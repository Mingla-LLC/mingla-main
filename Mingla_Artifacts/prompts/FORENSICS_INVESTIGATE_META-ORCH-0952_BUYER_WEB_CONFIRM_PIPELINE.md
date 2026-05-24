# FORENSICS INVESTIGATE — META-ORCH-0952 [Buyer-web confirm pipeline — multi-ticket QR carousel still broken]

**Target skill:** Claude `mingla-forensics` (INVESTIGATE mode — deep cross-layer, NOT SPEC, NOT IMPLEMENT)

**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]/` on branch `meta-orch-0952-buyer-web-confirm-deep-forensics`. cd into it first. Metro port 8083 if needed (likely not — this is buyer-web).

**ORCH-ID:** META-ORCH-0952 [Buyer-web confirm pipeline deep forensics + binding SPEC] — sealed-saga consolidation of 5 failed point-fix attempts on the multi-ticket QR carousel render bug.

---

## Operator directive (verbatim, 2026-05-24)

> "The QR codes still don't show up when you buy more than one ticket on a trip — fix this for real with a deep investigation across all the layers, not just another guess."

Five prior attempts have failed. Stop guessing. Prove. This dispatch is **investigation only** — no fixes proposed in the report, no code edits. SPEC follows after operator approves the root-cause findings.

---

## Symptom (what an actual buyer sees)

1. Buyer pays for **2+ tickets** on a trip via buyer-anonymous web at `business.usemingla.com/checkout-trip/{tripEventId}` (and the parallel `/checkout/{eventId}` event flow).
2. Stripe redirects to `…/confirm?cs=…&csi=…&bst=…`.
3. Page chrome renders correctly: green checkmark hero, "You're in", order summary card, order ID, "Back to trip" CTA.
4. The QR carousel area renders a **thin vertical strip** (~10px wide × ~320px tall). No QR images. No swipe pagination. No "Swipe to see next ticket" hint.
5. **Single-ticket purchases render the QR correctly** post-ORCH-0932 (server-side PNG pivot).

Native (iOS / Android dev builds of mingla-business) are unverified but believed-working (no SSR/hydration on RN native). Buyer-web is the only confirmed-broken surface.

---

## Required Phase 0 ingest (read in this order, before any probe)

1. **Saga (single source of truth for what's been tried):** `Mingla_Artifacts/reports/SAGA_BUYER_WEB_CONFIRM_CAROUSEL.md` — read end-to-end. This documents all 5 attempts, the hypothesis behind each, the result, the files touched, the diagnostic gaps, and the explicit "what we DON'T know" list.
2. **Prior investigation reports** (read each — they contain probe scripts, DOM snapshots, and ruled-out hypotheses you do NOT need to re-prove):
   - `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0928_BUYER_WEB_QR_CAROUSEL_RENDERS_AS_STRIP.md`
   - Any `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0930_*.md` (multiple iterations)
   - Any `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0932_*.md` (server-side QR PNG pivot)
   - Any `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0951_*.md` (carousel host width — wrong diagnosis)
3. **Critical code (verbatim read, every line; do not skim):**
   - `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` (full file)
   - `mingla-business/app/checkout/[eventId]/confirm.tsx` (full file — confirm parity vs trip)
   - `mingla-business/src/components/checkout/TicketQrCarousel.tsx` (full file)
   - `mingla-business/src/components/checkout/CartContext.tsx` (OrderResult type, qrImageDataUrl threading)
   - `supabase/functions/ticket-checkout-confirm/index.ts`
   - `supabase/functions/ticket-checkout-status/index.ts`
   - `supabase/functions/_shared/ticketQrImage.ts`
   - `mingla-business/src/components/checkout/__tests__/orch_0930_qr_carousel_mounted_guard.test.tsx`
4. **Existing Playwright forensic probe (working harness — extend, don't rebuild):** `/tmp/orch-0928-forensic/probe-orch-0951-v2.js` — mock-network 3-ticket harness. Reuse + extend.

If any of these files are missing, STOP and report — do not proceed on partial intel.

---

## What is already proven (do NOT re-prove — cite the saga + skip)

| Layer | State | Source |
|---|---|---|
| DB `tickets` rows | ✅ Created with `qr_code` populated | ORCH-0930 v3 + ORCH-0951 SQL probes |
| Edge fn `ticket-checkout-confirm` | ✅ Returns 200 + full order + `qrImageDataUrl` per ticket | ORCH-0932 deploy verification |
| Edge fn `ticket-checkout-status` | ✅ Returns 200 + full order + `qrImageDataUrl` per ticket | ORCH-0932 deploy verification |
| Web bundle | ✅ Contains the v2 fix (`width:"100%"`, `useState(false) + useEffect`, `<Image>` not `<QRCode>`) | ORCH-0951 v2 grep against production bundle |
| Single-ticket carousel | ✅ Renders correctly on web | Operator visual + Playwright |
| React error #418 fires | ✅ Confirmed via `pageerror` capture, headless Chromium, network-mocked 3-ticket | ORCH-0951 v1 forensic |

---

## What you MUST answer (the gap list — your investigation is incomplete until each has a graded verdict + evidence)

This list comes directly from the saga's "what we DON'T know" section. Treat it as a numbered scorecard:

### Q1 — Does the post-v2 production bundle still throw React #418 on a real multi-ticket purchase?

Drive Playwright against `https://business.usemingla.com/checkout-trip/{tripEventId}/confirm?cs=…&csi=…&bst=…` with a real (or convincingly-mocked) 3-ticket response. Capture `pageerror`, `console`, and the full rendered DOM tree of the carousel host element + every ancestor up to `<body>`. If #418 still fires → v2 did not fix it; the bug is elsewhere. If #418 does NOT fire and the strip persists → there is a SECOND root cause hiding behind the hydration mismatch.

