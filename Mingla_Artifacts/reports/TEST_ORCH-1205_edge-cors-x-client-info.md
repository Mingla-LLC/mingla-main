# TEST — ORCH-1205 [edge-function CORS missing `x-client-info` → team/scanner invites broken on web]

## 1. Verdict + P0–P4 count

**VERDICT: PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 1 (praise).

Backend/edge-function-only CORS change → exempt from the live-fire sim gate (no
mobile/UI/runtime surface). Regression gate satisfied: implementor happy-path
test (fails-on-revert independently re-run) **plus** a tester adversarial
**runtime** test (different angle, on-branch) **plus** the structural strict-grep
anti-recurrence gate. Both tests appear in `git diff origin/main...HEAD`.

Fix commit under test: `cc416fa43` (report-fill follow-up `e0483c866`). Branch
`1205-edge-cors-x-client-info`, up to date with `origin/main` after fetch+rebase.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | All 8 functions serve a CORS allow-list that includes `x-client-info` at RUNTIME | PASS | Tester runtime test invokes each function's actual OPTIONS handler; returned `Access-Control-Allow-Headers` = `authorization, x-client-info, apikey, content-type, accept-language` for all 8 (20/20 green). |
| SC-2 | The 7 browser-called invite/scanner/lead functions fixed (the actual bug) | PASS | list-my-pending-invites, invite-brand-member, invite-scanner, accept-brand-invitation, decline-brand-invitation, accept-scanner-invitation, beta-access-lead-submit all import `_shared/cors.ts`; runtime OPTIONS → 200 + x-client-info. |
| SC-3 | Cron-only process-booking-deadlines aligned for consistency | PASS | Runtime-verified via serve-shim import map: OPTIONS → 200 + x-client-info. |
| SC-4 | No behavior regression — method gate intact | PASS | Runtime: list-my-pending-invites + beta-access-lead-submit still return 405 `{error:"method_not_allowed"}` on GET. |
| SC-5 | Auth unchanged (verify_jwt) | PASS | `config.toml` NOT in fix commit; tester test reads config: 6 invite fns = `verify_jwt=true`, beta-lead = `false` (public form), as before. |
| SC-6 | Single source of truth | PASS | All 8 now serve `_shared/cors.ts` (`Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type, accept-language`); future fix is one-line. |
| SC-7 | Recurrence prevented structurally | PASS | New strict-grep gate fails any `supabase/functions/**/index.ts` that defines an inline allow-list omitting `x-client-info`; wired into the CI workflow; self-test 4/4. |

---

## 3. Findings

**P4 (praise):** The fix collapses 8 ad-hoc inline CORS objects onto the single
shared `_shared/cors.ts` allow-list — the canonical "one owner per truth" pattern.
A future header change is now a one-line edit, and the new strict-grep gate fences
the whole `supabase/functions/**` surface against re-introducing the bug. Clean,
minimal, scope-disciplined (logic/auth/methods/response shape untouched).

No P0/P1/P2/P3 findings.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

Implementor's happy-path test: `supabase/functions/_shared/__tests__/orch1205InviteCorsXClientInfo.test.ts` (source-string assertions).

- **GREEN (fixed tree):** `deno test --allow-read --allow-env --allow-net` → **9 passed | 0 failed**.
- **RED on revert (independently performed by tester):** restored `invite-brand-member/index.ts` to its pre-fix version (`git show 140a465ca:…`) — the test went RED with the exact assertion:
  > `AssertionError: invite-brand-member must allow x-client-info … Found via-shared=false, inline-ok=false.`
  Result: **8 passed | 1 failed**. Restored → working tree clean.

Commit hashes I checked out/ran: fixed `cc416fa43`; pre-fix source `140a465ca`.
Implementor's fails-on-revert claim **independently confirmed**.

---

## 5. Adversarial test added (tester-owned, DIFFERENT angle — RUNTIME not source-text)

