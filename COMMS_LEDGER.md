# Mingla Comms Ledger

**Canonical path:** `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` (anchor `main`).
**Reachable from every worktree** via absolute path.
**Read on every skill entry.** Write on cross-ORCH discovery.

Reference contract: `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-COMMS-LEDGER-ENTRY-STANZA, I-COMMS-LEDGER-WRITE-ON-DISCOVERY.

---

## How to read this file

Every Claude or Codex skill, on entry, scans the Active-entries table below.
For each row where `to` matches your skill name, OR your current ORCH-ID,
OR is literally `ALL`:

- `severity: BLOCK` + `status: OPEN` → STOP. Do the body. Append your
  `skill+side` to `acked_by`. Set status to `ACKNOWLEDGED` (or `RESOLVED`
  if the action fully closes it). Mention the ack in your chat response
  Section A ("Also handled COMMS-NNNN: <subject>").
- `severity: WARN` + `status: OPEN` → read, factor into your turn,
  append `skill+side` to `acked_by`.
- `severity: FYI` → read and continue.

## How to write

When you discover something that affects another in-flight ORCH:
1. Allocate next `COMMS-NNNN` (max existing ID + 1, zero-pad to 4).
2. Append a row to the Active table.
3. Direct-to-`main` one-file commit:
   ```bash
   cd /Users/sethogieva/Desktop/mingla-main
   git checkout main && git pull
   # edit COMMS_LEDGER.md to append the row
   git add COMMS_LEDGER.md
   git commit -m "COMMS-NNNN: <one-line subject>"
   git push origin main
   ```
4. Mention the new entry in your chat response Section A.

Bodies are inline (column may use `<br>` for line breaks). No separate detail files.

## Stale cleanup

Orchestrator sweeps the table at the top of every SNAPSHOT / TRIAGE / BOOTSTRAP run:
- `OPEN` rows with `expires < today` → set status to `STALE`.
- `RESOLVED` and `STALE` rows → move below the `## Archive` divider.
- Default `expires`: 14 days for `WARN` and `FYI`; `none` for `BLOCK` (BLOCK never auto-stales).

---

## Active entries

| id | created | from | to | re_orch | sev | subject | body | status | acked_by | resolved_at | expires |
|---|---|---|---|---|---|---|---|---|---|---|---|
| COMMS-0001 | 2026-05-24 | mingla-orchestrator+claude (ORCH-0954) | ORCH-0955 | ORCH-0955 | WARN | Tax dashboard link breaks under dashboard:none — ORCH-0955 owns rewrite | ORCH-0954 forensics F-6 found that `supabase/functions/brand-stripe-tax-dashboard-link/index.ts` calls `accounts.createLoginLink` which requires `dashboard='express'`. ORCH-0954 will flip the platform controller to `dashboard:none` (Stripe-managed risk + embedded onboarding) and the login-link call will start returning a Stripe API error.<br><br>Operator (Seth) decided 2026-05-24 that ORCH-0955 [Native Stripe Tax] absorbs the rewrite — replace the login-link redirect with Stripe's embedded Tax components (likely `<ConnectTaxRegistrations>` + `<ConnectTaxSettings>`). Brands will have no tax-settings UI between the two ORCH closes; acceptable because zero live brands exist at INTAKE.<br><br>Inputs for ORCH-0955 SPEC: ORCH-0954 investigation at `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-0954_EMBEDDED_ONBOARDING.md` (finding F-6 + F-11 cover the Tax embedded components contract). Coordinate sequencing so ORCH-0955 ships before or alongside ORCH-0954's live cutover. | OPEN | mingla-forensics+claude (ORCH-0955), mingla-orchestrator+claude (ORCH-0955) |  | none |
| COMMS-0002 | 2026-05-25 | mingla-tester+codex (ORCH-0956) | ALL | ALL | WARN | ORCH-0863 strict-grep gate blocks backend PRs touching supabase/functions | ORCH-0956 QA found PR #202 is locally Stripe-green but GitHub required check `ORCH-0863: Marketing Hub Phase B invariants` fails C7 `no-new-backend-files` because the PR adds `supabase/functions/_shared/stripeOpsAlertEmail.ts`. The gate appears globally applied to PR diffs, so unrelated backend ORCHs that legitimately touch `supabase/functions/` or migrations (including Stripe/tax work such as ORCH-0955) may be blocked unless the gate is scoped to ORCH-0863 files, allowlisted for backend ORCHs, or explicitly waived by orchestrator. Evidence: GitHub Actions run `26381105657`, failing job `ORCH-0863...`, log line `FAIL [C7: no-new-backend-files] ... offenders: supabase/functions/_shared/stripeOpsAlertEmail.ts`. | OPEN | mingla-forensics+claude (ORCH-0955), mingla-tester+codex (META-ORCH-0952), mingla-orchestrator+claude (ORCH-0956) |  | 2026-06-08 |

---

## Archive (resolved / stale — do not act on; kept for audit)

| id | created | resolved_at | from | to | re_orch | sev | subject | body | final_status |
|---|---|---|---|---|---|---|---|---|---|
