# INVESTIGATION — ORCH-1334 [rsvp-guest-console-identity-gap]

**Phase:** INVESTIGATE (+ Gap Closure Recommendation; NO binding SPEC, NO product code)
**Worktree:** `~/Desktop/mingla-orchs/1334-[rsvp-guest-identity]/` on branch `1334-rsvp-guest-identity`
**Date:** 2026-07-10
**Confidence:** **proven** — sealed at all five truth layers, with live prod-DB evidence that reproduces Seth's screenshot exactly (read/data-layer bug; Prime-Directive-7 sim exemption applies — backend/SQL/RLS/read-path investigation, live-fire done against the DB).

---

## Symptom summary (expected vs actual)

**Seth (verbatim):** "I RSVP'd for an RSVP event and the host just sees 'App guest' and not the relevant information. Also clicking a guest does not expand so a host can see the details of the guest — whether they are on the app, or they RSVP'd on web. Some details show for the standard event, but there are also gaps as well, so a host knows exactly where their guests come from."

**Screenshot:** business-app "Guests / Going (4)" — three rows read `Guest / App guest`, one reads `Arifat / arifatd99@gmail.com`.

| | Expected | Actual |
|---|---|---|
| App-user RSVP row | Real name + "On Mingla" provenance (identity is on file) | `Guest` / `App guest` |
| Web link-guest row | Real name + email/phone | `Arifat / arifatd99@gmail.com` ✅ (works) |
| Tap a guest row | Expand to a detail sheet (identity, source, RSVP time, plus-ones, status) | Nothing — rows are not tappable |

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|---|---|---|
| 1 | `mingla-business/src/components/rsvp/RsvpGuestConsole.tsx` | UI | Render of name/contact; row tap |
| 2 | `mingla-business/app/rsvp/[id]/guests.tsx` | UI/route | Mount + surface (authed host-only) |
| 3 | `mingla-business/src/services/rsvpApprovals.ts` | service | `RsvpGuest` type + RPC caller |
| 4 | `mingla-business/src/hooks/useRsvpApprovals.ts` | hook | `useRsvpGuestList` query |
| 5 | `supabase/migrations/20261012000000_orch_1150_rsvp_maybe.sql` | schema | RPC (maybe ver) + upsert |
| 6 | `supabase/migrations/20261004000000_orch_1150_rsvp_events.sql` | schema | Base table + RLS + CHECK comment |
| 7 | `supabase/migrations/20261016000001_orch_1163_event_rsvp_guests.sql` | schema | Web plus-ones + matched-user; RPC redef |
| 8 | `supabase/migrations/20261122000000_orch_1203_rsvp_qr_backfill.sql` | schema | **Latest** `submit_event_rsvp` def |
| 9 | `supabase/functions/public-submit-rsvp/index.ts` | edge | What the app actually sends |
| 10 | `app-mobile/src/services/rsvpDeckService.ts` | consumer | Consumer RSVP write payload |
| 11 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | schema | `profiles` table + RLS policies |
| 12 | `supabase/migrations/2026092x…_meta_orch_1104_*` | schema | Confirm profiles policies unchanged |
| 13 | `mingla-business/app/event/[id]/guests/index.tsx` | UI | STANDARD attendee list (parity) |
| 14 | `mingla-business/app/event/[id]/guests/[guestId].tsx` | UI | STANDARD guest detail (parity) |
| 15 | `supabase/migrations/20261206000001_orch_1273_offerings_read_rpcs.sql` | schema | `admin_list_event_rsvps` (proven definer template) |
| 16 | `.../__tests__/rsvpMaybeMigration.orch1150r2.test.ts`, `__tests__/orch_1150_rsvp.test.sql` | test | RPC-shape append-only tests (blast radius) |
| L | LIVE prod DB (`gqnoajqerqhnvulmnyvv`, Management API) | runtime/data | Real rows, RLS simulation, identity recovery |

---

## Q-scorecard

