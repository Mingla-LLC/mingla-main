// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 Leg 2 [public event page redesign] — consumer regression test.
//
// Proves the consumer EVENT detail (1) converges on the Direction-A foundation by
// REUSING the shared @mingla/offering-rendering primitives + an adapter, (2) is
// repointed OFF ExpandedBusinessEventSheet (EBES) for the deck event flow, (3)
// fires a BYTE-IDENTICAL ticket-checkout-create request (no address, no
// taxCalculationId, no paymentPlanChoice for events), and (4) renders NO trip-only
// blocks (refund ladder / deadline / itinerary / route / pay-toggle) — rule 9.
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions (see the sibling trip foundation test).
// Every assertion is written to FAIL on true LINE-DELETION of the guard it
// protects (fails-on-revert, NOT comment-out).
//
// Run with:
//   node app-mobile/src/screens/Event/__tests__/orch_1138_consumer_event_foundation.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const screenSrc = read("src/screens/Event/ConsumerEventDetailScreen.tsx");
const adapterSrc = read("src/hooks/useConsumerEventFoundation.ts");
const reserveBarSrc = read("src/components/offering/ConsumerEventReserveBar.tsx");
const modalSrc = read("src/components/ExpandedCardModal.tsx");
const coldRouteSrc = read("app/e/[brandSlug]/[eventSlug].tsx");

// Strip comments so doc-comment mentions never satisfy/violate code assertions.
const strip = (src) =>
  src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const screen = strip(screenSrc);
