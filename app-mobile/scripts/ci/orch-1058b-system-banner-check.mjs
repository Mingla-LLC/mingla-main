#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1058B — intrinsic collab system-banner regression suite.
 *
 * THE BUG (proven in INVESTIGATION_ORCH-1058B): the "notify the group" dead-end
 * banner could render as a plain USER bubble with a raw `[[open-prefs:…]]` token
 * because system-ness depended on the RECEIVING build recognizing the exact
 * (changeable) prose via the allowlist. Across builds the copy/allowlist drifted
 * → raw token leaked. ORCH-1058B makes system-ness INTRINSIC (sender_id=NULL +
 * message_type='system') and draws chips + a tappable button from a structured
 * `card_payload`, never from prose. Old builds degrade to clean token-stripped
 * prose, never raw codes.
 *
 * This suite asserts the §10 contract:
 *   T-01  intrinsic recognition (isSystem true with the allowlist EMPTIED)
 *   T-02  token never leaks in payload.prose
 *   T-03  chips built from data (one chip per participant, "Name · Label")
 *   T-04  CROSS-BUILD DEGRADE — the new producer's token-stripped prose, fed to
 *         a deliberately-OLD allowlist snapshot + the REAL MessageBubble token
 *         parser, yields ZERO token buttons and ZERO `[[` text (the exact
 *         topology that produced the symptom)
 *   T-05  legacy prose row (with token, no payload) still parses into a button
 *   T-06  button-target matrix matches SPEC §3.2 for every reason
 *
 * fails-on-revert anchors:
 *   - T-01 fails if the enrich `message_type==='system'` clause is removed
 *     (it evaluates the REAL isSystem expression extracted from source with the
 *     allowlist forced empty).
 *   - T-02/T-04 fail if `stripCollabSystemTokens` stops stripping the token.
 *   - T-06 fails if `buildCollabDeadEndBannerAction` returns the wrong target.
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
  m.require = (spec) => {
    if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
    throw new Error(`Unexpected import "${spec}" in ${filename} — add a stub.`);
  };
  m._compile(js, filename);
  return m.exports;
}

// ---------------------------------------------------------------------------
// 1. Load the REAL collabDeadEndBannerService (RN-coupled imports stubbed).
//    buildCollabDeadEndBannerPayload / buildCollabDeadEndBannerAction /
//    stripCollabSystemTokens use only in-module helpers + the resolver.
//    The `../components/chat/MessageBubble` import is TYPE-ONLY (erased by tsc),
//    but transpileModule with isolatedModules-off keeps no runtime require for
//    a pure `import type`, so no stub is needed; we add one defensively.
// ---------------------------------------------------------------------------
const labelMod = evalTsModule(read('src/utils/formatLocationLabel.ts'), 'formatLocationLabel.ts');
const serviceMod = evalTsModule(read('src/services/collabDeadEndBannerService.ts'), 'collabDeadEndBannerService.ts', {
  '@react-native-async-storage/async-storage': { default: {} },
  './deckService': {},
  './supabase': { supabase: {} },
  '../components/ui/Toast': { toastManager: {} },
  '../utils/formatLocationLabel': labelMod,
  '../components/chat/MessageBubble': {},
});
const {
  buildCollabDeadEndBannerPayload,
  buildCollabDeadEndBannerAction,
  stripCollabSystemTokens,
  buildCollabDeadEndBannerContent,
} = serviceMod;
assert.equal(typeof buildCollabDeadEndBannerPayload, 'function', 'buildCollabDeadEndBannerPayload must export');
assert.equal(typeof buildCollabDeadEndBannerAction, 'function', 'buildCollabDeadEndBannerAction must export');
assert.equal(typeof stripCollabSystemTokens, 'function', 'stripCollabSystemTokens must export');

// ---------------------------------------------------------------------------
// 2. Extract the REAL enrich `isSystem` expression from messagingService source
//    so T-01 exercises the actual shipped rule, not a hand-copy. The rule is the
//    RHS of `isSystem: <expr>,` inside enrichMessage.
// ---------------------------------------------------------------------------
const messagingSource = read('src/services/messagingService.ts');
const isSystemExprMatch = messagingSource.match(/isSystem:\s*([^\n]*?),\n/);
assert.ok(isSystemExprMatch, 'isSystem expression must be extractable from messagingService');
const isSystemExpr = isSystemExprMatch[1].trim();
// Evaluate that expression with a STUBBED isCollabDeadEndBannerMessage that
// always returns false (i.e. the allowlist EMPTIED) so the only thing that can
// make a system row system is the intrinsic null-sender / message_type clause.
function isSystemWithEmptyAllowlist(message) {
  const isCollabDeadEndBannerMessage = () => false;
  // eslint-disable-next-line no-new-func
  return Function(
    'message',
    'isCollabDeadEndBannerMessage',
    `return (${isSystemExpr});`,
  )(message, isCollabDeadEndBannerMessage);
}

