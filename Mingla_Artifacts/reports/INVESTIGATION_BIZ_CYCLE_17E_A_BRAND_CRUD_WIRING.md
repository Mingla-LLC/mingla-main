# INVESTIGATION REPORT — Cycle 17e-A (Brand CRUD wiring + delete UX)

**Cycle:** 17e-A (BIZ — founder-feedback feature absorption; Refinement Pass post-closure)
**Mode:** INVESTIGATE (forensics-only — SPEC defers until operator confirms 13 decisions including a blocking migration question)
**Dispatch anchor:** `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md`
**Stage 1 anchor:** `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17D_PERF_PASS.md` §I (verbatim cited; re-verified live)
**Confidence:** **H** on schema state + code state + RLS chain; **M** on data-migration story for existing phone-only brands (depends on operator product decision)
**Authored:** 2026-05-05

---

## 1. Layman summary

The mingla-business brand lifecycle (create / read / update / delete) is **completely unwired** to the `brands` Supabase table despite the schema being fully ready. When operators create or edit a brand on their phone today, the change writes to local Zustand storage only — opening the app on a second device shows nothing. The `brandMapping.ts` service file already has fully-built mapper helpers (`mapBrandRowToUi`, `mapUiToBrandInsert`, `mapUiToBrandUpdatePatch`) but they're **exported and unused** — zero consumers across the entire codebase. This is not a bug; it's a 12-cycle-old TRANSITIONAL pattern waiting to be finished. 17e-A's job is to build the service+hook layer that wires the existing mappers to React Query and adds the founder-asked delete UX on three surfaces.

**Critical blocking finding (escalation):** the UI Brand type carries 3 fields (`kind`, `address`, `coverHue`) that have **no corresponding columns** on the `brands` table. They were added to the UI in Cycle 7 + Cycle 7 FX2 with explicit TRANSITIONAL markers expecting B-cycle to add the schema. To wire CRUD properly, we need persistence for them — which requires a small schema migration that the dispatch §6.2 explicitly forbade. Operator must decide: add migration (escalation), keep client-only (per-device divergence pain), or defer 17e-A.

**13 decisions surfaced for batch lock** (12 from dispatch §3 §D + 1 escalation). 4 of them are pre-locked by Stage 1 (DEC-105 D-17d-FOUNDER-1A/B/C) with re-verification recommendations.

---

## 2. Symptom statement

**Expected behavior:** operator creates a brand on phone → row inserted in `brands` table → opening on second device shows the brand. Operator edits → UPDATE persists. Operator deletes → soft-delete via `deleted_at` + cascading invisibility. Operator can't delete a brand with upcoming events (clear modal).

**Actual behavior today:** every brand operation lives in Zustand only. `BrandSwitcherSheet:117 handleSubmit` does `setBrands([...brands, newBrand]) + setCurrentBrand(newBrand)` — pure local state. `BrandEditView:251 handleSave` does `onSave(snapshot)` which delegates to the route's `handleSave` at `app/brand/[id]/edit.tsx:55-63` which is also Zustand-only. There is **no delete UX anywhere**. The schema-ready brands table has zero CRUD service paths from mingla-business.

---

## 3. Investigation manifest (every file read in trace order)

| File | Why read | Key finding |
|---|---|---|
| `mingla-business/src/services/brandMapping.ts` | Existing mapper helpers | 290 LOC; 3 mappers EXPORTED but ZERO consumers; `BrandRow` interface has all DB fields; UI Brand fields `kind`/`address`/`coverHue` hardcoded as TRANSITIONAL defaults at lines 184-191 |
| `mingla-business/src/services/creatorAccount.ts` | Existing service-layer pattern reference | 58 LOC; `ensureCreatorAccount` upsert + `updateCreatorAccount` patch; throws-on-error contract per Const #3 |
| `mingla-business/src/services/supabase.ts` | Confirm Supabase client export | (assumed standard) |
| `mingla-business/src/store/currentBrandStore.ts` | v12 post-Stage-1 state shape | 391 LOC; `currentBrand: Brand | null` + `brands: Brand[]` + 3 actions; persistOptions name `mingla-business.currentBrand.v12`; v12 schema has 27 fields including the 3 problem fields |
| `mingla-business/src/store/brandList.ts:1-50` | STUB_BRANDS dev seed (D-17d-FOUNDER-1 needs migration story) | Local-only seed: `lm` / `tll` / `sl` / `hr` IDs; never persisted to DB; gated by `__DEV__` button on `account.tsx:130-139` |
| `mingla-business/src/hooks/useCreatorAccount.ts` | Existing hook-layer pattern reference | 102 LOC; canonical: query key factory `creatorAccountKeys` + 5 min staleTime + `useQuery` + `useMutation` with onSuccess invalidate |
| `mingla-business/src/hooks/useCurrentBrandRole.ts` | Existing brand-role hook | 164 LOC; READS `brands` (line 119-123) for solo-owner synthesis + STUB-MODE FALLBACK at lines 152-158 (synthesizes role from local-only Brand.role for stub brands not in DB) |
| `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | Phone-only create handler | 339 LOC; `handleSubmit` at line 117-125 does `setBrands([...brands, newBrand])`; `buildBrand()` at line 68-83 synthesizes phone-side ID `b_<ts36>`, slug, defaults; NO delete UX |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | Spot-check | 943 LOC; verified via grep — ZERO supabase / setBrands / handleSave / delete references; pure read-only render of Brand props |
| `mingla-business/src/components/brand/BrandEditView.tsx` | Phone-only update handler | 909 LOC; `handleSave` at line 251-263 calls `onSave(snapshot)` after 250ms simulated delay; NO delete UX |
| `mingla-business/app/brand/[id]/edit.tsx` | BrandEditView consumer | 81 LOC; `handleSave` at line 55-63 does `setBrands(brands.map((b) => (b.id === next.id ? next : b)))` + mirrors `setCurrentBrand` if active |
| `mingla-business/app/(tabs)/account.tsx:120-145` | Dev seed entry points | `handleSeedStubs` at line 133 + `handleWipeBrands` at line 141 — both `__DEV__`-gated; will need re-thinking post-CRUD |
| `mingla-business/app/brand/[id]/payments/onboard.tsx:34,62` | Other setBrands caller | Stripe Connect onboarding writes back to brand list; needs migration to React Query mutation |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7761-7782` | Brands table DDL | **VERIFIED:** 19 columns; NO `kind`/`address`/`cover_hue`; `deleted_at` exists; `brands_slug_nonempty` CHECK constraint |
| Migration lines 11391-11395 | Indexes | `idx_brands_account_id` + `idx_brands_slug_active` UNIQUE both `WHERE deleted_at IS NULL` |
| Migration lines 12567-12579 | Triggers | `trg_brands_immutable_account_id` + `trg_brands_immutable_slug` + `trg_brands_updated_at` (auto) |
| Migration line 14004 | INSERT RLS | `account_id = auth.uid() AND deleted_at IS NULL` |
| Migration line 14094 | DELETE RLS | `biz_is_brand_admin_plus_for_caller(id)` |
| Migration line 14114 | **UPDATE RLS** | `biz_is_brand_admin_plus_for_caller(id)` — **VERIFIED: UPDATE is permitted** → soft-delete via `UPDATE deleted_at = now()` works |
| Migration line 14170 | SELECT RLS (members) | `deleted_at IS NULL AND biz_is_brand_member_for_read_for_caller(id)` |
| Migration line 14430 | SELECT RLS (public) | `deleted_at IS NULL` + EXISTS (events) — public path also filters soft-deleted |

