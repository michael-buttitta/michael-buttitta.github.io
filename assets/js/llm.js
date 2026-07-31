/* =============================================================================
   Large Language Models — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /llm/ only.

   Structure:
     1. LLM core (pure — no DOM): a real, from-scratch educational stack.
          - byte-pair-encoding tokenizer, trained live on a tiny corpus
          - an interpolated n-gram language model (real counts, real
            probabilities — the transparent stand-in for a trained network)
          - co-occurrence (PPMI) word embeddings + a real 2D spectral
            projection via power iteration
          - sinusoidal positional encoding
          - scaled dot-product attention, multi-head attention, layer norm,
            GELU feed-forward, pre-norm transformer blocks, and a full
            forward pass with a weight-tied output head
          - temperature scaling, top-k and top-p (nucleus) sampling
        Everything is deterministic (seeded), operates on intentionally tiny
        matrices, and returns every intermediate value so the UI can expose
        the whole computation. When loaded under Node the file exports this
        core and stops — the shipped artifact is directly unit-testable.
     2. Shared UI utilities (canvas fitting, visibility gating, rAF loops)
     3. One init function per widget, guarded by element existence and
        wrapped in try/catch so one failure never takes down the page.
        Everything respects prefers-reduced-motion.

   Honesty notes: the tokenizer, the n-gram probabilities, the embeddings,
   the attention/transformer mathematics, and the three sampling filters are
   real implementations computing real numbers. The transformer's weights are
   seeded random values — it is deliberately UNTRAINED, and the page copy
   leans on that fact to teach what training contributes. The context-window,
   training-loop, scaling, and "beyond the transformer" visualizations are
   honest cartoons, labeled as such in the HTML.
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. LLM core (pure — no DOM)
     ========================================================================== */

  /* ---- deterministic RNG (LCG, same family as the other exhibits) ------- */
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function gaussFrom(rng) {
    var u = Math.max(rng(), 1e-9);
    var v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ---- the training corpus ----------------------------------------------
     A deliberately tiny micro-world. Every probability the page shows is a
     real statistic of these sentences — small enough that a visitor can
     audit any number by reading the corpus. */
  var CORPUS = [
    'the cat chased the mouse',
    'the dog chased the cat',
    'the cat sat on the mat',
    'the dog sat on the rug',
    'the mouse hid under the mat',
    'the cat watched the bird',
    'the dog watched the cat',
    'the bird sang in the tree',
    'the bird flew over the tree',
    'the cat slept in the sun',
    'the dog slept by the fire',
    'the mouse ate the cheese',
    'the cat ate the fish',
    'the dog ate the bone',
    'the bird ate the seed',
    'the sun rose over the hill',
    'the sun set over the sea',
    'the moon rose over the sea',
    'the rain fell on the roof',
    'the snow fell on the hill',
    'the storm rolled over the sea',
    'the wind blew through the tree',
    'the cloud drifted across the sky',
    'the stars shone in the sky',
    'the moon is bright',
    'the sun is warm',
    'the sea is deep',
    'the cheese was made of milk',
    'the bread was made of wheat',
    'the house was made of stone',
    'she read the book by the fire',
    'he read the letter twice',
    'she wrote a story about the sea',
    'he wrote a letter to a friend',
    'the story was about a cat',
    'the book was on the table',
    'the letter was from a friend',
    'a story starts with a word',
    'the model reads the text',
    'the model predicts the next word',
    'the model learned from the text',
    'a token is a piece of text',
    'the text is split into tokens',
    'the model turns words into numbers',
    'the next word depends on the last word'
  ];

  /* ---- tokenizer: byte-pair encoding, trained on the corpus -------------
     Real BPE: start from characters, repeatedly merge the most frequent
     adjacent pair. '▁' (▁) marks the start of a word, sentencepiece
     style. Ties break lexicographically so training is deterministic. */
  var WORD_MARK = '▁';
  var UNK = '<unk>';
  var BOS = '<s>';

  function preTokenize(text) {
    var out = [];
    var lower = String(text).toLowerCase();
    var re = /[a-z]+|[0-9]+|[^\sa-z0-9]/g;
    var m;
    while ((m = re.exec(lower)) !== null) {
      if (/[a-z0-9]/.test(m[0].charAt(0))) { out.push(WORD_MARK + m[0]); }
      else { out.push(m[0]); }
    }
    return out;
  }

  function mergePair(seq, a, b, joined) {
    var out = [];
    var i = 0;
    while (i < seq.length) {
      if (i < seq.length - 1 && seq[i] === a && seq[i + 1] === b) {
        out.push(joined);
        i += 2;
      } else {
        out.push(seq[i]);
        i += 1;
      }
    }
    return out;
  }

  function trainBPE(sentences, numMerges) {
    var freq = {};
    sentences.forEach(function (s) {
      preTokenize(s).forEach(function (w) { freq[w] = (freq[w] || 0) + 1; });
    });
    var words = Object.keys(freq).sort();
    var seqs = words.map(function (w) { return w.split(''); });

    var baseSet = {};
    seqs.forEach(function (seq) {
      seq.forEach(function (ch) { baseSet[ch] = true; });
    });

    var merges = [];
    for (var it = 0; it < numMerges; it++) {
      var pairCounts = {};
      seqs.forEach(function (seq, i) {
        var f = freq[words[i]];
        for (var j = 0; j < seq.length - 1; j++) {
          var key = seq[j] + ' ' + seq[j + 1];
          pairCounts[key] = (pairCounts[key] || 0) + f;
        }
      });
      var best = null;
      var bestC = 1; /* a merge must occur at least twice to be worth it */
      Object.keys(pairCounts).sort().forEach(function (k) {
        if (pairCounts[k] > bestC) { bestC = pairCounts[k]; best = k; }
      });
      if (best === null) { break; }
      var parts = best.split(' ');
      merges.push({ a: parts[0], b: parts[1], joined: parts[0] + parts[1], count: bestC });
      seqs = seqs.map(function (seq) { return mergePair(seq, parts[0], parts[1], parts[0] + parts[1]); });
    }

    /* vocabulary: specials, then base characters, then merges in order */
    var vocab = [UNK, BOS];
    Object.keys(baseSet).sort().forEach(function (ch) { vocab.push(ch); });
    merges.forEach(function (m) { vocab.push(m.joined); });

    var tokenToId = {};
    vocab.forEach(function (t, i) { tokenToId[t] = i; });

    var mergeRank = {};
    merges.forEach(function (m, i) { mergeRank[m.a + ' ' + m.b] = i; });

    return {
      vocab: vocab,
      tokenToId: tokenToId,
      merges: merges,
      mergeRank: mergeRank,
      wordFreq: freq
    };
  }

  /* apply learned merges to one pre-token, lowest-rank pair first (real BPE) */
  function bpeSegment(T, word) {
    var seq = word.split('');
    for (;;) {
      var bestRank = Infinity;
      var bestAt = -1;
      for (var i = 0; i < seq.length - 1; i++) {
        var r = T.mergeRank[seq[i] + ' ' + seq[i + 1]];
        if (r !== undefined && r < bestRank) { bestRank = r; bestAt = i; }
      }
      if (bestAt === -1) { break; }
      seq = mergePair(seq, seq[bestAt], seq[bestAt + 1], seq[bestAt] + seq[bestAt + 1]);
    }
    return seq;
  }

  function encodeDetailed(T, text) {
    var out = [];
    preTokenize(text).forEach(function (w) {
      bpeSegment(T, w).forEach(function (piece) {
        var id = T.tokenToId[piece];
        if (id === undefined) { out.push({ token: UNK, id: T.tokenToId[UNK], raw: piece }); }
        else { out.push({ token: piece, id: id, raw: piece }); }
      });
    });
    return out;
  }

  function encode(T, text) {
    return encodeDetailed(T, text).map(function (t) { return t.id; });
  }

  function decode(T, ids) {
    var s = ids.map(function (id) {
      var t = T.vocab[id];
      if (t === undefined || t === UNK || t === BOS) { return t === BOS ? '' : '␀'; }
      return t;
    }).join('');
    return s.split(WORD_MARK).join(' ').replace(/\s+/g, ' ').trim();
  }

  /* ---- n-gram language model over BPE tokens ----------------------------
     Interpolated trigram/bigram/unigram with real counts. This is the
     page's "trained model": every probability is an auditable statistic of
     the corpus. The page copy is explicit that production LLMs compute
     next-token distributions with a trained transformer instead — the
     *interface* (context in, distribution over the vocabulary out) is
     identical, which is the teaching point. */
  function trainNgram(T, sentences) {
    var uni = {};
    var bi = {};
    var tri = {};
    var total = 0;
    var bosId = T.tokenToId[BOS];
    var dotId = T.tokenToId['.'];

    sentences.forEach(function (s) {
      var ids = [bosId].concat(encode(T, s));
      if (dotId !== undefined) { ids.push(dotId); }
      for (var i = 1; i < ids.length; i++) {
        var w = ids[i];
        uni[w] = (uni[w] || 0) + 1;
        total += 1;
        var b = ids[i - 1];
        if (!bi[b]) { bi[b] = { n: 0, next: {} }; }
        bi[b].n += 1;
        bi[b].next[w] = (bi[b].next[w] || 0) + 1;
        if (i >= 2) {
          var t2 = ids[i - 2] + ',' + ids[i - 1];
          if (!tri[t2]) { tri[t2] = { n: 0, next: {} }; }
          tri[t2].n += 1;
          tri[t2].next[w] = (tri[t2].next[w] || 0) + 1;
        }
      }
    });
    return { uni: uni, bi: bi, tri: tri, total: total, bosId: bosId, dotId: dotId };
  }

  /* P(next | context) = 0.5·P₃ + 0.35·P₂ + 0.15·P₁ (weights renormalized
     when a higher-order context was never seen), floored so log-probs stay
     finite. Returns a dense array over the vocabulary that sums to 1. */
  function lmNextDist(T, M, contextIds) {
    var V = T.vocab.length;
    var ctx = contextIds.length ? contextIds : [M.bosId];
    var last = ctx[ctx.length - 1];
    var prev = ctx.length >= 2 ? ctx[ctx.length - 2] : M.bosId;

    var triRec = M.tri[prev + ',' + last];
    var biRec = M.bi[last];

    var wTri = triRec ? 0.5 : 0;
    var wBi = biRec ? 0.35 : 0;
    var wUni = 0.15;
    var wSum = wTri + wBi + wUni;

    var probs = new Array(V);
    var floor = 1e-6 / V;
    var sum = 0;
    for (var i = 0; i < V; i++) {
      var p = 0;
      if (triRec && triRec.next[i]) { p += (wTri / wSum) * (triRec.next[i] / triRec.n); }
      if (biRec && biRec.next[i]) { p += (wBi / wSum) * (biRec.next[i] / biRec.n); }
      if (M.uni[i]) { p += (wUni / wSum) * (M.uni[i] / M.total); }
      p += floor;
      probs[i] = p;
      sum += p;
    }
    for (i = 0; i < V; i++) { probs[i] /= sum; }
    return probs;
  }

  /* raw evidence behind one candidate — powers the "why?" panels */
  function lmExplain(T, M, contextIds, tokenId) {
    var ctx = contextIds.length ? contextIds : [M.bosId];
    var last = ctx[ctx.length - 1];
    var prev = ctx.length >= 2 ? ctx[ctx.length - 2] : M.bosId;
    var triRec = M.tri[prev + ',' + last];
    var biRec = M.bi[last];
    return {
      triContext: [T.vocab[prev], T.vocab[last]],
      triCount: triRec && triRec.next[tokenId] ? triRec.next[tokenId] : 0,
      triTotal: triRec ? triRec.n : 0,
      biContext: T.vocab[last],
      biCount: biRec && biRec.next[tokenId] ? biRec.next[tokenId] : 0,
      biTotal: biRec ? biRec.n : 0,
      uniCount: M.uni[tokenId] || 0,
      uniTotal: M.total
    };
  }

  /* ---- word embeddings: PPMI co-occurrence + spectral 2D projection -----
     Real distributional semantics on the corpus: count co-occurrences in a
     ±2 window, weight with positive pointwise mutual information, then
     project to 2D with the top two eigenvectors (power iteration with
     deflation). Similar-usage words genuinely end up near each other —
     nothing is hand-placed. */
  function buildWordEmbeddings(sentences) {
    var counts = {};
    sentences.forEach(function (s) {
      s.split(/\s+/).forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
    });
    var words = Object.keys(counts).sort();
    var idx = {};
    words.forEach(function (w, i) { idx[w] = i; });
    var n = words.length;

    var C = [];
    for (var i = 0; i < n; i++) { C.push(new Array(n).fill(0)); }
    sentences.forEach(function (s) {
      var ws = s.split(/\s+/);
      for (var a = 0; a < ws.length; a++) {
        for (var b = Math.max(0, a - 2); b <= Math.min(ws.length - 1, a + 2); b++) {
          if (a === b) { continue; }
          C[idx[ws[a]]][idx[ws[b]]] += 1;
        }
      }
    });

    var totalPairs = 0;
    var rowSum = new Array(n).fill(0);
    for (i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) { rowSum[i] += C[i][j]; totalPairs += C[i][j]; }
    }

    var P = [];
    for (i = 0; i < n; i++) {
      P.push(new Array(n).fill(0));
      for (j = 0; j < n; j++) {
        if (C[i][j] > 0) {
          var pmi = Math.log((C[i][j] * totalPairs) / (rowSum[i] * rowSum[j]));
          P[i][j] = pmi > 0 ? pmi : 0;
        }
      }
    }

    function matVec(M, v) {
      var out = new Array(M.length).fill(0);
      for (var r = 0; r < M.length; r++) {
        var s = 0;
        for (var c = 0; c < v.length; c++) { s += M[r][c] * v[c]; }
        out[r] = s;
      }
      return out;
    }
    function norm(v) { return Math.sqrt(v.reduce(function (s, x) { return s + x * x; }, 0)); }

    function topEigen(M, seed) {
      var rng = makeRng(seed);
      var v = [];
      for (var k = 0; k < M.length; k++) { v.push(rng() - 0.5); }
      var lambda = 0;
      for (var it = 0; it < 250; it++) {
        var w = matVec(M, v);
        lambda = norm(w);
        if (lambda < 1e-12) { break; }
        for (k = 0; k < w.length; k++) { v[k] = w[k] / lambda; }
      }
      /* deterministic sign: largest-magnitude component positive */
      var big = 0;
      for (k = 1; k < v.length; k++) { if (Math.abs(v[k]) > Math.abs(v[big])) { big = k; } }
      if (v[big] < 0) { for (k = 0; k < v.length; k++) { v[k] = -v[k]; } }
      return { vec: v, val: lambda };
    }

    var e1 = topEigen(P, 12345);
    var D = P.map(function (row, r) {
      return row.map(function (x, c) { return x - e1.val * e1.vec[r] * e1.vec[c]; });
    });
    var e2 = topEigen(D, 67890);

    var coords = words.map(function (w, k) {
      return {
        word: w,
        freq: counts[w],
        x: e1.vec[k] * Math.sqrt(Math.max(e1.val, 0)),
        y: e2.vec[k] * Math.sqrt(Math.max(e2.val, 0))
      };
    });

    function cosine(a, b) {
      var d = 0;
      var na = 0;
      var nb = 0;
      for (var k2 = 0; k2 < a.length; k2++) { d += a[k2] * b[k2]; na += a[k2] * a[k2]; nb += b[k2] * b[k2]; }
      if (na < 1e-12 || nb < 1e-12) { return 0; }
      return d / Math.sqrt(na * nb);
    }

    function neighbors(word, topN) {
      var i2 = idx[word];
      if (i2 === undefined) { return []; }
      return words
        .map(function (w, j2) { return { word: w, sim: j2 === i2 ? -1 : cosine(P[i2], P[j2]) }; })
        .sort(function (a, b) { return b.sim - a.sim; })
        .slice(0, topN || 5);
    }

    return { words: words, index: idx, vectors: P, coords: coords, cosine: cosine, neighbors: neighbors };
  }

  /* ---- tiny linear algebra ----------------------------------------------- */
  function matmul(A, B) {
    var n = A.length;
    var k = B.length;
    var m = B[0].length;
    var out = [];
    for (var i = 0; i < n; i++) {
      var row = new Array(m).fill(0);
      for (var p = 0; p < k; p++) {
        var a = A[i][p];
        if (a === 0) { continue; }
        for (var j = 0; j < m; j++) { row[j] += a * B[p][j]; }
      }
      out.push(row);
    }
    return out;
  }

  function transpose(A) {
    var out = [];
    for (var j = 0; j < A[0].length; j++) {
      var row = [];
      for (var i = 0; i < A.length; i++) { row.push(A[i][j]); }
      out.push(row);
    }
    return out;
  }

  function addRows(A, B) {
    return A.map(function (row, i) { return row.map(function (x, j) { return x + B[i][j]; }); });
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) { s += a[i] * b[i]; }
    return s;
  }

  function randMatrix(rows, cols, rng, scale) {
    var out = [];
    for (var i = 0; i < rows; i++) {
      var row = [];
      for (var j = 0; j < cols; j++) { row.push(gaussFrom(rng) * scale); }
      out.push(row);
    }
    return out;
  }

  /* ---- softmax (numerically stable) with optional temperature ----------- */
  function softmax(logits, temperature) {
    var T = temperature === undefined ? 1 : Math.max(temperature, 0.01);
    var mx = -Infinity;
    var i;
    for (i = 0; i < logits.length; i++) {
      var v = logits[i] / T;
      if (v > mx) { mx = v; }
    }
    var exps = new Array(logits.length);
    var sum = 0;
    for (i = 0; i < logits.length; i++) {
      var e = Math.exp(logits[i] / T - mx);
      exps[i] = e;
      sum += e;
    }
    for (i = 0; i < logits.length; i++) { exps[i] /= sum; }
    return exps;
  }

  /* ---- sinusoidal positional encoding (Vaswani et al. 2017) ------------- */
  function posEncoding(seqLen, dModel) {
    var out = [];
    for (var pos = 0; pos < seqLen; pos++) {
      var row = new Array(dModel);
      for (var i = 0; i < dModel; i++) {
        var angle = pos / Math.pow(10000, (2 * Math.floor(i / 2)) / dModel);
        row[i] = (i % 2 === 0) ? Math.sin(angle) : Math.cos(angle);
      }
      out.push(row);
    }
    return out;
  }

  /* ---- scaled dot-product attention --------------------------------------
     The real thing: scores = QKᵀ/√dₖ, optional causal mask, row softmax,
     weighted sum of V. Every intermediate is returned for inspection. */
  var MASKED = -1e9;

  function attention(Q, K, V, causal) {
    var dk = K[0].length;
    var scale = 1 / Math.sqrt(dk);
    var scores = [];
    var scaled = [];
    for (var i = 0; i < Q.length; i++) {
      var sRow = [];
      var cRow = [];
      for (var j = 0; j < K.length; j++) {
        var s = dot(Q[i], K[j]);
        sRow.push(s);
        var sc = s * scale;
        if (causal && j > i) { sc = MASKED; }
        cRow.push(sc);
      }
      scores.push(sRow);
      scaled.push(cRow);
    }
    var weights = scaled.map(function (row) { return softmax(row); });
    var output = matmul(weights, V);
    return { scores: scores, scaled: scaled, weights: weights, output: output, dk: dk };
  }

  /* ---- multi-head attention ---------------------------------------------- */
  function multiHeadAttention(X, params, causal) {
    var headOut = params.heads.map(function (h) {
      var Q = matmul(X, h.Wq);
      var K = matmul(X, h.Wk);
      var V = matmul(X, h.Wv);
      var att = attention(Q, K, V, causal);
      return { Q: Q, K: K, V: V, att: att };
    });
    var concat = X.map(function (_, i) {
      var row = [];
      headOut.forEach(function (h) { row = row.concat(h.att.output[i]); });
      return row;
    });
    var output = matmul(concat, params.Wo);
    return { heads: headOut, concat: concat, output: output };
  }

  /* ---- layer normalization (γ=1, β=0 for clarity) ------------------------ */
  function layerNorm(v) {
    var n = v.length;
    var mean = 0;
    var i;
    for (i = 0; i < n; i++) { mean += v[i]; }
    mean /= n;
    var va = 0;
    for (i = 0; i < n; i++) { va += (v[i] - mean) * (v[i] - mean); }
    va /= n;
    var inv = 1 / Math.sqrt(va + 1e-5);
    var out = new Array(n);
    for (i = 0; i < n; i++) { out[i] = (v[i] - mean) * inv; }
    return out;
  }

  /* ---- feed-forward network (GELU, tanh approximation) ------------------- */
  function gelu(x) {
    return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));
  }

  function ffn(X, params) {
    var H = matmul(X, params.W1).map(function (row, i) {
      return row.map(function (x, j) { return gelu(x + params.b1[j]); });
    });
    var out = matmul(H, params.W2).map(function (row) {
      return row.map(function (x, j) { return x + params.b2[j]; });
    });
    return { hidden: H, output: out };
  }

  /* ---- one pre-norm transformer block (GPT-2 style) ---------------------- */
  function transformerBlock(X, params, causal) {
    var ln1 = X.map(layerNorm);
    var mha = multiHeadAttention(ln1, params.attn, causal);
    var res1 = addRows(X, mha.output);
    var ln2 = res1.map(layerNorm);
    var ff = ffn(ln2, params.ffn);
    var out = addRows(res1, ff.output);
    return { input: X, ln1: ln1, mha: mha, res1: res1, ln2: ln2, ffn: ff, output: out };
  }

  /* ---- model builder + forward pass ---------------------------------------
     Weights are SEEDED RANDOM — this transformer is untrained on purpose.
     The mechanics (what runs) are exactly real; the values (what the weights
     mean) are what training would supply. The output head is weight-tied to
     the embedding matrix, as in GPT-2. */
  function buildModel(cfg) {
    var vocabSize = cfg.vocabSize;
    var d = cfg.dModel;
    var heads = cfg.heads;
    var layers = cfg.layers;
    var dk = Math.max(1, Math.floor(d / heads));
    var rng = makeRng(cfg.seed === undefined ? 42 : cfg.seed);
    var scale = 0.35;

    var We = randMatrix(vocabSize, d, rng, scale);
    var blocks = [];
    for (var L = 0; L < layers; L++) {
      var hs = [];
      for (var h = 0; h < heads; h++) {
        hs.push({
          Wq: randMatrix(d, dk, rng, scale),
          Wk: randMatrix(d, dk, rng, scale),
          Wv: randMatrix(d, dk, rng, scale)
        });
      }
      blocks.push({
        attn: { heads: hs, Wo: randMatrix(heads * dk, d, rng, scale) },
        ffn: {
          W1: randMatrix(d, d * 4, rng, scale),
          b1: new Array(d * 4).fill(0),
          W2: randMatrix(d * 4, d, rng, scale),
          b2: new Array(d).fill(0)
        }
      });
    }
    return {
      config: { vocabSize: vocabSize, dModel: d, heads: heads, layers: layers, dk: dk, seed: cfg.seed === undefined ? 42 : cfg.seed },
      We: We,
      blocks: blocks
    };
  }

  function countParams(model) {
    var c = model.config;
    var attn = c.heads * 3 * c.dModel * c.dk + (c.heads * c.dk) * c.dModel;
    var ff = c.dModel * 4 * c.dModel + 4 * c.dModel + 4 * c.dModel * c.dModel + c.dModel;
    return c.vocabSize * c.dModel + c.layers * (attn + ff);
  }

  function forward(model, ids, opts) {
    opts = opts || {};
    var usePos = opts.usePositional !== false;
    var causal = opts.causal !== false;
    var d = model.config.dModel;

    var embeddings = ids.map(function (id) { return model.We[id].slice(); });
    var pe = posEncoding(ids.length, d);
    var x = usePos ? addRows(embeddings, pe) : embeddings.map(function (r) { return r.slice(); });

    var blocks = [];
    var cur = x;
    model.blocks.forEach(function (bp) {
      var detail = transformerBlock(cur, bp, causal);
      blocks.push(detail);
      cur = detail.output;
    });

    var finalNorm = cur.map(layerNorm);
    var last = finalNorm[finalNorm.length - 1];
    /* weight-tied output head: logit_v = lastHidden · We[v] */
    var logits = new Array(model.config.vocabSize);
    for (var v = 0; v < model.config.vocabSize; v++) { logits[v] = dot(last, model.We[v]); }

    return {
      ids: ids,
      embeddings: embeddings,
      posEnc: pe,
      x0: x,
      blocks: blocks,
      finalNorm: finalNorm,
      lastHidden: last,
      logits: logits,
      probs: softmax(logits)
    };
  }

  /* ---- sampling: temperature, top-k, top-p --------------------------------
     These are the real decoding algorithms used in production inference,
     applied to real distributions. samplePipeline returns every stage so
     the UI can show exactly what each dial removed. */
  function applyTemperature(logits, temperature) {
    var T = Math.max(temperature, 0.01);
    return logits.map(function (x) { return x / T; });
  }

  function sortedEntries(probs) {
    var entries = [];
    for (var i = 0; i < probs.length; i++) { entries.push({ id: i, p: probs[i] }); }
    entries.sort(function (a, b) { return b.p - a.p || a.id - b.id; });
    return entries;
  }

  function topKFilter(entries, k) {
    if (!k || k <= 0 || k >= entries.length) { return { kept: entries.slice(), removed: [] }; }
    return { kept: entries.slice(0, k), removed: entries.slice(k) };
  }

  function topPFilter(entries, p) {
    if (!p || p >= 1) { return { kept: entries.slice(), removed: [] }; }
    var kept = [];
    var cum = 0;
    for (var i = 0; i < entries.length; i++) {
      kept.push(entries[i]);
      cum += entries[i].p;
      if (cum >= p) { break; }
    }
    return { kept: kept, removed: entries.slice(kept.length) };
  }

  function renormalize(entries) {
    var sum = 0;
    entries.forEach(function (e) { sum += e.p; });
    if (sum <= 0) { return entries.map(function (e) { return { id: e.id, p: 1 / entries.length }; }); }
    return entries.map(function (e) { return { id: e.id, p: e.p / sum }; });
  }

  function sampleFrom(entries, r) {
    var cum = 0;
    for (var i = 0; i < entries.length; i++) {
      cum += entries[i].p;
      if (r < cum) { return entries[i]; }
    }
    return entries[entries.length - 1];
  }

  function samplePipeline(logits, opts) {
    var temperature = opts.temperature === undefined ? 1 : opts.temperature;
    var k = opts.topK === undefined ? 0 : opts.topK;
    var p = opts.topP === undefined ? 1 : opts.topP;

    var tempered = applyTemperature(logits, temperature);
    var probs = softmax(tempered);
    var entries = sortedEntries(probs);
    var afterK = topKFilter(entries, k);
    var afterP = topPFilter(afterK.kept, p);
    var finalDist = renormalize(afterP.kept);
    var r = opts.rand === undefined ? 0.5 : opts.rand;
    var chosen = sampleFrom(finalDist, r);

    return {
      logits: logits,
      tempered: tempered,
      probs: probs,
      sorted: entries,
      afterTopK: afterK,
      afterTopP: afterP,
      finalDist: finalDist,
      rand: r,
      chosen: chosen
    };
  }

  /* ---- build the shared instances used by both Node tests and the UI ---- */
  var TOK = trainBPE(CORPUS, 200);
  var NGRAM = trainNgram(TOK, CORPUS);
  var EMB = buildWordEmbeddings(CORPUS);

  /* generate with the n-gram model through the real sampling pipeline */
  function lmGenerate(contextIds, opts) {
    var maxTokens = opts.maxTokens || 20;
    var rng = makeRng(opts.seed === undefined ? 7 : opts.seed);
    var ids = contextIds.slice();
    var steps = [];
    for (var i = 0; i < maxTokens; i++) {
      var dist = lmNextDist(TOK, NGRAM, ids);
      var logits = dist.map(function (x) { return Math.log(x); });
      var pipe = samplePipeline(logits, {
        temperature: opts.temperature, topK: opts.topK, topP: opts.topP, rand: rng()
      });
      steps.push(pipe);
      ids.push(pipe.chosen.id);
      if (pipe.chosen.id === NGRAM.dotId && opts.stopAtPeriod !== false) { break; }
    }
    return { ids: ids, steps: steps };
  }

  var LLM = {
    CORPUS: CORPUS,
    WORD_MARK: WORD_MARK,
    UNK: UNK,
    BOS: BOS,
    makeRng: makeRng,
    preTokenize: preTokenize,
    trainBPE: trainBPE,
    bpeSegment: bpeSegment,
    encodeDetailed: encodeDetailed,
    encode: encode,
    decode: decode,
    trainNgram: trainNgram,
    lmNextDist: lmNextDist,
    lmExplain: lmExplain,
    lmGenerate: lmGenerate,
    buildWordEmbeddings: buildWordEmbeddings,
    matmul: matmul,
    transpose: transpose,
    addRows: addRows,
    dot: dot,
    randMatrix: randMatrix,
    softmax: softmax,
    posEncoding: posEncoding,
    attention: attention,
    multiHeadAttention: multiHeadAttention,
    layerNorm: layerNorm,
    gelu: gelu,
    ffn: ffn,
    transformerBlock: transformerBlock,
    buildModel: buildModel,
    countParams: countParams,
    forward: forward,
    applyTemperature: applyTemperature,
    sortedEntries: sortedEntries,
    topKFilter: topKFilter,
    topPFilter: topPFilter,
    renormalize: renormalize,
    sampleFrom: sampleFrom,
    samplePipeline: samplePipeline,
    TOK: TOK,
    NGRAM: NGRAM,
    EMB: EMB
  };

  /* When loaded outside a browser (Node), export the core for the vector
     tests and stop — everything below is DOM territory.

     Calling conventions. Every exported function is positional, and the
     trained artifacts come FIRST — encode('text') throws; encode(T, 'text')
     is the call. The three prebuilt artifacts are on the export itself:

       TOK, NGRAM, EMB        the trained tokenizer, n-gram model, embeddings

       encode(T, text)                 -> array of token ids
       decode(T, ids)                  -> string (leading space is preserved,
                                          so round-trip tests want .trim())
       encodeDetailed(T, text)         -> per-word segmentation detail
       trainBPE(corpus, merges)        -> a fresh tokenizer T
       lmNextDist(T, M, contextIds)    -> dense array over the vocab, sums to 1
       lmExplain(T, M, contextIds, tokenId)
                                       -> the tri/bi/unigram counts behind one
                                          probability
       attention(Q, K, V, causal)      -> { weights, out }; rows of weights
                                          each sum to 1
       multiHeadAttention(X, params, causal)
       buildModel(cfg)                 REQUIRES cfg — throws TypeError if it is
                                       omitted, there is no default. Shape:
                                       { vocabSize, dModel, heads, layers, seed }
       forward(model, ids, opts)       -> { logits: [pos][vocab], probs, x0,
                                            blocks, ... }; opts defaults to
                                            { usePositional: true, causal: true }
       applyTemperature(logits, t)     -> scaled logits
       sortedEntries(dist)             -> [{ id, p }, ...] descending
       topKFilter(entries, k)          -> { kept, ... }   k = 0 keeps everything
       topPFilter(entries, p)          -> { kept, ... }
       renormalize(entries)            -> entries rescaled to sum to 1
       samplePipeline(logits, opts)    opts: { temperature, topK, topP, rand }
                                       rand is a 0..1 draw, not a seed

     Recorded vector suite — four assertions, all PASS as shipped. Run from the
     repository root; also checked in verbatim as _audit/llm-vectors.js:

       const L = require('./assets/js/llm.js'), T = L.TOK;
       const ids = L.encode(T, 'the bank of the river');
       // 1. BPE round-trip
       L.decode(T, ids).trim() === 'the bank of the river'
       // 2. n-gram distribution is a distribution
       const d = L.lmNextDist(T, L.NGRAM, ids);
       Math.abs(d.reduce((a, b) => a + b, 0) - 1) < 1e-9
       // 3. the causal mask hides the future: row 0 attends only to itself
       const I = [[1, 0], [0, 1]];
       const A = L.attention(I, I, I, true);
       Math.abs(A.weights[0][0] - 1) < 1e-12 && A.weights[0][1] === 0
       // 4. every attention row is a distribution
       A.weights.every(r => Math.abs(r.reduce((a, b) => a + b, 0) - 1) < 1e-9)
  */
  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = LLM;
    }
    return;
  }

  /* browser: expose for curious visitors' dev consoles, then build the UI */
  window.LLM_CORE = LLM;

  /* ==========================================================================
     2. Shared UI utilities
     ========================================================================== */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  document.documentElement.classList.add('llm-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return RM.matches; }

  var C = {
    deep: '#0b1120', line: '#1e293b', lineStrong: '#334155',
    text: '#cbd5e1', strong: '#f1f5f9', muted: '#94a3b8', faint: '#64748b',
    teal: '#2dd4bf', tealDeep: '#14b8a6',
    cTeal: '#0d9488', amber: '#d97706', sky: '#0284c7',
    rose: '#e11d48', violet: '#8b5cf6', lime: '#65a30d'
  };
  var SERIES = [C.cTeal, C.amber, C.sky, C.rose, C.violet, C.lime];

  function setupCanvas(canvas, onResize) {
    var ctx = canvas.getContext('2d');
    if (!ctx) { throw new Error('2d context unavailable'); }
    var state = { w: 0, h: 0, dpr: 1 };
    var initial = true;
    function resize() {
      var rect = canvas.getBoundingClientRect();
      if (rect.width < 2) { return; }
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = rect.width;
      state.h = rect.height;
      canvas.width = Math.max(2, Math.round(rect.width * state.dpr));
      canvas.height = Math.max(2, Math.round(rect.height * state.dpr));
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      if (onResize && !initial) { onResize(); }
    }
    if ('ResizeObserver' in window) {
      var pending = null;
      new ResizeObserver(function () {
        if (pending) { return; }
        pending = requestAnimationFrame(function () { pending = null; resize(); });
      }).observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();
    initial = false;
    return { ctx: ctx, state: state, resize: resize };
  }

  function onScreen(el, enter, leave) {
    if (!('IntersectionObserver' in window)) { if (enter) { enter(); } return; }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { if (enter) { enter(); } }
        else if (leave) { leave(); }
      });
    }, { threshold: 0.12 }).observe(el);
  }

  function makeLoop(fn) {
    var id = null;
    var last = 0;
    function frame(t) {
      id = requestAnimationFrame(frame);
      var dt = Math.min(50, t - last);
      last = t;
      fn(t, dt);
    }
    return {
      start: function () { if (id === null) { last = performance.now(); id = requestAnimationFrame(frame); } },
      stop: function () { if (id !== null) { cancelAnimationFrame(id); id = null; } },
      running: function () { return id !== null; }
    };
  }

  function fmt(v, d) {
    if (!isFinite(v)) { return v > 0 ? '∞' : '−∞'; }
    return v.toFixed(d === undefined ? 2 : d);
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  /* human-readable token label (the ▁ word mark stays visible on purpose) */
  function tokLabel(id) {
    var t = TOK.vocab[id];
    return t === undefined ? '?' : t;
  }

  /* signed-value heat color: teal for +, rose for −, alpha by magnitude */
  function heatColor(v, maxAbs) {
    var m = maxAbs > 1e-9 ? maxAbs : 1;
    var a = clamp(Math.abs(v) / m, 0, 1);
    return v >= 0
      ? 'rgba(45, 212, 191, ' + (0.08 + 0.8 * a).toFixed(3) + ')'
      : 'rgba(225, 29, 72, ' + (0.08 + 0.8 * a).toFixed(3) + ')';
  }

  /* probability bar list. entries: [{id, p}] (or {label, p}). opts:
     onClick(entry), highlightId, removed (render as killed), max. */
  function renderBars(container, entries, opts) {
    opts = opts || {};
    container.textContent = '';
    var max = 0;
    entries.forEach(function (e) { if (e.p > max) { max = e.p; } });
    entries.slice(0, opts.max || 10).forEach(function (e) {
      var row = el('button', 'llm-bar' + (opts.highlightId === e.id ? ' is-hot' : '') + (e.killed ? ' is-killed' : ''));
      row.type = 'button';
      if (!opts.onClick) { row.disabled = true; }
      var lab = el('span', 'llm-bar-label', e.label !== undefined ? e.label : tokLabel(e.id));
      var track = el('span', 'llm-bar-track');
      var fill = el('span', 'llm-bar-fill');
      fill.style.width = (max > 0 ? (100 * e.p / max) : 0).toFixed(1) + '%';
      track.appendChild(fill);
      var pct = el('span', 'llm-bar-pct', (100 * e.p).toFixed(1) + '%');
      row.appendChild(lab);
      row.appendChild(track);
      row.appendChild(pct);
      if (opts.onClick) {
        row.addEventListener('click', function () { opts.onClick(e); });
      }
      container.appendChild(row);
    });
    if (opts.footnote) {
      container.appendChild(el('p', 'llm-bar-foot', opts.footnote));
    }
  }

  /* matrix table renderer: data = array of rows; labels optional */
  function renderMatrix(table, data, rowLabels, colLabels, digits) {
    table.textContent = '';
    var maxAbs = 0;
    data.forEach(function (row) {
      row.forEach(function (v) {
        if (isFinite(v) && Math.abs(v) > maxAbs) { maxAbs = Math.abs(v); }
      });
    });
    if (colLabels) {
      var thead = el('thead');
      var hr = el('tr');
      hr.appendChild(el('th', null, ''));
      colLabels.forEach(function (c) { hr.appendChild(el('th', null, c)); });
      thead.appendChild(hr);
      table.appendChild(thead);
    }
    var tbody = el('tbody');
    data.forEach(function (row, i) {
      var tr = el('tr');
      tr.appendChild(el('th', null, rowLabels ? rowLabels[i] : String(i)));
      row.forEach(function (v) {
        var td = el('td', null, isFinite(v) ? fmt(v, digits === undefined ? 2 : digits) : '−∞');
        if (isFinite(v)) { td.style.background = heatColor(v, maxAbs); }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  /* draw a matrix as a canvas heatmap inside rect */
  function drawHeat(ctx, data, x, y, w, h, maxAbsIn) {
    var rows = data.length;
    var cols = data[0].length;
    var maxAbs = maxAbsIn;
    if (!maxAbs) {
      maxAbs = 0;
      data.forEach(function (r) { r.forEach(function (v) { if (isFinite(v) && Math.abs(v) > maxAbs) { maxAbs = Math.abs(v); } }); });
    }
    var cw = w / cols;
    var ch = h / rows;
    for (var i = 0; i < rows; i++) {
      for (var j = 0; j < cols; j++) {
        var v = data[i][j];
        ctx.fillStyle = isFinite(v) ? heatColor(v, maxAbs) : 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(x + j * cw + 0.5, y + i * ch + 0.5, Math.max(cw - 1, 1), Math.max(ch - 1, 1));
      }
    }
  }

  var TOK = LLM.TOK;
  var NGRAM = LLM.NGRAM;

  /* the shared educational model used by chapters 4, 5 and 7 */
  var EDU = LLM.buildModel({ vocabSize: TOK.vocab.length, dModel: 8, heads: 2, layers: 2, seed: 42 });

  function textTokens(text) { return LLM.encode(TOK, text); }
  function tokenChipText(id) {
    var t = tokLabel(id);
    return t;
  }
  function appendTokenText(text, id) {
    var t = TOK.vocab[id];
    if (t === undefined || t === LLM.UNK || t === LLM.BOS) { return text; }
    if (t.charAt(0) === LLM.WORD_MARK) { return text + ' ' + t.slice(1); }
    return text + t;
  }

  /* ==========================================================================
     Reveal-on-scroll + chapter rail
     ========================================================================== */

  function initReveal() {
    var targets = $$('#llm-experience [data-llm-reveal]');
    if (!targets.length) { return; }
    if (!('IntersectionObserver' in window) || reduced()) {
      targets.forEach(function (t) { t.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    targets.forEach(function (t) { io.observe(t); });
  }

  function initRail() {
    var dots = $$('#llm-experience .llm-rail-dot');
    if (!dots.length || !('IntersectionObserver' in window)) { return; }
    var map = {};
    dots.forEach(function (d) {
      var id = (d.getAttribute('href') || '').slice(1);
      if (id) { map[id] = d; }
    });
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) { return; }
        var id = e.target.id;
        if (!map[id]) { return; }
        if (current) { current.classList.remove('is-active'); }
        current = map[id];
        current.classList.add('is-active');
      });
    }, { rootMargin: '-30% 0px -55% 0px' });
    Object.keys(map).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) { io.observe(sec); }
    });
  }

  /* ==========================================================================
     Hero — ambient stream of tokens condensing into a prediction
     ========================================================================== */

  function initHero() {
    var canvas = $('#llm-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { if (reduced() || !loop) { draw(0); } });
    var ctx = cv.ctx;
    var rng = LLM.makeRng(2024);
    var words = [];
    TOK.vocab.slice(30).forEach(function (t) {
      if (t.charAt(0) === LLM.WORD_MARK && t.length > 3) { words.push(t.slice(1)); }
    });
    if (!words.length) { words = ['token', 'model', 'text']; }
    var parts = [];
    for (var i = 0; i < 46; i++) {
      parts.push({
        word: words[Math.floor(rng() * words.length)],
        x: rng(), y: rng(),
        v: 0.006 + rng() * 0.02,
        size: 10 + rng() * 8,
        a: 0.08 + rng() * 0.3,
        hot: rng() < 0.12
      });
    }
    function draw(t) {
      var w = cv.state.w;
      var h = cv.state.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      parts.forEach(function (p) {
        var x = ((p.x + (reduced() ? 0 : t * 0.00001 * p.v * 60)) % 1.1) * w;
        var y = p.y * h;
        ctx.font = '600 ' + p.size + 'px Inter, sans-serif';
        ctx.fillStyle = p.hot
          ? 'rgba(45, 212, 191, ' + (p.a + 0.15) + ')'
          : 'rgba(148, 163, 184, ' + p.a + ')';
        ctx.fillText(p.word, x - 60, y);
        if (p.hot) {
          var tw = ctx.measureText(p.word).width;
          ctx.strokeStyle = 'rgba(45, 212, 191, ' + (p.a * 0.7) + ')';
          ctx.strokeRect(x - 66, y - p.size, tw + 12, p.size + 8);
        }
      });
    }
    if (reduced()) { draw(0); return; }
    var loop = makeLoop(function (t) { draw(t); });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     01 — next-token prediction
     ========================================================================== */

  function initPredict() {
    var input = $('#llm-predict-input');
    var bars = $('#llm-predict-bars');
    if (!input || !bars) { return; }
    var why = $('#llm-predict-why');
    var status = $('#llm-predict-status');
    var corpusList = $('#llm-corpus-list');

    if (corpusList) {
      LLM.CORPUS.forEach(function (s) {
        corpusList.appendChild(el('span', 'llm-corpus-sent', s + '.'));
      });
    }

    var selectedId = null;

    function explain(entry) {
      selectedId = entry.id;
      var ids = textTokens(input.value);
      var ex = LLM.lmExplain(TOK, NGRAM, ids, entry.id);
      why.textContent = '';
      why.appendChild(el('p', 'llm-why-tok', 'candidate: ' + tokLabel(entry.id) + '  ·  p = ' + (100 * entry.p).toFixed(1) + '%'));
      var lines = [
        ['After ‹' + ex.triContext.join(' ') + '›', ex.triCount, ex.triTotal, 'trigram'],
        ['After ‹' + ex.biContext + '›', ex.biCount, ex.biTotal, 'bigram'],
        ['Anywhere in the corpus', ex.uniCount, ex.uniTotal, 'unigram']
      ];
      lines.forEach(function (l) {
        var p = el('p', 'llm-why-line');
        p.appendChild(el('strong', null, l[3] + ': '));
        p.appendChild(document.createTextNode(
          l[2] > 0
            ? l[0] + ', this token appeared ' + l[1] + ' of ' + l[2] + ' times (' + (100 * l[1] / l[2]).toFixed(1) + '%).'
            : l[0] + ': that context never occurs in the corpus, so this level is skipped.'
        ));
        why.appendChild(p);
      });
      why.appendChild(el('p', 'llm-why-line llm-why-note',
        'Final probability = the three levels blended (50% trigram, 35% bigram, 15% unigram, renormalized when a level is missing). Every number is a count you can verify in the corpus above.'));
      render(false);
    }

    function render(resetSel) {
      if (resetSel !== false) { selectedId = null; }
      var ids = textTokens(input.value);
      var dist = LLM.lmNextDist(TOK, NGRAM, ids);
      var entries = LLM.sortedEntries(dist).slice(0, 8);
      renderBars(bars, entries, { onClick: explain, highlightId: selectedId, max: 8 });
      return { ids: ids, dist: dist, entries: entries };
    }

    function appendToken(id, p, how) {
      input.value = appendTokenText(input.value, id);
      if (status) {
        status.textContent = how + ' ' + tokLabel(id) + '  (p = ' + (100 * p).toFixed(1) + '%)';
      }
      if (why) {
        why.textContent = '';
        why.appendChild(el('p', 'llm-why-hint', 'Click any bar to see the raw counts behind its probability.'));
      }
      render();
    }

    input.addEventListener('input', function () { render(); if (status) { status.textContent = ''; } });

    $$('#llm-predict-presets .llm-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        input.value = chip.getAttribute('data-text') || '';
        if (status) { status.textContent = ''; }
        render();
      });
    });

    var step = $('#llm-predict-step');
    if (step) {
      step.addEventListener('click', function () {
        var r = render();
        var top = r.entries[0];
        if (top) { appendToken(top.id, top.p, 'appended most likely:'); }
      });
    }
    var sample = $('#llm-predict-sample');
    if (sample) {
      sample.addEventListener('click', function () {
        var ids = textTokens(input.value);
        var dist = LLM.lmNextDist(TOK, NGRAM, ids);
        var entries = LLM.sortedEntries(dist);
        var pick = LLM.sampleFrom(entries, Math.random());
        appendToken(pick.id, pick.p, 'sampled:');
      });
    }
    var reset = $('#llm-predict-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        input.value = 'the cat';
        if (status) { status.textContent = ''; }
        render();
      });
    }
    render();
  }

  /* ==========================================================================
     02 — tokenizer
     ========================================================================== */

  function initTokenizer() {
    var input = $('#llm-tok-input');
    var chips = $('#llm-tok-chips');
    var idsRow = $('#llm-tok-ids');
    if (!input || !chips || !idsRow) { return; }
    var outChars = $('#llm-tok-chars');
    var outCount = $('#llm-tok-count');
    var outVocab = $('#llm-tok-vocab');
    if (outVocab) { outVocab.textContent = String(TOK.vocab.length) + ' tokens'; }

    function render() {
      var detail = LLM.encodeDetailed(TOK, input.value);
      chips.textContent = '';
      idsRow.textContent = '';
      detail.forEach(function (t, i) {
        var color = SERIES[i % SERIES.length];
        var chip = el('span', 'llm-tok-chip' + (t.token === LLM.UNK ? ' is-unk' : ''), t.token === LLM.UNK ? LLM.UNK : t.token);
        chip.style.borderColor = color;
        if (t.token === LLM.UNK && t.raw) { chip.title = 'no token for "' + t.raw + '" — mapped to <unk>'; }
        chips.appendChild(chip);
        var idc = el('span', 'llm-tok-id', String(t.id));
        idc.style.borderColor = color;
        idsRow.appendChild(idc);
      });
      if (outChars) { outChars.textContent = String(input.value.length); }
      if (outCount) { outCount.textContent = String(detail.length); }
    }

    input.addEventListener('input', render);
    $$('#llm-tok-presets .llm-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        input.value = chip.getAttribute('data-text') || '';
        render();
      });
    });

    var vocabList = $('#llm-tok-vocablist');
    var fold = vocabList ? vocabList.closest('details') : null;
    var built = false;
    if (fold && vocabList) {
      fold.addEventListener('toggle', function () {
        if (!fold.open || built) { return; }
        built = true;
        TOK.vocab.forEach(function (t, id) {
          var cell = el('span', 'llm-vocab-item');
          cell.appendChild(el('small', null, String(id)));
          cell.appendChild(el('span', null, t));
          if (id >= TOK.vocab.length - TOK.merges.length) {
            var m = TOK.merges[id - (TOK.vocab.length - TOK.merges.length)];
            cell.title = 'merge #' + (id - (TOK.vocab.length - TOK.merges.length) + 1) + ': "' + m.a + '" + "' + m.b + '" (seen ' + m.count + '×)';
            cell.classList.add('is-merge');
          }
          vocabList.appendChild(cell);
        });
      });
    }
    render();
  }

  /* ==========================================================================
     03 — embeddings
     ========================================================================== */

  function initEmbeddings() {
    var canvas = $('#llm-emb-canvas');
    var panel = $('#llm-emb-panel');
    if (!canvas || !panel) { return; }
    var EMB = LLM.EMB;
    var cv = setupCanvas(canvas, layout);
    var ctx = cv.ctx;

    var pts = [];
    var selA = null;
    var selB = null;
    var hover = null;
    var dragging = null;
    var moved = false;

    function layout() {
      if (cv.state.w < 60 || cv.state.h < 60) { return; }
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      EMB.coords.forEach(function (c) {
        if (c.x < minX) { minX = c.x; }
        if (c.x > maxX) { maxX = c.x; }
        if (c.y < minY) { minY = c.y; }
        if (c.y > maxY) { maxY = c.y; }
      });
      var pad = 42;
      var w = cv.state.w - pad * 2;
      var h = cv.state.h - pad * 2;
      pts = EMB.coords.map(function (c) {
        return {
          word: c.word,
          freq: c.freq,
          x: pad + ((c.x - minX) / (maxX - minX || 1)) * w,
          y: pad + ((c.y - minY) / (maxY - minY || 1)) * h
        };
      });
      draw();
    }

    function neighborsOf(word) {
      return EMB.neighbors(word, 5).filter(function (n) { return n.sim > 0.05; });
    }

    function draw() {
      if (cv.state.w < 60 || cv.state.h < 60) { return; }
      ctx.clearRect(0, 0, cv.state.w, cv.state.h);
      var nbSet = {};
      if (selA && !selB) {
        neighborsOf(selA.word).forEach(function (n) { nbSet[n.word] = n.sim; });
      }
      /* neighbor connector lines */
      if (selA && !selB) {
        pts.forEach(function (p) {
          if (nbSet[p.word] === undefined) { return; }
          ctx.strokeStyle = 'rgba(45, 212, 191, ' + (0.15 + nbSet[p.word] * 0.5) + ')';
          ctx.lineWidth = 1 + nbSet[p.word] * 2;
          ctx.beginPath();
          ctx.moveTo(selA.x, selA.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        });
      }
      if (selA && selB) {
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(selA.x, selA.y);
        ctx.lineTo(selB.x, selB.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      pts.forEach(function (p) {
        var isSel = (selA && p.word === selA.word) || (selB && p.word === selB.word);
        var isNb = nbSet[p.word] !== undefined;
        var isHover = hover && hover.word === p.word;
        var r = 3 + Math.min(p.freq, 30) * 0.12 + (isSel ? 3 : 0);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? C.teal : (isNb ? 'rgba(45, 212, 191, 0.75)' : (isHover ? C.text : 'rgba(148, 163, 184, 0.55)'));
        ctx.fill();
        ctx.font = (isSel || isNb || isHover ? '700 12px' : '500 10px') + ' Inter, sans-serif';
        ctx.fillStyle = isSel ? C.strong : (isNb ? C.teal : (isHover ? C.strong : 'rgba(148, 163, 184, 0.6)'));
        ctx.fillText(p.word, p.x + r + 3, p.y + 3);
      });
    }

    function renderPanel() {
      panel.textContent = '';
      if (!selA) {
        panel.appendChild(el('p', 'llm-why-hint', 'Click any word on the map.'));
        return;
      }
      if (selA && selB) {
        var sim = EMB.cosine(EMB.vectors[EMB.index[selA.word]], EMB.vectors[EMB.index[selB.word]]);
        panel.appendChild(el('p', 'llm-why-tok', selA.word + '  ↔  ' + selB.word));
        panel.appendChild(el('p', 'llm-why-line', 'Cosine similarity in the full space: ' + sim.toFixed(3) +
          (sim > 0.5 ? ' — the corpus uses these words very similarly.' :
            sim > 0.15 ? ' — some shared contexts.' : ' — barely related in this corpus.')));
        panel.appendChild(el('p', 'llm-why-line llm-why-note', 'Click a third word to restart the comparison.'));
        return;
      }
      panel.appendChild(el('p', 'llm-why-tok', selA.word + '  ·  appears ' + selA.freq + '×'));
      var nbs = neighborsOf(selA.word);
      if (nbs.length) {
        panel.appendChild(el('p', 'llm-why-line', 'Nearest neighbors (cosine, full 92-dim space):'));
        var wrap = el('div', 'llm-bars llm-bars-mini');
        renderBars(wrap, nbs.map(function (n) { return { id: -1, label: n.word, p: Math.max(n.sim, 0) }; }), { max: 5 });
        panel.appendChild(wrap);
      } else {
        panel.appendChild(el('p', 'llm-why-line', 'This word is too rare in the corpus to have meaningful neighbors — exactly what happens to rare tokens in real models.'));
      }
      panel.appendChild(el('p', 'llm-why-line llm-why-note', 'Now click a second word to compare the pair.'));
    }

    function hit(mx, my) {
      var best = null;
      var bestD = 18 * 18;
      pts.forEach(function (p) {
        var dx = p.x - mx;
        var dy = p.y - my;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = p; }
      });
      return best;
    }

    function pos(ev) {
      var r = canvas.getBoundingClientRect();
      var c = ev.touches && ev.touches.length ? ev.touches[0] : ev;
      return { x: c.clientX - r.left, y: c.clientY - r.top };
    }

    canvas.addEventListener('pointerdown', function (ev) {
      var p = pos(ev);
      var t = hit(p.x, p.y);
      if (t) {
        dragging = t;
        moved = false;
        canvas.setPointerCapture(ev.pointerId);
      }
    });
    canvas.addEventListener('pointermove', function (ev) {
      var p = pos(ev);
      if (dragging) {
        dragging.x = clamp(p.x, 8, cv.state.w - 8);
        dragging.y = clamp(p.y, 8, cv.state.h - 8);
        moved = true;
        draw();
        return;
      }
      var h = hit(p.x, p.y);
      if ((h && !hover) || (!h && hover) || (h && hover && h.word !== hover.word)) {
        hover = h;
        canvas.style.cursor = h ? 'pointer' : 'default';
        draw();
      }
    });
    canvas.addEventListener('pointerup', function () {
      if (dragging && !moved) {
        var t = dragging;
        if (!selA || (selA && selB)) { selA = t; selB = null; }
        else if (selA && t.word !== selA.word) { selB = t; }
        renderPanel();
      }
      dragging = null;
      draw();
    });

    var clear = $('#llm-emb-clear');
    if (clear) {
      clear.addEventListener('click', function () {
        selA = null;
        selB = null;
        layout();
        renderPanel();
      });
    }

    layout();
    renderPanel();
  }

  /* ==========================================================================
     04 — positional encoding
     ========================================================================== */

  function initPositional() {
    var pairA = $('#llm-pos-sent-a');
    var pairB = $('#llm-pos-sent-b');
    var verdict = $('#llm-pos-verdict');
    if (!pairA || !pairB || !verdict) { return; }
    var toggle = $('#llm-pos-toggle');

    var SENT_A = 'the cat chased the dog';
    var SENT_B = 'the dog chased the cat';

    function vectorsFor(text, usePos) {
      var ids = textTokens(text);
      var f = LLM.forward(EDU, ids, { usePositional: usePos });
      return { ids: ids, X: f.x0 };
    }

    function renderSentence(container, title, data) {
      container.textContent = '';
      container.appendChild(el('p', 'llm-panel-h', title));
      var row = el('div', 'llm-pos-toks');
      var maxAbs = 0;
      data.X.forEach(function (v) { v.forEach(function (x) { if (Math.abs(x) > maxAbs) { maxAbs = Math.abs(x); } }); });
      data.ids.forEach(function (id, i) {
        var chip = el('span', 'llm-pos-tok');
        chip.appendChild(el('span', 'llm-pos-tok-word', tokLabel(id)));
        var strip = el('span', 'llm-pos-strip');
        data.X[i].forEach(function (v) {
          var cell = el('span', 'llm-pos-cell');
          cell.style.background = heatColor(v, maxAbs);
          strip.appendChild(cell);
        });
        chip.appendChild(strip);
        chip.appendChild(el('small', null, 'pos ' + i));
        row.appendChild(chip);
      });
      container.appendChild(row);
    }

    function multisetKey(X) {
      return X.map(function (v) {
        return v.map(function (x) { return x.toFixed(6); }).join(',');
      }).sort().join('|');
    }

    function render() {
      var usePos = toggle ? toggle.checked : true;
      var A = vectorsFor(SENT_A, usePos);
      var B = vectorsFor(SENT_B, usePos);
      renderSentence(pairA, '“' + SENT_A + '”', A);
      renderSentence(pairB, '“' + SENT_B + '”', B);
      var same = multisetKey(A.X) === multisetKey(B.X);
      verdict.textContent = same
        ? 'Verified on the live numbers: without positional encoding, both sentences hand the model the exact same set of vectors. Who chased whom is unrecoverable.'
        : 'Verified on the live numbers: with positional encoding added, the two sentences now produce different vectors — position is baked into every token.';
      verdict.className = 'llm-pos-verdict ' + (same ? 'is-same' : 'is-diff');
    }

    if (toggle) { toggle.addEventListener('change', render); }
    render();

    /* PE heatmap + row inspector */
    var canvas = $('#llm-pos-canvas');
    var table = $('#llm-pos-table');
    if (canvas) {
      var POSN = 16;
      var DIMS = 32;
      var PE = LLM.posEncoding(POSN, DIMS);
      var cv = setupCanvas(canvas, drawPE);
      var selRow = -1;
      function drawPE() {
        var ctx = cv.ctx;
        if (cv.state.w < 60 || cv.state.h < 60) { return; }
        ctx.clearRect(0, 0, cv.state.w, cv.state.h);
        var labelW = 52;
        drawHeat(ctx, PE, labelW, 6, cv.state.w - labelW - 8, cv.state.h - 12, 1);
        ctx.font = '600 10px Inter, sans-serif';
        ctx.fillStyle = C.faint;
        var rh = (cv.state.h - 12) / POSN;
        for (var i = 0; i < POSN; i++) {
          ctx.fillStyle = i === selRow ? C.teal : C.faint;
          ctx.fillText('pos ' + i, 8, 6 + i * rh + rh / 2 + 3);
        }
      }
      canvas.addEventListener('click', function (ev) {
        var r = canvas.getBoundingClientRect();
        var y = ev.clientY - r.top;
        var row = Math.floor((y - 6) / ((cv.state.h - 12) / POSN));
        if (row < 0 || row >= POSN) { return; }
        selRow = row;
        drawPE();
        if (table) {
          var cols = [];
          for (var d = 0; d < DIMS; d++) { cols.push('d' + d); }
          renderMatrix(table, [PE[row]], ['PE(pos ' + row + ')'], cols, 3);
        }
      });
      drawPE();
    }
  }

  /* ==========================================================================
     05 — self-attention explorer
     ========================================================================== */

  function initAttention() {
    var tokensRow = $('#llm-att-tokens');
    var canvas = $('#llm-att-canvas');
    if (!tokensRow || !canvas) { return; }
    var sentenceSel = $('#llm-att-sentence');
    var causalToggle = $('#llm-att-causal');
    var readout = $('#llm-att-readout');
    var matrixTable = $('#llm-att-matrix');
    var matNote = $('#llm-att-matnote');

    /* one real head, small enough to read: dModel 8 → dk 4 */
    var head = EDU.blocks[0].attn.heads[0];

    var state = { ids: [], labels: [], sel: 0, mat: 'Q', att: null, X: null, Q: null, K: null, V: null };
    var cv = setupCanvas(canvas, drawArcs);

    var MAT_NOTES = {
      Q: 'Q = X·W_q — each row is one token’s question: “what am I looking for?” (4 numbers per token, because this head projects 8 dims down to 4).',
      K: 'K = X·W_k — each row is one token’s advertisement: “here is what I hold.” Queries are compared against every key.',
      V: 'V = X·W_v — each row is what the token will actually contribute if attended to. Attention decides how much of each V row flows onward.',
      scores: 'Q·Kᵀ/√d_k — every query dotted with every key, scaled by √4 = 2 so softmax stays in a healthy range. Masked cells (−∞) are the future the causal mask hides.',
      weights: 'softmax of each row — every row now sums to exactly 1.00 and is the mixing recipe for that token. This is “the attention” everyone talks about.',
      output: 'weights·V — each token’s new representation: a weighted blend of every value it attended to. This is what flows into the rest of the block.'
    };

    function compute() {
      var f = LLM.forward(EDU, state.ids, {});
      state.X = f.x0;
      state.Q = LLM.matmul(state.X, head.Wq);
      state.K = LLM.matmul(state.X, head.Wk);
      state.V = LLM.matmul(state.X, head.Wv);
      state.att = LLM.attention(state.Q, state.K, state.V, causalToggle ? causalToggle.checked : true);
    }

    function setSentence(text) {
      state.ids = textTokens(text);
      state.labels = state.ids.map(tokLabel);
      state.sel = Math.min(state.sel, state.ids.length - 1);
      compute();
      renderTokens();
      drawArcs();
      renderReadout();
      renderMatrix_();
    }

    function renderTokens() {
      tokensRow.textContent = '';
      state.labels.forEach(function (lab, i) {
        var b = el('button', 'llm-att-tok' + (i === state.sel ? ' is-active' : ''), lab);
        b.type = 'button';
        b.addEventListener('click', function () {
          state.sel = i;
          renderTokens();
          drawArcs();
          renderReadout();
        });
        tokensRow.appendChild(b);
      });
    }

    function drawArcs() {
      if (!state.att) { return; }
      var ctx = cv.ctx;
      var w = cv.state.w;
      var h = cv.state.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      var n = state.ids.length;
      var pad = 40;
      var xs = [];
      for (var i = 0; i < n; i++) { xs.push(pad + (w - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1))); }
      var base = h - 34;
      var weights = state.att.weights[state.sel];
      /* arcs */
      for (i = 0; i < n; i++) {
        if (i === state.sel) { continue; }
        var wt = weights[i];
        if (wt < 0.004) { continue; }
        var x1 = xs[state.sel];
        var x2 = xs[i];
        var mid = (x1 + x2) / 2;
        var lift = Math.min(Math.abs(x2 - x1) * 0.5, base - 24);
        ctx.strokeStyle = 'rgba(45, 212, 191, ' + (0.15 + wt * 0.85) + ')';
        ctx.lineWidth = 1 + wt * 9;
        ctx.beginPath();
        ctx.moveTo(x1, base - 12);
        ctx.quadraticCurveTo(mid, base - 12 - lift, x2, base - 12);
        ctx.stroke();
      }
      /* self weight + nodes */
      for (i = 0; i < n; i++) {
        var isSel = i === state.sel;
        var wt2 = weights[i];
        ctx.beginPath();
        ctx.arc(xs[i], base - 6, isSel ? 7 : 5 + wt2 * 6, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? C.teal : 'rgba(45, 212, 191, ' + (0.2 + wt2 * 0.8) + ')';
        ctx.fill();
        ctx.font = (isSel ? '700 12px' : '600 11px') + ' Inter, sans-serif';
        ctx.fillStyle = isSel ? C.strong : C.muted;
        ctx.textAlign = 'center';
        ctx.fillText(state.labels[i], xs[i], base + 16);
        ctx.fillStyle = wt2 > 0.003 ? C.teal : C.faint;
        ctx.font = '600 10px Inter, sans-serif';
        ctx.fillText((wt2 * 100).toFixed(0) + '%', xs[i], base - 20 - (isSel ? 4 : 0));
        ctx.textAlign = 'left';
      }
    }

    function renderReadout() {
      if (!readout || !state.att) { return; }
      readout.textContent = '';
      var p = el('p', 'llm-why-line');
      p.appendChild(el('strong', null, state.labels[state.sel] + ' '));
      p.appendChild(document.createTextNode('is the query. The percentages above are its softmax row — its recipe for blending every value vector into its new self.'));
      readout.appendChild(p);
    }

    function currentMatrix() {
      var dims4 = ['d0', 'd1', 'd2', 'd3'];
      switch (state.mat) {
        case 'Q': return { data: state.Q, rows: state.labels, cols: dims4 };
        case 'K': return { data: state.K, rows: state.labels, cols: dims4 };
        case 'V': return { data: state.V, rows: state.labels, cols: dims4 };
        case 'scores': return { data: state.att.scaled, rows: state.labels, cols: state.labels };
        case 'weights': return { data: state.att.weights, rows: state.labels, cols: state.labels };
        default: return { data: state.att.output, rows: state.labels, cols: dims4 };
      }
    }

    function renderMatrix_() {
      if (!matrixTable) { return; }
      var m = currentMatrix();
      renderMatrix(matrixTable, m.data, m.rows, m.cols);
      if (matNote) { matNote.textContent = MAT_NOTES[state.mat]; }
    }

    $$('.llm-att-tabs .llm-seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.llm-att-tabs .llm-seg-btn').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        state.mat = btn.getAttribute('data-mat');
        renderMatrix_();
      });
    });

    if (sentenceSel) {
      sentenceSel.addEventListener('change', function () { setSentence(sentenceSel.value); });
    }
    if (causalToggle) {
      causalToggle.addEventListener('change', function () {
        compute();
        drawArcs();
        renderMatrix_();
      });
    }
    setSentence(sentenceSel ? sentenceSel.value : 'the cat chased the dog');
  }

  /* ==========================================================================
     06 — multi-head attention
     ========================================================================== */

  function initHeads() {
    var grid = $('#llm-heads-grid');
    if (!grid) { return; }
    var note = $('#llm-heads-note');
    var btnReal = $('#llm-heads-real');
    var btnStory = $('#llm-heads-story');

    var SENT = 'the cat watched the bird in the tree';
    var ids = textTokens(SENT);
    var labels = ids.map(tokLabel);
    var n = ids.length;

    var H4 = LLM.buildModel({ vocabSize: TOK.vocab.length, dModel: 8, heads: 4, layers: 1, seed: 11 });
    var f = LLM.forward(H4, ids, {});
    var mha = f.blocks[0].mha;

    /* illustrative specialized patterns (hand-built, clearly labeled) */
    function storyPattern(kind) {
      var W = [];
      for (var i = 0; i < n; i++) {
        var row = new Array(n).fill(0);
        var j;
        if (kind === 'prev') {
          row[Math.max(0, i - 1)] = 0.8;
          row[i] = 0.2;
        } else if (kind === 'first') {
          row[0] = 0.7;
          row[i] = 0.3;
        } else if (kind === 'noun') {
          /* long-range: content words look back at earlier content words */
          var targets = [];
          for (j = 0; j <= i; j++) { if (labels[j].length > 4) { targets.push(j); } }
          if (!targets.length) { targets = [i]; }
          for (j = 0; j < targets.length; j++) { row[targets[j]] = 1 / targets.length; }
        } else {
          /* local window */
          var lo = Math.max(0, i - 2);
          for (j = lo; j <= i; j++) { row[j] = 1 / (i - lo + 1); }
        }
        W.push(row);
      }
      return W;
    }

    var STORY = [
      { name: 'previous token', W: storyPattern('prev') },
      { name: 'sentence start', W: storyPattern('first') },
      { name: 'long-range content', W: storyPattern('noun') },
      { name: 'local window', W: storyPattern('local') }
    ];

    var cells = [];
    function build() {
      grid.textContent = '';
      cells = [];
      for (var h = 0; h < 4; h++) {
        var cell = el('div', 'llm-head-cell');
        var cap = el('p', 'llm-head-cap', 'Head ' + (h + 1));
        var cnv = document.createElement('canvas');
        cnv.className = 'llm-head-canvas';
        cnv.setAttribute('aria-label', 'Attention heatmap for head ' + (h + 1));
        cell.appendChild(cnv);
        cell.appendChild(cap);
        grid.appendChild(cell);
        cells.push({ canvas: cnv, cap: cap, cv: null });
      }
      cells.forEach(function (c) { c.cv = setupCanvas(c.canvas, render); });
    }

    var mode = 'real';
    function render() {
      cells.forEach(function (c, h) {
        var ctx = c.cv.ctx;
        var w = c.cv.state.w;
        var hh = c.cv.state.h;
        if (w >= 60 && hh >= 60) {
          ctx.clearRect(0, 0, w, hh);
          var W = mode === 'real' ? mha.heads[h].att.weights : STORY[h].W;
          drawHeat(ctx, W, 4, 4, w - 8, hh - 8, 1);
        }
        c.cap.textContent = mode === 'real'
          ? 'Head ' + (h + 1) + ' — random weights (real math)'
          : 'Head ' + (h + 1) + ' — “' + STORY[h].name + '” (illustrative)';
      });
    }

    function setMode(m) {
      mode = m;
      if (btnReal) { btnReal.classList.toggle('is-active', m === 'real'); }
      if (btnStory) { btnStory.classList.toggle('is-active', m === 'story'); }
      if (note) {
        note.textContent = m === 'real'
          ? 'Real (untrained): these four heatmaps are genuinely computed by four attention heads with seeded random weights — the real mathematics, before training has given the heads any roles. Switch modes to see the kind of division of labor training tends to produce.'
          : 'Illustrative sketch: hand-drawn patterns of the roles researchers commonly find in trained models — a previous-token head, a sentence-start anchor, a long-range content tracker, a local-window head. Not computed from any real model’s weights.';
      }
      render();
    }

    if (btnReal) { btnReal.addEventListener('click', function () { setMode('real'); }); }
    if (btnStory) { btnStory.addEventListener('click', function () { setMode('story'); }); }
    build();
    setMode('real');
  }

  /* ==========================================================================
     07 — transformer block stepper
     ========================================================================== */

  function initBlock() {
    var canvas = $('#llm-block-canvas');
    var stagesList = $('#llm-block-stages');
    if (!canvas || !stagesList) { return; }
    var note = $('#llm-block-note');
    var table = $('#llm-block-table');

    var ids = textTokens('the cat chased the dog');
    var labels = ids.map(tokLabel);
    var f = LLM.forward(EDU, ids, {});
    var b = f.blocks[0];

    var STAGES = [
      { name: 'Input', data: f.x0,
        note: 'The starting matrix: one 8-dimensional row per token — embedding plus positional signature, exactly as chapters 3 and 4 built it.' },
      { name: 'LayerNorm', data: b.ln1,
        note: 'Each row is rescaled to zero mean and unit variance. Nothing moves between tokens — this just keeps the numbers in a range where training stays stable.' },
      { name: 'Attention', data: b.mha.output,
        note: 'The only stage where tokens exchange information. Both heads ran the full Q·K·V computation from chapter 5; this is their combined output.' },
      { name: '+ Residual', data: b.res1,
        note: 'Attention’s output is ADDED to the block’s input, not substituted for it. The original signal always survives — the reason 96-layer stacks remain trainable.' },
      { name: 'LayerNorm', data: b.ln2,
        note: 'Steadied again before the feed-forward stage.' },
      { name: 'Feed-forward', data: b.ffn.output,
        note: 'Each token is processed alone: expand to 32 dims, GELU nonlinearity, project back to 8. In production models this stage holds most of the parameters.' },
      { name: '+ Residual', data: b.output,
        note: 'Added back once more. This matrix is the block’s final output.' },
      { name: 'Output', data: f.blocks[1].input,
        note: 'The same matrix, now entering block 2 — which repeats the identical recipe. A production GPT does this several dozen times before reading off probabilities.' }
    ];

    var cur = 0;
    var cv = setupCanvas(canvas, draw);
    var lis = $$('li', stagesList);

    function draw() {
      var ctx = cv.ctx;
      var w = cv.state.w;
      var h = cv.state.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      var labelW = 76;
      drawHeat(ctx, STAGES[cur].data, labelW, 8, w - labelW - 10, h - 16);
      ctx.font = '600 11px Inter, sans-serif';
      var rh = (h - 16) / labels.length;
      for (var i = 0; i < labels.length; i++) {
        ctx.fillStyle = C.muted;
        ctx.fillText(labels[i], 8, 8 + i * rh + rh / 2 + 3);
      }
    }

    function setStage(i, announce) {
      cur = clamp(i, 0, STAGES.length - 1);
      lis.forEach(function (li, k) { li.classList.toggle('is-active', k === cur); });
      if (note) { note.textContent = STAGES[cur].name + ' — ' + STAGES[cur].note; }
      draw();
      if (table) {
        var cols = [];
        for (var d = 0; d < STAGES[cur].data[0].length; d++) { cols.push('d' + d); }
        renderMatrix(table, STAGES[cur].data, labels, cols);
      }
    }

    lis.forEach(function (li, k) {
      li.addEventListener('click', function () { setStage(k); stopPlay(); });
    });
    var prev = $('#llm-block-prev');
    var next = $('#llm-block-next');
    if (prev) { prev.addEventListener('click', function () { setStage(cur - 1); stopPlay(); }); }
    if (next) { next.addEventListener('click', function () { setStage(cur + 1); stopPlay(); }); }

    var playTimer = null;
    var playBtn = $('#llm-block-play');
    function stopPlay() {
      if (playTimer) { clearInterval(playTimer); playTimer = null; }
      if (playBtn) { playBtn.textContent = 'Autoplay'; }
    }
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        if (playTimer) { stopPlay(); return; }
        if (reduced()) { setStage(STAGES.length - 1); return; }
        setStage(0);
        playBtn.textContent = 'Stop';
        playTimer = setInterval(function () {
          if (cur >= STAGES.length - 1) { stopPlay(); return; }
          setStage(cur + 1);
        }, 1600);
      });
    }
    setStage(0);
  }

  /* ==========================================================================
     08 — context windows (honest cartoon)
     ========================================================================== */

  function initContext() {
    var viz = $('#llm-ctx-viz');
    if (!viz) { return; }
    var seg = $('#llm-ctx-seg');
    var turnsSlider = $('#llm-ctx-turns');
    var turnsOut = $('#llm-ctx-turns-out');
    var outUsed = $('#llm-ctx-used');
    var outVis = $('#llm-ctx-vis');
    var outLost = $('#llm-ctx-lost');

    var rng = LLM.makeRng(99);
    var MSGS = [];
    for (var i = 0; i < 60; i++) {
      MSGS.push({
        who: i % 2 === 0 ? 'you' : 'assistant',
        tokens: Math.round(i % 2 === 0 ? 30 + rng() * 220 : 120 + rng() * 480)
      });
    }

    var windowSize = 4096;

    function fmtTok(n) {
      if (n >= 1000) { return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K'; }
      return String(n);
    }

    function render() {
      var turns = turnsSlider ? parseInt(turnsSlider.value, 10) : 14;
      if (turnsOut) { turnsOut.textContent = turns + ' turns'; }
      var msgs = MSGS.slice(0, turns);
      var total = 0;
      msgs.forEach(function (m) { total += m.tokens; });

      /* newest-first fill */
      var visible = {};
      var budget = windowSize;
      for (var k = msgs.length - 1; k >= 0; k--) {
        if (msgs[k].tokens <= budget) { visible[k] = true; budget -= msgs[k].tokens; }
        else { break; }
      }

      viz.textContent = '';
      var visTok = 0;
      var lostN = 0;
      msgs.forEach(function (m, idx) {
        var inWin = !!visible[idx];
        if (inWin) { visTok += m.tokens; } else { lostN++; }
        var row = el('div', 'llm-ctx-msg' + (m.who === 'you' ? ' is-you' : '') + (inWin ? '' : ' is-lost'));
        var bar = el('span', 'llm-ctx-bar');
        bar.style.width = clamp(m.tokens / 6, 6, 100) + 'px';
        row.appendChild(el('span', 'llm-ctx-who', 'turn ' + (idx + 1) + ' · ' + m.who));
        row.appendChild(bar);
        row.appendChild(el('span', 'llm-ctx-n', '~' + m.tokens + ' tok' + (inWin ? '' : ' — forgotten')));
        viz.appendChild(row);
      });

      if (outUsed) { outUsed.textContent = '~' + fmtTok(total); }
      if (outVis) { outVis.textContent = '~' + fmtTok(visTok) + ' / ' + fmtTok(windowSize); }
      if (outLost) { outLost.textContent = lostN ? lostN + ' turns' : 'nothing yet'; }
      drawScale(total);
    }

    var scaleCanvas = $('#llm-ctx-scale');
    var scv = scaleCanvas ? setupCanvas(scaleCanvas, function () { render(); }) : null;
    function drawScale(convTokens) {
      if (!scv) { return; }
      var ctx = scv.ctx;
      var w = scv.state.w;
      var h = scv.state.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      var sizes = [128, 512, 4096, 32768, 131072];
      var names = ['128', '512', '4K', '32K', '128K'];
      var lo = Math.log10(64);
      var hi = Math.log10(200000);
      function X(v) { return 20 + (w - 40) * (Math.log10(v) - lo) / (hi - lo); }
      var y = h / 2;
      ctx.strokeStyle = C.line;
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(w - 20, y);
      ctx.stroke();
      sizes.forEach(function (s, k) {
        var x = X(s);
        var active = s === windowSize;
        ctx.beginPath();
        ctx.arc(x, y, active ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = active ? C.teal : C.lineStrong;
        ctx.fill();
        ctx.font = (active ? '700 12px' : '600 11px') + ' Inter, sans-serif';
        ctx.fillStyle = active ? C.strong : C.muted;
        ctx.textAlign = 'center';
        ctx.fillText(names[k], x, y - 14);
      });
      var cx = X(clamp(convTokens, 70, 190000));
      ctx.fillStyle = C.amber;
      ctx.beginPath();
      ctx.moveTo(cx, y + 8);
      ctx.lineTo(cx - 5, y + 18);
      ctx.lineTo(cx + 5, y + 18);
      ctx.closePath();
      ctx.fill();
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillStyle = C.amber;
      ctx.fillText('this conversation', cx, y + 30);
      ctx.textAlign = 'left';
    }

    if (seg) {
      $$('.llm-seg-btn', seg).forEach(function (btn) {
        btn.addEventListener('click', function () {
          $$('.llm-seg-btn', seg).forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          windowSize = parseInt(btn.getAttribute('data-ctx'), 10);
          render();
        });
      });
    }
    if (turnsSlider) { turnsSlider.addEventListener('input', render); }
    render();
  }

  /* ==========================================================================
     09 — training vs inference
     ========================================================================== */

  function initTrainVsInfer() {
    /* training side: illustrative loop */
    var trainCanvas = $('#llm-train-canvas');
    var trainBtn = $('#llm-train-run');
    var trainStatus = $('#llm-train-status');
    var trainChips = $$('#llm-tvi-train .llm-tvi-chip');
    if (trainCanvas && trainBtn) {
      var tcv = setupCanvas(trainCanvas, function () { drawLoss(lossPts.length); });
      var lossRng = LLM.makeRng(5);
      var lossPts = [];
      for (var i = 0; i < 120; i++) {
        lossPts.push(4.2 * Math.exp(-i / 34) + 0.55 + (lossRng() - 0.5) * 0.22 * Math.exp(-i / 60));
      }
      var drawLoss = function (upTo) {
        var ctx = tcv.ctx;
        var w = tcv.state.w;
        var h = tcv.state.h;
        if (w < 60 || h < 60) { return; }
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = C.line;
        ctx.strokeRect(10, 8, w - 20, h - 26);
        ctx.font = '600 10px Inter, sans-serif';
        ctx.fillStyle = C.faint;
        ctx.fillText('loss (illustrative)', 16, h - 6);
        ctx.strokeStyle = C.rose;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var k = 0; k < Math.min(upTo, lossPts.length); k++) {
          var x = 10 + (w - 20) * k / (lossPts.length - 1);
          var y = 8 + (h - 26) * (1 - (lossPts[k] - 0.4) / 4.2);
          if (k === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
      };
      var trainTimer = null;
      trainBtn.addEventListener('click', function () {
        if (trainTimer) { clearInterval(trainTimer); trainTimer = null; }
        if (reduced()) {
          drawLoss(lossPts.length);
          if (trainStatus) { trainStatus.textContent = 'loss 4.2 → 0.6 after many updates'; }
          return;
        }
        var step = 0;
        trainTimer = setInterval(function () {
          step++;
          drawLoss(step);
          trainChips.forEach(function (c, ci) { c.classList.toggle('is-lit', ci === (step % 4)); });
          if (trainStatus) {
            trainStatus.textContent = 'update ' + step + ' · loss ' + lossPts[Math.min(step, lossPts.length - 1)].toFixed(2);
          }
          if (step >= lossPts.length) {
            clearInterval(trainTimer);
            trainTimer = null;
            trainChips.forEach(function (c) { c.classList.remove('is-lit'); });
            if (trainStatus) { trainStatus.textContent += ' — done. Weights frozen; shipped.'; }
          }
        }, 45);
      });
      drawLoss(1);
    }

    /* inference side: real n-gram generation */
    var inferBtn = $('#llm-infer-run');
    var inferOut = $('#llm-infer-out');
    var inferStatus = $('#llm-infer-status');
    var inferChips = $$('#llm-tvi-infer .llm-tvi-chip');
    if (inferBtn && inferOut) {
      var running = false;
      inferBtn.addEventListener('click', function () {
        if (running) { return; }
        running = true;
        var g = LLM.lmGenerate(textTokens('the cat'), {
          temperature: 0.9, topK: 12, topP: 0.95,
          seed: Math.floor(Math.random() * 1e9), maxTokens: 14
        });
        inferOut.textContent = '';
        inferOut.appendChild(el('span', 'llm-infer-prompt', 'the cat'));
        var k = 0;
        function tick() {
          if (k >= g.steps.length) {
            running = false;
            inferChips.forEach(function (c) { c.classList.remove('is-lit'); });
            if (inferStatus) { inferStatus.textContent = 'done — and the weights are byte-for-byte unchanged.'; }
            return;
          }
          var st = g.steps[k];
          inferChips.forEach(function (c, ci) { c.classList.toggle('is-lit', ci === (k % 4)); });
          var chip = el('span', 'llm-infer-tok', tokLabel(st.chosen.id));
          chip.title = 'p = ' + (100 * st.chosen.p).toFixed(1) + '% after filters';
          inferOut.appendChild(chip);
          if (inferStatus) { inferStatus.textContent = 'token ' + (k + 1) + ': forward → distribution → sample → append'; }
          k++;
          if (reduced()) { tick(); } else { setTimeout(tick, 240); }
        }
        tick();
      });
    }
  }

  /* ==========================================================================
     10 — sampling playground
     ========================================================================== */

  function initSampling() {
    var input = $('#llm-samp-input');
    var rawEl = $('#llm-samp-raw');
    if (!input || !rawEl) { return; }
    var tempEl = $('#llm-samp-temp');
    var topkEl = $('#llm-samp-topk');
    var toppEl = $('#llm-samp-topp');
    var tS = $('#llm-samp-t');
    var kS = $('#llm-samp-k');
    var pS = $('#llm-samp-p');
    var tOut = $('#llm-samp-t-out');
    var kOut = $('#llm-samp-k-out');
    var pOut = $('#llm-samp-p-out');
    var outEl = $('#llm-samp-out');
    var logEl = $('#llm-samp-log');

    var genIds = null;

    function params() {
      var T = tS ? parseInt(tS.value, 10) / 100 : 1;
      var k = kS ? parseInt(kS.value, 10) : 0;
      var p = pS ? parseInt(pS.value, 10) / 100 : 1;
      if (tOut) { tOut.textContent = T.toFixed(2); }
      if (kOut) { kOut.textContent = k === 0 ? 'off' : String(k); }
      if (pOut) { pOut.textContent = p >= 1 ? 'off' : p.toFixed(2); }
      return { temperature: T, topK: k, topP: p };
    }

    function contextIds() {
      if (!genIds) { genIds = textTokens(input.value); }
      return genIds;
    }

    function renderPipeline() {
      var opt = params();
      var ids = contextIds();
      var dist = LLM.lmNextDist(TOK, NGRAM, ids);
      var logits = dist.map(function (x) { return Math.log(x); });
      var pipe = LLM.samplePipeline(logits, { temperature: opt.temperature, topK: opt.topK, topP: opt.topP, rand: 0.5 });

      renderBars(rawEl, LLM.sortedEntries(dist).slice(0, 8), { max: 8 });
      renderBars(tempEl, pipe.sorted.slice(0, 8), { max: 8 });

      var keptK = LLM.renormalize(pipe.afterTopK.kept).slice(0, 8);
      renderBars(topkEl, keptK, {
        max: 8,
        footnote: opt.topK > 0
          ? pipe.afterTopK.removed.length + ' candidates cut, survivors renormalized'
          : 'top-k off — nothing cut'
      });
      var keptP = pipe.finalDist.slice(0, 8);
      renderBars(toppEl, keptP, {
        max: 8,
        footnote: opt.topP < 1
          ? pipe.afterTopP.removed.length + ' more cut — the “nucleus” that remains is what gets sampled'
          : 'top-p off — nothing cut'
      });
      return pipe;
    }

    function sampleOnce() {
      var opt = params();
      var ids = contextIds();
      var dist = LLM.lmNextDist(TOK, NGRAM, ids);
      var logits = dist.map(function (x) { return Math.log(x); });
      var pipe = LLM.samplePipeline(logits, { temperature: opt.temperature, topK: opt.topK, topP: opt.topP, rand: Math.random() });
      genIds = ids.concat([pipe.chosen.id]);
      if (outEl) {
        if (!outEl.childNodes.length) {
          outEl.appendChild(el('span', 'llm-infer-prompt', input.value));
        }
        var chip = el('span', 'llm-infer-tok', tokLabel(pipe.chosen.id));
        chip.title = 'p = ' + (100 * pipe.chosen.p).toFixed(1) + '% in the final distribution';
        outEl.appendChild(chip);
      }
      if (logEl) {
        var rank = 0;
        for (var i = 0; i < pipe.finalDist.length; i++) {
          if (pipe.finalDist[i].id === pipe.chosen.id) { rank = i + 1; break; }
        }
        var line = el('p', 'llm-samp-logline',
          'picked ' + tokLabel(pipe.chosen.id) + ' — rank ' + rank + ' of ' +
          pipe.finalDist.length + ' surviving candidates, p = ' + (100 * pipe.chosen.p).toFixed(1) + '% after all filters');
        logEl.insertBefore(line, logEl.firstChild);
        while (logEl.childNodes.length > 5) { logEl.removeChild(logEl.lastChild); }
      }
      renderPipeline();
      return pipe.chosen.id;
    }

    function reset() {
      genIds = null;
      if (outEl) { outEl.textContent = ''; }
      if (logEl) { logEl.textContent = ''; }
      renderPipeline();
    }

    var stepBtn = $('#llm-samp-step');
    if (stepBtn) { stepBtn.addEventListener('click', sampleOnce); }
    var autoBtn = $('#llm-samp-auto');
    if (autoBtn) {
      var autoRunning = false;
      autoBtn.addEventListener('click', function () {
        if (autoRunning) { return; }
        autoRunning = true;
        var count = 0;
        function tick() {
          var id = sampleOnce();
          count++;
          if (count >= 22 || id === NGRAM.dotId) { autoRunning = false; return; }
          if (reduced()) { tick(); } else { setTimeout(tick, 170); }
        }
        tick();
      });
    }
    var resetBtn = $('#llm-samp-reset');
    if (resetBtn) { resetBtn.addEventListener('click', reset); }
    input.addEventListener('input', reset);
    [tS, kS, pS].forEach(function (s) {
      if (s) { s.addEventListener('input', renderPipeline); }
    });
    renderPipeline();
  }

  /* ==========================================================================
     11 — hallucinations
     ========================================================================== */

  function initHalluc() {
    var goBtn = $('#llm-hall-go');
    var outEl = $('#llm-hall-out');
    if (!goBtn || !outEl) { return; }
    var confEl = $('#llm-hall-conf');
    var prompt = 'the moon is made of';

    $$('#llm-hall-presets .llm-chip').forEach(function (chip, i) {
      if (i === 0) { chip.classList.add('is-active'); }
      chip.addEventListener('click', function () {
        $$('#llm-hall-presets .llm-chip').forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        prompt = chip.getAttribute('data-text') || prompt;
      });
    });

    goBtn.addEventListener('click', function () {
      var g = LLM.lmGenerate(textTokens(prompt), {
        temperature: 0.7, topK: 8, topP: 0.95,
        seed: Math.floor(Math.random() * 1e9), maxTokens: 10
      });
      outEl.textContent = '';
      outEl.appendChild(el('span', 'llm-infer-prompt', prompt));
      g.steps.forEach(function (st) {
        var chip = el('span', 'llm-infer-tok', tokLabel(st.chosen.id));
        chip.title = 'p = ' + (100 * st.chosen.p).toFixed(1) + '%';
        outEl.appendChild(chip);
      });
      if (confEl) {
        confEl.textContent = '';
        confEl.appendChild(el('p', 'llm-panel-h', 'How confident was each choice?'));
        var wrap = el('div', 'llm-hall-steps');
        g.steps.forEach(function (st) {
          var s = el('span', 'llm-hall-step');
          s.appendChild(el('strong', null, tokLabel(st.chosen.id)));
          s.appendChild(el('small', null, (100 * st.chosen.p).toFixed(0) + '%'));
          wrap.appendChild(s);
        });
        confEl.appendChild(wrap);
        confEl.appendChild(el('p', 'llm-why-line llm-why-note',
          'High percentages throughout — the model was “sure” at every step, because in its training data these continuations really are what follows. Statistical confidence is not knowledge.'));
      }
    });
  }

  /* ==========================================================================
     12 — scaling
     ========================================================================== */

  function initScale() {
    var slider = $('#llm-scale-slider');
    var canvas = $('#llm-scale-canvas');
    if (!slider || !canvas) { return; }
    var outParams = $('#llm-scale-params');
    var outMem = $('#llm-scale-mem');
    var outGpus = $('#llm-scale-gpus');
    var outTokens = $('#llm-scale-tokens');
    var outFlops = $('#llm-scale-flops');

    function human(n, unit) {
      var U = ['', 'K', 'M', 'B', 'T'];
      var i = 0;
      while (n >= 1000 && i < U.length - 1) { n /= 1000; i++; }
      return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + U[i] + (unit || '');
    }
    function bytesHuman(b) {
      var U = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
      var i = 0;
      while (b >= 1024 && i < U.length - 1) { b /= 1024; i++; }
      return (b >= 100 ? b.toFixed(0) : b.toFixed(1)) + ' ' + U[i];
    }

    var MARKS = [
      { exp: 34, name: 'this page' },
      { exp: 60, name: '1M' },
      { exp: 80, name: '100M' },
      { exp: 90, name: '1B' },
      { exp: 100, name: '10B' },
      { exp: 110, name: '100B' },
      { exp: 120, name: '1T' }
    ];

    var cv = setupCanvas(canvas, render);

    function render() {
      var v = parseInt(slider.value, 10);
      var N = Math.pow(10, v / 10);
      if (outParams) { outParams.textContent = human(N); }
      if (outMem) { outMem.textContent = bytesHuman(2 * N); }
      if (outGpus) {
        var g = (2 * N) / (80 * Math.pow(1024, 3));
        outGpus.textContent = g < 0.001 ? 'a rounding error' : (g < 1 ? g.toFixed(3) : Math.ceil(g) + ' GPUs');
      }
      if (outTokens) { outTokens.textContent = human(20 * N); }
      if (outFlops) {
        var f = 6 * N * 20 * N;
        var exp = Math.floor(Math.log10(f));
        outFlops.textContent = (f / Math.pow(10, exp)).toFixed(1) + '×10^' + exp + ' FLOPs';
      }

      var ctx = cv.ctx;
      var w = cv.state.w;
      var h = cv.state.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      var lo = 3;
      var hi = 12.4;
      function X(exp10) { return 30 + (w - 60) * (exp10 - lo) / (hi - lo); }
      var y = h * 0.58;
      ctx.strokeStyle = C.line;
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(w - 24, y);
      ctx.stroke();
      ctx.font = '600 11px Inter, sans-serif';
      MARKS.forEach(function (m) {
        var x = X(m.exp / 10);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = C.lineStrong;
        ctx.fill();
        ctx.fillStyle = C.muted;
        ctx.textAlign = 'center';
        ctx.fillText(m.name, x, y + 22);
      });
      /* moving marker with glow */
      var mx = X(v / 10);
      var r = 7 + 14 * (v - 34) / (120 - 34);
      var grad = ctx.createRadialGradient(mx, y, 2, mx, y, r * 2.4);
      grad.addColorStop(0, 'rgba(45, 212, 191, 0.75)');
      grad.addColorStop(1, 'rgba(45, 212, 191, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(mx, y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx, y, r, 0, Math.PI * 2);
      ctx.fillStyle = C.teal;
      ctx.fill();
      ctx.fillStyle = C.strong;
      ctx.font = '700 13px Inter, sans-serif';
      ctx.fillText(human(N) + ' parameters', mx, y - r - 10);
      ctx.textAlign = 'left';
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillStyle = C.faint;
      ctx.fillText('log scale — every step is 10×', 30, h - 8);
    }

    slider.addEventListener('input', render);
    $$('#llm-scale-chips .llm-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        slider.value = chip.getAttribute('data-exp') || '90';
        render();
      });
    });
    render();
  }

  /* ==========================================================================
     The Transformer Lab
     ========================================================================== */

  function initLab() {
    var runBtn = $('#llm-lab-run');
    var tokensEl = $('#llm-lab-tokens');
    var attnEl = $('#llm-lab-attn');
    if (!runBtn || !tokensEl || !attnEl) { return; }
    var dSel = $('#llm-lab-d');
    var hSel = $('#llm-lab-h');
    var lSel = $('#llm-lab-l');
    var promptSel = $('#llm-lab-prompt');
    var tS = $('#llm-lab-t');
    var kS = $('#llm-lab-k');
    var pS = $('#llm-lab-p');
    var tOut = $('#llm-lab-t-out');
    var kOut = $('#llm-lab-k-out');
    var pOut = $('#llm-lab-p-out');
    var logitsEl = $('#llm-lab-logits');
    var explainEl = $('#llm-lab-explain');
    var inspectSel = $('#llm-lab-inspect');
    var matrixTable = $('#llm-lab-matrix');
    var paramsOut = $('#llm-lab-params');
    var seedOut = $('#llm-lab-seed');
    var stepBtn = $('#llm-lab-step');
    var reseedBtn = $('#llm-lab-reseed');

    var state = { seed: 42, model: null, ids: [], gen: [], fwd: null };

    function cfg() {
      return {
        vocabSize: TOK.vocab.length,
        dModel: dSel ? parseInt(dSel.value, 10) : 8,
        heads: hSel ? parseInt(hSel.value, 10) : 2,
        layers: lSel ? parseInt(lSel.value, 10) : 2,
        seed: state.seed
      };
    }

    function decoding() {
      var T = tS ? parseInt(tS.value, 10) / 100 : 1;
      var k = kS ? parseInt(kS.value, 10) : 10;
      var p = pS ? parseInt(pS.value, 10) / 100 : 0.9;
      if (tOut) { tOut.textContent = T.toFixed(2); }
      if (kOut) { kOut.textContent = k === 0 ? 'off' : String(k); }
      if (pOut) { pOut.textContent = p >= 1 ? 'off' : p.toFixed(2); }
      return { temperature: T, topK: k, topP: p };
    }

    function rebuild() {
      state.model = LLM.buildModel(cfg());
      state.gen = [];
      if (paramsOut) { paramsOut.textContent = String(LLM.countParams(state.model)); }
      if (seedOut) { seedOut.textContent = String(state.seed); }
      run();
    }

    function ctxIds() {
      return textTokens(promptSel ? promptSel.value : 'the cat chased the dog').concat(state.gen);
    }

    function run() {
      state.ids = ctxIds();
      state.fwd = LLM.forward(state.model, state.ids, {});
      renderTokens();
      renderAttn();
      renderLogits();
      buildInspector();
      renderInspect();
    }

    function renderTokens() {
      tokensEl.textContent = '';
      var promptLen = state.ids.length - state.gen.length;
      state.ids.forEach(function (id, i) {
        var chip = el('span', 'llm-lab-tok' + (i >= promptLen ? ' is-gen' : ''), tokLabel(id));
        chip.title = 'id ' + id + (i >= promptLen ? ' — generated' : '');
        tokensEl.appendChild(chip);
      });
    }

    function drawHead(c, hd) {
      if (c.state.w < 60 || c.state.h < 60) { return; }
      c.ctx.clearRect(0, 0, c.state.w, c.state.h);
      drawHeat(c.ctx, hd.att.weights, 2, 2, c.state.w - 4, c.state.h - 4, 1);
    }

    function renderAttn() {
      attnEl.textContent = '';
      var c = state.model.config;
      state.fwd.blocks.forEach(function (b, L) {
        b.mha.heads.forEach(function (hd, h) {
          var cell = el('div', 'llm-head-cell llm-head-cell-sm');
          var cnv = document.createElement('canvas');
          cnv.className = 'llm-head-canvas llm-head-canvas-sm';
          cnv.setAttribute('aria-label', 'Attention map, layer ' + (L + 1) + ' head ' + (h + 1));
          cell.appendChild(cnv);
          cell.appendChild(el('p', 'llm-head-cap', 'L' + (L + 1) + '·H' + (h + 1)));
          attnEl.appendChild(cell);
          var cv2 = setupCanvas(cnv, function () { drawHead(cv2, hd); });
          drawHead(cv2, hd);
        });
      });
    }

    function renderLogits() {
      if (!logitsEl) { return; }
      var entries = LLM.sortedEntries(state.fwd.probs).slice(0, 10);
      renderBars(logitsEl, entries, {
        max: 10,
        footnote: 'near-uniform? that is what “untrained” looks like — random weights have no opinions yet'
      });
    }

    function buildInspector() {
      if (!inspectSel) { return; }
      var prev = inspectSel.value;
      inspectSel.textContent = '';
      var opts = [];
      opts.push({ key: 'x0', name: 'Input X (embeddings + position)' });
      state.fwd.blocks.forEach(function (b, L) {
        var p = 'Layer ' + (L + 1) + ' — ';
        opts.push({ key: 'b' + L + '.ln1', name: p + 'LayerNorm 1' });
        b.mha.heads.forEach(function (hd, h) {
          var hp = p + 'head ' + (h + 1) + ' ';
          opts.push({ key: 'b' + L + '.h' + h + '.Q', name: hp + 'Q' });
          opts.push({ key: 'b' + L + '.h' + h + '.K', name: hp + 'K' });
          opts.push({ key: 'b' + L + '.h' + h + '.V', name: hp + 'V' });
          opts.push({ key: 'b' + L + '.h' + h + '.w', name: hp + 'attention weights' });
        });
        opts.push({ key: 'b' + L + '.attnOut', name: p + 'attention output (all heads)' });
        opts.push({ key: 'b' + L + '.out', name: p + 'block output' });
      });
      opts.push({ key: 'final', name: 'Final LayerNorm (feeds the output head)' });
      opts.push({ key: 'We', name: 'Embedding table (rows for current tokens)' });
      opts.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.key;
        opt.textContent = o.name;
        inspectSel.appendChild(opt);
      });
      if (prev) { inspectSel.value = prev; }
      if (!inspectSel.value) { inspectSel.value = 'x0'; }
    }

    function dims(nc) {
      var out = [];
      for (var d = 0; d < nc; d++) { out.push('d' + d); }
      return out;
    }

    function renderInspect() {
      if (!inspectSel || !matrixTable) { return; }
      var key = inspectSel.value || 'x0';
      var labels = state.ids.map(tokLabel);
      var data = null;
      var rows = labels;
      var cols = null;
      if (key === 'x0') { data = state.fwd.x0; }
      else if (key === 'final') { data = state.fwd.finalNorm; }
      else if (key === 'We') {
        data = state.ids.map(function (id) { return state.model.We[id]; });
        rows = state.ids.map(function (id) { return tokLabel(id) + ' (id ' + id + ')'; });
      } else {
        var m = key.match(/^b(\d+)(?:\.h(\d+))?\.(\w+)$/);
        if (m) {
          var b = state.fwd.blocks[parseInt(m[1], 10)];
          if (m[2] !== undefined) {
            var hd = b.mha.heads[parseInt(m[2], 10)];
            if (m[3] === 'Q') { data = hd.Q; }
            else if (m[3] === 'K') { data = hd.K; }
            else if (m[3] === 'V') { data = hd.V; }
            else { data = hd.att.weights; cols = labels; }
          } else if (m[3] === 'ln1') { data = b.ln1; }
          else if (m[3] === 'attnOut') { data = b.mha.output; }
          else { data = b.output; }
        }
      }
      if (!data) { return; }
      renderMatrix(matrixTable, data, rows, cols || dims(data[0].length));
    }

    function step() {
      var opt = decoding();
      var pipe = LLM.samplePipeline(state.fwd.logits, {
        temperature: opt.temperature, topK: opt.topK, topP: opt.topP, rand: Math.random()
      });
      state.gen.push(pipe.chosen.id);
      if (explainEl) {
        explainEl.textContent = '';
        explainEl.appendChild(el('p', 'llm-why-tok', 'sampled: ' + tokLabel(pipe.chosen.id)));
        var rank = 0;
        for (var i = 0; i < pipe.finalDist.length; i++) {
          if (pipe.finalDist[i].id === pipe.chosen.id) { rank = i + 1; break; }
        }
        explainEl.appendChild(el('p', 'llm-why-line',
          'The forward pass produced ' + state.fwd.logits.length + ' logits. Temperature ' + opt.temperature.toFixed(2) +
          ' rescaled them; top-k ' + (opt.topK || 'off') + ' and top-p ' + (opt.topP >= 1 ? 'off' : opt.topP.toFixed(2)) +
          ' left ' + pipe.finalDist.length + ' candidates. This token was rank ' + rank +
          ', p = ' + (100 * pipe.chosen.p).toFixed(1) + '%.'));
        explainEl.appendChild(el('p', 'llm-why-line llm-why-note',
          'With untrained weights the choice is close to a dice roll — run the same pipeline on chapter 10, where the model has real statistics, to feel the difference training makes.'));
      }
      run();
    }

    if (runBtn) { runBtn.addEventListener('click', function () { state.gen = []; run(); }); }
    if (stepBtn) { stepBtn.addEventListener('click', step); }
    if (reseedBtn) {
      reseedBtn.addEventListener('click', function () {
        state.seed = Math.floor(Math.random() * 100000);
        rebuild();
      });
    }
    [dSel, hSel, lSel].forEach(function (s) {
      if (s) { s.addEventListener('change', rebuild); }
    });
    if (promptSel) { promptSel.addEventListener('change', function () { state.gen = []; run(); }); }
    [tS, kS, pS].forEach(function (s) {
      if (s) { s.addEventListener('input', decoding); }
    });
    if (inspectSel) { inspectSel.addEventListener('change', renderInspect); }

    decoding();
    rebuild();
  }

  /* ==========================================================================
     Boot
     ========================================================================== */

  function boot() {
    [
      initReveal, initRail, initHero,
      initPredict, initTokenizer, initEmbeddings, initPositional,
      initAttention, initHeads, initBlock, initContext,
      initTrainVsInfer, initSampling, initHalluc, initScale,
      initLab
    ].forEach(function (fn) {
      try { fn(); } catch (e) {
        if (window.console && console.warn) { console.warn('[llm] widget failed:', fn.name, e); }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
