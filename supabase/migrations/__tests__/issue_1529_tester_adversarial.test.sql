\set ON_ERROR_STOP on
BEGIN;

-- ===========================================================================
-- Issue #1529 — TESTER ADVERSARIAL SUITE (mingla-tester, owns T-6).
--
-- DELIBERATELY A DIFFERENT ANGLE from the implementor's suites. Those prove
-- the four #1529 producers write a country and that a policy skip does not
-- escalate a refund. This file attacks the three things they do NOT cover:
--
--   ADV-1  COMPLETENESS UNDER EXEMPTION. The live catalog contains FIVE
--          notification_outbox producers. The fifth,
--          public.admin_request_source_refund_attention_recovery, enqueues into
--          the outbox and never mentions country_code. It is legitimately
--          exempt — its rows are source-refund-pool rows whose country is
--          derived at the DRAIN, because #1221 keeps recipient PII out of the
--          outbox — but "legitimately exempt" is a CLAIM, and an unproven claim
--          is exactly how #1529 shipped.
--
--          This section makes the exemption earned on three axes, because I
--          broke the weaker forms on a live database and recorded how:
--            - DISCOVERY is on any MENTION of notification_outbox, not on an
--              `INSERT INTO public.notification_outbox` regex. Two evasions
--              defeat that regex — `public . notification_outbox` and an
--              unqualified `notification_outbox` — and both wrote real rows
--              while staying invisible.
--            - CLASSIFICATION is three-way (populating / drain_derived /
--              reader) and a "reader" that actually inserts is rejected, so a
--              discovered writer cannot be silenced by parking it.
--            - THE EXEMPTION discriminates on the producer's CATEGORY LITERALS
--              and on claim-pool behaviour. Qualifying it with loose words is
--              not enough: I redefined the exempt name with a body that wrote
--              an ordinary generic-pool row and kept the marker words in a
--              comment, and a word-level check stayed green.
--          A producer that is neither populating nor provably drain-derived
--          FAILS.
--
--   ADV-2  HOSTILE DERIVATION INPUT. The implementor's parity fixtures are
--          well-formed. These are not: NANP overlap (Canada, Caribbean), a
--          +44 crown dependency, the +234/+2348 boundary, national format with
--          a leading zero, an extension suffix, letters interleaved with
--          digits, a doubled '+', unicode digits, a bare calling code, and the
--          two REAL +33 handsets that exist in production today — the finding
--          that got France mapped rather than permanently cut off. Same
--          fixture block is read by the
--          TypeScript twin, so SQL and TS cannot drift on the hostile set
--          either.
--
--   ADV-3  IDEMPOTENCY INVARIANCE UNDER A COLUMN ADDITION. Adding a column to
--          an INSERT is the classic way to accidentally change a key and
--          double-send to real customers. This fires the REAL reservation
--          trigger, asserts the produced idempotency_key matches the exact
--          pre-#1529 format, and re-fires to prove ON CONFLICT still collapses.
--
--   ADV-4  A SECOND NEGATIVE CONTROL ON THE MONEY PATH. The implementor proves
--          'skipped' does not escalate and 'terminal_unsent' does. This adds
--          the two cases that would let a broken implementation still pass
--          both of those: 'ambiguous' must ALSO escalate, and 'skipped' must
--          not CLEAR an alarm that was already raised.
--
-- Every section carries a vacuity guard. A section that matches zero rows
-- FAILS — it never passes over an empty set.
-- ===========================================================================


-- ===========================================================================
-- ADV-2 — HOSTILE DERIVATION FIXTURES (shared with the TypeScript twin).
-- ===========================================================================
CREATE TEMP TABLE issue_1529_adv_fixtures (
  label          text PRIMARY KEY,
  raw            text,
  expect_e164    text,
  expect_country text
);

