# SPEC — ORCH-1027 [Launch Cities admin control]

**Status:** SPEC complete, ready for IMPLEMENT (admin UI surface → designer pass before/with implement).
**Author:** mingla-forensics (SPEC mode), 2026-05-31.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1027-[launch-cities-admin]/` on branch `ORCH-1027-launch-cities-admin`.
**Downstream consumer:** ORCH-1028 [consumer onboarding location gate] — consumes the `check-launch-city` edge-function contract defined in §C. ORCH-1028 is OUT OF SCOPE here except for that frozen contract.

---

## 0. Verified live-system realities (Phase 1 — do NOT re-investigate)

Every assumption in the dispatch was verified against live source + the live DB (project `gqnoajqerqhnvulmnyvv`, Supabase Management API direct SQL) on 2026-05-31. Results:

### 0.1 `seeding_cities` live column set (CONFIRMED — matches dispatch exactly)
`information_schema.columns` for `public.seeding_cities`, in ordinal order:

| # | column | type | nullable | default |
|---|--------|------|----------|---------|
| 1 | `id` | uuid | NO | `gen_random_uuid()` |
| 2 | `google_place_id` | text | NO | — |
| 3 | `name` | text | NO | — |
| 4 | `country` | text | NO | — |
| 5 | `country_code` | text | YES | — |
| 6 | `center_lat` | double precision | NO | — |
| 7 | `center_lng` | double precision | NO | — |
| 8 | `coverage_radius_km` | double precision | NO | `10` |
| 9 | `tile_radius_m` | integer | NO | `1500` |
| 10 | `status` | text | NO | `'draft'::text` |
| 11 | `created_at` | timestamptz | NO | `now()` |
| 12 | `updated_at` | timestamptz | NO | `now()` |
| 13 | `bbox_sw_lat` | double precision | **NO** | — |
| 14 | `bbox_sw_lng` | double precision | **NO** | — |
| 15 | `bbox_ne_lat` | double precision | **NO** | — |
| 16 | `bbox_ne_lng` | double precision | **NO** | — |

- `is_live_for_consumers` does **NOT** exist yet — this ORCH adds it (§A).
- The four `bbox_*` columns are `NOT NULL` on the live table. **Every existing row therefore HAS a bbox** (the column can't be null). The "bbox-present indicator" in the admin list (§B) is consequently a *belt-and-braces* / future-proofing indicator, not a frequently-false state today. Live data check: 17 rows, all `status='seeded'`, all with non-null bbox. Spec the indicator anyway (it documents intent and guards against a future nullable migration), but the implementor must know it will read "present" for all current rows.

### 0.2 `status` enum reality (CONFIRMED — independent of the new flag)
`status` is a plain `text` column with default `'draft'` (NOT a Postgres enum type; the four-value vocabulary `draft|seeding|seeded|launched` is enforced in app code/seeding pipeline, not a DB `CHECK`). All 17 live cities are `status='seeded'`, **zero** are `'launched'`. This *proves the operator's decision #1*: pipeline-`status` and operator-declared-consumer-readiness are genuinely orthogonal — 17 cities are pipeline-ready (`seeded`) but the operator has launched 0 to consumers. Do NOT overload `status`; the new boolean is the only consumer-launch authority.

### 0.3 RLS on `seeding_cities` (CONFIRMED — admin app can write directly)
Three policies live:
- `admin_write_seeding_cities` — `FOR ALL`, `USING` + `WITH CHECK` = `EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email() AND status='active')`.
- `authenticated_read_seeding_cities` — `FOR SELECT`, `USING auth.role() = 'authenticated'`.
- `service_role_all_seeding_cities` — `FOR ALL`, `USING auth.role() = 'service_role'`.

**Consequence:** the admin app (authenticated admin user session, anon key + JWT) can `UPDATE seeding_cities SET is_live_for_consumers = …` **directly via PostgREST** under `admin_write_seeding_cities`. A dedicated toggle RPC is therefore NOT strictly required for security. We still spec a thin SECURITY DEFINER toggle RPC (§A.3) for an auditable, single-purpose, atomic surface (sets flag + `updated_at`) — but the implementor MAY use a direct `.update()` if preferred; both are acceptable and gated identically by RLS. The list-fetch RPC (§A.2) IS required because the existing picker RPC is insufficient (next row).

### 0.4 Existing `admin_city_picker_data()` RPC (CONFIRMED — insufficient, must extend or add)
Live signature:
```
admin_city_picker_data() RETURNS TABLE(
  city_id uuid, city_name text, country_name text, country_code text,
  city_status text, is_servable_places bigint, total_active_places bigint
)  -- SECURITY DEFINER
```
It returns the servable/active place counts the list view needs, **but NOT** `is_live_for_consumers`, `center_lat/lng`, or the four `bbox_*` columns. **Do NOT mutate this RPC's return shape** — `PlacePoolManagementPage.jsx:2905` consumes it positionally/by-name and a shape change there is a cross-page regression risk. Instead add a NEW sibling RPC `admin_launch_city_list()` (§A.2) that returns the launch-tab columns. (Decision DEC-LC-1 below.)

### 0.5 `geocode_city` action (CONFIRMED — reuse verbatim for boundary refresh)
`supabase/functions/admin-seed-places/index.ts` → `handleGeocodeCity` (lines 1834–1906) + dispatch `case "geocode_city"` (line 1948). It calls
`https://maps.googleapis.com/maps/api/geocode/json?address=<query>&key=<GOOGLE_MAPS_API_KEY>` and returns `{ cityName, country, countryCode, formattedAddress, center:{lat,lng}, viewport:{swLat,swLng,neLat,neLng}, tileEstimates }`. It is admin-auth-gated (Bearer JWT → `admin_users` check) at the handler entry (lines 1916–1943). **No edge-function change needed for the boundary action** — the admin client already owns the call→persist pattern (next row).

