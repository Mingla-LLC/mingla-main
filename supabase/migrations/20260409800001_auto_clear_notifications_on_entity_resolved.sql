-- Migration: auto_clear_notifications_on_entity_resolved
-- ORCH-0349: When friend_requests, pair_requests, or collaboration_invites
-- leave 'pending' status, automatically delete the corresponding notification
-- row. This is the authoritative server-side cleanup — even if client code
-- fails, stale notifications get cleaned up.
--
-- SECURITY DEFINER is required because the notification's user_id may differ
-- from auth.uid() (e.g., the request sender accepted from their own device).
-- The trigger runs as the function owner, bypassing RLS.

-- ── Index for related_id lookups ──────────────────────────────────────────────
-- The trigger deletes by related_id. Without this index, every entity status
-- change would full-scan the notifications table.
CREATE INDEX IF NOT EXISTS idx_notifications_related_id
  ON public.notifications(related_id)
  WHERE related_id IS NOT NULL;

-- ── Trigger function (shared by all three tables) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_notifications_on_entity_resolved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_type TEXT;
BEGIN
  -- Only fire when status transitions FROM 'pending' to something else.
  -- Guards against unrelated updates (e.g., updated_at changes).
  IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status = 'pending' THEN
    RETURN NEW;
  END IF;

  -- Map table name → notification type
  CASE TG_TABLE_NAME
    WHEN 'friend_requests' THEN
      v_notification_type := 'friend_request_received';
    WHEN 'pair_requests' THEN
      v_notification_type := 'pair_request_received';
    WHEN 'collaboration_invites' THEN
      v_notification_type := 'collaboration_invite_received';
    ELSE
      RETURN NEW;
  END CASE;

  -- Delete matching notification(s). The related_id column stores the entity ID
  -- (set by notify-dispatch from the relatedId field in each edge function).
  -- This is idempotent — if the client already deleted it, 0 rows are affected.
  DELETE FROM public.notifications
    WHERE related_id = OLD.id::TEXT
      AND type = v_notification_type;

  RETURN NEW;
END;
$$;

-- ── Triggers ──────────────────────────────────────────────────────────────────

-- friend_requests: fires when status changes from 'pending' → anything else
DROP TRIGGER IF EXISTS trg_clear_notification_on_friend_request_resolved ON public.friend_requests;
CREATE TRIGGER trg_clear_notification_on_friend_request_resolved
  AFTER UPDATE ON public.friend_requests
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status IS DISTINCT FROM 'pending')
  EXECUTE FUNCTION public.delete_notifications_on_entity_resolved();

-- pair_requests: fires when status changes from 'pending' → anything else
DROP TRIGGER IF EXISTS trg_clear_notification_on_pair_request_resolved ON public.pair_requests;
CREATE TRIGGER trg_clear_notification_on_pair_request_resolved
  AFTER UPDATE ON public.pair_requests
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status IS DISTINCT FROM 'pending')
  EXECUTE FUNCTION public.delete_notifications_on_entity_resolved();

-- collaboration_invites: fires when status changes from 'pending' → anything else
DROP TRIGGER IF EXISTS trg_clear_notification_on_collab_invite_resolved ON public.collaboration_invites;
CREATE TRIGGER trg_clear_notification_on_collab_invite_resolved
  AFTER UPDATE ON public.collaboration_invites
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status IS DISTINCT FROM 'pending')
  EXECUTE FUNCTION public.delete_notifications_on_entity_resolved();
