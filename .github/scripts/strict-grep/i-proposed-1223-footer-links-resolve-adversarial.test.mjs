#!/usr/bin/env node
/**
 * ORCH-1223 — ADVERSARIAL test for the footer-links-resolve gate
 * (i-proposed-1223-footer-links-resolve.mjs).
 *
 * Written by mingla-tester, intentionally on a DIFFERENT axis than the
 * implementor's `--self-test` fixtures. The implementor only exercised flat
 * dead-link re-adds against a HARD-CODED FAKE_ROUTES set. This test instead
 * drives the gate's REAL Next.js App Router walker (`buildRouteSet`) against a
 * synthetic on-disk app tree to attack the route-RESOLUTION logic itself:
 *
 *   1. route GROUP index  `(explorer)/page.tsx`            -> "/"        (accept)
 *   2. route-group-wrapped NESTED DYNAMIC `(blog)/blog/[slug]/page.tsx`
 *                                                          -> "/blog/[slug]" (accept exact dynamic href)
 *   3. TRAILING-SLASH normalization `/support/`            -> "/support" (accept)
 *   4. PRIVATE folder `_draft/secret/page.tsx`             -> NOT a route (reject href to it)
 *   5. a plainly fake href `/ghost`                        -> reject
 *
 * It runs the ACTUAL gate binary (copied verbatim, unmodified) as a subprocess
 * from a synthetic repo root, so it tests the shipped resolution code, not a
 * re-implementation. PASS = gate exit 0 on the all-real footer, exit 1 on each
 * footer that adds an unresolvable href.
 *
 * Run: node <thisfile>     (exits 0 on PASS, 1 on FAIL)
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_GATE = join(HERE, 'i-proposed-1223-footer-links-resolve.mjs');

const root = mkdtempSync(join(tmpdir(), 'orch1223-adv-'));
const MK = (p) => mkdirSync(join(root, p), { recursive: true });
const PAGE = (p) => { MK(p); writeFileSync(join(root, p, 'page.tsx'), 'export default function P(){return null}'); };
const W = (rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };

// --- synthetic marketing App Router tree (adversarial route shapes) ---------
PAGE('mingla-marketing/app/(explorer)');                 // group index -> "/"
PAGE('mingla-marketing/app/(blog)/blog/[slug]');         // group-wrapped nested dynamic -> "/blog/[slug]"
PAGE('mingla-marketing/app/organisers');                 // -> "/organisers"
PAGE('mingla-marketing/app/support');                    // -> "/support"
PAGE('mingla-marketing/app/_draft/secret');              // private folder -> MUST NOT be a route

W('mingla-marketing/lib/subdomain.ts', "export const ORGANISER_PATH = '/organisers'\n");

// Stage the real gate inside the synthetic repo root (verbatim copy).
mkdirSync(join(root, '.github/scripts/strict-grep'), { recursive: true });
const GATE = join(root, '.github/scripts/strict-grep/i-proposed-1223-footer-links-resolve.mjs');
copyFileSync(REAL_GATE, GATE);

const FOOTER = 'mingla-marketing/components/marketing/footer.tsx';
// Mirror the REAL footer's authoring style: literal hrefs live as object
// properties (`href: '/...'`), columns are rendered via `href={l.href}`
// (a variable the gate does not parse as a literal), and the cross-link may
// use the ORGANISER_PATH symbol. The gate keys off the `href:` colon form.
const footer = (hrefs) =>
  `import Link from 'next/link'\nimport { ORGANISER_PATH } from '@/lib/subdomain'\n` +
  `const cols = [\n` +
  hrefs.filter((h) => h !== 'ORGANISER_PATH')
    .map((h) => `  { href: '${h}', label: 'x' },`).join('\n') +
  `\n]\n` +
  (hrefs.includes('ORGANISER_PATH')
    ? `const crossLink = { href: ORGANISER_PATH, label: 'biz' }\n` : '') +
  `export function Footer(){ return (<footer>{cols.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}</footer>) }\n`;

const runGate = () => {
  try {
    execFileSync('node', [GATE], { cwd: root, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
};

const cases = [
  // name, hrefs, expectedExit (0 accept / 1 reject)
  ['GOOD: group index "/" + nested dynamic + trailing-slash + ORGANISER_PATH',
    ['/', '/blog/[slug]', '/support/', 'ORGANISER_PATH'], 0],
  ['REJECT: href into a PRIVATE _draft folder (not a real route)',
    ['/', '/_draft/secret'], 1],
  ['REJECT: wrong dynamic shape /blog/anything (literal, not the [slug] route)',
    ['/', '/blog/anything'], 1],
  ['REJECT: plainly fake /ghost',
    ['/', '/ghost'], 1],
  ['ACCEPT: organisers nested static route, exact',
    ['/organisers'], 0],
];

let failures = 0;
for (const [name, hrefs, expected] of cases) {
  W(FOOTER, footer(hrefs));
  const got = runGate();
  const ok = (expected === 0) ? got === 0 : got !== 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} [exit ${got}, want ${expected === 0 ? '0' : 'non-0'}] ${name}`);
  if (!ok) failures++;
}

rmSync(root, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\nORCH-1223 adversarial test FAILED: ${failures} case(s) wrong.`);
  process.exit(1);
}
console.log('\nORCH-1223 adversarial gate test passed (route-group index, nested dynamic, trailing-slash, private-folder, fake — all correctly classified).');
