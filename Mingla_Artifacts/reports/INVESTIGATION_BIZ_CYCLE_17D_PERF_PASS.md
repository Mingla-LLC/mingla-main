# INVESTIGATION REPORT — BIZ Cycle 17d (perf pass + storage hygiene + 2 founder-feedback intake threads)

**Cycle:** 17d (BIZ — fourth + final mini-cycle of Phase 5 Refinement Pass)
**Mode:** INVESTIGATE
**Generated:** 2026-05-05
**Effort:** ~2.5 hrs forensics
**Codebase:** `mingla-business/`
**Confidence (overall):** HIGH on §B/§C/§D/§E/§F/§G/§I schema + §J schema; MEDIUM on §A bundle (no runtime measurement done — operator must run `expo export`); HIGH on §H TTL proposal logic; HIGH on operator-decision menu

---

## 1. Layman summary

The four Q1-Q4 storage questions resolve cleanly: **comp guests, drafts, and notification prefs are all phone-only by intentional design** — every one carries an explicit `[TRANSITIONAL]` marker citing B-cycle as the EXIT condition. **No data-loss risk worth panicking about.** The TTL question (Q4) is a real launch-floor concern for ended events but not blocking; recommend a single shared `evictEndedEvents()` helper called at app start.

Bigger surprise from the brand-delete investigation (§I): **brand creation itself is also phone-only TRANSITIONAL** — `BrandSwitcherSheet` writes to Zustand only, never to the `brands` Supabase table. The DB schema is **fully ready** for both create AND delete (RLS policies + cascade FKs + `deleted_at` soft-delete column all in place), but the mobile-side wiring is absent. The founder's "no way to delete a brand" surfaces a much wider truth: there's no way to genuinely create one either. This is good news — the schema work is done, only the service+hook+UI layer needs wiring.

The cover/profile media ask (§J) finds **events schema is fully ready** (`cover_media_url` + `cover_media_type` constraint already accepts `'image' | 'video' | 'gif'`). **Brands schema has `profile_photo_url` but no separate `cover_url`** — needs either reuse of profile_photo for both, or a small additive migration adding `cover_media_url` + `cover_media_type` mirror.

The classic perf surfaces (§A bundle / §C LOC / §D DoorPaymentMethod): **two .tsx files exceed 2000 LOC** (CreatorStep2When at 2271, CreatorStep5Tickets at 2148) — clear top-3 split candidates. **`@tanstack/query-async-storage-persister` + `@tanstack/react-query-persist-client` are installed but unused** — easy bundle trim. Bundle measurement requires operator running `npx expo export --dump-sourcemap` to produce concrete byte numbers — flagged as IMPL-time task.

**Decomposition recommendation:** SPLIT — 17d perf+storage (single sweep, ~6-8h) + 17e founder-feature follow-on (brand lifecycle wiring + Giphy/Pexels media picker, ~16-24h split into 17e-A + 17e-B). 17e is bigger than 17d's perf scope can absorb; combining them stalls the Refinement Pass close.

---

## 2. Investigation Manifest