**Verdict format:** `#418 fires: YES/NO` + commit hash of the bundle tested + DOM evidence.

### Q2 — If #418 is gone but the strip persists, which of (a)–(e) below is the actual layout/render root cause?

Enumerate ALL of these — do not stop after the first plausible match. The 5-attempt history proves stopping early is the failure mode:

(a) **pageWidth / onLayout chicken-and-egg** — measure `pageWidth` state on every render, log `onLayout` width events, prove whether the empty-bare-host loop ever resolves.
(b) **GlassCard parent 0-width edge case on RNW** — walk every ancestor's computed `getBoundingClientRect()` width. Identify which ancestor first goes to 0 or fractional.
(c) **Expo Router Suspense boundary aborts the carousel subtree** — inspect React DevTools (or `__REACT_DEVTOOLS_GLOBAL_HOOK__`) for fiber state; identify any suspended boundary in the chain.
(d) **`react-native-svg-web` peer-dep mismatch** — though ORCH-0932 swapped to `<Image>`, verify there's no residual SVG path. Grep the rendered DOM for `<svg>` inside the carousel — should be zero.
(e) **Something else entirely** — Stripe redirect query-state race, hydration boundary at the wrong level, CSS module load order, font-loading reflow killing onLayout, RNW `position: absolute` page model collapsing under 0-height parent, FlatList vs ScrollView paging on web, `ScrollView` `horizontal` + `pagingEnabled` web-paint mismatch. Enumerate. Test each.

**Verdict format:** for each of (a)–(e), `RULED OUT / SUSPECTED / CONFIRMED ROOT CAUSE` + the exact probe + evidence.

### Q3 — Is the bug platform-specific (Safari vs Chrome vs Firefox)?

Operator tested on Safari. Run Playwright matrix: headless Chromium, headless WebKit (Safari engine), and headed Firefox if available. Capture the carousel computed dimensions on each. Distinguish "broken everywhere" from "broken only on WebKit" — the right fix scope changes dramatically.

**Verdict format:** matrix table — browser × `pageWidth` × `svgCount` × `imageCount` × `#418` fires × strip visible.

### Q4 — Does the event flow (`/checkout/{eventId}/confirm`) behave identically to the trip flow?

Both files are assumed-parallel but never verified together post-ORCH-0951. Probe both. If they diverge, that's a clue: whatever differs is in the suspect set.

**Verdict format:** parity-diff table + a verdict line "Same root cause" or "DIVERGENT — event flow exhibits X, trip flow exhibits Y".

### Q5 — Five-truth-layer reconciliation

Per the orchestrator's standing rule, force the inspection across all 5 layers and call out every contradiction:

| Layer | Question |
|---|---|
| **Docs** | What does the saga + prior reports say SHOULD happen? |
| **Schema** | DB `tickets` shape — is the `qr_code` actually a valid scannable string for the multi-ticket case? Are there N rows or fewer than expected? |
| **Code** | Does the source on `main` (commit `4b734b1c`) actually do what we think it does at every callsite in the carousel chain? |
| **Runtime** | Playwright DOM + network + console — what actually happens in the browser? |
| **Data** | A real test purchase's `orders` + `tickets` rows in production — do they match what the edge fn returns? Do the qr_code strings differ between tickets in a multi-ticket order? |

