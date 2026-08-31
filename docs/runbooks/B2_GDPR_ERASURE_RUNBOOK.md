# B2a Path C V3 — GDPR Right-to-Be-Forgotten Erasure Runbook

**Status:** Operator-side runbook — Stripe + Supabase coordinated action.
**Authoritative source:** B2a Path C V3 SPEC §3 + DEC-V3-4 + Sub-A migration `20260511000004_b2a_v3_gdpr_erasure.sql`.
**Owner:** Operator + Mingla legal/compliance lead (DPO if appointed).
**Estimated time:** 30-60 min per request.

---

## Why this runbook exists

GDPR Article 17 ("right to erasure") obliges Mingla to anonymize a user's personal data on request, within 30 days. For users whose Mingla account is associated with a Stripe Connect account (brand admins), erasure has two distinct surfaces:

- **Stripe-side:** governed by Stripe's own GDPR contract. Stripe retains certain transaction records for AML/KYC/tax compliance per §26.1 of the Stripe Services Agreement; these are NOT erasable, but Stripe will redact PII fields on operator request.
- **Mingla-side:** governed by `anonymize_user_audit_log()` SQL function (Sub-A migration `20260511000004`). Anonymization preserves row counts and FK integrity (so reporting/audit trails remain queryable) but redacts PII fields.

The anonymization is **field-level**, not row-level: rows persist, names/emails/addresses become hashed-stable identifiers, and any free-text fields are scrubbed. This pattern preserves legal-retention compliance while satisfying GDPR.

---

## Retention windows that override erasure

Per legal advice + Mingla's data-retention policy:

| Jurisdiction | Retention requirement | Source |
|---|---|---|
| US | 7 years (IRS records) | IRC §6001 |
| UK | 6 years (HMRC + FCA) | HMRC TMA 1970, FCA SYSC 9 |
| EU | 5 years (AML directive) | Directive (EU) 2015/849 Art. 40 |
| Germany | 10 years (HGB §257 + AO §147) | German Commercial Code |
| Italy | 10 years (Civil Code §2220) | Italian Civil Code |

Until the retention window has elapsed for the requesting user's jurisdiction, anonymization (NOT deletion) is the maximum we can do. The runbook below executes anonymization; full deletion can only be scheduled at the end of retention.

---

## Pre-flight

- [ ] Erasure request received in writing (email, support ticket, or formal letter). Capture the timestamp; the 30-day GDPR clock starts here.
- [ ] Verify requester identity. For brand admins, require a verification step: email confirmation from the email on file + a knowledge factor (last 4 of bank account on file, or recent payout amount).
- [ ] Determine the requester's primary jurisdiction (where retention rules apply).
- [ ] Determine ALL Mingla user_id values associated with the request. A single human may have multiple accounts (e.g., consumer account + brand admin account). Confirm scope with requester.
- [ ] Notify Mingla legal/DPO. Compliance log entry is mandatory.

---

## Procedure

### Step 1 — Confirm operator has the right tools

```bash
# Supabase service-role client capable of executing anonymize_user_audit_log
# (the function is service_role-only per migration 20260511000004).
supabase --version  # confirm CLI installed
psql --version      # confirm psql installed (for the DB-side step)

# Stripe CLI authenticated to the right workspace
stripe config --list | grep account_id
```

### Step 2 — Identify all data surfaces touched by the user's data

Run this query against the Mingla DB (via Supabase Studio SQL Editor OR psql with service_role):

```sql
-- Replace :user_id with the user's Mingla auth.users.id
SELECT 'profiles' AS table_name, count(*) FROM public.profiles WHERE id = :user_id
UNION ALL
SELECT 'brand_team_members', count(*) FROM public.brand_team_members WHERE user_id = :user_id
UNION ALL
SELECT 'orders', count(*) FROM public.orders WHERE account_id = :user_id
UNION ALL
SELECT 'audit_log', count(*) FROM public.audit_log WHERE actor_user_id = :user_id
UNION ALL
SELECT 'notifications', count(*) FROM public.notifications WHERE user_id = :user_id
UNION ALL
SELECT 'gdpr_erasure_log', count(*) FROM public.gdpr_erasure_log WHERE user_id = :user_id;
```