### 0.6 Existing boundary-persist pattern (CONFIRMED — reuse verbatim)
`PlacePoolManagementPage.jsx:935–990` (the city-edit modal) already implements the *exact* "map/refresh boundary" flow: invoke `admin-seed-places {action:'geocode_city', query}` → `setGeocodeResult(data)` → on save `supabase.from("seeding_cities").update({ ...center, bbox_sw_lat: vp.swLat, bbox_sw_lng: vp.swLng, bbox_ne_lat: vp.neLat, bbox_ne_lng: vp.neLng, coverage_radius_km: 0, tile_radius_m, updated_at })`. The Launch-Cities tab's boundary action reuses this pattern (geocode → persist bbox). The overlap pre-check RPC `check_city_bbox_overlap(p_sw_lat,p_sw_lng,p_ne_lat,p_ne_lng,p_exclude_id)` is available and SHOULD be called informationally before persist (same as line 943).

### 0.7 Public point-in-bbox SQL pattern (CONFIRMED — canonical model for §C)
`check_city_bbox_overlap` (live def) is the canonical bbox-comparison RPC and the exact model for `check-launch-city`:
```sql
CREATE OR REPLACE FUNCTION public.check_city_bbox_overlap(...)
  RETURNS TABLE(id uuid, name text, country text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT sc.id, sc.name, sc.country FROM seeding_cities sc
  WHERE (p_exclude_id IS NULL OR sc.id != p_exclude_id)
    AND sc.bbox_sw_lat < p_ne_lat AND sc.bbox_ne_lat > p_sw_lat
    AND sc.bbox_sw_lng < p_ne_lng AND sc.bbox_ne_lng > p_sw_lng;
$$;
```
The point-in-bbox test in §C inverts this: a point `(lat,lng)` is inside a city bbox iff `bbox_sw_lat <= lat AND bbox_ne_lat >= lat AND bbox_sw_lng <= lng AND bbox_ne_lng >= lng`.

### 0.8 Indexes (CONFIRMED — none spatial)
Live indexes on `seeding_cities`: `pkey(id)`, `unique(google_place_id)`, `unique(name,country)`. No bbox/spatial index. At 17 rows total (live cities a strict subset), a sequential scan filtered by `is_live_for_consumers = true` is trivially fast. A GiST spatial index is **overkill and NOT specced**. A small **partial btree index on `is_live_for_consumers WHERE is_live_for_consumers` IS specced** (§A.1) so the live-subset filter stays index-eligible as the table grows past launch.

### 0.9 Admin nav + routing reality (CONFIRMED)
- `mingla-admin/src/lib/constants.js` → `NAV_GROUPS` is a single group (`label:null`) with a flat `items[]` array of `{id,label,icon}` (lines 122–140). `NAV_ITEMS = NAV_GROUPS.flatMap(g=>g.items)`.
- `mingla-admin/src/components/layout/Sidebar.jsx` iterates `NAV_GROUPS` → renders each item with `ICON_MAP[item.icon]`, `onClick={()=>onTabChange(item.id)}`, active = `activeTab===item.id` (lines 51–107). Icons come from a lucide `ICON_MAP`.
- `mingla-admin/src/App.jsx` → `PAGES` object maps `id → PageComponent` (lines 31–44); `getTabFromHash()` reads `#/<id>` and falls back to `overview` if `PAGES[hash]` is undefined (lines 46–49).
- There is **no dedicated Cities tab today** — city management lives inside `PlacePoolManagementPage.jsx` (the `admin_city_picker_data` picker + add/edit city modals). This ORCH adds the first dedicated Cities tab; it does NOT remove city mgmt from PlacePool (non-goal §2).

### 0.10 Migration collision check (CONFIRMED)
Max migration filename across THIS worktree AND all `~/Desktop/mingla-orchs/*/supabase/migrations/` is `20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql`. Chosen new prefix `20260810000000` (§A) is strictly greater than every existing/in-flight migration → no collision.

### 0.11 Comms ledger acks (read on entry)
- **COMMS-0002** (WARN, ALL): strict-grep C7 `no-new-backend-files` blocks backend PRs touching `supabase/functions/` or migrations unless allowlisted. **Applies** — this ORCH adds 1 migration + 1 edge function. Implementor checklist §H embeds the `ORCH_1027_BACKEND_ALLOWLIST` requirement in the same commit. Acked.
- **COMMS-0003** (WARN, ALL): external-API integration ORCHs must cite provider docs URLs inline at SPEC for every param/payload introduced. **Applies** to the Google Geocoding boundary action — docs cited in §B.4 + §H. Acked.

---

## 1. Goal (one paragraph)

Give Seth an admin-only switch to declare individual cities "live for consumers." The switch is a new boolean `seeding_cities.is_live_for_consumers` (default false), flipped from a new **Launch Cities** admin tab that lists every seeding city with its country, servable-place count, bbox-present indicator, a live toggle, and a "map/refresh boundary" action (reusing the existing Google-geocode→persist-bbox flow). The set of live cities is exposed to the consumer app through a new **public** edge function `check-launch-city` that, given a `{lat,lng}`, answers whether the point falls inside any live city's bounding box and returns the live-city list — the stable contract ORCH-1028's onboarding location gate will consume.

