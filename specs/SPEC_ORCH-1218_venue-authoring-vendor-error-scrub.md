# SPEC — ORCH-1218 [Scrub AI-vendor codes from venue-authoring user-facing errors]

**Skill:** mingla-forensics (SPEC mode)
**Date:** 2026-06-22
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1218-[venue-authoring-vendor-error-scrub]/` on branch `ORCH-1218-venue-authoring-vendor-error-scrub`
**Investigation:** `investigations/INVESTIGATE_ORCH-1218_venue-authoring-vendor-leak.md` (this worktree) — `proven`.
**Binding:** This SPEC is a contract. The implementor builds exactly this. Anything outside the allowlist requires a stop-and-amend.

---

## 1. Executive summary

The venue auto-authoring AI stage can fail and return a raw error string that contains our AI vendor's name (`gemini_failed:429:...`, `gemini_incomplete_coverage:...`, `gemini_empty`, etc.). Today that raw string is rethrown by the business-app service and rendered verbatim to the venue operator in `VenueCreatorWizard`. Seth's standing intent is that users never learn which AI technology powers Mingla (ORCH-1217 established this for the Ari co-pilot copy; this is the second leak the 1217 tester found).

The fix: introduce **one** client-side sanitization function in `mingla-business` that maps any AI-vendor-tagged reason to a generic, human, per-code message BEFORE it reaches `setMessage`/`setSubmitErr`, while the RAW code stays untouched server-side (edge fn `console.error` + `brand_place_pipeline_state.last_error_message`) for debugging. A new strict-grep CI gate (sibling to ORCH-1217's) guards the venue-authoring surface so a vendor token can never reach a user-facing error string on this path again.

---

## 2. Scope & non-goals

**In scope:**
- A single sanitization boundary in the business app that strips/maps AI-vendor tokens out of user-facing venue-authoring error messages.
- Wiring it into every catch in `VenueCreatorWizard.tsx` that renders a pipeline `error.message` to the user (1 live path + 4 defensive same-render-path catches).
- A strict-grep regression gate + DRAFT invariant.

**Non-goals (explicit):**
- **Do NOT change the edge function's emitted codes.** The raw `gemini_*` codes stay in the edge fn (server-side debugging + `last_error_message` diagnostics) — per dispatch. (Edge fn is in the DO-NOT-TOUCH list.)
- **Do NOT redact the server response `message` field.** That is Discovery D-ORCH-1218-a (network-trace leak), flagged for Seth, NOT in this scope.
- **Do NOT touch `mingla-admin`** — its Gemini refs are internal operator tooling, explicitly out per dispatch.
- **Do NOT touch consumer (`app-mobile`)** — venue authoring is business-only.
- **Do NOT regress non-vendor error reasons** (`tier2_pipeline_failed`, `place_pool_link_missing`, network errors, `VenueGalleryError`, slug-collision, "Google location" geocoding messages) — these stay as-is (the sanitizer is a no-op for them).
- **Do NOT convert business jest to a blocking CI job** — the guard is strict-grep (D-ORCH-1218-c).

**Assumptions:** ORCH-1217's gate may not yet be on `origin/main` (D-ORCH-1218-b) — the new gate carries its OWN `stripComments` copy; it does not import from the 1217 gate.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | NO | n/a — not a consumer feature | none | n/a |
| 2 | Consumer Android (`app-mobile`) | NO | n/a | none | n/a |
| 3 | Buyer/anon Web | NO | n/a — not a buyer surface | none | n/a |
| 4 | Business iOS | YES | AI-stage failure shows a generic, non-vendor message ("Mingla's AI couldn't finish setting up your listing…") | `VenueCreatorWizard.tsx` + new sanitizer util | AUTOMATIC (shared component) |
| 5 | Business Android | YES | Same | same | AUTOMATIC |
| 6 | Admin Web (adjacent) | NO | OUT per dispatch (internal tooling) | none | n/a |
| 7 | Business Web preview (adjacent) | YES | Same; ships via Vercel `[deploy]` (NO `eas update` — COMMS-0052) | same | AUTOMATIC |

Parity is automatic across surfaces 4/5/7 because they all render the one React component `VenueCreatorWizard.tsx`. No per-surface success-criterion split is needed.

---

## 4. Layered specification

### 4.1 Database — NO CHANGE
`brand_place_pipeline_state.last_error_message` / `last_error_code` keep storing the raw reason (diagnostics, never rendered — F-6). No migration.

### 4.2 Edge function — NO CHANGE
`run-business-place-authoring-pipeline/index.ts` keeps emitting raw `gemini_*` codes, keeps `console.error` (L1694), keeps persisting `lastErrorMessage` (L1233). In DO-NOT-TOUCH list.

### 4.3 Service — NO CHANGE
`businessPlaceAuthoringService.ts` keeps `pipelineInvokeError`/`assertPipelineOk` exactly as-is. Rationale: the service is layer-agnostic (could be reused by a non-UI caller, e.g. a background sync, that legitimately wants the raw reason for logging). Sanitization belongs at the UI boundary, NOT in the service. In DO-NOT-TOUCH list.

### 4.4 NEW utility — the single-owner sanitizer

**Create:** `mingla-business/src/utils/sanitizeAuthoringError.ts`

**Exported signature:**
```ts
export function sanitizeAuthoringError(err: unknown, fallback: string): string
```

**Contract:**
1. Derive the raw reason: `const raw = err instanceof Error ? err.message : "";`
2. If `raw` is empty → return `fallback` (the existing per-call fallback strings are preserved as the `fallback` arg).
3. **Per-code mapping (exact table).** Match by `raw.startsWith(<code>)` (codes can carry suffixes like `:429:...`, `:<csv>`, `:<id>`). Order longest-prefix-first so `gemini_failed:` is not shadowed by a bare check, and check the suffixed forms before bare `gemini_failed`:

   | Raw code (prefix match) | User-facing message (returned) |
   |--------------------------|--------------------------------|
   | `gemini_unconfigured` | `"Mingla's AI isn't available right now. Please try again shortly."` |
   | `gemini_failed:429` (rate limit) | `"Mingla's AI is busy right now. Please wait a moment and try again."` |
   | `gemini_failed` (any other status, incl. bare) | `"Mingla's AI couldn't finish setting up your listing. Please try again."` |
   | `gemini_empty` | `"Mingla's AI didn't return a result. Please try again."` |
   | `gemini_unparseable_json` | `"Mingla's AI returned an unexpected result. Please try again."` |
   | `gemini_missing_evaluations` | `"Mingla's AI couldn't finish setting up your listing. Please try again."` |
   | `gemini_incomplete_coverage` | `"Mingla's AI couldn't finish setting up your listing. Please try again."` |
   | `gemini_missing_signal` | `"Mingla's AI couldn't finish setting up your listing. Please try again."` |

   (`gemini_failed:429` MUST be tested before generic `gemini_failed` — the 429 mapping is more specific.)
4. **Defense-in-depth unknown-vendor catch-all.** After the explicit table, run a forbidden-token scan on `raw` (the SAME token list as the gate: `Gemini, OpenAI, Anthropic, Claude, GPT-, Google AI, Vertex AI, Bard, Llama, Mistral` — word-boundaried, case-insensitive — EXCEPT do not treat the legitimate phrase "Google location" as a vendor hit; that geocoding message must pass through, see §4.5 exception). If `raw` matches ANY forbidden token, return the generic `"Mingla's AI couldn't finish setting up your listing. Please try again."` (so a NEW or differently-named vendor code added later is auto-scrubbed even before the table is updated).
5. **Otherwise** (no known code, no vendor token) → return `raw` UNCHANGED (preserves the META-ORCH-1009 Sub-E B6 intent: surface the useful real reason for non-vendor errors like `tier2_pipeline_failed`, `place_pool_link_missing`, network errors).
6. **No vendor token may appear anywhere in this file's source** (the mapping values say "Mingla's AI", never "Gemini"). The gate scans this file too (§9).

**Illustrative shape (≤3 lines, NOT the implementation):**
```ts
if (raw.startsWith("gemini_failed:429")) return "Mingla's AI is busy right now. Please wait a moment and try again.";
// ... table ...
if (FORBIDDEN.some((re) => re.test(raw))) return GENERIC; // catch-all
return raw || fallback;
```

### 4.5 Component — `VenueCreatorWizard.tsx` (wire the sanitizer into every user-facing catch)

Replace the raw `error.message` rendering at each catch with `sanitizeAuthoringError(error, <existing fallback>)`. Exact edits:

| Handler | Line (current) | Current | Becomes |
|---------|----------------|---------|---------|
| `handleRunAi` (LIVE) | 689 | `setMessage(error instanceof Error ? error.message : "AI setup failed.");` | `setMessage(sanitizeAuthoringError(error, "AI setup failed."));` |
| `handleConfirm` | 720–722 | `setMessage(error instanceof Error ? error.message : "Could not confirm AI outputs.");` | `setMessage(sanitizeAuthoringError(error, "Could not confirm AI outputs."));` |
| `handleRefresh` | 743–745 | `setMessage(error instanceof Error ? error.message : "Could not refresh deck readiness.");` | `setMessage(sanitizeAuthoringError(error, "Could not refresh deck readiness."));` |
| `handleSubmit` (tier1) | 241–243 | `setSubmitErr(e instanceof Error ? e.message : "Could not submit. Try again.");` | `setSubmitErr(sanitizeAuthoringError(e, "Could not submit. Try again."));` |
| `handleCoverChange` | 609–613 | `setMessage(error instanceof Error ? error.message : "Cover saved, but deck readiness did not sync yet.");` | `setMessage(sanitizeAuthoringError(error, "Cover saved, but deck readiness did not sync yet."));` |

**MUST PRESERVE (do NOT route through the sanitizer / do NOT change):**
- L230–235 `SlugCollisionError` branch (slug collision copy is non-vendor, user-helpful).
- L237–239 the `"Google location"` geocoding branch: `if (e instanceof Error && e.message.includes("Google location")) { setSubmitErr(e.message); return; }` — this is a Google **Places/geocoding** message, NOT an AI-vendor disclosure, and is user-actionable ("pick a Google location"). It returns BEFORE reaching the sanitized fallback at L241, so it is untouched. The sanitizer's forbidden-token list MUST NOT match "Google location" (the `\bgoogle\s+ai\b` pattern won't, but the implementor must verify no broader `\bgoogle\b` rule is added).
- L647, L660 photo/gallery `VenueGalleryError` catches — non-pipeline, non-vendor; leave as raw `e.message` (gallery upload errors are user-actionable and never carry a gemini code). OPTIONAL: may also route through the sanitizer (it's a no-op for them) for uniformity — implementor's choice, but NOT required and must not change their displayed text for non-vendor inputs.

**Import:** add `import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";` (adjust relative path to match the file's existing import block ordering).

