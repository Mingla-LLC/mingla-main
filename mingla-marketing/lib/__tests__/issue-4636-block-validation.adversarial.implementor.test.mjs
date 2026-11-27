// #4636 build 1 (adversarial): what a hostile or careless block list does.
// Every bad block is rejected by the registry and skipped (and reported) by
// the renderer plan; the rest of the page still renders; nothing throws.
// Run from mingla-marketing/: node --test lib/__tests__/issue-4636-block-validation.adversarial.implementor.test.mjs
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { loader } from './issue-4452-ts-loader.mjs'

const L = loader('issue-4636-adversarial-')
after(L.cleanup)
const r = await L.load('site-blocks/registry')
const { planBlocks } = await L.load('site-blocks/render-plan')

const wide = { media: 'v:cozy' }
const good = () => ({ type: 'wideClip', version: 1, content: { ...wide } })
const errs = (block) => {
  const res = r.validateBlock(block)
  assert.equal(res.ok, false, `expected a rejection for ${JSON.stringify(block).slice(0, 120)}`)
  return res.errors.join(' | ')
}

test('unknown block types, newer versions and malformed blocks are rejected', () => {
  assert.match(errs({ type: 'carousel3d', version: 1, content: {} }), /unknown block "carousel3d"/)
  assert.match(errs({ ...good(), version: 2 }), /newer than this site knows/)
  assert.match(errs({ ...good(), version: 0 }), /whole number/)
  assert.match(errs({ ...good(), version: '1' }), /whole number/)
  assert.match(errs({ ...good(), content: 'v:cozy' }), /content: must be an object/)
  assert.match(errs({ ...good(), hidden: 'yes' }), /hidden/)
  assert.match(errs({ ...good(), layout: 'wide' }), /block\.layout: unknown/)
  for (const bad of [null, 7, 'wideClip', []]) assert.equal(r.validateBlock(bad).ok, false)
})

test('text: no HTML, length limits, italic markup only where allowed and balanced', () => {
  const answer = (question, answerText = 'A plain answer.') => ({ type: 'answer', version: 1, content: { question, answer: answerText } })
  assert.match(errs(answer('<script>alert(1)</script>')), /contains < or >/)
  assert.match(errs(answer('x'.repeat(121))), /longer than 120/)
  assert.match(errs(answer('What is *Mingla?*')), /italic markup is not allowed/)
  assert.match(errs(answer('   ')), /is empty/)
  assert.match(errs(answer(42)), /must be text/)
  const paras = (heading) => ({ type: 'paras', version: 1, content: { heading, paragraphs: ['One.'] } })
  assert.equal(r.validateBlock(paras('Good plans *hard to find.*')).ok, true)
  assert.match(errs(paras('Good plans *hard to find.')), /unbalanced/)
})

test('a colour the section has no working style for is refused (R3)', () => {
  assert.match(errs({ type: 'tiles', version: 1, colour: 'moss', content: { heading: 'Tiles', items: [tile(), tile()] } }), /"moss" is not available for tiles/)
  assert.match(errs({ type: 'steps', version: 1, colour: 'night', content: homeSteps() }), /not available for steps/)
  // Per variant: About's cards are cream only, the Ari cards night only.
  const aboutCards = { variant: 'about', items: [vcard(), vcard()] }
  assert.equal(r.validateBlock({ type: 'vcards', version: 1, colour: 'cream', content: aboutCards }).ok, true)
  assert.match(errs({ type: 'vcards', version: 1, colour: 'night', content: aboutCards }), /not available for vcards/)
  // sand and clay are brand fields with no section style yet: no block offers them.
  for (const b of r.BLOCKS) for (const c of ['sand', 'clay']) assert.ok(!Object.values(b.colours).flat().includes(c), `${b.key} offers ${c}`)
  assert.match(errs({ ...good(), colour: 'sand' }), /not available/)
  assert.match(errs({ ...good(), colour: 'hotpink' }), /not available/)
})

function tile(over = {}) {
  return { media: 'v:a-solo', title: 'Solo', line: 'Some of the best plans only need you.', action: { label: 'Solo', to: '/going-out' }, ...over }
}
function vcard(over = {}) {
  return { media: 'v:ab-host', title: 'For places *with soul.*', line: 'Get found.', action: { label: 'Host', to: '/host' }, ...over }
}
function homeSteps() {
  return { variant: 'home', heading: 'How', lead: 'Lead', items: [1, 2, 3].map((n) => ({ title: `Step ${n}`, body: 'Body' })) }
}

test('media: a missing or foreign reference is refused', () => {
  assert.match(errs({ type: 'wideClip', version: 1, content: {} }), /wideClip\.media: missing/)
  for (const media of ['https://evil.example/x.mp4', '/marketing/site/m/cozy.mp4', 'v:', 'v:../../etc', 'm:not-a-uuid', 'x:cozy']) {
    assert.match(errs({ type: 'wideClip', version: 1, content: { media } }), /not a media reference/, media)
  }
  assert.equal(r.validateBlock({ type: 'wideClip', version: 1, content: { media: 'm:0b9d6f1e-4c1a-4b8e-9c55-0f2d1a2b3c4d' } }).ok, true, 'a library id has the reserved m:<uuid> shape')
  assert.match(errs({ type: 'tiles', version: 1, content: { heading: 'Tiles', items: [tile(), tile({ media: undefined })] } }), /items\[1\]\.media: missing/)
})

