// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// curatedStopsAvailability.adversarial.test.ts). Deno typechecks it at run.
//
// ORCH-1341 [guest-list-sheet-consumer] — implementor-owned happy-path guard
// suite (SPEC §7 T-9 + §9 structural safeguard; META-ORCH-1337 Leg 4).
//
// Deno-runnable source-structure suite in the 1157/1163/1340 house style
// (read the source files → strip comments → assert). Enforces:
//   - I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER (no gorhom import, no
//     raw RN <Modal>, no raw <FlatList> — the primitive owns the list).
//   - The EventAudienceSheet posture: wrapInRNModal + theme="dark" + fixed
//     GUEST_LIST_SNAP ['70%'] + stock motion (no animationConfigs) + no
//     dynamic sizing (ORCH-1138) + no TextInput (ORCH-1171 N/A by design).
//   - I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY: rows are never pressable —
//     the only Pressables are the sanctioned action controls.
//   - Constitution #4: the hook keys from the central guestListKeys factory,
//     never a literal key string.
//   - ORCH-1303: every Animated.timing in the sheet carries isInteraction:false.
//   - Q8: the sheet never calls sendFirstMessage (compose-path helper) and
//     never imports connectionsService (F-13 BAN).
//   - The 1338 error contract mapping + p_limit 100 in the service; the
//     fresh-fetch-per-open hook config; the §4.6 wiring on all three screens.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - wrap the sheet in a raw RN <Modal> / import gorhom → T-01/T-02 FAIL.
//   - drop wrapInRNModal / theme="dark" / the ['70%'] const → T-03 FAILS.
//   - hardcode the query key in the hook → T-07 FAILS.
//   - strip isInteraction:false from a timing → T-08 FAILS.
//   - wrap the row container in a Touchable/Pressable → T-09/T-10 FAIL.
//   - call sendFirstMessage / import connectionsService → T-11 FAILS.
//   - unwire a screen (drop the import/mount/handler) → T-14..T-16 FAIL.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

// Strip // line comments FIRST (the `[^:]` guard protects `https://` URLs),
// THEN /* */ block comments (covers {/* JSX */}) — line-first because a `/*`
// sequence INSIDE a line comment would otherwise open a phantom block that
// swallows real code (ConsumerTripDetailScreen has exactly that shape). Doc
// comments legitimately NAME forbidden things; they must not satisfy/trip.
const strip = (src: string): string =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const SHEET_RAW = await read("../EventGuestListSheet.tsx");
const HOOK_RAW = await read("../../hooks/useEventGuestList.ts");
const KEYS_RAW = await read("../../hooks/queryKeys.ts");
const SERVICE_RAW = await read("../../services/socialProofService.ts");
const EVENT_RAW = await read(
  "../../screens/Event/ConsumerEventDetailScreen.tsx",
);
const TRIP_RAW = await read("../../screens/Trip/ConsumerTripDetailScreen.tsx");
const EXP_RAW = await read(
  "../../screens/Experience/ConsumerExperienceDetailScreen.tsx",
);

const SHEET = strip(SHEET_RAW);
const HOOK = strip(HOOK_RAW);
const KEYS = strip(KEYS_RAW);
const SERVICE = strip(SERVICE_RAW);
const EVENT = strip(EVENT_RAW);
const TRIP = strip(TRIP_RAW);
const EXP = strip(EXP_RAW);

const NEW_FILES: ReadonlyArray<readonly [string, string]> = [
  ["EventGuestListSheet", SHEET],
  ["useEventGuestList", HOOK],
  ["socialProofService", SERVICE],
];

// ── T-01 — no second RN Modal, ever (COMMS-0084 / ORCH-0908) ────────────────

Deno.test("T-01 no raw RN <Modal> in any new file", () => {
  for (const [name, src] of NEW_FILES) {
    assert(!/<Modal\b/.test(src), `${name}: no raw RN <Modal>`);
    assert(!/\bRNModal\b/.test(src), `${name}: no RN Modal alias`);
  }
});

// ── T-02 — BaseBottomSheet is the sole sheet primitive (META-0991) ──────────

