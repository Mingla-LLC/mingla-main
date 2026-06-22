# TEST — ORCH-1217 [Scrub AI-vendor disclosure from user-facing Ari copy]

**Tester:** mingla-tester (adversarial gatekeeper)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1217-[ari-vendor-copy-scrub]`
**Branch:** `ORCH-1217-ari-vendor-copy-scrub`
**Feature commit under test:** `43933e5b7`
**Date:** 2026-06-22

---

## 1. VERDICT

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 1 (clean gate construction)

Regression gate satisfied: implementor happy-path gate (fails-on-revert independently re-run, §4)
+ tester adversarial cases (g–j, different angle: live directory-scan + case/spacing, on-branch,
in-diff, each proven fails-on-revert by mechanism mutation, §5).

Exemption note: this is a **copy-string + CI-gate** change. No UI interaction/runtime logic was
touched (no layout/style/handler/state change — `git show` confirms only two JSX text strings
changed). Phase 0.A live-fire sim gate is therefore **N/A** (source-only sufficient per the
build-config/copy exemption); the rendered strings are static `<Text>` children with no conditional
or runtime dependency. The CI gate (the actual protection) was exercised live, not reasoned about.

COMMS-0052 (BLOCK, OTA freeze) — already ACKNOWLEDGED for ORCH-1217 by the orchestrator in the
ledger `acked_by` column. This TEST run performs no deploy/OTA/merge, so it complies by construction.

---

## 2. SC-BY-SC MATRIX

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | `AriSettingsScreen.tsx` About copy = "Mingla's AI", no vendor name | PASS | line 153: `Ari is powered by Mingla's AI.` — raw grep finds no vendor token in non-comment source |
| SC-2 | `AiDisclosureModal.tsx` intro copy = "Mingla's AI", no vendor name | PASS | line 103: `Ari is your AI co-pilot, powered by Mingla's AI.` |
| SC-3 | Gate `--self-test` PASS | PASS | exit 0, "self-test PASS (… 10/10)" after my additions (was 6/6 as shipped) |
| SC-4 | Gate live run PASS on current tree | PASS | exit 0, "no AI-vendor name … 'Mingla's AI' present in both" |
| SC-5 | Gate wired into CI workflow | PASS | `strict-grep-mingla-business.yml:2921` job `orch-1217-ari-no-vendor-disclosure` with `--self-test` step + live step; workflow triggers on `mingla-business/**` and `.github/scripts/strict-grep/**` |
| SC-6 | Gate FAILS on revert (vendor name restored) | PASS | §4 — exit 1, 4 precise failures |
| SC-7 | Gate catches a vendor leak in a NOT-named file inside the scoped dirs | PASS | §3 Probe 1 + tester case (g): exit 1 |

---

## 3. ADVERSARIAL PROBES (every angle + the gate's verdict)

Tree restored clean after each probe (`git status --porcelain` empty between probes; HEAD `43933e5b7`).

| # | Probe | Expected | Gate verdict | Result |
|---|-------|----------|--------------|--------|
| 1 | Vendor name in a THIRD NEW file in the scoped dir (`AriHelpScreen.tsx` → "powered by Gemini") | catch | **exit 1** — `AriHelpScreen.tsx:4: forbidden AI-vendor token "Gemini"` | CAUGHT |
| 2a | Case variation — lowercase `gemini` in named file | catch | **exit 1** — forbidden token + missing-approved-copy both fire | CAUGHT |
| 2b | Spacing variation — `Google  Gemini` (double space) | catch | **exit 1** — `\bgemini\b` matches regardless of leading spaces | CAUGHT |
| 3 | Vendor token ONLY in a code comment (new Ari file) | ignore (intentional, documented) | **exit 0** — comments stripped; a comment is not user-facing | IGNORED (intended) |
| 4 | DELETE the "Mingla's AI" disclosure line entirely (positive-assertion bypass) | catch | **exit 1** — `approved first-party copy "Mingla's AI" is MISSING` | CAUGHT |
| 5 (extra) | Vendor token in a STRING LITERAL beginning with `//` (masquerading as a comment) | catch (string ≠ comment) | **exit 1** — `AriStrProbe.tsx:3: forbidden … "Gemini"` | CAUGHT |

