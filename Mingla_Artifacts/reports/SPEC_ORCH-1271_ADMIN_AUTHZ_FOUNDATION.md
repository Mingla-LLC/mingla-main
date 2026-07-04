# SPEC — ORCH-1271 [Admin authorization & audit FOUNDATION]

**Parent:** META-ORCH-1237 (Admin full-visibility console). **Phase:** SPEC (build contract). **Author:** mingla-forensics.
**Backend:** Supabase LIVE PROD `gqnoajqerqhnvulmnyvv`. **Surface:** Admin Web (`mingla-admin/`) + backend (migrations/RPC/edge). No shipping-app surface.
**Inputs consumed:** `INVESTIGATION_META-ORCH-1237_MASTER_SYNTHESIS.md`, `_ADMIN_ARCH_AUTHZ.md`, `_IDENTITY_USERS_ACCOUNTS_BRANDS.md`, `_OFFERINGS_EVENTS_TRIPS_EXPERIENCES_VENUES.md`, `_MONEY_STRIPE_ORDERS_SUBS.md`.
**COMMS ledger:** scanned on entry. Only OPEN row touching scope = COMMS-0061 (WARN, ALL): `gqnoajqerqhnvulmnyvv` is LIVE PROD, DR drills clone-only. Honored by construction — this spec ran read-only `execute_sql` SELECT probes only, mutated nothing. Factored, no ack write needed (WARN, not BLOCK).

> Every schema/column/function/policy name below was verified against live PROD via read-only `execute_sql` on 2026-07-03. Citations: `[verified]` = confirmed this session; `[report]` = sealed by the cited investigation.

---

## Scope & non-goals

**In scope (foundation only):**
1. Standardize the admin identity gate on `is_admin_user()` for all META-1237 in-scope tables; retire the two `profiles.account_type='admin'` policies.
2. Build + unit-prove the **audited admin-write PRIMITIVE**: `admin_audit_log` extension, shared `admin_write_audit(...)` SQL helper, ONE deployed golden reference RPC (`admin_audit_probe`), the documented copy-paste WRITE-RPC template, and the service_role edge-fn skeleton (`admin-write-primitive`).
3. Define the admin **READ authorization convention** (RLS-policy vs read-RPC decision rule + naming + return-shape) that 1272/1273/1274 follow.
4. Admin UI **scaffolding**: a new "Business" nav group + hash route; reusable `EntityListView`, `EntityDetailView`, `HighRiskActionModal`; one smoke-wired placeholder page (`BusinessConsolePage`) proving the shells + primitive round-trip render.
5. Pre-stage 3 DRAFT invariants + their strict-grep gates.
6. Two DECISION_LOG records (`brands.kind` alive; single-gate standardization).

