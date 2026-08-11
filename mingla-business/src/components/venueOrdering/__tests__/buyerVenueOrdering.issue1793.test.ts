// ===========================================================================
// Issue #1793 (#1767 Phase 4) — BUYER WEB's guest-ordering contract.
//
// Structural, over the real sources, because the four things it protects are
// invisible to a render test and expensive to discover live:
//
//   T-1793-W1  the whole rail, and its landing page, stay anon
//   T-1793-W2  the sitting is written BEFORE the guest is sent away to pay
//   T-1793-W3  the redirect is a same-tab assignment, not a popup after an await
//   T-1793-W4  the return leg lands somewhere that EXISTS
//
// fails-on-revert: add a `useAuth` and W1 dies; move `persistSitting` below the
// redirect and W2 dies; swap `window.location.assign` for `Linking.openURL` and
// W3 dies; delete `app/o/venue/[orderId].tsx` and W4 dies.
// ===========================================================================

import fs from "fs";
import path from "path";

const repoRoot = path.join(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(repoRoot, rel), "utf8");
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const HOOK =
  "mingla-business/src/components/venueOrdering/useBuyerVenueOrdering.ts";
const SLOTS =
  "mingla-business/src/components/venueOrdering/BuyerVenueOrderingSlots.tsx";
const SERVICE = "mingla-business/src/services/venueOrderingService.ts";
const VENUE_ROUTE = "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx";
const ORDER_ROUTE = "mingla-business/app/o/venue/[orderId].tsx";
const MENU_HOOK = "mingla-business/src/hooks/usePublicMenuBundle.ts";

