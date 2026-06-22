# TEST — ORCH-1218 [Venue-authoring error path leaks raw "gemini_*" vendor codes to business users]

**Skill:** mingla-tester (production gatekeeper)
**Date:** 2026-06-22
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1218-[venue-authoring-vendor-error-scrub]/` on branch `ORCH-1218-venue-authoring-vendor-error-scrub`
**Implementor commit tested:** `23d1efcf6` → rebased onto `origin/main` to **`a23333389`** (clean additive CI-workflow conflict resolved: ORCH-1217 job + ORCH-1218 job now coexist).
**SPEC:** `specs/SPEC_ORCH-1218_venue-authoring-vendor-error-scrub.md` (SC-1..SC-8).
**Mode:** SPEC-COMPLIANCE + adversarial. Phase 0.A exemption: this is a **copy / error-mapping change** (pure string-transform util + 5 catch re-routings); the sanitizer LOGIC is source-only sufficient, and the dispatch explicitly accepts **source-trace** for the on-screen render. No simulator run performed — stated plainly per the dispatch.

---

## 1. Verdict + finding count

# VERDICT: PASS

- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 0
- **P4 (notes):** 2 (cosmetic `gemini_failed:4290` prefix quirk — no leak; pre-existing monorepo tsc baseline noise — not a regression)

Regression gate satisfied: implementor happy-path jest test (9/9 PASS, fails-on-revert independently re-run) **+** tester adversarial cases added to the **CI-enforced** gate self-test (the blocking guard; jest is not a blocking CI job). Both deviations from SPEC are **sound** (proven below). No vendor token leaks across every emitted edge-fn code form and every adversarial variant; no over-scrub of legitimate reasons.

---

## 2. SC-by-SC matrix

Evidence type per row: **util** = real `sanitizeAuthoringError` module exercised via jest; **source-trace** = data-path proven by reading the wizard + render targets; **gate** = strict-grep gate live/self-test/fails-on-revert.

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| **SC-1** | `gemini_failed:429:…` → "Mingla's AI is busy right now…"; `gemini` appears nowhere on screen | **PASS** | util: `gemini_failed:429:{...}` → busy msg, `.not.toContain("gemini")`. source-trace: `handleRunAi` L688–689 catch → `setMessage(sanitizeAuthoringError(error,"AI setup failed."))` → `message` state rendered at `VenueCreatorWizard.tsx:1067` `<Text>{message}</Text>`. Render not exercised on device — source-trace per dispatch. |
| **SC-2** | `gemini_unconfigured` → "…isn't available right now…" | **PASS** | util: returns exact unconfigured msg. |
| **SC-3** | `gemini_incomplete_coverage:…` / `gemini_empty` / `gemini_unparseable_json` / `gemini_missing_evaluations` / `gemini_missing_signal:…` / bare `gemini_failed` → mapped generic, never raw | **PASS** | util: each maps to its SPEC §4.4 message; `.not.toContain("gemini")` on suffixed forms. Adversarial: ALL 9 edge-fn-emitted forms (incl. `gemini_failed:500:…`) scrubbed (§3). |
| **SC-4** | non-vendor reason (`tier2_pipeline_failed`, `place_pool_link_missing`, network) unchanged | **PASS** | util: each returned verbatim. No over-scrub. |
| **SC-5** | different vendor token (`openai_overloaded`, `powered by Claude`) scrubbed via catch-all | **PASS** | util + adversarial: every vendor in the FORBIDDEN list (incl. underscore-suffixed, mid-string, different casing, two-word) → generic. |
| **SC-6** | "Google location" geocoding submit error renders verbatim (not scrubbed) | **PASS** | source-trace: `handleSubmit` L238–240 returns BEFORE the sanitizer fallback at L242. util: `"Pick a Google location to continue."` returned unchanged — FORBIDDEN list's `\bgoogle\s+ai\b` does NOT match "Google location". |
| **SC-7** | gate PASSES on fixed tree, FAILS on any §4.5 revert | **PASS** | gate: self-test 11/11 PASS, live PASS (exit 0). Fails-on-revert independently re-run: reverting `handleRunAi` L689 → gate exit 1 (§4). |
| **SC-8** | parity on business iOS / Android / Web (shared component) | **PASS (automatic)** | One React component `VenueCreatorWizard.tsx` renders on all three surfaces; no per-surface code. Web ships via Vercel `[deploy]`; iOS/Android ride next native build (COMMS-0052 OTA freeze). |

---

## 3. Adversarial probes + results

All probes ran the **real compiled `sanitizeAuthoringError` module** (ts-jest, transient probe files; removed after — append-only respected). `containsVendor()` = case-insensitive scan for `gemini/openai/anthropic/claude/gpt/google ai/vertex ai/bard/llama/mistral`.

### 3.1 Every edge-fn-emitted vendor code (cross-checked against `run-business-place-authoring-pipeline/index.ts`)

Emitted forms confirmed at source (L857/947/957/971/975/994/1022/1139):

| Input (raw `Error.message`) | Result | Leak? |
|------------------------------|--------|-------|
| `gemini_unconfigured` | "…isn't available right now…" | NO |
| `gemini_failed:429:{"error":"rate limit"}` | "…busy right now…" | NO |
| `gemini_failed:500:internal error from gemini backend` | generic | NO |
| `gemini_empty` | "…didn't return a result…" | NO |
| `gemini_unparseable_json` | "…unexpected result…" | NO |
| `gemini_missing_evaluations` | generic | NO |
| `gemini_incomplete_coverage:vibe_chill,vibe_loud,price_low` | generic | NO |
| `gemini_missing_signal:signal_abc_123` | generic | NO |
| `gemini_failed` (bare) | generic | NO |

**Result: 9/9 scrubbed, NONE leak a vendor token; all contain "Mingla's AI".**

### 3.2 Vendor-token variants

| Vector | Input | Result | Leak? |
|--------|-------|--------|-------|
| mid-string | `pipeline error: powered by OpenAI servers` | generic | NO |
| mid-string | `response from Anthropic was bad` | generic | NO |
| different casing | `GEMINI_FAILED` | generic | NO |
| different casing | `CLAUDE timed out` | generic | NO |
| underscore-suffixed | `openai_overloaded`, `claude_timeout`, `mistral_429`, `bard_unavailable`, `llama_oom` | generic | NO |
| `gpt-` form | `gpt-4o refused` | generic | NO |
| NEW two-word | `Vertex AI quota exceeded`, `Google AI Studio error` | generic | NO |
| leading whitespace | `  gemini_failed` | generic (catch-all `\bgemini`) | NO |
| after newline | `stack trace\n at gemini call` | generic | NO |

**Result: all variants caught by the per-code table or the unknown-vendor catch-all. NONE leak.**

### 3.3 No over-scrub of legitimate reasons (false-positive guard)

| Input | Result | Correct? |
|-------|--------|----------|
| `Pick a Google location to continue.` | returned verbatim | YES (SC-6) |
| `tier2_pipeline_failed` | verbatim | YES |
| `place_pool_link_missing` | verbatim | YES |
| `Network request failed` | verbatim | YES |
| `geminids meteor venue` | verbatim (NOT scrubbed) | YES — `(?![a-z])` rejects trailing letter |
| `a venue near Llamas Cafe` | verbatim | YES |
| `openait merchant` | verbatim | YES |
| `Claudette's Bistro is closed` | verbatim | YES |

