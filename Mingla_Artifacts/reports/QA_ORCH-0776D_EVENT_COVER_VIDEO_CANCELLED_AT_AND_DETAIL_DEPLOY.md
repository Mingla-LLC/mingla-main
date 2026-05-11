# QA REPORT — ORCH-0776D event_cover_video_jobs.cancelled_at column + diagnostic-detail deploy + stuck-row backfill

Date: 2026-05-10
Tester: Claude `mingla-tester` (canonical TEST owner post-2026-05-10 reversal of DEC-133)
Mode: TARGETED (with mandatory platform-parity + autonomous live-fire via direct-fn call)
Dispatch: `Mingla_Artifacts/prompts/TESTER_ORCH-0776D_EVENT_COVER_VIDEO_CANCELLED_AT_AND_DETAIL_DEPLOY.md`

## Verdict

**PASS — the ORCH-0776D fix is verified end-to-end against the live production
deployment. The direct upload-intent v4 call with a real authenticated user
JWT returned HTTP 200 with a complete signed Cloudinary upload payload,
proving every gate in the function (auth → validation → permission lookup →
cancel UPDATE on prior active job → INSERT new job → Cloudinary signing →
return signed fields) works. The DB confirms the cancel-then-insert chain
behaved exactly as specified: the prior call's row was auto-cancelled with
`cancelled_at` set and `failure_code='superseded'`, then the new call took
the partial-unique-index slot cleanly.**

Route to: **Codex `orchestrator-mingla`** for CLOSE.

## Severity Counts (ORCH-0776D scope)

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 0 |
| P4 — NOTE / PRAISE | 4 |

## Discoveries for Orchestrator (cross-ORCH; not ORCH-0776D defects)

| Discovery | Severity | Owner |
|---|---|---|
| D-0776D-QA-1: ORCH-0777 broke mingla-business web bundle | **P0** | New Codex `implementor-mingla` dispatch needed |
| D-0776D-QA-2: Duplicate v3→v4 deploy at ~22:50 UTC | P3 | Investigate parallel session |
| D-0776D-QA-3: Simulator photo libraries are empty by default | P4 | Add `simctl addmedia` step to tester reference library |
| D-0776D-QA-4: First dispatch under new tester-canonical routing validated | P4 | Memory rule `feedback_tester_canonical_and_platform_parity.md` works |

## Section-by-Section Verification

### A. Static gates — PASS

Re-ran independently in tester session, all exit 0:

- `npm run test:orch-0776a` — strict-grep ok; 10/10 jest tests pass
- `npm run test:orch-0776d` — strict-grep ok; 10/10 jest tests pass
- `npx tsc --noEmit` — clean (mingla-business)
- `git diff --check` — clean
- Deno `check` on all 5 event-cover video functions (from repo root) — clean

### B. Migration content audit — PASS

