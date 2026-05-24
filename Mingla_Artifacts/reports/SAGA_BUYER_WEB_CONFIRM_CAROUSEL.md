# SAGA — Buyer-Web Confirm Page Multi-Ticket QR Carousel

**Last updated:** 2026-05-24
**Status:** UNRESOLVED. Multi-ticket carousel still renders only a thin vertical strip on `business.usemingla.com/checkout-trip/{tripEventId}/confirm` (and parallel `/checkout/{eventId}/confirm`) after a 4-attempt fix marathon. Single-ticket renders correctly post-ORCH-0932.

**Pivot:** further point-fixes paused. Sealed under META-ORCH-XXXX [Buyer-web confirm pipeline deep forensics] for a comprehensive Playwright-driven investigation + binding SPEC + IMPLEMENT pass in a dedicated worktree.

---

## Symptom

After a buyer pays for **2+ tickets** on a trip or event via the buyer-web checkout:

1. Stripe redirects back to `business.usemingla.com/checkout-trip/{tripEventId}/confirm?cs=…&csi=…&bst=…`
2. Page chrome renders correctly: green checkmark, "You're in", order summary card, order ID, "Back to trip" CTA
3. The QR carousel area renders only a **thin vertical strip** (~10px wide × 320px tall) — no QR codes, no swipe indicators, no "Swipe to see next ticket" hint
4. Single-ticket purchases render the QR correctly

DB confirms tickets exist with `qr_code` populated. Edge fn `ticket-checkout-confirm` returns 200 with full order + qrImageDataUrl per ticket. Server side fully correct. Bug is client-side carousel rendering only.

---

## Fix attempts (chronological)

### Attempt 1 — ORCH-0930 v1 [Component-level mount-guard inside TicketQrCarousel] (2026-05-23)

**Hypothesis:** React #418 hydration mismatch from `react-native-qrcode-svg` SVG output differing between Expo static export and post-hydration client render.

**Fix:** added `mounted` state + `useEffect(() => setMounted(true), [])` inside TicketQrCarousel; gated `<QRCode>` render behind `mounted`.

**Result:** FAILED. Playwright forensic showed carousel still wipes, svgCount=1 not N, React #418 still fires.

**File:** `mingla-business/src/components/checkout/TicketQrCarousel.tsx` (reverted in ORCH-0932).

---

### Attempt 2 — ORCH-0930 v2 [Parent-level useEffect+setHydrated gate in confirm.tsx] (2026-05-23)

**Hypothesis:** mount-guard needs to be at the parent level (confirm.tsx) so the entire TicketQrCarousel component is gated, not just its internals.

**Fix:** in confirm.tsx, `const [hydrated, setHydrated] = useState(false); useEffect(() => setHydrated(true), []); {hydrated && totalTickets > 0 ? <TicketQrCarousel/> : null}`.

**Result:** FAILED at the time (carousel still wipes). Diagnosis was "React #418 recovery cycle prevented useEffect from firing." **This diagnosis was later proven WRONG** — the SVG-generation bug being chased here was real, and v2's mount pattern was actually correct; the failure was attributed incorrectly.

**File:** both `confirm.tsx` files (reverted in ORCH-0930 v3, then re-reverted to v2 in ORCH-0951 v2).

---

### Attempt 3 — ORCH-0930 v3 [Parent-level useState initializer with `typeof window` check in confirm.tsx] (2026-05-23)

**Hypothesis:** v2's useEffect doesn't fire after React's #418 recovery cycle, so state stays false. Use a useState initializer that resolves at render time without depending on a post-mount effect.

**Fix:** `const [isClient] = useState(() => typeof window !== "undefined")`.

**Result:** "FIXED" single-ticket but NOT multi-ticket. Single-ticket reliably rendered <Image> post-ORCH-0932; multi-ticket still showed the strip.

**The pattern itself was the new root cause for multi-ticket:** initializer returns `false` on SSR (no window) and `true` on client first render → hydration mismatch by design → React aborts the carousel subtree. Single-ticket's simpler `<Image>` subtree was hydration-recoverable; multi-ticket carousel with onLayout-driven re-renders was not.

**Files:** both `confirm.tsx` files (reverted again in ORCH-0951 v2).

---

### Pivot 1 — ORCH-0932 [Server-side QR PNG generation] (2026-05-23)

