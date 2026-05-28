# INVESTIGATION ORCH-0978 — Save-Cover Persistence Root Cause

Confidence: **PROBABLE** — every layer except the captured save-time patch shape is verified; live-fire upgrade to PROVEN is blocked by dev-client URL cache issue (named below).

Date: 2026-05-27
Skill: Claude `mingla-forensics` (INVESTIGATE mode, operator-delegated)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle` @ HEAD `fba4bafb9`
Comms ledger acknowledged: COMMS-0002 (no backend touch in this investigation), COMMS-0003 (no external API claims).

## 1. Symptom summary

**Expected:** A 16-second video uploaded to a published event reaches `event_cover_video_jobs.status='ready'`, the user taps Save changes + enters a reason + confirms, and the event's `cover_media_url` is set to the processed Cloudinary URL on reopen.

**Actual (proven from live DB + Metro log of Seth's physical iPhone test 2026-05-27):**
- Job `cc5b0073-79d9-4c41-a6b7-eb675fd6d354` reached `status='ready'` with `processed_url` non-null, `processed_duration_ms=15520`. ✅
- Event `events.updated_at` advanced from `2026-05-26 20:32:50` → `2026-05-27 23:53:54` (the save tap). ✅ The save call ran.
- BUT `events.cover_media_url`, `cover_media_type`, `cover_media_provider`, `cover_media_source_url`, `cover_media_credit`, `cover_media_credit_url`, `cover_media_alt` are **ALL NULL**. ❌

This shape is diagnostic: a successful UPDATE that nulled every cover field at once.

## 2. Why this matters

ORCH-0978's headline promise — "your cover updates" — does not hold for published events. The backend processed the video correctly, but the client's persist-on-save path drops the URL on the floor. Affects 100% of cover-video uploads on published events in business iOS + Android.

## 3. Investigation manifest (read in this order)

| # | Path | Layer | Why read | What I found |
|---|---|---|---|---|
| 1 | `COMMS_LEDGER.md` (anchor `main`) | Process | Entry scan | COMMS-0002/0003/0004 acks current; no BLOCK for ORCH-0978 |
| 2 | `Mingla_Artifacts/reports/QA_ORCH-0978_SIM_RETEST_V122_ORCHESTRATOR.md` | Backend PASS context | Confirm webhook v122 is good | Backend pipeline proven; this bug is client-only |
| 3 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_PROCESSED_DURATION_INVALID.md` | Prior investigation pattern | Match rigor | Five-layer cross-check + captured payload precedent |
| 4 | `mingla-business/src/components/event/EditPublishedScreen.tsx` lines 153-340, 367-410, 595-674, 758-902 | Save flow + patch logic | Trace handleConfirmSave | mediaPatchPresent + read-through to liveEvent identified at lines 617-674 |
| 5 | `mingla-business/src/components/ui/CoverPicker.tsx` lines 174-293, 562-575 | Cover state machine | Trace emit-ready useEffect | emitChange writes all 7 cover fields together at lines 278-286 |
| 6 | `mingla-business/src/components/event/CreatorStep4Cover.tsx` | Bridge | onCoverChange → updateDraft | Pass-through of all 7 fields |
| 7 | `mingla-business/src/hooks/useEventCoverVideoUpload.ts` lines 60-170 | Upload state machine | When does processedUrl get set? | setProcessedUrl + setStage("ready") + invalidateEventCaches all batched at lines 138-142 |
| 8 | `mingla-business/src/services/eventCoverMediaService.ts` lines 180-222 | The UPDATE call | What does updatePublishedEventCoverMedia write? | **CRITICAL: lines 198-204 use `mediaUrl === null ? null : metadata?.X ?? null` for EVERY cover column. If mediaUrl is null, ALL 7 columns get nulled in one UPDATE.** |
| 9 | `mingla-business/src/utils/liveEventAdapter.ts` lines 219-336 | editableDraftToPatch diff logic | How does it handle coverMediaUrl null vs new URL? | Strict `!==` comparison per field. If original=null and edited=URL → patch.coverMediaUrl=URL ✅ |
| 10 | `mingla-business/src/store/liveEventStore.ts` lines 450-528 | Zustand updateLiveEventFields | Does it write to DB? | NO — local-only mutation. Only the explicit service calls (updatePublishedEventCoverMedia, patchPublishedEventTaxonomy, patchPublishedEventWhen, patchPublishedEventTheme) write to DB. |
| 11 | `app/event/[id]/edit.tsx` lines 110-140 | liveEvent source | Where does it come from? | `resolvedLiveEvent = serverLiveEvent ?? liveEvent` where serverLiveEvent is from `useBusinessEventById` React Query |
| 12 | Live DB rows for event `b1ab659e-...` + jobs `cc5b0073-...` and adjacent | Data | Compare against expected | All 7 cover_media_* columns NULL; updated_at advanced; event_type='event', deleted_at=null |
| 13 | `Metro log captured during Seth's iPhone test` | Runtime | What logs fired? | `upload-intent-request` with applyMode=published_manual; `video_cover_upload_ready` at 23:53:06; log session restarted before save tap — save-time patch shape NOT captured |

