# SPEC — ORCH-1384 [partner Brands screen dead end → partner brand-management verbs]

- **Phase:** SPEC (binding contract). Follows the REVIEW-APPROVED investigation
  `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1384_PARTNER_BRAND_MANAGEMENT.md` (F-1..F-10, D-1..D-8).
- **Author:** mingla-forensics+claude, 2026-07-16.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/` on branch `ORCH-1384-partner-brand-management`.
- **Binding product rulings (Seth, 2026-07-16 — encoded, not relitigable):** OQ-1 disconnect stops FUTURE
  splits only (team `removed_at` stamp; in-flight `partner_splits` pay out, NO voiding); OQ-2 cancel-pending
  AUTO-DELETES the pre-accept brand (existing soft-delete semantics); OQ-3 SHOW cancelled rows (greyed, last);
  OQ-6 BOTH sides ship (partner-initiated disconnect + owner-initiated remove-partner via Team screen);
  orchestrator interpretation: corrected email is NOT a cancel — a distinct reissue verb; OQ-7 no new
  notification rail as MUST (in-app state truth; notify = SHOULD).

### OPEN QUESTIONS (header — reversible defaults chosen, work not stalled)

| id | Fork | Reversible default ENCODED in this spec |
|---|---|---|
| OQ-1384-A | Cancel-pending when the pre-accept brand has upcoming `scheduled`/`live` events (partner built them out) — block, or force-cancel and cascade? | **Block** with typed `has_upcoming_events` rejection, mirroring `softDeleteBrand`'s Decision-11 workflow rejection. Never destroys sellable inventory; relaxing later is additive. |
| OQ-1384-B | Owner-side notice when a pending invite is cancelled / partner disconnected | **None as MUST** (per OQ-7 ruling: dead token 410s; in-app state truth). A push/email is a SHOULD listed for DESIGN/product. |
| OQ-8 (carried) | Sim login for the partner-flagged account (`6c61590c…`) | Owed by Seth **before TEST** (investigation §8; not an IMPLEMENT blocker). |

---

## 1. Executive summary

The partner Brands screen (`/partner/brands`) is a read-only dead end: a partner with even one pending
link cannot invite a second client brand, cannot see who they invited, and cannot cancel or disconnect
anything (F-1, F-3, F-4). This spec adds the full management-verb set:

1. **Invite-another-brand** — a persistent header add-CTA (UI-only; backend proven N-ready by probes P1–P3).
2. **Row detail sheet** — exposes the already-fetched `invited_owner_email`, `personal_note`, absolute
   timestamps, honest status; houses the verbs.
3. **Resend / correct-email (reissue)** — new edge fn + RPC: atomically kills the old token, issues a
   fresh invitation (optionally to a corrected address), updates the link's email VALUE and refreshes
   `invited_at`. Cures F-7 (email split) and D-8 (stale `invited_at`) for verb-created paths.
4. **Cancel-pending** — atomic RPC: stamp `cancelled_at` + revoke the pending invitation + soft-delete the
   pre-accept brand (ruling OQ-2).
5. **Disconnect-active** — atomic RPC: stamp `cancelled_at` + stamp the partner's
   `brand_team_members.removed_at` (the money truth, F-5). Partner-initiated (row detail) AND
   owner-initiated (Team screen; unblocks removal ONLY for the partner row — general removal stays ORCH-1051).
6. **Lifecycle coherence** — a DB trigger stamps the link when a `brand_owner` invitation on it is
   revoked (F-6 side door) or declined (D-3); 7-day expiry renders honestly via client derivation (D-4);
   cancelled rows show greyed/last with reason-specific labels (OQ-3), deleted-brand embeds render sanely (D-5).

Money is never voided: the time-pinned resolver (`removed_at > p_at`) protects everything earned before
the disconnect stamp; pending/retrying `partner_splits` rows pay out untouched (ruling OQ-1).

## 2. Scope & non-goals

**IN scope**
- `mingla-business` partner surface: `app/partner/brands.tsx`, new `PartnerLinkDetailSheet`, Team-screen
  partner-disconnect path (`app/brand/[id]/team.tsx` + `src/components/team/MemberDetailSheet.tsx`).
- `partnerBrandLinksService.ts` (verbs + include-cancelled read path + owner-side brand read) and hooks.
- Backend: ONE migration (`cancelled_reason` column, owner-read RLS policy, invite-kill trigger, 3 RPCs),
  ONE new edge fn (`partner-reissue-invitation`), extraction of the invite-email builder to `_shared`,
  ONE `config.toml` stanza.

**OUT of scope (explicit)**
- Admin partner console (META-1237). Consumer iOS/Android (zero refs, grep-proven). Buyer-web anon pages.
- General team-member removal UI (ORCH-1051) — `handleRemove` stays a no-op for every row EXCEPT the
  owner-initiated partner disconnect specced here.
- `?next=` resume on the accept flow (ORCH-1375).
- New notification rails (SHOULD only, OQ-1384-B). No changes to existing pushes.
- The RAW team-screen re-invite path's 23505 swallow (F-7 residual): the reissue verb is the sanctioned
  path; the raw-path swallow stays as registered discovery D-1 (candidate future ORCH). Note: the new
  invite-kill trigger means revoke-then-reinvite via the team screen now mints a FRESH link row (old one
  stamped cancelled), which already de-strands that sequence.
- Any change to `resolve_partner_for_brand_at_time`, `partnerSplits.ts`, `paystackPartnerSplits.ts`,
  `paystack-webhook`, the accept RPC, or `accept-brand-invitation` (verified below: they already exclude
  cancelled rows).

**Assumptions**
- The brands SELECT RLS does NOT hide soft-deleted rows from their owner (client code filters
  `deleted_at` explicitly everywhere, e.g. `brandsService.ts:590` — redundant if RLS filtered). The
  cancelled-row brand embed therefore keeps rendering after auto-delete. T-9 proves it; if it fails,
  implementor STOPS-AND-AMENDS (named fallback: snapshot column `cancelled_brand_name`), never improvises.

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched there | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | NOT covered | none — zero `partner_brand_links` refs (grep-proven, Q8) | — | n/a |
| 2 | Consumer Android (`app-mobile/`) | NOT covered | same | — | n/a |
| 3 | Buyer/anon Web (`mingla-business` public routes) | Indirectly affected, NO file changes | accept URL after cancel → 410 `invite_revoked`; after reissue → old token 410 `invite_expired`, new token accepts. Existing accept-flow copy handles both; ORCH-1373 gate untouched. | — | automatic (server truth) |
| 4 | Business iOS | COVERED | all six verb surfaces (§1) | `app/partner/brands.tsx`, `src/components/partner/PartnerLinkDetailSheet.tsx` (new), `app/brand/[id]/team.tsx`, `src/components/team/MemberDetailSheet.tsx`, services/hooks | automatic with #5 (shared RN code) |
| 5 | Business Android | COVERED | identical | same files | automatic (shared code); tester smoke-runs BOTH per policy |
| 6 | Admin Web (`mingla-admin`, adjacent) | NOT covered, tolerant | Identity console selects the link table incl. `cancelled_at` with no filter (F-10) — new stamps/columns are additive; no file changes | — | n/a |
| 7 | Business Web preview (adjacent) | Compiles, not a target | partner routes are native-first; same shared code builds for web unchanged | — | automatic |

## 4. Layered specification

### 4.1 Database — migration `supabase/migrations/20270102000000_orch_1384_partner_link_lifecycle.sql`

Version prefix `20270102000000` is unique (max on main is `20270101000864`; none of the six COMMS-0102
duplicate prefixes). Idempotent throughout (house style). The ORCHESTRATOR applies it (never blind
`db push` — migration-history drift hazard); the implementor only commits the file.

**Pre-apply READ-ONLY invariant probe** (orchestrator runs against prod BEFORE applying; expected values
in comments — any mismatch = STOP, re-investigate):

```sql
-- ORCH-1384 pre-apply probe (READ-ONLY)
SELECT
  (SELECT count(*) FROM pg_policies WHERE tablename='partner_brand_links')            AS link_policies,     -- expect 2 (self select + admin select)
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='partner_brand_links'
            AND column_name='cancelled_reason')                                       AS reason_col_exists, -- expect false
  (SELECT count(*) FROM pg_trigger
   WHERE tgname IN ('partner_brand_links_invite_kill_trigger'))                        AS kill_trigger,      -- expect 0
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN
     ('partner_cancel_pending_link','partner_disconnect_link',
      'partner_reissue_brand_invitation'))                                            AS new_rpcs,          -- expect 0
  (SELECT count(*) FROM pg_indexes WHERE tablename='partner_brand_links'
     AND indexname='partner_brand_links_partner_brand_active_idx')                    AS partial_idx,       -- expect 1
  (SELECT count(*) FROM pg_constraint WHERE conname='brand_invitations_status_check') AS status_check;      -- expect 1 (latest def = 20260924000000, includes 'declined')
