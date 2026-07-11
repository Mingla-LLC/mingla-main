# SPEC — ORCH-1338 [guest-read-backend]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 1 of 5 (blocks 1340/1341; half-blocks 1339)
**Phase:** SPEC (forensics SPEC mode — contract, not code)
**Binding investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_META-ORCH-1337_SOCIAL_PROOF_GUEST_LIST.md` (commit 0d3caa388) — findings F-3, F-6, F-7, F-8, F-11 govern this leg.
**Sealed orchestrator decisions honored (not re-opened):** D1 (privacy mapping), D2 (`privateGuestList` server-enforced in the RPC), D3 (ticketed identity = order BUYERS only), D6 (design must not preclude a bounded anon event-by-slug read), D7 (brand tiles out).
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list`.
**Date:** 2026-07-10

---

## 1. Executive summary

Today nothing in the backend lets a peer or an anonymous buyer see anything about who is going to an event beyond a bare RSVP count — and for ticketed events, trips, and experiences even an honest absolute "going" count is not anonymously readable when any tier is unlimited (F-3). Meanwhile guest identity (RSVP `user_id`, order `buyer_user_id`) and profile display data (`display_name`/`username`/`avatar_url`) exist server-side but are correctly walled by RLS (F-6, F-8).

This leg builds the ONE privacy-aware backend read layer the whole META rides on:

1. **`pg_public_social_proof(p_event_id)`** — an anon-callable counts + avatar-sample read, uniform across all four entity types (fixing the F-3 unlimited-capacity hole), carrying the two host gates (`privateGuestList`, `hideRemainingCount`) server-side. No names, ever, on this path (D1 anon shape).
2. **`peer_list_event_guests(p_event_id, p_limit, p_offset)`** — the authenticated, guard-first, row-capped, column-whitelisted guest-list read for the future consumer sheet (ORCH-1341), honoring `visibility_mode`, blocked pairs, and the server-enforced `privateGuestList` gate (D1/D2).
3. **`packages/offering-rendering/socialProofTypes.ts`** — the ONE shared TypeScript payload contract (`SocialProofSummary` et al) that ORCH-1339/1340/1341 consume as props (I-MOR-0827: the package gets data via props; this file is pure types + one constant, no fetch).

No UI in this leg. Table RLS is UNCHANGED — all access is RPC-mediated.

## 2. Scope & non-goals

**In scope**
- One migration file: two SECURITY DEFINER read RPCs + grants + comments (exact contracts in §4).
- The shared TS payload types file in the pure package (types + `SOCIAL_PROOF_SAMPLE_MAX` only).
- Migration regression tests under `supabase/migrations/__tests__/` (static SQL assertions, deno) per the `pg_public_trips_by_brand.antiLeak.adversarial.test.ts` house exemplar.