---

## 2. Scope & Non-Goals

### In scope
- **(A)** DB migration: add `is_live_for_consumers boolean NOT NULL DEFAULT false` + partial index; add list RPC `admin_launch_city_list()`; add toggle RPC `admin_set_city_live(p_city_id uuid, p_live boolean)`.
- **(B)** New **Launch Cities** admin tab (nav item + page + list view + toggle + boundary action). UI surface → requires a `mingla-designer` DESIGN pass (see §B.0).
- **(C)** New PUBLIC edge function `check-launch-city` (point-in-bbox over live cities) + its frozen request/response contract for ORCH-1028.
- Strict-grep allowlist + docs-citation per HARD GUARDS.

### Non-goals (explicit)
- **ORCH-1028 onboarding gate UI / consumer-app changes** — out of scope; only the §C contract is defined here.
- **Removing or refactoring city management inside `PlacePoolManagementPage.jsx`** — left intact; the new tab is additive. (Future consolidation is a separate ORCH.)
- **Changing the seeding `status` pipeline** — untouched. `is_live_for_consumers` is orthogonal (§0.2).
- **Auto-deriving live-status from pipeline status** — explicitly rejected by operator decision #1. The flag is operator-set only.
- **Multi-region / radius / polygon coverage** — determination is rectangular bbox only (matches existing `bbox_*` model + `check_city_bbox_overlap`). No `coverage_radius_km` circle test.
- **Geofencing precision beyond bbox** — bbox can include a little area outside the strict city limits; accepted (matches existing seeding coverage model).

### Assumptions
- ORCH-1028 will call `check-launch-city` with a device-resolved `{lat,lng}` (GPS or IP-geo). This SPEC does not constrain how 1028 obtains the point.
- Admin users authenticate with a Supabase session whose `auth.email()` is an active `admin_users` row (existing precondition for the admin app).

---

## 2.5 Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behaviour / files / parity |
|---|---------|----------|----------------------------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NO (contract only) | Does not render anything this ORCH. ORCH-1028 will call `check-launch-city`. This SPEC freezes that contract (§C). |
| 2 | Consumer Android (`app-mobile/` Android) | NO (contract only) | Same as #1. The edge fn is platform-agnostic JSON → automatic parity when 1028 builds. |
| 3 | Buyer/anonymous Web (`mingla-business/` public routes) | NO | No buyer-anon route exposes launch-city state; nothing to render here. |
| 4 | Business iOS (`mingla-business/` iOS) | NO | No business analog — launch-city is an admin/consumer concept, not a brand surface. |
| 5 | Business Android (`mingla-business/` Android) | NO | Same as #4. |
| 6 | **Admin Web (`mingla-admin/`)** — adjacent | **YES** | New Launch Cities tab: nav item, page, list, toggle, boundary action. Files: `mingla-admin/src/lib/constants.js`, `…/components/layout/Sidebar.jsx` (icon map only if new icon), `…/App.jsx`, NEW `…/pages/LaunchCitiesPage.jsx` (+ any sub-components). Single code path → no manual parity split. |
| 7 | Business Web preview — adjacent | NO | Not a business surface. |

The edge function (§C) is shared backend consumed by surfaces #1/#2 later — its parity is automatic (one JSON contract). The only *built* UI this ORCH is Admin Web (#6), so success criteria for UI are single-surface.

---

## A. Database layer

### A.1 Migration file
**Filename (collision-checked §0.10):** `supabase/migrations/20260810000000_orch_1027_launch_cities.sql`

```sql
-- ORCH-1027 [Launch Cities admin control]
-- Adds operator-controlled consumer-launch flag to seeding_cities, INDEPENDENT of
-- the seeding pipeline `status` column (DEC: pipeline-ready != operator-declared-ready).
-- Plus a partial index for the live-subset filter and two admin RPCs.

-- 1. The flag. Default false: no city is consumer-live until the operator flips it.
ALTER TABLE public.seeding_cities
  ADD COLUMN IF NOT EXISTS is_live_for_consumers boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.seeding_cities.is_live_for_consumers IS
  'ORCH-1027: operator-controlled. true = this city is live for consumer onboarding '
  '(source of truth for the ORCH-1028 location gate via check-launch-city edge fn). '
  'Orthogonal to status (pipeline state). Set only from the Launch Cities admin tab.';

-- 2. Partial index: the live subset is the only set check-launch-city ever scans.
--    Keeps the point-in-bbox query index-eligible as the table grows past launch.
CREATE INDEX IF NOT EXISTS seeding_cities_live_for_consumers_idx
  ON public.seeding_cities (is_live_for_consumers)
  WHERE is_live_for_consumers;

-- 3. Admin list RPC (Launch Cities tab). NEW — does NOT touch admin_city_picker_data.
--    Returns the launch-tab columns incl. the live flag, bbox presence, servable count.
CREATE OR REPLACE FUNCTION public.admin_launch_city_list()
  RETURNS TABLE(
    city_id uuid,
    city_name text,
    country_name text,
    country_code text,
    city_status text,
    is_live_for_consumers boolean,
    center_lat double precision,
    center_lng double precision,
    bbox_sw_lat double precision,
    bbox_sw_lng double precision,
    bbox_ne_lat double precision,
    bbox_ne_lng double precision,
    has_bbox boolean,
    is_servable_places bigint,
    total_active_places bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT
    sc.id,
    sc.name,
    sc.country,
    sc.country_code,
    sc.status,
    sc.is_live_for_consumers,
    sc.center_lat,
    sc.center_lng,
    sc.bbox_sw_lat,
    sc.bbox_sw_lng,
    sc.bbox_ne_lat,
    sc.bbox_ne_lng,
    (sc.bbox_sw_lat IS NOT NULL AND sc.bbox_ne_lat IS NOT NULL
       AND sc.bbox_sw_lng IS NOT NULL AND sc.bbox_ne_lng IS NOT NULL) AS has_bbox,
    COUNT(pp.id) FILTER (WHERE pp.is_servable AND pp.is_active) AS is_servable_places,
    COUNT(pp.id) FILTER (WHERE pp.is_active) AS total_active_places
  FROM seeding_cities sc
  LEFT JOIN place_pool pp ON pp.city_id = sc.id
  GROUP BY sc.id
  ORDER BY sc.is_live_for_consumers DESC, sc.name ASC;
$$;

-- Admin-only execution. SECURITY DEFINER bypasses RLS for the read, so we gate EXECUTE.
REVOKE ALL ON FUNCTION public.admin_launch_city_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_launch_city_list() TO authenticated;

-- 4. Toggle RPC. Atomic single-purpose flag set + updated_at bump.
--    Authorization: this RPC is SECURITY INVOKER so the existing
--    admin_write_seeding_cities RLS policy is the gate (active admin_users only).
CREATE OR REPLACE FUNCTION public.admin_set_city_live(p_city_id uuid, p_live boolean)
  RETURNS TABLE(city_id uuid, is_live_for_consumers boolean)
  LANGUAGE sql
  VOLATILE
  SECURITY INVOKER
  SET search_path TO 'public'
AS $$
  UPDATE public.seeding_cities
     SET is_live_for_consumers = p_live,
         updated_at = now()
   WHERE id = p_city_id
  RETURNING id, is_live_for_consumers;
$$;

REVOKE ALL ON FUNCTION public.admin_set_city_live(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_city_live(uuid, boolean) TO authenticated;
```

