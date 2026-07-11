# SPEC — ORCH-1334 [rsvp-guest-console-identity-gap]

**Phase:** SPEC (binding contract). NO product code, NO migration apply, NO PR in this phase.
**Worktree:** `~/Desktop/mingla-orchs/1334-[rsvp-guest-identity]/` on branch `1334-rsvp-guest-identity`
**Upstream:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1334_RSVP_GUEST_CONSOLE_IDENTITY.md` (sealed `9f4604fa9`, confidence **proven**)
**Date:** 2026-07-10
**Scope decision source:** Seth's two settled decisions (SHOW app-member contact; fix ALL THREE surfaces, preserving each RPC's distinct semantics).

---

## 1. Executive summary

When someone RSVPs from **inside the Mingla app**, the host's guest console shows "Guest / App
guest" instead of their real name — even though their identity is fully on file. The write path
deliberately stores a sentinel `guest_name='Guest'` for app users (identity is meant to be
"profile-inherited"), but the **read** RPC `host_list_rsvp_guests` returns raw `event_rsvps`
columns with **no `profiles` join**, so the inheritance never happens. Two sibling read RPCs have
the identical gap: admin `admin_list_event_rsvps` and consumer-calendar `fetch_user_going_rsvps`.
The rows are also **not tappable**, so a host cannot open a guest to see where they came from.

This SPEC defines the **read-time fix (R1)** across all three RPCs: resolve identity + provenance
from `profiles` at read time inside guard-first `SECURITY DEFINER` functions, returning
`display_name / username / avatar_url` plus (host & admin only) `email` (always) + `phone` (when
present) + a `source` discriminator (`'app'` vs `'web'`). The business-app host console gets an
avatar, an "On Mingla / RSVP'd on web" badge, a **pressable row**, and a NEW **guest-detail sheet**
(pixel-precise designer contract embedded in §4E). The write path is deliberately **untouched** —
the `'Guest'` literal becomes harmless once reads resolve identity. Fixes every existing row at
once with zero backfill.

**Layman outcome (also at §12):** the host will see the real person — name, photo, and an "On
Mingla vs RSVP'd on web" tag — for every guest, and can tap any guest to see full details and
contact. Nothing about who can RSVP or how they RSVP changes; only what the host is shown.

---

## 2. Scope & non-goals

### In scope (R1 — read-time identity/provenance resolution)
- **Host RPC** `host_list_rsvp_guests` → `RsvpGuestConsole.tsx` (business iOS/Android/web-preview).
- **Admin RPC** `admin_list_event_rsvps` → `OfferingDetailView.jsx` attendee list (admin web).
- **Consumer RPC** `fetch_user_going_rsvps` → app-mobile "Going / calendar" (SELF-facing, identity-only).
- Business-app **host console row redesign** + NEW **guest-detail sheet** (designer contract §4E).
- One NEW migration (all three RPCs), `RsvpGuest` type + mapper extension, console + sheet UI, one admin-view edit.

### Non-goals (explicitly OUT — and why)
1. **The write path is UNTOUCHED.** `submit_event_rsvp`, `public-submit-rsvp` edge fn,
   `rsvpDeckService.ts`, `rsvpEvents.ts` — NOT modified. The stored `'Guest'` literal is left as-is;
   read-time resolution makes it harmless. Rationale: read-time fixes ALL existing rows with zero
   backfill and stays off the higher-risk write/capacity path (investigation R3 rejected). Also
   honors COMMS-0040 (do not touch the public-RSVP write path).
2. **No RSVP↔ticket merge.** RSVP is a deliberately separate, moneyless, ticketless pipeline
   (COMMS-0057 / ORCH-1206). Parity with the standard `/event/[id]/guests` list is achieved via
   **shared FIELD SEMANTICS ONLY** (name/avatar/source), NOT by routing RSVP through the
   orders/tickets path.
3. **No new provenance CAPTURE.** invite/referral source, who-invited, share-channel/QR/campaign
   attribution, and primary-web-guest→account linkage are NOT in the data model (investigation F-8)
   → out of a read-only fix. The `source` discriminator is the app-vs-web binary only.
4. **Consumer twin adds NO contact.** `fetch_user_going_rsvps` stays self-facing identity-only —
   NO email/phone columns added (see §4D, Constraint C-CONSUMER).
5. **No consumer app-mobile host console.** None exists (investigation: empty grep). No app-mobile
   change for the host path.
6. **Search / CSV export / check-in surfacing / cross-history** on the RSVP console (parity-matrix
   gaps) are NOT in scope — candidate follow-ups.
7. **Consumer twin self-guard hardening** (server-side `p_user_id = auth.uid()` enforcement) is NOT
   added here — see §10 Open Question OQ-2 and §4D note (pre-existing property; touching it risks
   the `service_role` + CI callers). Flagged, not fixed.

### Assumptions (all verified live/in-code this phase — see §4A evidence)
- `events.brand_id` is `uuid NOT NULL`; every event (incl. RSVP) is brand-owned. No solo/NULL-brand
  RSVP events exist. → the brand-rank guard is complete (see §4A).
- `profiles.email` is 100% populated (61/61 live), `profiles.phone` ~49% (30/61). All `text`.
- FK: `event_rsvps.user_id → auth.users(id)` and `profiles.id → auth.users(id)` ⇒
  `event_rsvps.user_id = profiles.id`.

---

## 3. Cross-Surface Impact Declaration (MANDATORY per-surface table)

| # | Surface | Covered? | User-visible behavior demanded | Files touched | Parity |
|---|---------|----------|--------------------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile` iOS) | **Partial (consumer twin only)** | On the user's OWN "Going" list, their pass shows their REAL name, not "Guest". No other-guest contact ever. | `20261224…_orch_1334…sql` (RPC body only) | Manual (RPC shared w/ Android; no client edit) |
| 2 | Consumer Android (`app-mobile` Android) | **Partial (consumer twin only)** | Same as iOS. | same migration | Manual (same RPC) |
| 3 | Buyer/anon Web | **Not covered** | — | — | Host guest console is authed host-only; NOT in the anon allowlist (`guests.tsx:5`). |
| 4 | Business iOS | **Covered (primary)** | Real name + avatar + "On Mingla/RSVP'd on web" badge per row; tap row → detail sheet w/ identity + contact. Actions intact. | migration + `rsvpApprovals.ts` + `RsvpGuestConsole.tsx` + NEW `RsvpGuestDetailSheet.tsx` | Manual |
| 5 | Business Android | **Covered (primary)** | Same as iOS, with Android opaque-glass fallback (§4E-9). | same as Business iOS | Manual (Platform.select) |
| 6 | Admin Web (`mingla-admin`, adjacent) | **Covered** | Attendee list shows real name + source badge (not "Guest") for app RSVPs; resolved email available. | migration + `OfferingDetailView.jsx` | Manual |
| 7 | Business Web preview (adjacent) | **Covered** | Identical to Business iOS/Android (same RN component); DEFINER/guard key off caller JWT — platform-agnostic, no RLS delta. | same as Business iOS | Automatic (shared RN code) |

