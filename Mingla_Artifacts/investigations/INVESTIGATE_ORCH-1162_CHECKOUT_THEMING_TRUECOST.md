# INVESTIGATE — ORCH-1162 Bug 3: checkout (A) brand-color theming + (B) TRUE all-in cost lost

- **Phase:** INVESTIGATE (read-only forensic). No product code edited.
- **Date:** 2026-06-18
- **Device:** Samsung Galaxy A72, adb serial `R58R54YV7JT`, USB; buyer-web via device Chrome (signed-in `sethogieva@gmail.com`). Device clock untouched (24h).
- **Evidence dir:** `Mingla_Artifacts/evidence/ORCH-1162/`
- **Comms:** Acked COMMS-0040 (WARN, RSVP standardization) — not relevant to the checkout flow; no overlap.

---

## EXECUTIVE VERDICT

**Bug 3B is a CONFIRMED, comprehensive REGRESSION — the ENTIRE ORCH-1147 all-in cart fix (#497) was clobbered by ORCH-1138 Leg 3 (#507).** Not a missed surface — a wholesale revert. Every one of the 7 product files ORCH-1147 touched now has ZERO references to `unitPriceAllIn` / `allInTotal` / `priceAllInGbp`, and the ORCH-1147 regression test no longer even compiles. The clobber is a **stale-anchor merge**: #507 branched off a `main` that predated #497, so merging #507 overwrote `CartContext.tsx` (and the trip/experience checkout seeds, both checkout payment steps, two services, and the edge function's web-charge line) with the pre-1147 versions — silently, presenting as `+` insertions in the merge diff.

Net effect for buyers today: the cart + all 3 checkout steps sum the BARE base price, web hosted-Checkout bills the bare base too (the 1147 D-1 web-charge fix reverted), and on a pass-through-fee tier the displayed/charged number diverges from the server-quoted all-in. Proven with a REAL divergent fixture: the "ORCH-1153 Pass-Fee Tasting Crawl" tier is base `$50.00` but server all-in `$55.00` (`pg_public_event_tier_allin` → `all_in_cents:5500`).

**Bug 3A (theming) is CONFIRMED-deterministic:** the 3 checkout-step CTAs use `variant="primary"` → `accent.warm = #eb7825` (Mingla orange), and `coverHue` IS available in the checkout data flow (it survives on the public-event/brand object). The public PAGE already themes correctly (runtime: brand-BLUE "Buy ticket" on the event page), so the theming gap is isolated to the in-flow checkout buttons.

---

## INVESTIGATION MANIFEST (files read, in trace order)

1. `mingla-business/app/checkout/[eventId]/index.tsx:255-314` — Step 1 cart seed (`unitPrice: ticket.priceGbp`) + `variant="primary"` Continue button.
2. `mingla-business/src/components/checkout/CartContext.tsx:34-46, 402-426` — `CartLine` (no `unitPriceAllIn`) + `useCartTotals` (`total = subtotal`, no `allInTotal`).
3. `mingla-business/app/checkout/[eventId]/payment.tsx:265-348, 552-561` — native-only all-in preview (`Platform.OS !== "web"`), `displayTotalCents = totals.total`, `variant="primary"` Pay button.
4. `mingla-business/app/checkout/[eventId]/buyer.tsx:597` — `variant="primary"` Continue button.
5. `mingla-business/src/components/ui/Button.tsx:99-105` + `mingla-business/src/constants/designSystem.ts:159` — `primary` → `accent.warm = #eb7825`.
6. `mingla-business/src/services/publicEventsService.ts:840-895` — `fetchTierAllInCents` + `priceAllInGbp` (the EVENT service SURVIVED the clobber).
7. `mingla-business/src/services/publicExperienceService.ts`, `tripsService.ts` — `priceAllInGbp` GONE (clobbered).
8. `mingla-business/src/components/checkout/__tests__/orch_1147_cart_allin_total.test.ts` — the ORCH-1147 regression test (now fails to compile).
9. `supabase/functions/ticket-checkout-create/index.ts:552, 905-927, 1078-1092, 1358-1361` — engine gross-up + the web-charge `unit_amount` (reverted to bare `totalCents`).
10. Git: `git show 0e20cb949` (#497 ORCH-1147), `git show 13c3ec4c5` (#507 ORCH-1138 Leg 3), `git log -- CartContext.tsx`.
11. DB (read-only): `ticket_types` + `pg_public_event_tier_allin` for the pass-fee fixture.

---

## Q-SCORECARD

- **Q1. Do the 3 checkout-step CTAs render Mingla orange (#eb7825), not the brand color?** **Verdict: YES (bug).** All 3 are `variant="primary"` → `accent.warm = #eb7825`. `confirmed`-deterministic (source); the public page's brand-blue CTA (`web_12`) proves the contrast.
- **Q2. Is `coverHue` available in the checkout data flow for theming?** **Verdict: YES.** `coverHue` is on `PublicEventProps` (`types.ts:72`) and on the `PublicEventRecord` the checkout loads via `usePublicEventById`. `proven` (source).
- **Q3. Does the cart sum the bare base instead of the all-in?** **Verdict: YES.** Step 1 seeds `unitPrice: ticket.priceGbp` (bare); `useCartTotals.total = subtotal` (sum of bare). `proven` (source).
- **Q4. Does buyer WEB show/charge the bare price end-to-end?** **Verdict: YES.** Web display: `displayTotalCents = totals.total` (bare), the all-in preview is native-only (`Platform.OS !== "web"` early-return). Web CHARGE: the edge web-checkout `unit_amount: totalCents` (bare) — the 1147 D-1 fix reverted. `confirmed`-deterministic + the DB divergence fixture.
- **Q5. Is this a regression or a missed surface?** **Verdict: REGRESSION (full clobber of #497 by #507).** `proven` (git + the failing 1147 test).
- **Q6. Can the true-cost gap be proven with real divergent numbers?** **Verdict: YES.** Pass-fee fixture base `$50.00` vs server all-in `$55.00`. `proven` (DB + RPC).

---

## FINDINGS (six-field evidence)

### F-1 — ORCH-1147 cart all-in fix fully reverted by the #507 stale-anchor clobber (CONFIRMED ROOT CAUSE — Bug 3B)
1. **Symptom:** cart + checkout sum/display/charge the BARE base, not the server all-in; buyer surprised at PaymentSheet.
2. **Layer:** code (client + edge) + runtime (deterministic) + data.
3. **Probe:**
   - `git log --oneline -- mingla-business/src/components/checkout/CartContext.tsx` → last two touches are `0e20cb949` (ORCH-1147, #497) then `13c3ec4c5` (ORCH-1138 Leg 3, #507).
   - `npx jest orch_1147_cart_allin_total` (in `mingla-business/`).
   - grep for `unitPriceAllIn|allInTotal|priceAllInGbp` across all 7 ORCH-1147 files.
4. **Evidence:**
   - `git show 0e20cb949` ADDED `unitPriceAllIn?: number` to `CartLine`, `allInTotal`/`feesTaxCents`/`hasFeesTaxDelta` to `CartTotals`, and seeded `unitPriceAllIn` in the trip/experience/event checkout indexes.
   - CURRENT `CartContext.tsx`: `CartLine` (L34-46) has NO `unitPriceAllIn`; `useCartTotals` (L402-426) is `subtotal += line.unitPrice * line.quantity` and `total = subtotal` — no `allInTotal`.
   - The 1147 test FAILS TO COMPILE: `TS2339: Property 'allInTotal' does not exist on type 'CartTotals'`, `'hasFeesTaxDelta' does not exist`, `'unitPriceAllIn' does not exist in type 'Partial<CartLine>'`.
   - grep count of `unitPriceAllIn|allInTotal|priceAllInGbp` = **0** in CartContext, both checkout indexes, both payment steps, `publicExperienceService.ts`, `tripsService.ts`.
   - `git show 13c3ec4c5 --stat -- CartContext.tsx` shows `+29 insertions, 0 deletions` of ONLY ORCH-1138's `eventDateId` plumbing — yet the file emerged WITHOUT the 1147 lines. That is the stale-base signature: #507's branch never had the 1147 code, so the merge wrote its (older) whole-file version, dropping #497's lines while the diff tooling reported the delta against the stale base.
5. **Mechanism:** stale-anchor merge of #507 reverted #497 → cart seeds bare → `useCartTotals` sums bare → every downstream display/charge is bare.
6. **Severity:** CONFIRMED ROOT CAUSE. Confidence: `proven`.

### F-2 — Web shows AND charges the bare price end-to-end (CONFIRMED ROOT CAUSE — Bug 3B web surface)
1. **Symptom:** buyer-web checkout shows the bare base; the web Stripe charge bills the bare base.
2. **Layer:** code (client + edge).
3. **Probe:** read `payment.tsx:265-348, 552-561`; `ticket-checkout-create/index.ts:1078-1092`.
4. **Evidence:**
   - `payment.tsx:273` silent all-in preview: `if (Platform.OS === "web") return;` → web never fetches the all-in.
   - `payment.tsx:558-561`: `displayTotalCents = totals.total; displayAllIn = Platform.OS !== "web" && allInPreviewCents !== null ? formatCurrency(allInPreviewCents,…) : formatCurrency(displayTotalCents,…)` → on web the "Total" is always the bare cart subtotal.
   - Edge web hosted-Checkout `unit_amount: totalCents` (L1086), where `totalCents = Number(session.totalCents ?? 0)` (L552, bare base). ORCH-1147's D-1 fix had set this to `buyerSubtotal.buyerSubtotalCents` (the engine gross-up, `base + passed Mingla fee + passed service fee`) — reverted. The native PI path DOES use the gross-up (engineInput L910 → `computeBuyerSubtotal`), so web ≠ native.
5. **Mechanism:** web display = bare; web charge = bare; native = grossed-up — three inconsistent numbers, the exact divergence #497 closed.
6. **Severity:** CONFIRMED ROOT CAUSE. Confidence: `proven` (source) + the DB fixture (F-4). NOTE: with the D-1 revert, the WEB charge under-charges (brand silently absorbs the fee) rather than over-charging; either way the displayed/charged/quoted numbers no longer agree.

### F-3 — The 3 checkout-step CTAs are hardcoded Mingla orange via `variant="primary"` (CONFIRMED ROOT CAUSE — Bug 3A)
1. **Symptom:** the Step 1 Continue, Step 2 Continue, Step 3 Pay buttons render Mingla orange `#eb7825`, not the brand color.
2. **Layer:** code (+ runtime contrast).
3. **Probe:** read the 3 button sites + `Button.tsx` + `designSystem.ts`.
4. **Evidence:**
   - Step 1 `checkout/[eventId]/index.tsx:305` `variant="primary"`; Step 2 `buyer.tsx:597` `variant="primary"`; Step 3 `payment.tsx:681` `variant="primary"`.
   - `Button.tsx:100-104` `primary: { background: accent.warm, … }`; `designSystem.ts:159` `warm: "#eb7825"`.
   - Runtime contrast: the public event page's "Buy ticket" CTA is brand-BLUE (`web_12_event_venue_no_map.png`) — the public renderer themes from the brand; the checkout buttons do not.
5. **Mechanism:** `variant="primary"` resolves to the fixed Mingla-orange token, ignoring the brand's `coverHue`.
6. **Severity:** CONFIRMED ROOT CAUSE. Confidence: `confirmed`-deterministic (source + the runtime brand-blue contrast on the sibling public page).

### F-4 — Real divergent pass-fee fixture proves the gap is now VISIBLE (CONFIRMED — supporting data)
1. **Symptom:** base price ≠ all-in for a pass-through-fee tier.
2. **Layer:** data.
3. **Probe:** `SELECT … FROM ticket_types WHERE event_id='229ff02a-…'`; `SELECT * FROM pg_public_event_tier_allin('229ff02a-…')`.
4. **Evidence:** tier "Standard" `price_cents: 5000` (USD). `pg_public_event_tier_allin` → `{base_cents:5000, all_in_cents:5500, currency:'usd'}`. Brand `orch-1153-pass-fee-qa-50e0fd65`, event "ORCH-1153 Pass-Fee Tasting Crawl". Runtime `web_14`: the public experience page shows "From **$50.00**" (bare) — NOT the $55 all-in (the experience service lost its `priceAllInGbp` in the same clobber). (This brand is "Booking unavailable / organizer finishing payment setup," so checkout itself is gated — but the displayed BARE figure is the proof.)
5. **Mechanism:** with a $5 pass-through delta, the bare-vs-all-in bug is no longer invisible (the ORCH-1147 memory's "0/8 brands pass fees → invisible on prod" caveat is bypassed by this synthetic fixture).
6. **Severity:** CONFIRMED (supporting evidence). Confidence: `proven`.

### F-5 — The EVENT public service kept `priceAllInGbp`; the consuming checkout dropped it (CONFIRMED — scope nuance)
1. **Symptom:** the EVENT public PAGE shows the all-in ($67.93) but the EVENT CHECKOUT seeds bare.
2. **Layer:** code.
3. **Probe:** grep `publicEventsService.ts` (4 hits: `fetchTierAllInCents` L840, `priceAllInGbp` L885-890); read `checkout/[eventId]/index.tsx:274`.
4. **Evidence:** `#507` did not touch `publicEventsService.ts`, so the EVENT service still resolves `priceAllInGbp` (and the public page renders it — `web_12` "$67.93"). But the EVENT checkout seed at L274 is `unitPrice: ticket.priceGbp ?? 0` — the all-in producer survived; the consumer (the cart seed) was reverted. For EXPERIENCE/TRIP, BOTH producer (service) and consumer were reverted.
5. **Mechanism:** asymmetric clobber → event public page healthy, event checkout broken; experience/trip broken on both ends.
6. **Severity:** CONFIRMED (clarifies blast radius). Confidence: `proven`.

---

## (A) THEMING — the 3 buttons + coverHue availability

| Step | File:line | Current color (proven) | coverHue available? |
|---|---|---|---|
| Step 1 — Continue | `checkout/[eventId]/index.tsx:305` | `variant="primary"` → `#eb7825` | YES (`PublicEventProps.coverHue` / loaded event record) |
| Step 2 — Continue | `checkout/[eventId]/buyer.tsx:597` | `variant="primary"` → `#eb7825` | YES |
| Step 3 — Pay | `checkout/[eventId]/payment.tsx:681` | `variant="primary"` → `#eb7825` | YES |

`coverHue` is the existing brand accent source (no new schema needed, per Seth's decision). The public event/brand renderers already convert `coverHue` → an accent palette (`palette.accent`) used for their themed CTAs; the checkout buttons need the same derivation fed to a brand-accent button color. (Whether via a new Button variant or an explicit color override is a SPEC decision.)

## (B) TRUE COST — exact seeding/display sites + which surface shows bare vs all-in

| Site | File:line | Current | Should be (per #497) |
|---|---|---|---|
| Event cart seed | `checkout/[eventId]/index.tsx:274` | `unitPrice: ticket.priceGbp` | also seed `unitPriceAllIn: ticket.priceAllInGbp ?? priceGbp` |
| Trip cart seed | `checkout-trip/[tripEventId]/index.tsx:246, 450` | `unitPrice: …priceGbp` | + `unitPriceAllIn` |
| Experience cart seed | `checkout-experience/[experienceEventId]/index.tsx:277` | `unitPrice: …priceGbp` | + `unitPriceAllIn` |
| Cart totals | `CartContext.tsx:402-426` | `total = subtotal` (bare) | re-add `allInTotal`/`feesTaxCents` |
| Payment display | `payment.tsx:558-561` | web → bare `totals.total` | web → all-in floor |
| Web all-in preview | `payment.tsx:273` | `if web return` (skip) | web must source the all-in |
| Edge web charge | `ticket-checkout-create/index.ts:1086` | `unit_amount: totalCents` (bare) | `unit_amount: buyerSubtotal.buyerSubtotalCents` |
| Experience service all-in | `publicExperienceService.ts` | `priceAllInGbp` GONE | re-add (reuse `fetchTierAllInCents`) |
| Trip service all-in | `tripsService.ts` | `priceAllInGbp` GONE | re-add |

**Surface verdict:** BARE is shown on **buyer-web (all 3 steps)** and CHARGED bare on web; **native business app** shows the all-in only after the silent preview resolves (and charges the gross-up via the PI) — so native is partially protected, web is fully exposed. The EVENT public page (not checkout) shows all-in correctly; the EXPERIENCE public page shows bare (service clobbered).

**Regression vs missed-surface:** **REGRESSION** — full clobber of #497 by #507 (stale-anchor merge), proven by the failing-to-compile 1147 test + the zeroed greps + the git order.

**How proven:** DETERMINISTIC (source + git + the failing test) for the code revert; LIVE-DATA (DB + `pg_public_event_tier_allin`) for the $50 vs $55 divergence; RUNTIME (`web_14`) for the experience public page showing bare $50.

---

## FIVE-TRUTH-LAYER RECONCILIATION

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | ORCH-1147 memory: cart shows the TRUE all-in across event/trip/experience + web charge fix; SHIPPED #497. | **YES** — the shipped fix is no longer in the tree (clobbered by #507). The memory describes a state that has regressed. |
| **Schema** | `pg_public_event_tier_allin` returns base 5000 / all-in 5500 for the pass-fee tier; the engine (`computeBuyerSubtotal`) is intact. | No conflict — the server math is correct; the client/web-charge consumption regressed. |
| **Code** | Cart sums bare; web charge bills bare; native PI grosses up; 3 CTAs hardcoded orange. | The decisive contradiction: code is the pre-1147 state despite #497 being "merged." |
| **Runtime** | Public event page = all-in ($67.93) + brand-blue CTA; public experience page = bare ($50). | Asymmetric (F-5) — event service survived, experience service reverted. |
| **Data** | Pass-fee fixture proves a real $5 divergence; absorb-only prod brands hide it elsewhere. | Resolves the "invisible on prod" caveat — a divergent fixture exists. |

---

## REPRO EVIDENCE

| # | Screenshot | What it proves |
|---|---|---|
| 1 | `web_12_event_venue_no_map.png` | EVENT public page CTA is brand-BLUE + "$67.93 all-in" → the public renderer themes + shows all-in (contrast for the orange checkout buttons; checkout is the gap). |
| 2 | `web_14_passfee_exp_public.png` | EXPERIENCE public page shows "From $50.00" (bare) for a tier whose server all-in is $55.00 → the experience service lost `priceAllInGbp` in the clobber. |
| — | DB rows | `ticket_types.price_cents=5000`; `pg_public_event_tier_allin` → `all_in_cents:5500` → real $5 divergence. |
| — | jest output | `orch_1147_cart_allin_total.test.ts` fails to compile (allInTotal/unitPriceAllIn/hasFeesTaxDelta gone) → the regression-test that should fail-on-revert is RED, proving the revert. |

---

## BLAST RADIUS / CROSS-SURFACE MAP

- **Reverted (must restore):** `CartContext.tsx`, `checkout/[eventId]/index.tsx`, `checkout/[eventId]/payment.tsx`, `checkout-trip/[tripEventId]/index.tsx` + `payment.tsx`, `checkout-experience/[experienceEventId]/index.tsx` + `payment.tsx`, `publicExperienceService.ts`, `tripsService.ts`, `ticket-checkout-create/index.ts` (web `unit_amount`). The two 1147 test files survive but are RED.
- **Surfaces:** buyer-web (fully exposed — display + charge), business app native (partially protected via PI gross-up + silent preview), consumer app (event public deck/path shows all-in via the surviving event service; experience/trip consumer checkout would be bare). Theming gap (3A) is business-app + buyer-web checkout (the shared `checkout/[eventId]` routes).
- **Out of scope:** the EVENT public PAGE (already all-in + themed — F-5/D-2 of the map investigation); the engine/RPC (correct).

---

## DISCOVERIES FOR ORCHESTRATOR

- **D-1 (process, P0-class):** ORCH-1147 (#497) was wholesale reverted by ORCH-1138 Leg 3 (#507) via a stale-anchor merge — the exact hazard called out in memory (Paystack clobber; "deploy/branch from MERGED main, not stale worktrees"). The `git show #507 --stat` reports `+` insertions because the diff is taken against #507's stale base, masking the revert. RECOMMENDATION: the fix should RESTORE #497 (cherry-pick/re-apply all 9 files incl. the edge `unit_amount`) rather than re-author, and the 1147 regression tests (already in-tree, currently RED) become the fails-on-revert guard. Also: a CI check that the 1147 all-in test COMPILES would have caught this at #507 merge.
- **D-2:** The asymmetry (event service survived, experience/trip services reverted) means the EVENT public page looks correct while EXPERIENCE/TRIP public pages and ALL checkout flows are bare — easy to miss in a casual eyeball. Test must cover all three offering types on web.
- **D-3:** Memory's "0/8 charges-enabled brands pass fees → bug invisible on prod" caveat is now bypassed by the live `orch-1153-pass-fee-qa` fixture (base $50 / all-in $55). Reuse it for the tester's runtime proof (note it's currently charges-disabled, so a charges-enabled pass-fee fixture is still needed for an end-to-end PaymentSheet proof).

---

## CONFIDENCE & RECOMMENDED NEXT PHASE

- **Overall confidence: `proven`** — Bug 3B (the #497 clobber) is proven by git + the failing-to-compile regression test + zeroed greps + the live DB divergence + the runtime bare-price experience page; Bug 3A is `confirmed`-deterministic (source + the runtime brand-blue contrast on the sibling public page).
- **Recommended next phase: SPEC** — (3B) RESTORE ORCH-1147 across the 9 reverted files (re-make the 1147 tests GREEN as the fails-on-revert guard) so cart + all 3 checkout steps + the web charge read the server fee-grossed all-in for event/trip/experience; (3A) theme the 3 checkout CTAs from `coverHue` (no new schema), matching the public-page accent derivation. Out of scope: the public event page (already correct), the engine/RPC. **No fix proposed here.**