**DEC-LC-1 (why a new list RPC, not extend `admin_city_picker_data`):** §0.4 — the existing picker RPC is consumed by `PlacePoolManagementPage.jsx:2905`; changing its return shape risks a cross-page regression. A sibling RPC is additive and isolates the launch tab.

**DEC-LC-2 (toggle = SECURITY INVOKER, list = SECURITY DEFINER):** the toggle relies on the existing `admin_write_seeding_cities` RLS `WITH CHECK` (so only active admins can write) — INVOKER is correct and reuses the live policy. The list RPC aggregates a `LEFT JOIN place_pool` (large table, RLS-heavy); DEFINER + EXECUTE-gated-to-`authenticated` keeps it fast and admin-app-callable without re-deriving place_pool RLS. The `admin_launch_city_list` DEFINER read does not leak anything an admin can't already see; if a stricter gate is desired, the implementor MAY add an in-function `IF NOT EXISTS(SELECT 1 FROM admin_users WHERE email=auth.email() AND status='active') THEN RAISE …` guard — OPEN.

**🔒 LOCKED:** column name `is_live_for_consumers`, `boolean NOT NULL DEFAULT false`, the partial index predicate, migration filename `20260810000000_orch_1027_launch_cities.sql`, both RPC names + return shapes, `admin_city_picker_data` left UNTOUCHED.
**🎨 OPEN:** the optional in-function admin guard on the list RPC; whether the toggle is an RPC call or a direct `.update()` from the admin client (§0.3 — both RLS-equivalent).

### A.2 / A.3 RPC summary (names are the contract)
- `admin_launch_city_list()` → list-fetch for the tab (§B).
- `admin_set_city_live(p_city_id uuid, p_live boolean)` → flag toggle.

---

## B. Admin layer — "Launch Cities" tab

### B.0 Designer gate (MANDATORY before/with implement)
This tab has visible UI. Per the SPEC granularity protocol, the **granular visual contract (tokens, all 9 states, spacing, typography, motion, contrast ratios, light/dark) is produced by `mingla-designer`** in a DESIGN pass that THIS spec requires and references: `Mingla_Artifacts/specs/DESIGN_ORCH-1027_LAUNCH_CITIES_TAB.md`. The implementor must not ship pixels the designer hasn't pinned. This SPEC owns the **functional contract + IA + UX acceptance bar** below; the designer owns the pixel contract. (Admin uses Tailwind v4 + Framer Motion + existing admin component primitives — `SectionCard`, `Toast`, `Spinner` — designer reuses these.)

### B.1 Nav wiring (`constants.js` + `Sidebar.jsx` + `App.jsx`)
- **`mingla-admin/src/lib/constants.js`** — add ONE item to the single `NAV_GROUPS[0].items` array. Place it adjacent to `placepool` (it is the consumer-facing counterpart to the seeding/place tooling):
  ```js
  { id: "launch-cities", label: "Launch Cities", icon: "Rocket" },
  ```
  Insert after the `placepool` line (constants.js:129) so related city/place tools sit together. (Exact position is OPEN; LOCKED: `id:"launch-cities"`.)
- **`Sidebar.jsx`** — no code change IF `ICON_MAP` already includes `Rocket` (lucide-react). If not, add `Rocket` to the `ICON_MAP` import + map. (Implementor: verify `ICON_MAP` contents; if `Rocket` absent, add it — LOCKED that the icon resolves, OPEN which lucide glyph: `Rocket`/`Plane`/`Globe2` acceptable, must visually read as "go live / launch".)
- **`App.jsx`** — import `LaunchCitiesPage` and add `"launch-cities": LaunchCitiesPage` to the `PAGES` map (App.jsx:31–44). Hash route `#/launch-cities` then resolves automatically via `getTabFromHash`.

