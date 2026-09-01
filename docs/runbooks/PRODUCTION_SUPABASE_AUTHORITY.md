# Production Supabase authority

The sole Mingla production Supabase project is declared by
[`docs/contracts/production-supabase-authority.json`](../contracts/production-supabase-authority.json).
Scripts and operators must read or verify that contract before any production network action.
The project reference is safe to log; credentials, signed URLs, JWTs, user data, and raw environment
values are not.

## Why the dashboard used to say “dev”

The dashboard display name was historical label drift. Runtime bundles, deployed mobile
configuration, authentication, Mingla data, storage, Edge Functions, schedules, and provider
callbacks all use the contract's project. A dashboard label is not deployment authority; the
checked-in contract and exact project reference are.

The contract also records `gupxgpmukdwhozqfmzgd` as
`unrelated_project_do_not_target`. It belongs to Mode a Mela/SomethingElse. Never link Mingla,
deploy Mingla functions, run Mingla migrations, rotate Mingla auth, copy Mingla data, or change any
setting against that project.

## Offline verification

Run this before a production operation or when reviewing an opaque target in-place:

```bash
node scripts/ops/verify-production-supabase-authority.mjs \
  --mode=offline \
  --target-ref "$SUPABASE_PROJECT_REF"
```

Add `--rest-url "$SUPABASE_URL"` or
`--functions-url "$SUPABASE_FUNCTIONS_URL"` when those non-secret values are available. The verifier
prints only variable names and parsed refs. Missing, padded, malformed, concatenated, forbidden, or
noncanonical inputs exit nonzero with `no action executed`.

To verify every checked-in production source/config contract:

```bash
node scripts/ops/verify-production-supabase-authority.mjs \
  --mode=offline \
  --target-ref gqnoajqerqhnvulmnyvv \
  --check-sources
```

`metadata` mode has the same fail-closed input contract. It authorizes read-only metadata checks;
it does not fetch secrets and does not perform a write.

## Edge Function deploy

Use the repository wrapper. It verifies `SUPABASE_PROJECT_ID` before the first Supabase CLI call and
preserves the existing already-deployed `409` handling:

> **#2948 — there is no deploy-all.** Since #2886 the wrapper refuses a bare
> invocation (`FAIL deploy: explicit --function selection required; deploy-all is
> forbidden`) and requires `--merged-commit`. Name the functions you mean, from
> MERGED `main`. In CI the selection is computed for you by
> `scripts/ci/select-changed-edge-functions.mjs`; by hand, pass them.

```bash
SUPABASE_PROJECT_ID="$SUPABASE_PROJECT_REF" scripts/deploy-supabase-functions.sh \
  --merged-commit "$(git rev-parse HEAD)" \
  --function brand-stripe-onboard \
  --function brand-stripe-refresh-status
```

Never call `supabase functions deploy` directly for Mingla production.

## Migration or Management API lane

Migration history must be inspected first; do not default to `supabase db push` or migration repair.
Before any approved surgical Management API request, validate the exact target in a separate,
successful command:

```bash
node scripts/ops/verify-production-supabase-authority.mjs \
  --mode=offline \
  --target-ref "$SUPABASE_PROJECT_REF"
```

Only after that passes may the operator run the issue-approved request against a URL assembled from
the same `SUPABASE_PROJECT_REF`. Record the issue, script commit, migration version, before/after
read-only evidence, and redacted result. Never print the bearer token, database URL, query secrets,
or response rows containing personal data.

## Apple rotation and secret audit

`scripts/rotate-apple-jwt.mjs` validates `SUPABASE_PROJECT_REF` before JWT generation, GET, or PATCH.
The live secret-budget audit performs the same check before invoking `supabase secrets list`; its
output remains names-only. Do not bypass either script with a direct API or CLI command.

## External production reconciliation

Inspect Vercel, EAS, GitHub, and Supabase metadata read-only first. Record only the surface, variable
name, parsed ref, presence, and a one-way fingerprint where required. Never print a raw value. If a
surface is already canonical, leave it untouched. If it differs, stop for Gate B approval naming
that one variable, its impact, previous fingerprint, redeploy plan, verification, and rollback.

Preview and development targets may remain separately configurable, but evidence must label their
environment and may not present them as production.

## Incident response and rollback

An authority mismatch is a stop condition: do not deploy, rotate, migrate, rewrite environment
variables, or try the unrelated project. Confirm the contract has not changed unexpectedly, identify
the named input, and reconcile it read-only.

Repository rollback is an ordinary revert of the issue #2016 guard/docs commit through a reviewed
PR. Reverting enforcement does not change either Supabase project. An externally corrected variable
is rolled back only with its recorded previous fingerprint/value in the owning provider, followed by
a redeploy of that single surface and an exact-ref verification. Project deletion, migration, DNS,
key rotation, webhook changes, and cross-product moves require a new approved issue.

For database recovery, follow [DR_RESTORE.md](./DR_RESTORE.md). A drill always restores to a new
isolated clone; it never repoints production.