### 4.6 Child component — `VenueStep7Review.tsx` — NO CHANGE
It renders whatever `submitError` prop it receives (L63). Because `handleSubmit` now passes the sanitized string, the child needs no edit.

---

## 5. Success criteria (numbered, observable, testable)

- **SC-1:** When `runTier2Pipeline` rejects with `Error("gemini_failed:429:...")`, the venue deck-readiness screen shows `"Mingla's AI is busy right now. Please wait a moment and try again."` — and the string `gemini` / `Gemini` appears NOWHERE on screen.
- **SC-2:** When it rejects with `Error("gemini_unconfigured")`, screen shows `"Mingla's AI isn't available right now. Please try again shortly."`
- **SC-3:** When it rejects with `Error("gemini_incomplete_coverage:vibe_chill,vibe_loud")`, `Error("gemini_empty")`, `Error("gemini_unparseable_json")`, `Error("gemini_missing_evaluations")`, `Error("gemini_missing_signal:abc")`, or bare `Error("gemini_failed")`, the screen shows the mapped generic message from §4.4 and NEVER the raw code.
- **SC-4:** When it rejects with a NON-vendor reason — `Error("tier2_pipeline_failed")`, `Error("place_pool_link_missing")`, a network error — the screen shows that reason UNCHANGED (no regression of META-ORCH-1009 Sub-E B6 useful-reason behavior).
- **SC-5:** A reason that contains a DIFFERENT vendor token (e.g. `Error("openai_failed")`, `Error("powered by Claude")`) is scrubbed to the generic message by the catch-all (§4.4 step 4).
- **SC-6:** The `"Google location"` geocoding submit error still renders verbatim (not scrubbed) — non-AI Places message preserved.
- **SC-7:** The new gate `orch-1218-venue-authoring-no-vendor-leak.mjs` PASSES on the fixed tree and FAILS if any §4.5 edit is reverted to raw `error.message` (proven fails-on-revert).
- **SC-8 (parity, automatic):** SC-1..SC-6 hold identically on business iOS, Android, and Web because they share `VenueCreatorWizard.tsx`. (No separate per-surface code.)

