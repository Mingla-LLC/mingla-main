# INVESTIGATION — ORCH-1082 [Business-app notification deep-link handlers]

**Mode:** INVESTIGATE (investigation only — no fix, no spec, no code, no deploy)
**Date:** 2026-06-05
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1082-[business-notification-deeplink-handlers]/` on branch `ORCH-1082-business-notification-deeplink-handlers` (rebased clean onto `origin/main`)
**Investigator:** Claude `mingla-forensics`
**Confidence:** `proven` (source-traced end-to-end backend→client; this is a code-audit/backend-mapping investigation — sim live-fire exempt per Prime Directive 7 backend/code-audit carve-out)

---

## TL;DR — the dispatch premise is STALE

The dispatch (and the ORCH-1080 context doc, dated 2026-06-04) assert the business app **"appears to receive push notifications but has NO code to handle a notification TAP (no deep-link routing, no notification-opened handler)."**

**That premise is no longer true on current `main`.** Between the ORCH-1080 analysis and today, **META-ORCH-1074 [Business notifications]** shipped the entire business-notification vertical slice — backend dual-app push routing + 11 triggers (Sub-A, PR #354 `158068f3b`), the **client tap handler + deep-link router + deferred-replay** (Sub-B, PR #359 `e78c9fcc2`), the in-app inbox (Sub-C, same PR), and the EAS OneSignal-App-ID wiring (PR #362 `07f13affa` / `22f6c6509`).

So the **core gap ORCH-1082 was registered to fix is already closed.** A business notification tap **does** route today. What remains are **four narrow residual routing defects** in the client parser + one push-app-routing prefix miss — real, but far smaller than "add a tap handler from scratch." This report proves the current state and enumerates the residual gaps so SPEC can rescope ORCH-1082 to exactly those.

---

## 1. Current business-app notification state — PROVEN (tap handling EXISTS)

### 1.1 OneSignal init + identity (was the old state)
`mingla-business/src/services/oneSignalService.ts` — historically (ORCH-0808-FOLLOWUP) this was **identity-only**: `initialize` + `login` + `logout`. The module header still documents that origin (lines 4-5). But it was **extended by META-ORCH-1074 Sub-B** (header lines 6-17) to add the full receive path.

Proven present in the service today:
- `initializeOneSignal()` — `oneSignalService.ts:58`
- `loginToOneSignal(userId)` + `optIn()` (server-side subscription) — `oneSignalService.ts:95-106`
- `requestPushPermission()` — OS-level prompt — `oneSignalService.ts:117-127`
- `logoutOneSignal()` — `oneSignalService.ts:136-145`
- `clearNotificationBadge()` — `oneSignalService.ts:152-159`
- **`onForegroundNotification(callback)`** — foreground banner display — `oneSignalService.ts:171-208`
- **`onNotificationClicked(callback)`** — **the tap handler** — `oneSignalService.ts:215-232`. Registers OneSignal SDK v5 `"click"` event listener, narrows `event.notification.additionalData` to `OneSignalNotificationData`, invokes the callback, returns a cleanup fn.

### 1.2 The tap handler IS wired into the app entry
`mingla-business/app/_layout.tsx` (Expo Router root layout) — `RootLayoutInner`:
- imports `onNotificationClicked`, `onForegroundNotification` (`_layout.tsx:58-62`) and `processBusinessNotification` + `BusinessNavTarget` (`_layout.tsx:63-66`).
- `initializeOneSignal()` runs after first paint (`_layout.tsx:202`).
- `usePushPermissionMoment(user !== null, currentBrandId)` — value-moment OS prompt (`_layout.tsx:214`).
- **The click handler is registered** in a `useEffect` keyed on `[router, userId]` (`_layout.tsx:221-248`):
  ```ts
  const removeClicked = onNotificationClicked((data) => {
    if (typeof data.type !== "string") return;
    processBusinessNotification(data, {
      router,
      isAuthenticated: userId !== null,
      stashDeferred: (target) => { void AsyncStorage.setItem(DEFERRED_PUSH_TARGET_KEY, JSON.stringify({ target, ts: Date.now() })); },
    });
  });
  ```
- **Deferred-tap replay** post-login: a tap while logged out stashes the resolved target in AsyncStorage (`DEFERRED_PUSH_TARGET_KEY = "mingla-business.deferredPushTarget.v1"`, `_layout.tsx:73`) and is replayed once `userId` is non-null (`_layout.tsx:253-275`).
- **Foreground display** handler also wired (`_layout.tsx:224`), `display()`-ing every foreground business push (SDK v5 requirement).

**Verdict: the business app DOES register a notification-opened/click handler, DOES parse a deep link, and DOES route. The "no tap handling" state described in the dispatch is historical.**

### 1.3 The deep-link parser + router (the new code)
`mingla-business/src/services/businessNotificationRouting.ts` (META-ORCH-1074 Sub-B §4.B.4):
- **`parseBusinessDeepLink(deepLink)`** (`:63-93`) — parses `mingla-business://…` into an Expo Router path. Handles heads: `event` → `/event/{id}` (`:70-73`); `payments` → `/brand/{currentBrandId}/payments` else `/(tabs)/account` (`:74-77`); `brand` → `/brand/{id}/team` | `/brand/{id}/listing` | `/brand/{id}` (`:78-85`); `(tabs)` → `/(tabs)/{rest}` (`:86-89`); **default → `null`** (`:90-91`).
- **`resolveBusinessNavTarget(data)`** (`:101-144`) — prefers `data.deepLink` (parse), else a per-`type` NAV_TARGETS fallback covering the 11 `business.*` types + `stripe.*` → payments, default → `ACCOUNT_FALLBACK = "/(tabs)/account"` (`:56`).
- **`processBusinessNotification(data, deps)`** (`:191-216`) — resolves target; if unauthenticated, `stashDeferred(target)` + return; else `markRowClicked(notificationId)` (`:150-173`, fire-and-forget UPDATE of `read_at`/`push_clicked`/`push_clicked_at` with `.select("id")` row-count verify), Mixpanel-track, `router.push(target)`.

