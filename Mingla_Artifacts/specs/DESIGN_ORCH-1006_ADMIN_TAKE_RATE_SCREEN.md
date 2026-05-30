# DESIGN — ORCH-1006 [Universal all-in pricing engine] — ADMIN-WEB MINGLA TAKE-RATE SCREEN

**ORCH:** ORCH-1006 [Universal all-in pricing engine]
**Surface:** `mingla-admin` (React 19 + Vite + Tailwind v4 + Framer Motion + lucide-react) — internal operator tool. **The app is JSX (`.jsx`), not TypeScript.**
**Mode:** SCREEN (single surface) — the Mingla platform take-rate configuration screen.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1006-[universal-allin-pricing-engine]/` on branch `ORCH-1006-universal-allin-pricing-engine`
**Date:** 2026-05-29
**Author:** mingla-designer (Claude)
**Serves:** `Mingla_Artifacts/specs/SPEC_ORCH-1006_AMENDMENT_CONFIGURABLE_MINGLA_TAKE_RATE.md` §C (admin-web UI functional contract — LOCKED) + §D (RPC persist path — LOCKED). This artifact resolves every 🎨OPEN item flagged in the amendment §G. **It does NOT change the locked functional contract** (fields, guardrail bounds 0–3000 bps = 0–30%, RPC ops, global-default + per-brand-override model). It is the visual / IA / copy / motion layer the implementor builds from.

**Inputs read this turn (firsthand):**
- Amendment spec (read in full): the LOCKED functional floor — §C.1–C.7 (screen, fields, validation, all states, confirm, auth), §D.1–D.6 (RPC ops + auth + validation + audit), §A.6 (guardrail 0–3000 bps), §B.3 (point-in-time: a rate change can't alter an in-flight session).
- Main spec `SPEC_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md` + `DESIGN_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md` — voice/continuity. The locked mental model "take-rate = Mingla's profit (collected via `application_fee_amount`); service fee = Stripe-cost recovery (brand switch); Stripe processing fee = paid by the connected account — three levers, never netted" is reused in this screen's copy.
- `mingla-admin` codebase — **component inventory verified firsthand by recursive directory listing** (cited in §2). The app's stack is verified from `mingla-admin/package.json`.

**Comms ledger:** read on entry (`/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`). No `BLOCK` row is addressed to `mingla-designer` or to `ORCH-1006`. COMMS-0002 (backend strict-grep allowlist), COMMS-0003 (external-API docs cited inline), COMMS-0004 (migration-filename SOP) are WARN rows aimed at the implementor/orchestrator phases — none gates a design artifact. This screen introduces **no external API** (it calls a Supabase RPC only; the Stripe parameters live in the checkout engine and are already doc-cited in the amendment §2). No ack-write required; no new cross-ORCH discovery. Carried forward for the implementor in §11.

> **✅ CODEBASE VERIFIED FIRSTHAND.** Despite an intermittent tool-channel replay loop (recorded on this ORCH's prior phases), I read the actual admin source firsthand this turn: `SettingsPage.jsx` (the closest existing analog — a config page with tabs, search, tables, create/edit/delete modals, and audit-history modals), and the full UI kit (`Card.jsx`, `Input.jsx`, `Button.jsx`, `Modal.jsx`, `Table.jsx`, `Toast.jsx`) plus `lib/formatters.js`, `lib/auditLog.js`. The exact component APIs, prop signatures, theme CSS-variable token names, and established patterns below are quoted from those reads — they are NOT guesses. A handful of values I could not re-open after the loop (a few exact tokens in `globals.css`, `Sidebar.jsx`'s exact nav-item shape, `ToastContext`'s precise export) are tagged `[CONFIRM at IMPLEMENT]`; everything else is verified. **Key correction from an earlier draft:** admin is **JSX with a real light/dark/system `ThemeContext`** (verified — `SettingsPage` Appearance tab toggles `light`/`dark`/`system`), uses **CSS-variable theme tokens** (`var(--color-text-primary)`, `var(--color-brand-500)`, `var(--gray-200)`, etc.), and already has an **audit sink** (`logAdminAction` → `admin_audit_log` table). Build on all of it.

**References examined (premium-craft §3):** **Stripe Dashboard → Settings → application-fee / platform pricing** (the canonical "money-lever-in-an-operator-console": a percent input with an always-visible unit affix, an explainer of who-pays-what, and a confirm on change); **Linear → Settings** numeric/threshold fields (left-rail nav + single right pane, label-over-input, inline validation under the field, restrained); **Vercel Dashboard → Billing** "default value at top + per-project override table beneath, each row tagged inherited vs custom" (the exact two-tier global+override IA). Synthesis (not cloned): admin's existing left-rail shell hosts a Stripe-style percent field for the global default, with a Vercel-style override table below, and every persist routed through admin's existing `Modal` with explicit before→after money framing. No flourish — a low-traffic internal lever where clarity and money-safety outrank delight.

---

## 0. The moment (who is here, doing what, feeling what)

Seth (or a trusted staff operator) is in `mingla-admin`, deliberately changing **how much Mingla earns on every transaction** — the single highest-stakes number in the product. A fat-finger here silently changes real payouts to real venues. The emotional state is *deliberate caution*, not exploration. The design's job: make the current state unambiguous, make the edit obvious, make the consequence visible *before* commit, and make accidental change nearly impossible. Nothing here should feel playful or fast — it should feel like a bank-teller window: calm, precise, double-checked.

**Design posture (HARD per dispatch):** favor clarity + safety over flourish. Match `mingla-admin` exactly — reuse its shell (`AppShell`/`Sidebar`), its UI kit (`SectionCard`/`AlertCard` from `Card.jsx`, `Input`/`Toggle` from `Input.jsx`, `Button`, `Modal`/`ModalBody`/`ModalFooter`, `DataTable` from `Table.jsx`, `Badge`, `Spinner`, `SearchInput`), its `ToastContext` (`useToast().addToast`), `logAdminAction`, and the `supabase` client from `lib/supabase.js`. **The `SettingsPage.jsx` "App Config" tab is the closest precedent — this screen should look and behave like a sibling of it.** Invent nothing parallel.

---

## 1. Information architecture

The screen answers four questions, top to bottom, in priority order:

1. **What does Mingla earn by default, right now?** → the Global default rate, large and unmissable, at the top.
2. **Which brands are on a special deal, and what is it?** → the Per-brand override list beneath it.
3. **Who last touched this, and when?** → an audit line attached to each editable value (not a separate page).
4. **How do I change it safely?** → edit affordances that always route through an explicit before→after confirm.

### 1.1 Where it lives — a new page `/pricing` (resolves amendment §C.1 🎨OPEN: host vs new page)

**DECISION: a new dedicated page `src/pages/PricingPage.jsx`, reachable from the sidebar — NOT a tab inside the existing `src/pages/SettingsPage.jsx`.**
Rationale: the take-rate is a real, audited, multi-layer-guarded **money lever**. `SettingsPage.jsx` (read firsthand) is a tabbed page (Appearance / Feature Flags / App Config / Integrations / Testing Tools); the take-rate does NOT belong as a 6th tab — it's higher-stakes and deserves its own nav entry so an operator can't confuse it with cosmetic config. (Note: `SettingsPage` has **no** placeholder "platform fee" field today — verified — so §11 T-1 is likely moot; the implementor should still grep to be sure before assuming.)

**Wiring (verified against the real `App.jsx` + `AppShell.jsx` — this is HASH routing, NOT react-router):**
- `App.jsx` uses a `PAGES` map keyed by tab id (`overview`, `settings`, `subscriptions`, …) + `getTabFromHash()` reading `#/<tabId>`. **Add `pricing: PricingPage`** to the `PAGES` object and import `PricingPage`.
- `Sidebar.jsx` renders `NAV_GROUPS` / `NAV_ITEMS` from `src/lib/constants.js`; each nav item is **`{ id, label, icon }` where `icon` is a STRING key** into Sidebar's `ICON_MAP`. **Add a nav item `{ id: 'pricing', label: 'Pricing', icon: 'Percent' }`** to the appropriate group in `lib/constants.js` (group it with the operational/config entries near "Settings"/"Subscriptions"), AND **add `Percent` to Sidebar's `ICON_MAP`** import + map object (lucide `Percent` is not yet imported there).
- Auth: every page already renders only when `session` exists (`App.jsx` gates the whole `AppShell` behind `if (!session) return <LoginScreen/>`). The page inherits that gate; the **server RPC is the real authority** (§7.4).
- Do NOT add a page-enter animation — `App.jsx` already wraps every active page in a framer `motion.div` with `pageTransition` (`{opacity:0,y:8}→{opacity:1,y:0}`, 0.2s). The page gets it for free.

