# SPEC — ORCH-1186-C: Menu Builder + Public Menu (DISPLAY-ONLY)

**META:** META-ORCH-1186 Venue Unification · **Leg 3** (largest, last) · **Mode:** SPEC
**Author:** mingla-forensics (SPEC) · **Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/1186-[venue-unify]` · **Branch:** `1186-venue-unify` (at origin/main `89ab7f3ff`)
**Charter:** `Mingla_Artifacts/specs/CHARTER_META-ORCH-1186_VENUE_UNIFICATION.md` (DEC-C)
**Verified against:** post-redesign venue suite (ORCH-1184 #580 command-center desktop).

---

## 1. Executive summary

A verified venue can build a **persistent, manually-authored menu** (categories → items, each
item carrying name / description / price / currency / availability) inside the post-redesign venue
suite, and that menu renders with **currency-formatted prices on the public venue page** (business
web `/b/{slug}` + consumer app `/b/{slug}` via the shared `@mingla/brand-rendering` page).

This is **DISPLAY-ONLY**. There is **no cart, no checkout, no "order", no payment surface
anywhere** in this leg (DEC-C: pay-for-food ordering is a deferred fast-follow, OUT OF SCOPE).

This menu is a **NEW persistent asset**, entirely distinct from the existing "snap your menu"
Gemini parser (`parse-restaurant-menu` → `experience_stops`, the curated-experience builder). It
introduces two new tables — `menus` and `menu_items` — that do **not exist today** (verified: zero
`CREATE TABLE ... menus|menu_items` in `supabase/migrations/`). It does **not** touch, read, or
write `experience_stops`, `experiences`, or any Gemini parser path.

---

## 2. Scope & non-goals

### In scope
1. **Schema:** new `public.menus` + `public.menu_items` tables (FK → `brands`), with sort/ordering
   columns, an availability toggle per item, currency per item, `updated_at` triggers, indexes,
   RLS (brand-member read + manager-plus write), and one anon-readable **security-definer view**
   `public.public_menus_view` (gated on `claim_status = 'verified'`).
2. **Builder module** in the venue suite: a new `"menu"` command-band module (always visible,
   independent of the reservations toggle) that mounts `<VenueMenuModule>` — CRUD for categories
   and items (add / edit / delete / reorder, price input in brand `default_currency`, per-item
   availability toggle).
3. **Public render:** a new **Menu tab** on the shared `@mingla/brand-rendering` `PublicBrandPage`,
   visible only when the venue has ≥1 available item; currency-formatted prices; honest empty state;
   NO checkout/cart/payment control.
4. **Data layer:** hooks + service for builder CRUD (`mingla-business`) and a public-read service +
   wiring on both the business web wrapper and the consumer app screen.
5. **Regression-test contract:** menu CRUD + module-registry derivation + public-render fixture, all
   fails-on-revert.

### Non-goals (explicit OUT)
- **Ordering / cart / checkout / payment of any kind** — DEC-C deferred fast-follow. No "Add to
  order" button, no quantity stepper, no price-sum cart, no Stripe/Paystack path. (Invariant
  `I-PROPOSED-1186-MENU-DISPLAY-ONLY`.)
- **The snap-menu Gemini parser** (`parse-restaurant-menu`, `experience_stops`, `create_experience`)
  — untouched. This menu does not auto-populate from a snap; it is manually built. (A future leg
  *may* offer "import from snap" — explicitly NOT in 1186-C.)
- **Item images / photos per menu item** — text-only items in this leg (name/description/price).
  A `photo_url` column is laid as a NULLable seam but no upload UI ships (documented seam).
- **Dietary tags / allergens / modifiers / variants** — not modeled.
- **Multiple menus per daypart with scheduling** (breakfast/lunch/dinner time windows) — the schema
  supports multiple `menus` rows per brand (e.g. "Dinner", "Drinks") but there is NO time-of-day
  scheduling; menus are display-grouped only.
- **Menu translation / i18n.**

### Assumptions
- A1: A venue's currency is `brands.default_currency` (surfaced as `Brand.defaultCurrency`,
  `mingla-business/src/types/brand.ts:241`). Per-item `currency` defaults to it but is stored on the
  row so a historical price keeps its currency if the brand later changes default. The builder UI
  writes the brand default; it does not offer a per-item currency picker in this leg.
- A2: Only **verified venues** (`brands.claim_status = 'verified'`) expose a public menu. Any brand
  member can build a menu draft, but it only renders publicly once the venue is verified — matching
  the existing `claimed_venues_public_view` gate.
- A3: The `@mingla/brand-rendering` package is consumed as **workspace source** by BOTH
  `mingla-business` and `app-mobile` (no build artifact step — verified: neither package.json pins a
  built `brand-rendering`; both import `@mingla/brand-rendering` resolving to `packages/brand-rendering`).
  Therefore editing the shared `PublicBrandPage.tsx` ONCE yields automatic web + consumer + business
  parity for the render layer.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior | Files touched there | Parity |
|---|---------|---------|------------------------|---------------------|--------|
| 1 | Consumer iOS (`app-mobile` iOS) | YES (render) | Sees the new **Menu tab** with priced items on a verified venue's `/b/{slug}`. No ordering. | `app-mobile/src/hooks/useBrandBySlug.ts` (fetch menu), `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx` (pass `menu` prop) | **Automatic** for render (shared `PublicBrandPage`); **manual** for the consumer fetch (separate `useBrandBySlug` read path). |
| 2 | Consumer Android (`app-mobile` Android) | YES (render) | Same as iOS. Android glass = opaque fallback (policy) honored by reusing shared-page surfaces. | same as #1 | Same as #1. |
| 3 | Buyer/anon Web (`mingla-business` `/b/{brandSlug}`) | YES (render) | Anon visitor sees the Menu tab with prices on a verified venue. SSR-safe (no auth). | `mingla-business/src/services/publicEventsService.ts` (fetch menu into `PublicBrandDetail`), `mingla-business/src/components/brand/PublicBrandPage.tsx` (map + pass `menu`) | **Manual** fetch; **automatic** render. |
| 4 | Business iOS (`mingla-business` venue suite) | YES (builder) | Venue owner taps the **Menu** rail/pill item, builds categories+items with prices, toggles availability. | `venueModules.ts`, `types/venueReservation.ts`, `VenueSuiteShell.tsx`, new `VenueMenuModule.tsx` + sheets + hooks + service | **Automatic** (single shared venue-suite codebase across business iOS/Android/web). |
| 5 | Business Android (venue suite) | YES (builder) | Same as business iOS. | same as #4 | Same as #4. |
| 6 | Admin Web (`mingla-admin`, adjacent) | NOT covered | Admin approval flow is unchanged; menu is not part of the claim-approval surface. | — | Reason: menu is a post-claim owner asset, not an approval input. |
| 7 | Business Web preview (adjacent) | YES (builder + render) | The venue suite renders on business desktop web (rail layout) AND `/b/{slug}` renders there. | same as #3 + #4 | Automatic. |

**HARD GATE satisfied:** every surface enumerated; the two NOT-covered (admin) given a one-phrase reason.

---

## 4. Layered specification

### 4.1 Database

**New migration file (monotonic, collision-checked):**
`supabase/migrations/20261116000000_orch_1186c_menus_menu_items.sql`

> Collision check: current max prefix on this branch + anchor is `20261115000000`
> (`...orch_1183_pg_public_experience_by_slug.sql`). `20261116000000` is strictly greater.
> The implementor MUST re-scan `supabase/migrations/` AND `~/Desktop/mingla-orchs/*/supabase/migrations/`
> at IMPLEMENT and bump if any sibling worktree introduced a ≥ prefix (per the venue_tables precedent
> comment, `20261003000000_orch_1148_venue_tables.sql:14-17`).

**Apply path:** DO NOT `supabase db push`. Apply via the Supabase Management API after REVIEW
(CLI drift-wedged; MCP read-only by default). Mirrors the venue_tables migration footer.

#### Table `public.menus` (a named menu group, e.g. "Dinner", "Drinks")
```sql
CREATE TABLE IF NOT EXISTS public.menus (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 120),
  description text NULL CHECK (description IS NULL OR length(description) <= 500),
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```
- **No `category` table** — categories ARE `menus` rows. Decision: a single grouping level
  (menu/category) keeps the builder simple and matches "categories + items" in the charter. A venue
  with one menu uses one `menus` row ("Menu"); a richer venue uses several ("Food", "Drinks").
- Indexes: `menus_brand_id_idx ON (brand_id)`; `menus_brand_active_idx ON (brand_id) WHERE is_active`.

#### Table `public.menu_items`
```sql
CREATE TABLE IF NOT EXISTS public.menu_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id     uuid NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  brand_id    uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 160),
  description text NULL CHECK (description IS NULL OR length(description) <= 600),
  -- Price in MINOR units (cents / kobo). NULL = "price on request" (renders no number).
  price_cents int NULL CHECK (price_cents IS NULL OR (price_cents >= 0 AND price_cents <= 100000000)),
  currency    text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  is_available boolean NOT NULL DEFAULT true,
  photo_url   text NULL,                 -- seam only; no upload UI this leg
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```
- `brand_id` is **denormalized onto `menu_items`** (in addition to `menu_id`) so RLS and the public
  view can scope by brand without a join, and so a brand-scoped delete cascades cleanly. The builder
  service MUST set `brand_id` on insert to match the parent menu's `brand_id` (a `CHECK` cannot
  cross-reference; integrity is enforced by the service + the public view's join).
- `currency` is NOT NULL (3-letter upper ISO) — never defaults to GBP. Honors the de-GBP direction
  (`project_orch_1034_currency_de_gbp_scope`); the builder writes `brands.default_currency`.
- Indexes: `menu_items_menu_id_idx ON (menu_id)`; `menu_items_brand_id_idx ON (brand_id)`;
  `menu_items_menu_sort_idx ON (menu_id, sort_order)`.

#### `updated_at` triggers
Per-table `tg_menus_set_updated_at` / `tg_menu_items_set_updated_at` BEFORE UPDATE, mirroring
`tg_venue_tables_set_updated_at` (`...20261003000000_orch_1148_venue_tables.sql:52-65`).

#### RLS (brand-member read + manager-plus write) — mirrors venue_tables exactly
```sql
ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "menus brand member can read" ON public.menus
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));
CREATE POLICY "menus manager plus can write" ON public.menus
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menus TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menus TO service_role;
```
(Identical policy set on `public.menu_items`.) Helper functions confirmed live:
`biz_is_brand_member_for_read_for_caller`, `biz_brand_effective_rank_for_caller`, `biz_role_rank`
(used by `...20261003000000_orch_1148_venue_tables.sql:71-79`).

> **Note — DROP POLICY IF EXISTS before each CREATE POLICY**, additive-only, all objects
> `IF NOT EXISTS` guarded, `$function$` dollar-tags closed before GRANT (safe-migration protocol,
> per the venue_tables header).

#### Public anon read — security-definer view (mirrors `claimed_venues_public_view`)
```sql
CREATE OR REPLACE VIEW public.public_menus_view AS
  SELECT mi.id, mi.menu_id, mi.brand_id, b.slug AS brand_slug,
         m.name AS menu_name, m.description AS menu_description,
         m.sort_order AS menu_sort_order,
         mi.name AS item_name, mi.description AS item_description,
         mi.price_cents, mi.currency, mi.sort_order AS item_sort_order
  FROM public.menu_items mi
  JOIN public.menus  m ON m.id = mi.menu_id AND m.is_active = true
  JOIN public.brands b ON b.id = mi.brand_id
  WHERE mi.is_available = true
    AND b.deleted_at IS NULL
    AND b.claim_status = 'verified';
ALTER VIEW public.public_menus_view SET (security_invoker = false);  -- DEFINER: anon never touches brands directly
GRANT SELECT ON public.public_menus_view TO anon, authenticated;
```
- `security_invoker = false` is the established pattern so anon does not need direct `brands` SELECT
  (`...20260731000000_orch_0964_public_views_security_definer.sql:22,27`). The view's WHERE clause
  scopes rows to verified, non-deleted venues — only available items, only active menus.
- Anon reads `public_menus_view` filtered by `brand_slug` (PostgREST), already ordered by the service.

### 4.2 Edge function
**NONE.** No new edge function. All builder writes are RLS-gated direct table upserts via the
Supabase JS client (mirrors `useVenueReservationSettings` direct-upsert pattern). All public reads
are direct `from("public_menus_view")` selects (anon-safe via the definer view). No external API,
no payment, no Gemini.

### 4.3 Service (`mingla-business/src/services/`)
**New file:** `mingla-business/src/services/menusService.ts`
- Row interfaces `MenuRow`, `MenuItemRow` (snake_case) + camelCase domain `Menu`, `MenuItem` +
  `mapMenuRow` / `mapMenuItemRow` (mirrors `useVenueReservationSettings.ts:43-57` mapper style).
- `fetchBrandMenus(brandId)` → builder read: `from("menus").select(...).eq("brand_id", brandId).order("sort_order")`
  + `from("menu_items").select(...).eq("brand_id", brandId).order("sort_order")`, assembled into
  `Menu[]` with nested `items: MenuItem[]`. Error contract: **throws** on `error !== null` (matches
  `fetchVenueReservationSettings`).
- Mutations are thin and live in the hook (direct upsert/delete), NOT here — matching the venue
  pattern where `useVenueReservationSettings` owns the upsert. Service is read-shape + mappers only.

**New file:** `mingla-business/src/services/publicMenusService.ts`
- `MenuItemPublicRow` (snake_case from `public_menus_view`) + `PublicMenuGroup` domain shape
  (`{ menuId, menuName, menuDescription, items: PublicMenuItem[] }`) and a `PublicMenuItem`
  (`{ id, name, description, priceCents, currency }`).
- `fetchPublicMenus(brandSlug)` → `from("public_menus_view").select(...).eq("brand_slug", brandSlug)
  .order("menu_sort_order").order("item_sort_order")`; groups flat rows into `PublicMenuGroup[]`.
  Returns `[]` (never null) when the venue has no public menu. **Throws** on error.

### 4.4 Hook (`mingla-business/src/hooks/`)
**New file:** `mingla-business/src/hooks/useMenus.ts` — mirrors `useVenueReservationSettings.ts`
exactly (auth-gated query + upsert/delete mutations + invalidate).
- **Query-key factory** (export, do NOT hardcode strings — Static Analysis rule):
  ```ts
  export const menuKeys = {
    brandMenus: (brandId: string) => ["menus", brandId] as const,
    publicMenus: (brandSlug: string) => ["publicMenus", brandSlug] as const,
  };
  ```
- `useBrandMenus(brandId: string | null)` — `useQuery`, `enabled = isAuthReady && brandId` (gate via
  `useAuth().isAuthReady` like `useVenueReservationSettings.ts:82-83`), `staleTime: 30_000`,
  `queryFn` → `fetchBrandMenus(brandId)`.
- `useUpsertMenu(brandId)` — `useMutation`, upsert into `menus` (`onConflict: "id"` for edit;
  insert when no id), `onSuccess` invalidates `menuKeys.brandMenus(brandId)`. Has `onError` (rule).
- `useDeleteMenu(brandId)` / `useUpsertMenuItem(brandId, menuId)` / `useDeleteMenuItem(brandId)` /
  `useReorderMenuItems(brandId)` — each a `useMutation` with `onError` + invalidate
  `menuKeys.brandMenus(brandId)`. Reorder writes `sort_order` for the affected rows in a single
  upsert array (set `brand_id` on every item insert to match parent).
- **Public hook** `usePublicMenus(brandSlug: string | null)` lives here too: `useQuery`,
  `queryKey: menuKeys.publicMenus(brandSlug)`, `enabled = brandSlug !== null`, `staleTime: 60_000`,
  `queryFn` → `fetchPublicMenus(brandSlug)`. **Used by the consumer app**; the business web public
  page instead folds the read into the existing `getPublicBrandBySlug` batch (see §4.6) to avoid a
  second round trip on SSR.

### 4.5 Component — Builder (`mingla-business/src/components/venue/`)

**Module registration** — `mingla-business/src/components/venue/venueModules.ts`:
- Add `"menu"` to `VENUE_MODULES` as a **`band: "command"`** module (NOT booking — menu is
  independent of the reservations toggle; charter item 4 makes it a permanent venue capability).
  `label: "Menu"`, `summary: "Build your menu — categories, items, and prices guests see online."`
- `deriveVenueModules(reservationsEnabled)` MUST return menu in **both** branches:
  - OFF → `["overview", "menu", "settings"]`
  - ON  → `["overview", ...VENUE_BOOKING_MODULES, "menu", "settings"]`
  - Ordering decision: menu sits between the booking band and settings (a command capability after
    the booking band, before settings). Settings STAYS LAST (preserves the venueModules T-2 assertion
    pattern — see §9 for the test update).
- `isBookingModule("menu")` MUST return `false` (menu is command-band; the booking-only guard in
  `VenueSuiteShell.tsx:94-98` must not snap away from menu when reservations is OFF).

**Type union** — `mingla-business/src/types/venueReservation.ts:22-28`: add `"menu"` to the
`VenueModule` union. (This is the gating type for the whole suite nav.)

**Shell dispatch** — `mingla-business/src/components/venue/VenueSuiteShell.tsx:165-181`
`renderWorkspace()`: add `if (activeModule === "menu") return <VenueMenuModule brandId={brandId} />;`
before the booking branches. Menu renders inside the shell's plain-View scroll path
(`moduleSelfScrolls("menu")` → `false`; the shell supplies the ScrollView + bottom-nav clearance,
same as Settings). Confirm `venueShellScroll.ts` `moduleSelfScrolls` returns `false` for `"menu"`
(it already returns true only for `"overview"` — verify and leave unchanged so menu uses the shell
scroll).

**New file:** `mingla-business/src/components/venue/VenueMenuModule.tsx`
- Props: `{ brandId: string | null; testID?: string }`.
- Reads `useBrandMenus(brandId)` + `useCurrentBrand()` (for `defaultCurrency`) +
  `useCurrentBrandRole(brandId)` (manager-plus gate, mirrors `VenueSettingsModule.tsx:99-100`).
- States (ALL required, with copy):
  - **loading:** skeleton / "Loading your menu…".
  - **empty (no menus):** honest empty card — title "Build your menu", body "Add categories and
    priced items. Guests see your menu on your public page.", primary `Button` "Add a category"
    (`testID="venue-menu-add-category"`). NO fabricated sample rows.
  - **populated:** a `GlassCard` per menu/category (name, optional description, edit/delete affordance,
    reorder handles), each listing its items (name, currency-formatted price via `formatCurrency`,
    availability dot/toggle, edit/delete). "Add item" per category; "Add category" at the bottom.
  - **read-only (rank < manager):** the `VenueSettingsModule.tsx:405-409` read-only note pattern;
    mutation controls hidden/disabled.
  - **submitting:** mutation `isPending` disables the active control + shows inline spinner.
  - **error:** mutation `onError` → toast (existing toast util) "Couldn't save. Tap to try again.";
    the row stays in place (no optimistic-loss).
- **Add/Edit sheets** (new files, mirror `VenueTableSheet.tsx` / `VenueServicePeriodSheet.tsx`
  bottom-sheet form pattern):
  - `mingla-business/src/components/venue/MenuCategorySheet.tsx` — name (required) + description.
  - `mingla-business/src/components/venue/MenuItemSheet.tsx` — name (required), description, price
    input + availability toggle. **Price input is currency-aware**: it uses the exact draft-string →
    `minorFromMajor(major, currency)` → `price_cents` pattern from `VenueSettingsModule.tsx:126-146`
    (`majorFromMinor` to hydrate, `minorFromMajor` to commit; zero-decimal-currency safe). Currency
    label shows `normalizeCurrency(brand.defaultCurrency)`. A blank price writes `NULL`
    ("Price on request").
- **Reorder:** drag handles or up/down arrows writing `sort_order`. Reuse the simplest pattern that
  exists in the venue suite; if none, up/down arrow buttons are acceptable (avoid a new drag dep).
- Currency formatting on display uses `formatCurrency(priceCents, currency, true)`
  (`mingla-business/src/utils/currency.ts:91`), the same call `VenueSettingsModule.tsx:207` makes.
- **NO order/cart/quantity/checkout control anywhere** (invariant — and the grep gate in §9).

### 4.6 Component — Public render (shared, ONE edit = all-surface parity)

**Shared package** — `packages/brand-rendering/types.ts`:
- Add `PublicMenuItem` + `PublicMenuGroup` types and a `menu?: PublicMenuGroup[]` field on
  `PublicBrandPageProps` (optional; absent/`[]` → no Menu tab). Export both from
  `packages/brand-rendering/index.ts`.
  ```ts
  export interface PublicMenuItem { id: string; name: string; description: string | null;
    priceCents: number | null; currency: string; }
  export interface PublicMenuGroup { menuId: string; menuName: string;
    menuDescription: string | null; items: PublicMenuItem[]; }
  ```

**Shared page** — `packages/brand-rendering/PublicBrandPage.tsx`:
- Extend the `Tab` union (line 76) to `... | "menu"` and `tabLabel` (line 203) with `menu: "Menu"`.
- `visibleTabs` (lines 292-298): push `"menu"` when `menu.length > 0` AND at least one group has ≥1
  item. Position: after `about`, before offering tabs OR after experiences — **decision: insert
  `"menu"` immediately after `about`** (a venue's menu is core identity content). So order becomes
  `about → menu? → upcoming? → events? → trips? → experiences?`.
- Add a `<MenuTab>` render branch in the tab-content switch (lines 467-510): for each
  `PublicMenuGroup`, a section header (menuName + optional description) then each available item as a
  row: item name (+ description, clamped) on the left, **currency-formatted price** on the right via
  a self-contained formatter. The shared package must NOT import `mingla-business` currency utils
  (cross-package boundary) — add a tiny local `formatMenuPrice(priceCents, currency)` using
  `Intl.NumberFormat(undefined, { style: "currency", currency })` (the package already runs in RN +
  web; `Intl` is available in both Hermes and web). `priceCents === null` → no number (omit the
  price column for that row; do NOT render "£0").
- Honest empty: the Menu tab only appears when there is content, so there is no empty-tab dead-end
  (matches the existing "only non-empty tabs" rule, lines 290-298). Theme + palette + surface styling
  reuse the `AboutTab` / offering-tab conventions (Android opaque-glass via the shared `surface.card`).
- **NO interactive purchase control** in `MenuTab` — read-only rows only.

**Business web wrapper** — `mingla-business/src/components/brand/PublicBrandPage.tsx`:
- Accept `menu?: PublicMenuGroup[]` (from `PublicBrandDetail`, §4.3) and pass it straight through to
  `<SharedPublicBrandPage menu={menu} ... />` (line 295). No mapping needed if the service returns
  the shared shape directly; otherwise a thin `mapMenuGroup`.

**Business web fetch** — `mingla-business/src/services/publicEventsService.ts`:
- Add `menu: PublicMenuGroup[]` to `PublicBrandDetail` (after line 273).
- In `getPublicBrandBySlug` (line 1327): add `fetchPublicMenus(brandSlug)` to the `Promise.all`
  batch (line 1351-1356) and return `menu` in the result object (line 1369-1388). Only the venue
  branch needs it, but fetching unconditionally is cheap and returns `[]` for non-venues (the view's
  `claim_status = 'verified'` filter yields zero rows) → no Menu tab for non-venues. **Import**
  `fetchPublicMenus` from the new `publicMenusService.ts`.

**App route** — `mingla-business/app/b/[brandSlug]/index.tsx`: pass `menu={publicBrandQuery.data.menu}`
to `<PublicBrandPage>` (alongside `venue=` at line 65). One-line wire-through.

**Consumer app** — parity (manual fetch path):
- `app-mobile/src/hooks/useBrandBySlug.ts`: add `fetchPublicMenus(slug)` (port the same view read —
  or import a shared read; simplest is a local `from("public_menus_view")` select mirroring
  `publicMenusService`) into the existing `Promise.all` batch (around line 326-332) and include
  `menu` in the returned brand-detail shape.
- `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx`: pass `menu={query.data.menu}` to
  `<PublicBrandPage>` (alongside the existing props, lines 56-65). **This is the non-negotiable
  all-surface parity step** (`feedback_public_trip_page_all_surface_parity`): the consumer app MUST
  show the menu, not just web.

### 4.7 Realtime
NOT applicable. Builder writes invalidate the React Query cache; public reads are point-in-time. No
channel/subscription.

---

## 5. Success criteria (numbered, per-surface where parity is manual)

- **SC-1 (schema):** `menus` + `menu_items` + `public_menus_view` exist; RLS denies a non-member
  SELECT/INSERT; a manager-plus member can INSERT/UPDATE/DELETE own-brand rows; anon can SELECT
  `public_menus_view` rows only for verified venues.
- **SC-2-Biz (builder mount):** On a venue (any `reservationsEnabled` state), the venue suite shows a
  **Menu** rail row (desktop) / pill (native/web-phone). Tapping it mounts `<VenueMenuModule>` — no
  dead tap. Menu appears whether reservations are ON or OFF.
- **SC-3-Biz (CRUD):** A manager-plus owner can add a category, add a priced item to it
  (price typed in `default_currency`), edit the item, toggle its availability, reorder items, delete
  an item, delete a category — each persists (survives refetch) and shows currency-formatted prices.
- **SC-4-Biz (price correctness):** An item priced "12.50" in a USD-default brand stores
  `price_cents = 1250, currency = 'USD'` and the builder redisplays `$12.50`. A blank price stores
  `NULL` and renders "Price on request" (no `$0.00`). A zero-decimal currency (e.g. JPY) stores
  `price_cents = 1250` for "1250" and renders `¥1,250` (no decimals).
- **SC-5-Biz (permissions):** A below-manager member sees the menu read-only (no add/edit/delete
  controls) + the read-only note; RLS blocks any write they could attempt.
- **SC-6-Web (public render):** On a verified venue's `/b/{slug}` (anon, logged-out), a **Menu tab**
  appears (only when ≥1 available item) listing categories + items with currency-formatted prices and
  NO order/cart/buy control. A venue with zero available items shows no Menu tab (no empty dead-end).
- **SC-6-iOS / SC-6-Android (consumer render):** Same Menu tab with prices renders in the consumer
  app at `/b/{slug}` for a verified venue. NO ordering control.
- **SC-7 (display-only invariant):** There is NO cart, "Add to order", quantity stepper, price-sum,
  or checkout/payment control anywhere in the builder OR the public menu, on ANY surface.
- **SC-8 (no entanglement):** The snap-menu parser path (`parse-restaurant-menu`, `experience_stops`,
  `create_experience`) is byte-unchanged; the menu builder neither reads nor writes those.
- **SC-9 (currency honesty):** No item ever defaults to or hardcodes "GBP"; `currency` always comes
  from `brands.default_currency` / the stored row value.

---

## 6. Invariants

### Preserved
- `I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE` (`venueModules.ts:6-12`, test `venueModules.test.ts`
  T-1/T-2): the **booking band** stays gated SOLELY on the reservations toggle. Adding `"menu"` as a
  **command** band (present in BOTH derive branches) does NOT gate it on reservations, so the booking
  band's gating is unchanged. The §9 test update extends T-1/T-2's expected arrays to include `"menu"`
  in the command positions — the booking-band assertions are untouched, so the invariant still
  fails-on-revert if booking gating breaks.
- De-GBP currency direction (`project_orch_1034_currency_de_gbp_scope`): `currency` NOT NULL, never
  GBP-defaulted (SC-9).
- All-surface public-page parity (`feedback_public_trip_page_all_surface_parity`): consumer app
  render is mandatory (§4.6, SC-6-iOS/Android).
- Real-data-only public page (`packages/brand-rendering/PublicBrandPage.tsx:23` rule 9): Menu tab
  only renders with real items; no fabricated rows.

### Established (NEW — DRAFT; orchestrator flips ACTIVE on CLOSE)
- **`I-PROPOSED-1186-MENU-DISPLAY-ONLY`** (from charter): the menu builder + public menu carry NO
  checkout/cart/quantity/order/payment surface. Enforced by the §9 strict-grep gate + render tests.
- **`I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS`** (NEW): the menu schema/builder/public read are
  fully distinct from `experience_stops` and the Gemini parser; `menusService` / `publicMenusService`
  / `useMenus` / `VenueMenuModule` MUST NOT import or query `experience_stops`, `experiences`,
  `parse-restaurant-menu`, or `create_experience`. Enforced by a strict-grep gate (§9).
- **`I-PROPOSED-1186C-MENU-VERIFIED-VENUE-PUBLIC-ONLY`** (NEW): `public_menus_view` exposes menu
  rows ONLY for `claim_status = 'verified'` non-deleted brands (mirrors `claimed_venues_public_view`).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-DB-1 | RLS read isolation | member of brand A selects brand B menus | 0 rows | DB/RLS |
| T-DB-2 | RLS write gate | below-manager INSERT into `menu_items` | denied (42501) | DB/RLS |
| T-DB-3 | Manager CRUD | manager inserts/updates/deletes item | success, row persisted | DB/RLS |
| T-DB-4 | Anon public read (verified) | anon selects `public_menus_view` for verified venue slug | available items returned | DB |
| T-DB-5 | Anon public read (unverified) | anon selects `public_menus_view` for `claim_status='none'` brand | 0 rows | DB |
| T-DB-6 | Unavailable item hidden | item `is_available=false` | absent from `public_menus_view` | DB |
| T-SVC-1 | Price round-trip USD | "12.50", USD | `price_cents=1250, currency='USD'`; redisplay `$12.50` | service/hook |
| T-SVC-2 | Price round-trip JPY | "1250", JPY | `price_cents=1250`; redisplay `¥1,250` | service/hook |
| T-SVC-3 | Null price | blank price | `price_cents=NULL`; render "Price on request" | service/component |
| T-MOD-1 | Module derive OFF | `deriveVenueModules(false)` | `["overview","menu","settings"]` | unit |
| T-MOD-2 | Module derive ON | `deriveVenueModules(true)` | `["overview","tables","availability","reservations","waitlist","menu","settings"]` | unit |
| T-MOD-3 | menu not booking | `isBookingModule("menu")` | `false` | unit |
| T-MOD-4 | menu survives toggle OFF | shell on `menu`, reservations flips OFF | stays on `menu` (not snapped to overview) | component |
| T-UI-1 | Empty builder | brand with no menus | empty card + "Add a category", no sample rows | component |
| T-UI-2 | Read-only member | rank < manager | no mutation controls + read-only note | component |
| T-UI-3 | Error path | upsert returns 500 | toast "Couldn't save…", row unchanged | component |
| T-PUB-1 | Public render with items | `menu=[group w/ items]` | Menu tab visible, prices formatted, no buy control | render (shared) |
| T-PUB-2 | Public render empty | `menu=[]` | no Menu tab | render (shared) |
| T-PUB-3 | Consumer parity | `ConsumerBrandProfileScreen` with menu data | Menu tab renders on app-mobile | render |
| T-INV-1 | Display-only grep | scan builder + shared MenuTab source | zero `cart`/`checkout`/`addToOrder`/`quantity`/`PaymentSheet` tokens | strict-grep |
| T-INV-2 | No-entanglement grep | scan menusService/useMenus/VenueMenuModule | zero `experience_stops`/`parse-restaurant-menu`/`create_experience` | strict-grep |

---

## 8. Implementation order

1. **DB** — write + apply `20261116000000_orch_1186c_menus_menu_items.sql` (tables, indexes,
   triggers, RLS, `public_menus_view`, grants). Apply via Management API. Verify with the DB tests.
2. **Types** — add `"menu"` to `VenueModule` (`types/venueReservation.ts`); add `PublicMenuItem` /
   `PublicMenuGroup` to `packages/brand-rendering/types.ts` + `index.ts`.
3. **Service** — `menusService.ts` (builder read + mappers), `publicMenusService.ts` (public read).
4. **Hook** — `useMenus.ts` (query-key factory + builder query/mutations + `usePublicMenus`).
5. **Module registry** — `venueModules.ts` (`VENUE_MODULES.menu`, `deriveVenueModules` both branches,
   `isBookingModule` stays false). Update `venueModules.test.ts` (T-MOD-1/2/3).
6. **Builder UI** — `VenueMenuModule.tsx` + `MenuCategorySheet.tsx` + `MenuItemSheet.tsx`; wire into
   `VenueSuiteShell.tsx` `renderWorkspace()`.
7. **Public render (shared)** — `PublicBrandPage.tsx` (Tab union + tabLabel + visibleTabs + `MenuTab`
   + `formatMenuPrice`).
8. **Public wire (web)** — `publicEventsService.ts` (`PublicBrandDetail.menu` + batch fetch),
   `components/brand/PublicBrandPage.tsx` (pass-through), `app/b/[brandSlug]/index.tsx` (one-line).
9. **Public wire (consumer)** — `useBrandBySlug.ts` (fetch menu), `ConsumerBrandProfileScreen.tsx`
   (pass `menu`).
10. **Tests** — all of §7; prove the regression contract (§9) fails-on-revert.

---

## 9. Regression prevention (fails-on-revert contract)

1. **Module-registry unit test** — extend `mingla-business/src/components/venue/__tests__/venueModules.test.ts`:
   T-MOD-1 (`deriveVenueModules(false)` === `["overview","menu","settings"]`), T-MOD-2 (ON array
   includes `"menu"` between `waitlist` and `settings`), T-MOD-3 (`isBookingModule("menu") === false`).
   Reverting menu out of `deriveVenueModules` (the dead-tap / missing-module regression) flips T-MOD-1/2
   → FAIL; restoring → PASS.
2. **Price round-trip unit test** — new `__tests__/menuPrice.roundtrip.test.ts`: assert
   `minorFromMajor`/`majorFromMinor` + `formatMenuPrice` produce the SC-4 values for USD + JPY + null.
   Reverting to a hardcoded `* 100` (currency-blind) flips the JPY case → FAIL.
3. **Display-only strict-grep gate** — new
   `.github/scripts/strict-grep/orch-1186c-menu-display-only.mjs`: FAIL the build if any of
   `VenueMenuModule.tsx`, `MenuItemSheet.tsx`, `MenuCategorySheet.tsx`, or the `MenuTab` block of
   `packages/brand-rendering/PublicBrandPage.tsx` contains `cart`, `checkout`, `addToOrder`,
   `quantity`, `PaymentSheet`, `ticket-checkout`, or `Stripe`/`Paystack` tokens (case-insensitive,
   allow-comment annotated). Adding any ordering control → FAIL (enforces
   `I-PROPOSED-1186-MENU-DISPLAY-ONLY`). Register in `strict-grep-mingla-business.yml`.
4. **No-entanglement strict-grep gate** — new
   `.github/scripts/strict-grep/orch-1186c-menu-not-experience-stops.mjs`: FAIL if
   `menusService.ts` / `publicMenusService.ts` / `useMenus.ts` / `VenueMenuModule.tsx` reference
   `experience_stops`, `parse-restaurant-menu`, or `create_experience`. Entangling the snap parser →
   FAIL (enforces `I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS`).
5. **Public-render fixture test** — new
   `packages/brand-rendering/__tests__/publicMenu.render.test.tsx` (or a `mingla-business` render
   test importing the shared page): render `PublicBrandPage` with a 2-group menu fixture → assert the
   Menu tab is present, prices are currency-formatted, and there is NO buyable control
   (`queryByText(/add to order|order now|checkout/i)` is null). Render with `menu={[]}` → assert no
   Menu tab. Reverting the Menu tab → FAIL.

Each new gate carries a protective top-of-file comment naming the ORCH-ID, the invariant it guards,
and the "why" (mirrors `orch-1130-no-buyer-tax-form.mjs`).

---

## 10. Open questions

- **OQ-1 (menu vs category terminology):** This SPEC collapses "category" into a `menus` row (one
  grouping level). If Seth wants a true two-level **Menu → Category → Item** hierarchy (e.g. one
  "Dinner Menu" containing "Starters"/"Mains" categories), a third table `menu_categories` is needed.
  **Recommendation:** ship the single-level model (menus-as-categories) for 1186-C — it satisfies the
  charter ("categories/items") and the deferred-ordering scope; escalate to two-level only if a design
  review demands it. *Implementor proceeds single-level unless amended.*
- **OQ-2 (reorder UX):** Drag-reorder vs up/down arrows. **Recommendation:** up/down arrows (no new
  dependency, Android-safe). Flagged for the designer if a drag affordance is wanted.
- **OQ-3 (multiple menus display order on public page):** Multiple `menus` rows render as stacked
  sections within the single Menu tab, ordered by `sort_order`. Confirm this is the desired public
  layout (vs a sub-tab per menu). **Recommendation:** stacked sections (simpler, scannable).
- **OQ-4 (designer pass):** The builder UI + public Menu tab are net-new surfaces. This SPEC specifies
  states + tokens by reusing existing venue-suite / brand-page conventions, but if Seth wants a
  bespoke menu visual (e.g. dotted leader lines between item and price, à la a printed menu), route a
  `mingla-designer` pass before IMPLEMENT. **Recommendation:** ship the convention-reuse version;
  design polish as a fast-follow.

None of these BLOCK implementation; all have a stated default. Implementor proceeds on the
recommendations unless Seth amends.

---

## 11. Downstream routing

**Next = mingla-designer (optional, fast)** for the builder + Menu-tab visual pass IF Seth wants
bespoke menu styling (OQ-4); otherwise **next = mingla-implementor** directly.

Then: **mingla-implementor** builds per §8 (worktree `~/Desktop/mingla-orchs/1186-[venue-unify]`,
branch `1186-venue-unify`); proves the §9 regression contract fails-on-revert; writes the
implementation report. → **mingla-tester** runs the adversarial suite (RLS isolation, anon public
read, price round-trip across currencies, display-only sweep, consumer-app parity on device). →
**mingla-orchestrator** CLOSE: flip the three DRAFT invariants ACTIVE, sync artifacts, pre-merge gate.

**Sequencing reminder (charter Execution model):** Leg 3 is LAST (Leg 1 → 2 → 4 → 3) because all
legs share venue-suite files (`venueModules.ts`, `VenueSuiteShell.tsx`, `types/venueReservation.ts`).
The implementor MUST rebase on the merged Legs 1/2/4 state before building Leg 3 to absorb their
`VenueModule` union + `deriveVenueModules` edits without conflict.

---

## Scoped allowlist (implementor may change ONLY these)

**Create:**
- `supabase/migrations/20261116000000_orch_1186c_menus_menu_items.sql`
- `mingla-business/src/services/menusService.ts`
- `mingla-business/src/services/publicMenusService.ts`
- `mingla-business/src/hooks/useMenus.ts`
- `mingla-business/src/components/venue/VenueMenuModule.tsx`
- `mingla-business/src/components/venue/MenuCategorySheet.tsx`
- `mingla-business/src/components/venue/MenuItemSheet.tsx`
- `.github/scripts/strict-grep/orch-1186c-menu-display-only.mjs`
- `.github/scripts/strict-grep/orch-1186c-menu-not-experience-stops.mjs`
- `mingla-business/src/components/venue/__tests__/menuPrice.roundtrip.test.ts`
- `packages/brand-rendering/__tests__/publicMenu.render.test.tsx` (or equivalent in mingla-business)
- DB test fixtures as needed.

**Modify:**
- `mingla-business/src/types/venueReservation.ts` (VenueModule union)
- `mingla-business/src/components/venue/venueModules.ts` (register `menu`)
- `mingla-business/src/components/venue/__tests__/venueModules.test.ts` (T-MOD updates)
- `mingla-business/src/components/venue/VenueSuiteShell.tsx` (renderWorkspace dispatch)
- `mingla-business/src/components/venue/venueShellScroll.ts` (only IF `moduleSelfScrolls` needs `"menu"` → false; likely no change)
- `packages/brand-rendering/types.ts` + `packages/brand-rendering/index.ts` (menu types)
- `packages/brand-rendering/PublicBrandPage.tsx` (Tab + MenuTab)
- `mingla-business/src/services/publicEventsService.ts` (`PublicBrandDetail.menu` + batch)
- `mingla-business/src/components/brand/PublicBrandPage.tsx` (pass-through)
- `mingla-business/app/b/[brandSlug]/index.tsx` (one-line wire)
- `app-mobile/src/hooks/useBrandBySlug.ts` (fetch menu)
- `app-mobile/src/screens/ConsumerBrandProfileScreen.tsx` (pass `menu`)
- `.github/workflows/strict-grep-mingla-business.yml` (register the two new gates)

## DO-NOT-TOUCH (stop-and-amend before changing)
- `supabase/functions/parse-restaurant-menu/*`, `_shared/agentTools.ts` (`create_experience`),
  anything `experience_stops` / experiences / Gemini parser — DEC-C distinctness.
- `venue_reservation_settings`, `venue_tables`, `venue_availability_config`, reservation/waitlist
  tables + their hooks/components — Legs 1/2 territory.
- The booking-band gating logic in `deriveVenueModules` / `isBookingModule` (only ADD `menu` as
  command; do not change how the four booking modules gate on the toggle).
- Any Stripe / Paystack / `ticket-checkout-create` / cart / checkout code — display-only.
- The shared anchor `~/Desktop/mingla-main` — never edited.

Amendments append in-file or land as `SPEC_AMENDMENT_ORCH-1186-C_MENU_BUILDER.md`.

---

## DESIGN (ORCH-1186-C)

**Author:** mingla-designer · **Date:** 2026-06-21 · **Mode:** SCREEN + COMPONENT (two net-new surfaces)
**Resolves spec open questions:** OQ-1 single-level (menus-as-categories), OQ-2 **up/down arrow reorder** (no drag dep), OQ-3 stacked sections on the public page, OQ-4 **convention-reuse visual** (no bespoke dotted-leader menu skin).
**Design stance:** This is two surfaces, NOT a new design language. The builder is a structural twin of `VenueSettingsModule` (GlassCard `Section` spine + designSystem tokens + manager-plus gate + the `VenueTableSheet` add/edit-sheet pattern). The public Menu tab is a structural twin of the existing `AboutTab` / offering-list panes inside `PublicBrandPage` (shared `surface.card` + `palette` + `theme.fontFamilyValue`). Every value below is an existing token or a value lifted verbatim from the sibling component. Nothing bespoke ships unless named as a NEW token here (there are none — the design is 100% token-reuse).

### D.0 — Design tokens in force (no raw hex in components)

Builder side (`mingla-business/src/constants/designSystem.ts`): `spacing` (xxs 2 / xs 4 / sm 8 / md 16 / lg 24 / xl 32 / xxl 48), `radius` (sm 8 / md 12 / lg 16 / full 999), `typography` (`h3`, `bodyLg`, `body`, `bodySm`, `caption`, `labelCap`, `micro`), `text` (primary .96 / secondary .72 / tertiary .52 / quaternary .32), `accent.warm` (#eb7825), `semantic` (success #22c55e / successTint / warning #f59e0b / warningTint / error #ef4444 / errorTint), `durations`, `easings`. Glass surfaces ONLY via the `<GlassCard>` primitive (its Android opaque fallback is automatic — `ANDROID_GLASS_USES_OPAQUE_FALLBACK` satisfied by reuse; no raw rgba fills authored here).

Public side (`packages/brand-rendering`): the runtime `palette` (`createThemePalette`) + `surface` (`offeringSurfaceStyles`) + `theme.fontFamilyValue` threaded from `PublicBrandPage`. The Menu tab authors NO new color — every surface is `surface.card` / `surface.cardStrong`, every text color is `palette.primaryText / secondaryText / tertiaryText / accent`. Android opaque-glass is inherited from `surface.card` (the same primitive every existing tab uses). Local `spacing`/`radius` from `packages/brand-rendering/designTokens.ts`.

---

## PART 1 — THE BUILDER (`VenueMenuModule`)

### D1.1 — The moment & IA
The owner just tapped **Menu** in the always-visible command band. Their job is one of: *I have no menu and need to start one* (empty), or *I'm tending an existing menu* (populated). The decision tree is shallow by design — one grouping level (category) over a flat item list. Information hierarchy, top to bottom:
1. **Module intro line** (what this is + where it shows) — orienting, one line.
2. **Category cards** (each = a `menus` row), ordered by `sort_order`, each owning its items.
3. **"Add a category"** affordance at the bottom — the always-available escape hatch.
4. **Read-only note** (below-manager) pinned last.

No tabs, no sub-nav, no daypart scheduler (out of scope). The module scrolls inside the shell's ScrollView (`moduleSelfScrolls("menu") === false`), exactly like Settings — so the builder body is a plain `<View>` with `gap`, never its own scroll root.

### D1.2 — Command-band mount (how it appears)
`VENUE_MODULES.menu = { id:"menu", label:"Menu", band:"command", summary:"Build your menu — categories, items, and prices guests see online." }`. It renders in the master rail (desktop) / pill row (native + web-phone) using the EXACT existing rail-row / pill component the suite already draws for `overview`/`settings` — no new nav chrome. Position: command band, after the booking band, before Settings (Settings stays last). Icon: **`UtensilsCrossed`** from `lucide-react-native` (the suite already imports lucide; rail rows that carry icons use 20px / `strokeWidth 2`; if the current rail rows are text-only, ship text-only — match whatever `overview`/`settings` rows render today, do NOT introduce a lone icon).
- Active rail row: the established active treatment (accent left-edge / accent label) — identical to how `settings` highlights. No bespoke menu styling.
- Tap → `renderWorkspace()` returns `<VenueMenuModule brandId={brandId} />`. **Never a dead tap** (SC-2).

### D1.3 — Layout & spacing grid (the populated state)
Host container mirrors `VenueSettingsModule.styles.host` verbatim: `paddingHorizontal: spacing.md (16)`, `paddingTop: spacing.md (16)`, `gap: spacing.md (16)`. Each category is a `<GlassCard variant="base">` (the same `Section` shell), so vertical rhythm between cards = 16.

**Module intro** (above the first card, inside host):
- Text: "Your menu shows on your public venue page. Build it by category." — `typography.bodySm`, `color: text.secondary`, `marginBottom: spacing.xs (4)`.

**Category card anatomy** (`<GlassCard variant="base">`, internal `gap: spacing.sm (8)`):
- **Header row** (`flexDirection:"row", alignItems:"center", justifyContent:"space-between", gap: spacing.sm`):
  - Left: category **name** — `typography.bodyLg` weight, `color: text.primary`; optional **description** beneath — `typography.bodySm`, `color: text.secondary`, `numberOfLines: 2`.
  - Right (manager+ only): a tight **action cluster** (`flexDirection:"row", gap: spacing.xs (4)`): **▲ up** · **▼ down** · **✎ edit** · (delete lives inside the edit sheet, NOT in the row, to keep the row calm and require a reach for destruction — matches `VenueTableSheet` putting Delete inside the sheet). Each control is an icon `Pressable`, hit target ≥44×44 (icon 18–20px centered in a 44 box; `lucide` `ChevronUp`/`ChevronDown`/`Pencil`, `strokeWidth 2`, `color: text.secondary`, active-press → `opacity 0.6`).
- **Divider** under the header before items: a 1px hairline `View`, `height: StyleSheet.hairlineWidth`, `backgroundColor: "rgba(255,255,255,0.08)"` (= `glass.border.profileBase`), `marginVertical: spacing.xs (4)`. (Single named value; matches the glass border token.)
- **Item rows** (`gap: spacing.xs (4)` between rows): each item is a `flexDirection:"row", alignItems:"center", justifyContent:"space-between", paddingVertical: spacing.xs (4)`:
  - **Left block** (`flex:1, minWidth:0, gap: spacing.xxs (2)`): item **name** `typography.body`, `color: text.primary`, `numberOfLines:1`; item **description** `typography.bodySm`, `color: text.tertiary`, `numberOfLines:2` (omitted when null).
  - **Right block** (`flexDirection:"row", alignItems:"center", gap: spacing.sm (8)`): the **price** — `typography.body` weight `600`, `color: text.primary`, formatted via `formatCurrency(priceCents, currency, true)` (the SAME call Settings makes at `VenueSettingsModule.tsx:207`); when `price_cents === NULL` render the literal **"Price on request"** in `typography.bodySm`, `color: text.tertiary` (NEVER "$0.00"). Then the **availability dot** (see D1.6) + (manager+) the per-item action cluster (▲▼✎, same as category) tucked to the far right with `gap: spacing.xs`.
  - Unavailable item (manager view): the whole row at `opacity: 0.5` + a `caption` "Hidden" pill (`backgroundColor: glass.tint.profileBase`, `color: text.tertiary`, `paddingH spacing.xs`, `radius.full`). It stays in the builder (the owner manages it) but the dot is grey (D1.6).
- **"Add item" row** at the bottom of each category card (manager+ only): a full-width ghost `Pressable`, `paddingVertical: spacing.sm (8)`, `borderWidth:1, borderColor: accent.border (rgba(235,120,37,0.55)), borderStyle:"dashed", borderRadius: radius.md (12)`, centered label "+ Add item" `typography.bodySm` weight `600` `color: accent.warm`. Press → `opacity 0.7`. testID `venue-menu-add-item-<menuId>`.

**"Add a category"** (host-level, after the last card, manager+ only): primary-weight but secondary-styled — use `<Button label="Add a category" variant="secondary" size="md" />` (matches `VenueSettingsModule` "Edit venue details" pattern), `alignSelf:"stretch"`, testID `venue-menu-add-category`. (In the empty state it is a `variant="primary"` Button — see D1.5.)

### D1.4 — Type scale (every text element)
| Element | Token | Color |
|---|---|---|
| Module intro line | `typography.bodySm` | `text.secondary` |
| Category name | `typography.bodyLg` | `text.primary` |
| Category description | `typography.bodySm` | `text.secondary` |
| Item name | `typography.body` | `text.primary` |
| Item description | `typography.bodySm` | `text.tertiary` |
| Item price | `typography.body` (override `fontWeight:"600"`) | `text.primary` |
| "Price on request" | `typography.bodySm` | `text.tertiary` |
| "Hidden" pill | `typography.caption` | `text.tertiary` |
| "+ Add item" | `typography.bodySm` (override `fontWeight:"600"`) | `accent.warm` |
| Read-only note | `typography.caption` | `text.tertiary` |
Dynamic Type: all sizes flow from the shared `typography` tokens (already RN-Dynamic-Type-respecting via the suite); `numberOfLines` clamps prevent overflow; price column never wraps (it is short).

### D1.5 — Empty state (NO fabricated rows)
A single `<GlassCard variant="base">`, centered content, `paddingVertical: spacing.xl (32)`, `gap: spacing.sm (8)`, `alignItems:"center"`:
- Emoji glyph 🍽️ (`fontSize: 34`) — matches the existing `EmptyPane` emoji convention (`PublicBrandPage` uses 🗺️ at 34). Decorative, `accessibilityElementsHidden`.
- Title: "Build your menu" — `typography.bodyLg`, `text.primary`, centered.
- Body: "Add categories and priced items. Guests see your menu on your public page." — `typography.bodySm`, `text.secondary`, centered, `lineHeight` from token.
- Primary CTA: `<Button label="Add a category" variant="primary" size="lg" fullWidth />`, `marginTop: spacing.sm`, testID `venue-menu-add-category`.
- Below-manager empty view: same card WITHOUT the CTA, body swapped to "No menu yet. Ask a manager or owner to add one." Honest, no dead button.

### D1.6 — Availability indicator (the dot)
A 8px circle (`width/height:8, borderRadius:4`): **available → `semantic.success` (#22c55e)**; **unavailable → `text.quaternary` (rgba .32)** (grey, reads "off"). `marginRight: spacing.xs` before the price/actions. The dot is decorative; the row also carries an `accessibilityLabel` that states availability in words (color is NEVER the only signal — priority-1 a11y rule). Toggling availability is done INSIDE the item sheet (a `Switch`), not by tapping the dot (avoids fat-finger mistoggles in a dense list); the dot is read-only status.

### D1.7 — Every interactive state (builder)
- **Default:** as D1.3.
- **Loading** (`useBrandMenus` `isLoading`): a 2-card skeleton — two `<GlassCard variant="base">` each containing 1 header bar + 2 item bars rendered as `backgroundColor: glass.tint.profileBase, borderRadius: radius.sm, height: [16, 12, 12]` blocks, no text. A `caption` "Loading your menu…" is `accessibilityLiveRegion="polite"` for SR. No spinner-only blank screen. (Skeleton over spinner — priority-6 rule.)
- **Press** (any Pressable / icon control): `opacity 0.6–0.7`, `durations.fast (120)` via `easings.press`. Buttons use the `Button` primitive's own press feedback.
- **Submitting** (any mutation `isPending`): the specific control that triggered it shows the `Button` `loading` spinner (sheets) OR, for inline icon controls (reorder), the tapped arrow disables (`opacity 0.4`, `pointerEvents:"none"`) until settle. The list does NOT show a global overlay — only the touched row reacts. Reorder is optimistic-safe: the row visually swaps immediately, reverts on `onError`.
- **Error** (mutation `onError`): existing toast util → "Couldn't save. Tap to try again." (re-fires the same mutation on tap). The row/card stays exactly as it was (no optimistic loss). The reorder swap reverts. testID `venue-menu-error-toast`.
- **Read-only (rank < manager_plus):** ALL mutation controls (reorder arrows, edit pencils, "+ Add item", "Add a category") are NOT rendered (not merely disabled — a disabled-but-present control invites a dead tap). The read-only note from `VenueSettingsModule.tsx:405-409` renders last, verbatim copy: "You can view this menu. Ask a manager or owner to make changes." (`typography.caption`, `text.tertiary`, centered, `paddingBottom: spacing.md`).
- **Disabled (save in a sheet):** the sheet `Button` `disabled={!canSave}` — `canSave = name.trim().length > 0 && !saving` (item name required; price optional). Mirrors `VenueTableSheet.canSave`.

### D1.8 — The two sheets (add/edit)
Both use the canonical `<Sheet snapPoint={0.9}>` + scroll body + grouped `Field` + `Button` pattern from `VenueTableSheet` verbatim. Heading `typography.h3`, `color: text.primary`, `marginBottom: spacing.sm`. Body `paddingHorizontal: spacing.md, paddingTop: spacing.sm`. Scroll `paddingBottom: spacing.xxl, gap: spacing.xs`.

**`MenuCategorySheet.tsx`** — heading "Add category" / "Edit category":
- Field "Category name" (required) → `<Input placeholder="e.g. Starters, Drinks">` testID `menu-category-name`.
- Field "Description (optional)" → `<Input placeholder="A short line guests see under the heading">` testID `menu-category-desc`.
- `<Button label="Save category" / "Add category" variant="primary" size="lg" fullWidth loading={saving} disabled={!canSave}>`.
- Edit mode + manager: `<Button label="Delete category" variant="destructive" size="md" fullWidth>` → `<ConfirmDialog destructive title="Delete this category?" description="“{name}” and all its items will be removed from your menu and your public page. This can't be undone." confirmLabel="Delete" cancelLabel="Keep category">`. (Cascade copy is honest — `ON DELETE CASCADE` removes items.)

**`MenuItemSheet.tsx`** — heading "Add item" / "Edit item":
- Group "Item":
  - Field "Item name" (required) → `<Input placeholder="e.g. Margherita">` testID `menu-item-name`.
  - Field "Description (optional)" → `<Input placeholder="What's in it">` testID `menu-item-desc`.
- Group "Price":
  - Field "Price ({normalizeCurrency(brand.defaultCurrency)})" → `<Input variant="number" placeholder="0.00">` testID `menu-item-price`. **Currency-aware exactly per `VenueSettingsModule.tsx:126-146`:** hydrate the draft string via `majorFromMinor(price_cents, currency)` when editing; on save compute `draftCents` via `minorFromMajor(major, currency)` (zero-decimal-currency safe — JPY "1250" → 1250, USD "12.50" → 1250). **A blank price commits `price_cents = NULL`** and a helper line under the field reads "Leave blank to show "Price on request."" (`typography.caption`, `text.tertiary`).
  - The currency label is display-only text; **NO per-item currency picker** (A1) — `currency` is written as `normalizeCurrency(brand.defaultCurrency)`, never GBP-defaulted (SC-9).
  - **NO quantity / order / "add to cart" control** anywhere in this sheet (SC-7, strict-grep gate).
- Group "Availability": a `ToggleRow` (the `VenueTableSheet.ToggleRow`) "Show this item to guests" — `value=is_available`, `accent.warm` track, testID `menu-item-available`. Default ON for new items.
- `<Button label="Save item" / "Add item" variant="primary" size="lg" fullWidth loading={saving} disabled={!canSave}>`; edit+manager → `<Button label="Delete item" variant="destructive">` → `<ConfirmDialog title="Delete this item?" description="“{name}” will be removed from your menu and your public page. This can't be undone." confirmLabel="Delete" cancelLabel="Keep item">`.

### D1.9 — Reorder UX (OQ-2 resolved: up/down arrows)
Up (`ChevronUp`) / down (`ChevronDown`) icon buttons in each row/card action cluster, 44×44 targets, `color: text.secondary`. **The top item's ▲ and the bottom item's ▼ render disabled** (`opacity 0.3, pointerEvents:"none", accessibilityState:{disabled:true}`) — not hidden, so the cluster keeps a stable width and the user understands the boundary. Tap → swap `sort_order` with the adjacent sibling, optimistic visual swap, single `useReorderMenuItems`/`useReorderMenus` upsert array write, revert on error. Categories reorder by the SAME arrow pattern in the category header cluster. No drag dependency (Android-safe; charter decision).

### D1.10 — Builder motion
| Trigger | Property | Curve | Duration | Reduced-motion |
|---|---|---|---|---|
| Sheet open/close | `Sheet` primitive's own translateY | (sheet default) | (sheet default) | inherits sheet's reduced-motion |
| Reorder swap | row `layout` position | `LayoutAnimation`/Reanimated layout (if the suite already uses it) else instant | `durations.normal (200)` `easings.inOut` | instant swap (no animation) |
| Press feedback | `opacity` → 0.6 | `easings.press` | `durations.fast (120)` | unchanged (opacity is allowed) |
| Card mount on add | `opacity` 0→1 (+ optional 4px translateY) | `easings.out` | `durations.entry (260)` | `opacity` only, no translate |
| Availability dot color | `backgroundColor` cross-fade | `easings.inOut` | `durations.fast (120)` | instant |
Motion is confirmatory only; if the suite has no existing layout-animation infra, ship reorder as an instant swap (the optimistic position change IS the feedback). Never block save on animation.

### D1.11 — Builder accessibility
- Every icon control: `accessibilityRole="button"` + spoken label ("Move {item} up", "Move {item} down", "Edit {item}", "Add item to {category}", "Add a category", "Edit {category}").
- Availability conveyed in words via the row's `accessibilityLabel` ("{name}, {price}, {available|hidden}") — color-independent (priority-1).
- All targets ≥44×44 (icons centered in 44 boxes).
- `Input` fields carry `accessibilityLabel` (mirrors `VenueTableSheet`).
- Reading order: category name → description → items top-to-bottom → add-item → add-category.
- Loading uses `accessibilityLiveRegion="polite"`; error toast is announced by the existing toast util.
- Contrast: `text.primary` (.96 white) on the GlassCard dark fill ≫ 4.5:1; `accent.warm` (#eb7825) labels on dark ≈ 4.6:1 for the dashed "+ Add item" — passes AA for the ≥14px-600 weight; the price uses `text.primary` (never accent) so price legibility is maximal.

### D1.12 — Builder per-platform deltas
- **iOS / Android / business-web:** one shared codebase (suite). Identical layout.
- **Android glass:** automatic — every surface is `<GlassCard>` (opaque ≥0.92 fallback + `overflow:"hidden"`, no Android elevation, per the primitive). The dashed "+ Add item" border is a plain `View` border (renders identically); no translucent fills authored. `ANDROID_GLASS_USES_OPAQUE_FALLBACK` satisfied by reuse.
- **Web (desktop rail):** the module renders in the workspace column right of the 220px rail; cards go full workspace width (no max-width cap — ORCH-1184). Reorder arrows get a web hover state via the `Pressable` (cursor pointer, `opacity 0.85` hover) — no layout shift.
- **Web (phone width):** pill nav; same single-column card stack.

---

## PART 2 — THE PUBLIC MENU TAB (shared `PublicBrandPage`)

### D2.1 — The moment & IA
An anon guest (or consumer-app user) is on a verified venue's `/b/{slug}`, deciding *is this place for me / what do they serve / what does it cost*. The Menu tab answers exactly that and **nothing more** — it is a read-only price list, never a storefront. IA: the tab is a vertical stack of **category sections**, each = a `PublicMenuGroup`, ordered by `menu_sort_order`; within each, item rows ordered by `item_sort_order`. One scroll, scannable, no interaction beyond scrolling.

### D2.2 — Tab placement & visibility
- `Tab` union gains `"menu"`; `tabLabel.menu = "Menu"`.
- `visibleTabs`: push `"menu"` immediately **after `"about"`** (a venue's menu is core identity, ahead of dated offerings) and **only when** `menu.length > 0 && menu.some(g => g.items.length > 0)`. So order: `About → Menu? → Upcoming? → Events? → Trips? → Experiences?`. The Menu chip uses the EXISTING `TabBar` chip styling verbatim (the scrollable accent-active pill) — no bespoke chip. Optional count: pass total available item count via `countForTab("menu")` so the chip reads "Menu 14" (consistent with other tabs that show counts). Empty menu → no chip, no dead tab (matches the established hide-when-empty rule).

### D2.3 — Layout & spacing grid (the pane)
The pane sits in the existing `styles.paneWrap` (`marginTop: 18`). The Menu pane is `<View>` with category sections separated by `spacing.lg (24)`:

**Category section** (`gap: spacing.sm`):
- **Section header:** category name — `fontSize:17, lineHeight:21, fontWeight:"800", color: palette.primaryText, fontFamily: theme.fontFamilyValue` (matches `oCardTitle` weight + the page's themed-font convention so the menu inherits the brand's typeface). Optional category description beneath — `fontSize:14, lineHeight:20, color: palette.tertiaryText, marginTop:2`.
- **Section card:** wrap the section's items in a single `surface.card` block (`borderRadius:16, overflow:"hidden"`) so each category reads as one printed-menu panel — this reuses the EXACT offering-card surface (Android opaque inherited). Inner `padding:14`.

**Item row** (inside the card; `flexDirection:"row", alignItems:"flex-start", justifyContent:"space-between", gap:12, paddingVertical:10`; first row no top pad, rows separated by a 1px `palette.panelBorder` hairline `marginVertical` 0 between rows):
- **Left** (`flex:1, minWidth:0, gap:2`): item name — `fontSize:16, lineHeight:21, fontWeight:"700", color: palette.primaryText`; description — `fontSize:14, lineHeight:19, color: palette.tertiaryText, numberOfLines:3`.
- **Right** (price column, `alignItems:"flex-end"`, not shrinking): price — `fontSize:16, lineHeight:21, fontWeight:"800", color: palette.primaryText`, formatted by the local `formatMenuPrice(priceCents, currency)`; when `priceCents === null` the **entire price column is omitted** (do NOT render "£0", do NOT render "Price on request" on the public page — silence is cleaner for a guest; the row simply has no price). The left block then spans full width.

**Decision (OQ-4):** NO dotted leader lines between name and price. The two-column row (name left / price right) is the convention every offering card already uses (`oCardFoot` is space-between) and reads as a menu without a bespoke skin. Convention-reuse, per stance.

### D2.4 — `formatMenuPrice` (self-contained, package-boundary-safe)
```ts
const formatMenuPrice = (priceCents: number | null, currency: string): string | null => {
  if (priceCents === null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(priceCents / 100);
  } catch {
    return `${currency} ${(priceCents / 100).toFixed(2)}`;
  }
};
```
- Lives INSIDE `PublicBrandPage.tsx` (the package must NOT import `mingla-business` currency utils — cross-package boundary). Mirrors the file's existing `formatCurrencyRound` helper exactly in shape.
- `Intl.NumberFormat` renders zero-decimal currencies correctly (¥1,250 not ¥1,250.00) on both Hermes (RN) and web — same engine the rest of the page relies on.
- **NEVER GBP-defaulted** — `currency` always arrives from the row (`public_menus_view.currency`); the `catch` fallback echoes the stored currency, never "GBP" (SC-9).

### D2.5 — Public empty / edge states
- **No public menu** (`menu` absent / `[]` / no available items): the Menu tab simply does not appear (D2.2). There is no empty Menu pane to land on — honest, no dead-end (matches the page's whole-tab hide rule). This is the ONLY empty handling needed on the public side.
- **Category with all items unavailable:** the view already filters `is_available=true`, so such a category yields zero rows and is dropped server-side; never rendered as an empty header.
- **All-null-price menu:** renders names/descriptions with no price column — valid (a tasting-menu venue, "market price" board). No "$0" ever.

### D2.6 — Public type scale
| Element | Size/weight | Color |
|---|---|---|
| Category name | 17 / 800, themed font | `palette.primaryText` |
| Category description | 14 / 400 | `palette.tertiaryText` |
| Item name | 16 / 700 | `palette.primaryText` |
| Item description | 14 / 400, `numberOfLines:3` | `palette.tertiaryText` |
| Item price | 16 / 800 | `palette.primaryText` |
Dynamic Type respected (RN text scales; clamps prevent overflow; price column is short and right-aligned so it never collides with a scaled name).

### D2.7 — Public color & contrast
All colors are theme-palette tokens (the brand's own palette), so the menu auto-themes per brand exactly like every other tab. Price uses `primaryText` (max legibility, never accent — a price is data, not an action). Section card = `surface.card` (the audited Android-opaque surface; `primaryText`/`tertiaryText` on it already pass AA on the shared page — same pairing the About/offering tabs ship). No new contrast pairing is introduced.

### D2.8 — Public interactive states (there are almost none — by design)
- **Press:** NONE. Item rows are **not `Pressable`** — there is no detail screen, no buy, no expand. They are static `<View>`/`<Text>`. This is deliberate: a tappable-looking row that does nothing is a dead tap; a clearly static row sets the right expectation (read-only). (SC-7 — no order affordance "anywhere".)
- **Hover (web):** NONE on rows (no affordance, no cursor change, no hover bg). The Menu chip in the tab bar keeps its existing hover.
- **Loading:** the Menu data arrives in the same brand-detail batch as everything else; the page's existing brand-page loading/skeleton covers it. The Menu tab only mounts once data is present, so there is no per-tab loading state.
- **Error:** if the batch read fails, the page's existing error handling applies; a partial failure of just the menu read returns `[]` → no Menu tab (graceful degrade, never a broken tab).
- **NO empty pane** (D2.5).

### D2.9 — Public motion
- Tab switch into Menu: the page's EXISTING tab-content transition (whatever `PublicBrandPage` already does on `setActiveTab`) — no new animation. Reduced-motion inherits the page.
- No row-level motion (static content).
- The `ParallaxCoverShell` parallax is untouched (governing rule: the shell is never a scroll root; the Menu pane lives in the body flow exactly like every other pane).

### D2.10 — Public accessibility
- Each item row: `accessibilityRole` defaults to text; the row groups its name + description + price so a screen reader reads "{name}. {description}. {price}." in order. Set `accessibilityLabel` on the row `View` to the composed string (price spoken in words via the formatted currency string).
- Category header is an `accessibilityRole="header"` so SR users can navigate by section.
- Reading order: category header → its items top to bottom → next category.
- Contrast inherited from the shared palette (AA-passing surfaces).
- No interactive targets to size (no taps) — the only target on the tab is the chip, already ≥44 in the existing `TabBar`.
- Reduced-motion: inherited (no menu-specific animation).

### D2.11 — Public per-platform deltas
- **One shared component** → buyer-web + business-web + business iOS/Android (via `mingla-business` adapter) + consumer iOS/Android (via `ConsumerBrandProfileScreen`). Editing `PublicBrandPage.tsx` once = all five surfaces (A3). The consumer fetch is the only manual parity step (`useBrandBySlug` → `menu`), already specced §4.6 — **non-negotiable** (`feedback_public_trip_page_all_surface_parity`): the menu MUST render in the consumer app, not just web.
- **Android glass:** the section card = `surface.card` (opaque fallback baked into the shared surface engine); no new fills. Satisfied by reuse.
- **Web (desktop):** the Menu pane flows in the existing left content column under the tab bar; the right sticky panel (Share/Next-up) is unchanged. Category cards span the content-column width.
- **Web (phone) / native:** single-column stack of category cards in the body, sliding over the parallax seam like every other pane.
- **SSR (buyer-web):** the menu arrives via the security-definer `public_menus_view` in the existing `getPublicBrandBySlug` batch — anon-safe, no auth, no client token. Renders server-side with the rest of the page.

---

## D3 — Design acceptance checklist (verify before IMPLEMENT closes)
1. Builder: empty state shows 🍽️ + "Build your menu" + a single primary "Add a category" CTA; ZERO fabricated sample rows. ✓ D1.5
2. Builder: every category is a `<GlassCard>`; items show currency-formatted price via `formatCurrency(...,true)`; null price → "Price on request", never "$0.00". ✓ D1.3
3. Builder: reorder is up/down arrows (boundary arrows disabled-visible); NO drag dependency. ✓ D1.9
4. Builder: below-manager sees a read-only menu (no mutation controls rendered) + the verbatim read-only note. ✓ D1.7
5. Builder: price input is currency-aware (`minorFromMajor`/`majorFromMinor`), label shows brand `default_currency`, NO per-item currency picker, NEVER GBP-defaulted. ✓ D1.8
6. Builder + public: ZERO `cart`/`checkout`/`quantity`/`addToOrder`/`PaymentSheet`/`Stripe`/`Paystack` tokens; item rows are not buyable; public rows are not even `Pressable`. ✓ D1.8 / D2.8 (strict-grep gate §9)
7. Public: Menu chip appears after About, ONLY when ≥1 available item; uses the existing TabBar chip. ✓ D2.2
8. Public: category sections stacked, each a `surface.card`; name-left / price-right; null price omits the column (no "£0"). ✓ D2.3
9. Public: `formatMenuPrice` is package-local (no `mingla-business` import), `Intl`-based, zero-decimal safe, never GBP-defaulted. ✓ D2.4
10. Public: menu renders on ALL five surfaces incl. the consumer app (parity). ✓ D2.11
11. Android opaque-glass honored on both surfaces by reusing `GlassCard` / `surface.card` (no new translucent fills). ✓ D1.12 / D2.11
12. Distinct from snap-menu experiences: this builder is manual, text-only, display-only, touches no `experience_stops`/parser path. ✓ (scope + strict-grep gate §9)

## D4 — New tokens required
**NONE.** Every value is an existing `designSystem` / `brand-rendering` token or a value lifted verbatim from `VenueSettingsModule` / `VenueTableSheet` / `PublicBrandPage`. The only new helper is the package-local `formatMenuPrice` (D2.4), which is a function, not a token. The implementor builds this without adding to the design system.

## D5 — Downstream routing (design phase)
Design complete. Next = **mingla-implementor** (this DESIGN is now part of the binding SPEC; build per §8 implementation order, honoring every D-section value). No further designer pass needed unless Seth requests the bespoke printed-menu skin (dotted leaders) explicitly rejected here as OQ-4.