Pure resolvers (`parseBusinessDeepLink`, `resolveBusinessNavTarget`) are unit-testable; the impure `processBusinessNotification` wires side effects. This mirrors the consumer `app/index.tsx` `processNotification` + `NAV_TARGETS` pattern, re-skinned to Expo Router.

---

## 2. What pushes target the business app — full enumeration (file:line + type + deep-link data)

### 2.1 The app-type-prefix invariant (`I-PROPOSED-W` / NOTIFICATIONS-FILTERED-BY-APP-TYPE-PREFIX)
`supabase/functions/_shared/push-utils.ts:52-57`:
```ts
export function resolveOneSignalApp(type) {
  if (typeof type === "string" && (type.startsWith("business.") || type.startsWith("stripe."))) return "business";
  return "consumer";
}
```
**Mingla runs TWO separate OneSignal applications** (consumer + business), each with its own `(app_id, REST key)` pair; there is **no cross-app send** (push-utils.ts:7-18). The target app is a **pure function of the notification `type` prefix**: `business.*` and `stripe.*` → business app; everything else → consumer app. Business-credential absence MUST NOT fall back to consumer (SC-A2, push-utils.ts:102-110). `notify-dispatch` sets `app: resolveOneSignalApp(type)` at `notify-dispatch/index.ts:500`. The shared `notifications` inbox table is identical regardless of app; the client **prefix-filters at read time** (notify-dispatch:489-494). This is the routing convention the dispatch asked about.

### 2.2 The full payload-to-client wiring (PROVEN end-to-end)
`notify-dispatch/index.ts`:
- writes the in-app row with `data: { ...data, deepLink: deepLink || null }` and `deep_link` column (`:319, :321`). **ORCH-1030 CONTRACT** (`:312-318`): callers MUST pass the deep link as the **top-level** `deepLink` field; it overrides `data.deepLink`.
- on push, merges `pushData = { ...data, notificationId, type }` (`:487`) → `sendPush({ ..., data: pushData, app: resolveOneSignalApp(type) })` (`:495-501`).
- `sendPush` puts `data: payload.data ?? {}` into the OneSignal `data` field (push-utils.ts:120).