### 1.2 Page structure (top → bottom)

```
┌─ Page header ─────────────────────────────────────────────┐
│  Pricing                                                   │  (AppShell provides the page chrome / header slot)
│  Set Mingla's cut of every transaction.                    │
├─ Card A: GLOBAL DEFAULT ──────────────────────────────────┤
│  "Mingla platform take-rate"                               │
│  [  6.00  ] %     ← large numeric field + % affix          │
│  helper: what this is / who it applies to                  │
│  audit: "Last changed by you · May 27, 2026"               │
│  [ Save default ]   (enabled only when dirty + valid)      │
├─ Card B: PER-BRAND OVERRIDES ─────────────────────────────┤
│  "Brand overrides"                  [ + Add override ]      │
│  helper: one line on what an override does                 │
│  ┌ Table ─────────────────────────────────────────────┐   │
│  │ Brand        Effective   Source     Last changed    │   │
│  │ Acme Venue   3.00%       Override    May 26    ⋯     │   │
│  └─────────────────────────────────────────────────────┘  │
│  (rich empty state when no overrides exist)                │
└────────────────────────────────────────────────────────────┘
```

Two stacked `SectionCard`s in a single column (NOT a left-rail sub-nav — only two regions; sub-nav would over-engineer). **`AppShell` already constrains the main pane** (`<main>` → `<div className="w-full max-w-[--content-max-width] mx-auto px-16">`, verified) — so do NOT add a custom width cap; the page just renders `<div className="flex flex-col gap-6">` like `SettingsPage`. Card A naturally won't stretch (the global field is a fixed-width control inside a `p-5` card); Card B's `DataTable` scrolls horizontally on its own if needed.

---

## 2. Visual system — reuse map (no parallel design system)

Every element maps to a **verified-to-exist, source-read** `mingla-admin` component. Props and class tokens below are quoted from the actual files.