- **Q1 — Does the write store `'Guest'` for app users?** **Yes (proven).** See F-1.
- **Q2 — Does the read RPC drop profile identity?** **Yes (proven).** See F-2.
- **Q3 — Why can't the host tap a row to expand?** **The row has no `onPress` (proven).** See F-3.
- **Q4 — What profile columns are joinable + what is the FK?** **`display_name/username/avatar_url/first_name/last_name`; `event_rsvps.user_id = profiles.id` via `auth.users` (proven).** See F-4.
- **Q5 — Is the profiles join an RLS trap (returns NULL under host RLS)?** **NO — refuted. Profiles are broadly readable; a SECURITY INVOKER join WOULD resolve identity, failing only for the narrow blocked-pair case. But DEFINER+guard is still the safe pattern (proven).** See F-5.
- **Q6 — What does the STANDARD attendee path show, and where are ITS gaps?** **Rich (expandable, avatar, source/check-in) but purchase-centric with NO on-Mingla linkage (proven).** See F-6 + parity matrix.
- **Q7 — Blast radius of an RPC column add?** **Contained to 3 files + 1 new migration; no SQL RETURNS-TABLE assertion; no app-mobile use (proven).** See F-7.
- **Q8 — Which provenance signals exist vs are missing?** **App-vs-web/time/plus-ones/status exist; invite/referral/channel source do NOT (proven).** See F-8.

---

## Findings (six-field evidence)

### F-1 — WRITE stores the literal `'Guest'` for every in-app RSVP · `CONFIRMED ROOT CAUSE (write half)`
- **Symptom:** app-user rows carry `guest_name='Guest'`, `guest_email=NULL`, `guest_phone=NULL`.
- **Layer:** code (consumer → edge → RPC) + data.
- **Probe:** read `rsvpDeckService.ts:116-118`, `public-submit-rsvp/index.ts:15,152-157,277-278`, latest `submit_event_rsvp` (`20261122000000_orch_1203_rsvp_qr_backfill.sql:126,201`); live count query.
- **Evidence:**
  - Consumer sends NO identity: `rsvpDeckService.ts:117` → `body: { eventId, rsvpStatus, guests: guests ?? [] }` (no `guestName`/`guestEmail`).
  - Edge fn documents it: `public-submit-rsvp/index.ts:15` — "A logged-in app-user (JWT resolves a user_id) supplies none of those (profile-inherited)."; passes `p_guest_name: guestName.length > 0 ? guestName : null` (`:277`).
  - RPC fallback (latest, ORCH-1203): `126: v_name := COALESCE(NULLIF(btrim(p_guest_email), ''), 'Guest');` → with email NULL, `v_name = 'Guest'`; `201: guest_name = v_name`. Identical fallback in all 4 historical defs (`20261004…:903`, `20261012…:104`, `20261016…:250`, `20261122…:126`).
  - **LIVE DATA:** `SELECT count(*) … FROM event_rsvps` → `{total:4, app_user_rows:3, app_guest_named:3, web_link_guests:1, app_no_contact:3}` — **exact screenshot match** (3× "Guest/App guest" + 1 web guest).
- **Mechanism:** consumer omits name → edge passes nulls → RPC writes sentinel `'Guest'`, contact NULL. The write is BY DESIGN "profile-inherited" — identity is meant to come from `user_id` at read time, but the read never does that inheritance (F-2).
- **Severity:** `CONFIRMED ROOT CAUSE` (write half — it produces the stored 'Guest', but is NOT independently fixable-worthy; the read-time join is the correct repair — see recommendation).

### F-2 — READ RPC returns only raw `event_rsvps` columns, no profiles join · `CONFIRMED ROOT CAUSE (read half — primary)`
- **Symptom:** the console has no real identity to show for app users.
- **Layer:** schema (RPC) + code.
- **Probe:** latest def of `host_list_rsvp_guests` (`20261012000000_orch_1150_rsvp_maybe.sql:197-221`); grep confirms only two migrations ever define it, latest = 20261012 (no later supersede).
- **Evidence:**
  ```sql
  CREATE FUNCTION public.host_list_rsvp_guests(p_event_id uuid)
  RETURNS TABLE ( id, event_id, user_id, guest_name, guest_email, guest_phone,
                  rsvp_status, approval_status, plus_count, waitlisted_at, promoted_at, created_at )
  LANGUAGE sql SECURITY INVOKER STABLE SET search_path = public AS $$
    SELECT r.id, …, r.guest_name, r.guest_email, r.guest_phone, … FROM public.event_rsvps r
     WHERE r.event_id = p_event_id ORDER BY …;
  $$;
  ```
  No `JOIN public.profiles`; returns `r.guest_name` verbatim (= 'Guest' for app users).
- **Mechanism:** `user_id` is returned but never resolved to a profile → the console receives `guest_name='Guest'` and renders it. This is THE repairable root cause (a read-time join fixes all existing rows at once).
- **Severity:** `CONFIRMED ROOT CAUSE` (primary — the read path is where the fix belongs).