So the OneSignal `additionalData` the business client receives carries **`type`, `deepLink`, `notificationId`, plus per-type entity ids** — exactly the fields `processBusinessNotification` reads. Wiring is intact.

### 2.3 Every business-targeted push type, its emitter, and its deep-link data

| # | type | Emitter (file:line) | `deepLink` emitted | Other `data` |
|---|------|---------------------|--------------------|--------------|
| 1 | `business.order_paid` | `_shared/businessNotifyTriggers.ts:170-185` (from `ticket-checkout-confirm` + `stripeWebhookRouter` finalize) | `mingla-business://event/{eventId}` | orderId, eventId, eventTitle, totalCents, currency, qty |
| 2 | `business.event_sold_out` | `_shared/businessNotifyTriggers.ts:191-202` | `mingla-business://event/{eventId}` | eventId, eventTitle, capacity |
| 3 | `business.low_inventory` | `_shared/businessNotifyTriggers.ts:211-228` | `mingla-business://event/{eventId}` | eventId, eventTitle, remaining, capacity, pct |
| 4 | `business.refund_processed` | `_shared/stripeWebhookRouter.ts:800-817` | `mingla-business://event/{eventId}` **else** `mingla-business://payments` | orderId, refundId, amountCents, currency, eventId |
| 5 | `business.account_status_changed` | `_shared/stripeWebhookRouter.ts:~310-321` | `mingla-business://payments` | (account state hash) |
| 6 | `business.payout_paid` | `_shared/stripeWebhookRouter.ts:~510-514` | `mingla-business://brand/{brandId}/payments` | payout fields |
| 7 | `business.dispute_opened` | `_shared/stripeDisputeHandlers.ts:393-407` | `mingla-business://payments` | dispute fields |
| 8 | `business.dispute_action_needed` | `_shared/stripeDisputeHandlers.ts:414-428` | `mingla-business://payments` | dispute fields |
| 9 | `business.claim_decision` | `admin-review-venue-claim/index.ts:662-669` (recipient `brandRow.account_id`) | `mingla-business://brand/{brandId}/listing` | brandId, decision |
| 10 | `business.team_member_joined` | `accept-brand-invitation/index.ts:295-308` | `mingla-business://brand/{brandId}/team` | brandId |
| 11 | `stripe.bank_verification_failed` | `_shared/stripeWebhookRouter.ts:~440-452` | `mingla-business://brand/{brandId}/payments` | — |
| 12 | `stripe.payout_failed` | `_shared/stripeWebhookRouter.ts:~545-553`/`625` | `mingla-business://brand/{brandId}/payments` / `mingla-business://payments` | payoutId, failureCode |
| 13 | `stripe.account_deauthorized` | `_shared/stripeWebhookRouter.ts:~620-625` | `mingla-business://brand/{brandId}/payments` | — |
| 14 | `stripe.detach_completed` | `brand-stripe-detach/index.ts:96-102` | `mingla-business://brand/{brandId}/payments` | — |
| 15 | `stripe.kyc_stall_reminder` | `stripe-kyc-stall-reminder/index.ts:45-52` | `mingla-business://brand/{brandId}/payments/onboard` | brandId |
| 16 | `stripe.deadline_warning_{tier}d` | `stripe-kyc-stall-reminder/index.ts:164-181` | (see §5 gap — `user_id: null`) | — |
| 17 | `partner_stripe.detach_completed` | `partner-stripe-detach/index.ts:128-134` | `mingla-business://account/partner-earnings` | — |

