# REVIEW ORCH-0978 — Investigation: save-cover persistence

Verdict: **APPROVED**

Date: 2026-05-27
Reviewer: Claude `mingla-orchestrator` (Pass 1, operator-delegated)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` @ HEAD `02f5314ba`
Input under review: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_SAVE_COVER_PERSISTENCE.md` (committed `02f5314ba`)

## 1. Commit-hash verification (DEC-179)

| Claimed artifact | git log result | Verdict |
|---|---|---|
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_SAVE_COVER_PERSISTENCE.md` | `02f5314ba Investigate ORCH-0978 save-cover persistence …` | PASS — present on per-ORCH branch and pushed to origin |
| `Mingla_Artifacts/reports/qa-orch-0978-runtime/forensics-save-persistence-2026-05-27/00-sim-current.png` | `02f5314ba …` | PASS |
| `Mingla_Artifacts/reports/qa-orch-0978-runtime/forensics-save-persistence-2026-05-27/01-after-deeplink.png` | `02f5314ba …` | PASS |
| `Mingla_Artifacts/reports/qa-orch-0978-runtime/forensics-save-persistence-2026-05-27/02-after-localhost-link.png` | `02f5314ba …` | PASS |

`git status --porcelain` shows only pre-existing untracked artifact reports + tsconfig drift from earlier phases. No uncommitted product code.

## 2. Dependency walk (DEC-179)

Investigation is **documentation-only**. No source files modified. No `app.json`, `vercel.json`, `package.json`, `tsconfig*`, `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**`, or `.github/scripts/**` touched. Dependency walk: **N/A — no config-layer touches; PASS by absence**.

## 3. REVIEW protocol checklist

| Gate | Result | Evidence |
|---|---|---|
| Root cause proven or plausible | **PROBABLE** (acceptable per investigation §12) | Five-layer cross-check completes for the service-side bug (F-1 + F-3 produce the exact DB shape observed). Upstream client sub-failure within F-1's causal chain step (3) is the named uncertainty; investigation §8 documents the live-fire DIAG upgrade path. |
| Scope appropriate — could be narrower? | PASS | 5 findings tightly scoped (1 root + 2 contributing + 2 hidden + 1 carry-over). Blast radius mapped to business iOS/Android published-event covers. Out-of-scope items explicitly noted (consumer + admin not affected). |
| Hidden fallback paths that mask failure? | **CALLED OUT** | F-4 names the "Saved. Live now." silent-success toast as a hidden flaw. Investigation links this to ORCH-0980 [silent save failure bug class] in Discoveries §11 item 1. |
| Stale cache paths serving old data? | RULED OUT | H1 ruled out via Metro log + 48-second video-ready→save gap. React Query invalidation considered and accounted for. |
| Response shape truthful in ALL states? | **NO** — bug filed | F-4 documents that the save flow reports success even when DB write was an all-NULL silent write. Filed as 🟡 hidden flaw with hardening recommendation in §9. |
| Real fix or symptom mask? | PASS | §9 Fix Strategy proposes structural fixes (split service into setEventCover/clearEventCover, tighten cover-save guard) rather than masking the symptom. Primary + secondary + tertiary fix layers separated. |
| Solo/collab parity checked? | N/A | Server-side persistence path; no solo/collab distinction. |
| Constitutional compliance verified | **FLAGGED** | Investigation §10 explicitly flags Constitution rule 3 (no silent failures) violation via F-1+F-3+F-4 chain. Production-ready check: FAIL — investigation correctly states current state cannot ship as ORCH-0978 close. |
| Evidence chain complete | PASS | DB row captures (cover_media_url=null + 6 sibling nulls), Metro log capture (Seth's physical iPhone test 2026-05-27 lines 46-50 at `/private/tmp/.../tasks/bijrq5lxw.output`), source file + line citations across 13 files in the investigation manifest. |
| Documents updated | PASS | Investigation written; this REVIEW triggers SPEC AMENDMENT 7 next phase. |
| Cloudinary docs URLs (COMMS-0003) | N/A | Investigation §13 explicitly notes no Cloudinary claims — backend pipeline already proven. Compliance by absence. |

All gates pass. No NEEDS WORK items.

## 4. Quality of evidence assessment

The investigation reaches PROBABLE confidence through a structurally watertight argument:

- **DB signature is diagnostic.** All 7 `cover_media_*` columns NULL in unison + `updated_at` advanced. This shape can ONLY be produced by `eventCoverMediaService.ts:198-204` being called with `mediaUrl=null`, because the file's metadata columns are coupled to URL truthiness via `mediaUrl === null ? null : ...` ternaries. I independently verified those lines verbatim during this REVIEW pass.
- **Upstream caller behavior is documented at source level.** `EditPublishedScreen.tsx:617-637` invokes the service when ANY cover field is in the patch (`mediaPatchPresent`) but uses read-through `patch.coverMediaUrl !== undefined ? patch.coverMediaUrl : liveEvent.coverMediaUrl` — which returns null when patch lacks the URL and liveEvent's URL is null.
- **7 of 8 dispatch hypotheses ruled out** by source + DB + Metro log triangulation. The remaining hypothesis (H4) is the proposed root cause.
- **Named blocker for PROVEN upgrade is concrete and actionable.** The sim's dev-client URL cache issue is well-described with a workaround (uninstall+reinstall via `simctl`). The one-line DIAG console.log + Metro capture path is the proposed mechanism.

This is the same quality bar as the prior `INVESTIGATION_ORCH-0978_PROCESSED_DURATION_INVALID.md` (which reached PROVEN by capturing `provider_payload`). The reason this one is PROBABLE rather than PROVEN is purely an environmental constraint (sim URL cache), not a methodology gap. The fix direction is unchanged regardless of which client-side sub-mechanism produces the bad patch shape — F-1 + F-3 + F-4 all need addressing.

## 5. Side observations (non-blocking)

1. **F-1's causal chain step (3) lists three candidate sub-mechanisms** (re-render race, React Query refetch contamination, CoverPicker initial-props-sync useEffect side effect). The fix tightens the boundary regardless of which is exact — so live-fire upgrade can happen in parallel with implementation rather than blocking it.
2. **F-3's "coupled metadata-clearing" pattern is a recurring shape** worth scanning for elsewhere (e.g., brand cover, profile picture, trip cover) before ORCH-0980 [silent save failure bug class] scope is finalized. Investigation §11 item 1 calls this out.
3. **F-5 (missing trimStartMs/trimEndMs in upload-intent hook call)** is technically correct today because of how the backend defaults work + SPEC AMENDMENT 6's trim-fallback. But it's load-bearing-by-accident — worth tightening in the same commit as the F-1 fix to remove the latent regression risk.

## 6. Next phase decision

Operator delegated "take over" → orchestrator owns the next step. Two paths:
- **Path A:** Write SPEC AMENDMENT 7 directly (orchestrator authoring spec, as we did for SPEC AMENDMENT 6 in ORCH-0978).
- **Path B:** Dispatch back to forensics for the SPEC.

Path A is recommended for consistency with the AMENDMENT 6 precedent + operator's revealed preference for in-session execution. The investigation §9 already contains the fix strategy — SPEC AMENDMENT 7 just operationalizes it with code change sites, success criteria, test contracts, and the META-ORCH-0744 two-commit landing pattern.

## 7. Verdict

**APPROVED.** All 11 REVIEW gates pass (with appropriate PROBABLE-confidence acceptance per investigation §12 + named blocker). Commit-hash verified. Dependency walk N/A. Constitution rule 3 violation correctly flagged. Investigation is the gold standard for this kind of layer-stacked client bug. SPEC AMENDMENT 7 follows in the next orchestrator turn.