- **Path:** `supabase/functions/_shared/__tests__/orch1205InviteCorsXClientInfoRuntime.test.ts`
- **Support files:** `_serveShim.ts` (captures `serve()` for the cron fn that calls `serve()` unguarded at module load) + `_importmap.test.json` (aliases the std `http/server.ts@0.168.0` URL to the shim).
- **Angle:** the implementor asserts on SOURCE TEXT. This test INVOKES each function's actual OPTIONS handler with a real `Request` and asserts the RETURNED `Response.headers.get("Access-Control-Allow-Headers")` actually contains `x-client-info` — runtime behavior, not text. 7 functions via their exported `handler`; the cron fn via the serve-shim.
- **No-regression assertions:** representative functions still 405 a GET; verify_jwt posture unchanged for all 8 (read from `config.toml`).
- **Run:** `deno test --import-map=supabase/functions/_shared/__tests__/_importmap.test.json --allow-read --allow-env --allow-net supabase/functions/_shared/__tests__/orch1205InviteCorsXClientInfoRuntime.test.ts` → **11 passed | 0 failed** (both files together: **20 passed | 0 failed**).
- **fails-on-revert verified at `cc416fa43`:** narrowing the single shared `_shared/cors.ts` allow-list to remove `x-client-info` turned **all 8** runtime preflight assertions RED (**8 failed**) while the method-gate + verify_jwt assertions stayed GREEN (proving no false coupling). Restored → clean. This is a stronger proof than the implementor's: it attacks the shared source of truth that every function now depends on.
- **Append-only:** new files only; the implementor's test is untouched. Both tests are in `git diff origin/main...HEAD --name-only`.

---

## 5b. Strict-grep recurrence gate (structural anti-recurrence)

- **Path:** `.github/scripts/strict-grep/orch-1205-edge-cors-x-client-info.mjs`
- **Rule:** scans every `supabase/functions/<fn>/index.ts`; FAILS if any inline `Access-Control-Allow-Headers` literal omits `x-client-info`. Exempts functions with no inline literal (they import shared cors, which is correct) and the `_shared` dir.
- **Self-test:** `node … --self-test` → **PASS (4/4: compliant-inline + shared-import clean; omitting-inline + multiline-omitting fail)**.
- **Live on repo:** **PASS** (exit 0).
- **Catches a regression:** reverting `invite-brand-member` to its pre-fix inline allow-list → gate **FAIL exit 1**, naming the offending file.
- **CI wiring:** new job `orch-1205-edge-cors-x-client-info` added to `.github/workflows/strict-grep-mingla-business.yml` (runs self-test then live; the workflow already triggers on `supabase/functions/**`).

---

## 6. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | No UI. |
| 2 | One owner per truth | PASS | CORS allow-list now single-owned by `_shared/cors.ts`. |
| 3 | No silent failures | PASS | Fix REMOVES a silent failure (preflight rejection → net::ERR_FAILED). |
| 4 | One query key per entity | N/A | No client query. |
| 5 | Server state server-side | N/A | No client state. |
| 6 | Logout clears everything | N/A | No auth-state change. |
| 7 | Label TRANSITIONAL | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | 8 inline objects deleted, one import added. |
| 9 | No fabricated data | N/A | No data. |
| 10 | Currency-aware | N/A | No money. |
| 11 | One auth instance | PASS | verify_jwt untouched; no auth client added. |
| 12 | Validate at right time | N/A | No validation change. |
| 13 | Exclusion consistency | N/A | No filtering. |
| 14 | Persisted-state startup | N/A | No persisted state. |

No violations.

---

## 7. Device / parity matrix

| Surface | Result | Reason |
|---------|--------|--------|
| Consumer iOS / Android | N/A | Edge-function-only; consumer app not a caller of these 8. |
| Buyer/anon Web | N/A (covered by runtime test) | The bug surfaced on business.usemingla.com web preflight; the runtime test simulates the exact OPTIONS preflight that browsers send. |
| Business iOS / Android | N/A | Native clients were unaffected (they tolerate the omitted header); the fix is a no-op for them. |
| Admin Web | N/A | Not a caller. |
| Edge-function (the change) | PASS (runtime) | 20/20 Deno tests; all 8 handlers invoked. |

**Live deploy state (read-only):** The fix is committed but NOT merged/deployed
(per dispatch: do NOT deploy). The currently-deployed edge functions still serve
the OLD allow-list — expected. After merge, Seth must deploy the 8 functions
(`supabase functions deploy …`) for the browser fix to take effect in production.
No verify_jwt change to redeploy.

---

## 8. Discoveries for Orchestrator

- The runtime test depends on two test-support files (`_serveShim.ts`,
  `_importmap.test.json`) under `__tests__/`. They are test-only, never imported by
  product code. If CI runs Deno tests, the runtime file requires the
  `--import-map` flag (documented in the test header) to reach the cron function;
  the other 19 assertions pass without it.
- `process-booking-deadlines` calls `serve()` at module load with NO
  `import.meta.main` guard (unlike the other 7). Not a defect for this ORCH, but a
  minor inconsistency worth a future cleanup note.

## 9. Accepted conditions

None (PASS, not CONDITIONAL).
