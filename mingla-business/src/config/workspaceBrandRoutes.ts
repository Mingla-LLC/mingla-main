/**
 * #4453 (contract section I) — route metadata for the workspace brand switcher.
 *
 * Two questions, answered from the pathname and the route's params alone:
 *   1. `brandIdFromRoute` — does this screen name a brand? Then that brand is
 *      the one being edited, whatever the current-brand store says.
 *   2. `sameScreenForBrand` — the host is on this screen and picks another
 *      brand: where is "the same screen" for that brand?
 *
 * Dependency-free and pure (no React, no React Native, no router), so the
 * whole table is unit-tested in the node jest lane.
 */

// The route's own brand (and the path helpers) live in workspaceBrandRoute.ts,
// the small part the app shell loads at boot; this file is the switcher's.
import { brandIdFromRoute, firstParam as one, workspacePathSegments, workspaceRoutePath, type WorkspaceRouteParams } from "./workspaceBrandRoute";

export {
  brandIdFromRoute,
  workspacePathSegments,
  workspaceRoutePath,
  type WorkspaceRouteParams,
} from "./workspaceBrandRoute";

/** Home for any brand: the Home tab reads the current brand. */
export const WORKSPACE_BRAND_HOME = "/(tabs)/home";

/** `/brand/<id>/<these>` exist for every brand: switching keeps the screen. */
const BRAND_SCREENS: ReadonlySet<string> = new Set([
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
]);

/** A deeper screen under one of these falls back to the section's own list. */
const BRAND_SECTION_ROOTS: ReadonlySet<string> = new Set([
  "payments",
  "creators",
  "discounts",
]);

/** Blast sections (the Promote workspace); each is a list for the current brand. */
const BLAST_SECTIONS: ReadonlySet<string> = new Set([
  "campaigns",
  "ads",
  "creators",
  "people",
  "referrals",
  "templates",
]);

const HUB_SECTIONS: ReadonlySet<string> = new Set([
  "events",
  "experiences",
  "trips",
  "listing",
]);

/** One event, RSVP, experience, trip or venue belongs to one brand only. */
const ENTITY_SECTION_ROOT: Readonly<Record<string, string>> = {
  event: "/(tabs)/hub/events",
  rsvp: "/(tabs)/hub/events",
  experience: "/(tabs)/hub/experiences",
  trip: "/(tabs)/hub/trips",
  venue: "/(tabs)/hub/listing",
  insights: "/(tabs)/analytics",
};

/** Signed-in screens that are about the person, not about one brand. */
const NOT_BRAND_SCOPED: ReadonlySet<string> = new Set([
  "",
  "home",
  "analytics",
  "account",
  "notifications",
  "messages",
  "support",
  "recent",
  "team",
  "partner",
  "promoting",
]);

const enc = encodeURIComponent;

/**
 * The same screen for another brand.
 *
 * Returns the address to open, or `null` when the screen simply follows the
 * current brand (it re-renders by itself once the store changes) or when
 * nothing would change.
 *
 * - `/brand/<id>/website/**` opens the other brand's `/website`.
 * - `/brand/<id>/<screen>` keeps the screen when every brand has it; a deeper
 *   screen (one payout, one creator) falls back to that section's list.
 * - Blast lists (campaigns, ads, creators, people, referrals, templates) and
 *   Hub lists follow the store; one campaign, ad, template or a composer
 *   (`?draft=`) falls back to its section's list.
 * - One event, RSVP, experience, trip or venue falls back to its Hub list.
 * - Anything unrecognised opens the brand's Home.
 */
