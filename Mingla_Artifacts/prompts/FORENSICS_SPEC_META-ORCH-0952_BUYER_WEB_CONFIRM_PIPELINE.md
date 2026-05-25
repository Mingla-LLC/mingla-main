# FORENSICS SPEC — META-ORCH-0952 [Buyer-web confirm pipeline — binding fix SPEC]

**Target skill:** Claude `mingla-forensics` (SPEC mode — binding implementation contract, NOT INVESTIGATE, NOT IMPLEMENT)

**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]/` on branch `meta-orch-0952-buyer-web-confirm-deep-forensics`. `cd` there first.

**ORCH-ID:** META-ORCH-0952 [Buyer-web confirm pipeline deep forensics + binding SPEC] — INVESTIGATE phase APPROVED by orchestrator REVIEW 2026-05-24.

---

## What's already proven (do NOT re-investigate)

Investigation complete and approved. The full report with six-field evidence is at:

`Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md`

**Read it end-to-end before writing the SPEC.** The two confirmed root causes you are writing a fix contract for:

- **F1 — React #418 still fires post-ORCH-0951 v2** on production buyer-web confirm, across Chromium + WebKit + Firefox, on both `/checkout-trip/{tripEventId}/confirm` and `/checkout/{eventId}/confirm`. v2 did NOT eliminate the runtime hydration/recovery fault.
- **F2 + F3 — Multi-ticket carousel layout deadlock.** First render of `TicketQrCarousel` returns a bare measuring host while `pageWidth === 0` ([TicketQrCarousel.tsx:140-145](mingla-business/src/components/checkout/TicketQrCarousel.tsx#L140-L145)). Inside the center-aligned `GlassCard` chain that empty host computes to `width: 0px` even with source `width:"100%"`, so the measured width never becomes positive and the QR `<Image>` subtree never mounts. Ancestor walk: depths 1-3 = `width:32` (padding-only wrappers), depth 4 = `width:1232` with `alignItems:"center"` → RNW shrink-wrap resolves the host's `width:"100%"` against a zero-content parent.
- **F7 — Existing `orch_0930_qr_carousel_mounted_guard.test.tsx` is source-string only.** It asserts imports, no QRCode, `qrImageDataUrl`, v2 gate — but never launches a browser, never asserts computed width / image count / pageerror. That's why 5 attempts shipped green tests with a broken page.

Schema, data, and edge layers are clean (F4/F5/F6 — RULED OUT). Live multi-ticket orders `d99081c3-c77d-462e-a0ff-1e0345222af5` (3 tickets) and `86443229-557a-4d57-9ce2-a5f36ef0fa2e` (4 tickets) have all `qr_code` populated and distinct; `ticket-checkout-confirm` v45 + `ticket-checkout-status` v106 return `qrImageDataUrl` per ticket. The bundle uses `<Image>` not `react-native-qrcode-svg`. Do NOT propose changes to any of those.

---

## SPEC scope (binding — do NOT widen or narrow)

Per the investigation's "Recommended SPEC Scope" section. The SPEC must address all of:

1. **Carousel architecture rewrite for multi-ticket.** Eliminate the empty-measuring-host first-render pattern. The first render of the multi-ticket carousel must NOT depend on a previously-measured positive `pageWidth` to mount the image subtree. Either: render the images at a deterministic width on first paint (e.g., `Dimensions.get("window").width` minus card padding, or a viewport-based CSS unit, or a useRef + getBoundingClientRect synchronous read, or `100vw`-style CSS-only paging that doesn't need JS measurement), OR move the paging-width math to a post-mount layout effect that doesn't gate the image subtree. The SPEC author picks the approach — but the contract is: **on first paint of a multi-ticket carousel, the host element has positive computed width AND the N `<Image>` elements are mounted in the DOM.**
2. **React #418 elimination on production-like confirm pages.** The hydration/recovery fault must not fire when a multi-ticket paid confirm response is processed. The investigation didn't isolate the exact source of #418 (only proved it still fires post-v2); the SPEC implementor will need to instrument and isolate during implement. SPEC should require: post-implementation Playwright probe against production-build (`expo export -p web` + serve) shows zero `pageerror` matching `Minified React error #418` across Chromium + WebKit + Firefox with mocked 1-ticket AND 3-ticket confirm responses on both trip + event routes.
3. **Trip / event confirm parity as a first-class success criterion.** Both [confirm.tsx files](mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx) must exhibit identical carousel behavior. SPEC may consolidate shared logic into a hook or shared component if that helps; if it does, name the shared module and its API explicitly.
4. **Stale v3 comments cleanup.** Both confirm files still contain mount-block comments describing ORCH-0930 v3 behavior while the actual code is v2. SPEC must require comments be updated (or removed) to reflect the post-SPEC implementation so future responders don't chase the wrong hydration history. List the exact line ranges.
5. **Regression test contract (THIS IS WHERE THE PRIOR ATTEMPTS DIED — be precise).** Implementor and tester MUST each write browser-running regression tests, not source-string tests. The implementor's happy-path test and the tester's adversarial test (per ORCH-0840 / Step 0.5) must each:
   - Load the actual exported web confirm route (production build via `expo export -p web` + local serve, or a Playwright fixture that mounts the route component in a real browser).
   - Mock `ticket-checkout-confirm` to return 1-ticket AND 3-ticket paid responses.
   - Assert NO `pageerror` matching `Minified React error #418`.
   - Assert the carousel host element has `getBoundingClientRect().width > 0`.
   - Assert the DOM contains N `<img>` elements (or N QR placeholders) for N tickets.
   - Assert dots/swipe affordance is present for N>1 and absent for N=1.
   - Run for BOTH trip route and event route.
   - The adversarial test must attack a different angle than happy-path — candidates: zero-ticket edge case, ticket with empty `qrImageDataUrl`, viewport resize during carousel mount, rapid re-render from realtime ticket update, very-narrow viewport (≤375px), very-wide viewport (≥1920px). SPEC picks ONE adversarial vector to require; tester can add more.
   - Run across Chromium + WebKit (Safari engine) + Firefox.
   - Both tests must be `fails-on-revert verified` (per Step 0.5).
