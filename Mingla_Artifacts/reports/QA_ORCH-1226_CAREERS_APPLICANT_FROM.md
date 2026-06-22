# QA — ORCH-1226 [careers applicant email sends from careers@usemingla.com]

**Verdict: PASS** — P0:0 · P1:0 · P2:0 · P3:1 · P4:1
**Branch:** `1226-careers-applicant-from` · **HEAD under test:** `c22cfb257`
**Worktree:** `~/Desktop/mingla-orchs/1226-[careers-applicant-from]/`
**Mode:** TARGETED. Backend/edge-only email-header change → **UI/runtime sim gate EXEMPT** (no screen, gesture, render, or user-visible state; pure Resend payload shape). Verified at the unit (Deno) + CI-gate + source-contract layers, all green.

---

## 1. Scope confirmation (diff vs origin/main)

`git diff --name-only origin/main..HEAD` returns EXACTLY 5 files — and **NO `_shared/**` file**:

```
.github/scripts/strict-grep/i-proposed-1226-careers-applicant-from.mjs   (NEW gate)
.github/workflows/strict-grep-mingla-business.yml                        (gate job appended)
Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1226_CAREERS_APPLICANT_FROM.md (report)
supabase/functions/careers-apply/__tests__/apply_happy.test.ts           (append-only: +2 tests, 0 deletions)
supabase/functions/careers-apply/index.ts                                (the change)
```

`git diff --name-only origin/main..HEAD | grep _shared` → **empty**. ✅ The `_shared/email/senders.ts` module is untouched (DO-NOT-TOUCH SPEC constraint honoured); the careers sender is built INLINE via `resolveCareersSender()` mirroring `resolveSender`.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | APPLICANT confirmation `from` = `"Mingla Careers <careers@usemingla.com>"` | **PASS** | `index.ts:519-527` `applicantFrom = formatSenderHeader(resolveCareersSender())`, sandbox fallback `"Mingla Careers <careers@usemingla.com>"`; passed into `buildApplicantEmail(...)` at `:532`. Deno test `email.from.includes("careers@usemingla.com")` + `"Mingla Careers"` PASS. |
| SC-2 | APPLICANT `reply_to: careers@usemingla.com` | **PASS** | `index.ts:302` `return { from, to:[email], reply_to: CAREERS_REPLY_TO, … }`; `CAREERS_REPLY_TO = "careers@usemingla.com"` (`:76`). Deno `assertEquals(email.reply_to, "careers@usemingla.com")` PASS. |
| SC-3 | NOTIFICATION `to: ["seth@usemingla.com"]` UNCHANGED | **PASS** | `index.ts:353` `to: ["seth@usemingla.com"]`. Deno PASS. |
| SC-4 | NOTIFICATION prior sender (`notifications@`/system) UNCHANGED | **PASS** | `index.ts:508-515` `notifyFrom` resolves `EMAIL_SENDERS.system` → `notifications@usemingla.com` (senders.ts:27), sandbox fallback `"Mingla <notifications@usemingla.com>"`; passed to `buildNotifyEmail(...)` at `:543`. Diff shows pre-fix BOTH emails shared one `from`; now split — notify path identical to prior behaviour. |
| SC-5 | NOTIFICATION has NO reply_to added | **PASS** | `buildNotifyEmail` return (`index.ts:351-357`) has NO `reply_to` key; `sendEmail` JSON.stringify omits it; Resend treats absent reply_to as none. Deno `assertEquals(notify.reply_to, undefined)` PASS. |
| SC-6 | RESEND_CAREERS_FROM env override resolves to a careers@ identity | **PASS** | `resolveCareersSender()` (`:77-84`) reads `RESEND_CAREERS_FROM`, parses display+address, defaults to `careers@usemingla.com`; never falls back to notifications@. Adversarial source-contract test PASS. |
| SC-7 | New gate green (real-run + self-test) + fails-on-revert | **PASS** | self-test 5/5 PASS; real-run PASS; reverting applicant `from`→`notifyFrom` + dropping reply_to → gate exit 1 (2 failures); restore → PASS. |
| SC-8 | Deno tests green | **PASS** | 21 passed / 0 failed (17 implementor `apply_happy` + 4 tester adversarial). `deno check index.ts` exit 0. |

