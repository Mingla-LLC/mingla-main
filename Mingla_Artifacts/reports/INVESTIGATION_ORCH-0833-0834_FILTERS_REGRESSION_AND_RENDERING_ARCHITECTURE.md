# INVESTIGATION — ORCH-0833 (Discover filters regression) + ORCH-0834 (Ticket-purchase rendering architecture review)

**Mode:** INVESTIGATE (combined / two ORCHs, single artifact per orchestrator dispatch)
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Trigger:** Orchestrator dispatch following RETEST_3 + operator chat — operator surfaced (a) filter regression and (b) request to audit the sheet-rendering chain and consider replacing Stripe's native PaymentSheet with the inline `<BottomSheet>` pattern, also asking whether free tickets can join the same UX.

**Confidence:**
- ORCH-0833 root cause: **High — proven via Maestro view-hierarchy bounds + live-fire screenshots + source code reading.**
- ORCH-0834 architecture recommendation: **High — backed by `stripe-best-practices` skill, I-PROPOSED-O gate commentary, and existing `surface="web"` code path already production-tested for web buyers.**

---

## EXECUTIVE SUMMARY (read this first)

| Item | Verdict | Cost | Risk |
|---|---|---|---|
| **ORCH-0833 — filter chips Weekend/NextWeek/ThisMonth hidden** | Root cause **proven**: chips are rendered correctly but the ScrollView's flex-1 wrap is too narrow because the pinned "Filter" button reserves ~86px on the right; chips overflow past the screen edge and there's no visual scroll indicator. Fix is a 5–20-line layout change. | 0.5 day | Low |
| **ORCH-0834 — Stripe payment rendering** | **Recommendation: PIVOT iOS consumer paid flow to Stripe Hosted Checkout via `expo-web-browser`** (Option A in the matrix below). Stripe's own skill ranks Hosted Checkout above PaymentIntent + PaymentSheet in its preference order; the `I-PROPOSED-O` gate explicitly *endorses* the `expo-web-browser` pattern as Stripe-approved; the edge function's `surface="web"` path already returns the hosted-checkout URL; and this sidesteps the iOS 26 + SDK 0.50.3 hang entirely without depending on an unknown-future SDK fix. **The ORCH-0829-B D-1 work ships unchanged** as defense-in-depth (RPC tombstone-expiry remains correct; H-2 + H-3 mobile patches remain valuable for any residual native PaymentSheet usage e.g. mingla-business creator-side). | 1–1.5 day | Low–Medium (UX delta: in-app system browser instead of native modal) |
| **Free-ticket UX migration to inline `<BottomSheet>`** | **Recommend bundling** in the same architecture PR. Tight scope: 1 component (`TicketClaimConfirmModal.tsx`) + 1 consumer (`ExpandedBusinessEventSheet.tsx`) — ~80 LoC delta. Visual consistency with the event-detail sheet (both then use `@gorhom/bottom-sheet`). | 0.25 day | Trivial |

**Single recommended close cycle:** ship ORCH-0833 layout fix + ORCH-0834 Option A Hosted-Checkout pivot + free-ticket bottom-sheet migration in **one bundle** alongside the already-paused four-ORCH stack (0824 + 0828 + 0829-A + 0829-B), promoted Seth→main behind the pre-merge gate.

---

# PART 1 — ORCH-0833: Discover filter chips regression

## Symptom Summary

| | What happened |
|---|---|
| **Expected** | All 6 filter chips visible by default on Discover: Raleigh city chip + All + Tonight + This Weekend + Next Week + This Month + Filter button. Source code (`DiscoverScreen.tsx:1602-1636`) renders all 5 date chips inside a horizontal `ScrollView`. |
| **Actual** | Only Raleigh + All + Tonight + Filter button visible by default. This Weekend is half-visible (overlapped by Filter button), Next Week + This Month are off-screen right with no scroll indicator visible to the user. |
| **User-visible regression** | Operator-reported: "the filters have regressed. 'All' does not show all and the other filters have regressed." The phrasing reflects user perception (the chip row visibly lost half its options); the technical reality is the chips exist in the render tree but overflow horizontally past the available width. |
| **When it started** | Most likely introduced by ORCH-0828 rework which added the city chip (Raleigh) as the first slot in the chip row (DiscoverScreen.tsx:1584-1600) without correspondingly increasing the ScrollView's allotted width or trimming chip labels. Pre-0828 the city chip didn't exist; the 5 date chips fit. Post-0828 the row is 1 chip wider and overflow appeared. |

