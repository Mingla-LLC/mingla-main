// #4339 round B (E) — implementor regression test for the anti-copy work:
// poweredByHeader off, test ids stripped, issue references stripped from the
// emitted JS, the Content-Security-Policy (script-src limited to our own
// scripts, GA4 and PostHog; frame-ancestors 'self' kept), and the built-output
// gate (.github/scripts/strict-grep/issue-4339-built-output-anti-copy.mjs).
//
// Built mode (ISSUE_4339_BUILT=1 after `npm run build`) runs the gate on
// .next and checks the live response headers from `next start`.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-round-b-anti-copy.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { MARKETING } from './issue-4339-round-b-load.mjs'

const REPO = path.resolve(MARKETING, '..')
const GATE = path.join(REPO, '.github/scripts/strict-grep/issue-4339-built-output-anti-copy.mjs')
const config = fs.readFileSync(path.join(MARKETING, 'next.config.ts'), 'utf8')
const BUILT = process.env.ISSUE_4339_BUILT === '1'

test('next.config: no x-powered-by, no test ids, issue refs stripped from emitted JS', () => {
  assert.match(config, /poweredByHeader: false,/)
  assert.match(config, /reactRemoveProperties: \{ properties: \['\^data-testid\$'\] \}/)
  assert.match(config, /webpackConfig\.plugins = \[\.\.\.\(webpackConfig\.plugins \?\? \[\]\), new StripIssueRefsPlugin\(\)\]/)
  assert.match(config, /stage: Compilation\.PROCESS_ASSETS_STAGE_SUMMARIZE/, 'runs after minification')
  const literal = /const ISSUE_REF_IN_STRING = (\/.+\/g)\n/.exec(config)?.[1]
  assert.ok(literal)
  const re = eval(literal)
  const strip = (s) => s.replace(re, '$1')
  assert.equal(strip('throw Error(`#4339 going-out: city hub "x"`)'), 'throw Error(`going-out: city hub "x"`)')
  assert.equal(strip('Error("#4137: ".concat(a))'), 'Error("".concat(a))')
  assert.equal(strip('"[#4318 links] could not"'), '"[links] could not"')
  for (const keep of ['"4 Fenton Main St #120, Cary"', 'color:"#111"', '"#eb7825"', 'a="#4339"']) assert.equal(strip(keep), keep, keep)
})

test('Content-Security-Policy: enforced script-src allowlist, frame-ancestors kept, full policy report-only', () => {
  assert.match(config, /\{ key: 'Content-Security-Policy', value: csp\.enforced \}/)
  assert.match(config, /\{ key: 'Content-Security-Policy-Report-Only', value: csp\.reportOnly \}/)
  const scriptSrc = /const CSP_SCRIPT_SRC = \[([\s\S]*?)\]/.exec(config)[1].match(/'[^']+'|"[^"]+"/g).map((s) => s.slice(1, -1))
  assert.deepEqual(scriptSrc, ["'self'", "'unsafe-inline'", 'https://www.googletagmanager.com', 'https://*.googletagmanager.com', 'https://us-assets.i.posthog.com'])
  for (const directive of ["\"frame-ancestors 'self'\"", "\"object-src 'none'\"", "\"base-uri 'self'\"", "\"form-action 'self'\""]) assert.ok(config.includes(directive), directive)
  assert.match(config, /connect-src 'self' \$\{supabaseOrigins\(\)\.join\(' '\)\} https:\/\/us\.i\.posthog\.com/)
  assert.match(config, /"frame-src 'self' https:\/\/www\.youtube-nocookie\.com https:\/\/player\.vimeo\.com"/)
  assert.match(config, /\{ key: 'X-Frame-Options', value: 'SAMEORIGIN' \}/)
})

test('the built-output gate: self-test, wiring, and registered in the strict-grep registry', () => {
  for (const args of [['--self-test'], []]) {
    const run = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' })
    assert.equal(run.status, 0, `${args.join(' ') || 'plain'}: ${run.stderr}`)
  }
  const descriptor = JSON.parse(fs.readFileSync(`${GATE}.gate.json`, 'utf8'))
  assert.equal(descriptor.gate.enforcement, 'batch:A')
  assert.deepEqual(descriptor.gate.modes, ['self-test', 'plain'])
  const pkg = JSON.parse(fs.readFileSync(path.join(MARKETING, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.postbuild, /&& node \.\.\/\.github\/scripts\/strict-grep\/issue-4339-built-output-anti-copy\.mjs --built$/)
})

test('the gate catches what it must on a fake build', async () => {
  const { scanText } = await import(pathToFileURL(GATE).href)
  const rules = (s) => scanText(s).map((h) => h.rule)
  assert.deepEqual(rules('<p>#4339 is live</p>'), ['ISSUE_REF'])
  assert.deepEqual(rules('<div data-testid="x"></div>'), ['TEST_ID'])
  assert.deepEqual(rules('<!-- picked by Seth -->'), ['DEV_COMMENT'])
  assert.deepEqual(rules('fetch("https://mingla-git-x.vercel.app")'), ['INTERNAL_HOST'])
  assert.deepEqual(rules('// FIXME later'), ['TODO'])
  assert.deepEqual(rules('<!--$--><p>Plan it.</p><!--/$-->'), [])
})

async function freePort() {
  const server = net.createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  await new Promise((r) => server.close(r))
  return port
}

test('built: the gate passes on .next and the live headers', { skip: !BUILT && 'set ISSUE_4339_BUILT=1 after npm run build' }, async () => {
  const run = spawnSync(process.execPath, [GATE, '--built'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr || run.stdout)
  const port = await freePort()
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: MARKETING, stdio: 'ignore' })
  try {
    let res
    for (let i = 0; i < 100; i += 1) {
      try {
        res = await fetch(`http://127.0.0.1:${port}/host/events`)
        if (res.ok) break
      } catch {}
      await new Promise((r) => setTimeout(r, 200))
    }
    assert.ok(res?.ok, 'next start answered')
    assert.equal(res.headers.get('x-powered-by'), null)
    const csp = res.headers.get('content-security-policy') ?? ''
    assert.match(csp, /frame-ancestors 'self'/)
    assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/www\.googletagmanager\.com/)
    assert.match(res.headers.get('content-security-policy-report-only') ?? '', /connect-src 'self'/)
    const html = await res.text()
    assert.doesNotMatch(html, /data-testid/)
  } finally {
    server.kill()
  }
})
