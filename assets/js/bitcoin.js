/* =============================================================================
   Understanding Bitcoin — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /bitcoin/ only.

   Structure:
     1. Crypto core: real SHA-256, RIPEMD-160, secp256k1 (ECDSA), Base58Check.
        Pure functions, verified in Node against known vectors (SHA/RIPEMD test
        strings, the privkey=1 address, sign/verify round-trips). When loaded
        outside a browser the file exports these and stops, so the same file
        that ships is the one under test.
     2. Shared utilities (canvas fitting, visibility gating, rAF loops)
     3. One init function per widget, each guarded by element existence
     4. Everything respects prefers-reduced-motion: ambient animation is
        disabled and user-triggered demos jump to their final state.

   The simulators are illustrative models with honest ratios, not protocol
   emulation — the captions in the HTML say so where it matters. The
   cryptography, however, is the real thing.
   ============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. crypto core (pure — no DOM)
     ========================================================================== */

  function utf8Bytes(str) {
    return new TextEncoder().encode(str);
  }

  function bytesToHex(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) { s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16); }
    return s;
  }

  function hexToBytes(hex) {
    if (hex.length % 2) { hex = '0' + hex; }
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) { out[i] = parseInt(hex.substr(i * 2, 2), 16); }
    return out;
  }

  function concatBytes() {
    var total = 0, i;
    for (i = 0; i < arguments.length; i++) { total += arguments[i].length; }
    var out = new Uint8Array(total);
    var off = 0;
    for (i = 0; i < arguments.length; i++) { out.set(arguments[i], off); off += arguments[i].length; }
    return out;
  }

  function reverseBytes(u8) {
    var out = new Uint8Array(u8.length);
    for (var i = 0; i < u8.length; i++) { out[i] = u8[u8.length - 1 - i]; }
    return out;
  }

  /* ---- SHA-256 (FIPS 180-4) ---- */

  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  var _shaW = new Int32Array(64);

  function sha256(bytes) {
    var len = bytes.length;
    var blocks = ((len + 9 + 63) >> 6);
    var padded = new Uint8Array(blocks << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    var bitHi = Math.floor(len / 536870912);
    var bitLo = (len << 3) >>> 0;
    var pl = padded.length;
    padded[pl - 8] = (bitHi >>> 24) & 0xff;
    padded[pl - 7] = (bitHi >>> 16) & 0xff;
    padded[pl - 6] = (bitHi >>> 8) & 0xff;
    padded[pl - 5] = bitHi & 0xff;
    padded[pl - 4] = (bitLo >>> 24) & 0xff;
    padded[pl - 3] = (bitLo >>> 16) & 0xff;
    padded[pl - 2] = (bitLo >>> 8) & 0xff;
    padded[pl - 1] = bitLo & 0xff;

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = _shaW;

    for (var off = 0; off < pl; off += 64) {
      var i;
      for (i = 0; i < 16; i++) {
        var j = off + i * 4;
        w[i] = (padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3];
      }
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }

    var out = new Uint8Array(32);
    var H = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (var k = 0; k < 8; k++) {
      out[k * 4] = (H[k] >>> 24) & 0xff;
      out[k * 4 + 1] = (H[k] >>> 16) & 0xff;
      out[k * 4 + 2] = (H[k] >>> 8) & 0xff;
      out[k * 4 + 3] = H[k] & 0xff;
    }
    return out;
  }

  function sha256d(bytes) { return sha256(sha256(bytes)); }

  function sha256hex(str) { return bytesToHex(sha256(utf8Bytes(str))); }

  /* ---- RIPEMD-160 ---- */

  var RMD_RL = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
    3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
    1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
    4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13
  ];
  var RMD_RR = [
    5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
    6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
    15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
    8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
    12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11
  ];
  var RMD_SL = [
    11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
    7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
    11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
    11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
    9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6
  ];
  var RMD_SR = [
    8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
    9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
    9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
    15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
    8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11
  ];
  var RMD_KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
  var RMD_KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

  function rmdF(j, x, y, z) {
    if (j < 16) { return x ^ y ^ z; }
    if (j < 32) { return (x & y) | (~x & z); }
    if (j < 48) { return (x | ~y) ^ z; }
    if (j < 64) { return (x & z) | (y & ~z); }
    return x ^ (y | ~z);
  }

  function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }

  function ripemd160(bytes) {
    var len = bytes.length;
    var blocks = ((len + 9 + 63) >> 6);
    var padded = new Uint8Array(blocks << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    var bitLo = (len << 3) >>> 0;
    var bitHi = Math.floor(len / 536870912);
    var pl = padded.length;
    padded[pl - 8] = bitLo & 0xff;
    padded[pl - 7] = (bitLo >>> 8) & 0xff;
    padded[pl - 6] = (bitLo >>> 16) & 0xff;
    padded[pl - 5] = (bitLo >>> 24) & 0xff;
    padded[pl - 4] = bitHi & 0xff;
    padded[pl - 3] = (bitHi >>> 8) & 0xff;
    padded[pl - 2] = (bitHi >>> 16) & 0xff;
    padded[pl - 1] = (bitHi >>> 24) & 0xff;

    var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    var X = new Int32Array(16);

    for (var off = 0; off < pl; off += 64) {
      var i;
      for (i = 0; i < 16; i++) {
        var j = off + i * 4;
        X[i] = padded[j] | (padded[j + 1] << 8) | (padded[j + 2] << 16) | (padded[j + 3] << 24);
      }
      var al = h0, bl = h1, cl = h2, dl = h3, el = h4;
      var ar = h0, br = h1, cr = h2, dr = h3, er = h4;
      for (i = 0; i < 80; i++) {
        var round = (i / 16) | 0;
        var t = (al + rmdF(i, bl, cl, dl) + X[RMD_RL[i]] + RMD_KL[round]) | 0;
        t = (rotl(t, RMD_SL[i]) + el) | 0;
        al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = t;
        t = (ar + rmdF(79 - i, br, cr, dr) + X[RMD_RR[i]] + RMD_KR[round]) | 0;
        t = (rotl(t, RMD_SR[i]) + er) | 0;
        ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = t;
      }
      var tt = (h1 + cl + dr) | 0;
      h1 = (h2 + dl + er) | 0;
      h2 = (h3 + el + ar) | 0;
      h3 = (h4 + al + br) | 0;
      h4 = (h0 + bl + cr) | 0;
      h0 = tt;
    }

    var out = new Uint8Array(20);
    var H = [h0, h1, h2, h3, h4];
    for (var k = 0; k < 5; k++) {
      out[k * 4] = H[k] & 0xff;
      out[k * 4 + 1] = (H[k] >>> 8) & 0xff;
      out[k * 4 + 2] = (H[k] >>> 16) & 0xff;
      out[k * 4 + 3] = (H[k] >>> 24) & 0xff;
    }
    return out;
  }

  function hash160(bytes) { return ripemd160(sha256(bytes)); }

  /* ---- secp256k1 (BigInt, Jacobian coordinates) ---- */

  var EC_P = BigInt('0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f');
  var EC_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
  var EC_GX = BigInt('0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  var EC_GY = BigInt('0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8');
  var B0 = BigInt(0), B1 = BigInt(1), B2 = BigInt(2), B3 = BigInt(3), B8 = BigInt(8);

  function ecMod(a, m) { var r = a % m; return r < B0 ? r + m : r; }

  function ecInv(a, m) {
    a = ecMod(a, m);
    var lm = B1, hm = B0, low = a, high = m;
    while (low > B1) {
      var q = high / low;
      var nm = hm - lm * q;
      var nw = high - low * q;
      hm = lm; lm = nm; high = low; low = nw;
    }
    return ecMod(lm, m);
  }

  function jDouble(p) {
    var X = p[0], Y = p[1], Z = p[2];
    if (Z === B0 || Y === B0) { return [B0, B1, B0]; }
    var A = ecMod(X * X, EC_P);
    var Bv = ecMod(Y * Y, EC_P);
    var C = ecMod(Bv * Bv, EC_P);
    var t = ecMod((X + Bv) * (X + Bv) - A - C, EC_P);
    var D = ecMod(B2 * t, EC_P);
    var E = ecMod(B3 * A, EC_P);
    var F = ecMod(E * E, EC_P);
    var X3 = ecMod(F - B2 * D, EC_P);
    var Y3 = ecMod(E * (D - X3) - B8 * C, EC_P);
    var Z3 = ecMod(B2 * Y * Z, EC_P);
    return [X3, Y3, Z3];
  }

  function jAdd(p, q) {
    if (p[2] === B0) { return q; }
    if (q[2] === B0) { return p; }
    var Z1Z1 = ecMod(p[2] * p[2], EC_P);
    var Z2Z2 = ecMod(q[2] * q[2], EC_P);
    var U1 = ecMod(p[0] * Z2Z2, EC_P);
    var U2 = ecMod(q[0] * Z1Z1, EC_P);
    var S1 = ecMod(p[1] * Z2Z2 * q[2], EC_P);
    var S2 = ecMod(q[1] * Z1Z1 * p[2], EC_P);
    var H = ecMod(U2 - U1, EC_P);
    var R = ecMod(S2 - S1, EC_P);
    if (H === B0) {
      if (R === B0) { return jDouble(p); }
      return [B0, B1, B0];
    }
    var H2 = ecMod(H * H, EC_P);
    var H3 = ecMod(H * H2, EC_P);
    var U1H2 = ecMod(U1 * H2, EC_P);
    var X3 = ecMod(R * R - H3 - B2 * U1H2, EC_P);
    var Y3 = ecMod(R * (U1H2 - X3) - S1 * H3, EC_P);
    var Z3 = ecMod(H * p[2] * q[2], EC_P);
    return [X3, Y3, Z3];
  }

  function jToAffine(p) {
    if (p[2] === B0) { return null; }
    var zi = ecInv(p[2], EC_P);
    var zi2 = ecMod(zi * zi, EC_P);
    return [ecMod(p[0] * zi2, EC_P), ecMod(p[1] * zi2 * zi, EC_P)];
  }

  function ecMul(k, point) {
    var px = point ? point[0] : EC_GX;
    var py = point ? point[1] : EC_GY;
    k = ecMod(k, EC_N);
    if (k === B0) { return null; }
    var acc = [B0, B1, B0];
    var base = [px, py, B1];
    var bits = k.toString(2);
    for (var i = 0; i < bits.length; i++) {
      acc = jDouble(acc);
      if (bits[i] === '1') { acc = jAdd(acc, base); }
    }
    return jToAffine(acc);
  }

  function ecMulAdd(u1, u2, Q) {
    var a = u1 === B0 ? null : ecMul(u1);
    var b = u2 === B0 ? null : ecMul(u2, Q);
    if (!a) { return b; }
    if (!b) { return a; }
    return jToAffine(jAdd([a[0], a[1], B1], [b[0], b[1], B1]));
  }

  function bytesToBig(u8) {
    var hex = bytesToHex(u8);
    return hex.length ? BigInt('0x' + hex) : B0;
  }

  function bigToBytes(n, len) {
    var hex = n.toString(16);
    if (hex.length % 2) { hex = '0' + hex; }
    var raw = hexToBytes(hex);
    if (raw.length >= len) { return raw.slice(raw.length - len); }
    var out = new Uint8Array(len);
    out.set(raw, len - raw.length);
    return out;
  }

  function pubFromPriv(d) {
    var pt = ecMul(d);
    if (!pt) { return null; }
    var prefix = (pt[1] % B2) === B0 ? 0x02 : 0x03;
    return { x: pt[0], y: pt[1], compressed: concatBytes(new Uint8Array([prefix]), bigToBytes(pt[0], 32)) };
  }

  function ecdsaSign(z, d, k) {
    k = ecMod(k, EC_N);
    if (k === B0) { return null; }
    var R = ecMul(k);
    if (!R) { return null; }
    var r = ecMod(R[0], EC_N);
    if (r === B0) { return null; }
    var s = ecMod(ecInv(k, EC_N) * ecMod(z + r * d, EC_N), EC_N);
    if (s === B0) { return null; }
    if (s > EC_N / B2) { s = EC_N - s; }
    return { r: r, s: s };
  }

  function ecdsaVerify(z, r, s, pub) {
    if (r <= B0 || r >= EC_N || s <= B0 || s >= EC_N) { return false; }
    var w = ecInv(s, EC_N);
    var u1 = ecMod(z * w, EC_N);
    var u2 = ecMod(r * w, EC_N);
    var pt = ecMulAdd(u1, u2, [pub.x, pub.y]);
    if (!pt) { return false; }
    return ecMod(pt[0], EC_N) === r;
  }

  /* ---- Base58Check & addresses ---- */

  var B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var B58 = BigInt(58);

  function base58check(payload) {
    var data = concatBytes(payload, sha256d(payload).slice(0, 4));
    var n = bytesToBig(data);
    var s = '';
    while (n > B0) {
      s = B58_ALPHABET[Number(n % B58)] + s;
      n = n / B58;
    }
    for (var i = 0; i < data.length && data[i] === 0; i++) { s = '1' + s; }
    return s;
  }

  function p2pkhAddress(compressedPub) {
    return base58check(concatBytes(new Uint8Array([0x00]), hash160(compressedPub)));
  }

  /* When loaded outside a browser (Node), export the crypto core for the
     vector tests and stop — everything below is DOM territory. */
  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        utf8Bytes: utf8Bytes, bytesToHex: bytesToHex, hexToBytes: hexToBytes,
        concatBytes: concatBytes, reverseBytes: reverseBytes,
        sha256: sha256, sha256d: sha256d, ripemd160: ripemd160, hash160: hash160,
        EC_P: EC_P, EC_N: EC_N, EC_GX: EC_GX, EC_GY: EC_GY,
        ecMod: ecMod, ecInv: ecInv, ecMul: ecMul, ecMulAdd: ecMulAdd,
        bytesToBig: bytesToBig, bigToBytes: bigToBytes,
        pubFromPriv: pubFromPriv, ecdsaSign: ecdsaSign, ecdsaVerify: ecdsaVerify,
        base58check: base58check, p2pkhAddress: p2pkhAddress
      };
    }
    return;
  }

  /* ==========================================================================
     2. shared utilities
     ========================================================================== */

  document.documentElement.classList.add('bx-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');

  function reduced() { return RM.matches; }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }

  function randBytes(n) {
    var u8 = new Uint8Array(n);
    crypto.getRandomValues(u8);
    return u8;
  }

  function randScalar() {
    while (true) {
      var d = bytesToBig(randBytes(32));
      if (d > B0 && d < EC_N) { return d; }
    }
  }

  /* Fit a canvas's backing store to its CSS box (devicePixelRatio-aware). */
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

  /* Run enter/leave callbacks as an element scrolls in and out of view. */
  function onScreen(el, enter, leave) {
    if (!('IntersectionObserver' in window)) { if (enter) { enter(); } return; }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { if (enter) { enter(); } }
        else if (leave) { leave(); }
      });
    }, { threshold: 0.12 }).observe(el);
  }

  /* A stoppable requestAnimationFrame loop. fn(tMs, dtMs). */
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
      start: function () {
        if (id !== null) { return; }
        last = performance.now();
        id = requestAnimationFrame(frame);
      },
      stop: function () {
        if (id !== null) { cancelAnimationFrame(id); id = null; }
      },
      running: function () { return id !== null; }
    };
  }

  var C = {
    deep: '#0b1120', line: '#1e293b', lineStrong: '#334155',
    text: '#cbd5e1', strong: '#f1f5f9', muted: '#94a3b8', faint: '#64748b',
    teal: '#2dd4bf', tealDeep: '#14b8a6', btc: '#f7931a',
    sky: '#0284c7', rose: '#e11d48', violet: '#8b5cf6', lime: '#65a30d', amber: '#d97706'
  };

  /* ==========================================================================
     3. widgets
     ========================================================================== */

  /* ---- scroll reveal ---- */
  function initReveal() {
    var els = $$('#bitcoin-experience [data-bx-reveal]');
    if (!els.length) { return; }
    if (reduced() || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-revealed'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-revealed');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---- chapter rail ---- */
  function initRail() {
    var dots = $$('#bitcoin-experience .bx-rail-dot');
    if (!dots.length || !('IntersectionObserver' in window)) { return; }
    var byId = {};
    dots.forEach(function (d) {
      var id = (d.getAttribute('href') || '').slice(1);
      if (id) { byId[id] = d; }
    });
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) { return; }
        var dot = byId[e.target.id];
        if (!dot) { return; }
        if (current) { current.classList.remove('is-active'); }
        dot.classList.add('is-active');
        current = dot;
      });
    }, { rootMargin: '-35% 0px -55% 0px' });
    Object.keys(byId).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) { io.observe(sec); }
    });
  }

  /* ---- hero: a globe of nodes gossiping blocks ---- */
  function initHero() {
    var canvas = $('#bx-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { layout(); if (reduced()) { drawStatic(); } });
    var ctx = cv.ctx, st = cv.state;

    var NODES = 110;
    var pts = [];
    for (var i = 0; i < NODES; i++) {
      /* Fibonacci sphere for even coverage */
      var yy = 1 - (i / (NODES - 1)) * 2;
      var rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      var th = i * 2.39996323;
      pts.push({ x: Math.cos(th) * rr, y: yy, z: Math.sin(th) * rr, px: 0, py: 0, pz: 0, s: 0 });
    }
    /* adjacency: each point linked to its 3 nearest neighbors on the sphere */
    var links = [];
    var seen = {};
    pts.forEach(function (p, ai) {
      var ds = pts.map(function (q, bi) {
        var dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
        return { d: dx * dx + dy * dy + dz * dz, i: bi };
      }).sort(function (a, b) { return a.d - b.d; });
      for (var k = 1; k <= 3; k++) {
        var bi = ds[k].i;
        var key = Math.min(ai, bi) + '-' + Math.max(ai, bi);
        if (!seen[key]) { seen[key] = true; links.push([ai, bi]); }
      }
    });
    /* neighbor map for waves */
    var nbr = pts.map(function () { return []; });
    links.forEach(function (l) { nbr[l[0]].push(l[1]); nbr[l[1]].push(l[0]); });

    function bfs(from) {
      var dist = new Array(NODES).fill(-1);
      dist[from] = 0;
      var q = [from];
      while (q.length) {
        var n = q.shift();
        nbr[n].forEach(function (m) {
          if (dist[m] === -1) { dist[m] = dist[n] + 1; q.push(m); }
        });
      }
      return dist;
    }

    var angle = 0;
    var wave = null;           /* { dist: [], t0: ms } */
    var nextWaveAt = 900;
    var packets = [];          /* { link, t, dur, dir } */

    function layout() { /* projection happens per-frame; nothing cached */ }

    function project(t) {
      var R = Math.min(st.w, st.h) * 0.42;
      var cx = st.w / 2, cy = st.h / 2 + st.h * 0.02;
      var ca = Math.cos(angle), sa = Math.sin(angle);
      pts.forEach(function (p) {
        var x = p.x * ca + p.z * sa;
        var z = -p.x * sa + p.z * ca;
        var persp = 1 / (1 + z * 0.32);
        p.px = cx + x * R * persp;
        p.py = cy + p.y * R * 0.86 * persp;
        p.pz = z;
        p.s = persp;
      });
    }

    function draw(now) {
      ctx.clearRect(0, 0, st.w, st.h);
      var wd = wave ? wave.dist : null;
      var wAge = wave ? (now - wave.t0) : 0;
      var HOP = 130;

      ctx.lineWidth = 1;
      links.forEach(function (l) {
        var a = pts[l[0]], b = pts[l[1]];
        var depth = (a.pz + b.pz) / 2;
        var alpha = 0.05 + Math.max(0, 0.16 - depth * 0.12);
        var lit = 0;
        if (wd) {
          var da = wd[l[0]], db = wd[l[1]];
          var edgeT = Math.min(da, db) * HOP;
          var dt = wAge - edgeT;
          if (dt > 0 && dt < 700) { lit = 1 - dt / 700; }
        }
        if (lit > 0) {
          ctx.strokeStyle = 'rgba(247, 147, 26, ' + (0.08 + lit * 0.45) + ')';
        } else {
          ctx.strokeStyle = 'rgba(94, 130, 172, ' + alpha + ')';
        }
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.stroke();
      });

      /* ambient packets */
      packets.forEach(function (pk) {
        var a = pts[pk.link[0]], b = pts[pk.link[1]];
        if (pk.dir < 0) { var tmp = a; a = b; b = tmp; }
        var f = pk.t / pk.dur;
        var x = a.px + (b.px - a.px) * f;
        var y = a.py + (b.py - a.py) * f;
        ctx.fillStyle = 'rgba(45, 212, 191, ' + (0.55 * (1 - Math.abs(f - 0.5) * 0.8)) + ')';
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      });

      pts.forEach(function (p, i) {
        var glow = 0;
        if (wd) {
          var at = wd[i] * HOP;
          var dt = wAge - at;
          if (dt > 0 && dt < 900) { glow = 1 - dt / 900; }
        }
        var r = (1.1 + p.s * 1.5) + glow * 2.2;
        var baseA = 0.25 + Math.max(0, 0.55 - p.pz * 0.5);
        if (glow > 0) {
          ctx.fillStyle = 'rgba(247, 147, 26, ' + (baseA + glow * 0.5) + ')';
        } else {
          ctx.fillStyle = 'rgba(148, 163, 184, ' + baseA + ')';
        }
        ctx.beginPath();
        ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function drawStatic() {
      angle = 0.6;
      project(0);
      wave = { dist: bfs(12), t0: performance.now() - 400 };
      draw(performance.now());
      wave = null;
    }

    var loop = makeLoop(function (t, dt) {
      angle += dt * 0.000045;
      /* spawn / advance packets */
      if (packets.length < 26 && Math.random() < 0.25) {
        packets.push({ link: links[(Math.random() * links.length) | 0], t: 0, dur: 900 + Math.random() * 900, dir: Math.random() < 0.5 ? 1 : -1 });
      }
      for (var i = packets.length - 1; i >= 0; i--) {
        packets[i].t += dt;
        if (packets[i].t >= packets[i].dur) { packets.splice(i, 1); }
      }
      /* block waves */
      nextWaveAt -= dt;
      if (nextWaveAt <= 0) {
        wave = { dist: bfs((Math.random() * NODES) | 0), t0: t };
        nextWaveAt = 3600 + Math.random() * 2200;
      }
      if (wave && t - wave.t0 > 3200) { wave = null; }
      project(t);
      draw(t);
    });

    if (reduced()) { drawStatic(); return; }
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ---- horizontal timeline scrollers (chapters 1 & 2) ---- */
  function initScroller(trackId, prevId, nextId, barId) {
    var track = $(trackId);
    if (!track) { return; }
    var bar = $(barId);
    function update() {
      if (!bar) { return; }
      var max = track.scrollWidth - track.clientWidth;
      var f = max > 4 ? track.scrollLeft / max : 1;
      bar.style.width = (8 + f * 92) + '%';
    }
    function by(dir) {
      track.scrollBy({ left: dir * track.clientWidth * 0.75, behavior: reduced() ? 'auto' : 'smooth' });
    }
    var prev = $(prevId), next = $(nextId);
    if (prev) { prev.addEventListener('click', function () { by(-1); }); }
    if (next) { next.addEventListener('click', function () { by(1); }); }
    track.addEventListener('scroll', update, { passive: true });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { by(1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { by(-1); e.preventDefault(); }
    });
    update();
  }

  function initEras() {
    initScroller('#bx-eras-track', '#bx-eras-prev', '#bx-eras-next', '#bx-eras-bar');
  }

  function initHistory() {
    initScroller('#bx-history-track', '#bx-history-prev', '#bx-history-next', '#bx-history-bar');
  }

  /* ---- the copy-paste problem demo ---- */
  function initCopyDemo() {
    var goldBtn = $('#bx-copy-gold-btn');
    var coin = $('#bx-copy-gold-coin');
    var goldNote = $('#bx-copy-gold-note');
    if (goldBtn && coin) {
      var goldTries = 0;
      goldBtn.addEventListener('click', function () {
        goldTries++;
        coin.classList.remove('is-shaking');
        void coin.getBoundingClientRect(); /* restart the animation */
        coin.classList.add('is-shaking');
        goldNote.textContent = goldTries < 3
          ? 'Still one coin. Matter doesn’t copy — scarcity is physics.'
          : 'However hard you press, atoms don’t duplicate. That’s why gold worked.';
      });
    }

    var fileBtn = $('#bx-copy-file-btn');
    var stage = $('#bx-copy-file');
    var fileNote = $('#bx-copy-file-note');
    if (!fileBtn || !stage) { return; }
    var COIN_SVG = '<svg viewBox="0 0 64 64" class="bx-coin"><circle cx="32" cy="32" r="26" class="c1"></circle><circle cx="32" cy="32" r="20" class="c2"></circle><path d="M32 20v24M26 26h9a5 5 0 0 1 0 10h-9M26 36h10" class="c3"></path></svg>';
    var count = 1;
    function render() {
      var shown = Math.min(count, 18);
      var htmlStr = '';
      for (var i = 0; i < shown; i++) { htmlStr += '<span class="bx-filecoin">' + COIN_SVG + '</span>'; }
      stage.innerHTML = htmlStr;
    }
    render();
    fileBtn.addEventListener('click', function () {
      count *= 2;
      render();
      if (count <= 2) {
        fileNote.textContent = '2 identical coins. Which is the real one? Both. Neither. That’s the problem.';
      } else if (count <= 16) {
        fileNote.textContent = fmtInt(count) + ' identical coins, all provably “genuine”. Money that copies isn’t money.';
      } else {
        fileNote.textContent = fmtInt(count) + ' coins and counting — free duplication makes every copy worthless. Something must stop this.';
      }
    });
  }

  /* ---- one ledger, many copies ---- */
  function initLedgers() {
    var canvas = $('#bx-ledgers');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { drawAll(1); });
    var ctx = cv.ctx, st = cv.state;

    var ROWS = 5;
    var filled = 3;          /* rows currently in every ledger */
    var anim = null;         /* { t } incoming-row animation */

    function ledgerRects() {
      var cols = st.w > 760 ? 6 : (st.w > 500 ? 4 : 3);
      var rows = 2;
      var gap = 14;
      var W = (st.w - gap * (cols + 1)) / cols;
      var H = (st.h - gap * (rows + 1)) / rows;
      var out = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          out.push({ x: gap + c * (W + gap), y: gap + r * (H + gap), w: W, h: H });
        }
      }
      return out;
    }

    function drawAll(progress) {
      ctx.clearRect(0, 0, st.w, st.h);
      var rects = ledgerRects();
      rects.forEach(function (R) {
        ctx.strokeStyle = C.lineStrong;
        ctx.fillStyle = 'rgba(21, 31, 54, 0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(R.x, R.y, R.w, R.h, 7);
        ctx.fill();
        ctx.stroke();
        /* title bar */
        ctx.fillStyle = 'rgba(45, 212, 191, 0.35)';
        ctx.fillRect(R.x + 8, R.y + 8, R.w * 0.4, 4);
        /* rows */
        var innerTop = R.y + 20;
        var rowH = (R.h - 28) / ROWS;
        for (var i = 0; i < ROWS; i++) {
          var yy = innerTop + i * rowH;
          if (i < filled) {
            ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
            ctx.fillRect(R.x + 8, yy, R.w - 16, Math.max(3, rowH - 7));
          } else if (i === filled && progress < 1) {
            var w = (R.w - 16) * progress;
            ctx.fillStyle = 'rgba(247, 147, 26, 0.75)';
            ctx.fillRect(R.x + 8, yy, w, Math.max(3, rowH - 7));
          } else if (i === filled - 0 && progress >= 1) {
            /* handled by filled increment */
          }
        }
        /* pulse ring while a row arrives */
        if (progress < 1) {
          ctx.strokeStyle = 'rgba(247, 147, 26, ' + (0.5 * (1 - progress)) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(R.x - 3, R.y - 3, R.w + 6, R.h + 6, 9);
          ctx.stroke();
        }
      });
    }

    if (reduced()) { drawAll(1); return; }

    var waitLeft = 900;
    var loop = makeLoop(function (t, dt) {
      if (anim) {
        anim.t += dt;
        var p = clamp(anim.t / 700, 0, 1);
        drawAll(p);
        if (p >= 1) {
          filled = filled >= ROWS ? 3 : filled + 1;   /* “scroll” once full */
          anim = null;
          waitLeft = 2100;
          drawAll(1);
        }
      } else {
        waitLeft -= dt;
        if (waitLeft <= 0) { anim = { t: 0 }; }
      }
    });
    drawAll(1);
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* roundRect fallback for older engines */
  if (window.CanvasRenderingContext2D && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
    };
  }

  /* ---- SHA-256 sandbox ---- */
  function initHashbox() {
    var input = $('#bx-hash-input');
    var out = $('#bx-hash-output');
    var diff = $('#bx-hash-diff');
    if (!input || !out) { return; }
    var prevDigest = null;

    function render() {
      var digest = sha256(utf8Bytes(input.value));
      var hex = bytesToHex(digest);
      if (prevDigest) {
        var prevHex = bytesToHex(prevDigest);
        var htmlStr = '';
        for (var i = 0; i < 64; i++) {
          htmlStr += hex[i] === prevHex[i] ? hex[i] : '<span class="bx-hash-changed">' + hex[i] + '</span>';
        }
        out.innerHTML = htmlStr;
        var bits = 0;
        for (var b = 0; b < 32; b++) {
          var x = digest[b] ^ prevDigest[b];
          while (x) { bits += x & 1; x >>= 1; }
        }
        diff.textContent = bits === 0
          ? 'Identical input, identical fingerprint — deterministic.'
          : bits + ' of 256 bits flipped versus your previous input.';
      } else {
        out.textContent = hex;
      }
      prevDigest = digest;
    }
    input.addEventListener('input', render);
    render();
  }

  /* ---- tamper-with-a-blockchain demo ---- */
  function initChainDemo() {
    var wrap = $('#bx-chain');
    if (!wrap) { return; }
    var TARGET = '00';
    var blocks = [
      { data: 'Maya pays Liam 0.20 BTC\nNoah pays Ava 1.10 BTC', nonce: 0 },
      { data: 'Ava pays Zoe 0.65 BTC\nLiam pays Rui 0.05 BTC', nonce: 0 },
      { data: 'Zoe pays Maya 0.40 BTC\nRui pays Noah 0.90 BTC', nonce: 0 },
      { data: 'Noah pays Zoe 0.15 BTC\nMaya pays Ava 0.30 BTC', nonce: 0 }
    ];
    var GENESIS_PREV = '0000000000000000000000000000000000000000000000000000000000000000';

    function blockHash(i) {
      return sha256hex('block:' + (i + 1) + '|prev:' + blocks[i].prev + '|' + blocks[i].data + '|nonce:' + blocks[i].nonce);
    }

    function mineSync(i) {
      blocks[i].prev = i === 0 ? GENESIS_PREV : blocks[i - 1].hash;
      for (var n = 0; n < 300000; n++) {
        blocks[i].nonce = n;
        var h = blockHash(i);
        if (h.slice(0, TARGET.length) === TARGET) { blocks[i].hash = h; return; }
      }
      blocks[i].hash = blockHash(i); /* practically unreachable */
    }

    /* pre-mine the pristine chain */
    for (var i = 0; i < blocks.length; i++) { mineSync(i); }

    var els = [];
    blocks.forEach(function (b, idx) {
      var div = document.createElement('div');
      div.className = 'bx-cblock';
      div.innerHTML =
        '<div class="bx-cblock-head"><span class="bx-cblock-no">Block ' + (idx + 1) + '</span>' +
        '<span class="bx-cblock-status"></span></div>' +
        '<label class="bx-cblock-label" for="bx-cdata-' + idx + '">Transactions</label>' +
        '<textarea class="bx-cblock-data" id="bx-cdata-' + idx + '" rows="2" spellcheck="false"></textarea>' +
        '<span class="bx-cblock-label">Nonce</span>' +
        '<p class="bx-cblock-prev">nonce <span class="bx-cblock-nonce"></span></p>' +
        '<span class="bx-cblock-label">Previous hash</span>' +
        '<p class="bx-cblock-prev" data-role="prev"></p>' +
        '<span class="bx-cblock-label">Hash</span>' +
        '<p class="bx-cblock-hash" data-role="hash"></p>' +
        '<button type="button" class="bx-btn bx-btn-ghost bx-cblock-mine">Re-mine</button>';
      wrap.appendChild(div);
      var ta = $('.bx-cblock-data', div);
      ta.value = b.data;
      els.push({
        root: div,
        ta: ta,
        status: $('.bx-cblock-status', div),
        nonce: $('.bx-cblock-nonce', div),
        prev: $('[data-role="prev"]', div),
        hash: $('[data-role="hash"]', div),
        mine: $('.bx-cblock-mine', div)
      });
    });

    var verdict = $('#bx-chain-verdict');

    function short(h) { return h.slice(0, 16) + '…'; }

    function refresh() {
      var chainOk = true;
      var brokenAt = -1;
      var parentOk = true;
      blocks.forEach(function (b, idx) {
        b.prevActual = idx === 0 ? GENESIS_PREV : blocks[idx - 1].hash;
        b.hash = blockHash(idx);
        /* a block is only valid if its own proof checks out AND its whole
           ancestry does — invalidity cascades, exactly like the real chain */
        var own = b.hash.slice(0, TARGET.length) === TARGET && b.prev === b.prevActual;
        var valid = own && parentOk;
        parentOk = valid;
        if (!valid && brokenAt === -1) { brokenAt = idx; }
        if (!valid) { chainOk = false; }
        var el = els[idx];
        el.root.classList.toggle('is-invalid', !valid);
        el.status.textContent = valid ? 'valid' : 'broken';
        el.nonce.textContent = fmtInt(b.nonce);
        el.prev.textContent = short(b.prev);
        el.hash.textContent = short(b.hash);
        /* repairs must happen in order: only the first broken block is minable */
        el.mine.disabled = idx !== brokenAt;
      });
      if (verdict) {
        if (chainOk) {
          verdict.textContent = 'Chain intact: every hash starts with "' + TARGET + '" and matches the next block’s "previous hash". Now edit a transaction in block 1 or 2…';
        } else {
          var n = blocks.length - brokenAt;
          verdict.textContent = 'Block ' + (brokenAt + 1) + ' changed, so its fingerprint changed — and every block after it now points at a hash that no longer exists. ' +
            'To cover your tracks you must re-mine ' + n + ' block' + (n > 1 ? 's' : '') + ', in order, while the real network keeps adding new ones.';
        }
      }
    }

    els.forEach(function (el, idx) {
      el.ta.addEventListener('input', function () {
        blocks[idx].data = el.ta.value;
        refresh();
      });
      el.mine.addEventListener('click', function () {
        /* animated re-mine: real search, chunked so the nonce visibly spins */
        blocks[idx].prev = idx === 0 ? GENESIS_PREV : blocks[idx - 1].hash;
        var n = 0;
        el.root.classList.add('is-mining');
        el.mine.disabled = true;
        function chunk() {
          var t0 = performance.now();
          while (performance.now() - t0 < 9) {
            blocks[idx].nonce = n;
            var h = blockHash(idx);
            if (h.slice(0, TARGET.length) === TARGET) {
              el.root.classList.remove('is-mining');
              refresh();
              return;
            }
            n++;
          }
          el.nonce.textContent = fmtInt(n);
          el.hash.textContent = short(blockHash(idx));
          if (reduced()) { while (blockHash(idx).slice(0, TARGET.length) !== TARGET) { blocks[idx].nonce = ++n; } el.root.classList.remove('is-mining'); refresh(); return; }
          requestAnimationFrame(chunk);
        }
        chunk();
      });
    });

    refresh();
  }

  /* ---- transaction journey stepper ---- */
  function initTxFlow() {
    var svg = $('#bx-txflow-svg');
    if (!svg) { return; }
    var NS = 'http://www.w3.org/2000/svg';
    var cap = $('#bx-txflow-cap');
    var card = $('#bx-txcard');
    var sigEl = $('#bx-txcard-sig');
    var stepsList = $$('#bx-tx-steps li');
    var prevBtn = $('#bx-tx-prev');
    var nextBtn = $('#bx-tx-next');

    /* fixed layout: alice, mesh of relays, one miner, bob */
    var nodes = [
      { x: 70, y: 175, label: 'Alice', kind: 'alice' },
      { x: 205, y: 88, kind: 'relay' }, { x: 218, y: 245, kind: 'relay' },
      { x: 320, y: 158, kind: 'relay' }, { x: 335, y: 62, kind: 'relay' },
      { x: 352, y: 268, kind: 'relay' }, { x: 452, y: 110, kind: 'miner', label: 'Miner' },
      { x: 468, y: 232, kind: 'relay' }, { x: 552, y: 160, kind: 'relay' },
      { x: 650, y: 175, label: 'Bob', kind: 'bob' }
    ];
    var edges = [[0, 1], [0, 2], [1, 4], [1, 3], [2, 3], [2, 5], [3, 4], [3, 5], [3, 6], [3, 7], [4, 6], [5, 7], [6, 8], [7, 8], [8, 9], [6, 7]];
    var adj = nodes.map(function () { return []; });
    edges.forEach(function (e) { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
    function bfsFrom(s) {
      var d = nodes.map(function () { return -1; });
      d[s] = 0;
      var q = [s];
      while (q.length) {
        var n = q.shift();
        adj[n].forEach(function (m) { if (d[m] === -1) { d[m] = d[n] + 1; q.push(m); } });
      }
      return d;
    }
    var distFromAlice = bfsFrom(0);
    var distFromMiner = bfsFrom(6);

    function el(name, attrs, parent) {
      var e = document.createElementNS(NS, name);
      for (var k in attrs) { e.setAttribute(k, attrs[k]); }
      (parent || svg).appendChild(e);
      return e;
    }

    /* static skeleton */
    var edgeEls = edges.map(function (e) {
      return el('line', {
        x1: nodes[e[0]].x, y1: nodes[e[0]].y, x2: nodes[e[1]].x, y2: nodes[e[1]].y,
        stroke: '#1e293b', 'stroke-width': 1.4
      });
    });
    var confG = el('g', { opacity: 0 });     /* confirmation strip near Bob */
    var confBlocks = [];
    for (var ci = 0; ci < 6; ci++) {
      confBlocks.push(el('rect', {
        x: 555 + ci * 26, y: 285, width: 20, height: 20, rx: 4,
        fill: 'rgba(247,147,26,0.12)', stroke: '#334155', 'stroke-width': 1.4
      }, confG));
    }
    el('text', { x: 555, y: 278, fill: '#64748b', 'font-size': 11, 'font-family': 'Inter, sans-serif' }, confG)
      .textContent = 'confirmations';

    var nodeEls = nodes.map(function (n) {
      var g = el('g', {});
      var r = n.kind === 'alice' || n.kind === 'bob' ? 15 : (n.kind === 'miner' ? 12 : 8);
      var fill = n.kind === 'alice' ? 'rgba(45,212,191,0.15)' : n.kind === 'bob' ? 'rgba(101,163,13,0.15)' : n.kind === 'miner' ? 'rgba(247,147,26,0.15)' : 'rgba(30,41,59,0.9)';
      var stroke = n.kind === 'alice' ? '#2dd4bf' : n.kind === 'bob' ? '#65a30d' : n.kind === 'miner' ? '#f7931a' : '#334155';
      var c = el('circle', { cx: n.x, cy: n.y, r: r, fill: fill, stroke: stroke, 'stroke-width': 2 }, g);
      if (n.label) {
        var t = el('text', {
          x: n.x, y: n.y + r + 16, fill: '#94a3b8', 'font-size': 12,
          'font-family': 'Inter, sans-serif', 'text-anchor': 'middle', 'font-weight': 600
        }, g);
        t.textContent = n.label;
      }
      return { g: g, c: c, baseStroke: stroke, baseFill: fill };
    });

    var txDot = el('circle', { cx: nodes[0].x, cy: nodes[0].y, r: 5, fill: '#2dd4bf', opacity: 0 });
    var blockRect = el('rect', { x: nodes[6].x - 13, y: nodes[6].y - 34, width: 26, height: 20, rx: 4, fill: 'rgba(247,147,26,0.2)', stroke: '#f7931a', 'stroke-width': 1.6, opacity: 0 });

    var anim = null; /* cancellable one-shot animation state */
    function animate(dur, fn, done) {
      if (anim) { cancelAnimationFrame(anim.id); anim = null; }
      if (reduced()) { fn(1); if (done) { done(); } return; }
      var t0 = performance.now();
      var state = {};
      function frame(now) {
        var p = clamp((now - t0) / dur, 0, 1);
        fn(p);
        if (p < 1) { state.id = requestAnimationFrame(frame); anim = state; }
        else { anim = null; if (done) { done(); } }
      }
      state.id = requestAnimationFrame(frame);
      anim = state;
    }

    function tint(i, on, color) {
      var ne = nodeEls[i];
      ne.c.setAttribute('stroke', on ? color : ne.baseStroke);
      ne.c.setAttribute('stroke-width', on ? 3 : 2);
    }

    function resetVisual() {
      nodes.forEach(function (n, i) { tint(i, false); });
      txDot.setAttribute('opacity', 0);
      blockRect.setAttribute('opacity', 0);
      confG.setAttribute('opacity', 0);
      confBlocks.forEach(function (b) { b.setAttribute('fill', 'rgba(247,147,26,0.12)'); });
      edgeEls.forEach(function (e) { e.setAttribute('stroke', '#1e293b'); });
    }

    /* one real signature for flavor: a fixed demo key signs the tx text */
    var demoSig = null;
    function getSig() {
      if (!demoSig) {
        var d = bytesToBig(sha256(utf8Bytes('bx-demo-key'))) % EC_N;
        var z = bytesToBig(sha256(utf8Bytes('alice pays bob 0.5 btc')));
        var sig = null;
        while (!sig) { sig = ecdsaSign(z, d, randScalar()); }
        demoSig = bigToBytes(sig.r, 32);
      }
      return bytesToHex(demoSig).slice(0, 40) + '…';
    }

    var steps = [
      {
        cap: 'Step 1 — Compose. Alice’s wallet selects an unspent output she controls (0.8 BTC) and drafts outputs: 0.5 to Bob, change back to herself, and a small fee left for whoever mines it.',
        run: function () { resetVisual(); card.classList.remove('is-off'); sigEl.textContent = 'unsigned'; sigEl.classList.remove('is-signed'); }
      },
      {
        cap: 'Step 2 — Sign. Her wallet signs the transaction with her private key. The signature commits to every detail — change anything and it dies. (See chapter 6.)',
        run: function () {
          resetVisual(); card.classList.remove('is-off');
          sigEl.textContent = 'sig ' + getSig();
          sigEl.classList.add('is-signed');
          tint(0, true, '#2dd4bf');
        }
      },
      {
        cap: 'Step 3 — Broadcast. Alice hands the signed transaction to her peers, who hand it to theirs. Within seconds the whole network has it. Note what she did NOT do: contact Bob, or any bank.',
        run: function () {
          resetVisual(); card.classList.remove('is-off');
          sigEl.textContent = 'sig ' + getSig(); sigEl.classList.add('is-signed');
          var maxHop = Math.max.apply(null, distFromAlice);
          animate(1600, function (p) {
            nodes.forEach(function (n, i) {
              var arrive = distFromAlice[i] / (maxHop + 0.5);
              tint(i, p >= arrive, '#2dd4bf');
            });
            txDot.setAttribute('opacity', p < 1 ? 1 : 0.6);
            var f = Math.min(1, p * (maxHop + 0.5));
            var hop = Math.min(maxHop, Math.floor(f));
            txDot.setAttribute('cx', 70 + (650 - 70) * p);
            txDot.setAttribute('cy', 175 + Math.sin(p * Math.PI * 2) * 28);
          });
        }
      },
      {
        cap: 'Step 4 — Verify. Every node independently checks the signature, confirms the input exists and is unspent, and rejects any double-spend. No vote, no trust — each computer proves it to itself.',
        run: function () {
          resetVisual(); card.classList.add('is-off');
          animate(900, function (p) {
            nodes.forEach(function (n, i) {
              if (n.kind === 'relay' || n.kind === 'miner') { tint(i, p > (i % 5) / 6, '#65a30d'); }
            });
          });
        }
      },
      {
        cap: 'Step 5 — Mempool. Valid but unconfirmed, the transaction waits in every node’s memory pool alongside thousands of others, ranked by fee. There is no single queue — each node keeps its own.',
        run: function () {
          resetVisual(); card.classList.add('is-off');
          txDot.setAttribute('opacity', 1);
          animate(800, function (p) {
            txDot.setAttribute('cx', nodes[3].x + (nodes[6].x - nodes[3].x) * p);
            txDot.setAttribute('cy', nodes[3].y + (nodes[6].y - nodes[3].y) * p - Math.sin(p * Math.PI) * 20);
            tint(6, p > 0.7, '#f7931a');
          });
        }
      },
      {
        cap: 'Step 6 — Mined. A miner wins the proof-of-work lottery (chapter 8) and includes Alice’s transaction in the new block, collecting her fee. The block races across the network like the transaction did.',
        run: function () {
          resetVisual(); card.classList.add('is-off');
          blockRect.setAttribute('opacity', 1);
          txDot.setAttribute('opacity', 0);
          var maxHop = Math.max.apply(null, distFromMiner);
          animate(1500, function (p) {
            nodes.forEach(function (n, i) {
              var arrive = distFromMiner[i] / (maxHop + 0.5);
              tint(i, p >= arrive, '#f7931a');
            });
          });
        }
      },
      {
        cap: 'Step 7 — Confirmed. The block containing the payment is now part of history, and each new block on top makes reversing it harder. After six, convention calls it settled. Bob’s wallet — online or not — now controls 0.5 BTC.',
        run: function () {
          resetVisual(); card.classList.add('is-off');
          blockRect.setAttribute('opacity', 0);
          confG.setAttribute('opacity', 1);
          tint(9, true, '#65a30d');
          animate(2000, function (p) {
            var lit = Math.floor(p * 6.99);
            confBlocks.forEach(function (b, i) {
              b.setAttribute('fill', i < lit ? 'rgba(247,147,26,0.65)' : 'rgba(247,147,26,0.12)');
            });
          });
        }
      }
    ];

    var idx = -1;
    function goTo(n) {
      idx = clamp(n, 0, steps.length - 1);
      steps[idx].run();
      if (cap) { cap.textContent = steps[idx].cap; }
      stepsList.forEach(function (li, i) {
        li.classList.toggle('is-current', i === idx);
        li.classList.toggle('is-done', i < idx);
      });
      prevBtn.disabled = idx === 0;
      nextBtn.textContent = idx === steps.length - 1 ? 'Replay ↺' : 'Next →';
    }
    prevBtn.addEventListener('click', function () { goTo(idx - 1); });
    nextBtn.addEventListener('click', function () { goTo(idx === steps.length - 1 ? 0 : idx + 1); });
    goTo(0);
  }

  /* ---- key pair generator (real secp256k1) ---- */
  var currentKey = null; /* shared with the signature demo */

  function initKeys() {
    var btn = $('#bx-keys-gen');
    var bitsEl = $('#bx-keys-bits');
    var privEl = $('#bx-keys-priv');
    var pubEl = $('#bx-keys-pub');
    var addrEl = $('#bx-keys-addr');
    if (!btn || !privEl) { return; }

    var cells = [];
    if (bitsEl) {
      for (var i = 0; i < 256; i++) { cells.push(document.createElement('i')); bitsEl.appendChild(cells[i]); }
    }

    function generate() {
      var d = randScalar();
      var dBytes = bigToBytes(d, 32);
      var pub = pubFromPriv(d);
      var addr = p2pkhAddress(pub.compressed);
      currentKey = { d: d, pub: pub };
      privEl.textContent = bytesToHex(dBytes);
      pubEl.textContent = bytesToHex(pub.compressed);
      addrEl.textContent = addr;
      cells.forEach(function (c, i) {
        var byte = dBytes[i >> 3];
        var on = (byte >> (7 - (i & 7))) & 1;
        c.className = on ? 'is-on' : '';
      });
      /* invalidate any old signature display */
      var st = $('#bx-sign-status');
      var sg = $('#bx-sign-sig');
      if (st && sg && sg.textContent) {
        st.textContent = 'New key — sign again.';
        st.className = 'bx-sign-status';
        sg.textContent = '';
        lastSig = null;
      }
    }

    btn.addEventListener('click', generate);
    /* auto-generate the first pair when the section scrolls into view —
       but never clobber a key the visitor already has */
    var done = false;
    onScreen(btn, function () {
      if (!done) { done = true; if (!currentKey) { generate(); } }
    });
  }

  /* ---- sign & verify (real ECDSA) ---- */
  var lastSig = null;

  function initSign() {
    var msg = $('#bx-sign-msg');
    var btn = $('#bx-sign-btn');
    var status = $('#bx-sign-status');
    var sigEl = $('#bx-sign-sig');
    if (!msg || !btn) { return; }

    function zOf(text) { return bytesToBig(sha256(utf8Bytes(text))); }

    btn.addEventListener('click', function () {
      if (!currentKey) { status.textContent = 'Generate a key pair above first.'; return; }
      var sig = null;
      while (!sig) { sig = ecdsaSign(zOf(msg.value), currentKey.d, randScalar()); }
      lastSig = { r: sig.r, s: sig.s, key: currentKey };
      sigEl.textContent = 'r = ' + bigToBytes(sig.r, 32).reduce(function (a, b) { return a + (b < 16 ? '0' : '') + b.toString(16); }, '').slice(0, 32) +
        '…  s = ' + bigToBytes(sig.s, 32).reduce(function (a, b) { return a + (b < 16 ? '0' : '') + b.toString(16); }, '').slice(0, 32) + '…';
      verify();
    });

    var pending = null;
    function verify() {
      if (!lastSig) { return; }
      var ok = ecdsaVerify(zOf(msg.value), lastSig.r, lastSig.s, lastSig.key.pub);
      status.textContent = ok
        ? 'Valid — this exact message was approved by the private key.'
        : 'Invalid — the message changed, so the signature no longer matches.';
      status.className = 'bx-sign-status ' + (ok ? 'is-ok' : 'is-bad');
    }
    msg.addEventListener('input', function () {
      if (!lastSig) { return; }
      clearTimeout(pending);
      pending = setTimeout(verify, 120);
    });
  }

  /* ---- wallet x-ray toggle ---- */
  function initXray() {
    var mythBtn = $('#bx-xray-myth');
    var truthBtn = $('#bx-xray-truth');
    var mythView = $('#bx-xray-view-myth');
    var truthView = $('#bx-xray-view-truth');
    if (!mythBtn || !truthBtn) { return; }
    function show(truth) {
      mythBtn.classList.toggle('is-active', !truth);
      truthBtn.classList.toggle('is-active', truth);
      mythBtn.setAttribute('aria-pressed', String(!truth));
      truthBtn.setAttribute('aria-pressed', String(truth));
      mythView.hidden = truth;
      truthView.hidden = !truth;
    }
    mythBtn.addEventListener('click', function () { show(false); });
    truthBtn.addEventListener('click', function () { show(true); });
  }

  /* ---- 2-of-3 multisig vault ---- */
  function initMultisig() {
    var keys = $$('#bx-multisig .bx-mkey');
    var vault = $('#bx-vault');
    var label = $('#bx-vault-label');
    if (!keys.length || !vault) { return; }
    function update() {
      var n = keys.filter(function (k) { return k.getAttribute('aria-pressed') === 'true'; }).length;
      var open = n >= 2;
      vault.setAttribute('data-open', String(open));
      label.textContent = Math.min(n, 2) + ' of 2 required keys — ' + (open ? 'unlocked' : 'locked');
    }
    keys.forEach(function (k) {
      k.addEventListener('click', function () {
        k.setAttribute('aria-pressed', k.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        update();
      });
    });
    update();
  }

  /* ---- the mining simulator (real double SHA-256 over a header) ---- */
  function initMiner() {
    var startBtn = $('#bx-miner-start');
    var onceBtn = $('#bx-miner-once');
    if (!startBtn) { return; }
    var diffSel = $('#bx-miner-diff');
    var els = {
      prev: $('#bx-miner-prev'), merkle: $('#bx-miner-merkle'), nonce: $('#bx-miner-nonce'),
      target: $('#bx-miner-target-str'), hash: $('#bx-miner-hash'), tries: $('#bx-miner-tries'),
      rate: $('#bx-miner-rate'), elapsed: $('#bx-miner-elapsed'), best: $('#bx-miner-best'),
      verdict: $('#bx-miner-verdict'), chain: $('#bx-miner-chain'), height: $('#bx-miner-height')
    };

    var height = 908251;
    var prevHash = bytesToHex(sha256(utf8Bytes('bx-exhibit-chain-tip')));
    var txs = ['coinbase->you:3.125+0.041', 'b3..1f->1e..9c:0.5', '8a..77->f0..2b:0.125', 'c9..03->55..ae:2.4'];

    function merkleRoot() {
      var level = txs.map(function (t) { return sha256d(utf8Bytes(t)); });
      while (level.length > 1) {
        var next = [];
        for (var i = 0; i < level.length; i += 2) {
          var a = level[i], b = level[i + 1] || level[i];
          next.push(sha256d(concatBytes(a, b)));
        }
        level = next;
      }
      return level[0];
    }

    var header = new Uint8Array(80);
    var merkle;
    function rebuildHeader() {
      merkle = merkleRoot();
      header.set([0x04, 0x00, 0x00, 0x20], 0);                    /* version (LE) */
      header.set(reverseBytes(hexToBytes(prevHash)), 4);          /* prev block hash */
      header.set(merkle, 36);                                     /* merkle root */
      var t = Math.floor(Date.now() / 1000);
      header[68] = t & 0xff; header[69] = (t >> 8) & 0xff;
      header[70] = (t >> 16) & 0xff; header[71] = (t >> 24) & 0xff;
      header.set([0xff, 0xff, 0x00, 0x17], 72);                   /* nBits (display only) */
      els.prev.textContent = prevHash.slice(0, 26) + '…';
      els.merkle.textContent = bytesToHex(merkle).slice(0, 26) + '…';
      els.height.textContent = 'height ' + fmtInt(height);
    }
    rebuildHeader();

    function setNonce(n) {
      header[76] = n & 0xff; header[77] = (n >>> 8) & 0xff;
      header[78] = (n >>> 16) & 0xff; header[79] = (n >>> 24) & 0xff;
    }

    /* leading zero hex chars of the DISPLAYED (byte-reversed) hash */
    function leadingZeros(digest) {
      var z = 0;
      for (var i = 31; i >= 0; i--) {
        var b = digest[i];
        if (b === 0) { z += 2; continue; }
        if (b < 0x10) { z += 1; }
        break;
      }
      return z;
    }

    var zerosNeeded = 4;
    function updateTarget() {
      zerosNeeded = parseInt(diffSel.value, 10);
      var zs = '';
      for (var i = 0; i < zerosNeeded; i++) { zs += '0'; }
      els.target.textContent = zs + '…';
    }
    updateTarget();

    function fmtHash(hex, zeros) {
      var lead = Math.min(zeros, zerosNeeded + 2);
      return '<span class="bx-hash-zeros">' + hex.slice(0, lead) + '</span>' + hex.slice(lead);
    }

    var mining = false;
    var nonce = 0, tries = 0, t0 = 0, best = null, bestZeros = -1;
    var rateEma = 0;

    function stopMining(msg) {
      mining = false;
      startBtn.textContent = 'Start mining';
      onceBtn.disabled = false;
      diffSel.disabled = false;
      if (msg) { els.verdict.textContent = msg; }
    }

    function found(digest) {
      var hex = bytesToHex(reverseBytes(digest));
      var secs = (performance.now() - t0) / 1000;
      els.hash.innerHTML = fmtHash(hex, leadingZeros(digest));
      els.hash.classList.add('is-found');
      setTimeout(function () { els.hash.classList.remove('is-found'); }, 900);
      var li = document.createElement('li');
      li.textContent = '#' + fmtInt(height) + ' · ' + hex.slice(0, 12) + '… · +3.166 BTC';
      els.chain.appendChild(li);
      while (els.chain.children.length > 4) { els.chain.removeChild(els.chain.firstChild); }
      stopMining('Block found! Nonce ' + fmtInt(nonce) + ' worked after ' + fmtInt(tries) +
        ' attempts in ' + secs.toFixed(1) + ' s — you earn the 3.125 BTC subsidy plus 0.041 BTC in fees. ' +
        'The network now builds on YOUR block: the next candidate’s “previous hash” is this one.');
      /* chain continues from the block we just found */
      prevHash = hex;
      height += 1;
      rebuildHeader();
      nonce = 0;
    }

    function frame() {
      if (!mining) { return; }
      var t = performance.now();
      var batchStart = t;
      var batchTries = 0;
      while (performance.now() - batchStart < 9) {
        setNonce(nonce);
        var digest = sha256d(header);
        tries++; batchTries++;
        var z = leadingZeros(digest);
        if (z > bestZeros) { bestZeros = z; best = bytesToHex(reverseBytes(digest)); }
        if (z >= zerosNeeded) { found(digest); return; }
        nonce = (nonce + 1) >>> 0;
      }
      var dt = performance.now() - batchStart;
      var inst = batchTries / (dt / 1000);
      rateEma = rateEma ? rateEma * 0.8 + inst * 0.2 : inst;
      /* update readouts once per frame */
      setNonce(nonce);
      var last = sha256d(header);
      els.hash.innerHTML = fmtHash(bytesToHex(reverseBytes(last)), leadingZeros(last));
      els.nonce.textContent = fmtInt(nonce);
      els.tries.textContent = fmtInt(tries);
      els.rate.textContent = fmtInt(rateEma) + ' H/s';
      els.elapsed.textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s';
      els.best.textContent = best ? best.slice(0, 12) + '…' : '—';
      requestAnimationFrame(frame);
    }

    startBtn.addEventListener('click', function () {
      if (mining) { stopMining('Paused. The real network never does.'); return; }
      mining = true;
      tries = 0; best = null; bestZeros = -1; rateEma = 0;
      t0 = performance.now();
      startBtn.textContent = 'Stop';
      onceBtn.disabled = true;
      diffSel.disabled = true;
      els.verdict.textContent = 'Searching… each attempt is a full double SHA-256 of the 80-byte header. Odds per try: 1 in ' + fmtInt(Math.pow(16, zerosNeeded)) + '.';
      requestAnimationFrame(frame);
    });

    onceBtn.addEventListener('click', function () {
      setNonce(nonce);
      var digest = sha256d(header);
      var z = leadingZeros(digest);
      var hex = bytesToHex(reverseBytes(digest));
      els.hash.innerHTML = fmtHash(hex, z);
      els.nonce.textContent = fmtInt(nonce);
      els.tries.textContent = fmtInt(++tries);
      if (z >= zerosNeeded) {
        t0 = t0 || performance.now();
        found(digest);
      } else {
        els.verdict.textContent = 'Nonce ' + fmtInt(nonce) + ' produced ' + (z === 0 ? 'no leading zeros' : z + ' leading zero' + (z > 1 ? 's' : '')) +
          ' — you need ' + zerosNeeded + '. Chance per attempt: 1 in ' + fmtInt(Math.pow(16, zerosNeeded)) + '. Keep guessing.';
        nonce = (nonce + 1) >>> 0;
      }
    });

    diffSel.addEventListener('change', updateTarget);
  }

  /* ---- difficulty thermostat ---- */
  function initRetarget() {
    var canvas = $('#bx-retarget-canvas');
    if (!canvas) { return; }
    var slider = $('#bx-retarget-rate');
    var out = $('#bx-retarget-rate-out');
    var read = $('#bx-retarget-read');
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx, st = cv.state;

    var WINDOW = 42;
    var epochs = [];          /* { t: minutes per block, d: difficulty, h: hashrate } */
    var H = 1, D = 1;

    function growth() { return parseInt(slider.value, 10) / 100; }

    function step() {
      H = Math.max(0.05, H * (1 + growth()) * (1 + (Math.random() - 0.5) * 0.06));
      var t = 10 * D / H;                       /* minutes per block this period */
      var factor = clamp(10 / t, 0.25, 4);      /* Bitcoin clamps retargets to 4x */
      epochs.push({ t: t, d: D, h: H });
      D = D * factor;
      if (epochs.length > WINDOW) { epochs.shift(); }
    }

    function draw() {
      ctx.clearRect(0, 0, st.w, st.h);
      if (!epochs.length) { return; }
      var padL = 46, padR = 52, padT = 18, padB = 26;
      var W = st.w - padL - padR, Hh = st.h - padT - padB;
      var xs = function (i) { return padL + (i / (WINDOW - 1)) * W; };

      /* block-interval scale: 0..20+ min */
      var tMax = 22;
      var yT = function (t) { return padT + Hh * (1 - clamp(t, 0, tMax) / tMax); };
      /* difficulty on log scale relative to window */
      var ds = epochs.map(function (e) { return e.d; });
      var dMin = Math.min.apply(null, ds), dMax = Math.max.apply(null, ds);
      var yD = function (d) {
        if (dMax / dMin < 1.02) { return padT + Hh * 0.5; }
        var f = (Math.log(d) - Math.log(dMin)) / (Math.log(dMax) - Math.log(dMin));
        return padT + Hh * (1 - f);
      };

      /* 10-minute guide */
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(padL, yT(10));
      ctx.lineTo(padL + W, yT(10));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.faint;
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText('10 min target', padL + 6, yT(10) - 6);
      ctx.fillText('block interval', padL - 40, padT + 10);
      ctx.save();
      ctx.fillStyle = 'rgba(247,147,26,0.9)';
      ctx.fillText('difficulty', padL + W + 6, padT + 10);
      ctx.restore();

      /* difficulty staircase (orange) */
      ctx.strokeStyle = C.btc;
      ctx.lineWidth = 2;
      ctx.beginPath();
      epochs.forEach(function (e, i) {
        var y = yD(e.d);
        if (i === 0) { ctx.moveTo(xs(i), y); }
        else { ctx.lineTo(xs(i), yD(epochs[i - 1].d)); ctx.lineTo(xs(i), y); }
      });
      ctx.stroke();

      /* block time line (teal) */
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 2;
      ctx.beginPath();
      epochs.forEach(function (e, i) {
        var y = yT(e.t);
        if (i === 0) { ctx.moveTo(xs(i), y); } else { ctx.lineTo(xs(i), y); }
      });
      ctx.stroke();

      /* axis labels */
      ctx.fillStyle = C.faint;
      ctx.fillText('0', padL - 14, yT(0) + 4);
      ctx.fillText('20', padL - 20, yT(20) + 4);
      ctx.fillText('→ 2,016-block periods (≈ 2 weeks each)', padL + W / 2 - 90, st.h - 8);
    }

    function narrate() {
      var g = Math.round(growth() * 100);
      var last = epochs[epochs.length - 1];
      var t = last ? last.t : 10;
      var dir = g > 0 ? 'joins' : g < 0 ? 'leaves' : 'holds steady';
      out.textContent = (g > 0 ? '+' : '') + g + '% per period';
      read.textContent = 'Hashrate ' + dir + (g ? ' at ' + Math.abs(g) + '% per period' : '') +
        '. Latest period averaged ' + t.toFixed(1) + ' min per block; the next adjustment ' +
        (t < 9.7 ? 'raises difficulty to slow blocks back down.' : t > 10.3 ? 'lowers difficulty to speed blocks back up.' : 'barely moves — the thermostat is settled.');
    }

    for (var i = 0; i < WINDOW; i++) { step(); }
    draw(); narrate();

    slider.addEventListener('input', narrate);

    if (reduced()) {
      slider.addEventListener('change', function () {
        for (var i = 0; i < WINDOW; i++) { step(); }
        draw(); narrate();
      });
      return;
    }
    var acc = 0;
    var loop = makeLoop(function (t, dt) {
      acc += dt;
      if (acc > 700) { acc = 0; step(); draw(); narrate(); }
    });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ---- consensus: clusters, propagation, fork replay ---- */
  function initConsensus() {
    var canvas = $('#bx-consensus-canvas');
    if (!canvas) { return; }
    var cap = $('#bx-consensus-cap');
    var replayBtn = $('#bx-fork-replay');
    var cv = setupCanvas(canvas, function () { place(); });
    var ctx = cv.ctx, st = cv.state;

    /* four regional clusters (normalized coordinates) */
    var CLUSTERS = [
      { cx: 0.17, cy: 0.36, label: 'Americas' },
      { cx: 0.44, cy: 0.62, label: 'Europe' },
      { cx: 0.66, cy: 0.28, label: 'Africa & Mid-East' },
      { cx: 0.86, cy: 0.60, label: 'Asia-Pacific' }
    ];
    var nodes = [];
    CLUSTERS.forEach(function (cl, ci) {
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2 + ci;
        var r = 0.055 + (i % 3) * 0.03;
        nodes.push({ nx: cl.cx + Math.cos(a) * r, ny: cl.cy + Math.sin(a) * r * 1.5, c: ci, x: 0, y: 0 });
      }
    });
    var links = [];
    /* intra-cluster: nearest two */
    nodes.forEach(function (n, ai) {
      var ds = nodes.map(function (m, bi) {
        if (m.c !== n.c || bi === ai) { return { d: 9, i: bi }; }
        var dx = n.nx - m.nx, dy = n.ny - m.ny;
        return { d: dx * dx + dy * dy, i: bi };
      }).sort(function (a, b) { return a.d - b.d; });
      for (var k = 0; k < 2; k++) {
        var bi = ds[k].i;
        if (ds[k].d < 9 && !links.some(function (l) { return (l[0] === ai && l[1] === bi) || (l[0] === bi && l[1] === ai); })) {
          links.push([ai, bi, 1]);
        }
      }
    });
    /* inter-cluster backbones (weight 3 = slower hop) */
    [[0, 1], [1, 2], [2, 3], [0, 3], [1, 3]].forEach(function (pair, i) {
      var a = pair[0] * 8 + (i % 8);
      var b = pair[1] * 8 + ((i + 3) % 8);
      links.push([a, b, 3]);
    });
    var adj = nodes.map(function () { return []; });
    links.forEach(function (l) { adj[l[0]].push([l[1], l[2]]); adj[l[1]].push([l[0], l[2]]); });

    function dijkstra(from) {
      var dist = nodes.map(function () { return Infinity; });
      dist[from] = 0;
      var visited = nodes.map(function () { return false; });
      for (var iter = 0; iter < nodes.length; iter++) {
        var u = -1, bd = Infinity;
        for (var i = 0; i < nodes.length; i++) { if (!visited[i] && dist[i] < bd) { bd = dist[i]; u = i; } }
        if (u === -1) { break; }
        visited[u] = true;
        adj[u].forEach(function (e) {
          if (dist[u] + e[1] < dist[e[0]]) { dist[e[0]] = dist[u] + e[1]; }
        });
      }
      return dist;
    }

    function place() {
      nodes.forEach(function (n) { n.x = n.nx * st.w; n.y = n.ny * st.h; });
    }
    place();

    var HOP = 260;
    var mode = 'ambient';
    var wave = null;           /* ambient { dist, t0 } */
    var nextWave = 600;
    var fork = null;           /* { distA, distB, t0, winner, resolveDist, resolveT0, phase } */

    function startFork() {
      var a = 2;                       /* Americas node */
      var b = 3 * 8 + 4;               /* Asia-Pacific node */
      fork = {
        distA: dijkstra(a), distB: dijkstra(b), a: a, b: b,
        t0: performance.now(), phase: 'race', winner: null, resolveDist: null, resolveT0: 0
      };
      mode = 'fork';
      wave = null;
      if (cap) { cap.textContent = 'Two miners — one in the Americas, one in Asia-Pacific — found valid blocks at the same height almost simultaneously. Watch each half of the world adopt the block it heard first…'; }
    }

    replayBtn.addEventListener('click', startFork);

    function campOf(i, now) {
      if (!fork) { return 0; }
      var ta = fork.t0 + fork.distA[i] * HOP;
      var tb = fork.t0 + fork.distB[i] * HOP;
      if (now < Math.min(ta, tb)) { return 0; }
      return ta <= tb ? 1 : 2;
    }

    function draw(now) {
      ctx.clearRect(0, 0, st.w, st.h);

      /* cluster labels */
      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = 'rgba(100,116,139,0.85)';
      CLUSTERS.forEach(function (cl) {
        ctx.fillText(cl.label, cl.cx * st.w - 26, cl.cy * st.h - st.h * 0.155);
      });

      ctx.lineWidth = 1;
      links.forEach(function (l) {
        var a = nodes[l[0]], b = nodes[l[1]];
        ctx.strokeStyle = l[2] > 1 ? 'rgba(2,132,199,0.22)' : 'rgba(94,130,172,0.16)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });

      nodes.forEach(function (n, i) {
        var fill = 'rgba(148,163,184,0.75)';
        var ring = null, glow = 0;

        if (mode === 'ambient' && wave) {
          var at = wave.t0 + wave.dist[i] * HOP;
          var dt = now - at;
          if (dt > 0 && dt < 900) { glow = 1 - dt / 900; }
          if (glow > 0) { fill = 'rgba(247,147,26,' + (0.5 + glow * 0.5) + ')'; }
        }

        if (mode === 'fork' && fork) {
          var camp = fork.phase === 'resolved' ? fork.winner : campOf(i, now);
          if (fork.phase === 'resolving' || fork.phase === 'resolved') {
            var rt = fork.resolveT0 + fork.resolveDist[i] * HOP;
            if (now >= rt) { camp = fork.winner; }
          }
          if (camp === 1) { fill = 'rgba(247,147,26,0.9)'; }
          if (camp === 2) { fill = 'rgba(139,92,246,0.9)'; }
          if (i === fork.a) { ring = '#f7931a'; }
          if (i === fork.b) { ring = '#8b5cf6'; }
        }

        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 4 + glow * 2, 0, Math.PI * 2);
        ctx.fill();
        if (ring) {
          ctx.strokeStyle = ring;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    function forkTick(now) {
      var maxA = Math.max.apply(null, fork.distA);
      var maxB = Math.max.apply(null, fork.distB);
      var settled = fork.t0 + Math.max(maxA, maxB) * HOP + 900;

      if (fork.phase === 'race') {
        if (now > fork.t0 + 600 && cap) {
          var c1 = 0, c2 = 0;
          nodes.forEach(function (n, i) {
            var c = campOf(i, now);
            if (c === 1) { c1++; }
            if (c === 2) { c2++; }
          });
          cap.textContent = 'The network is split: ' + c1 + ' nodes follow the orange block, ' + c2 +
            ' follow the violet one. Both are valid. Miners on each side are already mining on top of “their” block…';
        }
        if (now > settled) {
          fork.phase = 'resolving';
          fork.winner = Math.random() < 0.5 ? 1 : 2;
          var camps = nodes.map(function (n, i) { return campOf(i, now); });
          var candidates = [];
          camps.forEach(function (c, i) { if (c === fork.winner) { candidates.push(i); } });
          var origin = candidates[(Math.random() * candidates.length) | 0] || 0;
          fork.resolveDist = dijkstra(origin);
          fork.resolveT0 = now + 300;
          if (cap) {
            cap.textContent = 'Next block found — and it builds on the ' + (fork.winner === 1 ? 'orange' : 'violet') +
              ' block, making that branch the chain with the most work. Watch the whole network converge…';
          }
        }
      } else if (fork.phase === 'resolving') {
        var maxR = Math.max.apply(null, fork.resolveDist);
        if (now > fork.resolveT0 + maxR * HOP + 700) {
          fork.phase = 'resolved';
          if (cap) {
            cap.textContent = 'Consensus restored: everyone follows the ' + (fork.winner === 1 ? 'orange' : 'violet') +
              ' branch. The losing block is stale — its transactions simply return to the mempool and confirm in a later block. Total drama: about one minute, resolved by math.';
          }
          setTimeout(function () { mode = 'ambient'; fork = null; nextWave = 400; }, 2600);
        }
      }
    }

    var loop = makeLoop(function (t, dt) {
      if (mode === 'ambient') {
        nextWave -= dt;
        if (nextWave <= 0) {
          wave = { dist: dijkstra((Math.random() * nodes.length) | 0), t0: t };
          nextWave = 3400 + Math.random() * 1800;
        }
        if (wave && t - wave.t0 > 12 * HOP + 1200) { wave = null; }
      } else if (fork) {
        forkTick(t);
      }
      draw(t);
    });

    if (reduced()) {
      /* static frame with one settled wave; replay renders end states stepwise */
      wave = { dist: dijkstra(5), t0: performance.now() - 2000 };
      draw(performance.now());
      wave = null;
      replayBtn.addEventListener('click', function () {
        if (cap) {
          cap.textContent = 'Fork replay (reduced motion): two simultaneous blocks split the network by region; the next block built on one of them, that branch accumulated more work, and every node converged on it. The losing block became stale.';
        }
      });
      return;
    }
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ---- supply schedule chart ---- */
  function initSupply() {
    var host = $('#bx-supply-chart');
    if (!host) { return; }
    var NS = 'http://www.w3.org/2000/svg';
    var scrub = $('#bx-supply-scrub');
    var yearOut = $('#bx-supply-year');
    var outSub = $('#bx-supply-subsidy');
    var outTotal = $('#bx-supply-total');
    var outPct = $('#bx-supply-pct');
    var outInfl = $('#bx-supply-infl');

    /* height <-> year anchors: real halving dates, then ~3.98y per epoch */
    var anchors = [[2009.0, 0], [2012.92, 210000], [2016.53, 420000], [2020.37, 630000], [2024.30, 840000]];
    (function () {
      var y = 2024.30, h = 840000;
      while (y < 2056) { y += 3.98; h += 210000; anchors.push([y, h]); }
    })();

    function yearToHeight(y) {
      if (y <= anchors[0][0]) { return 0; }
      for (var i = 1; i < anchors.length; i++) {
        if (y <= anchors[i][0]) {
          var f = (y - anchors[i - 1][0]) / (anchors[i][0] - anchors[i - 1][0]);
          return Math.round(anchors[i - 1][1] + f * (anchors[i][1] - anchors[i - 1][1]));
        }
      }
      return anchors[anchors.length - 1][1];
    }

    function subsidyAt(h) {
      var e = Math.floor(h / 210000);
      if (e >= 33) { return 0; }
      return 50 / Math.pow(2, e);
    }

    function supplyAt(h) {
      var total = 0;
      var e = 0;
      while (e * 210000 < h && e < 34) {
        var inEpoch = Math.min(210000, h - e * 210000);
        total += inEpoch * subsidyAt(e * 210000);
        e++;
      }
      return total;
    }
    var MAX_SUPPLY = 20999999.97;

    /* build the SVG once */
    var W = 720, H = 320, padL = 50, padR = 44, padT = 20, padB = 34;
    var IW = W - padL - padR, IH = H - padT - padB;
    var Y0 = 2009, Y1 = 2050;
    function xOf(y) { return padL + ((y - Y0) / (Y1 - Y0)) * IW; }
    function yOfSupply(s) { return padT + IH * (1 - s / 21000000); }
    function yOfSub(sub) { return padT + IH * (1 - sub / 52); }

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Chart of bitcoin supply approaching 21 million as the block subsidy halves every four years');
    host.appendChild(svg);
    function el(name, attrs) {
      var e = document.createElementNS(NS, name);
      for (var k in attrs) { e.setAttribute(k, attrs[k]); }
      svg.appendChild(e);
      return e;
    }

    /* gridlines + labels */
    [[0, '0'], [10500000, '10.5M'], [21000000, '21M']].forEach(function (g) {
      el('line', { x1: padL, y1: yOfSupply(g[0]), x2: padL + IW, y2: yOfSupply(g[0]), stroke: '#1e293b', 'stroke-width': 1 });
      var t = el('text', { x: 8, y: yOfSupply(g[0]) + 4, fill: '#64748b', 'font-size': 11, 'font-family': 'Inter, sans-serif' });
      t.textContent = g[1];
    });
    [2010, 2020, 2030, 2040, 2050].forEach(function (yr) {
      var t = el('text', { x: xOf(yr) - 13, y: H - 10, fill: '#64748b', 'font-size': 11, 'font-family': 'Inter, sans-serif' });
      t.textContent = yr;
    });

    /* halving markers */
    anchors.slice(1).forEach(function (a, i) {
      if (a[0] > Y1) { return; }
      el('line', { x1: xOf(a[0]), y1: padT, x2: xOf(a[0]), y2: padT + IH, stroke: 'rgba(247,147,26,0.22)', 'stroke-width': 1, 'stroke-dasharray': '3 4' });
      var t = el('text', { x: xOf(a[0]) - 12, y: padT + 12 + (i % 2) * 12, fill: 'rgba(247,147,26,0.6)', 'font-size': 9.5, 'font-family': 'Inter, sans-serif' });
      t.textContent = (i < 4 ? '' : '≈') + Math.round(a[0]);
    });

    /* subsidy staircase */
    var subPath = 'M ' + xOf(Y0) + ' ' + yOfSub(50);
    for (var e2 = 1; e2 < 11; e2++) {
      var hy = anchors[e2] ? anchors[e2][0] : Y1;
      if (hy > Y1) { hy = Y1; }
      subPath += ' L ' + xOf(hy) + ' ' + yOfSub(subsidyAt((e2 - 1) * 210000));
      subPath += ' L ' + xOf(hy) + ' ' + yOfSub(subsidyAt(e2 * 210000));
      if (hy >= Y1) { break; }
    }
    el('path', { d: subPath, fill: 'none', stroke: '#14b8a6', 'stroke-width': 1.8, opacity: 0.85 });

    /* supply curve + soft fill */
    var d = 'M ' + xOf(Y0) + ' ' + yOfSupply(0);
    for (var yy = Y0; yy <= Y1; yy += 0.25) {
      d += ' L ' + xOf(yy).toFixed(1) + ' ' + yOfSupply(supplyAt(yearToHeight(yy))).toFixed(1);
    }
    el('path', { d: d + ' L ' + xOf(Y1) + ' ' + yOfSupply(0) + ' Z', fill: 'rgba(247,147,26,0.08)', stroke: 'none' });
    el('path', { d: d, fill: 'none', stroke: '#f7931a', 'stroke-width': 2.4 });

    /* 21M cap line */
    el('line', { x1: padL, y1: yOfSupply(21000000), x2: padL + IW, y2: yOfSupply(21000000), stroke: 'rgba(241,245,249,0.35)', 'stroke-width': 1, 'stroke-dasharray': '6 5' });

    /* legend */
    var lg1 = el('text', { x: padL + 10, y: padT + 14, fill: '#f7931a', 'font-size': 11, 'font-family': 'Inter, sans-serif', 'font-weight': 600 });
    lg1.textContent = '— total supply';
    var lg2 = el('text', { x: padL + 10, y: padT + 30, fill: '#14b8a6', 'font-size': 11, 'font-family': 'Inter, sans-serif', 'font-weight': 600 });
    lg2.textContent = '— block subsidy (right steps: 50 → 25 → 12.5 …)';

    /* scrub marker */
    var marker = el('line', { x1: 0, y1: padT, x2: 0, y2: padT + IH, stroke: '#2dd4bf', 'stroke-width': 1.6 });
    var dot = el('circle', { cx: 0, cy: 0, r: 5, fill: '#2dd4bf', stroke: '#04211d', 'stroke-width': 2 });

    function update() {
      var y = parseFloat(scrub.value);
      yearOut.textContent = String(Math.round(y));
      var h = yearToHeight(y + 0.5);
      var sub = subsidyAt(h);
      var sup = supplyAt(h);
      marker.setAttribute('x1', xOf(y + 0.5));
      marker.setAttribute('x2', xOf(y + 0.5));
      dot.setAttribute('cx', xOf(y + 0.5));
      dot.setAttribute('cy', yOfSupply(sup));
      outSub.textContent = sub >= 1 ? sub + ' BTC' : sub > 0 ? sub.toFixed(5).replace(/0+$/, '') + ' BTC' : '0 (fees only)';
      outTotal.textContent = (sup / 1e6).toFixed(2) + 'M BTC';
      outPct.textContent = (sup / MAX_SUPPLY * 100).toFixed(1) + '%';
      var infl = sup > 0 ? (sub * 52560 / sup) * 100 : 0;
      outInfl.textContent = sup > 0 ? (infl >= 10 ? infl.toFixed(0) : infl.toFixed(2)) + '% / yr' : '—';
    }
    scrub.addEventListener('input', update);
    update();
  }

  /* ---- race the honest chain (51% intuition) ---- */
  function initAttack() {
    var runBtn = $('#bx-attack-run');
    if (!runBtn) { return; }
    var shareIn = $('#bx-attack-share');
    var shareOut = $('#bx-attack-share-out');
    var depthIn = $('#bx-attack-depth');
    var depthOut = $('#bx-attack-depth-out');
    var laneH = $('#bx-attack-lane-honest');
    var laneE = $('#bx-attack-lane-evil');
    var verdict = $('#bx-attack-verdict');

    shareIn.addEventListener('input', function () { shareOut.textContent = shareIn.value + '%'; });
    depthIn.addEventListener('input', function () { depthOut.textContent = depthIn.value; });

    var timer = null;

    function cell(lane, cls) {
      var i = document.createElement('i');
      i.className = 'bx-lane-cell ' + cls;
      lane.appendChild(i);
      while (lane.children.length > 30) { lane.removeChild(lane.firstChild); }
    }

    function catchOdds(q, z) {
      if (q >= 0.5) { return 1; }
      return Math.pow(q / (1 - q), z);
    }

    function run() {
      if (timer) { clearInterval(timer); timer = null; }
      laneH.innerHTML = '';
      laneE.innerHTML = '';
      var q = parseInt(shareIn.value, 10) / 100;
      var D = parseInt(depthIn.value, 10);
      for (var i = 0; i < D; i++) { cell(laneH, 'is-old'); }
      var h = 0, a = 0, ticks = 0;
      var TICKS_MAX = 34;

      function verdictLive() {
        var deficit = D + h - a + 1;
        verdict.textContent = 'Racing… honest chain +' + h + ', your secret chain ' + a +
          ' — you need ' + Math.max(0, deficit) + ' more block' + (deficit === 1 ? '' : 's') + ' of net gain to take over.';
      }

      function finish(won) {
        clearInterval(timer);
        timer = null;
        var odds = catchOdds(q, D + 1);
        if (won) {
          verdict.textContent = 'You caught up — with ' + Math.round(q * 100) + '% of the network, rewriting is a matter of time (this is exactly why >50% breaks the guarantee, and why nobody has ever held it on Bitcoin). Try 30% and watch the same race fail.';
        } else {
          verdict.textContent = 'Race over: the honest chain pulled ' + (D + h - a) + ' blocks ahead and the gap keeps growing. At ' +
            Math.round(q * 100) + '% hashrate, the odds of EVER erasing a ' + D + '-block-deep transaction are about ' +
            (odds < 1e-6 ? odds.toExponential(1) : (odds * 100).toFixed(odds > 0.01 ? 1 : 3) + '%') +
            '. Every confirmation buys exponentially more safety.';
        }
      }

      function tick() {
        ticks++;
        if (Math.random() < q) { a++; cell(laneE, 'is-evil'); }
        else { h++; cell(laneH, 'is-honest'); }
        verdictLive();
        if (a >= D + h + 1) { finish(true); }
        else if (ticks >= TICKS_MAX || (D + h - a) > 16) { finish(false); }
      }

      if (reduced()) {
        while (ticks < TICKS_MAX && a < D + h + 1 && (D + h - a) <= 16) { tick(); }
        if (timer === null && ticks >= 1) { /* finish() already called via conditions? ensure: */ }
        if (a >= D + h + 1) { finish(true); } else { finish(false); }
        return;
      }
      verdictLive();
      timer = setInterval(tick, 240);
    }

    runBtn.addEventListener('click', run);
  }

  /* ---- lightning channel walkthrough ---- */
  function initLightning() {
    var svg = $('#bx-ln-svg');
    if (!svg) { return; }
    var NS = 'http://www.w3.org/2000/svg';
    var cap = $('#bx-ln-cap');
    var openBtn = $('#bx-ln-open');
    var payBtn = $('#bx-ln-pay');
    var closeBtn = $('#bx-ln-close');

    function el(name, attrs, parent) {
      var e = document.createElementNS(NS, name);
      for (var k in attrs) { e.setAttribute(k, attrs[k]); }
      (parent || svg).appendChild(e);
      return e;
    }

    /* base chain strip */
    var chainBlocks = [];
    el('text', { x: 40, y: 236, fill: '#64748b', 'font-size': 11, 'font-family': 'Inter, sans-serif' }).textContent = 'Bitcoin base chain (slow, global, final)';
    for (var i = 0; i < 8; i++) {
      chainBlocks.push(el('rect', {
        x: 40 + i * 36, y: 246, width: 28, height: 28, rx: 5,
        fill: 'rgba(30,41,59,0.9)', stroke: '#334155', 'stroke-width': 1.5
      }));
    }

    /* Alice & Bob */
    el('circle', { cx: 130, cy: 96, r: 17, fill: 'rgba(45,212,191,0.15)', stroke: '#2dd4bf', 'stroke-width': 2 });
    el('text', { x: 130, y: 62, fill: '#94a3b8', 'font-size': 13, 'text-anchor': 'middle', 'font-family': 'Inter, sans-serif', 'font-weight': 600 }).textContent = 'Alice';
    var aliceBal = el('text', { x: 130, y: 140, fill: '#2dd4bf', 'font-size': 12, 'text-anchor': 'middle', 'font-family': 'Inter, sans-serif', 'font-weight': 700 });
    el('circle', { cx: 590, cy: 96, r: 17, fill: 'rgba(101,163,13,0.15)', stroke: '#65a30d', 'stroke-width': 2 });
    el('text', { x: 590, y: 62, fill: '#94a3b8', 'font-size': 13, 'text-anchor': 'middle', 'font-family': 'Inter, sans-serif', 'font-weight': 600 }).textContent = 'Bob';
    var bobBal = el('text', { x: 590, y: 140, fill: '#65a30d', 'font-size': 12, 'text-anchor': 'middle', 'font-family': 'Inter, sans-serif', 'font-weight': 700 });

    /* channel */
    var chanG = el('g', { opacity: 0 });
    el('rect', { x: 170, y: 82, width: 400, height: 28, rx: 14, fill: 'rgba(11,17,32,0.9)', stroke: '#334155', 'stroke-width': 1.5 }, chanG);
    var fillRect = el('rect', { x: 172, y: 84, width: 198, height: 24, rx: 12, fill: 'rgba(45,212,191,0.35)' }, chanG);
    var divider = el('line', { x1: 370, y1: 78, x2: 370, y2: 114, stroke: '#f1f5f9', 'stroke-width': 2 }, chanG);
    var bolt = el('path', { d: 'M 0 0', stroke: '#8b5cf6', 'stroke-width': 2.5, fill: 'none', opacity: 0, 'stroke-linejoin': 'round' }, chanG);
    var counter = el('text', { x: 360, y: 178, fill: '#94a3b8', 'font-size': 13, 'text-anchor': 'middle', 'font-family': 'Inter, sans-serif' });

    var state = { open: false, alice: 0.05, bob: 0.05, payments: 0, anim: null };

    function setBalances() {
      var total = 0.1;
      var f = state.alice / total;
      fillRect.setAttribute('width', Math.max(6, 396 * f));
      divider.setAttribute('x1', 172 + 396 * f);
      divider.setAttribute('x2', 172 + 396 * f);
      aliceBal.textContent = state.alice.toFixed(3) + ' BTC';
      bobBal.textContent = state.bob.toFixed(3) + ' BTC';
      counter.textContent = 'off-chain payments: ' + state.payments + ' · on-chain transactions: ' + (state.open ? 1 : state.payments > 0 ? 2 : 0);
    }

    function reset() {
      state.open = false; state.alice = 0.05; state.bob = 0.05; state.payments = 0;
      if (state.anim) { clearInterval(state.anim); state.anim = null; }
      chanG.setAttribute('opacity', 0);
      chainBlocks.forEach(function (b) { b.setAttribute('fill', 'rgba(30,41,59,0.9)'); b.setAttribute('stroke', '#334155'); });
      aliceBal.textContent = '';
      bobBal.textContent = '';
      counter.textContent = '';
      openBtn.disabled = false;
      openBtn.textContent = '1 · Open channel';
      payBtn.disabled = true;
      closeBtn.disabled = true;
      cap.textContent = 'Alice and Bob each hold 0.05 BTC. Open a channel to begin.';
    }

    openBtn.addEventListener('click', function () {
      reset();
      state.open = true;
      chainBlocks[2].setAttribute('fill', 'rgba(247,147,26,0.35)');
      chainBlocks[2].setAttribute('stroke', '#f7931a');
      chanG.setAttribute('opacity', 1);
      setBalances();
      openBtn.disabled = true;
      payBtn.disabled = false;
      cap.textContent = 'Channel open. ONE on-chain transaction locked 0.1 BTC into an address requiring both signatures. From here on, Alice and Bob can pay each other without touching the chain at all.';
    });

    payBtn.addEventListener('click', function () {
      payBtn.disabled = true;
      if (reduced()) {
        state.payments = 47;
        state.alice = 0.032; state.bob = 0.068;
        setBalances();
        closeBtn.disabled = false;
        cap.textContent = '47 payments streamed instantly — coffee-sized, fee-free-ish, each one just a mutually signed balance update. The base chain saw none of them: still one transaction.';
        return;
      }
      var n = 0;
      cap.textContent = 'Streaming payments — each is a new balance signed by both parties, replacing the last. Instant, private, and nearly free…';
      state.anim = setInterval(function () {
        n++;
        state.payments++;
        var delta = (Math.random() * 0.006 + 0.001) * (Math.random() < 0.68 ? 1 : -1);
        delta = clamp(delta, -state.bob + 0.004, state.alice - 0.004);
        state.alice -= delta;
        state.bob += delta;
        setBalances();
        var x = parseFloat(divider.getAttribute('x1'));
        bolt.setAttribute('d', 'M ' + (x - 7) + ' 74 L ' + (x + 3) + ' 88 L ' + (x - 3) + ' 92 L ' + (x + 7) + ' 106');
        bolt.setAttribute('opacity', 1);
        setTimeout(function () { bolt.setAttribute('opacity', 0); }, 140);
        if (n >= 24) {
          clearInterval(state.anim);
          state.anim = null;
          closeBtn.disabled = false;
          cap.textContent = state.payments + ' payments later, the balance stands at Alice ' + state.alice.toFixed(3) +
            ' / Bob ' + state.bob.toFixed(3) + ' BTC — and the base chain still shows exactly one transaction. Now settle.';
        }
      }, 210);
    });

    closeBtn.addEventListener('click', function () {
      closeBtn.disabled = true;
      chainBlocks[6].setAttribute('fill', 'rgba(20,184,166,0.3)');
      chainBlocks[6].setAttribute('stroke', '#14b8a6');
      chanG.setAttribute('opacity', 0.35);
      counter.textContent = 'off-chain payments: ' + state.payments + ' · on-chain transactions: 2 (open + close)';
      cap.textContent = 'Channel closed: a second on-chain transaction pays out the final balances — Alice ' + state.alice.toFixed(3) +
        ', Bob ' + state.bob.toFixed(3) + ' BTC. ' + state.payments + ' payments settled with 2 base-chain entries. That is the entire trick, and it inherits Bitcoin’s security.';
      openBtn.disabled = false;
      openBtn.textContent = '↺ Open again';
    });

    reset();
  }

  /* ---- misconception accordions ---- */
  function initMyths() {
    $$('#bitcoin-experience .bx-myth-btn').forEach(function (btn) {
      var body = document.getElementById(btn.getAttribute('aria-controls'));
      if (!body) { return; }
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        if (reduced()) { body.hidden = open; return; }
        if (!open) {
          body.hidden = false;
          var h = body.scrollHeight;
          body.style.overflow = 'hidden';
          body.style.maxHeight = '0px';
          body.getBoundingClientRect();
          body.style.transition = 'max-height 0.3s ease';
          body.style.maxHeight = h + 'px';
          setTimeout(function () {
            body.style.maxHeight = '';
            body.style.overflow = '';
            body.style.transition = '';
          }, 320);
        } else {
          var h2 = body.scrollHeight;
          body.style.overflow = 'hidden';
          body.style.maxHeight = h2 + 'px';
          body.getBoundingClientRect();
          body.style.transition = 'max-height 0.25s ease';
          body.style.maxHeight = '0px';
          setTimeout(function () {
            body.hidden = true;
            body.style.maxHeight = '';
            body.style.overflow = '';
            body.style.transition = '';
          }, 270);
        }
      });
    });
  }

  /* ---- the network playground ---- */
  function initPlayground() {
    var canvas = $('#bx-pg-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { build(); });
    var ctx = cv.ctx, st = cv.state;

    var sliders = {
      nodes: [$('#bx-pg-nodes'), $('#bx-pg-nodes-out')],
      miners: [$('#bx-pg-miners'), $('#bx-pg-miners-out')],
      diff: [$('#bx-pg-diff'), $('#bx-pg-diff-out')],
      txrate: [$('#bx-pg-txrate'), $('#bx-pg-txrate-out')],
      blocksize: [$('#bx-pg-blocksize'), $('#bx-pg-blocksize-out')],
      latency: [$('#bx-pg-latency'), $('#bx-pg-latency-out')]
    };
    var outs = {
      height: $('#bx-pg-height'), avg: $('#bx-pg-avg'), confirmed: $('#bx-pg-confirmed'),
      mempool: $('#bx-pg-mempool'), stale: $('#bx-pg-stale'), verdict: $('#bx-pg-verdict')
    };
    var runBtn = $('#bx-pg-run');
    var resetBtn = $('#bx-pg-reset');

    function val(k) { return parseFloat(sliders[k][0].value); }
    function hopMs() { return val('latency') * 35; }

    function labelOutputs() {
      sliders.nodes[1].textContent = val('nodes');
      sliders.miners[1].textContent = val('miners');
      sliders.diff[1].textContent = val('diff') + ' s';
      sliders.txrate[1].textContent = val('txrate').toFixed(1);
      sliders.blocksize[1].textContent = val('blocksize');
      var l = val('latency');
      sliders.latency[1].textContent = (l <= 4 ? 'fast' : l <= 10 ? 'medium' : 'slow') + ' (' + hopMs() + ' ms/hop)';
    }

    var net = null;
    var sim = null;

    function build() {
      var N = val('nodes');
      var M = Math.min(val('miners'), N);
      var margin = 26;
      var nodes = [];
      var minDist = Math.sqrt((st.w * st.h) / N) * 0.62;
      var guard = 0;
      while (nodes.length < N && guard++ < 4000) {
        var x = margin + Math.random() * (st.w - margin * 2);
        var y = margin + Math.random() * (st.h - margin * 2);
        var okPos = nodes.every(function (n) {
          var dx = n.x - x, dy = n.y - y;
          return dx * dx + dy * dy > minDist * minDist;
        });
        if (okPos) { nodes.push({ x: x, y: y, miner: false }); }
      }
      /* links: nearest 2, then stitch components together */
      var links = [];
      var key = function (a, b) { return Math.min(a, b) + '-' + Math.max(a, b); };
      var have = {};
      nodes.forEach(function (n, ai) {
        nodes.map(function (m, bi) {
          var dx = n.x - m.x, dy = n.y - m.y;
          return { d: dx * dx + dy * dy, i: bi };
        }).sort(function (a, b) { return a.d - b.d; }).slice(1, 3).forEach(function (e) {
          if (!have[key(ai, e.i)]) { have[key(ai, e.i)] = 1; links.push([ai, e.i]); }
        });
      });
      var parent = nodes.map(function (n, i) { return i; });
      function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
      links.forEach(function (l) { parent[find(l[0])] = find(l[1]); });
      var comps = {};
      nodes.forEach(function (n, i) { comps[find(i)] = 1; });
      while (Object.keys(comps).length > 1) {
        var best = null;
        for (var a2 = 0; a2 < N; a2++) {
          for (var b2 = a2 + 1; b2 < N; b2++) {
            if (find(a2) === find(b2)) { continue; }
            var dx2 = nodes[a2].x - nodes[b2].x, dy2 = nodes[a2].y - nodes[b2].y;
            var dd = dx2 * dx2 + dy2 * dy2;
            if (!best || dd < best.d) { best = { d: dd, a: a2, b: b2 }; }
          }
        }
        links.push([best.a, best.b]);
        parent[find(best.a)] = find(best.b);
        comps = {};
        nodes.forEach(function (n, i) { comps[find(i)] = 1; });
      }
      var adj = nodes.map(function () { return []; });
      links.forEach(function (l) { adj[l[0]].push(l[1]); adj[l[1]].push(l[0]); });
      /* miners spread across the field */
      var order = nodes.map(function (n, i) { return i; }).sort(function (a, b) { return nodes[a].x - nodes[b].x; });
      for (var mi = 0; mi < M; mi++) {
        nodes[order[Math.floor((mi + 0.5) * N / M)]].miner = true;
      }
      net = { nodes: nodes, links: links, adj: adj };
      resetSim();
    }

    function bfsFrom(s) {
      var d = net.nodes.map(function () { return -1; });
      d[s] = 0;
      var q = [s];
      while (q.length) {
        var n = q.shift();
        net.adj[n].forEach(function (m) { if (d[m] === -1) { d[m] = d[n] + 1; q.push(m); } });
      }
      return d;
    }

    function resetSim() {
      sim = {
        running: false, height: 0, confirmed: 0, backlog: 0, stale: 0,
        lastBlockAt: null, avgInterval: null,
        txWaves: [], blocks: [], events: [],
        heads: {}   /* blockId -> block, at the two most recent heights */
      };
      outs.verdict.textContent = 'Press run. Teal pulses are transactions gossiping; orange rings are blocks propagating; a violet ring means a competing block — a fork.';
      updateStats();
      drawFrame(performance.now());
    }

    var blockSeq = 0;
    function spawnBlock(now) {
      var miners = [];
      net.nodes.forEach(function (n, i) { if (n.miner) { miners.push(i); } });
      if (!miners.length) { return; }
      var m = miners[(Math.random() * miners.length) | 0];
      /* the miner extends the highest block IT has heard about */
      var parentBlock = null;
      sim.blocks.forEach(function (b) {
        if (now >= b.born + b.dist[m] * hopMs()) {
          if (!parentBlock || b.height > parentBlock.height) { parentBlock = b; }
        }
      });
      var h = (parentBlock ? parentBlock.height : 0) + 1;
      var rival = sim.blocks.filter(function (b) { return b.height === h && b.alive; })[0] || null;
      var included = Math.min(val('blocksize'), sim.backlog);
      sim.backlog -= included;
      sim.confirmed += included;
      var blk = {
        id: ++blockSeq, height: h, miner: m, born: now, dist: bfsFrom(m),
        included: included, alive: true, color: rival ? 'violet' : 'orange',
        parent: parentBlock ? parentBlock.id : 0
      };
      sim.blocks.push(blk);
      if (sim.blocks.length > 6) { sim.blocks.shift(); }

      if (rival) {
        sim.events.push('FORK at height ' + h + ': two blocks are racing — nodes follow whichever arrives first.');
      } else {
        if (h > sim.height) {
          if (sim.lastBlockAt !== null) {
            var iv = (now - sim.lastBlockAt) / 1000;
            sim.avgInterval = sim.avgInterval === null ? iv : sim.avgInterval * 0.75 + iv * 0.25;
          }
          sim.lastBlockAt = now;
          sim.height = h;
        }
        /* did this block just resolve a fork one height below? */
        var losers = sim.blocks.filter(function (b) { return b.height === h - 1 && b.alive && b.id !== blk.parent; });
        losers.forEach(function (b) {
          b.alive = false;
          sim.stale++;
          sim.confirmed -= b.included;
          sim.backlog += b.included;
          sim.events.push('Fork resolved at height ' + (h - 1) + ' — the losing block is stale; its ' + b.included + ' transactions went back to the queue.');
        });
        if (!losers.length && blk.included > 0) {
          sim.events.push('Height ' + h + ': miner found a block with ' + blk.included + ' tx.');
        }
      }
    }

    function updateStats() {
      outs.height.textContent = fmtInt(sim.height);
      outs.avg.textContent = sim.avgInterval === null ? '—' : sim.avgInterval.toFixed(1) + ' s';
      outs.confirmed.textContent = fmtInt(Math.max(0, sim.confirmed));
      outs.mempool.textContent = fmtInt(Math.round(sim.backlog));
      outs.stale.textContent = fmtInt(sim.stale);
    }

    var lastStatAt = 0;
    function tick(now, dt) {
      /* transactions */
      var rate = val('txrate');
      if (Math.random() < (rate * dt) / 1000) {
        var origin = (Math.random() * net.nodes.length) | 0;
        sim.backlog += 1;
        if (sim.txWaves.length < 30) {
          sim.txWaves.push({ x: net.nodes[origin].x, y: net.nodes[origin].y, t0: now });
        }
      }
      /* blocks */
      if (Math.random() < dt / (val('diff') * 1000)) { spawnBlock(now); }
      /* prune old visuals */
      sim.txWaves = sim.txWaves.filter(function (w) { return now - w.t0 < 1600; });
      if (now - lastStatAt > 200) {
        lastStatAt = now;
        updateStats();
        if (sim.events.length) {
          outs.verdict.textContent = sim.events[sim.events.length - 1];
          if (sim.events.length > 4) { sim.events = sim.events.slice(-4); }
        }
      }
    }

    function drawFrame(now) {
      ctx.clearRect(0, 0, st.w, st.h);
      if (!net) { return; }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(94,130,172,0.14)';
      net.links.forEach(function (l) {
        var a = net.nodes[l[0]], b = net.nodes[l[1]];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });

      /* tx pulses */
      sim.txWaves.forEach(function (w) {
        var age = (now - w.t0) / 1600;
        ctx.strokeStyle = 'rgba(45,212,191,' + (0.4 * (1 - age)) + ')';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(w.x, w.y, 6 + age * 64, 0, Math.PI * 2);
        ctx.stroke();
      });

      /* block waves: ring from origin + node glow at arrival */
      sim.blocks.forEach(function (b) {
        var age = now - b.born;
        var maxHop = Math.max.apply(null, b.dist);
        var span = (maxHop + 1) * hopMs();
        if (age < span + 600) {
          var col = b.alive ? (b.color === 'violet' ? '139,92,246' : '247,147,26') : '100,116,139';
          var origin = net.nodes[b.miner];
          var f = clamp(age / span, 0, 1);
          ctx.strokeStyle = 'rgba(' + col + ',' + (0.5 * (1 - f)) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(origin.x, origin.y, 8 + f * Math.max(st.w, st.h) * 0.55, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      net.nodes.forEach(function (n, i) {
        var glow = 0, col = null;
        sim.blocks.forEach(function (b) {
          var at = b.born + b.dist[i] * hopMs();
          var dt2 = now - at;
          if (dt2 > 0 && dt2 < 800) {
            var g = 1 - dt2 / 800;
            if (g > glow) { glow = g; col = b.alive ? b.color : 'gone'; }
          }
        });
        var fill = 'rgba(148,163,184,0.8)';
        if (glow > 0) {
          fill = col === 'violet' ? 'rgba(139,92,246,' + (0.5 + glow * 0.5) + ')'
            : col === 'gone' ? 'rgba(100,116,139,0.8)'
              : 'rgba(247,147,26,' + (0.5 + glow * 0.5) + ')';
        }
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.miner ? 5.5 : 3.5 + glow, 0, Math.PI * 2);
        ctx.fill();
        if (n.miner) {
          ctx.strokeStyle = 'rgba(247,147,26,0.8)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    var loop = makeLoop(function (t, dt) {
      if (sim.running) { tick(t, dt); }
      drawFrame(t);
    });

    Object.keys(sliders).forEach(function (k) {
      sliders[k][0].addEventListener('input', function () {
        labelOutputs();
        if (k === 'nodes' || k === 'miners') { build(); }
      });
    });

    runBtn.addEventListener('click', function () {
      sim.running = !sim.running;
      runBtn.textContent = sim.running ? 'Pause' : 'Resume';
      if (sim.running) { loop.start(); }
    });
    resetBtn.addEventListener('click', function () {
      build();
      runBtn.textContent = 'Run simulation';
    });

    labelOutputs();
    build();
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     4. boot
     ========================================================================== */

  /* Each widget boots in isolation: one failure (e.g. a canvas context that
     is transiently unavailable while the page loads hidden/prerendered) must
     not take the other widgets down. Failed inits are retried once when the
     page becomes visible or the user first interacts. */
  function boot() {
    var inits = [
      initReveal, initRail, initHero, initEras, initHistory, initCopyDemo,
      initLedgers, initHashbox, initChainDemo, initTxFlow, initKeys, initSign,
      initXray, initMultisig, initMiner, initRetarget, initConsensus,
      initSupply, initAttack, initLightning, initMyths, initPlayground
    ];
    var failed = [];

    function tryInit(fn) {
      try { fn(); } catch (err) {
        failed.push(fn);
        if (window.console && console.error) { console.error('bitcoin.js: ' + (fn.name || 'init') + ' failed', err); }
      }
    }

    inits.forEach(tryInit);

    if (failed.length) {
      var retry = function () {
        document.removeEventListener('visibilitychange', retry);
        window.removeEventListener('pointerdown', retry, true);
        window.removeEventListener('keydown', retry, true);
        var again = failed;
        failed = [];
        again.forEach(tryInit);
      };
      document.addEventListener('visibilitychange', retry);
      window.addEventListener('pointerdown', retry, true);
      window.addEventListener('keydown', retry, true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