-- #1529-ADV-FIXTURES-BEGIN
INSERT INTO issue_1529_adv_fixtures (label, raw, expect_e164, expect_country) VALUES
  -- NANP is ONE calling code shared by many sovereign states. All of them must
  -- resolve to the same Twilio route; none may resolve to NULL and fail closed.
  ('nanp_us_california', '+14155550123', '+14155550123', 'US'),
  ('nanp_canada_toronto', '+16475550123', '+16475550123', 'US'),
  ('nanp_jamaica', '+18765550123', '+18765550123', 'US'),
  ('nanp_dominican', '+18095550123', '+18095550123', 'US'),
  -- +44 crown dependency (Jersey). Must not fall out of the GB branch.
  ('gb_crown_dependency_jersey', '+441534123456', '+441534123456', 'GB'),
  ('gb_mobile', '+447700900000', '+447700900000', 'GB'),
  ('gb_no_plus', '447700900000', '+447700900000', 'GB'),
  -- The +234 / +2348 boundary. Longest-prefix-first must not let a shorter
  -- entry shadow Nigeria, and a shorter fragment must not become Nigeria.
  ('ng_boundary_full', '+2348012345678', '+2348012345678', 'NG'),
  ('ng_boundary_no_plus', '2348012345678', '+2348012345678', 'NG'),
  ('ng_production_handset', '2347084065203', '+2347084065203', 'NG'),
  ('ng_prefix_fragment_23', '+23', '+23', NULL),
  ('ng_prefix_fragment_2', '+2', NULL, NULL),
  -- Belgium, present in production data.
  ('be_mobile', '+32460964460', '+32460964460', 'BE'),
  -- France is MAPPED, and this fixture is the reason it is. It originally
  -- asserted NULL, on the SPEC's stated basis that the unmapped population was
  -- "zero in production today". That was false — two real auth.users rows carry
  -- a +33 handset — so failing closed here would have cut those two people off
  -- permanently, by construction. The orchestrator authorised mapping France
  -- (2026-08-03) and this expectation moved with the decision.
  ('mapped_france_2_production_users', '+33075123456', '+33075123456', 'FR'),
  -- Genuinely unmapped calling codes MUST still be NULL, never a guess. These
  -- two carry that half of the contract now that France no longer does.
  ('unmapped_germany', '+4915112345678', '+4915112345678', NULL),
  ('unmapped_russia_kazakh_shared', '+79001234567', '+79001234567', NULL),
  -- The P3-1 minimum-length floor, pinned from the tester side. Both of these
  -- resolved to a COUNTRY before that fix — '+234' derived NG, and a vanity
  -- number truncated to '+1800' derived US — so a garbage contact selected a
  -- real provider. They must still NORMALISE (the normaliser's contract is
  -- deliberately unchanged, which is what keeps every hostile normalisation
  -- fixture above honest) and then fail to DERIVE.
  ('calling_code_only_ng', '+234', '+234', NULL),
  ('vanity_truncated_us', '+1 (800) FLOWERS', '+1800', NULL),
  -- National format with the trunk zero is NOT E.164 and must be rejected
  -- outright rather than silently becoming a +0 number.
  ('national_format_ng_trunk_zero', '07084065203', NULL, NULL),
  ('plus_leading_zero', '+0123456789', NULL, NULL),
  ('double_zero_idd_prefix', '+00234801234567', NULL, NULL),
  -- Structurally broken input.
  ('plus_only', '+', NULL, NULL),
  ('hyphen_only', '-', NULL, NULL),
  ('empty_string', '', NULL, NULL),
  ('blank_spaces', '   ', NULL, NULL),
  ('null_input', NULL, NULL, NULL),
  ('overlong_16_digits', '+2348012345678901', NULL, NULL),
  ('absurdly_long', '+234801234567890123456', NULL, NULL),
  -- Emails must be rejected BEFORE digit-stripping, or the local part donates
  -- digits and an address masquerades as a phone.
  ('email_with_digits', 'user2000@example.com', NULL, NULL),
  ('email_plain', 'guest@example.com', NULL, NULL),
  -- Formatting noise a human or an import can introduce.
  ('spaced_ng', '+234 801 234 5678', '+2348012345678', 'NG'),
  ('hyphenated_ng', '+234-801-234-5678', '+2348012345678', 'NG'),
  ('leading_space_ng', ' +2348012345678', '+2348012345678', 'NG'),
  ('doubled_plus', '++2348012345678', '+2348012345678', 'NG'),
  ('letters_interleaved', '+234a801b234c5678', '+2348012345678', 'NG'),
  ('trailing_letter', '+2348012345678x', '+2348012345678', 'NG'),
  ('letters_only', 'not a number', NULL, NULL),
  -- Unicode digits are NOT ASCII digits. They must be stripped, not honoured —
  -- if either implementation treated them as digits the two would diverge.
  ('unicode_arabic_indic_digits', '٢٣٤8012345678', '+8012345678', NULL);
-- #1529-ADV-FIXTURES-END

-- Vacuity guard FIRST: an emptied or reflow-broken fixture block would make
-- every assertion below pass over zero rows.
DO $adv_fixture_vacuity$
DECLARE
  v_count integer;
  v_derivable integer;
BEGIN
  SELECT count(*) INTO v_count FROM issue_1529_adv_fixtures;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'issue_1529_adv_fixture_table_is_empty__guard_is_vacuous';
  END IF;
  IF v_count < 38 THEN
    RAISE EXCEPTION
      'issue_1529_adv_fixture_set_shrank_expected_at_least_38_got_%', v_count;
  END IF;
  -- A fixture set where EVERY expectation is NULL would pass the comparison
  -- below against a function that returns NULL unconditionally.
  SELECT count(*) INTO v_derivable
  FROM issue_1529_adv_fixtures WHERE expect_country IS NOT NULL;
  IF v_derivable < 10 THEN
    RAISE EXCEPTION
      'issue_1529_adv_fixtures_have_only_%_derivable_cases__cannot_detect_a_null_returning_impl',
      v_derivable;
  END IF;
END;
$adv_fixture_vacuity$;

DO $adv_derivation$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(
           f.label || ' raw=' || COALESCE(f.raw, '<NULL>') ||
           ' expected=' || COALESCE(f.expect_e164, '<NULL>') ||
           ' got=' || COALESCE(public.mingla_e164_normalize(f.raw), '<NULL>'),
           E'\n  ' ORDER BY f.label)
    INTO v_bad
  FROM issue_1529_adv_fixtures f
  WHERE public.mingla_e164_normalize(f.raw) IS DISTINCT FROM f.expect_e164;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1529_adv_normalize_mismatch:%s  %s', E'\n  ', v_bad;
  END IF;

  SELECT string_agg(
           f.label || ' raw=' || COALESCE(f.raw, '<NULL>') ||
           ' expected=' || COALESCE(f.expect_country, '<NULL>') ||
           ' got=' || COALESCE(public.mingla_e164_country(f.raw), '<NULL>'),
           E'\n  ' ORDER BY f.label)
    INTO v_bad
  FROM issue_1529_adv_fixtures f
  WHERE public.mingla_e164_country(f.raw) IS DISTINCT FROM f.expect_country;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1529_adv_country_mismatch:%s  %s', E'\n  ', v_bad;
  END IF;
