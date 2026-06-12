# TEST — ORCH-1119 — Trip itinerary days: optional per-day media gallery

**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1119-[trip-day-media-gallery]` · branch `ORCH-1119-trip-day-media-gallery`
**Tested HEAD:** `012124a09` (rebased onto `origin/main`; was `37a6a94b4` pre-rebase — the 6 commits behind were all COMMS-ledger doc commits, zero product conflict).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1119_TRIP_DAY_MEDIA_GALLERY.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1119_TRIP_DAY_MEDIA_GALLERY.md`
**Live project:** `gqnoajqerqhnvulmnyvv`

---

## 1. Verdict + P0–P4 count

**VERDICT: CONDITIONAL PASS** — zero P0, zero P1. Two P3 notes, two P4. Regression gate satisfied (implementor happy-path fails-on-revert independently reproduced + tester adversarial on a different angle, both on-branch + in-diff). DB + RPC + RLS + anon-web surfaces are **runtime/live-fire PROVEN**. The business-app **authoring UI walkthrough (SC-2/SC-3 device upload)** and the **consumer native one-playing autoplay (SC-4)** could NOT be driven to `proven` in this parallel-session environment (brand-owner auth credentials + sim photo-library video are human-in-the-loop) — they sit at **`probable`** (source-complete, dead-tap-safe by the conditional-mount pattern, bundle compiles end-to-end, error paths surface friendly toasts).

**The CONDITIONAL is:** Seth (or an authenticated session) confirms the on-device authoring round-trip + the consumer native autoplay-one-at-a-time, OR explicitly accepts deferring that device proof to the OTA smoke-test at CLOSE. **Nothing found blocks CLOSE on correctness** — every layer I could live-fire is clean and the un-driven surfaces are source-proven safe (not dead-tap-suspect).

P0: 0 · P1: 0 · P2: 0 · P3: 2 · P4: 2

---

## 2. SC-by-SC matrix