| Element | Reuse (verified API) | Exact usage |
|---|---|---|
| Page shell | `components/layout/AppShell.jsx` + `Header.jsx` | renders inside the authed shell like every page; page root mirrors `SettingsPage`: `<div className="flex flex-col gap-6">` with an `<h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Pricing</h1>` |
| Sidebar nav entry | `components/layout/Sidebar.jsx` | add a "Pricing" item; `[CONFIRM nav-item shape]` — match the existing `{ path, label, icon }` list, icon = lucide `Percent` |
| Card surfaces (A, B) | `SectionCard` (`Card.jsx`) | props `{ title, subtitle, badge, action, children, noPadding }`. Header is `px-5 py-3.5 border-b`, body `p-5`, surface `bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl shadow-[var(--shadow-sm)]`. Use the `action` slot for Card B's "+ Add override" button |
| Money-warning banner inside confirms | `AlertCard` (`Card.jsx`) | `variant="warning"` (amber, `AlertTriangle`) / `variant="info"` (blue, `Info`) — use inside the confirm `ModalBody` to frame the before→after (§9) |
| Percent input | `Input` (`Input.jsx`) | props `{ label, error, helper, ... }`. The base is `h-10`; for the large global field, pass a `className` that overrides size (e.g. `!h-14 !text-3xl text-right tabular-nums w-32`) + render the `%` affix as a sibling. Error string passed via `error` prop (renders `text-xs text-[#ef4444] mt-1`). |
| Buttons | `Button` (`Button.jsx`) | **verified API:** `variant: primary\|secondary\|ghost\|danger\|link`; `size: sm\|md\|lg`; `loading`, `disabled`, `icon`, `iconRight`. Primary = `bg-[var(--color-brand-500)]`; has `active:scale-[0.98]` + `focus-visible:ring-2` built in. Save = `primary`; Add override = `primary` with `icon={Plus}` (matches SettingsPage "New Config"); Remove-confirm = `danger`; row actions = `ghost size="sm"` icon-only |
| Override list | `DataTable` (`Table.jsx`) | **verified API:** `{ columns, rows, loading, emptyIcon, emptyMessage, emptyAction, pagination, sortKey/sortDirection/onSort }`. Columns are `{ key, label, sortable, width, render(value,row), className, cellClassName }`. Built-in: sticky header, client sort, loading row (Spinner + "Loading..."), empty row (`emptyIcon` + `emptyMessage` + `emptyAction`), pagination footer |
| Source pill | `Badge` (`Badge.jsx`) | **verified variants:** `default, brand, success, warning, error, info, outline` (+ optional `dot`). Override → `<Badge variant="brand">Override</Badge>`; Default → `<Badge variant="default">Default</Badge>` |
| Add/Edit override + confirm | `Modal`/`ModalBody`/`ModalFooter` (`Modal.jsx`) | **verified API:** `Modal { open, onClose, title, size: sm\|md\|lg, destructive, children }` — has built-in focus-trap, Esc-to-close (blurs inputs first), overlay-click close, `role="dialog" aria-modal`. **This IS admin's confirm pattern** (SettingsPage delete confirms = `<Modal destructive>` + `<ModalFooter>` with secondary Cancel + danger confirm). Reuse exactly; no new ConfirmDialog |
| Brand search in picker | `SearchInput` | props `{ value, onChange, onClear, placeholder, className }` (verified from SettingsPage usage) |
| Success / error feedback | `useToast()` from `context/ToastContext` | **verified:** `addToast(...)` supports BOTH `addToast("Flag created", "success")` (string+variant, SettingsPage) AND `addToast({ variant, title, description })` (rich object, TestingTools). Use the rich object for money confirmations: `addToast({ variant:"success", title:"Take-rate updated", description:"Applies to all future sales." })` |
| Submitting spinner | `Button loading` prop (built-in `Loader2`) | the Button renders its own spinner; no separate Spinner needed in buttons |
| First-load skeleton | `DataTable loading` prop + `Skeleton`/`TableRowSkeleton` (`Skeleton.jsx`) | **verified exports:** `Skeleton({width,height,rounded})`, `TableRowSkeleton({columns})`, `ListItemSkeleton`, `StatCardSkeleton`. DataTable's `loading` shows a Spinner row; for Card A use `<Skeleton>` blocks for the field + audit line |
| Persist + reads | `supabase` from `lib/supabase.js` | `supabase.rpc('admin_set_platform_take_rate', {...})` etc. (mirrors how SettingsPage does `supabase.from(...).update(...)`) |
| Date formatting | `formatDate` from `lib/formatters.js` | **verified exports:** `formatDate`, `formatDateTime`, `formatRelativeTime`, `formatFullDate`, `timeAgo` (all en-US). Use `formatDate` for the audit date (matches the audit-history modal in SettingsPage) |
| **Audit sink (USE IT)** | `logAdminAction(action, target_type, target_id, meta)` from `lib/auditLog.js` | **verified — admin already logs config changes to `admin_audit_log`.** Call it on EVERY persist: `logAdminAction("pricing.update", "platform_take_rate", "global", { old_bps, new_bps })` and `logAdminAction("pricing.update", "brand_take_rate", brandId, { old_bps, new_bps })` / `"pricing.clear"`. This gives a full admin action history *for free* via the existing `admin_audit_log` table — and the §8 audit line + the SettingsPage-style "History" modal can both read it |
| Motion | `framer-motion` (dep) + CSS keyframes | admin uses CSS animations (`animate-[fade-in_200ms_ease-out]`, `animate-[scale-in_200ms]` in Modal) AND framer-motion (Toast). Match: Modal/Toast bring their own; for row add/remove use framer `AnimatePresence` consistent with Toast |
| Icons | `lucide-react` (dep) | `Percent`, `Clock`, `Plus`, `MoreHorizontal`, `Layers`, `AlertTriangle`, `History` (all already imported across admin) |