END;
$adv_derivation$;

-- The defect in one assertion: NULL must never be readable as US anywhere.
DO $adv_null_is_not_us$
DECLARE
  v_leak text;
BEGIN
  SELECT string_agg(f.label, ', ' ORDER BY f.label) INTO v_leak
  FROM issue_1529_adv_fixtures f
  WHERE f.expect_country IS NULL
    AND public.mingla_e164_country(f.raw) = 'US';
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_adv_undeciderable_input_resolved_to_US__that_is_the_defect__%',
      v_leak;
  END IF;
END;
$adv_null_is_not_us$;


-- ===========================================================================
-- ADV-1 — COMPLETENESS UNDER EXEMPTION, WITH EVASION-RESISTANT DISCOVERY.
--
-- The implementor's audit discovers producers with
-- `prosrc ~* 'insert\s+into\s+public\.notification_outbox'`. I attacked that
-- regex on a live database and got TWO unaudited producers past it:
--
--   INSERT INTO public . notification_outbox (...)   -- whitespace around the dot
--   INSERT INTO notification_outbox (...)            -- unqualified + search_path
--
-- Both wrote a real row and neither was discovered, so neither had to decide a
-- country. The guard's whole premise is that it derives its subject set from
-- the live catalog and therefore "cannot pass by ignoring a producer nobody
-- remembered to add" — a premise a single space defeats.
--
-- SO THIS FILE DISCOVERS DIFFERENTLY. The subject set is every public function
-- that MENTIONS notification_outbox at all. Then each one is classified:
--
--   populating     writes the column at enqueue                (must mention it)
--   drain_derived  source-refund pool, country derived at drain (capped, ghost-checked)
--   readers        provably does NOT insert                     (explicit list)
--
-- A function can only escape by constructing the table name dynamically, which
-- is a far louder thing to write than a stray space.
-- ===========================================================================
CREATE TEMP TABLE issue_1529_adv_producers AS
SELECT p.proname::text AS proname,
       p.prosrc        AS prosrc,
       -- PERMISSIVE insert detector: optional schema, optional quoting, any
       -- whitespace around the dot. This is what the two evasions above defeat
       -- in the narrow form.
       (p.prosrc ~* 'insert\s+into\s+("?public"?\s*\.\s*)?"?notification_outbox"?')
         AS writes_outbox
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ~* 'notification_outbox';

DO $adv_producer_vacuity$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM issue_1529_adv_producers;
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'issue_1529_adv_producer_discovery_matched_zero__guard_is_vacuous';
  END IF;
  -- Everything that TOUCHES the table, writers and readers alike.
  IF v_count < 12 THEN
    RAISE EXCEPTION
      'issue_1529_adv_outbox_touching_function_floor_breached_expected_at_least_12_got_%',
      v_count;
  END IF;

  -- And the WRITERS specifically. FIVE, not four: the floor is the number that
  -- actually exists, so a producer disappearing is caught as well as one
  -- appearing.
  SELECT count(*) INTO v_count
  FROM issue_1529_adv_producers WHERE writes_outbox;
  IF v_count < 5 THEN
    RAISE EXCEPTION
      'issue_1529_adv_producer_floor_breached_expected_at_least_5_got_%',
      v_count;
  END IF;
END;
$adv_producer_vacuity$;

DO $adv_producer_partition$
DECLARE
  -- Bucket 1: producers that MUST write country_code at enqueue, because they
  -- hold (or can hold) the recipient's contact on the row.
  populating text[] := ARRAY[
    'orch_1161_reservation_notify_outbox',
    'pg_notify_reminders_enqueue',
    'finalize_rsvp_contribution',
    'issue_1389_enqueue_stay_event'
  ];
  -- Bucket 2: producers exempt because their rows belong to the source-refund
  -- pool, which by #1221's privacy design carries contact NULL and resolves the
  -- recipient (and therefore the country) at the DRAIN. Membership of this
  -- bucket is PROVEN below, not assumed.
  drain_derived text[] := ARRAY[
    'admin_request_source_refund_attention_recovery'
  ];
  -- Bucket 3: functions that touch the table but must NEVER insert into it.
  -- Listing them explicitly is what lets discovery stay broad: a NEW function
  -- mentioning notification_outbox is unclassified until a human looks at it,
  -- and if it turns out to insert, the writes_outbox check below rejects it
  -- from this bucket outright.
  readers text[] := ARRAY[
    'claim_notification_outbox',
    'claim_source_refund_notification_delivery',
    'claim_source_refund_notification_outbox',
    'complete_source_refund_notification_delivery',
    'issue_1427_admin_list_stay_operations',
    'issue_1427_admin_retry_stay_notification',
    'issue_1427_admin_stay_group_projection'
  ];
  v_unclassified text;
  v_missing_cc text;
  v_reader_writes text;
  v_bad_exempt text;
