/**
 * appLink — THE single owner of the "Open in Mingla" destination in every
 * transactional email. Issue #2240.
 *
 * ─── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * Three templates each hand-wrote `https://usemingla.com/orders/{id}/chat`
 * TWICE (once in the HTML body, once in the plain-text body) — SIX literals for
 * ONE destination. That destination has never existed: there is no `orders`
 * route in `mingla-marketing/app` and no rewrite or redirect to one in
 * `mingla-marketing/next.config.ts`. Measured against production 2026-08-18:
 *
 *     GET https://usemingla.com/orders/<order-uuid>/chat  ->  HTTP 404
 *
 * So every ticket, experience and trip confirmation email ever sent carried a
 * dead button. #2217 found and fixed the SAME literal on the confirmation
 * *page*; it did not touch these templates, which carried their own copies.
 *
 * ─── WHY ONE MODULE, AND WHY THE MARKUP LIVES HERE TOO ──────────────────────
 *
 * Six copies is the reason three of them were still wrong after #2217 fixed the
 * fourth. This module owns the URL *and* the CTA markup, so a template cannot
 * express "Open in Mingla" without calling in here — there is no partial reuse
 * that leaves a hand-written `<a href>` behind. The three CTA blocks were
 * already byte-identical markup (ticket interpolated `BRAND_ORANGE_BUTTON`,
 * trip and experience hard-coded its value `#C4471A`), so collapsing them
 * loses nothing.
 *
 * `.github/scripts/strict-grep/i-2240-email-app-link-sole-owner.mjs` makes the
 * seventh copy impossible: it bans the dead `usemingla.com/orders/` literal
 * repository-wide and bans any app-destination literal under
 * `supabase/functions/_shared/email/` outside THIS file.
 *
 * ─── WHY THIS URL, AND NOT A UA SWITCH ──────────────────────────────────────
 *
 * An email cannot run JavaScript and cannot read a User-Agent, so the device
 * decision has to happen AT THE DESTINATION. `usemingla.com/download` is the
 * ORCH-1319 smart-download route — a Next.js SERVER component
 * (`mingla-marketing/app/download/page.tsx`) that reads the request UA header
 * and 307s per device. Measured against production 2026-08-18:
 *
 *     iPhone UA  -> 307 -> https://apps.apple.com/app/id6760440898
 *     Android UA -> 307 -> https://play.google.com/store/apps/details?id=com.mingla.app.v2
 *     desktop UA -> 200    (the QR + both store badges page)
 *
 * ─── WHY IT IS THE SAME DESTINATION AS THE #2217 PAGE BUTTON ────────────────
 *
 * #2217's `resolveConfirmationAppTarget(entity, platform)` in
 * `mingla-business/src/services/guestFunnelLink.ts` resolves the confirmation
 * page's ONE button. While `GUEST_FUNNEL_ONELINK_URL` is null (DARK, today) it
 * returns APP_STORE_URL for 'ios', PLAY_STORE_URL for 'android', and
 * DOWNLOAD_PAGE_URL for 'other'.
 *
 * `'other'` is precisely the platform an email knows: none. And the three
 * destinations `/download` resolves to are byte-identical to the three the page
 * button resolves to. One destination, one owner — this module is
 * `resolveConfirmationAppTarget(e, 'other').ctaUrl` evaluated in Deno, where
 * that module cannot be imported.
 *
 * WHY IT IS COPIED RATHER THAN IMPORTED. `guestFunnelLink.ts` lives in the
 * Expo/npm `mingla-business` package; these templates are bundled by
 * `supabase functions deploy`. Reaching across would put an app-package file in
 * the deploy graph, so the value is mirrored here and the gate above enforces
 * the correspondence — the same cross-package technique
 * `orch-1342-store-links-ssot.mjs` already uses to keep the mingla-business and
 * mingla-marketing store SSOTs from drifting.
 *
 * ⚠️ THE GO-LIVE FLIP IS ENFORCED, NOT REMEMBERED. The gate does not merely
 * byte-compare against `DOWNLOAD_PAGE_URL`; it reads
 * `GUEST_FUNNEL_ONELINK_URL` and requires whichever arm
 * `resolveConfirmationAppTarget(e, 'other')` would take:
 *
 *     GUEST_FUNNEL_ONELINK_URL === null  ->  this must equal DOWNLOAD_PAGE_URL
 *     GUEST_FUNNEL_ONELINK_URL !== null  ->  this must be on the OneLink base
 *
 * So the moment Seth flips that constant at AppsFlyer go-live (COMMS-0083), CI
 * goes RED until this file follows the page. That is what keeps "one
 * destination, one owner" true across a boundary the two runtimes cannot import
 * across.
 *
 * ⚠️ DO NOT "UPGRADE" THIS TO THE ONELINK BY HAND, AHEAD OF THAT FLIP.
 * `go.usemingla.com/w36m` is live and device-aware, but it is NOT what the page
 * button emits today, and on a DESKTOP UA it 301s to the iOS App Store
 * (curl-verified 2026-08-18) — a desktop buyer would be dropped on a mobile
 * store listing, which `resolveConfirmationAppTarget` explicitly refuses to do
 * for 'other'.
 */

