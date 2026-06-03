#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1058 banner ↔ allowlist PARITY check (regression guard for the
 * "Notify the group" raw-token leak).
 *
 * THE BUG (regression introduced by the ORCH-1058 copy change):
 *   `buildCollabDeadEndBannerContent` (collabDeadEndBannerService.ts) emits a
 *   chat string containing an [[open-prefs:…]] token. The chat only renders it
 *   as a PARSED system banner (token → tappable button) when the string matches
 *   one of the COLLAB_SYSTEM_* allowlist regexes in messagingService.ts
 *   (`isCollabDeadEndBannerMessage` → `isSystem` → MessageBubble system branch).
 *   ORCH-1058 changed the banner COPY without updating that allowlist, so the
 *   new strings failed the regex, rendered as plain text, and leaked the raw
 *   `[[open-prefs:location:<uuid>]]` token to users.
 *
 * THIS TEST makes copy↔allowlist drift impossible to ship silently:
 *   1. Runs the REAL `buildCollabDeadEndBannerContent` (transpiled from source,
 *      imports stubbed) across EVERY reason + all 3 intersection cases with a
 *      sample uuid, capturing every string it can emit.
 *   2. Asserts each emitted string MATCHES a real messagingService allowlist
 *      regex (extracted from source) → would render as a parsed system banner.
 *   3. Asserts the REAL MessageBubble token parser strips the token from the
 *      visible text (no `[[` survives) and produces a tappable label.
 *
 * fails-on-revert: revert the messagingService allowlist edit and the 3 new
 * intersection strings (waiting / different_cities / same_city_tight) stop
 * matching → step 2 fails.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---------------------------------------------------------------------------
// Transpile + evaluate a TS module, intercepting its imports with stubs so a
// RN-coupled file can run headless. Returns the module exports.
// ---------------------------------------------------------------------------
function evalTsModule(tsSource, filename, stubs = {}) {
  const js = ts.transpileModule(tsSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const m = new Module(filename);
  m.filename = filename;
  // Custom require that returns stubs for declared specifiers, else throws.
  m.require = (spec) => {
    if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
    throw new Error(`Unexpected import "${spec}" in ${filename} — add a stub.`);
  };
  m._compile(js, filename);
  return m.exports;
}

// ---------------------------------------------------------------------------
// 1. Load the REAL collabDeadEndBannerService with its imports stubbed.
//    `buildCollabDeadEndBannerContent` only uses in-module helpers +
//    resolveParticipantLocationLabel; the rest are import-time only.
// ---------------------------------------------------------------------------
const labelSource = read('src/utils/formatLocationLabel.ts');
const labelMod = evalTsModule(labelSource, 'formatLocationLabel.ts');

const serviceSource = read('src/services/collabDeadEndBannerService.ts');
const serviceMod = evalTsModule(serviceSource, 'collabDeadEndBannerService.ts', {
  '@react-native-async-storage/async-storage': { default: {} },
  './deckService': {},
  './messagingService': { messagingService: {} },
  './supabase': { supabase: {} },
  '../components/ui/Toast': { toastManager: {} },
  '../utils/formatLocationLabel': labelMod,
});
const { buildCollabDeadEndBannerContent } = serviceMod;
assert.equal(
  typeof buildCollabDeadEndBannerContent,
  'function',
  'buildCollabDeadEndBannerContent must be importable',
);

// ---------------------------------------------------------------------------
// 2. Load the REAL messagingService allowlist predicate. The allowlist block
//    (COLLAB_TOKEN_USER_ID + COLLAB_DEAD_END_BANNER_PATTERNS +
//    isCollabDeadEndBannerMessage) is import-free, so we extract that exact
//    block from source and evaluate it as a standalone module — running the
//    SAME predicate the app uses (`isSystem = … || isCollabDeadEndBannerMessage`).
//    No string eval(); the regexes are compiled by the real source.
// ---------------------------------------------------------------------------
const messagingSource = read('src/services/messagingService.ts');
const allowlistBlockMatch = messagingSource.match(
  /const COLLAB_TOKEN_USER_ID = [\s\S]*?export function isCollabDeadEndBannerMessage\([\s\S]*?\n\}/,
);
assert.ok(allowlistBlockMatch, 'messagingService allowlist block must be extractable');
const allowlistMod = evalTsModule(allowlistBlockMatch[0], 'collabAllowlist.ts');
const { isCollabDeadEndBannerMessage } = allowlistMod;
assert.equal(typeof isCollabDeadEndBannerMessage, 'function', 'isCollabDeadEndBannerMessage must export');
const matchesAllowlist = (s) => isCollabDeadEndBannerMessage(s);

// ---------------------------------------------------------------------------
// 3. Load the REAL MessageBubble token parser + the valid-section set + the
//    split regex, by extracting their import-free declarations from source and
//    evaluating them as one standalone module. Proves the token is stripped
//    from visible text and yields a tappable label.
// ---------------------------------------------------------------------------
const bubbleSource = read('src/components/chat/MessageBubble.tsx');
const tokenRegexDecl = bubbleSource.match(/const SYSTEM_TOKEN_REGEX = \/.*\/[gimsuy]*;/);
assert.ok(tokenRegexDecl, 'SYSTEM_TOKEN_REGEX must be defined in MessageBubble');
const validSectionsDecl = bubbleSource.match(/const VALID_PREF_SECTIONS = new Set\(\[[^\]]*\]\);/);
assert.ok(validSectionsDecl, 'VALID_PREF_SECTIONS must be defined');
const parseFnDecl = bubbleSource.match(/export function parseCollabSystemToken\([\s\S]*?\n\}\n/);
assert.ok(parseFnDecl, 'parseCollabSystemToken must be extractable');
const bubbleMod = evalTsModule(
  `type CollabSystemPrefSection = 'travel' | 'location' | 'categories' | 'dates';
type CollabSystemToken = any;
${validSectionsDecl[0]}
${tokenRegexDecl[0]}
${parseFnDecl[0]}
export { parseCollabSystemToken, VALID_PREF_SECTIONS, SYSTEM_TOKEN_REGEX };`,
  'messageBubbleTokens.ts',
);
const { parseCollabSystemToken, VALID_PREF_SECTIONS, SYSTEM_TOKEN_REGEX } = bubbleMod;