---

## 6. Invariants

**New (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip):**

- **`I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK`** — On the business venue-authoring user-facing error path, no AI-vendor token (`Gemini/OpenAI/Anthropic/Claude/GPT-/Google AI/Vertex AI/Bard/Llama/Mistral`) may reach a rendered error string, AND every `VenueCreatorWizard` catch that feeds `setMessage`/`setSubmitErr` from a pipeline-service call MUST route the error through `sanitizeAuthoringError`. Enforced by `orch-1218-venue-authoring-no-vendor-leak.mjs` (§9).

**Preserved:**
- META-ORCH-1009 Sub-E B6 (surface a USEFUL non-vendor reason, not an opaque "non-2xx") — PRESERVED by §4.4 step 5 (non-vendor reasons pass through unchanged).
- `I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE` — UNAFFECTED (different scope: Ari dirs). The 1218 gate is a sibling, not a replacement.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy) | non-vendor reason passes through | `Error("tier2_pipeline_failed")` | returns `"tier2_pipeline_failed"` | util |
| T2 (error) | rate-limit mapped | `Error("gemini_failed:429:{...}")` | returns the 429 message; no `gemini` substring | util |
| T3 (error) | unconfigured mapped | `Error("gemini_unconfigured")` | returns the unconfigured message | util |
| T4 (edge) | suffixed coverage code | `Error("gemini_incomplete_coverage:a,b")` | generic message; no `gemini` | util |
| T5 (edge) | bare fallback | `Error("gemini_failed")` | generic message | util |
| T6 (edge) | other-vendor catch-all | `Error("openai_overloaded")` | generic message | util |
| T7 (edge) | empty/non-Error | `null` / `{}` | returns the `fallback` arg | util |
| T8 (edge) | Google location preserved | `Error("Pick a Google location to continue.")` | returns it UNCHANGED (not scrubbed) | util |
| T9 (component) | live render | mock `runTier2Pipeline` rejects `gemini_failed:429` | `message` state = 429 copy; `<Text>` shows no vendor token | component |
| T10 (gate) | fails-on-revert | revert L689 to raw `error.message` | gate exits non-zero | CI |

