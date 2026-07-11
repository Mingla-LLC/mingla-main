// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1341_guest_list_sheet.test.ts). Deno typechecks it at run.
//
// ORCH-1359 (d) [guest-list-sheet-identity-display, item d] — implementor-owned
// happy-path suite for tap-name → peer-profile as a DETAIL-LOCAL overlay (D-B).
// SPEC §4.4 + investigation "SETH DECISION NEEDED (item d) → D-B". This item
// SUPERSEDES the sealed DRAFT invariant I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY
// with I-PROPOSED-1359-GUEST-NAME-OPENS-PROFILE.
//
// Deno-runnable source-structure suite in the 1341/1359 house style (read the
// source → strip comments → assert the rendered code). Enforces:
//   (1) EventGuestListSheet exposes the `onOpenProfile?` seam.
//   (2) Tapping a NAMED guest's name opens the profile: a Pressable wrapping the
//       name carries testID `orch-1359-guest-sheet-open-profile-${item.key}`.
//   (3) The name is pressable ONLY on NAMED, non-You rows that carry a profileId
//       (canOpenProfile gate) — anonymous/unlinked/You rows keep a plain,
//       NON-pressable name (deanonymization guard; no dead tap).
//   (4) The row CONTAINER stays a non-pressable Animated.View (T-09 parity).
//   (5) Close-before-navigate: onClose() fires BEFORE onOpenProfile(profileId)
//       (extends I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE — the wrapInRNModal
//       sheet must unmount first; COMMS-0084 — never a modal-over-modal).
//   (6) NO Linking.openURL / `mingla://` — pure in-app overlay (COMMS-0093).
//   (7) All three Consumer*DetailScreens render the DETAIL-LOCAL overlay: reuse
//       the EXISTING ViewFriendProfileScreen (no new profile screen), hold the
//       local profileUserId, pass onOpenProfile, wrap it in an absolute-fill
//       View (not a raw <Modal>), and Back returns to THIS detail (setState null)
//       — never the app shell. onMessage rides openDirectMessageInApp.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - drop the onOpenProfile prop / handler → T-1/T-5 FAIL.
//   - drop the name-open Pressable / its testID → T-2 FAIL.
//   - loosen canOpenProfile to include anon/unlinked/You → T-3 FAIL.
//   - reorder to navigate-before-close → T-5 FAIL.
//   - unwire a screen (drop the import / overlay / onOpenProfile) → T-7..T-9 FAIL.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

// Line comments FIRST, then block comments — a `/*` inside a line comment must
// not open a phantom block that swallows real code (house-style strip).
const strip = (src: string): string =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const SHEET = strip(await read("../EventGuestListSheet.tsx"));
const EVENT = strip(
  await read("../../screens/Event/ConsumerEventDetailScreen.tsx"),
);
const TRIP = strip(
  await read("../../screens/Trip/ConsumerTripDetailScreen.tsx"),
);
const EXP = strip(
  await read("../../screens/Experience/ConsumerExperienceDetailScreen.tsx"),
);

// ── T-1 — the sheet exposes the onOpenProfile seam ──────────────────────────

Deno.test("T-1 EventGuestListSheet declares the onOpenProfile? seam", () => {
  assert(
    /onOpenProfile\?:\s*\(userId:\s*string\)\s*=>\s*void;/.test(SHEET),
    "onOpenProfile?: (userId: string) => void is a prop on the sheet",
  );
  assertStringIncludes(SHEET, "onOpenProfile,"); // destructured in the component
});

// ── T-2 — the NAME is the profile-open target (exact testID) ────────────────

Deno.test("T-2 the guest name is wrapped in a Pressable with the ORCH-1359 testID", () => {
  assert(
    /testID=\{`orch-1359-guest-sheet-open-profile-\$\{item\.key\}`\}/.test(SHEET),
    "the name-open Pressable carries the orch-1359-guest-sheet-open-profile testID",
  );
  // The handler that the name Pressable fires.
  assertStringIncludes(SHEET, "handleOpenProfilePress(item)");
  assertStringIncludes(SHEET, "const handleOpenProfilePress");
});

// ── T-3 — pressable ONLY on named, non-You rows with a profileId ────────────

