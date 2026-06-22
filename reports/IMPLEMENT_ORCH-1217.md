# IMPLEMENT — ORCH-1217 [Scrub AI-vendor disclosure from user-facing Ari copy]

**Status:** implemented and verified.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1217-[ari-vendor-copy-scrub]/` on branch `ORCH-1217-ari-vendor-copy-scrub`.
**Surface:** business-app Ari co-pilot copy (mingla-business RN codebase → web + iOS + Android). No native dep, no deploy/OTA/merge performed.

---

## 1. Summary

Removed every user-facing mention of the AI vendor ("Google Gemini") from the
business-app Ari co-pilot disclosure copy, replacing it with the Seth-approved
first-party framing **"Mingla's AI"**, and added a CI-enforced strict-grep gate
that fails the build if any AI-vendor name leaks back into user-facing Ari copy
OR if the approved "Mingla's AI" framing goes missing.

Two copy strings changed; one new gate + one workflow job added. Copy-only —
no layout, styles, or logic touched.

---

## 2. Files changed (before → after copy)

### `mingla-business/src/screens/ari/AriSettingsScreen.tsx` (About section, ~line 153)

**Before:**
```
Ari uses Google Gemini. Your conversations are stored so Ari remembers context across
visits. Ari is not a financial, legal, or tax advisor.
```
**After:**
```
Ari is powered by Mingla's AI. Your conversations are stored so Ari remembers context across
visits. Ari is not a financial, legal, or tax advisor.
```
Only the first sentence changed; line wrapping/indentation preserved. Net: 1 line changed.

### `mingla-business/src/components/ari/AiDisclosureModal.tsx` (intro body, ~line 103)

**Before:**
```
Ari is your AI co-pilot, powered by Google Gemini. It can create brands and events
for you, and answer questions about your business.
```
**After:**
```
Ari is your AI co-pilot, powered by Mingla's AI. It can create brands and events
for you, and answer questions about your business.
```
Net: 1 line changed.

### `.github/scripts/strict-grep/orch-1217-ari-no-vendor-disclosure.mjs` (NEW)
CI gate (see §3). ~330 lines.

### `.github/workflows/strict-grep-mingla-business.yml` (job added)
New job `orch-1217-ari-no-vendor-disclosure` (Self-test step + Run step), inserted
after `orch-1213-payment-webhook-silence-info-only`, mirroring the
`orch-1211-notif-web-render-safe` block. Net: +13 lines.

---

## 3. CI gate — what it checks

**Path:** `.github/scripts/strict-grep/orch-1217-ari-no-vendor-disclosure.mjs`
**Invariant:** `I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE`
**Wired into:** `.github/workflows/strict-grep-mingla-business.yml` → job `orch-1217-ari-no-vendor-disclosure` (checkout, setup-node 20, Self-test step `--self-test`, Run step).

What it does:
- **(a) Forbidden-token scan** across `mingla-business/src/screens/ari/` AND
  `mingla-business/src/components/ari/` (the whole dirs, recursively, `.ts`/`.tsx`,
  skipping `__tests__`). FAILS if any of these AI-vendor tokens appear in
  NON-COMMENT source (case-insensitive, word-boundaried): `Gemini`, `OpenAI`,
  `Anthropic`, `Claude`, `GPT-`, `Google AI`, `Vertex AI`, `Bard`, `Llama`,
  `Mistral`. Comments (`//`, `/* */`, JSDoc) are STRIPPED before scanning
  (`stripComments` reused verbatim from `orch-1211-notif-web-render-safe.mjs`),
  so the legitimate internal code comments that mention "Gemini" in
  `AriChatScreen.tsx`, `agentChoices.ts`, and `MessageList.tsx` never false-trip.
  Scope is the two Ari dirs ONLY.
- **(b) Positive assertion** that `"Mingla's AI"` is present in BOTH
  `AriSettingsScreen.tsx` AND `AiDisclosureModal.tsx` — so a future edit that
  deletes the disclosure line (not just swaps the vendor) is also caught.
- **(c) `--self-test`** runs 6 inline-fixture cases: dirty "Google Gemini" must
  FAIL; clean "Mingla's AI" must PASS; vendor name in a `//` comment must PASS;
  vendor name in a block/JSDoc comment must PASS; other vendors (OpenAI/GPT-/Claude/
  Anthropic) in user-facing text must FAIL; positive-assertion present/absent both
  detect correctly. Exits non-zero if any expectation is wrong.

---

## 4. Proof runs (four, mandatory)

Commit hash for fails-on-revert reference: **`HEAD of branch ORCH-1217-ari-vendor-copy-scrub`** (filled below).

