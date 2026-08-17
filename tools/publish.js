#!/usr/bin/env node
/* tools/publish.js — link-check, commit, push, and confirm the change is live.

   Pushing to main IS the production deploy of a public site, so this always
   shows you the diff and asks before pushing. Nothing is pushed on a bare run.

   Usage:  node tools/publish.js "reworded the GPU hero"
           node tools/publish.js --check "msg"    stop after the link check   */
'use strict';

const { execFileSync, execSync } = require('child_process');
const readline = require('readline');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE = 'https://michael-buttitta.github.io';

const args = process.argv.slice(2);
const checkOnly = args[0] === '--check' && args.shift();
const message = args.join(' ').trim();

if (!message) {
  console.error('usage: node tools/publish.js "commit message"');
  process.exit(2);
}

function git(cmd) {
  return execSync('git ' + cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a.trim().toLowerCase()); }));
}

(async function main() {
  /* 1. Link check — the local stand-in for the two html-proofer failures that
        block the GitHub Actions deploy. Turns a 4-minute failed build into 50ms.
        One pre-existing WARN about /consulting/ is expected and is not a failure. */
  console.log('\n[1/5] link check');
  try {
    const out = execFileSync('node', ['_audit/linkcheck.js'], { cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(out.split('\n').slice(-12).join('\n') + '\n');
  } catch (e) {
    process.stdout.write((e.stdout || '') + (e.stderr || ''));
    console.error('\n  link check FAILED — this would fail the deploy. Nothing was committed.');
    process.exit(1);
  }

  const status = git('status --porcelain');
  if (!status.trim()) { console.log('\nnothing to publish — working tree is clean.'); return; }

  if (checkOnly) { console.log('\n--check given, stopping before commit.'); return; }

  /* 2. Show exactly what would go out. */
  console.log('\n[2/5] changes');
  git('add -A');
  process.stdout.write(git('diff --cached --stat'));

  const branch = git('rev-parse --abbrev-ref HEAD').trim();

  /* 3. Confirm. main is the live public site. */
  console.log('\n[3/5] confirm');
  console.log('  branch:  ' + branch + (branch === 'main' ? '   (pushing this deploys the PUBLIC site)' : ''));
  console.log('  message: ' + message);
  const yes = await ask('\n  push and deploy? [y/N] ');
  if (yes !== 'y' && yes !== 'yes') {
    console.log('  aborted. Changes are staged but not committed.');
    return;
  }

  /* 4. Commit and push. */
  console.log('\n[4/5] pushing');
  execFileSync('git', ['commit', '-m', message], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['push', 'origin', branch], { cwd: ROOT, stdio: 'inherit' });

  /* 5. Confirm on the LIVE PAGE, never the GitHub API. The unauthenticated API
        allows 60 requests/hour per IP; a polling loop exhausts it, and once
        exhausted it returns a JSON error that greps to nothing — indistinguishable
        from "the run hasn't started", so you wait forever on a deploy that already
        finished. The live page has no rate limit. */
  const sha = git('rev-parse --short HEAD').trim();
  const files = git('show --stat --name-only --format= HEAD').trim().split('\n').filter(Boolean);
  const pages = files
    .filter(f => f.startsWith('_tabs/'))
    .map(f => '/' + path.basename(f).replace(/\.(html|md)$/, '') + '/');
  const probe = pages[0] || '/';

  console.log('\n[5/5] waiting for ' + LIVE + probe + ' to serve ' + sha);
  const started = Date.now();
  const deadline = started + 5 * 60 * 1000;
  let landed = false;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10000));
    let head = '';
    try {
      head = execFileSync('curl', ['-sSI', LIVE + probe + '?nocache=' + Date.now()], { encoding: 'utf8' });
    } catch (e) { continue; }
    const lm = /last-modified:\s*(.+)/i.exec(head);
    const age = lm ? (Date.now() - new Date(lm[1]).getTime()) / 1000 : Infinity;
    const secs = Math.round((Date.now() - started) / 1000);
    process.stdout.write('\r  ' + secs + 's elapsed — page last modified ' + Math.round(age) + 's ago   ');
    if (age < (Date.now() - started) / 1000 + 90) { landed = true; break; }
  }

  const secs = Math.round((Date.now() - started) / 1000);
  if (landed) {
    console.log('\n\n  deployed in ~' + secs + 's — ' + LIVE + probe);
    if (pages.length > 1) { console.log('  also changed: ' + pages.slice(1).join(' ')); }
  } else {
    console.log('\n\n  still not live after ' + secs + 's. The push succeeded; check the Actions tab.');
    console.log('  verify by hand once it builds:');
    console.log('    curl -sS "' + LIVE + probe + '?nocache=$RANDOM" | grep -c "some text you changed"');
  }
})();