Deno.test("T-3 canOpenProfile is gated to NAMED, non-You, profileId-bearing rows", () => {
  // All four guards present in the canOpenProfile expression.
  assertStringIncludes(SHEET, "const canOpenProfile");
  assert(/item\.isNamed/.test(SHEET), "requires item.isNamed");
  assert(/!item\.isYou/.test(SHEET), "excludes the You row");
  assert(
    /guest\.profileId !== null/.test(SHEET),
    "requires a non-null profileId (anon/unlinked rows carry null — D8)",
  );
  assert(
    /onOpenProfile !== undefined/.test(SHEET),
    "requires the host to have wired the overlay seam (no dead affordance)",
  );
  // The name renders inside `canOpenProfile ? <Pressable...> : <Text...>` — the
  // else branch proves anon/unlinked/You names stay a plain, non-pressable Text.
  assert(
    /canOpenProfile\s*\?\s*\(/.test(SHEET),
    "the name Pressable is guarded by the canOpenProfile ternary",
  );
});

// ── T-4 — the row CONTAINER is still never pressable (T-09 parity) ──────────

Deno.test("T-4 the row container stays a non-pressable Animated.View group", () => {
  assert(
    /<Animated\.View\s+key=\{item\.key\}\s+style=\{\[styles\.row/.test(SHEET),
    "row container renders as a keyed, non-pressable Animated.View (only the name is a target)",
  );
  assert(!/TouchableOpacity/.test(SHEET), "no TouchableOpacity anywhere");
});

// ── T-5 — close-before-navigate + no unregistered-scheme nav ────────────────

Deno.test("T-5 handleOpenProfilePress closes the sheet BEFORE opening the profile", () => {
  const start = SHEET.indexOf("const handleOpenProfilePress");
  assert(start >= 0, "handleOpenProfilePress exists");
  // Guard: bail on a null profileId OR an unwired seam (no dead close).
  assert(
    /if \(profileId === null \|\| onOpenProfile === undefined\) return;/.test(
      SHEET,
    ),
    "the handler hard-returns on a null profileId or an absent seam",
  );
  const closeIdx = SHEET.indexOf("onClose();", start);
  const navIdx = SHEET.indexOf("onOpenProfile(profileId)", start);
  assert(closeIdx > start, "onClose() is inside the handler");
  assert(navIdx > start, "onOpenProfile(profileId) is inside the handler");
  assert(
    closeIdx < navIdx,
    "SEALED: onClose() must precede onOpenProfile(profileId) (the wrapInRNModal sheet unmounts first — no modal-over-modal)",
  );
});

Deno.test("T-6 no Linking.openURL / mingla:// for the profile nav (COMMS-0093)", () => {
  // The sheet still bans Linking.openURL / hand-built mingla:// strings; the
  // profile nav is pure in-app overlay, added without reintroducing them.
  assert(!/Linking\.openURL/.test(SHEET), "Linking.openURL stays BANNED in the sheet");
  assert(!/["'`]mingla:\/\//.test(SHEET), "no mingla:// URL strings in the sheet");
});

// ── T-7..T-9 — the DETAIL-LOCAL overlay wiring on all three screens ─────────

const assertScreenWired = (src: string, label: string): void => {
  // Reuse the EXISTING peer-profile screen — no new profile screen is built.
  assertStringIncludes(
    src,
    'import ViewFriendProfileScreen from "../../components/profile/ViewFriendProfileScreen"',
  );
  assertStringIncludes(src, "<ViewFriendProfileScreen");
  // Local overlay state + the onOpenProfile wire into the sheet.
  assert(
    /const \[guestProfileUserId, setGuestProfileUserId\] = useState<string \| null>\(/
      .test(src),
    `${label}: holds the local guestProfileUserId overlay state`,
  );
  assertStringIncludes(src, "onOpenProfile={setGuestProfileUserId}");
  // Rendered as an absolute-fill View overlay (NOT a raw <Modal> — no
  // modal-over-modal) that Back closes → returns to THIS detail (not the shell).
  assertStringIncludes(src, "<View style={styles.guestProfileOverlay}>");
  assert(
    /guestProfileOverlay:\s*\{[\s\S]*?absoluteFillObject[\s\S]*?zIndex:\s*100/.test(
      src,
    ),
    `${label}: the overlay is absolute-fill above the chrome (zIndex 100)`,
  );
  assertStringIncludes(src, "onBack={() => setGuestProfileUserId(null)}");
  // onMessage rides the sanctioned in-app open-DM rail — never Linking.openURL.
  assertStringIncludes(src, "openDirectMessageInApp(userId)");
};

Deno.test("T-7 ConsumerEventDetailScreen renders the detail-local profile overlay", () => {
  assertScreenWired(EVENT, "Event");
});

Deno.test("T-8 ConsumerTripDetailScreen renders the detail-local profile overlay", () => {
  assertScreenWired(TRIP, "Trip");
});

Deno.test("T-9 ConsumerExperienceDetailScreen renders the detail-local profile overlay", () => {
  assertScreenWired(EXP, "Experience");
});