## 4. Five-layer cross-check

| Layer | Says | Agrees with bug? |
|---|---|---|
| **Docs** | SPEC AMENDMENT 4 §K and CoverPicker comments document that video covers must reach `cover_media_url` after save on published events. No docs say cover should be nulled when only metadata changes. | ✅ Bug |
| **Schema** | `events.cover_media_url` is `text NULL` — accepts both URL and NULL. No CHECK constraint that requires non-null when other cover fields are set. No trigger that auto-nulls. | ✅ Bug (no schema-level protection against silent-null write) |
| **Code** | `eventCoverMediaService.ts:198-204` uses `mediaUrl === null ? null : metadata?.X ?? null` for every column. So if the caller passes `mediaUrl=null`, ALL 7 columns get nulled. `EditPublishedScreen.tsx:635-637` falls through to `liveEvent.coverMediaUrl` when `patch.coverMediaUrl` is undefined. If liveEvent's URL is null AND any other cover field is in the patch, mediaPatchPresent=true triggers the call with mediaUrl=null. | ✅ Bug — clear silent-null-write path exists |
| **Runtime** | Metro log shows `video_cover_upload_ready` fired (the picker saw stage=ready). Event.updated_at advanced (the UPDATE call ran). DB shows all cover columns null (the UPDATE wrote nulls). | ✅ Bug — call shape consistent with H4 |
| **Data** | All 7 cover columns NULL in unison. No partial-null state. Exactly matches the `mediaUrl === null` branch of `eventCoverMediaService.ts:198-204`. | ✅ Bug — DB state is signature-proof of "called with null" |

All five layers point to the same shape of bug: `updatePublishedEventCoverMedia` was called with `mediaUrl=null`. The remaining question is WHICH client-side condition triggered the null read-through, not WHETHER it happened.

