# SPEC ORCH-1150 — RSVP Event (Partiful-style) Sibling Create/Edit Wizard

**Mode:** SPEC (binding build contract). No product code, no migration files, no worktree, no deploys produced by this document.
**Anchor read:** `/Users/sethogieva/Desktop/mingla-main` on `main` (read-only).
**Date:** 2026-06-15.
**Evidence base:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1150_RSVP_EVENT_WIZARD_WALKTHROUGH.md` (every `file:line` below was re-read verbatim against `main` while writing this spec).
**Comms ledger:** Read on entry. No OPEN entry targets `mingla-forensics`, `ORCH-1150`, or `ALL` at BLOCK. COMMS-0033 (ORCH-1133 ID collision) + COMMS-0029 (trip RPC clobber) are unrelated. Nothing to ack.

> This SPEC honors Seth's 4 LOCKED steering decisions exactly. Where the investigation's walkthrough recommended a different default (drop Party Type; invite-link-only; cap-only host config), the steering OVERRIDES it and this SPEC specs to the steering. Each override is flagged inline.
>
> **AMENDED 2026-06-15 (full-featured v1).** Seth LOCKED four further V1-SCOPE decisions (World Map "V1-SCOPE STEERED"): **A2** BUILD the approve/deny host console in v1 (full manual approval, not just a count); **A3** FULL waitlist (`waitlisted` status + auto-promote-oldest + notify); **A4** notify going-guests via push + SMS + email (all three) through a NEW RSVP notification pipeline, capturing guest contact at RSVP time; the 6-step structure is CONFIRMED unchanged. These EXPAND the original spec — the prior lightweight/deferred versions (old §10 A2/A3/A4 "RECOMMEND lightweight/follow-on") are REPLACED. See the **Amendment Log** at the end for the auditable diff. Every amended contract item cites the real file:line it clones from.

---

## 1. Executive Summary

ORCH-1150 ships a **fourth sibling offering wizard** — the RSVP event — alongside the existing event / experience / trip wizards, all forked off the `events.event_type` discriminator (`supabase/migrations/20260605000000_orch_0826_events_event_type_discriminator.sql:32-34`). An RSVP event is a Partiful-style gathering: the same Basics / When / Where / Cover surfaces as a ticketed event, but **no tickets and no checkout** — guests reply **Going / Not going**, and the host gets full control over capacity, plus-ones, waitlist, and approval.

The build is **additive and low-regression** because there is already a proven fork pattern (trip got its own `business_publish_trip_draft` because extending the event RPC was infeasible — `...orch_1075...sql:2307`, comment `:2621`). RSVP follows the same shape. The single largest landmine is that the event pipeline **hard-assumes ≥1 ticket in three places** — the publish RPC raises `event_ticket_required` (`...orch_1075...sql:1932-1934`), `validateTickets` blocks at 0 tickets (`draftEventValidation.ts:452-461`), and the public page routes every CTA to checkout (`PublicEventPage.tsx:291,329,340`). This SPEC therefore mandates a **forked publish RPC, a forked validator, and a Going/Not-going public CTA** — none of these three may be reused verbatim.

Two genuinely new persistence concepts are required: (a) widen the `event_type` CHECK to include `'rsvp'`; (b) a new per-guest `public.event_rsvps` table (no event-level attendee table exists today — `board_card_rsvps` is an unrelated consumer collab-board table). Per Seth's steering, discovery is **host-choosable** via a new `events.rsvp_discoverable` boolean (default OFF): when true the row appears on the consumer deck with a Going/Not-going card; when false it is invite-link-only. Single-date only in v1.

---

## 2. Scope & Non-Goals

### In scope
1. Chooser fork: "Create event" → in-sheet `step:"event"` with two rows (Ticketed → `/event/create` untouched; RSVP → new `/rsvp/create`). Mirrors the ORCH-1144 experience-step pattern (`UniversalCreatorSheet.tsx:262-311`).
2. New sibling `RsvpCreatorWizard.tsx` (6 steps) + its `/rsvp/create` and `/rsvp/[id]/edit` routes.
3. Forked validator (`draftRsvpValidation.ts`) — no ≥1-ticket gate; keep Basics party-type gate.
4. Additive `DraftEvent` fields + persist `version` bump 11 → 12 + additive migrator.
5. Schema: `event_type` CHECK widen (+`'rsvp'`); new `public.event_rsvps` table + RLS; `events.rsvp_discoverable boolean`; `events.rsvp_capacity int`, `events.rsvp_allow_plus_ones boolean`, `events.rsvp_plus_ones_max int`, `events.rsvp_waitlist_enabled boolean`, `events.rsvp_approval_mode text`.
6. RPCs: `business_publish_rsvp_draft` (publish), `biz_update_live_rsvp` (edit-published), `public_submit_rsvp` (guest write — anon-capable via edge function).
7. Public RSVP page: Going / Not-going CTA + +1 input + capacity-full / waitlist / pending-approval states, on `PublicEventPage.tsx` (the `/e/` route).
8. Consumer deck RSVP card variant (discoverable path only) + discover-RPC widen.
9. Hub list-card / manage-sheet RSVP branch ("N going" instead of revenue).
10. RSVP-aware edit-after-publish guards (no refund gate, no EndSalesSheet, no ticket-diff).
11. **(A2 + A2-NEW) Host approve/deny/remove console** (business iOS+Android) — a Guests list off the RSVP's manage-sheet showing pending RSVPs with per-row Approve/Deny + bulk-approve, AND a per-row **Remove** (with confirm) on Going guests that un-admits an already-approved guest (A2-NEW `approved→denied`, frees a spot, auto-promotes the oldest waitlisted guest, notifies the removed guest); backed by `host_set_rsvp_status(p_rsvp_id, p_status)` RPC + RLS (owning host only); approve/deny/remove fires a guest notification (§5.4).
12. **(A3) FULL waitlist** — a `waitlisted` attendance status + auto-promote-oldest-when-a-spot-opens (going→not_going, deny/remove, or cap raised) via a DB trigger that enqueues a notification (§5.5). Capacity accounting counts `plus_count`.
13. **(A4 + A4-NEW + A4-NEW-2) RSVP notification pipeline** — guest contact capture (**link guests: name+email+phone ALL required — A4-NEW**; app users: profile-inherited, exempt) on the public form + a new `rsvp-notify` edge fn fanning out across push (OneSignal) + SMS (Twilio) + email (Resend), attempting **every channel the guest has an address/token for — app users get push+email+SMS, not push-only (A4-NEW-2)**, per-channel non-blocking, for **four** triggers: published-edit → all going guests; waitlist auto-promotion → the promoted guest; approve/deny → that guest; **host-remove → the removed guest (A2-NEW `rsvp_removed`)** (§5.6).

### Non-goals (explicit, with reason)
- **Multi-date + recurring RSVP** — OUT for v1 (Seth steering #4). The RSVP When step is single-date only. Flagged as a follow-on (§10 Open Q-A1).
- **Paid RSVP / tickets on an RSVP** — OUT by definition. An RSVP never enters checkout; `ticket-checkout-create` is untouched. A brand wanting tickets uses the Ticketed wizard.
- **Stripe / money surfaces in the RSVP wizard** — OUT. No StripeBlockedCard, no `computePublishability` blocked-stripe branch, no payout gate.
- **Guest-side RSVP edit / cancel-after-going management UI** — v1 writes a Going/Not-going row + allows the guest to flip their own status (RLS supports it); a richer "manage my RSVP" surface is a follow-on.
- **Marketing-consent / opt-out plumbing for RSVP notifications** — OUT. RSVP notifications (A4) are **TRANSACTIONAL** (a guest who tapped "Going" is told when the event they joined changes) — they sit OUTSIDE the unshipped `marketing_consent` foundation (`project_marketing_hub_strategy`). The transactional basis = the guest's own RSVP action; no marketing-consent column is read. (A guest can still flip to Not-going to stop being a going-guest.)
- **Admin-web + marketing-web RSVP surfaces** — OUT (no offering-authoring surface there).

### Assumptions
- The brand authoring an RSVP is universal — every brand reaches `/rsvp/create` with no `venueCategory`/kind gate (honors `I-BRAND-UNIVERSAL-AUTHORING`, mirrors how `/trip/create` routes universally `UniversalCreatorSheet.tsx:129-138`).
- `events.event_type='rsvp'` rows have ZERO `ticket_types` rows (new invariant `I-PROPOSED-1150-RSVP-NO-TICKET-ROWS`).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior | Files touched here | Parity |
|---|---------|----------|-----------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | **YES (discoverable path only)** | When host opts the RSVP onto the deck, an RSVP card appears with a Going/Not-going CTA (NOT Book). Link-only RSVPs never appear. | `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` (or a new `RsvpSwipeCard.tsx`); `cardConverters.ts`; the discover supply RPC. | Manual (per-surface card variant) |
| 2 | Consumer Android | **YES (same)** | Same as iOS. | Same RN files. | Automatic (shared RN) |
| 3 | Buyer/anon Web (`mingla-business` `/e/...`) | **YES** | Guests tap **Going / Not going** instead of a checkout CTA; +1 stepper when host allows; "Event full" / "Join waitlist" / "Awaiting host approval" states. Anon (logged-out) link guests can RSVP. | `PublicEventPage.tsx`; `@mingla/event-rendering` CTA machine (`resolveOfferingCta` branch or a sibling `resolveRsvpCta`); new `public_submit_rsvp` edge fn. | Manual (web-aware) |
| 4 | Business iOS (`mingla-business`) | **YES** | New chooser row; new RSVP create + edit wizard (6 steps); Hub list-card shows "N going". **(A2)** A "Guests" row on the RSVP manage-sheet opens the approve/deny console (pending list + per-row Approve/Deny + bulk-approve). | `UniversalCreatorSheet.tsx`; `RsvpCreatorWizard.tsx` + step components; `/rsvp/*` routes; `draftRsvpValidation.ts`; `draftEventStore.ts`; offering Hub primitives (`OfferingManageSheet.tsx`, `EventManageMenu.tsx`); NEW `RsvpGuestConsole.tsx` + `/rsvp/[id]/guests` route + `useRsvpApprovals.ts`. | — |
| 5 | Business Android | **YES** | Same as Business iOS (incl. the A2 console). | Same RN code. Android glass opaque-fallback on the new chooser row (`UniversalCreatorSheet.tsx:316-334` pattern) AND on the new console rows. | Automatic (shared RN) + manual glass token |
| 6 | Admin Web | **NO** | — | — | No admin offering-authoring surface. |
| 7 | Business Web preview (adjacent) | **YES (automatic)** | Same wizard + public page render via shared code. The A2 console renders on business-web too (shared RN). | Shared code; subject to lucide-shim / `__common` 2.25MB bundle-budget gate (per-icon named imports only; no `import *`). | Automatic |

**(A4 + A4-NEW + A4-NEW-2) Notification fan-out is cross-surface but not a "screen":** the RSVP notification pipeline reaches a guest across THREE delivery channels, attempting **every channel for which the guest has a usable address/token** — **push** to Mingla-app guests (consumer iOS/Android via OneSignal external_id), **SMS** to any guest with a phone (Twilio), **email** to any guest with an email (Resend). A **link guest** (no app account) supplies BOTH email AND phone (A4-NEW required), so they get **email AND SMS**. An **app-user guest** gets **push AND email (AND SMS if a profile phone exists)** — NOT push-only (A4-NEW-2). This is the consumer-app push path (surfaces 1+2) reached transactionally — no new consumer screen, just a delivered notification + the existing in-app notifications inbox row.

**Backend (in scope, not a "surface"):** Supabase — CHECK widen, `event_rsvps` table + RLS + contact columns + two-dimension status model, `business_publish_rsvp_draft` + `biz_update_live_rsvp` + `host_set_rsvp_status` + `submit_event_rsvp` RPCs, the `fn_rsvp_drain_on_capacity_freed` auto-promote trigger, `public_submit_rsvp` + `rsvp-notify` edge fns, discover-RPC widen.

---

## 4. Layered Specification

### 4.0 File-change manifest (allowlist — see §“Scoped allowlist” for DO-NOT-TOUCH)

**CREATE**
- `mingla-business/app/rsvp/create.tsx` — entry route (clone of `app/event/create.tsx`, swap `/event/` → `/rsvp/`).
- `mingla-business/app/rsvp/[id]/edit.tsx` — resume/edit route (clone of `app/event/[id]/edit.tsx`, mount `RsvpCreatorWizard`).
- `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx` — 6-step wizard shell (clone of `EventCreatorWizard.tsx`).
- `mingla-business/src/components/rsvp/RsvpStep5Setup.tsx` — NEW RSVP-setup step (replaces Tickets).
- `mingla-business/src/utils/draftRsvpValidation.ts` — forked validator.
- `mingla-business/src/services/rsvpEvents.ts` — `publishRsvpDraft` + `updateLiveRsvp` service callers.
- `mingla-business/src/hooks/useRsvpEvents.ts` (or extend `useBusinessEvents.ts`) — publish/update mutation hooks.
- `supabase/migrations/<VERSION>_orch_1150_rsvp_events.sql` — schema (CHECK widen, table, columns + contact + two-dimension status, RLS, RPCs, auto-promote trigger). VERSION per §4.1 rule.
- `supabase/functions/public-submit-rsvp/index.ts` — anon-capable guest write edge fn.
- **(A2) `mingla-business/src/components/rsvp/RsvpGuestConsole.tsx`** — host approve/deny console screen (pending list + per-row Approve/Deny + bulk-approve). Clones the list/row pattern from `EventManageMenu.tsx` rows + a list screen (§5.4).
- **(A2) `mingla-business/app/rsvp/[id]/guests.tsx`** — route mounting `RsvpGuestConsole` (clone of an `app/event/[id]/*.tsx` detail route).
- **(A2) `mingla-business/src/hooks/useRsvpApprovals.ts`** — React Query: `useRsvpGuestList(eventId)` (host read) + `useSetRsvpStatus()` mutation (calls `host_set_rsvp_status`, invalidates the guest-list + going-count keys).
- **(A2) `mingla-business/src/services/rsvpApprovals.ts`** — service caller for `host_set_rsvp_status` + the guest-list query.
- **(A4) `supabase/functions/rsvp-notify/index.ts`** — the multi-channel fan-out edge fn (push+SMS+email; per-channel non-blocking; §5.6). Reuses `_shared/push-utils.ts sendPush` + a Resend send cloned from `notify-dispatch/index.ts:84-138` + a Twilio send cloned from `ticket-confirmation-dispatch/index.ts:123-170`.
- Test files per §7 / §9.

**MODIFY**
- `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` — add `step:"event"` fork (§4.5).
- `mingla-business/src/store/draftEventStore.ts` — additive RSVP fields + version 12 migrator (§4.6).
- `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx` reuses existing step components `CreatorStep1Basics`, `CreatorStep2When`, `CreatorStep3Where`, `CreatorStep4Cover`, `CreatorStep6Settings` (see §4.3 reuse table — Settings needs a prop-gated variant).
- `mingla-business/src/components/event/PublicEventPage.tsx` — RSVP CTA branch (§4.7).
- `packages/event-rendering/` — `resolveRsvpCta` (or an `rsvp` branch in `resolveOfferingCta`) + the public-page Going/Not-going buttons.
- `supabase/config.toml` — `[functions.public-submit-rsvp] verify_jwt = false`.
- The consumer discover supply RPC (the one feeding `discover-cards` / the deck) — widen to include opted-in RSVP rows (§4.8).
- `app-mobile/src/...` deck card converter + card component — RSVP variant (§4.8).
- Hub offering list-card / manage-sheet — `event_type='rsvp'` branch (§4.3 last row).
- **(A2)** `mingla-business/src/components/offering/OfferingManageSheet.tsx` (+ its action-config layer) and/or `EventManageMenu.tsx` — add a **"Guests"** action row (visible only for `event_type='rsvp'` rows) routing to `/rsvp/[id]/guests`. Show a pending-count badge when `rsvp_approval_mode='manual'`. Clone the "Orders" row pattern (`EventManageMenu.tsx:171-183`).
- **(A4)** `supabase/config.toml` — `[functions.rsvp-notify] verify_jwt = true` (service-role-invoked only; it is NOT a public anon route).

### 4.1 Database

**Migration version rule (DROP-before-widen + monotonic prefix).** The current migration head is `20261002000000_orch_1142_notifications_soft_delete.sql`. The implementor MUST, at build time, run `ls supabase/migrations/ | sort | tail -1` and pick a prefix strictly greater than the head (e.g. `20261003000000_orch_1150_rsvp_events.sql`). **Do NOT hardcode a colliding version** — verify free before writing. Wrap the migration in `BEGIN; ... COMMIT;` (matches discriminator migration `:28`). Place any `GRANT` after the function body's closing `$$;` and `DROP` before any `RETURNS TABLE` widen (per `feedback_edge_deploy_and_migration_apply_hazards`).

**(a) Widen `event_type` CHECK (DROP + ADD, never silent widen).**
```sql
ALTER TABLE public.events DROP CONSTRAINT events_event_type_check;
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('event','experience','trip','rsvp'));
```
(Confirm the live constraint name via `\d public.events` / `information_schema`; the original was created inline at `20260605000000...:33-34` so the auto-name is `events_event_type_check` — verify before DROP.)

**(b) New host-control columns on `public.events` (all nullable / defaulted; additive).**
| Column | Type | Default | Meaning | Steering |
|--------|------|---------|---------|----------|
| `rsvp_discoverable` | `boolean NOT NULL` | `false` | true → row eligible for consumer deck; false → invite-link-only | #1 |
| `rsvp_capacity` | `integer NULL` | `NULL` | optional event-level guest cap; NULL = unlimited | #3 |
| `rsvp_allow_plus_ones` | `boolean NOT NULL` | `false` | host allows guests to bring +N | #3 |
| `rsvp_plus_ones_max` | `integer NOT NULL` | `0` | max additional guests per RSVP when plus-ones allowed (1..N) | #3 |
| `rsvp_waitlist_enabled` | `boolean NOT NULL` | `false` | when capacity hit, offer a waitlist | #3 |
| `rsvp_approval_mode` | `text NOT NULL` | `'auto'` | `CHECK (rsvp_approval_mode IN ('auto','manual'))` — auto-approve vs approve-each | #3 |

These columns are inert (defaults) for `event_type<>'rsvp'` rows; no behavioral change to events/experiences/trips.

**(c) New table `public.event_rsvps` (per-guest) — TWO-DIMENSION status model + contact columns (AMENDED for A2/A3/A4).**

**Status model decision (A2+A3): TWO independent columns, not one.**
- **`rsvp_status`** = the guest's own *intent / attendance* dimension: `going` | `not_going` | `waitlisted`. The guest controls `going`/`not_going`; the SYSTEM sets `waitlisted` (auto, when capacity is full at submit time) and auto-promotes `waitlisted → going` when a spot opens (§5.5).
- **`approval_status`** = the *host gate* dimension: `pending` | `approved` | `denied`. Defaults `approved`; set `pending` at write time only when `rsvp_approval_mode='manual'`; the host moves `pending → approved` / `pending → denied` (§5.4).

Two dimensions because a guest can be simultaneously "Going" AND "Awaiting host approval" (manual mode), OR "Going" AND "Approved", OR "Waitlisted" (capacity, orthogonal to approval). Collapsing them into one column would make these states unrepresentable. **Interaction / precedence rules (canonical):**
1. A row counts toward "confirmed attending" (and toward the capacity cap) **iff** `rsvp_status='going' AND approval_status='approved'`.
2. **Capacity-vs-approval precedence at submit (manual + cap both on):** capacity is evaluated against *confirmed-attending* count. A new Going RSVP first resolves approval: `pending` (manual). A `pending` row does NOT consume capacity. Capacity is only consumed when the host approves. Therefore in manual mode a guest is never auto-`waitlisted` at submit — they are `pending`; if capacity is already full when the host tries to approve, the approve is rejected (`rsvp_capacity_full` — host must raise the cap or deny others). In **auto** mode, a new Going RSVP that would exceed the cap is set `rsvp_status='waitlisted', approval_status='approved'` (waitlisted-but-host-auto-OK).
3. `denied` and `not_going` and `waitlisted` rows never consume capacity. A `denied` row keeps `rsvp_status` as last-known but is treated as not-attending for all counts.

```sql
CREATE TABLE public.event_rsvps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id         uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL for anon link guests
  guest_name      text NOT NULL,                 -- always captured (display on host list + notify)
  guest_email     text NULL,                     -- A4-NEW (DECIDED): REQUIRED for link guests (user_id IS NULL) — enforced at the form + RPC + a DB CHECK below; nullable at column level only because app-user (user_id IS NOT NULL) rows may inherit/omit it (profile supplies notify addresses)
  guest_phone     text NULL,                     -- A4-NEW (DECIDED): REQUIRED for link guests (E.164) — enforced at the form + RPC + the same DB CHECK; nullable at column level only for app-user rows
  rsvp_status     text NOT NULL DEFAULT 'going'
                    CHECK (rsvp_status IN ('going','not_going','waitlisted')),  -- A3: + waitlisted
  approval_status text NOT NULL DEFAULT 'approved'
                    CHECK (approval_status IN ('pending','approved','denied')), -- A2: + denied. A2-NEW (DECIDED): 'denied' is ALSO the host-REMOVE terminal state for an already approved/Going guest (no distinct 'removed' state — see §4.1c host-remove rule + §5.4).
  plus_count      integer NOT NULL DEFAULT 0 CHECK (plus_count >= 0),
  waitlisted_at   timestamptz NULL,              -- A3: set when system sets rsvp_status='waitlisted'; ORDER BY for promote-oldest
  promoted_at     timestamptz NULL,              -- A3: set when auto-promoted waitlisted→going
  notified_at     timestamptz NULL,              -- A3/A4: last transactional-notify enqueue (idempotency aid)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- A4-NEW (DECIDED, Seth 2026-06-15): a LINK guest (user_id IS NULL) MUST carry BOTH a
  -- usable email AND a usable phone, so the host's "they'll be notified" promise always holds
  -- across email + SMS. App-user rows (user_id IS NOT NULL) are exempt at the DB layer (they
  -- inherit notify addresses from their profile / are reachable via push by user_id).
  CONSTRAINT event_rsvps_link_guest_contact_required CHECK (
    user_id IS NOT NULL
    OR (guest_email IS NOT NULL AND length(btrim(guest_email)) > 0
        AND guest_phone IS NOT NULL AND length(btrim(guest_phone)) > 0)
  )
);
CREATE INDEX event_rsvps_event_id_idx ON public.event_rsvps (event_id);
-- A3: promote-oldest query support (waitlisted rows ordered by waitlisted_at ASC).
CREATE INDEX event_rsvps_waitlist_idx ON public.event_rsvps (event_id, waitlisted_at)
  WHERE rsvp_status = 'waitlisted';
CREATE UNIQUE INDEX event_rsvps_event_user_uniq
  ON public.event_rsvps (event_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX event_rsvps_event_email_uniq
  ON public.event_rsvps (event_id, lower(guest_email)) WHERE guest_email IS NOT NULL;
```
**Capacity accounting (A3):** the "confirmed attending" headcount used for the cap is
`SUM(1 + plus_count) FILTER (WHERE rsvp_status='going' AND approval_status='approved')` — the `+1`s count. The `rsvp_capacity` cap is compared against this sum (see §5.3 submit + §5.5 promote).
Notes: the two partial-unique indexes prevent a logged-in guest or an emailed link guest from double-RSVPing (a re-submit UPDATEs the existing row). **(A4-NEW, DECIDED) Every link guest (`user_id IS NULL`) is REQUIRED to supply BOTH `guest_email` AND `guest_phone`** — enforced at three layers: the public form (§6.5), the `submit_event_rsvp`/`public-submit-rsvp` write path (§5.3 step 2, raises `rsvp_contact_required`), and the DB `event_rsvps_link_guest_contact_required` CHECK above (last-line defense). Because email is now always present for a link guest, the `event_email_uniq` partial index always covers link guests (no more "anon without email" un-deduped rows). **App-user RSVPs (`user_id IS NOT NULL`) inherit the rule loosely:** they are NOT required to type email/phone (the column-level NULLs stay) — the notify pipeline resolves their addresses from their profile where available and always has push by `user_id` (see §5.6 + §6.5 logged-in path). Contact columns mirror `waitlist_entries`'s `email`/`phone` shape (`20260724000010_orch_0948_waitlist_feature.sql:117-127` selects `email, phone` per entry). The model is event-scoped, mirroring `board_card_rsvps`'s shape (`20260505000000_baseline_squash_orch_0729.sql:7520-7531`) but on `event_id`.

**(d) RLS on `public.event_rsvps` (RLS ENABLED).**
- **Host read (all rows for their brand's events):**
  `SELECT` USING `EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_rsvps.event_id AND public.biz_brand_effective_rank(e.brand_id, auth.uid()) >= public.biz_role_rank('event_manager'))`.
- **Host write (approve/deny/remove — UPDATE `approval_status` and/or `rsvp_status`):** same `event_manager`-rank predicate as host read (USING + WITH CHECK). **(A2 + A2-NEW)** This is the policy the `host_set_rsvp_status` RPC writes under (the RPC is `SECURITY DEFINER` but the predicate is still asserted in-RPC so RLS and the RPC agree — defense-in-depth). A host may set `approval_status` to `approved`/`denied` **from any source state** — `pending→approved`, `pending→denied`, AND **`approved→denied` (the A2-NEW host-REMOVE / un-admit transition)** — and is the only actor who may write `rsvp_status='waitlisted'` directly; ordinary guest UPDATEs may only set `rsvp_status` to `going`/`not_going` for their own row. Only the owning brand's host (`event_manager`-rank) may perform the remove (RLS USING/WITH CHECK both assert the rank; cross-brand removal is impossible).
- **Guest read own:** `SELECT` USING `user_id = auth.uid()`.
- **Guest write own (logged-in):** `INSERT`/`UPDATE` WITH CHECK `user_id = auth.uid()` AND the event is a published discoverable/linked RSVP (`EXISTS event e WHERE e.id=event_id AND e.event_type='rsvp' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL`).
- **Anon link guests** write via the `public-submit-rsvp` edge fn under **service-role** (bypasses RLS), NOT via a direct anon-key table INSERT (anon role gets NO direct table policy). This keeps the table closed to arbitrary anon writes while supporting link guests — the edge fn validates the event is a published RSVP and rate-limits.

**(e) Discover-RPC widen.** The consumer discover RPC (`20261001000000_orch_426_discover_rpc.sql:100` filters `e.event_type = 'event'`) MUST be widened to also admit opted-in RSVP rows. Change the predicate to:
```sql
AND ( e.event_type = 'event'
   OR (e.event_type = 'rsvp' AND e.rsvp_discoverable = true) )
```
Because the RPC is `CREATE OR REPLACE`, ship the full replacement function in the ORCH-1150 migration (latest definition wins per migration-chain rule). RSVP rows have no `has_paid_online` / paid-ticket concept → the `gated` CTE (`:108-112`) leaves them untouched (their `has_paid_online` resolves false). Confirm the SELECT still produces a valid `display_price_cents` for RSVP rows (RSVP = free; the converter should render no price — see §4.8). Also confirm any sibling discover function (`20260612000000_orch_426_discover_scale.sql:39`) is consistently widened or explicitly out-of-path.

**(f) Auto-promote trigger `fn_rsvp_drain_on_capacity_freed()` + `trg_rsvp_drain_on_capacity_freed` (A3 — DETERMINISTIC, DB-trigger).** Clone the PROVEN ticket-waitlist precedent `fn_waitlist_drain_on_capacity_freed()` (`20260724000010_orch_0948_waitlist_feature.sql:93-169`) — same shape: `SECURITY DEFINER`, `SET search_path=public`, `AFTER UPDATE` on the attendance source row, select oldest waiting entries `ORDER BY <waitlisted_at> ASC`, enqueue a notification with an idempotency key, flip the entry's status. **This is a DB trigger, NOT an app-side function call** — it is the safest deterministic option (it fires in the SAME transaction that freed the spot, so two concurrent "spot frees" can't double-promote past the cap; the ticket waitlist chose exactly this for the same reason). Deltas vs the precedent:
- **Trigger source = `public.event_rsvps`** (not `tickets`): `AFTER UPDATE OF rsvp_status, approval_status ON public.event_rsvps FOR EACH ROW WHEN (...)`, PLUS a second trigger path on `public.events` for the **cap-raise** case: `AFTER UPDATE OF rsvp_capacity ON public.events WHEN (NEW.rsvp_capacity IS DISTINCT FROM OLD.rsvp_capacity AND NEW.event_type='rsvp')`.
- **"Spot freed" conditions (any of):** a going+approved row flips to `not_going`/`waitlisted`; an `approval_status` flips to `denied` — **this single condition covers BOTH `pending→denied` (a normal deny) AND `approved→denied` (the A2-NEW host-REMOVE of an already-approved/Going guest), so the host-remove auto-promote reuses the SAME mechanism with NO new trigger arm** (the trigger fires `AFTER UPDATE OF rsvp_status, approval_status` and recomputes free capacity regardless of which deny path freed the spot); a row is deleted (handle via an `AFTER DELETE` arm or recompute on the same trigger family); OR `events.rsvp_capacity` is raised.
- **Promote logic:** compute `v_free := rsvp_capacity - confirmed_attending_sum` (the §4.1c capacity formula, counting `+plus_count`). While `v_free > 0`, take the OLDEST `rsvp_status='waitlisted'` row (`ORDER BY waitlisted_at ASC NULLS FIRST, created_at ASC`), and:
  - if the event is **auto** mode → set that row `rsvp_status='going'`, `promoted_at=now()`, decrement `v_free` by `(1 + plus_count)`.
  - if the event is **manual** mode → set that row `rsvp_status='going', approval_status='pending'`, `promoted_at=now()` (the host still approves), and STOP consuming free capacity for it (a pending row doesn't occupy the cap; promote the next waitlisted too if still free) — i.e. manual promotion converts waitlist→pending, not waitlist→confirmed.
  - In BOTH cases enqueue a transactional notification for the promoted guest (insert into the A4 `rsvp_notifications` queue with `template_key='rsvp_waitlist_promoted'`, idempotency key `rsvp_promote:<rsvp_id>:<events.updated_at-or-counter>` — guard double-promote via `ON CONFLICT DO NOTHING` exactly as the ticket trigger's `'waitlist_invite:'||id` key does `:148`).
- **Capacity-unlimited / cap-OFF events:** `rsvp_capacity IS NULL` → the trigger is a no-op (no "full" → nothing to drain), mirroring the precedent's early `RETURN NEW`.
- Defensive existence-check of the `rsvp_notifications` queue table so the trigger never breaks the parent UPDATE (mirror the `ORCH-0880` guard pattern and the precedent's `information_schema` nullable-check at `:86-91`).

The enqueue-then-deliver split (trigger enqueues a `pending` queue row; the `rsvp-notify` edge fn + a retry sweeper deliver it) mirrors the ticket waitlist's `fn_waitlist_drain` → `ticket_order_notifications` → `ticket-confirmation-dispatch` → `notification-retry-sweeper` chain exactly (§5.5, §5.6).

### 4.2 The new sibling wizard `RsvpCreatorWizard.tsx`

Clone `EventCreatorWizard.tsx` wholesale, then apply these deltas. The shell logic (chrome, Stepper, autosave, desktop rail, dock, discard/publish dialogs, Toast) is reused as-is EXCEPT:

**STEP_DEFS (6 entries, replaces the 7-entry array at `EventCreatorWizard.tsx:111-119`):**
```ts
const STEP_DEFS = [
  { title: "Basics",   subtitle: "Name, format, and party type" },
  { title: "When",     subtitle: "Date and time" },
  { title: "Where",    subtitle: "Venue or online link" },
  { title: "Cover",    subtitle: "Pick a cover style" },
  { title: "RSVP",     subtitle: "Capacity, plus-ones, approvals" },
  { title: "Preview",  subtitle: "How it looks to guests" },
];
```
`TOTAL_STEPS = 6`. `renderStepBody` switch (clone of `:631-673`) maps: 0→`CreatorStep1Basics`, 1→`CreatorStep2When`, 2→`CreatorStep3Where`, 3→`CreatorStep4Cover`, 4→`RsvpStep5Setup`, 5→`RsvpStep7Preview` (RSVP preview — see §4.4).

**Publish dock (`:894-922`):** remove the Stripe-block disable (`publishDisabled = publishability.status === 'blocked-stripe'` at `:609-610`). RSVP `publishDisabled = coverVideoProcessing` only. Label "Publish RSVP".

**`handlePublishTap` (`:505-529`):** replace `validatePublish(liveDraft, stripeStatus)` with `validateRsvpPublish(liveDraft)` (no stripe arg). Drop the `stripeBlocking`/`stripeNotConnected` branches entirely. On errors → open `PublishErrorsSheet` (reused). On clean → `setPublishConfirmVisible(true)`.

**`handleConfirmPublish` (`:531-587`):** keep the simulated-submit + `onPublishDraft` call. The `resolvePaidPublishGuardCopy` branch (`:560-576`) is INERT for RSVP (no paid gate) but harmless to keep; recommend dropping it for clarity. The publish RPC error surface for RSVP is `offering_date_past` only if a discoverable RSVP is past-dated — see §4.6 publish RPC; map it to a When-step jump (mirror Guard B `:572-574`).

**Publish modal copy (`:613-627`):** single-date only → static title `"Publish RSVP?"`, description `"Your invite link goes live immediately. Guests can RSVP right away. You can edit details after publishing."`. Drop the recurring/multi_date branches.

**`stripeStatus` / `payoutGateStatus` / `computePublishability` imports:** remove (RSVP has no money gate).

### 4.3 Step-component reuse table (which existing components are reused as-is vs need a variant)

| Step | Component | Verdict | Required change |
|------|-----------|---------|-----------------|
| 1 Basics | `CreatorStep1Basics` | **REUSE AS-IS** | No change. Keep Name + Format + **Party Type (required ≥1)** + Vibe Tags + Music Genre + Description. *(Steering #2 OVERRIDE: the walkthrough said drop Party Type; Seth says KEEP it. Basics for RSVP == Basics for event.)* |
| 2 When | `CreatorStep2When` | **REUSE, single-mode only** | The component renders mode tabs (single/recurring/multi_date). For RSVP, the wizard forces `whenMode:"single"` at draft creation (§4.6) and the RSVP draft MUST hide the recurring/multi_date mode switcher. Pass a NEW optional prop `lockSingleDate?: boolean` (default false; RSVP passes true) that hides the mode tabs + renders only the single-date body. *(Steering #4.)* If adding the prop is heavier than a small variant, create `RsvpStep2When.tsx` wrapping the single-date sub-body — implementor's call, but the mode tabs MUST NOT be reachable in the RSVP wizard. |
| 3 Where | `CreatorStep3Where` | **REUSE AS-IS** (validator relaxes city) | Component unchanged. The freeform-location relaxation lives in the VALIDATOR (`validateRsvpWhere`, §4.4) + the publish RPC (no `city_required`), not the component. Reword the `hideAddressUntilTicket` label only if it surfaces in this step (it lives in Settings/where-copy); for RSVP it reads "Hide address until a guest RSVPs Going". |
| 4 Cover | `CreatorStep4Cover` | **REUSE VERBATIM** | Zero change. `validateCover` returns `[]` (`draftEventValidation.ts:448-450`); RSVP keeps that. |
| 5 RSVP setup | `RsvpStep5Setup` (NEW) | **CREATE** | Replaces Tickets entirely. Full host control (§4.4 component contract). |
| 6 Settings (now folded) | — | **FOLDED into RSVP-setup + Preview** | *Decision:* the 6-step RSVP wizard does NOT carry a standalone Settings step. The settings RSVP needs (visibility, private guest list, going-count visibility, require-approval) move INTO the RSVP-setup step (§4.4), because they are few and RSVP-semantic. This drops `allowTransfers` (ticket-only, dead toggle) and the password/transfer settings. *Justification below.* |
| Preview | `RsvpStep7Preview` (NEW, clone of `CreatorStep7Preview`) | **CREATE / MODIFY** | Renders the RSVP public-page mini preview (Going/Not-going), NO StripeBlockedCard, NO money surfaces, NO `onConnectStripe`. |
| — Hub list-card / manage-sheet | shared `offering/` primitives (`OfferingManageSheet.tsx`, `EventManageMenu.tsx`) | **NEEDS `event_type='rsvp'` branch + (A2) "Guests" row** | Render "N going" (from the §4.1c confirmed-attending count) instead of revenue/tickets-sold. **(A2)** Add a "Guests" action row (clone of the "Orders" row `EventManageMenu.tsx:171-183`) that routes to `/rsvp/[id]/guests` (the approve/deny console, §5.4); show a pending-count badge when `rsvp_approval_mode='manual'` and pending>0. |

**Why 6 steps (no standalone Settings step) + discovery toggle placement.** *(Step structure CONFIRMED unchanged by the 2026-06-15 amendment — A2/A3/A4 add NO wizard step; the console + notifications are post-publish surfaces, not authoring steps. The 6 steps remain Basics → When → Where → Cover → RSVP-setup → Preview.)* The investigation's §3 table kept Settings as step 6. This SPEC folds Settings into the RSVP-setup step and drops it as a standalone, because (a) RSVP keeps only 4 settings (visibility, private guest list, hide-going-count, require-approval) and 3 of those are already part of the host-control intent of the RSVP-setup step; (b) `allowTransfers` + password are pure ticket concepts and become dead taps (Constitution #1) — dropping the step removes them cleanly; (c) fewer steps = lower Partiful-style friction. **The discovery toggle lives in the RSVP-setup step** (NOT a separate Settings step), grouped under a "Who can find this" subsection with the visibility control — this co-locates the two discoverability decisions (public/unlisted/private visibility AND show-on-discovery-feed) so the host sets reach in one place. Default `rsvp_discoverable = false` (link-only, Partiful parity, steering #1).

### 4.4 The RSVP-setup step component contract (`RsvpStep5Setup.tsx`)

Conforms to `StepBodyProps` (`types.ts:14-77`) — reuse the shared prop contract verbatim (the `editMode`/`canEditTicketPrice` props are ignored). All writes go through the passed `updateDraft` patcher.

**Sections + fields (top to bottom), with defaults and persistence:**

1. **Capacity** (steering #3 — optional cap)
   - Toggle "Limit the guest list" (default OFF). When OFF → `rsvpCapacity = null` (unlimited).
   - When ON → numeric stepper/input "Max guests" (min 1). Persists `rsvpCapacity:int`.
   - Copy when OFF: "No limit — anyone with the link can RSVP."

2. **Plus-ones** (steering #3 — +1 toggle + count)
   - Toggle "Allow guests to bring extras" (default OFF) → `rsvpAllowPlusOnes:boolean`.
   - When ON → numeric stepper "Max extra guests per person" (min 1, default 1) → `rsvpPlusOnesMax:int`.
   - Helper: "Each guest's extras count toward your limit."

3. **Waitlist** (steering #3 — waitlist-when-full) — **A3: this toggle now backs the REAL auto-promote feature.**
   - Toggle "Start a waitlist when full" (default OFF) → `rsvpWaitlistEnabled:boolean`.
   - DISABLED + greyed when Capacity is OFF (no cap → no "full"). Helper: "Add a guest limit first."
   - Helper when ON: "When a spot opens, the next person on the waitlist is automatically moved in and notified." *(A3 — no longer a passive flag; it arms `fn_rsvp_drain_on_capacity_freed`, §5.5.)*

4. **Approvals** (steering #3 — manual vs auto, host chooses) — **A2: "Approve each RSVP" now backs the REAL approve/deny console.**
   - Segmented control: **"Auto-approve"** (default) | **"Approve each RSVP"** → `rsvpApprovalMode:'auto'|'manual'`.
   - Auto helper: "Guests are in the moment they tap Going."
   - Manual helper: "You approve each guest from your Guests list. They'll see 'Awaiting host approval' until you do." *(A2 — the Guests console, §5.4, is reachable from the RSVP's manage-sheet once published.)*

5. **Who can see the guest list** (reuses existing `privateGuestList` field `draftEventStore.ts:349`)
   - Toggle "Keep the guest list private (only you see who's coming)" (default ON) → `privateGuestList:boolean`.
   - When OFF → guests see the full Going list. *(Matches walkthrough §7d default host-only.)*

6. **Going count visibility** (reuses existing `hideRemainingCount` field `draftEventStore.ts:343`, re-labeled)
   - Toggle "Hide the Going count from guests" (default OFF) → `hideRemainingCount:boolean`.

7. **Who can find this** (visibility + discovery toggle co-located)
   - Visibility pills public / unlisted / private (reuses `visibility` field) — same control as the event Settings step.
   - Toggle **"Also show this on Mingla's discovery feed"** (default OFF) → `rsvpDiscoverable:boolean`. *(Steering #1.)*
   - Helper: "Off = invite-link only (only people you share the link with). On = anyone nearby can find and RSVP."
   - When `visibility='private'`, the discoverable toggle is DISABLED + forced OFF (a private RSVP can't be on a public feed) — enforce in both the component and the publish RPC.

**`validateRsvpStep(4, draft)` returns `[]`** — no required fields (mirrors `validateCover`/`validateSettings`). The only cross-field rule (waitlist-requires-capacity, plus-max≥1-when-allowed) is UI-enforced via disabled states, not a publish blocker.

**States:** every toggle has loading=N/A (local), pressed, disabled (the two conditional disables above), and a11y label per `I-39`. No empty/error state (all defaults valid). Android glass: any new card/row uses the opaque-fallback (`Platform.select` solid fill, `overflow:'hidden'`, no Android shadow) per `ANDROID_GLASS_USES_OPAQUE_FALLBACK`.

### 4.5 The chooser fork (`UniversalCreatorSheet.tsx`)

Mirror the ORCH-1144 in-sheet experience-step pattern exactly (`:262-311`). Edits:

1. Extend the step union (`:73`): `export type UniversalCreatorStep = "root" | "experience" | "event";`
2. Change the `"event"` `ROOT_OPTIONS` entry (`:110-117`) from `route:"/event/create"` to `step:"event"` (drop the `route`, add `step:"event"`). Update its subtitle to neutral copy: `"A gathering with guests — ticketed, or RSVP-only."`
3. Add an `EVENT_OPTIONS` array (mirror `EXPERIENCE_OPTIONS` `:145-173`), two rows:
   - `{ key:"ticketed", iconName:"calendar", title:"Ticketed event", subtitle:"Sell or issue tickets — concert, party, comedy night, festival.", route:"/event/create", testID:"event-chooser-ticketed" }`
   - `{ key:"rsvp", iconName:"sparkle"|"list", title:"RSVP event", subtitle:"Guests reply Going or Not going. No tickets — like a private invite.", route:"/rsvp/create", testID:"event-chooser-rsvp" }`
   (Use a distinct icon from the experience rows; `IconName` union at `:87` already includes `list`. Add a new icon name only if a better glyph exists — otherwise reuse `list`.)
4. Add a render branch for `step==="event"` (clone the `step!=="root"` experience branch `:262-311`): heading **"Create an event"**, subtitle "Pick how guests join.", a Back affordance gated by `step==="event" && initialStep==="root"`, and the `EVENT_OPTIONS` rows reusing the `expRow` Android-opaque styles (`:402-424`).
5. Generalize `canGoBackToRoot` (`:225`): change to `const showBack = step !== "root" && initialStep === "root";` and use `showBack` in both the experience and event branches (currently `canGoBackToRoot` is experience-specific). Add a corresponding `handleEventSelect` (clone of `handleExperienceSelect` `:215-220`) — both just `pushRoute(option.route)`.
6. `handleRootSelect` (`:203-213`) is unchanged — it already checks `option.step` first, so the `"event"` row now transitions in-place instead of pushing.

**Caller-regression check (MANDATORY).** Callers pass `initialStep` (`:81-84`). The only non-default caller is Hub > Experiences passing `"experience"`. **No caller passes `"event"`** (the `+` button opens at `"root"`). Confirm by grepping `initialStep=` across `mingla-business/src` before merge: the only literal values are `"experience"` and the implicit `"root"` default. The fork is therefore additive and regresses no caller. The existing `/event/create` route is UNTOUCHED — Ticketed flows exactly as today.

### 4.6 Draft store (`draftEventStore.ts`)

**Discriminator + additive RSVP fields on `DraftEvent` (add after the Settings block ~`:354`):**
```ts
  /** ORCH-1150 — true when this draft is an RSVP event (routes to the RSVP
   *  wizard + business_publish_rsvp_draft). Absent/false = ticketed event. */
  isRsvp: boolean;
  /** ORCH-1150 — RSVP host-control (ignored when isRsvp=false). */
  rsvpCapacity: number | null;        // null = unlimited
  rsvpAllowPlusOnes: boolean;
  rsvpPlusOnesMax: number;            // 0 when not allowed
  rsvpWaitlistEnabled: boolean;
  rsvpApprovalMode: "auto" | "manual";
  rsvpDiscoverable: boolean;