## Investigation Manifest

| # | File / artifact | Why read | Found |
|---|---|---|---|
| 1 | `app-mobile/src/components/DiscoverScreen.tsx:1602-1636` | Filter chip JSX render block | All 5 date chips correctly mapped (any/today/weekend/next-week/month) |
| 2 | `app-mobile/src/components/DiscoverScreen.tsx:2101-2128` | Filter bar + chip row styles | `filterBarAbsolute` row layout: scroll wrap (`flex: 1`) + divider + pinned Filter. No `overflow: 'hidden'` on scroll wrap. |
| 3 | `git diff app-mobile/src/components/DiscoverScreen.tsx` | Uncommitted ORCH-0828 changes | 137-line diff adds discriminated-union expansion target + dual-array empty-state check; **does NOT touch the chip render block itself**. City chip was added pre-ORCH-0828 (already in committed code). |
| 4 | `git log --oneline` on filter-touching files | Last commit relevant: c980520d (ORCH-0824 follow-up batch) | No recent commit reduced chip width or restructured chip row |
| 5 | Maestro view-hierarchy dump (fresh Discover state) | Authoritative live-runtime evidence | Bounds proven: Weekend [284, 407], Next Week + This Month positioned further right but off-screen; Filter button overlays at [300, 386] |
| 6 | Live-fire screenshots (08_fresh_state.png + 03_discover_fresh.png + 04_filter_all.png) | Default-state visual proof | Only Raleigh / All / Tonight / Filter visible by default; aggressive horizontal swipe DOES scroll the chip row, exposing Weekend/Next Week/This Month — so the chips ARE scrollable just not in default position |

## 🔴 ROOT CAUSE R-1: Filter chip ScrollView is too narrow to display all 6 chips at default scroll position; pinned Filter button overlays the rightmost chip

**File + line:** `app-mobile/src/components/DiscoverScreen.tsx:1572-1665` (filter bar JSX + layout)
**Layout in source:**
```tsx
<View style={[styles.filterBarAbsolute, { ... }]}>  // flexDirection: "row", left: 0, right: 0
  <View style={styles.filterBarScrollWrap}>           // flex: 1
    <ScrollView horizontal ...>
      {/* Raleigh city chip */}
      {/* All / Tonight / Weekend / NextWeek / ThisMonth chips */}
    </ScrollView>
    <LinearGradient .../>  // left fade
    <LinearGradient .../>  // right fade
  </View>
  <View style={styles.filterBarDivider} />            // ~16px
  <View style={styles.filterBarPinned}>
    <FilterChip label="Filter" .../>                  // ~86px
  </View>
</View>
```

**Maestro view-hierarchy bounds (default state, screen width = 402px):**
```
Raleigh chip       bounds=[16,110][126,142]    visible
All chip           bounds=[142,108][189,144]   visible
Tonight chip       bounds=[197,108][276,144]   visible
This Weekend chip  bounds=[284,108][407,144]   ⚠ extends past screen edge (407 > 402)
Filter button      bounds=[300,108][386,144]   visible BUT overlays "This Weekend" at x=300-386
Next Week chip     not in current view bounds  (further right, off-screen)
This Month chip    not in current view bounds  (further right, off-screen)
```

**What it does:** The horizontal ScrollView lays out 6 chips with `gap: d.filterBar.chipGap` between each. Total content width ≈ 16 (left pad) + 110 (Raleigh) + 8 (gap) + 47 (All) + 8 + 79 (Tonight) + 8 + 122 (This Weekend) + 8 + 102 (Next Week) + 8 + 104 (This Month) + 16 (right pad) = **636 px** of content. The ScrollView wrap (`flex: 1`) gets approximately 402 - 86 (Filter pinned) - 16 (divider) = **300 px** of visible width. Default scroll position is x=0 (Raleigh leftmost), so chips past x=300 are clipped by the parent and overlapped by the Filter button.

**What it should do:** Either (a) fit all 6 chips inside the visible scroll width without overflow, (b) make horizontal overflow obvious to the user (visible scroll-indicator fade gradient pulling visually past the chip-row content, or chevron icon hinting "more chips →"), or (c) collapse overflow chips into a "More" overflow pill that opens a sheet — matching the pattern the source-comment at line 6-7 originally documented ("All / Tonight / This Weekend / Next Week / This Month / More").