**Probe-3 behavior documentation (per dispatch):** the gate STRIPS comments before scanning
(`stripComments`, reused verbatim from `orch-1211-notif-web-render-safe.mjs`). A vendor token that
exists only in a `//` or `/* */`/JSDoc comment is intentionally ignored because a comment is not
user-facing copy. This is **acceptable and correct** for a user-facing-disclosure gate — and it is
not a loophole, because probe 5 proves the stripper does NOT over-strip: a vendor token in a string
literal whose text happens to start with `//` is still treated as code and IS caught.

**No probe found a gate failure to catch a genuinely user-facing vendor leak.** No P0/P1.

---

## 4. STEP 0.5 — INDEPENDENT RE-RUN OF THE IMPLEMENTOR'S FAILS-ON-REVERT PROOF

I did NOT trust the implementor's claim; I reproduced it by true line-edit of the shipped fix.

- **Checked-out commit:** `43933e5b7` (branch HEAD).
- **Revert performed:** restored `Ari uses Google Gemini.` in `AriSettingsScreen.tsx:153` AND
  `powered by Google Gemini` in `AiDisclosureModal.tsx:103`.
- **Gate on reverted tree:** `node …/orch-1217-ari-no-vendor-disclosure.mjs` → **exit 1**, with 4
  exact failures:
  - `AriSettingsScreen.tsx:153: forbidden AI-vendor token "Gemini" …`
  - `AiDisclosureModal.tsx:103: forbidden AI-vendor token "Gemini" …`
  - `AriSettingsScreen.tsx: approved first-party copy "Mingla's AI" is MISSING …`
  - `AiDisclosureModal.tsx: approved first-party copy "Mingla's AI" is MISSING …`
- **Gate on restored tree:** **exit 0**, "no AI-vendor name … present in both".
- **Tree after restore:** clean, HEAD `43933e5b7`.

Implementor fails-on-revert: **independently confirmed at `43933e5b7`.**

---

## 5. ADVERSARIAL TEST ADDED (tester-owned, different angle)

**Path:** `.github/scripts/strict-grep/orch-1217-ari-no-vendor-disclosure.mjs` — appended self-test
cases **(g)–(j)** (append-only; implementor cases (a)–(f) untouched). Per Seth's hard rule, this
extends a gate that ACTUALLY RUNS IN CI (jest is non-blocking and does not count); the cases are
exercised by the existing CI `--self-test` step.

**Different angle vs implementor:** the implementor's (a)–(f) call `checkForbidden()` on **inline
strings** only. My cases exercise the **end-to-end live directory-scan path** (`listSourceFiles →
checkForbidden`) that a real leak in an unnamed scoped-dir file actually hits, plus case/spacing
variations the inline cases never cover.

- **(g)** Live directory scan catches a vendor leak in a THIRD, not-explicitly-named file
  (`AriHelpScreen.tsx`) written into a temp scoped dir, and does NOT flag a clean sibling.
- **(h)** Lowercase `gemini` in user-facing text fires (case-insensitivity).
- **(i)** Double-spaced `Google  Gemini` fires.
- **(j)** Vendor token in a string literal beginning with `//` is NOT mis-stripped as a comment.

**PASS output:** `self-test PASS (6 implementor cases + 4 tester adversarial cases g–j = 10/10).`
Live gate still PASS (exit 0). Live-with-real-leak (third file `Anthropic Claude`) → exit 1.

**Fails-on-revert / teeth (each new case proven to fail when its mechanism breaks):**
- Mutation A — make `/\bgemini\b/i` case-SENSITIVE → case **(h)** fires, exit 1.
- Mutation B — make `stripComments` strip string-literal bodies → case **(j)** fires, exit 1.
- Mutation C — make `listSourceFiles` return `[]` (no recursion) → case **(g)** fires, exit 1.
- After each mutation the gate was restored byte-identical (`diff` IDENTICAL) and self-test returned 10/10.

