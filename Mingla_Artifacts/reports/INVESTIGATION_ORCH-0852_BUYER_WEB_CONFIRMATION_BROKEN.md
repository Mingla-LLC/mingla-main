# INVESTIGATION — ORCH-0852 [Buyer-web confirmation QR clipped + wallet passes inert + in-app-browser stuck after payment]

**Mode:** INVESTIGATE
**Confidence:** Mixed — `proven` (Symptom C, Symptom B); `suspected` (Symptom A — see Phase 1 note)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigator:** Claude `mingla-forensics`

---

## Symptom Summary

Three buyer-checkout symptoms reported by operator with two screenshots:

- **A.** After completing a paid checkout on the public event page (web), the QR code on the confirmation screen renders clipped/half-visible.
- **B.** "Add to Apple Wallet" and "Add to Google Wallet" buttons on the confirmation screen are non-functional.
- **C.** When the buyer purchases through the **business app's native checkout** (not the web page in WebView — clarified below), the screen gets stuck on a "Payment received — Your ticket will arrive by email and message shortly" banner and never advances to the confirmation/QR screen. The "Pay $110.00" button is greyed out.

---

## Phase 0 — Ingest Log

| Artifact | Read | Constraint it imposes |
|---|---|---|
| `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md` | yes | Three symptom threads, hypotheses to verify or disprove, hard guards (read-only, no fixes proposed) |
| `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md` | grepped for `wallet`/`pkpass`/`apple pay`/`google pay` — **zero hits** | ORCH-0777 [Production ticket checkout + buyer notifications] never promised wallet pass functionality; symptom B is missing-feature not regression |
| `Mingla_Artifacts/specs/SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md` | indirectly via in-code citation in `payment.tsx` L53-57 | ORCH-0849 [Stripe payment method parity] introduced native PaymentSheet flow with the polling-finalize-or-timeout pattern that is the root cause of Symptom C |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | full file | The native PaymentSheet flow; the "Payment received" copy lives here, gated on `finalizingTimedOut` state |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | L350-460 | Confirmation screen showing QR carousel + wallet stubs + "Back to event" button (matches screenshot 2 layout exactly) |
| `mingla-business/app/o/[orderId].tsx` | full file | Mirror of confirm.tsx for re-visited order detail; identical wallet stub pattern |
| `mingla-business/src/components/checkout/TicketQrCarousel.tsx` | full file | Multi-ticket horizontal-paging carousel; structural absence of explicit height in `styles.host`/`styles.page` |
| `mingla-business/src/services/ticketCheckoutService.ts` L100-145 | yes | `pollTicketCheckoutStatus` + `FINALIZATION_BACKOFF_MS = [1000, 1500, 2000, 3000, 4000, 5000]` — total polling budget ~16.5s, then null returned |
| MEMORY.md (auto-loaded) | yes | Cross-Surface Impact rule, RN inline-style colors, anon buyer routes, response-shape-conditional |

---

## Phase 1 — Repro evidence

**Operator's repro is the authoritative live-fire evidence** (two screenshots, dated 2026-05-17 01:37 and 01:38 BST):

- **Screenshot 1** — native iOS business app, payment.tsx screen, step "3 OF 3", "ORDER SUMMARY 2× The Paid $110.00 / Total $110.00", "PAYMENT" card with "Session 90defa2d", and a SECOND card titled "Payment received" with subcopy "Your ticket will arrive by email and message shortly." Pay button at bottom is greyed/disabled. No URL bar = native chrome.
- **Screenshot 2** — in-app browser (Safari View Controller header "◀ Business", URL "business.usemingla.com"), buyer-web confirm screen, event "The Reckoning Sun 17 May · 01:35", "2× The Paid $110.00", "Order a5f1c8a3-f706-4dbd-9b53-640b97e61e37", QR code with **top and bottom portions clipped** (visible QR pattern occupies only a horizontal strip inside the white background), "Ticket 1 of 2 —" caption with single orange dot + dim dot, "Swipe to see next ticket" hint, Apple/Google Wallet buttons, "Back to event" CTA.

**Caveat on confidence:** I did NOT run an independent browser repro with DevTools to capture the QR container's computed CSS for symptom A. Per Prime Directive 7, source-only reasoning on a UI/runtime bug maxes at "suspected." Symptoms B and C, by contrast, are fully provable from source because their behaviour is deterministic from the code (the wallet `onPress` is `setWalletToast(true)` with no other effect; the "Payment received" copy is emitted ONLY when `finalizingTimedOut` is set and `router.replace` is gated behind a non-null status). Symptom A's container-collapse hypothesis is consistent with the source but needs DOM inspection to elevate to `proven`.

---

## Phase 2 — Five-Truth-Layer Cross-Check

### Symptom A — QR clipped (multi-ticket carousel on web)