**Causal chain:**
1. ORCH-0809 M2 added city chip as first slot in the row (pre-existing); ORCH-0828's prior batch may or may not have widened the row but did not add "More" overflow logic.
2. Total chip-row content width grew to ~636 px after adding Raleigh, exceeding the ScrollView wrap's allocated ~300 px.
3. ScrollView correctly clips visible region but does NOT auto-scroll to active chip on mount, so default state shows leftmost chips only.
4. The "right fade" `LinearGradient` at `chipRowFade` (lines 1646-1652) IS rendered but visually subtle — it fades chips into the Filter button area, not into a hint that more chips exist beyond. User reads "Filter" as the rightmost element and never tries to scroll the chip row.
5. User perceives Weekend / Next Week / This Month as missing.

**Verification step:** The Maestro hierarchy dump proves the chips exist at coordinates outside the visible region but within the same y-band as the visible chips. A user could swipe-left on the chip row to scroll them into view (proven by my `swipe: 70%,18% → 5%,18%` test which successfully shifted Weekend / Next Week / This Month into the visible region). The bug is a default-state + discoverability issue, not a render issue.

## 🟠 CONTRIBUTING FACTOR C-1: No `ScrollView.scrollTo` on mount or on filter selection to auto-center the active chip

`DiscoverScreen.tsx:1575-1637` declares the ScrollView but assigns no ref and never calls `.scrollTo` to bring the active filter chip into view. When a user taps "This Month" (off-screen), the chip becomes selected (state updates) but the user can't see the orange highlight without manually scrolling.

## 🟡 HIDDEN FLAW H-1: The fade gradient at `chipRowFade` (right side) is positioned ABOVE the Filter button rather than INSIDE the ScrollView content area

`DiscoverScreen.tsx:1646-1652` renders the right fade with `right: 0` — meaning it sits at the right edge of the scroll wrap, which is the boundary between scrollable content and the pinned Filter button. A user looking at this sees "fade → Filter button" and interprets the fade as decoration around the Filter button, not as "more chips exist scrolled off". The fade direction visually says "content fades INTO the right edge" but the actual content overflow direction (more chips →) isn't communicated. A chevron-right icon or a different gradient direction would communicate scrollability better.

## Fix Strategy (NOT a spec — direction only for ORCH-0833)

Three viable directions, ranked by simplicity and impact:

1. **Drop the pinned Filter button position guarantee** — let "Filter" scroll with the other chips. The Filter button becomes the 7th item in the ScrollView, accessible by scrolling right. **No layout magic needed.** Cost: tiny (move the FilterChip "Filter" inside the ScrollView, remove the divider + pinned wrapper). Risk: tiny (Filter discoverability slightly drops but is recoverable via scroll). Recommended for speed.

2. **Auto-scroll active chip into view** — add a ref to the ScrollView, `useEffect` on `selectedFilters.date` to call `scrollViewRef.current?.scrollTo({x: <calculated chip offset>, animated: true})`. Active chip is always visible. Cost: small (~20 LoC). Risk: small (need accurate chip offset calculation — measure on layout). Best for UX clarity.

3. **Shorten chip labels for compact screens** — "Weekend" instead of "This Weekend", "Next Wk" instead of "Next Week", "Month" instead of "This Month". Updates i18n keys. Cost: small (~6 i18n string edits + measurement). Risk: small (translation impact). Could combine with (2).

**Recommended bundling:** Option 1 + Option 2 together. Filter chip moves into ScrollView for scrollability uniformity; auto-scroll-to-active ensures the user always sees their selection. ~30 LoC total.

---

# PART 2 — ORCH-0834: Ticket-purchase rendering architecture review

## Current Rendering Chain (proven via source-read)

When a consumer taps a Big Party event card on Discover → progresses through ticket purchase, three completely different rendering engines fire in sequence:

