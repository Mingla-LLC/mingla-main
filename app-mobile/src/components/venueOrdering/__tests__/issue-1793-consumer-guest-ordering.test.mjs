// ===========================================================================
// Issue #1793 (#1767 Phase 4) — the CONSUMER app's guest-ordering contract.
//
// app-mobile has no jest, so this is a `node --test` structural suite over the
// real sources. What it protects is not pixels but four rules that a runtime
// test on a simulator would only find by accident:
//
//   T-1793-N1  the guest rail never asks a diner to sign in
//   T-1793-N2  the payment step lives OUTSIDE the shared renderers
//   T-1793-N3  the Pay button is dead until the SERVER has priced the basket
//   T-1793-N4  the scanned spot and the entry source are read, and kept apart
//
// fails-on-revert: add a `useAuth` to the hook and N1 dies; move the payment
// sheet into `packages/brand-rendering/venueOrdering/` and N2 dies; drop
// `priced &&` from the Pay gate and N3 dies; stop reading `?spot=` and N4 dies.
// ===========================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..", "..", "..");
const repoRoot = path.resolve(appRoot, "..");

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const HOOK = "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts";
const SLOTS =
  "app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx";
const SERVICE = "app-mobile/src/services/venueOrderingService.ts";
const ROUTE = "app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx";