// ---------------------------------------------------------------------------
// 3. Load the REAL MessageBubble token parser (import-free declarations).
// ---------------------------------------------------------------------------
const bubbleSource = read('src/components/chat/MessageBubble.tsx');
const tokenRegexDecl = bubbleSource.match(/const SYSTEM_TOKEN_REGEX = \/.*\/[gimsuy]*;/);
const validSectionsDecl = bubbleSource.match(/const VALID_PREF_SECTIONS = new Set\(\[[^\]]*\]\);/);
const parseFnDecl = bubbleSource.match(/export function parseCollabSystemToken\([\s\S]*?\n\}\n/);
assert.ok(tokenRegexDecl && validSectionsDecl && parseFnDecl, 'MessageBubble token parser must be extractable');
const bubbleMod = evalTsModule(
  `type CollabSystemPrefSection = 'travel' | 'location' | 'categories' | 'dates';
type CollabSystemToken = any;
${validSectionsDecl[0]}
${tokenRegexDecl[0]}
${parseFnDecl[0]}
export { parseCollabSystemToken, SYSTEM_TOKEN_REGEX };`,
  'messageBubbleTokens.ts',
);
const { parseCollabSystemToken, SYSTEM_TOKEN_REGEX } = bubbleMod;

// renderSystemBannerContent's visible-text extraction (token → label, else text).
function renderVisibleText(content) {
  const parts = content.split(SYSTEM_TOKEN_REGEX).filter((p) => p.length > 0);
  let buttonCount = 0;
  const visible = parts
    .map((part) => {
      const token = parseCollabSystemToken(part);
      if (!token) return part;
      buttonCount += 1;
      if (token.type === 'open-dismissed') return 'Review dismissed';
      if (token.type === 'compose-mention') return 'Message them';
      const section = token.section === 'categories' ? 'categories' : `${token.section} picks`;
      return token.type === 'open-prefs-self' ? `Open your ${section}` : `Open ${section}`;
    })
    .join('');
  return { visible, buttonCount };
}

// A deliberately-OLD allowlist snapshot — the PRE-1058 patterns that did NOT yet
// know the new copy. Used by T-04 to prove a NEW token-stripped prose string,
// fed to an OLD recognizer, still degrades cleanly (no token, no button).
const OLD_ALLOWLIST_SNAPSHOT = [
  /^.+ is too far from the group\.[\s\S]*\[\[open-prefs:travel:[a-zA-Z0-9_-]+\]\]$/,
  /^Nobody has picked categories yet\. \[\[open-prefs:self:categories\]\]$/,
  /^You've all seen everything for now\. \[\[open-dismissed\]\]$/,
];
const matchesOldAllowlist = (s) => OLD_ALLOWLIST_SNAPSHOT.some((re) => re.test(s));

// ---------------------------------------------------------------------------
// Scenario fixtures (one per reason / intersection case).
// ---------------------------------------------------------------------------
const UUID = '6b8f0a2c-1d3e-4f5a-9b0c-7d8e9f0a1b2c';
const OTHER = 'a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
const THIRD = 'c3333333-3333-4333-8333-333333333333';
const mkP = (id, name, opts = {}) => ({ user_id: id, has_accepted: opts.hasAccepted ?? true, profiles: { first_name: name } });