// Simulate MessageBubble.renderSystemBannerContent's text extraction: split on
// the token regex, parse each token segment; tokens become labels (stripped),
// non-token text stays. Returns the VISIBLE text (what the user reads).
function renderVisibleText(content) {
  const parts = content.split(SYSTEM_TOKEN_REGEX).filter((p) => p.length > 0);
  return parts
    .map((part) => {
      const token = parseCollabSystemToken(part);
      if (!token) return part; // plain text segment
      // token → tappable button label, NOT the raw token text
      if (token.type === 'open-dismissed') return 'Review dismissed';
      if (token.type === 'compose-mention') return 'Message them';
      const section = token.section === 'categories' ? 'categories' : `${token.section} picks`;
      return token.type === 'open-prefs-self' ? `Open your ${section}` : `Open ${section}`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// 4. Drive buildCollabDeadEndBannerContent across EVERY emittable branch.
// ---------------------------------------------------------------------------
const UUID = '6b8f0a2c-1d3e-4f5a-9b0c-7d8e9f0a1b2c'; // sample participant uuid (hyphens)
const OTHER = 'a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d';

const mkParticipant = (id, name, opts = {}) => ({
  user_id: id,
  has_accepted: opts.hasAccepted ?? true,
  profiles: { first_name: name },
});

// Each entry: { label, input } → produces one banner string.
const SCENARIOS = [
  {
    label: 'intersection_empty · single outlier (3+, one too far)',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'intersection_empty',
      participants: [mkParticipant(UUID, 'You'), mkParticipant(OTHER, 'Ada'), mkParticipant('c3333333-3333-4333-8333-333333333333', 'Ben')],
      participantPrefs: {
        // Ada + Ben near each other; You far away → single outlier = You.
        [UUID]: { custom_lat: 51.5, custom_lng: -0.12, travel_constraint_value: 30, travel_mode: 'walking' },
        [OTHER]: { custom_lat: 38.90, custom_lng: -77.03, travel_constraint_value: 30, travel_mode: 'walking' },
        'c3333333-3333-4333-8333-333333333333': { custom_lat: 38.91, custom_lng: -77.04, travel_constraint_value: 30, travel_mode: 'walking' },
      },
    },
    expectTokenSection: 'travel',
  },
  {
    label: 'intersection_empty · waiting (GPS fix not landed)',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'intersection_empty',
      participants: [mkParticipant(UUID, 'You'), mkParticipant(OTHER, 'Ada')],
      participantPrefs: {
        [UUID]: { custom_lat: 35.78, custom_lng: -78.64 },
        [OTHER]: {}, // no coords → pending → waiting (only 1 known center)
      },
    },
    expectTokenSection: 'location',
  },
  {
    label: 'intersection_empty · different_cities (DC↔Raleigh)',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'intersection_empty',
      participants: [mkParticipant(UUID, 'You'), mkParticipant(OTHER, 'Ada')],
      participantPrefs: {
        [UUID]: { custom_lat: 38.9072, custom_lng: -77.0369, custom_location: 'Washington, DC, USA' },
        [OTHER]: { custom_lat: 35.7796, custom_lng: -78.6382, custom_location: 'Raleigh, NC, USA' },
      },
    },
    expectTokenSection: 'location',
  },
  {
    label: 'intersection_empty · same_city_tight (one metro, ranges miss)',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'intersection_empty',
      participants: [mkParticipant(UUID, 'You'), mkParticipant(OTHER, 'Ada')],
      participantPrefs: {
        [UUID]: { custom_lat: 35.7796, custom_lng: -78.6382, custom_location: 'Raleigh, NC' },
        [OTHER]: { custom_lat: 35.8100, custom_lng: -78.6500, custom_location: 'Raleigh, NC' },
      },
    },
    expectTokenSection: 'travel',
  },
  {
    label: 'no_matching_candidates · GPS-gap',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'no_matching_candidates',
      participants: [mkParticipant(UUID, 'You'), mkParticipant(OTHER, 'Ada')],
      participantPrefs: { [UUID]: {}, [OTHER]: {} },
      payload: { pendingGpsUserIds: [OTHER], detail: 'no gps' },
    },
    expectTokenSection: 'location',
  },
  {
    label: 'no_matching_candidates · no categories',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'no_matching_candidates',
      participants: [mkParticipant(UUID, 'You', { hasAccepted: true })],
      participantPrefs: { [UUID]: { use_gps_location: true, custom_lat: 1, custom_lng: 2 } },
      payload: { pendingGpsUserIds: [], detail: '' },
    },
    expectTokenSection: 'categories', // self
  },
  {
    label: 'no_unswiped_candidates',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'no_unswiped_candidates',
      participants: [mkParticipant(UUID, 'You')],
      participantPrefs: { [UUID]: {} },
    },
    expectTokenSection: null, // open-dismissed
  },
  {
    label: 'quorum_not_met',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'quorum_not_met',
      participants: [mkParticipant(UUID, 'You', { hasAccepted: true }), mkParticipant(OTHER, 'Ada', { hasAccepted: false })],
      participantPrefs: { [UUID]: {}, [OTHER]: {} },
      payload: { acceptedCount: 1 },
    },
    expectTokenSection: null, // compose-mention
  },
  {
    label: 'all_pools_exhausted',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'all_pools_exhausted',
      participants: [mkParticipant(UUID, 'You')],
      participantPrefs: { [UUID]: {} },
    },
    expectTokenSection: null, // open-prefs:self:dates
  },
];

