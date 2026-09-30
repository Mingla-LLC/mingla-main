-- Issue #3622 — reassigning a brand owner left the previous owner with full access.
--
-- `public.admin_reassign_brand_owner` armed the txn-local transfer bypass, updated
-- `brands.account_id`, wrote an audit row and returned. It touched
-- `public.brand_team_members` NOT AT ALL, in either direction.
--
-- `biz_create_brand_owner_team_member` — the trigger that creates an owner's
-- membership row — is bound AFTER INSERT ON public.brands only. There is no UPDATE
-- binding, so a reassignment cannot fire it. Neither UPDATE-side guard maintains
-- membership either: `biz_prevent_brand_account_id_change` only permits the write when
-- the bypass GUC is armed, and `issue_2101_guard_brand_owner_transfer` only refuses
-- when the brand has an active named ticket checkout.
--
-- WHY THAT GRANTS ACCESS. `biz_brand_effective_rank` is GREATEST of two arms:
--   (a) rank 60 when `brands.account_id = p_user_id`, and
--   (b) max(biz_role_rank(role)) over `brand_team_members` rows that are
--       `removed_at IS NULL AND accepted_at IS NOT NULL`.
-- The outgoing owner's row was written by the insert trigger with role='brand_owner',
-- accepted_at = created_at, removed_at = NULL. Arm (b) therefore kept returning 60 for
-- them indefinitely, on a brand they no longer owned. Arm (a) correctly served the
-- incoming owner, which is exactly why the handover LOOKED like it worked and the
-- retained access was invisible.
--
-- NEVER TRIGGERED IN PRODUCTION. `admin_audit_log` holds 129 rows and 0 with
-- action = 'brand.reassign_owner'; the live query for an active accepted brand_owner
-- row whose user_id differs from its brand's account_id returns 0 rows. The denominator
-- is what makes that zero evidence rather than an empty-table artefact. There is no
-- victim to remediate — only a latent defect to close before the first support-driven
-- handover creates the condition silently.
--
-- THE CONTRACT — the outgoing owner loses brand access entirely:
--   1. The outgoing owner's active brand_owner row is CLOSED (`removed_at = now()`),
--      in the same transaction as the `brands.account_id` update. Their effective
--      rank on that brand becomes 0.
--   2. The incoming owner GETS a real brand_owner row with `accepted_at` set, so the
--      two arms of `biz_brand_effective_rank` agree rather than one silently covering
--      for the other. A synthesised owner is by definition accepted; the insert
--      trigger uses `created_at` for both invited_at and accepted_at and this mirrors
--      that convention with a single reassignment timestamp.
--
-- SCOPE NOTE — only the OWNERSHIP grant is withdrawn, and only the row belonging to the
-- account that owned the brand immediately before the UPDATE. The baseline already carries
-- a UNIQUE partial index — `idx_brand_team_members_brand_user_active` on
-- (brand_id, user_id) WHERE removed_at IS NULL — so a given user holds AT MOST ONE active
-- row per brand and there is nothing else of theirs to withdraw. (An earlier draft of this
-- header claimed no such constraint existed. It does, since the baseline squash; the #3622
-- tester suite pins it from the catalogue and by an executed write that raises
-- unique_violation, group T9.) The deterministic `ORDER BY ... LIMIT 1` promotion below is
-- therefore kept as defence if that index is ever dropped, not because a second candidate
-- row exists today.
--
-- KNOWN LIMITATION — that index constrains (brand_id, user_id), NOT (brand_id, role), so two
-- DIFFERENT users can each hold an active accepted brand_owner row on one brand. The
-- revocation below is filtered on `user_id = v_old_owner`, so a co-owner's brand_owner row
-- SURVIVES the handover and keeps them at rank 60 on a brand they do not own. Production has
-- ZERO brands in that state — 47 active accepted brand_owner rows exist and none is orphaned
-- from its brand's account_id — so the precondition does not exist today. Deliberately NOT
-- fixed here: widening the predicate changes WHO a handover revokes, which is a product
-- decision, not a defect fix.
--
-- CONCURRENCY — the `v_before` SELECT below takes `FOR UPDATE`. Without that row lock a
-- second admin reassigning the SAME brand under READ COMMITTED reads `v_before` while the
-- first handover is still uncommitted, blocks on the UPDATE, and then revokes a STALE
-- v_old_owner — leaving the REAL outgoing owner active at rank 60 on a brand they no longer
-- own, which is exactly the condition this migration exists to eliminate, and writing an
-- audit `before` blob naming the wrong outgoing owner so support's only record of the
-- handover is false. Measured with two genuinely independent sessions rather than reasoned
-- about (#3622 tester suite, group T11). The sibling path
-- `accept_invite_and_transfer_brand_ownership` already locks the brand row first
-- (`SELECT * INTO v_brand_record FROM public.brands WHERE id = ... FOR UPDATE`); this
-- follows the convention that already existed.
--
-- PRESERVED VERBATIM from 20261208000005: SECURITY DEFINER, SET search_path TO
-- 'public', the is_admin_user() guard as the FIRST statement, the reason_required
-- check, the invalid_new_owner check, the set_config bypass arming, and the
-- admin_write_audit call and its metadata shape. This migration ADDS membership
-- maintenance and the brand-row lock described under CONCURRENCY; it does not otherwise
-- rewrite the function.
--
-- Enforces: I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT, -ADMIN-WRITE-AUDITED,
--           -ADMIN-SINGLE-GATE.

CREATE OR REPLACE FUNCTION public.admin_reassign_brand_owner(
  p_brand_id       uuid,
  p_new_account_id uuid,
  p_reason         text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_before    jsonb;
  v_after     jsonb;
  v_old_owner uuid;
  v_now       timestamptz;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- guard FIRST
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  -- FOR UPDATE (issue #3622 rework): serialize concurrent reassignments of the same
  -- brand, so v_old_owner below cannot be an owner already replaced by another
  -- admin's uncommitted handover. Same lock the sibling transfer path takes.
  SELECT to_jsonb(b) INTO v_before FROM public.brands b WHERE b.id = p_brand_id FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_accounts
                 WHERE id = p_new_account_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_new_owner';
  END IF;
  -- ORCH-1276 P1 fix: arm the txn-local bypass for biz_prevent_brand_account_id_change()
  -- (is_local=true -> transaction-scoped) — the SAME mechanism ORCH-1081 uses. Without
  -- it the trigger raises 'brands.account_id is immutable' and the reassign fails.
  PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);
  UPDATE public.brands SET account_id = p_new_account_id, updated_at = now()
   WHERE id = p_brand_id RETURNING to_jsonb(brands) INTO v_after;

  -- ===========================================================================
  -- Issue #3622 — membership maintenance, same transaction as the account_id
  -- update above. Placed AFTER the UPDATE deliberately: by this point
  -- brands.account_id is already the incoming owner, so the outgoing owner is no
  -- longer the account owner and closing their row cannot orphan the brand.
  -- ===========================================================================
  v_old_owner := (v_before->>'account_id')::uuid;
  v_now       := now();

  -- (1) OUTGOING owner — withdraw the ownership grant. Guarded on DISTINCT so a
  -- no-op reassignment to the incumbent does not revoke the owner it just kept.
  IF v_old_owner IS NOT NULL AND v_old_owner IS DISTINCT FROM p_new_account_id THEN
    -- Accepted rows are soft-closed. brand_team_members_accepted_removed_excl is
    -- (removed_at IS NULL OR accepted_at IS NOT NULL), so a never-accepted row
    -- cannot carry removed_at — it is deleted instead. Same branch
    -- admin_remove_team_member uses for the same constraint.
    UPDATE public.brand_team_members
       SET removed_at = v_now  -- NO updated_at on this table
     WHERE brand_id    = p_brand_id
       AND user_id     = v_old_owner
       AND role        = 'brand_owner'
       AND removed_at  IS NULL
       AND accepted_at IS NOT NULL;

    DELETE FROM public.brand_team_members
     WHERE brand_id    = p_brand_id
       AND user_id     = v_old_owner
       AND role        = 'brand_owner'
       AND removed_at  IS NULL
       AND accepted_at IS NULL;
  END IF;

  -- (2) INCOMING owner — idempotent, mirroring the EXISTS-guard care in
  -- biz_create_brand_owner_team_member. Three cases:
  --   already an active brand_owner row  -> only ensure it is accepted, so arm (b)
  --                                         of biz_brand_effective_rank counts it
  --   an active row at some other role   -> promote exactly ONE, deterministically
  --   no active row at all               -> insert, mirroring the trigger's shape
  IF EXISTS (
    SELECT 1 FROM public.brand_team_members
     WHERE brand_id = p_brand_id AND user_id = p_new_account_id
       AND role = 'brand_owner' AND removed_at IS NULL
  ) THEN
    UPDATE public.brand_team_members
       SET accepted_at = v_now
     WHERE brand_id    = p_brand_id
       AND user_id     = p_new_account_id
       AND role        = 'brand_owner'
       AND removed_at  IS NULL
       AND accepted_at IS NULL;
  ELSE
    UPDATE public.brand_team_members
       SET role        = 'brand_owner',
           accepted_at = COALESCE(accepted_at, v_now)
     WHERE id = (
       SELECT m.id FROM public.brand_team_members m
        WHERE m.brand_id = p_brand_id
          AND m.user_id  = p_new_account_id
          AND m.removed_at IS NULL
        ORDER BY public.biz_role_rank(m.role) DESC, m.invited_at ASC, m.id ASC
        LIMIT 1
     );
    IF NOT FOUND THEN
      INSERT INTO public.brand_team_members (
        brand_id, user_id, role, invited_at, accepted_at, removed_at,
        mingla_tos_accepted_at, mingla_tos_version_accepted
      ) VALUES (
        p_brand_id, p_new_account_id, 'brand_owner',
        v_now,
        v_now,   -- a synthesised owner is by definition accepted
        NULL,    -- active
        NULL,    -- INTENTIONAL: the incoming owner traverses the V3 ToS gate,
        NULL     -- exactly as biz_create_brand_owner_team_member leaves a new owner.
      );
    END IF;
  END IF;
  -- =========================== end issue #3622 ===============================

  PERFORM public.admin_write_audit('brand.reassign_owner', 'brand', p_brand_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_reassign_brand_owner(uuid, uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reassign_brand_owner(uuid, uuid, text) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_reassign_brand_owner(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #3622: admin_reassign_brand_owner still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_reassign_brand_owner(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #3622: authenticated lost EXECUTE on admin_reassign_brand_owner (admin UI would break)';
  END IF;
END $$;

COMMENT ON FUNCTION public.admin_reassign_brand_owner(uuid, uuid, text) IS
  'Admin brand-owner reassignment. Issue #3622: maintains brand_team_members in the '
  'same transaction as the brands.account_id update — the outgoing owner''s active '
  'brand_owner row is closed and the incoming owner gets a real accepted brand_owner '
  'row, so both arms of biz_brand_effective_rank agree.';

-- ===========================================================================
-- THE ALTERNATIVE THAT WAS IMPLEMENTED, TESTED AND REJECTED — read this before
-- proposing it again.
--
-- "Surely demoting the outgoing owner to brand_admin is the gentler option" is the
-- obvious suggestion, and it is wrong: demotion is not a weaker form of removal, it
-- is a control that does not function. It was built and executed against the full
-- 602-migration schema, and the demoted user restored themselves to rank 60 with a
-- single write, acting only as themselves:
--
--   STEP 1 — after demotion, outgoing owner effective rank = 50
--   STEP 2 — demoted user self-promoted, rows written by them = 1
--   STEP 3 — outgoing owner effective rank is now = 60
--   VERDICT: DEMOTION IS SELF-REVERSIBLE — the demoted owner restored rank 60 unaided.
--
-- The route is the RLS policy "Brand admin plus update brand_team_members" on
-- public.brand_team_members: USING and WITH CHECK are both
-- biz_is_brand_admin_plus_for_caller(brand_id) (rank >= 50) and neither constrains the
-- role value being written. `authenticated` holds UPDATE/INSERT/DELETE on the table and
-- there are zero non-internal triggers on it, so a demoted owner reaches it directly
-- with one PostgREST PATCH of their own row — no admin involved, no audit row, nothing
-- surfaced in the product. (That escalation exists today for any brand_admin, which is
-- issue #3632; it is not created by this migration and is not fixed here.)
--
-- Demotion also fails on its own terms independently of the escalation: rank 50 keeps
-- the brand's money, because biz_can_manage_payments_for_brand is
-- biz_is_brand_admin_plus(...) OR finance_manager. A demoted ex-owner would retain
-- Stripe Connect and payout authority, plus team management, the audit log and the
-- contact-book export. Only six owner-only capabilities are above rank 50, all
-- venue-claim / venue-listing shaped.
--
-- Removal is what holds, and the same attack proves it:
--
--   STEP 1 — after removal, outgoing owner effective rank = 0
--   STEP 2b — their INSERT was refused: new row violates row-level security policy
--   STEP 2 — rows they could UPDATE = 0, rows they could INSERT = refused
--   VERDICT: REMOVAL HOLDS — at rank 0 every write policy refuses them.
--
-- Removal is also the reversible direction: an admin can re-grant deliberately, which
-- is the right asymmetry. The rejected block is kept below only so this reasoning has
-- something concrete to attach to.
--
--   IF v_old_owner IS NOT NULL AND v_old_owner IS DISTINCT FROM p_new_account_id THEN
--     UPDATE public.brand_team_members
--        SET role = 'brand_admin'
--      WHERE brand_id    = p_brand_id
--        AND user_id     = v_old_owner
--        AND role        = 'brand_owner'
--        AND removed_at  IS NULL
--        AND accepted_at IS NOT NULL;
--   END IF;
-- ===========================================================================