| Layer | Finding |
|---|---|
| Docs | TicketQrCarousel header comment (L1-12) declares "Cycle 11 J-S8 — replaces single-QR rendering on /checkout/{eventId}/confirm and /o/{orderId}. One QR per seat... mirrors Apple Wallet's passes-as-cards UX." No web-specific layout note. |
| Schema | N/A |
| Code | `TicketQrCarousel.tsx:159-213` styles: `host` has no `height`; `page` has no `height` — only `alignItems`/`justifyContent`/`gap`/`paddingHorizontal`. `pageWidth` defaults to `Dimensions.get("window").width` and updates via `onLayout`. On RNW, `<ScrollView horizontal pagingEnabled>` becomes a `<div>` with `overflow-x:auto; overflow-y:hidden` and depends on its intrinsic content height to size vertically — but each child has `width: pageWidth` (full window width on web), which can exceed the GlassCard container's inner width and cause the browser to size the ScrollView height based on a wrap-collapsed flexbox rather than the QR's intrinsic 200×200 dimensions. |
| Runtime | Screenshot 2 shows the QR clipped vertically; the top and bottom of the QR matrix are missing while the left/right edges and the white background extend further. Consistent with a parent `overflow:hidden` clipping a child taller than the container. Not independently DOM-inspected (see Phase 1 caveat). |
| Data | N/A |

Layers in tension: Docs imply pristine pass-card UX; Code lacks explicit vertical sizing; Runtime shows clipping. Two-layer agreement (Code + Runtime) supports the hypothesis but not at `proven` strength without browser DevTools confirmation.

### Symptom B — Wallet buttons inert

| Layer | Finding |
|---|---|
| Docs | `mingla-business/app/o/[orderId].tsx:16` header comment: `Wallet add row (TRANSITIONAL — same stub as confirm.tsx)`. `confirm.tsx:15`: `[TRANSITIONAL] Wallet add is a toast — Apple .pkpass + Google Wallet ...` (truncated in grep). ORCH-0777 SPEC has ZERO matches for `wallet`/`pkpass`/`apple pay`/`google pay`. |
| Schema | No `wallet_pass_tokens` table; no `.pkpass` storage bucket; no wallet-related columns in `orders`/`tickets`. |
| Code | `o/[orderId].tsx:209-214` and `confirm.tsx` parallel: `handleWalletAdd = useCallback((): void => { setWalletToast(true); }, [])` — only effect is showing the `<Toast … message="Coming soon — saved to your account." />` (o/[orderId].tsx:491). No edge function call, no pass generation, no deep-link. |
| Runtime | Tapping the buttons would show a toast and do nothing else; screenshot 2 captures the state BEFORE tap, so no toast visible. |
| Data | N/A |

All layers agree: this is an intentional placeholder stub that predates ORCH-0777. No layer ever promised functional wallet passes.

### Symptom C — Stuck on "Payment received"

| Layer | Finding |
|---|---|
| Docs | `payment.tsx:53-57` header comment cites ORCH-0849 [Stripe payment method parity] for the native PaymentSheet pivot; ORCH-0849 SPEC `SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md` exists. |
| Schema | The Stripe webhook → `biz_ticket_checkout_finalize` RPC writes the orders row. If the webhook is delayed >16.5s OR fails, the order row never appears. |
| Code | `payment.tsx:356`: `const status = await pollTicketCheckoutStatus(sessionId, "")`. `ticketCheckoutService.ts:131-138`: polls 7 times against `FINALIZATION_BACKOFF_MS = [1000, 1500, 2000, 3000, 4000, 5000]` then a final immediate fetch — total wait budget ~16.5s. Returns `null` if all fetches still have `order === null`. `payment.tsx:358-373`: on null/`order===null`, `setFinalizingTimedOut(true)` is fired and the function `return`s — `router.replace("/confirm")` (L393) NEVER runs. `payment.tsx:514-525` render block: `{finalizing || finalizingTimedOut ? (<GlassCard>...{finalizingTimedOut ? "Payment received" : "Finalizing your tickets..."}... {finalizingTimedOut ? "Your ticket will arrive by email and message shortly." : "Stripe has accepted the payment..."}</GlassCard>) : null}` — this is verbatim the copy in screenshot 1. `payment.tsx:553`: `<Button … disabled={processing \|\| finalizingTimedOut} />` — matches the greyed Pay button. There is NO recovery affordance, NO retry, NO link to the order, NO "find my ticket" CTA. |
| Runtime | Screenshot 1 shows the exact `finalizingTimedOut === true` UI state. |
| Data | The buyer's order row eventually IS created by the webhook (the operator received the order detail in screenshot 2 via the email/SMS link), proving the payment captured and the order finalized server-side. The user simply doesn't see it because the mobile client gave up polling before the webhook arrived. |

Strong five-layer alignment. The orchestrator's WebView hypothesis (from the dispatch §"Likely root cause hypothesis") is **DISPROVEN**: screenshot 1 is the native business app's own payment.tsx screen, not a WebView. The Stripe redirect/return path is irrelevant here — the native PaymentSheet completed successfully and the bug is in the post-payment polling timeout fallback.

---

## Phase 3 — Root cause classifications

### 🔴 ROOT CAUSE — Symptom C — Polling timeout in native PaymentSheet flow leaves buyer permanently stranded