BEGIN
  SELECT string_agg(d.proname, ', ' ORDER BY d.proname) INTO v_unclassified
  FROM issue_1529_adv_producers d
  WHERE NOT (d.proname = ANY(populating))
    AND NOT (d.proname = ANY(drain_derived))
    AND NOT (d.proname = ANY(readers));
  IF v_unclassified IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_adv_unclassified_outbox_touching_function__%__classify_it_as_populating_drain_derived_or_reader',
      v_unclassified;
  END IF;

  -- A "reader" that inserts is not a reader. This is the assertion that closes
  -- the discovery-regex evasions: a producer written as
  -- `INSERT INTO public . notification_outbox` or unqualified is DISCOVERED
  -- here (discovery is on the mention, not the INSERT), and can only be
  -- silenced by being parked in `readers` — where this check rejects it.
  SELECT string_agg(d.proname, ', ' ORDER BY d.proname) INTO v_reader_writes
  FROM issue_1529_adv_producers d
  WHERE d.proname = ANY(readers) AND d.writes_outbox;
  IF v_reader_writes IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_adv_function_classified_as_reader_actually_INSERTS__%__it_must_decide_a_country',
      v_reader_writes;
  END IF;

  SELECT string_agg(d.proname, ', ' ORDER BY d.proname) INTO v_missing_cc
  FROM issue_1529_adv_producers d
  WHERE d.proname = ANY(populating)
    AND d.prosrc !~* 'country_code';
  IF v_missing_cc IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1529_adv_populating_producer_omits_country_code__%',
      v_missing_cc;
  END IF;

  -- The exemption bucket must stay small and must not contain ghosts. A third
  -- exemption is a deliberate human decision, not an append.
  IF array_length(drain_derived, 1) > 2 THEN
    RAISE EXCEPTION
      'issue_1529_adv_exemption_bucket_grew_past_2__an_exemption_bucket_that_keeps_growing_IS_a_blanket_allowlist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(drain_derived) AS x(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM issue_1529_adv_producers d WHERE d.proname = x.name
    )
  ) THEN
    RAISE EXCEPTION
      'issue_1529_adv_exemption_names_a_function_that_no_longer_exists__remove_the_stale_exemption';
  END IF;
  -- An exempt producer that writes the column is a POPULATING producer that has
  -- been mis-filed, and mis-filing is how a real omission gets hidden.
  SELECT string_agg(d.proname, ', ' ORDER BY d.proname) INTO v_bad_exempt
  FROM issue_1529_adv_producers d
  WHERE d.proname = ANY(drain_derived) AND d.prosrc ~* 'country_code';
  IF v_bad_exempt IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_adv_exempt_producer_writes_country_code__reclassify_as_populating__%',
      v_bad_exempt;
  END IF;

  -- THE EXEMPTION IS ABOUT WHICH POOL THE PRODUCER WRITES INTO, so assert on
  -- the CATEGORY LITERALS in its body, not on loose words.
  --
  -- I attacked the weaker form and it fell over: the implementor's audit
  -- qualifies the exemption with `prosrc ~* 'contract_version' AND prosrc ~*
  -- 'source_refund'`, and BOTH of those match a COMMENT. I redefined the exempt
  -- name with a body whose only INSERT wrote an ordinary generic-pool row
  -- ('buyer_reservation_changed') and kept the two words in a comment — the
  -- audit stayed green, because its behavioural section proves pool separation
  -- with its OWN canned row and never looks at what the exempt producer emits.
  --
  -- These two checks discriminate on the real signal. Verified against the live
  -- catalog: the genuine exempt producer has a 'source_refund category literal
  -- and NO generic one; all four populating producers are the exact inverse.
  SELECT string_agg(d.proname, ', ' ORDER BY d.proname) INTO v_bad_exempt
  FROM issue_1529_adv_producers d
  WHERE d.proname = ANY(drain_derived)
    AND d.prosrc !~ '''source_refund';
  IF v_bad_exempt IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_adv_exempt_producer_has_no_source_refund_category_literal__it_does_not_write_to_that_pool__%',
      v_bad_exempt;
  END IF;

  SELECT string_agg(d.proname, ', ' ORDER BY d.proname) INTO v_bad_exempt
  FROM issue_1529_adv_producers d
  WHERE d.proname = ANY(drain_derived)
    AND d.prosrc ~ '''(buyer_|business\.|stay_)';
  IF v_bad_exempt IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_adv_exempt_producer_writes_a_GENERIC_pool_category__the_drain_derived_exemption_does_not_cover_it__%',
      v_bad_exempt;
  END IF;
END;
$adv_producer_partition$;


-- ===========================================================================
-- ADV-1b — THE EXEMPTION IS EARNED, NOT ASSERTED.
--
-- The drain-derived exemption is only sound if such a row is genuinely
-- invisible to the GENERIC claim RPC (whose consumer reads country_code
-- straight off the row) and visible to the SOURCE-REFUND claim RPC (whose
-- consumer derives country after resolving the recipient). If that ever
-- inverted, a country-less row would flow to the generic dispatcher and the
-- #1529 defect would be back on a money path. Proven by CLAIMING, not by
-- reading source text.
-- ===========================================================================
INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1529-4dd0-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'adv-1529@example.test', now(), now()
);

INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-1529-4dd0-8000-000000000001',
        'adv-1529@example.test', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, created_at, updated_at
) VALUES (
  '00000000-1529-4dd0-8000-000000000010',
  '00000000-1529-4dd0-8000-000000000001',
  'Issue 1529 Adversarial Brand', 'issue-1529-adv-brand', 'NGN', now(), now()
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1529-4dd0-8000-000000000011',
  '00000000-1529-4dd0-8000-000000000010',
  'issue1529adv', 'Issue 1529 Adversarial Venue', 6.45, 3.47,
  'restaurant', 'verified'
);

