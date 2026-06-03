// ORCH-1041 — "Your circle" coach-mark copy (step 9) regression.
// Source-static check (coachMarkSteps copy is a hardcoded string, no behavior to mock).
// Happy-path: the new operator-approved copy is present.
// Adversarial angle: the copy must convey BOTH the friends-of-friends AND the
// events/trips discovery (a revert to a generic "people you plan with" line fails),
// and the step must still be the profile "Your circle" step (id 9).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'coachMarkSteps.ts'), 'utf8');

const APPROVED =
  "Friends of friends, and people from the events and trips you shared — find them and connect.";

test('ORCH-1041 T-01: step 9 carries the approved "Your circle" copy', () => {
  assert.ok(src.includes(APPROVED), 'approved Your-circle description string must be present');
});

test('ORCH-1041 T-02: the copy conveys both friends-of-friends and events/trips discovery', () => {
  // Locate the step-9 (Your circle) object and assert its description shape.
  const block = src.slice(src.indexOf("title: 'Your circle'"));
  const desc = block.slice(0, 400);
  assert.match(desc, /[Ff]riends of friends/, 'must mention friends-of-friends');
  assert.match(desc, /events and trips/, 'must mention events and trips (co-attendee discovery)');
  // Guard against a regression to the old generic line.
  assert.ok(!desc.includes('The people you plan with, all in one place.'),
    'must not revert to the old generic copy');
});
