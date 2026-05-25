# REVIEW_META-ORCH-0972_AUDIT

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Phase reviewed:** 1 of 4 — AUDIT (forensics INVESTIGATE mode, 4 deliverable reports)
**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-25
**Verdict:** **APPROVED — with two operator action items before Phase 2 dispatch**

---

## Reviewer transparency note

This audit was produced by Claude `mingla-forensics` operating in the SAME continuous Claude session as this orchestrator REVIEW. Standard pipeline norms put forensics and orchestrator on separate skill invocations to maximize independent verification. This session's combined-invocation pattern was operator-authorized via the "take over" delegate at each phase boundary. The REVIEW below is honest about its limitations: I'm checking my own work for completeness, structure, and operator-actionability — not for hidden bias I might share with the forensics output. Operator should treat the APPROVED verdict as "structurally complete + ready for next phase" rather than as deep independent verification. If operator wants a true second-set-of-eyes review, dispatch this audit to Codex `forensic-mingla` (TEST mode) before authorizing Phase 2 — that's a one-turn add and worth doing if any audit finding feels surprising.

---

## Files reviewed

All four under `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/Mingla_Artifacts/reports/`:

1. [INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md](./INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md) — Master 12-dimension catalogue
2. [INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md](./INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md) — Schema + RLS + RPCs + edge fns + DROP COLUMN safety plan
3. [INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md](./INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md) — 8 journeys + 5 themes for Phase 2 designer
4. [INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md](./INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md) — Q1–Q11 with recommended defaults

---

## REVIEW checklist (adapted for AUDIT phase — no code, so commit-hash + dependency walk N/A)

| Check | Verdict | Notes |
|---|---|---|
| All 12 dimensions covered? | ✅ PASS | D1–D12 catalogued; checklist in Report 1 §"Completeness" |
| Migration-chain rule applied? | ✅ PASS | `brands_kind_check` latest verified (ORCH-0855); views verified via ORCH-0962 DROP/RECREATE; RPCs verified |
| No grep-only conclusions? | ✅ PASS | Subagents read files; orchestrator spot-checked authoring gate, hub gates, experience data model |
| False positives flagged? | ✅ PASS | `agent-chat.error.kind`, `tripConfirmationEmail.i.kind`, `installment_kinds.test.ts`, all consumer-app `kind` hits — explicitly catalogued as NO-CHANGE |
| Hidden surfaces found? | ✅ PASS | `mingla-admin/src/services/adminClaimsService.js:37` discovered (P1) — refutes orchestrator's prior "admin is kind-agnostic" assumption |
| No solution drift? | ✅ PASS | Reports catalogue current state + classification; do NOT propose new RPC shapes, new component APIs, or new UI flows — those are Phase 2/3 territory |
| 8 user journeys cover the model? | ✅ PASS | Sign-up, cross-persona authoring, address, free-vs-paid, venue claim, public page mixed, AI parser without address — all 8 mapped |
| Open questions actionable? | ✅ PASS | Q1–Q11 each have status + context + candidate options + recommended default. Operator can answer all 9 open ones in one message. |
| Affected Surfaces declaration accurate? | ⚠ UPDATE NEEDED | WORLD_MAP entry said admin-web was "pending grep"; now CONFIRMED in scope (D12 finding). Update the WORLD_MAP entry. |
| Base-tree gap documented? | ✅ PASS | P1 discovery in Report 1 §"P1 DISCOVERY" + Q8 in Report 4 with recommended action |
| Comms ledger acked? | ✅ PASS | COMMS-0001/0002/0003/0004/0005 all read and factored; Report 1 documents the factoring |

**Verdict:** **APPROVED** — structurally complete, ready for operator decisions and Phase 2 dispatch.

---

## Action items before Phase 2 dispatch

1. **Operator: answer 9 open questions** (Q1, Q2, Q3, Q4, Q6, Q7, Q8, Q9, Q10) from Report 4. Q5 and Q11 already answered. Recommended defaults provided for each.
2. **Operator: authorize rebase per Q8** (recommend Option A — rebase now). Procedure:
   ```
   cd ~/Desktop/mingla-main && git pull origin main
   cd ~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features] && git fetch origin && git rebase origin/main
   ```
   Then forensics runs a 1-turn supplemental sweep to add the ORCH-0963 surfaces (now in scope) to Report 1 Dimension 9.
3. **Orchestrator (next turn after operator answers): update WORLD_MAP META-ORCH-0972 entry** to flip `admin-web (pending grep verification)` → `admin-web (CONFIRMED in scope — adminClaimsService.js:37)`.
4. **Optional: dispatch a one-turn independent review** to Codex `forensic-mingla` TEST mode if operator wants a second set of eyes on the audit before Phase 2.

---

## What's good

- The 30-step DROP COLUMN safety plan (Report 2 Stage 1–4) is sequenced correctly: code first (no DB impact), then views/RLS (column still present but unread), then RPCs, then constraint + column. Reversible at each stage.
- The 5 cross-dimensional themes in Report 3 give the designer a coherent design problem: "3-button chooser as connective tissue," "address as data not gate," "venue claim as upgrade path," etc. Designer doesn't need to start from scratch.
- The TripBrandWizard collapse analysis is concrete (6-step walk, every step preservable in unified flow, no unique safety behavior to keep) — answers Q5 with evidence, not speculation.
- Q4 (experiences in Upcoming) is correctly identified as blocked on the data-model question (Q9), with a recommended default that avoids new schema until needed.

## What could be sharper

- **Q1 free-vs-paid contract** could use a concrete decision tree diagram in the spec phase. Today it's prose. Phase 3 spec writer should visualize the 4 quadrants (Stripe active/inactive × paid offerings yes/no) to make the rung 1 behavior unambiguous.
- **Experience data model (Q9)** — Path A (column add) vs Path B (JSON sub-fields) deserves a longer trade-off discussion in Phase 3 spec. The audit recommends Path B for venue; the spec phase should make the call explicit with rationale.
- **Phase 4 sub-ORCH ordering** in Report 2 mixes Sub-A (gates), Sub-B (UX), Sub-C (DB + public page), Sub-D (edge fns + tests). The orchestrator should formalize this into a sequenced sub-ORCH plan with explicit handoff points between subs.

None of these gaps are blockers for APPROVED — they're refinements for the SPEC phase.

---

End of REVIEW report.