```
Defaults in `DEFAULT_DRAFT_FIELDS` (`:401-451`): `isRsvp:false, rsvpCapacity:null, rsvpAllowPlusOnes:false, rsvpPlusOnesMax:0, rsvpWaitlistEnabled:false, rsvpApprovalMode:"auto", rsvpDiscoverable:false`.

**RSVP draft creation.** Add `createRsvpDraft(brandId)` to the store (clone of `createDraft` `:803-808`) that sets `isRsvp:true, whenMode:"single"`. The `/rsvp/create` route calls `useDraftEventStore.getState().createRsvpDraft(currentBrandId)` and `router.replace`s to `/rsvp/${draft.id}/edit?step=0`. (Mirrors `app/event/create.tsx:192-193`, swapping the action + route.)

**Persist version bump 11 → 12 + additive migrator (`:696-793`).** Set `version: 12`. Add a `version === 11` branch in `migrate` that maps every existing draft additively (all existing drafts are ticketed → `isRsvp:false` + the RSVP defaults):
```ts
if (version === 11) {
  const v11 = persistedState as { drafts: Array<Omit<DraftEvent,
    'isRsvp'|'rsvpCapacity'|'rsvpAllowPlusOnes'|'rsvpPlusOnesMax'|'rsvpWaitlistEnabled'|'rsvpApprovalMode'|'rsvpDiscoverable'>> };
  return { drafts: v11.drafts.map((d): DraftEvent => ({
    ...d, isRsvp:false, rsvpCapacity:null, rsvpAllowPlusOnes:false,
    rsvpPlusOnesMax:0, rsvpWaitlistEnabled:false, rsvpApprovalMode:'auto', rsvpDiscoverable:false,
  })) };
}
```
The terminal `return persistedState` (`:792`) handles version 12. No existing migrator branch changes.

**How the edit route knows which wizard to open.** The `/rsvp/[id]/edit` route resolves the draft via `useDraftById` and mounts `RsvpCreatorWizard` unconditionally (the route IS the discriminator). For the **published-edit** path, the edit route reads `event_type` off the resolved live event (the server row carries `event_type='rsvp'`) — when `event_type==='rsvp'` it mounts the RSVP edit screen / `biz_update_live_rsvp` path. Defensively, `isRsvp` on the draft is the client-side discriminator so an `/event/[id]/edit` URL pointed at an RSVP draft can redirect to `/rsvp/[id]/edit` (and vice-versa) rather than mounting the wrong wizard. Spec the edit-route guard: if `draft.isRsvp === true` and the route is the event-edit route → `router.replace('/rsvp/'+id+'/edit'...)`; the RSVP edit route does the inverse.

### 4.7 The RSVP-specific validator (`draftRsvpValidation.ts`)

Fork — do NOT reuse `validateTickets`/`validatePublish` (they block at 0 tickets `draftEventValidation.ts:454-460` and loop the Tickets step `:76-78`). Export:

```ts
export const validateRsvpStep = (step: number, draft: DraftEvent): ValidationError[] => {
  switch (step) {
    case 0: return validateBasics(draft);       // REUSE from draftEventValidation (keeps party-type gate, steering #2)
    case 1: return validateRsvpWhen(draft);     // single-mode only
    case 2: return validateRsvpWhere(draft);    // venue+address required; NO structured-city gate
    case 3: return [];                          // Cover — no rules
    case 4: return [];                          // RSVP setup — no ≥1 requirement (steering #3)
    case 5: return [];                          // Preview
    default: return [];
  }
};