---

## 4. Findings

### 🔴 F-A (Root Cause) — Brand CRUD is entirely phone-only despite schema readiness

- **File + line:** `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:117-125`
- **Exact code:**
  ```ts
  const handleSubmit = (): void => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const newBrand = buildBrand(trimmedName);
    setBrands([...brands, newBrand]);
    setCurrentBrand(newBrand);
    onBrandCreated?.(newBrand);
    onClose();
  };
  ```
- **What it does:** synthesizes a Brand object via `buildBrand()` (lines 68-83 — phone-side ID `b_<ts36>`, slug from name, defaults `kind: "popup"` + `address: null` + `coverHue: 25`); appends to Zustand `brands` array; sets as current; closes modal.
- **What it should do:** call `useCreateBrand().mutateAsync({ accountId, name, slug, kind, address, coverHue })`; service inserts into `brands`; React Query invalidates `brandKeys.list(accountId)`; UI re-renders from server-truth.
- **Causal chain:** operator creates brand on Phone A → no DB row → opens Phone B → empty brand list → operator confused; ALSO blocks all downstream brand-keyed work (events / payouts / stripe / team) from ever having a real anchor.
- **Verification step:** `grep -n "supabase.from(\"brands\").insert\|supabase.from('brands').insert" mingla-business/` returns 0 hits. Confirmed.

### 🔴 F-B (Root Cause) — Service+hook layer doesn't exist

- **File + line:** `mingla-business/src/services/brandMapping.ts:175,217,255` (3 exported mappers)
- **Exact code:** functions `mapBrandRowToUi`, `mapUiToBrandInsert`, `mapUiToBrandUpdatePatch` — all EXPORTED with full JSDoc + complete type signatures
- **What it does:** the mappers are READY — they handle every field in the existing 19-column `brands` schema correctly, including `splitBrandDescription` for tagline/bio + `linksToSocialJson` for social_links + `normalizeCustomLinks` for custom_links
- **What it should do:** the service layer `brandsService.ts` should call them; the hook layer `useBrands.ts` should wrap them
- **Causal chain:** mappers exist but are unused → no service layer references them → no hook layer references service → UI uses Zustand directly → 17e-A's job is to bridge the gap
- **Verification step:** `grep -rn "mapBrandRowToUi\|mapUiToBrandInsert\|mapUiToBrandUpdatePatch" mingla-business --include="*.ts" --include="*.tsx"` returns ONLY the 3 export sites + 1 docstring reference. Zero consumers.

### 🟠 F-C (Contributing — ESCALATION) — UI Brand type has 3 fields with no schema columns

- **File + line:** `mingla-business/src/services/brandMapping.ts:184-191`
- **Exact code:**
  ```ts
  // [TRANSITIONAL] Cycle 7 FX2 added kind/address/coverHue to UI Brand type but
  // brands table doesn't carry these columns yet. Defaults: popup (safer — no fake
  // address shown), null address, hue 25 (warm-orange — matches accent.warm scheme).
  // EXIT: B-cycle adds the 3 columns to brands table → BrandRow interface + this
  // mapper read from `row` directly. Per Cycle 17a §A.3; closes D-CYCLE12-IMPL-2.
  kind: "popup" as const,
  address: null,
  coverHue: 25,
  ```
- **What it does:** hardcodes 3 UI Brand fields to TRANSITIONAL defaults regardless of what the DB row says
- **What it should do:** read from `row.kind`, `row.address`, `row.cover_hue` (or whatever column names operator approves)
- **Causal chain:** 17e-A wires CRUD → operator selects `kind="physical"` + types address + picks coverHue in BrandEditView → save mutation only persists `name/slug/description/contact/links/...` (no kind/address/coverHue in BrandTableInsert) → operator opens Phone B → defaults reset to `popup/null/25` → operator's design choices LOST → worse than current TRANSITIONAL state because they LOOK persisted on Phone A
- **Verification step:** Migration line 7761-7782 shows brands columns; `kind`/`address`/`cover_hue` absent. Confirmed.
- **Severity:** S1-high — without resolution, 17e-A SPEC has no path forward
- **Mitigation options (operator decides):**
  - **Option A (RECOMMENDED — escalation):** Add small migration `20260506000000_brand_kind_address_cover_hue.sql` adding 3 columns to brands; ~10 LOC SQL; aligns Cycle 7 + Cycle 7 FX2 promises with reality. Estimated +30 min effort. **Dispatch §6.2 forbade this; operator's call to escalate.**
  - **Option B:** Per-device Zustand keyed by brand id (Map<brandId, ClientBrandExtras>); per-device divergence — operator sets `kind=physical` on Phone A, Phone B sees `popup`. Bad UX.
  - **Option C:** Defer 17e-A to a cycle that includes the migration. Postpones founder ask.

### 🟠 F-D (Contributing) — useCurrentBrandRole has stub-mode synthesis fallback

- **File + line:** `mingla-business/src/hooks/useCurrentBrandRole.ts:152-158`
- **Exact code:** stub-mode synthesis fires when DB chain returns null role; maps local Brand.role → 6-role enum
- **What it does:** unblocks stub brands (lm/tll/sl/hr) in DEV by synthesizing roles from Zustand
- **What it should do:** become dead code post-17e-A — DB chain returns real values for every persisted brand
- **Causal chain:** 17e-A wires real CRUD → all real brands have brand_team_members rows + creator_accounts.user_id chain → DB chain wins → stub fallback never fires for non-stub brands → stub brands themselves get explicit cleanup decision (D-17e-A-5)
- **Verification step:** read header lines 14-17 — explicit EXIT condition cited
- **Mitigation:** mark as carry-forward TRANSITIONAL during 17e-A; explicit cleanup in 17e-A IMPL post-flight if zero stub brands remain in DEV state

