## Independent forensics review — PR #59 (Cycle B1)

**Verdict: 🟡 Approve with follow-ups.** Migration is fundamentally sound — RLS is layered correctly, helpers are properly hardened (`SECURITY DEFINER` + `SET search_path = public, pg_temp`), every public table is RLS-enabled with deny-by-default semantics, cross-brand isolation holds across all 19 tables, the multi-permissive `tickets` UPDATE pattern is correctly constrained by the `biz_tickets_enforce_update` trigger (with proper scanner-identity binding on valid→used per the Copilot fix), and the anon public surface (§B.8) is column-revoked AND policy-scoped — no Stripe / tax / contact-PII data leaks via anon. Migration chain is collision-free across all 293 prior migrations and zero new table names clash with any existing query in `app-mobile/src/services/**` or `mingla-admin/src/**`. Confidence high.

The follow-ups below are split into "fix in this PR or immediate B1.5" (must address before any production write) and "B2/B3 cleanup" (track but don't block merge).

### 🟠 Should-fix — block merge OR commit to as immediate B1.5

- **`brands.slug` is mutable** but the consumer (`mingla-business/src/store/currentBrandStore.ts:271–283`) documents invariant **I-17** as *"FROZEN at brand creation per I-17. NEVER add an edit path — IG-bio links and shared brand URLs (Cycle 7 `/b/{brandSlug}` surface) depend on this slug being immutable."* Recommend mirroring `biz_prevent_brand_account_id_change` for `slug`. ~5 lines.
- **`events.slug` is mutable** but Cycle 7 public URLs (`app/e/[brandSlug]/[eventSlug].tsx`) resolve events by `(brandSlug, eventSlug)` — a renamed slug 404s every previously-shared link. Same trigger pattern. ~5 lines.
- **`events.created_by` is mutable** by `event_manager+`. Allows attribution forgery (audit-trail integrity). Add immutability trigger.
- **"Append-only" carve-out for service role (`audit_log`, `scan_events`)** — the `IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD)` short-circuit lets service-role calls UPDATE/DELETE rows. Either drop the short-circuit (true append-only for ALL roles) or update both `COMMENT ON TABLE` strings to reflect "append-only for non-service-role; mutations restricted to migration scripts." Pick a side and document.
- **`refunds.status` and `door_sales_ledger.payment_method`** lack CHECK constraints, while every peer status / payment_method column has one. Quality drift; trivial fix.

### 🟡 Should-fix — track for B1.5 / B2

- **`creator_accounts.deleted_at` is user-mutable** via the existing `"Creators can update own account"` policy (pre-B1, but B1's `account_deletion_requests` pipeline now makes the contradiction concrete). Recommend column-level RLS to exclude `deleted_at` from user-writable columns, OR document that the pipeline is convention-only.
- **`creator_accounts.default_brand_id` has no ownership check** — a user could set any brand they don't own as their default. Cosmetic only, but worth a `WITH CHECK EXISTS (SELECT 1 FROM brand_team_members ...)` on UPDATE.
- **`permissions_matrix` SELECT is open to all `authenticated`** — that includes Mingla mobile / consumer-app users. Today's seed rows are harmless role mappings, but no constraint prevents drift toward sensitive flags. Recommend scoping to `EXISTS (SELECT 1 FROM creator_accounts WHERE id = auth.uid())`.
- **`events.organiser_contact jsonb` and `theme jsonb`** are exposed to anon via the public-events RLS and `events_public_view`. Untyped jsonb means an organiser could dump PII (personal phone) and it's globally visible. Recommend either a CHECK on jsonb shape or shape-validation in the writing edge function.
- **`events.created_by` (an `auth.users.id`) is exposed to anon** via the same public-events RLS. Mild user-ID enumeration vector. Mirror the column-level REVOKE+GRANT pattern used for `creator_accounts` and `brands`.
- **`events.visibility = 'discover'` has no anon read policy and no authenticated-mingla-user read policy.** If "discover" is meant to surface in Mingla mobile's discover tab, mobile-side reads need an RLS allow. Confirm semantic intent.

### 🔵 Observations / informational (no action required for merge)

- **`tickets` has SELECT and 2× UPDATE policies but NO INSERT or DELETE policy.** All issuance is service-role-only (matches the spec's "issuance via service role"). Worth surfacing in B2 planning so a future "admin manual ticket issuance" UI doesn't get assumed — it'll need an edge function.
- **No `supabase_realtime` publication membership** for any new business table. When live ticket sales / scan progress dashboards land, mirror the `add_collaboration_tables_to_realtime.sql` migration pattern.
- **Frontend ↔ backend shape mismatches.** Frontend `Brand` (currentBrandStore) uses `displayName`/`bio`/`tagline`/`kind`/`address`/`coverHue`/`contact.phoneCountryIso` — backend `brands` has `name`/`description`/`profile_photo_url` and lacks `kind`/`address`/`coverHue`/`tagline`/`phoneCountryIso`. Frontend `LiveEvent` (liveEventStore) has `format`/`category`/`whenMode`/`coverHue`/`requireApproval`/`allowTransfers`/`hideRemainingCount`/`passwordProtected`/`hideAddressUntilTicket`/`venueName` — backend `events` doesn't model these directly. Not a B1 blocker (B1 is intentionally schema-first), but B2 needs a schema-reconciliation task before client cutover so the implementor isn't asking "where does X go?" on every field.
- **`tickets.qr_code` UNIQUE INDEX is global** (across all events). Issuance code must use sufficient entropy.
- **PR description mentions a `storage.objects` ownership migration blocking `db reset` in one env.** This migration itself doesn't depend on it — should apply cleanly even if the storage blocker remains.
- **No automated RLS regression suite is included.** Acknowledged in PR. Worth a B-cycle commitment to add `SET ROLE` + assertion patterns before production traffic.

### Questions for the author

1. **SF-1 / SF-2 (slug immutability)** — would you prefer to land the four small immutability triggers in this PR, or merge as-is and land them as the first commit on top? Either is fine; calling out so it doesn't slip.
2. **SF-4 (append-only carve-out)** — was the service-role short-circuit on `audit_log` / `scan_events` triggers intentional (so reconciliation jobs can repair bad rows), or an oversight? Either answer is acceptable; we just need it documented.
3. **HF-7 (`events.visibility = 'discover'`)** — what reads `'discover'` events? If the consumer Mingla mobile app, we'll need either an RLS allow or a service-role edge function on the read path before that surface ships.
4. **OB-1 / OB-2 (frontend shape mismatches)** — confirm the plan: schema-first now, frontend reshapes in B2 cutover (don't add columns retroactively to match the stub)? Or do you want backend to grow `kind`/`address`/`coverHue`/`tagline`/etc. to match the consumer contract?

Full forensic report (with six-field evidence on every finding) at `Mingla_Artifacts/reports/INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md`.