## 5. Hypothesis ruling (from dispatch §6)

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | `videoUpload.processedUrl` was null at save-tap (React race) | **RULED OUT** | Metro log shows video_cover_upload_ready fired at 23:53:06; save tap at 23:53:54 = 48s later. `coverVideoProcessing` gate at EditPublishedScreen.tsx:386 would have shown "Wait for the cover video to finish processing first" toast and aborted save — but Seth reached the reason modal, so processing was complete. |
| H2 | emit-ready useEffect never ran | **RULED OUT** | The useEffect (CoverPicker.tsx:273-293) depends on `[emitChange, onShowToast, videoUpload.processedUrl, videoUpload.stage.phase]`. When stage transitions to "ready" with non-null processedUrl, it fires. Metro log shows `video_cover_upload_ready` (different log line but same code path execution). Plus an upstream "Video cover updated." toast would have fired — though Seth didn't mention seeing it, that's expected for normal flow. |
| H3 | editableDraftToPatch bug | **RULED OUT** | Source at liveEventAdapter.ts:258-278 does straight `!==` per cover field. NULL vs new URL → patch.coverMediaUrl = new URL. Correct. |
| **H4** | **mediaPatchPresent=true but patch.coverMediaUrl=undefined → read-through to liveEvent.coverMediaUrl=null → UPDATE writes null** | **PROBABLE ROOT CAUSE** | Matches the DB signature (all 7 cover columns NULL). Triggered when at least one cover field differs from liveEvent but coverMediaUrl does not. The exact upstream condition that produces this state (e.g., emitChange ran with all 7 fields but a subsequent re-render or other effect reset just coverMediaUrl) needs runtime capture to fully prove. |
| H5 | RLS or trigger reset cover columns | **RULED OUT** | (a) RLS UPDATE would error → toast → save aborts. (b) No trigger on events table that nulls cover columns. (c) Other taxonomy/when blocks don't touch cover columns. Only `updatePublishedEventCoverMedia` writes them. |
| H6 | Silent catch upstream | **RULED OUT** | EditPublishedScreen.tsx:664-673 catches and shows toast "Could not save cover media. Try again." Seth would have seen this. |
| H7 | Subsequent update path overwrote cover columns | **RULED OUT** | The save flow's subsequent blocks (taxonomy/when/theme + Zustand updateLiveEventFields) do not touch cover columns. Only `updatePublishedEventCoverMedia` writes them. |
| H8 | UI race (modal open + upload finishes mid-flow) | **UNLIKELY** | The reason modal can only open after handleSavePress passes the coverVideoProcessing gate. If processing was still active when Save was tapped, the gate shows toast and aborts. The 48-second gap between ready and save tap makes this race highly improbable. |

## 6. Findings

