/**
 * hostDesktopShellRoutes — #4420 (spec §3.4). Which desktop chrome a route gets.
 *
 *   "tabs"    — inside app/(tabs): its own layout already mounts the sidebar
 *               (BottomNav.web) and DesktopCanvas, so the root shell steps aside.
 *   "sidebar" — every other signed-in host route: the 248 grouped sidebar
 *               plus the web top bar.
 *   "rail"    — wizard and full-screen task routes: the 80 icon rail plus the
 *               web top bar.
 *   "none"    — left exactly as it is today: sign-in / auth, every public
 *               buyer route (e, t, b, exp, checkout*, pay, stay/[groupId],
 *               booking, rsvp, reserve, g, o, m, invite...), self-authenticating
 *               links, the door / scanner full-screen, wizards that already draw
 *               their own rail (event, RSVP, trip), and dev pages.
 *
 * Pure (no RN), so the route table is unit-tested. The desktop gate itself
 * stays in useResponsiveLayout (I-DESKTOP-GATE-VIA-HOOK); this only answers
 * "which chrome" once the caller already knows it is wide desktop and signed in.
 */

import {
  isPublicBuyerRoute,
  isSelfAuthenticatedExemptRoute,
  isSignInRoute,
} from "../../utils/coldLoadAuthGates";

import { isRailRoute } from "./desktopSidebarState";

export type HostDesktopShellMode = "tabs" | "sidebar" | "rail" | "none";

const segmentSafe = (pathname: string, base: string): boolean =>
  pathname === base || pathname.startsWith(`${base}/`);

/**
 * Route prefixes that stay chrome-free on desktop. The public buyer and
 * sign-in lists come from coldLoadAuthGates (one owner); these are the rest.
 */
const NONE_PREFIXES = [
  "/auth",
  "/stay", // /stay/[groupId] and /stay/pay/[token]: guest-facing stay pages
  "/rsvp", // public RSVP pages; the host RSVP wizard draws its own rail
  "/invite",
  "/join",
  "/attendance",
  "/accept-brand-invitation",
  "/accept-scanner-invitation",
  "/pending-brand-invite",
  "/connect-onboarding",
  "/connect-account-management",
  "/connect-partner-onboarding",
  "/connect-partner-account-management",
  "/connect-tax-registrations",
  "/stripe-onboarding-return",
  "/website-return",
  "/__styleguide",
  "/_sitemap",
] as const;

/** Door and scanner are full-screen tools on every platform. */
const FULL_SCREEN_TOOL_RE = /^\/event\/[^/]+\/(door|scanner)(\/|$)/;

/** Wizards that already draw their own 80 rail (EventCreatorWizard, RsvpCreatorWizard, TripCreatorWizard). */
const OWN_RAIL_WIZARD_RE = /^\/(event\/create|event\/[^/]+\/edit|trip\/create|trip\/[^/]+\/edit)(\/|$)/;

/** Wizard / full-screen routes that get the shell's 80 rail. */
const RAIL_RE = /^\/(brand\/new|venue\/create|experience\/create|experience\/[^/]+\/edit|experience\/snap)(\/|$)/;

export const hostDesktopShellModeFor = (
  pathname: string | null | undefined,
  segments: readonly string[],
): HostDesktopShellMode => {
  if (segments[0] === "(tabs)") return "tabs";
  const raw = (pathname ?? "").split("?")[0] ?? "";
  const path = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (path === "" || isSignInRoute(path)) return "none";
  if (isPublicBuyerRoute(path) || isSelfAuthenticatedExemptRoute(path)) return "none";
  if (NONE_PREFIXES.some((base) => segmentSafe(path, base))) return "none";
  if (/^\/(e|t|b|exp|g|o|m|pay|booking|reserve|refund)(\/|$)/.test(path)) return "none";
  if (/^\/checkout(-trip|-experience)?(\/|$)/.test(path)) return "none";
  if (FULL_SCREEN_TOOL_RE.test(path) || OWN_RAIL_WIZARD_RE.test(path)) return "none";
  if (/^\/event\/[^/]+\/preview(\/|$)/.test(path)) return "none";
  if (RAIL_RE.test(path) || isRailRoute(path)) return "rail";
  return "sidebar";
};