Notes:
- Types 1-15 carry a well-formed `deepLink` that the prefix invariant routes to the **business** OneSignal app correctly.
- The `account_status_changed` (#5) deep-link string is the bare `mingla-business://payments` form (resolved client-side to the current brand's payments screen).
- `venue_claim_review` / `venue_claim_feedback` (admin-review-venue-claim:637, :321) and `partner_stripe.detach_completed` (#17) are emitted but do **not** all carry the `business.`/`stripe.` prefix — see §5 gaps.

---

## 3. The business app's navigation / deep-link system (Expo Router)

### 3.1 URL scheme registered
`mingla-business/app.config.ts:71` — `scheme: "mingla-business"` (added Cycle B2a for Stripe Connect onboarding return). `app.json` also declares iOS associated-domain `scheme: "https"` (`:61`) and Android `scheme: "com.sethogieva.minglabusiness"` (`:74`) for app links. The custom scheme the push deep links use is **`mingla-business://`**.

### 3.2 How Expo Router handles incoming deep links
This app uses **file-based Expo Router** (`Stack` at `_layout.tsx:358`), not the consumer app's custom navigation. Importantly, the business notification system **does NOT rely on Expo Router's native `Linking` URL-to-route resolution** for taps. Instead it intercepts the tap in JS (`onNotificationClicked`), **parses the `mingla-business://` string itself** (`parseBusinessDeepLink`), and calls `router.push("/expo/router/path")` with a translated **path** (not the raw URI). `BusinessNavTarget` is explicitly "an Expo Router push target (path string) — never a raw deep-link" (businessNotificationRouting.ts:43-44). So the mapping is manual scheme→path, then `router.push`.

### 3.3 Routable target screens (verified to EXIST under `mingla-business/app/`)
All current deep-link path targets resolve to real route files:
- `/event/{id}` → `app/event/[id]/index.tsx` ✅ (event dashboard; has orders, guests, scanner, door sub-routes)
- `/brand/{id}/payments` → `app/brand/[id]/payments/index.tsx` ✅
- `/brand/{id}/payments/onboard` → `app/brand/[id]/payments/onboard.tsx` ✅ (exists, but unreachable via parser — §5)
- `/brand/{id}/listing` → `app/brand/[id]/listing.tsx` ✅
- `/brand/{id}/team` → `app/brand/[id]/team.tsx` ✅
- `/brand/{id}` → `app/brand/[id]/index.tsx` ✅ (brand hub)
- `/(tabs)/account` → `app/(tabs)/account.tsx` ✅ (ACCOUNT_FALLBACK)
- `/(tabs)/marketing` → `app/(tabs)/marketing/index.tsx` ✅
- `app/notifications.tsx` ✅ (the in-app inbox screen, Sub-C)
- `app/partner/earnings.tsx` ✅ (partner earnings — but the deep link points at `account/partner-earnings`, which has no file — §5)

Other organiser-relevant routes that an alert *could* target but currently do not: `app/event/[id]/orders/index.tsx`, `app/event/[id]/guests/index.tsx`, `app/brand/[id]/payments/reports.tsx`, `app/event/[id]/group-chat.tsx`.

---

## 4. The consumer reference pattern (conceptual model — NOT to copy blindly)

`app-mobile/app/index.tsx` (custom navigation, not Expo Router):
- `onNotificationClicked` (`:62`) → `processNotification(data)` (`:434`).
- `parseDeepLink(deepLink)` (`:499`) + `typeFallbackDestination` from `src/services/deepLinkService.ts` (`:93`).
- `executeDeepLink(dest, pushNavigationHandlers)` (`:501`) — drives the consumer app's **custom page-state navigation** (`setCurrentPage`, handlers), plus cold-start persistence of the deep link (`:450`).

**Reusable concept:** intercept tap → parse string → resolve to a destination → fallback by type → defer if pre-auth. **The business app already implements this concept** (businessNotificationRouting.ts mirrors it).

**What must differ (and already does):** the consumer app drives a bespoke `setCurrentPage` state machine via `NavigationHandlers`; the business app uses **Expo Router `router.push(path)`**. The business resolver therefore emits Expo Router **path strings**, not `{page, params}` handler objects. The consumer `deepLinkService.parseDeepLink` is NOT importable/reusable here (different scheme `mingla://` vs `mingla-business://`, different nav primitive). The re-build was correct and is done.

---

## 5. The gap matrix — what STILL needs work (residual, post-META-ORCH-1074)

Because the core handler exists, ORCH-1082's real scope is these residual routing defects. Legend: ✅ routes correctly · 🟠 routes to a degraded/wrong target · 🔴 push never reaches the business app.

| # | type | Tap routes today to | SHOULD route to | Class |
|---|------|---------------------|-----------------|-------|
| 1 | `business.order_paid` | `/event/{id}` ✅ | event dashboard | ✅ correct |
| 2 | `business.event_sold_out` | `/event/{id}` ✅ | event dashboard | ✅ correct |
| 3 | `business.low_inventory` | `/event/{id}` ✅ | event dashboard | ✅ correct |
| 4 | `business.refund_processed` | `/event/{id}` (or `/brand/{id}/payments` when no eventId) ✅ | event/payments | ✅ correct |
| 5 | `business.account_status_changed` | `/brand/{currentBrandId}/payments` ✅ | payments | ✅ correct |
| 6 | `business.payout_paid` | `/brand/{id}/payments` ✅ | payments | ✅ correct |
| 7 | `business.dispute_opened` | `/brand/{currentBrandId}/payments` ✅ | payments | ✅ correct |
| 8 | `business.dispute_action_needed` | `/brand/{currentBrandId}/payments` ✅ | payments | ✅ correct |
| 9 | `business.claim_decision` | `/brand/{id}/listing` ✅ | venue listing | ✅ correct |
| 10 | `business.team_member_joined` | `/brand/{id}/team` ✅ | brand team | ✅ correct |
| 11 | `stripe.bank_verification_failed` | `/brand/{id}/payments` ✅ | payments | ✅ correct |
| 12 | `stripe.payout_failed` | `/brand/{id}/payments` (or `/payments`) ✅ | payments | ✅ correct |
| 13 | `stripe.account_deauthorized` | `/brand/{id}/payments` ✅ | payments | ✅ correct |
| 14 | `stripe.detach_completed` | `/brand/{id}/payments` ✅ | payments | ✅ correct |
| 15 | **`stripe.kyc_stall_reminder`** | **`/brand/{id}`** (brand hub — the `payments/onboard` sub is DROPPED) | `/brand/{id}/payments/onboard` (file exists) | 🟠 **deep-link sub-path lost in parser** |
| 16 | **`stripe.deadline_warning_{tier}d`** | (push sent, but `user_id: null`) | a brand user's onboard/payments | 🔴 **`user_id: null` → no external_id target → reaches nobody** |
| 17 | **`partner_stripe.detach_completed`** | **consumer OneSignal app** (prefix `partner_stripe.` ≠ `business.`/`stripe.`) → business device never gets it; even if delivered, `account` head → null → `ACCOUNT_FALLBACK` tab | partner earnings (`app/partner/earnings.tsx`) | 🔴 **wrong OneSignal app** + 🟠 **`account/partner-earnings` path unhandled by parser AND no matching route file** |

### Proven root causes for the residual defects

**Gap 15 — `payments/onboard` sub-path dropped (🟠).**
`businessNotificationRouting.ts:78-85` (`brand` case) handles only `sub === "team"` and `sub === "listing"`; any other sub (here `payments`, with a further `/onboard`) falls through to `return /brand/${brandId}` (`:84`). So `mingla-business://brand/{id}/payments/onboard` → `/brand/{id}`. The KYC stall reminder lands on the brand hub instead of the onboarding screen the copy promises. *Verification:* `parseBusinessDeepLink("mingla-business://brand/X/payments/onboard")` returns `/brand/X` (rest = `["payments","onboard"]`; `sub="payments"` matches neither branch).

**Gap 16 — deadline-warning push has no recipient (🔴).**
`stripe-kyc-stall-reminder/index.ts:164` emits `stripe.deadline_warning_{tier}d` with `user_id: null` (`:177-ish`, confirmed `user_id: null` in the dispatch block). `push-utils.sendPush` targets `include_aliases.external_id = [targetUserId]` (push-utils.ts:115). A null user id yields no external_id → OneSignal delivers to nobody. (The `stripe.kyc_stall_reminder` sibling at `:45-52` DOES set a real recipient, so this is specifically the deadline-warning broadcast variant.) *Note:* this is a **backend** defect, not a client-routing one.

**Gap 17 — partner detach routes to the wrong OneSignal app + unhandled client path (🔴 + 🟠).**
- `partner-stripe-detach/index.ts:128` emits type `partner_stripe.detach_completed`. `resolveOneSignalApp` (push-utils.ts:52-53) only matches `business.`/`stripe.` → this falls to **consumer** app. A partner is a business-app user → **the business device never receives it.** This is a **backend** prefix-coverage defect.
- Even if delivered, the deep link `mingla-business://account/partner-earnings` has head `account`, which `parseBusinessDeepLink` does NOT handle (`:69-92` switch has no `account` case) → returns `null` → NAV_TARGETS default → `ACCOUNT_FALLBACK = /(tabs)/account` (the account TAB), not partner earnings. **And** there is no `app/account/partner-earnings.tsx` file — partner earnings lives at `app/partner/earnings.tsx`. So the path is wrong on two counts (unhandled head + nonexistent route).

### Other observations (🔵)
- `venue_claim_review` / `venue_claim_feedback` (admin-review-venue-claim:637, :321) are non-`business.`/`stripe.`-prefixed → route to the **consumer** app. Whether these are *meant* for the organiser (business) or an admin is unverified here; if organiser-facing, they share Gap-17's prefix problem. Flag for SPEC to confirm intended audience.
- `android_channel_id` is DISABLED in notify-dispatch (`:503-508`) to avoid OneSignal 400s — business pushes use the default channel. Not a routing bug; noted for completeness.

---

## 6. Blast radius / constraints — client-only vs needs-backend

**The already-shipped core (META-ORCH-1074) is client + backend, both deployed.** For the **residual** ORCH-1082 scope:

| Residual gap | Fix locus | Why |
|--------------|-----------|-----|
| Gap 15 (`payments/onboard` sub-path) | **CLIENT-ONLY** | `parseBusinessDeepLink` `brand` case needs a `payments`/`payments/onboard` sub-branch; the backend deep-link string is already correct + the route file exists. No edge redeploy. |
| Gap 17 client half (`account/partner-earnings` unhandled + nonexistent route) | **CLIENT-ONLY** | parser needs an `account`/`partner` head case → `/partner/earnings`; OR the backend deep-link string changes to `mingla-business://(tabs)/account` or a real path. Pick one in SPEC. |
| Gap 16 (`deadline_warning` `user_id: null`) | **BACKEND** | `stripe-kyc-stall-reminder` must resolve real recipient user ids before dispatch. Pure edge-function change. |
| Gap 17 backend half (`partner_stripe.` → consumer app) | **BACKEND** | `resolveOneSignalApp` (push-utils.ts:52) must also treat `partner_stripe.` as a business prefix (or partner-stripe-detach must emit a `business.`/`stripe.`-prefixed type). Touches the shared push-utils + a push-routing test. |

**Constraints / things that make this bigger than "add a tap handler":**
1. **The premise must be corrected before SPEC.** ORCH-1082 is NOT "build the handler" — it's "patch 1-2 client parser cases + 2 backend push-routing/recipient defects." The orchestrator should reconcile ORCH-1082's scope with META-ORCH-1074's CLOSE (see Discoveries).
2. **Push permission IS requested** in the business app — `usePushPermissionMoment` at the value moment (authenticated + brand exists), one-shot AsyncStorage-flagged (`usePushPermissionMoment.ts`). Not a gap.
3. **Backend touches require the strict-grep `*_BACKEND_ALLOWLIST` discipline** (COMMS-0002) if any `supabase/functions/` file is added/changed; `push-utils.ts` is already in the META-ORCH-1074 allowlist but a new edit may need re-listing. Flag at IMPLEMENT.
4. **No DB/migration/RLS change is implied** by any residual gap — the `notifications` table + `deep_link` column already exist and are written. Pure client + edge-fn surface.
5. **`resolveOneSignalApp` is a shared consumer/business chokepoint** — widening its prefix set (Gap 17) is low-risk but must keep `business.`/`stripe.` behavior byte-stable and add a routing test (precedent: `_shared/__tests__/meta_orch_1074_push_routing.test.ts`).

---

## 7. Five-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | ORCH-1080 analysis doc says "business app has NO tap handlers" — **stale**; predates META-ORCH-1074 Sub-B merge. WORLD_MAP line 1079 confirms META-ORCH-1074 shipped Sub-A/B/C. |
| **Schema** | `notifications` table carries `deep_link`, `read_at`, `push_clicked`, `push_clicked_at`, `type`, `brand_id` — all written by notify-dispatch + read/updated by the client. No schema gap. |
| **Code** | Tap handler + parser + router + deferred-replay all present (oneSignalService.ts, _layout.tsx, businessNotificationRouting.ts). Residual: parser `brand` sub-path + `account` head gaps; backend `resolveOneSignalApp` prefix + `deadline_warning` recipient. |
| **Runtime** | Backend→OneSignal→client `additionalData` carries `type`+`deepLink`+`notificationId` (proven via notify-dispatch:487/319 + sendPush:120). Not sim-replayed (code-audit scope). |
| **Data** | `data.deepLink` override contract (ORCH-1030, notify-dispatch:312-319) ensures the client routes on the right field. |

No cross-layer contradiction on the core path; the only contradiction is **Docs (ORCH-1080) vs Code (current main)** — and Code is the truth (META-ORCH-1074 closed the gap the doc described).

---

## 8. Confidence + open steering questions for SPEC

**Confidence: `proven`** for the current-state mapping and the four residual gaps (all source-traced to exact lines). Not sim-replayed because this is a backend/client code-audit (Prime Directive 7 exemption); if SPEC wants device proof of a specific tap (e.g. KYC stall → onboard), that is a TEST-phase live-fire, not an INVESTIGATE blocker.

Open questions the SPEC must answer (do NOT resolve here):
1. **Rescope ORCH-1082** from "build the handler" to "fix residual routing defects (Gaps 15-17)" — confirm with orchestrator given META-ORCH-1074 already shipped the handler.
2. For Gap 17, fix in the **client parser** (add `account`/`partner` head + `partner_stripe.` prefix) or in the **backend** (re-prefix the type + correct the deep-link string)? (Recommend: both — prefix in backend so it reaches the business app, path in client/backend so it lands on partner earnings.)
3. Are `venue_claim_review`/`venue_claim_feedback` organiser-facing? If so they need the business prefix too.
4. Gap 16 (`deadline_warning` `user_id: null`) — is the deadline-warning meant to reach brand users at all, or is it an admin/ops broadcast? Determines whether it's in ORCH-1082 scope.

---

## Discoveries for Orchestrator

1. **ORCH-1082's registered premise is obsolete.** META-ORCH-1074 [Business notifications] (Sub-A PR #354 `158068f3b`, Sub-B+C PR #359 `e78c9fcc2`, EAS wiring PR #362 `07f13affa`) already shipped the full business notification-tap handler + deep-link router + inbox. ORCH-1082 should be **rescoped** to the four residual routing defects (this report §5/§6), or merged into a META-ORCH-1074 follow-up. The ORCH-1080 doc's "business gap" note (its §line 6 + Q3) is now historical.
2. **Backend push-routing bug (independent of ORCH-1082 core):** `partner_stripe.detach_completed` (`partner-stripe-detach/index.ts:128`) routes to the **consumer** OneSignal app because `resolveOneSignalApp` (push-utils.ts:52) only matches `business.`/`stripe.`. Partner detach notifications never reach the business app today. Worth a P2 ticket even if ORCH-1082 is rescoped narrowly.
3. **Backend recipient bug:** `stripe.deadline_warning_{tier}d` (`stripe-kyc-stall-reminder/index.ts:164`) dispatches with `user_id: null` → no OneSignal external_id target → reaches nobody.
4. **No COMMS ledger entry was written** this turn — the residual gaps don't yet affect another *in-flight* ORCH (META-ORCH-1074 is shipped, not in-flight). If ORCH-1082 proceeds to touch `_shared/push-utils.ts`, the COMMS-0002 backend-allowlist discipline applies at IMPLEMENT.
