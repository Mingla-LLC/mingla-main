# IMPLEMENTATION — ORCH-1303 [venue/brand/trip hero-cover VIDEO upload fails on business WEB — a mangled blob URL]

Phase: IMPLEMENT · Skill: mingla-implementor · Date: 2026-07-04
Worktree: `~/Desktop/mingla-orchs/orch-1303-[web-cover-video-uri]/` on branch `orch-1303-web-cover-video-uri`
Binding contract: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1303_HERO_COVER_VIDEO_WEB_UPLOAD.md` (commit `186b5a79e`)
Fix commit: `7f94c6aaa`
Status: **implemented, partially verified** — runnable gate + pure-logic + source assertions PASS and fails-on-revert PROVEN; jest/tsc/expo unrun in-session (symlinked `node_modules` is partial — see Operator action). Authed-biz-web upload live-fire is the tester's gate.

---

## 1. Summary

On the business **website**, picking a **video** for "Add hero cover" never uploaded — it failed with a cryptic "Failed to fetch". Cause: the shared cover picker took the browser's temporary video link (`blob:https://…`) and wrongly bolted `file://` in front of it (`file://blob:https://…`) — a line written for the phone app that also ran on web. The uploader then tried to open that nonsense address and the browser refused.

The fix passes the browser blob link through **unmangled on web** (exactly like the image path that already works), while the phone app keeps normalizing its real file path (byte-identical). Because the picker is shared, this restores web video cover for **venue deck-readiness, the META-ORCH-1290 wizard Cover step, brand covers, and trip/event covers** in one change. The Bunny video host, its signing edge function, and the web TUS transport were correct and untouched — they were simply never reached. A genuine web upload failure now shows an honest, actionable message instead of "Failed to fetch".

Ships **business WEB only via Vercel** (no OTA; business is native-build-only per COMMS-0052 — native already works via the untouched branch).

---

## 2. SPEC success-criteria coverage

