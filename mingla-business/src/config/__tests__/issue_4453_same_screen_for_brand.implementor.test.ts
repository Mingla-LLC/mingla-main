// MINGLA-INVARIANT: I-4453-SWITCH-KEEPS-THE-SCREEN | issue #4453 | Switching brand on a brand-scoped Host screen opens the SAME screen for the chosen brand: /brand/<id>/website and its sub-routes open that brand's /website; Blast and Hub lists follow the current brand; one event, experience, venue, campaign, ad, template or a ?draft= composer falls back to its section's list; an unrecognised screen opens the brand's Home. A route that names a brand (/brand/<id>/..., or ?brandId= on a Host screen) is that brand's screen, and a public buyer route never is.
/**
 * #4453 (contract section I) — the route table behind the brand switcher.
 *
 * FAILS-ON-REVERT: make `sameScreenForBrand` return null for /brand/<id>/website
 * (the old behaviour: a pick only changed the store) and "website" fails; drop
 * the "new" guard in `brandIdFromRoute` and "/brand/new" reads as a brand.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/config/__tests__/issue_4453_same_screen_for_brand.implementor.test.ts
 */
import { describe, expect, test } from "@jest/globals";

import {
  WORKSPACE_BRAND_HOME,
  brandIdFromRoute,
  canOpenWorkspaceScreen,
  sameScreenForBrand,
  workspaceFallbackMessage,
  workspaceRoutePath,
  workspaceScreenAccess,
} from "../workspaceBrandRoutes";
import { MIN_RANK_FOR_TAB } from "../../utils/navTabGate";
import { MIN_RANK } from "../../utils/permissionGates";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";

const A = "11111111-1111-4111-8111-111111111111"; // Gameland Lagos
const B = "22222222-2222-4222-8222-222222222222"; // Lantern Room
const go = (pathname: string, params: Record<string, string | string[] | undefined> = {}, from: string | null = A) =>
  sameScreenForBrand(pathname, params, from, B);

describe("#4453 brandIdFromRoute", () => {
  test.each([
    [`/brand/${A}`, {}, A],
    [`/brand/${A}/website`, {}, A],
    [`/brand/${A}/website/pages`, { id: A }, A],
    [`/brand/${A}/payments/rel_1`, {}, A],
    ["/(tabs)/ari", { brandId: A, sitesIntent: "edit" }, A],
    ["/ari", { brandId: [A, B] }, A],
    ["/account/tap-to-pay", { brandId: A }, A],
    ["/people/import", { brandId: A, returnTo: "marketingPeople" }, A],
    ["/venue/deck-readiness", { brand_id: A }, A],
  ])("%s names its brand", (pathname, params, expected) => {
    expect(brandIdFromRoute(pathname, params)).toBe(expected);
  });

  test.each([
    ["/brand/new", { draft: A }],
    ["/brand", {}],
    ["/home", {}],
    ["/marketing/campaigns", {}],
    ["/ari", {}],
    ["/ari", { brandId: "" }],
    // The current-brand screens ignore a stray brandId in the query.
    ["/marketing/ads", { brandId: A }],
    // Public buyer routes never move the host's brand.
    [`/reserve/${A}`, { brandId: A }],
    [`/reserve/${A}/confirm`, { brandId: A }],
    ["/b/gameland-lagos", { brandSlug: "gameland-lagos" }],
    [`/event/${A}`, { id: A }],
  ])("%s does not name a brand", (pathname, params) => {
    expect(brandIdFromRoute(pathname, params)).toBeNull();
  });

  test("null and empty inputs are safe", () => {
    expect(brandIdFromRoute(null, null)).toBeNull();
    expect(brandIdFromRoute(undefined, undefined)).toBeNull();
    expect(brandIdFromRoute("", {})).toBeNull();
    expect(brandIdFromRoute("/brand/a%20b/website", {})).toBe("a b");
    expect(brandIdFromRoute("/brand/%E0%A4%A/website", {})).toBe("%E0%A4%A");
  });
});

