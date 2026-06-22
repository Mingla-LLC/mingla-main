# INVESTIGATE — ORCH-1218 [Venue-authoring error path leaks raw `gemini_*` vendor codes to business users]

**Skill:** mingla-forensics
**Date:** 2026-06-22
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1218-[venue-authoring-vendor-error-scrub]/` on branch `ORCH-1218-venue-authoring-vendor-error-scrub` (rebased on `origin/main`, up to date)
**Mode:** INVESTIGATE (no fix proposed here; SPEC is the sibling file)
**Confidence:** `proven` (source-traced end-to-end; this is a backend/edge + service + component string-flow audit — exempt from live-fire per Prime Directive 7 "pure backend / edge-function / code-audit" exemption; the flow is fully deterministic and read verbatim across every layer).

---

## 1. Symptom summary (expected vs actual)

- **Expected:** When the venue auto-authoring AI stage fails (model quota/429, empty/truncated response, missing signal coverage, unconfigured key), the business user (venue operator) sees a **generic, non-vendor** error — Mingla never discloses which AI vendor powers the pipeline. Seth's standing intent: "I don't want people to know our technology." (ORCH-1217 established this for the Ari co-pilot copy.)
- **Actual:** The venue operator can see the **raw server error string verbatim**, which contains the vendor name `gemini` — e.g. `gemini_failed:429:...`, `gemini_incomplete_coverage:...`, `gemini_empty`, `gemini_unconfigured`. The string is rendered as inline error text in the venue deck-readiness screen of `VenueCreatorWizard`.

This is the **second leak** found by the ORCH-1217 tester (Discovery D-1), distinct from the Ari co-pilot copy that ORCH-1217 already scrubbed.

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Why / layer |
|---|------|-------------|
| 1 | `COMMS_LEDGER.md` | Ledger ingest — found BLOCK COMMS-0052 (business OTA freeze); acked |
| 2 | `supabase/functions/run-business-place-authoring-pipeline/index.ts` | EDGE — origin of every `gemini_*` string; which actions can emit them; how they reach the HTTP response |
| 3 | `mingla-business/src/services/businessPlaceAuthoringService.ts` | SERVICE — `pipelineInvokeError` / `assertPipelineOk`; how the raw server `message`/`code` is rethrown to callers |
| 4 | `mingla-business/src/hooks/useBrandPlacePipelineState.ts` | HOOK — whether `last_error_message` (DB) is surfaced via React Query |
| 5 | `mingla-business/src/components/venue/VenueCreatorWizard.tsx` | COMPONENT — the catch blocks + `setMessage`/`setSubmitErr` + the JSX that renders them |
| 6 | `mingla-business/src/components/venue/VenueStep7Review.tsx` | COMPONENT — renders `submitError` prop |
| 7 | `mingla-business/src/components/venue/VenueListingContent.tsx` | COMPONENT — Toast host; confirm it does NOT independently surface pipeline errors |
| 8 | `mingla-business/src/components/venue/VenueSettingsModule.tsx` | COMPONENT — confirm no independent pipeline-error rendering |
| 9 | `.github/workflows/strict-grep-mingla-business.yml` + `origin/ORCH-1217-...:.github/scripts/strict-grep/orch-1217-ari-no-vendor-disclosure.mjs` | CI — model the sibling regression gate |

---

## 3. Q-scorecard

- **Q1 — What is the complete set of vendor-tagged error codes the edge fn can emit?**
  Verdict: 7 distinct `gemini_*` codes (one with a status+body suffix, one with a list suffix, one with a signal-id suffix). All originate in `callGeminiForEvaluations` / `buildAiSignalScores`. See F-1. (`proven`)

- **Q2 — Which edge actions can emit a `gemini_*` code?**
  Verdict: ONLY `run_tier2_pipeline` and `regenerate_sales_bio` (both routed to `handleTier2`). `handleTier1`, `handleConfirmAiOutputs`, `handleRefreshDeckReadiness`, `handleSyncGallery`, `handleSyncHeroMedia`, `handleGetAuthoringContext` never call Gemini. See F-2. (`proven`)

- **Q3 — How does a `gemini_*` code travel from the edge fn into the client `Error.message`?**
  Verdict: The top-level handler catch returns `errorResponse(500, "PIPELINE_FAILED", msg)` where `msg = err.message = "gemini_failed:..."`. supabase-js raises a `FunctionsHttpError`; the service's `pipelineInvokeError` reads the structured body's `message` (= the raw `gemini_*` string) and rethrows it as `new Error(real)`. See F-3 + F-4. (`proven`)

- **Q4 — Which user-facing surfaces render that `Error.message` verbatim?**
  Verdict: ONE confirmed live surface — the venue deck-readiness screen in `VenueCreatorWizard.tsx`, via `setMessage(error.message)` in `handleRunAi` (line 689), rendered at line 1067. Three additional defensive renderers in the same component would leak IF a vendor code reached them, but their server actions do not call Gemini today (submitErr/tier1, confirm, refresh). See F-5. (`proven` for the live one; `proven` that the others cannot currently carry a gemini code)

- **Q5 — Is the DB-persisted `last_error_message` (which holds the raw gemini string) rendered anywhere?**
  Verdict: NO. `last_error_message` / `last_error_code` are read into the typed `BrandPlacePipelineState` by `fetchBrandPlacePipelineState`, returned by `useBrandPlacePipelineState`, but NO component renders those two fields. Not a user leak (telemetry/diagnostics only). See F-6. (`proven`)

- **Q6 — Is there already any sanitization between the raw server reason and the user?**
  Verdict: NONE. The service deliberately surfaces the real reason (META-ORCH-1009 Sub-E B6 comment, lines 248–250) and the component renders it raw. See F-4. (`proven`)

---

## 4. Findings (F-1 .. F-7, six-field evidence)

### F-1 — The 7 vendor-tagged error codes the edge fn emits — `CONFIRMED ROOT CAUSE` (source)

1. **Symptom:** Vendor name `gemini` is embedded in every AI-stage error string.
2. **Layer:** code (edge).
3. **Probe:** `grep -n "gemini_" supabase/functions/run-business-place-authoring-pipeline/index.ts`
4. **Evidence (verbatim, `supabase/functions/run-business-place-authoring-pipeline/index.ts`):**
   - L857: `throw new Error("gemini_unconfigured");`
   - L947: `lastErr = \`gemini_failed:${res.status}:${body.slice(0, 200)}\`;` (L949 `throw new Error(lastErr)` on <500)
   - L957: `lastErr = "gemini_empty";`
   - L971: `lastErr = "gemini_unparseable_json";`
   - L975: `lastErr = "gemini_missing_evaluations";`
   - L994: `lastErr = \`gemini_incomplete_coverage:${missing.slice(0, 5).join(",")}\`;`
   - L1022: `throw new Error(lastErr || "gemini_failed");` (bare fallback)
   - L1139: `throw new Error(\`gemini_missing_signal:${signal.id}\`);` (inside `buildAiSignalScores`)
   **Complete vendor-tagged code set (8 string forms, 7 distinct codes + 1 bare fallback):** `gemini_unconfigured`, `gemini_failed:<status>:<body>`, `gemini_empty`, `gemini_unparseable_json`, `gemini_missing_evaluations`, `gemini_incomplete_coverage:<csv>`, `gemini_missing_signal:<id>`, `gemini_failed` (bare).
   Note `gemini_failed:<status>:<body>` is the WORST leak — `<body>` is up to 200 chars of the raw Google API error JSON (which itself can name the vendor/model/endpoint).