INSERT INTO public.source_refunds (
  id, source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
  requested_by_type, reason, provider, currency, original_charge_cents,
  buyer_refund_requested_cents, buyer_refund_processed_cents, buyer_state,
  fee_reversal_required_cents, fee_reversal_processed_cents, fee_state,
  fee_leg_kind, financial_state, organizer_refund_liability_cents,
  platform_fee_absorption_cents, provider_payment_reference, idempotency_key,
  ops_status, attention_generation
) VALUES
  ('00000000-1529-4dd0-8000-000000000020', 'venue_reservation',
   '00000000-1529-4dd0-8000-000000000030',
   '00000000-1529-4dd0-8000-000000000030',
   '00000000-1529-4dd0-8000-000000000010',
   '00000000-1529-4dd0-8000-000000000011',
   'venue_eligible_cancel', 'system', 'Issue 1529 adversarial ambiguous',
   'stripe', 'USD', 1000, 1000, 0, 'queued', 0, 0, 'not_required',
   'not_required', 'pending', 1000, 0,
   'pi_issue1529_adv_ambiguous', 'issue-1529-adv-ambiguous', 'none', 1),
  ('00000000-1529-4dd0-8000-000000000021', 'venue_reservation',
   '00000000-1529-4dd0-8000-000000000031',
   '00000000-1529-4dd0-8000-000000000031',
   '00000000-1529-4dd0-8000-000000000010',
   '00000000-1529-4dd0-8000-000000000011',
   'venue_eligible_cancel', 'system', 'Issue 1529 adversarial preexisting',
   'stripe', 'USD', 1000, 1000, 0, 'queued', 0, 0, 'not_required',
   'not_required', 'pending', 1000, 0,
   'pi_issue1529_adv_preexisting', 'issue-1529-adv-preexisting',
   'needs_review', 1);

-- A fresh database seeds the attention contract disabled at version 0.
-- PRODUCTION runs it ENABLED at version 9 (verified read-only, 2026-08-03), and
-- the source-refund claim RPC returns nothing at all unless that is true — so a
-- test left on the default would silently prove nothing about this pool.
UPDATE public.source_refund_attention_contract
   SET contract_version = 9, enabled = true, updated_at = now()
 WHERE singleton;

DO $adv_claim_separation$
DECLARE
  v_event      bigint;
  v_outbox     uuid := '00000000-1529-4dd0-8000-000000000040';
  v_generic    integer;
  v_source     integer;
BEGIN
  INSERT INTO public.source_refund_events (
    refund_id, leg_type, event_key, event_type, to_state, actor_type
  ) VALUES (
    '00000000-1529-4dd0-8000-000000000020', 'buyer_refund',
    'issue-1529-adv-event', 'needs_attention', 'needs_attention', 'system'
  ) RETURNING id INTO v_event;

  -- A source-refund outbox row in exactly the shape the exempt producer emits:
  -- contact NULL, country_code NULL, contract_version 9, a channel.
  INSERT INTO public.notification_outbox (
    id, category_key, user_id, contact, brand_id, payload, idempotency_key,
    status, channel, contract_version, attention_generation,
    source_refund_event_id, country_code
  ) VALUES (
    v_outbox, 'source_refund_buyer_state', NULL, NULL,
    '00000000-1529-4dd0-8000-000000000010', '{}'::jsonb,
    'issue-1529-adv-outbox', 'pending', 'sms', 9, 1, v_event, NULL
  );

  -- The generic claim RPC must NOT see it. If it did, a row that structurally
  -- cannot carry a country would reach the dispatcher that reads the column
  -- directly — the exact shape of #1529.
  SELECT count(*) INTO v_generic
  FROM public.claim_notification_outbox(25) c WHERE c.id = v_outbox;
  IF v_generic <> 0 THEN
    RAISE EXCEPTION
      'issue_1529_adv_source_refund_row_claimed_by_GENERIC_pool__country_would_be_read_as_NULL_from_the_row';
  END IF;

  -- The source-refund claim RPC MUST see it — otherwise the drain never runs
  -- and the "derived at the drain" exemption is vacuous.
  SELECT count(*) INTO v_source
  FROM public.claim_source_refund_notification_outbox(
         25, 9, '00000000-1529-4dd0-8000-000000000099'::uuid, now()) c
  WHERE c.id = v_outbox;
  IF v_source <> 1 THEN
    RAISE EXCEPTION
      'issue_1529_adv_source_refund_row_NOT_claimed_by_source_pool__drain_derivation_is_unreachable_got_%',
      v_source;
  END IF;
END;
$adv_claim_separation$;


