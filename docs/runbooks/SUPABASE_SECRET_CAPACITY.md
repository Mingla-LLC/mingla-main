# Supabase Secret Capacity

This runbook keeps Mingla below Supabase's 100 user-secret limit without exposing secret
material. The committed manifest and every audit output are names-only. Never paste a value,
digest, credential prefix, environment dump, or raw `supabase secrets list --output json`
response into GitHub, chat, logs, artifacts, or this file.

## Capacity policy

- Normal ceiling: 87 user-managed names, leaving 13 slots.
- Slots 88–90 require a linked issue, named owner, data class, reader list, secure source,
  review/expiry date, reason an existing store is unsuitable, and explicit approval.
- A temporary migration name expires within 72 hours unless its issue records a shorter
  approved window.
- 91 or more user-managed names is an unconditional blocking breach.
- The seven platform-managed `SUPABASE_*` defaults do not count against the user budget and
  never belong in `supabase/secrets.manifest.json`.
- Review names monthly. Escalate an expired, unexpected, missing, duplicate, or consumerless
  name immediately regardless of the count.

The pull-request audit validates the exact 88-name target manifest offline. The scheduled/manual
workflow uses the dedicated least-privilege `SUPABASE_SECRET_AUDIT_ACCESS_TOKEN` only at live
runtime and emits sorted names/reasons/counts, never raw CLI output. If that separately
authorized credential is missing, the scheduled/manual workflow emits an error and fails; a
green skipped live audit is forbidden.

`supabase/secrets.manifest.json` is in `enforced` / `complete` mode. The live audit accepts only
the exact 88-name manifest set and applies the 87/90 ceilings. Slot 88 is the sole time-bounded,
founder-approved issue #2830 exception; its live value remains separately gated. The historical `transition` /
`pre_rollout` mode remains test-covered solely to prove the original #1203 consolidation math; it
is not an authorized production state.

## Ownership and secure re-entry

Every manifest record names a primary owner, backup owner, reader set, source type, review
interval, issue, status, and field-level owners for bundles. The manifest is an index, not a
vault. Values are reconstructed only by an authorized person from the named provider dashboard,
controlled operating record, or secure vault.

Supabase does not provide a plaintext value readback suitable for repacking. Never scrape
metadata, compare or publish digests, deploy an exfiltration function, or infer two settings are
semantically identical because their stored metadata matches. If the authoritative source is
missing, stop. Rotation requires a separately approved plan. For a recipient-fingerprint HMAC,
replacement without a previous key is permitted only under the zero-row epoch protocol below.