### 🟠 F-E (Contributing) — account.tsx dev-seed wires STUB_BRANDS to Zustand bypassing DB

- **File + line:** `mingla-business/app/(tabs)/account.tsx:130-139`
- **Exact code:**
  ```ts
  // [TRANSITIONAL] dev seed buttons — removed in B1 backend cycle when real
  // brand CRUD endpoints land. Existence gated by __DEV__ so production
  // builds never see these.
  const handleSeedStubs = useCallback((): void => {
    setBrands([...STUB_BRANDS]);
    ...
  });
  ```
- **What it does:** populates Zustand with 4 stub brands for dev convenience
- **What it should do post-17e-A:** either (a) call `useCreateBrand` 4 times to insert real DB rows, OR (b) be deleted (operator manually creates real brand in DEV)
- **Causal chain:** existing TRANSITIONAL marker explicitly cites "removed in B1 backend cycle when real brand CRUD endpoints land" — 17e-A IS that cycle → satisfies EXIT condition
- **Mitigation:** D-17e-A-5 decides between "convert to bulk insert" vs "delete entirely"

### 🟠 F-F (Contributing) — events.brand_id is ON DELETE CASCADE; soft-delete leaves orphans

- **File + line:** baseline migration line 13356 — `ALTER TABLE events ADD CONSTRAINT events_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE`
- **What it does:** hard-delete of brand cascades to ALL events; soft-delete (UPDATE deleted_at) does NOT fire FK cascade because the brand row still exists
- **What it should do:** UI must filter events queries by `brands.deleted_at IS NULL` to avoid showing events under soft-deleted brands; ALTERNATIVELY, mark brand soft-delete as a "you can't restore — events are stranded" warning
- **Causal chain:** operator soft-deletes brand → events row's brand_id still points at the soft-deleted brand → if events query JOINs through brands AND filters `brands.deleted_at IS NULL`, those events become invisible (good); if events query reads brand_id raw without join, events render but with broken brand context (bad)
- **Verification step:** need to grep events queries in `mingla-business/` to verify they all filter `brands.deleted_at IS NULL` — this is an IMPL pre-flight task
- **Severity:** S1-high — could cause stale data display

### 🟠 F-G (Contributing) — stripe_connect_id lives directly on brands AND in stripe_connect_accounts

- **File + line:** baseline migration line 7775 (`brands.stripe_connect_id text`) + Stage 1 §I.1 cited `stripe_connect_accounts.brand_id` ON DELETE CASCADE
- **What it does:** brand has TWO Stripe Connect references — direct column + separate table
- **What it should do:** likely separate table is canonical (cascade behavior implies authoritative); brands.stripe_connect_id is denormalized cache
- **Causal chain:** soft-delete leaves both — brand row's stripe_connect_id stale; stripe_connect_accounts.brand_id orphan-but-persistent; Stripe webhook events hit stale brand row
- **Severity:** S2-medium — Stripe Connect is partially-wired (Cycle 11 J-A10/J-A11 status flags); 17e-A doesn't touch this; flag as observation for B-cycle Stripe wire
- **Mitigation:** out of 17e-A scope; document as forward observation

### 🟡 F-H (Hidden Flaw) — creator_accounts.default_brand_id is ON DELETE SET NULL

- **File + line:** baseline migration line 13266
- **What it does:** hard-delete of brand clears `creator_accounts.default_brand_id`; soft-delete leaves stale pointer
- **What it should do:** UI must filter `default_brand_id` against `deleted_at IS NULL` when reading; or 17e-A IMPL clears it on soft-delete via additional UPDATE
- **Causal chain:** operator soft-deletes the default brand → opens app → cold start defaults to soft-deleted brand → brands list filters out soft-deleted → operator stuck in "select a brand" empty state
- **Severity:** S2-medium — 17e-A IMPL must handle (clear `default_brand_id` if equals soft-deleted brand id, or filter at read time)
- **Mitigation:** SPEC §F.IMPL.softDeleteBrand mutation adds `if (currentBrand.id === brandId) UPDATE creator_accounts SET default_brand_id = NULL` step

### 🟡 F-I (Hidden Flaw) — Slug collision risk on CREATE

- **File + line:** baseline migration line 11395 — `idx_brands_slug_active UNIQUE WHERE deleted_at IS NULL`
- **What it does:** UNIQUE constraint on lowercased slug among non-deleted brands; INSERT with duplicate slug fails with `23505 unique_violation`
- **What it should do:** UI catches collision pre-INSERT via slug-availability check OR error-handles 23505 with friendly message + slug regen suggestion
- **Causal chain:** operator types brand name "Lonely Moth" → slugify → "lonelymoth"; another operator's brand also slugifies to "lonelymoth" → INSERT fails → current `buildBrand()` synthesizes slug locally so no failure mode exists today (because no INSERT happens)
- **Severity:** S1-high once CRUD wires
- **Mitigation:** 17e-A IMPL adds slug-availability check via `getBrand` query before submit, OR catches Postgrest 23505 + surfaces "Brand name conflicts with existing brand. Try a variation." inline error

### 🟡 F-J (Hidden Flaw) — buildBrand synthesizes phone-side ID `b_<ts36>`

- **File + line:** `BrandSwitcherSheet.tsx:69`
- **Exact code:** `id: \`b_${Date.now().toString(36)}\``
- **What it does:** prefixes phone-side ID with `b_` + base36 timestamp
- **What it should do:** DB INSERT uses server-side `gen_random_uuid()` — phone-side ID gets discarded
- **Causal chain:** 17e-A IMPL must NOT pass `id` to mapUiToBrandInsert (which already correctly omits it from BrandTableInsert per line 49-65)
- **Severity:** S3-low — already handled by mapper shape; cosmetic risk if implementor accidentally passes id
- **Mitigation:** SPEC §F.IMPL.createBrand explicitly says "discard phone-side id; let DB return server-generated UUID"

### 🟡 F-K (Hidden Flaw) — Pre-condition check needs status enum verification