export const validateRsvpPublish = (draft: DraftEvent): ValidationError[] => {
  const errors: ValidationError[] = [];
  for (let step = 0; step <= 4; step++) errors.push(...validateRsvpStep(step, draft));
  return errors;  // NO stripe/paid cross-step gate.
};
```

- **`validateBasics`** — import the EXISTING `validateBasics` from `draftEventValidation.ts` (export it). It already requires name + description + ≥1 canonical party type — exactly steering #2. Do not duplicate.
- **`validateRsvpWhen`** — clone `validateWhenSingle` (`draftEventValidation.ts:171-193`): requires `date` (no past), `doorsOpen`, `endsAt`. Drop the recurring/multi_date branches entirely (steering #4).
- **`validateRsvpWhere`** — clone `validateWhere` (`:377-420`) BUT drop the `city`-required sub-rule (`:393-402`). For in_person/hybrid require venueName + address only; freeform text is accepted (steering / walkthrough §3 Where). Keep the online-URL rule (`:404-418`) verbatim.

No `computePublishability` equivalent is needed (no Stripe state). The RSVP Preview step's "ready" state = `validateRsvpPublish(draft).length === 0`.

### 4.8 Consumer deck RSVP card (discoverable path only)

- **Supply:** the discover-RPC widen (§4.1e) already admits `event_type='rsvp' AND rsvp_discoverable=true` rows into the consumer card stream feeding `discover-cards`. No new RPC needed if the existing discover function is the supply path; confirm against the live deck source (`app-mobile/src/utils/cardConverters.ts` + `mergedDiscover.ts`). If the deck reads a separate `pg_eligible_*_for_deck` RPC (as experiences do per `project_orch_1065_consumer_experience_deck_card`), add an analogous inclusion there instead — implementor confirms the live supply path before choosing.
- **Card variant:** add an RSVP branch in the card converter (`cardConverters.ts`) that maps an RSVP row to a card with: brand badge, cover, title, date/venue, and a **Going / Not going** CTA pair — NOT a Book/checkout button. Tapping "Going" calls the same RSVP-write path as the public page (`public_submit_rsvp` / the logged-in RPC); the consumer app user is authenticated so the write uses the logged-in RLS policy (`user_id = auth.uid()`), not the anon edge fn. Render NO price (RSVP is free).
- Keep it minimal — this is gated entirely behind the host toggle; a link-only RSVP never reaches this code.

---

## 5. The publish + edit RPCs

### 5.1 `business_publish_rsvp_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer DEFAULT NULL) RETURNS jsonb`

Clone of `business_publish_event_draft` (`...orch_1075...sql:1813-2299`), `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`. Deltas:

**KEEP (verbatim from the event RPC):** auth gate (`:1870-1873`), draft-load + `FOR UPDATE` (`:1875-1879`), `event_draft_deleted` / `event_draft_not_publishable` (`:1885-1891`), permission rank (`:1893-1895`), brand load (`:1897-1905`), title-required (`:1927-1930`), slug generation (`:2022-2039`), single-date `event_dates` materialization (`:2071-2084`), the cover/description/timezone reads (`:2041-2059`), and the **party-type read + canonical validation** (`:1970-2000`, steering #2).

**REMOVE (the ticket assumptions):**
- The `event_ticket_required` empty-array gate (`:1932-1934`) — DELETE.
- The per-ticket validation loop (`:1936-1966`) — DELETE.
- The `city_required` gate (`:1986-1988`) — DELETE (steering / freeform location).
- The entire paid-publish guard block (`:2123-2157`) — DELETE the Stripe `stripe_charges_disabled` raise. KEEP an `offering_date_past` guard ONLY when `rsvp_discoverable=true` (a discoverable RSVP must be future-dated so it doesn't surface a dead card); for link-only RSVPs, skip the past-date guard (a host can share a same-day link).
- The `ticket_types` soft-delete + INSERT loop (`:2215-2269`) — DELETE. **An RSVP creates ZERO `ticket_types` rows** (`I-PROPOSED-1150-RSVP-NO-TICKET-ROWS`).
- The multi_date / recurring date branches (`:2086-2121`) — DELETE (single-date only).

**ADD:**
- INSERT/UPDATE `event_type = 'rsvp'` (the event RPC writes `event_type` at `:421` in its INSERT path; the publish UPDATE at `:2164-2209` must set `event_type='rsvp'` — confirm the draft row was created with `event_type='rsvp'`; safest is to set it explicitly in the UPDATE).
- Read + persist the RSVP host-control columns from `v_business_draft`: `rsvp_capacity`, `rsvp_allow_plus_ones`, `rsvp_plus_ones_max`, `rsvp_waitlist_enabled`, `rsvp_approval_mode` (CHECK `IN ('auto','manual')`), `rsvp_discoverable`. Enforce: if `visibility='private'` then `rsvp_discoverable := false`.
- Vibe-tags / music-genres reads stay (optional, canonical) — they're harmless and keep Basics parity.

**RETURN shape:** mirror the event RPC's `jsonb_build_object('event', to_jsonb(v_event), 'brand', {...}, 'tickets', '[]'::jsonb, 'eventDates', v_event_dates_rows, 'client_revision', ...)` — `tickets` is always the empty array.

**Raised error codes (RSVP set):** `not_authenticated`, `event_draft_not_found`, `event_draft_deleted`, `event_draft_not_publishable`, `insufficient_event_permission`, `brand_not_found`, `event_title_required`, `event_date_required`, `party_types_required`, `party_types_not_canonical`, `rsvp_approval_mode_invalid`, `offering_date_past` (discoverable + past only). **Never** raises `event_ticket_required`, `city_required`, or `stripe_charges_disabled`.

**Session flag:** if the `biz_prevent_event_slug_change` trigger (ORCH-0763) gates the draft→scheduled slug finalization (the trip RPC sets both `mingla.business_publish_trip_draft` AND `mingla.business_publish_event_draft` flags for this reason — `...orch_1075...sql:2621`), `business_publish_rsvp_draft` MUST `PERFORM set_config('mingla.business_publish_event_draft','on',true)` (and/or a new `mingla.business_publish_rsvp_draft` flag if the trigger is extended) so the slug write is permitted. Implementor verifies the trigger's accepted flags before merge.

**Service caller (`rsvpEvents.ts`):** clone `publishBusinessEventDraft` (`businessEvents.ts:672-705`) → `publishRsvpDraft`, calling `supabase.rpc("business_publish_rsvp_draft", {...})`, building `p_draft_payload` via `draftToServerUpdate(draft,{})` (the `business_draft` JSONB must carry the new `rsvp*` keys — extend `draftToServerUpdate` to pass them through, or pass them explicitly). Keep the `mingla_event_published` AppsFlyer event (or a `mingla_rsvp_published` variant).

### 5.2 `biz_update_live_rsvp(p_event_id uuid, p_payload jsonb, p_reason text) RETURNS jsonb`

Mirror `biz_update_live_experience` (`...orch_1075...sql:1318-1336+`). Deltas:
- Gate: `IF v_existing.event_type <> 'rsvp' THEN RAISE EXCEPTION 'event_not_an_rsvp' USING HINT='biz_update_live_rsvp only handles event_type=rsvp rows.';` (mirror `:1328-1331`).
- Status gate: `status IN ('scheduled','live')` (mirror `:1333-1337`) — draft edits never route here.
- Permission rank `>= event_manager` (mirror `:1339-1342`).
- Patch the same offering fields (title/description/cover/when single-date/where/visibility) + the RSVP host-control columns. **No refund gate, no sold-ticket diff** — replace the experience's `biz_experience_sold_count`/refund context (`:1353-1354`) with an RSVP `going` count for the change-notice copy (see §6).
- **(A4) Material-change detection + notify-enqueue.** When the UPDATE changes a guest-facing field — **date/time, venue/address, or cancellation** (NOT cover-only or description-only typo fixes; the implementor defines the "material" field set, recommend: `event_dates.starts_at`, `location_text`/venue, `status→cancelled`) — the RPC enqueues an `rsvp_notifications` row per GOING+APPROVED guest with `template_key='rsvp_event_updated'` and a payload carrying the changed field summary, idempotency key `rsvp_update:<event_id>:<events.updated_at>` so re-saving the same edit doesn't double-notify. The `rsvp-notify` edge fn (§5.6) then fans out push+SMS+email. **Capacity raise** is handled separately by the §4.1f trigger (it drains the waitlist + notifies the promoted guest, not all guests).
- Returns `{ ok, ... , going_count, notified_count }`. No `intake_changed_tier_ids` / ticket machinery.

### 5.3 `public_submit_rsvp` (guest write — anon-capable)

**Edge function** `supabase/functions/public-submit-rsvp/index.ts`, `verify_jwt = false` (config.toml — mirror `discover-merged-events` `:21-22`). Runs under service-role; validates input; calls a `SECURITY DEFINER` RPC `public.submit_event_rsvp(...)` (or does the insert directly with service-role + explicit WHERE guards as defense-in-depth, mirroring the discover fn's pattern).

Request: `{ eventId, guestName, guestEmail?, guestPhone?, rsvpStatus:'going'|'not_going', plusCount? }` + (when present) the caller's JWT for the logged-in path. **(A4-NEW — DECIDED, Seth 2026-06-15):** for an anon link guest (no JWT / no app account) `guestName` AND `guestEmail` AND `guestPhone` are ALL REQUIRED — the host's "they'll be notified" promise must hold across both email and SMS, so both contact addresses are mandatory at the link-guest write path. A logged-in app-user supplies none of email/phone (name from profile; notify resolves push + profile email + profile phone by `user_id`, §5.6).
Server logic (AMENDED for A3 full waitlist + A4 contact capture):
1. Load event; reject if not `event_type='rsvp'`, not `status IN ('scheduled','live')`, or `deleted_at` set → `404 rsvp_not_open`.
2. **(A4-NEW)** Validate contact: anon path (no JWT) MUST have `guestName` non-empty AND `guestEmail` valid AND `guestPhone` present → else `400 rsvp_contact_required` (the inline form blocks before this, §6.5; the edge fn is the second line of defense, and the DB `event_rsvps_link_guest_contact_required` CHECK is the third). Normalize `guestPhone` to E.164 (reject malformed → `400 rsvp_phone_invalid`). The logged-in path (JWT present, `user_id` resolved) skips this required-contact gate.
3. Clamp `plusCount` to `[0, rsvp_plus_ones_max]` (0 when plus-ones disallowed).
4. **Resolve approval + attendance per the §4.1c precedence rules:**
   - `approval_status := (rsvp_approval_mode='manual') ? 'pending' : 'approved'`.
   - Compute `confirmed := SUM(1+plus_count) FILTER (rsvp_status='going' AND approval_status='approved')` for the event (FOR UPDATE on the event row to serialize concurrent submits — mirror the ticket checkout's capacity lock).
   - **If `rsvpStatus='not_going'`** → write the row `rsvp_status='not_going'` (this may free a spot → the trigger §4.1f fires).
   - **If `rsvpStatus='going'` AND `rsvp_capacity IS NULL`** (no cap) → `rsvp_status='going'` (approval as above).
   - **If `rsvpStatus='going'` AND would exceed cap** (`confirmed + 1 + plusCount > rsvp_capacity`):
     - **manual mode** → still write `rsvp_status='going', approval_status='pending'` (pending doesn't occupy the cap; the host's approve will be gated on capacity, §5.4). Response signals `pending`.
     - **auto mode + `rsvp_waitlist_enabled`** → write `rsvp_status='waitlisted', approval_status='approved', waitlisted_at=now()`. Response signals `waitlisted`. *(A3 — a REAL status now, not a client-only flag.)*
     - **auto mode + waitlist OFF** → reject `409 rsvp_full`. (No row written, or write `not_going`-equivalent? — write nothing; client shows "Event full".)
   - **Else (`going` fits)** → `rsvp_status='going'`, approval as above.
5. UPSERT on `(event_id, user_id)` (logged-in) or `(event_id, lower(guest_email))` (anon w/ email); else INSERT. A re-submit that flips `going→not_going` frees capacity (trigger §4.1f drains the waitlist).
6. Rate-limit anon writes (per-IP, basic) to prevent guest-list spam.
Response: `{ status:'going'|'not_going'|'waitlisted', approvalStatus:'pending'|'approved', capacityFull?:boolean }`.

**Public-route allowlist (honor `anon_buyer_routes_must_be_allowlisted_against_root_auth_gate`).** The `/e/{brandSlug}/{eventSlug}` route is ALREADY in the `PUBLIC_BUYER_ROUTE_PREFIXES` allowlist (it's the event public page). RSVP reuses the SAME `/e/` route — no new prefix needed. Confirm the RSVP write itself (the edge-fn call) needs no auth-gated route; it's a fetch from the public page, not a navigation. If any NEW public route is introduced (it should not be — RSVP renders on `/e/`), it MUST be added to the allowlist. **The A2 `/rsvp/[id]/guests` host console route is a LOGGED-IN business-app route — it is NOT a public buyer route and MUST NOT be added to the anon allowlist.**

### 5.4 Host approve/deny console (A2) — `host_set_rsvp_status` RPC + `RsvpGuestConsole.tsx`

**RPC `host_set_rsvp_status(p_rsvp_id uuid, p_status text) RETURNS jsonb`** — `SECURITY DEFINER`, `SET search_path TO 'public','pg_temp'`. `p_status IN ('approved','denied')` (CHECK; else `rsvp_status_invalid`). Logic:
1. Load the `event_rsvps` row + its event (`JOIN events`); `FOR UPDATE` on the rsvp row + the event row.
2. **Auth/RLS:** assert `biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank('event_manager')` (same predicate as the host-read RLS §4.1d) → else `insufficient_event_permission`. Reject if `e.event_type<>'rsvp'` → `event_not_an_rsvp`.
3. **State machine (A2 + A2-NEW host-remove — DECIDED, Seth 2026-06-15):** allowed transitions:
   - `pending → approved` (admit) — capacity-gated, step 4.
   - `pending → denied` (decline a not-yet-admitted guest).
   - **`approved → denied` (the A2-NEW host-REMOVE / un-admit of an already-approved or Going guest)** — always allowed; this is the "remove guest" action. We REUSE `approval_status='denied'` as the terminal removed-state (NO distinct `'removed'` value) precisely so the existing §4.1f `fn_rsvp_drain_on_capacity_freed` trigger — which already treats a flip to `denied` as a spot-freeing event — auto-promotes the oldest waitlisted guest with ZERO new trigger code (see §4.1f). Re-applying the current status is idempotent (no-op, return current). A `denied → *` source (already-removed) is idempotent on `denied` and rejected otherwise → `rsvp_already_removed`.
   - The RPC reads the source `approval_status` to pick the right notification template (step 6) and to know whether the deny frees an occupied spot.
4. **Capacity gate on approve (manual+cap precedence, §4.1c rule 2):** if `p_status='approved'` and `rsvp_capacity IS NOT NULL` and `confirmed + 1 + plus_count > rsvp_capacity` → reject `rsvp_capacity_full` (host must raise the cap or deny/remove others). On success set `approval_status='approved'`. (Deny/remove is never capacity-gated.)
5. **On `denied`** → set `approval_status='denied'`. (a) The removed/denied guest **no longer counts toward capacity** — the §4.1c precedence rule already excludes `denied` rows from the confirmed-attending sum, so the cap immediately reflects the freed seat. (b) If the source state was `approved` (a host-remove of an occupying guest) — OR a `pending` deny that had been provisionally counted — the flip to `denied` fires the §4.1f trigger, which **auto-promotes the OLDEST waitlisted guest** into the freed seat(s) (auto→going, manual→going+pending) and notifies them (§5.5). `rsvp_status` is left at its last-known value (the row is treated as not-attending purely via `approval_status='denied'`).
6. **(A4) Enqueue guest notification:** insert an `rsvp_notifications` row for THIS guest. Template selection: `pending→approved` → `rsvp_approved`; `pending→denied` → `rsvp_denied`; **`approved→denied` (host-remove) → `rsvp_removed`** (distinct copy: "the host has removed you from this event" — see §5.6). Idempotency key `rsvp_approval:<rsvp_id>:<source_state>:<p_status>` (includes the source state so an approve-then-remove on the same row enqueues two distinct notifications, not a collision). The `rsvp-notify` edge fn (§5.6) fans out.
7. Returns `{ ok, rsvpId, approvalStatus, wasRemoved:boolean, pendingCountRemaining, goingCountRemaining }` (`wasRemoved=true` when the transition was `approved→denied`).

A **bulk-approve** companion `host_bulk_approve_rsvps(p_event_id uuid) RETURNS jsonb` approves all `pending` rows up to remaining capacity (oldest `created_at` first), enqueues one `rsvp_approved` notification each, returns `{ approvedCount, skippedForCapacity }`.

**Service + hook.** `rsvpApprovals.ts.setRsvpStatus(rsvpId, status)` → `supabase.rpc('host_set_rsvp_status', …)` — this SINGLE caller serves Approve (`'approved'`), Deny (`'denied'` from pending) AND **Remove (`'denied'` from approved, A2-NEW)**; no separate remove RPC/service is added (the transition is disambiguated server-side by the source state). `listRsvpGuests(eventId)` → a host-scoped SELECT (RLS host-read) ordered pending-first then going then waitlisted. `useRsvpApprovals.ts`: `useRsvpGuestList(eventId)` (React Query key `['rsvp-guests', eventId]`) + `useSetRsvpStatus()` mutation invalidating `['rsvp-guests', eventId]` AND the offering going-count key on success (optimistic remove-from-section acceptable; on a Remove, the promoted waitlist guest only appears after the invalidated refetch). Clone the mutation shape from an existing business mutation hook (e.g. `useBusinessEvents.ts` publish hook) so error contract + toast match.

**Component `RsvpGuestConsole.tsx`** (business iOS/Android, opened from the manage-sheet "Guests" row). A list screen — NOT a sheet (a pending list can be long; full-screen is the right affordance), cloning the row/list visuals from the event detail screens (`EventDetailActivityRow.tsx` row shape) + the action-button pattern. States (ALL required, Constitution #1 no dead taps):
- **loading** → skeleton rows.
- **empty (no pending, manual mode)** → "No one's waiting on approval. {N} going." (still shows the going list below).
- **empty (auto mode)** → console still lists going + waitlisted guests, no Approve/Deny actions (auto = nothing to approve); copy "Everyone who taps Going is in automatically."
- **list (pending exist)** → a "Pending ({N})" section: each row = guest name + contact (email/phone, masked-ish) + `+N` plus-count chip + **Approve** (filled) / **Deny** (ghost) buttons. A sticky **"Approve all ({N})"** bulk button at top (calls `host_bulk_approve_rsvps`).
- **going section** → "Going ({M})" rows. **(A2-NEW — DECIDED)** each Going row carries a **Remove** action (a ghost/destructive trailing button or row-overflow item) that calls `host_set_rsvp_status(rsvpId, 'denied')` (the `approved→denied` transition, §5.4). Tapping Remove opens a **confirm dialog** — title "Remove {name}?", body "They'll be moved out of this event and notified. If you have a waitlist, the next person is moved in automatically.", actions **Remove** (destructive) / **Cancel** — and only on confirm fires the mutation (Constitution #1: the action must truly work, not a no-op). On success the row leaves the Going section, the going count drops, and (if a waitlist exists) a promoted guest appears.
- **waitlisted section** → "Waitlist ({W})" read-only rows in `waitlisted_at` order.
- **error** → toast "Couldn't load guests. Tap to retry." (never a dead end). Per-row Approve/Deny/**Remove** failure → toast "Couldn't update {name}. Try again." and the row stays in its prior section (no optimistic-stick on error).
- Android glass: console cards/rows use the opaque fallback (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`).
- a11y labels on every Approve/Deny/**Remove**/Approve-all control (`I-39`).