-- ===========================================================================
-- ADV-3 — IDEMPOTENCY INVARIANCE + REAL-TRIGGER COUNTRY MATRIX.
--
-- Adding a column to an INSERT is a classic way to accidentally change the
-- conflict key and double-send to a real customer. The keys asserted here are
-- the EXACT pre-#1529 formats, read off the live production function bodies.
-- ===========================================================================
INSERT INTO public.reservations (
  id, brand_id, venue_id, reserved_for, party_size, status, source, created_via,
  guest_name, guest_phone_e164, guest_email
) VALUES
  ('00000000-1529-4dd0-8000-000000000050',
   '00000000-1529-4dd0-8000-000000000010',
   '00000000-1529-4dd0-8000-000000000011',
   now() + interval '10 days', 2, 'confirmed', 'website', 'guest',
   'NG Guest', '+2348012345678', 'adv-ng@example.test'),
  -- Canada rides the NANP calling code. Correct ROUTING is Twilio/US; the
  -- documented imprecision must be US, never NULL (NULL would fail closed and
  -- silently stop a working Canadian text).
  ('00000000-1529-4dd0-8000-000000000051',
   '00000000-1529-4dd0-8000-000000000010',
   '00000000-1529-4dd0-8000-000000000011',
   now() + interval '11 days', 2, 'confirmed', 'website', 'guest',
   'CA Guest', '+16475550123', 'adv-ca@example.test'),
  ('00000000-1529-4dd0-8000-000000000052',
   '00000000-1529-4dd0-8000-000000000010',
   '00000000-1529-4dd0-8000-000000000011',
   now() + interval '12 days', 2, 'confirmed', 'website', 'guest',
   'GB Guest', '+447700900000', 'adv-gb@example.test'),
  -- A production-real French handset. Two +33 rows exist in auth.users today,
  -- which is why France is MAPPED rather than failing closed — under the
  -- original bounded map these two users could never have been texted again.
  ('00000000-1529-4dd0-8000-000000000053',
   '00000000-1529-4dd0-8000-000000000010',
   '00000000-1529-4dd0-8000-000000000011',
   now() + interval '13 days', 2, 'confirmed', 'website', 'guest',
   'FR Guest', '+33075123456', 'adv-fr@example.test'),
  ('00000000-1529-4dd0-8000-000000000054',
   '00000000-1529-4dd0-8000-000000000010',
   '00000000-1529-4dd0-8000-000000000011',
   now() + interval '14 days', 2, 'confirmed', 'website', 'guest',
   'Email Guest', NULL, 'adv-email@example.test'),
  -- A GENUINELY unmapped calling code, added when France was mapped. Without
  -- it this matrix would no longer contain a single unmapped-handset case, and
  -- would stop proving the property that matters most at the producer level:
  -- an underivable country is written as NULL, never guessed as US. The
  -- email-only row above is NULL for a DIFFERENT reason (no phone at all), so
  -- it cannot stand in for this one.
  ('00000000-1529-4dd0-8000-000000000055',
   '00000000-1529-4dd0-8000-000000000010',
   '00000000-1529-4dd0-8000-000000000011',
   now() + interval '15 days', 2, 'confirmed', 'website', 'guest',
   'DE Guest', '+4915112345678', 'adv-de@example.test');

DO $adv_reservation_matrix$
DECLARE
  v_id       text;
  v_expected text;
  v_actual   text;
  v_seen     integer := 0;
  v_before   integer;
  v_after    integer;
BEGIN
  FOR v_id, v_expected IN
    SELECT * FROM (VALUES
      ('00000000-1529-4dd0-8000-000000000050', 'NG'),
      ('00000000-1529-4dd0-8000-000000000051', 'US'),
      ('00000000-1529-4dd0-8000-000000000052', 'GB'),
      -- France: MAPPED (orchestrator decision, 2026-08-03). This row asserted
      -- NULL until the production probe found two real +33 users.
      ('00000000-1529-4dd0-8000-000000000053', 'FR'),
      ('00000000-1529-4dd0-8000-000000000054', NULL),
      -- Germany: genuinely unmapped. NULL, never US.
      ('00000000-1529-4dd0-8000-000000000055', NULL)
    ) AS t(rid, expected)
  LOOP
    -- The idempotency key asserted here is the PRE-#1529 format, verbatim:
    -- 'buyer_reservation_confirmed:' || NEW.id::text. If the column addition
    -- had perturbed the key this SELECT finds nothing and the test fails.
    SELECT country_code INTO v_actual
    FROM public.notification_outbox
    WHERE idempotency_key = 'buyer_reservation_confirmed:' || v_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'issue_1529_adv_idempotency_key_format_changed_or_no_row_for_%__duplicate_send_risk',
        v_id;
    END IF;
    v_seen := v_seen + 1;

    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION
        'issue_1529_adv_reservation_country_mismatch_% expected_% got_%',
        v_id, COALESCE(v_expected, '<NULL>'), COALESCE(v_actual, '<NULL>');
    END IF;
  END LOOP;

  IF v_seen <> 6 THEN
    RAISE EXCEPTION
      'issue_1529_adv_reservation_matrix_ran_over_%_rows_expected_6__vacuous',
      v_seen;
  END IF;

  -- The matrix must keep BOTH halves of the contract, or flipping one country
  -- to mapped could quietly hollow it out. Assert the shape directly: at least
  -- one row derived a real country, and at least one PHONE-BEARING row derived
  -- NULL. The email-only row is excluded because it is NULL for a different
  -- reason and would let the unmapped case disappear unnoticed.
  IF (SELECT count(*) FROM public.notification_outbox o
        WHERE o.idempotency_key LIKE 'buyer_reservation_confirmed:00000000-1529-4dd0%'
          AND o.country_code IS NOT NULL) = 0 THEN
    RAISE EXCEPTION
      'issue_1529_adv_matrix_has_no_derivable_country_case__would_pass_against_a_null_returning_impl';
  END IF;
  IF (SELECT count(*) FROM public.notification_outbox o
        WHERE o.idempotency_key LIKE 'buyer_reservation_confirmed:00000000-1529-4dd0%'
          AND o.contact IS NOT NULL AND o.contact NOT LIKE '%@%'
          AND o.country_code IS NULL) = 0 THEN
    RAISE EXCEPTION
      'issue_1529_adv_matrix_lost_its_unmapped_handset_case__NULL_never_means_US_is_no_longer_proven';
  END IF;

  -- ON CONFLICT must still collapse a repeat enqueue. A changed key would
  -- create a SECOND row here and double-text a real customer.
  SELECT count(*) INTO v_before FROM public.notification_outbox
  WHERE idempotency_key LIKE 'buyer_reservation_confirmed:00000000-1529-4dd0%';

  UPDATE public.reservations
     SET status = 'confirmed', party_size = 3
   WHERE id = '00000000-1529-4dd0-8000-000000000050';

  SELECT count(*) INTO v_after FROM public.notification_outbox
  WHERE idempotency_key LIKE 'buyer_reservation_confirmed:00000000-1529-4dd0%';

  IF v_after <> v_before THEN
    RAISE EXCEPTION
      'issue_1529_adv_reenqueue_created_a_duplicate_row_%_to_%__idempotency_broken',
      v_before, v_after;
  END IF;
