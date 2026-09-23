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
 *
 * ISSUE #3524/#3525 — THE FLIP WAS ATTEMPTED AND IS BLOCKED. RE-MEASURED
 * 2026-09-21 AND AGAIN 2026-09-22 (identical both times, by two different
 * agents) against
 * `https://go.usemingla.com/w36m?pid=email&c=ticket_confirmation`
 * with three desktop user-agents. All three land on an iOS App Store listing:
 *
 *   Windows / Chrome 140  -> HTTP 301  Location: https://apps.apple.com/US/app/id6760440898?mt=8
 *   Linux   / Firefox 131 -> HTTP 301  Location: https://apps.apple.com/US/app/id6760440898?mt=8
 *   macOS   / Safari 18.6 -> HTTP 200, and the body scripts to
 *                            https://apps.apple.com/US/app/id6760440898?mt=8&c=ticket_confirmation&pid=email
 *
 * The AppsFlyer template `w36m` DECLARES `Default: https://usemingla.com/download`,
 * and that default is not being honoured for desktop traffic. `usemingla.com/download`
 * appears nowhere in any of the three responses.
 *
 * SO THE FIX IS NOT CODE. It is the template's own desktop/default redirect, in
 * the AppsFlyer account. Until that is corrected, flipping this constant would
 * send every desktop recipient of a ticket confirmation to an iPhone store
 * listing — exactly what Seth's #3524 decision 5 forbids.
 *
 * DO NOT WORK AROUND IT by pointing the email somewhere else:
 * `i-2240-email-app-link-sole-owner.mjs` enforces that the email and the
 * confirmation page land in the SAME place, and breaking that is a separate
 * decision. #3524 hardens the PAGE side regardless — `resolveConfirmationAppTarget`
 * and the new `resolveClaimPageTarget` now return the download page for
 * `platform === 'other'` on BOTH arms — so a desktop buyer on a Mingla surface is
 * safe whatever this constant becomes.
 */

import { escapeHtml } from "./escape.ts";
import { SHELL_TOKENS } from "./shell.ts";

const { BRAND_ORANGE_BUTTON } = SHELL_TOKENS;

/**
 * ─── #3524 FOLLOW-UP: ONE BLOCK, AND IT CARRIES THE REAL LINK ────────────────
 *
 * Until this change a ticket confirmation shipped TWO competing calls to
 * action. This module rendered "Open in Mingla" at the bottom of the body,
 * pointing at the download page; and then `ticket-confirmation-dispatch`
 * CONCATENATED a second "Connect your attendance" block onto the finished body,
 * pointing at the per-order claim URL. The marketed button went nowhere useful
 * and the useful link was an afterthought below the fold.
 *
 * It was bolted on at the end for a real reason: the claim URL is minted AFTER
 * the body is rendered, because minting is a write against
 * `issue_order_attendance_claim_proof_v2` and the mint ORDER matters (#3551 —
 * the checkout confirm screen mints too, and whichever ran second used to
 * overwrite the other's proof). So the fix is NOT to mint earlier. It is to let
 * the caller thread the already-minted URL INTO the render: every template now
 * takes an optional claim URL and hands it to `renderAppCtaHtml` /
 * `appCtaTextLine`, and the dispatch re-renders the body once the mint has
 * returned instead of appending a second block to it.
 *
 * THE FALLBACK IS A PRODUCT DECISION, NOT A CONVENIENCE. An order can legitimately
 * have no claim URL — the buyer already has an account, or the confirm screen
 * armed the proof first and the dispatch's issuance came back `already_issued`.
 * In that case the block still renders and the button falls back to
 * `MINGLA_APP_LINK_URL`. A confirmation email must never lose its route into the
 * app, so `resolveAppCtaUrl` has no "no link" arm at all.
 *
 * ⚠️ AND YES, A PER-ORDER CREDENTIAL NOW TRAVELS IN THIS BUTTON. This module used
 * to argue the opposite — that a per-order secret in an email link is readable by
 * every forwarding hop — and that argument was about interpolating an id into the
 * DOWNLOAD PAGE's path, which is still forbidden (see `MINGLA_APP_LINK_URL`
 * below). What travels here is the #871/#3524 attendance claim URL: a
 * purpose-built credential that is hashed at rest under a pepper ring, rotatable,
 * expiring, and issued by `issue_order_attendance_claim_proof_v2` precisely so it
 * CAN be emailed. It was already being emailed — by the second block this change
 * removes, and by `attendance-claim-backfill`'s recovery notice. Nothing is newly
 * exposed; the link moved from a card below the footer onto the one button the
 * email already had.
 */