Record the counts. The `gdpr_erasure_log` count tells you whether this user has been anonymized before (idempotent operation; safe to repeat).

### Step 3 — Run the Mingla-side anonymization

```sql
-- Replace :user_id with the user's Mingla auth.users.id
SELECT public.anonymize_user_audit_log(:user_id);
```

This function (defined in migration `20260511000004_b2a_v3_gdpr_erasure.sql`) performs:

- **profiles:** name, email, phone, profile_photo_url → hashed-stable placeholder
- **brand_team_members:** display_name → hashed; invitation_email → hashed
- **orders:** customer_name, customer_email, billing_address fields → hashed
- **audit_log:** actor_user_id stays (FK integrity); actor_email + actor_ip → hashed
- **notifications:** title + body → "Notification redacted per GDPR erasure request"
- **gdpr_erasure_log:** new row inserted recording the erasure timestamp + the requesting operator

Re-run Step 2's query to verify counts unchanged (rows persist; values are now hashed).

### Step 4 — Stripe-side redaction

For each Stripe Connect account associated with the user (`stripe_connect_accounts` table → `stripe_account_id`):

1. Open Stripe Dashboard → Connect → search for the account ID.
2. Click into the connected account.
3. **DO NOT call `accounts.del`** — that's a different operation (closing the account); the user may want to retain account access without their PII. If they want full account closure, run the **detach** flow instead (see brand-stripe-detach edge fn) which is a separate user choice.
4. Email Stripe support at `privacy@stripe.com` with:
   - Subject: "GDPR Article 17 erasure request — connected account `acct_*`"
   - Body: include user identification (name + email pre-redaction), confirmation Mingla is the platform owner, and the retention-window clause that governs (US 7y / UK 6y / etc.).
   - Stripe responds within 30 days with a redaction confirmation. Stripe redacts free-text PII; structured KYC retained for retention window then auto-redacted.

### Step 5 — Notify the user

Send a confirmation email:

> Subject: Your data erasure request is processed
>
> Hi,
>
> We've completed your right-to-erasure request received on [DATE]. Your personal data has been anonymized in Mingla's records. Some transactional records are retained per legal retention requirements ([JURISDICTION]); these will be fully deleted at the end of the retention window. We've also requested redaction from Stripe, our payment processor; they'll respond within 30 days with confirmation.
>
> Reference: GDPR-ERASURE-[user_id_hash]
>
> If you have questions, reply to this email.

### Step 6 — Compliance log

Update `Mingla_Artifacts/DECISION_LOG.md` with:

- Erasure request received date + processed date
- User ID (anonymized — use the gdpr_erasure_log row ID, not the original user_id)
- Operator who executed the erasure
- Stripe support ticket reference (from Step 4)
- Confirmation email sent reference

This satisfies Article 30 (records of processing activities) for the erasure event itself.

---

## Verification (mandatory before declaring complete)

- [ ] Step 2 row counts match between pre-anonymization and post-anonymization (rows preserved)
- [ ] `gdpr_erasure_log` has a row for the user with today's date
- [ ] Sample a few records (audit_log, profiles) and confirm PII fields are hashed (not plaintext)
- [ ] Stripe support email sent + ticket reference recorded
- [ ] User received the confirmation email
- [ ] DECISION_LOG entry committed

---

## What NOT to do

- ❌ Do NOT delete rows. Anonymization preserves audit + reporting integrity; deletion breaks FK chains and reporting.
- ❌ Do NOT skip Stripe-side redaction. GDPR scope includes our payment processor; their data is in scope by association.
- ❌ Do NOT omit the compliance log. Lack of log = audit-fail finding under GDPR Art. 30.
- ❌ Do NOT respond to the user beyond the confirmation email until Stripe's redaction confirmation arrives. Premature "done" claims expose Mingla to liability if Stripe later finds residual data.

---

## Brand-owned non-user contact erasure (#1772)

