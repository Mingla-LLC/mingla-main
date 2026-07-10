// ORCH-1341 [guest-list-sheet-consumer] — adversarial guard suite (SPEC §9
// named-revert families 2/3/4/5 + the privacy/sequencing seals).
//
// Attacks the seams a future edit would most plausibly regress:
//   1. Message re-ordered to navigate-before-close (drops the sealed
//      I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE order).
//   2. Client-side block/visibility re-filtering added (server authority —
//      1338 SC-6; a client filter would mask server regressions, T-8).
//   3. Anonymous-row deanonymization (actions leaking onto anonymous rows /
//      identity recovery attempts — D8).
//   4. Offset-walking added around the 100-row scrape cap (F-8).
//   5. Zustand server-state writes sneaking in (ownership rule).
//   6. Conditional sheet mounts (`{visible ? <Sheet/> : null}` re-mounts
//      gorhom mid-gesture — the declarative primitive owns lifecycle).
//   7. The §4.6 double gate dropped from a screen wiring.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

// Line comments FIRST, then block comments — a `/*` inside a line comment
// must not open a phantom block that swallows real code (see the happy suite).
const strip = (src: string): string =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const SHEET = strip(await read("../EventGuestListSheet.tsx"));
const HOOK = strip(await read("../../hooks/useEventGuestList.ts"));
const SERVICE = strip(await read("../../services/socialProofService.ts"));
const SCREENS: ReadonlyArray<readonly [string, string]> = [
  [
    "ConsumerEventDetailScreen",
    strip(await read("../../screens/Event/ConsumerEventDetailScreen.tsx")),
  ],
  [
    "ConsumerTripDetailScreen",
    strip(await read("../../screens/Trip/ConsumerTripDetailScreen.tsx")),
  ],
  [
    "ConsumerExperienceDetailScreen",
    strip(
      await read("../../screens/Experience/ConsumerExperienceDetailScreen.tsx"),
    ),
  ],
];

// ── A-1 — sealed sequencing: ensure → close → NAVIGATE ──────────────────────

Deno.test("A-1 message handler closes the sheet BEFORE navigating (source order)", () => {
  const handlerStart = SHEET.indexOf("const handleMessagePress");
  assert(handlerStart >= 0, "handleMessagePress exists");
  const closeIdx = SHEET.indexOf("onClose();", handlerStart);
  const navIdx = SHEET.indexOf("Linking.openURL", handlerStart);
  const overrideIdx = SHEET.indexOf("onOpenConversation(conversationId)", handlerStart);
  assert(closeIdx > handlerStart, "the handler calls onClose()");
  assert(navIdx > handlerStart, "the handler navigates via the deep-link rail");
  assert(
    closeIdx < navIdx,
    "onClose() must precede Linking.openURL (close-before-NAVIGATE seal)",
  );
  assert(
    overrideIdx === -1 || closeIdx < overrideIdx,
    "onClose() must precede the onOpenConversation override too",
  );
  // ensure precedes close (the §4.5 ruled order — a post-close ensure failure
  // would have no error surface).
  const ensureIdx = SHEET.indexOf("ensureConversation(", handlerStart);
  assert(
    ensureIdx > handlerStart && ensureIdx < closeIdx,
    "ensureConversation resolves before the sheet closes (§4.5)",
  );
});

// ── A-2 — server authority: NO client re-filtering anywhere ─────────────────