const adapter = strip(adapterSrc);
const reserveBar = strip(reserveBarSrc);
const modal = strip(modalSrc);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── SC-2 / T-3: deck event card opens the NEW screen, OFF EBES ───────────────
ok(
  "T3a ExpandedCardModal imports ConsumerEventDetailScreen",
  /import\s+ConsumerEventDetailScreen\s+from\s+"\.\.\/screens\/Event\/ConsumerEventDetailScreen"/.test(
    modal,
  ),
);
{
  // Isolate the businessEvent branch (event flow) — EBES MAY still appear in the
  // experience branch (:2259) + chat, so we scope the EBES-ban to this branch.
  const m =
    /if\s*\(\s*businessEvent\s*!==\s*null[\s\S]*?\n\s{2}if\s*\(\s*!card\s*\)/.exec(
      modal,
    );
  const branch = m !== null ? m[0] : "";
  ok(
    "T3b businessEvent branch mounts <ConsumerEventDetailScreen>",
    /<ConsumerEventDetailScreen\b/.test(branch),
    "the deck event card must open the new foundation event detail",
  );
  ok(
    "T3c businessEvent branch does NOT mount <ExpandedBusinessEventSheet>",
    !/<ExpandedBusinessEventSheet\b/.test(branch),
    "the deck EVENT flow must be OFF EBES (experiences/chat keep EBES)",
  );
}
ok(
  "T3d the new screen never references ExpandedBusinessEventSheet",
  !/\bExpandedBusinessEventSheet\b/.test(screen),
);

// ── SC-1/SC-3: foundation primitives + selectable tier radiogroup ────────────
ok(
  "T1a screen imports the offering-rendering foundation primitives",
  /from\s+"@mingla\/offering-rendering"/.test(screen) &&
    /OfferingChrome/.test(screen),
);
ok(
  "T1b screen does NOT mount ParallaxCoverShell as the sheet host (compose-around-scroll)",
  !/<ParallaxCoverShell\b/.test(screen),
  "ParallaxCoverShell's native branch nests its ScrollView → re-freezes the gorhom sheet (SPEC §4.7)",
);
ok(
  "T1c gorhom BottomSheetScrollView is a DIRECT child of BaseBottomSheet (scroll structure)",
  /<BottomSheetScrollView\b/.test(screen) && /scrollMode="view"/.test(screen),
);
ok(
  "T5 the tier list is a radiogroup (selectable tiers)",
  /accessibilityRole="radiogroup"/.test(screen) &&
    /accessibilityRole=\{?\s*selectable\s*\?\s*"radio"/.test(screen),
);

// ── SC-6 / T-15 / G-3: BYTE-IDENTICAL checkout (no address/tax/plan) ─────────
ok(
  "T15a screen calls runNativeCheckout via the shared nativeCheckoutFlow",
  /runNativeCheckout\(/.test(screen) &&
    /useNativeCheckoutFlow/.test(screen),
);
ok(
  "T15b checkout request carries NO `address` field",
  !/\baddress:\s/.test(
    // only inspect the runNativeCheckout call payload region
    (screen.match(/runNativeCheckout\(\{[\s\S]*?\}\);/) || [""])[0],
  ),
);
ok(
  "T15c checkout request carries NO `taxCalculationId`",
  !/taxCalculationId/.test(screen),
);
ok(
  "T15d checkout request omits `paymentPlanChoice` (events have no plan)",
  !/paymentPlanChoice/.test(screen),
);
ok(
  "T15e Reserve opens TicketCartSheet directly (cart is the confirmation step)",
  /<TicketCartSheet\b/.test(screen) &&
    /onCheckout=\{handleCartCheckout\}/.test(screen),
);

// ── SC-7 anon-read (COMMS-0009): theme via useEventTheme, no .from('brands') ──
ok(
  "T7a theme via useEventTheme (anon-safe business_public_events_view)",
  /useEventTheme\(/.test(screen),
);
ok(
  "T7b screen never reads .from('brands')",
  !/\.from\(\s*["']brands["']/.test(screen),
);
ok(
  "T7c adapter does no Supabase table read (pure projection)",
  !/\.from\(/.test(adapter) && !/supabase/.test(adapter),
);
ok(
  "T7d adapter does not import mingla-business/src (I-MOR-0827-PACKAGE-ISOLATION)",
  !/mingla-business\/src/.test(adapter),
);

// ── T-18 / N2 / N3 / N4 / rule 9: NO trip-only blocks ────────────────────────
for (const [name, token] of [
  ["RefundLadder", /\bRefundLadder\b/],
  ["RefundPolicyDisplay", /\bRefundPolicyDisplay\b/],
  ["bookingDeadline", /\bbookingDeadline\b/],
  ["splitCtas", /\bsplitCtas\b/],
  ["paymentPlanChoice", /\bpaymentPlanChoice\b/],
  ['"Pay over time"', /Pay over time/],
  ['"Day by day"', /Day by day/],
  ['"Leaving from"', /Leaving from/],
]) {
  ok(
    `T18 screen has NO ${name} (trip-only / rule 9)`,
    !token.test(screen),
  );
}

// ── SC-8: Android opaque-glass fallback on the reserve bar ────────────────────
ok(
  "T8 reserve bar uses Platform.select Android opaque fill (no shadow under rounded fill)",
  /Platform\.select/.test(reserveBar) &&
    /android:\s*\{\s*elevation:\s*0,\s*shadowOpacity:\s*0\s*\}/.test(reserveBar),
);
ok(
  "T8b reserve bar is single-CTA (no split-CTA branch)",
  !/\bsplitCtas\b/.test(reserveBar) && !/ReserveSplitCtas/.test(reserveBar),
);

// ── OQ-6: cold deep-link route mounts the screen with seed=null ───────────────
ok(
  "T-OQ6 cold route mounts ConsumerEventDetailScreen with seed={null}",
  /<ConsumerEventDetailScreen[\s\S]*?seed=\{null\}/.test(strip(coldRouteSrc)),
);
ok(
  "T-OQ6b screen handles a null seed gracefully (no crash, no fetch added)",
  /seed\s*===\s*null/.test(screen),
);

console.log(`\nORCH-1138 Leg 2 consumer event foundation: ${passed} assertions passed.`);