**Hypothesis:** the underlying bug is in `react-native-qrcode-svg` on Expo SDK 54 web export. No client-side gate can fix SVG generation that fails at the runtime level. Pivot to server-side PNG.

**Fix:** new `_shared/ticketQrImage.ts` (uses `esm.sh/qrcode@1.5.4` — same pipeline as `ticketPdf.ts`). Edge fns `ticket-checkout-confirm` + `ticket-checkout-status` return `qrImageDataUrl` per ticket. Carousel renders `<Image source={{ uri }}>` instead of `<QRCode>`.

**Result:** **PARTIAL SUCCESS.** Single-ticket purchases render correctly post-ORCH-0932 deploy. Multi-ticket still shows the strip.

**Files:**
- `supabase/functions/_shared/ticketQrImage.ts` (new)
- `supabase/functions/_shared/__tests__/ticketQrImage.test.ts` (new)
- `supabase/functions/ticket-checkout-confirm/index.ts`
- `supabase/functions/ticket-checkout-status/index.ts`
- `mingla-business/src/components/checkout/CartContext.tsx` (added qrImageDataUrl field)
- `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` (thread qrImageDataUrl)
- `mingla-business/app/checkout/[eventId]/confirm.tsx` (mirror)
- `mingla-business/src/components/checkout/TicketQrCarousel.tsx` (replace QRCode with Image)

**PR:** #187 (merged 2026-05-23T23:14:23Z, deploy 5d569a8a).

---

### Attempt 4 — ORCH-0951 v1 [Carousel host explicit `width: "100%"`] (2026-05-24)

**Hypothesis:** the multi-ticket carousel's `if (pageWidth === 0) return <View style={styles.host} onLayout={handleLayout}/>` early-return (ORCH-0852-era) leaves an empty bare host that collapses to ~0 width inside a center-aligned parent on RNW. `onLayout` fires with width=0, `pageWidth` stays 0, loop forever.

**Fix:** added `width: "100%"` to `styles.host` so the empty bare host has a definite width on first paint.

**Result:** FAILED. Playwright forensic post-deploy showed `styles.host` IS in the bundle with `width:"100%"`, but the computed CSS on the rendered element is `width: 0px` and parents up the chain are 32px each. The width:100% never takes effect because the React subtree was aborted before layout completed.

**Discovery from this attempt:** Playwright probe revealed the REAL underlying bug — React error #418 hydration mismatch (this time confirmed via `pageerror: "Minified React error #418"` in the forensic console).

**PR:** #188 (merged 2026-05-24T17:18:58Z, deploy 346ebf7f).

---

### Attempt 5 — ORCH-0951 v2 [Revert ORCH-0930 v3 → ORCH-0930 v2 pattern] (2026-05-24)

**Hypothesis:** ORCH-0930 v3's `useState(() => typeof window !== "undefined")` is the real cause of the React #418. v2's `useState(false) + useEffect` was structurally correct but blamed for an unrelated SVG bug at the time.

**Fix:** revert both `confirm.tsx` files from v3 to v2 pattern.

**Result:** UNVERIFIED on production. Operator tested against `business.usemingla.com` after the merge but the carousel area still shows the strip in their screenshot. Two possible explanations:

1. The pending "Confirming your reservation…" hero state during their test never resolved to the full order view (race / browser cache / refresh needed)
2. v2 also doesn't fix multi-ticket — the bug is deeper than the hydration mismatch alone

Preview URL was offered but not tested. Decision: stop poking; do deep forensics under META-ORCH.

**PR:** #191 (merged 2026-05-24, deploy f560476d).

---

## What we know for sure

| Layer | State |
|---|---|
| **DB tickets** | ✅ Created correctly with qr_code populated |
| **Edge fn ticket-checkout-confirm** | ✅ Returns 200 + full order + qrImageDataUrl per ticket |
| **Edge fn ticket-checkout-status** | ✅ Returns 200 + full order + qrImageDataUrl per ticket |
| **Web bundle** | ✅ Contains the v2 fix (width:"100%", useState+useEffect, Image-not-QRCode) |
| **Single-ticket carousel** | ✅ Renders correctly on web post-ORCH-0932 |
| **Multi-ticket carousel on web** | ❌ Still renders only a thin strip |
| **Multi-ticket on native (iOS/Android)** | ❌ UNTESTED — likely works because no SSR-hydration on native |
| **React error #418** | ✅ Confirmed via Playwright `pageerror` capture (network-mocked confirm response, headless Chromium) |