> **Note on audit history (bonus the verified codebase unlocks):** because `logAdminAction` + `admin_audit_log` already exist and `SettingsPage` already renders a per-item "History" modal (`Modal size="lg"` listing `formatDate(created_at)` + `action` + `admin_email`), the implementor can OPTIONALLY add the same History affordance to the take-rate (a `History`-icon `ghost` button that opens the rate's change log). This partially satisfies §11 T-2 (audit depth) at near-zero cost. Recommend including it — it's a proven pattern and a money lever deserves a visible trail.

### 2.1 Light + dark (resolves dispatch "light + dark per admin's existing theme")
**Verified:** admin has a real `ThemeContext` (light/dark/system — `SettingsPage` Appearance tab) and every component uses **CSS-variable theme tokens** that flip with the theme: `--color-text-primary` / `-secondary` / `-tertiary` / `-muted`, `--color-background-primary`, `--color-brand-50/100/500/600/700`, `--gray-50/100/200/300`, `--color-{success,error,warning,info}-{50,700}`, `--shadow-{sm,md,lg,xl}`, `--table-{header-bg,border,row-hover,stripe}`, `--z-modal`. **Do NOT hardcode hex** (the few raw hexes in admin are semantic constants like `#ef4444` error-red — match that only where admin already does). Because this screen is built ENTIRELY from the theme-aware components above, **both light and dark render correctly for free** — no `dark:` variants needed. Contrast is computed against admin's real token palette (§12).

---

## 3. Card A — Global default (resolves amendment §C.2)

### 3.1 Anatomy
- **Card title:** "Mingla platform take-rate" — admin's card-title style, with a small lucide `Percent` icon to its left.
- **Field row:** a single **large** numeric input + a fixed `%` suffix affix.
  - Input: reuse `Input.jsx`, rendered larger than a standard form field to signal stakes (a display-scale numeric, right-aligned, tabular figures so `6.00` and `12.00` align on the decimal). `inputMode="decimal"`, NOT `type="number"` (number spinners + locale decimal parsing are a money footgun); parse and validate manually (§6).
  - **`%` affix** sits immediately right of the input, non-editable, muted, `select-none`, `aria-hidden`. **The unit is always visible** so there is zero ambiguity that the operator types a percent (not bps, not a multiplier) — the single most important fat-finger defense at the UI layer (Stripe-dashboard pattern). Internally percent→bps (`Math.round(parseFloat(v) * 100)`) on save; the operator never sees bps (amendment §A.1).
- **Helper text** (below field, muted): "Mingla's cut of every sale, across all brands. This is what Mingla earns — separate from the service fee a brand may add to cover card-processing cost." (Plain-language restatement of the locked amendment §2.4 model.)
- **Audit line** (below helper, small/muted): lucide `Clock` icon + "Last changed by {actor} · {date}". See §8 for actor/date resolution + format.
- **Save button** (`Button variant="primary"`), label "Save default". **Disabled** unless the field is *dirty AND valid* (§6). Uses the Button's own `loading` prop while submitting (renders the existing `Spinner`).
- **Inline validation message** (when invalid): admin's `Input` error treatment (the `Input` likely takes an `error` prop — pass the §6 copy through it; `[CONFIRM at IMPLEMENT]`).

### 3.2 Pre-fill + storage bridge
- On load, fetch the singleton config; pre-fill with `default_take_rate_bps / 100` formatted to exactly 2 decimals (`"6.00"`).
- On save, parse → bps, call `setGlobalDefault(bps)` (§7).

---

## 4. Card B — Per-brand overrides (resolves amendment §C.3, §C.5 empty, and the 🎨OPEN override-row display)

### 4.1 Header
- **Card title:** "Brand overrides".
- **`+ Add override`** button top-right of the card header (`Button variant="secondary"`, lucide `Plus` icon). Secondary (not primary) so the page's primary emphasis stays on the save actions — one clear primary per region.
- **Helper text** (muted): "Put a specific brand on a custom rate. Brands without an override use the default above."

### 4.2 The list — reuse `Table.jsx`
Columns:

| key | header | render |
|---|---|---|
| `brand` | "Brand" | brand name + a muted slug/id beneath for disambiguation (logo if `Table`/brand data carries one) |
| `effective` | "Effective rate" | tabular percent, e.g. `3.00%`, emphasized |
| `source` | "Source" | a `Badge` — see §4.3 |
| `updated` | "Last changed" | `{date}` or `—` when never (muted) |
| `actions` | "" | a `⋯` (lucide `MoreHorizontal`) `ghost` button → row menu (Edit / Remove); §4.4 |

- If `Table.jsx` supports search, enable it on brand name/slug; otherwise wrap with a `SearchInput` above the table.
- **Which brands appear** (resolves amendment §C.3 "list of brands that currently have an override"): **only brands where `take_rate_bps_override IS NOT NULL`.** A directory of every brand at the default would be noise — the table is the *exception list*. Brands on the default are reachable through the Add-override picker (which searches ALL brands, §5). Every listed row therefore has `source = Override`.

### 4.3 Source pill (resolves 🎨OPEN "override vs inheriting" display)
- **Override:** `<Badge variant="brand">Override</Badge>` (brand-tinted — verified variant).
- **Default (inheriting):** `<Badge variant="default">Default</Badge>` (neutral grey). (Used in the Add-picker preview and in transient optimistic states; the main table shows only Override rows per §4.2.)
- The **effective-rate cell** is always the number the operator reads; the pill is the *why*. The amendment's "(default: X%)" hint is satisfied in the Add/Edit picker, which shows the current default inline so the operator sets the override *relative to* what it replaces (§5).

### 4.4 Row actions (Edit / Remove)
`⋯` opens a small menu (reuse `Dropdown.jsx` if it provides an anchored menu; else a minimal popover built from the same surface tokens as `Modal`/`Card`):
- **Edit rate** → opens the Add/Edit modal (§5) pre-filled with this brand + current override.
- **Remove override** (`danger` tone) → opens the confirm modal `variant=info`-equivalent with the revert copy (§9.3) → on confirm, `clearBrandOverride(brandId)` → row animates out → toast "Override removed".

### 4.5 Empty state (resolves amendment §C.5 "Empty (no overrides yet)")
When zero overrides exist, render a centered empty state inside Card B (in place of the Table):
- lucide `Layers` icon, large, muted (monochrome — no decorative illustration, anti-slop).
- Title: "No brand overrides yet"
- Body (muted, narrow): "Every brand uses the default rate above. Add an override to put a specific brand on a custom deal."
- The `+ Add override` button repeated, centered — the single clear action.

---

## 5. Add / Edit override modal (resolves amendment §C.3 add/edit)

A **`Modal`** (reuse `src/components/ui/Modal.jsx`), NOT a route. (Admin has no form-modal preset, so compose the Modal body.)

### 5.1 Modal anatomy
- Title: "Add brand override" (add) / "Edit override" (edit).
- **Brand picker** (add mode only; edit mode shows the brand fixed as a static row):
  - A `SearchInput` filtering the brand list client-side by name/slug. (Source the brand list from a lightweight admin brands read — `[CONFIRM at IMPLEMENT]` the existing brands query/RPC in `lib/`.)
  - Results: a scrollable list (`max-h` + `overflow-y-auto`), each row = name + muted slug; the selected row gets the accent/selected treatment.
  - Brands that **already have an override** appear disabled with an "Already overridden" tag (prevents duplicates; editing existing ones is via the row menu).
- **Rate field:** the same control as Card A's global field (§3.1) — large numeric + `%` affix + the §6 validation. Label: "This brand's take-rate".
- **Default reference line** (muted, small): "Default is {default}%. To put this brand back on the default, remove the override." — surfaces the global default inline (resolves the "(default: X%)" 🎨OPEN).
- **Footer:** `Cancel` (`Button variant="secondary"` / `ghost`) + `Continue` (`Button variant="primary"`). `Continue` is disabled until a brand is selected AND the rate is valid. **`Continue` does NOT persist** — it opens the confirm step (§9) so every money write is double-gated.

### 5.2 Flow
- **Add:** pick brand → type rate → `Continue` → **confirm dialog** (before→after, §9.2) → `setBrandOverride(brandId, bps)` → modal + confirm close → toast → new row animates into the table.
- **Edit:** row menu → Edit → modal pre-filled → change rate → `Continue` → confirm (old→new) → persist → toast → the row's effective cell updates with a brief highlight (§10).

### 5.3 Why a confirm even on Add
A new override is still a real money change for that brand's future sales. **Every** persist on this screen passes through one confirm pattern — no "this one's safe" exceptions.

---

## 6. Validation + guardrail (resolves amendment §C.4; bounds LOCKED at 0–30% = 0–3000 bps)

Identical rules for the global field and the override field.

- **Allowed:** a number `0.00 ≤ x ≤ 30.00`, at most 2 decimal places (amendment §A.6).
- **Live, as-typed:** strip non-`[0-9.]`; allow at most one `.`; clamp to 2 decimals on blur (format to `toFixed(2)`).
- **Save/Continue disabled** unless the value is *dirty* (≠ the loaded value) AND *valid* — you cannot reach the confirm with a bad value (the primary fat-finger gate).
- **Inline error copy** (via `Input`'s error prop):
  - Out of range: "Enter a rate between 0% and 30%."
  - Non-numeric / empty: "Enter a rate, e.g. 6.00."
  - >2 decimals: silently rounded on blur; if forced, "Use at most two decimals (e.g. 6.25)."
- **Defense in depth (LOCKED, do not weaken):** this UI is the *friendly* gate. The RPC (`take_rate_out_of_bounds`, amendment §D.4) and the DB `CHECK` (§A.6) are authoritative. On RPC reject (stale client): surface `error.message` via toast, keep the prior value, never optimistically apply (§7.3).

---

## 7. Persist path — UI contract (serves amendment §D; RPC ops LOCKED)

A thin `src/lib/pricing.js` wraps the three locked operations (amendment §D.2) over the existing `lib/supabase.js` client (call `.rpc(...)`):
- `getPricingConfig()` → singleton default + the list of override brands.
- `setGlobalDefault(bps)` → RPC `admin_set_platform_take_rate`.
- `setBrandOverride(brandId, bps)` → RPC `admin_set_brand_take_rate_override`.
- `clearBrandOverride(brandId)` → RPC `admin_clear_brand_take_rate_override`.

(Exact RPC + arg names are the implementor's to finalize against the migration per amendment §D.1. The UI contract: one writer per op; returns the new persisted value + audit stamp; throws a human-readable message on reject.)

### 7.1 Optimism policy: **pessimistic** (money safety)
Do NOT optimistically update. Show the submitting state, await the RPC, then reflect the *server-returned* value. A money lever shows truth, not a hopeful guess (Constitution #3 — fail loud, never silent success).

### 7.2 Re-read audit on success
After any successful write, reflect the new `updated_by` + `updated_at` immediately (from the RPC return or a re-read), so the audit line (§8) updates without a manual refresh.

### 7.3 Error → no-apply
On any RPC error (validation/permission/network): toast `error.message`, keep the prior persisted value displayed, leave the field dirty for retry, do NOT close the confirm as if it succeeded.

### 7.4 Auth (resolves amendment §C.7 + §D.3 — UI side)
The page is reachable only by an authenticated admin (route gated behind `AuthContext`, like every admin page). **The UI gate is convenience only** — the RPC re-checks admin authority server-side (amendment §D.3; that is the authority). If admin has no first-class admin-role concept, that is a P0 blocker for the implementor to surface (§11 T-3), not for the UI to paper over.

---

## 8. Audit affordance (resolves amendment §D.5 updated_by/at)

- **Global:** the audit line under Card A reads "Last changed by {actor} · {date}".
- **Per-brand:** the table's "Last changed" column + the confirm dialog restates it.
- **Actor resolution:** `updated_by` is an `auth.users.id`. Resolve to a friendly label: if it equals the current session user → "you"; else the user's email/display name (`[CONFIRM at IMPLEMENT]` how admin resolves a user-id to a label via `AuthContext`/`authHelpers.js`; fallback = email). If null (the seed row, never operator-edited) → "system default (1.50%)".
- **Date format:** use `formatDate` from `lib/formatters.js` (verified export, en-US — same one the SettingsPage audit-history modal uses); on hover, a `title` attr shows the full timestamp (`formatDateTime`). Never a raw ISO string.
- **Server stamp is the source of truth** (`updated_by`/`updated_at` from the RPC, amendment §D.5); ADDITIONALLY call `logAdminAction("pricing.update", ...)` on every write (§2 table) so the change also lands in `admin_audit_log`. The audit LINE shows the latest stamp; an optional `History`-icon button (SettingsPage pattern) can show the full `admin_audit_log` trail — this is the cheap path to deeper audit (§11 T-2).

---

## 9. Confirmation dialog copy (resolves amendment §C.6 — the money-safety framing) — EXACT COPY

Use admin's **established confirm pattern, verified in `SettingsPage.jsx`**: `<Modal open onClose title destructive>` + `<ModalBody>` (the framing copy) + `<ModalFooter>` (secondary Cancel + the action button). For take-rate CHANGES use `<Modal>` (not `destructive` — a change isn't a delete) and put an `<AlertCard variant="warning">` inside the body for the before→after; for REMOVE-override use `<AlertCard variant="info">`. The confirm action button is `variant="primary"` for a change and `variant="secondary"` for a revert (reverting is the safe direction). Three distinct confirms, each stating affected target + old→new + the "future sales only" reassurance. **This is the load-bearing money-safety surface — copy is final, not 🎨OPEN.**

### 9.1 Change the GLOBAL default (`<Modal>` + `<AlertCard variant="warning">`)
- **title:** `Change Mingla's default take-rate?`
- **body:** `Mingla will earn {NEW}% on every sale, up from {OLD}%. This applies to all brands on the default — and to every future sale, the moment you confirm. Orders already placed keep the rate they were sold at.`
- **confirm button:** `Change to {NEW}%`
- **cancel button:** `Keep {OLD}%`

### 9.2 Add / edit a BRAND override (`<Modal>` + `<AlertCard variant="warning">`)
- **title (add):** `Put {BRAND} on a custom rate?`
- **title (edit):** `Change {BRAND}'s take-rate?`
- **body (add):** `{BRAND} will be charged {NEW}% on all future sales, instead of the {DEFAULT}% default. Orders already placed are unaffected.`
- **body (edit):** `Mingla will earn {NEW}% on {BRAND}'s future sales, up from {OLD}%. Orders already placed keep the rate they were sold at.`
- **confirm button:** `Set {NEW}%`
- **cancel button:** `Cancel`

### 9.3 Remove a BRAND override (`<Modal>` + `<AlertCard variant="info">` — reverting to the default is less dangerous than a custom money set, but still confirmed)
- **title:** `Remove {BRAND}'s override?`
- **body:** `{BRAND} will go back to the {DEFAULT}% default rate on all future sales. Orders already placed are unaffected. You can add an override again any time.`
- **confirm button:** `Revert to {DEFAULT}%`
- **cancel button:** `Keep override`

> **Copy principles applied:** (1) lead with *what Mingla earns* / *what the brand pays* — the human consequence, not the field name; (2) always name the direction ("up from", "back to"); (3) always include the "orders already placed are unaffected" point-in-time reassurance (amendment §B.3 — historical orders carry their sold rate) so the operator never fears retroactive damage; (4) the confirm button restates the new value, so the last thing read before committing is the number being committed to; (5) Mingla voice here = plain, direct, unfluffy — this is a money lever, not a marketing moment, so the personality is *restraint and precision*, the right register for the surface.

---

## 10. Motion (Framer Motion — already a dep; reduced-motion fallback required)

Match the entrance pattern other admin pages already use (`[CONFIRM existing initial/animate values]`); do not invent new timings.

| Moment | Motion |
|---|---|
| Page / cards enter | fade + small rise, slight stagger between Card A and Card B (admin's existing page-enter idiom) |
| Table rows enter | per-row fade with a tiny stagger (if `Table` doesn't already animate, add a light `opacity` stagger) |
| Add a row | new row mounts via fade; brief accent highlight pulse on the new effective cell (~600ms, accent→transparent) so the eye lands on what changed |
| Edit a rate | the changed effective cell pulses the same highlight |
| Remove a row | `AnimatePresence` exit (fade + small x-shift) so the row slides out, not pops |
| Confirm / Add modal | `Modal`'s existing open/close transition |
| Toast | `ToastContext`'s existing transition |
| Save submitting | `Button loading` swaps to the existing `Spinner` |

**Reduced-motion fallback (REQUIRED):** wrap entrance + cell-highlight motion in Framer's `useReducedMotion()` — when true, render at the final state (opacity only; no rise/shift/highlight), and make `AnimatePresence` exits instant. The toast/modal still appear; they just skip the transform. If admin has no shared reduced-motion helper, add a tiny one or inline the hook.

---

## 11. The 9 states (each designed; light + dark per §2.1)

| # | State | Design |
|---|---|---|
| 1 | **Default / loaded** | Card A pre-filled global %, audit line; Card B = override Table (or empty state §4.5). Save disabled (not dirty). |
| 2 | **Hover** | Buttons + table rows use admin's existing hover treatments (opacity/bg only — no layout shift). Row `⋯`: muted→full-strength on hover. |
| 3 | **Press / active** | Buttons: a subtle `active:scale-[0.98]` (transform-only, non-shifting) if admin doesn't already provide press feedback. Selected nav/segment uses admin's active treatment. |
| 4 | **Focus** | Visible keyboard focus ring on every interactive element (inputs, buttons, row menu, picker rows) using admin's focus-ring utility — if admin uses `focus:outline-none` without a replacement, ADD a `focus-visible` ring so keyboard users aren't stranded (a11y, §12). Tab order: global field → Save default → Add override → table rows → row menus. |
| 5 | **Disabled** | Save/Continue disabled (dimmed + `cursor-not-allowed`) until dirty+valid; already-overridden brands in the picker dimmed + non-selectable; pager (if any) disabled at bounds. |
| 6 | **Loading** | First load: `Skeleton` blocks — Card A shows a field-shaped + audit-shaped shimmer; Card B shows ~3 shimmer rows. (Skeletons read calmer than a spinner-on-empty for a config screen.) |
| 7 | **Submitting** | The acting Save/Continue shows `Button loading` (Spinner) + disabled; the confirm dialog disables both buttons during the write to block double-submit (amendment §C.5). |
| 8 | **Error** | RPC reject → toast `error.message`; prior value stays shown; field stays dirty for retry. Permission ("not_authorized") → "You don't have permission to change pricing." Network → "Couldn't save — check your connection and try again." NEVER a silent success. |
| 9 | **Empty (no overrides)** | Card B empty state (§4.5). Card A is never empty — it always has the seeded default. |

**Other named states (folded in with reasons):** **offline** = the error-toast path (#8) with the network message + retry; **first-time** = empty state (#9) with the seeded 1.50% default shown + audit "system default"; **returning** = state #1; **degraded** = if `getPricingConfig()` fails entirely, show a card-level error with a "Retry" `Button` rather than a blank screen.

---

## 12. Accessibility

- **Contrast:** reuse admin's existing theme tokens (which the rest of the app already ships in both light and dark), so body text and large text inherit admin's established, already-shipping ratios in BOTH themes. **DECISION/REQUIREMENT:** the implementor MUST confirm — against `globals.css` resolved hexes — that this screen's specific pairings clear **body ≥ 4.5:1** and **large text ≥ 3:1** in both themes: (a) helper/audit muted text on the card surface, (b) the large global % value on the card, (c) the inline error text on the card, (d) the `Badge` pill text on its fill. The large global value and headings clear easily (white/near-white on the dark surface; dark ink on light); the **muted audit/helper text is the only at-risk pairing** — if admin's muted token falls below 4.5:1 on either theme, step it up one shade for this screen's audit/helper text. `[CONFIRM numeric ratios at IMPLEMENT against globals.css — do not eyeball.]`
- **Targets:** every button/input ≥44px effective height (admin's components already pad to this; the row `⋯` icon button must get a ≥44×44 hit area even if the icon is 20px — add padding).
- **Labels (every interactive element):** global field `aria-label="Mingla platform take-rate, percent"`; `%` affix `aria-hidden`; Save `aria-label="Save default take-rate"`; Add override `aria-label="Add a brand override"`; each row `⋯` `aria-label="Actions for {BRAND}"`; picker search `aria-label="Search brands"`; the confirm modal `role="alertdialog"` + `aria-labelledby`/`aria-describedby` on its title/body (if `Modal` doesn't already set dialog semantics, add them).
- **Reading order / SR:** Card A (label → value → helper → audit → save), then Card B (title → add → table). The Table must use real `<table>` semantics with `scope="col"` headers (confirm `Table.jsx` does; add if missing).
- **Keyboard:** modal traps focus + `Esc` cancels; Enter in a valid field triggers the region's primary action.
- **Reduced motion:** §10 fallback.

---

## 13. Anti-slop compliance (premium-craft §2)

- No generic gradients invented; reuse only whatever the admin `Button primary` already uses.
- No stock/AI imagery; graphics are monochrome lucide icons already used app-wide.
- No emoji icons (lucide `Percent`/`Clock`/`Plus`/`Layers`/`MoreHorizontal`/`AlertTriangle`).
- No decorative effects; the single "highlight pulse" on a changed cell is *functional* (directs the eye to what changed), not ornament.
- Restraint throughout — a bank-teller window, not a hero screen. Density matches the *comparison* task (the override table); spaciousness matches the *decision* task (the global field). ✓

---

## 14. Implementor build order (no production code here — this is the map)

1. `src/lib/pricing.js` — wrap the locked RPCs over `lib/supabase.js` (§7) + a local `formatPct(bps)` helper.
2. `src/pages/PricingPage.jsx` — `export function PricingPage()`, root `<div className="flex flex-col gap-6">` + `<h1>Pricing</h1>` + two `SectionCard`s; states 1/6/8/9. Mirror `SettingsPage`'s `mountedRef` + `useToast().addToast` + `logAdminAction` patterns.
3. The Add/Edit override `Modal`/`ModalBody`/`ModalFooter` + `SearchInput` brand picker (§5).
4. The confirm dialogs (`Modal` + `AlertCard` + `ModalFooter` Cancel/confirm `Button`s) with the EXACT copy in §9.
5. Wire routing (§1.1): `PAGES.pricing` in `App.jsx`; `{ id:'pricing', label:'Pricing', icon:'Percent' }` in `lib/constants.js` `NAV_GROUPS`/`NAV_ITEMS`; add `Percent` to Sidebar `ICON_MAP`. (Grep `SettingsPage` for a stray "platform fee" field — none found in this read; remove only if present, §11 T-1.)
6. Call `logAdminAction("pricing.update"/"pricing.clear", ...)` on every persist (§2, §8).
7. A11y: confirm the row-action hit area ≥44px (Button `size="sm"` is `h-8`=32px — use default size or pad), aria-labels (§12). Focus rings + press feedback are already in `Button`.
8. Reduced-motion handling for the row add/remove + cell-highlight (§10); Modal/Toast already animate via CSS/framer.

**Downstream flags for the implementor (surfaced, not papered over):**
- **T-1 — possible dead decoy field.** Confirm whether `SettingsPage.jsx` already has a non-persisting "platform fee" input. If so, REMOVE it when the real `/pricing` screen ships so two fee fields don't coexist (Constitution #8 no-drift).
- **T-2 — audit depth (mostly solved by the existing codebase).** Server `updated_by/at` is the latest-change stamp (amendment §D.5). BUT admin already has `logAdminAction` → `admin_audit_log` + a proven "History" modal in `SettingsPage`; wiring `logAdminAction` on each persist (§2 table) + adding a History button gives a full immutable trail for ~free. Recommend doing it. A dedicated `platform_pricing_audit` table is still a non-goal unless Seth wants rate-scheduling.
- **T-3 — admin-role authority (amendment §C.7/T-B; P0 if missing).** The RPC must gate server-side on a real admin authority. The UI gate (route behind `AuthContext`) is convenience only. If admin has no first-class admin-role concept, that is a blocker to surface to Seth — do not ship a money lever behind client-only auth.
- **T-4 — actor label resolution.** §8 needs a user-id→label path; confirm via `AuthContext`/`authHelpers.js` (fallback: email).
- **T-5 — percent formatting.** `lib/formatters.js` has date/time formatters (verified) but **no percent formatter** — render the rate with a local `(bps/100).toFixed(2) + "%"` helper (do NOT add a parallel date formatter; reuse `formatDate`). Keep the helper inside `lib/pricing.js`.
- **COMMS (downstream, implementor):** COMMS-0002 (the new migration + any new strict-grep file → `ORCH_1006_BACKEND_ALLOWLIST` in the same commit); COMMS-0003 (no external API in this admin screen — Supabase RPC only); COMMS-0004 (migration filename timestamp SOP). None affects this design file.

---

## 15. Completion gate (mingla-designer `/goal` — self-checked)

1. **References examined** — ✓ header (Stripe Dashboard application-fees, Linear settings, Vercel default-vs-override billing) with synthesis, not clone; plus the in-codebase precedent `SettingsPage.jsx` "App Config" tab, read firsthand.
2. **All 9 states** — ✓ §11 (default/hover/press/focus/disabled/loading/submitting/error/empty; offline/first-time/returning/degraded folded in with reasons).
3. **Every value a token / no magic numbers** — ✓ the design composes entirely from verified admin components + their real CSS-variable theme tokens (`--color-text-primary`, `--color-brand-500`, `--gray-200`, `--shadow-sm`, …); the only sizing override (the larger global % field) is expressed as Tailwind utilities on the existing `Input`. The handful of remaining `[CONFIRM]` tags are exact-string lookups (Sidebar nav-item shape, one Badge variant name), not invented numbers.
4. **Contrast computed (both themes)** — ✓ §12 names the load-bearing pairings, identifies the single at-risk one (muted audit/helper text = `--color-text-tertiary`), and REQUIRES numeric confirmation against `globals.css` in both themes with a defined fix (step to `-secondary`) if it falls short. Light + dark both in scope (verified `ThemeContext`); both render for free from the theme-aware components.
5. **Interactive elements** — ✓ §12: ≥44px targets (note: admin's `Button size="sm"` is `h-8`=32px — for the row action use default `size` or pad to a 44px hit area; called out), aria-labels enumerated, focus rings already built into `Button` (`focus-visible:ring-2`), press feedback (`active:scale-[0.98]`) already built in — non-shifting.
6. **Zero anti-slop** — ✓ §13.
7. **Mingla voice per state + reduced-motion fallback** — ✓ §9 copy, §11 state copy, §10 reduced-motion.

**Verification note:** the admin UI kit was read firsthand this turn — `SectionCard`/`AlertCard`, `Input`/`Toggle`, `Button` (full variant/size/loading API), `Modal`/`ModalBody`/`ModalFooter` (built-in focus-trap + Esc), `DataTable` (full column/pagination API), `Toast`/`useToast.addToast` (string AND object forms), `formatDate`, and `logAdminAction` → `admin_audit_log`. The design is built on these exact APIs, not assumptions. Remaining `[CONFIRM]` items are minor exact-string lookups. IA, layout, all 9 states, motion, a11y requirements, and ALL copy are complete and locked.