If two layers disagree, that gap IS the bug or hides it. Flag every contradiction.

### Q6 — Is there a structural reason the 5 prior attempts all failed?

Pattern-recognize. All 5 attempts shipped quickly, all 5 had a single hypothesis, all 5 were tested either on operator's device or with limited Playwright. The bug has survived component-level guards, parent-level guards, useState-initializer patterns, server-side PNG generation, and explicit width:100% on the host. What's the meta-pattern? Is the bug actually in a layer NOT touched by any of those (e.g., the Expo Router page wrapper, the GlassCard, the success_url query-state parse race, the cart/CartContext provider mount order, the Stripe redirect param decode, the static export rehydration model)?

Spend real time here. This is the question the operator is paying for.

---

## Hard guards

- **Investigation only.** Do NOT propose fixes inside the report. Do NOT edit any product code outside `/tmp/` probes. Do NOT add or modify tests. The report enumerates root causes; SPEC follows separately after operator approves.
- **Do NOT run `supabase db push --linked`.** Operator owns DB migrations.
- **Do NOT deploy edge functions.** Orchestrator owns deploys, and there's nothing to deploy at investigation time.
- **Do NOT spin up Stripe live charges from the investigation.** Use test mode (already configured on the DC Adventure connected account `acct_1TY6UFPjlZjiLhFt` with test card `4242 4242 4242 4242`) OR mock the edge-fn response with the existing Playwright harness pattern. The saga notes operator already paid €1k+ in test charges during prior cycles; don't add more unless mocking is genuinely impossible for a given probe.
- **Do NOT skip prior reports.** Re-running probes that were already done is wasted effort. Read the existing investigations and only re-probe when you have a NEW hypothesis or need to verify post-v2 state.
- **Reproduce on the simulator/browser before claiming probable** (Mingla rule `feedback_always_simulator_repro_described_behaviour.md`). Source-only reasoning maxes at "suspected".
- **Cross-surface declaration:** confirm in the report header that buyer-anonymous web is in scope, and consumer iOS/Android + business iOS/Android + admin-web are out of scope (per INTAKE).

---

## Six-field evidence standard (per finding)

Every root cause / suspected cause in the report carries:

1. **Symptom** — what the user / browser sees (DOM snippet, screenshot path, computed style).
2. **Layer** — docs / schema / code / runtime / data.
3. **Probe** — exact command, URL, script path, or query that produced the evidence.
4. **Evidence** — the actual output (pasted, not paraphrased). Computed CSS, network status, console line, fiber tree, SQL row.
5. **Mechanism** — why this causes the symptom (the causal chain in 1–3 sentences).
6. **Severity** — `CONFIRMED ROOT CAUSE` / `SECONDARY ROOT CAUSE` / `SUSPECTED CONTRIBUTOR` / `RULED OUT`.

A finding without all 6 is incomplete.

---

## Expected output

**Report file:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md` (inside this worktree).

**Report structure:**

1. **Executive summary (≤200 words)** — plain English: what is the actual root cause (or causes), and what changes architecturally to fix it.
2. **Phase 0 ingest log** — list each file you read, with one-line "what I learned that the next phase needs".
3. **Q1–Q6 verdicts** — each question above answered with the verdict format specified.
4. **Findings table** — every finding with the six-field evidence standard.
5. **Five-truth-layer contradiction list** — every disagreement between layers, called out.
6. **Pattern analysis (Q6 deep-dive)** — why the 5 prior attempts failed; what they missed structurally.
7. **Recommended SPEC scope** — bullets only, no code. "The binding SPEC should cover: X, Y, Z. It should NOT touch: A, B, C." Sufficient detail that the orchestrator can write the SPEC dispatch without re-investigating.
8. **Artifact appendix** — paths to any Playwright probes, DOM snapshots, screenshots, SQL probes you ran. Keep large blobs out of the report body; reference them.

**Length target:** as long as it needs to be. 5 attempts have failed. A 4-page report that finally proves the cause is worth more than a 12-page one that misses it.

---

## Downstream routing

After this investigation returns, the orchestrator reviews against the 6-Q scorecard. If APPROVED → SPEC dispatch (same skill, SPEC mode). If NEEDS WORK → targeted re-investigation on the specific gap. NO IMPLEMENT until SPEC + operator approval. Test phase will run the live matrix: iOS sim + Android emu + Safari + Chrome + operator's physical iPhone.

Pipeline: INVESTIGATE (this) → REVIEW → SPEC → REVIEW → IMPLEMENT → REVIEW → DEPLOY → TEST → CLOSE → reap worktree.
