// issue #2272 — the four app-link path families that had NO web route.
//
// ─── WHAT THIS IS ───────────────────────────────────────────────────────────
//
// `/orders/*`, `/chat/*`, `/board/*` and `/invite/*` are declared as verified
// deep links for the Explorer app on BOTH platforms — live iOS AASA
// (`public/.well-known/apple-app-site-association`) and Android `autoVerify`
// intent filters (`app-mobile/app.json`). Nothing in this Next app served them,
// so anyone WITHOUT the app who opened one in a browser got a 404. Measured on
// production 2026-08-18, all three user-agents, all four families: HTTP 404.
//
// Confirmation emails delivered before #2240 still carry `/orders/{id}/chat`.
// They cannot be recalled, so the browser case had to be served.
//
// ─── THE TWO RULES THIS MODULE EXISTS TO KEEP ───────────────────────────────
//
// 1. ONE DEVICE-DETECTION OWNER. The landing does NOT sniff the user agent and
//    does NOT know a store URL. Its single call to action is `/download`, the
//    route that already owns that decision (`app/download/page.tsx` →
//    `resolvePlatformFromUa` → 307 App Store / 307 Google Play / 200 QR page,
//    verified live). A second detector here would be a second thing to keep
//    correct, and #2217 already proved how quietly that arm rots.
//
// 2. NOTHING THE PAGE SAYS MAY BE FALSE. The person holding this link holds a
//    real ticket, and the browser genuinely cannot show it. Every sentence below
//    is a closed union of string literals — no interpolation, no order data, no
//    "your ticket" page that isn't one. The two factual claims are sourced:
//      - the QR really is an attached PDF
//        (`supabase/functions/_shared/email/copy.ts` → "QR in attached PDF")
//      - signing in really does reconnect the order to the account
//        (`supabase/functions/attendance-claim-identity`, #2217 — it matches the
//        account's own provider-verified email/phone against the order).
//
// ─── WHAT `/board/*` TURNED OUT TO BE (issue #2272 asked; do not re-guess) ──
//
// `/board/{code}` is NOT a mis-spelled `/b/{brandSlug}`. Evidence:
//   - `app-mobile/src/services/boardInviteService.ts:40` mints
//     `mingla://board/{invite_code}` from `collaboration_sessions.invite_code`,
//     with the https form sitting commented out on the next line — it never
//     shipped.
//   - `app-mobile/src/services/deepLinkService.ts:183` parses `board` as
//     `page: 'board-invite'`, keyed by that same invite code.
//   - `app-mobile/app/b/[slug].tsx` is a BRAND page keyed by a brand slug.
// A collaboration invite code is not a brand slug, so redirecting `/board/{id}`
// to `/b/{id}` would send every one of these to a brand lookup that cannot
// match. It gets the honest landing like the other three.
//
// `/invite/{referralCode}` is likewise a referral code
// (`app-mobile/src/services/oneLinkShare.ts:177`), minted on the AppsFlyer
// branded domain `go.usemingla.com` — never on this apex. The apex only ever
// receives one because the AASA claims `/invite/*`.
//
// ─── OUT OF SCOPE, DELIBERATELY ─────────────────────────────────────────────
//
// No `.well-known` file is touched. Adding or withdrawing a deep-link claim is
// issue #2245 and a founder decision, and both files are cached by the OS and by
// Apple's CDN. A phone WITH the app is therefore unaffected by anything here:
// the OS still intercepts the link and `app-mobile/app/+native-intent.tsx` still
// lands it on home (#2219).

/** The four families, as a closed set. Order is the serving order, not a rank. */
export const APP_LINK_LANDING_KINDS = ['order', 'chat', 'board', 'invite'] as const

export type AppLinkLandingKind = (typeof APP_LINK_LANDING_KINDS)[number]

/**
 * First URL segment each kind is served at — EXACTLY the four declared in the
 * live AASA `paths` and the Android intent filters. Changing one of these
 * without changing the declaration re-opens #2272 for that family.
 */
export const APP_LINK_LANDING_SEGMENTS: Readonly<
  Record<AppLinkLandingKind, string>
> = {
  order: 'orders',
  chat: 'chat',
  board: 'board',
  invite: 'invite',
}

/**
 * The ONE install destination, and the only one this module may name.
 *
 * A path, not an absolute URL: it must stay same-origin so the redirect chain
 * `/orders/... → /download → store` never leaves the apex mid-flight. The store
 * URLs themselves live in `lib/store-links.ts` and are read only by
 * `app/download/page.tsx`.
 */
export const DOWNLOAD_PATH = '/download'

/**
 * Page copy. Every field is a union of literals so no caller — and no future
 * edit — can interpolate an order id, a brand name, or anything else a buyer
 * supplied into this page. Widening any of these to `string` is the regression.
 */
export interface AppLinkLandingCopy {
  /** Browser tab / OG title. */
  readonly title:
    | 'Your ticket is in the Mingla app'
    | 'Event chat is in the Mingla app'
    | 'This plan is in the Mingla app'
    | 'This invite opens in the Mingla app'
  /** The one-line truth about why the browser showed nothing. */
  readonly lede:
    | 'This link opens in the Mingla app. A browser cannot show a ticket.'
    | 'This link opens in the Mingla app. Event chat does not exist on the web.'
    | 'This link opens in the Mingla app. Shared plans do not exist on the web.'
    | 'This link opens in the Mingla app. Invites are accepted in the app.'
  /** What to do next, and what is already in their possession. */
  readonly detail:
    | 'Your ticket QR is already attached to your confirmation email as a PDF, so you can get in without doing anything else. Install Mingla and sign in with the email or phone from your order to keep it in the app too.'
    | 'Install Mingla and sign in with the email or phone from your order — your event and its chat are waiting there.'
    | 'Install Mingla and sign in to open shared plans, boards and group chats.'
    | 'Install Mingla and sign in to accept this invite.'
  /** Button label. */
  readonly cta: 'Get the Mingla app'
}

const COPY: Readonly<Record<AppLinkLandingKind, AppLinkLandingCopy>> = {
  order: {
    title: 'Your ticket is in the Mingla app',
    lede: 'This link opens in the Mingla app. A browser cannot show a ticket.',
    detail:
      'Your ticket QR is already attached to your confirmation email as a PDF, so you can get in without doing anything else. Install Mingla and sign in with the email or phone from your order to keep it in the app too.',
    cta: 'Get the Mingla app',
  },
  chat: {
    title: 'Event chat is in the Mingla app',
    lede: 'This link opens in the Mingla app. Event chat does not exist on the web.',
    detail:
      'Install Mingla and sign in with the email or phone from your order — your event and its chat are waiting there.',
    cta: 'Get the Mingla app',
  },
  board: {
    title: 'This plan is in the Mingla app',
    lede: 'This link opens in the Mingla app. Shared plans do not exist on the web.',
    detail: 'Install Mingla and sign in to open shared plans, boards and group chats.',
    cta: 'Get the Mingla app',
  },
  invite: {
    title: 'This invite opens in the Mingla app',
    lede: 'This link opens in the Mingla app. Invites are accepted in the app.',
    detail: 'Install Mingla and sign in to accept this invite.',
    cta: 'Get the Mingla app',
  },
}

export function appLinkLandingCopy(kind: AppLinkLandingKind): AppLinkLandingCopy {
  return COPY[kind]
}