**COMMS-0040 coordination note:** this ORCH touches ONLY the authed HOST guest console
(`RsvpGuestConsole.tsx`, a NEW in-`src` detail sheet component), the three READ RPCs, and one admin
view. It does **NOT** touch any file coordinated by COMMS-0040/ORCH-1163 (public-RSVP-page
standardization): `RsvpPublicBody.tsx`, `preview.tsx`, `RsvpMomentumDecision.tsx`,
`ConsumerEventDetailScreen.tsx`, `PublicEventPage.tsx`, `packages/offering-rendering/*`,
`rsvpEvents.ts`, `public-submit-rsvp`. The new detail sheet is a `src/components/rsvp/` component
(NOT a new `app/rsvp/*` route), so there is no route-dir overlap. No coordination conflict.

---

## 4. Layered specification

### 4A. Ownership model verification (the CRITICAL landmine — RESOLVED)

**Question:** can an RSVP event be solo/consumer-hosted (brand_id NULL) as well as brand-hosted? If
so the guard must cover both, or solo hosts get locked out.

**Verified answer: NO — every event is brand-owned; solo/NULL-brand RSVP events do not exist.**

Evidence (live prod `gqnoajqerqhnvulmnyvv`, read-only, this phase):
- `information_schema.columns` for `public.events`: the ONLY ownership columns are
  **`brand_id uuid NOT NULL`** and **`created_by uuid NOT NULL`**. There is **no** `owner_id`,
  `host_id`, `host_user_id`, `user_id`, `creator_id`, or `account_id` column. There is no
  solo/consumer ownership axis on `events`.
- Census: `SELECT count(*) FILTER (WHERE brand_id IS NULL) FROM events WHERE event_type='rsvp'` →
  **0** (4/4 RSVP events have `brand_id` set).
- `biz_brand_effective_rank(NULL, uid)` evaluates to **0** (both branches require a `brands` row
  matching `brand_id`; NULL matches nothing) — below `event_manager`. So even a hypothetical
  NULL-brand event would be rejected by the existing write path, i.e. there is no working
  solo-host code path to protect.
- The already-shipped live host RPCs `host_set_rsvp_status` and `host_bulk_approve_rsvps`
  (`20261123000000_orch_1206…`:281, :397) and the RLS policy `event_rsvps_host_read`
  (`20261004000000…`:120-129) ALL guard on the SAME predicate with NO solo fallback:
  `biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank('event_manager')`.

**Conclusion:** mirroring the shipped write-path guard is airtight — the read path gets **identical
authorization** to approve/deny. A host who can act on a guest can see them; no host who can act is
denied. `created_by` is NOT an authorization axis in any existing RSVP guard and is NOT used here.
A solo *creator* who owns a *personal brand* passes via `brand_owner` rank in
`biz_brand_effective_rank` — fully covered.

> **VERIFIED HOST GUARD PREDICATE (pin — identical across all host surfaces):**
> ```sql
> IF NOT EXISTS (
>   SELECT 1 FROM public.events e
>   WHERE e.id = p_event_id
>     AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
>           >= public.biz_role_rank('event_manager'::text)
> ) THEN
>   RAISE EXCEPTION 'insufficient_event_permission';
> END IF;
> ```

### 4B. Database — Host RPC `host_list_rsvp_guests` (DROP+CREATE, DEFINER)

**Current (authoritative latest — `20261012000000_orch_1150_rsvp_maybe.sql`:197-223):**
`LANGUAGE sql SECURITY INVOKER STABLE`, RETURNS TABLE of **12 columns** (order is load-bearing):
`id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status,
plus_count, waitlisted_at, promoted_at, created_at`. No `profiles` join. `ORDER BY` CASE bucket
(pending 0 / going+approved 1 / waitlisted 2 / maybe 3 / else 4), then `created_at ASC`.

**After (NEW migration; DROP+CREATE mandatory — language + column-set + security change):**
- `DROP FUNCTION IF EXISTS public.host_list_rsvp_guests(uuid);`
- `LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public` (plpgsql required so the guard
  can `RAISE` BEFORE any row is produced — a `LANGUAGE sql` body cannot guard-first).
- **Guard-first:** the §4A predicate is the FIRST executable statement, then `RETURN QUERY`.
- **RETURNS TABLE = the existing 12 columns in the SAME ORDER, then APPEND 6 new columns:**

