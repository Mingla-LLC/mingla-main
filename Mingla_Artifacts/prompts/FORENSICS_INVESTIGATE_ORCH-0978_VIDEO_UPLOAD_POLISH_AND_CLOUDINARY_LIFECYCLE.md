# FORENSICS DISPATCH — ORCH-0978 [Video upload polish + cross-surface cover-media expansion + Cloudinary lifecycle management]

**Target skill:** Claude `mingla-forensics`
**Mode:** INVESTIGATE only (return INVESTIGATE first, await REVIEW, then a separate SPEC dispatch will follow)
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Metro port:** 8090
**Affected Surfaces (write):** business-iOS, business-Android, business-web-preview, `supabase/functions/` edge layer.
**Affected Surfaces (read):** buyer-web (public brand `/b/[slug]`, public event `/e/[brandSlug]/[eventSlug]`, public trip render), iOS-consumer (`ExpandedBusinessEventSheet` + the new ORCH-0964 `/brand/[slug]` screen + anywhere brand/event cover renders), Android-consumer (same).
**Surfaces explicitly NOT in scope:** admin-web (no admin cover-edit UI exists), checkout (cover-media-neutral per ORCH-0964 invariant).

---

## Goal (plain English)

Three connected problems were bundled into this ORCH per operator directive 2026-05-26:

**(A) Video everywhere.** It's unclear today which media-picker slots in `mingla-business/` accept photo vs. GIF vs. video. Brand cover, brand profile photo, event cover (popup + physical), trip cover, plus any non-cover pickers — we need a per-surface inventory of current accept-status before we can add video parity where it's missing.

**(B) UX polish on the existing Cloudinary pipeline.** The base pipeline shipped via ORCH-0770 / ORCH-0776 / ORCH-0776D works for the happy path but the UX is rough: progress feedback is minimal, no trim/crop preview, no cancel-during-upload, error states + retry affordances are weak, the picker affordance doesn't telegraph "Photo / GIF / Video", and render-side mute/loop/autoplay defaults are not consistent.

**(C) Cloudinary lifecycle / cost control.** From the operator's 2026-05-25 side-investigation, three confirmed leaks exist:
1. Raw originals at `event-covers/raw/{brandId}/{eventId}/{jobId}` accumulate indefinitely — zero deletion code.
2. Deleting an event cascades the Supabase row but never calls Cloudinary destroy → orphaned processed MP4 forever.
3. Replacing a cover overwrites `events.cover_media_url` but leaves the previous Cloudinary asset orphaned.

This is the same risk class as ORCH-0957 [Storage image transformation overage] — material recurring cost at scale.

The investigation must map current truth across all three workstreams before SPEC. No solutions yet.

---

## INVESTIGATE — what we need proved before SPEC

### Phase 0 mandatory ingest

Before any analysis, read:

1. **Pipeline base — Cloudinary upload-intent edge function:** `supabase/functions/event-cover-video-upload-intent/index.ts` (full file — note line 245 eager-transformation pipeline `so_,du_,c_limit,w_1280,h_720,vc_h264,ac_aac,br_900k-9000k,f_mp4,q_auto:good`).
2. **Pipeline base — webhook:** `supabase/functions/event-cover-video-webhook/index.ts` (full file).
3. **Cloudinary client helper:** `supabase/functions/_shared/cloudinaryClient.ts` (or wherever the signing + Admin API helpers live — grep `supabase/functions/_shared/` for `cloudinary` to enumerate).
4. **Job-state table:** `event_cover_video_jobs` schema via Supabase Mgmt API SQL probe — full column list, plus any RLS policies.
5. **Service layer:** `mingla-business/src/services/` — grep for `cover`, `cloudinary`, `videoUpload`, `mediaPicker` to enumerate every service touching media. Read each.
6. **Hook layer:** `mingla-business/src/hooks/` — same greps.
7. **Component layer — media picker surfaces:** grep `mingla-business/src/components/` AND `mingla-business/app/` for media-picker invocations. Enumerate every `<ImagePicker>` / `<MediaPicker>` / `expo-image-picker` / `expo-document-picker` / `ImagePicker.launchImageLibraryAsync` / `ImagePicker.launchCameraAsync` call site. For each, capture: file path + line, the surface (brand cover / brand profile photo / event cover popup / event cover physical / trip cover / other), and the current `mediaTypes` / `allowsEditing` / `videoMaxDuration` config.
8. **Render layer — every cover-media render site:** grep for `cover_media_url`, `coverMediaUrl`, `coverVideoUrl`, `cloudinary`, `res.cloudinary.com`, `<Video`, `expo-av`, `expo-video` across:
   - `mingla-business/src/components/` + `mingla-business/app/`
   - `app-mobile/src/components/` + `app-mobile/app/`
   - `packages/event-rendering/`
   - `packages/brand-rendering/` (NOTE: this package is being introduced by ORCH-0964 — may not exist yet on `main`; cross-reference the ORCH-0964 worktree at `~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/` to see its planned shape)
