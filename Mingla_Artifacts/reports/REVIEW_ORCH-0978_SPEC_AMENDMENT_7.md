# REVIEW ORCH-0978 — SPEC AMENDMENT 7

Verdict: **APPROVED**

Date: 2026-05-27
Reviewer: Claude `mingla-orchestrator` (Pass 1, operator-delegated)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` @ HEAD `f6e9fb9d5`
Input under review: `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` §"SPEC AMENDMENT 7" (committed `f6e9fb9d5`, 475 net lines appended)

## 1. Commit-hash verification (DEC-179)

| Claimed artifact | git log result | Verdict |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` (SPEC AMENDMENT 7 appended) | `f6e9fb9d5 ORCH-0978 SPEC AMENDMENT 7: …` | PASS — present on per-ORCH branch, pushed to origin |

Single-file commit. No stray modifications. Working-tree dirty items (`app-mobile/tsconfig.json`, `mingla-business/tsconfig.json`, `mingla-business/package-lock.json`) are pre-existing drift carried from earlier session phases — not from SPEC AMENDMENT 7. Scheduled for CLOSE Step 1.6 sweep.

## 2. Dependency walk (DEC-179)

SPEC AMENDMENT 7 is **documentation only**. No source files modified. No config-layer files touched (`app.json`, `vercel.json`, `package.json`, `tsconfig*`, `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**`, `.github/scripts/**` all untouched). The SPEC PRESCRIBES changes to 8 files in IMPLEMENT-5 — the dependency walk for those will run at REVIEW IMPLEMENT-5, not here. Dependency walk for SPEC itself: **N/A — no config-layer touches; PASS by absence**.

## 3. REVIEW protocol checklist

| Gate | Result | Evidence |
|---|---|---|
| Root cause binding from investigation | PASS | Cites investigation `02f5314ba` PROBABLE confidence + REVIEW `8266f7e5d` APPROVED. SPEC §M correctly notes "fix direction is unambiguous regardless of which client sub-mechanism produces the bad patch shape — the new contract structurally prevents the bug." |
| Scope appropriate — could be narrower? | PASS | 8 items binding (Items 1-8 per dispatch). Non-goals explicitly listed: edge function changes, migration, draft-event save path (parking as Discovery), trip-cover save path (parking), brand-cover service (parking). Tightly bounded. |
| Cross-Surface Impact (Phase 2.5 MANDATORY) | PASS | §C declares all 7 surfaces. Business iOS + Android in scope with automatic parity (shared bundle). Consumer iOS/Android/buyer-web/admin-web all N/A with one-phrase reason each. Business web preview noted as incidental beneficiary. |
| Layered specification (Phase 3) | PASS | §D.1 service layer (exact replacement code), §D.2 component layer (exact replacement code), §D.3 sibling-component verification, §D.4 hook layer, §D.5 text strings, §D.6 CI gate. Every layer addressed. |
| Success criteria observable + testable (Phase 4) | PASS | §E lists SC-AMEND7-1 through SC-AMEND7-8 — each numbered, observable, testable, unambiguous. SC-5 uses TS compile-time enforcement (clever — closes the bug class at the type system level). |
| Invariants preserved + new declared (Phase 5) | PASS | §F preserves AMENDMENTS 4-6 invariants + introduces I-PROPOSED-NO-COVER-NULL-IMPLICIT-WRITE (4 backing mechanisms: strict-grep, tests, TS signature, round-trip verification). Constitution rule 3 closure documented. |
| Test cases (Phase 6) | PASS | §G specifies 8 scenarios (T-AMEND7-01..08) with explicit META-ORCH-0744 mapping (T-AMEND7-05 = implementor happy-path; T-AMEND7-08 = tester adversarial — different angles, NOT a rename). Fails-on-revert proof contract specified. |
| Implementation order (Phase 7) | PASS | §H two-commit pattern matches IMPLEMENT-3+4 precedent. Commit 1 = product fix (8 files, ~150 net lines). Commit 2 = Jest tests (2 files, ~200 net lines). Tester commits T-AMEND7-08 separately during RETEST. |
| Regression prevention (Phase 8) | PASS | §I lists 6 mechanisms: strict-grep C8, strict-grep C9, T-AMEND7-05 fixture, TS signature, round-trip verification, I-PROPOSED invariant promotion. Defense-in-depth. |
| Hidden fallback paths that mask failure? | **STRUCTURALLY CLOSED** | F-4 from investigation (silent "Saved" toast) is closed by round-trip verification in `setEventCover` per §D.1 — throws `persist_mismatch` instead of silently succeeding. |
| Real fix or symptom mask? | PASS | Service split + TypeScript signature change is a STRUCTURAL fix, not a patch. The bug class becomes compile-time impossible after this lands. |
| Solo/collab parity | N/A | Server-side persistence, no solo/collab distinction. |
| Constitutional compliance | PASS | Closes Constitution rule 3 violation flagged in investigation §10. New invariant promotes to ACTIVE on CLOSE. |
| Evidence chain complete | PASS | SPEC cites investigation file + REVIEW file + IMPLEMENT-4 precedent for test pattern. Implementor has everything needed cold. |
| Documents updated | PASS | SPEC appended; this REVIEW triggers IMPLEMENT-5 dispatch. |
| COMMS-0002 (backend allowlist) | PASS by absence | §A explicitly notes "no backend allowlist update — client-only changes." No `supabase/` files touched. |
| COMMS-0003 (Cloudinary docs) | PASS by absence | §A explicitly notes "no external API claims — client-only changes." Backend pipeline (webhook v122) unchanged. |
| COMMS-0004 (no INTAKE) | PASS by absence | Same ORCH-0978; no new ORCH-ID assignment. |