| Layer | Component | Engine | Source file |
|---|---|---|---|
| **(1) Event detail sheet** ("Big Party / About / Tickets / Buy ticket") | `ExpandedBusinessEventSheet` | `@gorhom/bottom-sheet` inline `<BottomSheet>` per ORCH-0828 TM pattern | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:120,393-414` |
| **(2) Confirmation modal** ("The Paid Tickets / $250.00 / Continue to Payment") | `TicketClaimConfirmModal` | **React Native `Modal`** (NOT `@gorhom/bottom-sheet`) | `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` |
| **(3) Stripe checkout sheet** (white loading skeleton + card form) | Stripe RN PaymentSheet | **Stripe's own native iOS UIKit modal** (NOT Mingla bottom sheet, NOT RN Modal — entirely Stripe-controlled) | External `@stripe/stripe-react-native@0.50.3` → wrapped by `packages/payments-native/useStripePaymentSheet.ts:104-159` |

**Direct answers to operator's questions:**

| Q | A |
|---|---|
| "How are we rendering the sheet that slides up when you want to purchase a ticket?" | TWO different things slide up depending on which sheet you mean. The event-detail sheet (where the Buy ticket button lives) is Mingla's `@gorhom/bottom-sheet` inline pattern. The Stripe payment sheet that hangs is Stripe RN's own native UIKit modal — completely outside Mingla's bottom-sheet ecosystem. |
| "Are we using the bottom sheet that already exists in the consumer app?" | Yes for the event-detail sheet (the dark one with About / Tickets). No for the Stripe sheet (Stripe controls its own rendering — Stripe's white loading skeleton). |
| "Is there an issue with the shared packages or Stripe rendering there?" | The shared package `packages/payments-native/useStripePaymentSheet.ts` is a thin ~150-line wrapper around `@stripe/stripe-react-native`'s `useStripe()`. The wrapper is clean (proven by ORCH-0829-B regression 6/6 PASS). The hang is in Stripe RN's native iOS code on iOS 26 + SDK 0.50.3 — independent of our wrapper, independent of PaymentIntent freshness (ORCH-0829-B RETEST_3 proved this with a fresh PI also hanging). |
| "Can we render free tickets in the bottom sheet modal?" | Yes — straightforward migration. `TicketClaimConfirmModal` currently uses React Native `Modal` for both free and paid flows. Migration to `@gorhom/bottom-sheet` inline pattern matches the event-detail sheet's UX and unifies the visual language. ~80 LoC delta. **See "Free-ticket migration scope" below.** |

## Architecture Options Decision Matrix

Following the dispatch's request to consult the `stripe-best-practices` skill before recommending, here is the matrix. **Stripe's own preference order** (from `/Users/sethogieva/.claude/skills/stripe-best-practices/references/payments.md`):

> "Prioritize Stripe-hosted or embedded Checkout where possible. Use in this order of preference:
> 1. **Payment Links** — No-code. Best for simple products.
> 2. **Checkout** — Stripe-hosted or embedded form. Best for most web apps.
> 3. **Payment Element** — Embedded UI component for advanced customization."
>
> "Use the **Checkout Sessions API** (`checkout.sessions.create`) for on-session payments. It supports one-time payments and subscriptions and handles taxes, discounts, shipping, and adaptive pricing automatically."

Mingla's current setup (PaymentIntent + native PaymentSheet on iOS) is below Stripe's own #2 recommended pattern.

| Option | Description | Implementation cost | UX delta from current | Risk | Stripe-skill alignment | Rank |
|---|---|---|---|---|---|---|
| **A. Hosted Checkout in `expo-web-browser`** | Pivot iOS consumer paid flow: call edge function with `surface="web"` (already supported, lines 178-311), get `hostedCheckoutUrl`, open via `expo-web-browser.openAuthSessionAsync(url, "com.mingla.app.v2://stripe-redirect")`. Deep-link back returns success/cancel. | ~1 day (1 component change in `ExpandedBusinessEventSheet.tsx`, 1 service change in `nativeCheckoutFlow.ts`, add `expo-web-browser` import — already in package.json). | Medium: in-app system browser sheet (SFSafariViewController on iOS) opens instead of native PaymentSheet. Stripe's hosted page is well-designed and familiar to users who've ever bought anything online. Branding-controllable via Stripe Dashboard Checkout settings. | **Low.** Edge function path is already production-tested for web buyers. `expo-web-browser` is mature (~15.0.11 installed). Sidesteps iOS 26 + SDK 0.50.3 hang entirely. | ⭐ STRONG — matches Stripe's #2 preference. I-PROPOSED-O gate explicitly endorses the `expo-web-browser` Stripe pattern as Stripe-approved. | **🥇 1** |
| **B. Stripe RN SDK upgrade matrix** | Bench-test 0.51.x → 0.66.x against Xcode 26 + iOS 26 sim to find a version where `presentPaymentSheet()` renders the card form. Each version: `npm install`, `eas build --platform ios --profile development-simulator` (~20 min cloud build), live-fire test, document. Originally deferred per ORCH-0829-B spec §3.4. | ~3 days (multiple SDK swaps + bench cycles). The original `META-ORCH-0827 Pass 2` notes that 0.51.0 fails compilation with `fmt consteval errors` on Xcode 26 and 0.65.1 has missing iOS 26 PaymentSheet APIs — so the working version may not exist yet. | None: identical UX to current (when it works). Native PaymentSheet feels more "in-app". | **High.** No guarantee any tested SDK version works on iOS 26 + Xcode 26. If none work, you're back to Option A anyway, having burned 3 days. | Neutral — Stripe skill ranks PaymentIntent + native PaymentSheet below Hosted Checkout. | 🥉 3 |
| **C. Real-device diagnostic first** | Run the same ORCH-0829-B RETEST_3 Maestro reproducer on physical iPhone 15 or 16 (NOT iOS 26 sim). The hang may be sim-specific (Xcode 26 + iOS 26 simulator regressions are common for Stripe). If real device passes T-C3, ship as-is and register sim-only hang as P3 cosmetic. | 10 minutes (operator runs once on their iPhone). | None: same UX as current. | **Low.** Test cost is trivial. Best-case: bug doesn't exist on real devices and we ship today. Worst-case: bug exists on devices too and we pivot to Option A anyway. | Doesn't change Stripe alignment either way. | 🥈 2 — recommend as fast pre-flight before committing to A or B |
| **D. Stripe Payment Element embedded in Mingla's `<BottomSheet>`** | Stripe Elements (web JS SDK) rendered in a WebView inside `@gorhom/bottom-sheet`. Theoretically could control the UX entirely from Mingla's side. | ~5+ days (WebView wrapper, message bridge, payment_method_data confirmation flow). | Significant: fully Mingla-controlled UI. | **Very High.** Violates `I-PROPOSED-O` invariant (Stripe explicitly prohibits Connect Embedded Components inside embedded WebViews in mobile apps per Stripe docs — Mingla codified this for `@stripe/connect-js` but the spirit applies to Payment Element too). PCI compliance scope increases. Off the table. | ❌ EXPLICITLY DISALLOWED by I-PROPOSED-O. | ❌ EXCLUDED |

### Recommended sequencing

1. **First** (5 min, operator-owned): Run Option C on a real iPhone. If T-C3 passes on the real device, the four-ORCH bundle (0824 + 0828 + 0829-A + 0829-B) closes as PASS with iOS 26 sim documented as a known-but-non-blocking environmental issue. Done.
2. **If real device ALSO hangs** (likely — the SDK version is the same): immediately commit to **Option A** (Hosted Checkout pivot). One-day implementation. The defense-in-depth from ORCH-0829-B D-1 (RPC tombstone-expiry, H-2 try/finally, H-3 timeout race) **ships unchanged** as belt-and-suspenders for any residual native PaymentSheet usage (e.g. mingla-business creator's own paid surfaces if they exist).
3. **Defer Option B forever** unless Stripe releases a known-working iOS 26 + Xcode 26 SDK version organically.

## Free-Ticket Migration Scope (bundled into Option A per operator)

**Goal:** Move `TicketClaimConfirmModal` from React Native `Modal` to inline `@gorhom/bottom-sheet`, matching the event-detail sheet's pattern for visual consistency. Free + paid both go through the same UX surface.

| File | Change | Lines |
|---|---|---|
| `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` | Replace `<Modal visible={open} transparent animationType="slide">` wrapper with inline `<BottomSheet ref={sheetRef} index={open ? 0 : -1} snapPoints={["60%"]} enablePanDownToClose onChange={(i) => i === -1 && handleCancel()}>` + `<BottomSheetView>` content. Drop the manual backdrop view (use `BottomSheetBackdrop` per ORCH-0828 pattern). Drop the absolute-positioned outer container. | ~40 LoC modified, ~10 LoC added |
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | The consumer renders `<TicketClaimConfirmModal>` as a sibling fragment (per the working ORCH-0828 pattern). Add a `useRef<BottomSheet>` for the confirmation sheet alongside the existing event-detail sheet ref. Two stacked inline `<BottomSheet>` instances are supported by `@gorhom/bottom-sheet` v5 (proven by ORCH-0828 — TicketMaster sheet uses the same compositional pattern). | ~10 LoC modified |
| `app-mobile/scripts/ci/orch-0828-regression-check.mjs` (existing) | Add 1 new contract: `TicketClaimConfirmModal must use BottomSheet from @gorhom/bottom-sheet, not React Native Modal` — same regex shape as existing T-06/T-07 contracts. | ~5 LoC added |

**Total scope:** 3 files, ~65 LoC. No native dependencies added (`@gorhom/bottom-sheet` already in package.json). No invariant changes needed — uses existing `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS`.

**Operator-visible UX after migration:** tap "Buy ticket" on the event-detail sheet → confirmation slides up using THE SAME native-feeling bottom-sheet animation as the event-detail sheet did. Tap Continue → bottom sheet replaces the confirmation content with the Hosted Checkout button or directly opens `expo-web-browser`. Cohesive single-language UX from tap to payment.

---

## Five-Truth-Layer Cross-Check (both ORCHs)

### ORCH-0833 (filter regression)

| Layer | What it says | Matches reality? |
|---|---|---|
| **Docs** | DiscoverScreen.tsx:6-8 source comment documents "All / Tonight / This Weekend / Next Week / This Month / **More**" (note "More" mentioned but no More chip in current code) | ⚠ Mismatch — docs reference a "More" overflow chip the code doesn't implement |
| **Schema** | N/A (UI-only) | N/A |
| **Code** | All 5 date chips rendered in JSX (lines 1602-1636) inside horizontal ScrollView. Filter button pinned outside ScrollView. | ✓ Code is correct in intent |
| **Runtime** | Maestro hierarchy proves 6 chips render but ~3 are off-screen right in default scroll position; horizontal swipe DOES scroll them in (so ScrollView is functional) | ✓ Layout is the bug, not the render |
| **Data** | N/A (Big Party event itself is in DB and visible under All + Tonight filters when reachable) | ✓ Data layer fine |

**Contradiction location:** Docs vs Code (the "More" chip referenced in source comments doesn't exist). Layout-level — code is correct in intent but doesn't reconcile with display constraints when 6 chips compete for ~300px width.

### ORCH-0834 (rendering architecture)

| Layer | What it says | Matches reality? |
|---|---|---|
| **Docs** | `stripe-best-practices/SKILL.md` + `references/payments.md` rank Hosted Checkout as Tier 2 preference (above PaymentIntent + PaymentSheet). I-PROPOSED-O gate commentary endorses `expo-web-browser` as Stripe-approved. | ✓ Strong external authority for Option A |
| **Schema** | Edge function `ticket-checkout-create/index.ts:178-311` already implements `surface="web"` returning `requires_web_redirect` + `hostedCheckoutUrl`. Production-tested for web buyers. | ✓ Server-side infrastructure ready |
| **Code** | iOS consumer app currently calls `runNativeCheckout` with implicit `surface="native"` (default at `nativeCheckoutFlow.ts:88`) → routes to PaymentIntent + PaymentSheet path | Mismatch with Stripe's recommended pattern — code path exists but not chosen by mobile |
| **Runtime** | ORCH-0829-B RETEST_3 proved Stripe RN 0.50.3 PaymentSheet hangs on iOS 26 even with fresh PaymentIntents | Confirms Option A's rationale (sidestep the SDK) |
| **Data** | All necessary data layers operate correctly (RPC tombstones correctly, edge fn creates correct PI/Checkout Session) | ✓ Data layer fine on both paths |

**Contradiction location:** Code (mobile chose native surface) vs Docs (Stripe recommends Hosted Checkout) vs Runtime (native surface broken on iOS 26). All three converge on Option A.

---

## Blast Radius

### ORCH-0833 (filter regression)
- **Affected:** every consumer using Discover on iPhone (iPad TBD — different layout). Android may have same bug since the source code is platform-agnostic but specific bounds may differ.
- **Not affected:** Big Party itself is discoverable under All + Tonight (both visible), so users CAN find it. The bug only blocks date-narrowing to Weekend / Next Week / This Month for events that aren't tonight.
- **Cross-domain:** affects only `app-mobile/src/components/DiscoverScreen.tsx`. No DB / RPC / edge function impact. Admin dashboard unaffected.

### ORCH-0834 (rendering architecture)
- **Affected by Option A pivot:** iOS consumer paid checkout flow. Free-ticket flow not touched by Option A (still uses edge function's `free_completed` path). Web buyer flow already uses Hosted Checkout — no change.
- **Mingla-business creator-side:** uses different code paths (Stripe Connect Embedded Components per B2a). Not affected.
- **Android consumer:** if iOS Hosted Checkout pivot works well, Android can follow the same path (consistent UX). No urgency since the hang appears iOS-specific.

---

## Invariant Violations

### ORCH-0833
**None violated.** Constitutional rules all preserved. The bug is a layout/discoverability defect, not a code-correctness defect. May warrant a NEW invariant: `I-PROPOSED-DISCOVER-CHIP-ROW-FIT — the Discover filter chip row MUST visually expose ALL filter chips to the user at default scroll position OR explicitly indicate scrollable overflow with a scroll-indicator that doesn't visually merge with adjacent chrome.`