```

**Migration body (contract — the implementor commits exactly this shape):**

```sql
-- ORCH-1384 [partner brand-management verbs] — link lifecycle coherence.
-- Adds: cancelled_reason column; owner-read RLS; invitation-kill trigger;
-- partner_cancel_pending_link / partner_disconnect_link /
-- partner_reissue_brand_invitation RPCs.
-- I-PROPOSED-1331-LINK-COLUMNS-FROZEN: this migration ADDS a column and stamps
-- EXISTING columns; it renames nothing. Compatible by the invariant's own text.
BEGIN;

-- 1. cancelled_reason ------------------------------------------------------
ALTER TABLE public.partner_brand_links
  ADD COLUMN IF NOT EXISTS cancelled_reason text;
ALTER TABLE public.partner_brand_links
  DROP CONSTRAINT IF EXISTS partner_brand_links_cancelled_reason_check;
ALTER TABLE public.partner_brand_links
  ADD CONSTRAINT partner_brand_links_cancelled_reason_check CHECK (
    cancelled_reason IS NULL
    OR (cancelled_at IS NOT NULL AND cancelled_reason IN
        ('partner_cancelled','owner_declined','invitation_revoked',
         'partner_disconnected','owner_removed'))
  );
COMMENT ON COLUMN public.partner_brand_links.cancelled_reason IS
  'ORCH-1384: why the link terminated. NULL allowed (legacy stamps). Values: partner_cancelled | owner_declined | invitation_revoked | partner_disconnected | owner_removed.';

-- 2. Owner-read RLS (inline predicate per feedback_rls_returning_owner_gap) -
DROP POLICY IF EXISTS partner_brand_links_owner_select ON public.partner_brand_links;
CREATE POLICY partner_brand_links_owner_select
  ON public.partner_brand_links
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = partner_brand_links.brand_id
      AND b.account_id = auth.uid()
  ));

-- 3. Invitation-kill trigger (F-6 side door + D-3 decline) ------------------
CREATE OR REPLACE FUNCTION public.partner_brand_links_stamp_on_invite_kill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF NEW.role = 'brand_owner'
     AND OLD.status = 'pending'
     AND NEW.status IN ('revoked','declined') THEN
    UPDATE public.partner_brand_links
       SET cancelled_at = now(),
           cancelled_reason = CASE NEW.status
             WHEN 'revoked' THEN 'invitation_revoked'
             ELSE 'owner_declined' END
     WHERE brand_id = NEW.brand_id
       AND lower(invited_owner_email) = lower(NEW.email)
       AND cancelled_at IS NULL
       AND accepted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS partner_brand_links_invite_kill_trigger
  ON public.brand_invitations;
CREATE TRIGGER partner_brand_links_invite_kill_trigger
  AFTER UPDATE OF status ON public.brand_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_brand_links_stamp_on_invite_kill();
```

**RPC 1 — `public.partner_cancel_pending_link(p_link_id uuid) RETURNS jsonb`**
(SECURITY DEFINER, `search_path` locked, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated`.)
Error signaling mirrors the accept RPC: `RAISE EXCEPTION '<message>' USING ERRCODE='P0001'` with messages
`forbidden` / `link_not_found` / `link_not_pending` / `has_upcoming_events` (blocking count in `DETAIL`).
Exact internal sequence (ORDER IS LOAD-BEARING — race + trigger semantics):