5. **Mechanism:** Each is the message of a thrown `Error` (or the `lastErr` finally thrown at L1022). They surface unaltered to the HTTP layer (F-3).
6. **Severity:** `CONFIRMED ROOT CAUSE` (the vendor token originates here).

### F-2 — Only `run_tier2_pipeline` / `regenerate_sales_bio` can emit a gemini code — `CONFIRMED` (scope bound)

1. **Symptom:** Determines which client call paths can leak.
2. **Layer:** code (edge).
3. **Probe:** `grep -n "function handle\|callGeminiForEvaluations\|buildAiSignalScores"` + read of the action router (L1670–1698).
4. **Evidence:** `callGeminiForEvaluations` is called ONLY at L1216, inside `handleTier2` (L1153). `buildAiSignalScores` (which throws `gemini_missing_signal`) is called ONLY at L1225, also inside `handleTier2`. The router (L1670–1691) maps `run_tier2_pipeline`/`regenerate_sales_bio` → `handleTier2`. `handleTier1` (L501), `handleConfirmAiOutputs` (L1334), `handleRefreshDeckReadiness` (L1451), `handleSyncGallery`, `handleSyncHeroMedia`, `handleGetAuthoringContext` contain NO Gemini call.
5. **Mechanism:** The vendor leak can ONLY originate from the `run_tier2_pipeline`/`regenerate_sales_bio` action → client `runTier2Pipeline()` service fn → `handleRunAi` in the wizard.
6. **Severity:** `CONFIRMED` (scopes the blast radius to one client call path).

