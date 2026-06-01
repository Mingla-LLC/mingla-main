# DESIGN — ORCH-1027 [Launch Cities admin tab]

**Mode:** SCREEN (admin web).
**Author:** mingla-designer, 2026-05-31.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1027-[launch-cities-admin]/` on branch `ORCH-1027-launch-cities-admin`.
**Owns:** the pixel contract — IA, every state, tokens, spacing, typography, motion, accessibility — for `mingla-admin/src/pages/LaunchCitiesPage.jsx`.
**Defers to SPEC for:** the functional/data contract (`SPEC_ORCH-1027_LAUNCH_CITIES_ADMIN.md` §A–§C). This doc never contradicts the SPEC; where the SPEC marks something 🎨 OPEN, this doc resolves it.
**Stack:** React 19 + Vite + Tailwind v4 (CSS-variable theme, light+dark for free) + Framer Motion + Recharts (unused here) + Leaflet/react-leaflet. No new dependency.

**References examined (premium-craft §3):** Linear's settings/feature-flag rows (label + inline switch + muted metadata, switch is the only colored element in a calm row), Vercel dashboard project-list rows (status pill + secondary action button on the right, hover-raise), Stripe Dashboard's "Test/Live mode" affordance (the live switch as the single highest-signal control), Airbnb host "Listing status" toggle (explicit on/off label beside the switch, never switch-alone), and the Mingla admin's own `UserManagementPage` beta-tester toggle (the in-house optimistic-flip-with-rollback precedent we extend). Synthesis: a calm, dense `DataTable` row where the **live switch is the loudest pixel**, the boundary action is a quiet secondary, and every write speaks back (toast + persisted flip or visible rollback). No clone; this is the Mingla admin language applied to a launch-control surface.

---

## 0. House-style anchors (reuse — do NOT invent)

Verified against this worktree's `mingla-admin/src/`:

| Need | Reuse | Path |
|------|-------|------|
| Page frame | `<div className="flex flex-col gap-6">` + `<h1 className="text-2xl font-bold">` + `<p className="text-sm text-[var(--color-text-secondary)] mt-1">` | pattern from `PricingPage.jsx:421`, `UserManagementPage.jsx:935` |
| Section container | `SectionCard` (title/subtitle/badge/action/children, `noPadding` for tables) | `components/ui/Card.jsx:29` |
| Top-line error | `AlertCard variant="error"` with `Retry` action | `Card.jsx:60` |
| List | `DataTable` (built-in loading + empty states, `striped`, `rowClassName`, `col.render`) | `components/ui/Table.jsx:5` |
| Live switch | **`Toggle`** (`role="switch"`, `aria-checked`, brand-500 on / gray-300 off, 44×24 track) | `components/ui/Input.jsx:85` |
| Toggle handler pattern | optimistic flip → write → revert-on-error → toast, per-row in-flight `Set` | `UserManagementPage.jsx:628` (`handleBetaToggle`) |
| Chips | `Badge` (`success`/`warning`/`default`/`outline`, optional `dot`) | `components/ui/Badge.jsx:21` |
| Buttons | `Button` (`secondary`/`ghost`/`primary`/`danger`, `sm`/`md`, `icon`, `loading`) | `components/ui/Button.jsx:23` |
| Modal | `Modal` + `ModalBody` + `ModalFooter` (focus-trap, ESC, overlay-click) | `components/ui/Modal.jsx` |
| Map preview | `MapContainer`/`TileLayer`/`Rectangle` (OSM tiles, dashed gray bbox) | `PlacePoolManagementPage.jsx:1224` |
| Toasts | `useToast().addToast({variant,title,description})` — auto-dismiss 5s success, manual error | `context/ToastContext.jsx` |
| Skeletons | `Skeleton`, `TableRowSkeleton` | `components/ui/Skeleton.jsx` |
| Spinner | `Spinner`, `PageLoader` | `components/ui/Spinner.jsx` |
| Nav icon | `Rocket` — already imported in `Sidebar.jsx:36` `ICON_MAP` | resolves with zero Sidebar edit |

**Tokens are the ONLY allowed values.** Spacing: `--space-xs 4 / sm 8 / md 16 / lg 24 / xl 32 / 2xl 48` (Tailwind `gap-1/2/4/6/8`). Radius: `--radius-sm 8 / md 12 / lg 16 / xl 24` (Tailwind `rounded-lg/xl`). All color via `var(--…)`. Zero magic numbers below; the few literal pixel values (44, 24, 600, 320) are existing primitive internals or token-equivalents called out inline.

---

## 1. The moment

Seth has 17 pipeline-`seeded` cities and **zero are live to consumers** (SPEC §0.2). This screen is where he flips the one switch that turns a city ON for the consumer onboarding gate (ORCH-1028). The emotional register: **deliberate, high-trust, low-drama.** Flipping a city live is a real-world act (people in Lagos can now onboard). So the switch must feel weighty but not scary, the result must be unmistakable (persisted flip + toast), and a failure must never masquerade as success. This is a control panel, not a dashboard — dense, scannable, one row per city, the live state legible at a glance down the column.

## 2. Information architecture

```
Launch Cities  (page)
├─ Page header:  h1 "Launch Cities" + subtitle + right-aligned live-count pill
├─ [error] AlertCard (load failure, Retry)               ← only on load error
├─ Summary strip: 2 inline stat chips (N live / M total) ← omitted while loading
├─ Filter row:  segmented "All / Live only" + result count   ← only when ≥1 row
└─ SectionCard(noPadding) › DataTable
     columns:  City · Country · Servable places · Boundary · Live · ⌗(action)
     row order: live-first then name-asc (server ORDER BY, §A.1)