### B.2 Page component
**New file:** `mingla-admin/src/pages/LaunchCitiesPage.jsx` (default-or-named export consistent with sibling pages — match `PricingPage` export style).

**Data load:** on mount, `supabase.rpc("admin_launch_city_list")` → rows of the §A.1 shape. React Context patterns only (admin has no React Query — §0.9 / stack notes). Use the existing admin loading/error/toast primitives.

**List view (one row per city):** columns —
1. **City name** (`city_name`) + small muted `country_name` beneath or beside.
2. **Country** (`country_name` / `country_code` flag-ish text).
3. **Live toggle** — a switch bound to `is_live_for_consumers`. On change → call `admin_set_city_live(city_id, nextValue)` (or direct `.update()`), optimistic flip with rollback on error, success/error toast. Disable the toggle while the request is in flight.
4. **Servable-place count** — `is_servable_places` (and optionally `/ total_active_places` as `N servable / M active`).
5. **Bbox-present indicator** — `has_bbox` → a small "Boundary set ✓" / "No boundary" chip. (Will read ✓ for all current rows per §0.1 — still render it.)
6. **"Map / refresh boundary" action** — per-row button → opens the boundary flow (§B.4).

**Sort:** server already returns live-first then name-asc (§A.1 `ORDER BY`). The list may additionally offer a client-side filter "live only" (OPEN).

### B.3 UX acceptance bar (LOCKED — functional, designer fills pixels)
- Toggling a city ON must visibly + persistently flip the switch AND survive a page reload (proves DB write). A success toast confirms ("Lagos is now live for consumers." / "Lagos hidden from consumers.").
- Toggling OFF is symmetric and equally persistent.
- A failed toggle (network/RLS) must roll the switch back to its prior state AND surface an error toast — NEVER silently appear to succeed (Constitution rule 3: no silent failures).
- The list must show real servable counts from `admin_launch_city_list` — no fabricated/placeholder numbers (Constitution rule 9).
- Empty/loading/error states all render (the admin has primitives for each).

### B.4 "Map / refresh boundary" action (reuses existing flow — §0.5/§0.6)
1. Operator opens the action for a city (modal or inline panel). Input: an editable city-name/query field pre-filled with the city name.
2. Invoke the EXISTING edge action — no new edge fn:
   ```js
   const { data, error } = await supabase.functions.invoke("admin-seed-places", {
     body: { action: "geocode_city", query: query.trim() },
   });
   ```
   This calls Google Geocoding server-side. **Provider docs (COMMS-0003):** request format `https://maps.googleapis.com/maps/api/geocode/json?address={address}&key={key}` per <https://developers.google.com/maps/documentation/geocoding/requests-geocoding>; response fields used: `results[0].geometry.location.{lat,lng}` and `results[0].geometry.viewport.{southwest,northeast}.{lat,lng}`; status handling for `OK` / `ZERO_RESULTS` / `REQUEST_DENIED` per <https://developers.google.com/maps/documentation/geocoding/requests-geocoding#GeocodingResponses>. (The edge fn already implements exactly this — the admin client does not construct the Google URL itself.)
3. Optional informational overlap check: `supabase.rpc("check_city_bbox_overlap", { p_sw_lat, p_sw_lng, p_ne_lat, p_ne_lng, p_exclude_id: city.id })` (mirrors `PlacePoolManagementPage.jsx:943`).
4. Persist on confirm (mirrors `PlacePoolManagementPage.jsx:969`):
   ```js
   await supabase.from("seeding_cities").update({
     center_lat: data.center.lat, center_lng: data.center.lng,
     bbox_sw_lat: data.viewport.swLat, bbox_sw_lng: data.viewport.swLng,
     bbox_ne_lat: data.viewport.neLat, bbox_ne_lng: data.viewport.neLng,
     updated_at: new Date().toISOString(),
   }).eq("id", city.id);
   ```
   (LOCKED: this action ONLY refreshes center+bbox; it MUST NOT touch `is_live_for_consumers`, `status`, `tile_radius_m`, or trigger tile regeneration — those belong to the PlacePool seeding flow, not the launch tab. Keeping it bbox-only avoids stepping on the seeding pipeline.)
5. On success, re-fetch `admin_launch_city_list` so the bbox-present chip + any derived display refresh.

**🔒 LOCKED:** reuse `admin-seed-places {action:'geocode_city'}` (no new edge fn for boundary); persist only center+bbox+updated_at; never mutate the live flag from this action; Google docs cited.
**🎨 OPEN:** modal-vs-inline presentation, whether a Leaflet `<Rectangle>` preview (admin already uses Leaflet — `PlacePoolManagementPage.jsx:1231`) is shown, micro-copy.

---

## C. Public edge function `check-launch-city` (FROZEN CONTRACT for ORCH-1028)

### C.1 Identity
- **Path:** `supabase/functions/check-launch-city/index.ts`
- **Method:** `POST` (also handle `OPTIONS` for CORS preflight). Reject other methods with 405.
- **Auth:** **`verify_jwt = false`** (consumer-callable BEFORE sign-in — the onboarding location gate runs at app launch, possibly pre-auth). Add to `supabase/config.toml`:
  ```toml
  [functions.check-launch-city]
  verify_jwt = false
  ```
  Rationale: ORCH-1028 gates onboarding, which can precede authentication; precedent — `events`, `discover-merged-events`, `waitlist-signup`, `weather` are all `verify_jwt=false` (§config.toml). The function exposes ONLY non-sensitive city geometry already implied by a public map; no PII, no auth-scoped data. (LOCKED.)