// ---------------------------------------------------------------------------
test("T-1793-N1 — a diner has no account, so nothing on this rail asks for one", () => {
  for (const rel of [HOOK, SLOTS, SERVICE, ROUTE]) {
    const src = stripComments(read(rel));
    assert.doesNotMatch(
      src,
      /\buseAuth\w*\s*\(/,
      `${rel} must not call an auth hook — the guest ordering rail is anon`,
    );
    assert.doesNotMatch(
      src,
      /from\s+["'][^"']*AuthContext["']/,
      `${rel} must not import AuthContext`,
    );
    assert.doesNotMatch(
      src,
      /redirect[^\n]*sign-?in/i,
      `${rel} must never send a guest to sign-in`,
    );
  }
});

test("T-1793-N1b — the route stays OUTSIDE the tab host, where anon buyer routes live", () => {
  assert.ok(fs.existsSync(path.join(repoRoot, ROUTE)));
  assert.doesNotMatch(ROUTE, /\(tabs\)/);
});

// ---------------------------------------------------------------------------
test("T-1793-N2 — the payment step is host-owned; the shared renderers never touch money", () => {
  // The host names the payment rail, and that is exactly where it belongs
  // (SPEC #1788 P-61: the payment STEP lives in separately-named components the
  // gate is never pointed at).
  const hook = stripComments(read(HOOK));
  assert.match(hook, /@stripe\/stripe-react-native/);
  assert.match(hook, /initPaymentSheet|presentPaymentSheet/);

  // And no file under the shared ordering folder does.
  const dir = path.join(repoRoot, "packages", "brand-rendering", "venueOrdering");
  const files = fs.readdirSync(dir).filter((name) => /\.tsx?$/.test(name));
  assert.ok(files.length >= 8, "the shared ordering folder must exist and be real");
  for (const name of files) {
    const src = stripComments(fs.readFileSync(path.join(dir, name), "utf8"));
    assert.doesNotMatch(src, /\bstripe\b/i, `${name} may not name a provider`);
    assert.doesNotMatch(src, /paymentsheet/i, `${name} may not name a payment sheet`);
    assert.doesNotMatch(src, /application_fee/i, `${name} may not name a fee`);
  }
});

test("T-1793-N2b — the connected account is re-initialised before the sheet opens", () => {
  const hook = stripComments(read(HOOK));
  // Without this the mid-sheet confirm hits the PLATFORM context and the
  // connected-account secret is rejected (ORCH-0844). It is the one line whose
  // absence produces a payment that fails only in production.
  assert.match(hook, /initStripe\(\{[\s\S]*stripeAccountId/);
  assert.match(hook, /merchantIdentifier/);
  assert.match(hook, /urlScheme/);
});

// ---------------------------------------------------------------------------
test("T-1793-N3 — the Pay button is dead until the SERVER has priced this basket", () => {
  const pane = stripComments(read(
    "packages/brand-rendering/venueOrdering/VenueOrderReviewPane.tsx",
  ));
  // `priced` is `previewStatus === "ready" && preview !== null` and it gates
  // BOTH the totals block and the button. A stale price behind a live button is
  // how a guest is charged a number they never saw.
  assert.match(pane, /const priced = previewStatus === "ready" && preview !== null/);
  assert.match(pane, /const canPay = priced &&/);
  assert.match(pane, /disabled=\{!canPay\}/);
  // And when it is not priced there is no number at all, only an honest line.
  assert.match(pane, /Working out the total…/);
});

test("T-1793-N3b — the price is re-fetched whenever anything that moves a number moves", () => {
  const hook = stripComments(read(HOOK));
  assert.match(hook, /priceSignature/);
  assert.match(hook, /queryKey: \["venueOrderPreview", priceSignature\]/);
  // Never served stale to a different basket.
  assert.match(hook, /staleTime: 0/);
  assert.match(hook, /gcTime: 0/);
});

// ---------------------------------------------------------------------------
test("T-1793-N4 — the spot and the entry source are read, and kept apart", () => {
  const route = stripComments(read(ROUTE));
  assert.match(route, /params\.spot/);
  assert.match(route, /params\.src/);
  assert.match(route, /spotCode/);
  assert.match(route, /entrySource/);
  // D-3a — two different facts, two different fields on the request.
  const hook = stripComments(read(HOOK));
  assert.match(hook, /spotCode: config\.spotState === "ok" \? input\.spotCode : null/);
  assert.match(hook, /entrySource: input\.entrySource/);
});

test("T-1793-N4b — a spot the server did not confirm is NOT sent as a spot", () => {
  // The guest may still order — as a counter guest — but the order is never
  // stamped with a spot Mingla could not resolve. Provenance is RECORDED, never
  // inferred (D-3a), and an unconfirmed code is not a record.
  const hook = stripComments(read(HOOK));
  assert.match(hook, /config\.spotState === "ok" \? input\.spotCode : null/);
});

// ---------------------------------------------------------------------------
test("T-1793-N5 — the guest-facing failure is the SENTENCE, never the machine code", () => {
  const service = stripComments(read(SERVICE));
  // The rail answers { error: <code>, message: <copy> }, and the app's generic
  // extractor prefers `error` — which would show a diner the literal string
  // `buyer_phone_required`. This rail reads its own bodies.
  assert.match(service, /parseVenueOrderFailureBody/);
  assert.doesNotMatch(service, /extractFunctionError/);
});

test("T-1793-N6 — the ordering renderers are lazily hosted, in the ROUTE", () => {
  const route = stripComments(read(ROUTE));
  assert.match(route, /React\.lazy/);
  assert.match(route, /ConsumerVenueOrderingSlots/);
  // The shared screen may never code-split: that belongs where the bundle is
  // measured (i-1047-biz-bundle-budget-deferral).
  const screen = stripComments(
    read("packages/brand-rendering/PublicVenueScreen.tsx"),
  );
  assert.doesNotMatch(screen, /React\.lazy/);
  assert.doesNotMatch(screen, /ConsumerVenueOrdering|BuyerVenueOrdering/);
});

test("T-1793-N7 — the sitting persists IDs and tokens, never a server record", () => {
  const hook = stripComments(read(HOOK));
  assert.match(hook, /AsyncStorage/);
  assert.match(hook, /serialiseVenueOrderSitting/);
  // Zustand persist is for client state; this is neither a store nor a snapshot
  // of one (feedback_zustand_persist_no_server_snapshots).
  assert.doesNotMatch(hook, /src\/store\//);
  const sitting = stripComments(read(
    "packages/brand-rendering/venueOrdering/venueOrderingSitting.ts",
  ));
  for (const forbidden of ["totalCents", "subtotalCents", "lines", "menu"]) {
    assert.doesNotMatch(
      sitting,
      new RegExp(`\\b${forbidden}\\b\\s*:`),
      `the sitting may not carry ${forbidden} — that is a server record`,
    );
  }
});
