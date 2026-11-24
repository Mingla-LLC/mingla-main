-- #4490 P3 (before P3-1) — who may act on a venue booking.
--
-- A venue booking (`stay_reservation_groups` with offer_kind set) is opened,
-- paid, read and cancelled through the service-role RPCs behind edge
-- `venue-offers`. The edge function passes the caller as either the booking
-- token's SHA-256 or the verified user id; `issue_4490_booking_actor_ok`
-- decides. A booking bought signed-out has user_id and booked_by_user_id NULL,
-- so the user-id comparison evaluated to NULL rather than false, the whole
-- check came back NULL, and `IF NOT FOUND OR NOT <NULL>` let the call through:
-- any signed-in user who knew the group id could read the booking (guest name,
-- email, phone, pass code) or start a payment on it.
--
-- The check now answers true or false, never NULL: a user id is accepted only
-- for the booking's own user (user_id / booked_by_user_id); everyone else
-- needs the booking token. Staff read bookings through the staff paths
-- (venue-check-in and the Host RPCs), not through this check; the cancel path
-- keeps its own staff branch (money rights on that venue).
--
-- Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): restore issue_4490_booking_actor_ok from
-- 20281203084490_issue_4490_p2_offer_checkout.sql (not recommended).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.issue_4490_booking_actor_ok(
  p_group public.stay_reservation_groups,
  p_token_hash bytea,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    p_group.id IS NOT NULL
    AND p_group.offer_kind IS NOT NULL
    AND (
      (p_token_hash IS NOT NULL
       AND p_group.buyer_token_hash IS NOT NULL
       AND p_group.buyer_token_hash = p_token_hash)
      OR (p_user_id IS NOT NULL
          AND (p_group.user_id IS NOT DISTINCT FROM p_user_id
               OR p_group.booked_by_user_id IS NOT DISTINCT FROM p_user_id))
    ),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_booking_actor_ok(public.stay_reservation_groups, bytea, uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
