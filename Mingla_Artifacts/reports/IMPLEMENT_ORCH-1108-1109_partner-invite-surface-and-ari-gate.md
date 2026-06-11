# IMPLEMENT — ORCH-1108 / ORCH-1109 [partner-invite-surface-and-ari-gate]

> NOTE: This report file did not exist in the worktree at loop-back time; it is
> created here to carry the loop-back fix section. The primary IMPLEMENT/TEST
> history for ORCH-1108/1109 lives in the branch commits
> `d252669d4` (implement) and `00c0167ab` (tester adversarial nav-gate).

---

## Loop-back fix — OAuth null-email

### Defect (DB-proven by the orchestrator)
The in-app invite flow silently failed for Google-OAuth users whose
`auth.users.email` is NULL. Proven on a real account: auth user
`332e1733-af2b-49ca-8014-87d56f1b735e` (sethogievabelgium@gmail.com) has
`auth.users.email = NULL`, but `auth.identities.identity_data->>'email' =
'sethogievabelgium@gmail.com'` with `email_verified='true'`. The code resolved
the caller email from `userResult.user.email` (edge fns) and
`SELECT u.email FROM auth.users` (RPC) — both NULL → the email match failed →
the invite never surfaced (no To-Do row, no bell) and accept/decline 403'd.

### Fix — trusted email resolution with verified-OAuth fallback
Resolve the caller email from a TRUSTED chain:
1. `auth.users.email` if present; else
2. a VERIFIED OAuth identity email from `auth.identities`
   (`identity_data->>'email'` where `email_verified` ∈ {`true`,`t`}),
   most-recent sign-in first.

`raw_user_meta_data` / `user_metadata.email` is **NEVER** consulted — it is
user-writable and would let an attacker claim another person's invite.
`identity_data` from an OAuth provider with `email_verified=true` IS trusted
(provider-asserted, GoTrue-written). All emails are `lower(trim(...))`-normalized.

### Shared helper (justification)
Factored the edge-fn resolution into a single shared module
`supabase/functions/_shared/trustedCallerEmail.ts` imported by all three fns
(vs three inline copies). It fits the existing `_shared` pattern (cf.
`stripeEdgeAuth.ts`, `businessNotifyTriggers.ts`). Exports:
- `pickVerifiedIdentityEmail(identities)` — pure; first verified email or `""`.
- `resolveTrustedCallerEmail(user, fetchIdentities?)` — chain orchestrator.
- `makeAuthIdentitiesFetcher(service)` — binds the DB fallback to a service
  client using the repo-standard **GoTrue admin API**
  (`auth.admin.getUserById`, as in send-otp / verify-otp / venue-claim) rather
  than a PostgREST `auth.identities` read (the `auth` schema is not exposed to
  PostgREST). `getUserById` returns the user's fully-populated `identities[]`.

### 4 change sites + commit hashes
| # | Site | File | Commit |
|---|------|------|--------|
| 0 | NEW shared helper | `supabase/functions/_shared/trustedCallerEmail.ts` | `919ef7c1f` |
| 1 | list invites — caller email | `supabase/functions/list-my-pending-invites/index.ts` | `919ef7c1f` |
| 2 | accept — `callerEmail` (line ~234) + partner-link `memberEmail` | `supabase/functions/accept-brand-invitation/index.ts` | `919ef7c1f` |
| 3 | decline — caller email | `supabase/functions/decline-brand-invitation/index.ts` | `919ef7c1f` |
| 4 | RPC `accept_invite_and_transfer_brand_ownership` | `supabase/migrations/20260925000000_orch_1108_oauth_null_email_accept.sql` | `919ef7c1f` |

`list-my-pending-invites/index.test.ts` test #3 updated (seam relocated into the
resolver — security intent preserved: JWT-derived, no injectable email param).

### New migration (orchestrator to apply)
**`supabase/migrations/20260925000000_orch_1108_oauth_null_email_accept.sql`**

It `CREATE OR REPLACE`s the function VERBATIM from
`20260924000000_orch_1108_brand_invite_declined.sql` (P0007 declined guard,
`app.allow_brand_owner_transfer` bypass, `accepted_by_account_id`, audit_log
shape, `partner_brand_links` stamp, `partner_setup` return — all unchanged) and
changes ONLY the `v_acceptor_email` resolution to add the NULL fallback:

```sql
SELECT u.email INTO v_acceptor_email FROM auth.users u WHERE u.id = v_acceptor_user_id;

IF v_acceptor_email IS NULL THEN
  SELECT (i.identity_data->>'email') INTO v_acceptor_email
  FROM auth.identities i
  WHERE i.user_id = v_acceptor_user_id
    AND (i.identity_data->>'email') IS NOT NULL
    AND lower(coalesce(i.identity_data->>'email_verified','')) IN ('true','t')
  ORDER BY i.last_sign_in_at DESC NULLS LAST
  LIMIT 1;
END IF;
```

Conventions kept: forward-only, idempotent (`CREATE OR REPLACE`), `$function$;`
before the GRANT/REVOKE, OWNER postgres + GRANT EXECUTE to service_role,
read-only verification probe asserting the body carries the `auth.identities` +
`email_verified` fallback. Prefix `20260925000000` verified collision-free
(next monotonic after `20260924000000`).

### Test results
- New regression test: `supabase/functions/list-my-pending-invites/oauthNullEmail.test.ts`
  (append-only; drives the live resolver `resolveTrustedCallerEmail` +
  `makeAuthIdentitiesFetcher` with `getUserById` stubbed to the bug account's
  payload). Cases: (a) null users.email + verified identity → resolves
  lowercased; (b) null email + NO verified identity → `""` (no invite, no leak);
  (c) users.email present → wins, no DB hop; (d) inline getUser identities used
  before DB; (e) **user_metadata is NEVER consulted** (spoofed metadata → `""`);
  (f) flattened-projection tolerance.
- Deno suite (3 fns + helper): **30 passed / 0 failed**.
- Business jest (`businessTodos.invite.test.ts` + `navTabGate.test.ts`):
  **19 passed / 0 failed**.
- `deno check` on helper + 3 edge fns: clean.
- Strict-grep gates: **orch-1050 PASS**, **orch-1055 PASS** (nav gating untouched).

### Fails-on-revert (proven)
Reverted the identity fallback in `trustedCallerEmail.ts`
(`resolveTrustedCallerEmail` → resolve from `user.email` only). The null-email
case and the inline-identities case **FAILED** (2 failed / 4 passed): the
resolver returned `""` instead of `sethogievabelgium@gmail.com`. Restored →
6/6 pass. (Revert applied transiently via `perl` patch + restored from
`/tmp/tce.bak`; no revert commit on the branch.)

### Trusted chain confirmation
The trusted chain is `auth.users.email` → verified `auth.identities` OAuth
email ONLY. `user_metadata` / `raw_user_meta_data` is explicitly excluded in
both the edge-fn helper (documented + asserted by the metadata-spoof test) and
the RPC (the SQL fallback reads `auth.identities` only).

### Redeploy (orchestrator)
Edge fns to redeploy from MERGED main: `list-my-pending-invites`,
`accept-brand-invitation`, `decline-brand-invitation`. Apply migration
`20260925000000_orch_1108_oauth_null_email_accept.sql` via the Supabase
Management API.