describe("T-1793-W1 — a diner has no account", () => {
  test.each([HOOK, SLOTS, SERVICE, ORDER_ROUTE, MENU_HOOK])(
    "%s calls no auth hook and imports no AuthContext",
    (rel) => {
      const src = stripComments(read(rel));
      expect(src).not.toMatch(/\buseAuth\w*\s*\(/);
      expect(src).not.toMatch(/from\s+["'][^"']*AuthContext["']/);
      expect(src).not.toMatch(/isAuthReady/);
    },
  );

  test("the order page sits OUTSIDE (tabs)/, which is the contract the dir name carries", () => {
    expect(fs.existsSync(path.join(repoRoot, ORDER_ROUTE))).toBe(true);
    expect(ORDER_ROUTE).not.toMatch(/\(tabs\)/);
    // `/o/` is already on PUBLIC_BUYER_ROUTE_PREFIXES, so the root auth gate
    // lets a logged-out guest through with NO change to that frozen list.
    const gates = read("mingla-business/src/utils/coldLoadAuthGates.ts");
    expect(gates).toContain('"/o/"');
  });

  test("the venue route's public menu read no longer travels through the auth-importing module", () => {
    const route = stripComments(read(VENUE_ROUTE));
    expect(route).toContain("usePublicMenuBundle");
    expect(route).not.toMatch(/usePublicMenus\s*\(/);
  });
});

describe("T-1793-W2 — the sitting survives the trip to the payment page", () => {
  const hook = stripComments(read(HOOK));

  test("persistSitting is called BEFORE the redirect, not after", () => {
    const persistAt = hook.indexOf("persistSitting({");
    const redirectAt = hook.indexOf("window.location.assign(url)");
    expect(persistAt).toBeGreaterThan(-1);
    expect(redirectAt).toBeGreaterThan(-1);
    // A hosted checkout takes the guest off this page and the browser may never
    // come back to it. Persisting after the redirect is persisting never.
    expect(persistAt).toBeLessThan(redirectAt);
  });

  test("what is persisted is ids, tokens and the guest's own choices — no server record", () => {
    expect(hook).toMatch(/sessionId: created\.sessionId/);
    expect(hook).toMatch(/buyerStatusToken: created\.buyerStatusToken/);
    expect(hook).toMatch(/guestCancelToken: created\.guestCancelToken/);
    expect(hook).not.toMatch(/totalCents:\s*created/);
    expect(hook).not.toMatch(/lines:\s*preview/);
  });
});

describe("T-1793-W3 — the redirect is a same-tab assignment", () => {
  const hook = stripComments(read(HOOK));

  test("web uses window.location.assign — the house pattern for every buyer-web payment", () => {
    expect(hook).toContain("window.location.assign(url)");
    // `Linking.openURL` on web resolves to window.open(url, "_blank",
    // "noopener") — a popup, opened after an await, which is exactly the shape a
    // popup blocker eats. It survives only as the NATIVE fallback.
    const webBlock = hook.slice(hook.indexOf('Platform.OS === "web"'));
    expect(webBlock.indexOf("window.location.assign")).toBeLessThan(
      webBlock.indexOf("Linking.openURL"),
    );
  });

  test("both providers are flattened to ONE redirect a caller cannot forget", () => {
    const service = stripComments(read(SERVICE));
    expect(service).toMatch(/hostedUrl: String\(data\.url \?\? ""\)/);
    expect(service).toMatch(/hostedUrl: String\(\s*data\.authorizationUrl \?\? "",?\s*\)/);
  });
});

describe("T-1793-W4 — the return leg lands somewhere that exists", () => {
  test("the edge function sends BOTH rails at /o/venue/{id}, and that route is real", () => {
    const create = read("supabase/functions/venue-order-create/index.ts");
    // Hosted checkout success.
    expect(create).toContain("${baseUrl}/o/venue/${orderId}?bst=");
    // The NG rail, re-pointed by this issue away from the 404 at /pay/callback.
    expect(create).toContain("${callbackOrigin}/o/venue/${");
    expect(create).not.toContain('"https://business.usemingla.com/pay/callback"');
    expect(fs.existsSync(path.join(repoRoot, ORDER_ROUTE))).toBe(true);
  });

  test("the landing page authorises by POSSESSION and polls for the webhook", () => {
    const route = stripComments(read(ORDER_ROUTE));
    expect(route).toMatch(/params\.bst/);
    expect(route).toContain("fetchVenueOrderStatus");
    expect(route).toContain("setInterval");
    // Never claims success or failure before the webhook lands.
    const pane = stripComments(read(
      "packages/brand-rendering/venueOrdering/VenueOrderStatusPane.tsx",
    ));
    expect(pane).toContain('live.paymentStatus === "pending"');
    expect(pane).toContain("Finishing your payment…");
  });

  test("a forwarded link can SHOW an order and can never refund one", () => {
    const route = stripComments(read(ORDER_ROUTE));
    // The URL carries the READ token only; the cancel token is never in it.
    expect(route).not.toMatch(/params\.\s*gct|guestCancelToken.*params/);
    expect(route).toContain("guestCancelToken");
    expect(route).toContain("localStorage");
  });
});

describe("T-1793-W5 — the money on screen is the server's, and only the server's", () => {
  test("no host file recomputes a total from the priced response", () => {
    for (const rel of [HOOK, SLOTS, ORDER_ROUTE]) {
      const src = stripComments(read(rel));
      expect(src).not.toMatch(/preview\.\w+Cents\s*[-+*/]/);
      expect(src).not.toMatch(/totals\.\w+Cents\s*[-+*/]/);
    }
  });

  test("the sticky bar shows the server's total or NO total — never a running sum", () => {
    const bar = stripComments(read(
      "packages/brand-rendering/venueOrdering/VenueOrderingStickyBar.tsx",
    ));
    expect(bar).toMatch(/totalCents === null \|\| currency === null/);
    expect(bar).toContain("See your order · ${count}");
    expect(bar).not.toMatch(/reduce|\+=/);
  });

  test("the review pane draws the venue's own service charge as its OWN line", () => {
    const pane = stripComments(read(
      "packages/brand-rendering/venueOrdering/VenueOrderReviewPane.tsx",
    ));
    // D-9 / P-19 — the venue's label, never "Fees & tax", never merged.
    expect(pane).toContain("label={preview.serviceChargeLabel}");
    expect(pane).toContain('label="Fees & tax"');
    expect(pane).toContain("money(preview.feesAndTaxCents)");
    // …and the tip is its own line too, outside both.
    expect(pane).toContain("money(preview.tipCents)");
  });
});