**Result: zero over-scrub. The narrow boundary regex correctly distinguishes vendor tokens from English words that merely start with the same letters.**

### 3.4 Prefix-match / bypass edge cases

| Input | Result | Note |
|-------|--------|------|
| `gemini_failed:500:error code 429 seen` | generic (NOT falsely "busy") | 429-in-body does not falsely trigger the rate-limit branch |
| `gemini_failed:4290:weird` | "…busy…" | **P4 cosmetic:** `startsWith("gemini_failed:429")` matches `:4290` — wrong copy bucket but **NO LEAK** and not a real HTTP status the edge fn emits. Informational only. |
| `  gemini_failed` (leading space) | generic | startsWith misses, catch-all catches |
| `stack trace\n at gemini call` | generic | catch-all catches |

**Result: no leak under any bypass attempt.**

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out / operated at HEAD **`a23333389`** (rebased implementor commit).

- **Implementor happy-path test** `mingla-business/src/utils/__tests__/sanitizeAuthoringError.test.ts`: re-ran → **9/9 PASS** (T1–T8 + per-code).
- **Fails-on-revert (wizard):** reverted `VenueCreatorWizard.tsx:689` from `setMessage(sanitizeAuthoringError(error, "AI setup failed."))` → `setMessage(error instanceof Error ? error.message : "AI setup failed.");`. Ran the gate:
  - **Exit 1 (FAIL).** Exact failing assertion: *"`VenueCreatorWizard.tsx`: reverted raw pipeline shape `setMessage(error instanceof Error ? error.message ...)` is present — it re-introduces the raw vendor-code leak."*
  - Restored L689 → gate **exit 0 (PASS)**. Working tree clean.