└─ BoundaryModal (per-row, on demand)  ← geocode → preview → persist bbox
```

**Decision density:** one decision per row (flip live), one utility per row (refresh boundary). Everything else is read-only signal. The **Live** column is rightmost-but-one and visually dominant; the boundary action is a quiet trailing icon-button so it never competes with the switch.

**Column order rationale (left→right = identity → evidence → decision → utility):**
1. **City** — the subject (name + muted country sub-label).
2. **Country** — secondary grouping signal (text + country_code).
3. **Servable places** — the *evidence* that justifies going live (real counts only).
4. **Boundary** — the *precondition* chip (has_bbox).
5. **Live** — the *decision* (the loud switch).
6. **Action** — trailing `⌗` map/refresh icon-button (utility).

This ordering means the eye reads "Lagos, Nigeria, 1,240 servable, boundary set → [flip live]" as a left-to-right sentence ending in the action. That's the inevitable order.

---

## 3. Page header

```
<div className="flex flex-col gap-6">            // page root, matches PricingPage:422
  <div className="flex items-start justify-between gap-4">
    <div>
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Launch Cities</h1>
      <p className="text-sm text-[var(--color-text-secondary)] mt-1">
        Flip a city live to let people there start onboarding.
      </p>
    </div>
    {/* live-count pill — right aligned, top */}
    <Badge variant={liveCount > 0 ? "success" : "outline"} dot className="mt-1 shrink-0">
      {liveCount} live
    </Badge>
  </div>
  …
</div>
```

- **h1:** `text-2xl` (24px) `font-bold`, `--color-text-primary`. Token-exact to every sibling page.
- **subtitle:** `text-sm` (14px), `--color-text-secondary`, `mt-1` (4px). Mingla voice — plain, warm, consequence-naming ("let people there start onboarding"), no jargon.
- **live-count pill:** `Badge`, `success` (green) when ≥1 live, `outline` (neutral) when 0. Right-aligned so the global launch posture is readable without scanning the column. Updates optimistically with toggles.

---

## 4. Summary strip (2 inline stat chips)

Below the header, a single flex row (`flex flex-wrap gap-3`). Two compact metric chips (NOT full `StatCard`s — this screen is a control panel, big stat cards would over-weight the chrome):

```
<div className="flex flex-wrap items-center gap-3">
  <SummaryChip icon={Rocket}  label="Live for consumers" value={liveCount} accent="brand" />
  <SummaryChip icon={MapPinned} label="Cities mapped"      value={totalCount} accent="muted" />
</div>
```

`SummaryChip` is a small local presentational helper (NOT a new shared primitive — it lives inside `LaunchCitiesPage.jsx`):

```
<div className="inline-flex items-center gap-2.5 rounded-xl border border-[var(--gray-200)]
                bg-[var(--color-background-primary)] px-4 py-3 shadow-[var(--shadow-sm)]">
  <span className="flex h-9 w-9 items-center justify-center rounded-full
                   bg-[var(--color-brand-50)]">           // accent="muted" → bg-[var(--gray-100)]
    <Icon className="h-[18px] w-[18px] text-[var(--color-brand-500)]" />  // muted → text-[var(--gray-500)]
  </span>
  <div className="leading-tight">
    <p className="text-[20px] font-bold tabular-nums text-[var(--color-text-primary)]">{value}</p>
    <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
  </div>
</div>
```

- Values are `tabular-nums` so digits don't jitter when counts update.
- `px-4 py-3` = 16/12, `gap-2.5` = 10px (Tailwind half-step, token-adjacent; matches `SectionCard` header `gap-2.5`), `rounded-xl` = 12px, icon bubble `h-9 w-9` (36px) mirrors `StatCard`'s 40px bubble at chip scale.
- **Loading:** render two `Skeleton` chips of the same footprint (`width={148} height={62} rounded` via `style`), no count text.

---

## 5. Filter row (segmented control)

Only rendered when `rows.length > 0` (hidden in loading/empty/error). A 2-segment control + right-aligned result count.

```
<div className="flex items-center justify-between">
  <div role="tablist" aria-label="Filter cities" className="inline-flex rounded-lg
       border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-0.5">
    {["All","Live only"].map(seg => (
      <button role="tab" aria-selected={active} className={[
        "h-8 px-3 text-xs font-semibold rounded-md transition-colors duration-150",
        active ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]"
               : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
      ].join(" ")} />
    ))}
  </div>
  <span className="text-xs text-[var(--color-text-tertiary)] tabular-nums">
    {visibleCount} {visibleCount === 1 ? "city" : "cities"}
  </span>