export function sameScreenForBrand(
  pathname: string | null | undefined,
  params: WorkspaceRouteParams | null | undefined,
  fromBrandId: string | null | undefined,
  toBrandId: string,
): string | null {
  if (toBrandId.length === 0) return null;
  const segments = workspacePathSegments(pathname);
  const head = segments[0] ?? "";
  const to = enc(toBrandId);

  if (head === "brand") {
    const here = brandIdFromRoute(pathname, params);
    // `/brand/new` (the create flow) belongs to no brand: leave it for Home.
    if (here === null) return WORKSPACE_BRAND_HOME;
    if (here === toBrandId) return null;
    const rest = segments.slice(2);
    if (rest.length === 0) return `/brand/${to}`;
    if (rest[0] === "website") return `/brand/${to}/website`;
    const screen = rest.join("/");
    if (BRAND_SCREENS.has(screen)) {
      const tab = screen === "referrals" ? one(params?.tab) : null;
      return `/brand/${to}/${screen}${tab !== null ? `?tab=${enc(tab)}` : ""}`;
    }
    if (BRAND_SECTION_ROOTS.has(rest[0] ?? "")) return `/brand/${to}/${rest[0]}`;
    return WORKSPACE_BRAND_HOME;
  }

  if (fromBrandId === toBrandId) return null;

  if (head === "marketing") {
    const section = segments[1];
    if (section === undefined) return null;
    if (!BLAST_SECTIONS.has(section)) return "/(tabs)/marketing";
    return segments.length === 2 ? null : `/(tabs)/marketing/${section}`;
  }
  // A person, a group or an import all sit under Blast › People.
  if (head === "people") return "/(tabs)/marketing/people";

  if (head === "hub") {
    if (segments.length === 1) return null;
    return segments.length === 2 && HUB_SECTIONS.has(segments[1] ?? "")
      ? null
      : "/(tabs)/hub/events";
  }

  if (head === "ari") {
    // `/ari/settings` is the person's own Ari settings.
    if (segments.length > 1) return null;
    if (one(params?.brandId) === null) return null;
    const intent = one(params?.sitesIntent);
    return `/(tabs)/ari?brandId=${to}${intent !== null ? `&sitesIntent=${enc(intent)}` : ""}`;
  }

  if (head === "account") {
    return segments[1] === "tap-to-pay" && one(params?.brandId) !== null
      ? `/account/tap-to-pay?brandId=${to}`
      : null;
  }

  const sectionRoot = ENTITY_SECTION_ROOT[head];
  if (sectionRoot !== undefined) return sectionRoot;
  if (NOT_BRAND_SCOPED.has(head)) return null;
  return WORKSPACE_BRAND_HOME;
}

// Rank values mirror `BRAND_ROLE_RANK` (src/utils/brandRole.ts) and the gates
// the screens themselves apply (navTabGate, permissionGates). Restated here so
// this module stays dependency-free; the unit test pins the two together.
const RANK_MARKETING = 20;
const RANK_FINANCE = 30;
const RANK_ADMIN = 50;
const RANK_VENUE_STAFF = -1;

export interface WorkspaceScreenAccess {
  /** The lowest role rank that can open the screen. */
  minRank: number;
  /** How the toast names the screen: "Your role … doesn't include <name>." */
  name: string;
}

/** What a member needs to open `href` (an address `sameScreenForBrand` returned). */
export function workspaceScreenAccess(href: string): WorkspaceScreenAccess {
  const segments = workspacePathSegments(href);
  const head = segments[0] ?? "";
  if (head === "brand") {
    const section = segments[2];
    if (section === "website") return { minRank: RANK_MARKETING, name: "the website" };
    if (section === "team" || section === "audit-log") {
      return { minRank: RANK_ADMIN, name: "team settings" };
    }
    if (section === "payments") return { minRank: RANK_FINANCE, name: "payments" };
    if (section === "creators" || section === "referrals" || section === "promote" || section === "blasts") {
      return { minRank: RANK_MARKETING, name: "Blast" };
    }
    return { minRank: 0, name: "this screen" };
  }
  if (head === "marketing") return { minRank: RANK_MARKETING, name: "Blast" };
  if (head === "hub") return { minRank: RANK_FINANCE, name: "the Hub" };
  if (head === "ari") return { minRank: RANK_FINANCE, name: "Ari" };
  return { minRank: 0, name: "this screen" };
}

/**
 * Can a member with this role rank open `href`? Venue staff (a negative
 * sentinel rank) only ever get Home.
 */
export function canOpenWorkspaceScreen(href: string, rank: number): boolean {
  if (workspaceRoutePath(href) === workspaceRoutePath(WORKSPACE_BRAND_HOME)) return true;
  if (rank === RANK_VENUE_STAFF) return false;
  return rank >= workspaceScreenAccess(href).minRank;
}

/** The toast shown when the chosen brand cannot open the same screen. */
export function workspaceFallbackMessage(brandName: string, href: string): string {
  return `Your role at ${brandName} doesn't include ${workspaceScreenAccess(href).name}. You're on its Home instead.`;
}