The dispatch is the contract (no separate SPEC file). Criteria mapped to the fix commit `7f94c6aaa`:

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1-Web | Web raw-clip video uri passes UNMANGLED (blob:, no `file://`) to the uploader | ✓ `7f94c6aaa` | `resolveRawClipUploadUri(asset.uri, Platform.OS === "web")` at CoverPicker.tsx call site; pure-logic + jest T-1303-01/02 |
| SC-2-Native | Native behavior byte-identical (still normalizes real file paths) | ✓ `7f94c6aaa` | helper native branch = `normalizeLocalFileUri(assetUri)`; jest T-1303-03/04; native never reaches the branch anyway (`isNative && trimResult===null` early-returns) |
| SC-3 | Downstream web `fetch(input.uri)` succeeds with a `blob:` uri | ✓ (static) | eventCoverVideoProcessingService.ts:988 `fetch(input.uri)` — a raw `blob:` URL is fetchable in the browser; the mangled `file://blob:` was the only thing that rejected. Runtime = tester live-fire |
| SC-4 | Shared across venue / 1290 wizard / brand / trip-event covers (single seam) | ✓ `7f94c6aaa` | one shared `pickVideoCover` seam fixed; no per-target code |
| SC-5 | Honest, actionable message on a genuine web upload failure (Constitution #3) | ✓ `7f94c6aaa` | try/catch around the web fetch → `EventCoverVideoProcessingError("source_upload_failed", <actionable copy>)` |
| SC-6 | Bunny signing / edge / TUS transport untouched | ✓ | zero edits under `supabase/functions/**`; `eventCoverVideoTusPatch*`, `patchTusWithXhr`, intent edge fn unchanged |
| SC-7 | Strict-grep gate locks the invariant (fails-on-revert) | ✓ `7f94c6aaa` | `orch-1303-web-cover-video-uri.mjs` self-test 4/4 + live PASS; revert → exit 1 |

---

## 3. Files changed

| File | ± | What |
|------|---|------|
| `mingla-business/src/components/ui/coverPickerVideoTrimUpload.ts` | +10 | add pure helper `resolveRawClipUploadUri(assetUri, isWeb)` |
| `mingla-business/src/components/ui/CoverPicker.tsx` | +6 −2 | import + call site: `resolveRawClipUploadUri(asset.uri, Platform.OS === "web")` (was `normalizeLocalFileUri(asset.uri)`) |
| `mingla-business/src/services/eventCoverVideoProcessingService.ts` | +14 −2 | wrap web `fetch(input.uri)` in try/catch → honest actionable error |
| `mingla-business/src/components/ui/__tests__/CoverPicker.webClipUri.test.ts` | +79 (new) | happy-path regression (web unmangled / native normalized) + source-lock |
| `.github/scripts/strict-grep/orch-1303-web-cover-video-uri.mjs` | +~200 (new) | CI gate + `--self-test` |
| `.github/workflows/strict-grep-mingla-business.yml` | +14 | registry comment + appended `orch-1303-web-cover-video-uri` job |
| `.github/scripts/strict-grep/README.md` | +1 | registry-table row |
| `mingla-business/package.json` | +1 | `test:orch-1303` script |

No migrations. No edge-function changes. No RLS changes. No new dependencies.

---

## 4. Data-model changes applied

None. Purely client-side uri handling on business web.

## 5. Edge functions touched

None. `event-cover-video-upload-intent` (and every other edge fn) is untouched. `verify_jwt` values unchanged (nothing to preserve because nothing changed).

---

## 6. Regression tests added

- **Happy-path (implementor-owned):** `mingla-business/src/components/ui/__tests__/CoverPicker.webClipUri.test.ts` — 5 tests: web blob uri passes unmangled (no `file://`, no `file://blob:`); web uri stays `blob:`-scheme; native bare path normalized to `file://` (== `normalizeLocalFileUri`); native `file://` path untouched; source-lock that CoverPicker calls `resolveRawClipUploadUri(asset.uri, Platform.OS === "web")` and no longer carries `uri: normalizeLocalFileUri(asset.uri)`.
- **CI gate:** `.github/scripts/strict-grep/orch-1303-web-cover-video-uri.mjs` (`--self-test` 4/4; live PASS).
- **fails-on-revert verified at `7f94c6aaa`** — TRUE LINE DELETION of the fix at BOTH sites (helper body → `normalizeLocalFileUri(assetUri)`; call site → `uri: normalizeLocalFileUri(asset.uri)`) → `orch-1303-web-cover-video-uri.mjs` exits **1** (all 3 rules trip) and jest T-1303-05 source assertion fails; `git checkout` restore → gate exits **0**. Full transcript captured in-session.

**Jest run NOT executed in-session** — the worktree's `node_modules` is a partial symlink to the anchor and is missing `ts-jest` + `@jest/globals` (and `typescript`, `expo`, `react-native`). The test logic was instead verified deterministically: a standalone node replica of `resolveRawClipUploadUri` produced the exact expected outputs (web unmangled, native normalized), and the two source-level assertions were confirmed by grep against the real file. The tester's `npm ci` will run `npm run test:orch-1303` (`CoverPicker.webClipUri`) to close the loop.

---

## 7. Old → New receipts

### coverPickerVideoTrimUpload.ts
**Before:** exposed `normalizeLocalFileUri(path)` only; no web/native uri resolver.
**Now:** adds pure `resolveRawClipUploadUri(assetUri, isWeb)` = `isWeb ? assetUri : normalizeLocalFileUri(assetUri)`.
**Why:** SC-1/SC-2 — a testable seam so web passes the blob uri through and native still normalizes.
**Lines:** +10.

### CoverPicker.tsx
**Before:** raw-clip branch `uri: normalizeLocalFileUri(asset.uri)` — on web mangled `blob:…` → `file://blob:…`.
**Now:** `uri: resolveRawClipUploadUri(asset.uri, Platform.OS === "web")`; import swapped `normalizeLocalFileUri` → `resolveRawClipUploadUri` (the former had no other use in this file).
**Why:** SC-1/SC-4 — restore web video cover across all shared-picker targets; native branch identical.
**Lines:** +6 −2.

### eventCoverVideoProcessingService.ts
**Before:** web branch `const blobResponse = await fetch(input.uri); webBlob = await blobResponse.blob();` — a rejection surfaced a raw "Failed to fetch" to the operator.
**Now:** the fetch+blob read is wrapped in try/catch; on failure throws `EventCoverVideoProcessingError("source_upload_failed", "Could not read the selected video in your browser. Try a shorter MP4, or upload the cover from the Mingla Business app.")`. Happy path unchanged.
**Why:** SC-5 / Constitution #3 — honest, actionable message on a genuine web failure.
**Lines:** +14 −2. (Web-branch only; native `else` path untouched.)

---

## 8. Cross-surface impact

| Surface | Affected | What changes / reason |
|---------|----------|-----------------------|
| Consumer iOS | No | venue/brand authoring is business-only |
| Consumer Android | No | same |
| Buyer/anonymous Web | No | no cover authoring on buyer routes |
| Business iOS | No (byte-identical) | native never takes the raw-clip branch; helper native path == old `normalizeLocalFileUri` |
| Business Android | No (byte-identical) | same |
| Admin Web (adjacent) | No | no cover authoring |
| **Business Web preview (adjacent)** | **Yes — FIXED** | venue deck-readiness + 1290 wizard Cover step + brand + trip/event video covers now upload; honest error on failure. Parity is **automatic** (single shared `pickVideoCover` seam). |

Parity is automatic (shared code) — no manual per-surface duplication.

---

## 9. Smoke result

- Runnable in-session (no RN/Expo/TS deps needed): strict-grep gate `--self-test` **PASS 4/4**; gate live **PASS**; pure-logic replica of the helper **PASS** (web unmangled, native normalized); source assertions **PASS**; fails-on-revert **PROVEN** (gate exit 1 on revert, 0 on restore).
- NOT runnable in-session: `jest`, `tsc --noEmit`, `expo export -p web --clear` — the symlinked `node_modules` is partial (missing `ts-jest`, `@jest/globals`, `typescript`, `expo`, `react-native`). Deferred to the tester's `npm ci`.
- Authed-biz-web upload live-fire (pick a short MP4 for a venue on desktop web → Bunny TUS → processing → hero renders video) is the tester's CLOSE gate — the same named blocker (authed biz-web runtime unreachable) that capped the investigation.

---

## 10. Known issues / deferred

- **D-2 (from investigation):** `.mov`/HEVC clips on web — many iPhone `.mov`/HEVC files can't be decoded by the browser, so `readBrowserVideoDurationMs` returns null → the honest "Could not read this video's duration" toast fires BEFORE upload. This is a real browser limitation, unchanged by this fix and out of scope; the new actionable error copy ("…or upload the cover from the Mingla Business app") points such users to the working native path. Left for the orchestrator to decide whether to add a format-specific message.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required

- **No migration, no edge deploy.** Nothing to `db push` or deploy.
- **Ship vector:** business **WEB only via Vercel `[deploy]`** at CLOSE. **NO `eas update`** (business is native-build-only per COMMS-0052→0063; native already works via the untouched branch and rides the next native build for parity).
- **Tester must `npm ci`** in the worktree, then run: `npm run test:orch-1303` (from `mingla-business/`), `npx tsc --noEmit`, `npx expo export -p web --clear`, and the authed-biz-web video-cover live-fire (venue + 1290 wizard + a brand cover; confirm the hero renders the processed video, per investigation D-3).

---

## 12. Discoveries for Orchestrator

- **D-1 (from investigation, re-affirmed):** ORCH-1300's F-6 "desktop-web video cover upload is functional" is FALSE — it was broken until this fix. Update WORLD_MAP / any doc inheriting that claim.
- **No new side issues found.** The image path, Bunny transport, and edge fn were all confirmed correct and left untouched.
- Comms: no OPEN BLOCK ledger entry addressed to ORCH-1303/implementor/ALL; COMMS-0052 (business native-build-only, no `eas update`) is ACKNOWLEDGED and honored (web-only Vercel ship). No new ledger entry needed (no cross-ORCH discovery).