### F-3 — Top-level handler catch returns the raw message as the response body — `CONFIRMED ROOT CAUSE` (edge→wire)

1. **Symptom:** Raw `gemini_*` string leaves the server in the JSON response.
2. **Layer:** code (edge) / runtime (wire contract).
3. **Probe:** read of L1692–1696 + `errorResponse` (L183–185).
4. **Evidence (verbatim):**
   ```
   1692  } catch (err) {
   1693    const msg = err instanceof Error ? err.message : "Pipeline failed";
   1694    console.error("[run-business-place-authoring-pipeline]", msg.slice(0, 400));
   1695    return errorResponse(500, "PIPELINE_FAILED", msg);
   1696  }
   ```
   ```
   183  function errorResponse(status: number, code: string, message: string): Response {
   184    return jsonResponse(status, { kind: "error", code, message });
   185  }
   ```
   Also, the AI-stage catch at L1226–1235 persists the raw reason to the DB (`lastErrorMessage: aiMsg.slice(0, 500)`) AND rethrows (`throw aiErr;`), so the raw string both lands in `last_error_message` and reaches the top-level catch.
5. **Mechanism:** `err.message` (the `gemini_*` string) is placed verbatim into the response body's `message` field. The body shape is `{ kind:"error", code:"PIPELINE_FAILED", message:"gemini_failed:429:..." }`.
6. **Severity:** `CONFIRMED ROOT CAUSE` (this is where the vendor string crosses the trust boundary onto the wire — but per the dispatch, the raw code is intentionally KEPT here for server-side debugging; the sanitization is to live in the client, see SPEC).

### F-4 — Service `pipelineInvokeError`/`assertPipelineOk` rethrow the raw message to the caller — `CONFIRMED ROOT CAUSE` (service)

1. **Symptom:** The client `Error.message` becomes the raw `gemini_*` string.
2. **Layer:** code (service).
3. **Probe:** read of `businessPlaceAuthoringService.ts` L117–154, L232–256.
4. **Evidence (verbatim):**
   ```
   135  async function pipelineInvokeError(
   ...
   144      const parsed = (await (ctx as Response).json()) as PipelineErrorBody;
   145      const real = parsed?.message ?? parsed?.code;
   146      if (typeof real === "string" && real.length > 0) {
   147        return new Error(real);          // <-- real = "gemini_failed:429:..."
   ```
   ```
   117  function assertPipelineOk<T extends { kind: string }>(...) {
   122    if (maybeError.kind === "error") {
   123      throw new Error(maybeError.message ?? maybeError.code ?? fallback);  // <-- raw message
   ```
   ```
   248    // META-ORCH-1009 Sub-E: surface the REAL server reason (e.g. gemini_failed:429,
   249    // gemini_incomplete_coverage) instead of the opaque "Edge Function returned a
   250    // non-2xx status code" string, matching the other pipeline calls.
   251    if (error !== null) throw await pipelineInvokeError(error, "tier2_pipeline_failed");
   ```
   The comment at L248–250 PROVES the leak is deliberate-but-unscrubbed: META-ORCH-1009 Sub-E intentionally surfaced the real reason to replace an opaque message, and `gemini_*` codes are named as examples of what it surfaces.
