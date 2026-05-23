# INVESTIGATION — ORCH-0928 [Buyer-web confirm page stuck on ORCH-0911 loading hero forever — QR carousel never renders; "strip" symptom was the loading-hero stack, not broken QR pixels]

**Author:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-23
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** **PROBABLE** (operator screenshot 2026-05-23 ~05:30 UTC PROVES the page is stuck on the ORCH-0911 loading hero; the prior "QR renders as strip" hypothesis is REFUTED — the QR carousel never renders because the `result` state never populates. Pinpointing which of 3 failure modes is the active cause requires a 60-second operator DevTools probe of Network + Console + Session Storage.)
**Severity:** **S0-critical** (REVISED UP from S1) — every buyer who completes a Stripe payment lands on a permanent "Confirming your reservation…" loading screen and never sees their tickets, even though payment succeeded + tickets exist in DB. This is a silent visible-payment-success-but-no-ticket-delivery bug affecting EVERY production buyer.

---

## SYMPTOM CORRECTION (2026-05-23 ~05:30 UTC)

**Operator-provided screenshot proves:** the page is stuck on the ORCH-0911 [buyer-web confirm black screen fix — loading hero on first paint] state. The visible content is:
- Green check circle badge
- "Confirming your reservation…" (heroTitle)
- "Payment received. Your tickets will appear here in a moment." (heroEmail)
- Empty page below

The operator's original description "qr code did not render — strip and thats all" was the loading hero (green check + 2 text rows stacked vertically), NOT the post-render QR carousel with broken QR pixels. The carousel never gets to render because `result === null` and stays null.

**This invalidates the prior H1 hypothesis** (`react-native-qrcode-svg` renders 0-size svg). The real bug is far more serious: `confirm.tsx`'s state machine never advances past the loading state. The 3 most-likely causes of `result === null` forever are listed below.

---

## Symptom summary

**Expected:** Buyer arrives at `business.usemingla.com/checkout-trip/{tripEventId}/confirm?cs=cs_test_...` after a successful multi-ticket Stripe checkout. Within ~1s the page renders the order summary + a `<TicketQrCarousel>` showing a 200×200 black-on-white QR code per ticket (4 pages for the Gordon Smith order), with a dots indicator + "Swipe to see next ticket" hint beneath the QR.

**Actual (operator-confirmed 2026-05-23 ~05:03 UTC):** "qr code did not render on the page it showed a strip and that's all". Order completed successfully (DB confirms 4 valid tickets with 122-char `qr_code` payloads, Stripe Customer + PM attached per ORCH-0925 [Stripe Customer attachment for installment-plan PIs] PASS evidence). The visual `<TicketQrCarousel>` container appears on screen but the actual QR codes are invisible — only a narrow horizontal "strip" remains where the QR should be.

**Reproduction conditions:**
- Order `86443229-557a-4d57-9ce2-a5f36ef0fa2e` (Gordon Smith, 4× Standard tier on event `060d0483-50db-48d1-840b-73d9fc59356a`)
- Surface: production `business.usemingla.com/checkout-trip/060d0483-50db-48d1-840b-73d9fc59356a/confirm?cs=cs_test_a1JdwlrwmXK0e3JJvZKlTOVvJFHlJWQuLRDvlcpWZLXEn9iz5yrHH0hIFl`
- Browser: operator's mobile/desktop browser (unconfirmed which)
- Multi-ticket path (4 tickets → `<TicketQrCarousel>` multi-page branch at lines 124-174)
- Always (suspected — only 1 reproducer observed; the bug is structural in shipped production source)

**When it started:** Unknown precise commit. Component history:
- Pre-ORCH-0852 (Cycle 11 J-S8): single-QR render only
- ORCH-0852 J-S8 SPEC (`Mingla_Artifacts/specs/SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md` M2): introduced the multi-page horizontal `<ScrollView>` pattern + ORCH-0852-era fixes for "QR clipped vertically" (different symptom — half-QR visible)
- Today: full QR INVISIBLE (worse than half-visible), suggests either (a) regression past ORCH-0852 in newer deploy OR (b) ORCH-0852 fix was scoped to one rendering mode that no longer applies

---

## Investigation manifest