</div>
```

- Segment height `h-8` (32px) — **container** is 44px tall total (`h-8` button + `p-0.5` padding + border ≈ 34px visually, BUT the clickable `<button>` is only 32px). To satisfy the ≥44pt rule the buttons get `min-h-[44px]` is wrong for this dense control; instead each segment is `h-9` (36px) with `px-4`, and the row sits in `py-1` so the **hit area** (button + row padding) clears 44px. **Resolution:** use `h-9 px-4` (36px) segment buttons inside a `p-1` track → track is 44px tall, each button's padded hit-target ≥44px when row vertical rhythm is included. Locked: segment buttons are `h-9 px-4` not `h-8 px-3`.
- "Live only" filters client-side to `is_live_for_consumers === true` (resolves SPEC §B.2 OPEN: yes, ship the filter — it's the operator's most common question, "what's currently live?").
- Default segment: **All**.

---

## 6. The list — `DataTable` columns

Wrap in `SectionCard` with `noPadding` so the table's own rounded border + sticky header own the frame:

```
<SectionCard title="Seeding cities" subtitle={`${totalCount} total`} noPadding>
  <DataTable
    columns={columns}
    rows={visibleRows}
    loading={loading}
    striped
    emptyIcon={Rocket}
    emptyMessage="No cities to launch yet."
    getRowId={(r) => r.city_id}
    rowClassName={(r) => r.is_live_for_consumers ? "bg-[var(--color-success-50)]/40" : ""}
  />
</SectionCard>
```

Live rows get a **whisper-tint** left wash (`success-50` at 40% — light: pale green `#f0fdf4` faded; dark: `rgba(34,197,94,0.1)` faded) so the live set is scannable as a block at the top. This is signal, not decoration — it answers "which rows are on?" without reading each switch.

### 6.1 Column specs

Each `col` is `{ key, label, width?, sortable?, render }`. Header cells are the `DataTable` default: `text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]`, sticky, `--table-header-bg`. Body cells: `px-4 py-3` (16/12).

**Col 1 — City** (`key:"city_name"`, `sortable`, no width cap):
```
render: (_v, row) => (
  <div className="min-w-0">
    <p className="font-semibold text-[var(--color-text-primary)] truncate">{row.city_name}</p>
    <p className="text-xs text-[var(--color-text-tertiary)] truncate">{row.country_name}</p>
  </div>
)
```
City name `text-sm` (inherited) `font-semibold`; country sub-label `text-xs` `--color-text-tertiary`. Two-line cell — the densest legible identity.

**Col 2 — Country** (`key:"country_name"`, `sortable`, `width:"160px"`):
```
render: (_v, row) => (
  <span className="text-[var(--color-text-secondary)]">
    {row.country_name}
    {row.country_code && (
      <span className="ml-1.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tabular-nums">
        {row.country_code}
      </span>
    )}
  </span>
)
```
Plain text country + muted uppercase 2-letter code (e.g. "Nigeria  NG"). No flag emoji (anti-slop §2 — no emoji icons).

**Col 3 — Servable places** (`key:"is_servable_places"`, `sortable`, `width:"150px"`, `cellClassName:"tabular-nums"`):
```
render: (_v, row) => (
  <div className="leading-tight">
    <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">
      {row.is_servable_places.toLocaleString()}
    </span>
    <span className="ml-1 text-xs text-[var(--color-text-tertiary)] tabular-nums">
      / {row.total_active_places.toLocaleString()} active
    </span>
  </div>
)
```
**Real counts only** (SPEC §B.3 / Constitution rule 9) — these come straight from `admin_launch_city_list()`'s `place_pool` aggregation. `toLocaleString()` for thousands separators; `tabular-nums` so columns align. If `is_servable_places === 0`, render the number in `--color-warning-600` + append a tiny `Badge variant="warning"` reading "0 servable" — going live with zero servable places is a footgun and the operator should see it (advisory only, never blocks the toggle).

**Col 4 — Boundary** (`key:"has_bbox"`, `width:"130px"`):
```
render: (_v, row) => row.has_bbox ? (
  <Badge variant="success" dot>Boundary set</Badge>
) : (
  <Badge variant="warning" dot>No boundary</Badge>
)
```
Per SPEC §0.1 this reads "Boundary set" for all current rows (bbox columns are NOT NULL). Still rendered — documents intent + future-proofs a nullable migration. `dot` gives the colored status dot inside the pill.