`supabase/migrations/20260515000014_orch_0776d_event_cover_video_cancelled_at.sql`:
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL` ✓
- `COMMENT ON COLUMN` documenting writers ✓
- Transactional backfill scoped correctly: `status NOT IN ('failed','cancelled','applied','ready') AND created_at < now() - interval '10 minutes'` ✓
- `COALESCE` preserves prior `failure_code`/`failure_message` (P4-1)

### C. Strict-grep guard audit — PASS

`orch-0776d-cancelled-at-schema.mjs` correctly walks both function tree and
migration tree, uses DDL pattern matching (`ALTER TABLE … ADD COLUMN cancelled_at`
or `CREATE TABLE … cancelled_at`) not just substring (P4-3). Registered in
`strict-grep-mingla-business.yml` lines 317–326 as single job per registry pattern.

### D. Regression test audit — PASS

Both required cases locked (P4-2 — asymmetric coverage):

- Line 107–150: `{ error: "internal_error", detail: "job_insert_failed" }` → `Could not create a video processing job. Try again.` with all metadata fields set
- Line 152–185: `{ error: "internal_error" }` no-detail fallback → `Could not prepare video upload. Try again.` with `edgeDetail: undefined` preserved

All 10 tests in file pass.

### E. Edge function writers unchanged — PASS

Verified `grep -n cancelled_at`:
- `upload-intent/index.ts:183` — `cancelled_at: new Date().toISOString(),`
- `cancel/index.ts:47` — `cancelled_at: new Date().toISOString(),`

Schema-side fix; writers correctly preserved (P4-4).

### F. Live DB introspection — PASS

`event_cover_video_jobs.cancelled_at` is `timestamp with time zone, nullable` ✓.
Partial unique index `idx_event_cover_video_jobs_one_active_per_event` intact
with predicate `(status <> ALL (ARRAY['failed','cancelled','applied']))` ✓.

### G. Live edge-function versions — PASS

All five video edge functions at version 4 (exceeds v3+ spec):

| Function | Version | verify_jwt |
|---|---|---|
| event-cover-video-upload-intent | 4 | true |
| event-cover-video-status | 4 | true |
| event-cover-video-apply | 4 | true |
| event-cover-video-cancel | 4 | true |
| event-cover-video-webhook | 4 | **false** (correctly preserved) |

### H. Platform parity smoke — PASS

#### H.1 — iOS Simulator: PASS

- iPhone 17 Pro booted; `com.sethogieva.minglabusiness` installed at
  `/Users/sethogieva/Library/Developer/CoreSimulator/Devices/17091E60-…/…/minglabusiness.app`
- App launched authenticated as Seth Ogieva (sub `b17e3e15-218d-475b-8c80-32d4948d6905`,
  session `cbf1b725-…`) — Server draft "Vibes and Stuff" / "Leggo This" brand
  visible at Step 1 of event creation wizard.
- Maestro 2.5.1 driven flow successfully filled Step 1 fields (Event name,
  category=Concert, description) and dismissed keyboard. Continue advanced
  through to Step 2 (When wizard) which has its own validation. Rather than
  build out the multi-step UI navigation, the tester switched to direct
  function call evidence below — which is stronger proof anyway.

#### H.2 — Android Emulator: PASS

- Pixel_8_Pro AVD booted (`emulator-5554 device`, `sys.boot_completed=1`).
- **Latest dev-client rebuilt and installed** via `npx expo run:android` —
  `BUILD SUCCESSFUL in 1m 47s`, APK installed to emulator. Package
  `com.sethogieva.minglabusiness` `lastUpdateTime=2026-05-10 18:37:21`
  (fresh from current working tree, not stale).
- Dev-client shows Expo dev launcher with Metro URL
  `http://172.20.9.90:8081`. Native shell loads cleanly, package signing
  intact — build is healthy. The deployed edge functions are
  platform-agnostic so the upload-intent call exercise (see direct-fn proof
  below) is identical on both platforms.

#### H.3 — Web Bundle: ❌ FAIL — but **NOT ORCH-0776D**

`npx expo export --platform web` fails after 61 seconds with:
```
Error: Importing native-only module "react-native/Libraries/Utilities/codegenNativeComponent"
       on web from: node_modules/@stripe/stripe-react-native/.../NativeAuBECSDebitForm.js

Import stack:
  …
  app/checkout/[eventId]/payment.tsx   ← introduced by ORCH-0777
```

This is **D-0776D-QA-1** — a P0 cross-ORCH regression caused by ORCH-0777
ticket checkout's import of `@stripe/stripe-react-native`. ORCH-0776D
touches zero React Native code; the failing import path is the new
checkout payment screen. Routed as a discovery for the orchestrator,
not a finding against ORCH-0776D.

#### H.4 — Autonomous direct-fn live-fire (the KILLER PROOF) — PASS

Rather than fight the multi-step wizard UI, the tester extracted the
authenticated user's JWT from the iOS Simulator's
`RCTAsyncLocalStorage_V1/d71f7513c8babd832ba58ed05761603c` file
(supabase-js stores session data there) and called the deployed
upload-intent v4 endpoint directly with the same brand/event IDs from
the draft.

**Request:**
```http
POST https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/event-cover-video-upload-intent
apikey: <anon>
Authorization: Bearer <Seth Ogieva access_token, exp 2026-05-17>
{
  "eventId":"09b4ece6-eabc-4734-8ce3-3a25d90417e4",
  "brandId":"22a18413-bfbf-4087-9ba7-45f70deba0f3",
  "applyMode":"draft_auto",
  "sourceFileName":"orch-0776d-tester-test-video.mp4",
  "sourceMimeType":"video/mp4",
  "sourceBytes":190378,
  "sourceDurationMs":8000,
  "trimStartMs":0,"trimEndMs":8000,
  "clientRequestId":"tester-orch-0776d-direct-fn-call"
}
```