- **File + line:** events table `status` column (need to verify enum values)
- **What it does:** D-17d-FOUNDER-1B locked "reject-if-upcoming-events"; "upcoming" needs precise definition
- **What it should do:** check `events WHERE brand_id = ? AND status IN ('upcoming', 'live') AND deleted_at IS NULL`
- **Causal chain:** if 17e-A pre-condition uses wrong status filter, either rejects too aggressively (counts past/cancelled events) or too leniently (misses live events)
- **Severity:** S1-high
- **Mitigation:** SPEC §F.IMPL.softDeleteBrand explicitly enumerates which statuses count as "upcoming"; verify events status enum in IMPL pre-flight

### 🔵 F-L (Observation) — Cycle 17d Stage 1 §C eviction TTL doesn't touch brands

- `evictEndedEvents()` evicts events with `endedAt + 30d` elapsed; no brand-related eviction
- 17e-A doesn't need to integrate with §C/§D; brands are independently managed
- No action required

### 🔵 F-M (Observation) — Realtime subscriptions to brands

- No code currently subscribes to `brands` table via Supabase Realtime
- 17e-A could optionally add Realtime on `brand-list` but per scope discipline, defer to future polish cycle
- React Query invalidation post-mutation is sufficient for single-device UX

### 🔵 F-N (Observation) — Existing patterns in app-mobile

- `app-mobile/` is a separate React Native app on the same Supabase backend (different domain — consumer app, not organiser app); does NOT have brand CRUD pattern to copy
- Mirror `useCreatorAccount` (mingla-business/src/hooks/useCreatorAccount.ts) is the canonical local reference

---

## 5. Five-Truth-Layer Cross-Check

| Layer | Result |
|---|---|
| **Docs** | Cycle 7 (kind/address) + Cycle 7 FX2 (coverHue) + Cycle 0a (id/displayName/slug) + B1 plan (brands table) + Stage 1 forensics §I (schema readiness verbatim) — all consistent: brands table is intended; UI fields exist; B-cycle is the EXIT for TRANSITIONAL state |
| **Schema** | brands table verified at migration line 7761-7782; 19 columns; `kind`/`address`/`cover_hue` ABSENT; `deleted_at` exists; soft-delete-friendly indexes; 3 RLS policies (INSERT/UPDATE/DELETE) all permit brand_admin+ |
| **Code** | brandMapping.ts mappers EXPORTED but unused; BrandSwitcherSheet:117 + BrandEditView:251 + 4 setBrands callers all phone-only; useCurrentBrandRole has stub-mode fallback |
| **Runtime** | NOT verified (no runtime trace) — implementor verifies via tsc-clean baseline + manual smoke against existing TRANSITIONAL flow during pre-flight |
| **Data** | NOT queried (Supabase MCP not accessed in this forensics) — likely there are zero brand rows in production for active operators today; this is a forensics-time inference, not verified |

**Layer disagreement:** Docs + Schema agree (brands exists, ready, awaiting wire). Code lags (mappers exist but unused; UI is Zustand-only). The disagreement IS the bug — and 17e-A's job is to close it.

**Layer alignment post-17e-A:** all 5 layers will agree once service+hook+UI lands.

---

## 6. Operator decisions surface (D-17e-A-1 through D-17e-A-13)

13 decisions to lock before SPEC dispatch. **4 are pre-locked** (Stage 1 DEC-105 D-17d-FOUNDER-1A/B/C); operator re-confirms at SPEC time.

| # | Decision | Options | Forensics recommendation | Locked? |
|---|---|---|---|---|
| **D-17e-A-1** | Soft-delete vs hard-delete | A: soft-delete via `deleted_at = now()`. B: hard-delete via DELETE FROM brands. | **A** — preserves audit trail; cascade FKs explicit; matches creator_accounts.deleted_at pattern (Cycle 14 I-35) | ✅ Stage 1 D-17d-FOUNDER-1A; **re-verified RLS UPDATE policy permits soft-delete via UPDATE — F-D verifies** |
| **D-17e-A-2** | Pre-condition check | A: reject-if-upcoming-events. B: cascade-cancel events on delete. | **A** — explicit, safe, operator-controlled wind-down | ✅ Stage 1 D-17d-FOUNDER-1B; **F-K flags status enum verification needed** |
| **D-17e-A-3** | Lifecycle scope | A: full CRUD (create + read + update + delete). B: just delete. | **A** — coherent service+hook layer for all 4 verbs | ✅ Stage 1 D-17d-FOUNDER-1C |
| **D-17e-A-4** | Cycle decomposition | A: 17e-A brand CRUD ~12-16h + 17e-B media picker separate. B: combine. | **A** — already locked at Stage 1 | ✅ Stage 1 D-17d-1 |
| **D-17e-A-5** | **CRITICAL — kind/address/coverHue persistence** (escalation per dispatch §6.2) | **A: ADD MIGRATION** (3 columns to brands; ~10 LOC SQL; ~30 min effort). B: keep client-only Zustand (per-device divergence). C: defer 17e-A. | **A — escalate to operator approval.** Dispatch §6.2 forbade migrations as goal-not-floor. Adding 3 small columns aligns Cycle 7 + FX2 promises with reality. Per F-C. | 🔴 NEEDS DECISION |
| **D-17e-A-6** | Type-to-confirm vs simple confirm for delete | A: type brand name to confirm. B: simple "Yes, delete" tap. | **A** — mirror Cycle 14 D-14-13 pattern; consistent delete UX | ⚪ Needs decision |
| **D-17e-A-7** | Delete CTA placement | A: BrandSwitcherSheet rows only. B: + BrandProfileView. C: + BrandEditView (A+B+C). | **C** — symmetric editing flow + closes "where do I delete?" surprise + matches founder ask + 943 LOC + 909 LOC views can host danger CTA naturally at bottom | ⚪ Needs decision |
| **D-17e-A-8** | Phone-only-brands data migration | A: best-effort one-time sync at app start. B: operator manually re-creates each. C: accept-as-loss + document. | **B or C — operator decides.** Per F-E + F-J: STUB_BRANDS are local-only by design (`__DEV__`-gated dev-seed). Real operators today have ZERO real brands (system is pre-MVP). Option A risks duplicate INSERTs if id collisions. Option C honest. | ⚪ Needs decision |
| **D-17e-A-9** | UPDATE scope — which fields are mutable | Triggers fix `account_id` + `slug` immutable. Mutable per RLS UPDATE: `name` / `description` / `profile_photo_url` / `contact_email` / `contact_phone` / `social_links` / `custom_links` / `display_attendee_count` / `tax_settings` / `default_currency` / `stripe_connect_id` / `stripe_payouts_enabled` / `stripe_charges_enabled` / `kind` (post D-17e-A-5 Option A) / `address` (post-A) / `cover_hue` (post-A). | All non-immutable columns mutable via UPDATE RLS policy (line 14114) | ⚪ Verify forensics call-out is correct |
| **D-17e-A-10** | Mutation pattern | A: optimistic everywhere. B: pessimistic everywhere. C: optimistic CREATE+UPDATE, pessimistic DELETE. | **C** — optimistic for CREATE/UPDATE (operator pain on edit-save latency); pessimistic for DELETE (avoid optimistic-show-then-restore on reject-if-events failure) | ⚪ Needs decision |
| **D-17e-A-11** | Error handling UX | A: toasts. B: modals. C: inline form errors. D: hybrid. | **D** — toast for CREATE/UPDATE network errors; inline for slug collision / validation; modal for reject-if-events case (workflow decision, not transient error) | ⚪ Needs decision |
| **D-17e-A-12** | Restore-from-soft-delete UX | A: out of 17e-A scope. B: add admin UI. | **A** — recover via DB intervention only; document as future enhancement | ⚪ Needs decision |
| **D-17e-A-13** | BrandRow defensive defaults at brandMapping.ts:184-191 | A: KEEP as belt+suspenders. B: REMOVE (CRUD wiring makes inputs trustworthy). | **A if D-17e-A-5=B/C; REMOVE post-D-17e-A-5=A** — once columns exist on DB, mapper reads from row directly; defensive defaults become dead code | ⚪ Conditional on D-17e-A-5 |