**Non-goals (explicitly out)**
- Any UI, component, service, or hook change — ORCH-1339 (card), 1340 (avatars), 1341 (sheet) own those.
- `host_list_rsvp_guests` / `admin_list_event_rsvps` / `fetch_user_going_rsvps` — ORCH-1334's scope (F-8); do not touch, do not collide.
- The invariant/test rewrite of I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY — ORCH-1340 owns it. This leg exposes NO identity to any surface that renders it (the RPCs exist; nothing consumes them until 1339+).
- Toggle WRITE paths (`biz_set_event_guest_privacy` is ORCH-1339's migration).
- Any anon event-by-slug consumer read (D6 / ORCH-1342) — but see §4.1 "D6 compatibility note".
- Any change to `business_public_events_view`, `pg_public_rsvp_by_slug`, `pg_public_ticket_types_remaining`, or any by-slug RPC.
- Per-seat ticket identity capture (tickets carry no user column — D3 accepts buyer-only linkage; future capture ask registered by the investigation).

**Assumptions (investigation-proven)**
- Toggle storage: `events.theme -> 'business_event' -> 'settings' -> {privateGuestList, hideRemainingCount}` booleans (F-4; latest writer `20261222000000_orch_1296_rsvp_edit_chip_in.sql:225-250`, verbatim-read).
- Going formula (RSVP): `SUM(1 + plus_count)` over `rsvp_status='going' AND approval_status='approved'` (`20261016000000_orch_1163_pg_public_rsvp_by_slug.sql:111-119`, verbatim-read).
- Sold formula (ticketed): `COUNT(tickets WHERE status IN ('valid','used','transferred'))` (`20260724000006_orch_0946_public_ticket_types_remaining.sql:42-47`, verbatim-read; `tickets.event_id` exists — baseline `:9866`).
- Buyer linkage: `orders.buyer_user_id uuid` NULLABLE (baseline `:8528`); `tickets` has NO user column (baseline `:9862-9885`).
- Blocking helper: `is_blocked_by(blocker uuid, target uuid) RETURNS boolean` — `EXISTS(SELECT 1 FROM blocked_users WHERE blocker_id=blocker AND blocked_id=target)` (baseline `:5448-5455`, verbatim-read).
- `profiles.visibility_mode` CHECK `('public','friends','private')`, default `'friends'` (baseline `:9105,9120`); profiles effectively world-readable via RLS (1334-sealed) — so exposing `profile_id` to AUTHED callers adds no new capability; the RPCs implement privacy IN-RPC, never leaning on profiles RLS (investigation Five-Truth flag).

## 3. Cross-Surface Impact Declaration

Backend-only leg: no user-visible behavior changes on any surface until ORCH-1339+ consume the RPCs.

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | Enabled-only | none (1339/1341 consume) | none | n/a |
| 2 | Consumer Android (`app-mobile/`) | Enabled-only | none | none | n/a |
| 3 | Buyer/anon Web (`mingla-business` `/e /t /exp /b /checkout`) | Enabled-only | none | none | n/a |
| 4 | Business iOS | Enabled-only | none | none | n/a |
| 5 | Business Android | Enabled-only | none | none | n/a |
| 6 | Admin Web (`mingla-admin/`) | NOT covered | — (ORCH-1334's admin twin owns admin attendee views) | none | n/a |
| 7 | Business Web preview | Enabled-only | none | none | n/a |

The RPCs themselves are cross-surface infrastructure: the SAME two functions serve every caller class; the per-caller shape difference (anon vs authed) is enforced INSIDE the RPCs (D1), never client-side.

## 4. Layered specification

### 4.1 Database — Migration 1 (the only migration in this leg)

**File:** `supabase/migrations/<VERSION>_orch_1338_social_proof_guest_reads.sql`

**VERSION (safe-migration protocol — MANDATORY):** strictly greater than `20261223000000` (current frontier = `20261223000000_orch_1298_chip_in_receipt_enqueue.sql`, re-verified in this worktree 2026-07-10). Provisional: `20261224000000`. **At IMPLEMENT time the implementor MUST re-scan the frontier before finalizing the version:** `git fetch origin && ls ~/Desktop/mingla-orchs/*/supabase/migrations | sort | tail` plus the worktree's own `supabase/migrations/` — ORCH-1334's migration is expected to land nearby (F-8); if anything ≥ the provisional version exists anywhere, bump above it. Never reuse or tie a version.

**File-level protocol (house style, from the verbatim-read `20261016000000` header):** `DROP FUNCTION IF EXISTS` before each `CREATE FUNCTION`; `$function$` terminator BEFORE the grants; explicit `REVOKE ALL ... FROM PUBLIC` then targeted `GRANT EXECUTE`; `COMMENT ON FUNCTION`; `NOTIFY pgrst, 'reload schema'` at the end. **Do NOT auto-apply to prod from the worktree** — the orchestrator/Seth applies via the Management API (memory: blind `db push` UNSAFE; edge-deploy/migration hazards), then verifies with one live call each (feedback_supabase_edge_deploy_verify_first_call analog for RPCs).

---

#### 4.1.1 Function A — `pg_public_social_proof(p_event_id uuid) RETURNS json`

`LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`.

**Guard-FIRST ordering (the FIRST executable statements, before any count/sample work — 1334 pattern):**
1. Resolve the event row: `SELECT ... FROM events e JOIN brands b ON b.id = e.brand_id WHERE e.id = p_event_id AND e.visibility = 'public' AND e.deleted_at IS NULL AND b.deleted_at IS NULL AND e.status = ANY (ARRAY['scheduled','live','ended','cancelled'])` (status set byte-parity with `pg_public_rsvp_by_slug:102-108` so the card can render wherever the page renders). Not found → `RETURN NULL::json` (mirror the by-slug NULL contract — no existence oracle beyond what the by-slug RPCs already expose).
2. Read the gates server-side from the resolved row (never trusting the client):
   - `v_private := COALESCE((e.theme #>> '{business_event,settings,privateGuestList}')::boolean, false)`
   - `v_hide_remaining := COALESCE((e.theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false)`
3. `v_viewer := auth.uid()` (NULL for anon — drives block-exclusion only; this function returns NO names to anyone).

**Counts (per-entity reads — COMMS-0057: the RSVP path NEVER merges into the ticket path; a `CASE e.event_type` branch, two disjoint queries):**
- `event_type = 'rsvp'` →
  `going := (SELECT COALESCE(SUM(1 + r.plus_count), 0) FROM event_rsvps r WHERE r.event_id = e.id AND r.rsvp_status = 'going' AND r.approval_status = 'approved')`; `capacity := e.rsvp_capacity` (NULL = unlimited).
- `event_type IN ('event','trip','experience')` →
  `going := (SELECT COUNT(*) FROM tickets t WHERE t.event_id = e.id AND t.status IN ('valid','used','transferred'))` — the ORCH-0946 sold formula, computed as an ABSOLUTE count under SECURITY DEFINER (this is the F-3 fix: no more deriving sold from per-tier remaining, no unlimited-capacity hole);
  `capacity := CASE WHEN EXISTS (SELECT 1 FROM ticket_types tt WHERE tt.event_id = e.id AND tt.deleted_at IS NULL AND (COALESCE(tt.is_unlimited,false) OR tt.quantity_total IS NULL)) THEN NULL ELSE (SELECT SUM(tt.quantity_total) FROM ticket_types tt WHERE tt.event_id = e.id AND tt.deleted_at IS NULL) END` (any unlimited/uncapped tier ⇒ capacity NULL ⇒ no scarcity language downstream — rule 9).

**Avatar-cluster sample (N specified: `SOCIAL_PROOF_SAMPLE_MAX = 5`):**
- `v_private = true` → `sample := '[]'::json` unconditionally (D2: server-enforced; counts still returned).
- Else, per entity (again disjoint branches):
  - rsvp: candidate guests = `event_rsvps` rows `going+approved` with `user_id IS NOT NULL`.
  - ticketed: candidate guests = `DISTINCT orders.buyer_user_id` over orders that own ≥1 live ticket for this event (`EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id AND t.status IN ('valid','used','transferred'))`) with `buyer_user_id IS NOT NULL` (D3: buyers only; seats have no identity).
- Join `profiles p ON p.id = <linked user id>` and keep only rows where ALL of:
  - `p.visibility_mode IN ('public','friends')` (D1: `private` → excluded from the sample; they remain in the count),
  - `p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0` (the sample is the AVATAR cluster feed; glyph fill comes from the count client-side — 15% avatar reality, F-6/F-11),
  - block exclusion for authed viewers: `v_viewer IS NULL OR (NOT is_blocked_by(p.id, v_viewer) AND NOT is_blocked_by(v_viewer, p.id))` (both directions).
- Order: `created_at ASC` (of the rsvp/order row — first-in guests), `LIMIT 5`.
- **Whitelist (hard):** each sample element carries EXACTLY `{"avatarUrl": text, "isMinglaUser": true}`. NO `display_name`, NO `username`, NO `profile_id`, NO email/phone/guest_name — for anon AND authed alike. Names live exclusively in Function B (authed). This is deliberately narrower than the D1 authed ceiling (minimal exposure; the card never renders names — ORCH-1341's sheet uses Function B).

**Response schema (json, camelCase keys — house style of `pg_public_rsvp_by_slug`):**
```json
{
  "eventId": "<uuid>", "entityType": "rsvp|event|trip|experience",
  "goingCount": 0, "capacity": null,
  "privateGuestList": false, "hideRemainingCount": false,
  "sample": [ { "avatarUrl": "https://…", "isMinglaUser": true } ]
}
```
- `entityType` maps `events.event_type` verbatim (`'event'|'rsvp'|'trip'|'experience'`).
- Event not found / not public → the RPC returns SQL `NULL` (PostgREST body `null`). No error shape on this path.

**Grants:** `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO anon, authenticated;`

**`verify_jwt` posture:** n/a — these are Postgres RPCs via PostgREST, not edge functions. Anon calls ride the anon key exactly like `pg_public_rsvp_by_slug`; there is no edge function in this leg.

**D6 compatibility note (binding on shape, not scope):** the function is keyed by `p_event_id` and is entity-agnostic. ORCH-1342's bounded anon event-by-slug read can wrap or precede it (slug → id via its own guarded resolver) with zero change here. Nothing in this contract may assume the caller already holds an authed session or a deck seed.

#### 4.1.2 Function B — `peer_list_event_guests(p_event_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS json`

`LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`.

**Guard-FIRST ordering (each guard is its own statement, in this exact order, before ANY data read):**
1. `v_viewer := auth.uid(); IF v_viewer IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;` (D1: the named list is app-gated + authed; anon NEVER reaches row data).
2. Resolve event (same join/predicates as Function A but **status restricted to `ARRAY['scheduled','live']`** — the dispatch's "event public + live check"; no scraping ended/cancelled guest lists). Not found → `RAISE EXCEPTION 'event_not_available';`
3. `v_private` gate read server-side from `events.theme` exactly as in Function A; `IF v_private THEN RAISE EXCEPTION 'guest_list_private'; END IF;` (D2: the peer list is suppressed IN the RPC, not client-only).
4. Row-cap clamp: `v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100); v_offset := GREATEST(COALESCE(p_offset, 0), 0);` — 100 is the HARD cap; no parameter combination returns more.

**Row source (per-entity, disjoint — COMMS-0057):**
- rsvp: one row per `event_rsvps` row with `rsvp_status='going' AND approval_status='approved'`; `party_size := 1 + plus_count`. (Web plus-one rows in `event_rsvp_guests` stay inside `party_size`; `matched_user_id` identity surfacing is deferred — live table is empty, F-11. Note in §10.)
- ticketed (`event`/`trip`/`experience`): one row per order owning ≥1 live ticket (same EXISTS predicate as Function A); `party_size :=` count of that order's live tickets. (D3: extra seats render as glyphs client-side via `party_size`.)

**Per-row identity mapping (D1, applied in the SELECT — the ONLY columns the query may touch on `profiles` are `id, display_name, username, avatar_url, visibility_mode`):**
- Linked (`user_id`/`buyer_user_id` NOT NULL) + `visibility_mode IN ('public','friends')` + not blocked → named row:
  `{"profileId": uuid, "displayName": text|null, "username": text|null, "avatarUrl": text|null, "isMinglaUser": true, "isAnonymous": false, "partySize": n}`.
- Linked + `visibility_mode = 'private'` → anonymous row (D1: glyph + anonymous): `{"profileId": null, "displayName": null, "username": null, "avatarUrl": null, "isMinglaUser": true, "isAnonymous": true, "partySize": n}`.
- Linked + blocked pair (either direction, via `is_blocked_by` twice) → row EXCLUDED entirely.
- Unlinked (anon RSVP guest / anon buyer) → `{"profileId": null, …nulls…, "isMinglaUser": false, "isAnonymous": true, "partySize": n}`. **`guest_name`/`guest_email`/`guest_phone`/`buyer_name`/`buyer_email`/`buyer_phone`/`attendee_*` MUST NOT appear anywhere in the query's output expressions** — typed contact data of non-users is never peer-visible (whitelist discipline; F-8 scraper warning).
- `profileId` is returned ONLY on named rows: 1341's add-friend (`useFriends().addFriend(uuid)`) and message (`ensureConversation`) actions need it; exposure rationale in §2 assumptions (profiles already world-readable to authed users — 1334-sealed posture; the RPC adds no capability, it adds curation).

**Ordering + pagination:** `ORDER BY (identity_present) DESC, created_at ASC, id ASC` (named rows first, then anonymous; deterministic tiebreak). Fetch `v_limit + 1` rows; `hasMore := (rowcount > v_limit)`; return the first `v_limit`.

**Response schema:**
```json
{ "eventId": "<uuid>", "entityType": "rsvp", "returned": 12, "hasMore": false,
  "guests": [ { "profileId": null, "displayName": null, "username": null,
                "avatarUrl": null, "isMinglaUser": false, "isAnonymous": true,
                "partySize": 2 } ] }
```

**Error shapes (client-visible via PostgREST, all `RAISE EXCEPTION`, message = machine token):**

| Condition | message | Client meaning |
|---|---|---|
| anon caller | `authentication_required` | 1341 shows the app-gate (never reached in practice — sheet is app-only) |
| event missing / not public / not scheduled-or-live | `event_not_available` | treat as gone |
| `privateGuestList = true` | `guest_list_private` | affordance should already be hidden (Function A gate); defense-in-depth vs scrapers |

**Grants:** `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated;` — **NO anon grant** (D1).

#### 4.1.3 RLS statement (explicit, per dispatch)

**Table RLS is UNCHANGED by this leg.** `event_rsvps` keeps exactly `event_rsvps_host_read` / `event_rsvps_host_write` / `event_rsvps_guest_read_own` / guest-insert (verbatim-read `20261004000000:118-160`); `event_rsvp_guests` keeps host_read + owner_read; `orders`/`tickets` keep buyer-or-brand-team SELECT (baseline). All peer/anon access is mediated exclusively by the two SECURITY DEFINER functions above. No policy is added, dropped, or altered. No table gains or loses RLS.

### 4.2 Edge function — none (no edge function in this leg; both reads are Postgres RPCs).

### 4.3 Service / Hook / Component / Realtime — none in this leg (ORCH-1339 owns the client services + props plumbing; ORCH-1341 owns the sheet).

### 4.4 Shared TypeScript payload contract (created HERE, consumed by 1339/1340/1341)

**File (NEW):** `packages/offering-rendering/socialProofTypes.ts` — pure types + one constant; NO imports beyond nothing (dep-free, mirrors `rsvpMomentum.ts` style); exported from the package barrel `packages/offering-rendering/index.ts`.

```ts
export const SOCIAL_PROOF_SAMPLE_MAX = 5;
export type SocialProofEntityType = "rsvp" | "event" | "trip" | "experience";
```
- `SocialProofSampleEntry`: `{ avatarUrl: string; isMinglaUser: true }` — the Function-A sample element.
- `SocialProofSummary`: `{ eventId: string; entityType: SocialProofEntityType; goingCount: number; capacity: number | null; privateGuestList: boolean; hideRemainingCount: boolean; sample: SocialProofSampleEntry[] }` — the Function-A payload, camelCase-identical to the RPC json (no client mapping layer needed).
- `PeerGuestRow`: `{ profileId: string | null; displayName: string | null; username: string | null; avatarUrl: string | null; isMinglaUser: boolean; isAnonymous: boolean; partySize: number }` and `PeerGuestListPage`: `{ eventId: string; entityType: SocialProofEntityType; returned: number; hasMore: boolean; guests: PeerGuestRow[] }` — the Function-B payload (1341's input).

I-MOR-0827 compliance: types only — no fetch, no react, no app `src/` import. 1340 extends rendering, NOT this shape (the sample already carries `avatarUrl`; the card ignores it until 1340).

## 5. Success criteria (observable, tester-checkable; caller-class split replaces surface split — parity across app surfaces is automatic because both functions are the single shared read)

- **SC-1** Calling `pg_public_social_proof` as ANON on a live public RSVP event returns `goingCount` equal to `SUM(1+plus_count)` of going+approved rows, `capacity = rsvp_capacity`, both gates as stored, and a `sample` array in which NO element has any key other than `avatarUrl`/`isMinglaUser`.
- **SC-2** Same call on a live public ticketed event (any of event/trip/experience) returns `goingCount` = count of valid/used/transferred tickets **even when every tier is unlimited** (F-3 fixed), and `capacity` NULL iff ≥1 non-deleted tier is unlimited/uncapped, else Σ`quantity_total`.
- **SC-3** With `theme.business_event.settings.privateGuestList = true` (the live prod event from F-11 qualifies): Function A returns `privateGuestList: true` AND `sample: []`; Function B raises `guest_list_private`. Both proven by live call, not source-read.
- **SC-4** Function A sample NEVER contains: a guest whose profile `visibility_mode='private'`; a guest with empty/NULL `avatar_url`; more than 5 entries; (for an authed caller) a guest with a block in either direction between viewer and guest.
- **SC-5** Function B as anon (no JWT) raises `authentication_required` — zero rows ever cross the wire unauthenticated.
- **SC-6** Function B named rows appear ONLY for linked guests with `visibility_mode IN ('public','friends')` and no block either direction; linked-private guests appear as `isAnonymous: true, isMinglaUser: true` rows with all-null identity; unlinked guests as `isAnonymous: true, isMinglaUser: false`; blocked-pair guests are absent entirely; no output field ever carries `guest_name/guest_email/guest_phone/buyer_*/attendee_*` values.
- **SC-7** Function B row-cap: `p_limit=10000` returns ≤100 rows; `p_limit=0`/negative returns ≥1 (clamped); `hasMore` is true exactly when more rows exist past the returned page; pagination via `p_offset` is deterministic (stable ordering).
- **SC-8** Draft / deleted / `visibility<>'public'` events: Function A returns json `null`; Function B raises `event_not_available`. Ended/cancelled events: Function A still answers (page parity); Function B raises `event_not_available` (public+live only).
- **SC-9** `NOTIFY pgrst` reload works: both functions callable through PostgREST immediately post-apply (orchestrator's one-curl verify).
- **SC-10** Table RLS diff is empty: `pg_policies` for `event_rsvps`, `event_rsvp_guests`, `orders`, `tickets`, `profiles` is byte-identical before/after the migration.

## 6. Invariants

**Preserved (each with how + verifying test):**
- **I-MOR-0827-PACKAGE-ISOLATION** — untouched: the package gains a dep-free types file only; data still arrives via props; no fetch enters `packages/offering-rendering`. Verified by the existing META-ORCH-0827 packages gate + T-12.
- **I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (ACTIVE)** — NOT rewritten here (1340 owns the rewrite with the tests-append-only token). This leg keeps the invariant's enforcement surface green: `RsvpMomentumDecision.tsx` and its tests are untouched; no renderer consumes identity. The bundled ADDRESS-privacy half is untouched (no address fields anywhere in either RPC's output).
- **COMMS-0057 / ORCH-1206 (RSVP never merges into the ticket path)** — both functions branch `CASE event_type` into disjoint queries; the RSVP count/list never reads `tickets`/`orders` and vice versa. Verified by T-13 (static) + SC-1/SC-2.
- **Profiles-RLS posture (1334-sealed)** — privacy is implemented IN-RPC (visibility_mode + blocks evaluated in the query), never delegated to profiles RLS.

**Proposed NEW (DRAFT — the orchestrator flips ACTIVE on CLOSE; this SPEC does not):**
- **I-PROPOSED-1338-PEER-GUEST-READ-GUARDED (DRAFT):** every peer/anon-facing guest read RPC is SECURITY DEFINER with guard-FIRST ordering (auth gate where applicable → event public/live+visibility gate → server-side `privateGuestList` gate → hard row-cap ≤100) and a column whitelist that never emits typed contact data (`guest_*`, `buyer_name/email/phone`, `attendee_*`) nor names to anon callers.
- **I-PROPOSED-1338-SOCIAL-PROOF-COUNTS-HONEST (DRAFT):** the cross-entity social-proof count is the absolute per-entity formula (RSVP `SUM(1+plus_count)` going+approved; ticketed COUNT of valid/used/transferred tickets), computed server-side; capacity is NULL whenever any tier is unlimited — scarcity is never fabricated from partial capacity.
- **I-PROPOSED-1338-SOCIAL-PROOF-SAMPLE-PRIVACY (DRAFT):** the anon-callable sample carries avatars only (no names/ids), excludes `private` profiles and (for authed viewers) blocked pairs, and is empty whenever `privateGuestList` is on.

## 7. Test cases

| # | Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|---|
| T-1 | happy counts rsvp | live public RSVP, 3 going+approved (one plus_count=1) | Fn A anon | goingCount 4, capacity=rsvp_capacity | data/live |
| T-2 | happy counts ticketed-unlimited | live public event, 2 live tickets, all tiers unlimited | Fn A anon | goingCount 2, capacity null (F-3 fix) | data/live |
| T-3 | happy counts ticketed-finite | tiers 10+5 finite, 3 sold | Fn A anon | goingCount 3, capacity 15 | data/live |
| T-4 | trip + experience parity | same as T-2 on event_type trip / experience | Fn A anon | identical shape, entityType correct | data/live |
| T-5 | privateGuestList on | F-11's live `pgl_true` event | Fn A anon+authed; Fn B authed | A: gates true + sample []; B: raises `guest_list_private` | data/live |
| T-6 | sample privacy | guests: 1 public w/ avatar, 1 friends w/ avatar, 1 private w/ avatar, 1 public no-avatar, 1 unlinked | Fn A anon | sample = exactly the 2 non-private avatar-bearing; keys only avatarUrl/isMinglaUser | data/live |
| T-7 | blocked pair | viewer blocks guest X (and inverse case) | Fn A authed; Fn B authed | X absent from sample AND from list rows | data/live |
| T-8 | anon vs authed shapes | same event, anon key vs user JWT | Fn A both; Fn B anon | A: identical (no names either way); B anon: `authentication_required` | runtime |
| T-9 | row-cap scrape | seed >100 guest rows; `p_limit=10000`, then offset-walk | Fn B authed | ≤100/page; hasMore true then false; deterministic pages; no dup/skip at boundaries | data/live |
| T-10 | draft/deleted/private-visibility event | each state | Fn A / Fn B | A: json null; B: `event_not_available` | data/live |
| T-11 | ended/cancelled event | status='ended' / 'cancelled' | Fn A / Fn B | A: answers (page parity); B: `event_not_available` | data/live |
| T-12 | package purity | socialProofTypes.ts | deno source assert | no import statements / no fetch / exports the 5 named symbols + constant 5 | test/CI |
| T-13 | per-entity separation (static) | migration SQL | deno source assert | rsvp branch contains no `tickets`/`orders` reference; ticketed branch no `event_rsvps`; both functions contain the guard tokens in guard-first order | test/CI |
| T-14 | contact-data leak (adversarial, static+live) | migration SQL + live rows with guest_email set | assert + Fn B | `guest_email|guest_phone|guest_name|buyer_name|buyer_email|buyer_phone|attendee_` absent from every output expression; live response bodies contain none of the seeded strings | test/CI + data/live |
| T-15 | RLS unchanged | pg_policies snapshot pre/post | SQL diff | empty diff (SC-10) | schema/live |
| T-16 | partySize honesty | rsvp plus_count=2; order with 3 tickets | Fn B authed | partySize 3 / 3 respectively; goingCount consistent with Σ partySize per entity formula | data/live |

Live-fire notes for the tester (headless QA insufficient for SQL RPCs — memory rule): run T-1…T-11, T-14…T-16 against prod `gqnoajqerqhnvulmnyvv` via the Management API / PostgREST with the anon key + a real user JWT; seed/teardown test rows only on a dedicated test event; never mutate the F-11 live host's event beyond reads.

## 8. Implementation order

1. **Re-scan the migration frontier** (worktrees + origin/main; §4.1) → finalize `<VERSION>`.
2. Write `supabase/migrations/<VERSION>_orch_1338_social_proof_guest_reads.sql` — Function A, Function B, revokes/grants, comments, `NOTIFY pgrst`.
3. Write `packages/offering-rendering/socialProofTypes.ts` + add the barrel exports in `packages/offering-rendering/index.ts`.
4. Write `supabase/migrations/__tests__/orch_1338_social_proof_reads.test.ts` (static: T-13 halves) and `supabase/migrations/__tests__/orch_1338_social_proof_reads.antiScrape.adversarial.test.ts` (static: T-14 grep-class + guard-order + grant assertions) — house exemplar `pg_public_trips_by_brand.antiLeak.adversarial.test.ts`.
5. Package test for T-12 in `packages/offering-rendering/__tests__/orch_1338_social_proof_types.test.ts`.
6. Local gates: deno tests + typecheck + lint. NO deploy/apply from the implementor (orchestrator applies via Management API at SHIP; verify each function with one live curl — SC-9).

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** the adversarial migration test `orch_1338_social_proof_reads.antiScrape.adversarial.test.ts` reads the migration file and asserts, in order: (a) `authentication_required` guard precedes any `FROM event_rsvps|orders|tickets` in Function B's body; (b) the `guest_list_private` gate token exists and precedes row reads; (c) `LEAST(GREATEST(` row-cap clamp present; (d) `GRANT EXECUTE ... TO authenticated;` for Function B carries NO `anon`; (e) none of `guest_email|guest_phone|guest_name|buyer_name|buyer_email|buyer_phone|attendee_` appears in any json output expression; (f) Function A's sample object literal contains ONLY `avatarUrl`/`isMinglaUser` keys.

**Fails-on-revert requirement:** deleting the migration file, weakening any guard token, adding an anon grant to Function B, or widening the sample keys makes the test FAIL; restoring the contract makes it PASS. The implementor must demonstrate one revert-run (e.g. sed-strip the `guest_list_private` gate in a scratch copy) in the implementation report.

**Protective comment:** each function's header comment must state WHY guard-first + whitelist exist (F-8: "a DEFINER RPC without a guard is an open per-event guest-scraper") and name this SPEC + I-PROPOSED-1338-PEER-GUEST-READ-GUARDED.

## 10. Open questions

1. **`event_rsvp_guests.matched_user_id` identity rows** — deferred out of Function B's row model (plus-ones stay inside `partySize`); the table is live-empty (F-11). If Seth wants matched plus-ones named in the sheet later, register a follow-up ORCH (no schema change needed — additive to Function B).
2. **`profileId` exposure on named rows (Function B)** — included per §4.1.2 rationale (1341's add-friend/message need it; profiles already world-readable to authed users per the 1334-sealed posture). Flagged for Seth's awareness because the dispatch's literal whitelist named only display columns + `is_mingla_user`; this SPEC treats `profileId` as the D1 "per-D1 privacy fields" carrier for named rows only. Veto = 1341 falls back to username-based resolution (`resolve_user_visibility_by_identifier`, one extra round-trip per action).
3. **Ended/cancelled events answering Function A** — chosen for page parity (the by-slug RPCs serve those pages). If Seth prefers momentum to go dark post-event, flip the status array to `('scheduled','live')` at IMPLEMENT (one-line change; 1339 renders nothing on `null`).

## 11. Downstream routing

- **Next: mingla-implementor** — implement exactly this contract in the META worktree (`~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]`, branch `META-ORCH-1337-social-proof-guest-list`). No deploy/apply; no UI. Stop-and-amend on ANY file outside the allowlist below.
- **Then: mingla-tester** — live-fire the §7 table against prod via Management API/PostgREST (read-only + dedicated test-event seeds); verify SC-1…SC-10; adversarial scrape attempts mandatory (T-9, T-14).
- **Then: orchestrator SHIP/CLOSE** — applies the migration via Management API, one-curl verifies both functions (SC-9), merges via PR (one PR per CLOSE), flips the I-PROPOSED-1338-* invariants ACTIVE, updates WORLD_MAP. ORCH-1339 (card) may IMPLEMENT in parallel after this migration's contract is frozen, but must not SHIP before 1338 is applied (it consumes Function A live).

---

## Scoped allowlist (the implementor may create/modify ONLY these)

1. `supabase/migrations/<VERSION>_orch_1338_social_proof_guest_reads.sql` (NEW — version per §4.1 re-scan)
2. `packages/offering-rendering/socialProofTypes.ts` (NEW)
3. `packages/offering-rendering/index.ts` (barrel exports for the new types ONLY — no other line)
4. `supabase/migrations/__tests__/orch_1338_social_proof_reads.test.ts` (NEW)
5. `supabase/migrations/__tests__/orch_1338_social_proof_reads.antiScrape.adversarial.test.ts` (NEW)
6. `packages/offering-rendering/__tests__/orch_1338_social_proof_types.test.ts` (NEW)

## DO-NOT-TOUCH (stop-and-amend before touching ANY of these)

- Any existing migration file — especially `20261016000000_orch_1163_pg_public_rsvp_by_slug.sql`, `20260724000006_orch_0946_public_ticket_types_remaining.sql`, `20261220000000_orch_1291_rsvp_contributions.sql` (`business_public_events_view`), `20261222000000_orch_1296_rsvp_edit_chip_in.sql`, `20261004000000_orch_1150_rsvp_events.sql` (RLS), baseline.
- `host_list_rsvp_guests` / `admin_list_event_rsvps` / `fetch_user_going_rsvps` (ORCH-1334's scope).
- ANY table RLS policy, ANY table/column DDL (this leg is functions-only).
- `packages/offering-rendering/RsvpMomentumDecision.tsx`, `rsvpMomentum.ts`, `RsvpOfferingBody.tsx`, `EventOfferingBody.tsx`, `TripOfferingBody.tsx`, `ExperienceOfferingBody.tsx` (ORCH-1339's files).
- `packages/offering-rendering/__tests__/orch_1157_*` and `orch_1163_*` test files (tests-append-only; 1340 owns the sanctioned rewrite).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (orchestrator owns registry writes at CLOSE).
- All app code (`app-mobile/`, `mingla-business/`, `mingla-admin/`), all edge functions, `COMMS_LEDGER.md`.