| Field | Detail |
|---|---|
| File + line | `mingla-business/app/checkout/[eventId]/payment.tsx:356-373` (the polling call + null-return handler) and `payment.tsx:514-525` (the render that surfaces the stranded state). Supporting: `mingla-business/src/services/ticketCheckoutService.ts:79` (`FINALIZATION_BACKOFF_MS = [1000, 1500, 2000, 3000, 4000, 5000]`), `ticketCheckoutService.ts:124-138` (poll loop), `payment.tsx:553` (button disable). |
| Exact code | `const status = await pollTicketCheckoutStatus(sessionId, "");` followed by `if (status === null \|\| status.order === null) { ... setFinalizingTimedOut(true); setFinalizing(false); setProcessing(false); ...mixpanelService.track("ticket_checkout_failed", ... reason: "finalize_timeout" ...); return; }`. Then in render: `{finalizingTimedOut ? "Payment received" : "Finalizing your tickets..."}` + `{finalizingTimedOut ? "Your ticket will arrive by email and message shortly." : "Stripe has accepted the payment..."}`. |
| What it does | Stripe PaymentSheet succeeds → polls `ticket-checkout-status` 7 times across ~16.5 seconds → if the Stripe webhook hasn't finalized the order in that window (or if the polling edge function returns `order === null` for any other reason), sets `finalizingTimedOut = true` → renders a reassuring "Payment received" placeholder → `router.replace` to /confirm is unreachable → buyer is stuck on the payment screen with a disabled Pay button. No retry, no recovery, no order link, no "open my order" CTA. The mixpanel event `ticket_checkout_failed { reason: "finalize_timeout" }` fires but the user-facing UI hides this as success. |
| What it should do | EITHER (a) keep polling longer with visible progress UI and explicit timeout messaging; OR (b) on timeout, surface a recovery affordance — link to `/o/{orderId}` once webhook eventually completes, link to email/SMS confirmation, a "Retry / Check now" button that resumes polling, or a "Go to my order" CTA. Constitution Rule 3 (No silent failures) is violated: an error path is being painted as success copy ("Payment received"). |
| Causal chain | Buyer taps Pay → native PaymentSheet opens → Stripe charges card → PaymentSheet returns `succeeded` (`payment.tsx:347`) → `pollTicketCheckoutStatus` runs (L356) → webhook+finalize RPC lag exceeds 16.5s, OR `ticket-checkout-status` edge function returns null shape → `finalizingTimedOut = true` (L360) → render switches to the timeout copy "Payment received…" (L517-523) → Pay button disabled (L553) → no further interactive path → user stranded. The order row IS eventually created server-side (proven by screenshot 2 showing the order with QR via in-app browser entry from the email/SMS link), but the user has no in-app route to find it. |
| Verification step | (1) Read `payment.tsx:356-373` and L514-525 — the copy in screenshot 1 is impossible to produce from any other code path. (2) Read `ticketCheckoutService.ts:79` — confirm 16.5s budget is too tight for tail-latency Stripe webhooks. (3) Operator received the email/SMS containing the order link (implied by being able to load screenshot 2's `/checkout/{eventId}/confirm` with `Order a5f1c8a3-…` in the in-app browser) — proves order finalized server-side after the 16.5s window. |

**Severity:** S1-high. Buyer pays, payment captures, order is created, but the in-app UI strands them with no recovery path. Trust impact is severe — "did my payment go through?" anxiety while staring at a disabled button.

**Classification:** `bug` + `regression` introduced by ORCH-0849 [Stripe payment method parity] (2026-05-15) when the native PaymentSheet pivot replaced the prior hosted-Stripe-Checkout flow. The prior web flow's full-page redirect didn't have this failure mode because Stripe's `success_url` simply returned the buyer to the `/confirm` page directly; the new native flow must poll for the webhook, and the poll budget is too tight + the timeout fallback is dishonest.

### 🟢 PROVEN MISSING-FEATURE — Symptom B — Wallet buttons are intentional `[TRANSITIONAL]` stubs

| Field | Detail |
|---|---|
| File + line | `mingla-business/app/o/[orderId].tsx:16` (file header), `:209-211` (handler), `:441-457` (button JSX). Mirror in `mingla-business/app/checkout/[eventId]/confirm.tsx:15` (file header), `:432-458` (button JSX + handler). |
| Exact code | `const handleWalletAdd = useCallback((): void => { setWalletToast(true); }, []);` and `<Toast … message="Coming soon — saved to your account." />`. File headers carry the literal label `[TRANSITIONAL]` and `Wallet add row (TRANSITIONAL — same stub as confirm.tsx)`. |
| What it does | Tapping either wallet button toggles a "Coming soon" toast. No `.pkpass` is generated, no Google Wallet save link is constructed, no edge function exists for either pass type, no entitlement is granted. |
| What it should do | Either (a) HIDE the buttons until real wallet pass infrastructure ships — required by Constitution Rule 9 (No fabricated data — never show fake affordances; missing = hidden, never fake) AND by `feedback_no_summary_paragraph.md`'s principle of honesty over polish; OR (b) ship a follow-up ORCH to build Apple `.pkpass` generation (signed PassKit bundle uploaded to Storage, deep-linked via mobile-config) + Google Wallet generic-pass JWT issuance via a new edge function (`wallet-pass-issue` or similar). |
| Causal chain | ORCH-0777 [Production ticket checkout + buyer notifications] shipped the buyer-web checkout flow with the pre-existing Cycle 9b/9c TRANSITIONAL stubs unchanged. ORCH-0777 SPEC never promised wallet pass functionality (grep confirmed zero matches). The buttons render because `showAppleWallet = Platform.OS === "ios" \|\| isWeb` and `showGoogleWallet = Platform.OS === "android" \|\| isWeb` — on web, BOTH show. Buyer expects standard wallet behaviour; product surface lies via affordance. |
| Verification step | (1) `grep -rni "wallet\|pkpass\|apple pay\|google pay" Mingla_Artifacts/specs/SPEC_ORCH-0777_*.md` returns zero matches. (2) `grep -rn "pkpass\|wallet-pass\|appleWallet\|googleWallet" supabase/functions/ supabase/migrations/` returns zero matches — no backend wallet infrastructure exists. (3) Source comments explicitly self-label as `[TRANSITIONAL]`. |

**Severity:** P1-high if we consider the user-facing dishonesty (Constitution Rule 9 violation); P2-medium if we consider it intentionally-deferred polish. **Recommendation goes to operator** — see §"Recommendations" below.

**Classification:** `missing-feature` (NOT regression — never shipped functional).

### 🟡 SUSPECTED ROOT CAUSE — Symptom A — Multi-ticket QR carousel relies on intrinsic vertical sizing that collapses/clips on RNW

| Field | Detail |
|---|---|
| File + line | `mingla-business/src/components/checkout/TicketQrCarousel.tsx:112-156` (multi-ticket render), `:159-213` (styles). |
| Exact code | `<View style={styles.host} onLayout={handleLayout}>` with `host: { alignSelf: "stretch", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.sm }` (no `height`). Inside it `<ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>` — no `style` prop, no explicit `height`. Each page: `<View key={p.ticketId} style={[styles.page, { width: pageWidth }]}>` with `page: { alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md }` (no `height`). |
| What it does | On native iOS/Android, RN's flexbox + ScrollView's content-derived height produce a 200×200 QR with the white wrapper and label fitting naturally. On RNW, the horizontal `<ScrollView>` is rendered as `<div style="flex-direction:row; overflow-x:scroll; overflow-y:hidden; ...">`. Without explicit `height`, the div's height depends on its tallest child — but children with `width: pageWidth = window.innerWidth` may exceed the parent GlassCard's inner width, triggering flexbox shrinking that can collapse vertical bounds. Screenshot 2 shows the QR clipped top/bottom while horizontal padding looks normal — consistent with `overflow-y:hidden` on a parent that's been sized too short. The single-ticket case (L94-110) uses `styles.singleWrap` and bare `<QRCode size={qrSize}>` with no horizontal ScrollView, so single-ticket orders likely render correctly — would need browser repro to confirm. |
| What it should do | Multi-ticket carousel host should set an explicit `height` (e.g., `qrSize + label-height + paddingY` ≈ 280-300px) OR use `aspectRatio: 1` on the page child OR enforce a `minHeight` matching the QR's intrinsic dimensions. The `pageWidth` calculation should also clamp to `Math.min(Dimensions.get("window").width, containerWidth)` measured via `onLayout`, not the raw window width. |
| Causal chain | Buyer reaches confirm.tsx (or /o/{orderId}) on web with a 2+ ticket order → TicketQrCarousel renders in multi-page mode → ScrollView host has no explicit vertical extent → page child's `width: pageWidth` is the full window width which may exceed GlassCard's content area → RNW's flex calculation collapses vertical size → `overflow-y: hidden` on the horizontal ScrollView clips the QR top + bottom → buyer sees half-QR. |
| Verification step | NEEDED — run buyer-web confirm.tsx in desktop Chrome DevTools, inspect the `<ScrollView>` and `.qrInner` computed CSS, measure heights, force `overflow: visible` and see if QR fully renders. ALSO test single-ticket order (1× ticket) to confirm whether the clip is multi-ticket-only (predicted) or affects single-ticket too (would change the hypothesis). |

**Severity:** S1-high. Buyer cannot scan their ticket if half the QR matrix is unreadable. Door staff scanner will not decode a half-QR.

**Confidence:** `suspected`. Strong structural fit but not browser-DOM-verified. Hypothesis would be elevated to `proven` by either: (a) operator confirming the clip ONLY occurs on multi-ticket orders, OR (b) running the buyer-web confirm in Chrome DevTools and capturing the computed height of `[role="scrollbar"]` / the host `<View>`.

**Classification:** `bug` + `regression` likely introduced by Cycle 11 J-S8 when TicketQrCarousel replaced the single-QR rendering, OR latent since first multi-ticket order on web (whichever came first). git log shows the carousel landed in commit `ade877fb` — "Cycle 11 — QR scanner + check-in + scanner-team UI + per-ticket QR carousel".

---

## Phase 4 — Cross-Symptom Analysis

| Question | Answer |
|---|---|
| Do A and C share a component? | **No.** Symptom A is `TicketQrCarousel.tsx` (component layer, web-platform layout). Symptom C is `payment.tsx` + `ticketCheckoutService.ts` (screen-level state machine, native-platform polling). Different surfaces, different platforms, different layers. |
| Do A and B share a component? | **Yes — confirm.tsx + o/[orderId].tsx both render the carousel AND the wallet stubs.** They are visually adjacent on the same screen but the bugs are independent: A is a layout flaw, B is missing functionality. |
| Do B and C share a component? | **No.** |
| Single fix bundle viable? | **No — three independent root causes.** Symptom A needs a styling fix in `TicketQrCarousel.tsx`. Symptom B needs either a hide-the-buttons cleanup OR a brand-new wallet-pass feature ORCH. Symptom C needs polling-budget extension + recovery affordance in `payment.tsx` + likely a `ticket-checkout-status` edge-function tuning pass. They can share an ORCH-0852 banner but the SPEC should be split into three sub-deliverables (M0/M1/M2) with their own success criteria. |

---

## Phase 5 — Blast Radius

| Surface | Symptom A (QR clip) | Symptom B (wallet stub) | Symptom C (stuck on payment) |
|---|---|---|---|
| Consumer iOS / Android (`app-mobile/`) | Not affected — consumer mobile does not render TicketQrCarousel from `mingla-business/`. Consumer's own QR rendering is a separate code path (would need a parallel audit if consumer ticket display has similar carousel). | Not affected — consumer mobile has its own ticket detail screens. | Not affected — consumer mobile has its own checkout flow (`app-mobile/src/payments/nativeCheckoutFlow.ts`) which is the SOURCE of the parity pattern ORCH-0849 ported. **Worth checking** — if consumer's flow has the same timeout-fallback bug, it ships in production today. |
| Buyer-web (`mingla-business` web export) | **AFFECTED** — both `/o/{orderId}` and `/checkout/{eventId}/confirm` render TicketQrCarousel. | **AFFECTED** — both routes render the wallet stubs. | Not affected — web checkout uses full-page Stripe Checkout redirect (`payment.tsx:239-298`), not native PaymentSheet polling. The web path's `success_url` lands directly on `/confirm` with `?cs=` resume. |
| Business iOS / Android (`mingla-business/` native) | Likely not affected — RN ScrollView gives native ScrollViews intrinsic height correctly; the bug is RNW-specific. Worth verifying. | **AFFECTED** — same code path; on iOS shows Apple-only stub, on Android shows Google-only stub (per `showAppleWallet`/`showGoogleWallet` Platform gates). Same "Coming soon" toast outcome. | **AFFECTED — this is the proven repro surface.** Business app iOS native PaymentSheet → poll timeout → stuck. |
| Admin (`mingla-admin/`) | Not affected — admin doesn't render buyer-side confirmation. | Not affected. | Not affected. |
| Business web preview | Same as buyer-web — affected by A and B. | — | — |

**Downstream consumers of `pollTicketCheckoutStatus`:** I-95-pattern check — grep for all callers:
- `mingla-business/app/checkout/[eventId]/payment.tsx:356` (Symptom C source)
- `mingla-business/app/checkout/[eventId]/confirm.tsx:197` (also calls it from the web `?cs=` resume path) — same timeout budget; if web resume polling times out, web buyer would also see a stuck `/confirm` screen with no recovery — **worth flagging as a parallel risk on the web surface** even though operator didn't repro it today.

**Possible consumer-app parallel bug:** `app-mobile/src/payments/nativeCheckoutFlow.ts` is cited in `payment.tsx:55` as the source pattern ORCH-0849 ported. If the consumer side has the same `setFinalizingTimedOut` fallback pattern, consumer buyers may also strand on timeout. Should be a `Discovery for Orchestrator` (see below).

---

## Phase 6 — Invariant Violations

| Invariant | Status | Note |
|---|---|---|
| Constitution Rule 3 — No silent failures | **VIOLATED by Symptom C** | Mixpanel logs `ticket_checkout_failed { reason: "finalize_timeout" }` while the UI shows "Payment received" — error path painted as success. |
| Constitution Rule 9 — No fabricated data / affordances | **VIOLATED by Symptom B** | Wallet buttons render but do nothing; user reasonably expects standard wallet behaviour. |
| Constitution Rule 1 — No dead taps | **VIOLATED by Symptom B** | The buttons "respond" with a toast but the response is non-actionable; arguably a dead tap dressed as a live one. |
| I-ANON-BUYER-ROUTES (anon-tolerant routes) | Preserved | All affected routes correctly avoid `useAuth`. |
| `feedback_universal_skill_output_format` | N/A | This is a chat-output rule. |

---

## Phase 7 — Discoveries for Orchestrator

1. **Parallel risk: web `?cs=` resume on `/confirm` shares the same polling timeout.** `confirm.tsx:197` calls `pollTicketCheckoutStatus(sessionId, "")` after the Stripe success_url returns the buyer to web. Same 16.5s budget. If the webhook is slow on the web path, the buyer hits the same stranded state (the error block at `confirm.tsx:226-232` reads `console.warn("[checkout-confirm] web resume failed", err);` — this is a silent failure on web too). Operator should consider this in-scope for ORCH-0852 even though it wasn't in today's repro. Filed as a sub-symptom worth covering in the SPEC.

2. **Possible consumer-app parallel bug.** `app-mobile/src/payments/nativeCheckoutFlow.ts` (consumer side, untouched in this investigation per dispatch scope) is the source pattern ORCH-0849 cloned for business. If consumer's flow has the same `setFinalizingTimedOut` + dead-end render, consumer buyers also strand. **Recommend a 30-minute scoped audit** of `app-mobile/src/payments/nativeCheckoutFlow.ts` + the consumer-side caller, before SPEC, to decide whether ORCH-0852 should expand to a cross-app parity fix or whether to register a parallel `ORCH-0852-CONSUMER` follow-up.

3. **`Session 90defa2d` is leaked to the buyer-facing UI.** `payment.tsx:510` renders `Session {checkoutSessionId.slice(0, 8)}` visibly in the PAYMENT card. Internal session identifiers shouldn't appear in buyer-facing UI; it adds visual noise and exposes implementation detail. P3-low. Worth surfacing for a follow-up cleanup.

4. **Wallet stubs predate ORCH-0777.** Headers are labelled `Cycle 9b/9c` and `Cycle 11 J-S8` for the carousel — the stubs have been visible to every paying web buyer since Cycle 9c shipped. The longer they sit, the more buyers form a "this brand's wallet integration is broken" impression. Recommend prioritising even if the fix is just hiding the buttons.

5. **No backup/heartbeat reminder set for ORCH-0852.** Symptom C's fix likely involves a server-side change (`ticket-checkout-status` edge function and/or webhook timing). If the SPEC ships a longer polling budget without addressing webhook latency, the symptom returns under heavier production load. Orchestrator should consider whether p99 webhook→finalize latency is observable in production (DataDog / Supabase logs) before defining the new budget.

---

## Phase 8 — Confidence Labels

| Finding | Confidence | Reason |
|---|---|---|
| Symptom C root cause | **proven** | Six-field evidence from source + operator screenshot is verbatim the timeout copy; impossible to produce from any other code path |
| Symptom B verdict (intentional stub, missing-feature) | **proven** | Source self-labels TRANSITIONAL; spec grep returns zero promises; no backend infrastructure exists |
| Symptom A root cause | **suspected** | Strong structural fit (no explicit height in carousel host/page) + matching runtime symptom in screenshot, but not DOM-inspected. Source-only reasoning ceiling per Prime Directive 7 |
| Symptom A multi-ticket-only hypothesis | **suspected** | Single-ticket case takes a different code path (no horizontal ScrollView); would need single-ticket browser repro to confirm |
| Web `?cs=` resume parallel risk | **probable** | Same function called, same timeout budget; not independently repro'd |
| Consumer-app parallel bug | **suspected** | Not yet read — flagged as Discovery 2 |

---

## Recommendations (direction only — not a spec)

Three independent fix tracks, recommended order: **C → A → B**.

### Fix C first (highest user impact + revenue trust)

- **Server-side first:** measure p95 + p99 Stripe-webhook-to-`orders`-row-insert latency. If p99 >16.5s, raise the polling budget AND/OR add a long-poll endpoint that holds the connection open server-side until the order finalizes (avoiding wasted client roundtrips).
- **Client-side:** when `finalizingTimedOut` fires, show an HONEST status banner ("Payment captured — confirming your tickets") with a **retry** button that resumes polling, plus a **fallback CTA** like "We'll email you the order link if this is taking longer than expected. Tap here to check now." that calls `/ticket-checkout-status` once on demand. Once polling does succeed (even minutes later), auto-navigate to `/confirm`.
- **Mixpanel:** `ticket_checkout_failed { reason: "finalize_timeout" }` should be downgraded to `ticket_checkout_finalize_slow` and emit a separate `ticket_checkout_succeeded_after_timeout` when the recovery path succeeds, so the funnel actually reflects reality.

### Fix A second (UX + door scanning)

- Add explicit `height` to `styles.host` OR `aspectRatio: 1` to `styles.page` OR `minHeight: qrSize + labelHeight + paddingY * 2` to whichever is the right RNW-safe approach. Validate in Chrome, Safari, Firefox at 375px / 768px / 1280px viewports.
- Measure `pageWidth` via `onLayout` rather than `Dimensions.get("window").width` initial fallback — initial render uses window width which is wrong for nested containers on web.

### Fix B third (operator decision)

- **Option 1 (cheap, ships now):** wrap the entire `<View style={styles.walletRow}>` in `Platform.OS === "web" ? null : ...` OR simply remove the buttons until real wallet pass infrastructure is built. Constitution Rule 9 compliance. Mingla product positioning (experience app, not date app) does not strictly require wallet passes pre-launch.
- **Option 2 (build it):** new ORCH for `wallet-pass-issue` edge function generating `.pkpass` (signed PassKit bundles with Mingla branding) and Google Wallet generic-pass JWTs. Requires Apple Developer Wallet certificate + Google Wallet Issuer ID. Probably ~2-3 day implementation incl. cert procurement.

**Recommended:** Option 1 in ORCH-0852, register Option 2 as a separate forward-looking ORCH (e.g., ORCH-0853 [Wallet pass issuance]) and prioritise post-launch.

---

## Layman summary

- **What's broken (in plain English):**
  1. **The "stuck on Payment received" screen** is the worst issue: when a buyer pays through the business app's native flow, the app talks to Stripe successfully and Stripe charges the card, but then the app gives up waiting for the server to confirm the order after ~16.5 seconds and shows reassuring copy without ever moving the user to their ticket. The buyer's order DOES exist (they get it by email) but the in-app experience strands them on a disabled-button screen. This is a regression from the 2-day-old ORCH-0849 [Stripe payment method parity] change. **Severity: very high — revenue + trust.**
  2. **The half-QR on web** is most likely caused by the multi-ticket QR carousel not declaring its own height, so on a web browser the layout collapses and clips the QR top and bottom. Single-ticket orders likely work fine because they take a different render path. Needs browser DevTools confirmation to be certain. **Severity: high — door staff can't scan a half-QR.**
  3. **The Apple/Google Wallet buttons** were never actually implemented — they're 2-month-old placeholder buttons that show a "Coming soon" toast. ORCH-0777 [Production ticket checkout + buyer notifications] never promised wallet pass functionality. Easy fix: hide the buttons. Real fix: build the wallet pass feature as a follow-up ORCH. **Severity: moderate — affordance lies to users.**
- **What I'd recommend:** fix the "stuck" issue first (longest user pain, regression that just shipped), fix the QR clip second (needs a browser repro to confirm before specing), and as the third deliverable hide the wallet buttons until we ship real wallet pass infrastructure as its own future ORCH.
- **Cross-cutting concern:** the same polling-timeout pattern probably affects (a) the web `?cs=` resume flow on `/confirm` and (b) potentially the consumer app's payment flow. Worth a brief audit before specing the fix, so we don't ship a one-surface patch and leave parity bugs everywhere else.
- **No user-visible change yet** — this is the investigation; spec, implementation, and testing come next.

---

---

## Addendum — Deeper investigation after operator's "investigate everything to be 100% sure" directive (2026-05-17)

### A1. Consumer vs business — the architectural diff

After reading `app-mobile/src/payments/nativeCheckoutFlow.ts` (full file, 254 lines) and its caller `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:206-302`, the difference is NOT in `nativeCheckoutFlow.ts` itself — both apps' versions return `{outcome: "succeeded", orderId: checkoutSessionId}` identically. **The bug lives in how the caller handles that success.**

**Consumer pattern (`ExpandedBusinessEventSheet.tsx:264-286`) — fire-and-forget:**
```
if (result.outcome === "succeeded") {
  void Haptics.notificationAsync(Success);
  toastManager.show("Ticket secured! Check your calendar.", "success");
  sheetRef.current?.close();
  queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] });
  if (payload.totalCents > 0) {
    // poll-invalidate 3 times at 1-second intervals
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] });
      if (attempts >= 3) clearInterval(interval);
    }, 1000);
  }
}
```
Total client-side waiting: **3 seconds of background re-invalidation, user is NEVER blocked.** The buyer is told "you're good, check your calendar," the sheet closes, and the calendar updates when the order lands via React Query refetch + realtime subscription. If the order takes 30 seconds, the calendar just shows it 30 seconds later. **No way to strand the user — there's no blocking UI to be stranded ON.**

**Business pattern (`mingla-business/app/checkout/[eventId]/payment.tsx:347-393`) — synchronous block:**
```
const sessionId = outcome.orderId;
setCheckoutSessionId(sessionId);
setFinalizing(true);                       // ← blocks the payment screen
finalizingRef.current = true;
const status = await pollTicketCheckoutStatus(sessionId, "");  // ← 16.5s ceiling
if (!finalizingRef.current) return;
if (status === null || status.order === null) {
  finalizingRef.current = false;
  setFinalizingTimedOut(true);             // ← strands the user
  setFinalizing(false);
  setProcessing(false);
  return;                                  // ← never navigates
}
recordResult({ ... });
router.replace(`/checkout/${eventId}/confirm` as never);  // ← only reachable on poll success
```

**The diff:** consumer never gates navigation on the polling result. Business gates BOTH the navigation AND the success copy on a 16.5s poll. When the poll loses to webhook latency, business has nowhere to go — there is no "exit" affordance on the screen, the back button isn't shown post-payment, and the Pay button is disabled.

**Therefore the safe fix is to mirror consumer's pattern in business**, not invent a new server-side or polling tuning. The fix removes the blocking polling on the checkout screen entirely:
- On PaymentSheet `succeeded`: show a success toast, navigate to the event page / a "your tickets" surface, and let an order-fetching hook (React Query against the orders table, OR realtime subscription, OR the same `pollTicketCheckoutStatus` running in background) populate the QR view when ready.

### A2. Web `?cs=` resume path on `/confirm` — confirmed parallel bug, less severe but same root

`mingla-business/app/checkout/[eventId]/confirm.tsx:162-243` (the web Stripe-redirect-back resume effect). On Platform.OS === "web":

1. Buyer pays through Stripe's hosted checkout → Stripe redirects to `business.usemingla.com/checkout/{eventId}/confirm?cs=…`
2. Effect detects `?cs=` in `location.search`, reads `checkoutResumePayload` from sessionStorage, restores cart context for visual continuity
3. Calls `pollTicketCheckoutStatus(checkoutSessionId, buyerStatusToken)` — same function, same 16.5s budget
4. On null/failure: sets `webResumeError = "Your payment is being finalised — tickets will arrive by email shortly."` (L203-206)
5. Render fallback at L309-328: a "Payment received" hero card with the resume-error copy

**This is less hostile than native** — the screen has its own dedicated layout, not a stuck wizard step — but still has zero recovery affordances: no retry button, no "check now" CTA, no link to the order if the webhook lands later. If the buyer closes the tab, the sessionStorage payload may be lost on next visit (depending on tab persistence), making manual recovery harder. Same root pattern.

### A3. Server-side root cause — webhook→finalize latency is unbounded

`supabase/functions/ticket-checkout-status/index.ts:22-39` — the status function returns `order: null` whenever `ticket_checkout_sessions.order_id` is unpopulated. `order_id` is populated by `biz_ticket_checkout_finalize` RPC, which runs INSIDE the Stripe webhook handler (`supabase/functions/stripe-webhook/index.ts`) when `payment_intent.succeeded` fires.

Stripe webhook latency is bounded only by:
- Stripe's own delivery infrastructure (typically <1s p50, but p99 can spike to 10-30s under high event volume on Stripe's side)
- Mingla's webhook handler processing (DB writes, RLS checks, finalize RPC)
- DB load — concurrent inserts, lock contention