### Proof 1 — `--self-test` → PASS (exit 0)
```
$ node .github/scripts/strict-grep/orch-1217-ari-no-vendor-disclosure.mjs --self-test
ORCH-1217 I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE self-test PASS (6/6 cases).
exit=0
```

### Proof 2 — gate on FIXED tree → PASS (exit 0)
```
$ node .github/scripts/strict-grep/orch-1217-ari-no-vendor-disclosure.mjs
ORCH-1217 I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE PASS — no AI-vendor name in
user-facing Ari copy; "Mingla's AI" present in both AriSettingsScreen + AiDisclosureModal.
exit=0
```

### Proof 3 — reintroduce "Google Gemini" in AiDisclosureModal.tsx → MUST FAIL (then restore)
```
ORCH-1217 ... FAIL — the Ari co-pilot copy regressed ...
Failures:
  mingla-business/src/components/ari/AiDisclosureModal.tsx:103: forbidden AI-vendor token "Gemini" in user-facing Ari copy — "Ari is your AI co-pilot, powered by Google Gemini. ...". Use the Seth-approved first-party framing "Mingla's AI" (ORCH-1217).
  mingla-business/src/components/ari/AiDisclosureModal.tsx: approved first-party copy "Mingla's AI" is MISSING ...
exit=1
--- restored; re-run -> PASS (exit 0) ---
```

### Proof 4 — delete the "Mingla's AI" line in AriSettingsScreen.tsx → MUST FAIL on positive assertion (then restore)
```
ORCH-1217 ... FAIL — the Ari co-pilot copy regressed ...
Failures:
  mingla-business/src/screens/ari/AriSettingsScreen.tsx: approved first-party copy "Mingla's AI" is MISSING — the Ari disclosure line must state Ari is powered by "Mingla's AI" (ORCH-1217). Do not delete or reword away the disclosure.
exit=1
--- restored; re-run -> PASS (exit 0) ---
```

All four temporary edits were restored; `git diff --stat` after the proofs shows ONLY
the two intended copy lines + the workflow addition + the new gate file.

**fails-on-revert verified at `HEAD of branch ORCH-1217-ari-vendor-copy-scrub`** — the gate FAILS on vendor-name
reintroduction (Proof 3) AND on deletion of the approved "Mingla's AI" copy
(Proof 4), and PASSES on the shipped fix (Proofs 1–2).

---

## 5. Regression test — the CI gate IS the protection

Per the Seth HARD MUST (`feedback_close_tester_regression_protection_hard_must.md`):
every shipped fix must be guarded by something that ACTUALLY RUNS IN CI. This is a
copy-only change with no runtime logic to unit-test; the regression protection is the
strict-grep gate above, wired as a blocking job into `strict-grep-mingla-business.yml`
(a CI workflow that runs on PRs), with `--self-test` proving FAIL-on-vendor and
PASS-on-clean, plus the live fails-on-revert proofs (§4). The invariant
`I-PROPOSED-1217-ARI-NO-VENDOR-DISCLOSURE` is ACTIVE.

---

## 6. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS | No | Ari is a business-app feature only |
| Consumer Android | No | same |
| Buyer/anon Web | No | not an Ari surface |
| Business iOS | Yes (copy) | shared RN code; parity automatic; ships with next business native build (OTA blocked — see §7) |
| Business Android | Yes (copy) | same |
| Business Web preview | Yes (copy) | shared RN code; parity automatic; ships via Vercel `[deploy]` |
| Admin Web | No | not an Ari surface |

Parity is automatic across all business surfaces (one RN codebase). No manual mirroring.

---

## 7. Operator action required (orchestrator/Seth — NOT this skill)

- **No migration, no edge function** touched.
- **OTA: BLOCKED** by COMMS-0052 (business `eas update` is frozen until a new
  business native build ships — `posthog-react-native` hard-import). This change
  ships to business WEB via Vercel `[deploy]` ONLY; the iOS/Android copy update
  rides the next business native build. NO `eas update` for mingla-business.
- Route to orchestrator for REVIEW → tester dispatch. No merge/deploy by implementor.
- **Also handled COMMS-0052** (BLOCK, to ALL, OPEN): acked — this work adds no
  native dep and performs no OTA/deploy, fully complying with the freeze.

---

## 8. Confirmations

- **No native dependency added** — no `package.json`/lockfile/Podfile/build.gradle/
  app.config/eas.json touched (`git status` confirms NONE).
- **No deploy / OTA / merge** performed — that is the orchestrator's job.
- Scope held to exactly the 2 copy strings + the gate + the workflow job + this report.
- Working tree clean of all temporary proof edits.