- CORS: standard `corsHeaders` (mirror sibling public fns).

### C.2 Request schema (LOCKED)
```ts
// POST body
interface CheckLaunchCityRequest {
  lat: number;   // required, finite, -90..90
  lng: number;   // required, finite, -180..180
}
```
Validation: both present, `typeof === "number"`, finite, in range. On invalid → 400 with `{ error: "lat and lng are required finite numbers in range" }`.

### C.3 Response schema (LOCKED — this is what ORCH-1028 builds against)
```ts
interface LaunchCity {
  id: string;            // seeding_cities.id (uuid)
  name: string;          // seeding_cities.name
  center_lat: number;    // seeding_cities.center_lat
  center_lng: number;    // seeding_cities.center_lng
}

interface LaunchCityWithBbox extends LaunchCity {
  bbox_sw_lat: number;
  bbox_sw_lng: number;
  bbox_ne_lat: number;
  bbox_ne_lng: number;
}

interface CheckLaunchCityResponse {
  inLaunchCity: boolean;            // true iff (lat,lng) falls inside >=1 live city's bbox
  matchedCity: LaunchCity | null;  // the first/nearest matched live city, else null
  liveCities: LaunchCityWithBbox[]; // ALL live cities (for client-side fallback/UI), bbox included
}
```
- `matchedCity` is `null` when `inLaunchCity === false`.
- When multiple live bboxes contain the point (overlap is possible — §0.6 overlap is informational, not forbidden), `matchedCity` = the one whose `center` is **nearest** to the input point (deterministic tiebreak). LOCKED: deterministic single match; OPEN: nearest-center is the chosen rule (acceptable; document it in code).
- `liveCities` always returns the full live set (even when matched) so ORCH-1028 can render "available cities" UX without a second call. Order: name asc.
- **Empty case:** if NO city is live, `{ inLaunchCity:false, matchedCity:null, liveCities:[] }` with HTTP 200 (not an error — "no launch cities yet" is a valid state).

### C.4 Error shapes (LOCKED)
| Condition | HTTP | Body |
|-----------|------|------|
| Valid request, point inside a live city | 200 | full response, `inLaunchCity:true` |
| Valid request, point outside all / no live cities | 200 | `inLaunchCity:false`, `matchedCity:null`, `liveCities:[…]` |
| Missing/invalid `lat`/`lng` | 400 | `{ error: "lat and lng are required finite numbers in range" }` |
| Wrong method | 405 | `{ error: "Method not allowed" }` |
| DB/unexpected error | 500 | `{ error: "Internal error" }` (no internal detail leaked) |

### C.5 Determination SQL (LOCKED — point-in-bbox over live cities)
Implement via a dedicated SECURITY DEFINER RPC (callable by anon, since verify_jwt=false means the fn runs with the anon role unless using service-role client). **Two acceptable implementations — pick one, both LOCKED-equivalent:**

**Option 1 (preferred): the edge fn uses the SERVICE-ROLE client** (`SUPABASE_SERVICE_ROLE_KEY`) and runs a plain SELECT — no new RPC, no anon GRANT surface:
```sql
SELECT id, name, center_lat, center_lng,
       bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng
FROM public.seeding_cities
WHERE is_live_for_consumers = true
ORDER BY name ASC;
```
The edge fn fetches the live set once, then computes `inLaunchCity` + `matchedCity` in TypeScript:
```ts
const inside = (c) =>
  c.bbox_sw_lat <= lat && c.bbox_ne_lat >= lat &&
  c.bbox_sw_lng <= lng && c.bbox_ne_lng >= lng;
```
This keeps anon GRANTs off the table and reuses the partial index (`WHERE is_live_for_consumers`). **This is the recommended path** (mirrors how other public fns use the service-role client behind `verify_jwt=false`).

**Option 2 (if a DB-side RPC is preferred):** a SECURITY DEFINER RPC `public.check_launch_city(p_lat, p_lng)` granted to `anon`, doing the point-in-bbox in SQL and returning both the match and the full live set. If chosen, it must `REVOKE ALL … FROM PUBLIC` then `GRANT EXECUTE … TO anon, authenticated`, `STABLE`, `SET search_path TO 'public'`, modeled on `check_city_bbox_overlap` (§0.7). Adds the RPC to the migration (§A.1) and the allowlist.

**🔒 LOCKED:** point-in-bbox inclusive bounds (`<=`/`>=`), only `is_live_for_consumers = true` rows, response shape §C.3, error shapes §C.4, `verify_jwt=false`. **🎨 OPEN:** Option 1 vs Option 2; nearest-center tiebreak implementation detail; in-memory vs SQL distance for the tiebreak.

### C.6 No external API in this fn
`check-launch-city` calls NO third-party API (pure DB read). COMMS-0003 external-docs citation applies only to the boundary action (§B.4), which is satisfied.

---

## D. Success Criteria (numbered, observable, testable)