There is a `reconcile-stuck-checkouts` edge function (filename only — not read) which suggests this race condition has been known. Operator should grep its source to understand the cleanup contract.

**The 16.5s client budget is a guess that loses any time the webhook takes ≥17 seconds — and there is no production observability on webhook latency p95/p99 in the artifacts I read.** Fixing the symptom on the client alone (longer poll, more attempts) is a patch; the architectural fix is consumer's pattern (fire-and-forget, don't gate navigation on the webhook).

### A4. Symptom A — refined hypothesis (still `suspected`)

Re-read `TicketQrCarousel.tsx` against `mingla-business/app/checkout/[eventId]/confirm.tsx:603-606` (`qrCard: { marginBottom, alignItems: "center" }`) and `o/[orderId].tsx:662-665` (same):

- GlassCard parent has `padding: spacing.md` so inner content area is window-width minus all outer padding chain (scrollContent.paddingHorizontal `spacing.lg` × 2 + GlassCard.padding × 2) ≈ window-width minus ~64-80px.
- TicketQrCarousel host has `alignSelf: "stretch"` — fills GlassCard content width.
- ScrollView inside the host has NO style.
- Each page is `width: pageWidth` where pageWidth defaults to `Dimensions.get("window").width` — full window — until `onLayout` fires and updates it.
- On RNW, `<ScrollView horizontal>` becomes `<div style="overflow-x: auto; overflow-y: hidden">`. The height should come from intrinsic child content (QR 200 + padding 16 + label ~40 + paddingY 16 ≈ 270px), but if any flex sizing on the page or qrInner gets misinterpreted by `react-native-web`'s style transformer, vertical content can spill outside the div's height and be clipped by `overflow-y: hidden`.

