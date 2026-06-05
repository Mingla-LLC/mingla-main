# SPEC — ORCH-1082 [Business-app notification deep-link handlers] (RESCOPED)

**Mode:** SPEC (spec only — no code, no deploy, no db push)
**Date:** 2026-06-05
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1082-[business-notification-deeplink-handlers]/` on branch `ORCH-1082-business-notification-deeplink-handlers` (rebased clean onto `origin/main`)
**Author:** Claude `mingla-forensics`
**Source of truth:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1082_BUSINESS_NOTIFICATION_DEEPLINK_HANDLERS.md` (this worktree)
**Confidence:** `proven` — every claim below re-verified against current `main` source (file:line cited).

---

## 0. Premise correction + a material investigation overturn

### 0.1 The original premise is dead (already known)
META-ORCH-1074 shipped the entire business notification tap handler + deep-link parser + deferred-replay + inbox. ORCH-1082 is therefore **not** "build the handler" — it is a bounded patch of residual routing defects. This is settled by the investigation.

### 0.2 NEW overturn: the investigation's Gap 16 root cause is FACTUALLY WRONG
The investigation (§5, Gap 16) claims `stripe.deadline_warning_{tier}d` is dispatched with `user_id: null` so it "reaches nobody." **Re-reading the actual source disproves this.**

`supabase/functions/stripe-kyc-stall-reminder/index.ts`:
- The deadline-warning notification is emitted by calling **`notifyBrand(...)`** (`:162-175`).
- `notifyBrand` (`:18-73`) resolves real recipients via `getBrandPaymentManagerUserIds(supabase, input.brandId)` (`:31`) and dispatches with **`userId: userIds[i]`** (`:40`) — a real brand payment-manager user id, never null.
- The literal `user_id: null` the investigation saw is in the **`writeAudit(...)` calls** at `:149` and `:178` — the audit-log row, **not** the notification dispatch. The investigation misattributed the audit parameter to the push.

**Proof of no post-investigation drift:** `git diff origin/main -- supabase/functions/stripe-kyc-stall-reminder/index.ts` is empty; `git status` shows the file unmodified. `grep -rn "deadline_warning" supabase/functions/` shows exactly one emitter (`:164`). So the recipient resolution is correct on `main` today.

**Consequence:** there is **no backend "no recipient" fix** to write for deadline_warning. Its only *real* residual defect is that `notifyBrand` always stamps `deepLink: mingla-business://brand/${brandId}/payments/onboard` (`:52`) — the exact `payments/onboard` sub-path the client parser drops (Gap 15). So deadline_warning's fix is **subsumed entirely by Gap 15's client parser fix**; it needs no edge-function change.

This SPEC therefore **re-defines Gap 16**: not a backend recipient fix, but the confirmation that deadline_warning shares Gap 15's client defect and is fixed by it. No separate backend work, no edge function touched for Gap 16. (If the orchestrator wants a paper trail, this is a corrected-INVESTIGATION note, not new scope.)

---

## 1. Scope

This SPEC covers exactly:

| Gap | Defect | Locus | Edge fn touched? |
|-----|--------|-------|------------------|
| **15** | `parseBusinessDeepLink` `brand` case drops `payments` / `payments/onboard` sub-paths → KYC stall reminder + deadline warnings land on brand hub, not onboarding | **CLIENT-ONLY** | No |
| **16** (redefined) | deadline_warning recipients are CORRECT (investigation wrong); its only residual defect = the dropped `payments/onboard` sub-path → **fixed by Gap 15's parser fix.** No backend change. | **CLIENT-ONLY (via Gap 15)** | No |
| **17** | `partner_stripe.detach_completed` (a) routes to the CONSUMER OneSignal app (prefix not `business.`/`stripe.`) so it never reaches the organiser device; (b) deep-links to nonexistent route `mingla-business://account/partner-earnings` | **BOTH** | Yes (`partner-stripe-detach`) + client parser |
| **VC** (venue_claim) | `venue_claim_review` + `venue_claim_feedback` call `sendPush()` directly with no `app` param → default consumer app, but target the organiser (`brand.account_id`) → never reach the business device | **BACKEND-ONLY** | Yes (`admin-review-venue-claim`) |