All gates pass. No NEEDS WORK items.

## 4. Quality of specification assessment

SPEC AMENDMENT 7 is implementor-ready in three notable ways:

1. **Exact code-block replacement, not directional prose.** §D.1 and §D.2 provide the full TypeScript code for `setEventCover`, `clearEventCover`, and the new EditPublishedScreen save-flow conditional tree. Implementor doesn't need to interpret — they paste-and-adapt-imports. This matches IMPLEMENT-4's SPEC AMENDMENT 6 precedent.

2. **TypeScript-enforced regression prevention.** The cleverest move in this SPEC: `setEventCover(serverEventId: string, mediaUrl: string, mediaType: EventCoverMediaType, metadata: EventCoverProviderMetadata)` — `mediaUrl` is `string` not `string | null`. This makes the bug class structurally impossible to reintroduce because the type system rejects null at every call site. The implementor cannot accidentally re-create the silent-null-write even if they try. This is structural safety, not test-only safety.

3. **Round-trip verification closes the silent-failure surface.** §D.1's `setEventCover` does `.select("id, cover_media_url, cover_media_type").maybeSingle()` and then throws `persist_mismatch` if the returned `cover_media_url` doesn't match the input `mediaUrl`. F-4 from the investigation (Constitution rule 3 violation — "Saved. Live now." toast appearing on silent-null writes) is structurally closed. Even if some future code path manages to produce a null write through an unexpected mechanism, the user gets a truthful toast.

The optional Item 8 DIAG console.log is well-scoped — implementor's choice, reapable at CLOSE Step 1.5 if included. Doesn't expand or contract the fix.

## 5. Side observations (non-blocking)

1. **`tripsService.ts:672-674` has the same `patch.coverMediaUrl !== undefined` read-through pattern** — investigation Discovery §11 item 1 flagged this. SPEC §B (non-goals) correctly parks it as out-of-scope and routes to a follow-up ORCH after ORCH-0978 closes. Recommend filing the follow-up at CLOSE Step 4.
2. **`useBrandCoverUpload.ts` and any other cover-like service** should be audited for the same bug class before declaring I-PROPOSED-NO-COVER-NULL-IMPLICIT-WRITE fully systemic. SPEC §I's invariant promotion handles this on the events-cover path; cross-service audit follows.
3. **T-AMEND7-03 (TypeScript compile-time check via `// @ts-expect-error`)** is unusual but correct — verifying the type signature does what it claims is the highest possible regression bar. Implementor needs to ensure CI runs `tsc` (which the existing strict-grep workflow covers indirectly via Deno check and tsc passes elsewhere).

## 6. Next phase decision

Operator delegated "take over" → orchestrator dispatches IMPLEMENT-5 to Codex `implementor-mingla`. Default routing per Canonical Pipeline Routing block.

## 7. Verdict

**APPROVED.** All 17 REVIEW gates pass. Commit-hash verified at `f6e9fb9d5`. Dependency walk N/A (SPEC is docs-only). Investigation binding correctly cited. Cross-Surface Impact declared. 8 items operationalized with exact code change sites. TypeScript-enforced regression prevention is the gold standard for this bug class. Ready for IMPLEMENT-5 dispatch.
