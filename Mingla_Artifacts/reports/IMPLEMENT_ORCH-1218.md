# IMPLEMENTATION — ORCH-1218 [Scrub AI-vendor codes from venue-authoring user-facing errors]

**Skill:** mingla-implementor (claude side)
**Date:** 2026-06-22
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1218-[venue-authoring-vendor-error-scrub]/` on branch `ORCH-1218-venue-authoring-vendor-error-scrub`
**SPEC:** `specs/SPEC_ORCH-1218_venue-authoring-vendor-error-scrub.md` (contract)
**Status:** implemented and verified (source + gate proven; component live-render = SC-1/-9 unverified — UNVERIFIED, see §9).

---

## 1. Summary

Business venue operators could see a raw AI-vendor error code (`gemini_failed:429:…`, `gemini_incomplete_coverage:…`, `gemini_empty`, etc.) whenever the venue auto-authoring AI stage failed — those raw strings were rendered verbatim in `VenueCreatorWizard`. This change adds ONE client-side sanitizer that maps every vendor-tagged reason to a generic "Mingla's AI…" message before it reaches the screen, while non-vendor reasons (`tier2_pipeline_failed`, network errors, the "Google location" geocoding message) pass through unchanged. The raw codes are untouched server-side for debugging. A new strict-grep CI gate guarantees no vendor token can reach a user-facing error on this path again, and that none of the 5 wizard catches can revert to rendering a raw `error.message`.

Also handled COMMS-0052 (BLOCK, to ALL — business-app OTA freeze): this change is pure-JS, adds NO native dependency, performs NO `eas update`/deploy/merge. It ships to business WEB via Vercel `[deploy]` at CLOSE and rides the next business native build for iOS/Android.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Verified | How |
|----|-----------|----------|-----|
| SC-1 | `gemini_failed:429:…` → "…busy right now…"; no `gemini` on screen | ✓ (util) / UNVERIFIED (on-screen) | Unit test T2 PASS; component render not exercised on device/sim |
| SC-2 | `gemini_unconfigured` → "…isn't available right now…" | ✓ | Unit test T3 PASS |
| SC-3 | `gemini_incomplete_coverage`/`gemini_empty`/`gemini_unparseable_json`/`gemini_missing_evaluations`/`gemini_missing_signal`/bare `gemini_failed` → mapped generic, never raw | ✓ | Unit tests T4 + per-code test + T5 PASS |
| SC-4 | non-vendor reason (`tier2_pipeline_failed`, `place_pool_link_missing`, network) unchanged | ✓ | Unit test T1 PASS |
| SC-5 | different-vendor token (`openai_overloaded`, `powered by Claude`) scrubbed via catch-all | ✓ | Unit test T6 PASS |
| SC-6 | "Google location" geocoding submit error renders verbatim (not scrubbed) | ✓ | Unit test T8 PASS; wizard L237–239 branch returns BEFORE the sanitizer |
| SC-7 | gate PASSES on fixed tree, FAILS on revert of any §4.5 edit | ✓ | Live PASS + 2 fails-on-revert proofs (§6) |
| SC-8 | parity on business iOS/Android/Web (shared component) | ✓ (automatic) | Single `VenueCreatorWizard.tsx`; no per-surface code |

Commit satisfying all: see §6 commit hash.

---

## 3. Files changed

| File | Change | Lines |
|------|--------|-------|
| `mingla-business/src/utils/sanitizeAuthoringError.ts` | CREATE — the single-owner sanitizer | +122 |
| `mingla-business/src/components/venue/VenueCreatorWizard.tsx` | EDIT — 1 import + 5 catches routed through sanitizer | +9 / −9 (net 18 changed) |
| `.github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs` | CREATE — CI gate + `--self-test` | +427 |
| `.github/workflows/strict-grep-mingla-business.yml` | EDIT — append one job (self-test + run) | +13 |
| `mingla-business/src/utils/__tests__/sanitizeAuthoringError.test.ts` | CREATE — jest unit tests T1–T8 (9 specs) | +108 |

All 5 files are inside the SPEC's scoped allowlist (§ allowlist items 1–5). No DO-NOT-TOUCH file changed (edge fn / service / hooks / VenueStep7Review / migrations / mingla-admin / app-mobile all untouched — verified by `git status`).

---

## 4. Data-model changes applied

NONE. `brand_place_pipeline_state.last_error_message`/`last_error_code` keep storing the raw reason (diagnostics). No migration.

---

## 5. Edge functions touched

NONE. `run-business-place-authoring-pipeline/index.ts` is unchanged — keeps emitting raw `gemini_*` codes + `console.error` + `lastErrorMessage` persistence. `verify_jwt` for that function is unchanged (not touched).

---

## 6. The mapping table (SPEC §4.4)

Implemented as a sentinel-exempted, longest-prefix-first table (`CODE_MESSAGE_TABLE`), iterated in order so `gemini_failed:429` matches before bare `gemini_failed`:

| Raw code (prefix match) | User-facing message |
|--------------------------|---------------------|
| `gemini_failed:429` | "Mingla's AI is busy right now. Please wait a moment and try again." |
| `gemini_unconfigured` | "Mingla's AI isn't available right now. Please try again shortly." |
| `gemini_empty` | "Mingla's AI didn't return a result. Please try again." |
| `gemini_unparseable_json` | "Mingla's AI returned an unexpected result. Please try again." |
| `gemini_missing_evaluations` | GENERIC ("Mingla's AI couldn't finish setting up your listing. Please try again.") |
| `gemini_incomplete_coverage` | GENERIC |
| `gemini_missing_signal` | GENERIC |
| `gemini_failed` (any other/bare) | GENERIC |
| (catch-all) any other forbidden vendor token | GENERIC |
| (default) no code, no token | raw, unchanged — or `fallback` if raw empty |

Catch-all token list (mirrored in the gate): `gemini, openai, anthropic, claude, gpt-, google ai, vertex ai, bard, llama, mistral`, each `\b<token>(?![a-z])` case-insensitive. The `(?![a-z])` (rather than a trailing `\b`) is a deliberate fix found during testing: `\bopenai\b` does NOT match `openai_overloaded` (underscore is a word char, so no boundary), which would have silently leaked SC-5's own example. `(?![a-z])` matches the bare word AND the `_suffixed` code form. The narrow `\bgoogle\s+ai(?![a-z])` deliberately does NOT match "Google location" (SC-6 preserved).

---

## 7. The 5 wired catches (SPEC §4.5)

| Handler | Before | After |
|---------|--------|-------|
| `handleRunAi` (LIVE leak) | `setMessage(error instanceof Error ? error.message : "AI setup failed.");` | `setMessage(sanitizeAuthoringError(error, "AI setup failed."));` |
| `handleConfirm` | `setMessage(error instanceof Error ? error.message : "Could not confirm AI outputs.");` | `setMessage(sanitizeAuthoringError(error, "Could not confirm AI outputs."));` |
| `handleRefresh` | `setMessage(error instanceof Error ? error.message : "Could not refresh deck readiness.");` | `setMessage(sanitizeAuthoringError(error, "Could not refresh deck readiness."));` |
| `handleSubmit` (tier1) | `setSubmitErr(e instanceof Error ? e.message : "Could not submit. Try again.");` | `setSubmitErr(sanitizeAuthoringError(e, "Could not submit. Try again."));` |
| `handleCoverChange` | `setMessage(error instanceof Error ? error.message : "Cover saved, but deck readiness did not sync yet.");` | `setMessage(sanitizeAuthoringError(error, "Cover saved, but deck readiness did not sync yet."));` |

Import added: `import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";` (next to the existing `../../utils/deckReadinessRoutes` import).