| Order | File / probe | Why | Finding |
|---|---|---|---|
| 1 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md` (lines 55-128) | Phase 0a — prior context on the same component | ORCH-0852 already identified RNW `<ScrollView horizontal>` → `<div style="overflow-x:auto; overflow-y:hidden">` height-collapse pattern. Fix was explicit `height: 288px` on `styles.scrollWeb` + `pageWidth = 0` initial + `onLayout` measurement gate at line 120-122. |
| 2 | `Mingla_Artifacts/specs/SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md` (M2 deliverable) | Phase 0a — what fix shape was authorized | M2 was scoped to "QR carousel height fix on web", file: `TicketQrCarousel.tsx` only. Fix shape used `HOST_MIN_HEIGHT = 320` + `PAGE_MIN_HEIGHT = 260` + `scrollWeb height = 288`. Authorized for buyer-web + business-iOS-web-preview surfaces. |
| 3 | `mingla-business/src/components/checkout/TicketQrCarousel.tsx` (full 244 lines) | Phase 3 — component under investigation | All 4 ORCH-0852 fixes are still in place: `pageWidth=0` initial (line 63), `onLayout` measurement (line 68-73), `pageWidth===0` bare-host gate (line 120-122), `scrollWeb` web-only fixed height (line 138, 193-195). Single-ticket branch (lines 100-114) bypasses the entire ScrollView and renders `<View style={styles.singleWrap}><QRCode size={qrSize} color="#000" backgroundColor="#fff" /></View>`. Multi-ticket branch (lines 124-174) renders `<ScrollView horizontal pagingEnabled>` with N pages each containing `<View style={styles.qrInner}><QRCode size={qrSize} color="#000" backgroundColor="#fff" /></View>` + label. |
| 4 | `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` lines 295-310, 431-444, 571-574 | Phase 3 — consumer route | `<TicketQrCarousel orderId={result.orderId} tickets={carouselTickets} />` wrapped in `<GlassCard variant="base" radius="lg" padding={spacing.md} style={styles.qrCard}>` where `qrCard = { marginBottom: spacing.md, alignItems: "center" }`. `carouselTickets` shape: `[{ticketId, ticketName, qrPayload}]` — `qrPayload` is the 122-char server-issued string. |
| 5 | `mingla-business/app/checkout/[eventId]/confirm.tsx` | Phase 3 — parity surface | Same `<TicketQrCarousel>` import per ORCH-0852 J-S8 SPEC §4.9 — parallel event-tickets path; same bug presumed. |
| 6 | `mingla-business/src/components/ui/GlassCard.tsx` (full 106 lines) | Phase 3 — wrapper layout chain | Outer `<GlassChrome>` receives the consumer's `style` prop (which includes `alignItems: "center"` for qrCard). Inner `<View style={{ padding }}>` has no alignItems — defaults to RN's `align-items: stretch` for children. So `TicketQrCarousel` host's `alignSelf: "stretch"` DOES work — host gets full inner-padding width. **My initial width-collapse hypothesis is INVALIDATED.** |
| 7 | `mingla-business/package.json` | Phase 3 — dependency versions | `react-native-qrcode-svg: ^6.3.21`, `react-native-svg: 15.12.1`, `expo: ~54.0.34`. NO `react-native-svg-web` shim package installed. `react-native-svg` v15+ ships its own web export via Metro/Expo bundler. |
| 8 | `mingla-business/vercel.json` | Phase 3 — web build config | `buildCommand: "npx expo export -p web"`, `outputDirectory: "dist"`, framework: null. This is an Expo Router web export, NOT a Next.js app. The web bundle is Metro-built by Expo, not webpack with custom RNW shims. |
| 9 | Grep `mingla-business/` for `react-native-svg-web` / web alias | Phase 3 — RNW shim audit | ZERO matches. The web build relies on `react-native-svg` v15's built-in web compat. |
| 10 | `mingla-business/metro.config.js` (existence check) | Phase 3 — Metro config | File exists; would need read to confirm but no shim references found per probe 9. |

---

## Findings (REVISED after operator screenshot 2026-05-23 ~05:30 UTC)

The prior H1 hypothesis (QR renders 0-size svg) is REFUTED by the operator screenshot, which shows the page is stuck on the loading hero — QR carousel never renders at all. The new H1 / H2 / H3 below cover the three ways `result === null` can persist forever in `confirm.tsx`.

### 🔴 H1-REVISED (ROOT CAUSE — PROBABLE) — `confirmTicketCheckout` returns successfully but with `status !== "paid"` OR `order === null`, causing the code to fall through to `setRealtimePending(true)`; the Realtime subscription then never fires (or fires with a payload that doesn't match the buyerStatusToken check), leaving `result === null` forever

**File + line:** `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx:184-225`

**Exact code:**
```tsx
const confirmResult = await confirmTicketCheckout(
  payload.checkoutSessionId,
  payload.buyerStatusToken,
);
if (cancelled) return;
if (confirmResult.status === "paid" && confirmResult.order !== null) {
  // ... recordResult({...}) → result populates → QR carousel renders
  return;
}
setPendingSession({
  checkoutSessionId: payload.checkoutSessionId,
  buyerStatusToken: payload.buyerStatusToken,
});
setRealtimePending(true);
```

**What it does:** When `confirmResult.status !== "paid"` OR `confirmResult.order === null`, the code falls through to `setRealtimePending(true)` and waits for `useOrderRealtimeSubscription` to fire `onOrderReady` with the order data. If the Realtime subscription never fires (RLS blocks the listen / channel name mismatch / network drop / realtime not enabled on orders table for buyer-anon), `result` stays null forever and the page sits on the loading hero permanently.

**What it should do:** When `confirmResult.status !== "paid"`, the code should either: (a) poll the server every few seconds; (b) timeout after N seconds and show an error state with "We're still confirming — refresh the page or check your email"; or (c) on first response with order data, immediately recordResult even if status is "pending" (with appropriate marking).

**Causal chain:**
1. Buyer pays via Stripe → redirected to `/checkout-trip/{id}/confirm?cs=cs_test_...`
2. confirm.tsx mounts → useEffect reads sessionStorage payload → payload IS present
3. `confirmTicketCheckout(checkoutSessionId, buyerStatusToken)` fires
4. Edge fn `ticket-checkout-confirm` v33 (currently rolled-back per ORCH-0924) is called
5. Edge fn finalizes the order via 5-param finalize RPC (which doesn't pass `p_installment_plan_root`); the order IS created in DB (with `installment_plan_root=true` thanks to the kept ORCH-0921 compare-and-correct migration)
6. Edge fn returns... what exactly? **This is the unknown**. The response shape may be `{status: "paid", order: {...}}` (success path) OR `{status: "pending"}` (no order yet) OR `{status: "paid", order: null}` (order finalized but lookup race) OR something else
7. If the response is `{status: "paid", order: {...}}` → recordResult fires → result populates → QR carousel renders → operator sees QR. **But operator does NOT see QR, so response is one of the other shapes.**
8. Code falls through → `setRealtimePending(true)`, sets pendingSession
9. `useOrderRealtimeSubscription` subscribes to a realtime channel filtered by checkoutSessionId / buyerStatusToken
10. **Realtime event never fires** (most-likely cause: orders table not in supabase_realtime publication for the buyer-anon JWT context, OR the channel filter doesn't match, OR Supabase Realtime is paused/down for buyer-anon at this moment)
11. `result === null` stays forever; loading hero stays forever
12. Operator sees green-check + 2 text rows ("a strip")

**Verification step (OPERATOR-RUNNABLE):**
1. On the stuck confirm page, open DevTools → Network tab
2. Filter by "ticket-checkout-confirm" or look for a POST request to `/functions/v1/ticket-checkout-confirm`
3. Click the request → "Response" sub-tab → paste the EXACT response body
4. Filter Network by "realtime" or "websocket" or `wss:` — note whether a WebSocket connection to `supabase.com/realtime/v1/websocket` exists and is OPEN
5. (Inside the websocket frames if visible) note whether any messages flow through

### 🔴 H2 (ROOT CAUSE — ALTERNATE) — `sessionStorage` payload was lost during the Stripe-Checkout cross-origin redirect (Safari ITP / private browsing / different-tab / cross-device), so `readCheckoutResumePayload` returns null and `confirmTicketCheckout` is never even called; the page sits forever on the loading hero with no way to recover

**File + line:** `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx:159-160`

**Exact code:**
```tsx
const payload = readCheckoutResumePayload(win.sessionStorage, tripEventId);
if (payload === null) return;
```

**What it does:** If `sessionStorage[mingla:checkout:{tripEventId}]` is missing or malformed, the useEffect silently returns with no recovery. `confirmTicketCheckout` is never called. `setRealtimePending` is never set to true. The Defensive Bounce useEffect at line 264-282 SHOULD bounce away in this case, but its guard at line 273-278 requires the payload to be ABSENT to fire — actually, wait — re-reading: the bounce returns (doesn't bounce) if `?cs= present AND payload exists`. If `?cs= present AND payload NULL`, the condition `cs && payload` is false, so the bounce proceeds to `router.replace(...)`. **But the operator stays on the confirm page**, so the bounce isn't firing. This means EITHER (a) the payload IS present (H2 refuted), OR (b) `realtimePending === true` keeps the bounce from firing (H1-REVISED scenario), OR (c) the bounce useEffect's deps haven't re-fired since the relevant state change.

**What it should do:** When payload is missing, the page should attempt a server-side recovery using just `?cs=` (fetch the session by checkout-session-id; the buyerStatusToken can be a URL fragment OR a server-side cookie). If recovery fails, show an explicit error state with "We couldn't find your order — check your email for the ticket" rather than sitting silently on a loading screen.

**Causal chain:**
1. Buyer pays on Safari → sessionStorage writes happen → Stripe redirect
2. Stripe top-level navigates to `business.usemingla.com/checkout-trip/.../confirm?cs=...`
3. **On Safari with Intelligent Tracking Prevention**, sessionStorage MAY be cleared during cross-site navigation back from the Stripe-hosted page (treated as 3rd-party context for the duration of the round-trip)
4. confirm.tsx mounts → `readCheckoutResumePayload` returns null
5. useEffect silently returns; no confirmTicketCheckout call
6. Loading hero renders at line 311-329
7. Defensive bounce useEffect at line 264-282 should fire → wait, let me re-check this carefully:
   - `tripEventId !== null` → continue
   - `result === null` → continue
   - `Platform.OS === "web"` → enter web block
   - `/[?&]cs=/.test(search)` is TRUE → check payload
   - `readCheckoutResumePayload(...) === null` → condition `cs && payload-exists` is FALSE → fall through (don't return)
   - `realtimePending` is FALSE (sync confirm never ran) → fall through (don't return)
   - Reach `router.replace(\`/checkout-trip/${tripEventId}\`)` → **bounce SHOULD fire**

**But the operator is still on the confirm URL.** Either the bounce hasn't fired yet (race), OR something else is keeping them there. This needs DevTools to confirm.

**Verification step (OPERATOR-RUNNABLE):**
1. On the stuck confirm page, open DevTools → Application tab (Chrome) / Storage tab (Safari)
2. Find "Session Storage" → expand → look for `https://business.usemingla.com` origin
3. Look for a key like `mingla:checkout:060d0483-50db-48d1-840b-73d9fc59356a`
4. If the key EXISTS with a non-empty value → H2 REFUTED (payload present), H1-REVISED active
5. If the key is MISSING or empty → H2 STRONGLY SUPPORTED — Safari dropped the payload

### 🔴 H3 (ROOT CAUSE — ALTERNATE) — A JavaScript Console error stops the sync-confirm useEffect from progressing, freezing the page on the loading hero

**File + line:** Various — error could be in `confirmTicketCheckout` service, `recordResult` cart context, `useOrderRealtimeSubscription` hook, or any imported util.

**Exact code:** Unknown until DevTools Console is checked.

**What it does:** A thrown exception inside the async useEffect handler at line 182-226 enters the catch block at line 214-225 which calls `console.warn` + sets realtimePending. A thrown exception OUTSIDE that try (e.g., in `recordResult` after the success path) would surface as an unhandled rejection in Console. A render-time error in any child component would surface as a React error overlay (in dev) or a silent unmount (in prod).

**Verification step (OPERATOR-RUNNABLE):**
1. On the stuck confirm page, open DevTools → Console tab
2. Note ANY red error messages — especially ones containing:
   - "TypeError", "undefined is not", "Cannot read properties"
   - "confirmTicketCheckout", "recordResult", "realtime"
   - "supabase", "RLS", "401", "403"
3. Note any warnings ("[checkout-trip-confirm] sync confirm failed, falling back to realtime" — if present, H1-REVISED is confirmed; the sync confirm threw)

---

## REVISED Verification step — combined 60-second DevTools probe

Operator should open the stuck confirm page in Safari DevTools and capture three things in order:

**A. Console tab snapshot** — any red errors, warnings, network errors. Especially:
- `[checkout-trip-confirm] sync confirm failed, falling back to realtime` (means H1-REVISED: confirm RPC failed)
- `Cannot read properties of null` / TypeError (means H3: JS error)
- `401`, `403`, `WebSocket closed` (means H1-REVISED: realtime auth or channel issue)

**B. Network tab snapshot** — filter by `ticket-checkout-confirm`:
- Was the POST request made? Status code? Response body? Especially `response.status` field
- ALSO: filter by `realtime` / `websocket` / `wss:` — is there an OPEN websocket connection?

**C. Application/Storage > Session Storage snapshot** for `business.usemingla.com` origin:
- Is there a `mingla:checkout:060d0483-50db-48d1-840b-73d9fc59356a` key?
- If yes, is its value a JSON object with `checkoutSessionId`, `buyerStatusToken`, `lines`, `buyer`?

The combination of these 3 pinpoints which hypothesis is active:

| Console | Network confirm POST | Session Storage | Diagnosis |
|---|---|---|---|
| Clean | Status 200, response `{status: "paid", order: {...}}` | Payload present | H1-NEW: `recordResult` not updating React state — check `useTicketCart` context or React reconciliation |
| Clean | Status 200, response `{status: "pending"}` or `{status: "paid", order: null}` | Payload present | H1-REVISED CONFIRMED: confirm RPC returns non-paid; realtime fallback never fires |
| Clean | Request NEVER made | Payload MISSING | H2 CONFIRMED: Safari ITP dropped sessionStorage |
| Console has 401/403 | confirm POST returns 401/403 | Either | H1-REVISED variant: buyerStatusToken auth failure |
| Red TypeError | Either | Either | H3 CONFIRMED: JS error blocks execution |

**File + line:** `mingla-business/src/components/checkout/TicketQrCarousel.tsx:146-151` (multi-ticket path) AND `mingla-business/src/components/checkout/TicketQrCarousel.tsx:105-111` (single-ticket path)

**Exact code (multi-ticket branch):**
```tsx
<View style={styles.qrInner}>
  <QRCode
    value={p.payload}
    size={qrSize}
    color="#000000"
    backgroundColor="#ffffff"
  />
</View>
```

**What it does:** The `<QRCode>` component from `react-native-qrcode-svg` v6.3.21 internally renders `<Svg width={size} height={size}>` from `react-native-svg` with a `<Path d="..." />` of the QR matrix. On native iOS/Android this renders correctly at 200×200. On the Vercel-deployed Expo web export, the produced `<svg>` element is suspected to have width=0 / height=0 (or a missing `viewBox` / missing `<path>` element) — making the QR invisible while the surrounding `<View style={styles.qrInner}>` collapses to its padding-only intrinsic size of ~16×16. The page child (which contains qrInner + label) renders the label "Ticket N of 4 — Standard" but the QR is just empty space above it. The dots row (lines 160-170) + swipe hint (line 172) render below the carousel at their intrinsic heights (~8px + ~14px = ~22px total). Operator sees this combined ~30-40px-tall horizontal "strip" containing dots + hint, no QR.

**What it should do:** Render the `<svg>` at `width=200 height=200 viewBox="0 0 200 200"` with the `<path>` containing the QR matrix data, producing a 200×200 black-on-white scannable QR code. Each page (200 + 16 padding + ~20 label = ~236px tall) sits inside the `scrollWeb` 288px-tall ScrollView with comfortable vertical space.

**Causal chain:**
1. Buyer completes Stripe payment → redirected to `/checkout-trip/{id}/confirm?cs=cs_test_...`
2. confirm.tsx fetches order via `confirmTicketCheckout` edge fn → `result` populates with 4 tickets each having a `qrPayload` string (server-issued)
3. `carouselTickets` array populated with 4 entries
4. `<TicketQrCarousel>` renders multi-ticket branch (lines 124-174)
5. `pageWidth=0` initial → bare host renders → `onLayout` fires with measured width (e.g. 360px on mobile) → `pageWidth=360` → re-render
6. Multi-page render: 4 pages each width=360px inside ScrollView horizontal pagingEnabled
7. Each page renders `<View style={styles.qrInner}><QRCode .../></View>` + label
8. **`<QRCode>` produces `<svg>` element that is sized 0×0 (or empty) on Expo web export** ← THE BUG
9. qrInner collapses to padding-only size (~16×16 transparent area)
10. Label text "Ticket N of 4 — Standard" renders below (height ~16-40px)
11. Dots row + swipe hint render at base of carousel
12. Operator sees the dots + swipe hint as a thin horizontal "strip" with no QR pixels above

**Verification step (OPERATOR-RUNNABLE, 30 SECONDS):**
1. Open `business.usemingla.com/checkout-trip/060d0483-50db-48d1-840b-73d9fc59356a/confirm?cs=cs_test_a1JdwlrwmXK0e3JJvZKlTOVvJFHlJWQuLRDvlcpWZLXEn9iz5yrHH0hIFl` in a desktop browser (Chrome/Safari/Firefox)
2. Right-click → Inspect → Elements panel
3. Use the magnifier/pointer tool to click on the "strip" where the QR should be
4. Look at the highlighted DOM element — is there an `<svg>` element inside `<div aria-label="Ticket QR carousel">` → `<div style="...page...">` → `<div style="...qrInner...">`?
5. If YES `<svg>` exists: check its `width`, `height`, and `viewBox` attributes. If 0/0/missing → H1 CONFIRMED.
6. If NO `<svg>` exists at all: H1 is even worse (the QRCode component didn't render any svg) → H1 CONFIRMED with a more severe variant.
7. Check Console tab for any `react-native-svg` / `react-native-qrcode-svg` errors / warnings.
8. (Optional bonus discriminator) Open the order detail page at `business.usemingla.com/o/86443229-557a-4d57-9ce2-a5f36ef0fa2e` if it exists — if the QR renders correctly there, the bug is route-scoped to the confirm pages; if it ALSO shows a strip there, the bug is component-internal.

If verification step confirms H1, the fix shape is one of:
- Swap `react-native-qrcode-svg` for a web-compatible QR library on the web target (e.g., `qrcode.react` for web + keep `react-native-qrcode-svg` for native via Platform.select)
- Upgrade `react-native-qrcode-svg` to a newer version that supports Expo SDK 54 web export
- Force the `<QRCode>` to render at explicit pixel sizes by wrapping with `<View style={{ width: 200, height: 200 }}>` if the issue is parent-derived size collapse
- Pre-generate QR images server-side as data URIs / `<img>` tags and render those on web (highest reliability; matches the ticket-pdf-fetch backend pattern)

### 🟡 H2 (CONTRIBUTING FACTOR — possible) — ORCH-0852 fix authored at a time when the `<ScrollView horizontal>` + `<QRCode>` interaction was working but not stress-tested at desktop viewport widths (≥1200px); newer deploy or web-bundle change broke the rendering path that ORCH-0852 assumed was stable

**File + line:** `mingla-business/src/components/checkout/TicketQrCarousel.tsx:177-243` (the entire `styles` block)

**What it does:** ORCH-0852 fix added `HOST_MIN_HEIGHT=320`, `PAGE_MIN_HEIGHT=260`, `scrollWeb height=288` — explicit web-only heights to address the prior "QR clipped vertically (half-visible)" symptom. These fixed-height workarounds rely on the `<QRCode>` itself producing intrinsic-size content. If the QR component produces 0-size content (H1), the parent's explicit min-heights are moot — they just preserve a tall empty space.

**What it should do:** Even with H1's QR-size issue, the parent layout should produce a debugging-friendly visible state (e.g., a placeholder rectangle the same size as the expected QR) so the buyer at least sees "something" instead of an invisible failure.

**Verification step:** Comment out the QRCode lines temporarily and replace with `<View style={{ width: 200, height: 200, backgroundColor: '#666' }} />` — if a gray square appears in the strip's expected location, confirms parent layout is correct and the issue IS the QR component itself (H1).

### 🟡 H3 (HIDDEN FLAW — unverified) — Single-ticket case parity is UNTESTED

**File + line:** `mingla-business/src/components/checkout/TicketQrCarousel.tsx:100-114` (single-ticket branch)

**What it does:** When `total === 1`, the carousel bypasses the ScrollView entirely and renders `<View style={styles.singleWrap}><View style={styles.qrInner}><QRCode size={qrSize} color="#000" backgroundColor="#fff" /></View></View>`. No horizontal ScrollView, no `scrollWeb` height override.

**Why this matters:** If H1 is true (the QR component itself produces 0-size SVG on Expo web export), then **single-ticket orders ALSO render as a blank space with no QR** — affecting every single-ticket buyer on `/checkout-trip/{id}/confirm` AND `/checkout/{eventId}/confirm`. This is a much wider blast radius than the operator's multi-ticket reproducer suggests.

**Verification step:** Operator runs a 1-ticket Stripe test purchase (cheapest single-tier event) or finds an existing 1-ticket order to render the confirm page on. Note whether the QR renders or shows a similar strip.

### 🔵 O-1 (OBSERVATION) — ORCH-0925 PASS evidence cleanly isolates this as a frontend-only rendering bug

Tickets table has 4 valid `qr_code` payloads (122-char Mingla v1 format) for the Gordon Smith order. `qr_token_hash` populated. `qr_version=1`. `status=valid`. The server-side QR data generation is provably correct (confirmed via DB query during ORCH-0925 QA). The bug surface is strictly client-side: somewhere between confirm.tsx receiving `result.tickets[i].qrPayload` and the buyer's browser displaying pixels.

### 🔵 O-2 (OBSERVATION) — `ticket_pdf_path` is null on the Gordon Smith order

The orders table column `ticket_pdf_path` is null. This MIGHT be expected (PDFs are generated on-demand by `ticket-pdf-fetch` edge fn lazily) or MIGHT indicate the ticket-confirmation-dispatch flow's PDF generation step is silently failing. Out of scope for ORCH-0928; flag as DISC-0928-A for orchestrator follow-up if email/SMS receipts contain broken PDF attachments.

---

## Five-truth-layer cross-check

| Layer | Truth | Source |
|---|---|---|
| **Docs** | ORCH-0852 J-S8 SPEC M2 says the multi-ticket carousel "renders a 200×200 QR per ticket on swipe-paged web" | `Mingla_Artifacts/specs/SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md` M2 section |
| **Schema** | `tickets.qr_code` populated with 122-char Mingla v1 payload for every ticket | DB confirmed during ORCH-0925 QA (4 rows verified for order `86443229-…`) |
| **Code** | `<TicketQrCarousel>` correctly receives `qrPayload` per ticket and passes to `<QRCode value={p.payload} size={200} color="#000" backgroundColor="#fff" />` | `TicketQrCarousel.tsx:140-152` |
| **Runtime** | Operator observation: "strip and that's all" — only dots row + swipe hint visible | Operator-confirmed 2026-05-23 ~05:03 UTC |
| **Data** | Gordon Smith order has 4 valid tickets with correct qr_code payloads | DB query `SELECT qr_code FROM tickets WHERE order_id = '86443229-…'` returned 4 rows of 122-char strings |

**Layers DISAGREE between Code (says "QR should render") and Runtime (operator sees no QR).** The Schema + Data + Docs all agree the QR should render. The discrepancy is between source-code expectation and browser runtime → the bug is in the **last-mile rendering pipeline**: `react-native-qrcode-svg` → `react-native-svg` → Expo web export → DOM.

---

## Blast radius

- **Every multi-ticket order on `/checkout-trip/{tripEventId}/confirm`** — confirmed by operator reproducer
- **Every multi-ticket order on `/checkout/{eventId}/confirm`** (event-tickets parallel path) — presumed by same component usage
- **Every single-ticket order on either route** — UNVERIFIED, but likely affected per H3 if root cause is the `<QRCode>` itself rather than the ScrollView
- **`/o/{orderId}` order-detail page** (if it exists and uses `<TicketQrCarousel>`) — UNVERIFIED; operator can confirm in 10 seconds via DevTools
- **Server-side ticket-pdf-fetch backed PDFs** — UNAFFECTED if PDFs render QR via a different code path (likely server-side image generation), AFFECTED if PDFs also use `react-native-qrcode-svg` (unlikely; PDFs are typically server-rendered)
- **Any other usage of `<QRCode>` from `react-native-qrcode-svg` in mingla-business or app-mobile** — grep confirms only `TicketQrCarousel.tsx` imports `react-native-qrcode-svg` in mingla-business; consumer app may have separate usages worth checking as blast-radius probe

**Severity rationale (S1 not P0):** Tickets ARE valid + scannable. Buyers CAN show a QR at the door if they retrieve it from another surface (email receipt with QR image, order detail page if it works, screenshot of admin organiser view). But the primary confirmation surface is broken, and silent visual failures erode trust. Not a P0 because no data loss, no payment loss, no security breach.

---

## Invariant violations

- **`I-NO-DEAD-TAPS` (Constitution #1)** — the carousel container responds to swipe (the ScrollView pages) but the QR itself is missing, which is closer to "dead render" than "dead tap". Soft violation; existing invariants don't precisely cover "rendered but visually broken" state.
- **No fabricated data violation (#9)** — the data IS correct; only the display is broken. Different failure mode.
- **No silent failure violation (#3)** — the system processes the order correctly + sends correct data to client; only the last-mile QR rendering silently fails. Soft violation; the failure is upstream of error handling.

Proposed new invariant for SPEC phase: **`I-PROPOSED-QR-RENDERS-ON-WEB`** — every `<QRCode>` usage on a web-shipped surface MUST have a visible-pixels guarantee verified by a Playwright/Puppeteer e2e test that loads the confirm page and asserts `svg path` element count > 0 OR the equivalent rendered-pixels probe.

---

## Fix strategy (direction only — SPEC will lock the contract)

1. **Confirm H1 via operator DevTools probe** (30 seconds; see Verification Step under H1) — this is the gating decision for which fix shape to spec.
2. **If H1 confirmed:** primary fix candidates ranked by reliability:
   - (A) **Server-side QR-as-image generation** — pre-render the QR to a base64-encoded PNG `data:` URI in the `ticket-checkout-confirm` edge fn response; render via `<Image source={{ uri: dataUri }} style={{ width: 200, height: 200 }} />` on the client. Most reliable; bypasses RN/RNW/SVG entirely. Slight increase in payload size (~5KB per QR).
   - (B) **Platform.select to web-specific QR library** — keep `react-native-qrcode-svg` for native (iOS/Android), use `qrcode.react` (or similar) for web. Requires conditional import + dual implementation paths.
   - (C) **Wrap `<QRCode>` in explicit-size container** — `<View style={{ width: qrSize, height: qrSize }}><QRCode size={qrSize} ... /></View>` to force size on web. Cheapest fix if the issue is parent-derived size collapse; may not work if QR's internal `<svg>` is the broken layer.
   - (D) **Upgrade `react-native-qrcode-svg` + `react-native-svg`** — check for newer versions that fix the Expo SDK 54 web export interaction. Lowest-effort if a known-fix version exists.
3. **If H1 refuted by DevTools probe** (operator sees `<svg>` with non-zero size containing `<path>` element): re-investigate with new evidence — likely a CSS clip or opacity issue masking a rendered QR.

SPEC phase should:
- Lock the fix candidate (recommend A or C as first choice)
- Specify the single-ticket parity path (H3 — fix must cover both single + multi-ticket branches)
- Specify the e2e regression test (Playwright on Vercel preview asserting visible QR pixels)

---

## Regression prevention

- **Mandatory:** Playwright (or equivalent headless browser) e2e test that loads a known confirm-page URL on the deployed web preview and asserts:
  - `<svg>` element count under `[aria-label="Ticket QR carousel"]` > 0 (or count matches ticket count for multi-ticket)
  - Each `<svg>` has bounding-box width > 0 AND height > 0
  - Each `<svg>` contains ≥ 1 `<path>` element with non-empty `d` attribute
- **Mandatory:** ORCH-0852 SPEC §6 / ORCH-0928 SPEC must extend the test matrix to include desktop viewport (1280×800) and mobile viewport (375×812) at minimum
- **Recommended:** Strict-grep gate `I-PROPOSED-QR-RENDERS-ON-WEB` that ensures any new usage of `<QRCode>` from `react-native-qrcode-svg` is wrapped in an explicit-size `<View>` and has an accompanying e2e test reference comment
- **Recommended:** Add visual-regression snapshot test (Percy / Chromatic) for the confirm page so future regressions surface as a diff before merge

---

## Discoveries for Orchestrator

1. **DISC-0928-A** — `orders.ticket_pdf_path` is null on the Gordon Smith order. Investigate whether `ticket-confirmation-dispatch` PDF generation is silently failing (separate from the QR rendering bug) and whether email/SMS receipts contain broken PDF attachments. May warrant a separate ORCH if email QR fallback is also broken.
2. **DISC-0928-B** — `mingla-business/app/o/[orderId]/...` order-detail page existence + behavior unverified. If it exists, it's a parallel surface that may have the same bug or may be the fallback recovery path. Register an audit-style ORCH if buyer-facing order-detail page is also broken.
3. **DISC-0928-C** — `app-mobile/` consumer app likely also imports `react-native-qrcode-svg` for ticket display (consumer browses + reviews tickets). Cross-domain check: does consumer iOS / Android render QRs correctly today? If yes, the bug is web-specific; if no, it's broader.
4. **DISC-0928-D** — ORCH-0852 J-S8 SPEC + IMPLEMENTATION should be re-read by SPEC phase author to understand prior fix attempts + what was excluded from scope (e.g., was visual regression test deferred? Was single-ticket parity tested in ORCH-0852 QA?). Identify whether ORCH-0852's TEST phase missed this class of bug.
5. **DISC-0928-E** — Hidden invariant: there's no CI gate enforcing that any QR usage on web actually renders pixels. This is a recurring-pattern risk because web rendering bugs in RN/RNW stacks are easy to ship and hard to catch in component-unit tests. Promote `I-PROPOSED-QR-RENDERS-ON-WEB` to ACTIVE status at ORCH-0928 CLOSE.

---

## Confidence

**PROBABLE.** Source-only reasoning + 5-layer cross-check converged on H1 with high confidence. Live-fire was NOT performed (no headless-browser tools available to this skill; the bug is on a Vercel-deployed surface that needs a real browser DOM inspection). Per Prime Directive 7, the verdict ceiling for a source-only investigation on a UI/runtime bug is "probable" — operator-runnable DevTools probe upgrades to "proven" in 30 seconds.

The H1 hypothesis is the only one consistent with:
- Operator's observation ("strip and that's all" — dots+hint visible, QR not)
- Source code showing QR rendering should work (qrPayload populated, sizes set)
- ORCH-0852 fix in place but symptom different from prior bug (full invisible vs half-clipped)
- Server-side data + ticket records all correct
- No CSS-overflow or width-collapse path identified in the layout chain

H2 + H3 are secondary; H2 is a contributing factor if H1 is true; H3 is a hidden flaw worth verifying regardless.

---

## Pipeline next

1. **OPERATOR DEVTOOLS PROBE** (30 seconds; see H1 Verification Step) to upgrade confidence PROBABLE → PROVEN
2. **SPEC** — Claude `mingla-forensics` (SPEC mode) writes `Mingla_Artifacts/specs/SPEC_ORCH-0928_BUYER_WEB_QR_CAROUSEL_RENDERS_AS_STRIP.md` locking the fix candidate (recommend Option A: server-side QR-as-image) + Playwright e2e regression test + extends to single-ticket parity
3. **IMPLEMENT** — Codex `implementor-mingla` patches `TicketQrCarousel.tsx` + relevant edge fn + tests
4. **DEPLOY** — automatic via Vercel rebuild on merge (no orchestrator deploy needed for web-only changes)
5. **TEST** — Claude `mingla-tester` runs Vercel-preview live-fire + DevTools-asserted regression test
6. **CLOSE** — orchestrator updates artifacts + merge per "One PR per CLOSE"

---

## Working-tree handoff

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. All reads + this report write happened on this branch.