---

## 3. Findings

### P3-1 — Implementor appended ORCH-1226 tests into an EXISTING test file (append-only, not a new file)
- **Evidence:** `apply_happy.test.ts` already exists on origin/main (from META-ORCH-1222); the implementor's two ORCH-1226 `Deno.test` blocks were appended to it (`git diff origin/main..HEAD` shows +41 lines, **0 deletions**).
- **Impact:** None functional. The `tests-append-only.yml` CI gate (`test-append-only-check.js`) blocks only modifications **with deleted lines** + requires a `[TEST-MOD-APPROVED]` token; a pure-append (0 deletions) is permitted. Verified deletion count = 0 → CI-compliant.
- **Required fix:** None (compliant). Noted only because tester discipline prefers NEW files; the tester's own adversarial test IS a new file, satisfying the "different angle, on-branch, in-diff" requirement.
- **Retest:** `git diff origin/main..HEAD -- …/apply_happy.test.ts | grep -cE '^-[^-]'` → 0.

### P4-1 — Clean, well-isolated implementation (praise)
- The change correctly keeps the two send paths fully independent: `notifyFrom` vs `applicantFrom` resolved separately, each with its own `assertNotResendSandbox` guard + literal fallback. The `sendEmail` payload union type was widened to accept either shape rather than mutating the notify path. No scope creep, no `_shared` edit, env-override pattern faithfully mirrors `resolveSender`.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

The implementor claimed fails-on-revert at `eec2d952c` (pre-commit working tree) against the GATE. I independently re-ran fails-on-revert against BOTH the gate AND the implementor's Deno test on HEAD `c22cfb257`:

- **Gate revert** (sed: `applicantFrom`→`notifyFrom` + drop `reply_to: CAREERS_REPLY_TO`): gate exited **1** with
  - `applicant Resend payload must set reply_to to "careers@usemingla.com".`
  - `buildApplicantEmail(...) must be called with the careers-derived 'applicantFrom'.`
  - Restore → gate exit **0**.
- **Implementor Deno test revert** (drop `reply_to: CAREERS_REPLY_TO` from the applicant return): test `ORCH-1226 — applicant email sets a careers Reply-To` **FAILED** (`apply_happy.test.ts:164`), 16 passed / 1 failed. Restore → 17/17 PASS.