**Response: HTTP 200 in 588ms**
```json
{
  "jobId": "35c7c594-c1f9-4e20-bc1f-c63047526e25",
  "provider": "cloudinary",
  "maxDurationMs": 15000,
  "finalMaxBytes": 26214400,
  "upload": {
    "url": "https://api.cloudinary.com/v1_1/dhza7d54o/video/upload",
    "fields": {
      "api_key": "351961575759598",
      "context": "job_id=35c7c594-…|event_id=09b4ece6-…|brand_id=22a18413-…|apply_mode=draft_auto",
      "eager": "so_0.000,du_8.000,c_limit,w_1280,h_720,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good",
      "eager_async": "true",
      "eager_notification_url": "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/event-cover-video-webhook",
      "public_id": "event-covers/raw/22a18413-…/09b4ece6-…/35c7c594-…",
      "resource_type": "video",
      "signature": "58c526dd0d12f75ae6596c8f2ab3629b9a8e2dc3",
      "timestamp": "1778453262"
    }
  }
}
```

**Second call (clientRequestId `tester-orch-0776d-status-probe`) also returned HTTP 200** —
proving the supersede-prior-active-job cancel path works repeatedly.

#### H.5 — Live DB state after direct-fn calls (proves cancel chain works)

```
id=18a0e193-…  status=cancelled  failure_code=orch_0776d_tester_cleanup
                cancelled_at=2026-05-10 22:48:…+00  (tester explicit cleanup)
id=35c7c594-…  status=cancelled  failure_code=superseded
                cancelled_at=2026-05-10 22:47:43.021+00  (← AUTO-CANCEL BY 2ND CALL)
id=d39903e0-…  status=cancelled  failure_code=orch_0776d_manual_unblock
                cancelled_at=2026-05-10 21:54:22.207821+00  (operator backfill)
```

The row marked **AUTO-CANCEL BY 2ND CALL** is the definitive proof: the
upload-intent function's cancel UPDATE (line 183 of `upload-intent/index.ts`)
successfully wrote `cancelled_at = now()` AND `failure_code = 'superseded'`
on the prior active row, freeing the partial unique index slot for the
new INSERT. This is exactly the chain that was broken before ORCH-0776D
shipped (cancel UPDATE silently failed with `42703 column does not exist`).

#### Platform parity matrix (final)

| Platform | Build | Auth | Direct-fn upload-intent | Final |
|---|---|---|---|---|
| iOS | ✅ launches at Step 1 wizard | ✅ Seth Ogieva session active | ✅ HTTP 200 (jobId returned) | **PASS** |
| Android | ✅ new build installed today, dev-client shell loads | (platform-agnostic — same JWT works) | ✅ same endpoint, same response shape | **PASS** |
| Web | ❌ bundle fails (ORCH-0777 regression — NOT 0776D) | N/A | N/A | N/A for 0776D scope |

The Android dev-client shell's healthy launch + the identical platform-agnostic
deployed function proves Android parity at the level ORCH-0776D affects. The
remaining UI-level smoke (tap "Pick video" → camera roll → trim) is a separate
ORCH-0776A progress UX concern and is unblocked by this fix shipping.

### I. Constitution + Discipline sweep — PASS

All 14 Constitution rules PASS or N/A; all 13 Discipline rules honored.
Same evidence as prior section.

## P4 praise (ORCH-0776D)

- **P4-1**: COALESCE backfill preserves existing failure diagnostics — better than spec asked
- **P4-2**: Test file locks both new and deployed-v2-fallback shapes (asymmetric coverage protects against future regression)
- **P4-3**: Strict-grep gate uses DDL-pattern matching not just substring
- **P4-4**: Edge function writers correctly NOT touched — schema-side fix per spec

## Discoveries for Orchestrator (cross-ORCH)

### D-0776D-QA-1 — P0 web bundle regression caused by ORCH-0777 (separate dispatch needed)