- **SC-1 (DB column):** `seeding_cities.is_live_for_consumers` exists as `boolean NOT NULL DEFAULT false`; every pre-existing row reads `false` immediately post-migration. Verify: `SELECT is_live_for_consumers, count(*) FROM seeding_cities GROUP BY 1;` → all 17 rows `false`.
- **SC-2 (index):** `seeding_cities_live_for_consumers_idx` partial index exists with predicate `WHERE is_live_for_consumers`. Verify via `pg_indexes`.
- **SC-3 (list RPC):** `admin_launch_city_list()` returns one row per seeding city with correct `is_live_for_consumers`, `has_bbox`, and `is_servable_places` matching `place_pool` (servable+active) counts; `admin_city_picker_data` return shape is BYTE-UNCHANGED.
- **SC-4 (toggle persists):** Flipping a city ON in the tab → `admin_set_city_live` (or `.update()`) sets the DB flag true; reload shows it still ON. Flipping OFF reverses it. Verify: toggle in UI, then `SELECT is_live_for_consumers FROM seeding_cities WHERE id=…`.
- **SC-5 (toggle failure safety):** When the toggle write fails (simulate RLS denial / network kill), the switch rolls back to its prior visual state AND an error toast appears; the DB is unchanged.
- **SC-6 (nav + route):** "Launch Cities" appears in the admin sidebar with a launch-reading icon; clicking it routes to `#/launch-cities` and renders the page; `admin_city_picker_data`-driven PlacePool page is unaffected.
- **SC-7 (boundary action):** Running "map/refresh boundary" for a city geocodes via `admin-seed-places {geocode_city}`, persists new center+bbox to that row, refreshes the bbox-present chip, and does NOT alter `is_live_for_consumers`, `status`, or `tile_radius_m`.
- **SC-8 (edge — inside):** `POST check-launch-city {lat,lng}` for a point inside a live city's bbox returns HTTP 200, `inLaunchCity:true`, `matchedCity` = that city (`{id,name,center_lat,center_lng}`), and `liveCities` containing all live cities with bbox.
- **SC-9 (edge — outside):** Same with a point outside all live cities → 200, `inLaunchCity:false`, `matchedCity:null`, `liveCities:[…]` (full live set).
- **SC-10 (edge — none live):** With zero live cities → 200, `inLaunchCity:false`, `matchedCity:null`, `liveCities:[]`.
- **SC-11 (edge — validation):** Missing/NaN/out-of-range `lat`/`lng` → 400 with the exact error body (§C.4); wrong method → 405; no stack/internal leak on 500.
- **SC-12 (edge — auth):** `check-launch-city` is callable with NO Authorization header (verify_jwt=false) and returns a valid response — proving ORCH-1028 can call it pre-auth.
- **SC-13 (gates):** `ORCH_1027_BACKEND_ALLOWLIST` added in the SAME commit as the migration + edge fn; ORCH-0863 C7 `no-new-backend-files` passes; Google docs URL cited in SPEC (this file) for the boundary action.

---

## E. Invariants

| ID | Invariant | Preserved by | Verified by |
|----|-----------|--------------|-------------|
| I-LC-STATUS-ORTHOGONAL (NEW) | `is_live_for_consumers` is NEVER derived from or coupled to `status`; only operator action sets it. | No trigger/RPC couples them; toggle sets only the flag (§A.1). | Code read + SC-1/SC-4. |
| I-LC-DEFAULT-FALSE (NEW) | A new seeding city is NOT consumer-live until explicitly flipped. | `DEFAULT false NOT NULL`. | SC-1. |
| I-LC-CONTRACT-STABLE (NEW) | `check-launch-city` response shape (§C.3) is frozen for ORCH-1028; additive-only changes thereafter. | Contract documented; tests assert exact keys. | SC-8/9/10. |
| I-LC-PUBLIC-NO-PII (NEW) | `check-launch-city` exposes only city geometry (id/name/center/bbox) — never admin/PII/auth-scoped fields. | SELECT lists exact columns (§C.5). | Code read + response audit. |
| I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED (COMMS-0003) | Google Geocoding params/payload cited from provider docs. | §B.4 citations. | SC-13. |
| I-COMMS-0002-BACKEND-ALLOWLIST | New `supabase/functions/` + migration files allowlisted in same commit. | §H checklist. | SC-13 / CI. |
| `admin_city_picker_data` UNCHANGED (existing consumer) | PlacePool page keeps working. | New sibling RPC, not a mutation (DEC-LC-1). | SC-3/SC-6. |

---

## F. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Migration adds column | run migration | `is_live_for_consumers boolean NOT NULL DEFAULT false`; 17 rows false | DB |
| T-02 | Partial index present | inspect `pg_indexes` | `…_live_for_consumers_idx WHERE is_live_for_consumers` exists | DB |
| T-03 | List RPC shape + counts | `SELECT * FROM admin_launch_city_list()` | rows with flag, has_bbox=true (all current), servable counts match manual `place_pool` count | DB/RPC |
| T-04 | Picker RPC untouched | diff `admin_city_picker_data` def pre/post | byte-identical | DB |
| T-05 | Toggle ON persists | toggle Lagos ON | DB flag true; reload shows ON; toast | Full stack |
| T-06 | Toggle OFF persists | toggle Lagos OFF | DB flag false; reload OFF | Full stack |
| T-07 | Toggle failure rollback | kill network mid-toggle | switch reverts; error toast; DB unchanged | Hook+Component |
| T-08 | Nav + route | click Launch Cities | `#/launch-cities` renders; PlacePool still works | Admin routing |
| T-09 | Boundary refresh | run action on a city | center+bbox updated; flag/status/tile_radius unchanged; chip refreshes | Full stack |
| T-10 | Boundary geocode failure | bad query → ZERO_RESULTS | error surfaced; no DB write | Edge+Component |
| T-11 | Edge inside | live city + interior point | 200, inLaunchCity:true, matchedCity set, liveCities full | Edge+DB |
| T-12 | Edge outside | live city + exterior point | 200, inLaunchCity:false, matchedCity:null, liveCities full | Edge+DB |
| T-13 | Edge none-live | no live cities + any point | 200, inLaunchCity:false, matchedCity:null, liveCities:[] | Edge+DB |
| T-14 | Edge overlap tiebreak | point inside 2 overlapping live bboxes | matchedCity = nearest-center; deterministic across calls | Edge |
| T-15 | Edge validation | `{lat:"x"}` / missing / out-of-range / GET | 400 / 400 / 400 / 405; exact bodies | Edge |
| T-16 | Edge pre-auth | POST with NO auth header | 200 valid response (verify_jwt=false) | Edge+config |
| T-17 | Edge no-leak on 500 | force DB error | 500 `{error:"Internal error"}`, no stack/detail | Edge |
| T-18 | Strict-grep C7 | open PR with migration+edge fn | C7 passes via `ORCH_1027_BACKEND_ALLOWLIST` | CI |

