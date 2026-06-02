/**
 * (tabs)/partner — Mingla partner earnings tab route.
 *
 * ORCH-1052 hotfix: the implementor created `app/partner/earnings.tsx`
 * (outside the (tabs)/ group) but never wired it into any nav surface, so
 * toggling `creator_accounts.partner_enabled=true` in mingla-admin had no
 * visible effect on the user's mingla-business app. This file re-exports
 * the screen as a real (tabs)/ route so the bottom-nav can render it.
 *
 * Tab visibility is gated by `usePartnerStripeStatus().partner_enabled` in
 * `app/(tabs)/_layout.tsx` via `navTabGate.visibleTabsForRank`. The original
 * `/partner/earnings` route still works (the post-onboarding redirect at
 * `app/connect-partner-onboarding.web.tsx` still resolves) — both paths
 * mount the same default export.
 */

export { default } from "../partner/earnings";