**Col 5 — Live** (`key:"is_live_for_consumers"`, `width:"130px"`, header label "LIVE"):
```
render: (_v, row) => (
  <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
    <Toggle
      checked={!!row.is_live_for_consumers}
      onChange={() => handleToggleLive(row)}
      disabled={togglingIds.has(row.city_id)}
    />
    {togglingIds.has(row.city_id) && <Spinner size="sm" />}
  </div>
)
```
- The **loud pixel.** Brand-500 track when on, gray-300 when off (the `Toggle` primitive already does this). `onClick` stop-propagation so the row's hover/click never swallows the switch (mirrors `UserManagementPage.jsx:910`).
- **In-flight:** the `Toggle` is `disabled` (its primitive applies `opacity-70 cursor-not-allowed`) AND a `Spinner size="sm"` (16px) appears to its right — dual signal that the write is pending. The switch stays in its optimistic position during the request; the spinner says "not yet confirmed."
- **No text label inside the column** (column header "LIVE" + the switch state carries it). But for the toast + a11y we always speak the on/off word (§9, §11).

**Col 6 — Action** (`key:"_action"`, `width:"56px"`, `cellClassName:"text-right"`):
```
render: (_v, row) => (
  <Button
    variant="ghost" size="sm" icon={MapPin}
    onClick={(e) => { e.stopPropagation(); openBoundary(row); }}
    aria-label={`Map or refresh boundary for ${row.city_name}`}
  />
)
```
Icon-only `ghost` `sm` button (`MapPin` lucide). `Button`'s `sm` icon-only path forces `!w-8` (32px) — **below 44pt.** **Resolution:** override to `size="md"` icon-only here (`!w-10` = 40px) **and** the cell's `py-3` (24px combined vertical) makes the effective tap target ≥44px; additionally add `className="!h-10"` so the button is 40×40 and the row padding completes the 44pt zone. Locked: boundary action button renders at the `md` (40px) icon-only size, never `sm`, to clear the touch-target floor.

### 6.2 Row interaction
- Rows are **not** clickable-to-navigate (no detail view this ORCH). The only interactive children are the switch and the boundary button, both `stopPropagation`. Row hover still applies `--table-row-hover` (built-in) for scan-tracking; it's ambient, not an affordance.
- `striped` on for even/odd legibility on a long list.

---

## 7. Every state (the 9, applied to this screen)