**Preserved untouched** (per SPEC §4.5 MUST PRESERVE): L230–235 `SlugCollisionError` branch; L237–239 `"Google location"` geocoding branch (returns before the sanitized fallback); L647/L660 `VenueGalleryError` catches (non-pipeline; left as raw `e.message`). `VenueStep7Review.tsx` unchanged (renders the now-sanitized `submitError` prop).

### Old → New receipt

**`VenueCreatorWizard.tsx`** — *Before:* 5 pipeline catches rendered the raw `error.message`/`e.message` directly to the user, so a `gemini_*` reason leaked the AI vendor name on screen. *Now:* each routes the error through `sanitizeAuthoringError(error, <same fallback>)`, mapping vendor codes to generic copy while passing non-vendor reasons through. *Why:* SPEC SC-1..SC-6; the live leak at `handleRunAi`. *Lines:* 18 changed (1 import + 5 catches).

**`sanitizeAuthoringError.ts`** — *Before:* did not exist. *Now:* exports `sanitizeAuthoringError(err, fallback)` with the §4.4 contract. *Why:* the single UI-boundary sanitizer. *Lines:* +122.

---

## 8. The gate (SPEC §9)

**Path:** `.github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs`
**Invariant:** `I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK` (DRAFT — flips ACTIVE at CLOSE).
**`stripComments`:** copied VERBATIM from the canonical `i-proposed-1213-payment-webhook-silence-info-only.mjs` helper (NOT imported; the ORCH-1217 sibling gate is not on `origin/main`, confirmed absent on this rebased branch).

What it checks (comments stripped first):
- **(a)** No forbidden vendor token in non-comment source of `sanitizeAuthoringError.ts` + `VenueCreatorWizard.tsx`. The sanitizer's two `strict-grep-allow: vendor-token-list` blocks (the FORBIDDEN regex array + the `CODE_MESSAGE_TABLE` code-prefix keys) are exempted via `dropVendorTokenListBlock` (sentinel-line → next `];`).
- **(b)** Structural binding: the wizard imports `sanitizeAuthoringError` AND calls it ≥4 times, AND contains NO reverted `setMessage(error instanceof Error ? error.message …)` / `setSubmitErr(e instanceof Error ? e.message …)` shape. This is the fail-on-revert tripwire.
- **(c)** Positive presence: `sanitizeAuthoringError.ts` contains the approved phrase `Mingla's AI`.