## 1.1 Non-goals (explicitly OUT)
- Rebuilding/altering the tap handler, deferred-replay, inbox, foreground display, push-permission moment — all shipped by META-ORCH-1074, all correct.
- Any DB / migration / RLS change — the `notifications` table + `deep_link` column already exist and are written. **Zero migration in this ORCH.**
- Consumer app, admin-web, buyer/anon web — see Cross-Surface Impact §8.
- The `android_channel_id` disabled-in-notify-dispatch observation (§5 obs in investigation) — not a routing bug.
- New deep-link *targets* for the "could route to orders/guests/reports/group-chat" routes — those are deferrable enhancements, not defects.

## 1.2 Assumptions
- Backend deploys happen from **MERGED main** at CLOSE (COMMS-0015 / `feedback_edge_deploy_and_migration_apply_hazards.md`), **never from this worktree**. This SPEC mandates no deploy.
- The business client registers against the business OneSignal app via `EXPO_PUBLIC_ONESIGNAL_APP_ID` (proven by META-ORCH-1074 EAS wiring, PR #362).
- `brand.account_id` is the organiser/owner auth user id and is a valid OneSignal `external_id` (proven by `business.claim_decision` already using `userId: brandRow.account_id` successfully through notify-dispatch — `admin-review-venue-claim:660`).

---

## 2. External docs cited (COMMS-0003 — MANDATORY for push/deeplink behavior)

Every push-routing / deep-link behavior introduced is grounded in provider docs (cited inline at each requirement too):
- OneSignal dual-app keys & ids (why a business push MUST carry the business `app_id`): https://documentation.onesignal.com/docs/keys-and-ids
- OneSignal Create Message / `include_aliases.external_id` targeting: https://documentation.onesignal.com/reference/create-message
- OneSignal REST API overview (`Key <rest-api-key>` auth scheme): https://documentation.onesignal.com/docs/rest-api-overview
- Expo Router imperative navigation (`router.push(path)`, typed/href paths): https://docs.expo.dev/router/navigating-pages/
- Expo Router deep linking & URL scheme handling: https://docs.expo.dev/router/advanced/native-intent/ and https://docs.expo.dev/guides/deep-linking/

---

## 3. Gap-by-gap contract

### GAP 15 — `payments` / `payments/onboard` sub-path dropped (🟠 → CLIENT-ONLY) 🔒 LOCKED

**File:** `mingla-business/src/services/businessNotificationRouting.ts`
**Function:** `parseBusinessDeepLink` — the `case "brand":` block, lines **78-85**.

**Current code (verbatim, `:78-85`):**
```ts
case "brand": {
  const brandId = rest[0];
  const sub = rest[1];
  if (!brandId) return null;
  if (sub === "team") return `/brand/${brandId}/team`;
  if (sub === "listing") return `/brand/${brandId}/listing`;
  return `/brand/${brandId}`;
}
```

**Current behavior:** `mingla-business://brand/{id}/payments/onboard` → `rest = ["payments","onboard"]` → `sub = "payments"` matches neither `team` nor `listing` → falls through to `return /brand/${brandId}` → lands on the **brand hub** (`app/brand/[id]/index.tsx`). The KYC-stall reminder + deadline warnings (both emitted by `stripe-kyc-stall-reminder` via `notifyBrand`, deep link `mingla-business://brand/${brandId}/payments/onboard`, `:52`) never reach the onboarding screen the copy ("Finish Stripe verification") promises.

**Required behavior (after):** the `brand` case must additionally handle the `payments` sub with its `onboard` leaf:
```ts
case "brand": {
  const brandId = rest[0];
  const sub = rest[1];
  if (!brandId) return null;
  if (sub === "team") return `/brand/${brandId}/team`;
  if (sub === "listing") return `/brand/${brandId}/listing`;
  if (sub === "payments") {
    // rest[2] === "onboard" → the KYC/stall onboarding screen; bare → payments hub.
    return rest[2] === "onboard"
      ? `/brand/${brandId}/payments/onboard`
      : `/brand/${brandId}/payments`;
  }
  return `/brand/${brandId}`;
}
```

**Route-existence proof (verified in worktree):**
- `/brand/{id}/payments/onboard` → `mingla-business/app/brand/[id]/payments/onboard.tsx` ✅ EXISTS
- `/brand/{id}/payments` → `mingla-business/app/brand/[id]/payments/index.tsx` ✅ EXISTS

**Expo Router note:** `BusinessNavTarget` is an Expo Router *path string* fed to `router.push` (businessNotificationRouting.ts:43-44); `/brand/{id}/payments/onboard` is a valid file-route href (https://docs.expo.dev/router/navigating-pages/).

**🎨 OPEN:** the implementor MAY refactor the `payments` branch shape (e.g. a small lookup) so long as the exact two outputs above are produced and the bare-`payments` path keeps returning `/brand/${brandId}/payments` (currency for the `payments` head case at `:74-77` which resolves to current brand — leave that head case untouched).

**Success criteria:**
- **SC-15.1 (LOCKED):** `parseBusinessDeepLink("mingla-business://brand/B/payments/onboard")` returns `"/brand/B/payments/onboard"`.
- **SC-15.2 (LOCKED):** `parseBusinessDeepLink("mingla-business://brand/B/payments")` returns `"/brand/B/payments"`.
- **SC-15.3 (LOCKED — no regression):** `team`, `listing`, bare `brand/{id}`, and missing-`brandId` cases return exactly what they returned before.
- **SC-15.4 (LOCKED — outcome):** a tapped `stripe.kyc_stall_reminder` (and `stripe.deadline_warning_{tier}d`) routes to `/brand/{id}/payments/onboard`, not `/brand/{id}`.

---

### GAP 16 (REDEFINED) — deadline_warning recipients are correct; fixed by Gap 15 🔒 LOCKED

**Determination: CLIENT-ONLY, fully covered by Gap 15. No backend change. No edge function touched.**

**Evidence (re-verified):** `stripe-kyc-stall-reminder/index.ts` emits `stripe.deadline_warning_{tier}d` through `notifyBrand` (`:162`), which resolves real recipients (`getBrandPaymentManagerUserIds`, `:31`) and dispatches `userId: userIds[i]` (`:40`) with `deepLink: mingla-business://brand/${brandId}/payments/onboard` (`:52`). Recipients are populated; the type carries the `stripe.` prefix so `resolveOneSignalApp` routes it to the business app correctly. Its ONLY defect is the dropped `payments/onboard` sub-path — Gap 15.

**Success criterion:**
- **SC-16.1 (LOCKED):** after Gap 15's fix, a tapped `stripe.deadline_warning_{tier}d` routes to `/brand/{id}/payments/onboard`. (Same assertion as SC-15.4, distinct type.)
- **SC-16.2 (LOCKED — documentation):** the IMPLEMENT report must record the corrected finding (deadline_warning recipient is NOT null) so the World Map / investigation are reconciled. No code.

---

### GAP 17 — `partner_stripe.detach_completed` wrong app + nonexistent route (🔴 + 🟠 → BOTH) 🔒 LOCKED

Two independent defects, both must be fixed.

#### 17a — BACKEND: re-route through the business OneSignal app

**File:** `supabase/functions/partner-stripe-detach/index.ts`, dispatch block **`:125-135`**.

**Current code (verbatim, `:125-135`):**
```ts
await dispatchNotification({
  userId,
  brandId: null,
  type: "partner_stripe.detach_completed",
  title: "Stripe disconnected",
  body: "Your partner Stripe account is no longer linked. Reconnect anytime from Partner Earnings.",
  relatedId: stripeAccountId,
  relatedType: "partner_stripe_connect_account",
  idempotencyKey: `partner_stripe.detach_completed:${stripeAccountId}:${userId}`,
  deepLink: "mingla-business://account/partner-earnings",
});
```

**Why it's broken:** this goes through `notify-dispatch`, which calls `resolveOneSignalApp(type)` (`notify-dispatch/index.ts:500`). `resolveOneSignalApp` (push-utils.ts:52-57) returns `"business"` **only** for `business.*`/`stripe.*` prefixes. `partner_stripe.` matches neither → falls to `"consumer"`. A partner is a business-app user → **the business device never receives it** (per OneSignal's no-cross-app-send rule, https://documentation.onesignal.com/docs/keys-and-ids).

**Chosen fix (re-prefix at emit, NOT widen the shared chokepoint):**
Change the emitted `type` from `partner_stripe.detach_completed` to **`stripe.partner_detach_completed`** so it inherits the existing `stripe.` business-app routing — zero change to the shared `resolveOneSignalApp` and zero risk to consumer routing.

**Rationale for this over widening `resolveOneSignalApp`:** `resolveOneSignalApp` is a shared consumer/business chokepoint (investigation §6 constraint 5). Adding a `partner_stripe.` prefix there is also valid but enlarges the business-prefix set and forces a routing-test rewrite for a single call site. Re-prefixing one emitter to the already-routed `stripe.` namespace is the minimal, lowest-blast-radius change and keeps `business.`/`stripe.` behavior byte-stable. **LOCKED to the re-prefix approach.**

**After (verbatim target):**
```ts
await dispatchNotification({
  userId,
  brandId: null,
  type: "stripe.partner_detach_completed",
  title: "Stripe disconnected",
  body: "Your partner Stripe account is no longer linked. Reconnect anytime from Partner Earnings.",
  relatedId: stripeAccountId,
  relatedType: "partner_stripe_connect_account",
  idempotencyKey: `stripe.partner_detach_completed:${stripeAccountId}:${userId}`,
  deepLink: "mingla-business://partner/earnings",
});
```
(Note both the `type`, the `idempotencyKey` prefix, AND the `deepLink` change — the deepLink fix is 17b.)

**Consumer-routing safety:** there is no existing consumer notification type beginning `stripe.partner_` (grep `supabase/functions` for `partner_detach` returns only this emitter). Re-prefixing cannot collide with or steal a consumer notification.

#### 17b — CLIENT + BACKEND: point the deep link at a real route the parser handles

**The route truth (verified):** partner earnings lives at `mingla-business/app/partner/earnings.tsx` → Expo Router path `/partner/earnings`. There is **no** `app/account/partner-earnings.tsx` — the old deep link `mingla-business://account/partner-earnings` was nonexistent on two counts (the `account` head is unhandled by the parser AND the path file doesn't exist).

**Backend half (already in 17a's `after` block):** emit `deepLink: "mingla-business://partner/earnings"`.

**Client half — `parseBusinessDeepLink` must handle the `partner` head.**
**File:** `mingla-business/src/services/businessNotificationRouting.ts`, the `switch (head)` in `parseBusinessDeepLink` (`:69-92`). Add a `case "partner":` before `default`:
```ts
case "partner": {
  // mingla-business://partner/earnings → the partner earnings screen.
  const sub = rest[0];
  return sub === "earnings" ? `/partner/earnings` : null;
}
```

**Route-existence proof:** `/partner/earnings` → `mingla-business/app/partner/earnings.tsx` ✅ EXISTS.

**🎨 OPEN:** the implementor MAY collapse 17b's `partner` case into a small map alongside the other heads; the exact output `"/partner/earnings"` for `partner/earnings` is LOCKED.

**Success criteria (Gap 17):**
- **SC-17.1 (LOCKED — backend, routing):** `resolveOneSignalApp("stripe.partner_detach_completed")` returns `"business"` (inherited; no change to push-utils needed). A `deno test` asserting this is required.
- **SC-17.2 (LOCKED — backend, emit):** `partner-stripe-detach` emits `type: "stripe.partner_detach_completed"` and `deepLink: "mingla-business://partner/earnings"` (and the idempotencyKey prefix matches). No emitter of `partner_stripe.detach_completed` remains in `supabase/functions/`.
- **SC-17.3 (LOCKED — client, parser):** `parseBusinessDeepLink("mingla-business://partner/earnings")` returns `"/partner/earnings"`.
- **SC-17.4 (LOCKED — outcome):** a tapped partner-detach notification reaches the **business** OneSignal app and routes to `/partner/earnings` (not `/(tabs)/account`).
- **SC-17.5 (LOCKED — no regression):** unhandled heads (e.g. a bare unknown scheme path) still return `null` → caller's NAV_TARGETS fallback unchanged.

---

### VENUE_CLAIM VERIFICATION — VERDICT: **IN SCOPE** (mis-routed to consumer app) 🔒 LOCKED

**Resolved from code — no operator answer required.**

**The two emitters (verbatim):**
1. `venue_claim_review` — `admin-review-venue-claim/index.ts:631-643`:
```ts
const pushCopy = pushCopyForReview(parsed.action, brandName);
if (pushCopy && !noop && typeof brandRow.account_id === "string") {
  pushSent = await sendPush({
    targetUserId: brandRow.account_id,
    title: pushCopy.title,
    body: pushCopy.body,
    data: { type: "venue_claim_review", brand_id: parsed.brandId, action: parsed.action },
    androidChannelId: "system",
  });
}
```
2. `venue_claim_feedback` — `admin-review-venue-claim/index.ts:314-327`:
```ts
if (fbBrand && typeof fbBrand.account_id === "string") {
  const copy = feedbackPushCopy((fbBrand.name as string) ?? "Your venue");
  pushSent = await sendPush({
    targetUserId: fbBrand.account_id,
    title: copy.title,
    body: copy.body,
    data: { type: "venue_claim_feedback", brand_id: parsed.brandId, round },
    androidChannelId: "system",
  });
}
```

**Why both are mis-routed (proven):**
- Both call **`sendPush(...)` DIRECTLY** — bypassing `notify-dispatch`/`dispatchNotification`, so `resolveOneSignalApp(type)` is never invoked for them.
- Neither passes an `app` parameter → `sendPush` defaults `appType = payload.app ?? "consumer"` (push-utils.ts:99) → both deliver through the **consumer** OneSignal app.
- Both target **`brand.account_id`** / `fbBrand.account_id` — the **organiser/owner** (a business-app user). Confirmed organiser-targeted by ORCH-1064 [venue-claim-feedback], whose shipped feature establishes the business/organiser as the intended recipient (the `business.claim_decision` sibling in the SAME file at `:659-670` correctly routes the same `brand.account_id` recipient through `dispatchNotification` → business app).
- Therefore: **organiser-targeted notifications delivered to the consumer app → they never reach the business device.** Same defect class as Gap 17a.

**Secondary defect:** neither carries a `deepLink` (just `data: { type, brand_id, ... }`). Even once delivered to the business app, the client `resolveBusinessNavTarget` has no deepLink to parse and no NAV_TARGETS case for `venue_claim_review`/`venue_claim_feedback` → falls to `ACCOUNT_FALLBACK = /(tabs)/account` (businessNotificationRouting.ts:142). The organiser would land on the account tab rather than the venue listing.

**Fix (BACKEND-ONLY for the routing defect; client routing is a degraded-but-safe fallback — see decision):**

The **routing defect (wrong app)** is the in-scope P-level miss and MUST be fixed. The cleanest fix that reaches the business app is to add `app: "business"` to BOTH `sendPush` calls (these are direct `sendPush` calls, so `resolveOneSignalApp` re-prefixing does not apply — they never enter notify-dispatch):

`admin-review-venue-claim/index.ts:632` and `:316` — add `app: "business",` to the `sendPush` payload:
```ts
pushSent = await sendPush({
  targetUserId: brandRow.account_id,   // (or fbBrand.account_id for feedback)
  title: ...,
  body: ...,
  data: { type: "venue_claim_review", brand_id: parsed.brandId, action: parsed.action },
  androidChannelId: "system",
  app: "business",   // ← organiser-targeted → business OneSignal app (was consumer)
});
```

**🎨 OPEN — client landing improvement (RECOMMENDED, not LOCKED):** add a `deepLink: "mingla-business://brand/${parsed.brandId}/listing"` to both data payloads so the organiser lands on the venue listing instead of the account tab. The investigation shows `business.claim_decision` (same file, same recipient) uses exactly this deep link. The implementor SHOULD add it; if they do, the parser already handles `brand/{id}/listing` (no parser change). This is OPEN because the wrong-app fix is the load-bearing requirement; the landing-screen polish is a quality add that doesn't gate correctness.

**Success criteria (venue_claim):**
- **SC-VC.1 (LOCKED — backend):** both `venue_claim_review` and `venue_claim_feedback` `sendPush` calls pass `app: "business"`.
- **SC-VC.2 (LOCKED — outcome):** an organiser receiving a venue-claim review/feedback notification gets it on the **business** OneSignal app (proven by the `app_id` in the captured push request).
- **SC-VC.3 (OPEN):** if the deepLink is added, a tapped venue-claim notification routes to `/brand/{id}/listing`; absent the deepLink it routes to `/(tabs)/account` (safe fallback, no crash).

---

## 4. Files touched (exhaustive)

| File | Layer | Change | Edge fn? |
|------|-------|--------|----------|
| `mingla-business/src/services/businessNotificationRouting.ts` | Client (parser) | Gap 15 `payments`/`onboard` sub-branch + Gap 17b `partner` head case | — |
| `supabase/functions/partner-stripe-detach/index.ts` | Backend (edge) | Gap 17a re-prefix `type`+idempotencyKey to `stripe.partner_detach_completed`; deepLink → `mingla-business://partner/earnings` | YES |
| `supabase/functions/admin-review-venue-claim/index.ts` | Backend (edge) | VC: add `app: "business"` to both `sendPush` calls (+ optional listing deepLink) | YES |
| `mingla-business/src/services/__tests__/businessNotificationRouting.test.ts` | Client test | Gap 15 + 17b regression cases (implementor happy-path) | — |
| `supabase/functions/_shared/__tests__/meta_orch_1074_push_routing.test.ts` **or** a new `supabase/functions/admin-review-venue-claim/__tests__/orch_1082_*.test.ts` | Edge test | Gap 17a + VC routing assertions | YES (test) |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | CI gate | `ORCH_1082_BACKEND_ALLOWLIST` (see §6) | — |

**No migration. No RLS. No DB function.** Confirmed: the `notifications` table + `deep_link` column already exist and are written by `notify-dispatch`.

---

## 5. Regression test contracts (TWO required — distinct angles)

### Test 1 — implementor happy-path (FAILS-on-revert) — CLIENT parser
**Path:** `mingla-business/src/services/__tests__/businessNotificationRouting.test.ts` (Jest; file exists).
**Cases (each FAILS if the corresponding parser branch is reverted):**
- `parseBusinessDeepLink("mingla-business://brand/B/payments/onboard")` → `"/brand/B/payments/onboard"` (Gap 15; reverting the `payments` branch yields `"/brand/B"` → fail).
- `parseBusinessDeepLink("mingla-business://brand/B/payments")` → `"/brand/B/payments"` (Gap 15 bare).
- `parseBusinessDeepLink("mingla-business://partner/earnings")` → `"/partner/earnings"` (Gap 17b; reverting the `partner` case yields `null` → fail).
- Regression guards: `team`→`/brand/B/team`, `listing`→`/brand/B/listing`, bare `brand/B`→`/brand/B`, unknown head → `null`.
**Why it FAILS-on-revert:** asserts the exact post-fix path string for the previously-dropped inputs; the pre-fix parser returns `/brand/B` or `null` for those exact inputs.

### Test 2 — tester adversarial angle (DISTINCT) — BACKEND push-app routing + emit shape
**Path:** new `supabase/functions/admin-review-venue-claim/__tests__/orch_1082_push_app_routing.test.ts` (Deno; mirrors the `meta_orch_1074_push_routing.test.ts` fetch-stub pattern). The adversarial framing: *prove an organiser-targeted push physically cannot land on the consumer app_id.*
**Cases:**
- **17a:** `resolveOneSignalApp("stripe.partner_detach_completed")` === `"business"` AND `resolveOneSignalApp("partner_stripe.detach_completed")` === `"consumer"` (proves the OLD type was wrong and the NEW type is right — guards against a partial re-prefix).
- **17a emit-shape (source assertion):** read `partner-stripe-detach/index.ts` source and assert it contains `"stripe.partner_detach_completed"` and `"mingla-business://partner/earnings"` and does **NOT** contain `"partner_stripe.detach_completed"` or `"mingla-business://account/partner-earnings"` (catches a stale string).
- **VC (adversarial — the load-bearing assertion):** with the OneSignal fetch stubbed (capture `app_id`), a `sendPush({ app: "business", ... })` call hits the **BUSINESS** app_id; AND a source assertion that both `venue_claim_review` + `venue_claim_feedback` `sendPush` payloads in `admin-review-venue-claim/index.ts` include `app: "business"`. The adversarial twist vs Test 1: it attacks the *delivery target* (which app physically receives the push), a layer Test 1 (pure path parsing) never exercises — so the two tests fail for different reasons and neither subsumes the other.
**Why it's a distinct adversarial angle:** Test 1 proves "given delivery, the path is right"; Test 2 proves "delivery reaches the right app at all" — the exact bug an organiser hits (push silently lands on the consumer app and is never seen). A reviewer trying to ship 17a/VC without the app fix passes Test 1 and fails Test 2.

> **Deno env note:** the routing test must `Deno.env.set` the four OneSignal creds (per the existing `setAllCreds()` helper) before importing `push-utils.ts`. Run: `deno test --allow-env --allow-read supabase/functions/admin-review-venue-claim/__tests__/orch_1082_push_app_routing.test.ts`.

---

## 6. C7 backend allowlist requirement (COMMS-0002 — MANDATORY, same commit)

Any added/modified `supabase/functions/**` file trips ORCH-0863 C7 `no-new-backend-files`. Per COMMS-0002 + COMMS-0015, the SPEC REQUIRES, **in the same commit as the backend change**, adding to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`:

```js
// ORCH-1082 [business notification deep-link handlers — residual routing fixes]:
// MODIFIES partner-stripe-detach (re-prefix type → stripe.* so it reaches the
// business OneSignal app + correct deepLink) and admin-review-venue-claim
// (app:"business" on the venue_claim_review/feedback direct sendPush calls).
// C7 flags MODIFIED backend files too. Per COMMS-0002 — lands in the SAME commit.
const ORCH_1082_BACKEND_ALLOWLIST = [
  "supabase/functions/partner-stripe-detach/index.ts",
  "supabase/functions/admin-review-venue-claim/index.ts",
  "supabase/functions/admin-review-venue-claim/__tests__/orch_1082_push_app_routing.test.ts",
];
```
…and add `...ORCH_1082_BACKEND_ALLOWLIST,` to the `const ALLOWLIST = [ ... ]` spread block (currently `:1801-`). Note `partner-stripe-detach/index.ts` is NOT yet in any allowlist; `admin-review-venue-claim/index.ts` already appears in META_ORCH_1074 + ORCH_1066 allowlists, but C7 de-dupes via membership so re-listing under ORCH-1082 is safe and keeps the provenance comment scoped.

**Verification:** the implementor MUST run the full strict-grep gate locally and confirm C7 exits 0 before pushing (precedent: ORCH-1064/1066 ledger acks).

**Deploy-at-close (COMMS-0015):** edge functions are deployed from MERGED main at CLOSE, never from this worktree. This SPEC mandates **no deploy and no `supabase db push`** (there is no migration).

---

## 7. Invariants

- **I-NOTIFICATIONS-FILTERED-BY-APP-TYPE-PREFIX (`I-PROPOSED-W`):** preserved. Gap 17a re-prefixes to the already-business `stripe.` namespace; `resolveOneSignalApp` byte-stable (no edit to push-utils.ts). VC uses an explicit `app: "business"` on a direct `sendPush` (the invariant's prefix rule governs `notify-dispatch`-routed pushes; direct `sendPush` callers must pass `app` explicitly — this SPEC makes that compliance explicit and adds a test).
- **SC-A2 (no cross-app fallback):** preserved — `sendPush` still skips+returns false when business creds are absent (unchanged).
- **Constitution #3 (no silent failures):** `markRowClicked` row-count verify path unchanged; the new parser branches return real paths (no swallow).
- **NEW micro-invariant proposed (DRAFT for orchestrator):** *Every organiser-targeted `sendPush` direct call (not routed through `notify-dispatch`) MUST pass `app: "business"`.* A future strict-grep could assert no `sendPush({...account_id...})` lacks `app:"business"` in business-owner contexts. Register only if the orchestrator wants the gate; not required to close ORCH-1082.

---

## 8. Cross-Surface Impact

**In scope:**
1. **Business iOS** (`mingla-business/` on iOS) — Gap 15 + 17b parser fix (shared TS, automatic parity with Android); Gap 17a + VC backend fixes deliver the push to this device. User-visible: KYC/stall + deadline taps open the onboarding screen; partner-detach + venue-claim notifications now arrive on the business device and route correctly. Files: `businessNotificationRouting.ts` (client) + the two edge fns (backend).
2. **Business Android** (`mingla-business/` on Android) — identical to iOS; the parser is shared JS (automatic parity) and the push-app routing is platform-agnostic (OneSignal external_id). **No separate per-platform success criterion needed** — there is no platform-divergent code path; SC-15.*/17.*/VC.* hold on both. (If TEST wants device proof, run one tap per platform; not a code requirement.)
3. **Touched edge functions** (server-side, platform-agnostic): `partner-stripe-detach`, `admin-review-venue-claim`.

**NOT in scope (with reason):**
- **Consumer iOS / Consumer Android** (`app-mobile/`) — these notifications are organiser-only; the consumer app has its own (correct) handler. Re-prefixing 17a and adding `app:"business"` to VC REMOVES erroneously-consumer-routed pushes from the consumer app — a correction, not a consumer feature. No consumer code touched.
- **Buyer/anonymous Web** (`mingla-business/` `/checkout`, `/e/…`, `/b/…`) — anon buyers have no notification inbox / push registration; these routes don't expose organiser notifications.
- **Admin Web** (`mingla-admin/`) — admins trigger `admin-review-venue-claim` but don't receive these organiser pushes; admin doesn't render this.
- **Business Web preview** (dev/web build) — push notifications are native-only (`@stripe/stripe-react-native` analog: OneSignal SDK is native); web preview can't receive a tap. Parser unit tests still run in Jest regardless.

---

## 9. Implementation order

1. **Client parser** (`businessNotificationRouting.ts`): add Gap 15 `payments`/`onboard` branch + Gap 17b `partner` head case.
2. **Client test** (`businessNotificationRouting.test.ts`): add the Test-1 cases; run Jest green.
3. **Backend 17a** (`partner-stripe-detach/index.ts`): re-prefix type+idempotencyKey to `stripe.partner_detach_completed`; deepLink → `mingla-business://partner/earnings`.
4. **Backend VC** (`admin-review-venue-claim/index.ts`): add `app: "business"` to both `sendPush` calls (+ optional listing deepLink).
5. **Backend test** (`admin-review-venue-claim/__tests__/orch_1082_push_app_routing.test.ts`): add Test-2 cases; run `deno test` green.
6. **C7 allowlist** (`orch-0863-marketing-hub-phase-b.mjs`): add `ORCH_1082_BACKEND_ALLOWLIST` + spread — SAME commit as steps 3-5. Run full strict-grep, confirm C7 exit 0.
7. PR → main. **No deploy, no db push from the worktree.** Edge fns deploy from merged main at CLOSE.

---

## 10. Regression prevention

- The two distinct tests (client path + backend app-routing) lock both halves of every gap; reverting any single branch fails a named assertion.
- The 17a source-string assertion (no `partner_stripe.detach_completed`, no `account/partner-earnings` remaining) prevents a stale-string regression.
- The proposed DRAFT micro-invariant (§7) documents the "direct `sendPush` must pass `app`" rule so the next organiser-push author doesn't repeat the VC/17a class of bug.
- Protective comments at each fix site cite the gap + the OneSignal dual-app docs URL (COMMS-0003).

---

## 11. Completion self-check (SPEC `/goal`)

- [x] Gaps 15/16/17 each with exact file:line + verbatim before/after + per-gap client/backend/both determination.
- [x] Gap 16 root-cause overturn resolved from code (deadline_warning recipient is NOT null; fixed by Gap 15) — documented, no operator needed.
- [x] venue_claim prefix verdict resolved from code: **IN SCOPE** (direct `sendPush` defaults to consumer app; organiser-targeted) — fix = `app:"business"`.
- [x] Two regression-test contracts at real paths, FAILS-on-revert + distinct adversarial angle.
- [x] C7 `ORCH_1082_BACKEND_ALLOWLIST` requirement for both edge fns + test, same commit (COMMS-0002), deploy-from-merged-main at close (COMMS-0015).
- [x] Cross-Surface Impact: business iOS+Android + 2 edge fns in; consumer/admin/buyer-web out, with reasons.
- [x] External OneSignal + Expo Router docs URLs cited inline (COMMS-0003).
- [x] No code changed; spec only.