This is a separate service-only procedure for a person in a brand's private contact book who has
no linked Mingla user account. It does not replace or modify the linked-user/account anonymization
procedure above. There is no Business, Consumer, buyer, or Admin UI for this operation, and Admin
status alone is not authority. Only an enabled support/privacy staff member using the approved
service boundary may perform it.

### Preconditions

- The request and identity-verification record exist under a safe internal case reference matching
  `^[A-Z0-9][A-Z0-9._/-]{2,79}$`; never put a name, email, phone, or free-text note in that field.
- The operator is an enabled `support_staff` member and uses their own verified JWT. Never supply
  an actor ID in a request body and never place a service-role key in a client or operator UI.
- The target is an active canonical person in the named brand, has no linked Mingla user, no open
  identity conflict, and no active merge. If the service refuses any condition, stop; do not use
  Admin access, raw SQL, a raw merge engine, or an alternate address as an override.
- The challenge destination is one active `brand_owned` email or phone already stored on that
  person. Never accept a newly supplied destination.
- The independently approved #1772 migration, Edge function, and capacity-safe secret field are
  deployed and read back exactly. Follow the #1772 field-install procedure in
  `SUPABASE_SECRET_CAPACITY.md`; never read, log, infer, or regenerate production secret material
  during an erasure case.

### Procedure

1. Pause if another erasure, merge, Split, or conflict action is unresolved for the person. Record
   only the safe case reference and generated operation/challenge identifiers in operational
   evidence; do not copy Book PII into logs, chat, analytics, receipts, or audit metadata.
2. Through the approved `support-brand-person-erasure` service client, submit
   `action=create_challenge` with the safe case reference, brand/person/contact-method identifiers,
   and one fresh client request UUID. The handler authenticates support authority and validates
   input before resolving the challenge key, generating a code, writing a challenge, or calling a
   provider.
3. The database claims delivery exactly once immediately before provider I/O. Email uses the
   service's exact provider idempotency key; SMS has no provider idempotency input. If the result is
   `erasure_challenge_state_unknown` or dispatch remains unknown, do not resend, invalidate, or
   erase. Wait until the fixed 15-minute challenge TTL passes, investigate through PII-free status,
   and start a new request only after expiry.
4. Ask the requester for the six-digit code delivered to the already-stored method. Keep the code
   only in the approved in-memory operator interaction; never persist, paste, screenshot, log, or
   include it in the case reference.
5. Submit `action=execute` with the challenge ID, code, and one fresh execution request UUID. Reuse
   that same request UUID for status recovery or an identical retry after a transport timeout;
   never mint a second UUID merely because the response was lost.
6. The service verifies the code and atomically installs keyed email/phone tombstones before it
   scrubs the Book projection. It detaches source links, retires/scrubs contact methods and names,
   deletes the canonical Book projection, removes eligible pending invitations and Manual-group
   projections, and expires brand-book export objects. Source orders, reservations, RSVPs,
   tickets, financial/legal records, and historical delivery facts remain unchanged.
7. The Edge function removes the returned private `brand-people-exports` objects and finalizes the
   PII-free operation. If it returns `erasure_cleanup_pending`, the database erasure is already
   complete: use the same operation status/retry path until cleanup completes. Never repeat or
   reverse the database erasure because object cleanup failed.

### Verification and evidence

- The final service status is `completed`, or an explicitly owned cleanup retry remains open.
- The safe count summary covers the enumerated Book projections and contains no raw identity data.
- PII-free tombstone counts exist for every retired email/phone channel, and synthetic attempts
  through derived ingestion, manual add, CSV import, and a direct service contact insert are
  refused without recreating a person, conflict, source link, invitation, or marketing reach.
- Source commerce row counts and identifiers remain unchanged. Do not sample or publish raw source
  PII as proof.
- The immutable erasure audit records the expected safe phases and enabled support actor without a
  destination, name, code, free text, storage path, secret, provider error, or contact value.

Erasure is forward-only. Rollback may pause/revoke the new service boundary or repair it with a new
migration/deployment, but it must never restore scrubbed PII, delete tombstones/audit/receipts, or
make a retired address reachable again.
