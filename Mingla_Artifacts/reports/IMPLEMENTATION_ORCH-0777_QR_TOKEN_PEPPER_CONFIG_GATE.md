# IMPLEMENTATION ORCH-0777 - QR Token Pepper Config Gate

Date: 2026-05-10  
Owner: Codex `implementor-mingla`  
Working tree: main (`/Users/sethogieva/Desktop/mingla-main`)  
Status: **blocked before implementation**

Superseded note (2026-05-10): this historical report documents the failed
database-level GUC route only. The required QR pepper runtime contract is now
the bounded service-role RPC argument path implemented in
`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`;
do not follow the database-level Postgres configuration route below.

## Plain-English Status

The final ORCH-0777 pre-live-fire blocker is still blocked. I generated a fresh strong pepper locally without printing it and attempted to persist it through the linked Supabase SQL path. Supabase rejected the mutation with `42501 permission denied to set parameter "app.qr_token_pepper"`, so the database configuration still requires an owner/admin/support route.

No secret values were printed, requested, written to artifacts, or committed.

## Inputs

- `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md`
- `Mingla_Artifacts/prompts/OPERATOR_ORCH-0777_APPLY_B2_CONFIG_AND_LIVE_FIRE_RERUN.md`
- User dispatch: execute the remaining `app.qr_token_pepper` blocker using available Supabase access.

## Attempted Mutation

Command shape, with generated value kept in shell memory and unset after the command:

```bash
PEPPER="$(openssl rand -hex 32)"
/Users/sethogieva/bin/supabase db query --linked -o table \
  "alter database postgres set app.qr_token_pepper = '${PEPPER}';"
unset PEPPER
```

Observed result:

```text
pepper_set_command=failed
ERROR: 42501: permission denied to set parameter "app.qr_token_pepper"
```

## Post-Attempt Verification

Read-only verification query:

```sql
select
  case
    when nullif(current_setting('app.qr_token_pepper', true), '') is null then 'missing'
    when current_setting('app.qr_token_pepper', true) = 'local-ticket-pepper' then 'default_fallback'
    when length(current_setting('app.qr_token_pepper', true)) < 32 then 'too_short'
    else 'set_non_default_min32'
  end as qr_token_pepper_status,
  coalesce(length(nullif(current_setting('app.qr_token_pepper', true), '')), 0) as value_length;
```

Observed result:

```text
qr_token_pepper_status=missing
value_length=0
```

## Operator Secret Follow-Up Verification

After the operator reported setting the value in Supabase secrets, I verified name presence only. Supabase Edge Function secrets now include a secret named `app.qr_token_pepper`. I did not print, request, copy, or record the secret value.

The DB gate still fails because the production SQL path reads the Postgres setting, not Edge Function secrets:

```text
qr_token_pepper_status=missing
value_length=0
```

## MCP Surface Check

I checked exposed MCP resources/templates in this Codex session. No Supabase MCP execute tool is available in the active tool surface; only GitHub resource templates are exposed. The Supabase CLI linked query path is available but does not have permission to set this database parameter.

## Verdict

`app.qr_token_pepper` remains **BLOCKED** for the historical database-GUC
contract. Do not proceed to live-fire from this report. This route is
superseded by the bounded service-role RPC argument contract in
`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_QR_PEPPER_SESSION_GUC.md`.

## Downstream Routing

After the operator clears this configuration gate, rerun `Mingla_Artifacts/reports/LIVE_FIRE_ORCH-0777_TICKET_CHECKOUT_MATRIX.md` and replace every `NOT RUN` row with concrete runtime evidence. If live-fire passes, route to Codex `orchestrator-mingla` for CLOSE. If any live-fire scenario fails, route the narrow failing slice back to Codex `implementor-mingla`.