const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({ name, pass: true }); }
  catch (err) { checks.push({ name, pass: false, detail: err.message }); }
};

for (const sc of SCENARIOS) {
  const content = buildCollabDeadEndBannerContent(sc.input);

  // Sanity: every produced string contains at least one token.
  check(`[${sc.label}] produces a token`, () => {
    assert.ok(/\[\[[^\]]+\]\]/.test(content), `no token in: ${content}`);
  });

  // CORE PARITY: produced string must match the messagingService allowlist
  // (so isCollabDeadEndBannerMessage → isSystem → parsed banner).
  check(`[${sc.label}] matches messagingService allowlist`, () => {
    assert.ok(
      matchesAllowlist(content),
      `NOT allowlisted (would leak raw token as plain text):\n        ${JSON.stringify(content)}`,
    );
  });

  // TOKEN-STRIP: MessageBubble must remove the raw [[…]] from visible text.
  check(`[${sc.label}] MessageBubble strips the raw token`, () => {
    const visible = renderVisibleText(content);
    assert.ok(!visible.includes('[['), `raw token leaked in visible text:\n        ${visible}`);
    assert.ok(!visible.includes(']]'), `raw token close leaked in visible text:\n        ${visible}`);
  });

  // Token section (where applicable) must be in the parser's valid set.
  if (sc.expectTokenSection) {
    check(`[${sc.label}] token section "${sc.expectTokenSection}" is parser-valid`, () => {
      assert.ok(
        VALID_PREF_SECTIONS.has(sc.expectTokenSection),
        `${sc.expectTokenSection} not in VALID_PREF_SECTIONS`,
      );
      assert.ok(
        content.includes(`:${sc.expectTokenSection}:`) || content.includes(`:self:${sc.expectTokenSection}`),
        `expected ${sc.expectTokenSection} token in: ${content}`,
      );
    });
  }
}

// Explicit guard: the 3 NEW intersection strings carry the location/travel
// section the parser supports — the exact thing that regressed.
check('GUARD: location section is parser-valid (the regressed section)', () => {
  assert.ok(VALID_PREF_SECTIONS.has('location'), 'location must be a valid pref section');
});

// Explicit fails-on-revert anchor: the literal new copy lines must each be
// allowlisted (independent of branch routing).
const NEW_COPY = [
  `Waiting on Ada's location to land — the deck fills in automatically. [[open-prefs:location:${UUID}]]`,
  `You're in different cities — Washington, DC and Raleigh, NC. Pick one spot you'll all head to. [[open-prefs:location:${UUID}]]`,
  `So close — you're in the same area but your travel ranges don't touch. Bump travel time or distance? [[open-prefs:travel:${UUID}]]`,
];
for (const line of NEW_COPY) {
  check(`FAILS-ON-REVERT: new copy allowlisted → ${line.slice(0, 38)}…`, () => {
    assert.ok(matchesAllowlist(line), `new copy NOT allowlisted: ${line}`);
  });
}

// ---------------------------------------------------------------------------
let failed = 0;
for (const c of checks) {
  if (c.pass) console.log(`  PASS  ${c.name}`);
  else { failed += 1; console.error(`  FAIL  ${c.name}\n        ${c.detail}`); }
}
console.log(`\nORCH-1058 parity: ${checks.length - failed}/${checks.length} checks passed.`);
if (failed > 0) {
  console.error(`ORCH-1058 banner↔allowlist parity check FAILED (${failed} failing).`);
  process.exit(1);
}
console.log('ORCH-1058 banner↔allowlist parity check PASSED.');