import { SHELL_TOKENS } from "./shell.ts";

const { BRAND_ORANGE_BUTTON } = SHELL_TOKENS;

/**
 * THE destination. Mirrors `DOWNLOAD_PAGE_URL` in
 * `mingla-business/src/constants/storeLinks.ts` (byte-compared by
 * `i-2240-email-app-link-sole-owner.mjs`), which is what
 * `resolveConfirmationAppTarget` hands a caller that cannot name a platform.
 *
 * NEVER interpolate an order id, a slug, or any per-buyer value into this URL.
 * Nothing on this path is per-order: the ticket is reconnected to the account
 * AFTER install by #2217's `attendance-claim-identity`, which matches the
 * account's own provider-verified email/phone against the order. A per-order
 * secret in an email link would be readable by every forwarding hop.
 */
export const MINGLA_APP_LINK_URL = "https://usemingla.com/download";

/**
 * The CTA copy, as a CLOSED UNION rather than a `string`.
 *
 * The headline is interpolated into HTML without escaping, so accepting a bare
 * `string` would be an injection seam the moment someone passed a brand or
 * buyer value through it. A union of the three literals the product actually
 * uses makes that unrepresentable — `renderAppCtaHtml(\`… ${brand.name} …\`)`
 * does not compile — which is a stronger guarantee than a lint rule and needs
 * no gate to enforce it. The trip template picks between two members with a
 * ternary rather than building its noun by interpolation.
 */
export type AppCtaHeadline =
  | "Join your event chat in the Mingla app"
  | "Join your trip chat in the Mingla app"
  | "Your ticket + details are in the Mingla app";

/** The whole CTA block — the ONLY way an email may render "Open in Mingla". */
export function renderAppCtaHtml(headline: AppCtaHeadline): string {
  return `<div style="margin-top:32px;padding:24px;background:#FFF5EC;border-radius:12px;border:1px solid #FFD9B8;text-align:center;">
    <p style="margin:0;font-size:15px;color:#6B5A47;">${headline}</p>
    <a href="${MINGLA_APP_LINK_URL}"
       style="display:inline-block;margin-top:12px;padding:12px 24px;background:${BRAND_ORANGE_BUTTON};color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
      Open in Mingla
    </a>
  </div>`;
}

/**
 * The plain-text twin. #2240's requirement is that the text body carry the SAME
 * working link as the HTML — both come from `MINGLA_APP_LINK_URL` above, so
 * they cannot diverge.
 */
export function appCtaTextLine(headline: AppCtaHeadline): string {
  return `${headline}: ${MINGLA_APP_LINK_URL}`;
}