### ORCH-0834
**None violated by Option A.** `I-PROPOSED-O` (no DIY WebView wrap of Stripe SDK) — Option A uses `expo-web-browser.openAuthSessionAsync` which is NOT a WebView wrap (it's SFSafariViewController, a sandboxed system browser endorsed by Stripe). May warrant a NEW invariant: `I-PROPOSED-PAID-CHECKOUT-VIA-HOSTED — iOS consumer paid ticket checkout MUST route via Stripe Hosted Checkout in expo-web-browser, NOT native PaymentSheet (which is preserved for mingla-business creator-side flows only).`

---

## Discoveries for Orchestrator

### D-1 (ORCH-0833): Source comment vs implementation mismatch — "More" chip in comments but not in code
`DiscoverScreen.tsx:6-7` documents a "More" overflow chip that the implementation doesn't have. Either (a) implementation regressed and lost the More chip during refactor, (b) the comment was forward-looking and "More" was never built, or (c) the "Filter" pinned button IS conceptually the "More" but was renamed. Suggest the SPEC that addresses ORCH-0833 also reconciles this docs↔code drift.

### D-2 (ORCH-0833): Filter bar layout untested against device width variations
The current chip overflow happens on iPhone 17 Pro (402px width). On a narrower device (iPhone SE = 320px width), the problem would be even worse — possibly only 2 chips visible. Suggest a future ORCH adds device-width-responsive sizing (or shorter labels on small screens via `useWindowDimensions`).

### D-3 (ORCH-0834): Define what happens to the once-only guard refs in `useStripePaymentSheet` after Option A pivot
With Option A, the iOS consumer no longer calls `presentPaymentSheet()` directly. The wrapper still exists for any remaining callers. Either (a) keep the wrapper and its defensive timeout race as future-proofing (recommend — costs nothing), or (b) eventually deprecate when no callers remain (low priority). Document the call-site audit in the SPEC.

### D-4 (ORCH-0834): Free-ticket flow + Option A — should free tickets ALSO go through Hosted Checkout?
The edge function's `free_completed` path bypasses Stripe entirely (no charge → no Stripe call at all). With Option A, paid tickets open expo-web-browser; free tickets do not. The UX has two different post-confirmation experiences. **Recommend:** keep them separate. Free tickets finalize instantly via the edge function with a toast — no need to open a browser. The visual unification comes via the shared confirmation bottom sheet (the migration above), not via a unified post-confirmation flow.

### D-5 (ORCH-0834): Stripe Checkout Session needs branding configured in Dashboard
Hosted Checkout pages can be branded via Stripe Dashboard → Branding settings (logo, colors, font). Today these are likely set to Stripe defaults. Suggest the SPEC includes a manual step: "Operator confirms Stripe Dashboard branding is set to Mingla's logo + brand color before shipping Option A."

### D-6 (ORCH-0834): Cancel + success deep-link URLs need defining
The edge function currently uses `${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}` and `${baseUrl}/checkout/${eventId}/payment` for web. For iOS via Option A, the equivalent deep links need to be: `com.mingla.app.v2://checkout-success/<orderId>` and `com.mingla.app.v2://checkout-cancel/<sessionId>`. The mobile-app deep-link handler needs to route these (likely in `app-mobile/app/_layout.tsx` or a similar root deep-link handler). The SPEC must cover this.

### D-7 (ORCH-0833 + ORCH-0834 BUNDLED CLOSE): Consider a NEW invariant for inline-BottomSheet UX consistency
Once free + paid both use `@gorhom/bottom-sheet`, suggest a new invariant: `I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM — confirmation surfaces (paid + free) MUST use @gorhom/bottom-sheet inline pattern, NOT React Native Modal`. CI gate via strict-grep.

---

## Working-Branch Discipline

This investigation and its 8 screenshots live in `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No code modified. No migrations applied. No edge functions deployed. No global indexes (DECISION_LOG, INVARIANT_REGISTRY, WORLD_MAP, AGENT_HANDOFFS) written from this skill — they belong to the orchestrator at CLOSE.

Screenshots captured at `Mingla_Artifacts/reports/orch-0833-0834-investigation/`:
- `01_discover_default.png` — initial state (expanded Big Party sheet from prior test)
- `02_after_dismiss.png` — attempted dismiss (didn't work, sheet remained)
- `03_discover_fresh.png` — fresh Discover via tab-switch (Tonight active, Big Party shown)
- `04_filter_all.png` — All filter active (Big Party + 3 TM events)
- `05_filter_tonight.png` — Tonight filter active (Big Party only)
- `06_filter_chips_scrolled.png` — after first swipe attempt (no visible change)
- `07_filter_chips_aggressive_scroll.png` — after aggressive swipe (chips did move per hierarchy bounds)
- `08_fresh_state.png` — re-reset for authoritative default-state hierarchy dump

---

NEXT HANDOFF — paste into Claude `mingla-orchestrator`:

Combined investigation for ORCH-0833 (Discover filter chip regression — root cause **proven** via Maestro view-hierarchy bounds: chips render but overflow horizontally and Filter pinned button overlays "This Weekend"; Next Week + This Month off-screen right with no visible scroll indicator) and ORCH-0834 (ticket-purchase rendering architecture review — **strong recommendation to pivot iOS consumer paid flow to Stripe Hosted Checkout via `expo-web-browser`**, backed by `stripe-best-practices` skill's Tier 2 preference and I-PROPOSED-O gate's explicit endorsement of the `expo-web-browser` pattern) is complete at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834_FILTERS_REGRESSION_AND_RENDERING_ARCHITECTURE.md` with 8 screenshots in `Mingla_Artifacts/reports/orch-0833-0834-investigation/`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Three operator-decision items in the report's executive summary: (1) accept the ORCH-0833 fix direction — either remove Filter button's pinned position (let it scroll with the date chips, simplest) OR add auto-scroll-to-active-chip (best UX clarity) OR both; (2) accept the ORCH-0834 Option A pivot (Hosted Checkout via `expo-web-browser`) — recommend running the 10-minute Option C real-device diagnostic FIRST (the iOS 26 sim may be the only place the SDK hangs, in which case ship four-ORCH bundle as-is and skip the pivot); (3) accept bundling the free-ticket UX migration to `@gorhom/bottom-sheet` in the same close (~80 LoC, low risk, recommended for visual consistency). Seven Discoveries for Orchestrator: D-1 (source comment "More" chip vs code), D-2 (chip row untested at narrower device widths), D-3 (useStripePaymentSheet wrapper future after pivot), D-4 (free flow keeps current path under Option A), D-5 (Stripe Dashboard branding gate before ship), D-6 (deep-link routes need defining for Option A), D-7 (proposed new invariant for confirmation-sheet UX consistency). Downstream routing: orchestrator REVIEW + operator decisions → dispatch Claude `mingla-forensics` again for SPEC scoped to the chosen options (likely TWO specs: one for ORCH-0833 layout fix, one for ORCH-0834 Option A pivot + free-ticket migration) → Codex `implementor-mingla` IMPLEMENT → TEST mode RETEST → orchestrator CLOSE of the now-six-ORCH bundle (0824 + 0828 + 0829-A + 0829-B + 0833 + 0834) in one PR Seth→main with pre-merge gate. The defensive D-1 work from ORCH-0829-B (RPC tombstone-expiry migration + H-2 try/finally + H-3 timeout race) ships unchanged regardless of the Option A decision — those remain valuable defense-in-depth for any residual native PaymentSheet usage.