No proven test from source alone. Need browser DevTools repro — confirm or refute by:
1. Open `business.usemingla.com` in Chrome, complete a real 2-ticket purchase
2. On the confirm screen, inspect the carousel `<div>` (parent of `<svg>` QR), check `height` and `overflow` computed styles
3. Toggle `overflow-y: visible` — if QR renders fully, hypothesis is confirmed

Alternatively, if operator can confirm: does the clip happen on **single-ticket** orders too, or only **multi-ticket (2+)**? If only multi-ticket, hypothesis is confirmed without DevTools (single-ticket takes the no-ScrollView `singleWrap` code path at TicketQrCarousel.tsx:94-110).

### A5. Updated severity matrix

| Symptom | Severity | Confidence | Surfaces |
|---|---|---|---|
| C (native business stuck) | S1-high (revenue + trust) | proven from source | business iOS, business Android |
| C-parallel (web `?cs=` resume) | S2-medium (still has fallback screen) | proven from source | buyer-web on `mingla-business` |
| A (QR clipped on web multi-ticket) | S1-high (door scan fails) | suspected | buyer-web on `mingla-business`, possibly business-iOS web preview |
| B (wallet stubs) | P2-medium (Constitution Rule 9 violation) | proven from source | buyer-web, business iOS, business Android |
| Consumer parity | Not affected | proven from source | consumer iOS, consumer Android — leave untouched |
| `Session 90defa2d` leak | P3-low (cosmetic) | proven from source | business iOS, business Android |

