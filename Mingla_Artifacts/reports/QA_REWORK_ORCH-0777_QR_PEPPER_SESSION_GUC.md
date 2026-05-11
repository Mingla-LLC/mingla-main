# QA REWORK ORCH-0777 - QR Pepper Session GUC

Verdict: **PASS** (with two non-blocking P3 deploy-choreography advisories)
Date: 2026-05-11
Owner: Claude `mingla-tester`
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)
Scope: Independent verification that the implementor rework removes
database-level QR pepper dependence and replaces it with a bounded
service-role RPC argument contract, without weakening B2 RLS, without
exposing the pepper value, and without running live-fire.

Inputs verified:
- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`
- `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_QR_TOKEN_PEPPER_CONFIG_GATE.md` (superseded)
- `Mingla_Artifacts/reports/DEPLOY_ORCH-0777_EDGE_FUNCTIONS_AND_SECRETS.md` (superseded)
- `Mingla_Artifacts/reports/TEST_REPORT_RETEST_ORCH-0777_B2_QR_CREDENTIAL_RLS_TIGHTENING.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_B2_QR_CREDENTIAL_RLS_TIGHTENING.md`
- `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql`
- `supabase/migrations/20260515000015_orch_0777_b2_ticket_qr_credential_rls.sql`
- `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql`
- `supabase/functions/_shared/ticketCheckout.ts`
- `supabase/functions/_shared/stripeWebhookRouter.ts`
- `supabase/functions/ticket-checkout-create/index.ts`
- `supabase/functions/ticket-checkout-status/index.ts`
- `supabase/functions/ticket-confirmation-dispatch/index.ts`
- `supabase/functions/scan-ticket/index.ts`
- `supabase/functions/_shared/__tests__/ticketCheckout.test.ts`
- `supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts`
- `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts`
- `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`

Hard guards respected during this QA:
- Pepper value never read from local `.env`, secrets store, or any artifact.
- No live-fire executed.
- No `mcp__supabase__apply_migration` invocation. All DB observations were
  read-only (file/grep) or, where mentioned, read-only `supabase migration list --linked` per the implementor's prior report.
- B2 grants and revokes inspected only — never modified.
- ORCH-0777 not routed to CLOSE.

## Verdict Summary

| Criterion | Result | Evidence |
| --- | --- | --- |
| Repo gates | PASS | `npm run test:orch-0777` clean; strict-grep `orch-0777-ticket-checkout-production.mjs` enforces new contract on signatures, RPC argument passing, and absence of database-level config |
| SQL contract (migration 20260515000016) | PASS | DROPs all 4 legacy signatures; CREATEs 4 pepper-argument signatures plus `biz_ticket_checkout_assert_qr_pepper` guard; REVOKE ALL ... FROM PUBLIC + GRANT EXECUTE service_role only; zero `current_setting`/`ALTER DATABASE`/`pg_reload_conf` references |
| Edge Function secret handling | PASS | `qrTokenPepper()` reads `Deno.env.get("app.qr_token_pepper")`, trims, rejects missing/short(<32)/`local-ticket-pepper`; never logs the value; tests use synthetic 32-char strings |
| Runtime path wiring | PASS | Free checkout (`ticket-checkout-create`), paid webhook (`stripeWebhookRouter` → `payment_intent.succeeded`), and scan validation (`scan-ticket`) all call `qrTokenPepper()` and pass `p_qr_token_pepper` into the bounded RPCs |
| B2 RLS preservation | PASS | New migration does not re-grant `qr_code`/`qr_token_hash` SELECT to anon/authenticated; new helper signatures are `REVOKE ALL FROM PUBLIC` and `GRANT EXECUTE ... TO service_role` only; old 2-arg helpers were DROPped, so the only callable QR-payload generators are service-role + pepper-arg |
| Deployment readiness | CONDITIONAL — see P3 advisories | Migration `20260515000016` not yet remote-applied; Edge Functions not yet redeployed; both gates owned by orchestrator + operator per memory `feedback_orchestrator_deploys_edge_functions.md` |
| Pepper value exposure | PASS | No console statement, artifact, test fixture, or commit contains the production pepper value; only the secret NAME (`app.qr_token_pepper`) appears in code/docs |
| Live-fire | NOT RUN (intentional, per hard guard) | Live-fire matrix still rows-NOT-RUN, gated on this PASS + DB push + Edge Function redeploy |

Overall verdict: **PASS**. Findings P3/P4 only; zero P0/P1/P2.

## Evidence Detail

### Repo Gates

```
$ cd mingla-business && npm run test:orch-0777
ORCH-0777 production checkout guard passed.
PASS src/utils/__tests__/phone.test.ts
PASS src/services/__tests__/eventOrdersService.test.ts
PASS src/services/__tests__/ticketCheckoutMigrationGuards.test.ts
PASS src/services/__tests__/ticketCheckoutService.test.ts
Test Suites: 4 passed, 4 total
Tests:       10 passed, 10 total
```

Strict-grep gate file: `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`
- Lines 126–150 enforce migration 20260515000016 DROPs the legacy 4-arg `biz_ticket_checkout_finalize`, 3-arg `biz_ticket_scan`, 2-arg `biz_ticket_checkout_qr_payload`, and 1-arg `biz_ticket_checkout_token_hash`; GRANTs only the pepper-argument signatures to `service_role`; forbids `current_setting('app.qr_token_pepper')`, `pg_reload_conf(`, and `alter database` in the new migration.
- Lines 152–170 enforce that `_shared/ticketCheckout.ts` reads the secret by name, every runtime path passes `p_qr_token_pepper` into its bounded RPC, and historical reports (`IMPLEMENTATION_ORCH-0777_QR_TOKEN_PEPPER_CONFIG_GATE.md`, `DEPLOY_ORCH-0777_EDGE_FUNCTIONS_AND_SECRETS.md`) carry an explicit "Superseded note (2026-05-10)" tag plus the live-fire prompt forbids the database-level route.

Jest migration guards: `mingla-business/src/services/__tests__/ticketCheckoutMigrationGuards.test.ts`
- Section "supersedes database-level QR pepper GUC fallback with bounded service-role RPC parameters" (lines 81–93) directly asserts the SQL contract: pepper-typed argument present, `qr_token_pepper_missing` exception present, all four DROPs present, both bounded GRANTs present, and no `current_setting('app.qr_token_pepper'`, `pg_reload_conf`, or `alter database` in the new migration body.
- Section "passes the Edge Function QR pepper secret into every QR-dependent RPC" (lines 95–105) verifies the Edge Function-side wiring.

```
$ deno test --allow-env supabase/functions/_shared/__tests__/ticketCheckout.test.ts supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts
running 2 tests from ./supabase/functions/_shared/__tests__/ticketCheckout.test.ts
qrTokenPepper rejects missing, fallback, and short values ... ok
qrTokenPepper returns a trimmed non-default secret without logging it ... ok
running 4 tests from ./supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts
router exposes 19 subscribed events and excludes fake requirements event ... ok
payment_intent.succeeded finalizes checkout with bounded QR pepper RPC argument ... ok
account.updated updates connect row and clears KYC stall marker when enabled ... ok
payout.failed upserts payout and dispatches remediation notification ... ok
ok | 6 passed | 0 failed
```

```
$ deno check supabase/functions/ticket-checkout-create/index.ts \
            supabase/functions/ticket-checkout-status/index.ts \
            supabase/functions/ticket-confirmation-dispatch/index.ts \
            supabase/functions/scan-ticket/index.ts \
            supabase/functions/stripe-webhook/index.ts
Check ticket-checkout-create/index.ts
Check scan-ticket/index.ts
Check stripe-webhook/index.ts
Check ticket-checkout-status/index.ts
Check ticket-confirmation-dispatch/index.ts
EXIT=0
```

```
$ git diff --check
EXIT=0
```

### SQL Contract (migration 20260515000016)

Verified against [supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql](../../supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql):

1. **Legacy signatures dropped** (lines 6–9):
   - `DROP FUNCTION IF EXISTS public.biz_ticket_checkout_finalize(uuid, text, text, text);`
   - `DROP FUNCTION IF EXISTS public.biz_ticket_scan(uuid, text, uuid);`
   - `DROP FUNCTION IF EXISTS public.biz_ticket_checkout_qr_payload(uuid, text);`
   - `DROP FUNCTION IF EXISTS public.biz_ticket_checkout_token_hash(text);`
   Confirmed each old signature exists in 20260515000013 (lines 249, 261, 481, 657) so the DROPs cleanly target the prior contract.

2. **Pepper guard helper** (lines 11–27): `biz_ticket_checkout_assert_qr_pepper(text)` rejects NULL, empty, `length(btrim(...)) < 32`, and `'local-ticket-pepper'` with `RAISE EXCEPTION 'qr_token_pepper_missing'`. Marked `STABLE` (input-only), `SET search_path = public`. Returns trimmed value.

3. **Pepper-argument RPCs** (lines 29–332):
   - `biz_ticket_checkout_token_hash(p_token text, p_qr_token_pepper text)` — STABLE SQL; SHA-256 over `token || ':' || assert(pepper)`.
   - `biz_ticket_checkout_qr_payload(p_ticket_id uuid, p_token_hash text, p_qr_token_pepper text)` — STABLE SQL; deterministic signature.
   - `biz_ticket_checkout_finalize(uuid, text, text, text, text)` — SECURITY DEFINER plpgsql; asserts pepper first (line 83) before any QR derivation; idempotent for prior `order_id IS NOT NULL` sessions; preserves the order/line-item/ticket/notification rows pattern.
   - `biz_ticket_scan(uuid, text, uuid, text)` — SECURITY DEFINER plpgsql; asserts pepper first (line 260); preserves `scanner_not_authorized`/`not_found`/`wrong_event`/`void`/`duplicate`/`success` verdict matrix; writes `scan_events` regardless of result.

4. **GRANTs / REVOKEs** (lines 334–344): All five new functions REVOKE ALL ... FROM PUBLIC then GRANT EXECUTE ... TO service_role. anon/authenticated cannot call any pepper-side function.

5. **Database-level config absent**:
   ```
   $ grep -nE "current_setting|ALTER DATABASE|pg_reload_conf" supabase/migrations/20260515000016*.sql
   (no output)
   ```

### Edge Function Secret Handling

`qrTokenPepper()` (`supabase/functions/_shared/ticketCheckout.ts:29-38`):
- Source: `Deno.env.get("app.qr_token_pepper")?.trim() ?? ""`
- Reject: `pepper.length < 32 || pepper === "local-ticket-pepper"` → `throw new Error("qr_token_pepper_missing")`
- Return: trimmed value, no log.

Runtime callers:
- [ticket-checkout-create/index.ts:109-124](../../supabase/functions/ticket-checkout-create/index.ts#L109-L124) — gated on `totalCents === 0`, calls `qrTokenPepper()`, returns 500 `qr_token_pepper_missing` on throw, then passes `p_qr_token_pepper: qrPepper` into the 5-arg `biz_ticket_checkout_finalize`.
- [_shared/stripeWebhookRouter.ts:472-481](../../supabase/functions/_shared/stripeWebhookRouter.ts#L472-L481) — `payment_intent.succeeded` finalization passes `p_qr_token_pepper: qrTokenPepper()` inline.
- [scan-ticket/index.ts:26-38](../../supabase/functions/scan-ticket/index.ts#L26-L38) — calls `qrTokenPepper()` after authenticating the scanner via `getUser`, returns 500 `qr_token_pepper_missing` on throw, passes `p_qr_token_pepper: qrPepper` into the 4-arg `biz_ticket_scan`.

Paths that do NOT need the pepper (verified by source read):
- `ticket-checkout-status/index.ts` reads already-issued `qr_code` through the service-role client + buyer-status-token gate; no QR regeneration.
- `ticket-confirmation-dispatch/index.ts` does no QR work — Resend + Twilio fan-out only.

Pepper value never appears in:
- Any `console.{log,info,warn,error,debug}` call in the four Edge Function files audited.
- Any test fixture — `ticketCheckout.test.ts` and `stripeWebhookRouter.test.ts` use the synthetic 32-char string `12345678901234567890123456789012`.
- Any artifact under `Mingla_Artifacts/` — only the secret NAME and shell-variable expansions (`${PEPPER}`) appear.

### B2 RLS Preservation

Migration 20260515000015 (B2):
- `REVOKE SELECT ON TABLE public.tickets FROM anon, authenticated;`
- `GRANT SELECT (<18 non-credential columns>) ON TABLE public.tickets TO anon, authenticated;` — explicitly excludes `qr_code` and `qr_token_hash`.
- `REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text) FROM PUBLIC, anon, authenticated; GRANT ... TO service_role;`
- Same revoke/grant pattern for the 1-arg `biz_ticket_checkout_token_hash(text)`.

Migration 20260515000016 (this rework):
- DROPs the 2-arg `biz_ticket_checkout_qr_payload(uuid, text)` and 1-arg `biz_ticket_checkout_token_hash(text)`. The B2 EXECUTE grants are implicitly invalidated by the DROP (no privilege carries to a different-signature replacement).
- CREATEs the 3-arg and 2-arg pepper-argument replacements with `REVOKE ALL FROM PUBLIC` and explicit `GRANT EXECUTE ... TO service_role` only. anon/authenticated cannot call them. The B2 invariant ("app roles cannot regenerate scanner-valid QR payloads") is preserved by construction — and now strengthened because the no-pepper signatures literally no longer exist in the schema.
- Does not touch the column grants on `public.tickets`. The B2 SELECT contract on `tickets` is untouched.

Confirmed by Jest "removes brand-team-readable ticket scan credentials from direct SELECT grants" (lines 69–79 of `ticketCheckoutMigrationGuards.test.ts`) — still PASSes after the rework.

### Deployment Requirements

The implementation report calls out (and this QA confirms) that the new contract is not yet live:
- Migration `20260515000016` exists locally but is not in remote `supabase migration list --linked` per implementor's read-only check.
- Deployed Edge Functions still pass 4-arg `biz_ticket_checkout_finalize` and 3-arg `biz_ticket_scan` — they will fail with `function does not exist` once the migration applies, until the redeploy completes. Symmetrically, redeploying Edge Functions before the migration applies will fail with the same error against the still-old remote schema.

Required deploy choreography post-PASS:
1. Operator: `supabase db push --linked` to apply 20260515000016.
2. Orchestrator (per memory `feedback_orchestrator_deploys_edge_functions.md`): `supabase functions deploy ticket-checkout-create`, `supabase functions deploy scan-ticket`, `supabase functions deploy stripe-webhook`. The shared `_shared/ticketCheckout.ts` change requires every dependent function to redeploy. The shared `_shared/stripeWebhookRouter.ts` change requires the `stripe-webhook` function to redeploy.
3. Verify version bumps via `mcp__supabase__list_edge_functions` (read-only).
4. Then re-run `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` in full.

## Findings

### P3 — Deploy Choreography (advisory, post-PASS)

**P3-1. Migration must apply BEFORE Edge Function redeploy completes, with a brief intentional downtime window.**
- Both orderings (DB-first or Edge-first) cause `function does not exist` mismatches during the gap.
- Recommended: DB migration first (atomic), then immediate parallel `supabase functions deploy` for the three changed functions. The window between migration apply and function deploy is the only at-risk interval; outside that window the system is consistent.
- Why it matters: free checkout, paid webhook finalize, and scanner all hit a pepper-side RPC. Any request during the window fails closed (no ticket issuance / no scan). Failure is observable but not silent.

**P3-2. Scheduling note: live-fire matrix re-run must happen AFTER both DB and Edge Function deploys land and after the orchestrator confirms version bumps.**
- Per memory `feedback_orchestrator_deploys_edge_functions.md`, orchestrator owns the `supabase functions deploy` step. Tester cannot perform live-fire pre-deploy.

### P4 — Informational

**P4-1. Pepper rotation invalidates already-issued tickets.**
- Because the QR payload signature is `digest(ticket_id || ':' || token_hash || ':' || pepper)` and the same pepper is required at scan time, any pepper rotation makes prior `tickets.qr_code` values fail to match. Already-known property of pepper-based signing; not introduced by this rework. Document this operationally before any future pepper rotation.

**P4-2. `biz_ticket_checkout_assert_qr_pepper` declared `STABLE`.**
- Acceptable because it is a pure function of its argument. No external state, no side effects. The `RAISE EXCEPTION` is consistent with STABLE (Postgres allows exceptions in STABLE functions).

**P4-3. Migration `20260515000013` retains its `current_setting('app.qr_token_pepper', true)` references inside the OLD function bodies.**
- These are dead code paths after 20260515000016 DROPs and replaces those functions. The strict-grep gate (line 146–150) correctly scopes its `current_setting` check to the NEW migration only; the old migration is historical and immutable. No action required.

### No P0 / P1 / P2 findings.

Constitutional principles inspected (subset relevant to this surface):
- One owner per truth: pepper has a single owner (Edge Function secret) and a single passing path (RPC argument). ✓
- No silent failures: `qr_token_pepper_missing` surfaces as 500 in Edge Functions and `RAISE EXCEPTION` in SQL. ✓
- Server state server-side: pepper lives in Supabase secrets, not mobile/admin client. ✓
- Validate at the right time: pepper is asserted both at the Edge Function boundary AND inside every SQL RPC before any digest computation. ✓
- Security overrides: bounded service-role RPC + DROP of legacy signatures + REVOKE ALL FROM PUBLIC produces a strictly more secure surface than before. ✓

## Platform Parity Note

This rework changes only backend SQL and Deno Edge Functions. There is no mobile / admin / web UI surface exercised by this dispatch — the buyer QR display path (`ticket-checkout-status` → `tickets.qr_code` already-issued) is untouched, the scanner UI is untouched (it continues to POST `{eventId, qrPayload}` to `scan-ticket`), and the admin dashboard does not call any pepper-side RPC. iOS/Android/Web parity is therefore N/A for this dispatch and will be exercised by the live-fire matrix re-run after deploy.

## Non-Blocking Observations Forwarded to Orchestrator

- The strict-grep gate now hard-asserts the bounded-RPC contract. Future ORCH-0777 work touching ticket checkout cannot accidentally regress to a no-pepper or DB-level GUC path without failing CI on `mingla-business/test:orch-0777`.
- The Jest migration guard hard-asserts the historical reports remain marked "Superseded note (2026-05-10)". Any cleanup that removes those markers will fail CI — intentional.

## Recommendation

**Route to operator for `supabase db push --linked` of `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql`, then to Codex `orchestrator-mingla` for redeploy of `ticket-checkout-create`, `scan-ticket`, and `stripe-webhook` (these are the three functions that either import the changed `_shared/ticketCheckout.ts` or include the changed `_shared/stripeWebhookRouter.ts`). Verify version bumps via `mcp__supabase__list_edge_functions`. Then re-run `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` in full. Live-fire PASS routes to Codex `orchestrator-mingla` for CLOSE. Any live-fire FAIL routes back to Codex `implementor-mingla` for narrow rework cited by failing matrix slice.**