9. **ORCH-0964 IMPLEMENT collision surface:** read the ORCH-0964 SPEC AMENDMENT 3 commit `69b4e375f` on its worktree branch. Specifically map which files ORCH-0964 will rewrite (esp. `packages/event-rendering/PublicEventPage.tsx`, the new `packages/brand-rendering/`, the new consumer `app-mobile/app/brand/[slug]/`, the new hooks `useBrandBySlug.ts` + `useEventTheme.ts`). Note in the investigation report exactly where the ORCH-0978 IMPLEMENT work will need to rebase onto ORCH-0964 after it merges.
10. **Prior closes that established the pipeline:** WORLD_MAP entries for ORCH-0770 [Cover video pipeline base], ORCH-0776 [Video processing], ORCH-0776D [Cover video deploy] — for the architectural rationale.
11. **Sister cost-control ORCH for pattern reuse:** WORLD_MAP entry for ORCH-0957 [Storage image transformation overage] CLOSE — what tactics did we use? Any reusable patterns?
12. **Memory entries to factor:**
    - `feedback_orchestrator_deploys_edge_functions.md`
    - `feedback_supabase_edge_deploy_verify_first_call.md`
    - `feedback_external_api_docs_verified.md` ← REQUIRED — Cloudinary IS an external API
    - `feedback_always_simulator_repro_described_behaviour.md`
    - `feedback_rn_color_formats.md` (any new color tokens in error states must use hex/rgb/hsl/hwb)
13. **COMMS to ack at top of report:** COMMS-0002 (backend allowlist requirement for any new edge function + migration), COMMS-0003 (Cloudinary docs URLs must be cited inline at SPEC time — surface this in INVESTIGATE so SPEC can prepare).

### Five-truth-layer cross-check

| Layer | Question |
|-------|----------|
| Docs | What did ORCH-0770 / 0776 / 0776D specs promise? Where do they fall short of what's now requested? |
| Schema | `event_cover_video_jobs` shape. Any equivalent for brand cover videos? Brand profile videos? Trip cover videos? Or is video upload event-only today? |
| Code | Per media-picker call site: what `mediaTypes` is configured? `Images` / `Videos` / `All`? What's the upload destination — Cloudinary or Supabase Storage? What's the post-upload write path? |
| Runtime | Pick one real production brand with at least one event cover video. Read-only Mgmt API: confirm the Cloudinary URL is reachable, the processed MP4 plays, the raw original exists, the job row is marked complete. |
| Data | Mgmt API counts: how many `event_cover_video_jobs` rows in `completed` state? How many `cover_media_url` rows on `events` pointing at `res.cloudinary.com`? How many brands have any cover video? How many trips have any cover video (probably zero today — confirm)? |

### Required findings (numbered F-#)

**Workstream A — Video everywhere inventory:**

- **F-1 — Media-picker surface inventory.** Table with one row per picker invocation: file path + line, surface (brand cover / brand profile / event cover popup / event cover physical / trip cover / other-named), current accept-set (image / gif / video / mixed), upload destination (Cloudinary vs Supabase Storage vs other), post-upload write target (which DB column), and known limitations (max file size, max duration, aspect-ratio enforcement).
- **F-2 — Render-surface inventory.** Table with one row per cover-media render site: file path + line, surface, media-type handling today (does it render video? GIF? image-only?), `<Video>` / `expo-av` / `expo-video` usage if any, autoplay/mute/loop defaults if any.
- **F-3 — Gap matrix.** Cross F-1 and F-2: for each surface, "writes accept video but renders ignore" / "renders support video but no picker writes it" / "full parity" / "no support either side." This is the SPEC-time scope-shaping artifact.

**Workstream B — Pipeline UX inventory:**