**Non-goals (HARD — do NOT build; belong to later ORCHs):**
- NO domain pages (Person/Brand/Offerings/Money views) — 1272/1273/1274.
- NO edit UI wired to a real business-data mutation. The primitive ships **built + unit-proven but NOT behind any user-facing edit button.** Only the harmless self-test probe exercises it end-to-end.
- NO destructive admin action ships in 1271 (no user delete, brand delete, refund, owner-reassign, cancel).
- NO remediation of the two flagged anomalies. **FLAG ONLY, route to later ORCHs:** `admin_set_city_live` (guard-less invoker-rights RPC) `[report: ADMIN_ARCH A-1]` and the `delete-user` edge fn (self-delete of caller's own id, no safe admin arbitrary-user-delete path) `[report: ADMIN_ARCH D-1/G-7]`. These are registered as Discoveries below; 1271 must not touch them.
- NO change to `is_admin_user()` itself (used everywhere; changing it is out-of-blast-radius — see Open Questions Q3).
- NO super-admin tier. `admin_users.role` is nullable free-text `[verified]`; every active admin is fully privileged. Safety comes from typed-reason + confirm + server audit, not from a tier.

---

## Binding decisions (from Seth — spec conforms to these)

- **D1 — VISIBILITY-FIRST.** Foundation = READ authz + UI scaffolding + audited-write primitive (built, unit-proven, unwired). Edit UI is wave 2.
- **D2 — High-risk actions = typed REASON + CONFIRM + server-side AUDIT, every admin, no super-admin tier.** The primitive bakes reason-required + server audit into the RPC/edge seam; the modal bakes typed-reason + confirm into the UI.

---

## (1) Single-gate standardization (+ migration)

### Decision (canonical)
**`public.is_admin_user()` is THE admin-identity gate for every META-1237 in-scope table and admin code path.** `profiles.account_type='admin'` is retired from all in-scope RLS.

**Evidence the split is small and safe to flip `[verified]`:** exactly TWO policies in the entire `public` schema reference `account_type = 'admin'`, both SELECT-only, each an OR-branch alongside a self-access branch:
- `partner_splits` / `partner_splits_partner_self_select` (cmd SELECT) — self-branch `partner_account_id = auth.uid()` OR the `profiles.account_type='admin'` admin-branch.
- `partner_stripe_connect_accounts` / `partner_stripe_self_select` (cmd SELECT) — `(account_id = auth.uid()) OR (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.account_type = 'admin'))`.

`profiles.account_type='admin'` currently has exactly **1 row (Seth)** `[verified]` — so the split gate *works today by accident of Seth's dual flag*, but the moment a new `admin_users` admin lacks `account_type='admin'` on their profile, they silently lose partner-money read. Flipping to `is_admin_user()` removes that drift.

### Migration (RLS-only, self-asserting)
File: `supabase/migrations/<next-utc-ts>_orch_1271_single_admin_gate.sql` (implementor: use next-free UTC timestamp > latest migration on `origin/main`).

For each of the two policies: `DROP POLICY` then `CREATE POLICY` replacing the `account_type='admin'` OR-branch with `public.is_admin_user()`, preserving the self-access branch. Illustrative shape (≤3 lines — NOT the full file):
```sql
CREATE POLICY partner_stripe_self_select ON public.partner_stripe_connect_accounts
  FOR SELECT USING (account_id = auth.uid() OR public.is_admin_user());
```
End the migration with a self-assertion that fails apply if any in-scope policy still references the split gate:
```sql
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
  AND (COALESCE(qual,'') ILIKE '%account_type%''admin''%' OR COALESCE(with_check,'') ILIKE '%account_type%''admin''%'))
  THEN RAISE EXCEPTION 'I-ADMIN-SINGLE-GATE violated: account_type=admin policy still present'; END IF; END $$;
```

**Do NOT** add admin RLS to any new business table here — read-authz coverage on `events`/`orders`/`creator_accounts`/etc. is domain work (1272/1273/1274). This migration ONLY reconciles the two existing split-gate policies.

---

## (2) The audited admin-write PRIMITIVE

### 2a. Exact `admin_audit_log` schema — existing + additions

**Existing columns `[verified]`:** `id uuid NOT NULL DEFAULT gen_random_uuid()` · `admin_email text NOT NULL` · `action text NOT NULL` · `target_type text NOT NULL` · `target_id text NULL` · `metadata jsonb NULL DEFAULT '{}'::jsonb` · `created_at timestamptz NULL DEFAULT now()`.
**Existing indexes `[verified]`:** pkey(id), `idx_audit_log_created_at (created_at DESC)`, `idx_audit_log_admin (admin_email)`, `idx_audit_log_action (action)`. **No append-only trigger on this table** `[verified]` — the `trg_audit_log_block_update` trigger is on a *different* table (`audit_log`, not `admin_audit_log`); append-only-ness of `admin_audit_log` is enforced by RLS having only INSERT+SELECT policies (no UPDATE/DELETE policy) `[report: ADMIN_ARCH]`.

**Columns to ADD (migration; both NULLABLE for backward-compat with existing client-side `logAdminAction` inserts):**

| Field (requested) | Column | Status | Notes |
|---|---|---|---|
| actor email | `admin_email` | exists | server-resolved in helper |
| actor uid | **`actor_uid uuid`** | **ADD** | server-resolved `auth.uid()`; true PK of actor |
| action | `action` | exists | e.g. `brand.suspend` |
| entity_type | `target_type` | exists | e.g. `brand` |
| entity_id | `target_id` | exists | text |
| reason | **`reason text`** | **ADD** | typed reason; helper rejects empty for high-risk |
| payload / before-after | `metadata` | exists | jsonb; canonical shape `{ "before": {...}, "after": {...} }` (+ any extra keys) |
| created_at | `created_at` | exists | default now() |

Migration `supabase/migrations/<ts>_orch_1271_audit_log_extend.sql`:
```sql
ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS actor_uid uuid,
  ADD COLUMN IF NOT EXISTS reason text;
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON public.admin_audit_log (target_type, target_id);
```
(`idx_audit_log_target` supports the wave-2 "audit trail for this entity" view.)

### 2b. Shared SQL helper `admin_write_audit(...)`

File: `supabase/migrations/<ts>_orch_1271_admin_write_primitive.sql`. Confirmed **no such helper exists today** `[verified]`.

Signature + full body (this IS the contract — implementor ships verbatim, adjusting only formatting):
```sql
CREATE OR REPLACE FUNCTION public.admin_write_audit(
  p_action        text,
  p_entity_type   text,
  p_entity_id     text,
  p_reason        text,
  p_metadata      jsonb    DEFAULT '{}'::jsonb,
  p_require_reason boolean DEFAULT true,
  p_actor_email   text     DEFAULT NULL,   -- edge-fn (service_role) path override
  p_actor_uid     uuid     DEFAULT NULL    -- edge-fn (service_role) path override
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid; v_email text; v_id uuid;
BEGIN
  -- GUARD (first executable statement): a JWT caller MUST be an active admin.
  -- Service-role edge fns call with no JWT (auth.uid() IS NULL) after their own
  -- admin re-check, and pass p_actor_* explicitly.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_require_reason AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  v_uid   := COALESCE(p_actor_uid, auth.uid());
  v_email := COALESCE(p_actor_email, (SELECT email FROM auth.users WHERE id = auth.uid()));
  IF v_email IS NULL THEN RAISE EXCEPTION 'actor_unresolved'; END IF;
  INSERT INTO public.admin_audit_log (admin_email, actor_uid, action, target_type, target_id, reason, metadata)
  VALUES (v_email, v_uid, p_action, p_entity_type, p_entity_id, p_reason, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
```
Rationale for `SET search_path TO 'public'`: matches the hardened `admin_set_platform_take_rate` exemplar `[verified]` and prevents search_path hijack of the `admin_audit_log` / `auth.users` references.

### 2c. Golden reference RPC (deployed, unit-proven) — `admin_audit_probe`

The ONE worked, guarded + audited RPC that unit-proves the whole seam **without mutating any business data** (satisfies D1 "built and unit-proven, unwired"). Ships in the same migration:
```sql
CREATE OR REPLACE FUNCTION public.admin_audit_probe(p_reason text, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;   -- gate = first statement
  RETURN public.admin_write_audit(
    'admin.audit_probe', 'self_test', NULL, p_reason,
    jsonb_build_object('note', p_note), true);
END; $$;
```
`admin_audit_probe` is the golden template's guard+reason+audit spine minus a business mutation. It is the demo action the placeholder page's modal calls.

### 2d. Golden WRITE-RPC template (documented contract — copied by 1272/1273/1274; NOT deployed in 1271)

Every future admin write RPC MUST follow this exact skeleton. `<...>` are the only substitution points:
```sql
CREATE OR REPLACE FUNCTION public.admin_<verb>_<entity>(p_<id> uuid, p_<field> <type>, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;      -- (I-ADMIN-GATE-FIRST-STATEMENT)
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;  -- (D2, high-risk)
  SELECT to_jsonb(t) INTO v_before FROM public.<table> t WHERE t.id = p_<id>;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.<table> SET <field> = p_<field>, updated_at = now()
   WHERE id = p_<id> RETURNING to_jsonb(public.<table>) INTO v_after;
  PERFORM public.admin_write_audit('<entity>.<verb>', '<entity>', p_<id>::text, p_reason,   -- (I-ADMIN-WRITE-AUDITED)
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;
```
**Ordering is load-bearing:** guard FIRST, then reason gate, then any SELECT/mutation. No query may precede the guard (else `is_admin_user()` fail-open exposure window).

### 2e. Service_role edge-fn skeleton — `admin-write-primitive`

For wave-2 actions that must call the Stripe API (refund, onboarding-link, dispute), the seam is a service_role edge fn following the proven `careers-cv-signed-url` contract `[verified]`: `verify_jwt=true` → `getUser(token)` → `admin_users` active-check → 403 → work → **audit inside the fn**.

Ship a deployed, harmless prover at `supabase/functions/admin-write-primitive/index.ts` (guarded no-op — proves the seam, touches no Stripe/business data):
```ts
// getUser(token) → admin_users {status:'active'} → else 403  (mirrors careers-cv-signed-url:37-60)
// then (admin only): const { data: auditId } = await svc.rpc('admin_write_audit', {
//   p_action:'admin.edge_probe', p_entity_type:'self_test', p_entity_id:null,
//   p_reason: body.reason, p_metadata:{ via:'edge' },
//   p_actor_email:user.email, p_actor_uid:user.id });   // p_actor_* set because service-role has no JWT uid
// return json({ ok:true, audit_id:auditId });           // 400 if reason blank (helper raises reason_required)
```
Register in `supabase/config.toml`:
```toml
[functions.admin-write-primitive]
verify_jwt = true
```
Reason-required for high-risk is enforced server-side by `admin_write_audit` (`reason_required`) — the edge fn must surface a blank/whitespace reason as HTTP 400.

**Deploy note:** per memory `feedback_orchestrator_deploys_edge_functions`, the orchestrator deploys edge fns at implement/close; implementor writes + locally validates. Verify with one curl each: anon → 401, non-admin authed → 403, admin + blank reason → 400, admin + reason → 200 `{ok:true, audit_id}` + row in `admin_audit_log`.

---

## (3) Admin READ authorization CONVENTION

The rule 1272/1273/1274 follow to decide **RLS SELECT policy vs read-RPC** per target table.

### Decision rule
- **Add an `is_admin_user()` SELECT RLS policy** when the console reads *whole rows of a single table* that carry no cross-brand-sensitive derivation — i.e. mirror the proven `brands` / `venue_listings` / `profiles` admin-read policies. Copy-paste exemplar `[verified]` (policy name `venue_listings admin can read`):
  ```sql
  CREATE POLICY "<table> admin can read" ON public.<table> FOR SELECT USING (public.is_admin_user());
  ```
  Candidate tables (domain ORCHs decide, NOT 1271): `creator_accounts`, `brand_team_members`, `brand_invitations`, `partner_brand_links` (identity); `events`, `event_dates`, `ticket_types`, `trip_days`, `trip_pricing_tiers`, `experience_stops`, `venue_listings` (offerings). All confirmed to have **zero admin policy today** `[report]`.
- **Read via an `admin_*` SECURITY DEFINER RPC** when the read is *derived, joined, cross-brand aggregated, or crosses a sensitive money table* — e.g. derived Stripe status (`pg_derive_brand_stripe_status` + `stripe_connect_accounts.requirements`), RSVP counts (`event_rsvps`/`event_rsvp_guests` rollups), order/refund/dispute joins, subscription context. Precedent: `admin_list_subscriptions`, `admin_get_claim_review_bundle` `[report]`.

### Naming convention (domain specs MUST follow)
- Read RPC: `admin_list_<entities>(...)` (paged list) · `admin_get_<entity>(p_id ...)` (single detail bundle) · `admin_<entity>_stats(...)` (aggregates).
- Write RPC: `admin_<verb>_<entity>(p_..., p_reason text)` (per §2d template).
- RLS policy: `"<table> admin can read"` (SELECT), `"<table> admin can write"` (INSERT/UPDATE/DELETE) — matching existing string style.

### Return-shape convention
- List RPCs return a JSON array (or `SETOF` composite) of flat row objects PLUS a total count for pagination — shape `{ rows: jsonb[], total: int }` or a two-call `(list, count)` pair mirroring `admin_list_subscriptions` `[report]`. Detail RPCs return one `jsonb` bundle. Timestamps ISO-8601; money in integer cents + currency code (never pre-formatted).

### Acceptance rule — "prove against a known draft/private/cross-brand row" (MANDATORY, HARD)
Every admin read path a domain adds MUST be proven, at TEST, to return a row the admin does **not** own — specifically at least one `events` row with `status`/visibility = draft/private (not public-published) AND one row under a brand the admin is not a team member of. This catches the silent-empty-read failure mode `[report: ADMIN_ARCH G-1, synthesis §4.5]` where a missing admin policy makes a list quietly return only public rows and *looks* like it works. (1271 does not add these reads; this rule is the contract the domain specs inherit and the tester enforces.)

---

## (4) Admin UI scaffolding

All paths under `mingla-admin/src/`. Reuse existing kit — do NOT re-implement Table/Modal/SearchInput/Card/Badge/Button/Skeleton/Spinner/Toast/Dropdown.

### 4a. Nav group "Business" + route
- `lib/constants.js`: append a SECOND group to `NAV_GROUPS` (currently one flat `label:null` group `[verified]`). The Sidebar already renders `group.label` headers `[verified: Sidebar.jsx:148-170]`:
  ```js
  { label: "Business", items: [ { id: "business-console", label: "Business Console", icon: "Building2" } ] }
  ```
- `components/layout/Sidebar.jsx`: import `Building2` from `lucide-react` and add it to `ICON_MAP` — **required**, else the icon silently falls back to `LayoutDashboard` `[verified: Sidebar.jsx:38-48,85]` (the documented Careers/Support footgun).
- `App.jsx`: import `BusinessConsolePage`, add `"business-console": BusinessConsolePage` to the `PAGES` map `[verified: App.jsx:41-66]`. Hash route `#/business-console` works automatically via `getTabFromHash`.

### 4b. `components/entity/EntityListView.jsx`
Reusable server-driven list. Wraps `DataTable` (exported name is `DataTable`, `components/ui/Table.jsx` `[verified]`), `SearchInput`, `Dropdown` filters, `exportCsv`.
```
props:
  title: string
  columns: { key, label, sortable?, render?, width? }[]        // DataTable column shape
  fetchPage: async ({ search, sortKey, sortDir, filters, page, pageSize }) => { rows, total }
  searchPlaceholder?: string                 // default "Search…"
  filters?: { key, label, options: {value,label}[] }[]   // rendered as Dropdowns; passed back in filters
  pageSize?: number                          // default 25
  onRowClick?: (row) => void                 // e.g. navigate to detail
  csv?: { columns: {key,label}[], filename: string }     // enables CSV button via lib/exportCsv
  emptyMessage?: string; emptyIcon?: Icon
  rowKey?: (row) => string                   // default row.id
```
Behavior contract: debounced search (300ms) → resets to page 0; server sort via `DataTable` controlled `sortKey/sortDirection/onSort`; server pagination via `DataTable` `pagination={{page,pageSize,total,from,to,onChange}}` (0-based page `[verified]`); loading → `DataTable loading`; error → `Card`/`AlertCard` with retry; empty → `DataTable` empty state; CSV → `exportCsv(csv.columns, currentRows, csv.filename)` `[verified: exportCsv(columns,rows,filename)]`. All state (search/sort/filter/page) lifted so `fetchPage` is the single data authority (no client-only fabrication).

### 4c. `components/entity/EntityDetailView.jsx`
```
props:
  header: { title, subtitle?, badges?: {label,variant}[], backLabel?, onBack? }
  sections: { label: string, fields: { label, value, render? }[] }[]   // rendered as SectionCard blocks
  actions?: HighRiskAction[]     // renders action buttons that open HighRiskActionModal (see 4d)
  loading?: boolean; error?: string; onRetry?: () => void
```
Renders `Breadcrumbs` + `Card`/`SectionCard` blocks + a footer action row. In 1271 `actions` is exercised only by the placeholder's self-test probe (no real edit).

### 4d. `components/entity/HighRiskActionModal.jsx`
The reusable typed-reason + confirm modal that calls the audited primitive (D2). Built + unit-tested; **NOT wired to any real business mutation in 1271.**
```
props:
  open: boolean; onClose: () => void
  title: string; description: string
  confirmLabel: string                       // e.g. "Suspend brand"
  destructive?: boolean                       // red styling via Modal destructive + Button variant
  requireReason?: boolean                     // default true
  reasonLabel?: string                        // default "Reason (required)"
  confirmPhrase?: string                      // if set, user must type it exactly to enable confirm (extra guard for destructive)
  onConfirm: async ({ reason }) => void       // caller invokes the audited RPC/edge fn here
```
Behavior contract (HARD): built on `Modal`+`ModalBody`+`ModalFooter` `[verified]`; a multiline reason `<textarea>`; **confirm button disabled until** `reason.trim().length > 0` (when `requireReason`) AND, if `confirmPhrase` set, the typed phrase matches exactly; on confirm → submitting state (spinner, inputs disabled) → `await onConfirm({reason})` → success `Toast` + close, or inline error (stay open, reason preserved). Never calls `onConfirm` with an empty/whitespace reason. Client-side reason check is UX only — the server (`admin_write_audit` `reason_required`) is the real gate.

### 4e. Placeholder page `pages/BusinessConsolePage.jsx` (smoke-wire only)
Proves the scaffolding + primitive render end-to-end. Contains:
1. `EntityListView` fed a **static in-memory demo dataset** (~5 fake rows) — proves list/search/sort/pagination/CSV/empty render. Clearly labeled "Scaffolding preview — no live data (wave 2)."
2. Row click → `EntityDetailView` with demo sections.
3. A "Run audited-write self-test" button → `HighRiskActionModal` (`requireReason`) → `onConfirm` calls `adminWriteService.runAuditProbe(reason)` → shows returned `audit_id` + success Toast. This is the ONLY live call; it writes an `admin.audit_probe` audit row and mutates nothing else.

### 4f. Service wrapper `services/adminWriteService.js`
Thin wrappers (mirrors `services/*` pattern `[verified]`), reuses `invokeWithRefresh` for edge calls:
```
runAuditProbe(reason, note?)          -> supabase.rpc('admin_audit_probe', { p_reason: reason, p_note: note })
callAdminWriteRpc(rpcName, params)    -> supabase.rpc(rpcName, params)          // generic; domains reuse
invokeAdminWriteEdge(fnName, body)    -> invokeWithRefresh(fnName, { body })     // generic; domains reuse
```
Each returns `{ data, error }`; callers surface `error` to the modal's inline error slot.

---

## (5) Invariants (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip)

| ID | Rule | Enforcement family | Regression-test shape (fails-on-revert) |
|---|---|---|---|
| `I-PROPOSED-1271-ADMIN-SINGLE-GATE` | No in-scope admin authorization path uses `profiles.account_type='admin'`; `is_admin_user()` is the sole gate. | strict-grep over `supabase/migrations/**` + migration self-assert (§1). | `.github/scripts/strict-grep/i-admin-single-gate.mjs`: assert the two flipped partner policies with `is_admin_user()` are PRESENT in a migration AND that no `CREATE POLICY ... account_type = 'admin'` exists for any in-scope table. Reverting the flip migration removes the present-tokens → script FAILS. |
| `I-PROPOSED-1271-ADMIN-WRITE-AUDITED` | Every `admin_*` SECURITY DEFINER write RPC (a) guards on `is_admin_user()` AND (b) writes `admin_audit_log` (directly or via `admin_write_audit`). | strict-grep + admin-write-RPC registry (grows per domain). | `.github/scripts/strict-grep/i-admin-write-audited.mjs`: assert `admin_write_audit` + `admin_audit_probe` definitions exist in migrations AND every function name listed in the registry's "admin write RPC" set contains an `admin_write_audit(`/`INSERT INTO ... admin_audit_log` reference. Reverting the primitive migration → helper/probe absent → FAILS. |
| `I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT` | In every admin SECURITY DEFINER RPC, `IF NOT is_admin_user() THEN RAISE` is the FIRST executable statement (after `DECLARE`/comments, before any query). | strict-grep AST-lite over migration fn bodies. | `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs`: for each registered `admin_*` definer fn, parse body; the first non-comment statement after `BEGIN` (past the `DECLARE` block) must match `/IF\s+NOT\s+.*is_admin_user\(\)\s+THEN\s+RAISE/i`. A query before the guard → FAILS. Covers `admin_audit_probe` + `admin_write_audit` in 1271. |

**Strict-grep wiring:** three scripts under `.github/scripts/strict-grep/` (existing `i-*.mjs` naming convention `[verified]`), each with a fixture test under `.github/scripts/strict-grep/__tests__/`. Register three job steps in `.github/workflows/strict-grep-mingla-business.yml` (the single strict-grep workflow, already gates `supabase/migrations` `[verified]`). Registry: add an "ORCH-1271 admin write RPC set" list inside `i-admin-write-audited.mjs` (seed = `admin_audit_probe`) that 1272/1273/1274 append their write RPCs to — the append-only registry pattern (`feedback_strict_grep_registry_pattern`).

---

## (6) DECISION_LOG records (append to `Mingla_Artifacts/DECISION_LOG.md`)

**DEC — `brands.kind` is ALIVE in schema; decommission was product-layer only.**
Schema truth `[verified]`: `brands.kind text NOT NULL DEFAULT 'popup'` with `CHECK (kind = ANY (ARRAY['physical','popup','trip_planner']))` (constraint `brands_kind_check`). Memory `feedback_brand_kind_decommissioned` refers to the removed persona-picker / `brand.kind`-immutable product flow, NOT a dropped column. **Ruling:** the wave-2 admin brand editor treats `kind` as a live, editable column (values physical/popup/trip_planner). No migration drops it. Supersedes any reading of the memory as "column removed."

**DEC — Single admin gate = `is_admin_user()`; no super-admin tier.**
`is_admin_user()` (auth.uid → auth.users.email → `admin_users` status='active') is the canonical admin-identity check for all META-1237 in-scope tables `[verified]`. The two `profiles.account_type='admin'` partner-money SELECT policies are retired to it (§1). `admin_users.role` is nullable free-text `[verified]` — no enforced tier; every active admin is fully privileged. Destructive-action safety is delivered by **typed reason + confirm + server-side audit** (D2), not by a super-admin sub-tier. Any future tier is a separate DEC.

---

## Acceptance criteria (testable, per deliverable)

Each is phrased so a fails-on-revert regression test can prove it. **HP** = happy-path (implementor), **ADV** = adversarial (tester); the CLOSE gate requires both.

**AC-1 Single gate (§1)**
- AC-1.1 [HP] After migration, `SELECT count(*) FROM pg_policies WHERE schemaname='public' AND (qual ILIKE '%account_type%''admin''%' OR with_check ILIKE '%account_type%''admin''%')` = **0**.
- AC-1.2 [HP] `partner_stripe_connect_accounts` + `partner_splits` SELECT policies now contain `is_admin_user()`; partner self-access branch preserved (verify qual retains `account_id = auth.uid()` / `partner_account_id = auth.uid()`).
- AC-1.3 [ADV] `i-admin-single-gate.mjs` FAILS when the flip migration is reverted; PASSES restored. Migration self-assert `DO $$` raises on a re-introduced split policy.

**AC-2 Audited-write primitive (§2)**
- AC-2.1 [HP] `admin_audit_log` has columns `actor_uid uuid` + `reason text` (nullable) + index `idx_audit_log_target`; existing client `logAdminAction` insert (no actor_uid/reason) still succeeds.
- AC-2.2 [HP] As an active admin, `SELECT admin_audit_probe('helping brand X')` returns a uuid AND a new `admin_audit_log` row exists with `action='admin.audit_probe'`, `reason='helping brand X'`, `admin_email`=caller, `actor_uid`=caller uid.
- AC-2.3 [ADV] `SELECT admin_audit_probe('')` (blank reason) RAISES `reason_required` and writes NO row. `SELECT admin_audit_probe('   ')` (whitespace) likewise.
- AC-2.4 [ADV] A non-admin authed session calling `admin_audit_probe('x')` RAISES `not_authorized` and writes NO row (proves the guard, since the fn is anon/authenticated-executable by design).
- AC-2.5 [ADV] Edge fn `admin-write-primitive`: anon → 401; non-admin authed → 403; admin + blank reason → 400 (no audit row); admin + reason → 200 `{ok:true, audit_id}` + matching `admin_audit_log` row with `actor_uid`=user.id.
- AC-2.6 [ADV] `i-admin-write-audited.mjs` + `i-admin-gate-first-statement.mjs` FAIL when the primitive migration is reverted (helper/probe absent); PASS restored.

**AC-3 Read-authz convention (§3)** — doc/contract deliverable (no live read added in 1271)
- AC-3.1 [HP] Spec §3 is referenced by name from the 1272/1273/1274 handoff prompts; the decision rule, naming, return-shape, and the "prove against a known draft/private/cross-brand row" acceptance rule are present and unambiguous. (Verified by orchestrator at domain-spec dispatch.)

**AC-4 UI scaffolding (§4)**
- AC-4.1 [HP] `mingla-admin` builds (`npm run build`) with zero new lint/type errors; the "Business" group renders in the sidebar with a non-fallback `Building2` icon; `#/business-console` loads `BusinessConsolePage`.
- AC-4.2 [HP] `EntityListView` on the demo dataset: search filters rows, a sortable column header toggles asc/desc/none, pagination advances, CSV export downloads a file, empty state shows when search matches nothing.
- AC-4.3 [HP] Row click opens `EntityDetailView` with the demo sections + back navigation.
- AC-4.4 [HP] "Run audited-write self-test" → `HighRiskActionModal` opens; confirm is **disabled** with empty reason; typing a reason enables it; confirming calls `runAuditProbe`, shows the returned `audit_id` + success Toast.
- AC-4.5 [ADV] Modal never calls `onConfirm` with empty/whitespace reason (unit test on the disabled-confirm gate); `Escape`/overlay close preserves no partial write; no real business table is written by the placeholder (only `admin.audit_probe` audit rows).
- AC-4.6 [ADV] No domain data is wired (grep `BusinessConsolePage.jsx` for `creator_accounts`/`events`/`orders`/`stripe_connect_accounts` → 0 hits) — proves scope was held.

**AC-5 Invariants + DEC (§5,§6)**
- AC-5.1 [HP] Three `I-PROPOSED-1271-*` invariants added to `Mingla_Artifacts/INVARIANT_REGISTRY.md` as DRAFT; three strict-grep scripts + `__tests__` fixtures present; three job steps registered in `strict-grep-mingla-business.yml`; all three scripts PASS on the built tree.
- AC-5.2 [HP] Two DEC records appended to `DECISION_LOG.md` (brands.kind alive; single-gate).

---

## Implementor task list (ordered)

1. **DB — single gate.** Write `<ts>_orch_1271_single_admin_gate.sql`: DROP+CREATE the two partner SELECT policies with `is_admin_user()`; append the `DO $$` self-assert. (AC-1)
2. **DB — audit extend.** Write `<ts>_orch_1271_audit_log_extend.sql`: ADD `actor_uid`,`reason`; CREATE `idx_audit_log_target`. (AC-2.1)
3. **DB — primitive.** Write `<ts>_orch_1271_admin_write_primitive.sql`: `admin_write_audit(...)` helper + `admin_audit_probe(...)` golden RPC (verbatim §2b/§2c). (AC-2.2–2.4)
4. **Edge — skeleton.** Add `supabase/functions/admin-write-primitive/index.ts` (guarded prover, §2e) + `config.toml` `verify_jwt=true` block. (AC-2.5)
5. **UI kit — entity shells.** Create `components/entity/EntityListView.jsx`, `EntityDetailView.jsx`, `HighRiskActionModal.jsx` (§4b–4d), reusing existing `ui/*`.
6. **UI — service + page.** `services/adminWriteService.js` (§4f); `pages/BusinessConsolePage.jsx` (§4e).
7. **UI — nav wiring.** `lib/constants.js` "Business" group; `Sidebar.jsx` import + `ICON_MAP['Building2']`; `App.jsx` `PAGES` entry. (AC-4.1)
8. **Invariants + gates.** Add 3 `I-PROPOSED-1271-*` to `INVARIANT_REGISTRY.md`; 3 `i-admin-*.mjs` scripts + `__tests__` fixtures; 3 job steps in `strict-grep-mingla-business.yml` (seed the write-RPC registry with `admin_audit_probe`). (AC-5.1)
9. **DEC.** Append 2 records to `DECISION_LOG.md`. (AC-5.2)
10. **Self-verify.** `npm run build` (admin) clean; run the 3 strict-grep scripts locally (PASS) + prove fails-on-revert on each migration/policy; hand deploy (migrations + edge fn) to orchestrator with the AC-2.5 curl matrix.

**Allowlist (implementor may create/modify ONLY these):**
`supabase/migrations/<ts>_orch_1271_single_admin_gate.sql`, `<ts>_orch_1271_audit_log_extend.sql`, `<ts>_orch_1271_admin_write_primitive.sql` · `supabase/functions/admin-write-primitive/index.ts` · `supabase/config.toml` (append one function block) · `mingla-admin/src/components/entity/{EntityListView,EntityDetailView,HighRiskActionModal}.jsx` · `mingla-admin/src/services/adminWriteService.js` · `mingla-admin/src/pages/BusinessConsolePage.jsx` · `mingla-admin/src/lib/constants.js` · `mingla-admin/src/components/layout/Sidebar.jsx` · `mingla-admin/src/App.jsx` · `.github/scripts/strict-grep/i-admin-single-gate.mjs`, `i-admin-write-audited.mjs`, `i-admin-gate-first-statement.mjs` (+ `__tests__/` fixtures) · `.github/workflows/strict-grep-mingla-business.yml` · `Mingla_Artifacts/INVARIANT_REGISTRY.md` · `Mingla_Artifacts/DECISION_LOG.md`.

**DO-NOT-TOUCH (stop-and-amend before touching):** `is_admin_user()` definition · `admin_set_city_live` · `supabase/functions/delete-user/**` · any existing `admin_*` RPC · any business table RLS beyond the two partner policies (no admin policy on `events`/`orders`/`creator_accounts`/`venue_listings`/`stripe_connect_accounts` — that's 1272/1273/1274) · `lib/auditLog.js` (existing client logger stays) · any shipping-app (`app-mobile/`, `mingla-business/`) code.

---

## Open questions

- **Q1 (non-blocking).** `metadata` carries before/after as `{before,after}` keys rather than dedicated columns — chosen for backward-compat with existing `logAdminAction` writers and zero NOT-NULL churn. Confirm acceptable vs adding explicit `before jsonb`/`after jsonb` columns. Default: keep in `metadata`.
- **Q2 (non-blocking).** Deploy the `admin-write-primitive` edge fn as a live guarded no-op now (unit-proves the seam per D1) vs ship the skeleton file uncalled until wave 2. Default: deploy the guarded prover (matches "built and unit-proven").
- **Q3 (non-blocking, routed).** `is_admin_user()` lacks `SET search_path` while newer admin fns have it `[verified]`. Hardening it is out-of-blast-radius for 1271 (used platform-wide) — recommend a separate hardening ORCH. New 1271 functions already set `search_path public`.
- **No BLOCKING open questions.** All schema/policy/function facts verified against live PROD; the primitive, gate, convention, and scaffolding are fully specified.

---

## Downstream routing

Next = **mingla-implementor** (build per task list, in the per-ORCH worktree). Then **mingla-tester** (AC matrix, esp. ADV rows + fails-on-revert on all 3 gates + the AC-2.5 curl matrix). Then **orchestrator CLOSE** (flip 3 invariants DRAFT→ACTIVE, deploy migrations + edge fn, merge one PR, update WORLD_MAP). 1272/1273/1274 unblock only after 1271 ships (they consume `admin_write_audit`, the §2d template, the §3 convention, and the §4 shells).