The implementor's fails-on-revert claim is **independently confirmed** at `a23333389`.

---

## 5. Adversarial test added (tester-owned, different angle, CI-enforced)

**Path:** `.github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs` — extended the gate's `--self-test` with **4 new cases (8)–(11)**, additions-only (no existing line modified beyond the PASS-count message). This file is NOT a jest `*.test.*` / `__tests__/` file, so it is outside the `tests-append-only` scope, AND I added only — both compliant. It runs in the **blocking** `strict-grep-mingla-business.yml` CI job (the implementor's jest test does not).

Different angle than the implementor's revert-shape proof — these attack vectors the implementor's 7 self-test cases did NOT cover:

- **(8)** Vendor token in a **fully-wired wizard string literal** (4+ sanitizer calls + import + no reverted shape) → must trip rule (a) on the wizard. A *different leak vector* than reverted-shape (b).
- **(9)** Vendor token **after the sentinel array close** in the sanitizer → proves `dropVendorTokenListBlock` does NOT over-exempt the rest of the file (the second-table deviation is bounded).
- **(10)** Two-word vendor token `Vertex AI` in a wizard literal → multi-word boundary, not just single-word tokens.
- **(11)** A **partial raw revert coexisting with ≥4 compliant calls** → proves fail-on-revert is not bypassed by call count alone (a failure mode the implementor's case (1) does not cover).

**PASS proof:** `--self-test` → "self-test PASS (11/11 cases; +4 tester adversarial)" (exit 0); live gate exit 0.

**Each new case is meaningful (not a no-op) — fails-on-broken-gate verified:**
- Neutered `checkNoVendorToken` (rule a) → self-test reported failures for **(8), (9), (10)** as expected; restored.
- Neutered the `revertedMessage` regex (rule b) → self-test reported failures for **(1) and (11)** as expected; restored.

**fails-on-revert verified at `a23333389`** (wizard L689 revert) **and** broken-gate-neuter for the 4 new cases at the same HEAD.

**Closing-diff visibility:** `git diff origin/main...HEAD --name-only` includes both `mingla-business/src/utils/__tests__/sanitizeAuthoringError.test.ts` (implementor) and `.github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs` (tester adversarial cases live here).

---

## 6. Two SPEC-deviation assessments (report §13) — both SOUND

### Deviation (a): vendor-token regex `\b<token>(?![a-z])` instead of `\b…\b`

**Assessment: SOUND and NECESSARY.** SPEC §4.4 step 4 / §9 specify "word-boundaried" tokens. A trailing `\b` would **fail to catch** `openai_overloaded` / `claude_timeout` because `_` is a word character → there is no `\b` between `i` and `_`. The edge fn emits exactly these underscore-suffixed forms (`gemini_failed`, `gemini_empty`, …) and the SPEC's own SC-5 requires `openai_overloaded` to be caught. `(?![a-z])` is the correct construction: it requires the token NOT be immediately followed by a letter, so it matches the bare word AND the `_`-suffixed code, while rejecting false positives (`geminids`, `Llamas`, `openait`, `claudette` — all proven passing through in §3.3). **No hole created** — the deviation strictly improves on plain `\b` and over-scrubs nothing.

### Deviation (b): `gemini_*` prefix keys in a second sentinel-exempted table (`CODE_MESSAGE_TABLE`)

**Assessment: SOUND, BOUNDED.** SPEC §4.4 step 3 mandates the exact per-code mapping table whose left-hand keys are literally `gemini_*` strings. Those keys are **matching prefixes, never returned to the user** — only the right-hand "Mingla's AI" copy is returned (verified: every table row's value contains "Mingla's AI", none contains a vendor token). The gate's `dropVendorTokenListBlock` exempts this table block from rule (a) via the `// strict-grep-allow: vendor-token-list` sentinel. My adversarial case **(9)** proves the exemption is **bounded to the array** — a vendor token in a real string literal *after* the array closes still FAILS the gate. The gate's self-test case (3) independently proves a vendor token in a non-exempt string literal FAILS. **No hole:** the exemption cannot be abused to smuggle a user-facing vendor string past the gate.

---

## 7. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | No new interactive control; error-copy change only. |
| 2 | One owner per truth | **PASS** | Single sanitizer `sanitizeAuthoringError.ts` is the sole UI-boundary scrub owner; service/edge untouched (raw codes stay server-side for diagnostics). |
| 3 | No silent failures | **PASS** | All 5 catches still call `setMessage`/`setSubmitErr` with a non-empty user message (mapped, fallback, or passthrough); nothing is swallowed. |
| 4 | One query key per entity | N/A | No query keys touched. |
| 5 | Server state stays server-side | N/A | Pure local transform; no Zustand/server-state change. |
| 6 | Logout clears everything | N/A | No persisted/auth state. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code. |
| 8 | Subtract before adding | **PASS** | Replaces inline ternaries with one shared helper; net behavior consolidated, no parallel mechanism added. |
| 9 | No fabricated data | **PASS** | Maps error codes to honest generic copy; hides vendor identity (intended), fabricates no values/ratings/prices. |
| 10 | Currency-aware | N/A |
| 11 | One auth instance | **PASS** | Sanitizer/wizard add no `useAuth`; touched paths unchanged auth-wise (wizard already used `user?.id`). |
| 12 | Validate at the right time | N/A |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup gate | N/A |

No violations.

---

## 8. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Consumer iOS (`app-mobile`) | N/A | Not a consumer feature (SPEC §3). |
| Consumer Android | N/A | Same. |
| Buyer/anon Web | N/A | Not a buyer surface. |
| Business iOS | PASS (source-trace) | Shared `VenueCreatorWizard.tsx`; render path proven (catch → sanitizer → `setMessage`/`setSubmitErr` → `<Text>`). Not exercised on sim — copy/logic change, dispatch accepts source-trace. |
| Business Android | PASS (source-trace) | Same component, automatic parity. |
| Admin Web (adjacent) | N/A | Out per dispatch (internal tooling). |
| Business Web preview (adjacent) | PASS (source-trace) | Ships via Vercel `[deploy]`; NO `eas update` (COMMS-0052). |

**Physical iPhone (HITL):** not requested for this copy/logic change; the dispatch authorized source-level proof for the on-screen render. No physical-device step was applicable.

**Edge-fn live state:** N/A — no edge fn touched (DO-NOT-TOUCH honored). Raw `gemini_*` codes intentionally remain in `run-business-place-authoring-pipeline/index.ts` for server-side diagnostics (SPEC §4.2; OQ-1 wire-leak is a separate out-of-scope follow-up).

---

## 9. Scope / hard-guard compliance

- DO-NOT-TOUCH list honored: edge fn, `businessPlaceAuthoringService.ts`, hooks, `VenueStep7Review.tsx`, migrations, `mingla-admin/**`, `app-mobile/**`, the ORCH-1217 gate file — all unchanged by ORCH-1218's diff. Verified `git diff origin/main...HEAD --name-only` lists only the 5 allowlisted files + spec/investigation/report.
- The only DELETED line in my edit is the PASS-count message string ("7/7" → "11/11"); not a test-scope file. No product code modified by the tester.
- Rebase conflict in `strict-grep-mingla-business.yml` resolved additively (both ORCH-1217 and ORCH-1218 jobs present) — not a scope change, required to land on current `origin/main`.

---

## 10. Discoveries for Orchestrator

- **D-1 (P4, cosmetic):** `gemini_failed:4290:…` maps to the "busy" (429) copy via `startsWith("gemini_failed:429")`. No leak; `4290` is not an HTTP status the edge fn emits. Could tighten to `startsWith("gemini_failed:429:")` or `=== "gemini_failed:429"`-with-delimiter if ever desired. **Not a blocker; informational only.**
- **D-2 (carried from SPEC OQ-1, NOT in scope):** the server response `message` field still carries the raw `gemini_*` string on the wire (visible in business-web devtools / network capture). SPEC scrubbed only the rendered UI string per dispatch. If Seth wants the wire `message` neutralized too, that is a separate follow-up ORCH.
- **D-3:** monorepo `tsc --noEmit` baseline = 725 pre-existing errors (phone-input package, module resolution) — NONE in ORCH-1218 touched files. Not a regression; flagged so a future "typecheck must be clean" gate isn't surprised.

---

## 11. COMMS handled

- **COMMS-0052** (BLOCK, to ALL — business-app OTA freeze): factored. As tester I perform no deploy/OTA/merge, so I comply by default. Per tester worktree discipline I do NOT commit a ledger ack to anchor `main` — **noted for the orchestrator** to record at CLOSE (consistent with the implementor's existing COMMS-0052 ack for ORCH-1218).

---

## 12. Routing

**PASS → CLOSE (orchestrator).** Flip `I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK` to ACTIVE; ship business WEB via Vercel `[deploy]` ONLY; NO `eas update` (COMMS-0052; native rides next business build). Tester commit on the branch carries the 4 adversarial gate cases.
