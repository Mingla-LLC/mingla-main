# INVESTIGATION — ORCH-0978 [video upload polish + sub-30s perfect cross-surface render] — iOS keyframe-overshoot trim rejection

**Author:** Claude `mingla-forensics` (INVESTIGATE mode)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` @ HEAD `0d76a27a2`
**Date:** 2026-05-28
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_INVESTIGATE_SPEC_ORCH-0978_AMENDMENT_8_KEYFRAME_OVERSHOOT.md`
**Confidence:** **PROBABLE** (root cause mechanism proven by source + Seth's physical-device runtime signal + synthetic keyframe demonstration; the only missing element is a live in-sim capture of the exact overshoot value — blocked, see §8).
**Comms ledger:** COMMS-0002 (WARN — new migration + strict-grep revision will need `ORCH_0978_BACKEND_ALLOWLIST` update in the IMPLEMENT-6 commit; factored into SPEC AMENDMENT 8) + COMMS-0003 (WARN — every Cloudinary `du_` claim is inline-cited with a docs URL in the SPEC) acknowledged and factored.

---

## 1 — Symptom summary

**Expected:** A user picks a long source video → iOS shows the native trim screen → the user trims to ~29 seconds → taps Choose → Mingla accepts the clip and uploads it.

**Actual (Seth, physical iPhone, 2026-05-28):** Picked a 1-minute video → iOS showed Apple's native "Video Too Long to Send" sheet → the iOS trimmer opened → Seth trimmed to ~29 s → tapped Choose → Mingla showed the toast **"Please trim to 29 seconds first."** and the video did NOT upload. The user trimmed correctly but the app still rejected the clip.

**Reproduction conditions:** Source longer than 29 s, trimmed at the iOS native trimmer to a value the user perceives as ≈29 s. Deterministic for footage whose keyframe (sync-sample / I-frame) spacing places the next keyframe ≥ ~29.25 s after the trim out-point.

**When it started:** Introduced by SPEC AMENDMENT 4 (IMPLEMENT-2, 2026-05-27), which dropped the cap from 30 s → 29 s with only a `+250 ms` tolerance. AMENDMENT 4 §Item 4 explicitly assumed "iOS keyframe overshoot typically 100-800 ms … comfortable headroom" against the 250 ms slop. This investigation shows that assumption is wrong for real footage: overshoot routinely exceeds 250 ms.

---

## 2 — Investigation manifest (every file read, in trace order)

| # | File | Why read | Layer |
|---|---|---|---|
| 1 | `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` AMENDMENTS 1, 4, 6, 7 | AMENDMENT 1 = original 30s-cap keyframe rationale; AMENDMENT 4 = 29s drop + 250ms tolerance + DB migration + the `[ORCH-0978-TRIM]` diagnostic; AMENDMENT 6 = `du_` clause; AMENDMENT 7 = trim wiring through the hook | Docs |
| 2 | `mingla-business/src/components/ui/CoverPicker.tsx:411-449` | The picker config (`videoMaxDuration`), the acceptance check, the `[ORCH-0978-TRIM]` log, the rejection toast | Code (client) |
| 3 | `mingla-business/src/services/eventCoverVideoProcessingService.ts:16-23` | `EVENT_COVER_MAX_VIDEO_DURATION_MS` + source constants + copy | Code (client) |
| 4 | `mingla-business/src/hooks/useEventCoverVideoUpload.ts:80-118` | How `trimEndMs`/`trimStartMs` are sent to the edge (the value that feeds `du_` and the DB constraint) | Code (client) |
| 5 | `mingla-business/src/utils/eventCoverMediaRules.ts` (constant + messages) | The DUPLICATE `EVENT_COVER_MAX_VIDEO_DURATION_MS` declaration + storage-bucket validation path | Code (client) |
| 6 | `supabase/functions/event-cover-video-upload-intent/index.ts:17, 60-179, 226-289` | Body parse, `EFFECTIVE_TRIM_CEILING_MS` source check, `validateTrimRange`, job insert (`trim_start_ms`/`trim_end_ms`), `du_` eager clause | Code (edge) |
| 7 | `supabase/functions/_shared/eventCoverVideo.ts:13-28, 355-407` | `MAX_DURATION_MS`/`MAX_SOURCE_VIDEO_DURATION_MS` constants, `validateTrimRange`, `assertProcessedDerivative` processed-duration cap | Code (edge shared) |
| 8 | `supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql` | The live DB constraints on `trim_end_ms - trim_start_ms` and `processed_duration_ms` | Schema |
| 9 | `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | C1-C9 CI gates — all assume `29` everywhere; will need revision | CI |
| 10 | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:887-899` | `ORCH_0978_BACKEND_ALLOWLIST` (COMMS-0002) | CI |
| 11 | iOS sim live-fire (UDID `F7ECAC25-…`), synthetic 35 s / 2 s-GOP clip, Maestro nav, system log stream | Prime Directive 7 live-fire attempt | Runtime |

---

## 3 — The full cap chain (verified against source — all 10 sites confirmed)

| # | Layer | File:line | Current value | Verified |
|---|---|---|---|---|
| 1 | iOS picker `videoMaxDuration` (trimmer target + Apple "too long" gate) | `CoverPicker.tsx:429` | `videoMaxDuration: 29` | ✅ |
| 2 | Client acceptance check | `CoverPicker.tsx:441` | `durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS + 250` (= **29250 ms**) → toast | ✅ |
| 3a | Client constant (Cloudinary pipeline) | `eventCoverVideoProcessingService.ts:17` | `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000` | ✅ |
| 3b | Client constant (storage-bucket pipeline, DUPLICATE) | `eventCoverMediaRules.ts:4` | `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000` | ✅ |
| 4 | Edge source-duration cap | `upload-intent/index.ts:17` + `:144` | `EFFECTIVE_TRIM_CEILING_MS = 29_250`; `sourceDurationMs > 29250 → 422 duration_over_cap` | ✅ |
| 5 | Edge `du_` processed clause | `upload-intent/index.ts:266-272` | `durationBudgetMs = Math.min(trimEndMs - trimStartMs, MAX_DURATION_MS=30000)`; `du_${ceil(durationBudgetMs/1000)}` | ✅ |
| 6 | Edge trim-window storage | `upload-intent/index.ts:123-124, 239-240` | `trimStartMs = body.trimStartMs ?? 0`; `trimEndMs = body.trimEndMs ?? sourceDurationMs`; persisted as `trim_start_ms`/`trim_end_ms`. Client sends `trimEndMs = compressed.durationMs` (raw source duration) per `useEventCoverVideoUpload.ts:100` | ✅ |
| 7 | DB constraint (trim window) | migration `:20-22` | `CHECK ((trim_end_ms - trim_start_ms) <= 29000)` | ✅ |
| 8 | DB constraint (processed) | migration `:23-25` | `CHECK (processed_duration_ms IS NULL OR processed_duration_ms <= 29000)` | ✅ |
| 9 | `_shared` `MAX_DURATION_MS` | `_shared/eventCoverVideo.ts:17-20` | `env EVENT_COVER_MAX_DURATION_MS ?? "30000"` | ✅ |
| 10 | `_shared` `assertProcessedDerivative` | `_shared/eventCoverVideo.ts:405-406` | `durationMs > MAX_DURATION_MS (30000) → processed_duration_over_cap` | ✅ |

**Two additional cap sites NOT in the orchestrator's 10-site map (discovered this investigation):**

| # | Layer | File:line | Current value | Note |
|---|---|---|---|---|
| 11 | Edge `validateTrimRange` trim-window upper bound | `_shared/eventCoverVideo.ts:366` | `trimEndMs - trimStartMs > MAX_DURATION_MS (30000) → 422 trim_over_duration` | **`MAX_DURATION_MS` does double duty** — it is BOTH the trim-window (source-side) ceiling here AND the processed (output-side) ceiling at line 405. This is the constant that must be SPLIT to implement "generous source / tight processed." |
| 12 | Edge `validateTrimRange` source-bound | `_shared/eventCoverVideo.ts:369-374` | `trimEndMs > sourceDurationMs + 250 → 422 trim_out_of_range` | A second 250ms-tolerance gate, source-side. |

---

## 4 — Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | SPEC AMENDMENT 1 chose 30 s "to absorb keyframe overshoot via native trim." AMENDMENT 4 dropped to 29 s and asserted "iOS keyframe overshoot typically 100-800 ms … comfortable headroom" against a `+250 ms` slop. **Contradiction:** the doc's own stated overshoot range (up to 800 ms) already exceeds the 250 ms tolerance it shipped — the headroom was never there for the high end of the doc's own estimate. |
| **Schema** | DB constraints pin BOTH trim-window and processed at **≤ 29000 ms** (migration `20260730000000`). A trim window of 29.4 s (29400 ms) violates the trim constraint at the DB layer even before any processed-duration question. |
| **Code (client)** | `CoverPicker.tsx:441` rejects when `durationMs > 29250`. This is the exact gate that produced Seth's toast. The `[ORCH-0978-TRIM]` `console.log` at `:442-446` records `{ durationMs, capMs, overshoot }` — but its output requires the Business Metro dev session to capture it (see §8). |
| **Code (edge)** | Even if the client were loosened, `upload-intent:144` (`> 29250 → 422`), `validateTrimRange:366` (`> 30000 → 422`), and the DB constraints (`≤ 29000`) form three more rejection gates. `MAX_DURATION_MS` (30000) is overloaded as both the trim-window and processed ceiling. |
| **Runtime** | **Seth's physical device fired the `:447` toast after a ~29 s trim.** The toast fires ONLY when `durationMs > 29250`. Therefore Seth's trimmed asset's reported duration was **> 29250 ms** — direct runtime evidence that the overshoot exceeded the 250 ms tolerance. (Exact magnitude not captured — see §8.) |
| **Data** | The job row stores `trim_end_ms = raw source duration` (client sends `compressed.durationMs`). For an overshot trim that means `trim_end_ms ≈ 29.4 s`, which trips both the DB `≤ 29000` trim constraint AND the edge `≤ 29250` source check. No job row is ever inserted because the client rejects first. |

**Layers in conflict:** Docs (claimed 250 ms is enough) vs. Code/Schema (gates at 29250/29000) vs. Runtime (Seth's asset > 29250). The truth-holder is Runtime + the keyframe mechanism (§5): real iOS trim overshoot exceeds 250 ms.

---

## 5 — Findings

### 🔴 F-1 (ROOT CAUSE, PROBABLE) — iOS native-trimmer keyframe snapping pushes a "29 s" trim past the 29.25 s ceiling

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/src/components/ui/CoverPicker.tsx:441` (`durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS + 250`, = `> 29250`); constant `eventCoverVideoProcessingService.ts:17` (`29_000`). |
| **Exact code** | `if (durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS + 250) { console.log("[ORCH-0978-TRIM]", {...}); onShowToast("Please trim to 29 seconds first."); return; }` |
| **What it does** | Rejects any picked/trimmed asset whose reported duration exceeds 29250 ms, before any upload. |
| **What it should do** | Accept a normally-trimmed clip (one the user trimmed to the 29 s target) even when iOS keyframe snapping reports it slightly over 29.25 s, and rely on a server-side processed cap to keep the rendered cover sub-30 s. |
| **Causal chain** | iOS `UIImagePickerController` with `allowsEditing: true` performs a **passthrough (fast) export** of the trimmed range. Passthrough export can only cut at **sync samples (keyframes / I-frames)**, so the out-point snaps to the next keyframe ≥ the user's selected position → the exported asset's duration is `userOutPoint + (keyframe_gap_remainder)`. For real iPhone footage (1-2 s+ GOP, sparser for 4K Dolby Vision HDR — Seth's default per AMENDMENT 3 §"worst-case input"), the snap adds anywhere from ~250 ms to ~2 s. A 29.0 s selection on footage with a keyframe at 30.0 s exports a 30.0 s asset → `durationMs = 30000` → `30000 > 29250` → rejected. → user sees "Please trim to 29 seconds first." despite having trimmed correctly. |
| **Verification step** | (a) Seth's physical-device repro fired the `:447` toast (toast fires only when `durationMs > 29250`) — proves the asset exceeded 29250 ms. (b) Synthetic demonstration (§8): a 35 s clip authored with keyframes at exactly 2.0 s spacing (0,2,…,30,…,34) means a 29 s out-point's next sync sample is 30.0 s → 1000 ms overshoot, 4× the 250 ms tolerance. (c) Source trace confirms no other gate fires before `:441`. **Missing for `proven`:** a live in-sim `[ORCH-0978-TRIM]` capture of the exact `overshoot` value for a real trimmed asset — blocked per §8. |

### 🟠 F-2 (CONTRIBUTING) — `MAX_DURATION_MS` is overloaded as both the source-side trim ceiling and the processed-side output ceiling

`_shared/eventCoverVideo.ts:366` uses `MAX_DURATION_MS` (30000) as the **trim-window** upper bound (`validateTrimRange`), and `:405` uses the **same constant** as the **processed-duration** upper bound (`assertProcessedDerivative`). The single 30000 constant cannot simultaneously be "generous on the source" (must accept ~33 s sources to absorb overshoot) and "tight on the processed output" (must keep the rendered cover sub-30 s). **This overload is the structural reason the operator's "generous source / tight processed" architecture cannot be expressed without a code change — the two roles must be split into two constants.** SPEC AMENDMENT 8 splits them.

### 🟠 F-3 (CONTRIBUTING) — `trim_end_ms` is persisted as the RAW source duration, so the overshoot propagates into the DB constraint and `du_`

`useEventCoverVideoUpload.ts:100` sends `trimEndMs: compressed.durationMs` (the raw, overshot source duration). The edge persists it verbatim (`upload-intent:240`) and feeds it to both the DB trim constraint (`≤ 29000`) and the `du_` budget. So even if the client check were loosened, an overshot `trim_end_ms ≈ 29400` would be rejected by the DB constraint and would push `du_` toward 30. The fix must **clamp the persisted trim window to the processed cap** so the source overshoot never reaches the processed budget or the DB constraint.

### 🟡 F-4 (HIDDEN FLAW) — the duplicate `EVENT_COVER_MAX_VIDEO_DURATION_MS` declaration means the source ceiling must be threaded carefully

`EVENT_COVER_MAX_VIDEO_DURATION_MS` is declared in BOTH `eventCoverVideoProcessingService.ts:17` and `eventCoverMediaRules.ts:4` (the latter feeds the older storage-bucket validation path, `eventCoverMediaRules.ts:339`). AMENDMENT 4 §J-bis already flagged this as a "one owner per truth" debt. For AMENDMENT 8, the **trimmer-target** number (29) stays in both, but the new **source-acceptance ceiling** (33 s) must be introduced as a separate constant and applied to the picker acceptance check AND (if video flows through it) the storage-bucket video check, or the two pipelines will diverge again. Strict-grep C2/C3 currently pin both at `29_000`; the revision must keep those green while adding the source-ceiling check.

### 🔵 F-5 (OBSERVATION) — the rejection toast is misleading

"Please trim to 29 seconds first." tells a user who *did* trim to ~29 s that they failed. The toast wording is technically the trimmer target, but UX-wise it blames the user for a keyframe-alignment artifact they cannot control. AMENDMENT 8 keeps the trimmer target at 29 s (so the messaging stays "29 seconds") but raises the acceptance ceiling to 33 s, so the toast only fires for genuinely-untrimmed long sources — which is the only case where "trim first" is accurate.

---

## 6 — Blast radius

- **Surfaces affected:** Business iOS + Business Android (shared `mingla-business/` bundle; the native picker is the authoring path). Web composer is incidentally affected (it has no native trimmer; a >29.25 s raw pick hits the same client check). Consumer apps + admin: not affected (read-only / no cover authoring).
- **Pipeline scope:** Client picker check (layer 2), edge source check (layer 4), edge `validateTrimRange` trim-window bound (layer 11), `du_` budget (layer 5), DB trim + processed constraints (layers 7-8), `_shared` `MAX_DURATION_MS` overload (F-2). The webhook duration-fallback (AMENDMENT 6) is downstream and unaffected by the cap values themselves but reads `trim_end_ms` — which the clamp changes, so the fallback's result becomes the clamped (sub-30) value, which is correct.
- **Invariants touched:** `I-PROPOSED-VIDEO-CAP-CONSISTENCY-29S` (AMENDMENT 4 §E) — this invariant asserts "all layers agree at 29000." AMENDMENT 8 **supersedes** it with a two-tier contract (source ≥ 33000 > processed ≤ 30000). The strict-grep C1-C9 that back it need revision, not just addition (dispatch §6.7).
- **Greenfield:** AMENDMENT 2 probe confirmed ZERO production video covers and ZERO Cloudinary URLs, so raising the constraints carries no data-migration risk (the pre-flight `RAISE EXCEPTION` guard will see zero offending rows).

---

## 7 — Fix strategy (direction only — full contract in SPEC AMENDMENT 8)

"Generous source / tight processed":
1. Keep the iOS trimmer target at **29 s** (`videoMaxDuration: 29` unchanged) and keep the "29 seconds" copy.
2. Raise the **source-acceptance ceiling** to **33000 ms** at the client check (layer 2) and the edge source check (layer 4) — a new constant, distinct from the 29 s trimmer-target constant. 33 s absorbs realistic iOS keyframe overshoot (measured/bounded at ≤ ~2 s on a 29 s target; 33 s gives ~4 s headroom).
3. **Split** the overloaded `MAX_DURATION_MS` (F-2) into a generous source/trim bound and a tight processed cap.
4. **Clamp the persisted `trim_end_ms`** to the tight processed cap at the edge (the trust boundary) so the overshoot never reaches the `du_` budget or the DB constraint; store the raw value in `source_duration_ms` (the "generous record").
5. New DB migration raising the trim + processed constraints to the tight processed cap (so the clamped trim window is legal) while keeping processed tight (≤ 30000).
6. Revise strict-grep C1-C9 to enforce the new two-tier relationship (source ceiling > processed cap; processed stays tight) instead of "29 everywhere."

---

## 8 — Live-fire attempt + named blocker (Prime Directive 7)

**A genuine live-fire attempt was made.** It is BLOCKED for the post-trim capture; confidence is therefore capped at **PROBABLE** per the dispatch §9 authorization.

**Steps performed (evidence captured):**
1. ✅ Confirmed target sim booted: iPhone 17, iOS 26.4, UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`. Business app installed (`com.sethogieva.minglabusiness`).
2. ✅ Synthesized a controlled repro asset: 35 s, 1080×1920, 30 fps, **keyframes forced at exactly 2.0 s spacing** (`ffmpeg -g 60 -keyint_min 60 -sc_threshold 0`). `ffprobe` confirms sync samples at 0,2,4,…,30,32,34 s. This demonstrates the snapping mechanism deterministically: a 29 s out-point's next sync sample is **30.0 s → 1000 ms overshoot → 30000 ms > 29250 ms ceiling → rejection**.
3. ✅ Injected the clip into the sim Photos library (`xcrun simctl addmedia`).
4. ✅ Launched the Business app; at first launch it showed a cached session on the published event "A life in vegas" (screenshot `01_launch.png`). Started a background `log stream` filtered for `ORCH-0978`/`TRIM`/`duration`.
5. ✅ Drove Maestro toward the cover editor; dumped the view hierarchy.
6. ❌ **BLOCKED:** The Business app's Metro bundler is **not running** — `ps`/`curl` confirm only `app-mobile`'s Metro is up (localhost:8081, labelled "Mingla"); the Business tunnel `https://l4ur-4g-sethogieva-8090.exp.direct` returns ngrok `ERR_NGROK_3200` (offline) and ports 8090/8093 are down. On relaunch the Business dev client falls to the Expo dev-client launcher ("DEVELOPMENT SERVERS" / "RECENTLY OPENED") with no reachable Business bundle, so the cover-upload flow cannot be reached to fire the `[ORCH-0978-TRIM]` log. The system `log stream` captured 0 lines matching `ORCH-0978`/`TRIM`.

**Second, independent blocker (would persist even with Metro up):** The iOS **Simulator's** `UIImagePickerController` trim+export path uses software AVFoundation and is not guaranteed to reproduce a physical device's passthrough keyframe-snapping. Prior QA (`QA_ORCH-0978_IMPLEMENT_5_RETEST.md`) documented the sim intercepting long sources with Apple's "Video Too Long to Send" sheet, which gates differently from Seth's physical-device behaviour (where the trimmer opened and Choose was rejected post-trim). Maestro also cannot reliably drag the native trim handle (it is not a standard accessibility element).

**Why PROBABLE is the correct ceiling (not SUSPECTED):** there is a real runtime signal — Seth's physical device fired the `:447` toast after a ~29 s trim, and that toast fires **only** when `durationMs > 29250`, so the overshoot demonstrably exceeded the 250 ms tolerance on real hardware. Combined with the proven source trace and the synthetic keyframe demonstration, the mechanism is established. The single missing element for `proven` is a live capture of the exact `overshoot` value for a real trimmed asset.

**Unblock paths (for the tester at IMPLEMENT-6 RETEST):** (a) start the Business worktree Metro and reconnect the dev client, then drive the picker with the injected 35 s clip; OR (b) Seth re-runs the repro on his physical iPhone with Metro reachable (per `feedback_physical_iphone_test_handoff_provides_metro_url.md`) and reports the `[ORCH-0978-TRIM]` `overshoot` value from the Metro log. Either yields the exact magnitude and upgrades the root cause to `proven`.

**Other observations during the attempt (Discoveries for Orchestrator, NOT scope-widened):**
- The Business Metro tunnel is offline; any tester live-fire on this worktree needs Metro restarted first (memory `feedback_sim_load_latest_bundle_before_test`).
- The dev-client "RECENTLY OPENED" list shows multiple stale Business endpoints (8090 tunnel, 8093, plus an `app-mobile`/Mingla on 8081) — a clean reconnect target should be confirmed before RETEST.

---

## 9 — Discoveries for Orchestrator

1. **Two un-mapped cap sites (layers 11-12 above):** `_shared/eventCoverVideo.ts:366` (`validateTrimRange` trim-window bound) and `:369-374` (source bound) were NOT in the dispatch's 10-site map. Layer 11 is load-bearing for AMENDMENT 8 because it shares the overloaded `MAX_DURATION_MS`. Folded into the SPEC.
2. **`I-PROPOSED-VIDEO-CAP-CONSISTENCY-29S` is now obsolete** (AMENDMENT 4 §E asserted "all layers agree at 29000"). AMENDMENT 8 supersedes it with a two-tier invariant. The DECISION_LOG / INVARIANT_REGISTRY entry for the 29s invariant should be marked superseded at CLOSE.
3. **Duplicate-constant debt (AMENDMENT 4 §J-bis) persists** and is mildly aggravated by adding a source ceiling. Still recommend the consolidation cleanup ORCH.
4. **Business Metro tunnel offline** — environment hygiene for whoever runs IMPLEMENT-6 RETEST.

---

## 10 — Confidence: PROBABLE

Root-cause mechanism (F-1) is established by: (a) full source trace of all 12 cap sites, (b) Seth's physical-device runtime signal (`:447` toast → asset > 29250 ms), and (c) a deterministic synthetic keyframe demonstration (2.0 s GOP → 29 s out-point snaps to 30.0 s). The named blocker preventing `proven` is the inability to capture a live in-sim `[ORCH-0978-TRIM]` overshoot value (Business Metro offline + simulator trimmer-fidelity uncertainty). This is exactly the condition under which the dispatch authorizes `probable`. The architecture decision ("generous source / tight processed") is operator-locked and not re-litigated; SPEC AMENDMENT 8 operationalizes it with exact values.