| SC | Verdict | Tier | Evidence |
|----|---------|------|----------|
| **SC-1 (DB column + CHECK + backfill)** | PASS | proven (live) | Live `information_schema`: `media jsonb NOT NULL DEFAULT '[]'::jsonb`. `pg_constraint`: `trip_days_media_is_array CHECK ((jsonb_typeof(media) = 'array'))`. Backfill: 15/15 rows `media='[]'`. Both migrations recorded in `schema_migrations` (`20260928000000`, `…001`). |
| **SC-2-iOS / SC-2-Android (authoring round-trip)** | CONDITIONAL | probable | Source dead-tap-safe: `onAddMedia` → `setMediaSheetDayIndex(index)` → sheet conditionally mounted as host child (`mediaEnabled && mediaSheetDayIndex !== null`, Step2:186-196) — NOT the ORCH-1103 self-unmount trap. Wizard threads `brandId`/`eventId={trip.id}`/`onShowToast` (Wizard:1184-1186) → `mediaEnabled=true`. Autosave threads `media` (Wizard:`autosaveStep2`). Re-seed via `tripToDaysDraft` (`media: d.media ?? []`). DB-layer round-trip PROVEN (SC-6 live §5b upsert persisted a typed gallery). **Not driven on device** (auth + sim video = HITL). |
| **SC-3 (video upload + reject)** | PASS (logic) / CONDITIONAL (live upload) | proven (logic) / probable (live) | `tripDayMediaService.ts`: unsupported MIME → `BrandCoverError("unsupported_type", "Choose a JPEG, PNG, WebP, GIF, MP4, MOV, or WebM.")` BEFORE `.upload()`; >25 MB → `file_too_large` ("…under 25 MB.") at BOTH pre-read (metadata) + post-read (byteLength). Explicit-but-unsupported MIME does NOT fall back to extension (blocks `.txt`-renamed-`.mp4`). Sheet web path aggregates skipped files into a visible toast (Sheet:312/316). No silent failure (Constitution #3). Unit test asserts reject-precedes-upload. **Live storage upload of a real >25 MB clip = device + auth (HITL).** |
| **SC-4-iOS / SC-4-Android (consumer display)** | CONDITIONAL | probable | Source: single screen-level `activeVideoKey` ⇒ at most ONE `playbackActive={true}` across the whole itinerary (stronger than per-day); keys `${day.id}-${mi}` unique; gallery gated on `day.media.length > 0` ⇒ zero nodes for empty (Constitution #9). Consumer bundle compiles end-to-end (4.77 MB, zero Metro errors). Behavioral replica test (one active key ⇒ exactly one playing) passes. **Native autoplay one-at-a-time not driven** (consumer app needs auth + a seeded scheduled trip with media). |
| **SC-5-Web (anon buyer)** | PASS | **proven (live headless browser)** | Real headless Chrome (Playwright, NO auth context) on `http://localhost:8091/t/travelbrand/the-dc-adventure` (anon public trip page, ORCH-1119 web bundle) with a temporarily-seeded 2-item day-1 gallery → DOM rendered aria-labels `["Day 1 media gallery","Day 1 media 1, image","Day 1 media 2, video"]`; Day 2 + Day 3 (`media:[]`) rendered NO `media gallery` node. Zero console errors. Screenshot shows the 2-tile gallery row under DAY 1, no row under DAY 2/3. Live DB restored to `[]` after. |
| **SC-6 (published-edit additive, never blocked by sales)** | PASS | **proven (live-fire RPC)** | Live-fired `biz_update_live_trip` as the impersonated brand owner on the SOLD trip `060d0483…` ("The DC Adventure", **24 orders**), media-only day change + valid reason → `{ok:true, severity:"material", changed_keys:["days"], affected_order_count:24}`. NOT blocked by `days_dropped_with_sales`. Media persisted (`day1.media=[{url,type:"video"}]`). Client change-summary additive (`computeRichTripFieldDiffs` → "Photos/videos updated", `severity:"additive"`). D-2 pre-resolved: RPC `severity:"material"` is acceptable (the load-bearing guarantee is not-blocked + additive client summary). Live DB + test edit_log row restored after. |
| **SC-7 (Constitution #9 — media:[] ⇒ zero nodes)** | PASS | proven | Web: live headless render showed gallery ONLY on the media-bearing day (SC-5). Consumer/editor: gated on `media.length > 0` (source + behavioral test). Coercer drops malformed → no fabricated gallery. |
| **SC-8 (no scope leak)** | PASS | proven | `git diff origin/main` of `ExperienceStopPhotoSheet.tsx`, `experienceStopImageService.ts`, `useEventCoverVideoUpload.ts`, `eventCoverVideoProcessingService.ts`, `packages/event-rendering/*` = EMPTY. Only the 2 new migrations added. |

---

## 3. Findings (P-numbered)

### P3-1 — SC-2/SC-3/SC-4 device-UI firing not driven to `proven` (environment-limited, not a code defect)
- **Evidence:** The business dev build + consumer dev build are installed on the iPhone 17 Pro sim and a physical Samsung is ADB-connected, but reaching the trip-create Step 2 (and the consumer trip detail) requires a brand-owner authenticated session (Apple/Google/Email OTP) + a sim photo-library video — both human-in-the-loop. The ORCH-1119 business + consumer bundles were confirmed to **compile end-to-end** from this worktree's Metro (business 6.27 MB incl. `trip-day-media` storage-key literal, consumer 4.77 MB, zero transform errors), and the dead-tap path is source-safe (conditional-mount, not the ORCH-1103 self-unmount trap).
- **Impact:** The "+ Add media" tile firing, picker open, image+video add/reorder/remove, autosave persistence, and native autoplay-one-at-a-time are `probable`, not `proven`.
- **Required fix:** None (code). Drive on device with an authenticated brand-owner session, OR accept the OTA smoke-test at CLOSE as the device gate.
- **Retest:** Sign into the business app (brand owner of a draft trip) → trip create → Step 2 → tap "+ Add media" on a day → confirm the sheet opens, add a device image + video, reorder, remove, advance/return → media survives; publish → reopen shows media. Consumer: open a scheduled trip with media → confirm one video plays at a time.

### P3-2 — Consumer/web gallery is tap-to-play, not autoplay-in-view (defensible UX deviation from §4.6a wording)
- **Evidence:** `ConsumerTripDetailScreen.tsx:191` initial `activeVideoKey=null` ⇒ NO video autoplays until tapped (each shows a play badge). SPEC §4.6a says "only the in-view/tapped tile gets `playbackActive`". Web `TripPreview` DOES auto-activate the first video (`activeVideoKey===null ? firstVideoIndex`). So consumer = tap-to-play; web = first-autoplays. Both honor the load-bearing rule "at most one playing".
- **Impact:** Minor cross-surface inconsistency in default autoplay; the SC-4 invariant ("at most one at a time") holds on both.
- **Required fix:** None required (both satisfy "at most one"). Optional polish: align consumer to also auto-activate the first in-view video. Orchestrator may accept as-is.
- **Retest:** Confirm on device that at most one consumer video ever plays simultaneously.

### P4-1 (praise) — `coerceTripDayMedia` is a clean, hostile-input-resistant sanitizer
Drops non-arrays, non-objects, missing/empty/non-string url, non-`image|video` type, and strips non-whitelisted keys. Survived my full adversarial battery (proto-pollution attempt, String-wrapper url, number/array/object types, 10k mixed array) with zero leakage. This is the right data-integrity gate for the anon-readable column.

### P4-2 (praise) — Upload error handling is exemplary (Constitution #3)
Every failure path in `tripDayMediaService.ts` + `TripDayMediaSheet.tsx` surfaces a user-facing `BrandCoverError.message`/`onShowToast` with friendly copy; reject precedes upload; web per-file skips aggregate into a visible toast. No silent failures.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Reproduced at the tested HEAD `012124a09` (true line deletion in the REAL source, then restored):

- **Draft path:** deleted `media: d.media ?? []` from `upsertTripDays` (tripsService.ts) → implementor test `orch1119_trip_day_media_persistence.test.ts` assertion **"upsertTripDays INSERT row object includes a media key" FAILED**.
- **Published-edit path:** replaced `media = EXCLUDED.media` → `narrative = EXCLUDED.narrative` in `20260928000001_…live_trip_media.sql` → assertion **"biz_update_live_trip §5b migration upserts media" FAILED**.
- Both restored → **9/9 PASS**.
- **Consumer half:** replaced `day.media.length > 0` → `false` in `ConsumerTripDetailScreen.tsx` → consumer test assertion **"T3 consumer gallery is gated on day.media.length > 0 (Constitution #9)" FAILED**; restored → **11/11 PASS**.

Implementor's fails-on-revert claim **independently verified true.**

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/src/services/__tests__/orch1119_coerce_media_boundary.tester_adversarial.test.ts` (NEW, append-only, marked `[TEST-MOD-APPROVED ORCH-1119]`).
- **Angle (distinct from both implementor tests):** attacks the ACTUAL `coerceTripDayMedia` data-integrity boundary by **extracting + executing the REAL `tripsService.ts` source bytes** (not a hand-copied replica like the implementor's consumer test). 7 hostile cases the implementor did not cover: `type` as number/array/object/null/bool/wrong-case/`"gif"`/trailing-space; `url` as number/empty/String-wrapper/null/array; non-object items; **prototype-pollution attempt** (`__proto__` via JSON.parse, asserts no global pollution); extra-key stripping (`evil`/`onLoad` dropped); a 10k interleaved-poison array (no throw, only well-formed survivors, every survivor carries an explicit valid type); non-array raw → `[]`.
- **Result:** 7/7 PASS.
- **fails-on-revert verified at `012124a09`:** deleting the real `if (type !== "image" && type !== "video") continue;` guard in `tripsService.ts` → assertion "type as non-string-literal is DROPPED" **FAILED** (poisoned items survived); restored → 7/7 PASS.
- **In closing diff:** committed to the branch (`012124a09`); `git diff origin/main --name-only` includes both the implementor's two tests, the type-fixture mod (`publishedTripEditGuards.test.ts`, marker in commit body), and this adversarial test.

---

## 6. Regression baseline confirmation (self-verified, not taken on faith)

Ran the affected suites on the branch AND on the clean anchor `main` (`02411e2ea` = origin/main):

| Scope | Branch (`012124a09`) | Anchor (`02411e2ea`, clean) | Verdict |
|---|---|---|---|
| `src/components/trip` + `tripAdapter` | 10 suites failed, 8 passed; 27 tests failed, 260 passed (287 total) | **IDENTICAL**: 10 failed, 8 passed; 27 failed, 260 passed (287 total) | Same failure set — ORCH-1119 adds ZERO new failures |
| 4 named suites (`tripsService`, `EditPublishedTripScreen.save`/`.refundGate`, `TripCreatorWizard.cover`, `publicEventsService.tripFetch`) | 4 failed, 42 passed | **IDENTICAL**: 4 failed, 42 passed | Pre-existing |

Pre-existing failures (NOT ORCH-1119): `@mingla/event-rendering` unresolved in jest (monorepo path); drifted source-grep "contract" tests (six-sections count, cover providers, publish-RPC name); `tripsService.test.ts` mock missing an RPC stub. Confirmed present on clean origin/main. Recorded as a Discovery for a cleanup ORCH.

The two ORCH-1119 happy-path tests (`orch1119_*`) = 9/9 + 11/11 PASS. My adversarial = 7/7 PASS. Consumer/business typecheck of the touched files is clean (the tsc errors enumerated are all pre-existing Deno-style test files + unrelated `BoardDiscussion`/`packages` files, none in the ORCH-1119 touched set).

---

## 7. Constitution 14-rule matrix (independently re-checked against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS (probable on device) | "+ Add media" wired to a conditionally-mounted sheet via host-child pattern (Step2:186-196); not the ORCH-1103 self-unmount trap. Device firing = probable (P3-1). |
| 2 | One owner per truth | PASS | `trip_days.media` is the single source; `upsertTripDays` (draft) + `biz_update_live_trip §5b` (published) are the only writers; reads coerce via the one `coerceTripDayMedia`. |
| 3 | No silent failures | PASS | Every upload/pick failure → friendly `BrandCoverError.message`/toast (P4-2). |
| 4 | One query key per entity | N/A | No new query-key factory; rides existing trip query keys. |
| 5 | Server state server-side | PASS | `activeVideoKey` is ephemeral UI state (useState), not server data. |
| 6 | Logout clears everything | N/A | No new persisted client state. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | Reuses `event_covers` bucket, `EventCoverMedia`, `brandCoverRules`; no new bucket/policy; `upsertTripDays` only ADDS `media` (left `stops` as-is per SPEC). |
| 9 | No fabricated data | PASS | `media:[]` ⇒ zero gallery nodes (SC-5/SC-7 live-proven on web; source-gated on consumer/editor). |
| 10 | Currency-aware | N/A | No money in this change. |
| 11 | One auth instance | PASS | Consumer anon select adds only `media` to the existing `trip_days` select; no new `useAuth`/`.from("brands")`/`.from("tickets")` (COMMS-0009 preserved — grep clean). |
| 12 | Validate at the right time | PASS | Size/MIME validated at pick/upload time before storage write. |
| 13 | Exclusion consistency | N/A | No exclusion logic touched. |
| 14 | Persisted-state startup | N/A | No new hydration-gated store. |

Zero violations.

---

## 8. Device / parity matrix

| Surface | Status | Note |
|---|---|---|
| Consumer iOS | PROBABLE | Bundle compiles from worktree Metro (4.77 MB, 0 errors); source one-playing guard + empty-state correct. Native autoplay not driven (auth + seeded-trip HITL). |
| Consumer Android | PROBABLE | Shared RN code; same as iOS. Physical Samsung ADB-connected but consumer auth = HITL. |
| Buyer/anon Web `/t/{brandSlug}/{tripSlug}` | **PROVEN** | Headless Chrome (Playwright, anon) rendered the per-day gallery aria-labels; empty days = no gallery node; zero console errors. |
| Business iOS | PROBABLE | Business bundle compiles from worktree Metro (6.27 MB incl. `trip-day-media`); dead-tap path source-safe. App launched on sim to sign-in (auth = HITL to reach Step 2). |
| Business Android | PROBABLE | Shared RN; same authoring code. |
| Admin Web | N/A | Out of scope (no trip-day authoring/display in admin). |
| Business Web preview | PROVEN (= the `/t/...` `TripPreview` component) | Same component proven via SC-5 headless render. |

**Physical iPhone (HITL):** not invoked this pass — the gating blocker is brand-owner auth, which Seth must perform regardless of device; deferred to the CLOSE/OTA smoke-test ask rather than a mid-test HITL pause.

**Edge functions:** none changed (read-only `list` not needed — implementation report + SPEC both confirm zero edge fns; RPC is a migration, live-verified `src_len`=20630 with `media = EXCLUDED.media` at pos 16447).

**Live-DB hygiene:** all live-fire writes (SC-6 RPC media + edit_log row; SC-5 probe media) were **restored** — final state: all 3 days of `060d0483…` back to `media:[]`, test edit_log row deleted (verified 0 leftover). Three background Metros I started (8089/8090/8091) were stopped; the other sessions' Metros (8081 anchor, 8085 ORCH-1118) left untouched.

---

## 9. Discoveries for Orchestrator

1. **Pre-existing trip jest failures (not ORCH-1119):** `@mingla/event-rendering` jest-unresolved + drifted source-grep contract tests + a `tripsService.test.ts` mock gap fail identically on clean origin/main (`02411e2ea`). Confirms the implementor's Discovery #3. Worth a cleanup ORCH (jest moduleNameMapper for `@mingla/*` + refresh the contract counts).
2. **D-2 (server `severity:"material"` for media-only edit)** — confirmed live (`{severity:"material"}` on the SOLD-trip media-only edit). Pre-resolved by orchestrator as acceptable; the not-blocked + additive-client-summary guarantee is fully live-proven. No action unless a server-side additive label is later required (would need a §6 amendment the SPEC forbade).
3. **D-1 (`publicEventsService.ts` compile-coupling)** — confirmed: the buyer-checkout `TripDay` literal now carries `media: coerceTripDayMedia(d.media)`. Minimal/additive. Candidate for the future shared `OfferingMediaGallery` consolidation.
4. **COMMS-0024 (WARN, OPEN, to ALL)** — factored: confirms ORCH-1119 (`trip-day-media-gallery`) legitimately owns the number; the renumber concern is for OTHER concurrent sessions, not this worktree. No conflict (disjoint files).

---

## 10. Accepted conditions (CONDITIONAL PASS)

The CONDITIONAL rests on ONE item, requiring Seth's affirmative:

- **C-1 (device authoring + consumer autoplay proof):** SC-2/SC-3-live/SC-4 are `probable` (source-complete + dead-tap-safe + bundle-compiles), not `proven`, because reaching the authoring + consumer surfaces needs a brand-owner authenticated session (and a sim video) — human-in-the-loop. Either (a) Seth drives the on-device round-trip per §3 P3-1 Retest, or (b) Seth accepts deferring it to the CLOSE/OTA smoke-test. Until one is chosen, those three SCs are not `proven`.

No follow-up ORCH-ID is yet attached to this acceptance; the orchestrator must obtain Seth's affirmative (per the tester CONDITIONAL rule) before routing to CLOSE, or downgrade to a device-retest loop.

---

## 11. Routing

- Correctness: zero P0/P1 — **no REWORK needed.**
- The DB/RPC/RLS/anon-web core is **PASS (proven/live-fire).**
- CLOSE may proceed once Seth resolves C-1 (device proof or documented acceptance). The two `I-PROPOSED` invariants (optional-hidden + explicit-type) are satisfied by the proven surfaces + the coercer adversarial test and are safe to flip ACTIVE on CLOSE.