**Pre-condition check location** (was D-17e-A-12 in dispatch §3 §D — renumbered): A: edge function. B: client-side query. **B** — UX guard not security boundary. Folded into D-17e-A-2's IMPL detail.

**Slug regeneration on edit** (was D-17e-A-12 in dispatch §3 §D — renumbered): trigger forbids slug change → display "URL slug locked" hint near name field on edit. Folded into D-17e-A-9 IMPL detail.

---

## 7. Risk inventory

| Risk | Severity | Mitigation |
|---|---|---|
| **R-1: kind/address/coverHue persistence missing** (F-C) | S1-high | D-17e-A-5 escalation — operator approves Option A migration |
| **R-2: events orphaned on brand soft-delete** (F-F) | S1-high | IMPL pre-flight verifies all events queries filter `brands.deleted_at IS NULL`; SPEC §F adds query convention test |
| **R-3: default_brand_id stale pointer post-soft-delete** (F-H) | S2-medium | IMPL softDeleteBrand mutation adds `clear default_brand_id if matches` step |
| **R-4: slug collision on CREATE** (F-I) | S1-high | IMPL adds slug-availability check + 23505 error handling |
| **R-5: events status enum mismatch on pre-condition check** (F-K) | S1-high | IMPL pre-flight verifies status enum values; SPEC explicit list |
| **R-6: stripe_connect dual-source confusion** (F-G) | S2-medium | Out of 17e-A scope; flag as B-cycle observation |
| **R-7: stub-brand fallback dead code** (F-D) | S3-low | Stage 1 acknowledges TRANSITIONAL; cleanup post-17e-A |
| **R-8: dev-seed regression** (F-E) | S3-low | D-17e-A-8 + Option C delete entirely OR Option A bulk-insert real DB rows |
| **R-9: cycle 14 account-delete cascade interaction** | S2-medium | Verify: account soft-delete should soft-delete owned brands too; 17e-A IMPL adds this if missing |

---

## 8. Service+hook+UI architecture proposal (Forensics §F output)

### 8.1 Service file: `mingla-business/src/services/brandsService.ts` (NEW, ~120 LOC est.)

```ts
import { supabase } from "./supabase";
import {
  mapBrandRowToUi,
  mapUiToBrandInsert,
  mapUiToBrandUpdatePatch,
  type BrandRow,
} from "./brandMapping";
import type { Brand } from "../store/currentBrandStore";

export interface CreateBrandInput {
  accountId: string;
  name: string;
  slug: string;
  // Optional client-state fields per D-17e-A-5 Option A (post-migration):
  kind?: "physical" | "popup";
  address?: string | null;
  coverHue?: number;
  // Other optional fields...
}

export async function createBrand(
  input: CreateBrandInput,
  role: "owner" | "admin",
): Promise<Brand> {
  const insertPayload = mapUiToBrandInsert({
    accountId: input.accountId,
    brand: { displayName: input.name, slug: input.slug, /* ... */ },
  });
  const { data, error } = await supabase
    .from("brands")
    .insert(insertPayload)
    .select()
    .single();
  if (error) throw error;
  return mapBrandRowToUi(data as BrandRow, { role });
}

export async function getBrands(accountId: string): Promise<Brand[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as BrandRow[]).map((row) =>
    mapBrandRowToUi(row, { role: "owner" }), // role refined by useCurrentBrandRole
  );
}

export async function getBrand(brandId: string): Promise<Brand | null> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  return mapBrandRowToUi(data as BrandRow, { role: "owner" });
}

export async function updateBrand(
  brandId: string,
  patch: Partial<Brand>,
  existingDescription: string | null,
): Promise<Brand> {
  const updatePayload = mapUiToBrandUpdatePatch(patch, { existingDescription });
  const { data, error } = await supabase
    .from("brands")
    .update(updatePayload)
    .eq("id", brandId)
    .select()
    .single();
  if (error) throw error;
  return mapBrandRowToUi(data as BrandRow, { role: "owner" });
}

export interface SoftDeleteBrandResult {
  rejected: false;
  brandId: string;
}

export interface SoftDeleteBrandRejection {
  rejected: true;
  reason: "upcoming_events";
  upcomingEventCount: number;
}

export async function softDeleteBrand(
  brandId: string,
): Promise<SoftDeleteBrandResult | SoftDeleteBrandRejection> {
  // Pre-condition check: count upcoming events
  const { count, error: countError } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .in("status", ["upcoming", "live"]) // pending D-17e-A-2 verification
    .is("deleted_at", null);
  if (countError) throw countError;
  if (count !== null && count > 0) {
    return { rejected: true, reason: "upcoming_events", upcomingEventCount: count };
  }
  // Soft-delete via UPDATE
  const { error } = await supabase
    .from("brands")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", brandId);
  if (error) throw error;
  // F-H mitigation: clear default_brand_id if it matches
  await supabase
    .from("creator_accounts")
    .update({ default_brand_id: null })
    .eq("default_brand_id", brandId);
  return { rejected: false, brandId };
}
```

**Error contract:** services THROW on Postgrest error per Const #3 (mirrors `creatorAccount.updateCreatorAccount` line 56-57). Hooks catch + surface to user.