### 5.5 Waitlist auto-promote (A3)

The mechanism is the §4.1f DB trigger `fn_rsvp_drain_on_capacity_freed` — DETERMINISTIC and in-transaction (chosen over an app-side function for the exact concurrency-safety reason the ticket waitlist chose it: `20260724000010_orch_0948_waitlist_feature.sql:93-169`). Recap of the guest-facing behavior the trigger guarantees:
- A spot opens (going→not_going, a `denied` — including the **A2-NEW host-REMOVE of an already-approved/Going guest (`approved→denied`)**, a deletion, OR a `rsvp_capacity` raise) → the OLDEST `waitlisted` guest (by `waitlisted_at ASC`) auto-promotes. The host-remove path reuses the identical drain mechanism as a normal deny — no parallel promote logic (§4.1f / §5.4 step 5).
- **auto mode** → promoted straight to `going` (confirmed). **manual mode** → promoted to `going`+`pending` (host still approves from the §5.4 console).
- The promoted guest is notified (`template_key='rsvp_waitlist_promoted'`) via §5.6.
- Promotion never exceeds the cap (in-transaction free-capacity recompute counting `+plus_count`).
- Idempotent: `ON CONFLICT (idempotency_key) DO NOTHING` on the enqueue (mirror `:148`) prevents double-notify if two frees race.