Deno.test("T-02 no @gorhom import; the sheet consumes BaseBottomSheet", () => {
  for (const [name, src] of NEW_FILES) {
    assert(!/@gorhom\//.test(src), `${name}: no direct gorhom import`);
  }
  assertStringIncludes(SHEET, 'import { BaseBottomSheet } from "./ui/BaseBottomSheet"');
  assertStringIncludes(SHEET, "<BaseBottomSheet");
});

// ── T-03 — the EventAudienceSheet posture (SPEC §4.3 config lines) ──────────

Deno.test("T-03 wrapInRNModal + dark theme + fixed ['70%'] snap + flatlist body", () => {
  assertStringIncludes(SHEET, 'const GUEST_LIST_SNAP = ["70%"];');
  assertStringIncludes(SHEET, "snapPoints={GUEST_LIST_SNAP}");
  assertStringIncludes(SHEET, "wrapInRNModal");
  assertStringIncludes(SHEET, 'theme="dark"');
  assertStringIncludes(SHEET, 'scrollMode="flatlist"');
  assertStringIncludes(SHEET, 'accessibilityLabel="Who\'s going"');
  // #111418 canvas — exemplar parity (design §2.2).
  assertStringIncludes(SHEET, '"#111418"');
});

Deno.test("T-04 no dynamic sizing, no custom motion, no keyboard surface", () => {
  assert(!/enableDynamicSizing/.test(SHEET), "no dynamic sizing (ORCH-1138)");
  assert(!/animationConfigs/.test(SHEET), "stock motion only (ORCH-1064)");
  assert(!/TextInput/.test(SHEET), "no text input in v1 (ORCH-1171 N/A)");
  assert(!/tabBarAware|hidesBottomNav/.test(SHEET), "nav props stay omitted (Bug-4)");
  assert(!/\boverlay\s*=/.test(SHEET), "overlay slot unused in v1");
});

// ── T-05 — the primitive owns the list (no raw RN list) ─────────────────────

Deno.test("T-05 no raw <FlatList>/<ScrollView> inside the sheet", () => {
  assert(!/<FlatList\b/.test(SHEET), "no raw RN FlatList");
  assert(!/<ScrollView\b/.test(SHEET), "no raw RN ScrollView");
  assert(!/<SectionList\b/.test(SHEET), "no raw RN SectionList");
});

// ── T-06 — banned dependencies (F-13; SPEC §4.4/T-8) ────────────────────────

Deno.test("T-06 no connectionsService / blockService import in any new file", () => {
  for (const [name, src] of NEW_FILES) {
    assert(!/connectionsService/.test(src), `${name}: connectionsService BANNED (F-13)`);
    assert(!/blockService/.test(src), `${name}: no client block plumbing (T-8)`);
  }
});

// ── T-07 — Constitution #4: key factory, never a literal ────────────────────

Deno.test("T-07 hook keys from guestListKeys; no literal key string", () => {
  assertStringIncludes(HOOK, "guestListKeys.list(");
  assertStringIncludes(HOOK, 'import { guestListKeys } from "./queryKeys"');
  assert(
    !/\[\s*['"]eventGuestList['"]/.test(HOOK),
    "hook must not hardcode the eventGuestList key",
  );
  // The factory lives in the CENTRAL factory file.
  assertStringIncludes(KEYS, "export const guestListKeys");
  assertStringIncludes(KEYS, "['eventGuestList'] as const");
});

Deno.test("T-07b hook pins fresh-fetch-per-open + enabled gating", () => {
  assertStringIncludes(HOOK, "staleTime: 0");
  assertStringIncludes(HOOK, "gcTime: 0");
  assertStringIncludes(HOOK, "enabled: visible && eventId !== null");
  assertStringIncludes(HOOK, "retry: 1");
});

// ── T-08 — ORCH-1303: every timing carries isInteraction:false ──────────────

Deno.test("T-08 every Animated.timing in the sheet carries isInteraction: false", () => {
  const segments = SHEET.split("Animated.timing(");
  assert(segments.length > 1, "the sheet animates (skeleton pulse + fades)");
  for (let i = 1; i < segments.length; i++) {
    const window = segments[i].slice(0, 400);
    assertStringIncludes(
      window,
      "isInteraction: false",
      `Animated.timing #${i} must carry isInteraction: false (ORCH-1303)`,
    );
  }
  assert(/Animated\.loop\(/.test(SHEET), "skeleton pulse is a loop");
});

// ── T-09/T-10 — rows are NEVER pressable; only sanctioned Pressables ────────

Deno.test("T-09 no TouchableOpacity; row container is a plain accessible group", () => {
  assert(!/TouchableOpacity/.test(SHEET), "no TouchableOpacity anywhere");
  assert(
    /<Animated\.View\s+style=\{\[styles\.row/.test(SHEET),
    "row container renders as a non-pressable Animated.View group",
  );
});

Deno.test("T-10 every <Pressable> is one of the sanctioned action controls", () => {
  const segments = SHEET.split("<Pressable");
  assert(segments.length >= 3, "add-friend + message + retry Pressables exist");
  for (let i = 1; i < segments.length; i++) {
    const window = segments[i].slice(0, 1200);
    assert(
      /testID=\{`orch-1341-guest-sheet-(add-friend|message)-\$\{item\.key\}`\}/.test(
        window,
      ) || /testID="orch-1341-guest-sheet-error-retry"/.test(window),
      `Pressable #${i} must be a sanctioned action control (rows are not pressable)`,
    );
  }
});

// ── T-11 — message plumbing (Q8 + ORCH-0993 gate) ───────────────────────────

Deno.test("T-11 ensureConversation only; sendFirstMessage never called", () => {
  assertStringIncludes(SHEET, "messagingService.ensureConversation(");
  assert(!/sendFirstMessage/.test(SHEET), "compose path belongs to the thread UI (Q8)");
  // The one deep-link rail — no second parser.
  assertStringIncludes(SHEET, "mingla://chat/${conversationId}?type=direct");
  // Friend-gate locked hint (D4).
  assertStringIncludes(SHEET, "Add them as a friend to message");
});

Deno.test("T-11b add-friend rides the exact useFriends().addFriend signature", () => {
  assertStringIncludes(
    SHEET,
    'await addFriend(profileId, "", row.guest.username ?? undefined)',
  );
  assert(
    !/from\s*\(\s*["']friend_requests["']\s*\)/.test(SHEET),
    "the sheet never writes friend_requests directly",
  );
});

// ── T-12 — the service error contract + hard cap (SPEC §4.1) ────────────────

Deno.test("T-12 service maps the 1338 error tokens and pins p_limit 100", () => {
  assertStringIncludes(SERVICE, '"peer_list_event_guests"');
  assertStringIncludes(SERVICE, "p_limit: 100");
  assertStringIncludes(SERVICE, "class GuestListGatedError");
  assertStringIncludes(SERVICE, "class GuestListUnavailableError");
  assertStringIncludes(SERVICE, 'message.includes("guest_list_private")');
  assertStringIncludes(SERVICE, 'message.includes("event_not_available")');
});

// ── T-13 — all five designed states + the §4 copy block ─────────────────────

Deno.test("T-13 all five states render the design's copy", () => {
  // skeleton
  assertStringIncludes(SHEET, "orch-1341-guest-sheet-skeleton");
  // gated (an EMPTY state, not an error)
  assertStringIncludes(SHEET, "This guest list is private");
  assertStringIncludes(SHEET, "The host keeps it just for the guests.");
  // zero-empty
  assertStringIncludes(SHEET, "No one yet");
  assertStringIncludes(SHEET, "Someone has to be first.");
  // error + retry
  assertStringIncludes(SHEET, "Couldn't load the guest list");
  assertStringIncludes(SHEET, "Give it another go.");
  assertStringIncludes(SHEET, "orch-1341-guest-sheet-error-retry");
  // capped tail
  assertStringIncludes(SHEET, "orch-1341-guest-sheet-footer-more");
  assertStringIncludes(SHEET, "and ${moreCount} more");
  // row variants
  assertStringIncludes(SHEET, '"Someone"');
  assertStringIncludes(SHEET, '"Keeping it low-key"');
  assertStringIncludes(SHEET, '"On Mingla"');
  assertStringIncludes(SHEET, '"You"');
  assertStringIncludes(SHEET, "Requested");
  assertStringIncludes(SHEET, "Couldn't send — try again");
});

// ── T-14..T-16 — §4.6 wiring on all three consumer screens ──────────────────

Deno.test("T-14 ConsumerEventDetailScreen wires BOTH branches + mounts the sheet", () => {
  assertStringIncludes(EVENT, "import EventGuestListSheet from");
  assertStringIncludes(EVENT, "<EventGuestListSheet");
  assertStringIncludes(EVENT, "handleSeeWhosGoing");
  // RSVP branch: config-object form; standard branch: JSX-prop form.
  assert(/onSeeWhosGoing:\s*\n?/.test(EVENT), "rsvpConfig carries onSeeWhosGoing");
  assert(/onSeeWhosGoing=\{/.test(EVENT), "EventOfferingBody carries onSeeWhosGoing");
  assertStringIncludes(EVENT, "visible={guestSheetVisible}");
});

Deno.test("T-15 ConsumerTripDetailScreen wires the trip body + mounts the sheet", () => {
  assertStringIncludes(TRIP, "import EventGuestListSheet from");
  assertStringIncludes(TRIP, "<EventGuestListSheet");
  assertStringIncludes(TRIP, "handleSeeWhosGoing");
  assert(/onSeeWhosGoing=\{/.test(TRIP), "TripOfferingBody carries onSeeWhosGoing");
  assertStringIncludes(TRIP, "eventId={detail.tripId}");
});

Deno.test("T-16 ConsumerExperienceDetailScreen wires the experience body + mounts the sheet", () => {
  assertStringIncludes(EXP, "import EventGuestListSheet from");
  assertStringIncludes(EXP, "<EventGuestListSheet");
  assertStringIncludes(EXP, "handleSeeWhosGoing");
  assert(/onSeeWhosGoing=\{/.test(EXP), "ExperienceOfferingBody carries onSeeWhosGoing");
  assertStringIncludes(EXP, "eventId={seed.eventId}");
});

// ── T-17 — header + a11y contract (design §2.3/§2.8) ────────────────────────

Deno.test("T-17 header, a11y labels and hit targets", () => {
  assertStringIncludes(SHEET, "Who's going");
  assertStringIncludes(SHEET, "${goingCount} going");
  assertStringIncludes(SHEET, 'accessibilityRole="header"');
  assertStringIncludes(SHEET, "Add ${name} as a friend");
  assertStringIncludes(SHEET, "Message ${name}");
  assertStringIncludes(SHEET, "Available once you're friends");
  assertStringIncludes(SHEET, "Friend request sent to ${name}");
  assertStringIncludes(SHEET, "accessibilityState={{ disabled: true }}");
  assertStringIncludes(SHEET, "hitSlop={4}");
});
