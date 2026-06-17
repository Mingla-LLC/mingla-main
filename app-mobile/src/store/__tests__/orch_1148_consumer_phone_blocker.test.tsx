// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1148 [consumer phone blocker] — a signed-in consumer could NOT complete a
// table reservation: tapping "Confirm reservation" on the VenueReserveSheet
// review step returned the server `buyer_phone_required` 400, and no phone field
// was expected because the user HAS a phone on their profile.
//
// ROOT CAUSE (sub-bug 1, REAL): the store `user` is seeded from the Supabase
// AUTH user (`session.user` via setAuth), which does NOT carry `profiles.phone`.
// The phone lives only on the separately-loaded `profiles` row (`setProfile`).
// VenueReserveSheet reads `user?.phone` → always empty → `needsPhone` always
// true; if the (unexpected) prompt is left blank, `composedPhoneE164` is "" and
// the server rejects with `buyer_phone_required`.
//
// FIX (primary): `appStore.setProfile` now mirrors a non-empty `profiles.phone`
// onto the store `user.phone` (single chokepoint — covers every profile-load
// path). FIX (secondary/defensive): VenueReserveSheet sources the phone from
// `user.phone ?? profile.phone` so a user WITH a profile phone gets
// needsPhone=false (no prompt, books automatically) even before the store merge
// lands; a user with NONE still gets the contact-phone input block + the
// client-side `phoneOk` guard that surfaces a friendly message BEFORE the server.
//
// These are SOURCE-STRING assertions (the RN store + sheet can't mount under the
// node harness — the established ORCH-1138/1153 consumer pattern). fails-on-
// revert: each `ok(...)` below flips red if the corresponding fix line is removed
// (proven against commit that reverts the two edits). Owner: mingla-implementor.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// REPO_ROOT = up 4 from this dir (…/app-mobile/src/store/__tests__).
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

const APP = "app-mobile";
const storeSrc = stripComments(read(`${APP}/src/store/appStore.ts`));
const sheetSrc = stripComments(
  read(`${APP}/src/components/expandedCard/VenueReserveSheet.tsx`),
);

// ── Sub-bug 1 fix — appStore.setProfile mirrors profile.phone onto user ──────

// setProfile must use the functional form so it can read the current user.
ok(
  "setProfile reads current state (functional set)",
  /setProfile:\s*\(profile\)\s*=>\s*set\(\s*\(state[^)]*\)\s*=>/.test(storeSrc),
  "expected `setProfile: (profile) => set((state...) => ...)`",
);

// It must derive a non-empty phone from the loaded profile.
ok(
  "setProfile derives a non-empty phone from the profile",
  /profile\?\.phone/.test(storeSrc) &&
    /profile\.phone\.trim\(\)\.length\s*>\s*0/.test(storeSrc),
  "expected a trimmed non-empty `profile.phone` guard",
);

// It must merge that phone onto the store user (so user.phone reflects profile).
ok(
  "setProfile merges the profile phone onto the store user",
  /\{\s*\.\.\.state\.user,\s*phone:\s*nextProfilePhone\s*\}/.test(storeSrc),
  "expected `{ ...state.user, phone: nextProfilePhone }`",
);

// It must still set `profile` (no regression of the original behavior).
ok(
  "setProfile still sets profile",
  /return\s*\{\s*profile,\s*user:\s*nextUser\s*\}/.test(storeSrc),
  "expected `return { profile, user: nextUser }`",
);

// ── Sub-bug 2 fix — VenueReserveSheet phone sourcing + render + guard ────────

// The sheet must read both user and profile from the store.
ok(
  "sheet reads { user, profile } from the store",
  /const\s*\{\s*user,\s*profile\s*\}\s*=\s*useAppStore\(\)/.test(sheetSrc),
  "expected `const { user, profile } = useAppStore()`",
);

// profilePhone must fall back to profile.phone when user.phone is empty.
ok(
  "profilePhone falls back to user.phone ?? profile.phone",
  /user\?\.phone\s*\?\?\s*profile\?\.phone/.test(sheetSrc),
  "expected `user?.phone ?? profile?.phone`",
);

// needsPhone is derived from the (now profile-aware) phone.
ok(
  "needsPhone derives from profilePhone length",
  /const\s+needsPhone\s*=\s*profilePhone\.length\s*===\s*0/.test(sheetSrc),
);

// When needsPhone, the sheet builds the E164 from the typed input; otherwise it
// reuses the profile phone (no prompt for users who already have one).
ok(
  "composedPhoneE164 uses the profile phone when not needsPhone",
  /composedPhoneE164\s*=\s*needsPhone[\s\S]*?:\s*profilePhone/.test(sheetSrc),
);

// The phone-input block MUST render when needsPhone is true (the secondary path).
ok(
  "phone input block renders when needsPhone",
  /\{needsPhone\s*&&\s*\(/.test(sheetSrc) && /<PhoneInput/.test(sheetSrc),
  "expected `{needsPhone && ( ... <PhoneInput ... )}`",
);

// The client-side phoneOk guard must fire BEFORE the server (friendly message).
ok(
  "handleConfirm guards on phoneOk before reserving",
  /if\s*\(!phoneOk\)\s*\{[\s\S]*?Add a phone number[\s\S]*?return;/.test(sheetSrc),
  "expected the `if (!phoneOk) { ...friendly... return; }` guard before reserve(",
);

// The reservation must send the composed phone (non-empty when one exists).
ok(
  "reserve sends composedPhoneE164 as the buyer phone",
  /phone:\s*composedPhoneE164/.test(sheetSrc),
);

console.log(`\n${passed} assertions passed.`);
