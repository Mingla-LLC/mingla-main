# Supabase Secret Capacity

This runbook keeps Mingla below Supabase's 100 user-secret limit without exposing secret
material. The committed manifest and every audit output are names-only. Never paste a value,
digest, credential prefix, environment dump, or raw `supabase secrets list --output json`
response into GitHub, chat, logs, artifacts, or this file.

## Capacity policy

- Normal ceiling: 85 user-managed names, leaving 15 slots.
- Slots 86–90 require a linked issue, named owner, data class, reader list, secure source,
  review/expiry date, reason an existing store is unsuitable, and explicit approval.
- A temporary migration name expires within 72 hours unless its issue records a shorter
  approved window.
- 91 or more user-managed names is an unconditional blocking breach.
- The seven platform-managed `SUPABASE_*` defaults do not count against the user budget and
  never belong in `supabase/secrets.manifest.json`.
- Review names monthly. Escalate an expired, unexpected, missing, duplicate, or consumerless
  name immediately regardless of the count.

The pull-request audit validates the 85-name target manifest offline. The scheduled/manual
workflow uses the dedicated least-privilege `SUPABASE_SECRET_AUDIT_ACCESS_TOKEN` only at live
runtime and emits sorted names/reasons/counts, never raw CLI output. Until that separately
authorized credential exists, the live step records an explicit warning and does not invoke the
CLI.

`supabase/secrets.manifest.json` deliberately starts in `transition` / `pre_rollout` mode. In
that state the live audit requires exact parity with the known 100-name pre-rollout set: the five
pending bundle names must be absent and the 20 approved legacy/stale names must be present. It
does not treat the count alone as a final-policy breach, but any missing, extra, or count-drifted
name still fails. After the approved stages reach 85, change `live_audit_mode` to `enforced` in a
reviewed PR; enforced mode accepts only the final manifest set and applies the 85/90 ceilings.

## Ownership and secure re-entry

Every manifest record names a primary owner, backup owner, reader set, source type, review
interval, issue, status, and field-level owners for bundles. The manifest is an index, not a
vault. Values are reconstructed only by an authorized person from the named provider dashboard,
controlled operating record, or secure vault.

Supabase does not provide a plaintext value readback suitable for repacking. Never scrape
metadata, compare or publish digests, deploy an exfiltration function, or infer two settings are
semantically identical because their stored metadata matches. If the authoritative source is
missing, stop. Rotate/recreate through the provider under a separately approved plan.

Stripe restricted keys remain separate by role and environment. Follow Stripe's
[API key security guidance](https://docs.stripe.com/keys-best-practices) and
[restricted-key guidance](https://docs.stripe.com/keys) so each service retains the minimum
permissions and an independent rotation boundary.

## Five bounded bundles

Only these version-1 objects are permitted:

- `MINGLA_PAYMENT_MODES_JSON`: independent `stripe_mode` and `paystack_mode`.
- `MINGLA_EMAIL_SENDERS_JSON`: independent `admin_from`, `system_from`, and `ticket_from`.
- `MINGLA_DELIVERY_FLAGS_JSON`: independent marketing, Nigeria SMS, and US SMS booleans.
- `MINGLA_ALERT_RECIPIENTS_JSON`: independent API-health, Stripe-dispute, and
  Stripe-webhook-failure lists.
- `MINGLA_RUNTIME_CONFIG_JSON`: exactly the eight non-credential fields enforced by
  `_shared/runtimeConfig.ts`.

Do not put provider credentials, RAKs, account IDs, webhook/signing material, origins,
sender IDs, app IDs, or payment keys into a bundle. Every reader prefers its own bundle field
and falls back only to its exact legacy name during the compatibility window. Invalid bundles
produce redacted field/reason telemetry and never invent a value.

## No-downtime sequence

Every mutation and live-fire step requires contemporaneous approval. Code merge alone does not
authorize any secret or provider change.

1. Reconstruct all five objects privately from authoritative sources. Run the strict validators.
   Record only bundle name, schema version, byte length, field-name set, and PASS/FAIL.
2. After the Stripe ownership/use/recoverability gate and separate approval, retire only the
   consumerless KYC reminder Supabase name. Keep its provider key valid for the separately
   approved 14-day recovery window.
3. After approval, set the runtime bundle while all eight legacy names remain. Merge and deploy
   compatibility readers from the reviewed `origin/main` commit, verify deployment identity,
   live-fire applicable owners, and require a clean 72-hour soak.
4. After separate approval, unset exactly the eight runtime-config legacy names recorded in
   issue #1203. The count moves to 92.
5. After approval, set the four semantic bundles while all 11 semantic legacy names remain.
   Redeploy exact affected functions, live-fire every independent rail/role/region/domain, and
   require another clean 72-hour soak.
6. After separate approval, unset exactly the 11 semantic legacy names recorded in issue #1203.
   Confirm 85 user-managed names plus seven platform defaults, repeat live-fire, and monitor for
   seven days.
7. Keep compatibility for at least two successful full deploys and 30 days. Removing fallbacks
   requires separate review. Stripe provider-key expiration is a separate irreversible approval
   no earlier than day 14.

A partial or concurrent deployment, deployment-commit mismatch, parser/missing-field event,
unknown ownership, missing source, or failed live-fire blocks every unset.

## Rollback order

Before a legacy unset, rollback removes only the new bundle; untouched legacy names resume
without a code rollback.

After a legacy unset, restore every affected legacy name from its authoritative secure source
first, verify the old path, and only then remove the failing bundle. Never remove a bundle while
its legacy names are absent, restore one field from another field's current value, or assume
equality.

## Audit commands

Offline target validation is safe and requires no credential:

```bash
node scripts/secrets/audit-supabase-secret-budget.mjs --manifest-only
node --test scripts/secrets/issue_1203_*.test.mjs
node .github/scripts/strict-grep/issue-1203-secret-capacity.mjs --self-test
node .github/scripts/strict-grep/issue-1203-secret-capacity.mjs
```

Run the live audit through the scheduled/manual GitHub workflow. Do not run or paste raw
secret-list output in an incident channel. Audit failures expose only names and reasons.

## Recovery verification

For any recovery, confirm:

1. the manifest owner and backup acknowledge the source and intended environment;
2. the object validates without echoing and is below 48 KiB;
3. the replacement is set before any old name is removed;
4. every affected function reports the reviewed merged deployment identity;
5. role/rail/region/domain live-fire passes without money movement or live delivery unless
   separately approved;
6. redacted telemetry contains no bundle-invalid or fallback event after soak; and
7. the live names-only audit reports the expected count and exact manifest parity.

## Primary references

- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [Supabase Edge Function secrets and platform defaults](https://supabase.com/docs/guides/functions/secrets)
- [Supabase CLI secret management](https://supabase.com/docs/reference/cli/supabase-secrets)
- [Supabase Edge Function deployment](https://supabase.com/docs/guides/functions/deploy)
- [Stripe API key security and least privilege](https://docs.stripe.com/keys-best-practices)
- [Stripe API and restricted-key management](https://docs.stripe.com/keys)