T1–T8 are unit tests of `sanitizeAuthoringError` (jest — informational, NOT the blocking guard). T10 is the blocking guard.

---

## 8. Implementation order

1. Create `mingla-business/src/utils/sanitizeAuthoringError.ts` (§4.4) with the exact mapping table + catch-all + Google-location passthrough.
2. Edit `VenueCreatorWizard.tsx` — add the import; wire the 5 catches per §4.5; preserve the slug + Google-location branches.
3. Create the gate `.github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs` (§9) with `--self-test`.
4. Register the gate job in `.github/workflows/strict-grep-mingla-business.yml` (append a job, mirroring the ORCH-1217 stanza pattern).
5. (Optional, recommended) Add `sanitizeAuthoringError.test.ts` for T1–T8.
6. Run the gate (`--self-test` then real) PASS; prove fails-on-revert (T10); run business typecheck/lint on the two touched src files.

---

## 9. Regression prevention — the gate (fails-on-revert)

**Create:** `.github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs`
**Model:** `orch-1217-ari-no-vendor-disclosure.mjs` (copy its `stripComments` verbatim — do NOT import it; D-ORCH-1218-b: 1217 may not be on main).

**Rules (all must hold; comments stripped before scanning so internal code comments naming Gemini never false-trip):**

- **(a) No forbidden AI-vendor token in NON-COMMENT source of the sanitizer + wizard.** Scope = exactly two files:
  `mingla-business/src/utils/sanitizeAuthoringError.ts` and `mingla-business/src/components/venue/VenueCreatorWizard.tsx`.
  Forbidden token list (word-boundaried, case-insensitive): `Gemini, OpenAI, Anthropic, Claude, GPT-, Google AI, Vertex AI, Bard, Llama, Mistral`. (The sanitizer's own FORBIDDEN regex literals are the one allowed exception — see (c); implement by allowing the token list to live inside a clearly-marked array OR by scanning only string/JSX-text literals. Simplest robust approach: scan stripped source and EXEMPT the sanitizer file's regex-definition block via a sentinel comment `// strict-grep-allow: vendor-token-list` on those lines, mirroring how other gates carve out their own definition lines.)
- **(b) Structural binding — the wizard must route pipeline errors through the sanitizer.** Assert that `VenueCreatorWizard.tsx` contains `sanitizeAuthoringError(` at least 4 times (the 4 mandatory catches: handleRunAi, handleConfirm, handleRefresh, handleSubmit; handleCoverChange = 5th) AND imports it. Assert that NO `setMessage(` / `setSubmitErr(` call in the file passes a bare `error.message`/`e.message` for the pipeline catches — specifically, the gate FAILS if it finds the pattern `setMessage(\s*error instanceof Error \? error.message` or `setSubmitErr(\s*e instanceof Error \? e.message` (the reverted shape). This is what makes it FAIL-on-revert: restoring raw `error.message` re-introduces that exact pattern.
- **(c) Positive presence.** `sanitizeAuthoringError.ts` MUST contain the approved phrase `Mingla's AI` (so a future edit that deletes the mapping, not just swaps a token, is also caught).