Deno.test("A-2 no .filter( in any new file — the payload is privacy-final", () => {
  for (const [name, src] of [
    ["EventGuestListSheet", SHEET],
    ["useEventGuestList", HOOK],
    ["socialProofService", SERVICE],
  ] as const) {
    assert(
      !/\.filter\(/.test(src),
      `${name}: no client-side row filtering (blocked/visibility exclusion is SERVER-side — 1338 SC-6/T-8)`,
    );
    assert(!/hasBlockBetween|isBlocked|blocked_users/.test(src), `${name}: no block plumbing`);
  }
});

// ── A-3 — anonymity seal (D8): keying + no identity recovery ────────────────

Deno.test("A-3 anonymous rows key by index and expose no actions", () => {
  assertStringIncludes(SHEET, "guest.profileId ?? `anon-${index}`");
  // Actions gate: named, non-You rows ONLY.
  assertStringIncludes(
    SHEET,
    "const showActions = item.isNamed && !item.isYou;",
  );
  // Named ⇔ profileId present AND not anonymous (belt-and-braces).
  assertStringIncludes(
    SHEET,
    "const isNamed = guest.profileId !== null && !guest.isAnonymous;",
  );
  // Both action handlers hard-return on a null profileId.
  const addStart = SHEET.indexOf("const handleAddFriendPress");
  const msgStart = SHEET.indexOf("const handleMessagePress");
  for (const [label, start] of [
    ["handleAddFriendPress", addStart],
    ["handleMessagePress", msgStart],
  ] as const) {
    assert(start >= 0, `${label} exists`);
    const window = SHEET.slice(start, start + 600);
    assertStringIncludes(
      window,
      "if (profileId === null) return;",
      `${label} refuses anonymous rows (D8)`,
    );
  }
  // No identity-recovery attempt: the sheet renders payload fields only.
  assert(
    !/resolve_user_visibility|from\s*\(\s*["']profiles["']\s*\)/.test(SHEET),
    "no username/identity resolution inside the sheet",
  );
});

// ── A-4 — the 100-row cap is a scrape guard, not a pagination seam ──────────

Deno.test("A-4 no offset-walking: single page, no p_offset, no load-more", () => {
  assert(!/p_offset/.test(SERVICE), "service never passes p_offset");
  assert(!/p_offset/.test(HOOK), "hook never passes p_offset");
  assert(!/onEndReached|fetchNextPage|useInfiniteQuery/.test(SHEET), "no load-more");
  assert(!/useInfiniteQuery/.test(HOOK), "no infinite query");
  assertStringIncludes(SERVICE, "p_limit: 100");
});

// ── A-5 — server state stays in React Query (no Zustand writes) ─────────────

Deno.test("A-5 the sheet reads the viewer id only; no store writes", () => {
  assertStringIncludes(SHEET, "useAppStore((s) => s.user?.id)");
  assert(!/setState|\.getState\(\)/.test(SHEET), "no store writes/imperative reads");
  assert(!/useAppStore/.test(HOOK), "the hook holds server state in React Query only");
});

// ── A-6 — declarative mounts: never conditionally mounted ───────────────────

Deno.test("A-6 every host mounts the sheet UNCONDITIONALLY (visible drives it)", () => {
  for (const [name, src] of SCREENS) {
    assert(
      !/guestSheetVisible\s*\?\s*\(?\s*<EventGuestListSheet/.test(src),
      `${name}: never {visible ? <Sheet/> : null} (re-mounts gorhom mid-gesture)`,
    );
    assertStringIncludes(src, "visible={guestSheetVisible}");
  }
});

// ── A-7 — the §4.6 belt-and-braces double gate on every wiring ──────────────

Deno.test("A-7 every screen gates the handler on privateGuestList + goingCount", () => {
  for (const [name, src] of SCREENS) {
    const idx = src.indexOf("privateGuestList !== true");
    assert(idx >= 0, `${name}: double gate present`);
    assert(
      /privateGuestList !== true &&[\s\S]{0,120}> 0\s*\?\s*handleSeeWhosGoing\s*:\s*undefined/.test(
        src,
      ),
      `${name}: handler passes ONLY when the card can render it usefully`,
    );
  }
});

// ── A-8 — fixed detent + fresh fetch (rapid open/close safety) ──────────────

Deno.test("A-8 fixed single detent and fresh-fetch-per-open stay pinned", () => {
  assertStringIncludes(SHEET, 'const GUEST_LIST_SNAP = ["70%"];');
  assert(!/"90%"|"50%"|"100%"/.test(SHEET), "single 70% detent only");
  assertStringIncludes(HOOK, "staleTime: 0");
  assertStringIncludes(HOOK, "gcTime: 0");
});
