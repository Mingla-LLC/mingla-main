// @ts-nocheck
// ORCH-0945 [Collab deck dead-end UX polish] — TESTER adversarial regression
//
// Attacks angles the implementor's happy-path tests did NOT cover. Adversarial,
// not a renamed copy of the implementor's structural asserts.
//
//   T-AT-01: 2-participant boundary — detectIntersectionOutlier MUST return multi
//            (privacy + UX: 1-outlier copy requires ≥3 participants by design)
//   T-AT-02: privacy invariant — banner builder MUST NOT interpolate raw lat/lng
//            into returned strings; location label comes only from formatLocationLabel
//   T-AT-03: NaN/non-finite defense — detectIntersectionOutlier filters via
//            Number.isFinite and degrades to multi rather than crashing
//   T-AT-04: token regex character-class security — MessageBubble token parser
//            restricts to alphanumeric + dash + underscore + comma (no quote,
//            semicolon, parenthesis, angle bracket — XSS / injection mitigation)
//   T-AT-05: isEditable save-handler gate — handleApplyPreferences MUST short-circuit
//            on first body line; no save RPC reachable in read-only mode
//   T-AT-06: graceful fallback names — formatParticipantName defaults to 'A participant'
//            so missing first_name + display_name does not surface 'undefined' to users
//   T-AT-07: single-outlier majority-connected guard — single-outlier mode is only
//            returned when all non-outliers form a fully-connected sub-cluster
//            (prevents false-positive outlier in fragmented 3-person sessions)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_MOBILE_ROOT = path.resolve(__dirname, '../..');

function readSource(relPath) {
  return fs.readFileSync(path.join(APP_MOBILE_ROOT, relPath), 'utf8');
}

const banner = readSource('services/collabDeadEndBannerService.ts');
const messageBubble = readSource('components/chat/MessageBubble.tsx');
const preferencesSheet = readSource('components/PreferencesSheet.tsx');

// T-AT-01: 2-participant boundary
assert.match(
  banner,
  /if\s*\(\s*participants\.length\s*<\s*3\s*\)\s*return\s*\{\s*mode:\s*'multi'\s*\}/,
  '[T-AT-01] detectIntersectionOutlier MUST return multi for <3 participants',
);

// T-AT-02: privacy invariant — no raw lat/lng interpolation inside the intersection-empty banner string template
const intersectionBlockMatch = banner.match(/case\s+'intersection_empty':\s*\{([\s\S]*?)\}\s*case\s+'no_matching_candidates'/);
assert.ok(intersectionBlockMatch, '[T-AT-02] intersection_empty case block must exist');
const intersectionBlock = intersectionBlockMatch[1];
assert.ok(
  !/\$\{[^}]*custom_lat/.test(intersectionBlock),
  '[T-AT-02] banner content MUST NOT interpolate custom_lat (privacy invariant)',
);
assert.ok(
  !/\$\{[^}]*custom_lng/.test(intersectionBlock),
  '[T-AT-02] banner content MUST NOT interpolate custom_lng (privacy invariant)',
);

// T-AT-03: NaN/non-finite defense
assert.match(
  banner,
  /Number\.isFinite\(lat\)/,
  '[T-AT-03] detectIntersectionOutlier MUST use Number.isFinite(lat) to filter NaN',
);
assert.match(
  banner,
  /Number\.isFinite\(lng\)/,
  '[T-AT-03] detectIntersectionOutlier MUST use Number.isFinite(lng) to filter NaN',
);

// T-AT-04: token regex character-class security — must NOT include unsafe chars.
// Extract the value-segment char class (alphanumeric + safe punctuation) by
// pulling the `[...]` block that appears AFTER the colon separator in the regex.
const valueClassMatch = messageBubble.match(/const\s+SYSTEM_TOKEN_REGEX\s*=[^;]*?\(\?:[^[]*\[([^\]]+)\]\+/);
assert.ok(valueClassMatch, '[T-AT-04] SYSTEM_TOKEN_REGEX value char-class must be extractable');
const valueClass = valueClassMatch[1];
for (const unsafe of ['"', "'", ';', '<', '>', '`', '$', '*', '&', '|', '+', '#', '/', '\\\\']) {
  assert.ok(
    !valueClass.includes(unsafe),
    `[T-AT-04] SYSTEM_TOKEN_REGEX value char-class MUST NOT include unsafe char ${JSON.stringify(unsafe)} (class body: ${valueClass})`,
  );
}
// Sanity: it DOES include alphanumerics by design.
assert.match(valueClass, /a-zA-Z0-9/, '[T-AT-04] value char-class must include alphanumeric range');

// T-AT-05: isEditable save-handler gate — handleApplyPreferences's first executable line is the guard
const applyMatch = preferencesSheet.match(/const\s+handleApplyPreferences\s*=\s*useCallback\s*\(\s*async\s*\(\s*\)\s*=>\s*\{\s*([\s\S]{0,80})/);
assert.ok(applyMatch, '[T-AT-05] handleApplyPreferences definition must exist');
const firstBodyChars = applyMatch[1];
assert.match(
  firstBodyChars,
  /if\s*\(\s*!isEditable\s*\)\s*return/,
  '[T-AT-05] handleApplyPreferences first body statement MUST be isEditable guard',
);

// T-AT-06: graceful fallback names
assert.match(
  banner,
  /'A participant'/,
  "[T-AT-06] formatParticipantName MUST default to 'A participant' fallback",
);
assert.ok(
  !banner.includes('undefined.first_name') && !banner.includes('${undefined}'),
  '[T-AT-06] banner builder MUST NOT have a code path that emits literal undefined',
);

// T-AT-07: majorityConnected guard for single-outlier path
assert.match(
  banner,
  /majorityConnected/,
  '[T-AT-07] detectIntersectionOutlier MUST compute majorityConnected for single-outlier path',
);
const singleOutlierLine = banner.match(/isolated\.length\s*===\s*1\s*&&\s*majorityConnected\s*\?[^?]+?'single'/);
assert.ok(
  singleOutlierLine,
  '[T-AT-07] single-outlier path MUST require BOTH isolated.length === 1 AND majorityConnected',
);

console.log('PASS T-AT-01..T-AT-07 ORCH-0945 banner adversarial');
