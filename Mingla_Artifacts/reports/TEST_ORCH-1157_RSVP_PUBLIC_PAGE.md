# TEST — ORCH-1157 [rsvp-public-redesign] · Public RSVP Page → Direction C "Momentum"

**Skill:** mingla-tester (Claude). **Date:** 2026-06-17. **Mode:** SPEC-COMPLIANCE + TARGETED.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1157-[rsvp-public-redesign]/` on branch `ORCH-1157-rsvp-public-redesign`, HEAD `59ece6a11`.
**Binding contract:** `SPEC_ORCH-1157_RSVP_PUBLIC_PAGE.md` + `RSVP_DIRECTION_C_MOMENTUM.html`.
**Comms ledger:** read; no BLOCK/OPEN entry addressed to mingla-tester, ORCH-1157, or ALL. (OPEN rows are WARN/FYI scoped to other ORCHs — 1119/1120/1131 — and unrelated to RSVP.) No ack required.

---

## 1. VERDICT: **FAIL** — P0: 0 · P1: 2 · P2: 0 · P3: 1 · P4: 2

Two P1 defects block this from PASS. Both are real and mechanically fixable; neither is a security or data-loss issue. The shared component, the honesty/ticketless constraints, the no-migration claim, the theme dial, and all 24 regression tests are correct and pass. The blockers are: (P1-A) a **dead, duplicate Going/Maybe/Can't decision row** rendered in the phone body, diverging from the binding mockup which explicitly hides it; and (P1-B) the **append-only CI gate is RED on this branch** (the `[TEST-MOD-APPROVED …]` token cites the stale ID `ORCH-1156` and is not in the HEAD commit body), contradicting the implementor's report claim of "4 passed / 0 failed."

Regression gate: SATISFIED — implementor happy-path (fails-on-revert independently re-run, below) + tester adversarial (different angle, on-branch, in-diff, fails-on-revert) both present.

---

## 2. SC-by-SC matrix

| SC | Verdict | Evidence |
|---|---|---|
| SC-1 (open, count>0: kicker+count+meter+cluster+chips+facts) | PASS (source+data) | `deriveMomentum(38,50)`→"12 spots left · filling up", meter 76%, cluster 3+`+35` (T-1 green). Real event `the-second-test` (going=4, cap=null) + `test-rsvp` (going=1, cap=1) confirm live data shape. Device-visual = Seth. |
| SC-2-Web desktop (two-col sticky panel) | CONDITIONAL (source) | `RsvpPublicBody` passes `stickyPanelNode` to `ParallaxCoverShell.stickyPanel` when `isDesktop`; `showMomentum={isDesktop}`. Sticky behavior is `ParallaxCoverShell`'s proven desktop shell. Runtime/viewport not driven this pass (no web export). |
| SC-2-phone (decision docked bottom) | FAIL | The floating dock (`styles.floatingDock`, absolute bottom + safeAreaBottom) IS the functional decision — correct. BUT the in-body `inlineMomentum` (`variant="inline"`) ALSO renders a full Going/Maybe/Can't row (see P1-A) → two decision rows, the body one a dead-tap. Mockup line 177 hides the in-body decision on phone. |
| SC-3 (Going/Maybe/Can't writes via existing path; resolves; no dead ends) | PARTIAL/FAIL | The DOCK decision wires `submit("going"/"maybe"/"not_going")` via the unchanged `onSubmit`/`public-submit-rsvp` path; state machine mirrors `resolveRsvpCta`; resolved branches render a toggle (no dead end). The DUPLICATE in-body decision row IS a dead end (no-op handlers) — P1-A. |
| SC-4 (full+waitlist: meter 100, "Join waitlist", NO number) | PASS (source) | T-4 + tester-adversarial: `deriveMomentum(50,50)`→"Full · waitlist open", meter 100, `assert(!/\d/.test(subLabel))`. Decision full+waitlist branch = Going("Join waitlist")+Can't, no Maybe (adversarial case 4). |
| SC-5 (manual approval → "Awaiting approval", disabled, no number) | PASS (source) | `pendingResolved` → single disabled `GoingButton` "Awaiting approval" (ClockGlyph), no number. |
| SC-6 (NO price/Reserve/cart/checkout on any RSVP surface) | PASS | Comment-stripped grep over `RsvpMomentumDecision.tsx` + `RsvpPublicBody.tsx` + the consumer RSVP region = 0 hits for checkout/priceAllIn/Reserve/Get tickets/cart/ticket-checkout. `TicketCartSheet` retained ONLY on the gated ticketed branch. I-PROPOSED-1157-RSVP-NO-CHECKOUT green. |
| SC-7 (goingCount=0 → "Be the first to RSVP", empty meter, NO cluster; incl. preview) | PASS | T-3 (`deriveMomentum(0,50)`→meter 0, shownAvatars 0). Preview passes `goingCount: 0`; consumer omits the unit when momentum unresolved. fails-on-revert proven. |
| SC-8 (consumer Going/**Maybe**/Can't + chips; momentum iff OQ-1) | PASS (source) | Consumer write enum + `handleRsvp` widened to `going\|not_going\|maybe`; `fetchRsvpMomentum` reads the anon view (OQ-1=a); `<RsvpMomentumDecision>` consumed. (Same P1-A duplicate-row caveat applies to the consumer inline unit.) |
| SC-9 (Android opaque fills) | PASS (source) | `opaqueCardFill = Platform.OS==='android' ? palette.page : palette.card` (6 uses) + `overflow:'hidden'` on every card; no Android shadow. ANDROID_GLASS_USES_OPAQUE_FALLBACK honored. Device-visual = Seth. |
| SC-10 (theme accent drives meter/cluster/going/dot; no layout change) | PASS | Zero hardcoded hex in the component (verified); meter/cluster/going/dot all read `palette.accent`/`accentWash`/`accentText`. I-PROPOSED-1157-RSVP-USES-BRAND-THEME-DIAL green. Light-vs-dark layout-invariance = Seth device-visual. |

**No migration / no edge function (SPEC §8):** PASS — `git diff origin/main...HEAD` touches no `supabase/migrations/**` or `supabase/functions/**`. The anon `business_public_events_view` already carries all 9 RSVP fields (verified live: `rsvp_going_count`, `rsvp_capacity`, `rsvp_waitlist_enabled`, `rsvp_approval_mode`, `rsvp_allow_plus_ones`, `rsvp_plus_ones_max`, `party_types`, `vibe_tags`, `event_type`).

---

## 3. Findings

### P1-A — Duplicate, dead Going/Maybe/Can't decision row in the phone body (dead-tap + binding-design divergence)
- **Evidence:** `packages/offering-rendering/RsvpMomentumDecision.tsx:563-574` renders `{decisionBlock}` **unconditionally** — there is no prop to suppress it. Both phone callers render the in-body momentum with `variant="inline"`, `showMomentum`, and **no-op handlers**:
  - `mingla-business/src/components/event/RsvpPublicBody.tsx:407-432` (`inlineMomentum`, `onGoing/onMaybe/onNotGoing => undefined`).
  - `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx:691-718` (`rsvpMomentumUnit`, same no-op handlers).
  The binding mockup `Mingla_Artifacts/design/ORCH-1157/RSVP_DIRECTION_C_MOMENTUM.html:177` sets `.decision-host.inbody { display:none; } /* live in the floating dock on phone */` — the in-body decision is explicitly hidden on phone; the decision lives ONLY in the floating dock.
- **Impact:** On phone (buyer-web, business iOS/Android, consumer iOS/Android), the body shows a SECOND Going/Maybe/Can't row in addition to the working floating dock. Its handlers are `() => undefined`. For a logged-in/contact-complete viewer all three render as active buttons that do nothing on tap; even for a logged-out guest the in-body "Can't go" is enabled (`disabled={submitting}` only) and is a no-op. This is Constitution rule 1 (no dead taps) and a visible divergence from the approved Direction-C layout (the count/meter/cluster should lead the body; the decision should appear once, docked).
- **Required fix:** Add a `showDecision`/`decisionOnly` control to `RsvpMomentumDecision` (or split the momentum unit from the decision) so the `inline` momentum variant renders kicker+chips+momentum WITHOUT the decision block, and the `floating-dock`/`sticky-panel` variant renders the decision. Wire the phone callers to render momentum-only inline. This restores 1:1 mockup parity.
- **Retest:** render the phone RSVP page; assert exactly ONE Going/Maybe/Can't row exists and it is inside the floating dock; assert the in-body momentum renders no decision buttons. Add a render/structure guard.

### P1-B — Append-only CI gate is RED on this branch; token cites stale ID + missing from HEAD commit body
- **Evidence:** `node .github/scripts/test-append-only-check.js` at HEAD `59ece6a11` → **3 passed, 1 failed**: `RsvpPublicBody.maybeCta.orch1150r2.test.ts` has 24 deleted lines and the override token is NOT in the latest commit body. The token actually present is `[TEST-MOD-APPROVED ORCH-1156]` (stale pre-renumber ID) and it lives in commit `48a8595a5`, not HEAD (`59ece6a11`, the renumber commit, has no token). The gate (`test-append-only-check.js:18`) checks the HEAD commit body only.
- **Impact:** The implementation report §9 claims "node .github/scripts/test-append-only-check.js → 4 passed, 0 failed (the `[TEST-MOD-APPROVED ORCH-1157]` token is recognized)" — FALSE at the current HEAD on both counts (count and token-ID). The CLOSE/merge will fail this required gate as the branch stands. (The 24-line deletion itself is legitimate test-rework — re-aiming assertions about the now-removed inline lucide CTA buttons to the new shared-unit delegation.)
- **Required fix:** put `[TEST-MOD-APPROVED ORCH-1157]` in the HEAD commit body (or the squash-merge commit body at CLOSE) — i.e., amend the renumber commit body, or ensure the orchestrator's squash body carries the ORCH-1157 token. Re-run the gate to green.
- **Retest:** `node .github/scripts/test-append-only-check.js` → 4 passed / 0 failed.

### P3-1 — Plus-ones stepper buttons are 36×36 (below the 44pt touch target)
- **Evidence:** `RsvpMomentumDecision.tsx:651-652` `stepBtn { width:36, height:36 }`.
- **Impact:** the −/+ extras stepper taps are below the 44pt a11y minimum; the main decision buttons are fine (full-width × ~48pt). Minor.
- **Required fix:** bump `stepBtn` to ≥44×44 or add hitSlop.

### P4-1 (praise) — Honesty model is exemplary
The pure `rsvpMomentum.ts` is the single owner of the honest derivation; rule-9 (no fabricated data) is enforced at the source of truth (goingCount=0 → no cluster, no count; full → state copy never a waitlist number; unlimited → "Open invite" not fake scarcity). Faceless SVG glyph cluster, zero `<Image>`/uri, no name/maybeCount/waitlistCount props. Clean.

### P4-2 (praise) — Ticketless separation is clean
RSVP-render code is provably free of any checkout/price/cart affordance; the consumer ticketed path stays byte-identical behind the `isRsvp ? … : …` gate (ORCH-1150 deck-off-EBES contract preserved; its test still 3/3 green).

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out HEAD `59ece6a11`. The implementor (report §9) claims: delete the `goingCount === 0` guard in `rsvpMomentum.ts` → T-3 fails.
- **Re-run by tester (true line-deletion of the `if (safeGoing === 0) { … }` early-return block):**
  - After deletion: `deno test … orch_1157_rsvp_momentum.test.ts` → **13 passed / 1 failed**, the failing test being `T-3: goingCount=0 → 'Be the first to RSVP', empty meter, NO cluster` (at `:67:6`).
  - After restore: **14 passed / 0 failed.**
- **Verdict:** the implementor's fails-on-revert claim is TRUE and independently reproduced at `59ece6a11`. File restored clean (git status clean).

Implementor happy-path suites independently re-run green at HEAD:
- `packages/offering-rendering/__tests__/orch_1157_rsvp_momentum.test.ts` → 14/14 (Deno).
- `app-mobile/src/services/__tests__/orch_1157_rsvp_consumer.test.ts` → 5/5 (Deno).
- `mingla-business/.../RsvpPublicBody.maybeCta.orch1150r2.test.ts` + `offeringCta.orch1117.test.ts` → 17/17 (jest).
- `app-mobile/.../rsvpDeckService.orch1150.test.ts` → 3/3 (Deno).

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `packages/offering-rendering/__tests__/orch_1157_rsvp_momentum_adversarial.test.ts` (NEW, append-only, in-diff).
- **Angle (different from implementor's checkout/anon focus):** honesty + state-machine EDGES — (1) no derived sub-line leaks a numeric headcount except the capacity-derived "N spots left" line; (2) full state = "Full · waitlist open" + meter 100 + zero digits; (3) meter clamp / degenerate-input guard; (4) the full+waitlist + hard-full DECISION branches must NOT include the Maybe button (dead-end-promise guard); (5) kicker copy locked to "YOU'RE INVITED" with title-inherited color + accent dot.
- **Result:** 5 passed / 0 failed.
- **fails-on-revert verified at `59ece6a11`:** true line-deletion of the `spotsLeft === 0` "Full · waitlist open" branch in `rsvpMomentum.ts` → case (2) FAILS (4 passed / 1 failed); restore → 5/5. File restored clean.
- **In closing diff:** both the implementor happy-path tests AND this adversarial test appear in `git diff origin/main...HEAD --name-only` (the adversarial file is staged/added in the worktree; must be committed to the branch before the closing PR).

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | **FAIL** | P1-A: the in-body `inline` decision row renders active-looking Going/Maybe/Can't buttons with no-op handlers. |
| 2 | One owner per truth | PASS | `rsvpMomentum.ts` is the single owner of the momentum derivation; `resolveRsvpCta` stays the CTA-state owner. |
| 3 | No silent failures | PASS | `submit` catch maps codes to inline messages (rsvp_full/not_open/contact/phone), never swallows. |
| 4 | One query key per entity | PASS | consumer `["rsvpMomentum", eventId]`; invalidated after own-submit. |
| 5 | Server state server-side | PASS | momentum via React Query (`useQuery`), no Zustand for server data. |
| 6 | Logout clears everything | N/A | no new persisted/auth state. |
| 7 | Label `[TRANSITIONAL]` | N/A | none added. |
| 8 | Subtract before adding | PASS | inline lucide CTA buttons + `ctaBtn` style removed from RsvpPublicBody, replaced by the shared unit. |
| 9 | No fabricated data | PASS | goingCount=0 → no cluster/count; full → state copy, no waitlist number; unlimited → "Open invite"; cluster is faceless glyph-only, no names/photos. |
| 10 | Currency-aware | N/A | RSVP is ticketless (no money). |
| 11 | One auth instance | PASS (N/A) | buyer-web/preview anon-tolerant; consumer uses existing JWT path; no new auth instance. |
| 12 | Validate at right time | PASS | A4-NEW contact gate (name+email+phone) applied to both Going and Maybe before submit. |
| 13 | Exclusion consistency | N/A | no list-exclusion logic. |
| 14 | Persisted-state startup | N/A | no new hydration-gated state. |

---

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Consumer iOS | BLOCKED (source PASS w/ P1-A) | No sim run this pass — worktree bracket path breaks Metro; no RN test renderer in the worktree to render the unit headlessly; web export deemed too flaky for the marginal gain given the verdict is already FAIL on source. Source: shared unit consumed, Maybe added, momentum via anon view; subject to P1-A. Device-visual = Seth. |
| Consumer Android | BLOCKED (source PASS) | Opaque fills via shared unit; same P1-A. Device-visual = Seth. |
| Buyer/anon Web | BLOCKED (source PASS w/ P1-A, P1-B) | Desktop sticky / phone dock wired; P1-A duplicate body decision; viewport behavior not driven (no web export). Device-visual = Seth. |
| Business iOS | BLOCKED (source PASS) | Auto via shared `RsvpPublicBody`; same P1-A. |
| Business Android | BLOCKED (source PASS) | Auto; opaque; same P1-A. |
| Business Web preview | PASS (source) | `goingCount: 0` + `partyTypes` from draft → honest zero-state (SC-7). |
| Admin Web | N/A | no RSVP public page. |
| Physical iPhone (HITL) | NOT RUN | Verdict is FAIL on source-provable defects (P1-A dead-tap, P1-B red gate) — routing to REWORK before consuming Seth's device time. Device-visual passes (count/meter/cluster/theme-dial/Android-opaque/duplicate-row visual) are deferred to the RETEST after rework. |

**Why no live-fire this pass (honest):** the two blockers are provable from source + the binding mockup + the live CI gate without a render. The worktree bracket path breaks Metro; a bracket-free checkout + buyer-web web export is heavy/flaky and would not change a FAIL. Per the skill's confidence ladder, source-only is sufficient for a FAIL (it is forbidden only for PASS). The full per-surface live-fire (5 surfaces × 5 states + light/dark theme dial) is the RETEST mandate once P1-A/P1-B are fixed.

---

## 8. Discoveries for Orchestrator

- **DISC-1 (informational):** the implementation report §9 overstated the append-only gate result ("4 passed / 0 failed", token `[TEST-MOD-APPROVED ORCH-1157]`). Actual at HEAD: 3 passed / 1 failed, token is the stale `ORCH-1156` and not in the HEAD commit body (P1-B). The implementor likely ran the gate before the renumber commit moved HEAD off the token-bearing commit.
- **DISC-2 (pre-existing, not 1157):** `mingla-business` default jest can't resolve `@mingla/*` for the `publicEventsService.*` suites (report D-2); cross-package tsc noise (`Cannot find module 'react'`) affects every package file identically on baseline. Not caused by 1157.
- **DISC-3:** the meter `Math.min(100,…)` clamp in `rsvpMomentum.ts` is effectively unreachable (going>capacity always hits the `spotsLeft===0` full branch first) — harmless defensive code, noted so a future refactor doesn't think it's load-bearing.
- **DISC-4 (parity reminder, not a defect):** per the parity memory rule, all-surface incl. consumer-app + business-app OTA is a CLOSE gate — not yet done (implementor §13 confirms nothing deployed).

---

## 9. Routing

**FAIL → REWORK (mingla-implementor, this worktree).** Two P1s to fix:
- P1-A: suppress the in-body `inline` decision so the phone decision renders ONCE (in the floating dock), matching mockup line 177 (`.decision-host.inbody { display:none }`).
- P1-B: place `[TEST-MOD-APPROVED ORCH-1157]` in the HEAD/squash commit body so the append-only gate goes green; correct the report's gate claim.
- P3-1 (optional this cycle): bump the plus-ones stepper buttons to ≥44pt.

After rework → RETEST (this skill): per-surface live-fire of SC-1…SC-10 across open / few-spots / full+waitlist / you're-going / pending on all 5 surfaces + the preview zero-state + the light/dark theme dial, with the duplicate-row defect re-checked on phone.