5. **Mechanism:** supabase-js wraps the non-2xx response as a `FunctionsHttpError` with `.context` = the `Response`; `pipelineInvokeError` parses `.context.json()` → `parsed.message` = `gemini_failed:...` → `new Error(real)`. The caller (`runTier2Pipeline`) rethrows it; `handleRunAi` catches it and renders `error.message`.
6. **Severity:** `CONFIRMED ROOT CAUSE`. There is NO sanitization here (answers Q6).

### F-5 — `VenueCreatorWizard.tsx` renders the raw `error.message` to the venue operator — `CONFIRMED ROOT CAUSE` (the user-visible leak)

1. **Symptom:** Venue operator sees `gemini_failed:429:...` (or similar) on screen.
2. **Layer:** code (component) / runtime (UI render).
3. **Probe:** read of `VenueCreatorWizard.tsx` catch blocks + JSX render of `message`/`submitErr`.
4. **Evidence (verbatim):**
   - **LIVE leak — `handleRunAi` (the `run_tier2_pipeline` call):**
     ```
     678    const result = await runTier2Pipeline({ brandId: brand.id, placePoolId, tier2: buildTier2() });
     ...
     688  } catch (error) {
     689    setMessage(error instanceof Error ? error.message : "AI setup failed.");
     ```
     `message` is rendered as visible text:
     ```
     1067  {message !== null ? <Text style={styles.submitErr}>{message}</Text> : null}
     ```
   - **Defensive renderers in the same component (do NOT carry a gemini code today, because their server actions never call Gemini — F-2):**
     - `handleConfirm` (confirm_ai_outputs) L719–722: `setMessage(error.message ... )` → rendered L1067.
     - `handleRefresh` (refresh_deck_readiness) L742–745: `setMessage(error.message ...)` → rendered L1067.
     - `handleSubmit` (upsert_tier1_place) L241–243: `setSubmitErr(error.message ...)` → passed as `submitError` prop (L280) → rendered at `VenueStep7Review.tsx:63` `<Text style={styles.err}>{submitError}</Text>`.
     - `handleCoverChange` (sync_hero_media) L608–613: `setMessage(error.message ...)` → rendered L1067. (`syncHeroMedia` rethrows the raw supabase error, not via `pipelineInvokeError`; `sync_hero_media` does not call Gemini.)
     - `handleAddPhotos`/photo handlers L647, L660: `setMessage(e.message ...)` — these are `VenueGalleryError`/upload errors, NOT pipeline gemini codes.
5. **Mechanism:** `error.message` (= the `gemini_*` string per F-4) is written to React state and rendered into a `<Text>`. The operator reads the vendor name directly off the screen.
6. **Severity:** `CONFIRMED ROOT CAUSE` for L689→L1067 (live). The other four are `SUSPECTED CONTRIBUTOR` (same render code path; cannot carry a gemini code today, but a future server change routing Gemini through confirm/refresh/tier1 would silently leak — so the sanitization boundary must cover them too).

### F-6 — DB-persisted `last_error_message` is NOT rendered (telemetry only, NOT a user leak) — `RULED OUT`