- **F-4 — Progress UX.** Walk one full upload cycle on `mingla-business` web preview (Metro 8090, Playwright Chromium). Document every state the user sees from picker tap to final render: spinner copy, percent indicator, intermediate states, error display, retry availability, cancel availability. Screenshot each.
- **F-5 — Picker affordance.** Per F-1 row: what does the user see BEFORE tapping (icon? copy? does it telegraph what's accepted)? Screenshot each.
- **F-6 — Error path.** Force a failure (e.g., upload a 200 MB file or simulate a Cloudinary signing error). What does the user see? Is there a retry? Does the job row get cleaned up?

**Workstream C — Cloudinary lifecycle / cost-control inventory:**

- **F-7 — Raw originals leak.** Confirm operator's 2026-05-25 finding: grep `supabase/functions/` + `mingla-business/src/services/` for any call to Cloudinary's Admin Destroy API (`resources` DELETE, `destroy` API, `delete_resources`) referencing the `event-covers/raw/` path prefix. Expected outcome: zero hits → confirms the leak. Quantify: how many raw originals currently exist on Cloudinary? (Cloudinary Admin API list with `prefix=event-covers/raw/`, but READ ONLY — do not delete.)
- **F-8 — Event-deletion leak.** Find the event-delete code path (likely `supabase/functions/event-delete/index.ts` or a soft-delete RPC; grep `events` table `deleted_at` UPDATE call sites). Confirm: does it call Cloudinary destroy for the cover asset? Expected outcome: no → confirms the leak. Also check: does it call destroy for the raw original?
- **F-9 — Cover-replacement leak.** Find the cover-update code path (UPDATE `events.cover_media_url` call sites). Confirm: when a cover is replaced, does the prior asset get destroyed? Expected outcome: no → confirms the leak.
- **F-10 — Brand cover + trip cover parity.** Same three leak checks for any brand cover or trip cover Cloudinary asset path. Even if these surfaces don't accept video today (per F-1 finding), if they upload IMAGES to Cloudinary, the lifecycle problem applies equally.
- **F-11 — Reconciliation candidate.** Pull Cloudinary Admin API resource list (read-only) + Supabase `events.cover_media_url` + `event_cover_video_jobs` + (when applicable) brand + trip cover columns. Compute: assets-on-Cloudinary-without-a-live-Supabase-row count. This sizes the "periodic reconciliation edge function" scope decision for SPEC.

**Cross-ORCH:**

- **F-12 — ORCH-0964 IMPLEMENT collision map.** Per Phase 0 step 9 ingest: list every file the ORCH-0964 IMPLEMENT will rewrite. For each, note whether ORCH-0978 IMPLEMENT will also need to touch it. This determines our rebase strategy when ORCH-0964 merges.
- **F-13 — Cloudinary API surface inventory + docs URLs.** For every Cloudinary endpoint / parameter / payload / webhook our existing code already calls (Upload API, Admin API, Webhook signature verification, signed URL generation, destroy), list the canonical docs URL. This pre-stages COMMS-0003 compliance for SPEC.

### Hard guards for INVESTIGATE phase

- **Investigation only.** No code edits. No migrations. No edge-function deploy. No SPEC writing yet.
- **No production Cloudinary deletions.** All Cloudinary Admin API calls are READ-ONLY (`GET /resources`, etc.). No destroy, no rename, no overwrite. If a destructive call is needed for evidence, stop and ask.
- **No production Supabase writes.** Mgmt API queries are READ-ONLY (SELECT / `information_schema`). No UPDATE / DELETE / INSERT.
- **Run web preview before claiming behaviour** — per memory rule. Metro on port 8090 for `mingla-business`; load real production data read-only.
- **No fabrication.** Honest "could not verify — needs operator data" beats invented findings.
- **No solutions.** Save them for SPEC. The investigation lays out current truth + gap inventory + cost data; SPEC will choose the fix shape.

### Expected output

`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_VIDEO_UPLOAD_POLISH_AND_CLOUDINARY_LIFECYCLE.md` in the worktree, with sections:

1. Executive summary (5-8 sentences, plain English — the three workstreams' current state in one paragraph each).
2. COMMS-0002 + COMMS-0003 ack stanzas.
3. Phase 0 ingest log (files + commits + memory entries + COMMS read).
4. Five-truth-layer matrix (filled).
5. Findings F-1 through F-13 with evidence (file paths + line numbers + grep output + screenshots + Cloudinary Admin API read-only outputs).
6. Open SPEC questions (3-7 questions that need operator + orchestrator decision before SPEC can be written — esp. around UX scope for workstream B and reconciliation scope for workstream C).
7. Suggested SPEC pipeline (which phases need to land in what order, given the ORCH-0964 collision).
8. No proposed solutions section — explicit "INVESTIGATE only; SPEC deferred to a separate dispatch."

---

## Downstream routing

After this INVESTIGATE returns:
1. Orchestrator REVIEWs (APPROVED / NEEDS WORK / REJECTED).
2. If APPROVED, orchestrator drafts the SPEC dispatch — same skill, SPEC mode — citing inline Cloudinary docs URLs per COMMS-0003.
3. SPEC REVIEW.
4. Operator gate on whether to dispatch IMPLEMENT now or hold until ORCH-0964 merges (per WORLD_MAP intake decision).
5. IMPLEMENT (Codex `implementor-mingla` default; Claude `mingla-implementor` alternate).
6. Orchestrator-owned edge-function deploy (per `feedback_orchestrator_deploys_edge_functions.md` + `feedback_supabase_edge_deploy_verify_first_call.md`).
7. TEST (Claude `mingla-tester` default).
8. CLOSE (with `[deploy]` tag if any Vercel-built web surface was touched — confirm at CLOSE time).

---

## Operator awareness flags

- This is a bundled-3-workstream ORCH per operator directive. Forensics may NOT split it across sub-ORCHs without explicit operator approval.
- ORCH-0964 is in active IMPLEMENT on a parallel worktree. INVESTIGATE phase has no code touch and is safe to run now; SPEC and IMPLEMENT will need rebase coordination after ORCH-0964 PR merges.
- COMMS-0003 is non-negotiable: every Cloudinary API touch in the eventual SPEC cites the canonical docs URL inline.