const SCENARIOS = {
  single_outlier: {
    reason: 'intersection_empty',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'intersection_empty',
      participants: [mkP(UUID, 'You'), mkP(OTHER, 'Ada'), mkP(THIRD, 'Ben')],
      participantPrefs: {
        [UUID]: { custom_lat: 51.5, custom_lng: -0.12, travel_constraint_value: 30, travel_mode: 'walking' },
        [OTHER]: { custom_lat: 38.90, custom_lng: -77.03, travel_constraint_value: 30, travel_mode: 'walking' },
        [THIRD]: { custom_lat: 38.91, custom_lng: -77.04, travel_constraint_value: 30, travel_mode: 'walking' },
      },
    },
    expectAction: { type: 'open-prefs', section: 'travel', userId: UUID },
  },
  waiting: {
    reason: 'intersection_empty',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'intersection_empty',
      participants: [mkP(UUID, 'You'), mkP(OTHER, 'Ada')],
      participantPrefs: { [UUID]: { custom_lat: 35.78, custom_lng: -78.64 }, [OTHER]: {} },
    },
    expectAction: { type: 'open-prefs', section: 'location', userId: OTHER },
  },
  different_cities: {
    reason: 'intersection_empty',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'intersection_empty',
      participants: [mkP(UUID, 'You'), mkP(OTHER, 'Ada')],
      participantPrefs: {
        [UUID]: { custom_lat: 38.9072, custom_lng: -77.0369, custom_location: 'Washington, DC, USA' },
        [OTHER]: { custom_lat: 35.7796, custom_lng: -78.6382, custom_location: 'Raleigh, NC, USA' },
      },
    },
    expectAction: { type: 'open-prefs', section: 'location', userId: UUID },
  },
  same_city_tight: {
    reason: 'intersection_empty',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'intersection_empty',
      participants: [mkP(UUID, 'You'), mkP(OTHER, 'Ada')],
      participantPrefs: {
        [UUID]: { custom_lat: 35.7796, custom_lng: -78.6382, custom_location: 'Raleigh, NC' },
        [OTHER]: { custom_lat: 35.8100, custom_lng: -78.6500, custom_location: 'Raleigh, NC' },
      },
    },
    expectAction: { type: 'open-prefs', section: 'travel', userId: UUID },
  },
  no_matching_gps: {
    reason: 'no_matching_candidates',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'no_matching_candidates',
      participants: [mkP(UUID, 'You'), mkP(OTHER, 'Ada')],
      participantPrefs: { [UUID]: {}, [OTHER]: {} },
      payload: { pendingGpsUserIds: [OTHER], detail: 'no gps' },
    },
    expectAction: { type: 'open-prefs', section: 'location', userId: OTHER },
  },
  no_matching_categories: {
    reason: 'no_matching_candidates',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'no_matching_candidates',
      participants: [mkP(UUID, 'You')],
      participantPrefs: { [UUID]: { use_gps_location: true, custom_lat: 1, custom_lng: 2 } },
      payload: { pendingGpsUserIds: [], detail: '' },
    },
    expectAction: { type: 'open-prefs-self', section: 'categories' },
  },
  no_unswiped: {
    reason: 'no_unswiped_candidates',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'no_unswiped_candidates',
      participants: [mkP(UUID, 'You')], participantPrefs: { [UUID]: {} },
    },
    expectAction: { type: 'open-dismissed' },
  },
  quorum: {
    reason: 'quorum_not_met',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'quorum_not_met',
      participants: [mkP(UUID, 'You', { hasAccepted: true }), mkP(OTHER, 'Ada', { hasAccepted: false })],
      participantPrefs: { [UUID]: {}, [OTHER]: {} }, payload: { acceptedCount: 1 },
    },
    expectAction: { type: 'compose-mention', userId: OTHER, text: 'can you tap accept' },
  },
  exhausted: {
    reason: 'all_pools_exhausted',
    input: {
      sessionId: 's', currentUserId: UUID, reason: 'all_pools_exhausted',
      participants: [mkP(UUID, 'You')], participantPrefs: { [UUID]: {} },
    },
    expectAction: { type: 'open-prefs-self', section: 'dates' },
  },
};

const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({ name, pass: true }); }
  catch (err) { checks.push({ name, pass: false, detail: err.message }); }
};

// --- T-01: intrinsic recognition with the allowlist EMPTIED -----------------
check('T-01 null-sender + system type is system with allowlist EMPTIED', () => {
  assert.equal(
    isSystemWithEmptyAllowlist({ sender_id: null, message_type: 'system', content: 'anything at all' }),
    true,
    'a null-sender system row must be system even with the allowlist disabled',
  );
});
check('T-01b non-null sender, non-system, no allowlist match → NOT system', () => {
  assert.equal(
    isSystemWithEmptyAllowlist({ sender_id: UUID, message_type: 'text', content: 'hi' }),
    false,
    'an ordinary user message must NOT be flagged system',
  );
});
check('T-01c message_type=system alone (defensive belt) → system', () => {
  assert.equal(
    isSystemWithEmptyAllowlist({ sender_id: UUID, message_type: 'system', content: 'x' }),
    true,
    'message_type=system must force system even with a non-null sender',
  );
});