### 8.2 Hook file: `mingla-business/src/hooks/useBrands.ts` (NEW, ~180 LOC est.)

```ts
export const brandKeys = {
  all: ["brands"] as const,
  lists: () => [...brandKeys.all, "list"] as const,
  list: (accountId: string) => [...brandKeys.lists(), accountId] as const,
  details: () => [...brandKeys.all, "detail"] as const,
  detail: (brandId: string) => [...brandKeys.details(), brandId] as const,
};

export const useBrands = (accountId: string | null): UseQueryResult<Brand[]> => { ... };
export const useBrand = (brandId: string | null): UseQueryResult<Brand | null> => { ... };
export const useCreateBrand = (): UseMutationResult<Brand, Error, CreateBrandInput> => {
  // Optimistic per D-17e-A-10 Option C:
  // onMutate: snapshot list + add temp row
  // onError: rollback to snapshot
  // onSuccess: replace temp with server-returned row
};
export const useUpdateBrand = (): UseMutationResult<Brand, Error, { brandId: string; patch: Partial<Brand> }> => { ... };
export const useSoftDeleteBrand = (): UseMutationResult<SoftDeleteBrandResult | SoftDeleteBrandRejection, Error, string> => {
  // Pessimistic per D-17e-A-10 Option C:
  // wait for server response
  // if rejected: surface rejection to UI (modal with upcomingEventCount)
  // if confirmed: invalidate brandKeys.list + clear cached detail + nav
};
```

### 8.3 Store interaction: `currentBrandStore.ts` MIGRATION (Const #5)