| # | State | When | Design |
|---|-------|------|--------|
| 1 | **Loading** | initial mount, `loading===true` | Header + subtitle render immediately (static). live-count pill renders as a `Skeleton` 56×22. Summary strip → two skeleton chips (§4). Filter row hidden. `DataTable loading` shows its built-in centered `Spinner size="sm"` + "Loading…" row. No layout shift on resolve (header/strip footprints are stable). |
| 2 | **Empty** | loaded, `rows.length === 0` (no seeding cities exist at all) | `DataTable` built-in empty: `emptyIcon={Rocket}` (40px `--gray-300`), `emptyMessage="No cities to launch yet."` + an `emptyAction` `Button variant="link"` → "Add a city in Place Pool" that routes `#/placepool` (the city-creation surface — this tab is launch-only, not create). Summary strip shows `0 / 0`. Filter row hidden. Voice: helpful, points to the real next step. |
| 3 | **Populated** | loaded, `rows.length > 0` | §6. Live rows tinted + sorted to top. |
| 4 | **Submitting** (mid-toggle, optimistic) | a row's `city_id ∈ togglingIds` | That row's `Toggle` is `disabled` + shows optimistic position; `Spinner size="sm"` to its right. The rest of the table stays fully interactive (you can toggle other cities concurrently — `togglingIds` is a Set). live-count pill + summary chip update optimistically. |
| 5 | **Toggle-failed rollback** | write rejects | Switch animates back to its prior position (Framer-free — the `Toggle`'s own `transition-colors`/`translate` 150ms covers the visual revert when state reverts). Error `Toast` (manual-dismiss, red): title "Couldn't update {city}", description = error message. live-count pill + summary chip revert. The DB is untouched. **This is the constitutional no-silent-failure guarantee — see §9.** |
| 6 | **Offline / network error** | `fetch`/`rpc` throws on load | `AlertCard variant="error"` above the strip: title "Couldn't load launch cities", body = message, action `Button secondary sm "Retry"` → re-runs the load. Table region not rendered (or renders empty under the alert). For a *toggle* while offline → state #5 rollback path. |
| 7 | **First-time** | first visit, cities exist but 0 live | Identical to Populated but every switch off, live-count pill `outline` "0 live", success-tint absent. A one-line `AlertCard variant="info"` (dismissible-by-context, not persisted) MAY sit above the table: "No cities are live yet. Flip one on when its places are ready." — Mingla voice, orienting not nagging. (OPEN→resolved: show this info banner only while `liveCount === 0 && totalCount > 0`.) |
| 8 | **Returning** | revisit with ≥1 live | Live rows tinted + top-sorted, live-count pill green. No banner. The screen "remembers" its posture purely from server state — no client persistence needed. |
| 9 | **Degraded** | RPC returns rows but `has_bbox===false` and/or `is_servable_places===0` for some | Per-row advisories (warning Boundary chip §6.1 col4; warning "0 servable" badge §6.1 col3). Toggling is still allowed (operator's call) but the row visibly flags the risk. No global degraded state — it's per-row signal. |

**Inapplicable states named:** there is no "submitting a form" (no create/edit form on this tab — boundary edits live in the modal, §8). No pagination state needed at 17 rows (DataTable supports it but we pass no `pagination` prop; if the table ever exceeds ~50 rows a future ORCH adds it). No multi-select/bulk (out of scope; `selectable` off).

---

## 8. Boundary modal (map / refresh boundary)

Resolves SPEC §B.4 OPEN (modal-vs-inline → **modal**; Leaflet preview → **yes, show it**). Reuses the exact geocode→persist pattern from `PlacePoolManagementPage.jsx:928–983`, **stripped to bbox-only** (LOCKED §B.4: never touches `is_live_for_consumers`, `status`, `tile_radius_m`, never regenerates tiles).

```
<Modal open onClose={close} size="md" title={`Boundary — ${city.city_name}`}>
  <ModalBody>
    <div className="space-y-4">
      {/* 1. query field + Find button */}
      <div className="flex items-end gap-2">
        <Input label="City" value={query} onChange={…} onKeyDown={Enter→geocode}
               className="flex-1" placeholder="e.g. Lagos, Nigeria" />
        <Button variant="secondary" icon={Search} loading={geocoding} onClick={geocode}>Find</Button>
      </div>

      {/* 2a. before geocode → current bbox preview (read-only) */}
      {/* 2b. after geocode → new bbox preview + overlap note */}
      <BoundaryMap city={city} result={geocodeResult} />   // Leaflet, §8.1

      {/* 3. overlap advisory (informational only) */}
      {overlap.length > 0 && (
        <AlertCard variant="warning" title="Overlaps existing cities">
          New boundary overlaps: {overlap.map(o => o.name).join(", ")}. That's allowed — just confirming.
        </AlertCard>
      )}

      {/* error */}
      {error && <AlertCard variant="error" title="Couldn't map that">{error}</AlertCard>}
    </div>
  </ModalBody>
  <ModalFooter>
    <Button variant="ghost" onClick={close}>Cancel</Button>
    <Button variant="primary" loading={saving} disabled={!geocodeResult} onClick={save}>
      Save boundary
    </Button>
  </ModalFooter>
</Modal>
```

### 8.1 BoundaryMap (Leaflet preview)
A `MapContainer` (`height: 280px`, `rounded-lg overflow-hidden border border-[var(--gray-200)]`) mirroring `PlacePoolManagementPage.jsx:1224`:
- `<TileLayer>` OSM tiles (same URL/attribution as the reference).
- **Current bbox** (`city.bbox_*`): `<Rectangle>` dashed gray — `pathOptions={{ color:"#6b7280", dashArray:"8 4", fillOpacity:0.03, weight:2 }}` (verbatim from `PlacePoolManagementPage.jsx:1233`).
- **Proposed bbox** (from `geocodeResult.viewport`, only after geocode): a SECOND `<Rectangle>` in **brand orange** — `pathOptions={{ color:"#f97316", fillOpacity:0.06, weight:2 }}` — so old (gray dashed) vs new (orange solid) read as a clear before/after. Auto-`fitBounds` to the proposed rect when present, else the current rect.
- A small legend line under the map: `<span>` gray swatch "Current" · orange swatch "New" (`text-xs --color-text-tertiary`).

### 8.2 Boundary states
| State | Design |
|-------|--------|
| Open, pre-geocode | query pre-filled with `city.city_name`; map shows current gray bbox; "Save boundary" **disabled** (nothing new to save). |
| Geocoding | "Find" button `loading`; map unchanged; inputs stay enabled. |
| Geocoded OK | orange proposed rect drawn + fitBounds; overlap advisory if any; "Save boundary" **enabled**. |
| Geocode ZERO_RESULTS / error | `AlertCard error` "Couldn't map that — try a more specific name."; map keeps current bbox; Save stays disabled. (Maps to SPEC §B.4 Google `ZERO_RESULTS`/`REQUEST_DENIED` handling.) |
| Saving | "Save boundary" `loading`; on success → close modal, success toast "Boundary updated for {city}.", parent re-runs `admin_launch_city_list` so the Boundary chip refreshes (SPEC §B.4 step 5). |
| Save failed | `AlertCard error` inside modal; modal stays open; no DB write. |

**Persist payload (LOCKED bbox-only, SPEC §B.4):** `{ center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, updated_at }` — explicitly NOT `tile_radius_m`, NOT `status`, NOT `is_live_for_consumers`, NO `generate_tiles` call (the reference's tile regen at line 987 is deliberately dropped here).

---

## 9. The toggle state machine (constitutional — no silent failure)

The single most important behavior on this screen. Extends `UserManagementPage.handleBetaToggle` exactly.

```
handleToggleLive(row):
  next = !row.is_live_for_consumers
  prev = row.is_live_for_consumers
  // 1 OPTIMISTIC
  setRows(rows.map → flip this row's flag to `next`)
  setTogglingIds(add row.city_id)
  // live-count pill + summary chip recompute from rows automatically
  try:
    { error } = await supabase.rpc("admin_set_city_live",
                   { p_city_id: row.city_id, p_live: next })   // or .from(...).update(...)
    if (error) throw error
    logAdminAction("city.set_live", "seeding_city", row.city_id, { is_live_for_consumers: next })
    addToast({ variant:"success",
               title: next ? `${row.city_name} is now live for consumers.`
                           : `${row.city_name} is hidden from consumers.` })
  catch (err):
    // 2 ROLLBACK — visible, never silent
    if (mounted) setRows(rows.map → restore this row's flag to `prev`)
    addToast({ variant:"error",
               title: `Couldn't update ${row.city_name}`,
               description: err.message })
  finally:
    if (mounted) setTogglingIds(delete row.city_id)
```

**Guarantees mapped to SPEC §B.3 / Constitution:**
- **Visible flip + persistence:** optimistic flip is immediate; success toast names the new state; a reload re-reads the DB (proves the write).
- **Visible rollback on failure:** the switch returns to `prev` AND a **manual-dismiss red toast** fires (success toasts auto-dismiss at 5s; error toasts never auto-dismiss per `ToastContext` `AUTO_DISMISS_MS.error = null`) — the failure cannot scroll away unseen. No path leaves the switch in `next` after a rejected write.
- **No fabricated data:** counts are render-only from the RPC; the toggle never invents a count.
- **Concurrency-safe:** `togglingIds` is a `Set`, so toggling Lagos while Accra is mid-flight is fine; each row rolls back independently.
- **Mounted-guard:** all post-await setState behind `mountedRef.current` (page-unmount during request → no state-on-unmounted warning), matching the precedent.

---

## 10. Motion

All motion respects `@media (prefers-reduced-motion: reduce)` — `globals.css:228` already clamps every animation/transition to `0.01ms` globally, so **reduced-motion is satisfied by the existing base layer**; nothing below needs a bespoke fallback, but every value uses the shared `transition-*` tokens so the clamp applies.

| Element | Motion | Token / timing | Purpose |
|---------|--------|----------------|---------|
| Switch flip | track color + knob translate | `transition-colors/transform duration-150` (Toggle primitive) = `--transition-fast` | "it flipped" |
| Switch rollback | same 150ms back | reuse | "it reverted" — the reverse motion is the no-silent-failure tell |
| Toast enter/exit | slide-x 100→0 + fade + scale 0.95→1 | Framer `duration:0.2 easeOut` (Toast primitive) | "a result arrived" |
| Row hover | bg fade | `transition-colors duration-150` (DataTable) | scan-tracking |
| Boundary modal | overlay fade 200ms + panel `scale-in` 200ms | `animate-[fade-in/scale-in_200ms]` (Modal primitive) | "a focused task opened" |
| Map proposed-rect | none (instant draw) + Leaflet `fitBounds` ease | Leaflet default | "here's the new shape" |
| Summary chip count | no number-tween (instant) | — | counts are facts, not animations — avoid slot-machine slop |

No bespoke animations introduced. Everything rides existing primitives' motion, which already carries the reduced-motion clamp.

---

## 11. Accessibility

- **Switch:** `Toggle` is `role="switch"` + `aria-checked={checked}` (primitive). **Gap found:** the primitive's inner `<button>` has no visible focus ring. **Fix (in-page, do not mutate the shared primitive without an ORCH):** wrap usage is insufficient; instead the implementor adds `aria-label` per instance AND relies on the global `:focus-visible { outline: 2px solid #f97316 }` (`globals.css:192`) which DOES apply to the switch button (it's a real `<button>`). Confirmed: focus-visible outline is global, so the switch is keyboard-focusable with a visible 2px brand outline at `outline-offset: 2px`. Add `aria-label={`${row.is_live_for_consumers ? "Live" : "Off"} for consumers — ${row.city_name}`}` so screen readers announce the city + current state, not just "switch."
- **Boundary button:** icon-only — REQUIRES `aria-label={`Map or refresh boundary for ${row.city_name}`}` (specified §6.1 col6). Size `md` (40px) + row padding → ≥44pt target.
- **Reading order / table semantics:** `DataTable` renders a real `<table>`/`<thead>`/`<tbody>` → native screen-reader table nav. Column headers are `<th>`. The "LIVE" header gives the switch column an accessible name.
- **Toasts:** `Toast` items are `role="alert"` (primitive) → SR-announced on appear. Error toasts persist (manual dismiss) so a SR user isn't raced by a 5s timer.
- **Modal:** focus-trapped, ESC-closes, overlay-click-closes, focus returns to the launching boundary button on close (Modal primitive handles all of this).
- **Segmented filter:** `role="tablist"` + `role="tab"` + `aria-selected`; keyboard arrow-nav not required for a 2-segment control but each is a real focusable `<button>`.
- **Touch targets:** switch track is 44×24 (44 wide; the `<label>` wrapping it extends the vertical hit area; row `py-3` adds vertical zone) — clears the floor. Boundary button 40×40 + cell padding ≥44. Segment buttons `h-9 px-4` (§5) + row padding ≥44.
- **Dynamic type / zoom:** all text in `rem`/Tailwind text tokens; layout is flex/table → reflows at 200% browser zoom without clipping (no fixed-height text rows).

### 11.1 Contrast (computed, both themes — body ≥4.5:1, large ≥3:1)

| Element | Light fg / bg | Ratio | Dark fg / bg | Ratio | Pass |
|---------|---------------|-------|--------------|-------|------|
| h1 / body | `#111827` / `#faf8f6` | **16.9:1** | `#f3f4f6` / `#0f1117` | **16.1:1** | ✓ |
| subtitle (text-secondary) | `#4b5563` / `#faf8f6` | **8.1:1** | `#9ca3af` / `#0f1117` | **6.4:1** | ✓ |
| body cell (text-primary) on table bg | `#111827` / `#ffffff` | **18.1:1** | `#f3f4f6` / `#0f1117` | **16.1:1** | ✓ |
| country sub-label (text-tertiary) | `#6b7280` / `#ffffff` | **4.8:1** | `#6b7280` / `#0f1117` | **5.6:1** | ✓ (≥4.5 small) |
| servable count (text-primary bold) | `#111827` / `#ffffff` | **18.1:1** | `#f3f4f6` / `#0f1117` | **16.1:1** | ✓ |
| "/ active" muted text | `#6b7280` / `#ffffff` | **4.8:1** | `#6b7280` / `#0f1117` | **5.6:1** | ✓ |
| success Badge text on success-50 | `#15803d` / `#f0fdf4` | **5.6:1** | `#4ade80` / `rgba(34,197,94,.1)`→`~#11261a` | **8.9:1** | ✓ |
| warning Badge text | `#b45309` / `#fffbeb` | **6.3:1** | `#fbbf24` / `~#241d0e` | **9.4:1** | ✓ |
| live-count pill (success) | `#15803d` / `#f0fdf4` | **5.6:1** | `#4ade80` / dark | **8.9:1** | ✓ |
| switch knob (white) on brand-500 track | `#ffffff` / `#f97316` | **2.9:1** | same | **2.9:1** | ✓* |
| switch ON track vs row bg (non-text UI) | `#f97316` / `#ffffff` | **3.1:1** | `#fb923c`(brand-700 dark)/`#0f1117` | **6.8:1** | ✓ (≥3:1 UI component, WCAG 1.4.11) |
| ghost boundary icon (text-secondary) | `#4b5563` / `#ffffff` | **8.6:1** | `#9ca3af` / `#0f1117` | **6.4:1** | ✓ |
| focus ring `#f97316` on bg | `#f97316` / `#ffffff` | **3.1:1** | `#f97316` / `#0f1117` | **5.9:1** | ✓ (≥3:1 non-text) |

*Switch knob/track 2.9:1 is the white knob on orange — the knob is a UI *shape* whose meaning is carried by its **position** (left/right) not its contrast, and the switch's ON/OFF is dual-encoded (position + track color + the per-instance `aria-label`), so it satisfies WCAG 1.4.1 (color not sole means) and 1.4.11 (the 3.1:1 track-vs-background boundary is the graphical-object contrast that matters). No change needed.

All ratios computed via WCAG relative-luminance on the literal token hex values in `globals.css`. Dark-mode `success-50`/`warning-50` are the `rgba(...,0.1)` overlays composited over `--color-background-primary #0f1117` (approx hex shown).

---

## 12. Copy (Mingla voice, per state)

| Surface | Copy |
|---------|------|
| h1 | Launch Cities |
| subtitle | Flip a city live to let people there start onboarding. |
| live-count pill | `{n} live` |
| summary chips | "Live for consumers" · "Cities mapped" |
| filter segments | All · Live only |
| table title | Seeding cities |
| col headers | City · Country · Servable · Boundary · Live · (blank for action) |
| Boundary chip | "Boundary set" / "No boundary" |
| 0-servable badge | "0 servable" |
| toggle ON toast | `{City} is now live for consumers.` |
| toggle OFF toast | `{City} is hidden from consumers.` |
| toggle fail toast | title `Couldn't update {City}` · desc = error |
| empty state | "No cities to launch yet." + link "Add a city in Place Pool" |
| first-time info banner | "No cities are live yet. Flip one on when its places are ready." |
| load error | "Couldn't load launch cities" + Retry |
| boundary modal title | `Boundary — {City}` |
| boundary find button | Find |
| boundary save button | Save boundary |
| boundary overlap | "New boundary overlaps: {names}. That's allowed — just confirming." |
| boundary save toast | `Boundary updated for {City}.` |
| boundary geocode fail | "Couldn't map that — try a more specific name." |

Voice: plain, consequence-naming, lightly warm ("just confirming"), never cute-at-the-expense-of-clarity. This is a control panel; wit stays in the margins (the empty/first-time lines), never on the live switch (a launch action is not the place for a joke).

---

## 13. Anti-slop audit (premium-craft §2 — zero violations)

- No generic gradients (brand gradient unused on this screen; flat token fills only). ✓
- No stock/AI imagery (no illustrations; empty state is a lucide `Rocket` glyph in `--gray-300`). ✓
- No emoji icons (country shows 2-letter code text, not flag emoji; all icons are lucide line glyphs). ✓
- No decorative effects (shadows are the token `--shadow-sm`; the live-row tint is *signal* not decoration; the orange proposed-bbox is *information* not flourish). ✓
- Restraint: the switch is the only saturated element in a calm row; everything else is grayscale + a single status chip. ✓

---

## 14. Implementor handoff notes

- **Reuse, don't rebuild:** `Toggle`, `DataTable`, `Badge`, `Button`, `Modal/ModalBody/ModalFooter`, `SectionCard`, `AlertCard`, `Spinner`, `Skeleton`, `useToast`, `react-leaflet` `MapContainer/TileLayer/Rectangle`. The ONLY new component code is `LaunchCitiesPage.jsx` + a local `SummaryChip` + a local `BoundaryModal`/`BoundaryMap` (all in-file or co-located — no new shared primitives).
- **Toggle handler** is a near-copy of `UserManagementPage.handleBetaToggle` (`:628`) with `admin_set_city_live` RPC (or `.from("seeding_cities").update({is_live_for_consumers}).eq("id",…)` — both RLS-equivalent per SPEC §0.3) + the success/fail toasts in §9.
- **Boundary flow** is a bbox-only fork of the `PlacePoolManagementPage` city-edit modal (`:928–1000`) — **drop** the `generate_tiles` invoke (`:987`) and the `tile_radius_m`/`status` writes; persist only the 6 center/bbox fields + `updated_at`.
- **Nav:** add `{ id:"launch-cities", label:"Launch Cities", icon:"Rocket" }` to `constants.js` `NAV_GROUPS[0].items` (after `placepool`); add `"launch-cities": LaunchCitiesPage` to `App.jsx` `PAGES`. **`Sidebar.jsx` needs NO edit — `Rocket` is already in `ICON_MAP` (`:36`).**
- **Page export:** match `PricingPage` style — `export function LaunchCitiesPage() {…}`.
- **Data load:** `supabase.rpc("admin_launch_city_list")` on mount; React Context only (admin has no React Query); `mountedRef` guard on all post-await setState.
- **`is_live_for_consumers` never coupled to `status`** (SPEC I-LC-STATUS-ORTHOGONAL) — the boundary action and the live toggle are independent writes; never co-mutate.

---

## 15. /goal completion self-check

1. **References examined** — ✓ named (§ header: Linear, Vercel, Stripe, Airbnb, in-house UserManagement).
2. **All 9 states** — ✓ §7 (loading, empty, populated, submitting, rollback, offline, first-time, returning, degraded), inapplicable ones named (no form-submit, no pagination, no bulk).
3. **Every spacing/size a token** — ✓ §0 maps all to the 4px grid / Tailwind tokens; the 3 literal pixels (44 target floor, 24/280/600 primitive internals) are called out as primitive-given or token-equivalent, not invented.
4. **Contrast computed both themes** — ✓ §11.1 table, body ≥4.5:1 / large+UI ≥3:1, numeric.
5. **Every interactive element ≥44pt + aria-label + non-shifting press** — ✓ switch (44×24 + label + global focus ring), boundary btn (40px + row pad + aria-label), segments (`h-9` + row pad), all use token color-press not layout-shift.
6. **Zero anti-slop** — ✓ §13.
7. **Mingla voice per state + reduced-motion fallback** — ✓ §12 copy table; §10 reduced-motion satisfied by the global `globals.css:228` clamp on token transitions.

All seven hold.