1. `v_caller := auth.uid()`; NULL → `forbidden`.
2. Plain SELECT of the link by `p_link_id` (no lock). Not found → `link_not_found`. Caller ≠
   `partner_account_id` → `forbidden`.
3. **Lock the invitation FIRST** (same lock order as the accept RPC — serializes the cancel-vs-accept
   race, no deadlock): `SELECT … FROM brand_invitations WHERE brand_id = v_link.brand_id AND
   lower(email) = lower(v_link.invited_owner_email) AND role='brand_owner' AND status='pending'
   ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`. May be empty (expired/declined/revoked histories) —
   cancel still proceeds; there is just nothing to revoke.
4. Re-read the link `FOR UPDATE`; re-verify `cancelled_at IS NULL AND accepted_at IS NULL` →
   else `link_not_pending`. (If an in-flight accept held the invitation lock, step 3 blocked until it
   committed and this re-check now refuses — the brand a new owner just received is NEVER deleted.)
5. Upcoming-events blocker (OQ-1384-A default; mirrors `softDeleteBrand` semantics incl. the
   date-aware ORCH-0862 filter): `SELECT count(DISTINCT e.id) FROM public.events e JOIN
   public.event_dates d ON d.event_id = e.id WHERE e.brand_id = v_link.brand_id AND e.status IN
   ('scheduled','live') AND e.deleted_at IS NULL AND d.end_at > now()`. > 0 → `has_upcoming_events`.
6. Stamp the link **before** touching the invitation: `UPDATE partner_brand_links SET
   cancelled_at = now(), cancelled_reason = 'partner_cancelled' WHERE id = p_link_id` — so the step-7
   trigger fire no-ops on its `cancelled_at IS NULL` predicate and the reason stays `partner_cancelled`.
7. If step 3 found an invitation: `UPDATE brand_invitations SET status='revoked', revoked_at=now()
   WHERE id = v_invitation.id AND status='pending'`.
8. Brand soft-delete (ruling OQ-2), defensively owner-guarded: `UPDATE brands SET deleted_at = now()
   WHERE id = v_link.brand_id AND deleted_at IS NULL AND account_id = v_link.partner_account_id`;
   capture ROW_COUNT.
9. `UPDATE creator_accounts SET default_brand_id = NULL WHERE id = v_link.partner_account_id AND
   default_brand_id = v_link.brand_id` (mirrors `softDeleteBrand` step 3).
10. Best-effort `audit_log` insert (action `partner_link_cancelled`), exception-swallowed like the
    accept RPC's audit block.
11. `RETURN jsonb_build_object('link_id', p_link_id, 'brand_id', v_link.brand_id,
    'brand_deleted', <rowcount> > 0, 'invitation_revoked', <step-3 found>)`.

**RPC 2 — `public.partner_disconnect_link(p_link_id uuid) RETURNS jsonb`**
(Same definer/grant shape; messages `forbidden` / `link_not_found` / `link_not_active` / `partner_is_owner`.)

1. `v_caller := auth.uid()`; NULL → `forbidden`.
2. `SELECT … FOR UPDATE` the link. Not found → `link_not_found`. `cancelled_at IS NOT NULL` OR
   `accepted_at IS NULL` → `link_not_active` (pending links use the cancel verb).
3. `v_owner := (SELECT account_id FROM brands WHERE id = v_link.brand_id)`. Caller =
   `partner_account_id` → `v_reason := 'partner_disconnected'`; caller = `v_owner` →
   `v_reason := 'owner_removed'`; else `forbidden`.