**In closing diff:** yes — the gate file appears in `git diff origin/main...HEAD --name-only` (the
implementor's gate is the same file; my cases are appended to it on-branch, not absorbed via merge).

**fails-on-revert verified** on the tester commit (the commit that adds these cases — branch
`ORCH-1217-ari-vendor-copy-scrub`, the second commit after feature `43933e5b7`): cases g/h/j proven
to fire via mechanism mutations C/A/B respectively, restored byte-identical after each.

---

## 6. CONSTITUTION 14-RULE MATRIX

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | no interactive element added/changed |
| 2 | One owner per truth | PASS | copy is a static literal; gate is the single owner of the invariant |
| 3 | No silent failures | PASS | gate exits non-zero + prints precise failures |
| 4 | One query key per entity | N/A | no data fetch |
| 5 | Server state server-side | N/A | no state |
| 6 | Logout clears everything | N/A | no persisted state |
| 7 | Label `[TRANSITIONAL]` | N/A | permanent copy |
| 8 | Subtract before adding | PASS | swapped vendor name for first-party framing; no new surface |
| 9 | No fabricated data | PASS | "Mingla's AI" is a truthful first-party framing (Seth-approved), not fabricated metrics |
| 10 | Currency-aware | N/A | no money |
| 11 | One auth instance | N/A | Ari screens unchanged structurally |
| 12 | Validate at the right time | N/A | no validation |
| 13 | Exclusion consistency | N/A | no filtering |
| 14 | Persisted-state startup gate | N/A | no hydration |

No violations.

---

## 7. DEVICE / PARITY MATRIX

| Surface | Ships here? | Result | Note |
|---------|-------------|--------|------|
| Consumer iOS | No | skip | Ari business-app feature; not in app-mobile |
| Consumer Android | No | skip | same |
| Buyer/anon Web | No | skip | Ari screens are authed business surfaces |
| Business iOS | Yes (native) | PASS (source) | copy rides next business native build (OTA frozen, COMMS-0052) |
| Business Android | Yes (native) | PASS (source) | same |
| Business Web preview | Yes (Vercel) | PASS (source) | ships via Vercel `[deploy]` at CLOSE |
| Admin Web | No | skip | not an admin surface |

Copy is identical static text on all three business surfaces (one shared RN codebase); the change is
a string swap with no platform-conditional logic, so source parity = runtime parity here. Physical
iPhone HITL: not required — no interaction/runtime behavior changed; the protection (CI gate) was
exercised live, and the copy is a static literal verified by direct file read.

---

## 8. DISCOVERIES FOR ORCHESTRATOR (out of scope — NOT fixed here)

**D-1 (P2-class, separate ORCH candidate): venue-authoring pipeline can surface a raw `gemini_*`
error code to business users.** The Tier1/Tier2 venue-authoring error path
(`mingla-business/src/services/businessPlaceAuthoringService.ts` →
`pipelineInvokeError`/`assertPipelineOk`) deliberately surfaces the server's `{code, message}` to the
user (lines 117–155). The edge function `supabase/functions/run-business-place-authoring-pipeline/index.ts`
throws vendor-named error strings — `gemini_failed:<status>` (947), `gemini_empty` (957),
`gemini_unparseable_json` (971), `gemini_missing_evaluations` (975), `gemini_incomplete_coverage:…`
(994), `gemini_unconfigured` (857), `gemini_failed` (1022) — which become the `code`/`message` shown
in the venue-submit error UI. So a business user hitting a Gemini failure during venue authoring CAN
see the literal string "gemini". This is a genuine user-facing vendor leak, but it is in the
**venue-authoring pipeline, NOT the Ari co-pilot disclosure copy** that ORCH-1217 scopes — and the
gate correctly does not sweep outside the Ari dirs (intentional per its docstring). Recommend a
follow-up ORCH to (a) map these error codes to user-friendly non-vendor messages and (b) extend a
gate to the venue-authoring error surface. Zero blast on ORCH-1217.

**D-2 (P4, FYI): 5 in-Ari-dir "Gemini" comments remain** (`AriChatScreen.tsx:312`,
`agentChoices.ts:7`, `MessageList.tsx:72/131/329`). These are internal code comments, NOT user-facing,
and are correctly ignored by the gate. No action — documented so a future reader knows they are
intentional.

---

## 9. P4 PRAISE

The gate's comment-stripping reuse (verbatim from `orch-1211-notif-web-render-safe.mjs`) plus the
dual rule (forbidden-token negative + approved-copy positive) is a clean, defensible design: it
guards the WHOLE scoped dir (not just the two named files), catches the line-deletion bypass, and
avoids false-tripping on legitimate internal comments. The directory-recursion scan is what made
probe 1 (third-file leak) pass without any gate change.

---

## FINAL VERDICT LINE

**PASS** — 0 P0 / 0 P1 / 0 P2 / 0 P3 / 1 P4. Implementor fails-on-revert independently re-run at
`43933e5b7`; tester adversarial cases (g–j) added on-branch + in-diff, fails-on-revert proven by
mechanism mutation. One out-of-scope Discovery (D-1, venue-authoring vendor error codes) routed to
the orchestrator as a separate follow-up. Routes to CLOSE.