// --- T-02 / T-03 / T-06 over every scenario ---------------------------------
for (const [name, sc] of Object.entries(SCENARIOS)) {
  const payload = buildCollabDeadEndBannerPayload(sc.input);

  // T-02 token never leaks in payload.prose.
  check(`T-02 [${name}] payload.prose has no raw token`, () => {
    assert.ok(!payload.prose.includes('[['), `prose leaked token: ${payload.prose}`);
    assert.ok(!payload.prose.includes(']]'), `prose leaked token close: ${payload.prose}`);
  });

  // T-03 chips from data — one per participant, "Name · Label".
  check(`T-03 [${name}] one chip per participant, "Name · Label"`, () => {
    assert.equal(payload.participants.length, sc.input.participants.length, 'chip count must equal participant count');
    for (const p of payload.participants) {
      assert.ok(p.name && p.label, `chip missing name/label: ${JSON.stringify(p)}`);
      assert.ok(['gps', 'place', 'pending'].includes(p.locationKind), `bad kind ${p.locationKind}`);
      assert.ok(p.a11yLabel.startsWith(`${p.name}:`), `a11y label must lead with name: ${p.a11yLabel}`);
    }
  });

  // T-06 button-target matrix.
  check(`T-06 [${name}] action matches SPEC §3.2`, () => {
    assert.deepEqual(payload.action, sc.expectAction, `action mismatch: ${JSON.stringify(payload.action)}`);
    // and the direct builder agrees with the payload builder
    assert.deepEqual(buildCollabDeadEndBannerAction(sc.input), sc.expectAction, 'action builder drift');
  });
}

// --- T-04: CROSS-BUILD DEGRADE (the key one) --------------------------------
// New producer output (token-stripped prose), fed to (a) the OLD allowlist
// snapshot and (b) the REAL MessageBubble token parser → no token, no button.
for (const name of ['different_cities', 'waiting']) {
  const payload = buildCollabDeadEndBannerPayload(SCENARIOS[name].input);
  const stripped = payload.prose; // already token-stripped by the service

  check(`T-04 [${name}] stripped prose carries NO token (vs an OLD allowlist that wouldn't match it)`, () => {
    assert.ok(!stripped.includes('[['), `stripped prose leaked token: ${stripped}`);
    // The OLD allowlist did not know this copy — it would NOT match. That is
    // FINE now: system-ness is intrinsic (null-sender), not allowlist-driven.
    assert.equal(matchesOldAllowlist(stripped), false, 'sanity: old allowlist did not know the new copy (proves the regressed topology)');
  });

  check(`T-04 [${name}] REAL MessageBubble parser yields ZERO buttons + ZERO raw token on the stripped prose`, () => {
    const { visible, buttonCount } = renderVisibleText(stripped);
    assert.ok(!visible.includes('[['), `raw token leaked in visible text: ${visible}`);
    assert.ok(!visible.includes(']]'), `raw token close leaked: ${visible}`);
    assert.equal(buttonCount, 0, `degrade prose must produce no inline buttons, got ${buttonCount}`);
  });
}

// --- T-05: legacy prose row (token present, no payload) still parses --------
check('T-05 legacy prose row WITH token → parser strips token into exactly one button', () => {
  const legacy = `You're in different cities — Washington, DC and Raleigh, NC. Pick one spot you'll all head to. [[open-prefs:location:${UUID}]]`;
  const { visible, buttonCount } = renderVisibleText(legacy);
  assert.ok(!visible.includes('[['), `raw token leaked in legacy visible text: ${visible}`);
  assert.equal(buttonCount, 1, `legacy row must produce exactly one button, got ${buttonCount}`);
});

// --- stripCollabSystemTokens unit: confirms the strip rule itself -----------
check('strip rule removes a trailing token and trims', () => {
  const raw = buildCollabDeadEndBannerContent(SCENARIOS.different_cities.input);
  assert.ok(raw.includes('[['), 'precondition: raw content carries a token');
  const out = stripCollabSystemTokens(raw);
  assert.ok(!out.includes('[['), `strip failed: ${out}`);
});

// ---------------------------------------------------------------------------
// ORCH-1058B send-UX + silent-failure hardening (rework section).
//
// THE BUG: tapping "Notify the group" gave no confirm, no success/failure
// feedback, and no row landed in the DB. Root cause of the no-row symptom is
// that `supabase.rpc` resolves with `{ data, error }` — it does NOT throw on a
// Postgres RAISE — so a try/catch alone swallows every RPC rejection silently.
//
// These source-level checks fail-on-revert if the confirm gate, the
// success/failure toasts, or the explicit `{ error }` (+ null `data`) inspection
// are removed.
// ---------------------------------------------------------------------------
const serviceSource = read('src/services/collabDeadEndBannerService.ts');
const swipeableSource = read('src/components/SwipeableCards.tsx');