4. Fail-close guard: `v_link.partner_account_id = v_owner` → `partner_is_owner` (structurally
   impossible for accepted links; never strip a current owner's membership).
5. `UPDATE partner_brand_links SET cancelled_at = now(), cancelled_reason = v_reason WHERE id = p_link_id`.
6. **Money truth (F-5):** `UPDATE brand_team_members SET removed_at = now() WHERE brand_id =
   v_link.brand_id AND user_id = v_link.partner_account_id AND removed_at IS NULL AND
   role <> 'brand_owner'` — same transaction as step 5 (I-PROPOSED-1384-DISCONNECT-STAMPS-BOTH).
7. **NO `partner_splits` writes of any kind** (ruling OQ-1; I-PROPOSED-1384-INFLIGHT-SPLITS-PAY-OUT).
   The time-pinned resolver (`removed_at IS NULL OR removed_at > p_at`, sole definition ORCH-1054)
   is the only money gate: charges with `p_at` before the stamp still split; at/after do not.
8. Best-effort audit (`partner_link_disconnected`, `after.reason = v_reason`), swallowed.
9. `RETURN jsonb_build_object('link_id', p_link_id, 'reason', v_reason)`.

**RPC 3 — `public.partner_reissue_brand_invitation(p_link_id uuid, p_partner_account_id uuid,
p_new_email text, p_token_hash text, p_expires_at timestamptz) RETURNS jsonb`**
(SECURITY DEFINER; `GRANT EXECUTE TO service_role` ONLY — called by the edge fn, which owns JWT auth;
messages `forbidden` / `link_not_found` / `link_not_pending` / `validation`.)

1. `p_new_email` empty/NULL → `validation` (edge fn also validates format; belt-and-braces).
2. `SELECT … FOR UPDATE` the link. Not found → `link_not_found`; `partner_account_id <>
   p_partner_account_id` → `forbidden`; `cancelled_at IS NOT NULL OR accepted_at IS NOT NULL` →
   `link_not_pending`.
3. Latest prior invitation for name reuse: `SELECT … FROM brand_invitations WHERE brand_id =
   v_link.brand_id AND lower(email) = lower(v_link.invited_owner_email) AND role='brand_owner'
   ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`; `v_name := COALESCE(v_old.invitee_name,
   split_part(p_new_email,'@',1))`.
4. **Kill old token(s) by EXPIRE-NOW, never by revoke** (I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-REVOKES —
   a `revoked` transition would fire the §4.1-3 trigger and terminally cancel the link being reissued):
   `UPDATE brand_invitations SET expires_at = now() WHERE brand_id = v_link.brand_id AND lower(email) =
   lower(v_link.invited_owner_email) AND role='brand_owner' AND status='pending' AND expires_at > now()`.
   Old tokens then die via the accept RPC's existing P0003 `invite_expired`; the invite-brand-member 409
   duplicate guard (`status='pending' AND expires_at > now()`) is naturally released; the team screen's
   pending filter (`expires_at > now`) naturally drops the stale row.
5. `INSERT INTO brand_invitations (brand_id, email, invitee_name, role, invited_by, token_hash,
   expires_at, status) VALUES (v_link.brand_id, p_new_email, v_name, 'brand_owner',
   p_partner_account_id, p_token_hash, p_expires_at, 'pending') RETURNING id INTO v_new_id`.
6. `UPDATE partner_brand_links SET invited_owner_email = p_new_email, invited_at = now() WHERE id =
   p_link_id` — the email VALUE update + `invited_at` refresh (I-1331 freezes column NAMES, not values;
   this cures F-7 + D-8 on this path: the accept RPC's `lower(invited_owner_email) =
   lower(v_invitation.email)` stamp can now match the corrected owner).
7. Best-effort audit (`partner_invitation_reissued`, `after` carries old/new email), swallowed.
8. `RETURN jsonb_build_object('invitation_id', v_new_id, 'invitee_name', v_name)`.

**Post-apply DO-block probes** (inside the migration, ORCH-1081 §8 style — read-only asserts): column +
named CHECK exist; the 3 pronames exist; `partner_brand_links_invite_kill_trigger` exists; policy
`partner_brand_links_owner_select` exists; partial unique index `partner_brand_links_partner_brand_active_idx`
STILL exists; `partner_brand_link_status` proname still present (frozen ORCH-1081 case tree untouched).
`COMMIT;` ends the file.

### 4.2 Edge function — `supabase/functions/partner-reissue-invitation/index.ts` (NEW)

- **Registration:** `supabase/config.toml` gains `[functions.partner-reissue-invitation]` /
  `verify_jwt = true` (matches siblings at config lines 194–210).
- **Contract:** `POST { link_id: uuid, new_email?: string }` →
  `201 { invitation_id }` · `400 { error:'validation', fields?:[] }` · `401 { error:'unauthenticated' }` ·
  `403 { error:'forbidden' }` · `404 { error:'link_not_found' | 'brand_not_found' }` ·
  `409 { error:'link_not_pending' }` · `502 { error:'email_send_failed' }` · `500 { error:'server' }`.
- **Flow:** CORS preflight via `_shared/cors.ts`; JWT → `userId`; validate `new_email` when present
  (reuse `EMAIL_RE`, `EMAIL_MAX`); service-role read of the link (404/403/409 mapping BEFORE any write);
  brands lookup `.is("deleted_at", null)` (name/cover/`partner_setup`) → 404 `brand_not_found` if gone;
  mint token (`makeToken`/`sha256Hex`, same constants `TOKEN_BYTES=32`, `EXPIRY_DAYS=7`); call RPC 3 with
  `p_partner_account_id = userId`, `p_new_email = new_email ?? link.invited_owner_email`; map RPC error
  messages to the HTTP codes above; build the accept URL (same `MINGLA_BUSINESS_WEB_URL` pattern); send
  via the extracted `_shared` invite-email builder with `partnerSetup: true` copy and the link's
  `personal_note`; **on send failure: `DELETE FROM brand_invitations WHERE id = <new id>`** (mirror
  invite-brand-member's rollback DELETE — a DELETE cannot fire the UPDATE trigger) and return 502.
  Degraded-but-recoverable state after a 502 (link email/`invited_at` already updated, no live token) is
  acceptable: the row detail still offers Resend and a retry fully cures.
- **No link INSERT anywhere in this fn** — reissue mutates the existing row via the RPC; the 23505
  swallow class is structurally unreachable on this path.
- **Strict-grep gates on `supabase/functions/**`:** the fn must not touch `paystack-webhook`, must not
  contain any partner-share rate literal (I-PROPOSED-1331-SHARE-FROM-PLATFORM-FEE), and adds no split logic
  (I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT untouched).

### 4.3 Shared email extraction — `supabase/functions/_shared/brandInviteEmail.ts` (NEW)

MOVE-ONLY refactor: relocate `buildInviteEmail`, `sendInviteEmail`, `makeToken`, `sha256Hex` (and their
local types/constants) from `invite-brand-member/index.ts` into the shared module; `invite-brand-member`
imports them back. **Byte-identical template output; zero behavior change**; the fn's existing
`__tests__` must pass unmodified (that is the guard). Both fns share one email source of truth.

### 4.4 Service — `mingla-business/src/services/partnerBrandLinksService.ts`

> **Invariant citation (MANDATORY, verbatim in the file header):** this file was on the ORCH-1331
> DO-NOT-TOUCH list under I-PROPOSED-1331-LINK-COLUMNS-FROZEN. ORCH-1384 amends that list BY SPEC with
> orchestrator REVIEW as the sanctioning step. The frozen rule itself is preserved: all reads keep the
> existing column NAMES; `deriveLinkStatus`'s case tree is UNCHANGED; nothing is renamed.

1. `PartnerBrandLinkRow` gains `cancelled_reason: string | null`; select string adds `cancelled_reason`.
2. `listPartnerBrandLinks(opts?: { includeCancelled?: boolean })` — when `includeCancelled !== true`,
   keep `.is("cancelled_at", null)` exactly as today (default behavior byte-compatible); when `true`,
   omit that filter. The brand embed stays UNFILTERED on `deleted_at` — **intentional** (cancelled rows
   must render their deleted brand's name, D-5); add the protective comment.
3. `partnerBrandLinksKeys.list(includeCancelled: boolean)` — the param IS part of the key (two cache
   entries; no hardcoded strings). Existing `all` root retained for invalidation.
4. NEW `listBrandPartnerLinks(brandId: string)` — owner-side read via the new RLS policy: same select,
   `.eq("brand_id", brandId)`, no cancelled filter; key `partnerBrandLinksKeys.brand(brandId)`. Used by
   the Team screen to identify the partner member row.
5. NEW verbs (all with typed error mapping from RPC/edge messages — `link_not_found` / `forbidden` /
   `link_not_pending` / `link_not_active` / `has_upcoming_events` (+ blocking count from `DETAIL` when
   surfaced) / `email_send_failed`; never a silent catch):
   - `cancelPendingLink(linkId): Promise<CancelPendingResult>` → `supabase.rpc("partner_cancel_pending_link")`;
     `has_upcoming_events` maps to a WORKFLOW REJECTION result (Decision-11 pattern, like `SoftDeleteResult`),
     not a throw.
   - `disconnectLink(linkId): Promise<void>` → `supabase.rpc("partner_disconnect_link")`.
   - `reissueInvitation(linkId, newEmail?): Promise<{ invitationId: string }>` →
     `supabase.functions.invoke("partner-reissue-invitation")`.
6. NEW derivation helpers: `INVITE_EXPIRY_DAYS = 7` (cross-ref comment to the edge fn's `EXPIRY_DAYS`;
   T-5 pins them equal) and `isInviteExpired(row): boolean` = `status === "awaiting_owner" &&
   Date.now() >= invited_at + INVITE_EXPIRY_DAYS days`. Presentation-level ONLY — the 4-value
   `PartnerBrandLinkStatus` union and `deriveLinkStatus` are frozen (D-4's "cheapest honest mechanism":
   reissue refreshes `invited_at` atomically with the new `expires_at`, keeping the derivation truthful;
   server truth already enforces death via P0003).

### 4.5 Hooks

- `usePartnerBrandLinks.ts`: signature gains `opts?: { includeCancelled?: boolean }`; query key from the
  factory with the param; all other options unchanged. Existing callers compile unchanged (param optional).
- NEW `mingla-business/src/hooks/usePartnerBrandLinkMutations.ts`: `useCancelPendingLink()`,
  `useDisconnectLink()`, `useReissueInvitation()` — React Query mutations, each with `onError` (toast) and
  `onSuccess` invalidating `partnerBrandLinksKeys.all`. `useCancelPendingLink` ADDITIONALLY mirrors the
  exact invalidation + current-brand fallback semantics of `useSoftDeleteBrand`
  (`src/hooks/useBrands.ts` — pessimistic, Decision 10): the auto-deleted brand must vanish from the
  switcher/list caches identically to a manual delete.
- NEW `useBrandPartnerLinks(brandId)` (may live in `usePartnerBrandLinks.ts`): owner-side query,
  `enabled` on auth + brandId.

### 4.6 Components

**`app/partner/brands.tsx`**
1. Header right slot (`:125`, today an empty 36px spacer): render `IconChrome` add-affordance —
   `accessibilityLabel="Set up another partner brand"`, `testID="partner-brands-add-button"`,
   `onPress={handleSetUpFirst}` (existing wizard route `/brand/new?partner_mode=client`). Rendered in ALL
   states (loading included — the route is always valid). Empty-state CTA stays byte-identical (SC-1).
2. Hook call becomes `usePartnerBrandLinks({ includeCancelled: true })` (OQ-3). Header counts (`:101-104`)
   are already status-filtered — cancelled rows MUST NOT alter them (SC-13).
3. Sorting: `STATUS_RANK` unchanged (cancelled = 3 → last); within cancelled, sort `cancelled_at` desc.
4. Dormant `cancelled` branches go LIVE with reason-aware copy — `statusLabel` for cancelled rows becomes
   reason-driven: `partner_cancelled`→"Cancelled", `owner_declined`→"Declined by owner",
   `invitation_revoked`→"Invite revoked", `partner_disconnected`→"Disconnected",
   `owner_removed`→"Disconnected by owner", NULL→"Cancelled". Subtext: `Cancelled {timeAgo(cancelled_at)}`
   (verb adjusted per reason). Greyed row styling per DESIGN.
5. Expired derivation: when `isInviteExpired(row)`, the awaiting_owner row renders label "Invite expired"
   + subtext `Expired {timeAgo(invited_at + 7d)}` (rank unchanged — needs attention).
6. Row tap: `awaiting_owner`/`awaiting_stripe`/`active` rows open the NEW `PartnerLinkDetailSheet`
   (replacing direct `/brand/{id}` push — the dashboard nav moves INTO the sheet); cancelled rows open the
   sheet in terminal read-only mode.

**`src/components/partner/PartnerLinkDetailSheet.tsx` (NEW)** — content/verbs/states contract (exact
layout/pixels = DESIGN's job, §DESIGN inputs):
- Content: brand name + thumb; honest status (incl. expired + reason labels); `invited_owner_email`;
  `personal_note` when present; ABSOLUTE timestamps (locale date) for `invited_at`, `accepted_at`,
  `owner_stripe_connected_at`, `first_split_at`, `cancelled_at` — render only the ones that are set.
- Verbs by state:
  - `awaiting_owner` (incl. expired): **Resend invite** (same email), **Correct email & resend**
    (inline email input, validated), **Cancel invite** (destructive), **Open brand dashboard**.
  - `awaiting_stripe` / `active`: **Disconnect** (destructive), **Open brand dashboard**.
  - cancelled: read-only terminal info; NO dashboard nav when the brand is deleted (SC-14). "Invite
    again" is a SHOULD (backend already supports a fresh link post-cancel, F-2/Q7) — DESIGN/product call.
- Destructive verbs are confirm-gated (two-step). The cancel confirm copy MUST disclose the brand
  deletion: default "This cancels the invite and deletes the draft brand you built. This can't be undone."
  Disconnect confirm default: "You'll stop earning from future sales for this brand. Money already earned
  still pays out."
- `has_upcoming_events` rejection renders the Decision-11 reject modal (default copy: "Cancel this
  invite's N upcoming events first, then cancel the invite."), NOT a toast-and-swallow.
- States: idle / submitting (verbs disabled, spinner) / error (typed message + retry) / success (sheet
  dismiss + list refresh via invalidation). All interactive elements ≥44pt with a11y labels.

**`app/brand/[id]/team.tsx` + `src/components/team/MemberDetailSheet.tsx`**
- Team screen (owner view) queries `useBrandPartnerLinks(brandId)`; a member row whose `user_id` matches
  an accepted, non-cancelled link's `partner_account_id` is the PARTNER row → badge "Mingla Partner"
  (DESIGN styles it).
- `MemberDetailSheet` gains an OWNER-ONLY destructive action for exactly that row: "Disconnect partner"
  (confirm-gated; default copy "They'll lose team access and stop earning from future sales. Money
  already earned still pays out."), wired to `useDisconnectLink`. Gate: caller rank = brand_owner AND the
  row is the matched partner. **`handleRemove` stays a no-op for every other member** (ORCH-1051
  untouched — SC-9).
- Pending-invite revoke path in `team.tsx`/`brandInvitationsService.ts` is UNCHANGED in code — the §4.1-3
  trigger now stamps the link server-side (F-6 closed for every writer, present and future).

**`app/(tabs)/account.tsx`** — NO file change. Its `usePartnerBrandLinks()` call keeps the
exclude-cancelled default; counts are additionally status-filtered. SC-13 + T-6 pin the semantics.

### 4.7 Realtime — none. List freshness rides existing query invalidation + `staleTime: 30_000` +
refetch-on-focus (unchanged).

## 5. Success criteria (numbered, observable; business iOS/Android parity automatic — tester smoke-runs both)

- **SC-1** With ≥1 link (any status), `/partner/brands` shows a header add-affordance
  (`partner-brands-add-button`) that opens `/brand/new?partner_mode=client`. The zero-links empty-state
  CTA renders byte-identical to today.
- **SC-2** Tapping any row opens the detail sheet showing `invited_owner_email`, `personal_note` (when
  set), absolute timestamps, and honest status. Dashboard nav is a sheet verb, available for
  non-cancelled rows only.
- **SC-3** `awaiting_owner` rows (incl. expired) offer Resend, Correct-email, and Cancel — each
  confirm-gated where destructive.
- **SC-4** Resend (same email): old accept URL → 410 (`invite_expired` P0003 path); a NEW email is
  delivered with a working token; `invited_at` refreshes ("Invite sent just now"); NO new
  `partner_brand_links` row; email value unchanged.
- **SC-5** Correct-email: invitation AND link both carry the new address atomically; accepting from the
  corrected address stamps `accepted_at` (F-7 cured on this path); old token 410s.
- **SC-6** Cancel-pending (confirmed): in ONE transaction the link becomes `cancelled` /
  `partner_cancelled`, the pending invitation is revoked (owner's accept URL → 410 `invite_revoked`), the
  pre-accept brand is soft-deleted (vanishes from the partner's switcher/brand list), and
  `default_brand_id` clears if it pointed there. No partial outcome is observable under any failure.
- **SC-7** Cancel-pending on a brand with ≥1 upcoming `scheduled`/`live` event: typed
  `has_upcoming_events` rejection with the count, reject-modal shown, ZERO writes.
- **SC-8** Disconnect (partner-initiated, `awaiting_stripe`/`active`): link → `cancelled` /
  `partner_disconnected` AND the partner's `brand_team_members.removed_at` stamps in the same
  transaction. A charge with `p_at` before the stamp still resolves the partner and splits; a charge
  at/after the stamp does not. Pending/retrying `partner_splits` rows continue to completion untouched.
- **SC-9** Owner-initiated: on the Team screen the partner member row carries the partner badge; the
  owner (rank brand_owner) can Disconnect it (reason `owner_removed`, same dual stamp). Every OTHER
  member's remove remains inert exactly as today.
- **SC-10** Team-screen revoke of a pending `brand_owner` invitation on a linked brand stamps the link
  `cancelled` / `invitation_revoked` (F-6 side door closed) — with zero changes to the revoke client code.
- **SC-11** Owner decline stamps the link `cancelled` / `owner_declined`; the partner's list shows it.
- **SC-12** 7-day-expired `awaiting_owner` rows render "Invite expired" (not a live "Awaiting Owner") and
  the detail sheet's Resend revives the engagement — a UI re-invite path now exists post-expiry (D-4/F-8).
- **SC-13** Cancelled rows render greyed, sorted last, with reason-specific labels; the Brands header
  count and the Account row count NEVER include cancelled rows.
- **SC-14** A cancelled row whose brand was auto-deleted still renders the brand's real name (embed) and
  offers NO dashboard navigation.
- **SC-15** Cancel-vs-accept race with a live token: exactly one side wins. Accept-first → cancel returns
  `link_not_pending` and the new owner's brand is NEVER deleted; cancel-first → accept returns
  `invite_revoked` (P0005). Never both.
- **SC-16** Reissue email-send failure: 502 surfaced, new invitation row deleted (not revoked — the
  trigger MUST NOT fire), link not cancelled, retry succeeds.
- **SC-17** Accept-side behavior for valid, live tokens is byte-identical (ORCH-1373 accept-gate lineage
  undisturbed; the accept RPC's `cancelled_at IS NULL AND accepted_at IS NULL` stamp predicate — latest
  definition `20260926000000:112-113` — already excludes cancelled links, verified).

## 6. Invariants

**Preserved (with mechanism + verifying test):**
- `I-PROPOSED-1331-LINK-COLUMNS-FROZEN` (ACTIVE) — column ADDITION + value updates only; no renames;
  `deriveLinkStatus` case tree untouched; service reads by existing names. Verified by T-2 + the
  migration's post-apply probe asserting `partner_brand_link_status` intact. The service file's
  DO-NOT-TOUCH listing is amended BY THIS SPEC with the citation in §4.4.
- `I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT` + `-SHARE-FROM-PLATFORM-FEE` (ACTIVE, strict-grep-gated) —
  no split-path files touched; no rate literal anywhere new; gates stay green (T-12 runs the gates).
- `I-PROPOSED-1331-NUBAN-NEVER-PERSISTED` — untouched surface.
- ORCH-1373 accept-gate lineage (COMMS-0099/0106; batch still in flight on its PR) — zero accept-route
  file changes; SC-17.
- `feedback_rls_returning_owner_gap` — the one new policy uses an inline EXISTS predicate.
- Unified release/version parity, OTA-per-platform, etc. — no version bump in this ORCH (pure-JS client
  work + backend; OTA eligibility per policy, sequencing in §8).

**NEW — pre-staged DRAFT (orchestrator flips ACTIVE at CLOSE):**
- **I-PROPOSED-1384-CANCEL-IS-MULTI-OBJECT (DRAFT):** cancel-pending is a single-transaction verb —
  link stamp + invitation revoke + brand soft-delete + default-brand clear never partially apply. Only
  `partner_cancel_pending_link` may perform it. Test: T-7 (forced mid-sequence failure → zero writes).
- **I-PROPOSED-1384-DISCONNECT-STAMPS-BOTH (DRAFT):** any active-link termination stamps
  `partner_brand_links.cancelled_at` AND the partner's `brand_team_members.removed_at` in one
  transaction; a link-only or team-only stamp is a defect. Test: T-8.
- **I-PROPOSED-1384-INFLIGHT-SPLITS-PAY-OUT (DRAFT):** no ORCH-1384 code path writes `partner_splits`;
  the time-pinned resolver is the sole money gate. Test: A-2 + grep-style assert (no `partner_splits`
  token in the new RPCs/fn).
- **I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-REVOKES (DRAFT):** reissue kills old tokens ONLY via
  `expires_at = now()` (status stays `pending`); `revoked`/`declined` transitions are reserved for
  genuine kills and (via the trigger) terminally cancel the link. Compensation paths use DELETE, never
  revoke. Test: T-4 + A-5.
- **I-PROPOSED-1384-LINK-LIFECYCLE-COHERENCE (DRAFT):** no `brand_owner`-invitation terminal transition
  (revoke/decline) may leave a live `awaiting_owner` link — enforced by
  `partner_brand_links_invite_kill_trigger` for every writer, present and future. Test: T-3 + A-5.

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 | SQL contract: migration objects | post-apply introspection | column+check+policy+trigger+3 RPCs present; partial idx + status fn intact | schema |
| T-2 | Service default read byte-compatible | `listPartnerBrandLinks()` | cancelled excluded; select incl. `cancelled_reason`; key excludes flag | service |
| T-2b | Include-cancelled path | `{ includeCancelled: true }` | cancelled rows returned; distinct query key | service |
| T-3 | Trigger stamps on revoke | RLS-client revoke of pending owner invite on linked brand | link `cancelled`/`invitation_revoked` | schema/runtime |
| T-3b | Trigger stamps on decline | decline fn transition | link `cancelled`/`owner_declined` | schema/runtime |
| T-3c | Trigger ignores accepted links | revoke a later owner-invite on a brand with an ACTIVE link | active link untouched (`accepted_at IS NULL` guard) | schema |
| T-4 | Reissue same email (handler probe, scripted supabase double) | `POST {link_id}` | 201; old invite expire-now'd (NOT revoked); new insert; link `invited_at` refreshed; NO link INSERT | edge/runtime |
| T-4b | Reissue corrected email | `POST {link_id, new_email}` | invitation + link both carry new email; accept-stamp predicate matches | edge/schema |
| T-4c | Reissue send-failure rollback | Resend double returns failure | 502; new invitation DELETEd; link NOT cancelled | edge |
| T-5 | Expiry derivation boundary | `invited_at = now-7d ±1min` | `isInviteExpired` flips exactly at 7d; `INVITE_EXPIRY_DAYS === 7` pinned to edge constant | service |
| T-6 | Count semantics | rows incl. cancelled | header + account counts exclude cancelled | component |
| T-7 | Cancel-pending happy + atomicity | confirmed cancel | SC-6 quad-outcome; forced mid-tx failure → zero writes | schema/runtime |
| T-7b | Cancel blocked by events | brand w/ future scheduled event | `has_upcoming_events` + count; zero writes; reject modal | schema/component |
| T-8 | Disconnect dual stamp | partner + owner initiations | link reason correct per caller; team `removed_at` same tx; stranger → `forbidden` | schema |
| T-9 | Deleted-brand embed renders | cancelled row, brand soft-deleted | brand name renders via embed; no dashboard verb; switcher excludes brand | data/component |
| T-10 | Add affordance | every list state | `partner-brands-add-button` present, routes to wizard; empty-state CTA unchanged | component |
| T-11 | Detail sheet states | each status incl. cancelled/expired | correct verb set per §4.6; destructive verbs confirm-gated | component |
| T-12 | Strict-grep gates | run orch-1331 gates + suite | all green on the branch | CI |

**Adversarial angles the TESTER must attack from a different direction (named, per dispatch):**
- **A-1 cancel-then-accept race:** drive BOTH orderings against real lock semantics (concurrent
  transactions, not sequential mocks). Assert SC-15 — especially that an accept-win leaves the new
  owner's brand undeleted and the link stamped `accepted`, and that the cancel verb can never fire after.
- **A-2 disconnect-at-the-boundary money:** charges at `removed_at - ε`, `removed_at` exactly, and
  `removed_at + ε` — resolver includes only the first (strict `removed_at > p_at`); a `retrying` split
  in flight at disconnect still reaches `transferred` (the ONLY post-cancel delta is the suppressed
  first-split celebratory push via existing `.is("cancelled_at", null)` filters — transfer itself pays).
- **A-3 corrected-email vs the 23505 swallow:** prove the reissue path never touches the swallow
  (no link INSERT); then prove the RAW team-screen re-invite still swallows (documented residual D-1) so
  the two paths are not confused in the report.
- **A-4 deleted-brand embed:** attack the RLS assumption in §2 directly — live-verify a partner can still
  SELECT their soft-deleted brand through the embed; try `/brand/{deleted-id}` cold nav for a sane
  not-found (no crash).
- **A-5 trigger provenance/control-flow (COMMS-0106 lesson):** verify the trigger via the REAL RLS-client
  revoke write path (not just psql), and that reissue's expire-now does NOT stamp; any slice-and-execute
  style test must carry uniqueness + no-preempting-control-flow companions.
- **A-6 authz sweep:** owner-select policy leaks nothing cross-brand; random authenticated user gets 0
  rows and `forbidden` from both RPCs; the OWNER calling cancel-pending (pre-accept) gets `forbidden`
  (partner-only verb); service-role-only grant on the reissue RPC holds (authenticated call fails).

## 8. Implementation order

1. **Migration** `supabase/migrations/20270102000000_orch_1384_partner_link_lifecycle.sql` (§4.1) —
   committed; APPLIED BY ORCHESTRATOR after pre-apply probe.
2. **Email extraction** `_shared/brandInviteEmail.ts` + `invite-brand-member/index.ts` import swap (§4.3);
   existing invite tests stay green.
3. **Edge fn** `partner-reissue-invitation/index.ts` + `config.toml` stanza (§4.2). Deployed by
   ORCHESTRATOR (with first-call curl verify) — never by the implementor.
4. **Service** `partnerBrandLinksService.ts` (§4.4) with the invariant citation header.
5. **Hooks** `usePartnerBrandLinks.ts` + new `usePartnerBrandLinkMutations.ts` (§4.5).
6. **Components** `PartnerLinkDetailSheet.tsx` (new) → `brands.tsx` → `team.tsx` + `MemberDetailSheet.tsx` (§4.6).
7. **Tests** T-1..T-12 (new files only — append-only gate untriggered; if ANY existing test file needs a
   deletion-bearing edit, the `[TEST-MOD-APPROVED ORCH-1384]` token must ride whatever commit is HEAD,
   re-verified after every rebase/amend — COMMS-0106 trap).
8. Sequencing rule: migration + edge deploy land BEFORE any client OTA/build carrying the new verbs (old
   clients are unaffected — additive column, unchanged defaults).

**File allowlist (implementor may change NOTHING else without a SPEC amendment):**
`supabase/migrations/20270102000000_orch_1384_partner_link_lifecycle.sql` (new) ·
`supabase/functions/partner-reissue-invitation/index.ts` (new) ·
`supabase/functions/_shared/brandInviteEmail.ts` (new) ·
`supabase/functions/invite-brand-member/index.ts` (import-swap ONLY) ·
`supabase/config.toml` (one stanza) ·
`mingla-business/src/services/partnerBrandLinksService.ts` ·
`mingla-business/src/hooks/usePartnerBrandLinks.ts` ·
`mingla-business/src/hooks/usePartnerBrandLinkMutations.ts` (new) ·
`mingla-business/src/components/partner/PartnerLinkDetailSheet.tsx` (new) ·
`mingla-business/app/partner/brands.tsx` ·
`mingla-business/app/brand/[id]/team.tsx` ·
`mingla-business/src/components/team/MemberDetailSheet.tsx` ·
new test files for T-1..T-11.

**DO-NOT-TOUCH (hard):** `supabase/functions/accept-brand-invitation/**`,
`supabase/functions/decline-brand-invitation/**` (trigger covers it), `supabase/functions/paystack-webhook/**`,
`supabase/functions/_shared/partnerSplits.ts`, `supabase/functions/_shared/paystackPartnerSplits.ts`,
every existing migration file, `resolve_partner_for_brand_at_time`, `partner_brand_link_status`,
`mingla-business/src/services/brandInvitationsService.ts`, `mingla-business/src/services/brandsService.ts`,
`mingla-business/src/components/brand/BrandCreationFlow.tsx`, `mingla-business/app/partner/earnings.tsx`,
`mingla-business/app/(tabs)/account.tsx`, `mingla-admin/**`, `app-mobile/**`, all `.github/**` gates.

## 9. Regression prevention (fails-on-revert contract — CLOSE Step 0.5)

- **Structural safeguard:** the invite-kill trigger makes lifecycle coherence a DB property (writer-
  independent), and the two RPCs are the only write paths for their verbs (RLS stays SELECT-only for
  clients on the link table).
- **Fails-on-revert proofs the implementor MUST demonstrate (revert → red, restore → green), each with a
  protective "why" comment:**
  1. Revert the §4.6-1 header slot to the empty spacer → T-10 red (asserts the testID + route).
  2. Strip `includeCancelled` handling or drop `cancelled_reason` from the select → T-2/T-2b red.
  3. Drop the trigger from the migration (or its `accepted_at IS NULL` guard) → T-3/T-3c red.
  4. Change reissue's expire-now to a revoke → T-4 red (asserts status stays `pending` AND the link
     survives un-cancelled).
  5. Remove the team-stamp from `partner_disconnect_link` → T-8 red.
  6. Remove the brand soft-delete or invitation revoke from `partner_cancel_pending_link` → T-7 red.
- **Tester adversarial suite:** A-1..A-6 (§7) attack the same invariants from the runtime/race/RLS
  direction; per COMMS-0106, any source-slicing test ships with provenance + control-flow companions.
- **CI:** all existing strict-grep gates must stay green (T-12); no gate modifications are in scope.

## 10. Open questions

Header table (OQ-1384-A/B + OQ-8). Nothing else is unresolved; all four Seth rulings + the orchestrator's
corrected-email interpretation are encoded above. If REVIEW overturns the OQ-1384-A default
(block-on-upcoming-events), only RPC-1 step 5 and the reject-modal change — isolated by design.

## 11. Downstream routing

- **REVIEW** (orchestrator) → **DESIGN** (mingla-designer). DESIGN inputs needed:
  (1) header add-CTA treatment in the 36px right slot (IconChrome glyph choice — supply one if no
  plus/add exists in the set); (2) `PartnerLinkDetailSheet` layout for the §4.6 content/verb/state
  contract, incl. the two destructive confirms (cancel copy MUST keep the brand-deletion disclosure) and
  the correct-email inline input; (3) greyed cancelled-row style + reason labels; (4) "Mingla Partner"
  badge + owner-side Disconnect placement in `MemberDetailSheet`; (5) `has_upcoming_events` reject modal;
  (6) expired-row treatment. WCAG AA, ≥44pt, per-platform deltas per house rules.
- **IMPLEMENT** (mingla-implementor) — this spec + embedded design contract; stop-and-amend on any
  allowlist gap.
- **TEST** (mingla-tester) — SC-1..SC-17 + A-1..A-6; requires the OQ-8 partner sim login from Seth;
  physical-device-first policy applies.
- **CLOSE** (orchestrator) — flips the five DRAFT invariants ACTIVE; applies migration/deploys are
  orchestrator-owned; NOTE: main is RED per COMMS-0108 (`@mingla/phone-input` resolution break from
  PR #925) — the eventual PR cannot get a green rollup until the dep-lane fix lands; do not `--admin`
  merge over it.
- Working tree: `~/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/` on branch
  `ORCH-1384-partner-brand-management`.