Stripe restricted keys remain separate by role and environment. Follow Stripe's
[API key security guidance](https://docs.stripe.com/keys-best-practices) and
[restricted-key guidance](https://docs.stripe.com/keys) so each service retains the minimum
permissions and an independent rotation boundary.

## Bounded bundles and the credential envelope

These objects are permitted:

- `MINGLA_PAYMENT_MODES_JSON`: independent `stripe_mode` and `paystack_mode`.
- `MINGLA_EMAIL_SENDERS_JSON`: independent `admin_from`, `system_from`, and `ticket_from`.
- `MINGLA_DELIVERY_FLAGS_JSON` schema v4: the original independent marketing, Nigeria SMS,
  and US SMS booleans plus an exact `payment_operations` object containing independent
  `payout_hold_onboard_flip`, `paystack_payout_hold_onboard_flip`,
  `payout_release_execute`, `source_refunds_post_disabled`, and
  `checkout_revocation_execute` JSON booleans. The Paystack onboarding field is bundle-only and
  has no direct-name fallback. Schemas v1, v2, and v3 remain readable for compatibility. During
  #2241, schema v3 plus exact `CHECKOUT_REVOCATION_EXECUTE` fallback stays authoritative until
  all 23 compatibility functions are verified; only then does the complete object move to v4.
- `MINGLA_ALERT_RECIPIENTS_JSON`: independent API-health, Stripe-dispute, and
  Stripe-webhook-failure lists.
- `MINGLA_RUNTIME_CONFIG_JSON`: eight required non-credential fields plus the optional
  `offering_invite_sms_price_book_v1` and `content_share_v1_create_enabled` fields enforced by
  `_shared/runtimeConfig.ts`. The content-share field is a strict JSON boolean; its retired
  compatibility name is `CONTENT_SHARE_V1_CREATE_ENABLED`.
- `AD_CONVERSION_TOKENS`: the existing private credential envelope. In addition to its existing
  independently named fields, it owns `NOTIFICATION_RECIPIENT_HMAC_SECRET` as exact raw material.
  The resolver never trims, normalizes, logs, rotates, or returns that value. It also owns the
  independent `BRAND_PERSON_ERASURE_CHALLENGE_SECRET` field for #1772. That field has its own
  Platform Security ownership and rotation boundary and is never derived from, substituted with,
  or exposed to any other envelope reader. #2241 also gives this open envelope four independently
  governed fields: `ATTENDANCE_CLAIM_PEPPER`, `META_COMPETITOR_ACCESS_TOKEN`,
  `META_COMPETITOR_IG_USER_ID`, and `RESEND_WEBHOOK_SECRET`. Each reads the valid envelope first,
  falls back only to its identical direct migration name, and never substitutes another field.
- `OFFERING_INVITE_TOKEN_PEPPER`: the #1770 standalone cryptographic secret used only by the
  shared offering-invite token helper, `marketing-send`, and the authenticated dispatch boundary. It stays outside every bundle
  because its independent rotation and audit boundary is part of invite authorization.
- `MINGLA_SITES_SECURITY_JSON`: the #2830 slot-88 credential envelope. Only
  `_shared/sitesSecurity.ts` may read the Core environment name, and it returns narrow directional
  projections. The exact field contract, 30-day review, 90-day expiry, 24-hour previous-key
  overlap, and sole #2830 capacity exception are fail-closed. Never set or distribute it from
  repository content; live mutation retains its separate production gate.

Do not put provider credentials, RAKs, account IDs, webhook/signing material, origins,
sender IDs, app IDs, or payment keys into an operational bundle. Credential material belongs
only in an approved credential envelope with field-level ownership. Every compatibility reader
prefers its own bundle field and may fall back only to its exact legacy name during a reviewed
migration window. Invalid bundles produce redacted field/reason telemetry and never invent a
value. Missing/invalid onboarding and payout authority resolve false; missing/invalid
source-refund authority resolves disabled=true. Content-share creation accepts only a bundled
JSON boolean or, during the #1808 migration window, the exact legacy string `true`; once the
direct name is retired, missing or invalid authority resolves false.

For the #1903 schema-v3 compatibility rollout, derive the runtime import closure before any
secret mutation. The reviewed closure is exactly: `brand-paystack-onboard`,
`brand-stripe-onboard`, `payout-release-sweep`, `marketing-send`,
`event-cancel-refund-fanout`, `rsvp-contribution-refund`, `source-refund-sweep`,
`venue-reservation-cancel`, `send-pair-request`, `send-phone-invite`, `send-venue-sms`,
`ticket-confirmation-dispatch`, `notify-dispatch`, `offering-invite-dispatch`, `rsvp-notify`,
`guest-roster-actions`, and `support-brand-person-erasure`. Deploy all 17 from one merged compatibility commit while production
is still schema v2, preserve each function's reviewed JWT posture, and require exact deployed
source parity. If the recursive guard derives any other set or count, stop for amendment. Only
after all 17 pass may the bundle be transformed value-blindly to exact schema v3 with the new
Paystack field false and all six pre-existing controls unchanged. Activation is a separate
post-#1845 operation.

### #2241 exact-88 readiness reconciliation

`supabase/function-env.contract.json` is the checked inventory for every production Edge
function. Run `audit-function-secret-contract.mjs` before any deploy; it follows recursive
relative imports, rejects an unclassified literal read, and requires each dynamic getter to
declare exact allowed public names, governed fields, and local/import-closure call boundaries.
Adding a new literal to an approved getter without declaring that name or field fails the audit.
A non-literal, conditional, concatenated, template, or variable argument also fails unless its
exact normalized expression is contract-owned. Static relative template-literal `import()` calls
and valid second arguments enter the closure; every computed dynamic import fails closed.

The only production entrypoint for the #2241 set/deploy sequence is
`scripts/secrets/reconcile-governed-secrets.mjs` (or the
`scripts/deploy-supabase-functions.sh --issue-2241-remediation` wrapper). It creates an ephemeral
Ed25519 authority and one-use random nonce in memory. Signed receipts contain public names and
PASS flags only, expire within 15 minutes, and are never accepted from a file. Altered,
wrong-project, wrong-commit, wrong-function, stale, or replayed receipts fail. The secure bundle
inputs must come from stdin or mode-0600 files; the setter writes only the already-existing named
secret through `/dev/stdin` and never puts a value in argv or output. The stdin assignment uses
the exact double-quote and escape rules of the Supabase CLI's pinned `godotenv` parser, including
literal dollar signs, comment markers, quotes, backslashes, backticks, bangs, and line breaks.

Normal deployment of any of the eight bundle-dependent functions must use the same wrapper with
the complete authoritative object(s) supplied in the same process: `--ad-input <0600-path>` for
an AD reader and/or `--delivery-input <0600-path>` for the checkout delivery reader, alongside
the explicit `--function`, `--project-ref`, and `--merged-commit` arguments. Before its first
apply or deploy, that route requires exact value-blind live-name parity with the 88-name manifest.
It then applies the complete object, creates and consumes the protected in-memory receipt, runs
the later function-readiness preflight, deploys only the selected functions with `--use-api`, and
verifies source/JWT parity. A receipt file, receipt CLI argument, receipt environment variable,
or second process is never accepted.

Before the production invocation, all of these sources must exist and be independently attested:

- AppsFlyer API v2 material from its provider dashboard plus secure vault;
- every optional `*_PREVIOUS_*` field or pair as `present` or `intentionally_absent`;
- the exact current attendance pepper and Resend webhook secret from their secure vault owners;
- the exact checkout execution boolean from the approved Payments operating record;
- complete AD and delivery objects with every pre-existing field preserved; and
- the dedicated GitHub live-audit credential.

If any source is missing or ambiguous, stop. Never reconstruct from Supabase, inspect plaintext,
infer from metadata, partially patch an object, persist a deploy-authority receipt, or rotate a
credential as a substitute for continuity.

The remediation is valid only from the exact clean merged commit that current remote `main`
reports via `git ls-remote` (a stale local tracking ref is not authority), within 72 hours, against
production ref `gqnoajqerqhnvulmnyvv`, while live names equal the exact 88-name manifest plus
`ATTENDANCE_CLAIM_PEPPER`, `CHECKOUT_REVOCATION_EXECUTE`,
`META_COMPETITOR_ACCESS_TOKEN`, `META_COMPETITOR_IG_USER_ID`, and
`RESEND_WEBHOOK_SECRET`. Its recursive deploy set is exactly:

`brand-paystack-onboard`, `brand-stripe-onboard`, `payout-release-sweep`, `marketing-send`,
`event-cancel-refund-fanout`, `rsvp-contribution-refund`, `source-refund-sweep`,
`venue-reservation-cancel`, `send-pair-request`, `send-phone-invite`, `send-venue-sms`,
`ticket-confirmation-dispatch`, `notify-dispatch`, `offering-invite-dispatch`, `rsvp-notify`,
`guest-roster-actions`, `support-brand-person-erasure`, `checkout-sale-revocation`,
`attendance-claim-link`, `claim-attendance`, `attendance-claim-backfill`,
`competitor-intel-worker`, and `resend-webhook`.

The coordinator first proves exact value-blind 93-name remediation parity; mismatch permits zero
apply or deploy calls. It then applies the reconstructed complete AD object. A same-run applied AD receipt
and a prepared-transition receipt for the exact preserved delivery-v3 → v4 candidate authorize
that one 23-function deploy. It downloads each deployed function, recursively follows relative
imports, rejects any missing, extra, or drifted closure file, then reads the remote function list
as names plus `verify_jwt` metadata only and requires exact live parity with the local lock. It
then applies delivery v4 and verifies a fresh one-use applied receipt. No receipt authorizes an
unset.

While every direct fallback remains, run value-blind attendance, checkout (without money
movement), competitor observation, Resend signature, prior AD/delivery reader, and synthetic
non-PII #1772 challenge smokes. Only after all pass may the five direct names be removed, one at a
time, in this order: `META_COMPETITOR_IG_USER_ID` (92),
`META_COMPETITOR_ACCESS_TOKEN` (91), `RESEND_WEBHOOK_SECRET` (90),
`CHECKOUT_REVOCATION_EXECUTE` (89), and `ATTENDANCE_CLAIM_PEPPER` last (88). Stop on any fallback
or invalid-bundle diagnostic or failed smoke. Then run the exact names-only audit and manually
dispatch the credential-backed workflow; both must execute and report exact 88 parity.

Rollback before any unset restores the prior complete bundle from its authoritative source.
After an unset, restore that exact direct name first from its approved source, verify the fallback
rail, then restore the prior bundle/deployed revision if necessary, reversing the removal order.
Never roll back completed #1772 erasure records.

## No-downtime sequence

Every mutation and live-fire step requires issue-bound authorization. Code merge alone does not
authorize a secret, provider, or operational-boolean change.

1. Reconstruct the complete current object only from its named provider dashboard, approved
   private operating record, or secure vault. Supabase plaintext readback, runtime exfiltration,
   value inference, and digest comparison are forbidden.
2. Build replacements in memory and validate without echoing. Allowed evidence is bundle name,
   schema version, sorted field-name set, minimum-valid PASS, and parser PASS/FAIL.
3. Deploy strict bundle-first compatibility readers from an exact merged commit while every
   superseded direct name remains present. Verify downloaded live source and JWT posture.
4. Set the existing bundle name before removing any direct name. Run value-blind runtime checks
   proving every rail retains its prior behavior.
5. Remove only the approved direct names, one at a time, verifying after each. For the #1436
   exit the locked order is: `SOURCE_REFUNDS_POST_DISABLED`, `PAYOUT_RELEASE_EXECUTE`,
   `PAYOUT_HOLD_ONBOARD_FLIP`, then `NOTIFICATION_RECIPIENT_HMAC_SECRET`.
6. Run the exact names-only audit. After the #1770 approved standalone pepper, the enforced
   pre-Sites state is exactly 87 user-managed names. The approved repository target is exactly 88
   names with 12 free slots and the sole #2830 exception; no other missing or unexpected name is allowed.
7. Merge repository truth only after live truth exists and independent testing passes. Removing
   compatibility code requires a separate reviewed issue.

A partial or concurrent deployment, deployment-commit mismatch, parser/missing-field event,
unknown ownership, missing source, or failed live-fire blocks every unset.

### #1772 brand-person erasure challenge field install

This procedure is authorized only after Seth accepts the exact independently tested #1772 release
candidate. It adds one independent field to the existing `AD_CONVERSION_TOKENS` object; it never
adds, removes, or renames a Supabase secret name and must leave the names-only audit at exactly 87.

1. Pause #1772 challenge creation. Before this field exists, the new resolver must remain fail
   closed, so no production brand-person erasure can start.
2. Reconstruct the complete current `AD_CONVERSION_TOKENS` object only from approved provider
   dashboards, private operating records, and the secure vault. Never use Supabase plaintext
   readback, runtime exfiltration, digest comparison, metadata inference, partial patching, or
   another field's value. Stop if any existing field's authoritative source is unavailable.
3. In authorized secure tooling, generate exactly 32 fresh random bytes. Immediately preserve the
   material in Platform Security's secure-vault record, encode it once as canonical standard
   Base64, and add only `BRAND_PERSON_ERASURE_CHALLENGE_SECRET` to the complete in-memory object.
   Never print or paste the value.
4. The value-blind preflight may report only the bundle name, sorted field-name set, existing-field
   preservation PASS, new-field owner/source PASS, canonical parser PASS, #1772 fail-closed test
   PASS, and serialized-object-below-48-KiB PASS. It must not report a value, byte/string length,
   raw/digest/hash/fingerprint, prefix, or suffix.
5. Atomically set the existing `AD_CONVERSION_TOKENS` Supabase name with the full reconstructed
   object before deploying `support-brand-person-erasure`. Do not set or unset any other name.
   The names-only audit must remain exactly 87 with exact parity and zero exception.
6. Deploy the exact merged Edge function, verify deployed-source and JWT-posture parity, then use
   synthetic non-production-PII fixtures for parser/create/execute proof. This does not waive the
   migration, independent tester, Seth pause, deployment, or OTA gates.
7. For rotation, pause new challenges and wait until every issued challenge is consumed,
   invalidated, or beyond the fixed 15-minute TTL. Then repeat the complete authoritative
   reconstruction and atomic replacement with fresh material.

Rollback restores the prior complete `AD_CONVERSION_TOKENS` object from its approved authoritative
source and verifies every pre-existing reader plus exact 87-name parity. If that source is
unavailable, retain the current complete bundle and stop; never delete this field, invent a value,
weaken the parser, or reconstruct from Supabase. The Edge function may be deactivated separately.
A completed database erasure, tombstone, or audit record is irreversible and is never rolled back
with secret configuration.

### #1808 content-share switch reconciliation

The active `CONTENT_SHARE_V1_CREATE_ENABLED` direct name is not part of the pre-Sites 87-name
manifest. Reconcile it without a capacity exception in this exact order:

1. Deploy the exact merged `shared-card` revision containing `resolveRuntimeBoolean` while the
   direct name remains `true`. The older bundle has no content-share field, so compatibility
   fallback preserves creation.
2. Reconstruct the complete approved `MINGLA_RUNTIME_CONFIG_JSON` record, add
   `content_share_v1_create_enabled:true`, and validate it with the exact merged parser before
   replacing the bundle. Never patch an object recovered from Supabase metadata.
3. Prove one controlled content-share creation and read while both authorities exist.
4. Unset only `CONTENT_SHARE_V1_CREATE_ENABLED`; prove creation and read again, then require an
   exact names-only audit of 86 user-managed names.
5. Set the separately governed `OFFERING_INVITE_TOKEN_PEPPER`; the exact audit must then match
   the historical 87-name manifest. Issue #2830 subsequently adds the separately approved slot-88
   Sites envelope record. If the bundle-backed smoke fails before the unset, stop. If it
   fails immediately after the unset, restore only the direct flag and investigate; do not
   weaken the parser or bundle the pepper.

## Notification HMAC zero-row epoch

Historical recipient fingerprints must retain the exact HMAC material that created them. If the
current material is unavailable, do not infer recipients, rewrite fingerprints, expose a hash
oracle, or add a second reader. A replacement epoch is allowed only when one value-blind
transaction proves zero HMAC-backed notification deliveries in every queued, failed, claimed,
provider-accepted, or open-provider-window state and zero pending payout alert intents.

Generate at least 32 random bytes privately, persist the exact replacement immediately in the
approved secure master source and `AD_CONVERSION_TOKENS`, and keep the direct compatibility name
until one operator-only transactional email plus an identical retry proves exactly one provider
acceptance and one durable terminal row. After the direct name is removed, a third identical retry
must return the same durable provider identity with no additional provider request. Report only
counts and PASS/FAIL; never report the recipient, logical key, row/provider identity, fingerprint,
payload hash, value, digest, prefix, or length.

After the controlled row exists, rollback must keep the new epoch: repair the bundle from the
secure master source or restore the exact new value under the direct compatibility name. Never
restore an unavailable old value. Any dependent row before rotation, identity conflict,
acceptance ambiguity, duplicate provider request, or inability to restore the new value is an
immediate stop for manual review.

## Rollback order

Before a direct unset, rollback restores the prior bundle from its authoritative source; all
direct names remain available.

After a direct unset, restore that exact direct value from its authoritative secure source first,
verify the direct path, and only then restore or remove a bundle. Never remove a bundle while a
superseded direct name is absent, restore one field from another field's current value, or assume
equality. Notification HMAC replacement additionally requires the zero-row epoch protocol above.

## Audit commands

Offline target validation is safe and requires no credential:

```bash
node scripts/secrets/audit-supabase-secret-budget.mjs --manifest-only
node scripts/secrets/audit-function-secret-contract.mjs
node --test scripts/secrets/issue_1203_*.test.mjs
node --test scripts/secrets/issue_2241_*.test.mjs
node .github/scripts/strict-grep/issue-1203-secret-capacity.mjs --self-test
node .github/scripts/strict-grep/issue-1203-secret-capacity.mjs
node .github/scripts/strict-grep/issue-2241-secret-readiness.mjs --self-test
node .github/scripts/strict-grep/issue-2241-secret-readiness.mjs
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