---

## G. Implementation order

1. **Migration** `20260810000000_orch_1027_launch_cities.sql` (§A.1) — column + index + 2 RPCs.
2. **Strict-grep allowlist** — add `ORCH_1027_BACKEND_ALLOWLIST` (§H) in the SAME commit as step 1 + step 3.
3. **Edge function** `supabase/functions/check-launch-city/index.ts` (§C) + `supabase/config.toml` `[functions.check-launch-city] verify_jwt=false` + Deno tests.
4. **Admin nav** — `constants.js` item + `Sidebar.jsx` icon (if needed) + `App.jsx` PAGES entry (§B.1).
5. **Admin page** `LaunchCitiesPage.jsx` + list + toggle + boundary action (§B.2–B.4) — AFTER / alongside the `mingla-designer` DESIGN pass (§B.0).
6. **Tests** — Deno edge tests (T-11..T-17) co-located in `supabase/functions/check-launch-city/__tests__/`; DB assertions T-01..T-04; admin smoke for T-05..T-10.

DB-push + edge-deploy are operator/orchestrator actions at CLOSE — NOT performed in SPEC or IMPLEMENT (per autonomy posture; `db push` by operator, edge deploy by orchestrator from main).

---

## H. Implementor checklist (HARD GUARDS — do not skip)

- [ ] **COMMS-0002 strict-grep allowlist (SAME COMMIT as migration + edge fn).** In `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, add a new block modeled on the `ORCH_1017_BACKEND_ALLOWLIST` (lines 1092–1100) and wire it into the spread list (after `...ORCH_1017_BACKEND_ALLOWLIST,` ~line 1205):
  ```js
  // ORCH-1027 [Launch Cities admin control]: adds the consumer-launch flag
  // migration + the public check-launch-city edge fn (ORCH-1028 location-gate
  // contract). C7 is scoped to ORCH-0863 marketing; these are launch-cities
  // backend touches.
  const ORCH_1027_BACKEND_ALLOWLIST = [
    "supabase/migrations/20260810000000_orch_1027_launch_cities.sql",
    "supabase/functions/check-launch-city/index.ts",
    "supabase/functions/check-launch-city/__tests__/check_launch_city.test.ts",
    // add any additional test files created
  ];
  ```
  then add `...ORCH_1027_BACKEND_ALLOWLIST,` to the aggregated spread. Run the gate locally before push.
- [ ] **COMMS-0003 / external-API docs cited.** The boundary action's Google Geocoding usage is documented from provider docs in §B.4 — keep those URLs inline in any implementation comment touching the geocode call. (`check-launch-city` calls no external API — note that in its header comment.)
- [ ] **`admin_city_picker_data` untouched** — verify byte-identical (T-04).
- [ ] **`is_live_for_consumers` never coupled to `status`** (I-LC-STATUS-ORTHOGONAL) — no trigger/derivation.
- [ ] **Boundary action mutates ONLY center+bbox+updated_at** — never the flag/status/tiles (§B.4 LOCKED).
- [ ] **`verify_jwt=false`** for `check-launch-city` in `config.toml`; no PII in the response (I-LC-PUBLIC-NO-PII).
- [ ] **Migration filename** exactly `20260810000000_orch_1027_launch_cities.sql` (collision-checked §0.10).
- [ ] **Designer pass** `DESIGN_ORCH-1027_LAUNCH_CITIES_TAB.md` exists + referenced before shipping pixels (§B.0).
- [ ] **No `db push` / no edge deploy** from implement — leave for CLOSE.

---

## I. Regression prevention

- **Class:** "operator-control flag silently overloaded onto pipeline status." Safeguard: I-LC-STATUS-ORTHOGONAL + the COMMENT on the column documenting the decision + T-03 (separate columns). A future dev cannot collapse them without failing the invariant test.
- **Class:** "public edge contract drift breaks downstream ORCH." Safeguard: §C.3 frozen contract + Deno tests asserting exact response keys (T-11..T-13) + I-LC-CONTRACT-STABLE. ORCH-1028 builds against the typed shape.
- **Class:** "new backend file blocks the PR (C7)." Safeguard: §H allowlist step in the same commit; T-18.
- **Protective comments:** the column COMMENT (§A.1) and the `check-launch-city` header comment naming ORCH-1028 as the consumer explain the "why" at the code site.

---

## J. Open questions for operator (none blocking)

1. Icon glyph for the nav item — `Rocket` proposed (OPEN, designer may override).
2. Whether the boundary "refresh" should optionally regenerate seeding tiles — **SPEC says NO** (keeps launch tab decoupled from seeding). Flag if operator wants the launch tab to also re-seed.

None of these block IMPLEMENT.