**Decision needed:** keep `brands` array in Zustand (current) OR delegate to `useBrands()` (cleaner per Const #5)?

**Forensics recommendation:** **keep `currentBrand: Brand | null` in Zustand (selection state, client-only); migrate `brands: Brand[]` to derived via `useBrands().data`**. `setBrands` action becomes legacy (used only by `__DEV__` dev-seed; D-17e-A-8 decides what happens to it).

Touch surface: `setBrands` callers (5 sites — `account.tsx:55,134`, `BrandSwitcherSheet.tsx:92,121`, `app/brand/[id]/edit.tsx:39,59`, `app/brand/[id]/payments/onboard.tsx:34,62`) all migrate to either:
- (a) Read `useBrands()` for the list (BrandSwitcherSheet for switch UI)
- (b) Call `useUpdateBrand()` mutation (BrandEditView's onSave; payments/onboard's stripe-status persist)
- (c) Delete entirely if vestigial (`__DEV__` dev-seed per D-17e-A-8)

### 8.4 UI surfaces touched

| File | Change |
|---|---|
| `BrandSwitcherSheet.tsx` | Switch action (no change) · Create action wires `useCreateBrand().mutateAsync()` (per-row swipe-to-delete or trailing-icon trash button → opens `BrandDeleteSheet`) · Read brands from `useBrands()` |
| `BrandProfileView.tsx` | Add danger-styled "Delete brand" CTA at bottom of view → opens `BrandDeleteSheet` |
| `BrandEditView.tsx` | `handleSave` wires `useUpdateBrand().mutateAsync()` · Add danger-styled "Delete brand" CTA at bottom (post-save section) → opens `BrandDeleteSheet` |
| `app/brand/[id]/edit.tsx` | `handleSave` becomes thin (just calls hook); remove `setBrands` direct write |
| `app/brand/[id]/payments/onboard.tsx` | Stripe Connect status persist via `useUpdateBrand` not `setBrands` |
| `app/(tabs)/account.tsx` | Read `useBrands()` instead of `useBrandList()` from Zustand · D-17e-A-8 decides dev-seed UX |
| `mingla-business/src/components/brand/BrandDeleteSheet.tsx` | NEW (~250 LOC est.) — 4-step state machine mirror of Cycle 14 account-delete: Warn → Cascade preview (events count + stripe-connect status + team members count) → Type-to-confirm → Soft-delete via mutation; on rejected `upcoming_events`: show modal "Cannot delete — N upcoming events. Cancel or transfer events first." |

### 8.5 Optional NEW migration (per D-17e-A-5 Option A)

```sql
-- supabase/migrations/20260506000000_brand_kind_address_cover_hue.sql
-- Cycle 17e-A — adds the 3 UI Brand fields existed since Cycle 7+FX2 with TRANSITIONAL marker
-- Enables CRUD wiring per D-17e-A-5 Option A; closes brandMapping.ts:184-191 TRANSITIONAL.

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'popup'
    CHECK (kind IN ('physical', 'popup')),
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS cover_hue integer NOT NULL DEFAULT 25
    CHECK (cover_hue >= 0 AND cover_hue < 360);

COMMENT ON COLUMN public.brands.kind IS
  'Cycle 7 v10 — physical brand owns/leases venue (renders address); popup operates across multiple venues. Default popup (safer, no fake address).';
COMMENT ON COLUMN public.brands.address IS
  'Cycle 7 v10 — public-facing address for physical brands. Free-form. Null when popup OR not yet shared.';
COMMENT ON COLUMN public.brands.cover_hue IS
  'Cycle 7 FX2 v11 — gradient hue for public brand page hero. Defaults to 25 (warm orange = accent.warm).';
```

3 columns; ~10 LOC SQL; defaults preserve current TRANSITIONAL behavior; no data backfill needed; existing brands (if any) get safe defaults; takes <1s on production.

---

## 9. Blast radius map

**Files SPEC will touch:**

| Layer | File | Change type |
|---|---|---|
| DB (conditional) | `supabase/migrations/20260506000000_brand_kind_address_cover_hue.sql` | NEW (per D-17e-A-5 Option A) |
| Service | `mingla-business/src/services/brandMapping.ts` | MOD — remove TRANSITIONAL defaults at lines 184-191 (per D-17e-A-13 conditional on D-17e-A-5=A) + add 3 fields to BrandRow interface + BrandTableInsert + mapUiToBrandUpdatePatch |
| Service | `mingla-business/src/services/brandsService.ts` | NEW |
| Hook | `mingla-business/src/hooks/useBrands.ts` | NEW |
| Hook | `mingla-business/src/hooks/useCurrentBrandRole.ts` | MOD — eventually drop stub-mode synthesis (TRANSITIONAL EXIT per F-D); keep through 17e-A as safety net |
| Store | `mingla-business/src/store/currentBrandStore.ts` | MOD — remove `brands: Brand[]` + `setBrands` action; keep `currentBrandId: string | null` selection state; reduce v12 → v13 schema (or accept partial; orchestrator decides at SPEC time) |
| Store | `mingla-business/src/store/brandList.ts` | MOD or DELETE — STUB_BRANDS dev-seed disposition per D-17e-A-8 |
| UI | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | MOD — wire `useCreateBrand` + add per-row delete affordance |
| UI | `mingla-business/src/components/brand/BrandProfileView.tsx` | MOD — add delete CTA (per D-17e-A-7 Option C) |
| UI | `mingla-business/src/components/brand/BrandEditView.tsx` | MOD — wire `useUpdateBrand` + add delete CTA |
| UI | `mingla-business/src/components/brand/BrandDeleteSheet.tsx` | NEW — 4-step state machine mirror of Cycle 14 account-delete |
| Route | `mingla-business/app/brand/[id]/edit.tsx` | MOD — thin handleSave |
| Route | `mingla-business/app/brand/[id]/payments/onboard.tsx` | MOD — use `useUpdateBrand` |
| Route | `mingla-business/app/(tabs)/account.tsx` | MOD — read `useBrands()` + D-17e-A-8 dev-seed disposition |

**Cache keys affected:**
- NEW: `brandKeys.all` / `brandKeys.lists` / `brandKeys.list(accountId)` / `brandKeys.details` / `brandKeys.detail(brandId)`
- INVALIDATED on createBrand: `brandKeys.list(accountId)` + invalidate any `brandKeys.detail` set
- INVALIDATED on updateBrand: `brandKeys.detail(brandId)` + `brandKeys.list(accountId)`
- INVALIDATED on softDeleteBrand: `brandKeys.list(accountId)` + invalidate `brandKeys.detail(brandId)` + invalidate `brandRoleKeys.byBrand(brandId, *)` (cleanup) + invalidate any events queries that join brands

**Tests SPEC will demand (proposed):**
- Service: createBrand happy path + slug collision (Postgrest 23505) + RLS denial
- Service: getBrands filters deleted_at IS NULL
- Service: softDeleteBrand reject-if-upcoming-events
- Service: softDeleteBrand clears default_brand_id mitigation (F-H)
- Hook: useCreateBrand optimistic rollback on error
- Hook: useSoftDeleteBrand pessimistic flow with rejection modal
- UI: BrandDeleteSheet 4-step state machine renders correctly
- UI: BrandSwitcherSheet renders from server data + create flow + per-row delete
- UI: BrandEditView delete CTA + flow (3-surface parity per D-17e-A-7)
- Cross-domain: events queries verified to filter brands.deleted_at IS NULL

---

## 10. Invariant violations + new invariants

### Existing invariants preserved
- **I-17 (slug FROZEN at brand creation):** preserved by `trg_brands_immutable_slug` trigger; UI honor by hiding slug edit field per D-17e-A-9
- **I-32 (rank parity SQL ↔ TS):** preserved; useCurrentBrandRole continues to use BRAND_ROLE_RANK
- **I-35 (soft-delete contract for creator_accounts):** echoed by D-17e-A-1 brand soft-delete pattern; mirror

### NEW invariants to propose (orchestrator authors at CLOSE)
- **I-PROPOSED-A: BRAND-LIST-FILTERS-DELETED** — "every query reading brands MUST filter `deleted_at IS NULL` at the SQL or post-fetch layer. Strict-grep CI gate scans `mingla-business/src/services/` + `mingla-business/src/hooks/` for raw `from("brands")` reads without `.is("deleted_at", null)` chain." (registry pattern per `feedback_strict_grep_registry_pattern`)
- **I-PROPOSED-B: BRAND-SOFT-DELETE-CASCADES-DEFAULT** — "soft-deleting a brand must `UPDATE creator_accounts SET default_brand_id = NULL WHERE default_brand_id = ?`. Test enforces."
- **I-PROPOSED-C: BRAND-CRUD-VIA-REACT-QUERY** — "no Zustand `setBrands` calls; brands list is owned by `useBrands()` query. CI grep gate enforces `setBrands\(` returns zero hits in `mingla-business/src/` post-17e-A."

Orchestrator decides which (if any) to ratify ACTIVE post-17e-A CLOSE.

---

## 11. Fix strategy (direction only, NOT a spec)

Per agent pipeline: forensics produces direction; SPEC writer locks code-shape contracts; implementor builds; tester verifies.

**Direction:**
1. **Decide D-17e-A-5 first** (kind/address/coverHue persistence) — this gates everything downstream.
2. **If D-17e-A-5 = A (migration):** ship migration first; rest of cycle wires to it.
3. **Build service layer** (`brandsService.ts`) calling existing `brandMapping.ts` mappers.
4. **Build hook layer** (`useBrands.ts`) with proper React Query factory keys + optimistic/pessimistic patterns per D-17e-A-10.
5. **Migrate Zustand store** — remove `brands` array; keep `currentBrandId` selection state.
6. **Wire UI surfaces** — BrandSwitcherSheet create/delete; BrandProfileView delete CTA; BrandEditView update + delete CTA + 3-surface parity per D-17e-A-7.
7. **Build BrandDeleteSheet** — 4-step state machine mirror of Cycle 14 account-delete (D-14-13 type-to-confirm pattern).
8. **Update routes** — thin handleSave wrappers; payments/onboard.tsx Stripe-status-persist via useUpdateBrand.
9. **Migration story for existing phone-only brands** per D-17e-A-8 — likely Option C (accept-as-loss + document).
10. **Drop stub-mode TRANSITIONAL fallbacks** per F-D + F-E once CRUD is live.
11. **Verify all events queries filter brands.deleted_at IS NULL** (R-2 mitigation).
12. **Add slug collision UI handling** (R-4 mitigation).
13. **Test + verify + CLOSE.**

---

## 12. Regression prevention

- Strict-grep CI gate enforces `setBrands\(` returns zero hits post-17e-A (proposed I-PROPOSED-C)
- Strict-grep CI gate scans for raw `.from("brands")` without `.is("deleted_at", null)` chain (proposed I-PROPOSED-A)
- Test fixtures verify all 5 service functions (createBrand / getBrands / getBrand / updateBrand / softDeleteBrand) — happy path + error path + edge case per service per `references/spec-template.md`
- TRANSITIONAL marker EXIT condition cited inline per Const #7

---

## 13. Discoveries for orchestrator

- **D-CYCLE17E-A-FOR-1:** kind/address/coverHue persistence is BLOCKING (F-C); operator decision D-17e-A-5 gates entire cycle scope
- **D-CYCLE17E-A-FOR-2:** events.brand_id ON DELETE CASCADE (F-F) — implementor must verify all events queries filter brands.deleted_at IS NULL; potential blast radius bigger than 17e-A scope
- **D-CYCLE17E-A-FOR-3:** stripe_connect_id duplicated on brands directly + stripe_connect_accounts table (F-G) — out of 17e-A scope; B-cycle Stripe wire ORCH register
- **D-CYCLE17E-A-FOR-4:** slug collision risk on CREATE (F-I) — IMPL must add UI handling; potentially needs slug-availability check edge function or 23505 error mapping
- **D-CYCLE17E-A-FOR-5:** account soft-delete should soft-delete owned brands too (R-9) — verify Cycle 14 J-A14 cascade integration; if missing, 17e-A IMPL adds; if present, 17e-A IMPL preserves
- **D-CYCLE17E-A-FOR-6:** STUB_BRANDS dev-seed disposition per D-17e-A-8 — bigger UX call than first appears (production builds never see them so impact is DEV-only)
- **D-CYCLE17E-A-FOR-7:** brandMapping.ts mappers had ZERO consumers — investigated whether they were dead code or pre-built waiting for wire; verified pre-built; 17e-A activates them
- **D-CYCLE17E-A-FOR-8:** 3 NEW invariants proposed (I-PROPOSED-A/B/C) — orchestrator decides ratification post-CLOSE
- **D-CYCLE17E-A-FOR-9:** v12 → v13 currentBrandStore migration — if `brands: Brand[]` removed from store, Cycle 17d Stage 1 §E reset-on-version-mismatch pattern kicks in; safe per established precedent

---

## 14. Confidence levels

| Topic | Confidence | Reasoning |
|---|---|---|
| Schema state (brands table columns + indexes + triggers) | **H** | Read directly from baseline migration line 7761-7782; 11391-11395; 12567-12579; 14004-14430 |
| RLS policy chain (INSERT + UPDATE + DELETE + SELECT) | **H** | Read directly from migration; verified UPDATE policy permits soft-delete |
| Code state (mappers exist + unused; phone-only handlers; setBrands callers) | **H** | Read directly from 5 source files; cross-checked via grep |
| useCurrentBrandRole stub-mode synthesis | **H** | Read directly from hook source + header comment EXIT condition |
| F-C kind/address/coverHue blocking finding | **H** | Schema read + UI Brand type read + brandMapping.ts:184-191 TRANSITIONAL marker — three layers agree on the gap |
| F-F events orphan on soft-delete | **H** | FK CASCADE constraint read from migration |
| F-K events status enum values | **M** | Inferred from common patterns; not directly verified at this forensics layer; IMPL pre-flight verifies |
| Data layer (existing brand row count in production) | **L** | Not queried; inference from "no service code calls insert" |
| Effort estimate ~12-16h IMPL | **M** | Per Stage 1 §I.4 F-I3 estimate; +30 min per D-17e-A-5 Option A migration if escalated; SPEC + IMPL effort holds within 12-16h envelope |

**Overall forensics confidence: H** — every blocking finding has 6-field evidence; verification commands documented; only data-layer (existing row counts) is unverified, and it doesn't change the architecture.

---

## 15. Operator-decision menu (compact, for orchestrator surface)

**4 pre-locked from Stage 1 (DEC-105 D-17d-FOUNDER-1A/B/C + D-17d-1):**
1. ✅ D-17e-A-1: soft-delete via `deleted_at = now()`
2. ✅ D-17e-A-2: reject-if-upcoming-events
3. ✅ D-17e-A-3: full CRUD scope
4. ✅ D-17e-A-4: 17e-A brand CRUD + 17e-B media picker separate

**1 escalation (BLOCKING — operator must decide):**
5. 🔴 D-17e-A-5: kind/address/coverHue persistence — **A: ADD MIGRATION (recommended)** / B: client-only Zustand divergence / C: defer 17e-A

**8 standard decisions (operator confirms recommendations or steers):**
6. ⚪ D-17e-A-6: type-to-confirm vs simple confirm (rec: A — type-to-confirm; mirror Cycle 14)
7. ⚪ D-17e-A-7: delete CTA placement (rec: C — Switcher + Profile + Edit views)
8. ⚪ D-17e-A-8: phone-only brands data migration (rec: B or C — operator decides between manual re-create vs accept-as-loss)
9. ⚪ D-17e-A-9: UPDATE field scope (rec: all non-immutable per RLS)
10. ⚪ D-17e-A-10: mutation pattern (rec: C — optimistic CREATE+UPDATE / pessimistic DELETE)
11. ⚪ D-17e-A-11: error UX hybrid (rec: D — toast/inline/modal split)
12. ⚪ D-17e-A-12: restore-from-soft-delete (rec: A — out of scope)
13. ⚪ D-17e-A-13: defensive defaults at brandMapping.ts:184-191 (rec: REMOVE conditional on D-17e-A-5=A)

**Recommended batch confirm:** "All recommendations (A on D-17e-A-5)" — single operator response unlocks SPEC dispatch.

---

## 16. Estimated SPEC + IMPL effort

| Phase | Estimate | Notes |
|---|---|---|
| SPEC authoring | ~1.5-2h | Larger than polish dispatches because feature scope; 13 decisions encoded as binding contract; ~30-35 SCs + ~25 test cases + 12-step impl order |
| IMPL effort | ~12-16h | Per Stage 1 §I.4 F-I3; +30 min for D-17e-A-5 Option A migration if escalated; matches forensics complexity assessment |
| Tester effort | ~3-4h | 30+ test cases + cross-domain checks (events queries filter; F-F/F-H mitigation verification) + UI states across 4 surfaces |
| Operator-side | ~30 min | Apply migration via `supabase db push` BEFORE OTA; smoke 4 surfaces post-IMPL |
| **Total cycle** | **~17-23h** including operator-side | Largest cycle since Cycle 14 Account hub; reasonable for the scope |

---

**Authored:** 2026-05-05
**Authored by:** mingla-forensics (INVESTIGATE mode — forensics-only; SPEC defers pending D-17e-A-5 decision lock)
**Awaiting:** orchestrator surfaces 13 decisions to operator for batch lock; on confirmation, orchestrator dispatches SPEC mode
**Next steps after operator decisions:** orchestrator authors SPEC dispatch → forensics SPEC mode → IMPL dispatch → tester dispatch → CLOSE protocol (DEC-109; DEC-107 reserved by ORCH-0735, DEC-108 by ORCH-0736)