1. **Symptom:** Concern that the persisted raw reason reaches the user.
2. **Layer:** data + code (hook/component).
3. **Probe:** `grep -rln "last_error_message|last_error_code|lastErrorMessage|lastErrorCode" mingla-business/src`
4. **Evidence:** ONLY hit is `businessPlaceAuthoringService.ts` (the SELECT at L332 and the type at L76–77). `useBrandPlacePipelineState` returns the whole row but NO component reads `.last_error_message` / `.last_error_code`. Searched `VenueCreatorWizard`, `VenueListingContent`, `VenueSettingsModule`, `listingStatus.ts`, `deckReadinessRoutes.ts`, `businessTodos.ts` — none render those fields.
5. **Mechanism:** The persisted raw reason is diagnostics-only (intended by the L1206–1211 comment). Server `console.error` (L1694) is also log-only. These are FINE to keep raw.
6. **Severity:** `RULED OUT` as a user leak. (Confirms the dispatch's note that log/telemetry/diagnostics raw codes are acceptable.)

### F-7 — `VenueListingContent` / `VenueSettingsModule` do NOT independently surface pipeline errors — `RULED OUT`

1. **Symptom:** Concern of a second component rendering the leak.
2. **Layer:** code (component).
3. **Probe:** `grep -n "runTier2Pipeline|confirmAiOutputs|refreshDeckReadiness|upsertTier1Place|syncGallery|.message|catch"` on both files.
4. **Evidence:** `VenueListingContent.tsx` only has a Toast host (`message={toast?.message ?? ""}` at L435); its toast messages come from `setSuccess`/`setError` callbacks (L135–146) fed by feedback-sheet copy, not pipeline `error.message`. `VenueSettingsModule.tsx` had ZERO matches for any pipeline fn, `.message`, or `catch`.
5. **Mechanism:** Neither component is on the gemini-error render path. The wizard is the sole renderer.
6. **Severity:** `RULED OUT`. Blast radius is confined to `VenueCreatorWizard.tsx` (+ its child `VenueStep7Review.tsx` for the defensive tier1 path).

---

## 5. Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction? |
|-------|-------|----------------|
| **Docs** | Seth's standing intent ("don't want people to know our technology") + ORCH-1217 scrubbed Ari copy. | Venue-authoring path was NOT covered by ORCH-1217 — the gate is scoped to `screens/ari` + `components/ari` ONLY (read verbatim from the 1217 gate). **GAP = the bug.** |
| **Schema** | `brand_place_pipeline_state.last_error_message/_code` store the raw reason by design (diagnostics). | None — diagnostics-only, not rendered (F-6). |
| **Code** | Edge emits `gemini_*` → returns it in `message` → service rethrows raw → component renders raw. | The L248–250 comment says "surface the REAL server reason" — TRUE intent was UX clarity, but it leaks the vendor. Code does exactly what it says; the spec/intent layer (no vendor disclosure) is what it violates. |
| **Runtime** | Not live-fired (deterministic string flow; backend/edge exemption). A 429 from the model → `gemini_failed:429:...` rendered on screen. | n/a |
| **Data** | `last_error_message` rows would contain `gemini_*` strings (diagnostics) — acceptable. | None. |

**Truth-holder:** the **Code** layer is internally consistent; the violation is of the **Docs/intent** layer (no-vendor-disclosure). The fix belongs at the code→user boundary in the business app.

---

## 6. Blast radius / cross-surface map

- **Single client call path** can carry a vendor code: `runTier2Pipeline()` → `handleRunAi` → `setMessage` → `<Text>` (VenueCreatorWizard.tsx L678→689→1067).
- **Defensive (same render code path, no gemini code today):** confirm / refresh / tier1(submitErr→VenueStep7Review) / sync_hero_media.
- **Component blast radius:** confined to `mingla-business/src/components/venue/VenueCreatorWizard.tsx` (+ child `VenueStep7Review.tsx`).
- **NOT affected:** `VenueListingContent.tsx`, `VenueSettingsModule.tsx` (F-7); `last_error_message`/`_code` rendering (F-6, none).

### Cross-surface (5 primary + 2 adjacent)

| Surface | In scope? | Why |
|---------|-----------|-----|
| 1. Consumer iOS (`app-mobile`) | NO | Venue authoring is a business-app feature; consumer never calls this pipeline. |
| 2. Consumer Android (`app-mobile`) | NO | Same. |
| 3. Buyer/anon Web | NO | Not a buyer surface. |
| 4. Business iOS | YES | `VenueCreatorWizard` ships here (native, rides next business build — COMMS-0052). |
| 5. Business Android | YES | Same. |
| 6. Admin Web (adjacent) | NO | `mingla-admin` Gemini refs are internal operator tooling — explicitly OUT per dispatch. |
| 7. Business Web preview (adjacent) | YES | `VenueCreatorWizard` renders on business web; fix ships via Vercel `[deploy]` (no OTA per COMMS-0052). |

Parity: AUTOMATIC across business iOS/Android/Web — they share the single React component `VenueCreatorWizard.tsx`. One fix covers all three.

---

## 7. Invariant impact

- ORCH-1217's `I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE` is scoped to the Ari dirs ONLY and does NOT cover the venue-authoring surface — verified by reading the 1217 gate (`ARI_DIRS = ["mingla-business/src/screens/ari", "mingla-business/src/components/ari"]`). A NEW sibling invariant is required for the venue path. (Proposed in SPEC as `I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK`, DRAFT.)
- No existing invariant is violated by adding a sanitizer; the META-ORCH-1009 Sub-E B6 intent (surface a USEFUL reason, not an opaque "non-2xx") must be PRESERVED — the fix must still show a useful, per-code human message, just without the vendor token.

---

## 8. Discoveries for Orchestrator

- **D-ORCH-1218-a:** `gemini_failed:<status>:<body>` leaks up to 200 chars of the raw Google API error JSON to the wire (F-1). Even with a client sanitizer, the server response body still carries it; anyone inspecting network traffic (browser devtools on business web) sees it. RECOMMENDATION (out of this ORCH's scope unless Seth wants it): consider redacting the `message` field server-side to a neutral token while keeping the raw reason in `last_error_message`/`console.error`. Flagged, NOT specced here (dispatch says keep raw codes server-side for debugging).
- **D-ORCH-1218-b:** ORCH-1217 is NOT yet merged to `origin/main` (lives on branch `origin/ORCH-1217-ari-vendor-copy-scrub`). The ORCH-1218 gate models the 1217 gate's `stripComments` helper; if 1217's gate file isn't on main when 1218 lands, the 1218 gate must carry its own copy of `stripComments` (do not `import` from a sibling gate that may not exist). Noted in SPEC.
- **D-ORCH-1218-c:** Business jest is NOT a blocking CI job (only `featureFlags.test.ts` runs) — per MEMORY + COMMS-0056. Therefore the regression guard MUST be a strict-grep gate wired into `strict-grep-mingla-business.yml`, not a jest test. (Drives the SPEC's gate choice.)

---

## 9. Confidence + recommended next phase

**Confidence: `proven`.** Full source trace, every layer read verbatim, the leak path sealed end-to-end (edge emit → wire → service rethrow → component render). Backend/edge/component string-flow audit — live-fire exempt; deterministic.

**Recommended next phase:** SPEC (sibling file `specs/SPEC_ORCH-1218_venue-authoring-vendor-error-scrub.md`) — introduce a single-owner client-side sanitization boundary in `mingla-business` that maps `gemini_*` (and any AI-vendor token) reasons to generic per-code messages before they reach `setMessage`/`setSubmitErr`, keep raw codes server-side, and add a sibling strict-grep gate. Then → implementor → tester → orchestrator CLOSE.

**Recommended scope (direction only, NOT a fix):** client-side sanitizer in the business app at the point pipeline errors become user-facing; cover the live path (handleRunAi) AND the defensive same-render-path catches; do NOT delete the raw edge codes; add a CI gate + DRAFT invariant.
