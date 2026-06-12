# INVESTIGATE — ORCH-1118: Trip-edit cover picker "does not work"

**Status:** INVESTIGATE complete (source PROVEN; authenticated runtime repro BLOCKED on Seth's login — see §Repro).
**Confidence:** GIF-tab root cause = **proven** (config + runtime-reachable). Dead-tap / RPC-drop hypotheses = **ruled out by source** (proven at code+schema layer; the one remaining "does the sheet open at runtime on the edit path" check is blocked behind login).
**Owner:** mingla-forensics. **Date:** 2026-06-11. **Surfaces:** business iOS + business Android (mingla-business).

---

## 1. Symptom summary (expected vs actual)

**Operator report (verbatim):** "the cover picker in the trip edit does not work."

"Trip edit" is ambiguous and the brief required disambiguation. There are TWO distinct trip-edit hosts (route dispatch proven below), and "does not work" was undefined (dead tap / opens-but-no-persist / persists-but-no-render / errors). This investigation defines all of it.

**Expected:** In trip edit, tap "Add cover" / "Change cover" → the unified cover sheet opens → pick from Library (device upload) / GIFs (GIPHY) / Stock (Pexels) → selection persists → renders in the preview and on save.

**Actual (proven at source + config):** Library and Stock work. The **GIFs tab is dead** — selecting it (or it auto-loading GIPHY trending) renders the fail-closed error card **"This source is taking a break. — GIFs aren't available right now — your own Library still works."** This is the same defect already registered as the **GIF-tab ORCH-1116** in `MASTER_BUG_LIST.md`. It is NOT edit-specific and NOT trip-specific.

---

## 2. Route dispatch — there are TWO trip-edit cover hosts

`mingla-business/app/trip/[id]/edit.tsx:1-46` routes by `trip.status`:

| Status | Editor component | Cover host |
|--------|------------------|------------|
| `draft` | `TripCreatorWizard` → `TripCreatorStep1Basics.tsx` | `CoverPickerSheet` (lines 468-486), `apply_mode: draft_auto` |
| `scheduled` \| `live` | `EditPublishedTripScreen.tsx` | `CoverPickerSheet` (lines 1255-1276), `apply_mode: published_manual` |
| `ended` \| `cancelled` | read-only empty state | none |

Both hosts mount the SAME `CoverPickerSheet` → same `CoverPicker` → same 3 tabs (Library / GIFs / Stock). So the GIF-tab failure is identical on the draft-edit and published-edit paths.

---

## 3. Investigation manifest (files read, in trace order)

1. `app/trip/[id]/edit.tsx` — status→editor dispatch (proves two hosts).
2. `src/components/trip/EditPublishedTripScreen.tsx` — published-edit host; cover state, sheet mount, save patch, RPC call site.
3. `src/components/trip/TripCreatorStep1Basics.tsx:432-486` — draft-edit host; sheet mount (structural parity check).
4. `src/components/ui/CoverPickerSheet.tsx` — `<Sheet visible={visible}>` wrapper; I-SUB-SHEET-INSIDE-PARENT compliance.
5. `src/components/ui/CoverPicker.tsx:116-195, 595-612, 1150-1216` — tab ids, default tab, GIPHY/Pexels browse, `not_configured` error copy.
6. `src/services/giphyEventCoverService.ts:29-85` + `src/services/coverProviderBrowseService.ts:66-105` — `publicGiphyKey()` env read → `not_configured` throw.
7. `src/services/tripsService.ts:1151-1282` — `LiveTripPatch` (7 cover fields), `updateLiveTripFields` → `biz_update_live_trip` RPC.
8. `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql:2626-3035` — LATEST `biz_update_live_trip` body; cover persistence (lines 3003-3032).
9. `eas.json`, `app.config.ts`, `.env*` (business app) — GIPHY key presence audit.

---

## 4. Q-scorecard

**Q1 — Is the trip-edit cover picker a dead tap (sheet never opens) on the edit path? (Hypothesis #1, ORCH-1103 precedent)**
Verdict: **NO (ruled out by source; proven at code layer).** In `EditPublishedTripScreen.tsx`, the "Add cover" `<Button onPress={() => setCoverPickerVisible(true)}>` (line 1240-1254) and the `<CoverPickerSheet visible={coverPickerVisible} …>` (line 1255-1276) are BOTH rendered inside `renderSectionBody("cover")`, which is returned inside `<View style={styles.sectionBody}>` — a child of the section card (lines 1423-1427). Button and sheet **co-mount and co-unmount** together (both gated by `openSection === "cover"`). This is the OPPOSITE of the ORCH-1103 Ari failure (where the sheet was conditionally unmounted while the trigger button stayed mounted). The sheet is a JSX child of its parent host (I-SUB-SHEET-INSIDE-PARENT satisfied), and `<Sheet visible>` reacts to the prop. The draft-edit host (`TripCreatorStep1Basics.tsx:468`) is structurally identical. No dead-tap mechanism exists in source. *(Caveat: a runtime tap-fires confirmation is blocked behind login — see Q5/Repro. Source proof caps this at "ruled out by source"; not contradicted by any evidence.)*

**Q2 — Does the trip live-edit RPC drop the cover field on EDIT so selection never persists? (Hypothesis #2, ORCH-1069 precedent)**
Verdict: **NO (ruled out; proven at schema layer).** The client sends all 7 cover fields: `EditPublishedTripScreen.buildLiveTripPatch` (lines 461-483) writes `cover_media_url/type/provider/source_url/credit/credit_url/alt` into the patch whenever the URL changes; `updateLiveTripFields` (tripsService.ts:1219-1229) forwards the whole patch to `supabase.rpc("biz_update_live_trip", { p_patch })`. The LATEST server definition — migration `20260911000000_orch_1075` lines 2626 (def) + 3003-3034 (apply) — explicitly `UPDATE public.events SET cover_media_url = CASE WHEN p_patch ? 'cover_media_url' THEN NULLIF(p_patch->>'cover_media_url','') ELSE cover_media_url END` and the same for all 7 columns. The migration chain was checked: 5 migrations redefine `biz_update_live_trip` (0876, 0880, 0950×2, **1075 = latest**); every version including the latest persists the cover family. Cover is NOT dropped. (Note: for `draft` trips the cover persists via `updateTripBasics` / `draft_auto` mode instead, not this RPC — also intact.)

**Q3 — Is Seth's "doesn't work" actually the GIF-tab config issue (= dup of the GIF ORCH-1116)? (Hypothesis #3 — REQUIRED discrimination)**
Verdict: **YES — most probably the GIF-tab config issue, and it is a DUPLICATE of the already-registered GIF-tab ORCH-1116.** `publicGiphyKey()` reads `EXPO_PUBLIC_GIPHY_API_KEY ?? EXPO_PUBLIC_GIPHY_KEY` (giphyEventCoverService.ts:39-40, coverProviderBrowseService.ts:66-67). That env var is **absent** from `mingla-business/eas.json`, `app.config.ts`, and every `.env` (only `.env.example` exists); `git log -S EXPO_PUBLIC_GIPHY` over eas.json/app.config returns **zero commits** → it has never been configured. With no key, both `searchGiphyEventCovers` and trending throw `"not_configured"` → CoverPicker maps it to the fail-closed card `"This source is taking a break."` (CoverPicker.tsx:1155, `noRetry` at :1215). Pexels is unaffected (edge-proxied, key server-side), so only the GIF tab breaks — which exactly matches a partial "the picker doesn't work."

**Q4 — Is the failure edit-specific, or does CREATE work while EDIT is broken?**
Verdict: **NOT edit-specific.** The GIF-tab `not_configured` failure is environment-level and fires identically on trip CREATE (draft wizard Step 1), trip EDIT (both draft + published hosts), event create/edit, experience create/edit, and brand cover — every mount of the shared `CoverPicker`. CREATE does NOT work-while-EDIT-breaks for the GIF tab; both are equally affected. Library + Stock work on both create and edit.

**Q5 — Did a live runtime repro confirm the user-visible symptom on the edit path?**
Verdict: **BLOCKED (not reproduced end-to-end).** The business-app dev build loaded from Metro :8081 on iPhone 17 Pro sim but stops at the sign-in wall (Continue with Apple/Google/Email + an Apple-ID system verification dialog). Reaching a real published/draft trip's edit screen requires Seth's authenticated login — a genuine STOP-and-ASK blocker (Prime Directive 9: account login needs the operator). The GIF config truth (Q3) is proven without login; the dead-tap/persist truths (Q1/Q2) are proven at code+schema. Confidence on the user-visible repro is therefore capped at "probable" pending Seth driving the last two taps.

---

## 5. Findings (six-field)

### F-1 — GIF tab fail-closed because EXPO_PUBLIC_GIPHY_API_KEY is unconfigured (CONFIRMED ROOT CAUSE of the GIF-tab failure)
- **Symptom:** GIFs tab shows "This source is taking a break. — GIFs aren't available right now — your own Library still works."; no retry affordance.
- **Layer:** code + config (env/build).
- **Probe:** `grep -rn "GIPHY" mingla-business/eas.json app.config.ts .env*` → only `.env.example`; `git -C mingla-business log -S "EXPO_PUBLIC_GIPHY" -- eas.json app.config.ts` → 0 commits; read `giphyEventCoverService.ts:39-85` + `CoverPicker.tsx:1155,1215`.
- **Evidence:** `publicGiphyKey = () => envValue("EXPO_PUBLIC_GIPHY_API_KEY") ?? envValue("EXPO_PUBLIC_GIPHY_KEY")` (giphyEventCoverService.ts:39-40). `if (apiKey === null) throw … "not_configured"` (:82-85). `not_configured: { title: "This source is taking a break.", … }` (CoverPicker.tsx:1155). No GIPHY key in any business-app config file (grep empty).
- **Mechanism:** No public GIPHY key in the runtime env → `publicGiphyKey()` returns null → GIF trending + search both throw `not_configured` → CoverPicker renders the fail-closed copy with no retry → the GIF tab "doesn't work."
- **Severity:** CONFIRMED ROOT CAUSE (of the GIF-tab symptom). **Duplicate of the GIF-tab ORCH-1116** in MASTER_BUG_LIST.md.

### F-2 — Edit-path dead-tap hypothesis does not hold (RULED OUT)
- **Symptom:** N/A (hypothesized "Add cover" is a dead tap on edit).
- **Layer:** code.
- **Probe:** Read `EditPublishedTripScreen.tsx:1224-1278` + `TripCreatorStep1Basics.tsx:432-486` + `CoverPickerSheet.tsx:94-95`.
- **Evidence:** Button (`onPress={() => setCoverPickerVisible(true)}`, line 1251) and `<CoverPickerSheet visible={coverPickerVisible} … />` (line 1255) are siblings inside the SAME `renderSectionBody("cover")` return; both unmount together when the accordion collapses. `<Sheet visible={visible} …>` (CoverPickerSheet.tsx:95) is driven by the prop.
- **Mechanism:** No unmount-while-trigger-mounted condition exists; the ORCH-1103 dead-tap shape is absent.
- **Severity:** RULED OUT (by source; not contradicted).

### F-3 — biz_update_live_trip persists all 7 cover columns on EDIT (RULED OUT as a drop)
- **Symptom:** N/A (hypothesized cover selection doesn't persist on save).
- **Layer:** schema (RPC) + code (service).
- **Probe:** Migration-chain sort for `biz_update_live_trip`; read latest body `20260911000000_orch_1075_…sql:2626,3003-3034`; read `tripsService.ts:1151-1229`.
- **Evidence:** Latest RPC: `UPDATE public.events SET cover_media_url = CASE WHEN p_patch ? 'cover_media_url' THEN NULLIF(p_patch->>'cover_media_url','') ELSE cover_media_url END,` + identical for `cover_media_type/provider/source_url/credit/credit_url/alt` (lines 3012-3032). Client forwards the full patch (tripsService.ts:1225-1229).
- **Mechanism:** Cover fields round-trip client→patch→RPC→events table intact; no silent drop (unlike ORCH-1069's experience_intents).
- **Severity:** RULED OUT.

---

## 6. Five-truth-layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| Docs | MASTER_BUG_LIST already registers the GIF-tab "This source is taking a break" as ORCH-1116 (config-drift). | None — corroborates F-1. |
| Schema | `biz_update_live_trip` (latest, 1075) persists 7 cover columns. | None — F-3. |
| Code | Sheet + button co-mount on edit; cover patch built + forwarded; GIPHY key read from env. | None. |
| Runtime | Business dev build loads from Metro :8081; sign-in wall blocks reaching trip edit. GIF `not_configured` is reachable code with no env key. | Partial gap: end-to-end tap on edit not runtime-confirmed (login). |
| Data | `EXPO_PUBLIC_GIPHY_*` never present in any business config/.env (grep + git -S). | None — corroborates F-1. |

The only inter-layer gap is Runtime-vs-rest (login wall), which caps the user-visible repro at "probable", not the root cause itself.

---

## 7. Repro evidence

- Booted iPhone 17 Pro sim `17091E60-…`; business app `com.sethogieva.minglabusiness` installed; Metro :8081 = `mingla-business … expo start --port 8081`.
- Deep-linked `com.sethogieva.minglabusiness://expo-development-client/?url=http://localhost:8081` → bundle loaded → **sign-in screen** (`/tmp/biz_loaded2.png`: "Mingla Business", Continue with Apple/Google/Email + Apple-ID verification system dialog).
- **Blocked:** cannot authenticate without Seth's credentials; cannot reach a published/draft trip's edit screen to tap the cover picker. Negative honesty: the user-visible GIF-tab card was NOT rendered on-device in this session; it is proven by code + config, not by screenshot.

---

## 8. Blast radius / cross-surface map

| Surface | GIF-tab (F-1) | Dead-tap (F-2) | RPC drop (F-3) |
|---------|---------------|----------------|----------------|
| Business iOS — trip edit (draft + published) | BROKEN | OK | OK |
| Business iOS — trip CREATE (draft wizard) | BROKEN (same picker) | OK | OK |
| Business iOS/Android — **event** create/edit (`CreatorStep4Cover.tsx`) | BROKEN (shared CoverPicker) | OK | OK |
| Business iOS/Android — **experience** create/edit (`ExperienceCoverStep.tsx`) | BROKEN (shared CoverPicker) | OK | OK |
| Business iOS/Android — **brand** cover (`BrandEditView`, `BrandCreationFlow`) | BROKEN (shared CoverPicker) | OK | OK |
| Business Android (all of the above) | BROKEN (same env gap) | OK | OK |
| Business web preview (adjacent) | BROKEN (same EXPO_PUBLIC inlining) | OK | OK |
| Consumer iOS/Android, admin-web, buyer-web | N/A (no authoring CoverPicker) | — | — |

**The GIF-tab failure is app-wide across every cover mount in mingla-business** — it is in no way specific to trip edit. Library + Pexels work on every surface.

---

## 9. Relationship to ORCH-1116 (required deliverable)

⚠️ **ID-collision note:** `ORCH-1116` is currently overloaded across THREE different registrations (`MASTER_BUG_LIST.md` = GIF-tab config drift; `WORLD_MAP.md:999` = booking-gate false-positive; `WORLD_MAP.md:1071` = Hub multi-select delete). The relevant one here is the **GIF-tab config-drift ORCH-1116** in MASTER_BUG_LIST.md.

**ORCH-1118 (as reported) is a DUPLICATE of the GIF-tab ORCH-1116.** Both describe the identical defect (GIPHY key unconfigured → "This source is taking a break"), same file:line (CoverPicker.tsx:1155), same root (missing `EXPO_PUBLIC_GIPHY_API_KEY`), same blast radius. The MASTER_BUG_LIST ORCH-1116 entry already scoped the fix (set the key in eas.json + boot fail-loud + CI grep gate). **Recommend the orchestrator FOLD ORCH-1118 into the GIF-tab ORCH-1116** (and resolve the ORCH-1116 ID collision separately).

**Caveat preserved for honesty:** the duplicate verdict rests on the most-likely interpretation that Seth tapped the GIFs tab. The login wall prevented confirming on-device that he hit GIFs specifically (vs. an unobserved distinct edit-path failure). If, on retest, Seth reports the picker is dead on the FIRST tap (before reaching any tab) or that a chosen cover fails to SAVE, that would be a NEW failure not covered by F-1 — but F-2 and F-3 already rule out the two obvious mechanisms for those, at source.

---

## 10. Invariant impact

- **I-NO-DEAD-TAPS** — not violated by source (F-2). Runtime tap-fires confirmation still owed (login-gated) before any PASS.
- **I-SUB-SHEET-INSIDE-PARENT** — satisfied (CoverPickerSheet is a JSX child of its host on both trip-edit hosts).
- No new invariant proposed here; the GIF-tab fix (ORCH-1116) should establish a config-presence/boot-fail-loud invariant + CI grep gate (that is ORCH-1116's deliverable, not ORCH-1118's).

---

## 11. Discoveries for orchestrator

1. **ORCH-1116 ID collision (3 distinct registrations).** Needs renumbering — confusing for routing.
2. **App-wide GIPHY gap, not just trips.** The fix should set `EXPO_PUBLIC_GIPHY_API_KEY` once (eas.json across all build profiles) — it fixes every cover surface at once. A boot-time fail-loud + CI grep gate would have caught this pre-ship.
3. **`tripToLocalEditState` seeds provider/source/credit/alt to `null`** (EditPublishedTripScreen.tsx:255-259) even when the trip already has them — a latent provider/attribution-loss-on-resave nit (not the reported bug; only matters if the operator re-saves an unchanged provider cover). Flag, do not fix here.

---

## 12. Confidence + recommended next phase

**Confidence:** GIF-tab root cause **proven** (config + reachable code). Dead-tap + RPC-drop hypotheses **ruled out by source**. User-visible end-to-end repro on the edit screen **probable / blocked on login** (honest negative — not screenshotted on device).

**Recommended next phase (direction only — NOT a fix):**
1. Orchestrator: **fold ORCH-1118 into the GIF-tab ORCH-1116** and resolve the ORCH-1116 ID collision.
2. Before closing as a pure dup, have **Seth confirm on-device** (one screenshot): open trip edit → Cover section → tap "Add cover" → does the sheet OPEN (kills any residual dead-tap doubt), and is the failing tab the **GIFs** tab showing "This source is taking a break"? If yes → dup of ORCH-1116. If the sheet does NOT open, or a chosen cover fails to save → re-dispatch INVESTIGATE for a distinct edit-path failure (F-2/F-3 already narrow where to look).

*INVESTIGATE only — no fix implemented, no code/config edited, all probes read-only.*

---
---

# APPENDIX — ORCH-1122 narrow INVESTIGATE: does trip-edit use the SAME unified CoverPicker?

**Renumbered off the stale-anchor ID collision per COMMS-0024 (ORCH-1116 → ORCH-1122).**
**Date:** 2026-06-12. **Owner:** mingla-forensics. **Surfaces:** business iOS + Android (mingla-business).
**Scope:** ONE question only — is the trip-EDIT cover control the unified `CoverPicker` (the tabbed Library/GIFs/Pexels sheet used by event/experience create and trip create), or a divergent/legacy control? (This is a PARITY question, orthogonal to the GIF-key config defect investigated above.)

**Comms ledger on entry:** read `COMMS_LEDGER.md`. **COMMS-0024 (WARN, OPEN)** is the relevant row — it documents the three-way ORCH-1116 stale-anchor collision and assigns this trip-edit-cover investigation to **ORCH-1122**. Factored; this appendix is filed under ORCH-1122 accordingly. No BLOCK rows addressed to forensics/ORCH-1122/ALL.

## Direct answer

**YES — the business-app trip-EDIT cover control mounts the exact same unified `CoverPicker`** (via the shared `CoverPickerSheet`) that event create, experience create, and trip create all use. There is NO divergent or legacy trip-edit cover control, and NO reduced/tab-gated variant. All three tabs (Library / GIFs / Photos[Pexels]) render identically on the edit path. **Confidence: proven at source** (the import + JSX mount + shared-component internals are unambiguous and identical across paths). Runtime tap-fire on the authenticated edit screen is login-gated (capped at source-confidence for the "reachable" sub-claim — see Q5b).

## Evidence (file:line, exact)

**Q1b — Trip-EDIT cover control import + mount.**
`mingla-business/src/components/trip/EditPublishedTripScreen.tsx`:
- Import: line **83** `import { CoverPickerSheet } from "../ui/CoverPickerSheet";` (plus `CoverPatch` type from `../ui/CoverPicker` at line 82, and `EventCoverMedia` at line 84 used only for the static PREVIEW thumbnail, not the picker).
- Mount: the `"cover"` accordion section body, lines **1320–1373** — a `<Button label="Change cover"/"Add cover" onPress={() => setCoverPickerVisible(true)}>` (1336–1350) plus `<CoverPickerSheet visible={coverPickerVisible} target={{ kind: "trip", brandId: trip.brandId, eventRowId: trip.id, coverMediaApplyMode: "published_manual" }} … />` (1351–1372).
Verdict: **the EDIT path mounts the unified `CoverPickerSheet`** — not `EventCoverMedia`-as-picker, not a bespoke trip cover component, not an image-only upload button. (`EventCoverMedia` at 1325–1334 is only the read-only preview tile above the button — same pattern as create.)

**Q2b — Trip-CREATE cover control (comparison).**
`mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` (the draft-wizard Step 1 used for trip create):
- Import: line **52** `import { CoverPickerSheet } from "../ui/CoverPickerSheet";`.
- Mount: lines **525–546** `<CoverPickerSheet visible={coverPickerVisible} target={{ kind: "trip", brandId, eventRowId: tripEventId, coverMediaApplyMode: "draft_auto" }} … />`, opened by the same "Change cover"/"Add cover" Button at 507–520.
Verdict: **SAME component.** The only difference between create and edit is `coverMediaApplyMode` (`"draft_auto"` on create vs `"published_manual"` on edit) — a persistence-timing flag inside the SAME `target`, NOT a different picker and NOT a tab gate.

**Q3b — Events / experiences create (cross-offering comparison).**
`grep -rln "CoverPickerSheet"` across `mingla-business/src/components/` returns the SAME sheet mounted in every authoring surface: `event/CreatorStep4Cover.tsx`, `experience/ExperienceCoverStep.tsx`, `trip/TripCreatorStep1Basics.tsx`, `trip/EditPublishedTripScreen.tsx`, plus `event/EditPublishedScreen.tsx`, `brand/BrandEditView.tsx`, `brand/BrandCreationFlow.tsx`, `brand/BrandAvatarPickerSheet.tsx`, `venue/VenueCreatorWizard.tsx`, `ari/ToolProposalCard.tsx`. **One sheet, every surface.** Verdict: trip edit is at full parity with event create, experience create, and trip create — they are literally the same JSX component.

**Q4b — Is the EDIT mount a reduced / tab-gated variant (e.g. a prop that hides the GIF tab on edit)?**
NO. `CoverPickerSheet` (`mingla-business/src/components/ui/CoverPickerSheet.tsx`) exposes NO tab-selection / tab-hiding prop — its props are `visible / onClose / target / initial / initialCoverHue / onCoverChange / onShowToast / disabled / onCoverVideoProcessingChange` (lines 42–55). It renders a single `<CoverPicker target={target} … />` (lines 116–131). Tab availability lives entirely inside `CoverPicker`:
- `CoverPicker.tsx:152–156` — `TAB_DEFS = [{id:"library",label:"Library"},{id:"gif",label:"GIFs"},{id:"stock",label:"Photos"}]` (static, all three).
- `CoverPicker.tsx:831` — the tab bar is `{TAB_DEFS.map((tab) => { … })}` rendered **unconditionally**, with NO filter on `target.kind`. The only `kind`-conditional logic is `isBrand = target.kind === "brand"` (line 188, drives storage scope + brand-specific behavior) and the video-availability gate — neither removes a tab; trips get all three tabs.
Verdict: **no reduced variant; the EDIT path gets the identical Library/GIFs/Pexels tab set.** Any tab difference Seth sees is the env-key config defect (F-1 above, the GIF tab failing app-wide), NOT a trip-edit-specific reduced picker.

**Q5b — Is the EDIT "Change cover" reachable at runtime (not a dead/conditionally-unmounted control)?**
Reachable at source (proven); runtime tap-fire login-gated (source-confidence cap stated).
- Dispatch: `mingla-business/app/trip/[id]/edit.tsx:150–151` — `if (trip.status === "scheduled" || trip.status === "live") return <EditPublishedTripScreen trip={trip} />;` (draft → `TripCreatorWizard` at :196). So EDIT (published) always renders `EditPublishedTripScreen`.
- Mount condition: the `"cover"` entry is always in `SECTIONS` (line 167); expanding it (`openSection === "cover"`) renders `renderSectionBody("cover")` (line 1522), inside which the Button AND the `CoverPickerSheet` **co-mount** (both children of the same returned View). This is the OPPOSITE of the ORCH-1103 Ari dead-tap (sheet unmounted while trigger stayed) — here button and sheet unmount together, so the tap can never target an unmounted sheet. `<Sheet visible={coverPickerVisible}>` reacts to the prop.
- Honest cap: the business dev build stops at the sign-in wall without Seth's login (same blocker as §7 above), so an on-device tap-fire on the edit screen was not performed this session. The "reachable" claim is **source-proven** (no unmount-while-mounted condition exists); a runtime screenshot is owed before a PASS but does not change the parity answer.

## Bottom line for Seth

Trip-edit is NOT divergent. It uses the one shared unified cover picker — same tabs, same attribution plumbing, same runtime-key path — as event create, experience create, and trip create. So the GIF/Library/Pexels tabs and any CoverPicker-level fix (including the GIPHY-key fix) reach trip-edit automatically; there is no separate trip-edit cover control to fix or to forget. The ONLY caveat is the app-wide GIF-tab env-key defect (F-1 / the GIF-key ORCH) which hits every cover mount equally — not a trip-edit parity gap.

*ORCH-1122 INVESTIGATE only — no fix, no code/config edits, all probes read-only against the anchor checkout.*