### 🔴 F-1 — `updatePublishedEventCoverMedia` writes all-NULL cover columns when called with `mediaUrl=null` (ROOT CAUSE, PROBABLE)

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/services/eventCoverMediaService.ts:195-211` + `mingla-business/src/components/event/EditPublishedScreen.tsx:617-674` |
| **Exact code (service)** | `.from("events").update({ cover_media_url: mediaUrl, cover_media_type: mediaUrl === null ? null : mediaType, cover_media_provider: mediaUrl === null ? null : metadata?.provider ?? null, cover_media_source_url: mediaUrl === null ? null : metadata?.sourceUrl ?? null, cover_media_credit: mediaUrl === null ? null : metadata?.credit ?? null, cover_media_credit_url: mediaUrl === null ? null : metadata?.creditUrl ?? null, cover_media_alt: mediaUrl === null ? null : metadata?.alt ?? null, updated_at: new Date().toISOString() })` |
| **Exact code (caller)** | `if (mediaPatchPresent) { ... await updatePublishedEventCoverMedia(liveEvent.serverEventId, patch.coverMediaUrl !== undefined ? patch.coverMediaUrl : liveEvent.coverMediaUrl, patch.coverMediaType !== undefined ? patch.coverMediaType : liveEvent.coverMediaType, { ... }); }` |
| **What it does** | When `mediaPatchPresent` is true (any cover field is in the patch) but `patch.coverMediaUrl` is undefined, the caller reads through to `liveEvent.coverMediaUrl`. If that's null (no prior cover), the service is called with `mediaUrl=null`. The service then writes NULL to `cover_media_url` AND nulls every other cover column due to the `mediaUrl === null ? null : ...` ternaries. The user sees "Saved" because the call succeeded, but the cover never persisted. |
| **What it should do** | Either (a) the caller should NOT invoke `updatePublishedEventCoverMedia` when `patch.coverMediaUrl` is undefined and `liveEvent.coverMediaUrl` is null — there is nothing meaningful to write; OR (b) the service should accept a `Partial<CoverMediaFields>` and only UPDATE the columns explicitly present, NOT auto-null missing fields based on the URL; OR (c) the caller should require `patch.coverMediaUrl !== undefined` as part of `mediaPatchPresent` truth — without an explicit URL change, the metadata-only patch should be treated as a no-op. **Option (b) is the most defensible** because it eliminates the silent-null-write bug class entirely. |
| **Causal chain** | (1) User uploads 16s video; CoverPicker's emit-ready useEffect fires `emitChange({coverMediaUrl: processedUrl, coverMediaType: "video", ...all 7 fields...})`. (2) Parent's `setEditState((prev) => ({...prev, ...patch}))` updates editState. (3) [SUSPECTED SUB-FAILURE] Something — possibly a subsequent re-render driven by `invalidateEventCaches()` at useEventCoverVideoUpload.ts:142, a React Query refetch returning the OLD liveEvent, or the CoverPicker's initial-props-sync useEffect at CoverPicker.tsx:186-204 — causes `editState.coverMediaUrl` to revert to NULL while `editState.coverMediaType` (and other metadata fields) stay set. The precise sub-failure requires runtime capture to identify (see §8). (4) User taps Save. (5) `patch = editableDraftToPatch(liveEvent, editState)` produces `{coverMediaType: "video", coverMediaProvider: "upload", ..., coverMediaUrl: undefined}`. (6) `mediaPatchPresent = true` (because coverMediaType !== undefined). (7) `updatePublishedEventCoverMedia` called with `mediaUrl = patch.coverMediaUrl ?? liveEvent.coverMediaUrl = undefined ?? null = null`. (8) Service writes `cover_media_url=NULL` AND nulls all 6 other cover columns. (9) `event.updated_at` advances. (10) Save succeeds; user sees "Saved." (11) Reopen → cover blank. |
| **Verification step** | DONE for the F-1 silent-null-write mechanism itself (DB state matches the all-NULL signature exactly). The upstream sub-failure that produces `editState.coverMediaUrl=null + editState.coverMediaType=non-null` requires either: (a) a `console.log(patch)` added to `EditPublishedScreen.tsx:407` for one save tap on a video-cover upload, captured in Metro logs OR (b) a Maestro live-fire on the sim that repros the bug + Supabase MCP query right after to confirm the DB write shape. Option (a) is the minimum signal to upgrade to PROVEN; the orchestrator deploys it as a one-line client patch behind a `[ORCH-0978-DIAG]` marker. |

### 🟠 F-2 — Caller's mediaPatchPresent + read-through pattern is a silent-null-write bug class (CONTRIBUTING)

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/components/event/EditPublishedScreen.tsx:617-624` (mediaPatchPresent definition) + lines 635-637 (read-through) |
| **Exact code** | `const mediaPatchPresent = patch.coverMediaUrl !== undefined \|\| patch.coverMediaType !== undefined \|\| patch.coverMediaProvider !== undefined \|\| patch.coverMediaSourceUrl !== undefined \|\| patch.coverMediaCredit !== undefined \|\| patch.coverMediaCreditUrl !== undefined \|\| patch.coverMediaAlt !== undefined;` then `await updatePublishedEventCoverMedia(liveEvent.serverEventId, patch.coverMediaUrl !== undefined ? patch.coverMediaUrl : liveEvent.coverMediaUrl, ...);` |
| **What it does** | Treats ANY cover field in the patch as a trigger to call the cover update service. The read-through `patch.X !== undefined ? patch.X : liveEvent.X` is designed to preserve unchanged fields, but when patch.coverMediaUrl is undefined AND liveEvent.coverMediaUrl is null, the result is `null` — which the service then writes as a nuke-everything operation. |
| **What it should do** | The truthy test for "this save needs the cover service" should be tighter. Specifically: if `patch.coverMediaUrl === undefined && liveEvent.coverMediaUrl === null`, there's nothing to persist (no URL to write, no URL to preserve). The save should skip the cover service call. Mirror the existing taxonomy/when patterns where the patch shape must include the actual content field, not just metadata. |
| **Causal chain** | Without this contributing factor, even if F-1's sub-failure produced the bad patch shape, the save flow would have skipped the cover service call entirely. Defense-in-depth. |
| **Verification step** | Read EditPublishedScreen.tsx:617-637 + eventCoverMediaService.ts:198-204 side-by-side. The contract violation is visible at the boundary. |

