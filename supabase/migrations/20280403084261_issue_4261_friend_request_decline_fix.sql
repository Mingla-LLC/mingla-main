-- Issue #4261 — declining a pending friend request works again.
--
-- Declining is a direct UPDATE friend_requests SET status = 'declined' by the
-- receiver (app-mobile useFriends.declineFriendRequest and
-- useNotifications.declineFriendRequestAction, under the fr_update policy).
-- The baseline squash (20260505000000) still carried the trigger
-- trg_cascade_fr_decline_to_links (AFTER UPDATE ON friend_requests), whose
-- function cascade_friend_request_decline_to_links() updates
-- public.friend_links on pending -> declined. That table was dropped in
-- 20260312300003_remove_friend_link_feature.sql, so every decline aborted with
-- "relation public.friend_links does not exist".
--
-- Subtract, don't patch: the friend-link feature is gone, so the trigger and
-- its function are dropped. No other trigger on friend_requests changes.
-- Static SQL, idempotent.

BEGIN;

DROP TRIGGER IF EXISTS "trg_cascade_fr_decline_to_links" ON "public"."friend_requests";
DROP FUNCTION IF EXISTS "public"."cascade_friend_request_decline_to_links"();

COMMIT;