END;
$adv_reservation_matrix$;


-- ===========================================================================
-- ADV-3b — WHOLE-SET INVARIANT: no SMS-destined row may carry a non-E.164
-- contact, and where a country IS present it must equal what the shared helper
-- derives from that row's own contact. This is the invariant
-- I-PROPOSED-1529-OUTBOX-SMS-CONTACT-IS-E164 expressed as data, over every row
-- this file produced — not over a hand-picked one.
-- ===========================================================================
DO $adv_row_invariant$
DECLARE
  v_scanned integer;
  v_bad     text;
BEGIN
  SELECT count(*) INTO v_scanned
  FROM public.notification_outbox o
  WHERE o.contact IS NOT NULL AND o.contact NOT LIKE '%@%';
  IF v_scanned = 0 THEN
    RAISE EXCEPTION
      'issue_1529_adv_row_invariant_scanned_zero_phone_rows__guard_is_vacuous';
  END IF;

  SELECT string_agg(o.idempotency_key || ' contact=' || o.contact, ', ')
    INTO v_bad
  FROM public.notification_outbox o
  WHERE o.payload->>'channel_hint' = 'sms'
    AND (o.contact IS NULL OR o.contact NOT LIKE '+%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_adv_sms_row_contact_is_not_e164__would_die_as_no_contact__%',
      v_bad;
  END IF;

  SELECT string_agg(
           o.idempotency_key || ' contact=' || o.contact ||
           ' stored=' || COALESCE(o.country_code, '<NULL>') ||
           ' derived=' || COALESCE(public.mingla_e164_country(o.contact), '<NULL>'),
           ', ')
    INTO v_bad
  FROM public.notification_outbox o
  WHERE o.contact IS NOT NULL
    AND o.contact NOT LIKE '%@%'
    AND o.country_code IS DISTINCT FROM public.mingla_e164_country(o.contact);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_adv_stored_country_disagrees_with_the_rows_own_contact__%',
      v_bad;
  END IF;
END;
$adv_row_invariant$;


-- ===========================================================================
-- ADV-4 — MONEY PATH, THE TWO CASES THE IMPLEMENTOR'S CONTROL DOES NOT COVER.
--
-- The implementor proves 'skipped' does not escalate and 'terminal_unsent'
-- does. An implementation that escalated ONLY on terminal_unsent would pass
-- both and still be wrong: 'ambiguous' must escalate too (a send whose
-- acceptance is unknown is a real ops question), and a skip must not CLEAR an
-- alarm that was already standing.
-- ===========================================================================
DO $adv_money_path$
DECLARE
  v_event_amb  bigint;
  v_event_pre  bigint;
  v_outbox_amb uuid := '00000000-1529-4dd0-8000-000000000060';
  v_outbox_pre uuid := '00000000-1529-4dd0-8000-000000000061';
  v_del_amb    uuid := '00000000-1529-4dd0-8000-000000000070';
  v_del_pre    uuid := '00000000-1529-4dd0-8000-000000000071';
  v_claim_amb  uuid := '00000000-1529-4dd0-8000-000000000080';
  v_claim_pre  uuid := '00000000-1529-4dd0-8000-000000000081';
  v_now        timestamptz := now();
  v_result     jsonb;
  v_ops        text;
BEGIN
  INSERT INTO public.source_refund_events (
    refund_id, leg_type, event_key, event_type, to_state, actor_type
  ) VALUES (
    '00000000-1529-4dd0-8000-000000000020', 'buyer_refund',
    'issue-1529-adv-amb', 'needs_attention', 'needs_attention', 'system'
  ) RETURNING id INTO v_event_amb;

  INSERT INTO public.source_refund_events (
    refund_id, leg_type, event_key, event_type, to_state, actor_type
  ) VALUES (
    '00000000-1529-4dd0-8000-000000000021', 'buyer_refund',
    'issue-1529-adv-pre', 'needs_attention', 'needs_attention', 'system'
  ) RETURNING id INTO v_event_pre;

  INSERT INTO public.notification_outbox (
    id, category_key, user_id, contact, brand_id, payload, idempotency_key,
    status, channel, contract_version, attention_generation,
    source_refund_event_id
  ) VALUES
    (v_outbox_amb, 'source_refund_buyer_state', NULL, NULL,
     '00000000-1529-4dd0-8000-000000000010', '{}'::jsonb,
     'issue-1529-adv-outbox-amb', 'processing', 'inapp', 9, 1, v_event_amb),
    (v_outbox_pre, 'source_refund_buyer_state', NULL, NULL,
     '00000000-1529-4dd0-8000-000000000010', '{}'::jsonb,
     'issue-1529-adv-outbox-pre', 'processing', 'inapp', 9, 1, v_event_pre);

  -- provider_io_started_at is required by check3 before a row may become
  -- 'ambiguous' — in the real flow the drain stamps it just before the provider
  -- call, which is precisely what makes acceptance unknown.
  INSERT INTO public.source_refund_notification_deliveries (
    id, refund_id, source_refund_event_id, outbox_id, attention_generation,
    audience, channel, recipient_revision, payload_fingerprint,
    serializer_version, idempotency_key, status,
    dispatch_claim_id, dispatch_claimed_at, claim_expires_at, attempts,
    provider_io_started_at
  ) VALUES
    (v_del_amb, '00000000-1529-4dd0-8000-000000000020', v_event_amb,
     v_outbox_amb, 1, 'buyer', 'inapp', 0, repeat('c', 64), 9,
     'issue-1529-adv-delivery-amb', 'dispatching', v_claim_amb, v_now,
     v_now + interval '120 seconds', 1, v_now),
    (v_del_pre, '00000000-1529-4dd0-8000-000000000021', v_event_pre,
     v_outbox_pre, 1, 'buyer', 'inapp', 0, repeat('d', 64), 9,
     'issue-1529-adv-delivery-pre', 'dispatching', v_claim_pre, v_now,
     v_now + interval '120 seconds', 1, v_now);

  -- CASE A — an AMBIGUOUS acceptance MUST still escalate. If this stopped
  -- escalating, the #1529 fix would have traded a false alarm for silence on a
  -- money path. The wire token is 'acceptance_unknown'; the recorded status is
  -- 'ambiguous'.
  v_result := public.complete_source_refund_notification_delivery(
    v_del_amb, v_claim_amb, 'acceptance_unknown', NULL,
    'acceptance_unknown', v_now
  );
  IF v_result->>'outcome' IS DISTINCT FROM 'ambiguous' THEN
    RAISE EXCEPTION
      'issue_1529_adv_ambiguous_call_did_not_take_effect_%', v_result;
  END IF;
  SELECT ops_status INTO v_ops FROM public.source_refunds
  WHERE id = '00000000-1529-4dd0-8000-000000000020';
  IF v_ops IS DISTINCT FROM 'needs_review' THEN
    RAISE EXCEPTION
      'issue_1529_adv_ambiguous_no_longer_escalates_got_%__real_alarm_lost',
      COALESCE(v_ops, '<NULL>');
  END IF;

  -- CASE B — a policy skip must not CLEAR a standing alarm. This refund was
  -- seeded already at 'needs_review'.
  v_result := public.complete_source_refund_notification_delivery(
    v_del_pre, v_claim_pre, 'skipped', NULL, 'provider_kill_switch_off', v_now
  );
  IF v_result->>'outcome' IS DISTINCT FROM 'skipped' THEN
    RAISE EXCEPTION
      'issue_1529_adv_skipped_call_did_not_take_effect_%', v_result;
  END IF;
  SELECT ops_status INTO v_ops FROM public.source_refunds
  WHERE id = '00000000-1529-4dd0-8000-000000000021';
  IF v_ops IS DISTINCT FROM 'needs_review' THEN
    RAISE EXCEPTION
      'issue_1529_adv_policy_skip_CLEARED_a_standing_ops_alarm_now_%',
      COALESCE(v_ops, '<NULL>');
  END IF;

  -- CASE C — an UNRECOGNISED outcome token must fail LOUD, not quietly.
  -- #1529 added 'skipped' to the vocabulary the drain speaks. If a future edit
  -- introduces a token the SQL side does not know, the safe answer is
  -- failed_terminal + needs_review — never a silent success. This pins that the
  -- unknown-token fallback was not softened while the skip branch was added.
  INSERT INTO public.source_refund_events (
    refund_id, leg_type, event_key, event_type, to_state, actor_type
  ) VALUES (
    '00000000-1529-4dd0-8000-000000000020', 'buyer_refund',
    'issue-1529-adv-unk', 'needs_attention', 'needs_attention', 'system'
  ) RETURNING id INTO v_event_amb;

  INSERT INTO public.notification_outbox (
    id, category_key, user_id, contact, brand_id, payload, idempotency_key,
    status, channel, contract_version, attention_generation,
    source_refund_event_id
  ) VALUES (
    '00000000-1529-4dd0-8000-000000000062', 'source_refund_buyer_state', NULL,
    NULL, '00000000-1529-4dd0-8000-000000000010', '{}'::jsonb,
    'issue-1529-adv-outbox-unk', 'processing', 'inapp', 9, 1, v_event_amb
  );

  INSERT INTO public.source_refund_notification_deliveries (
    id, refund_id, source_refund_event_id, outbox_id, attention_generation,
    audience, channel, recipient_revision, payload_fingerprint,
    serializer_version, idempotency_key, status,
    dispatch_claim_id, dispatch_claimed_at, claim_expires_at, attempts
  ) VALUES (
    '00000000-1529-4dd0-8000-000000000072',
    '00000000-1529-4dd0-8000-000000000020', v_event_amb,
    '00000000-1529-4dd0-8000-000000000062', 1, 'buyer', 'inapp', 0,
    repeat('e', 64), 9, 'issue-1529-adv-delivery-unk', 'dispatching',
    '00000000-1529-4dd0-8000-000000000082', v_now,
    v_now + interval '120 seconds', 1
  );

  v_result := public.complete_source_refund_notification_delivery(
    '00000000-1529-4dd0-8000-000000000072',
    '00000000-1529-4dd0-8000-000000000082',
    'a_token_this_function_has_never_heard_of', NULL, 'unknown_token', v_now
  );
  IF v_result->>'outcome' IS DISTINCT FROM 'failed_terminal' THEN
    RAISE EXCEPTION
      'issue_1529_adv_unknown_outcome_token_no_longer_fails_closed_got_%__silent_success_on_a_money_path',
      v_result;
  END IF;
END;
$adv_money_path$;

ROLLBACK;