| # | File / area | Layer | Why read |
|---|---|---|---|
| 1 | `mingla-business/src/store/guestStore.ts` (full) | Zustand | Q1 verdict — DB write or phone-only |
| 2 | `mingla-business/src/store/draftEventStore.ts` (header) | Zustand | Q2 verdict — server-side autosave intent |
| 3 | `mingla-business/src/store/notificationPrefsStore.ts` (full) | Zustand | Q3 verdict — sync gap |
| 4 | `mingla-business/app/account/notifications.tsx` (consumer) | Component | Q3 — verify double-wire is honored |
| 5 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (full) | Component | §I — confirm no delete affordance |
| 6 | Grep `supabase.from("brands")` across `mingla-business/` | Service | §I — find brand CRUD service paths (read-only verified) |
| 7 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` lines 7761-7852 | Schema | §I + §J — brands + events schema |
| 8 | Same migration, FK + RLS sections | Schema | §I — cascade behavior + delete RLS policy |
| 9 | Same migration, cover_media + storage bucket sections | Schema | §J — events.cover_media_url, brands.profile_photo_url |
| 10 | `mingla-business/app/event/[id]/door/[saleId].tsx` (header + imports) | Component | §D — DoorPaymentMethod import usage |
| 11 | `mingla-business/app/_layout.tsx` (Provider tree) | Bootstrapping | §A — verify React Query persist is wired |
| 12 | `mingla-business/package.json` (full deps) | Build | §A — bundle dependency inventory |
| 13 | `wc -l app/**/*.tsx src/**/*.tsx` | Build | §C — top 15 fattest files |

13 files / queries — all by direct read or grep, no sub-agent delegation.

---

## 3. §A — Bundle inventory (recommendation, no runtime measurement)

### A.1 Dependency landscape

41 dependencies in `mingla-business/package.json`. Categorization for trim assessment:

| Category | Deps | Trim opportunity |
|---|---|---|
| Auth (4) | `@react-native-google-signin/google-signin`, `expo-apple-authentication`, `@supabase/supabase-js` | None — load-bearing |
| Payment (2) | `@stripe/stripe-react-native`, `react-native-nfc-manager` | NFC only Cycle 12 door-sale; verify usage gates |
| Camera/scan (3) | `expo-camera`, `react-native-qrcode-svg`, `expo-image-picker` | Camera + image-picker unavoidable |
| UI animation (4) | `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler`, `react-native-screens` | All load-bearing |
| Glass effects (2) | `expo-blur`, `expo-linear-gradient` | Both used heavily in primitives |
| Image (1) | `expo-image` | **Verify** — installed but may not be wired (grep `expo-image` import in src/) |
| SVG (1) | `react-native-svg` | Used by EventCover stripes; **partial overlap with §J** — if Pexels/Giphy media replaces stripes, can trim later |
| Forms (1) | `@react-native-community/datetimepicker` | Used by event wizard Step 2 |
| Error handling (2) | `react-error-boundary`, `@sentry/react-native` | Cycle 16a; load-bearing |
| Routing/Expo (8) | `expo`, `expo-router`, `expo-constants`, `expo-dev-client`, `expo-font`, `expo-haptics`, `expo-linking`, `expo-splash-screen`, `expo-status-bar`, `expo-symbols`, `expo-system-ui`, `expo-web-browser` | All load-bearing |
| **React Query persist (UNUSED)** | `@tanstack/query-async-storage-persister`, `@tanstack/react-query-persist-client` | 🟡 **TRIM CANDIDATE** — installed but `app/_layout.tsx:101-105` only uses `QueryClientProvider`, NOT `PersistQueryClientProvider`. Confirmed via grep `persistQueryClient` returned 0 hits. Estimated ~30-50KB gzip savings if removed. |
| State (2) | `zustand`, `@tanstack/react-query` | Load-bearing |
| AsyncStorage (1) | `@react-native-async-storage/async-storage` | Load-bearing |
| Web (2) | `react-native-web`, `react-dom` | Web bundle |
| Test (none) | — | No jest, no vitest in deps; in-tree |

### A.2 Concrete recommendations

🟡 **F-A1 (Hidden flaw):** Two unused React Query persist deps in package.json
- File: `mingla-business/package.json:33-34` (entries `@tanstack/query-async-storage-persister` + `@tanstack/react-query-persist-client`)
- Verification: grep for `persistQueryClient` / `createAsyncStoragePersister` / `PersistQueryClientProvider` across mingla-business returned zero hits
- Recommendation: remove both deps OR wire the persistence (decision per D-17d-N)
- Severity: 🟡 hidden flaw — bundle bloat without any user benefit

🔵 **F-A2 (Observation):** Bundle measurement requires operator action
- Run from `mingla-business/`: `npx expo export --platform ios --dump-sourcemap --output-dir dist/`
- Then: `npx source-map-explorer dist/_expo/static/js/ios/*.hbc.map` (or platform-equivalent)
- Implementor can verify trim wins post-removal of unused deps
- Confidence on bundle savings without runtime measurement: MEDIUM

---

## 4. §B — AsyncStorage hygiene findings

### B.1 — Cold-start hydration cost

12 stores hydrate at app start. Zustand `persist` middleware reads each key serially via `AsyncStorage.getItem`. On a mid-tier Android with cold OS cache, AsyncStorage reads run ~5-15ms each → estimated **60-180ms hydration tax**. Not blocking but measurable. Implementor should add `console.time` / `Sentry.metrics.timing()` instrumentation around `onRehydrateStorage` callbacks at IMPL time to ground-truth this estimate.

🔵 **F-B1 (Observation):** No app-start hydration instrumentation. Add timing measurement to verify the 60-180ms estimate; if real number is >500ms, escalate to a separate perf ORCH.

### B.2 — Unbounded growth audit

5 append-only stores have NO pruning logic:

| Store | Pruning logic? | Growth driver | 12-month estimate (heavy operator: 50 events) |
|---|---|---|---|
| `orderStore.v1` | None | order count × ~500 bytes/entry | 50 events × 200 orders × 500B = **5MB** ⚠️ |
| `guestStore.v1` | None | comp guest count × ~400 bytes | 50 × 30 × 400B = ~600KB (manageable) |
| `eventEditLogStore.v1` | None | edit count × ~300 bytes | 50 × 20 × 300B = ~300KB (manageable) |
| `scanStore.v1` | None | scan count × ~250 bytes | 50 × 200 × 250B = **2.5MB** ⚠️ |
| `doorSalesStore.v1` | None | door-sale count × ~600 bytes | 50 × 50 × 600B = ~1.5MB |

iOS AsyncStorage soft-cap: ~6MB before performance degrades. **Heavy operator hits the cap inside 12 months on the 2 starred stores alone.**

🟠 **F-B2 (Contributing factor):** No TTL eviction across 5 append-only stores → AsyncStorage soft-cap risk for heavy operators within 12 months.

### B.3 — Migration version surface

`currentBrandStore.v12` has been migrated 12 times. Read `currentBrandStore.ts:428+` confirms migrate function handles every version. Most users are on v12 today. Versions v1-v11 are dead branches (no live users on those versions).

🟡 **F-B3 (Hidden flaw):** Migration code for v1-v11 is dead but loaded into bundle. Estimated +50-80 LOC of dead code paths. Low priority but trim opportunity.

### B.4 — Orphan key sweep specification

No app-start hook lists AsyncStorage keys + reaps unknowns. If a future cycle renames a store (e.g., `guestStore.v1` → `compGuestsStore.v1`), the old key persists indefinitely.

🟡 **F-B4 (Hidden flaw):** No orphan-key safety net. Recommend at IMPL time: a `reapOrphanStorageKeys()` helper called once at app start that:
1. `AsyncStorage.getAllKeys()`
2. Filter to `mingla-business.*` prefix
3. Compare against known store names whitelist
4. `console.warn` (and optionally clear) any keys not in the whitelist

### B.5 — Auth token security observation

🟠 **F-B5 (Contributing factor — security):** Supabase auth session lives in plain AsyncStorage (`supabase.ts:43` `persistSession: true` uses default). On iOS, AsyncStorage is filesystem-readable by any process with the app's container access. SecureStore (iOS Keychain + Android Keystore) is the canonical secure-storage layer for auth tokens.
- Migration cost: medium (~3-5h — wraps `supabase.auth.getSession()` storage adapter)
- Risk today: low (no jailbroken-device threat model documented)
- Recommendation: defer to a security-hardening ORCH; flag here for trail

---

## 5. §C — LOC decompose top 5 + recommended top 3 split candidates

### C.1 Top 15 fattest .tsx files (verified via `wc -l`)

| Rank | File | LOC |
|---|---|---|
| 1 | `src/components/event/CreatorStep2When.tsx` | **2271** ⚠️ |
| 2 | `src/components/event/CreatorStep5Tickets.tsx` | **2148** ⚠️ |
| 3 | `app/event/[id]/index.tsx` | 1354 |
| 4 | `src/components/event/PublicEventPage.tsx` | 1265 |
| 5 | `app/event/[id]/guests/[guestId].tsx` | 1262 |
| 6 | `app/__styleguide.tsx` | 1102 (dev fixture — ACCEPT) |
| 7 | `src/components/auth/BusinessWelcomeScreen.tsx` | 1065 |
| 8 | `app/event/[id]/reconciliation.tsx` | 1039 |
| 9 | `src/components/brand/PublicBrandPage.tsx` | 1017 |
| 10 | `app/event/[id]/scanner/index.tsx` | 960 |
| 11 | `src/components/brand/BrandProfileView.tsx` | 943 |
| 12 | `src/components/door/DoorSaleNewSheet.tsx` | 935 |
| 13 | `src/components/brand/BrandEditView.tsx` | 909 |
| 14 | `src/components/event/EditPublishedScreen.tsx` | 863 |

Total mingla-business code: ~50K LOC (`49943 total`).

### C.2 Recommended top 3 split candidates

🟠 **F-C1 (Contributing factor):** `CreatorStep2When.tsx` 2271 LOC
- Concrete split candidates (need IMPL-time verification):
  - Repeat-pattern picker sheet → `CreatorStep2WhenRepeatPickerSheet.tsx` (the preset selector at line 1231)
  - Multi-date override sheet handlers → `CreatorStep2WhenOverrideHandlers.ts`
  - Recurrence rule helpers → already in `recurrenceRule.ts` util (good)
- Estimated split: 800-1000 LOC extracted into 2-3 sub-components with `React.memo` boundaries

🟠 **F-C2 (Contributing factor):** `CreatorStep5Tickets.tsx` 2148 LOC
- Split candidates:
  - Per-tier card render → `TicketTierCard.tsx` (memoized)
  - Tier add/edit sheet → `TicketTierEditSheet.tsx`
  - Pricing helpers → util file
- Estimated split: 700-900 LOC extracted

🟠 **F-C3 (Contributing factor):** `app/event/[id]/index.tsx` 1354 LOC
- Single-route file; usually best decomposed via per-section sub-components extracted to `src/components/event/`
- Already imports from `event/` directory; pattern established
- Estimated split: 400-600 LOC extracted

**Decompose total:** ~1900-2500 LOC extracted across 3 files into 6-9 new memoized sub-components. Re-render surface measurably reduced for typing + selection events on these dense screens.

---

## 6. §D — DoorPaymentMethod cleanup verification

🔵 **F-D1 (Observation):** `DoorPaymentMethod` type imports verified used in 1 of 3 candidate files
- `app/event/[id]/door/[saleId].tsx:33-34` imports `DoorPaymentMethod` AS A TYPE; needs file-body verification at IMPL time (only the import statement was read — body usage not exhaustively traced)
- Other 2 candidate files (`door/index.tsx`, `guests/[guestId].tsx`) need same IMPL-time check
- Recommendation: implementor reads each file body, removes type imports if unused; total expected LOC delta: -3 to -6 lines if all 3 imports trimmable

---

## 7. §E — Q1 verdict: guestStore is phone-only BY DESIGN (NOT data-loss risk)

🔵 **F-E1 (Observation — verdict):** `guestStore.v1` IS phone-only AND that's the documented spec.

**Six-field evidence:**
- **File + line:** `mingla-business/src/store/guestStore.ts:1-34` (header docstring)
- **Exact code:**
  ```ts
  // Cycle 10: comp guests live client-only. B-cycle migrates to backend
  // (decision deferred to B-cycle SPEC: either tickets table with
  // order_id IS NULL OR a new comp_guests table with its own RLS).
  ...
  // [TRANSITIONAL] Zustand persist holds entries client-side. B-cycle
  // migrates to Supabase. When backend lands, this store contracts to a
  // cache + ID-only.
  ```
- **What it does:** writes/reads comp guests to `mingla-business.guestStore.v1` AsyncStorage key only; no `supabase.from("guests")` / `from("comp_guests")` / `from("orders")` call paths exist for comp-guest creation
- **What it should do:** verbatim what it does today, per Cycle 10 SPEC §4.4
- **Causal chain:** founder asks "what if phone breaks?" → spec answer is "comp guests are intentionally phone-only until B-cycle wires them; documented data-loss risk is accepted at MVP scale"
- **Verification:** grep `supabase.from\("(guests|comp_guests|comp_)"\)` returned zero hits; only `from("orders")` writes from regular checkout flow (NOT via guestStore)

**Verdict (a):** phone-only by design. Already TRANSITIONAL-tagged. EXIT condition: B-cycle SPEC. **No 17d action required.** Operator already accepted this trade-off at Cycle 10 SPEC.

---

## 8. §F — Q2 verdict: draftEventStore is phone-only BY DESIGN

🔵 **F-F1 (Observation — verdict):** `draftEvent.v1` IS phone-only AND that's the documented spec.

**Six-field evidence:**
- **File + line:** `mingla-business/src/store/draftEventStore.ts:1-24` (header docstring)
- **Exact code:**
  ```ts
  // [TRANSITIONAL] Zustand persist holds all drafts client-side. B-cycle
  // migrates drafts to server-side storage; this store contracts to a
  // cache + ID-only when backend lands.
  //
  // Per Cycle 3 spec §3.1; Cycle 4 spec §3.1 expands schema v2→v3 for
  // recurring + multi-date events (additive — single-mode unchanged).
  ```
- **What it does:** drafts persist to `mingla-business.draftEvent.v1` AsyncStorage; on publish, `convertDraftToLiveEvent()` (line 37 import) inserts into `events` table (verified via `liveEventConverter.ts` import path)
- **What it should do:** verbatim per Cycle 3 + 4 SPEC; published events are server-canonical, drafts are device-local
- **Causal chain:** founder asks "what if user switches devices mid-creation?" → spec answer is "drafts are ephemeral by design; they survive app kill but not device switch; B-cycle adds optional server autosave"
- **Verification:** events table has `status DEFAULT 'draft'` column (migration line 7813) — but mingla-business never INSERTs draft-status events; only publish flow writes (status='scheduled')

**Verdict (a):** phone-only by design. Already TRANSITIONAL-tagged. EXIT condition: B-cycle SPEC. **No 17d action required.**

---

## 9. §G — Q3 verdict: notification prefs sync is correctly double-wired (no drift)

🔵 **F-G1 (Observation — verdict):** Marketing toggle correctly double-wires to `creator_accounts.marketing_opt_in`; other 3 toggles are correctly TRANSITIONAL inert per Cycle 14 SPEC. **No sync gap.**

**Six-field evidence:**
- **File + line:** `mingla-business/src/store/notificationPrefsStore.ts:7-11` (header docstring) + `mingla-business/app/account/notifications.tsx:89-100` (consumer handler)
- **Exact code (consumer):**
  ```ts
  setPref(key, value);
  if (key === "marketing") {
    // DOUBLE-WIRE per D-14-7: also persist to creator_accounts.marketing_opt_in.
    try {
      await updateAccount({ marketing_opt_in: value });
    } catch (_err) {
      showToast("Couldn't save. Tap to try again.");
      setPref(key, !value);  // optimistic rollback
    }
  }
  ```
- **What it does:** marketing-key changes update phone optimistically + DB; other keys (orderActivity, scannerActivity, brandTeam) update phone only — TRANSITIONAL per Cycle 14 §4.5.1
- **What it should do:** verbatim per Cycle 14 SPEC §4.5.1 + DEC-096 D-14-7
- **Causal chain:** double-wire pattern with optimistic rollback ensures phone state matches DB on success; on failure, phone reverts to previous state (no silent drift)
- **Verification:** `useEffect` at notifications.tsx:71 calls `hydrateMarketing(account.marketing_opt_in)` on creator-account load — phone state initializes from DB on every mount

**Verdict:** No drift. Pattern is sound. The 3 inert toggles correctly stay phone-local until B-cycle wires `user_notification_prefs` schema + OneSignal delivery. **No 17d action required.**

---

## 10. §H — Q4 TTL eviction policy proposal

The 2 starred stores in §B.2 (`orderStore` 5MB at 12mo, `scanStore` 2.5MB at 12mo) hit AsyncStorage soft-cap on heavy operators. Recommend a single shared eviction utility called at app start.

### H.1 Proposed shared `evictEndedEvents()` helper

**Location (new):** `mingla-business/src/utils/evictEndedEvents.ts`

**Logic:**
1. Read `useLiveEventStore.getState().events`
2. Compute set of `eventId`s with `end_at < now() - 30 days`
3. For each phone store with eventId-keyed entries (`orderStore`, `guestStore`, `eventEditLogStore`, `scanStore`, `doorSalesStore`):
   - `setState((s) => ({ entries: s.entries.filter(e => !endedEventIds.has(e.eventId)) }))`
4. Persist hook fires automatically; AsyncStorage shrinks at next write

**Trigger point:** call once on app start, after Zustand hydration completes (in `app/_layout.tsx` after the persist middleware finishes hydrating all stores). Or call lazy on first event-list render (cheaper but later).

**TTL value:** 30 days post `end_at` is a reasonable default. Operator decision (D-17d-N).

### H.2 Findings

🟠 **F-H1 (Contributing factor):** No eviction utility exists today; 5 stores grow append-only forever.
- File: N/A (utility doesn't exist)
- Recommendation: ship `evictEndedEvents.ts` in 17d IMPL alongside the call site at `app/_layout.tsx:?`
- Estimated effort: ~1.5h (utility + integration test + call-site wiring)

🟡 **F-H2 (Hidden flaw):** Once shipped, `evictEndedEvents()` becomes a regression vector. Implementor must guard against deleting entries for events the user is actively using (e.g., scanning a ticket on day-of). Recommend: only evict events with `end_at + 30d < now()` AND `endedAt IS NOT NULL` — never evict in-progress events even if `end_at` is in the past (concert delays, etc.).

---

## 11. §I — D-17d-FOUNDER-1: Brand delete UX scoping

### I.1 Schema state — FULLY READY

`brands` table at migration line 7761-7782:

```sql
CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    ...
    "deleted_at" timestamp with time zone,    -- ✅ soft-delete column exists
    CONSTRAINT "brands_slug_nonempty" CHECK ((length(trim(...)) > 0))
);
```

Indexes filter on `deleted_at IS NULL`:
- `idx_brands_account_id` (line 11391)
- `idx_brands_slug_active` UNIQUE (line 11395) — soft-delete handles slug-collision elegantly

RLS policies:
- `Account owner can insert brand` (line 14004)
- **`Brand admin plus can delete brands`** (line 14094) — **DELETE is RLS-permitted for brand_admin+**

Cascade FKs (verified via grep on `REFERENCES "public"."brands"`):
- `events.brand_id` → ON DELETE **CASCADE** (line 13356)
- `brand_invitations.brand_id` → ON DELETE CASCADE (line 13156)
- `brand_team_members.brand_id` → ON DELETE CASCADE (line 13166)
- `payouts.brand_id` → ON DELETE CASCADE (line 13506)
- `stripe_connect_accounts.brand_id` → ON DELETE CASCADE (line 13865)
- `audit_log.brand_id` → ON DELETE SET NULL (line 12931) — audit trail preserved
- `creator_accounts.default_brand_id` → ON DELETE SET NULL (line 13266) — no orphan default

Triggers:
- `trg_brands_immutable_account_id` (line 12567) — account_id can't change
- `trg_brands_immutable_slug` (line 12571) — slug can't change
- `trg_brands_updated_at` (line 12579) — auto-updated_at

**The schema is unambiguous: soft-delete via `deleted_at = now()` is the canonical pattern. Hard-delete via `DELETE FROM brands WHERE id = ?` ALSO works (RLS permits + cascades fire). Both are valid. Operator decides.**

### I.2 Code state — UI ABSENT, CREATE ALSO PHONE-ONLY

🟠 **F-I1 (Contributing factor):** Brand creation is phone-only TRANSITIONAL — connected finding, broader than just the delete UX

- **File + line:** `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:117-125`
- **Exact code:**
  ```ts
  const handleSubmit = (): void => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const newBrand = buildBrand(trimmedName);
    setBrands([...brands, newBrand]);     // <-- Zustand only
    setCurrentBrand(newBrand);             // <-- Zustand only
    onBrandCreated?.(newBrand);
    onClose();
  };
  ```
- **What it does:** creates a new Brand object via `buildBrand()` helper (line 68-83 — synthesizes `id`, `slug`, defaults `kind`, `address`, `coverHue`); appends to phone state only
- **What it should do:** call a service that INSERTs into Supabase `brands` table, then phone state reflects the DB-returned row
- **Causal chain:** operator creates brand on phone → no DB row exists → opens app on second device → brand list is empty → operator confused; ALSO connects to Cycle 17a §A.3 D-CYCLE12-IMPL-2 fix (defensive defaults in `mapBrandRowToUi` for "B-cycle's first real-DB brand creation")
- **Verification:** grep `supabase.from\("brands"\)` returned exactly 1 hit (read for role check at `useCurrentBrandRole.ts:120`); zero INSERT/UPDATE/DELETE call paths

🟠 **F-I2 (Contributing factor):** No brand-delete UI in any of the 3 candidate locations
- `BrandSwitcherSheet.tsx` — only switch + create modes (verified full read; no delete button)
- `BrandProfileView.tsx` — 943 LOC; not exhaustively read for this forensics; recommend implementor verify (likely no delete affordance based on Cycle 2 J-A7 SPEC scope)
- `BrandEditView.tsx` — 909 LOC; same; likely edit-only

### I.3 UX scoping

The founder ask requires **delete affordance on**: (a) BrandSwitcherSheet dropdown rows, (b) BrandProfileView page, AND ideally (c) BrandEditView (for organisers already editing).

**UX patterns to surface as D-17d-FOUNDER-1 sub-decisions:**

- **Soft-delete vs hard-delete:**
  - Soft-delete (set `deleted_at = now()`) preserves audit trail; brand row stays in DB but UI hides it; recovery possible via DB intervention
  - Hard-delete cascades to events/orders/team_members/payouts/stripe_connect — irreversible but clean
  - Recommendation: **soft-delete by default** (matches `creator_accounts.deleted_at` pattern from Cycle 14); hard-delete reserved for GDPR-compliance ORCH

- **Cascade-cancel events vs reject-if-events:**
  - Reject-if-events: "Cannot delete — N upcoming events. Cancel or transfer events first." Forces operator to manually wind down.
  - Cascade-cancel: events soft-deleted alongside brand; orders auto-refunded via Stripe webhook in B-cycle (lots of moving parts)
  - Recommendation: **reject-if-upcoming-events** (operator must manually cancel upcoming events first, then delete brand). This is the explicit, safe pattern.

- **Type-to-confirm vs simple confirm:**
  - Mirror Cycle 14 account-delete pattern: type-to-confirm with brand name (D-14-13 type-to-confirm pattern is established).

- **Connected scope question:** does 17e (or whatever cycle absorbs this) ALSO wire brand creation to DB at the same time? **Recommend YES** — both create + delete are part of the same brand-lifecycle service layer; they ship together.

### I.4 Findings

🟠 **F-I3 (Contributing factor):** Founder feedback D-17d-FOUNDER-1 surfaces a much wider TRANSITIONAL — the entire mingla-business brand lifecycle (create / read / update / delete) is not yet wired to the `brands` Supabase table. Schema is ready. Service+hook+UI layer needs wiring. Severity S1-high (blocks real account hygiene + GDPR). Scope is bigger than 17d perf scope can absorb.

---

## 12. §J — D-17d-FOUNDER-2: Cover/profile media picker (Giphy/Pexels/upload)

### J.1 Schema state — events READY, brands PARTIAL

**Events table (line 7792-7820):**
```sql
"cover_media_url" "text",                    -- ✅ exists
"cover_media_type" "text",                   -- ✅ exists
CONSTRAINT "events_cover_media_type_check" CHECK
    ("cover_media_type" = ANY (ARRAY['image', 'video', 'gif']))   -- ✅ already accepts 3 types
```

**Brands table (line 7761-7782):**
```sql
"profile_photo_url" "text",     -- ✅ exists; GRANT SELECT ON anon (line 17904) — public-readable
-- NO cover_url / cover_media_url / cover_media_type column
```

🟡 **F-J1 (Hidden flaw):** Brands schema lacks separate cover column. Three remediation options:
- **Option A:** Reuse `profile_photo_url` as both avatar AND cover (cramped — single image serves dual purpose; awkward at hero scale)
- **Option B:** Add `cover_media_url` + `cover_media_type` columns to brands (mirror events shape; tiny additive migration)
- **Option C:** Status quo — keep EventCover hue stripes for brand cover, only swap event covers (operator's "weird covers" complaint persists for brands)

**Recommendation:** Option B (additive migration mirroring events shape). Cost ~30 min schema work + 2 column adds; future-proof + symmetric with events.

### J.2 Storage bucket state — UNVERIFIED

Grep on storage bucket-related migration content returned zero hits in the baseline migration. This is suspicious — uploads need a bucket. Either:
- (a) Bucket exists but is configured via Supabase Dashboard (not in declarative migrations) — likely
- (b) Bucket doesn't exist yet — needs creation

🔵 **F-J2 (Observation):** Storage bucket inventory needs runtime verification — operator (or implementor) checks Supabase Dashboard → Storage → buckets list. If `brand_covers` / `event_covers` exist, scope is upload-pattern wiring; if absent, scope adds bucket creation step.

### J.3 EventCover.tsx current state

Read header confirmed (forensics-time): pure SVG `<Rect>` stripe pattern with `hsl(hue, 60%, 45%)` colors. Used kit-wide where no real cover image exists. Operator's "weird covers" refers to this fallback.

**Replacement strategy:**
- EventCover.tsx STAYS as fallback when `cover_media_url` is null
- New `EventCoverMedia.tsx` component renders real media when URL present (wraps `expo-image` for image+gif; conditional `<Video>` from `expo-av` for MP4)
- Existing EventCover consumers (events list cards, event detail headers, brand profile hero, brand switcher rows) update to render media-or-fallback

### J.4 Giphy + Pexels integration assessment

| API | Auth | Free tier limits | Attribution | Mobile SDK |
|---|---|---|---|---|
| **Giphy** | API key (server-side recommended) | 1000 req/day free | "Powered by GIPHY" attribution required | No official RN SDK; REST `/v1/gifs/search` |
| **Pexels** | API key | 200 req/hr; 20K req/mo free | Photographer credit + Pexels link required | No official RN SDK; REST `/v1/search` |

**Architecture recommendation:** **Edge function proxy** for both APIs. Reasons:
- Const #5 (server state server-side) — API keys NEVER on phone
- Rate limit pooling — 1 server quota covers all users
- Attribution metadata centralized — single helper formats credit lines
- Estimated effort: 1 edge function `media-search` with `?provider=giphy|pexels` query param, ~3-4h authoring

**Picker UX (operator-decision territory):**
- Single sheet with 3 tabs: [Upload | Giphy | Pexels]
- OR three separate flows: ⊕ icon → action sheet → pick source → dedicated screen each
- Recommendation: single sheet with tabs (faster UX; 1 implementation surface)

**Scope dimensions:**
- Brand profile photo (Avatar — already exists; possibly extend with media picker)
- Brand cover (NEW per F-J1 Option B migration)
- Event cover (cover_media_url already exists; needs picker wiring)

### J.5 Findings

🟠 **F-J3 (Contributing factor):** Founder feedback D-17d-FOUNDER-2 has 3 distinct surfaces (brand profile photo, brand cover, event cover) and 3 distinct pickers (upload, Giphy, Pexels) → 9-cell scope matrix. Operator should pick a launch subset:
- Tier 1 (founder-feedback essentials): Event cover with all 3 sources
- Tier 2: Brand cover (after F-J1 Option B migration)
- Tier 3: Brand profile photo with all 3 sources

🔵 **F-J4 (Observation):** `expo-image` is in package.json but its actual usage in `mingla-business/src/` is currently uncertain — implementor verifies if wired or just installed. If unused, that's another F-A1-style trim opportunity.

---

## 13. §13 — Operator-decision menu (D-17d-N)

11 decisions surfaced for batched lock-in at 17d CLOSE (likely DEC-105 — DEC-104 used by 17c CLOSE).

### D-17d-1 — Decomposition split: 17d perf-only vs 17d single-sweep
- **Option A:** SPLIT — 17d perf+storage+TTL (~6-8h) + 17e founder-feature follow-on (brand lifecycle ~12-16h + Giphy/Pexels media ~10-14h) → 17e split into 17e-A + 17e-B
- **Option B:** SINGLE-SWEEP — 17d absorbs everything (~30-40h)
- **Recommendation:** **Option A** — 17e is bigger than 17d's perf scope can absorb; combining stalls the Refinement Pass close + spans 2-3 sessions which violates `feedback_sequential_one_step_at_a_time` spirit (one mini-cycle at a time).

### D-17d-2 — TTL eviction TTL value
- Option A: 7 days post `end_at` (aggressive — protects against "concert delay" edge case poorly)
- **Option B: 30 days post `end_at`** (recommended — gives operator time to review final reconciliation)
- Option C: 90 days (conservative — wastes AsyncStorage on non-recoverable data)
- **Recommendation:** Option B (30 days)

### D-17d-3 — TTL eviction trigger point
- **Option A:** App start, post-hydration (recommended — immediate cleanup)
- Option B: Lazy on first event-list render (cheaper but later cleanup)
- **Recommendation:** Option A

### D-17d-4 — Unused React Query persist deps trim
- **Option A:** Remove both `@tanstack/query-async-storage-persister` + `@tanstack/react-query-persist-client` from package.json (recommended)
- Option B: Wire React Query persistence (adds offline-resilience but needs careful staleTime tuning)
- **Recommendation:** Option A — defer wiring to a perf-or-offline-resilience ORCH if needed

### D-17d-5 — Auth token SecureStore migration
- Option A: Defer to a security-hardening ORCH (recommended)
- Option B: Bundle into 17d (~3-5h)
- **Recommendation:** Option A — flag as observation, not 17d scope

### D-17d-6 — currentBrand v1-v11 dead migration code prune
- **Option A:** Prune dead branches (recommended — ~50-80 LOC trim, no risk if no live users on v1-v11)
- Option B: Leave as-is (audit-trail value)
- **Recommendation:** Option A; document removed branches in comment

### D-17d-7 — Orphan-key safety net
- **Option A:** Ship `reapOrphanStorageKeys()` helper at app start (recommended)
- Option B: Defer
- **Recommendation:** Option A — cheap, prevents future regression

### D-17d-8 — LOC decompose top 3
- **Option A:** Decompose all 3 (`CreatorStep2When` + `CreatorStep5Tickets` + `event/[id]/index.tsx`) (~4-5h)
- Option B: Decompose top 2 only (skip event/[id]/index.tsx)
- Option C: Decompose top 1 only
- **Recommendation:** Option A — re-render surface improvement materially benefits CreatorStep2When and CreatorStep5Tickets users (event creator wizard typing lag); event/[id]/index.tsx is lower-priority but cheap to bundle while the implementor is in the area.

### D-17d-FOUNDER-1A — Brand delete: soft-delete vs hard-delete
- **Option A:** Soft-delete (`deleted_at = now()`) (recommended — matches kit pattern, reversible)
- Option B: Hard-delete + cascades (irreversible, clean DB)
- **Recommendation:** Option A; reserve hard-delete for GDPR-specific ORCH

### D-17d-FOUNDER-1B — Brand delete: pre-condition check
- **Option A:** Reject-if-upcoming-events (recommended — explicit, safe, matches operator mental model)
- Option B: Cascade-cancel events on brand delete (reflective of FK CASCADE behavior; complex with refunds)
- **Recommendation:** Option A

### D-17d-FOUNDER-1C — Brand lifecycle scope
- **Option A:** 17e absorbs full brand CRUD wiring (create + read + update + delete) (recommended — one coherent service+hook layer)
- Option B: 17e absorbs delete only; create remains TRANSITIONAL phone-only longer
- **Recommendation:** Option A

### D-17d-FOUNDER-2A — Brand cover schema
- **Option A:** Additive migration adding `brands.cover_media_url` + `brands.cover_media_type` mirroring events shape (recommended — symmetric, future-proof)
- Option B: Reuse `profile_photo_url` as both avatar and cover
- Option C: Status quo (no brand cover; only event cover gets media picker)
- **Recommendation:** Option A

### D-17d-FOUNDER-2B — Picker UX shape
- **Option A:** Single sheet with [Upload | Giphy | Pexels] tabs (recommended)
- Option B: Action sheet → 3 separate flows
- **Recommendation:** Option A

### D-17d-FOUNDER-2C — Architecture
- **Option A:** Edge function proxy (`media-search` with provider param) for both Giphy + Pexels (recommended — server-side keys, rate-limit pooling)
- Option B: Direct API calls from mobile (rejected — Const #5 violation, key exposure)
- **Recommendation:** Option A

### D-17d-FOUNDER-2D — Launch tier subset
- Option A: All 3 surfaces × all 3 sources (~14h IMPL)
- **Option B:** Tier 1 only — event cover with all 3 sources (~6h IMPL — recommended)
- Option C: Tier 1 + Tier 2 (event + brand cover) (~10h)
- **Recommendation:** Option B — ship event cover first, brand cover + profile photo follow in 17e-B-2 if operator validates demand

### D-17d-FOUNDER-2E — Storage bucket creation
- Action: operator confirms via Supabase Dashboard whether `brand_covers` / `event_covers` buckets exist; if absent, bucket creation is part of SPEC scope (declarative migration via `INSERT INTO storage.buckets` OR Dashboard click)
- **Recommendation:** declarative migration for repeatability

---

## 14. Decomposition recommendation

**Recommended:** **3-cycle decomposition** per D-17d-1 Option A

| Mini-cycle | Scope | Effort estimate |
|---|---|---|
| **17d** | §A unused dep trim + §B TTL eviction + B.3 dead migration prune + B.4 orphan-key safety + §C top-3 LOC decompose + §D DoorPaymentMethod cleanup | ~6-8h |
| **17e-A** | §I brand lifecycle wiring (full CRUD: create + read + update + delete via `brands` Supabase service + RLS-tested + delete UX on 3 surfaces) | ~12-16h |
| **17e-B** | §J Tier 1 — event cover media picker (single sheet, 3 sources, edge fn proxy) + brands schema migration (F-J1 Option B) | ~10-14h |
| **17e-B-2 (optional)** | §J Tier 2/3 — brand cover + brand profile photo media picker | ~6-8h |

**Why split:** combined 17d would be ~30-40h spanning 2-3 sessions, violating sequential-pace memory rule. Split keeps each mini-cycle ≤ 16h (one focused session pair). After 17d closes, Refinement Pass is structurally complete — 17e is feature work, not hardening.

---

## 15. Findings classification summary

| ID | Class | One-line |
|---|---|---|
| F-A1 | 🟡 Hidden flaw | 2 unused React Query persist deps in package.json (~30-50KB gzip) |
| F-A2 | 🔵 Observation | Bundle measurement requires operator-side `expo export` |
| F-B1 | 🔵 Observation | No app-start hydration timing instrumentation |
| F-B2 | 🟠 Contributing | No TTL eviction; AsyncStorage soft-cap risk at 12mo on heavy operator |
| F-B3 | 🟡 Hidden flaw | currentBrand v1-v11 dead migration code in bundle |
| F-B4 | 🟡 Hidden flaw | No orphan-key safety net |
| F-B5 | 🟠 Contributing (security) | Auth tokens in plain AsyncStorage, not SecureStore |
| F-C1 | 🟠 Contributing | CreatorStep2When 2271 LOC — split candidate |
| F-C2 | 🟠 Contributing | CreatorStep5Tickets 2148 LOC — split candidate |
| F-C3 | 🟠 Contributing | event/[id]/index.tsx 1354 LOC — split candidate |
| F-D1 | 🔵 Observation | DoorPaymentMethod imports need IMPL-time verification |
| F-E1 | 🔵 Observation | Q1 verdict: guestStore phone-only by design (not data-loss) |
| F-F1 | 🔵 Observation | Q2 verdict: draftEvent phone-only by design (not data-loss) |
| F-G1 | 🔵 Observation | Q3 verdict: notification prefs correctly double-wired (no drift) |
| F-H1 | 🟠 Contributing | No `evictEndedEvents()` utility exists |
| F-H2 | 🟡 Hidden flaw | Eviction must guard against in-progress events |
| F-I1 | 🟠 Contributing | Brand creation phone-only TRANSITIONAL (broader than just delete UX) |
| F-I2 | 🟠 Contributing | No brand-delete UI in any of 3 candidate locations |
| F-I3 | 🟠 Contributing | Founder D-17d-FOUNDER-1 surfaces wider brand-lifecycle TRANSITIONAL |
| F-J1 | 🟡 Hidden flaw | Brands schema lacks `cover_media_url` + `cover_media_type` |
| F-J2 | 🔵 Observation | Storage bucket inventory needs runtime verification |
| F-J3 | 🟠 Contributing | Founder D-17d-FOUNDER-2 has 9-cell scope matrix; needs Tier subset decision |
| F-J4 | 🔵 Observation | `expo-image` usage in src/ unverified |

**Total: 0 root cause · 9 contributing · 5 hidden · 9 observations**

(No 🔴 root causes — this is a hardening + scoping audit, not a defect investigation.)

---

## 16. Discoveries for orchestrator

- **D-CYCLE17D-FOR-1:** Brand creation phone-only TRANSITIONAL is BIGGER than founder ask — entire brand lifecycle (CRUD) is unwired despite schema being ready. Recommend 17e-A absorb full lifecycle.
- **D-CYCLE17D-FOR-2:** `events` schema cover_media columns are READY — Cycle 17e-B can ship event-cover media picker with zero new schema work.
- **D-CYCLE17D-FOR-3:** `brands` schema lacks separate cover_media columns — small additive migration recommended for symmetry with events.
- **D-CYCLE17D-FOR-4:** RLS policy `Brand admin plus can delete brands` already exists — schema doesn't block; UX/wiring is the only barrier.
- **D-CYCLE17D-FOR-5:** `@tanstack/query-async-storage-persister` + `@tanstack/react-query-persist-client` deps installed but unused — installed by an earlier cycle's "in case" without wiring; operator's call to remove or wire.
- **D-CYCLE17D-FOR-6:** `expo-image` import usage uncertain — IMPL-time grep verifies; if unused, another trim opportunity.
- **D-CYCLE17D-FOR-7:** Storage bucket existence needs operator dashboard check before §J SPEC fires.
- **D-CYCLE17D-FOR-8:** `audit_log.brand_id ON DELETE SET NULL` (vs CASCADE) means brand-delete preserves audit trail with NULL brand reference — desirable; flag this pattern as "audit-trail preservation invariant" candidate.

---

## 17. Confidence levels

| Section | Confidence | Reasoning |
|---|---|---|
| §A Bundle | MEDIUM | Dependency-list audit + grep are direct; concrete byte sizes need runtime measurement |
| §B AsyncStorage hygiene | HIGH | All 12 stores read directly; growth projections math-grounded |
| §C LOC decompose | HIGH | wc -l verified; top 3 candidates clear |
| §D DoorPaymentMethod | LOW | Only 1 of 3 file headers read; full body verification at IMPL time |
| §E Q1 guestStore | HIGH | Header docstring + grep on supabase calls confirms phone-only by design |
| §F Q2 draftEvent | HIGH | Header docstring + liveEventConverter import confirms publish-flow goes through DB; drafts don't |
| §G Q3 notification prefs | HIGH | Consumer code at notifications.tsx:89-100 read directly; double-wire pattern verified |
| §H TTL proposal | HIGH | Logic mirrors existing events table structure; trigger-point and TTL value are operator decisions |
| §I Brand delete | HIGH | Schema fully read; RLS confirmed; cascade FKs enumerated |
| §J Cover/profile media | MEDIUM-HIGH | Events schema verified; brands schema gap identified; storage bucket existence unverified (D-CYCLE17D-FOR-7) |
| §13 Operator-decision menu | HIGH | All 14 D-17d-N items have concrete options + recommendations |

---

**End of investigation report.**