`--self-test` has 7 adversarial cases: (1) reverted `setMessage` → FAIL(b); (2) clean → PASS; (3) vendor token in a string literal → FAIL(a); (4) vendor token only in a comment → PASS; (5) missing "Mingla's AI" → FAIL(c); (6) reverted `setSubmitErr` → FAIL(b); (7) missing import + too-few-calls → FAIL(b).

Registered in `strict-grep-mingla-business.yml` as job `orch-1218-venue-authoring-no-vendor-leak` (checkout, setup-node 20, self-test step, run step), mirroring the `orch-1213-*` / `orch-1211-*` stanzas, with a `name:` citing the invariant.

---

## 9. Proof runs

```
$ node .github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs --self-test
ORCH-1218 I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK self-test PASS (7/7 cases).   [exit 0]

$ node .github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs        (fixed tree)
ORCH-1218 … PASS — no vendor token …; VenueCreatorWizard routes every pipeline catch
through sanitizeAuthoringError; approved 'Mingla's AI' copy present.                    [exit 0]

$ npx jest src/utils/__tests__/sanitizeAuthoringError.test.ts
Tests: 9 passed, 9 total                                                                [exit 0]
```

**Fails-on-revert (true line replacement, NOT comment-out), proven twice:**
- Reverted `handleRunAi` L689 to raw `setMessage(error instanceof Error ? error.message …)` → gate exit 1, flagged the exact reverted shape; restored → PASS.
- Reverted `handleSubmit` to raw `setSubmitErr(e instanceof Error ? e.message …)` → gate exit 1, flagged the exact reverted shape; restored → PASS.

**Typecheck:** `npx tsc --noEmit` on `mingla-business` — ZERO errors in the 3 ORCH-1218 files (`sanitizeAuthoringError.ts`, `VenueCreatorWizard.tsx`, `sanitizeAuthoringError.test.ts`). The 67 remaining `tsc` errors are pre-existing baseline noise (missing `@testing-library/react-native` type decls in other tests, `app.config.ts` dup-key, `../packages/phone-input/*`, checkout `any` params) — none introduced by this ORCH.

**UNVERIFIED:** SC-1/SC-9 component live-render on device/sim was NOT exercised (no simulator run this turn). The util + state path are proven by unit + gate; on-screen confirmation that `<Text>` shows the mapped copy and no `gemini` substring is left for the tester (SPEC §11 routes this to mingla-tester).

`fails-on-revert verified at <commit hash below>` — test path `mingla-business/src/utils/__tests__/sanitizeAuthoringError.test.ts` (happy-path, 9 specs PASS) + the gate's structural fail-on-revert (§9).

---

## 10. Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| Consumer iOS / Android (`app-mobile`) | NO | venue authoring is business-only |
| Buyer/anon Web | NO | not a buyer surface |
| Business iOS | YES | AI-stage failure shows generic copy — parity AUTOMATIC (shared component) |
| Business Android | YES | same — AUTOMATIC |
| Admin Web | NO | OUT per dispatch |
| Business Web preview | YES | same — AUTOMATIC; ships via Vercel `[deploy]` (NO `eas update`, COMMS-0052) |

---

## 11. Known issues / deferred

- **OQ-1 (SPEC §10):** D-ORCH-1218-a — the server response `message` field still carries the raw `gemini_*` string on the wire (visible in business-web devtools/network). This change scrubs only the rendered UI string per dispatch. Deferred to Seth (default: NO follow-up). Not in scope.
- No `[TRANSITIONAL]` code introduced.

---

## 12. Operator action required (orchestrator / Seth)

- **CLOSE:** flip `I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK` to ACTIVE in `INVARIANT_REGISTRY.md`.
- **Ship:** business WEB via Vercel `[deploy]` ONLY. **NO `eas update`** for `mingla-business` (COMMS-0052 OTA freeze; native rides the next business build).
- **No migration `db push`.** **No edge-fn deploy.** (None changed.)

---

## 13. Discoveries for Orchestrator

- The SPEC's `\b…\b` "word-boundaried" token spec would have failed its own SC-5 example (`openai_overloaded`): a trailing `\b` does not exist between a letter and `_`. Implemented as `\b<token>(?![a-z])` (matches bare word + `_suffixed` code). This is a correctness improvement faithful to SC-5 intent, applied identically in the sanitizer and the gate. Flagging because the SPEC §4.4/§9 token-list wording says "word-boundaried" — if any future gate copies that literal `\b…\b` phrasing it will under-match underscore-suffixed codes.
- The SPEC §9(a) "exempt the regex-definition block via a sentinel" assumed only ONE vendor-token block in the sanitizer. The sanitizer also legitimately contains `gemini_*` code-prefix string literals (the matching keys). I moved them into a SECOND sentinel-exempted `CODE_MESSAGE_TABLE` so rule (a) stays clean — functionally equivalent to the SPEC's illustrative `raw.startsWith(...)` shape, longest-prefix-first preserved.
