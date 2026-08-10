-- issue #1771 (Wave 0 of #876) — remove the dormant, broken reciprocity trigger.
-- accept_friend_request() references friends.friend_id, a column that does not
-- exist (the real column is friend_user_id). It is unreachable today ONLY
-- because plpgsql compiles lazily and no live row makes the pending→accepted
-- transition; a single pre-existing pending friends row would make
-- accept_friend_request_atomic()'s ON CONFLICT DO UPDATE fire it and abort the
-- whole accept. Reciprocity is owned solely by accept_friend_request_atomic()
-- (baseline 20260505000000:174-264). Verified before drop: no other trigger,
-- function, or client references accept_friend_request().
drop trigger if exists accept_friend_request_trigger on public.friends;
drop function if exists public.accept_friend_request();