### A6. Conclusion of expanded investigation

- **C is fully proven.** Consumer's pattern is the gold reference. Fix = port consumer's fire-and-forget pattern to business; remove the blocking poll on the payment screen.
- **C-parallel on web is fully proven.** Same fix family — give `/confirm` a recovery surface even when the poll loses to webhook latency.
- **B is fully proven.** Hide the buttons (Option 1) or build the feature (Option 2 — separate ORCH).
- **A is suspected.** Needs ~3 minutes of browser DevTools OR operator's single-vs-multi confirmation to elevate. Implementor can also verify during fix.
- **Server-side investigation is sufficient.** No need for a webhook-latency-tuning ORCH — the consumer pattern doesn't depend on bounded webhook latency. Server stays as-is.

**SPEC scope (recommended):** all four — Symptom C (native), Symptom C-parallel (web resume), Symptom A (carousel height), Symptom B (hide wallet stubs).

**Out of scope (intentional):**
- Consumer app (working — must not regress)
- Server-side webhook latency tuning (architectural fix removes the dependency)
- Wallet pass infrastructure build-out (future ORCH; Option 2)
- `Session 90defa2d` cosmetic leak (P3 — register as follow-up)

---

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Status:** INVESTIGATION complete (including expanded scope per operator directive). Ready for SPEC dispatch.