No app-side polling, no cron for the promote itself (the trigger is synchronous); only the *delivery* of the enqueued notification is async (edge fn + retry sweeper, §5.6).

### 5.6 RSVP notification pipeline — push + SMS + email (A4)

**Queue table `public.rsvp_notifications`** (clone the `ticket_order_notifications` shape — `20260724000010_orch_0948_waitlist_feature.sql:86-91` references its columns; the canonical columns are `id, event_id, rsvp_id NULL, channel, recipient, status, payload jsonb, idempotency_key UNIQUE, attempt_count, provider, provider_message_id, last_error, sent_at, created_at, updated_at`). `channel IN ('push','sms','email')`. `status` machine `pending → sending → sent | failed_retryable | failed_terminal | skipped` (identical to the ticket queue). RLS: service-role only (no client policy). A producer (the publish-edit RPC §5.2, the approve/deny RPC §5.4, the auto-promote trigger §4.1f) enqueues ONE row per guest per channel-they-can-receive, or one row per guest with the edge fn fanning channels — **recommend one row per (guest, trigger)** with the edge fn deciding channels by available contact, mirroring how `notify-dispatch` takes one call and does push+email internally (`notify-dispatch/index.ts:360-563`).

**Edge fn `rsvp-notify`** (`supabase/functions/rsvp-notify/index.ts`, `verify_jwt=true`, service-role-invoked). Given a queue row (or `{ eventId, rsvpId, templateKey }`), it:
1. Resolves the guest (`event_rsvps` row → `user_id`, `guest_email`, `guest_phone`, `guest_name`) + the event (title, date, venue, brand).
2. Resolves the message copy by `templateKey` (table below).
3. **Fans out across EVERY channel for which the guest has a usable address/token, EACH independently, NON-BLOCKING (Constitution #3).** **(A4-NEW-2 — DECIDED, Seth 2026-06-15):** the rule is **notify across ALL channels the guest can receive on — NOT push-only for app users.** Resolve each channel's address and attempt it if present:
   - **push** — if `user_id IS NOT NULL` (an app-user guest): call `sendPush` from `_shared/push-utils.ts:95` with `app:"consumer"` (RSVP guests are consumer-app users; `resolveOneSignalApp` returns consumer for a non-`business.`/`stripe.` type — keep the type prefix neutral, e.g. `rsvp_*`). Also write an in-app `notifications` row (reuse `notify-dispatch` OR insert directly) so the guest's inbox reflects it.
   - **email** — attempt if an email address is resolvable: `guest_email` (always present for a link guest, §4.1c) OR, **for an app-user guest, the guest's verified profile/auth email** resolved server-side in the edge fn (look up `auth.users`/`auth.identities` by `user_id` per the verified-identity rule in `project_orch_1111_1112_invite_surface_ari_reachable`; never `user_metadata`). Clone the Resend send from `notify-dispatch/index.ts:84-138` (`sendResendBrandedEmail`, env `RESEND_API_KEY`, `EMAIL_SENDERS.system`, `assertNotResendSandbox` — NO `@resend.dev` fallback). **Do NOT write a new Resend client.**
   - **SMS** — attempt if a phone is resolvable: `guest_phone` (always present for a link guest, §4.1c) OR, for an app-user guest, a phone on their profile if one exists. Clone `sendTwilioMessage` from `ticket-confirmation-dispatch/index.ts:123-170` (env `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_MESSAGING_SERVICE_SID`; optional `TWILIO_STATUS_CALLBACK_SECRET` → the existing `twilio-message-status` callback). **Do NOT write a new Twilio client.**
   - **Resulting matrix:** an **app-user guest** gets **push AND email (AND SMS if a phone is on file)** — every channel they have a usable address/token for (A4-NEW-2), not push-only. A **link guest** gets **email AND SMS** (both always available — the form now requires both, §6.5 / §4.1c), plus push only if they later become an app user with a matched `user_id`. The explicit rule the implementor codes: *for each of {push, email, sms}, resolve the address/token; if present, attempt that channel; otherwise skip it.* No channel is suppressed when an address exists.
4. **Per-channel failure is logged + isolated** — one channel throwing/returning false MUST NOT abort the others (each in its own try/catch; collect `{push:ok, sms:ok, email:ok}`). Mirror `notify-dispatch`'s pattern: push failure is caught and warned (`:551-555`), email failure is caught and warned (`:381-383`) — neither blocks the other. Mark the queue row `sent` if ≥1 channel succeeded; `failed_retryable` if all available channels failed transiently; `failed_terminal` on a permanent failure (bad number/address). Log every per-channel outcome.
5. **Idempotency:** the queue `idempotency_key` (UNIQUE) is set by the producer (`rsvp_update:…`, `rsvp_approval:…`, `rsvp_promote:…`); a re-invocation of `rsvp-notify` for an already-`sent` row no-ops.
6. **Retry:** reuse the existing `notification-retry-sweeper` pattern (`supabase/functions/notification-retry-sweeper/index.ts`) — either extend it to also sweep `rsvp_notifications` (`status IN ('failed_retryable','pending')` older than N min) or add an analogous pg_cron sweeper. Implementor confirms whether to extend or fork.

**Message copy per trigger per channel** (kept short; the email uses the branded `generic_notification` shell):

| templateKey | Trigger | Push title / body | SMS body | Email subject / body |
|---|---|---|---|---|
| `rsvp_event_updated` | Host edits date/time/venue (§5.2) | "Plans changed: {event}" / "{what changed} — tap for details." | "{Brand}: {event} updated — {what changed}. {link}" | "{event} — updated details" / "The host updated {event}. {what changed}. See the latest: {link}" |
| `rsvp_waitlist_promoted` | Auto-promote (§5.5) | "You're in! {event}" / "A spot opened — you're going. 🎉" | "{Brand}: a spot opened at {event} — you're in! {link}" | "You're off the waitlist for {event}" / "Good news — a spot opened and you're now going to {event}. {link}" |
| `rsvp_approved` | Host approves (§5.4, manual) | "You're approved: {event}" / "The host approved your RSVP — see you there." | "{Brand}: you're approved for {event}! {link}" | "You're approved for {event}" / "The host approved your RSVP. {link}" |
| `rsvp_denied` | Host denies a PENDING guest (§5.4, manual) | "RSVP update: {event}" / "The host couldn't fit your RSVP this time." | "{Brand}: the host couldn't fit your RSVP for {event}." | "About your RSVP to {event}" / "Unfortunately the host couldn't confirm your RSVP for {event} this time." |
| `rsvp_removed` | Host REMOVES an already-approved/Going guest (§5.4, A2-NEW `approved→denied`) | "Update: {event}" / "The host has removed you from this event." | "{Brand}: the host has removed you from {event}." | "About your RSVP to {event}" / "The host has removed you from {event}. If you think this was a mistake, reach out to them." |

(Copy is illustrative-to-spec; the implementor finalizes exact strings within these bounds. No emoji in SMS if it risks GSM-7 segmentation cost concerns — implementor's call.)

---

## 6. The public RSVP page + write path (`PublicEventPage.tsx`)

The public page already mounts for `/e/{brandSlug}/{eventSlug}` and resolves the offering via `resolveOfferingCta` keyed off `tickets` (`:261-269`). For an `event_type='rsvp'` row (zero tickets), branch:

1. **CTA machine.** Add `resolveRsvpCta` to `@mingla/event-rendering` (or an `event_type==='rsvp'` branch in `resolveOfferingCta`) returning an RSVP CTA descriptor: `{ kind:'rsvp', state:'open'|'full'|'waitlist'|'pending'|'going'|'not_going' }`. The floating bar + inline action render **Going / Not going** buttons instead of buy/free.
2. **Replace checkout navigation.** The three `router.push(checkoutPublicPath(event.id))` sites (`:291,329,340`) become, for RSVP: call the RSVP write (`public_submit_rsvp` edge fn for anon/web; the logged-in RPC for the consumer app). NO navigation to `/checkout`.
3. **+1 input.** When `rsvp_allow_plus_ones`, render a stepper "Bringing extras? +N" (max `rsvp_plus_ones_max`) next to Going. Passes `plusCount` to the write.
4. **States (per write response / event state) — AMENDED for A3 real waitlist:**
   - `open` → Going / Not going active.
   - `full` (capacity hit, waitlist OFF, auto mode) → "Event full" + disabled Going (Not-going still allowed).
   - `waitlist` (capacity hit, waitlist ON) → tapping Going writes a REAL `rsvp_status='waitlisted'` row (§5.3) → on success "You're on the waitlist — we'll text/email you if a spot opens." (A3: this is a real promotable status, not a client-only flag.)
   - `pending` (manual approval, guest already RSVP'd) → "Awaiting host approval." (A2: the host admits from the Guests console; the guest is notified on approve/deny.)
   - `going` / `not_going` (guest's own current state, when resolvable) → reflect + allow flip. Flipping going→not_going frees a spot (may auto-promote a waitlisted guest, §5.5).
   - Not-bookable / errors → toast (never a dead-end; mirror the existing `showToast` guard at `:285-290`).
5. **(A4-NEW — DECIDED) Guest identity + contact capture.** A lightweight inline field set (NOT a full account), shown before/at the Going tap:
   - **Anon link guest:** **Name (required)** + **Email (required)** + **Phone (required — A4-NEW; both contact methods are mandatory so the host can always reach the guest by email AND SMS)**. All three are blocking — the Going button is disabled until name + a valid email + a valid phone are entered. A `400 rsvp_contact_required` from the edge fn surfaces inline ("Add your name, email, and phone to RSVP"); a `400 rsvp_phone_invalid` surfaces inline on the phone field ("Enter a valid phone number"). Validate email + phone format client-side before submit. Per-field validation states: empty-required (inline "Required"), invalid-format (inline message), valid (no message).
   - **Logged-in consumer-app user:** skip the name/email/phone entry entirely (profile supplies them; notify resolves push + profile email + profile phone by `user_id`, §5.6 — the link-guest both-required rule does NOT apply to app users). Optionally surface a one-tap "add a phone for texts" affordance if no profile phone is on file, but it is NOT blocking.
   - Transactional-basis microcopy near the field set: "We'll only use this to update you about this event." (transactional, not marketing — no consent checkbox; §2 non-goal.)
   - The fields pass `guestName`/`guestEmail`/`guestPhone` to `public_submit_rsvp` (§5.3).
6. **Host-side guest list.** The page (host view) / Hub shows "N going" (+ pending count when manual). **(A2)** The full approve/deny console SHIPS in v1 — reachable from the RSVP manage-sheet "Guests" row → `/rsvp/[id]/guests` (§5.4). **(A2-NEW)** From the same console the host can **Remove** an already-approved/Going guest (per-row Remove → confirm → `host_set_rsvp_status(..,'denied')`), which frees a spot, auto-promotes the oldest waitlisted guest, and notifies the removed guest (`rsvp_removed`). (No longer a follow-on.)

This is **buyer-web** (the `/e/` public page) AND, for the discoverable path, the **consumer-app card** (§4.8) which reuses the same write.

---

## 7. Test Cases

| # | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| T1 | Chooser fork | Open `+` → "Create event" | In-sheet `step:"event"` with Ticketed + RSVP rows; Back returns to root | Component |
| T2 | Ticketed untouched | Tap "Ticketed event" | Pushes `/event/create`; existing 7-step wizard mounts unchanged | Integration |
| T3 | RSVP create entry | Tap "RSVP event" | Pushes `/rsvp/create` → mints `isRsvp:true` draft → `/rsvp/{id}/edit?step=0` | Integration |
| T4 | RSVP wizard has 6 steps | Mount `RsvpCreatorWizard` | Stepper shows Basics/When/Where/Cover/RSVP/Preview; no Tickets step | Component |
| T5 | Party type still required (steering #2) | RSVP Basics with 0 party types → Continue | Blocks with "Pick at least one party type" | Validator |
| T6 | RSVP When single-only (steering #4) | RSVP When step | No recurring/multi_date tabs reachable | Component |
| T7 | Freeform location allowed | in_person, address typed not Places-picked (`city=null`) → Publish | Publishes (NO `city_required`) | RPC |
| T8 | RSVP-setup returns [] | RSVP setup with all toggles default → Continue | Advances (no required fields) | Validator |
| T9 | Publish creates zero tickets | Publish a valid RSVP | `events.event_type='rsvp'`; `SELECT count(*) FROM ticket_types WHERE event_id=… AND deleted_at IS NULL` = 0 | RPC/DB |
| T10 | No stripe gate | Publish RSVP on a brand with `stripe_charges_enabled=false` | Publishes (no `stripe_charges_disabled`) | RPC |
| T11 | Discoverable OFF → off deck | Publish link-only RSVP | Not returned by discover RPC | RPC/DB |
| T12 | Discoverable ON → on deck | Publish `rsvp_discoverable=true` RSVP in a deck city | Returned by discover RPC with no price; card shows Going/Not-going | RPC/DB + Component |
| T13 | Private forces non-discoverable | `visibility='private'` + discoverable ON | Publish persists `rsvp_discoverable=false` | RPC |
| T14 | Anon guest Going | Logged-out, valid event, name set → Going | `event_rsvps` row `rsvp_status='going'`, `approval_status='approved'` (auto mode) | Edge/DB |
| T15 | Manual approval | Auto=manual, anon Going | Row `approval_status='pending'`; page shows "Awaiting host approval" | Edge/DB + Web |
| T16 | Capacity full | cap=2, 2 going, waitlist OFF, 3rd Going | `409 rsvp_full`; "Event full" | Edge/Web |
| T17 | Plus-ones clamp | `rsvp_plus_ones_max=2`, guest sends `plusCount=5` | Persisted `plus_count=2` | Edge/DB |
| T18 | RLS host read | Host queries `event_rsvps` for own brand event | Sees all rows; other brand sees none | RLS |
| T19 | RLS guest read own | Logged-in guest queries | Sees only own row | RLS |
| T20 | Edit-published RSVP | `biz_update_live_rsvp` on a `rsvp` row | Patches; on an `event` row → `event_not_an_rsvp` | RPC |
| T21 | Wrong-wizard redirect | `/event/{id}/edit` for an `isRsvp` draft | Redirects to `/rsvp/{id}/edit` | Route |
| T22 | Persist migrate 11→12 | Hydrate v11 store | All drafts gain `isRsvp:false` + RSVP defaults; no data loss | Store |
| T23 | No checkout from RSVP page | RSVP `/e/` page, tap Going | Calls RSVP write; never navigates to `/checkout` | Web |
| T24 | (A4-NEW) Both email AND phone required for link guest | Anon Going with email but no phone (and vice-versa) | `400 rsvp_contact_required`; Going disabled until name+email+phone all valid; DB CHECK `event_rsvps_link_guest_contact_required` rejects a direct insert missing either | Edge/Web/DB |
| T25 | (A2) Manual mode → pending console | Manual RSVP, 3 anon Going | All `approval_status='pending'`; Guests console "Pending (3)" with Approve/Deny per row | Edge/DB + Component |
| T26 | (A2) Approve admits + notifies | Host taps Approve on a pending row | `host_set_rsvp_status` → `approved`; `rsvp_notifications` row `template_key='rsvp_approved'` enqueued; pending count drops | RPC/DB |
| T27 | (A2) Deny notifies | Host taps Deny | Row `approval_status='denied'`; `rsvp_denied` enqueued; row leaves pending | RPC/DB |
| T28 | (A2) Approve capacity gate | manual, cap=2, 2 approved, approve a 3rd pending | `rsvp_capacity_full`; row stays pending | RPC |
| T29 | (A2) Bulk approve | 5 pending, cap=3 (0 used) | `host_bulk_approve_rsvps` approves 3 oldest, `skippedForCapacity=2` | RPC |
| T30 | (A2) RLS console | Brand B host opens Brand A's RSVP guests | No rows (host-read RLS) / `insufficient_event_permission` on set | RLS |
| T31 | (A3) Auto-waitlist on full | auto mode, cap=2 full, waitlist ON, 3rd Going | Row `rsvp_status='waitlisted'`, `waitlisted_at` set; page "You're on the waitlist" | Edge/DB + Web |
| T32 | (A3) Auto-promote oldest | one going flips not_going (frees 1) | OLDEST waitlisted row → `going` (auto) / `going`+`pending` (manual); `promoted_at` set; `rsvp_waitlist_promoted` enqueued | Trigger/DB |
| T33 | (A3) Promote on cap raise | cap 2→4 with 2 waitlisted | Both promote (within new free cap); each notified | Trigger/DB |
| T34 | (A3) Plus-count toward cap | cap=4, guest A going +2 (=3), guest B going +1 (=2) | B exceeds → waitlisted/full per mode | Edge/DB |
| T35 | (A3) No double-promote on race | two frees in one tx | `ON CONFLICT` idempotency → exactly one promote-notify per promoted guest | Trigger/DB |
| T36 | (A4) Three-channel fan-out | guest with email+phone+app, fire `rsvp_event_updated` | push (OneSignal) + SMS (Twilio) + email (Resend) all attempted; queue `sent` | Edge |
| T37 | (A4) Per-channel non-blocking | Twilio mocked to 500, email OK | email sends, queue `sent` (≥1 channel), Twilio failure logged not thrown (Constitution #3) | Edge |
| T38 | (A4) Link guest email+SMS | anon guest (email+phone, no app) fire a notify | email AND SMS both sent; no push attempted (no `user_id`); no crash | Edge |
| T39 | (A4) Idempotent re-save | save same edit twice | one `rsvp_notifications` row per guest (idempotency_key collision) | RPC/DB |
| T40 | (A2-NEW) Host removes an approved guest | manual/auto, cap=2 full (2 approved), host taps Remove on one Going row → confirm | that row `approval_status='denied'`; going count drops to 1; the seat is freed (no longer counts toward cap); `rsvp_notifications` row `template_key='rsvp_removed'` enqueued | RPC/DB |
| T41 | (A2-NEW) Remove fires auto-promote | cap=2 full + 1 waitlisted; host removes one approved Going guest | the §4.1f trigger fires on `approved→denied`; OLDEST waitlisted guest → `going` (auto) / `going`+`pending` (manual), `promoted_at` set, `rsvp_waitlist_promoted` enqueued; same mechanism as a deny (no parallel path) | Trigger/DB |
| T42 | (A2-NEW) RLS on remove | Brand B host calls `host_set_rsvp_status` on Brand A's approved rsvp | `insufficient_event_permission`; no state change | RLS/RPC |
| T43 | (A4-NEW-2) App-user multi-channel | app-user guest WITH a profile email + profile phone, fire `rsvp_event_updated` | push AND email AND SMS all attempted (every channel the guest has an address/token for); NOT push-only; queue `sent` | Edge |
| T44 | (A4-NEW-2) App-user push+email, no phone | app-user guest, profile email present, no phone | push AND email attempted; SMS skipped (no phone); queue `sent` | Edge |

---

## 8. Implementation Order

1. **DB migration** — CHECK widen + `events` RSVP columns + `event_rsvps` table (two-dimension status + contact + waitlist columns) + RLS + `rsvp_notifications` queue + discover-RPC widen + `business_publish_rsvp_draft` + `biz_update_live_rsvp` (with notify-enqueue) + `host_set_rsvp_status` + `host_bulk_approve_rsvps` + `submit_event_rsvp` + `fn_rsvp_drain_on_capacity_freed` trigger (apply via Management API per `reference_supabase_db_write_paths` if CLI drift-wedged; deploy from MERGED main).
2. **Edge fns** — `public-submit-rsvp` (`verify_jwt=false`, contact capture + full-waitlist logic) + **`rsvp-notify`** (`verify_jwt=true`, push+SMS+email fan-out reusing the three existing clients); config.toml both.
3. **Draft store** — additive fields, `createRsvpDraft`, version 12 migrator.
4. **Validator** — `draftRsvpValidation.ts`; export `validateBasics` from `draftEventValidation.ts`.
5. **Services + hooks** — `rsvpEvents.ts` (`publishRsvpDraft`, `updateLiveRsvp`) + `useRsvpEvents.ts`; **`rsvpApprovals.ts` + `useRsvpApprovals.ts`** (A2 console data layer).
6. **Wizard** — `RsvpCreatorWizard.tsx`, `RsvpStep5Setup.tsx`, `RsvpStep7Preview.tsx`; `lockSingleDate` prop on `CreatorStep2When`; routes `/rsvp/create` + `/rsvp/[id]/edit`.
7. **Chooser fork** — `UniversalCreatorSheet.tsx` `step:"event"`.
8. **(A2) Host console** — `RsvpGuestConsole.tsx` + `/rsvp/[id]/guests` route + the "Guests" manage-sheet row (`OfferingManageSheet.tsx`/`EventManageMenu.tsx`).
9. **Public page** — `resolveRsvpCta` + `PublicEventPage.tsx` Going/Not-going branch + +1 + **(A4) contact-capture fields** + states (incl. real waitlist).
10. **Consumer deck** — discover supply confirm + card converter RSVP variant + Going/Not-going card.
11. **Hub** — offering list-card / manage-sheet `event_type='rsvp'` "N going" + pending-badge branch.
12. **Edit-published** — RSVP-aware edit screen path (drop Tickets section + refund gate; "N guests are going — they'll be notified" notice; the notice now backs a REAL §5.2 notify-enqueue).

---

## 9. Regression Prevention (fails-on-revert contract)

Six structural safeguards, each with a test that MUST fail when the fix is reverted and pass when restored:

1. **`I-PROPOSED-1150-RSVP-NO-TICKET-ROWS`** — an `event_type='rsvp'` row has zero non-deleted `ticket_types`. **Test (SQL, `supabase/migrations/__tests__/orch_1150_rsvp.test.sql`):** publish an RSVP draft via `business_publish_rsvp_draft`, assert `count(ticket_types where event_id=… and deleted_at is null)=0`. Reverting the "DELETE the ticket INSERT loop" delta makes this FAIL.
2. **`I-PROPOSED-1150-RSVP-OFF-DECK-UNLESS-DISCOVERABLE`** — an RSVP appears in the discover RPC iff `rsvp_discoverable=true`. **Test:** insert two scheduled RSVP rows (one discoverable, one not) in a deck city; call the discover RPC; assert only the discoverable one is returned, and a ticketed `event` is unaffected. Reverting the discover-RPC widen (or the `rsvp_discoverable` predicate) makes this FAIL.
3. **`I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC`** — RSVP never routes through `business_publish_event_draft`. **Test (TS, strict-grep-style + integration):** `rsvpEvents.ts.publishRsvpDraft` calls `business_publish_rsvp_draft` and NOT `business_publish_event_draft`; and a static assertion that `RsvpCreatorWizard`/`/rsvp/*` never import the event publish hook. Reverting the fork (re-pointing RSVP at the event RPC) makes this FAIL — and would also re-introduce the `event_ticket_required` 0-ticket block (caught by T9).
4. **`I-PROPOSED-1150-WAITLIST-AUTOPROMOTE-OLDEST` (A3 + A2-NEW)** — when a spot opens on a full waitlist-enabled RSVP, the OLDEST `waitlisted` guest (`waitlisted_at ASC`) auto-promotes and is notified, never exceeding the cap. **Test (SQL):** seed cap=2, 2 going+approved, 2 waitlisted (distinct `waitlisted_at`); flip one going→not_going; assert exactly the oldest waitlisted row flips to `going` (auto) / `going`+`pending` (manual), `promoted_at` set, exactly one `rsvp_notifications` row `template_key='rsvp_waitlist_promoted'` for that guest, and confirmed-attending never > cap. **A2-NEW arm (same trigger, same test family):** repeat the seed but instead of going→not_going, fire a **host-remove `approved→denied`** (via `host_set_rsvp_status(..,'denied')`) on an approved Going guest; assert the SAME auto-promote of the oldest waitlisted guest fires — proving host-remove reuses the drain mechanism, not a parallel one. Reverting the `fn_rsvp_drain_on_capacity_freed` trigger (or its `ORDER BY waitlisted_at` / `ON CONFLICT` idempotency, or removing `approved→denied` from the trigger's spot-freeing condition) makes this FAIL.
5. **`I-PROPOSED-1150-RSVP-NOTIFY-MULTICHANNEL-NONBLOCKING` (A4 + A4-NEW-2)** — `rsvp-notify` attempts **every channel for which the guest has a usable address/token** (push if `user_id`, email if any resolvable email, SMS if any resolvable phone — for app users this means push AND email AND SMS, NOT push-only — A4-NEW-2), and a failure in one channel does NOT block the others or throw; the queue row is `sent` when ≥1 channel succeeds. **Test (TS, edge-fn unit):** (a) mock the Twilio client to throw/500 while the Resend mock succeeds; assert the email send still fires, the queue row ends `sent`, the Twilio failure is logged (not rethrown). (b) **A4-NEW-2 multi-channel assertion:** for an app-user guest WITH a resolvable profile email and phone, assert `sendPush` AND the Resend send AND the Twilio send are ALL invoked (proving the path is NOT push-only). Reverting the per-channel try/catch isolation (wrapping all three in one try that aborts on first throw) OR reverting to a push-only branch for app users makes this FAIL. Pairs with Constitution #3 (no silent failure: each per-channel outcome is logged).

6. **`I-PROPOSED-1150-LINK-GUEST-CONTACT-BOTH-REQUIRED` (A4-NEW)** — a LINK guest (`event_rsvps.user_id IS NULL`) row MUST carry BOTH a non-empty `guest_email` AND a non-empty `guest_phone`; app-user rows (`user_id IS NOT NULL`) are exempt. **Test (SQL + edge-fn unit):** (a) attempt a direct `INSERT` into `event_rsvps` with `user_id=NULL` and only an email (no phone) → assert the `event_rsvps_link_guest_contact_required` CHECK rejects it; repeat with only a phone → rejected; both present → accepted; `user_id` set with neither → accepted. (b) call the `public-submit-rsvp` edge fn as an anon guest missing the phone → assert `400 rsvp_contact_required`. Reverting the CHECK constraint OR the edge-fn required-contact gate makes this FAIL.

Protective comment requirement: each forked/new artifact (`business_publish_rsvp_draft`, `validateRsvpPublish`, the public-page RSVP branch, `fn_rsvp_drain_on_capacity_freed`, `rsvp-notify`) carries a `-- ORCH-1150: do NOT merge back into the event/ticket path — RSVP has zero tickets + no money gate; notify is TRANSACTIONAL (no marketing-consent). See SPEC §5.` comment. The `event_rsvps_link_guest_contact_required` CHECK carries `-- ORCH-1150 A4-NEW: link guests MUST be reachable by email AND SMS — do not relax to email-only or name-only.`

All six flip ACTIVE on CLOSE (orchestrator owns the flip). They are DRAFT here.

---

## 10. Open Questions

- **A1 (multi-date RSVP)** — DEFERRED by steering #4. Confirm v1 ships single-date only; multi-date is a registered follow-on (re-add the `whenMode` tabs + the publish RPC's multi_date branch). No action needed unless Seth re-opens.
- **A2 (host approval console UI)** — **DECIDED-FULL (Seth, 2026-06-15).** BUILD the approve/deny console in v1: `RsvpGuestConsole.tsx` + `/rsvp/[id]/guests` + `host_set_rsvp_status`/`host_bulk_approve_rsvps` RPCs + the manage-sheet "Guests" row + approve/deny guest notification (§5.4). No longer a follow-on. Resolved.
- **A3 (waitlist semantics)** — **DECIDED-FULL (Seth, 2026-06-15).** Real `waitlisted` status + deterministic in-transaction auto-promote-oldest (the `fn_rsvp_drain_on_capacity_freed` DB trigger) + notify the promoted guest; capacity counts `+plus_count` (§4.1c/§4.1f/§5.5). The lightweight client-only flag is REMOVED. Resolved.
- **A4 (guest notifications)** — **DECIDED-FULL (Seth, 2026-06-15).** A real RSVP notification pipeline: `rsvp-notify` edge fn fans out push (OneSignal) + SMS (Twilio) + email (Resend), reusing the existing clients, for the three triggers (edit / promote / approve-deny), per-channel non-blocking, idempotent, transactional-basis (§5.6). Resolved.

**The three questions the full-featured expansion surfaced are now ALL DECIDED (Seth, 2026-06-15 finalization) — none remain open:**
- **A4-NEW (email mandatory for link guests?)** — **DECIDED (Seth, 2026-06-15).** *"Require BOTH email AND phone for anonymous link guests."* — STRONGER than the recommended email-only. A link guest (`user_id IS NULL`) MUST supply `guest_email` AND `guest_phone`, enforced at three layers: the public form (Going disabled until both valid, §6.5), the `public-submit-rsvp` edge fn (`400 rsvp_contact_required`, §5.3 step 2), and the DB `event_rsvps_link_guest_contact_required` CHECK (§4.1c). App-user RSVPs (`user_id IS NOT NULL`) are exempt — they inherit notify addresses from their profile and are reachable by push via `user_id` (§5.6). Resolved.
- **A2-NEW (un-admit an approved guest?)** — **DECIDED (Seth, 2026-06-15).** *"The host CAN remove/un-admit an already-approved or Going guest."* — `host_set_rsvp_status` gains the **`approved→denied`** transition (host-remove). We REUSE `approval_status='denied'` as the removed-state (NO distinct `'removed'` value) so the existing §4.1f `fn_rsvp_drain_on_capacity_freed` trigger — which already treats a flip to `denied` as spot-freeing — auto-promotes the oldest waitlisted guest with no new trigger code. The removed guest no longer counts toward capacity, is notified (`rsvp_removed`, §5.6), and only the owning brand's host (`event_manager`-rank) may do it (RLS, §4.1d). The `RsvpGuestConsole` Going rows carry a Remove action with a confirm dialog (§5.4). Resolved.
- **A4-NEW-2 (consumer-app guest = push-only?)** — **DECIDED (Seth, 2026-06-15).** *"App-user guests are notified via PUSH + EMAIL (all channels they have), not push-only."* — The `rsvp-notify` fan-out attempts EVERY channel for which the guest has a usable address/token: push (by `user_id`) AND email (profile/auth email resolved server-side) AND SMS (if a profile phone exists). The explicit rule: *for each of {push, email, sms}, resolve the address/token; if present, attempt it; otherwise skip* — no channel suppressed when an address exists (§5.6 step 3). Resolved.

**ALL §10 open questions are now DECIDED. No open questions remain.**

---

## 11. Downstream Routing

**Next phase: IMPLEMENT** (`mingla-implementor`), gated on Seth's REVIEW of this FINALIZED SPEC. **All §10 open questions are now DECIDED** (A2/A3/A4 DECIDED-FULL; A4-NEW / A2-NEW / A4-NEW-2 DECIDED in the 2026-06-15 finalization) — the spec is implementor-ready with no outstanding product decisions. The implementor builds in the §8 order inside a per-ORCH worktree `~/Desktop/mingla-orchs/ORCH-1150-[rsvp-event-wizard]/` on branch `ORCH-1150-rsvp-event-wizard`, honoring the allowlist below. Then **TEST** (`mingla-tester`) — Step-0.5 readiness = commit the five §9 fails-on-revert tests BEFORE the implementor merge (per `feedback_close_gate_verify_against_merged_main_not_stale_anchor`); adversarial angles: (a) confirm a published RSVP truly creates zero ticket rows AND is absent from checkout entirely; (b) confirm a link-only RSVP is invisible on the consumer deck while a discoverable one appears with a non-checkout CTA; (c) anon RLS — confirm the anon role has NO direct `event_rsvps` table policy and can only write via the edge fn, and the `/rsvp/[id]/guests` console is NOT in the anon allowlist; (d) confirm party-type is still enforced (steering #2 not silently dropped); **(e) A2** — confirm Approve/Deny actually mutate state AND notify (Constitution #1 no dead taps) and the approve capacity gate holds; **(e2) A2-NEW** — confirm the host **Remove** (`approved→denied`) action on a Going guest truly works (not a dead tap), frees the seat, auto-promotes the oldest waitlisted guest via the SAME drain trigger, and fires the `rsvp_removed` notification — and that a cross-brand host is blocked (`insufficient_event_permission`); **(f) A3** — drive a real spot-open and confirm the oldest waitlisted guest auto-promotes within the cap and gets exactly one notify (no double-promote on race); **(g) A4** — fault-inject one channel (Twilio 500) and confirm the other two still deliver and the failure is logged not swallowed (Constitution #3 no silent failure); **(g2) A4-NEW** — confirm a link guest CANNOT RSVP without BOTH email and phone (form + edge fn + DB CHECK all reject); **(g3) A4-NEW-2** — confirm an app-user guest with profile email+phone receives push AND email AND SMS (not push-only). Then **orchestrator CLOSE** flips the SIX invariants ACTIVE + World Map sync.

---

## Scoped Allowlist + DO-NOT-TOUCH

**Allowlist (implementor may create/modify ONLY these):** every file in the §4.0 manifest. Any file outside it requires a **stop-and-amend** (append in-file or `SPEC_AMENDMENT_ORCH-1150_*.md`) before edit.

**DO-NOT-TOUCH (hard):**
- `business_publish_event_draft`, `validateTickets`, `validatePublish`, `computePublishability`, `EventCreatorWizard.tsx`, `CreatorStep5Tickets.tsx`, `app/event/create.tsx`, `app/event/[id]/edit.tsx` — the Ticketed path stays byte-for-byte unchanged (except `validateBasics` gets an `export` added, and `CreatorStep2When` gets the additive optional `lockSingleDate` prop — both additive, no behavior change to the event path).
- `ticket-checkout-create` / `ticket-checkout-confirm` / any checkout RPC — RSVP never enters checkout.
- The Stripe / payout / paid-publish-guard machinery — RSVP is moneyless.
- `board_card_rsvps` and the consumer collab-board domain — unrelated.
- The existing event/experience/trip publish RPCs and their `event_dates`/`ticket_types` logic.
- **(A3/A4 reuse-don't-modify)** `_shared/push-utils.ts`, `notify-dispatch/index.ts`, `ticket-confirmation-dispatch/index.ts`, `_shared/email/*`, the `twilio-message-status` callback, `waitlist_entries` / `ticket_order_notifications` / `fn_waitlist_drain_on_capacity_freed`, and `notification-retry-sweeper/index.ts` — RSVP **CLONES the patterns** from these (cited with file:line in §5.5/§5.6) but must NOT modify the ticket waitlist/notification machinery. The only permitted touch is OPTIONALLY extending `notification-retry-sweeper` to also sweep `rsvp_notifications` (implementor's call, §5.6 step 6); if extended, it is additive and must not change the ticket-order sweep path.

---

### Invariant impact (flagged; orchestrator owns ACTIVE flip)
- **Preserves** `I-BRAND-UNIVERSAL-AUTHORING` (every brand reaches `/rsvp/create`, no kind/venueCategory gate).
- **Preserves** `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (new chooser row + RSVP-setup cards + A2 console rows use the opaque fallback).
- **Preserves** the public-route auth-gate allowlist (`anon_buyer_routes_must_be_allowlisted_against_root_auth_gate`) — RSVP reuses `/e/`, already allowlisted; the A2 `/rsvp/[id]/guests` console is a LOGGED-IN business route, NOT added to the anon allowlist.
- **Preserves** the ORCH-1075 paid-publish integrity invariants — inert for RSVP (moneyless); the RSVP RPC must NOT inherit the money gate.
- **Preserves** the marketing-consent boundary (`project_marketing_hub_strategy`) — A4 notifications are TRANSACTIONAL, sit OUTSIDE the unshipped `marketing_consent` foundation, read no consent column.
- **Establishes (DRAFT):** `I-PROPOSED-1150-RSVP-NO-TICKET-ROWS`, `I-PROPOSED-1150-RSVP-OFF-DECK-UNLESS-DISCOVERABLE`, `I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC`, **`I-PROPOSED-1150-WAITLIST-AUTOPROMOTE-OLDEST`** (A3 + A2-NEW host-remove), **`I-PROPOSED-1150-RSVP-NOTIFY-MULTICHANNEL-NONBLOCKING`** (A4 + A4-NEW-2 app-user multi-channel), **`I-PROPOSED-1150-LINK-GUEST-CONTACT-BOTH-REQUIRED`** (A4-NEW). SIX total.

### Steering compliance check
1. **Host-choosable discovery** — ✅ `rsvp_discoverable` column (default OFF), discover-RPC widen, consumer deck RSVP card, both paths in scope (§4.1b/e, §4.4§7, §4.8).
2. **KEEP Party Type in Basics** — ✅ Basics reused as-is; `validateBasics` retains the ≥1 canonical party-type gate; the publish RPC keeps party-type read + validation (§4.3, §4.7, §5.1). OVERRIDES the walkthrough's drop verdict.
3. **RSVP setup = full host control** — ✅ capacity cap + plus-ones toggle+count + waitlist toggle + auto/manual approval mode, all specced with defaults + persistence (§4.4, §4.1b).
4. **Single-date only v1** — ✅ `whenMode` forced single; recurring/multi_date dropped from wizard, validator, and publish RPC; flagged as follow-on (§4.2, §4.3, §4.7, §5.1, §10 A1).

### V1-SCOPE steering compliance check (2026-06-15 amendment — the 4 full-featured locks)
- **A2 — BUILD approve/deny host console in v1** — ✅ `RsvpGuestConsole.tsx` + `/rsvp/[id]/guests` route + manage-sheet "Guests" row; `host_set_rsvp_status` + `host_bulk_approve_rsvps` RPCs with host-rank RLS + capacity gate + state machine; approve/deny fires a guest notification. Fully usable, not just a count (§4.0, §4.3, §5.4, §6.6, T25–T30).
- **A3 — FULL waitlist (auto-promote + notify)** — ✅ two-dimension status model with real `waitlisted` status (§4.1c); deterministic in-transaction `fn_rsvp_drain_on_capacity_freed` trigger promotes the OLDEST waitlisted guest on any spot-open (going→not_going / deny / cap-raise), auto vs manual aware, idempotent, capacity counts `+plus_count`; promoted guest notified (§4.1f, §5.5, T31–T35). Precedent cited: `fn_waitlist_drain_on_capacity_freed` (`20260724000010_orch_0948_waitlist_feature.sql:93-169`).
- **A4 — Notify via push + SMS + email (all three) — new pipeline** — ✅ contact capture (name+email required for link guests, phone optional) on the public form (§6.5); `rsvp-notify` edge fn fans out across OneSignal push (`_shared/push-utils.ts:95`) + Twilio SMS (cloned from `ticket-confirmation-dispatch/index.ts:123-170`) + Resend email (cloned from `notify-dispatch/index.ts:84-138`), per-channel non-blocking (Constitution #3), idempotent; three triggers (edit / promote / approve-deny) with per-channel copy (§5.6, T36–T39). Transactional, outside marketing-consent.
- **Step structure — 6 confirmed** — ✅ Basics → When → Where → Cover → RSVP-setup → Preview, unchanged; A2/A3/A4 add post-publish surfaces, NOT wizard steps (§4.3).

### Finalization steering compliance check (2026-06-15 — the 3 last locked decisions)
- **A4-NEW — link guests REQUIRE BOTH email AND phone** — ✅ enforced at three layers: public form (Going disabled until name+email+phone valid, §6.5), `public-submit-rsvp` edge fn (`400 rsvp_contact_required`, §5.3 step 2), DB `event_rsvps_link_guest_contact_required` CHECK (§4.1c). App users exempt (profile-inherited, §5.6). New invariant `I-PROPOSED-1150-LINK-GUEST-CONTACT-BOTH-REQUIRED` + test T24 + §9 safeguard #6.
- **A2-NEW — host CAN remove/un-admit an approved/Going guest** — ✅ `approved→denied` transition added to `host_set_rsvp_status` (§5.4 step 3/5/6); REUSES `approval_status='denied'` (no `'removed'` state) so the existing §4.1f drain trigger auto-promotes the oldest waitlisted guest (a) removed guest stops counting toward cap, (b) auto-promote fires, (c) removed guest notified (`rsvp_removed`, §5.6), (d) RLS limits to owning host (§4.1d), (e) `RsvpGuestConsole` Going-row Remove action + confirm (§5.4). Trigger condition (§4.1f) + invariant #4 A2-NEW arm cover it. Tests T40–T42.
- **A4-NEW-2 — app-user guests notified via push + email + SMS (all channels they have), not push-only** — ✅ `rsvp-notify` fan-out resolves and attempts every available channel per guest, including profile email + profile phone for app users (§5.6 step 3); invariant #5 multi-channel arm + tests T43–T44.

---

## Amendment Log — 2026-06-15 (full-featured v1)

This section records exactly what changed from the original 505-line SPEC and why, so the diff is auditable. Trigger: Seth LOCKED four V1-SCOPE decisions (World Map "V1-SCOPE STEERED", 2026-06-15) that EXPAND the lightweight/deferred versions the original spec shipped. The original shipped A2/A3/A4 as "RECOMMEND lightweight / follow-on" (old §10); those recommendations are now REPLACED by full features.

**What changed, by section:**
1. **Header note** — added the amendment banner declaring A2/A3/A4 full + 6-step confirmed.
2. **§2 Scope** — moved A2 (approve/deny console), A3 (full waitlist), A4 (notification pipeline) OUT of non-goals and INTO in-scope (new items 11/12/13). Removed the "console UI is OUT / lightweight waitlist / notice-without-send" deferral wording. Added a TRANSACTIONAL-vs-marketing non-goal clarifying A4 sits outside `marketing_consent`.
3. **§3 Cross-Surface** — Business iOS/Android rows now include the A2 console; added the A4 three-channel fan-out cross-surface note (consumer push path reached transactionally); backend line lists the new RPCs/trigger/edge-fn.
4. **§4.0 Manifest** — ADDED: `RsvpGuestConsole.tsx`, `/rsvp/[id]/guests` route, `useRsvpApprovals.ts`, `rsvpApprovals.ts` (A2); `rsvp-notify/index.ts` (A4); manage-sheet "Guests" row + config.toml `rsvp-notify` entry.
5. **§4.1(c) `event_rsvps`** — **REWROTE the status model from one-ish to TWO explicit dimensions**: `rsvp_status` (going/not_going/**waitlisted**) + `approval_status` (pending/approved/**denied**), with canonical interaction/precedence rules (capacity counts confirmed-attending; pending doesn't occupy cap; manual+full → pending-not-waitlisted; auto+full → waitlisted). ADDED contact columns `guest_phone` + made the A4 email-capture intent explicit, plus `waitlisted_at`/`promoted_at`/`notified_at` and a waitlist partial index. Defined the `+plus_count` capacity formula.
6. **§4.1(d) RLS** — host-write policy expanded to cover approve/deny + host-only `waitlisted` writes.
7. **§4.1(f) NEW** — the `fn_rsvp_drain_on_capacity_freed` auto-promote trigger (A3), cloned from the proven ticket `fn_waitlist_drain_on_capacity_freed`, with the events.rsvp_capacity-raise arm + auto/manual promotion semantics + idempotency.
8. **§4.3 / §4.4** — waitlist + approval toggles re-annotated as backing REAL features; Hub manage-sheet row gains the "Guests" console entry; 6-step confirmation note added.
9. **§5.2 `biz_update_live_rsvp`** — added material-change detection + notify-enqueue (A4 trigger #1).
10. **§5.3 `public_submit_rsvp`** — REPLACED the lightweight "return 409 / client-only waitlist" with the real two-dimension resolve + real `waitlisted` write + A4 contact validation.
11. **§5.4 / §5.5 / §5.6 NEW** — host approve/deny console + `host_set_rsvp_status`/`host_bulk_approve_rsvps` (A2); waitlist auto-promote recap (A3); the `rsvp-notify` multi-channel pipeline + `rsvp_notifications` queue + per-trigger/per-channel copy table (A4), all citing the reused OneSignal/Twilio/Resend integrations by file:line.
12. **§6 Public page** — added A4 contact-capture field set (name+email required for link guests, phone optional) + real waitlist result state; A2 console is now reachable (not a follow-on).
13. **§7 Tests** — added T24–T39 (A2 console + capacity gate + RLS; A3 auto-promote + plus-count + race; A4 three-channel + non-blocking + idempotency).
14. **§8 Order** — added `rsvp-notify` edge fn, A2 console + data layer, contact-capture, notify-enqueue steps.
15. **§9 Regression** — added two DRAFT invariants `I-PROPOSED-1150-WAITLIST-AUTOPROMOTE-OLDEST` + `I-PROPOSED-1150-RSVP-NOTIFY-MULTICHANNEL-NONBLOCKING`, each with a fails-on-revert test (now FIVE total).
16. **§10 Open Questions** — A2/A3/A4 marked **DECIDED-FULL**; surfaced THREE genuinely-new questions the expansion forces (A4-NEW: is email mandatory for link guests vs name-only-no-notify — the primary one for Seth; A2-NEW: un-admit an approved guest?; A4-NEW-2: app-user guests push-only?).
17. **DO-NOT-TOUCH / Invariant impact / Steering check / §11 routing** — added the ticket waitlist/notification machinery as reuse-don't-modify; added the transactional/marketing-consent preservation; added the V1-SCOPE compliance sub-check; added A2/A3/A4 adversarial tester angles + five-invariant flip.

**What did NOT change:** the Ticketed path stays byte-for-byte (DO-NOT-TOUCH intact); the RSVP forked publish RPC / validator / Going-Not-going public CTA contracts; the `event_type` CHECK widen + discover-RPC widen; the 6-step wizard structure; party-type retention (steering #2); single-date-only (steering #4); host-choosable discovery (steering #1). No product code, no migration files, no worktree, no secrets inlined (all OneSignal/Twilio/Resend access is by env-var name via the reused clients).

---

## Amendment Log — Finalization 2026-06-15 (the 3 last locked decisions)

Seth LOCKED the three remaining product decisions that the full-featured expansion surfaced (former §10 NEW open questions). They are now DECIDED and propagated; **no §10 open questions remain — the spec is implementor-ready.**

1. **A4-NEW → link guests REQUIRE BOTH email AND phone** (stronger than the recommended email-only). Propagated to: §4.1c (`guest_email`/`guest_phone` comments + new `event_rsvps_link_guest_contact_required` CHECK + Notes paragraph defining the app-user inherit exemption), §5.3 (request contract + step-2 three-field validation), §6.5 (public-form: all three blocking for link guests, app users exempt), §5.6 (link guests always have email+SMS). New invariant `I-PROPOSED-1150-LINK-GUEST-CONTACT-BOTH-REQUIRED` (§9 safeguard #6, now SIX total), test T24 rewritten.

2. **A2-NEW → host CAN remove/un-admit an already-approved/Going guest.** Chose **`approval_status='denied'`** (NOT a distinct `'removed'` state) so the existing §4.1f `fn_rsvp_drain_on_capacity_freed` trigger — which already treats a flip to `denied` as spot-freeing — auto-promotes the oldest waitlisted guest with ZERO new trigger code. Propagated to: §4.1c (denied-as-remove comment), §4.1d (RLS host-write now allows `approved→denied`, owning-host only), §4.1f (spot-freed condition explicitly covers `approved→denied`), §5.4 (`host_set_rsvp_status` state machine steps 3/5/6 + `rsvp_removed` template + `RsvpGuestConsole` Going-row Remove action with confirm), §5.5 (host-remove reuses the drain), §5.6 (`rsvp_removed` copy row), §6.6. Invariant #4 gains an A2-NEW arm; tests T40–T42.

3. **A4-NEW-2 → app-user guests notified via push + email + SMS (every channel they have), NOT push-only.** Propagated to: §5.6 step 3 (rewrote the fan-out to "every channel for which the guest has a usable address/token"; app-user email resolved via verified `auth.users`/`auth.identities` per `project_orch_1111_1112_invite_surface_ari_reachable`, profile phone for SMS), §3 cross-surface note. Invariant #5 gains the multi-channel (not-push-only) arm; tests T43–T44.

**Other propagated edits:** §10 marked all three DECIDED (verbatim Seth answers) + "no open questions remain"; §11 routing un-gated (IMPLEMENT-ready) + added A2-NEW/A4-NEW/A4-NEW-2 tester angles + SIX-invariant flip; §"Establishes (DRAFT)" + §"Steering compliance check" updated (new Finalization sub-check); §9 header Five→Six.

**What did NOT change in finalization:** every prior contract (forked RPCs, validator, two-dimension status model, the drain trigger mechanism itself, the three reused notify clients, the 6-step structure, DO-NOT-TOUCH list). No product code, no migration files, no worktree, no secrets. The host-remove deliberately reuses the EXISTING drain trigger (§5.5/§4.1f), never a parallel promote path (Constitution #1 + the reuse-don't-rebuild guard).