/**
 * The FALLBACK destination, and the sole app-destination literal in the
 * repository's email layer. Mirrors `DOWNLOAD_PAGE_URL` in
 * `mingla-business/src/constants/storeLinks.ts` (byte-compared by
 * `i-2240-email-app-link-sole-owner.mjs`), which is what
 * `resolveConfirmationAppTarget` hands a caller that cannot name a platform.
 *
 * NEVER interpolate an order id, a slug, or any per-buyer value into THIS URL.
 * Nothing on this path is per-order. A per-order value belongs in the claim URL
 * the caller passes to `resolveAppCtaUrl`, which is minted per order, single-use
 * and revocable — not spliced into the download page's path.
 */
export const MINGLA_APP_LINK_URL = "https://usemingla.com/download";

/**
 * THE ONE PLACE the CTA's destination is decided. `renderAppCtaHtml` and
 * `appCtaTextLine` both call it and neither may name a URL of its own, which is
 * what keeps #2240's plain-text twin in lockstep with the HTML by construction
 * rather than by review. The gate enforces exactly that: see rule 6 in
 * `i-2240-email-app-link-sole-owner.mjs`.
 *
 * The claim URL arrives as a `string` because it is minted at runtime and cannot
 * be a closed union, so this is the module's one open input. It is therefore
 * VALIDATED rather than trusted: anything that is not a non-empty `https://`
 * URL degrades to `MINGLA_APP_LINK_URL`. An empty string, a `javascript:` URL or
 * a null from a failed mint can never become the button's href, and the failure
 * mode of a bad input is the download page — never a broken or hostile link.
 */
export function resolveAppCtaUrl(claimUrl?: string | null): string {
  if (typeof claimUrl === "string") {
    const candidate = claimUrl.trim();
    if (candidate.startsWith("https://") && candidate.length > "https://".length) {
      return candidate;
    }
  }
  return MINGLA_APP_LINK_URL;
}

/**
 * The CTA copy, as a CLOSED UNION rather than a `string`.
 *
 * The headline is interpolated into HTML without escaping, so accepting a bare
 * `string` would be an injection seam the moment someone passed a brand or
 * buyer value through it. A union of the literals the product actually uses
 * makes that unrepresentable — `renderAppCtaHtml(\`… ${brand.name} …\`)` does
 * not compile — which is a stronger guarantee than a lint rule and needs no gate
 * to enforce it. A template picks a member; it never builds its noun by
 * interpolation.
 *
 * #3524 FOLLOW-UP — WHAT THE COPY NOW SAYS, AND WHY. Seth's order is ticket
 * first, chat second, who's going: the button is the buyer's ticket before it is
 * anything else, and the reason to open the app is the room full of people going
 * with them. Every offering type gets its own member so the noun is the buyer's
 * own noun ("the event chat" / "the trip chat" / "the experience chat") rather
 * than a generic one, and so that adding a fourth offering type is a compile
 * error here rather than a wrong word in a shipped email.
 *
 * EVERY OFFERING TYPE HAS A GROUP CHAT — events, trips and experiences alike
 * (Seth, 2026-09-22). The experience template previously said "ticket + details"
 * and promised no chat; that was the odd one out, and it was wrong, not
 * deliberate. Do not reintroduce a chat-free variant on the theory that some
 * offering lacks one.
 */
export type AppCtaHeadline =
  | "Your ticket, the event chat, and who's going — all in the app"
  | "Your ticket, the trip chat, and who's going — all in the app"
  | "Your ticket, the experience chat, and who's going — all in the app";

/**
 * The whole CTA block — the ONLY way an email may render "Open in Mingla", and
 * now the ONLY call to action a confirmation email carries.
 *
 * `claimUrl` is the per-order attendance claim URL when the caller has one. The
 * href is HTML-attribute escaped because a claim URL carries a query-shaped
 * fragment (`#v=1&kind=order&…`), and a raw `&` in an attribute is wrong even
 * where browsers tolerate it. The plain-text twin carries the same URL
 * unescaped, which is what "the same link" means across the two bodies.
 */
export function renderAppCtaHtml(
  headline: AppCtaHeadline,
  claimUrl?: string | null,
): string {
  const href = escapeHtml(resolveAppCtaUrl(claimUrl));
  return `<div style="margin-top:32px;padding:24px;background:#FFF5EC;border-radius:12px;border:1px solid #FFD9B8;text-align:center;">
    <p style="margin:0;font-size:15px;color:#6B5A47;">${headline}</p>
    <a href="${href}"
       style="display:inline-block;margin-top:12px;padding:12px 24px;background:${BRAND_ORANGE_BUTTON};color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
      Open in Mingla
    </a>
  </div>`;
}

/**
 * The plain-text twin. #2240's requirement is that the text body carry the SAME
 * working link as the HTML. Both bodies route through `resolveAppCtaUrl` and
 * neither names a URL of its own, so a caller that passes the same `claimUrl`
 * to both cannot make them diverge.
 */
export function appCtaTextLine(
  headline: AppCtaHeadline,
  claimUrl?: string | null,
): string {
  return `${headline}: ${resolveAppCtaUrl(claimUrl)}`;
}