**`--self-test`:** inline fixtures — (1) a wizard fixture with raw `setMessage(error instanceof Error ? error.message ...)` MUST FAIL rule (b); (2) a clean fixture with `sanitizeAuthoringError(error, ...)` ×4 + import MUST PASS; (3) a sanitizer fixture containing "Gemini" in a STRING literal MUST FAIL rule (a); (4) a comment-only "Gemini" fixture MUST PASS (comments stripped); (5) a fixture missing `Mingla's AI` MUST FAIL rule (c).

**Protective comment** at the top of the gate: explain WHY (Seth: users must never learn the AI vendor; ORCH-1218 venue-authoring leak; sibling to ORCH-1217).

**Workflow stanza** (append to `strict-grep-mingla-business.yml`, mirroring the 1217 block):
```yaml
  orch-1218-venue-authoring-no-vendor-leak:
    name: "ORCH-1218: no AI-vendor token in venue-authoring user-facing errors; sanitizeAuthoringError wired in VenueCreatorWizard (I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Self-test the ORCH-1218 gate
        run: node .github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs --self-test
      - name: Run ORCH-1218 gate
        run: node .github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs
```

---

## 10. Open questions

- **OQ-1 (for Seth):** D-ORCH-1218-a — the server response `message` field still carries the raw `gemini_*` string on the wire (visible in business-web devtools / network capture). This SPEC scrubs only the rendered UI string per dispatch ("keep raw codes server-side for debugging"). Do you also want a follow-up ORCH to neutralize the wire `message` (keeping the raw reason in `last_error_message`/`console.error`)? Default: NO (out of scope here).
- **OQ-2:** Exact final copy wording for the 8 mapped messages is the designer/product call. The §4.4 table is the recommended copy; if Seth/product wants different phrasing, swap the message strings (the gate only requires "Mingla's AI" present + no vendor token, so any approved non-vendor copy passes).

---

## 11. Downstream routing

- **Next = mingla-implementor (claude side).** Build §4.4–§4.5 + §9 in this worktree.
- **Then = mingla-tester.** Verify SC-1..SC-8, prove gate fails-on-revert (T10), confirm no vendor token renders on business iOS/Android/Web for `VenueCreatorWizard` AI-stage failure.
- **Then = mingla-orchestrator CLOSE.** Flip `I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK` to ACTIVE; ship business WEB via Vercel `[deploy]` ONLY; **NO `eas update`** (COMMS-0052 OTA freeze in force — native rides the next business build).

**Working tree:** `~/Desktop/mingla-orchs/ORCH-1218-[venue-authoring-vendor-error-scrub]/` on branch `ORCH-1218-venue-authoring-vendor-error-scrub`.

---

## Scoped allowlist (implementor MAY change ONLY these)

1. `mingla-business/src/utils/sanitizeAuthoringError.ts` — CREATE (§4.4)
2. `mingla-business/src/components/venue/VenueCreatorWizard.tsx` — EDIT (§4.5; 5 catches + 1 import only)
3. `.github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs` — CREATE (§9)
4. `.github/workflows/strict-grep-mingla-business.yml` — EDIT (append one job, §9)
5. (Optional) `mingla-business/src/utils/__tests__/sanitizeAuthoringError.test.ts` — CREATE (T1–T8)
6. Artifacts under this worktree's `Mingla_Artifacts/reports/` (implementor report).

## DO-NOT-TOUCH (stop-and-amend before any change)

- `supabase/functions/run-business-place-authoring-pipeline/index.ts` — raw codes stay (server-side debugging).
- `mingla-business/src/services/businessPlaceAuthoringService.ts` — `pipelineInvokeError`/`assertPipelineOk` unchanged (layer-agnostic).
- `mingla-business/src/hooks/useBrandPlacePipelineState.ts`, `VenueStep7Review.tsx`, `VenueListingContent.tsx`, `VenueSettingsModule.tsx` — no change.
- Any migration / DB object (`last_error_message` stays raw).
- `mingla-admin/**`, `app-mobile/**` — out of scope.
- The ORCH-1217 gate file — do not edit/import; copy its `stripComments` into the new gate instead.
