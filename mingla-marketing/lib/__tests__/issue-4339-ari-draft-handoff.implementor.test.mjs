#!/usr/bin/env node
// #4339 §5 phase 4b — implementor happy path for the "Prompt your website into
// existence" → Ari draft hand-off on the marketing side.
//
// Proves: Generate posts the description in a POST body (never a URL) to the
// site-prompt-draft endpoint; only a well-formed draft id is accepted back;
// every failure resolves to "no draft"; "Continue on Mingla Web" goes to host
// web's sign-in resuming at /ari?draft=<id> and carries ONLY the id; without a
// draft it opens host web's front door; the demo wires both and the link is the
// same on every device (no phone OneLink).

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

// The CommonJS loader the #4137 seam test uses (relative imports only).
const cache = new Map()
function load(relative) {
  const file = relative.endsWith('.ts') ? relative : `${relative}.ts`
  if (cache.has(file)) return cache.get(file).exports
  assert(fs.existsSync(path.join(ROOT, file)), `#4339: missing module ${file}`)
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  cache.set(file, module)
  const dir = path.posix.dirname(file)
  const localRequire = (spec) => {
    assert(spec.startsWith('./'), `#4339: unexpected import ${spec} in ${file}`)
    return load(path.posix.join(dir, spec.slice(2)))
  }
  Function('module', 'exports', 'require', 'process', compiled)(module, module.exports, localRequire, process)
  return module.exports
}

const draft = load('lib/site-prompt-draft')
const { siteAttribution } = load('lib/links-src')
const ATTRIBUTION = siteAttribution('business_hero')
const DESCRIPTION = 'A rooftop café in Lekki with live acoustic sets on Fridays & the best plantain in town.'
const DRAFT_ID = '6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4'
const TRANSPORT = { functionsBase: 'https://example.supabase.co/functions/v1', anonKey: 'anon-test-key' }

function fakeFetch(answer) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    if (answer instanceof Error) throw answer
    return answer
  }
  return { calls, impl }
}
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('#4339 Generate posts the description in the body and gets the id back', async () => {
  const fetch = fakeFetch(jsonResponse(201, { draft_id: DRAFT_ID }))
  const id = await draft.postSitePromptDraft(`  ${DESCRIPTION}  `, { ...TRANSPORT, fetchImpl: fetch.impl })
  assert.equal(id, DRAFT_ID)
  assert.equal(fetch.calls.length, 1)
  const { url, init } = fetch.calls[0]
  assert.equal(url, 'https://example.supabase.co/functions/v1/site-prompt-draft')
  assert.equal(init.method, 'POST')
  assert.deepEqual(JSON.parse(init.body), { description: DESCRIPTION })
  assert.equal(init.headers.apikey, 'anon-test-key')
  // The description never travels in the URL.
  assert(!url.includes('rooftop') && !url.includes('?'), url)
})

test('#4339 every failure resolves to no draft', async () => {
  const answers = [
    jsonResponse(429, { error: 'rate_limited' }),
    jsonResponse(503, { error: 'unavailable' }),
    jsonResponse(201, { draft_id: 'not-an-id' }),
    jsonResponse(201, {}),
    new Response('<html>', { status: 200 }),
    new Error('offline'),
  ]
  for (const answer of answers) {
    const fetch = fakeFetch(answer)
    assert.equal(await draft.postSitePromptDraft(DESCRIPTION, { ...TRANSPORT, fetchImpl: fetch.impl }), null)
  }
  // Not configured: nothing is sent at all.
  const fetch = fakeFetch(jsonResponse(201, { draft_id: DRAFT_ID }))
  assert.equal(await draft.postSitePromptDraft(DESCRIPTION, { functionsBase: null, anonKey: 'k', fetchImpl: fetch.impl }), null)
  assert.equal(await draft.postSitePromptDraft(DESCRIPTION, { functionsBase: 'https://x', anonKey: null, fetchImpl: fetch.impl }), null)
  assert.equal(fetch.calls.length, 0)
})

test('#4339 a slow endpoint times out to no draft', async () => {
  const impl = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  assert.equal(await draft.postSitePromptDraft(DESCRIPTION, { ...TRANSPORT, fetchImpl: impl, timeoutMs: 20 }), null)
})

test('#4339 Continue carries only the draft id, to host web sign-in resuming at Ari', () => {
  const href = draft.ariDraftContinueHref(DRAFT_ID, ATTRIBUTION)
  assert.equal(href, `https://host.usemingla.com/auth?next=${encodeURIComponent(`/ari?draft=${DRAFT_ID}`)}`)
  const url = new URL(href)
  assert.equal(url.origin, 'https://host.usemingla.com')
  assert.equal(url.pathname, '/auth')
  assert.deepEqual([...url.searchParams.keys()], ['next'])
  const next = new URL(url.searchParams.get('next'), 'https://host.usemingla.com')
  assert.equal(next.pathname, '/ari')
  assert.deepEqual([...next.searchParams.entries()], [['draft', DRAFT_ID]])
  for (const word of ['rooftop', 'Lekki', 'plantain']) assert(!href.includes(word), href)
})

test('#4339 without a draft Continue opens host web front door', () => {
  assert.equal(draft.ariDraftContinueHref(null, ATTRIBUTION), 'https://host.usemingla.com')
  assert.equal(draft.ariDraftContinueHref('../../evil', ATTRIBUTION), 'https://host.usemingla.com')
})

test('#4339 the demo wires the post and the id-only link, same on every device', () => {
  const demo = read('components/site/site-prompt-demo.tsx')
  assert.match(demo, /postSitePromptDraft\(text, draftTransportFromEnv\(\)\)/)
  assert.match(demo, /<AriSheet href=\{ariDraftContinueHref\(draftId, ATTRIBUTION\)\}/)
  assert.match(demo, /href=\{href\} target="_blank"/)
  // No phone OneLink, store or device branching on this sheet: web on phones too.
  assert.doesNotMatch(demo, /phoneHref|appHandoffHrefs|data-cta-phone-href|resolveAppHandoff/)
  // The description is never put in a URL.
  assert.doesNotMatch(demo, /encodeURIComponent\(text\)|\?description=|[?&]text=/)
})