## What we DON'T know (the META-ORCH must answer)

1. **Does v2 (the latest fix) actually fix the React #418 on production?** Operator's test was against the wrong URL (production before merge AND post-merge with the loading hero in flight). A clean Playwright re-probe against the post-v2 production bundle is needed.
2. **If v2 fixes #418 but the strip persists, what else is wrong?** Possibilities: (a) the pageWidth/onLayout chicken-and-egg is real even without #418; (b) the GlassCard parent has a 0-width edge case; (c) Expo Router's Suspense boundary aborts the carousel subtree; (d) `react-native-svg-web` peer dep mismatch; (e) something else entirely.
3. **What's the right architecture?** Server-rendered HTML for the whole carousel? Switch to a different paging library? Drop the carousel + use vertically-stacked QRs? Native-only carousel + simpler web fallback?
4. **Is the bug platform-specific (Safari vs Chrome) or universal?** Operator tested on Safari. Chrome/Firefox unverified.
5. **Does the event-flow (`/checkout/{eventId}/confirm`) behave identically to trip-flow?** Both have parallel code; assumed identical but unverified.

## Decision (2026-05-24)

Stop applying surface fixes. Seal this under **META-ORCH-XXXX [Buyer-web confirm pipeline deep forensics + binding SPEC]** for a dedicated session pass:

1. Spawn dedicated worktree (per the new worktree-per-ORCH workflow, effective post-cutover)
2. Drive multi-ticket purchases end-to-end on Playwright (real Stripe flow, both trip + event paths)
3. Inspect every layer of the rendered DOM at every state transition
4. Identify ALL gaps + root causes (not just the first one)
5. SPEC a comprehensive fix (could span: carousel rewrite, parent layout fix, hydration pattern, OR full carousel re-architecture)
6. IMPLEMENT under the new worktree workflow
7. TEST with the live matrix (iOS sim + Android emu + Safari + Chrome + operator's physical iPhone)

Until then: multi-ticket buyer-web purchases work end-to-end EXCEPT for the QR display. Buyers can still receive their tickets via the email/SMS attachment paths (`ticket-confirmation-dispatch` + PDF). Door scanners still scan the underlying `tickets.qr_code` strings — so buyers can use the PDF attachment as their entry pass.

---

## Code archaeology (for the next session)

Critical files in the carousel chain:

| Layer | File | Lines |
|---|---|---|
| Buyer-web trip confirm | `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` | full file, particularly L96-117 (isClient gate), L490-520 (carousel mount) |
| Buyer-web event confirm | `mingla-business/app/checkout/[eventId]/confirm.tsx` | parallel |
| Carousel component | `mingla-business/src/components/checkout/TicketQrCarousel.tsx` | full file |
| Edge fn confirm | `supabase/functions/ticket-checkout-confirm/index.ts` | L60-150 fetchOrderPayload + tickets map |
| Edge fn status | `supabase/functions/ticket-checkout-status/index.ts` | L40-90 |
| QR generator | `supabase/functions/_shared/ticketQrImage.ts` | full file |
| Cart type | `mingla-business/src/components/checkout/CartContext.tsx` | L80-100 OrderResult |
| Existing tests | `mingla-business/src/components/checkout/__tests__/orch_0930_qr_carousel_mounted_guard.test.tsx` | 11 tests, all source-string assertions |
| Playwright forensic | `/tmp/orch-0928-forensic/probe-orch-0951-v2.js` | mock-network 3-ticket harness |

Previous investigation reports:
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0930_*` (chase the React #418 origin — multiple v1/v2/v3 iterations)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0932_*` (server-side QR PNG)
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0951_*` (carousel host width — was wrong diagnosis)

## Refunds outstanding

Operator made several Stripe test charges during this saga (€125 + €375 + €375 + €375 + … on DC Adventure connected account `acct_1TY6UFPjlZjiLhFt`, all with test card 4242). Operator declined refunds during the session — they sit as paid test orders in Stripe sandbox. Not a launch concern (test mode); cleanup can happen any time.
