-- MINGLA-INVARIANT: I-ARI-MEMORY-SCOPED | issue #3355 | An Ari memory note is readable only by its author (scope user) or by members of its brand (scope brand); a member of another brand never reads it, and only the author or a brand admin can forget it.
-- MINGLA-INVARIANT: I-ARI-MEMORY-NO-SENSITIVE | issue #3355 | public.ari_remember_note, ari_memory_save and ari_memory_update refuse payment, ID and contact details (emails, phone numbers, card-like numbers, password and ID words) server-side, are idempotent on the normalised words, and allow at most 20 new notes per user per hour.
--
-- Wave D (20280628063355). Reverting the migration fails the first block
-- (no ari_remember_note).

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('33550000-d100-4000-8000-000000000001','d1-owner@test.local','{"full_name":"Olu Owner"}'),
  ('33550000-d100-4000-8000-000000000002','d1-member@test.local','{"full_name":"Ada Member"}'),
  ('33550000-d100-4000-8000-000000000003','d1-outsider@test.local','{"full_name":"Out Sider"}');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('33550000-d100-4000-8000-000000000001','d1-owner@test.local','Olu Owner','d1_owner','business'),
  ('33550000-d100-4000-8000-000000000002','d1-member@test.local','Ada Member','d1_member','business'),
  ('33550000-d100-4000-8000-000000000003','d1-outsider@test.local','Out Sider','d1_outsider','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name) VALUES
  ('33550000-d100-4000-8000-000000000001','d1-owner@test.local','Olu Owner','D1 Host'),
  ('33550000-d100-4000-8000-000000000003','d1-outsider@test.local','Out Sider','D1 Other Host');
INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('33550000-d100-4000-8000-0000000000b1','33550000-d100-4000-8000-000000000001','Lantern Supper Club','d1-lantern-supper-club'),
  ('33550000-d100-4000-8000-0000000000b2','33550000-d100-4000-8000-000000000003','Harbour Nights','d1-harbour-nights');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
  ('33550000-d100-4000-8000-0000000000b1','33550000-d100-4000-8000-000000000002','event_manager',now());

CREATE TEMP TABLE d1_notes (key text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON d1_notes TO authenticated;

-- Helper: act as one user for the rest of the transaction block.
CREATE OR REPLACE FUNCTION pg_temp.d1_as(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END;
$$;

DO $d1$
DECLARE
  v_brand constant uuid := '33550000-d100-4000-8000-0000000000b1';
  v_other_brand constant uuid := '33550000-d100-4000-8000-0000000000b2';
  v_owner constant uuid := '33550000-d100-4000-8000-000000000001';
  v_member constant uuid := '33550000-d100-4000-8000-000000000002';
  v_outsider constant uuid := '33550000-d100-4000-8000-000000000003';
  v_note jsonb;
  v_again jsonb;
  v_list jsonb;
  v_error text;
  v_count bigint;
  v_text text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.d1_as(v_member);

  -- 1. A brand note from a member is shared with the brand.
  v_note := public.ari_remember_note('brand', 'correction',
    'Discount codes for influencers end on the event night, not a week after.', v_brand, NULL);
  IF v_note->>'scope' <> 'brand' OR (v_note->>'deduplicated')::boolean IS NOT FALSE
     OR v_note ? 'user_id' THEN
    RAISE EXCEPTION 'D1-1 brand note shape wrong: %', v_note;
  END IF;
  INSERT INTO d1_notes VALUES ('brand', (v_note->>'id')::uuid);

  -- 2. A private note stays the author's.
  v_note := public.ari_remember_note('user', 'preference', 'Keep replies short.', NULL, NULL);
  INSERT INTO d1_notes VALUES ('private', (v_note->>'id')::uuid);

  -- 3. The same words again are the same note (idempotent, case and spaces).
  v_again := public.ari_remember_note('user', 'preference', '  keep   REPLIES short. ', NULL, NULL);
  IF v_again->>'id' IS DISTINCT FROM v_note->>'id'
     OR (v_again->>'deduplicated')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D1-3 the repeat made a second note: % vs %', v_again, v_note;
  END IF;

  -- 4. Payment, ID and contact details are refused by the server.
  FOREACH v_text IN ARRAY ARRAY[
    'Email the guest list to ada@lantern.example',
    'Call me on +234 803 123 4567 about refunds',
    'My number is 0803 123 4567',
    'Use card 4111 1111 1111 1111 for ads',
    'The bank account number is in the notes',
    'My password is lantern2026',
    'My BVN is on file',
    'Passport number A1234567 for the visa'
  ] LOOP
    BEGIN
      PERFORM public.ari_remember_note('user', 'fact', v_text, NULL, NULL);
      v_error := 'none';
    EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
    END;
    IF v_error NOT LIKE 'memory_sensitive_content:%' THEN
      RAISE EXCEPTION 'D1-4 sensitive note accepted or wrong error (%): %', v_error, v_text;
    END IF;
  END LOOP;
  -- Ordinary facts with dates, times, prices and codes are fine.
  PERFORM public.ari_remember_note('brand', 'fact',
    'FAVY10 is 10% off and runs until 2026-12-19 at 23:59 Lagos time; tickets are 15000 NGN.', v_brand, NULL);
  -- The Host composer path refuses them too.
  BEGIN
    PERFORM public.ari_memory_save(NULL, 'fact', 'Text me on 07031234567', NULL);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error NOT LIKE 'memory_sensitive_content:%' THEN
    RAISE EXCEPTION 'D1-4 ari_memory_save accepted a phone number (%)', v_error;
  END IF;

  -- 5. Long notes, bad kinds and a brand note with no brand are refused.
  BEGIN
    PERFORM public.ari_remember_note('user', 'fact', repeat('a', 281), NULL, NULL);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'invalid_memory_content' THEN RAISE EXCEPTION 'D1-5 long note (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_remember_note('brand', 'fact', 'Shared fact', NULL, NULL);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'memory_brand_required' THEN RAISE EXCEPTION 'D1-5 brand note without brand (%)', v_error; END IF;

  -- 6. A member of another brand can't write into this brand.
  PERFORM pg_temp.d1_as(v_outsider);
  BEGIN
    PERFORM public.ari_remember_note('brand', 'fact', 'Planting a note', v_brand, NULL);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'D1-6 cross-brand write (%)', v_error; END IF;

  -- 7. Cross-brand note is never readable: not by RLS, not by the list.
  SELECT count(*) INTO v_count FROM public.ari_memory_notes;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'D1-7 an outsider read % note(s) through RLS', v_count;
  END IF;
  BEGIN
    PERFORM public.ari_memory_list(v_brand);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'D1-7 outsider listed the brand (%)', v_error; END IF;
  IF jsonb_array_length(public.ari_memory_list(v_other_brand)) <> 0 THEN
    RAISE EXCEPTION 'D1-7 brand A notes leaked into brand B';
  END IF;

  -- 8. The owner (a brand member) reads the shared notes, not the private one.
  PERFORM pg_temp.d1_as(v_owner);
  v_list := public.ari_memory_list(v_brand);
  IF jsonb_array_length(v_list) <> 2
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) x
                 WHERE x->>'id' = (SELECT id::text FROM d1_notes WHERE key = 'private')) THEN
    RAISE EXCEPTION 'D1-8 owner list wrong: %', v_list;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) x
                  WHERE (x->>'mine')::boolean IS FALSE AND (x->>'can_forget')::boolean IS TRUE) THEN
    RAISE EXCEPTION 'D1-8 a brand admin should be able to forget a shared note: %', v_list;
  END IF;
  SELECT count(*) INTO v_count FROM public.ari_memory_notes
   WHERE id = (SELECT id FROM d1_notes WHERE key = 'private');
  IF v_count <> 0 THEN RAISE EXCEPTION 'D1-8 RLS showed another user''s private note'; END IF;

  -- 9. Forget: not someone else's private note; a brand admin may forget a
  --    shared one; it then leaves every list.
  BEGIN
    PERFORM public.ari_memory_forget((SELECT id FROM d1_notes WHERE key = 'private'));
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_found' THEN RAISE EXCEPTION 'D1-9 forgot another user''s note (%)', v_error; END IF;
  PERFORM public.ari_memory_forget((SELECT id FROM d1_notes WHERE key = 'brand'));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.ari_memory_list(v_brand)) x
              WHERE x->>'id' = (SELECT id::text FROM d1_notes WHERE key = 'brand')) THEN
    RAISE EXCEPTION 'D1-9 a forgotten note is still listed';
  END IF;
  -- The member (not an admin) can't forget the owner's shared note.
  v_note := public.ari_remember_note('brand', 'preference', 'Use naira prices in every caption.', v_brand, NULL);
  PERFORM pg_temp.d1_as(v_member);
  BEGIN
    PERFORM public.ari_memory_forget((v_note->>'id')::uuid);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_found' THEN RAISE EXCEPTION 'D1-9 a member forgot the owner''s note (%)', v_error; END IF;
  -- And the member's own private note can be forgotten by them.
  PERFORM public.ari_memory_forget((SELECT id FROM d1_notes WHERE key = 'private'));

  -- 10. No direct writes for signed-in callers.
  BEGIN
    INSERT INTO public.ari_memory_notes(user_id, kind, content) VALUES (v_member, 'fact', 'direct');
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLSTATE;
  END;
  IF v_error <> '42501' THEN RAISE EXCEPTION 'D1-10 a direct insert was allowed (%)', v_error; END IF;
  RESET ROLE;

  -- 11. At most 20 new notes an hour.
  INSERT INTO public.ari_memory_notes(user_id, scope, kind, content, content_key)
  SELECT v_member, 'user', 'fact', 'Seeded note ' || g, public.ari_memory_content_key('Seeded note ' || g)
    FROM generate_series(1, 20) g;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.d1_as(v_member);
  BEGIN
    PERFORM public.ari_remember_note('user', 'fact', 'One note too many', NULL, NULL);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLSTATE || ':' || SQLERRM;
  END;
  IF v_error <> 'PT429:memory_rate_limited' THEN
    RAISE EXCEPTION 'D1-11 the hourly cap did not hold (%)', v_error;
  END IF;
  -- A repeat of an existing note is not a new note: still answered.
  v_again := public.ari_remember_note('user', 'fact', 'Seeded note 3', NULL, NULL);
  IF (v_again->>'deduplicated')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'D1-11 a repeat was rate limited: %', v_again;
  END IF;
  RESET ROLE;
END
$d1$;

-- The unauthenticated never call it.
DO $d1acl$
BEGIN
  IF has_function_privilege('anon', 'public.ari_remember_note(text,text,text,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D1-ACL anon can remember notes';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ari_remember_note(text,text,text,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D1-ACL signed-in callers must be able to remember notes';
  END IF;
END
$d1acl$;

SELECT 'issue_3355_ari_memory_notes: all tests passed' AS result;
ROLLBACK;