test('actions: no script, protocol-relative, traversal or off-limits destinations', () => {
  const fine = (link) => ({ type: 'finePrint', version: 1, content: { before: 'Read the', link, after: 'first.' } })
  for (const to of ['javascript:alert(1)', '//evil.example', '/../admin', 'http://insecure.example', 'data:text/html,hi', 'app:evil']) {
    assert.match(errs(fine({ label: 'x', to })), /not an internal path|not allowed here/, to)
  }
  // A tile opens a page on this site only; the toolkit row may also open Host.
  assert.match(errs({ type: 'tiles', version: 1, content: { heading: 'T', items: [tile(), tile({ action: { to: 'app:host' } })] } }), /host destination is not allowed here/)
  const row = (action) => ({ title: 'Ari AI', line: 'One assistant.', action })
  assert.equal(r.validateBlock({ type: 'toolkit', version: 1, content: { heading: 'Run it', items: [row({ label: 'E', to: '/host/events' }), row({ to: 'app:host' })] } }).ok, true)
  assert.match(errs({ type: 'toolkit', version: 1, content: { heading: 'Run it', items: [row({ label: 'E', to: '/x' }), row({ to: 'app:explorer' })] } }), /explorer destination is not allowed/)
  // A link needs words; only an app hand-off may use its own device labels.
  assert.match(errs(fine({ to: '/creator-agreement' })), /label: needed/)
  assert.match(errs(fine({ label: 'x', to: '/a', track: 'DROP TABLE' })), /track: invalid/)
  assert.match(errs(fine({ label: 'x', to: '/a', onclick: 'x' })), /onclick: unknown/)
})

test('lists keep their item counts; unknown fields and enums are refused', () => {
  const marquee = (words) => ({ type: 'marquee', version: 1, content: { words } })
  assert.match(errs(marquee(['a', 'b'])), /at least 3/)
  assert.match(errs(marquee(Array.from({ length: 17 }, (_, i) => `w${i}`))), /at most 16/)
  assert.match(errs(marquee('a, b, c')), /must be a list/)
  assert.match(errs({ type: 'steps', version: 1, content: { ...homeSteps(), variant: 'carousel' } }), /not one of/)
  assert.match(errs({ type: 'toolCard', version: 1, content: { tool: 'Free Money Calculator', body: 'x', cta: 'Go', fields: [{ label: 'a', input: 'text', example: 'b' }] } }), /not one of/)
  assert.match(errs({ type: 'cityHero', version: 1, content: { city: 'Lagos; drop' } }), /not a city/)
})

test('the renderer plan skips and reports bad blocks, keeps the good ones, never throws', () => {
  const messages = []
  const report = (m) => messages.push(m)
  const p = planBlocks(
    [
      good(),
      { type: 'nope', version: 1, content: {} },
      { type: 'wideClip', version: 1, content: {} },
      { ...good(), hidden: true },
      { type: 'reelHero', version: 9, content: {} },
      good(),
    ],
    report,
  )
  assert.deepEqual(p.groups.flatMap((g) => g.items.map((i) => i.index)), [0, 5], 'only the valid, visible blocks render, in order')
  assert.equal(p.skipped, 3)
  assert.equal(messages.length, 3, messages.join('\n'))
  assert.match(messages.join('\n'), /block 1 skipped: block\.type: unknown block "nope"/)
  assert.match(messages.join('\n'), /block 2 skipped: .*media: missing/)
  assert.match(messages.join('\n'), /block 4 skipped: .*newer than this site knows/)
  // A block the site has no renderer for is skipped too.
  const none = planBlocks([good()], report, () => false)
  assert.equal(none.groups.length, 0)
  // Not a list at all: nothing renders, it is reported, nothing throws.
  messages.length = 0
  assert.equal(planBlocks({ blocks: [] }, report).groups.length, 0)
  assert.match(messages[0], /must be a list/)
})

test('per-page limits: one lit paragraph, one features block, at most 40 blocks', () => {
  const lit = { type: 'litAbout', version: 1, content: { intro: 'i', call: { label: 'Talk', to: '/schedule' }, insideLabel: 'See', duoA: 'a', duoB: 'b', big: 'Big *words.*' } }
  const messages = []
  const p = planBlocks([lit, lit], (m) => messages.push(m))
  assert.equal(p.groups.flatMap((g) => g.items).length, 1, 'the second lit block is skipped (LandingRoot drives the first only)')
  assert.match(messages.join('\n'), /litAbout at most 1 per page/)
  const many = Array.from({ length: 41 }, good)
  assert.equal(r.validatePage(many).ok, false)
  messages.length = 0
  assert.equal(planBlocks(many, (m) => messages.push(m)).groups.flatMap((g) => g.items).length, 40)
  assert.match(messages.join('\n'), /at most 40 blocks/)
})
