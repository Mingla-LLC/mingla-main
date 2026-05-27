# REVIEW ORCH-0978 — Investigation: processed_duration_invalid

Verdict: **APPROVED**

Date: 2026-05-27
Reviewer: Claude `mingla-orchestrator` (Pass 1, operator-delegated)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` @ HEAD `1ec24f0fc`
Input under review: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_PROCESSED_DURATION_INVALID.md` (committed `1ec24f0fc`)

## 1. Commit-hash verification

| Claimed artifact | git log result | Verdict |
|---|---|---|
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_PROCESSED_DURATION_INVALID.md` | `1ec24f0fc Investigate ORCH-0978 processed_duration_invalid …` | PASS — present on per-ORCH branch, pushed to origin |

`git status --porcelain` shows only pre-existing untracked artifact reports + tsconfig drift carried from prior phases. No uncommitted product code. No stray modifications.

## 2. Dependency walk

Investigation is **documentation-only**. No source files touched. No `app.json`, `vercel.json`, `package.json`, `tsconfig*`, `metro.config.*`, `babel.config.*`, `next.config.*`, `.github/workflows/**`, or `.github/scripts/**` modified. Dependency walk: **N/A — no config-layer touches; PASS by absence**.

## 3. REVIEW protocol checklist

| Gate | Result | Evidence |
|---|---|---|
| Root cause proven (not just plausible) | PASS | Captured raw Cloudinary payload from `event_cover_video_jobs.provider_payload` shows eager block has NO `duration` field. Two alternative hypotheses (duration > cap, duration in wrong shape) ruled out by the same payload. |
| Scope appropriate — could be narrower? | PASS | Single root cause, four findings (1 root + 1 contributing + 3 hidden flaws), explicit out-of-scope §11 lists six items NOT in scope (SDK adoption, notification_url switch, etc.) |
| Hidden fallback paths that mask failure? | PASS | F-3 covers the `firstEager` silent-`{}` case as a hidden flaw; will not mask future bugs |
| Stale cache paths serving old data? | N/A | Server-side webhook; no client cache surface affected |
| Response shape truthful in ALL states? | PASS | Investigation §5 F-2 calls out the misleading single-code conflation across NaN/<=0/>cap as a contributing factor; fix direction includes splitting into three codes |
| Real fix or symptom mask? | PASS | Fix direction (job-row trim fallback) addresses the root cause structurally; eager `du_` clause + error-code split close the bug class, not just this instance |
| Solo/collab parity checked? | N/A | Server-side path; no solo/collab distinction |
| Constitutional compliance | PASS | No silent failures (F-3 calls out the hidden flaw); one owner per truth preserved; no data fabrication |
| Evidence chain complete | PASS | Five-layer cross-check explicitly tabled (docs/schema/code/runtime/data); all five agree; provider_payload captured verbatim in §4 |
| Documents updated | PASS | Investigation report written; SPEC AMENDMENT 6 follows in same orchestrator pass |
| Cloudinary docs URLs cited inline (COMMS-0003) | PASS | Six Cloudinary URLs cited in §3 (Docs row) and §13; every external-API claim is cited |
| Production-ready or flagged | PASS | Investigation flags 100% of cover-video uploads currently blocked; SPEC AMENDMENT 6 is the unblock path |

All gates pass. No NEEDS WORK items.

## 4. Quality of evidence (what makes this PROVEN)

The investigation upgraded its confidence from `probable` to `proven` by leveraging an existing observability surface (`event_cover_video_jobs.provider_payload`) the webhook stores on the failed-write path at `event-cover-video-webhook/index.ts:187`. This avoided needing to deploy a diagnostic webhook v122 just to capture the raw payload. The captured payload is verbatim in §4 of the investigation and matches Cloudinary's documented eager notification shape (URL + dimensions + bytes + format + transformation; no duration/video/audio metadata).

This is the kind of "always log the inbound payload" hygiene that pays off on every layer-stacked bug. The investigation's Discoveries-for-Orchestrator §10 item 2 calls this out as worth replicating to other webhook-receiving tables (Stripe webhook events, OneSignal callbacks). Worth registering as a follow-up if time allows; not blocking ORCH-0978.

## 5. Side-discoveries to track

- **F-3 (`firstEager` silent `{}` fallback)** — hidden flaw, not blocking ORCH-0978. Worth a follow-up ORCH if Cloudinary ever wires a non-eager `notification_url` alongside.
- **F-4 (`<1000 ? *1000 : raw` heuristic ambiguity at duration=0)** — hidden flaw; the AMENDMENT 6 fallback shape sidesteps it because the new helper guards `raw > 0` before applying the multiplier. Closing as covered.
- **F-6 (`media_metadata: true` opt-in)** — observation, not a defect. Optional defense-in-depth; explicitly out of scope for AMENDMENT 6 to keep the amendment tight.
- **Bug-class discovery (Discoveries §10 item 1)** — Stripe + OneSignal webhooks may have similar `Number(undefined) → NaN → misleading error` patterns. Worth a separate sweep ORCH; do NOT bundle into 0978.

## 6. Next phase decision

Operator delegated "take over" → orchestrator writes SPEC AMENDMENT 6 directly in the same pass rather than dispatching back to forensics. AMENDMENT 6 follows below in the SPEC file (`Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`).

## 7. Verdict

**APPROVED.** All 12 REVIEW gates pass. Commit-hash verified. Dependency walk N/A. Investigation is the gold standard: provider_payload-backed, five-layer-verified, Cloudinary-docs-cited, alternative-hypotheses-ruled-out. SPEC AMENDMENT 6 (written same pass) inherits this confidence and ships the fix.