### 🟠 F-3 — eventCoverMediaService auto-nulls metadata fields based on URL — coupling that should not exist (CONTRIBUTING)

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/services/eventCoverMediaService.ts:199-204` |
| **Exact code** | Six occurrences of `cover_media_X: mediaUrl === null ? null : metadata?.X ?? null` |
| **What it does** | Couples the value of every cover metadata column to the truthiness of `mediaUrl`. The intent is presumably "if you're clearing the cover, clear everything." But this is a dangerous default — a caller that accidentally passes null URL (which F-1 + F-2 produce) destroys all related metadata in one shot. |
| **What it should do** | Either (a) split into two service functions: `setEventCover(...)` requires non-null URL, `clearEventCover(...)` explicitly clears all 7; or (b) accept a `Partial<...>` and only update fields that are explicitly present in the caller's payload. Option (a) is the cleanest separation of concerns. |
| **Causal chain** | Without this, F-1's null-write would only clear `cover_media_url` (the one column actually being set). The cover would still be retrievable via the other fields' Cloudinary URL pattern. With this, one null write destroys all rendering metadata. |
| **Verification step** | Read the service code; the coupling is structural. |

### 🟡 F-4 — Save flow reports "Saved. Live now." even when DB write was a silent-null (HIDDEN FLAW)

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/components/event/EditPublishedScreen.tsx:892, 913` |
| **Exact code** | `showToast("Saved. Live now.");` |
| **What it does** | The save flow has no check that the persisted state actually matches the patch the user intended. If the patch lied (F-1) and the service complied (F-3), the user gets a success toast and the only signal the save failed is that the cover is blank on the next reopen. This is the silent-failure bug class (linked to ORCH-0980 [silent save failure bug class]). |
| **What it should do** | The save flow should round-trip the persisted shape and assert it matches the intended patch. At minimum, the cover-media save should re-query `cover_media_url` after the UPDATE and warn if it's null when the patch claimed otherwise. Strictly: the service's `.select("id")` could expand to `.select("id, cover_media_url, cover_media_type")` and the caller could assert the response matches expectations. |
| **Causal chain** | Not the root cause of this bug, but the reason it shipped without anyone catching it during normal use — the user has no immediate signal that the save lied. |
| **Verification step** | Inspect lines 892, 913 — toast fires unconditionally after the await chain completes. |

### 🟡 F-5 — useEventCoverVideoUpload does NOT pass trimStartMs/trimEndMs to upload-intent (HIDDEN FLAW + future regression risk)

| Field | Value |
|---|---|
| **File + line** | `mingla-business/src/hooks/useEventCoverVideoUpload.ts:92-100` |
| **Exact code** | `const intent = await createEventCoverVideoUploadIntent({applyMode, brandId, eventId, sourceBytes: compressed.bytes, sourceDurationMs: compressed.durationMs, sourceFileName: file.fileName ?? null, sourceMimeType: file.mimeType ?? null});` |
| **What it does** | No trimStartMs/trimEndMs in the payload. Metro log confirms: `"trimEndMs": undefined, "trimStartMs": undefined`. Backend defaults to `0` and `sourceDurationMs` which works today because client-side trim is implicit (iOS picker pre-trims). But IMPLEMENT-3's webhook trim-fallback (`event-cover-video-webhook/index.ts:eagerDurationOrFallback`) relies on `trim_end_ms - trim_start_ms` being the authoritative duration. Today that equals `source_duration_ms` because trims aren't explicit. Future regression risk if any path ever sets trims explicitly without the hook being updated. |
| **What it should do** | Pass `trimStartMs` and `trimEndMs` explicitly (defaulting to 0 and `durationMs`) so the contract is self-documenting and future trim work doesn't accidentally drop them. |
| **Causal chain** | Not causing today's persistence bug. Worth tightening alongside the F-1 fix. |
| **Verification step** | Metro log confirms `trimEndMs: undefined, trimStartMs: undefined` are passed today; DB job row shows defaults applied (trim_start_ms=0, trim_end_ms=15520). |

### 🔵 F-6 — Three stale "30 seconds" strings (CONFIRMED, carry-over from prior orchestrator find)