| # | New column | Type | Expression | Notes |
|---|-----------|------|------------|-------|
| 13 | `display_name` | text | `COALESCE(NULLIF(btrim(p.display_name),''), NULLIF(r.guest_name,'Guest'), r.guest_name)` | Real name for app; typed name for web; never fabricates. Worst case = honest `'Guest'`. |
| 14 | `username` | text | `p.username` | app only, else NULL |
| 15 | `avatar_url` | text | `p.avatar_url` | app only, else NULL |
| 16 | `email` | text | `COALESCE(NULLIF(btrim(p.email),''), NULLIF(btrim(r.guest_email),''))` | app profile email (always present) OR web typed email; NULL if neither |
| 17 | `phone` | text | `COALESCE(NULLIF(btrim(p.phone),''), NULLIF(btrim(r.guest_phone),''))` | present ~49% app / web-typed; **NULL when absent — never fabricated** (Constitution #9) |
| 18 | `source` | text | `CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END` | the core "where from" answer |

- **Join:** `LEFT JOIN public.profiles p ON p.id = r.user_id` (resolves ONLY the RSVP-er's own
  profile; rows bounded to this event's RSVPs — cannot scrape arbitrary profiles).
- **The existing 12 columns keep byte-identical expressions**; the `ORDER BY` CASE bucket
  (incl. `WHEN r.rsvp_status = 'maybe' THEN 3`) and `created_at ASC` are preserved **byte-for-byte**.
- `GRANT EXECUTE ON FUNCTION public.host_list_rsvp_guests(uuid) TO authenticated;`
- Trailing `NOTIFY pgrst, 'reload schema';`

**DEFINER-safety proof (I-PROPOSED-1334-RSVP-HOST-LIST-DEFINER-GUARD):** (1) guard is the first
executable statement → no row returned without `event_manager` rank on the event's brand; (2)
`SET search_path = public` blocks search_path injection; (3) only the 6 whitelisted columns are
projected — never `SELECT p.*` → cannot leak `visibility_mode`, `bio`, or any other profile field;
(4) the single input is `p_event_id`; rows are limited to that event's RSVPs → not a general profile
scraper. Without the guard, DEFINER would let any authenticated user pass any `event_id` and read
guest identity/contact — the guard is mandatory.

### 4C. Database — Admin RPC `admin_list_event_rsvps` (CREATE OR REPLACE — jsonb, no DROP)

**Current (authoritative latest — `20261206000001_orch_1273_offerings_read_rpcs.sql`:~54-178):**
`LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'`, RETURNS **jsonb**
`{rows, total, counts}`. Guard `IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'`
(existing, KEEP). Each row is a `jsonb_build_object` with `rsvp_id, guest_name, guest_email,
guest_phone, user_id, rsvp_status, approval_status, plus_count, waitlisted_at, promoted_at,
created_at, plus_guests`.

**After (CREATE OR REPLACE — jsonb return is schemaless to the client, so NO DROP needed):**
- Keep the `is_admin_user()` guard (admin/staff gate — the verified ADMIN guard predicate).
- Add `LEFT JOIN public.profiles p ON p.id = r.user_id` in the `ranked` CTE's underlying select
  (or resolve inline per row).
- **Append these keys to each row's `jsonb_build_object`** (existing keys unchanged):
  - `'display_name'`  → `COALESCE(NULLIF(btrim(p.display_name),''), NULLIF(r.guest_name,'Guest'), r.guest_name)`
  - `'username'`      → `p.username`
  - `'avatar_url'`    → `p.avatar_url`
  - `'email'`         → `COALESCE(NULLIF(btrim(p.email),''), NULLIF(btrim(r.guest_email),''))`
  - `'phone'`         → `COALESCE(NULLIF(btrim(p.phone),''), NULLIF(btrim(r.guest_phone),''))`
  - `'source'`        → `CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END`
- Counts + total + pagination + `plus_guests` unchanged. `GRANT`/`NOTIFY` unchanged.

**DEFINER-safety:** guard-first `is_admin_user()` unchanged; whitelisted keys only; `search_path`
pinned. Consistent with the existing admin-PII-via-definer-RPC invariant.

### 4D. Database — Consumer RPC `fetch_user_going_rsvps` (CREATE OR REPLACE — identity only)

**Current (authoritative latest — `20261016000001_orch_1163_event_rsvp_guests.sql`:~405-508):**
`LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public`. RETURNS TABLE incl.
`display_name text`. **Self-facing**, two-branch `UNION ALL`:
- (a) primary rows — `WHERE r.user_id = p_user_id`, `display_name := r.guest_name` (= `'Guest'` for app users).
- (b) matched-guest rows — `WHERE g.matched_user_id = p_user_id`, `display_name := g.name`.

Caller passes `auth.uid()` (`calendarService.ts:517`). Client already reads `display_name`.

**After (CREATE OR REPLACE — RETURNS TABLE column set/order UNCHANGED, so no DROP required):**
- **Column set is IDENTICAL** — only the `display_name` EXPRESSION changes. NO new columns.
  **NO `email`/`phone` added** (Constraint C-CONSUMER below).
- Branch (a) primary: `LEFT JOIN public.profiles pr ON pr.id = r.user_id`; set
  `display_name := COALESCE(NULLIF(btrim(pr.display_name),''), NULLIF(r.guest_name,'Guest'), r.guest_name)`.
- Branch (b) guest: `LEFT JOIN public.profiles pg ON pg.id = g.matched_user_id`; set
  `display_name := COALESCE(NULLIF(btrim(pg.display_name),''), g.name)`.
- Everything else (self-scoping WHERE clauses, `invited_by`, all event/brand/date columns, QR,
  `GRANT … TO authenticated, service_role`, `NOTIFY`) **byte-identical**.
- **No client edit** — `calendarService.ts` already maps `display_name`; the fix is migration-only.

> **Constraint C-CONSUMER (I-PROPOSED-1334-RSVP-CONSUMER-SELF-IDENTITY-ONLY, DRAFT):** the consumer
> twin resolves DISPLAY IDENTITY only (real `display_name`). It MUST NOT add `email`, `phone`, or
> any contact column, and MUST keep its self-scoping WHERE clauses (`r.user_id = p_user_id` /
> `g.matched_user_id = p_user_id`). A user viewing their own calendar sees only their OWN resolved
> name — never another guest's contact. Contact exposure is host/admin-only (§4B/§4C). Since the
> resolved `display_name` is always the row-owner's (`= p_user_id`) own name, this adds no
> cross-user exposure.

**Note on self-guard (OQ-2):** the RPC does not enforce `p_user_id = auth.uid()` server-side
(self-scoping is via the client passing `auth.uid()`, plus `service_role`/CI callers). This is a
pre-existing property; adding a server-side self-guard risks breaking `service_role` + CI callers
and is OUT of scope here (flagged §10, §11 Discovery).

### 4E. Component / UI — embedded mingla-designer contract

> Produced inline by `mingla-designer` this phase and embedded here (forensics-invoked; the
> implementor builds from THIS, never re-invokes the designer). Tokens are the real values from
> `mingla-business/src/constants/designSystem.ts`. Dark surface is the only theme (business console
> is dark-canvas). Reuses the shared `Sheet` (`src/components/ui/Sheet.tsx`) and the standard guest
> list's avatar convention (hue-hash + initials, `app/event/[id]/guests/index.tsx:88-101`).

#### 4E-1. IA & flow
- **Console (existing screen, redesigned rows):** sections Pending → Going → Maybe → Waitlist. Each
  row answers three questions at a glance: **who** (avatar + name), **where from** (source badge),
  **what next** (action buttons / status icon). Tapping the row body opens the **detail sheet**
  (progressive disclosure: identity + contact + provenance without leaving the list).
- **Detail sheet (NEW, bottom sheet overlay — NOT a route):** identity block → provenance
  (source + RSVP time) → status/approval → plus-ones → contact block → host actions (state-gated).
- Flow: `console row press → RsvpGuestDetailSheet(visible, guest) → [Approve/Deny/Remove fires
  mutation → sheet closes on success | scrim/handle dismiss]`. Actions in the sheet mirror the
  row actions and are gated by the same state (Pending → Approve/Deny; Going → Remove; Maybe/
  Waitlist → none). Error → inline toast (existing console `Toast`), sheet stays open.

#### 4E-2. Layout & spacing grid (4/8pt via `spacing` tokens)

**Row (redesign of `styles.guestRow`):** `flexDirection: row`, `alignItems: center`,
`gap: spacing.sm (8)`, `paddingVertical: spacing.sm + 2 (10)`, `paddingHorizontal: spacing.md (16)`,
`borderRadius: radius.md (12)`, `overflow: 'hidden'`.
- **Avatar** (leading): 40×40, `borderRadius: radius.full`, `marginRight: spacing.sm (8)`.
- **Info column** (`flex: 1`, `minWidth: 0`): line 1 = name (+ `+N` plus chip inline); line 2 =
  source badge + secondary meta (contact-or-time), `gap: spacing.xs (4)`, `marginTop: 2`.
- **Trailing:** action column (Pending: Approve+Deny, `gap: spacing.xs`) OR single action (Going:
  Remove) OR status icon (Maybe: `users`; Waitlist: `clock`). The trailing cluster is OUTSIDE the
  row's press target (see §4E-5 press-isolation).

**Detail sheet:** `Sheet snapPoint` = large content detent (fits identity + contact + actions;
`~0.62` ratio, or content-height). Inner padding `spacing.lg (24)` horizontal, `spacing.md (16)`
top, `insets.bottom + spacing.lg` bottom. Vertical block gaps `spacing.lg (24)`; within-block row
gaps `spacing.sm (8)`.
- Identity block: avatar 64×64 (`radius.full`) centered or leading; name below/beside; `@username`
  under name; source badge under username.
- Contact block: label-value rows, each `minHeight: 44` (tap target for copy/mailto later), label
  `text.tertiary`, value `text.primary`.
- Action bar: pinned bottom, buttons full-width stack or 2-up, `gap: spacing.sm (8)`.

#### 4E-3. Type scale (map to `typography` tokens)

| Element | Token | Value |
|---------|-------|-------|
| Row name | `typography.bodySm` bumped to weight 600 (keep existing `guestName`) | 14/20, 600 |
| Row source badge text | `typography.micro` | 11/14, 600, +0.4 |
| Row secondary meta (contact/time) | `typography.caption` | 12/16, 500, +0.2, color `text.tertiary` |
| Plus chip `+N` | `typography.caption` weight 700, color `accent.warm` | 12/16 |
| Sheet name | `typography.h3` | 20/32, 600 |
| Sheet `@username` | `typography.bodySm` color `text.secondary` | 14/20 |
| Sheet section label | `typography.labelCap` color `text.tertiary` | 12/16, 600, +1.4, UPPERCASE |
| Sheet contact value | `typography.body` | 16/24 |
| Sheet meta (time/status) | `typography.bodySm` | 14/20 |
- **Dynamic Type:** all `Text` allow default scaling; name/username use `numberOfLines={1}` +
  `ellipsizeMode="tail"`; sheet contact values wrap (no truncation).

#### 4E-4. Color & token mapping (dark canvas)

| Element | Token | Value | Contrast |
|---------|-------|-------|----------|
| Row / sheet surface (iOS) | `glass.tint.profileBase` | `rgba(255,255,255,0.04)` over `canvas.discover` | — |
| Row / sheet surface (Android) | opaque fallback | `#23262b` | — |
| Row border | `glass.border.profileBase` | `rgba(255,255,255,0.08)` | — |
| Name / sheet name | `text.primary` | `rgba(255,255,255,0.96)` | ≥14:1 on surface ✓ |
| Secondary meta / username | `text.secondary` | `rgba(255,255,255,0.72)` | ≥7:1 ✓ |
| Tertiary label / time | `text.tertiary` | `rgba(255,255,255,0.52)` | ~4.6:1 on `#23262b` ✓ AA |
| **Source badge "On Mingla"** | fill `accent.tint` `rgba(235,120,37,0.28)`, border `accent.border` `rgba(235,120,37,0.55)`, text `accent.warm` `#eb7825` | — | badge text `#eb7825` on the tinted-over-dark fill ≥4.5:1 ✓ |
| **Source badge "RSVP'd on web"** | fill `semantic.infoTint` `rgba(59,130,246,0.18)`, border `rgba(59,130,246,0.55)`, text `semantic.info` `#3b82f6` (lighten to `#7ab0ff` if AA fails on the tinted fill) | — | verify ≥4.5:1; use `#7ab0ff` variant if `#3b82f6` misses |
| Avatar image bg (loading) | `glass.tint.profileBase` | — | — |
| Avatar initials bg | `hsl(hashStringToHue(id), 60%, 45%)` | per-guest hue | initials `#fff` on 45%-L hue ≥4.5:1 ✓ |
| Approve btn | `accent.warm` `#eb7825`, text `#fff` | (existing) | ✓ |
| Deny/ghost btn | `glass.tint.profileBase` + `glass.border.profileBase`, text `text.secondary` | (existing) | ✓ |
| Remove btn | `rgba(255,255,255,0.04)` + border `semantic.error` `#ef4444`, text `semantic.error` | (existing) | ✓ |

> **Badge AA rule:** the implementor MUST verify each badge's text-on-fill contrast ≥4.5:1 at build
> time; the web-source badge text falls back to `#7ab0ff` if `#3b82f6` fails on the info-tint fill
> over dark canvas (WCAG AA kit invariants I-38/I-39).

#### 4E-5. Every interactive state

**Row (whole row is a `Pressable` opening the sheet — press-isolation is CRITICAL):**
- **Default:** surface + border as §4E-4.
- **Pressed (row body):** `opacity: 0.92` + `backgroundColor` step to `glass.tint.profileL2`-ish
  (or `#2a2e34` on Android) via `Pressable` `style={({pressed}) => …}`. No haptic on open (opening a
  sheet is not a commit).
- **Press-isolation (no dead taps, Constitution #1):** the trailing action cluster
  (Approve/Deny/Remove) and the "Approve all" header button are SIBLINGS of the pressable row body,
  NOT children of it — OR wrapped so their `onPress` calls `e.stopPropagation()` and the row's
  press target excludes their bounds. **Required structure:** `guestRow` = `<View>` container →
  `<Pressable style={rowBody}>` (avatar + info, `flex:1`, opens sheet) + `<View actionCol>`
  (buttons) as a sibling. The buttons keep their own `onPress`; tapping a button NEVER opens the
  sheet, and tapping the row body NEVER fires an action. Both remain ≥44pt.
- **Loading (list):** existing `ActivityIndicator` state (unchanged).
- **Error (list):** existing "Couldn't load guests." + retry (unchanged).
- **Empty:** Going empty → existing "No one's confirmed yet." (unchanged). Row itself has no empty
  state.
- **Avatar states:** app + `avatarUrl` present → `<Image>` (fade-in on load, `onError` → initials
  fallback); else → initials tile (`getInitials(displayName)` on `hsl(hashStringToHue(guest.id),…)`).

**Detail sheet:**
- **Default:** identity + provenance + contact + state-gated actions.
- **Action pressed/loading:** the tapped action shows a spinner (`setStatus.isPending` /
  `bulkApprove` analog); other actions disabled while pending.
- **Action success:** sheet closes (`onClose`) after the list-invalidation resolves; console reflects
  the new bucket.
- **Action error:** sheet STAYS open; console `Toast` shows "Couldn't update {name}. Try again."
  (reuse existing copy).
- **Empty contact (app, no phone):** the phone row is OMITTED entirely — never "N/A", never a blank
  row (Constitution #9). Email row always present for app; for web, show whatever was typed, omit
  the rest.
- **Dismiss:** scrim tap (default), downward drag past 80px / velocity 600 (Sheet built-in), or a
  header close affordance if the sheet chrome provides one.

#### 4E-6. Motion (inherits the shared `Sheet` motion — do not reinvent)
- **Present:** trigger = row press. Spring translateY from off-screen bottom → rest.
  `withSpring {damping: 22, stiffness: 200, mass: 1}`; scrim `opacity 0 → 1` `rgba(0,0,0,0.5)`.
- **Dismiss:** `withTiming 240ms Easing.in(cubic)` translateY → off-screen; scrim → 0; unmount +280ms.
- **`prefers-reduced-motion`:** open uses `withTiming 200ms Easing.out(cubic)` (Sheet's built-in
  `REDUCE_MOTION_OPEN`); no spring bounce. Row press-opacity is instant (no cross-fade) under reduced
  motion.
- **Avatar image:** fade-in `opacity 0→1` 180ms on load; skip under reduced motion.
- No decorative motion beyond these — every animation communicates present/dismiss/feedback.

#### 4E-7. Accessibility
- Row body `Pressable`: `accessibilityRole="button"`,
  `accessibilityLabel="{displayName}, {source==='app'?'on Mingla':'RSVP'd on web'}. Tap for details."`
- Action buttons keep their existing labels ("Approve {name}", "Deny {name}", "Remove {name}",
  "Approve all {n}").
- Avatar `Image`: `accessibilityLabel="{displayName} avatar"`; initials tile
  `accessibilityElementsHidden` (name is already read on the row).
- Source badge is NOT color-only: the WORD ("On Mingla" / "RSVP'd on web") carries the meaning;
  color is reinforcement.
- Sheet: `accessibilityViewIsModal`, focus lands on the name; reading order identity → provenance →
  status → contact → actions. All targets ≥44pt (avatar 40 but non-interactive; row body & buttons
  ≥44 tall).
- All contrast pairings pass AA per §4E-4 (verify badge text at build).

#### 4E-8. Copy (Mingla voice, honest)
- Source badge: **"On Mingla"** (app) / **"RSVP'd on web"** (web).
- App member with resolvable name → show it. App member with NO resolvable name (defensive) →
  name line shows **"On Mingla member"** (honest, never a fabricated name), badge "On Mingla".
- Sheet section labels: **WHO** (identity), **WHERE FROM**, **STATUS**, **PLUS-ONES**, **CONTACT**.
- Sheet time: relative + absolute, e.g. "RSVP'd 2 days ago · Jul 8, 3:14 PM".
- Empty phone: omit; empty web contact: omit the missing lines.

#### 4E-9. Per-platform deltas
- **iOS:** translucent glass — row/sheet surface `glass.tint.profileBase` `rgba(255,255,255,0.04)`,
  border `rgba(255,255,255,0.08)`. Existing `ROW_BG = glass.tint.profileBase`.
- **Android (opaque-glass fallback, `ANDROID_GLASS_USES_OPAQUE_FALLBACK`):** row/sheet surface
  `#23262b` (existing `ROW_BG` android value), pressed `#2a2e34`, `overflow:'hidden'` to clip, NO
  Android shadow under the rounded fill. Do NOT reintroduce translucent Android fills.
- **Web preview:** same RN component; `Sheet.web` variant handles the sheet (compositor-CSS
  transition). No RLS delta (DEFINER keys off caller JWT).

#### 4E-10. Build-ready handoff (UI)
- Reuse: `Sheet` (`src/components/ui/Sheet.tsx`), `Icon`, `Button`, `ConfirmDialog`, `Toast`,
  `Image` (RN). Avatar helpers: copy `hashStringToHue` + `getInitials` inline into the console
  (match `app/event/[id]/guests/index.tsx:88-101` byte-for-byte) — do NOT refactor into a shared
  util this ORCH (scope). New tokens: NONE required (all values exist).

---

## 5. Success criteria (numbered, observable, per-surface where parity is manual)

- **SC-1 (host RPC identity):** `host_list_rsvp_guests(<rsvp-event-with-app-guest>)` returns, for an
  app-user row, `display_name` = the profile's real name (NOT `'Guest'`), `source='app'`, `email`
  non-null, and `avatar_url`/`username` populated when on file.
- **SC-2 (host RPC honest phone):** for an app-user row whose `profiles.phone` is NULL, the returned
  `phone` is NULL (omitted in UI) — never fabricated.
- **SC-3 (host RPC web parity):** for a web link-guest row, `display_name/email/phone` echo the typed
  `guest_name/guest_email/guest_phone`, `source='web'`.
- **SC-4 (host guard):** a caller with `biz_brand_effective_rank(brand, uid) < event_manager` on the
  event's brand gets `insufficient_event_permission` (no rows).
- **SC-5-iOS / SC-5-Android (console row):** each row shows avatar + real name + "On Mingla"/"RSVP'd
  on web" badge; the WHOLE row body is tappable and opens the detail sheet; iOS glass / Android
  opaque surfaces per §4E-9.
- **SC-6 (actions intact — no dead taps):** Approve / Deny / Remove / Approve-all each still fire
  their mutation; tapping an action does NOT open the sheet, and tapping the row body does NOT fire
  an action.
- **SC-7 (detail sheet):** opening a guest shows identity (avatar, name, @username, source badge),
  RSVP time (`created_at` relative+absolute), plus-ones (`plus_count` + web plus-one names when
  present), status/approval, and a contact block (email always + phone when present for app; typed
  contact for web); phone omitted when null.
- **SC-8 (admin):** admin attendee list renders the real name + source badge (not "Guest") for app
  RSVPs; resolved `email` available; existing approve/deny/remove + counts unchanged.
- **SC-9 (consumer twin self-identity):** `fetch_user_going_rsvps(auth.uid())` returns the user's own
  REAL `display_name` on primary rows (not "Guest"); NO `email`/`phone` columns exist on the return;
  passing a different `user_id` still returns identity-only (no contact).
- **SC-10 (write path untouched):** no change to `submit_event_rsvp` / `public-submit-rsvp` /
  `rsvpDeckService.ts` / `rsvpEvents.ts`; new app RSVPs still store `guest_name='Guest'` and now
  render resolved identity at read time.
- **SC-11 (append-only tests green):** `rsvpMaybeMigration.orch1150r2.test.ts` stays green (the new
  migration does not edit the immutable `20261012` file).

---

## 6. Invariants

**Preserved:**
- **RSVP payment-free wall** — no price/amount columns added. ✓
- **admin PII via definer-only RPCs** — admin twin keeps `is_admin_user()` guard-first DEFINER. ✓
- **COMMS-0057 / ORCH-1206 "no RSVP↔ticket merge"** — parity via shared field semantics only; RPCs
  stay separate; write path untouched. ✓
- **Constitution #1 (no dead taps)** — §4E-5 press-isolation keeps all actions live. ✓ (SC-6)
- **Constitution #9 (no fabricated data)** — COALESCE never invents; null phone omitted. ✓ (SC-2)
- **ANDROID_GLASS_USES_OPAQUE_FALLBACK** — §4E-9 opaque Android surfaces. ✓
- **WCAG AA kit (I-38/I-39)** — §4E-4 contrast + badge build-time check. ✓
- **I-PROPOSED-1150-MAYBE-NOT-IN-CAP** — untouched (host RPC has no capacity predicate; maybe-order
  bucket preserved byte-identical). ✓

**NEW (propose as DRAFT — orchestrator flips ACTIVE on CLOSE):**

- **`I-PROPOSED-1334-RSVP-HOST-LIST-DEFINER-GUARD` (DRAFT):** `host_list_rsvp_guests` MUST be
  `SECURITY DEFINER` with `SET search_path = public`, and its FIRST executable statement MUST be the
  host-owns-event guard
  `IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND
  public.biz_brand_effective_rank(e.brand_id, auth.uid()) >= public.biz_role_rank('event_manager'))
  THEN RAISE EXCEPTION 'insufficient_event_permission'; END IF;` — preventing the DEFINER
  guest-scraper regression. Verified by the §7 non-host-rejected test.
- **`I-PROPOSED-1334-RSVP-GUEST-CONTACT-WHITELIST` (DRAFT):** all three RSVP identity RPCs expose
  ONLY whitelisted profile columns (`display_name`, `username`, `avatar_url`, and — host/admin only —
  `email`, `phone`) plus the derived `source`. They MUST NOT `SELECT profiles.*` or return
  `visibility_mode`, `bio`, or any non-whitelisted profile field.
- **`I-PROPOSED-1334-RSVP-CONSUMER-SELF-IDENTITY-ONLY` (DRAFT):** `fetch_user_going_rsvps` returns
  DISPLAY IDENTITY only (resolved `display_name`); it MUST NOT add `email`/`phone`/contact columns
  and MUST retain its self-scoping WHERE clauses. A user's own calendar never exposes another
  guest's contact.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy, fails-on-revert) | Host RPC resolves app identity | `host_list_rsvp_guests(evt)` w/ an app-user RSVP | row has real `display_name` (≠'Guest'), `source='app'`, `email` non-null | DB/RPC |
| T-2 (edge) | Honest null phone | app user, `profiles.phone` NULL | returned `phone` IS NULL | DB/RPC |
| T-3 (happy) | Web guest parity | web link-guest row | `display_name/email/phone` = typed values, `source='web'` | DB/RPC |
| T-4 (adversarial, security) | Non-host rejected | caller w/ brand rank < event_manager calls host RPC | `RAISE EXCEPTION insufficient_event_permission`, 0 rows | DB/RLS |
| T-5 (adversarial, security) | DEFINER whitelist | inspect host RPC output columns | ONLY the 18 whitelisted columns; no `visibility_mode`/`bio` | DB/RPC |
| T-6 (adversarial, security) | Blocked-pair still resolves | host who a guest blocked calls host RPC | identity STILL resolves (DEFINER bypasses profiles RLS) — determinism goal | DB/RPC |
| T-7 (happy) | Admin identity | `admin_list_event_rsvps(evt)` app row | jsonb row has `display_name`/`source`/`email` resolved | DB/RPC |
| T-8 (adversarial) | Admin guard | non-admin caller | `RAISE not_authorized` | DB/RPC |
| T-9 (happy) | Consumer self-identity | `fetch_user_going_rsvps(uid)` app primary | `display_name` = own real name (≠'Guest') | DB/RPC |
| T-10 (adversarial, security) | Consumer no contact leak | inspect consumer RPC columns; call w/ another `user_id` | NO `email`/`phone` columns exist; only identity returned | DB/RPC |
| T-11 (UI) | Row press-isolation | tap Approve button; tap row body | Approve fires mutation, sheet does NOT open; row body opens sheet, no mutation | Component |
| T-12 (UI) | Detail sheet contact omission | app guest w/ null phone | phone row absent; email row present | Component |
| T-13 (regression) | Append-only test green | run `rsvpMaybeMigration.orch1150r2.test.ts` | PASS (immutable file untouched) | Test |
| T-14 (regression) | Maybe-order preserved | inspect new host RPC ORDER BY | `WHEN r.rsvp_status = 'maybe' THEN 3` present byte-identical | DB/text |

**Implementor happy-path fails-on-revert (must FAIL on revert, PASS on restore):** T-1 + T-4 as a
live-fire SQL probe (`supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.sql`) —
resolves `display_name`+`email` for an app-user row, omits null phone, returns `source`, AND the
non-host caller is rejected. Reverting the migration (dropping the join/guard) makes T-1 return
`'Guest'` (fail) and T-4 return rows (fail).

**Tester adversarial angles:** T-4/T-5/T-6/T-8/T-10 (guard rejects non-host; DEFINER whitelist
proven; blocked-pair determinism; admin guard; consumer identity-only). Plus a source-text append
test (`orch_1334_rsvp_guest_identity.test.ts`) asserting the new migration text contains: `SECURITY
DEFINER`, the guard predicate, `LEFT JOIN public.profiles`, the `source` CASE, and the preserved
`WHEN r.rsvp_status = 'maybe' THEN 3` bucket — each failing on line deletion.

---

## 8. Implementation order

1. **Migration** `supabase/migrations/20261224000000_orch_1334_rsvp_guest_identity.sql` (bump the
   timestamp if a later migration has landed on origin/main at implement time — must be strictly
   greater than the current max, presently `20261223000000`). In ONE migration, in order:
   (a) `DROP FUNCTION IF EXISTS public.host_list_rsvp_guests(uuid);` + CREATE plpgsql DEFINER
   guard-first + profiles join + 6 appended columns + preserved ORDER bucket + GRANT (§4B);
   (b) `CREATE OR REPLACE` `admin_list_event_rsvps` + profiles join + 6 appended jsonb keys, guard
   kept (§4C);
   (c) `CREATE OR REPLACE` `fetch_user_going_rsvps` + profiles joins on both branches, display_name
   resolved, NO new columns (§4D);
   (d) `NOTIFY pgrst, 'reload schema';`
2. **Service** `mingla-business/src/services/rsvpApprovals.ts` — extend `RsvpGuest` +
   `RsvpGuestRow` + `rowToGuest` with `displayName, username, avatarUrl, email, phone, source`
   (map by field name; existing 12 fields unchanged).
3. **Component** `mingla-business/src/components/rsvp/RsvpGuestConsole.tsx` — avatar + source badge +
   press-isolated pressable row body (§4E-5) + `selectedGuest` state; render the new sheet; keep all
   actions. Copy `hashStringToHue`/`getInitials` inline (§4E-10).
4. **NEW component** `mingla-business/src/components/rsvp/RsvpGuestDetailSheet.tsx` — the detail sheet
   (§4E), consuming the passed `RsvpGuest` + the existing `useSetRsvpStatus`/mutation callbacks from
   the console (props), reusing `Sheet`.
5. **Admin view** `mingla-admin/src/pages/OfferingDetailView.jsx` — row label prefers
   `r.display_name` (`r.display_name || r.guest_name || r.guest_email || r.rsvp_id`); add the source
   badge ("On Mingla"/"RSVP'd on web") from `r.user_id`/`r.source`; optionally surface resolved
   `r.email`.
6. **Tests** — add `orch_1334_rsvp_guest_identity.test.ts` (append-only text asserts) and
   `orch_1334_rsvp_guest_identity.test.sql` (live-fire T-1/T-4). Both NEW files (append-only gate).

**No edit to:** `useRsvpApprovals.ts` (detail sheet reads the already-fetched guest via props — no
new hook/selector), `calendarService.ts` (consumer twin is migration-only), `offeringsService.js`
(jsonb passthrough — new keys ride through), `app/rsvp/[id]/guests.tsx` (unchanged mount).

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the guard-first DEFINER pattern + whitelisted-column projection make the
  host/admin RPCs incapable of leaking beyond the whitelist or serving non-hosts.
- **Fails-on-revert test:** `orch_1334_rsvp_guest_identity.test.sql` (live DB, tester-run) asserts
  T-1 (app row `display_name` ≠ 'Guest' + `email` present + `source`) AND T-4 (non-host →
  `insufficient_event_permission`). Reverting the migration reverts `host_list_rsvp_guests` to the
  SECURITY INVOKER no-join form → T-1 returns `'Guest'` (FAIL) and T-4 (INVOKER relies on RLS which
  the test's non-host role is filtered by, but the guard-absence assertion) FAILs. The source-text
  test `orch_1334_rsvp_guest_identity.test.ts` FAILS on deletion of the `SECURITY DEFINER` line, the
  guard predicate, the `LEFT JOIN public.profiles`, the `source` CASE, or the maybe-order bucket.
- **Protective comment** (in the migration, above the host RPC): *"ORCH-1334 — host guest identity
  resolves from profiles at READ time; DEFINER + brand-rank event_manager guard is MANDATORY (a
  SECURITY INVOKER form silently degraded to 'App guest'; a DEFINER without the guard is an open
  per-event guest-scraper). Do not remove the guard or widen the column whitelist. See
  I-PROPOSED-1334-RSVP-HOST-LIST-DEFINER-GUARD."*
- **Append-only:** `rsvpMaybeMigration.orch1150r2.test.ts` stays green (immutable `20261012` file
  untouched). New test files satisfy the test-append-only gate.

---

## 10. Open questions

- **OQ-1 (SETTLED by Seth — recorded for the implementor):** app-member contact IS shown on the
  host/admin detail (email always + phone when present). This SUPERSEDES the investigation's earlier
  "name + On Mingla only" open decision. No further input needed.
- **OQ-2 (flagged, OUT of scope):** should `fetch_user_going_rsvps` enforce `p_user_id = auth.uid()`
  server-side (vs the current client-passes-uid + service_role/CI contract)? Pre-existing property;
  hardening risks breaking `service_role`/CI callers. Recommend a separate low-priority hardening
  ORCH; NOT done here. Confirm this deferral is acceptable.
- **OQ-3 (SETTLED by Seth):** the admin + consumer-calendar twins ARE folded into this ORCH's single
  migration (Decision 2). No open item.

---

## 11. Downstream routing

- **Next = mingla-implementor (business + backend + admin).** Inputs: this SPEC, the investigation
  report, worktree `~/Desktop/mingla-orchs/1334-[rsvp-guest-identity]/` on branch
  `1334-rsvp-guest-identity`. Build §8 in order; honor the allowlist + DO-NOT-TOUCH; prove
  fails-on-revert (T-1 + T-4). Output: implementation report under `Mingla_Artifacts/reports/`.
- **Then = mingla-tester:** run the adversarial angles (§7 T-4/T-5/T-6/T-8/T-10/T-11/T-12) — live-fire
  SQL for the guard + whitelist + consumer-no-leak, and a business-sim run for row press-isolation +
  sheet + contact omission. Cap source-only claims at "suspected".
- **Then = orchestrator CLOSE:** flip the three `I-PROPOSED-1334-*` invariants DRAFT→ACTIVE, sync
  WORLD_MAP, one PR per CLOSE.

**Discoveries for orchestrator (carried from investigation, still open):** (1) profiles are
effectively world-readable (`"Profiles viewable except by blocked users"`, anon can read
'friends'-visibility) — standing privacy posture, not an ORCH-1334 defect (this DEFINER fix does not
depend on it). (2) `fetch_user_going_rsvps` self-guard (OQ-2). (3) RSVP console lacks
search/CSV/check-in surfacing (parity follow-ups).

### Scoped allowlist (implementor may modify ONLY these)
- `supabase/migrations/20261224000000_orch_1334_rsvp_guest_identity.sql` (NEW)
- `supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.ts` (NEW)
- `supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.sql` (NEW)
- `mingla-business/src/services/rsvpApprovals.ts`
- `mingla-business/src/components/rsvp/RsvpGuestConsole.tsx`
- `mingla-business/src/components/rsvp/RsvpGuestDetailSheet.tsx` (NEW)
- `mingla-admin/src/pages/OfferingDetailView.jsx`

### DO-NOT-TOUCH (stop-and-amend before touching)
- Write path: `supabase/functions/public-submit-rsvp/`, `submit_event_rsvp` (any migration),
  `app-mobile/src/services/rsvpDeckService.ts`, `mingla-business/src/services/rsvpEvents.ts`.
- COMMS-0040 files: `RsvpPublicBody.tsx`, `mingla-business/app/rsvp/[id]/preview.tsx`,
  `RsvpMomentumDecision.tsx`, `ConsumerEventDetailScreen.tsx`, `PublicEventPage.tsx`,
  `packages/offering-rendering/*`.
- Immutable migrations: `20261012000000_orch_1150_rsvp_maybe.sql` and all prior (append-only).
- ORCH-1206: `host_set_rsvp_status` / `host_bulk_approve_rsvps` (guard mirrored, not edited).
- `useRsvpApprovals.ts`, `calendarService.ts`, `offeringsService.js`,
  `mingla-business/app/rsvp/[id]/guests.tsx` (no change needed).

---

## 12. Layman-first outcome

Right now, when someone RSVPs from inside the Mingla app, the host's guest list just says "Guest /
App guest" — even though we already know exactly who they are, because the screen that lists guests
never looks up their profile. This fix makes three guest lists (the business-app host console, the
admin attendee list, and a person's own "Going" calendar) look up each app member's real profile at
read time, so the host sees the real name, photo, and an "On Mingla vs RSVP'd on web" tag for every
guest — and can now TAP any guest to open a detail card with their contact (email always, phone when
we have it; we never make up a number). We verified on the live database that every RSVP event
belongs to a brand (there are no "solo-hosted" RSVP events to worry about), so the permission check —
only a manager of that event's brand can see the list — is exactly the same one the app already uses
for approving guests, meaning no host who can approve a guest is ever locked out. On a person's own
calendar we ONLY fix their own name — we never expose other guests' emails there. Nothing about who
can RSVP or how they RSVP changes; we only fix what the host is shown. The old hidden "Guest"
placeholder is left in place on purpose — once the lists look up real profiles, it simply never
surfaces, and leaving the write side alone keeps the change safe.