6. **Browser matrix gate at TEST time.** Tester live matrix: iOS Simulator (Safari MOBILE), Android Emulator (Chrome Android), desktop Chrome, desktop Safari, desktop Firefox, AND operator's physical iPhone Safari (the original visual-bug-report device). SPEC names these surfaces explicitly so the tester can't claim PASS without exercising each.
7. **Single-ticket regression guard.** Single-ticket buyer-web purchases currently render correctly post-ORCH-0932. SPEC must include an explicit "do-not-regress" clause + a single-ticket regression test in the same spec.

## SPEC scope (binding — do NOT touch)

Investigation rules these out as causes; SPEC implementor must NOT modify:

- `tickets.qr_code` schema or QR token generation.
- `_shared/ticketQrImage.ts` server-side PNG.
- `ticket-checkout-confirm` / `ticket-checkout-status` QR response shape (except adding a test fixture if needed — flag explicitly).
- Stripe checkout, live charges, finalization RPC behavior, webhook/reconcile.
- Consumer mobile, business native checkout, admin surfaces.
- The `qrImageDataUrl` threading in [`CartContext.tsx`](mingla-business/src/components/checkout/CartContext.tsx) `OrderResult` type — it works.

If the implementor finds during implement that one of these IS implicated, they MUST stop and request a SPEC amendment from the orchestrator — they do NOT silently widen scope.

---

## Hard guards (SPEC-mode)

- **SPEC writes a contract, not code.** No code blocks longer than illustrative 2-3 line snippets to clarify intent. The implementor writes the actual code under a separate dispatch.
- **No new investigation.** If SPEC author finds a gap in the investigation, STOP and request a re-investigation dispatch from the orchestrator — do NOT investigate inside the SPEC.
- **Cross-surface declaration:** confirm in SPEC header that buyer-anonymous web is in scope; consumer iOS/Android, business iOS/Android, admin-web are out of scope.
- **No `supabase db push`, no edge deploy, no product code edits, no Stripe charges.**
- **Sequential rule:** SPEC is one document; do not bundle parallel ORCHs.

---

## Required SPEC structure

The SPEC document at `Mingla_Artifacts/specs/SPEC_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md` (inside this worktree) must contain:

1. **Executive summary** (≤150 words, plain English): what changes, what doesn't, what users see post-fix.
2. **Background pointer**: one paragraph + link to the investigation report. Do NOT re-summarize the investigation — link it.
3. **Affected files (scoped allowlist)** — exact paths the implementor may edit. Anything not listed is OUT OF SCOPE.
4. **Architecture decision** — for the carousel rewrite (scope item 1): which approach is binding (deterministic-width first paint / synchronous getBoundingClientRect / CSS-only paging / post-mount-effect-not-gating-mount / other). Justify in 3-5 sentences. Include the explicit invariant: "first paint of multi-ticket carousel has positive host width AND N mounted images."
5. **Behavioral contracts** — bullet list of every behavior the implementation must satisfy. One bullet per assertion the tester will check.
6. **Test contract** — exact list of regression tests required (happy-path + adversarial), file paths where they should live, assertions each must make. Cite ORCH-0840 / Step 0.5 explicitly. Both `fails-on-revert verified` required.
7. **Success criteria** — what PASS looks like (browser matrix + assertions + manual operator-iPhone-Safari check).
8. **Failure modes to instrument** — short list of things the implementor should add console/log/error-boundary visibility to during implement so the React #418 isolation step in Q2 can succeed.
9. **Non-goals / out-of-scope** — restate the "do NOT touch" list verbatim.
10. **Invariants this SPEC codifies** — if the fix establishes a new invariant for the registry (e.g., "all buyer-web checkout regression tests MUST run in a real browser with mocked edge responses, not source-string only"), state it.
11. **Pipeline routing post-SPEC** — IMPLEMENT (Codex `implementor-mingla` default, or Claude `mingla-implementor`) → REVIEW → DEPLOY (orchestrator deploys edge fns if any — likely none here, buyer-web only) → TEST (Claude `mingla-tester`, live matrix) → CLOSE.

---

## Expected output

**SPEC file:** `Mingla_Artifacts/specs/SPEC_META-ORCH-0952_BUYER_WEB_CONFIRM_PIPELINE.md` (inside this worktree).

**Length target:** as long as it needs to be precise; aim for tight. The implementor should be able to read the SPEC + the investigation and write code without asking questions.

---

## Downstream routing

After SPEC returns, orchestrator REVIEWs against the 11-section structure above + the scope discipline. If APPROVED → IMPLEMENT dispatch. If NEEDS WORK → targeted SPEC amendment.

Pipeline so far: INVESTIGATE ✅ APPROVED → SPEC (this) → REVIEW → IMPLEMENT → REVIEW → DEPLOY (likely none) → TEST → CLOSE → worktree reap.