### F-3 — Console rows are not tappable (no expand) · `CONFIRMED ROOT CAUSE (expand gap)`
- **Symptom:** "clicking a guest does not expand."
- **Layer:** code (UI).
- **Probe:** read `RsvpGuestConsole.tsx` all sections.
- **Evidence:** each guest row is a plain `<View style={styles.guestRow}>` (lines 206, 248, 277, 298). Only the action buttons (`Approve`/`Deny`/`Remove`) are `Pressable` (lines 217-234, 258-266). There is NO `onPress` on the row and NO guest-detail route under `app/rsvp/[id]/`.
- **Mechanism:** nothing captures a row tap → nothing to open → no expand. Contrast the standard path, whose rows ARE pressable and navigate to a detail route (F-6).
- **Severity:** `CONFIRMED ROOT CAUSE` (independent of F-1/F-2 — even with real names, there is no detail surface).

### F-4 — Profiles columns + FK mapping · `SUPPORTING (functional path)`
- **Layer:** schema + data.
- **Probe:** `baseline_squash:9081-9121`; live `pg_constraint` + join.
- **Evidence:** `profiles` columns available for display: **`display_name`, `username`, `avatar_url`, `first_name`, `last_name`, `photos text[]`, `bio`** (NO `full_name`, NO `handle`, NO `photo_url` — those don't exist). FK: live `pg_constraint` → `profiles_id_fkey_auth_users → auth.users`; and `event_rsvps.user_id → auth.users(id)` (`20261004…:56`). Therefore **`event_rsvps.user_id = profiles.id`** (transitive; empirically confirmed — the join below resolved every row).
- **Identity recovery (LIVE, proves the fix is possible / Constitution #9 honest):** the 3 `'Guest'` rows joined to profiles →
  - `485addca…` → display_name **"sethogievabelgium Gotham"**, username `sethogievabelgium`
  - `6c61590c…` → display_name **"rambleawaypod U"**, username `rambleawaypod`
  - `c727d491…` → display_name **"Seth O"**, username `sethogieva`, `has_avatar=true`
  All `visibility_mode='friends'`. Real identity is fully recoverable — the fix shows truth, never invents.
- **Severity:** supporting evidence (not a defect).

### F-5 — RLS "trap" — REFUTED as a hard blocker; DEFINER+guard is still the safe pattern · `SECONDARY (correctness/robustness)`
- **Symptom (hypothesis under test):** "a SECURITY INVOKER `LEFT JOIN profiles` runs under the host's RLS and returns NULL for every app guest → fix ships broken."
- **Layer:** schema (RLS) + runtime.
- **Probe:** live `pg_policies` on `public.profiles`; a live RLS simulation (`SET LOCAL role authenticated` + jwt claims) reading a `'friends'`-visibility guest profile; `is_blocked_by` check.
- **Evidence:**
  - Six permissive SELECT policies (all `roles={public}`, OR'd). The broadest: **`"Profiles viewable except by blocked users"` → `((auth.uid() = id) OR (NOT is_blocked_by(id, auth.uid())))`**. (`meta_orch_1104` migrations do NOT touch these policies — the baseline set is current.)
  - **LIVE RLS SIM — non-friend authenticated host (uid `1111…`) reading guest `485addca…`:** returns `{display_name:"sethogievabelgium Gotham", username:"sethogievabelgium"}` → **join WOULD resolve identity.**
  - **LIVE RLS SIM — even `anon`** reads the same row (`is_blocked_by(id, NULL)=false`) → profiles are effectively world-readable; `visibility_mode='friends'` is NOT enforced for reads.
  - `is_blocked_by('485addca…','1111…') = false`.
- **Mechanism / verdict:** the "always-NULL" hypothesis is **refuted** — under current RLS a SECURITY INVOKER join returns real identity for essentially all guests. It fails ONLY in the narrow **blocked-pair** case (a guest who actively blocked the host's personal account → `NOT is_blocked_by` = false → that ONE row NULLs to the honest fallback). **However**, the recommended safe pattern remains **SECURITY DEFINER + host-owns-event guard + whitelisted display columns**, because it is:
  1. **Deterministic** — identity resolves regardless of block-state / visibility_mode;
  2. **Robust** — the broad "viewable except blocked" policy is a known privacy smell that could be tightened later; an invoker join would then silently degrade to "On Mingla" for everyone;
  3. **Least-exposing** — returns only `display_name/username/avatar_url`, not the whole profile row shape;
  4. **Precedented** — mirrors the existing guard-first definer RPCs `admin_list_event_rsvps`, `fetch_user_going_rsvps`, `biz_resolve_verified_user`.
  - **The exact guard predicate (mandatory if DEFINER):**
    ```sql
    IF NOT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = p_event_id
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
              >= public.biz_role_rank('event_manager')
    ) THEN RAISE EXCEPTION 'insufficient_event_permission'; END IF;
    ```
    Without this guard, flipping to DEFINER turns the RPC into an open per-event guest-scraper (any authenticated user could pass any `event_id`). Today, SECURITY INVOKER gets this filtering "for free" from the `event_rsvps_host_read` RLS policy (`20261004…:120-129`) — a DEFINER version MUST replicate it in-body.
- **Severity:** `SECONDARY ROOT CAUSE` — the correctness/robustness constraint that shapes the fix; not a live crash today, but the reason to choose DEFINER over the tempting one-line invoker join.

### F-6 — STANDARD attendee path is rich + expandable but has its OWN gaps · `SUPPORTING (parity)`
- **Layer:** code (UI) + hook/store.
- **Probe:** read `event/[id]/guests/index.tsx` + `[guestId].tsx`.
- **Evidence:** the standard list (`index.tsx`) merges **orders + comps + door sales** from LOCAL Zustand stores (`useEventGuestList`, `useGuestStore`, `useDoorSalesStore`, `useScanStore`) — NOT a profiles-join RPC. Rows ARE pressable (`:325-332 handleOpenRow` → `/event/{id}/guests/{kind}-{innerId}`). Each row shows: avatar (initials + hue-hash), name (`"Anonymous"`/`"Walk-up"` fallbacks), email, ticket summary, **source/status pill** (PAID/REFUNDED/PARTIAL/CANCELLED, COMP, CASH/CARD/NFC/MANUAL), **check-in pill** (NOT/N-OF-M/ALL CHECKED IN), relative time; plus search + CSV export. Detail (`[guestId].tsx`) adds hero (avatar/name/email/phone), tickets w/ per-seat check-in CTA, order/payment activity, "ADDED BY" (comp), and cross-order history ("OTHER ORDERS BY THIS BUYER").
- **Its gaps:** the standard path is **purchase-centric** and has **NO on-Mingla-account linkage** either — buyer identity is captured at checkout (name/email/phone), never linked to a Mingla profile, so it too cannot say "this attendee is on the app." It also falls back to `"Anonymous"`/`"Walk-up"` when the captured name is blank. This confirms Seth's "some details show but there are gaps."
- **Severity:** supporting (parity target + shared gap).

### F-7 — Blast radius of adding columns to the RPC · `SUPPORTING (regression scope)`
- **Layer:** code + test.
- **Probe:** grep all consumers of the RPC / `RsvpGuest` / `useRsvpGuestList`; read the RPC-shape tests.
- **Evidence:**
  - RPC `host_list_rsvp_guests` runtime consumers: **exactly one** — `rsvpApprovals.ts:63 listRsvpGuests` → `rowToGuest` maps by field NAME (not position). Adding columns is backward-compatible.
  - `RsvpGuest` type: used only in `RsvpGuestConsole.tsx` + `useRsvpApprovals.ts` (both business). **NOT** referenced anywhere in `app-mobile` (consumer) — zero consumer blast.
  - `useRsvpGuestList`: only `RsvpGuestConsole.tsx`.
  - RPC-shape tests: `rsvpMaybeMigration.orch1150r2.test.ts:50-52` asserts text patterns against the **immutable** `20261012…maybe.sql` file (a new ORCH-1334 migration does not edit it → stays green). The SQL tests (`orch_1150_rsvp.test.sql`, `orch_1150_maybe.test.sql`) exercise `submit`/`host_set` behavior and insert into `event_rsvps` — **no `RETURNS TABLE` column-list assertion on `host_list_rsvp_guests`** → adding columns breaks nothing.
  - Adding columns to a `RETURNS TABLE` RPC requires **DROP+CREATE** in a NEW migration (migration-baseline rule); the existing maybe-order bucket + INVOKER→DEFINER change must be preserved in that new def.
- **Severity:** supporting — regression surface is contained to `{new migration, rsvpApprovals.ts, useRsvpApprovals.ts, RsvpGuestConsole.tsx}`.

### F-8 — Provenance signals: available vs missing · `SUPPORTING (honest scoping)`
- **Layer:** schema.
- **Evidence — AVAILABLE in-schema (no new capture needed):**
  - **On-Mingla vs Web:** `event_rsvps.user_id IS NOT NULL` (app member) vs `NULL` (web link-guest). ← the core "where did they come from" signal.
  - **App identity:** `profiles.display_name / username / avatar_url` via `user_id`.
  - **Web identity:** `guest_name / guest_email / guest_phone` (form-filled).
  - **RSVP time:** `created_at`. **Plus-ones:** `plus_count` (+ per-guest contacts in `event_rsvp_guests` for web). **Waitlist/promotion:** `waitlisted_at`, `promoted_at`. **Approval state:** `approval_status`. **Intent:** `rsvp_status` (going/not_going/waitlisted/maybe).
  - **Verified-account match for web plus-ones:** `event_rsvp_guests.matched_user_id` (via `biz_resolve_verified_user`) — already computed.
- **Evidence — MISSING (NOT in the data model; honest separation of "code fix" vs "new capture"):**
  - No **invite/referral source** (which invite link, who invited them) — `event_rsvps` has no `invited_by`/`referral`/`invite_id`.
  - No **share-channel / QR / campaign** attribution beyond the app-vs-web binary — no `source`/`channel` column.
  - No **primary-web-guest → Mingla account** link (only child plus-ones get `matched_user_id`; a web PRIMARY who has a Mingla account is not linked).
- **Severity:** supporting — anything beyond app-vs-web + timestamp + status is a NEW data-capture ask, not deliverable by a read-path fix.

---

## Five-Truth-Layer reconciliation

| Layer | What it says | Truth? |
|---|---|---|
| **Docs** | Edge fn (`:15`) + CHECK comment (`20261004…:70-77`) + SPEC: app-user rows are "profile-inherited addresses + push by user_id." | The PROMISE. |
| **Schema** | `guest_name NOT NULL`; no source column; `user_id → auth.users → profiles.id`; `host_list_rsvp_guests` RETURNS only raw `event_rsvps` cols; profiles broadly readable. | Enforces write-sentinel; read never inherits. |
| **Code** | Consumer sends no name → edge passes nulls → RPC writes `'Guest'`; read RPC has no join; console renders `guest_name` + `email??phone??"App guest"`; rows not pressable. | The MECHANISM. |
| **Runtime** | Live RLS sim: host (even anon) CAN read the guest profile; join would resolve identity. | Refutes "always-NULL." |
| **Data** | 4 RSVPs = 3 app `'Guest'`/NULL + 1 web real; the 3 map to real display_names. | Reproduces screenshot; identity recoverable. |

**Flagged contradiction (this IS the bug):** Docs promise identity is "profile-inherited" for app-user rows, but the READ path (`host_list_rsvp_guests`) never performs that inheritance. The gap between the documented promise (Docs) and the read implementation (Code/Schema) is the defect. **Code/Schema hold the truth; Docs describe an intent that was never wired at read time.**

---

## Repro evidence

Backend/read-path + data investigation (Prime-Directive-7 sim-exemption). Live-fire done against prod DB `gqnoajqerqhnvulmnyvv` via Management API (read-only):
- Row census reproduces the screenshot 1:1 (`total:4, app_guest_named:3, web_link_guests:1`).
- Identity-recovery join returns real display_names for the 3 `'Guest'` rows.
- RLS simulation (authenticated non-friend host, and anon) both read a `'friends'`-visibility guest profile successfully.
No mutations were run. **Negative result:** the RLS-block hypothesis did NOT reproduce (join is not universally blocked).

---

## Blast-radius / cross-surface map

**In scope (touched by the recommended fix):**
- `supabase/migrations/2026xxxx_orch_1334_*.sql` (NEW) — DROP+CREATE `host_list_rsvp_guests` as SECURITY DEFINER + guard + profiles join + new display/source columns.
- `mingla-business/src/services/rsvpApprovals.ts` — extend `RsvpGuest` type + `rowToGuest` mapping.
- `mingla-business/src/components/rsvp/RsvpGuestConsole.tsx` — render real name/avatar/source badge; make rows pressable.
- (optional) `mingla-business/src/hooks/useRsvpApprovals.ts` — if a detail selector is added.
- (design) a NEW guest-detail sheet/route under `app/rsvp/[id]/` — **mingla-designer** deliverable.

**Surfaces (per SPEC surface list):**
1. Consumer iOS — **not covered** (no host console on consumer; confirmed no `RsvpGuestConsole`/`host_list_rsvp_guests` in `app-mobile`).
2. Consumer Android — **not covered** (same).
3. Buyer/anon Web — **not covered** (route is authed host-only; NOT in anon allowlist per `guests.tsx:5`).
4. Business iOS — **covered** (renders the console).
5. Business Android — **covered** (opaque-glass fallback already in the console).
6. Admin Web — **not in scope, but FLAGGED:** `admin_list_event_rsvps` has the identical `'Guest'` gap (returns raw `guest_name`, no profiles join) — see Discoveries.
7. Business Web preview (authed) — **covered**; RLS behavior is identical to native (SECURITY INVOKER/DEFINER both key off the caller's JWT, platform-agnostic) — no platform-specific RLS delta.

**No consumer app-mobile host console exists** (proven: empty grep for `RsvpGuestConsole`/`host_list_rsvp_guests`/`host_set_rsvp_status` in `app-mobile`).

---

## STANDARD vs RSVP parity matrix

| Capability | STANDARD (`/event/[id]/guests`) | RSVP (`/rsvp/[id]/guests`) | Gap |
|---|---|---|---|
| Row tappable → detail | ✅ `handleOpenRow` → `[guestId].tsx` | ❌ plain `<View>`, no `onPress` | **RSVP missing** (F-3) |
| Avatar | ✅ initials + hue-hash | ❌ none | RSVP missing |
| Real name (app member) | n/a (buyer name at checkout) | ❌ `'Guest'` (profile not resolved) | **RSVP missing** (F-2) |
| Real name/contact (web guest) | ✅ buyer name/email/phone | ✅ guest_name/email/phone | parity ✅ |
| Blank-name fallback | `"Anonymous"`/`"Walk-up"` (honest) | `"App guest"` (honest but no name) | RSVP shows no name |
| Source/status badge | ✅ PAID/COMP/CASH/CARD/… | ⚠️ only bucket headers (Pending/Going/Waitlist/Maybe) | RSVP has no app-vs-web badge |
| On-Mingla-account linkage | ❌ none | ❌ none (data exists via `user_id`, unused) | **both gap** (RSVP fixable now) |
| Check-in / QR pass state | ✅ scan-derived pills | ❌ not shown (RSVP mints `qr_code`, never surfaced to host) | RSVP missing |
| RSVP/purchase time | ✅ relative time | ⚠️ `created_at` returned but not displayed | RSVP missing (display) |
| Plus-ones | n/a | ⚠️ `+N` chip only; web plus-one contacts not shown | RSVP partial |
| Search | ✅ name/email/phone | ❌ none | RSVP missing |
| CSV export | ✅ | ❌ | RSVP missing (out of ORCH-1334 scope) |
| Cross-history | ✅ "other orders by buyer" | ❌ | RSVP missing (out of scope) |

**COMMS-0057 / ORCH-1206 honored:** RSVP is a deliberately separate pipeline (moneyless, ticketless — "do NOT merge back into the event/ticket path", stamped across every RSVP RPC + service). Parity is achieved via **shared field semantics** (name/avatar/source/time), NOT shared code. Do not route RSVP through the order/ticket path.

---

## Provenance signals — available vs missing (summary)

- **Available now (fixable in the read path):** on-Mingla vs web (`user_id`), app identity (`profiles`), web identity (`guest_*`), RSVP time (`created_at`), plus-ones (`plus_count` + `event_rsvp_guests`), waitlist/promotion (`waitlisted_at`/`promoted_at`), approval (`approval_status`), intent (`rsvp_status`), web-plus-one verified match (`matched_user_id`).
- **Missing (needs NEW data capture — out of a code-only fix):** invite/referral source, who-invited-them, share-channel/QR/campaign attribution, primary-web-guest→account link.

---

## Expand-interaction data contract (for mingla-designer)

Tapping a guest row should open a detail sheet showing (all from data that EXISTS):

| Field | Source | Notes |
|---|---|---|
| Display name | `profiles.display_name` (app) / `guest_name` (web) | never fabricate; app fallback → "On Mingla member" |
| Handle | `profiles.username` (app only) | |
| Avatar | `profiles.avatar_url` (app) / initials (web) | |
| **Source badge** | derived: `user_id IS NOT NULL` → "On Mingla" · else "Web link" | the core "where from" answer |
| Contact | `guest_email`/`guest_phone` (web); app → none (push-only) or profile email if policy allows | app contact is intentionally push-by-`user_id` |
| RSVP time | `created_at` | relative + absolute |
| Status / approval | `rsvp_status` + `approval_status` | going/maybe/waitlisted + pending/approved |
| Plus-ones | `plus_count` + web plus-one contacts from `event_rsvp_guests` | |
| Waitlist/promotion | `waitlisted_at` / `promoted_at` | when applicable |
| (optional) Pass state | `event_rsvps.qr_code IS NOT NULL` | "entry pass issued" |

**Data-contract need:** the RPC must additionally return `display_name`, `username`, `avatar_url`, and a `source` discriminator (or the raw `user_id` for the client to derive). `created_at`/`plus_count`/`waitlisted_at`/`promoted_at`/`approval_status`/`rsvp_status` are ALREADY returned. The actual sheet visual/motion/IA is a **mingla-designer** deliverable (invoked by forensics at SPEC time, embedded into the SPEC — not built by the implementor freehand).

---

## Invariant impact

- **I (line 161) — RSVP payment-free wall:** untouched (no price/amount columns added).
- **I (line 304) — admin PII via definer-only RPCs:** the recommended host DEFINER RPC is consistent with this established pattern (guard-first, STABLE, read-only).
- **COMMS-0057 / ORCH-1206 "do NOT merge RSVP into ticket path":** honored — parity via shared field semantics, separate code.
- **Constitution #9 (no fabricated data):** the current `"App guest"` is an HONEST fallback (invents nothing); the fix must show real `display_name` OR an honest `"On Mingla"` label — never a made-up name. Live evidence confirms real identity is recoverable, so honesty is fully achievable.
- **No existing invariant pins the `host_list_rsvp_guests` column set** (grep clean).
- If SPEC'd, propose `I-PROPOSED-1334-RSVP-HOST-LIST-DEFINER-GUARD` (DRAFT): the host guest-list RPC must gate on `biz_brand_effective_rank >= event_manager` as its first executable statement (prevents the DEFINER-scraper regression).

---

## Discoveries for Orchestrator

1. **Admin RSVP list has the SAME `'Guest'` gap.** `admin_list_event_rsvps` (`20261206000001_…:382-399`) returns raw `guest_name` with no profiles join → the admin console also shows `'Guest'` for app-user RSVPs. Same one-line remedy (add the profiles resolution). Consider a sibling ticket or fold into ORCH-1334's migration since it's the same table + pattern.
2. **Consumer calendar shows `'Guest'` for the user's own primary RSVP.** `fetch_user_going_rsvps` (`20261016000001_…:445`) uses `r.guest_name AS display_name` — a user sees themselves as "Guest" on their own Going list. Cosmetic (they know who they are) but the same root literal; flag for a low-priority polish.
3. **Profiles are effectively world-readable** via `"Profiles viewable except by blocked users"` (`roles={public}`, anon can read `'friends'`-visibility rows). Not an ORCH-1334 defect, but a standing privacy posture worth a deliberate decision (it's WHY an invoker join would "just work"). Flagged, not scoped here.
4. **RSVP host console lacks search/CSV/check-in surfacing** that the standard path has (parity matrix) — candidate follow-ups beyond the identity fix.

---

## Gap Closure Recommendation (ranked, regression-free, read-time-favored)

> INVESTIGATE output — a recommendation, NOT a binding SPEC. The SPEC (with the embedded mingla-designer contract + fails-on-revert regression test) is the next phase.

### R1 (PRIMARY, recommended) — Resolve identity + provenance at READ time via a DEFINER-guarded RPC
Replace `host_list_rsvp_guests` (new migration, DROP+CREATE) with **`SECURITY DEFINER STABLE`**, guarded by the host-owns-event predicate (F-5 predicate) as the FIRST statement, joining `profiles` on `user_id`, returning the current columns **plus**:
- `display_name` = `COALESCE(NULLIF(p.display_name,''), NULLIF(r.guest_name,'Guest'), r.guest_name)` (real name for app; real name for web; never fabricates),
- `username`, `avatar_url` (app only, else NULL),
- a `source` discriminator (`CASE WHEN r.user_id IS NOT NULL THEN 'app' ELSE 'web' END`) — or let the client derive from `user_id`.

**Exact shape delta:** append 3–4 columns to the RETURNS TABLE; keep the existing 12 columns and the maybe-order bucket byte-for-byte. Flip `SECURITY INVOKER` → `SECURITY DEFINER` **and add the guard** (mandatory — F-5). `GRANT EXECUTE … TO authenticated`.

**Why read-time:** fixes all EXISTING rows (the 3 stored `'Guest'`) with zero backfill; single source of truth (no denormalized name that goes stale on rename); deterministic; matches `admin_list_event_rsvps`. **Regression-free** because: only one runtime consumer maps by field name (F-7); no SQL test asserts the RETURNS-TABLE shape; the immutable maybe-migration text test stays green.

**Console changes (F-3 + display):** show `g.displayName`; add an avatar (profile avatar or initials); replace the `email ?? phone ?? "App guest"` line with a **source badge** ("On Mingla" / "Web link") + contact when web; wrap each row in a `Pressable` → open the new detail sheet.

**Needs mingla-designer:** the guest-detail sheet (IA, layout, avatar, source badge, states, motion, a11y, Android glass fallback) — invoked at SPEC time and embedded into the SPEC. The data contract it consumes is defined above.

### R2 (SECONDARY, lighter-touch alternative) — Same read-time join but keep SECURITY INVOKER
Add the `LEFT JOIN profiles` while leaving the RPC `SECURITY INVOKER` (relies on the existing `event_rsvps_host_read` RLS for row-gating + the broad profiles read policy for identity). **Pros:** smallest diff, no new authorization surface. **Cons:** non-deterministic — a guest who blocked the host NULLs to "On Mingla"; silently degrades to "On Mingla" for everyone if the broad profiles policy is ever tightened. Acceptable ONLY if the honest "On Mingla" fallback is deemed sufficient for the blocked-pair edge case. **Not preferred** vs R1's determinism.

### R3 (do NOT do) — Write-time denormalization (`submit_event_rsvp` stores `profiles.display_name`)
Rejected: fixes only NEW rows (leaves the 3 existing `'Guest'` rows), duplicates identity that goes stale on rename, and touches the higher-risk write/capacity path. Read-time (R1) is strictly better.

### Open decision for Seth
- **App-member contact exposure:** app-user RSVPs are intentionally "push-by-`user_id`" (no email/phone stored). Should the host detail sheet show the app member's **profile email** (readable under current RLS), or only name + "On Mingla" (contact via in-app/push)? Product/privacy call — I recommend name + "On Mingla" (no raw contact) to preserve the app-native contact model; surface contact only for web guests who typed it.
- **Fold in the admin + consumer-calendar `'Guest'` twins (Discoveries 1–2)** now, or track separately?

---

## Recommended next phase
**SPEC** (forensics SPEC mode), scope = R1 (read-time DEFINER-guarded RPC + console identity/source/avatar + tappable row) with an **embedded mingla-designer** guest-detail-sheet contract and a fails-on-revert regression test (assert the RPC resolves `display_name` for an app-user row AND the guard rejects a non-host caller). Honor COMMS-0057 (no RSVP↔ticket merge). Decide the two open questions before/at SPEC.

---

## Layman-first outcome

When someone RSVPs from inside the Mingla app, the host's guest list just says "Guest / App guest" — even though we already know exactly who they are. The app never sends the person's name (by design — it's supposed to be filled in from their Mingla profile later), but the screen that lists guests never actually looks up that profile, so the name is lost. We proved this on the live database: your event has 4 RSVPs — 3 from app members (all showing "Guest") and 1 from someone who RSVP'd on the web (showing their real name and email) — an exact match to your screenshot. The real names ARE on file (we pulled them: "Seth O", "rambleawaypod", "sethogievabelgium"). The fix is to have the guest-list query look up each app member's profile and return their real name, avatar, and an "On Mingla vs Web" badge — which fixes every existing guest at once, with no risk to the rest of the app (only one screen uses this data). We also confirmed the tap-to-expand is simply missing (the rows aren't buttons), and that the standard ticketed-event guest list is the model to match — though even it can't tell you who's a Mingla app user, so that's a gap we can close here too. One product call for you: for app members, show just their name + "On Mingla", or also their email? I recommend name-only for app members (keep contact for web guests who typed it in).