describe("#4453 sameScreenForBrand — /brand/<id>/…", () => {
  test("the brand's own page", () => {
    expect(go(`/brand/${A}`)).toBe(`/brand/${B}`);
  });

  test.each([
    `/brand/${A}/website`,
    `/brand/${A}/website/pages`,
    `/brand/${A}/website/design`,
    `/brand/${A}/website/stories/story_9`,
    `/brand/${A}/website/destinations/new`,
    `/brand/${A}/website/preview?device=phone`,
    `/brand/${A}/website/setup?step=publish`,
    `/brand/${A}/website/ari`,
  ])("website: %s opens the other brand's website", (pathname) => {
    expect(go(pathname, { id: A, step: "publish", device: "phone" })).toBe(`/brand/${B}/website`);
  });

  test.each([
    "edit",
    "team",
    "audit-log",
    "blasts",
    "discounts",
    "discounts/report",
    "scanners",
    "pricing-defaults",
    "guest-chat",
    "listing",
    "payments",
    "payments/reports",
    "creators",
    "creators/roster",
    "creators/results",
    "referrals",
    "promote",
  ])("%s keeps the screen", (screen) => {
    expect(go(`/brand/${A}/${screen}`)).toBe(`/brand/${B}/${screen}`);
  });

  test("referrals keeps its tab; a listing-specific query is dropped", () => {
    expect(go(`/brand/${A}/referrals`, { id: A, tab: "rewards" })).toBe(`/brand/${B}/referrals?tab=rewards`);
    expect(go(`/brand/${A}/promote`, { id: A, kind: "event", listingId: "ev_1" })).toBe(`/brand/${B}/promote`);
    expect(go(`/brand/${A}/listing`, { id: A, venue: "v_1", focus: "feedback" })).toBe(`/brand/${B}/listing`);
  });

  test.each([
    [`/brand/${A}/payments/rel_123`, `/brand/${B}/payments`],
    [`/brand/${A}/payments/onboard`, `/brand/${B}/payments`],
    [`/brand/${A}/creators/gig_1/interest`, `/brand/${B}/creators`],
    [`/brand/${A}/creators/contract/c_1`, `/brand/${B}/creators`],
    [`/brand/${A}/creators/profile/cr_1`, `/brand/${B}/creators`],
    [`/brand/${A}/creators/brief`, `/brand/${B}/creators`],
    [`/brand/${A}/discounts/code_1`, `/brand/${B}/discounts`],
  ])("an entity tail falls back to its section: %s", (pathname, expected) => {
    expect(go(pathname)).toBe(expected);
  });

  test.each([
    `/brand/${A}/setup`,
    `/brand/${A}/connect`,
    `/brand/${A}/tap-to-pay/address`,
    `/brand/${A}/something-new`,
    "/brand/new",
  ])("%s has no twin for another brand: Home", (pathname) => {
    expect(go(pathname)).toBe(WORKSPACE_BRAND_HOME);
  });

  test("the route's brand decides, not the store's", () => {
    // The store still says Lantern Room (B) while the screen is Gameland's:
    // picking Lantern Room must leave Gameland's website, not no-op.
    expect(sameScreenForBrand(`/brand/${A}/website`, {}, B, B)).toBe(`/brand/${B}/website`);
    // Already on that brand's screen: nothing to do.
    expect(sameScreenForBrand(`/brand/${B}/website/pages`, {}, A, B)).toBeNull();
  });
});

describe("#4453 sameScreenForBrand — screens that follow the current brand", () => {
  test.each([
    "/home",
    "/(tabs)/home",
    "/analytics",
    "/hub",
    "/hub/events",
    "/hub/experiences",
    "/hub/trips",
    "/hub/listing",
    "/marketing",
    "/(tabs)/marketing",
    "/marketing/campaigns",
    "/marketing/ads",
    "/marketing/creators",
    "/marketing/people",
    "/marketing/referrals",
    "/marketing/templates",
    "/ari",
    "/ari/settings",
  ])("%s re-renders in place", (pathname) => {
    expect(go(pathname)).toBeNull();
  });

  test.each([
    ["/marketing/campaigns/cmp_1", {}, "/(tabs)/marketing/campaigns"],
    ["/marketing/campaigns/compose", { draft: "d_1" }, "/(tabs)/marketing/campaigns"],
    ["/marketing/campaigns/compose", {}, "/(tabs)/marketing/campaigns"],
    ["/marketing/ads/ad_1", { by: "plan" }, "/(tabs)/marketing/ads"],
    ["/marketing/ads/create", {}, "/(tabs)/marketing/ads"],
    ["/marketing/templates/tpl_1", {}, "/(tabs)/marketing/templates"],
    ["/marketing/something-new", {}, "/(tabs)/marketing"],
    ["/people/person_1", {}, "/(tabs)/marketing/people"],
    ["/people/groups/group_1", {}, "/(tabs)/marketing/people"],
    ["/people/import", { brandId: A }, "/(tabs)/marketing/people"],
    ["/hub/events/extra", {}, "/(tabs)/hub/events"],
    ["/hub/something-new", {}, "/(tabs)/hub/events"],
  ])("%s falls back to its list", (pathname, params, expected) => {
    expect(go(pathname, params)).toBe(expected);
  });

  test.each([
    ["/event/ev_1", "/(tabs)/hub/events"],
    ["/event/ev_1/orders/o_1", "/(tabs)/hub/events"],
    ["/event/create", "/(tabs)/hub/events"],
    ["/rsvp/r_1/guests", "/(tabs)/hub/events"],
    ["/experience/x_1", "/(tabs)/hub/experiences"],
    ["/experience/create", "/(tabs)/hub/experiences"],
    ["/trip/t_1/money", "/(tabs)/hub/trips"],
    ["/venue/v_1", "/(tabs)/hub/listing"],
    ["/venue/create", "/(tabs)/hub/listing"],
    ["/insights/l_1", "/(tabs)/analytics"],
  ])("one %s belongs to one brand: its list", (pathname, expected) => {
    expect(go(pathname)).toBe(expected);
  });

  test("a brand carried in the query moves with the switch", () => {
    expect(go("/ari", { brandId: A, sitesIntent: "edit", setupPart: "x", draft: "y" })).toBe(
      `/(tabs)/ari?brandId=${B}&sitesIntent=edit`,
    );
    expect(go("/ari", { brandId: A })).toBe(`/(tabs)/ari?brandId=${B}`);
    expect(go("/account/tap-to-pay", { brandId: A })).toBe(`/account/tap-to-pay?brandId=${B}`);
    expect(go("/account/tap-to-pay", {})).toBeNull();
  });

  test.each([
    "/account",
    "/account/edit-profile",
    "/account/notifications",
    "/notifications",
    "/messages",
    "/messages/conv_1",
    "/support/inbox",
    "/recent",
    "/team",
    "/partner/brands",
    "/promoting",
    "/",
  ])("%s is not about one brand: only the current brand changes", (pathname) => {
    expect(go(pathname)).toBeNull();
  });

  test("an unknown route opens the brand's Home", () => {
    expect(go("/something/brand-new")).toBe(WORKSPACE_BRAND_HOME);
    expect(go("/checkout/ev_1")).toBe(WORKSPACE_BRAND_HOME);
  });

  test("picking the brand you are on changes nothing", () => {
    expect(sameScreenForBrand("/marketing/campaigns/cmp_1", {}, B, B)).toBeNull();
    expect(sameScreenForBrand("/event/ev_1", {}, B, B)).toBeNull();
    expect(sameScreenForBrand("/something/brand-new", {}, B, B)).toBeNull();
    expect(sameScreenForBrand("/home", {}, A, "")).toBeNull();
  });

  test("an id is always encoded into the address", () => {
    expect(sameScreenForBrand("/brand/a/website", {}, "a", "b c/?")).toBe("/brand/b%20c%2F%3F/website");
  });
});