Both proofs re-confirmed by the tester. `git checkout index.ts` left HEAD clean (zero diff).

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `supabase/functions/careers-apply/__tests__/applicant_from_adversarial.test.ts` (**NEW file**, append-only, in the closing diff).
- **Angle (distinct from the implementor's positive-shape happy path):** attacks the COMPLEMENT —
  1. applicant `from` is NOT the notify/system no-reply identity AND distinct from the notify `from`;
  2. applicant + notify NEVER share a reply_to (notify reply_to === undefined);
  3. careers reply_to routes to the careers inbox, NOT seth@;
  4. `RESEND_CAREERS_FROM` override resolves to a careers@ identity / default never falls back to notifications@ (source-contract assertion since `resolveCareersSender` is module-private).
- **Fixed code:** 4/4 PASS. `deno check` clean.
- **fails-on-revert verified at `c22cfb257`:** realistic full revert (applicant `from`→`notifyFrom`, drop reply_to from both the return type and value, matching origin/main shape) → tests 2 + 3 **FAIL** (the reply_to-bearing assertions). Restore → 4/4 PASS.
- Both the implementor happy-path test AND this adversarial test appear in `git diff origin/main..HEAD --name-only`. ✅

---

## 6. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | No UI. |
| 2 | One owner per truth | PASS | Careers sender owned solely by `resolveCareersSender`; notify sender by `EMAIL_SENDERS.system`. No competing writer. |
| 3 | No silent failures | PASS | Email failures `console.error`'d non-fatal by design (row already saved); both send results checked. |
| 4 | One query key per entity | N/A | No React Query. |
| 5 | Server state server-side | N/A | Edge function. |
| 6 | Logout clears everything | N/A | Anon endpoint. |
| 7 | `[TRANSITIONAL]` labelled | PASS | None present; none needed. |
| 8 | Subtract before adding | PASS | No new module; reused shell/senders by import; INLINE resolver (no senders.ts edit). |
| 9 | No fabricated data | PASS | Real applicant fields; no faked addresses. |
| 10 | Currency-aware | N/A | No money. |
| 11 | One auth instance | N/A | Service-role client only. |
| 12 | Validate at the right time | PASS | `receivedAt`/throttle preserved; unchanged. |
| 13 | Exclusion consistency | PASS | Throttle/role-open logic untouched. |
| 14 | Persisted-state startup | N/A | No client persistence. |

Zero violations.

---

## 7. Device / parity matrix

| Surface | Result | Note |
|---------|--------|------|
| Consumer iOS/Android | N/A | Careers apply is a marketing-web + edge endpoint; no consumer-app surface. |
| Buyer/anon Web | N/A | No buyer-web change (email header only). |
| Business iOS/Android/Web | N/A | No business surface. |
| Admin Web | N/A | Admin unchanged (CV viewing path untouched). |
| Edge function (careers-apply) | **VERIFIED (source/unit)** | `verify_jwt = false` (public, correct per design). **NOT deployed** (do-not-deploy QA); the live deploy still runs the pre-1226 version — applies only after merge + `functions deploy --project-ref gqnoajqerqhnvulmnyvv`. |

Live-fire sim gate EXEMPT (backend/edge email-header change, no UI/runtime surface).

---

## 8. Resend deliverability finding (delivery acceptance of careers@)

**FINDING: VERIFIED DOMAIN → NO BLOCKER.** `careers@usemingla.com` will be accepted by Resend with no additional verification step.

Evidence:
1. The master keys doc states verbatim: **"FROM addresses (all @usemingla.com — domain DKIM-verified in Resend)"**. The `usemingla.com` domain is verified at the DOMAIN level (DKIM), so ANY local-part `@usemingla.com` — including `careers@` — sends.
2. Corroborated by production usage: `_shared/email/senders.ts` already ships THREE distinct local-parts in active production — `notifications@`, `hello@` (admin), `tickets@` — all `@usemingla.com`. Resend's single-sender (one-off address verification) model permits only ONE verified address; sending from three distinct local-parts is ONLY possible under a verified DOMAIN. This rules out single-sender-only.

This RESOLVES the implementor report's Open Question ("`careers@usemingla.com` must be a verified Resend sending identity"): domain-level verification means no per-address add is required. No operator action needed before deploy for deliverability.

---

## 9. Discoveries for Orchestrator

- **No COMMS-ledger entry targets ORCH-1226.** The OPEN ledger rows (COMMS-0057/0059/0053 ID-collisions for 1206/1209/1195; COMMS-0060 careers-site → already RESOLVED as META-ORCH-1222) do not block this work. No ack required.
- **No ID collision risk:** ORCH-1226 is above the current main frontier; careers-site shipped as META-ORCH-1222. The `1226-` token namespace (gate, job, invariant `I-PROPOSED-1226-CAREERS-APPLICANT-FROM`) is unique on the workflow.
- At CLOSE, register `I-PROPOSED-1226-CAREERS-APPLICANT-FROM` as ACTIVE in the INVARIANT_REGISTRY (currently DRAFT/PROPOSED namespacing).

---

## Verdict line

**PASS** — P0:0 · P1:0 · P2:0 · P3:1 (compliant append-only note) · P4:1 (praise). Regression gate satisfied: implementor happy-path fails-on-revert re-run @ `c22cfb257`; tester adversarial test `supabase/functions/careers-apply/__tests__/applicant_from_adversarial.test.ts` (new file, in-diff, fails-on-revert @ `c22cfb257`). Diff scope clean (5 files, no `_shared`). Resend deliverability: verified domain, no blocker. NOT deployed, NOT merged (per dispatch). → routes to CLOSE.