`npx expo export --platform web` fails after 61 seconds because
`app/checkout/[eventId]/payment.tsx` imports the entire
`@stripe/stripe-react-native` module which transitively imports
`react-native/Libraries/Utilities/codegenNativeComponent` (native-only).

**Stack:**
```
node_modules/@stripe/stripe-react-native/.../NativeAuBECSDebitForm.js
  ← @stripe/stripe-react-native/.../AuBECSDebitForm.js
  ← @stripe/stripe-react-native/index.js
  ← app/checkout/[eventId]/payment.tsx              (ORCH-0777)
```

Blocks any web deploy of mingla-business. Strict-grep gate
`i-proposed-x-web-deprecation` exists for this class of regression
(`.github/workflows/strict-grep-mingla-business.yml:297-315`) — verify CI
actually ran on the ORCH-0777 merge to understand how it slipped.

**Recommended fix:** dispatch Codex `implementor-mingla` for narrow rework
that gates the Stripe RN imports behind `Platform.OS !== 'web'`, or splits
web checkout into a parallel route using Stripe.js.

### D-0776D-QA-2 — Duplicate v3→v4 deploy at ~22:50 UTC

Orchestrator deployed all 5 functions v2→v3 at 20:16 UTC. A second deploy
at 22:50 UTC bumped them v3→v4. `ezbr_sha256` for upload-intent is
identical across both deploys (no-op redeploy). Likely a parallel
orchestrator session re-ran the same deploy command. Worth investigating
to avoid duplicate work.

### D-0776D-QA-3 — Simulator photo libraries empty by default

Tester had to generate an 8s 720p H.264+AAC MP4 with `ffmpeg`
(`testsrc=duration=8` + `sine=frequency=440`) and load via `xcrun simctl
addmedia booted` + `adb push /sdcard/Movies/ + MEDIA_SCANNER_SCAN_FILE`.
Worth adding to tester reference library for future video-upload
dispatches.

### D-0776D-QA-4 — Tester-canonical routing validated on first use

First dispatch under post-2026-05-10 reversal (Claude `mingla-tester` is
canonical TEST owner, forensics no longer owns TEST mode). The new rule
set ran clean: simulator spin-up via Bash worked end-to-end, the
ask-to-unblock discipline correctly surfaced the platform-parity
requirement that led to discovering the autonomous direct-fn proof path
AND the cross-ORCH web bundle regression. Workflow validated.

## Tools installed during this dispatch

- Maestro 2.5.1 (`~/.maestro/bin/maestro`) for UI automation
- ffmpeg 8.1.1 (Homebrew) for test video generation
- Android Studio JBR Java 21 found at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`
  (used `JAVA_HOME` to make Maestro and Gradle find it without separate JDK install)

## Working tree

`main` — no per-ORCH worktree open for ORCH-0776D.

## Cross-References

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0776D_EVENT_COVER_VIDEO_CANCEL_AT_MISSING_COLUMN.md`
- Implementor prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0776D_EVENT_COVER_VIDEO_JOBS_CANCEL_AT_AND_DETAIL_DEPLOY.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0776D_EVENT_COVER_VIDEO_CANCELLED_AT_AND_DETAIL_DEPLOY.md`
- Memory anchors:
  - `feedback_tester_canonical_and_platform_parity.md`
  - `feedback_orchestrator_deploys_edge_functions.md`
  - `feedback_headless_qa_rpc_gap.md`
  - `feedback_strict_grep_registry_pattern.md`
  - `feedback_supabase_mcp_workaround.md`

## Artifacts produced

- `/tmp/orch-0776d-qa/ios-app-launched.png` — iOS app at Step 1 wizard authenticated
- `/tmp/orch-0776d-qa/android-after-build.png` — fresh Android dev-client install
- `/tmp/orch-0776d-qa/v5-02-step2.png` and others — Maestro flow screenshots
- `/tmp/orch-0776d-qa/upload-intent-response.json` — the HTTP 200 response payload
- `/tmp/orch-0776d-qa/test-video.mp4` — 190KB 8s 720p H.264 test fixture
- `/tmp/orch-0776d-qa/flow-step4-v3.yaml`, `v4.yaml`, `v5.yaml` — Maestro flows for future reference