describe("#4453 who can open the same screen", () => {
  test("the thresholds mirror the screens' own gates", () => {
    expect(workspaceScreenAccess(`/brand/${B}/website`).minRank).toBe(MIN_RANK.WEBSITE_WORKSPACE);
    expect(workspaceScreenAccess("/(tabs)/marketing/ads").minRank).toBe(MIN_RANK_FOR_TAB.marketing);
    expect(workspaceScreenAccess("/(tabs)/hub/events").minRank).toBe(MIN_RANK_FOR_TAB.hub);
    expect(workspaceScreenAccess(`/(tabs)/ari?brandId=${B}`).minRank).toBe(MIN_RANK_FOR_TAB.ari);
    expect(workspaceScreenAccess(`/brand/${B}/team`).minRank).toBe(MIN_RANK.INVITE_TEAM_MEMBER);
    expect(workspaceScreenAccess(`/brand/${B}/audit-log`).minRank).toBe(MIN_RANK.VIEW_AUDIT_LOG);
    expect(workspaceScreenAccess(`/brand/${B}/payments`).minRank).toBe(BRAND_ROLE_RANK.finance_manager);
    expect(workspaceScreenAccess(`/brand/${B}`).minRank).toBe(0);
  });

  test("a scanner cannot open the website; a marketing manager can", () => {
    expect(canOpenWorkspaceScreen(`/brand/${B}/website`, BRAND_ROLE_RANK.scanner)).toBe(false);
    expect(canOpenWorkspaceScreen(`/brand/${B}/website`, BRAND_ROLE_RANK.marketing_manager)).toBe(true);
    expect(canOpenWorkspaceScreen("/(tabs)/hub/events", BRAND_ROLE_RANK.marketing_manager)).toBe(false);
    expect(canOpenWorkspaceScreen("/(tabs)/hub/events", BRAND_ROLE_RANK.brand_owner)).toBe(true);
  });

  test("venue staff only ever get Home; everyone gets Home", () => {
    expect(canOpenWorkspaceScreen(`/brand/${B}`, BRAND_ROLE_RANK.venue_staff)).toBe(false);
    expect(canOpenWorkspaceScreen(WORKSPACE_BRAND_HOME, BRAND_ROLE_RANK.venue_staff)).toBe(true);
    expect(canOpenWorkspaceScreen("/home", 0)).toBe(true);
  });

  test("the toast says why, in plain words", () => {
    expect(workspaceFallbackMessage("Lantern Room", `/brand/${B}/website`)).toBe(
      "Your role at Lantern Room doesn't include the website. You're on its Home instead.",
    );
    expect(workspaceFallbackMessage("Lantern Room", "/(tabs)/marketing/ads")).toContain("doesn't include Blast");
  });

  test("workspaceRoutePath ignores groups, the query and a trailing slash", () => {
    expect(workspaceRoutePath("/(tabs)/hub/events?x=1")).toBe("/hub/events");
    expect(workspaceRoutePath("/hub/events/")).toBe("/hub/events");
    expect(workspaceRoutePath(null)).toBe("/");
  });
});