// T-07 — the service inspects the RPC RETURN `{ error }` (not just try/catch).
check('T-07 service destructures { data, error } from the rpc and routes error → failure', () => {
  assert.match(
    serviceSource,
    /const\s*\{\s*data,\s*error\s*\}\s*=\s*await\s+supabase\.rpc\(\s*'rpc_post_collab_dead_end_banner'/,
    'must destructure { data, error } from the rpc call (rpc does not throw on DB error)',
  );
  assert.match(
    serviceSource,
    /if\s*\(\s*error\s*\)\s*\{[\s\S]*?throw new Error\(error\.message/,
    'a non-null rpc error must be routed (thrown) so it reaches the failure toast',
  );
  assert.match(
    serviceSource,
    /if\s*\(\s*!data\s*\)/,
    'a null data (no inserted message id) must be treated as a failure, not false success',
  );
});

// T-08 — failure toast wired (no silent no-op).
check('T-08 service shows a failure toast in the catch (no silent failure)', () => {
  assert.match(
    serviceSource,
    /catch\s*\(error\)\s*\{[\s\S]*?toastManager\.(error|warning)\(/,
    'the catch must surface a user-facing failure toast',
  );
  assert.match(
    serviceSource,
    /toastManager\.(error|warning)\(\s*"Couldn't notify the group/,
    'failure toast copy must name the failed notify action',
  );
});

// T-09 — success toast wired on a confirmed insert.
check('T-09 service shows a success toast only after a real row landed', () => {
  assert.match(
    serviceSource,
    /toastManager\.success\(\s*'Group notified'/,
    'a successful post must show a "Group notified" success toast',
  );
  // success toast must come AFTER the error/null-data guards (proves it only
  // fires on the success path, never before the rpc result is known).
  const successIdx = serviceSource.indexOf("toastManager.success('Group notified'");
  const errGuardIdx = serviceSource.search(/if\s*\(\s*error\s*\)\s*\{/);
  const nullGuardIdx = serviceSource.search(/if\s*\(\s*!data\s*\)/);
  assert.ok(successIdx > errGuardIdx && errGuardIdx !== -1, 'success toast must follow the error guard');
  assert.ok(successIdx > nullGuardIdx && nullGuardIdx !== -1, 'success toast must follow the null-data guard');
});

// T-10 — confirm gate present before the post fires.
check('T-10 "Notify the group" is gated behind an Alert.alert proceed/cancel confirm', () => {
  assert.match(swipeableSource, /from "react-native";/, 'sanity: react-native import block present');
  assert.match(
    swipeableSource,
    /Alert\.alert\(\s*\n?\s*'Notify the group\?'/,
    'confirm dialog must use the "Notify the group?" title',
  );
  assert.match(
    swipeableSource,
    /\{\s*text:\s*'Cancel',\s*style:\s*'cancel'\s*\}/,
    'confirm must offer a Cancel button',
  );
  assert.match(
    swipeableSource,
    /\{\s*text:\s*'Notify',\s*onPress:\s*\(\)\s*=>\s*\{\s*void\s+postNotifyGroup\(reason\)/,
    'only the "Notify" action may fire the post',
  );
  // The post itself must NOT be called unconditionally inside handleNotifyGroup
  // (it must live behind the confirm action).
  assert.match(
    swipeableSource,
    /const handleNotifyGroup = useCallback\(\(reason: CollabDeadEndReason\) => \{[\s\S]*?Alert\.alert\(/,
    'handleNotifyGroup must open the confirm, not post directly',
  );
});

// ---------------------------------------------------------------------------
let failed = 0;
for (const c of checks) {
  if (c.pass) console.log(`  PASS  ${c.name}`);
  else { failed += 1; console.error(`  FAIL  ${c.name}\n        ${c.detail}`); }
}
console.log(`\nORCH-1058B system-banner: ${checks.length - failed}/${checks.length} checks passed.`);
if (failed > 0) {
  console.error(`ORCH-1058B system-banner check FAILED (${failed} failing).`);
  process.exit(1);
}
console.log('ORCH-1058B system-banner check PASSED.');