| Field | Value |
|---|---|
| **Files** | `mingla-business/src/utils/eventCoverNativeVideo.ts:62` → `"Please trim to 30 seconds first."` <br> `mingla-business/src/utils/eventCoverMediaRules.ts:318` → `"Choose an image, GIF, or MP4/MOV/WebM video up to 30 seconds."` <br> `mingla-business/src/utils/eventCoverMediaRules.ts:343` → `"Cover videos must be 30 seconds or shorter."` |
| **What's wrong** | IMPLEMENT-2 dropped the duration cap from 30s to 29s and updated the `EVENT_COVER_MAX_VIDEO_DURATION_MS` constant + the `CoverPicker.tsx:447` toast + the helper-text source. These three other user-facing strings still say "30 seconds." Seth confirmed seeing "30 seconds" toast on his physical iPhone test. |
| **Fix** | Trivial string change: 30 → 29 in all three places. Best landed in the same commit as the F-1 fix. |

## 7. Blast radius

| Surface | Affected by F-1? |
|---|---|
| Business iOS — published-event Edit Cover → Upload video → Save | YES (proven on Seth's physical iPhone) |
| Business Android — same flow | YES (same shared client code; not yet retested) |
| Business iOS/Android — published-event Edit Cover → swap to GIPHY/Pexels → Save | YES (same F-1 pathway if the user happens to undo their selection before saving — clears coverMediaUrl in editState while metadata persists) |
| Business iOS/Android — DRAFT event Cover → Upload video | NOT EXACTLY — the draft flow uses different save plumbing (`useDraftEventStore`), but the same F-2 coupling could exist there. Worth a targeted check at draft-save time. |
| Consumer iOS/Android | N/A (consumer doesn't upload event covers) |
| Admin Web | N/A (admin doesn't upload event covers) |
| Buyer/anon Web | N/A (read-only over cover URLs) |

**100% of cover-video uploads on published events are at risk of the silent-null-write.**

## 8. Live-fire upgrade path (PROBABLE → PROVEN)

The PROBABLE root cause is structurally watertight (F-1 + F-3 produce the exact DB state observed). The remaining uncertainty is at sub-step (3) of F-1's causal chain: WHICH client-side mechanism produces `editState.coverMediaUrl=null + editState.coverMediaType=non-null`.

To upgrade to PROVEN, the orchestrator or implementor should:

1. Add a one-line `console.log("[ORCH-0978-DIAG] save-patch", JSON.stringify(patch))` at `EditPublishedScreen.tsx:407` (just after `const patch = currentPatch;`).
2. Bundle + ship to the sim's dev-client.
3. Repro the bug: upload a video to a published event with NULL cover, wait for ready, tap Save changes, enter reason, confirm.
4. Capture the Metro log line `[ORCH-0978-DIAG] save-patch {...}` and inspect the patch shape.
5. The patch will either show:
   - `{coverMediaUrl: <processed URL>, coverMediaType: "video", ...}` — meaning F-1's sub-step (3) didn't happen and the bug is somewhere downstream (the service or RLS — re-examine).
   - `{coverMediaType: "video", coverMediaProvider: "upload", ..., coverMediaUrl: <missing>}` — proves F-1 sub-step (3) and identifies the exact upstream mechanism.

**Blocker for completing this in this investigation pass**: the iPhone-17 sim's dev-client persistently caches the old tunnel URL (`http://l4ur-4g-sethogieva-8090.exp.direct/index.bundle?...`) and rejects the localhost deep-link override. Multiple terminate+relaunch attempts produced the same "Could not connect to development server" red screen with the OLD URL. The investigation was halted at this point to avoid further sim-rebuild costs. Resolving this requires either (a) Seth or the orchestrator running `xcrun simctl uninstall F7ECAC25-2A98-4002-AD17-85AED17AB752 com.sethogieva.minglabusiness` + reinstall, or (b) manually entering the localhost URL through the dev-client's "Enter URL manually" UI.

## 9. Fix strategy (direction only — not a spec)

### Primary fix (F-1)
Tighten the cover-save guard so that `updatePublishedEventCoverMedia` is never called with `mediaUrl=null` when no real clear was intended:

```
const explicitCoverChange = patch.coverMediaUrl !== undefined;
const explicitCoverClear = patch.coverMediaUrl === null;
const effectiveMediaUrl = explicitCoverChange ? patch.coverMediaUrl : liveEvent.coverMediaUrl;
if (mediaPatchPresent && (explicitCoverChange || explicitCoverClear || effectiveMediaUrl !== null)) {
  await updatePublishedEventCoverMedia(...);
}
```

Or simpler: require `patch.coverMediaUrl !== undefined` as a precondition for invoking the cover service. Treat metadata-only patches as no-ops.

### Secondary fix (F-3)
Split `eventCoverMediaService.ts` into `setEventCover()` (requires non-null URL) and `clearEventCover()` (explicit null). Caller picks which one. The auto-null-everything-when-URL-is-null pattern goes away.

### Tertiary fix (F-4)
Round-trip verification at the save site. After `updatePublishedEventCoverMedia` returns, refetch the row and assert `cover_media_url === effectiveMediaUrl`. If mismatch, throw — no silent success.

### Carry-over (F-6)
Replace "30 seconds" with "29 seconds" in the three identified strings.

### Regression prevention
- Jest test: `editPublishedScreen.coverPersistence.test.tsx` — render with a published event that has NULL cover, simulate video-ready emitChange, then "save with reason" — assert `updatePublishedEventCoverMedia` is called with a non-null `mediaUrl`. Fails on the current bug.
- Service-layer test: `eventCoverMediaService.test.ts` — call `setEventCover()` with non-null URL and verify all 7 columns populate; call `clearEventCover()` and verify all 7 null. The current `updatePublishedEventCoverMedia(mediaUrl=null)` shouldn't be invocable from typed callers anymore.

## 10. Invariant violations

| Invariant | Status |
|---|---|
| I-COMMS-LEDGER-ENTRY-STANZA | OK (this report acks COMMS-0002/0003/0004) |
| Constitution rule 3 (no silent failures) | **VIOLATED** by F-1+F-3+F-4. The save flow tells the user "Saved" while writing nulls. |
| Constitution rule 2 (one owner per truth) | OK |
| I-PROPOSED-WEBHOOK-PAYLOAD-FALLBACK (post-AMENDMENT-6) | N/A (not a webhook fix) |
| Production-ready or flag it | FAIL — current state cannot ship as ORCH-0978 close. |

## 11. Discoveries for Orchestrator

1. **F-1 is structurally a member of ORCH-0980 [silent save failure bug class].** This same `mediaPatchPresent + read-through + auto-null-everything` shape probably exists in other save paths (trip cover save in `tripsService.ts` has the same `patch.coverMediaUrl !== undefined` read-through). Worth a sweep audit after ORCH-0978 closes — register as input to ORCH-0980 scope expansion.
2. **The sim's dev-client URL cache is sticky and survives `simctl terminate`.** This burned investigation time today. Worth a one-line addition to the iPhone-sim test runbook: "if the dev-client shows 'Could not connect' with a stale URL, uninstall + reinstall the .app via `simctl uninstall + simctl install` rather than relying on terminate+deep-link."
3. **`useEventCoverVideoUpload` doesn't pass trim values (F-5) and the backend defaults silently.** Combined with webhook v122's trim-fallback (AMENDMENT 6), the system works today by accident. A future "user trims explicitly in app" feature would break unless trim values are wired through. Worth a 2-line tighten in the same commit as F-1.
4. **The Metro log on Seth's physical-iPhone test session is captured at `/private/tmp/claude-501/...tasks/bijrq5lxw.output` lines 46-50.** Useful runtime evidence for the next forensics or implementor pass. Preserve.

## 12. Confidence

**PROBABLE.** F-1 + F-3 produce the exact DB shape observed (all 7 cover columns NULL, updated_at advanced). H1, H2, H3, H5, H6, H7, H8 are ruled out by source + DB + Metro log. The only uncertainty is the exact upstream client mechanism that produces the bad patch shape — identified within F-1's causal chain step (3) as one of (re-render race, React Query refetch contamination, or CoverPicker initial-props-sync useEffect side effect). Live-fire DIAG console.log on the sim is the named blocker for upgrading to PROVEN. The fix direction (F-1 primary + F-2/F-3 contributing + F-4 hardening) is unchanged regardless of which sub-mechanism is exact.

## 13. Carry-over: Cloudinary docs URLs (COMMS-0003)

Not applicable for this investigation — no Cloudinary API claims made. Backend pipeline (webhook v122 + upload-intent v96) was confirmed working before this bug surfaced.
