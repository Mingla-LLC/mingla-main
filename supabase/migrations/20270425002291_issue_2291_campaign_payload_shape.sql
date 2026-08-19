-- issue #2291 — a `channel_payload` that does not satisfy its own channel's
-- required-key contract must not be storable.
--
-- WHY. `marketing_campaigns_payload_kind_valid` (Phase A,
-- 20260602000003_orch_0815_marketing_hub_phase_a.sql:211-217) validates the
-- DISCRIMINATOR and nothing it discriminates: payload is an object, `kind` is
-- one of email/sms/rcs, and `kind = channel`. So `'{"kind":"email"}'` — an
-- email campaign with no subject, no body, nothing at all — is a legal row.
-- That is the hole that let the `draft_campaign` agent tool write
-- `{kind:"email", body:"..."}` (one key, no `body_html`) and have it stored
-- cleanly, to be read back as an empty email by both the composer and the
-- send path.
--
-- WHAT THIS ADDS. A SECOND constraint alongside the first. The Phase A
-- constraint is NOT dropped and NOT altered — it still owns the discriminator;
-- this one owns the content. `ELSE false` also makes an `rcs` payload
-- unstorable, which is correct: `dispatchByKind` in marketing-send has no rcs
-- arm and throws `unknown_channel_kind:rcs`, so an rcs campaign could only ever
-- be claimed and then failed.
--
-- ============================================================================
-- `NOT VALID` IS MANDATORY AND DELIBERATE. DO NOT RUN `VALIDATE CONSTRAINT`.
-- ============================================================================
-- Read-only census of production taken 2026-08-19 immediately before authoring
-- (18 campaigns, 4 brands):
--
--   total campaigns .................................. 18
--   email rows ....................................... 12
--     ...that would violate the body predicate ....... 8   <-- all still 'draft'
--     ...whose `subject` is not a json string ........ 0
--     ...whose `subject` is blank .................... 9
--   sms rows ......................................... 6
--     ...that would violate the sms predicate ........ 3   <-- NOT in the #2291
--                                                            investigation; it
--                                                            only counted email
--   rows with kind outside (email,sms) ............... 0
--   NON-draft email rows with an empty body .......... 0   <-- nothing has ever
--                                                            been SENT blank
--
-- So `VALIDATE CONSTRAINT` would fail on ELEVEN live rows, not the eight the
-- investigation found. Worse than failing: validating (or writing the
-- constraint without `NOT VALID`) would strand eleven operators inside drafts
-- they can no longer save.
--
-- Note the 9 blank subjects. That is why this constraint requires `subject` to
-- be a PRESENT STRING but does NOT require it non-empty, while the send path
-- refuses a blank subject outright (`email_subject_empty`, marketing-send
-- index.ts). Seth's call on #2291: subject is enforced at DISPATCH, where
-- failing closed costs nothing, and not at REST, where it would break nine
-- half-written drafts. Do not "reconcile" the asymmetry by tightening this
-- constraint.
--
-- ============================================================================
-- THE DRAFT EXEMPTION — A DECIDED SPEC AMENDMENT, NOT AN OVERSIGHT.
-- ============================================================================
-- This constraint applies to rows that are NOT `draft`. A draft may be empty;
-- a campaign that has LEFT draft may not. That is a deliberate amendment to
-- SPEC §4.2, decided on #2291 after the conflict below was measured.
--
-- THE CONFLICT. SPEC §2 said: "Saving an empty draft is legitimate; scheduling
-- or sending one is not. Do not add friction to autosave." SPEC §4.2 then said
-- this constraint "leav[es] the 8 existing empty drafts readable and editable."
-- Both cannot be true of the SPEC's own predicate. `NOT VALID` skips only the
-- initial table scan; every future INSERT **and UPDATE** is still checked. So
-- the unexempted form would have meant:
--   * `useComposerDraft` autosave INSERTing a brand-new email draft before the
--     operator has typed a body (compose.tsx buildPayload -> body_html: "")
--     fails with `check_violation` — i.e. starting to write a campaign fails;
--   * any UPDATE to one of the 11 existing empty rows that does not ALSO fill
--     in the body fails the same way — a pure rename, an audience change.
-- The 11 empty rows in production are themselves the proof the composer does
-- this routinely: they exist because autosave created them.
--
-- WHY THE EXEMPTION IS THE RIGHT TRADE, and not a weakening. The LEVEL-1 SEND
-- GUARD is the actual protection: `email_body_empty` / `email_subject_empty` in
-- marketing-send refuse an empty body or subject AT DISPATCH regardless of how
-- the row was authored, which is the property that closes the path to a
-- customer. This constraint is defence-in-depth on top of that. Trading a real,
-- certain UX regression — autosave of a new draft failing — for redundant
-- protection at a layer the guard already covers is a bad trade: a constraint
-- that breaks the ordinary act of starting to write a campaign would be
-- reverted within a day, and then there would be neither.
--
-- WHAT THE EXEMPTION STILL BUYS, and it is more than it looks. Because the
-- predicate is evaluated against the row an UPDATE would PRODUCE, the
-- draft -> scheduled transition is itself checked: the UPDATE that sets
-- `status='scheduled'` on an empty campaign is REFUSED BY THE DATABASE. So
-- arming an empty campaign is blocked at the DB layer as well as in
-- `schedule_campaign`, and the 11 existing rows stay fully editable. That
-- resolves §2 and §4.2 in the direction §2 wanted.
--
-- CONSEQUENCE FOR `NOT VALID`: under this exemption ZERO live rows violate
-- (all 11 violators are drafts), so `NOT VALID` is now belt-and-braces rather
-- than strictly mandatory. It is kept as the SPEC specified, deliberately —
-- it costs an ACCESS EXCLUSIVE full-table scan to gain nothing, and it keeps
-- the door open if a non-draft violator is ever discovered. The ban on
-- `VALIDATE CONSTRAINT` stands.
--
-- NO DATA MIGRATION, NO BACKFILL, NO CLEANUP. The 11 rows are user data. They
-- become harmless the moment the send guard lands, and their owners must be
-- able to find them and finish or discard them.

-- ============================================================================
-- THE `coalesce` IS NOT COSMETIC — THE SPEC'S PREDICATE WAS A NO-OP WITHOUT IT.
-- ============================================================================
-- SPEC §4.2 specified this predicate WITHOUT the outer `coalesce(..., false)`.
-- Written that way it returns SQL NULL — not false — whenever a required key is
-- ABSENT, because `channel_payload->'subject'` on a missing key yields SQL NULL,
-- `jsonb_typeof(NULL)` yields NULL, `NULL = 'string'` yields NULL, and
-- `NULL AND true` yields NULL. **A CHECK constraint treats NULL as SATISFIED.**
--
-- Measured read-only against production 2026-08-19, evaluating the SPEC's exact
-- predicate as a SELECT (no writes):
--
--   payload                                          SPEC verbatim   want
--   ----------------------------------------------   -------------   ----
--   {"kind":"email"}                                  NULL -> PASS   reject
--   {"kind":"email","subject":"x","body":"..."}       NULL -> PASS   reject   <-- THE #2291 PAYLOAD
--   {"kind":"email","body_html":"has body"}           NULL -> PASS   reject
--   {"kind":"sms"}                                    NULL -> PASS   reject
--   {"kind":"email","subject":"x","body_html":""}     false          reject   (ok)
--   {"kind":"rcs","body":"x"}                         false          reject   (ok)
--
-- So the SPEC's own SC-6 ("INSERT of '{"kind":"email"}' is rejected") fails
-- against the SPEC's own SQL, and the constraint added to stop the `draft_
-- campaign` write would have admitted it unchanged. It is the
-- cannot-fail-check bug class: green, and carrying no information.
--
-- It would ALSO have looked correct in review and in any data-shaped test,
-- because every one of the 18 rows in production today happens to carry its
-- keys — 11 violate the CONTENT predicate on VALUE (empty string), 0 reach the
-- NULL arm. The hole opens only for the future write this issue exists to
-- prevent.
--
-- (Those 11 are all DRAFTS, so under the draft exemption above they violate the
-- CONSTRAINT AS SHIPPED zero times. The two counts are not in conflict: 11 is
-- how many rows the content predicate alone would reject; 0 is how many the
-- shipped constraint rejects. Measured read-only: 18 rows, 11 content-predicate
-- violators, all 11 draft, 6 non-draft rows, 0 non-draft violators.)
--
-- Corrected here by wrapping the SPEC's predicate, unchanged inside, in
-- `coalesce(..., false)`. Intent is identical; only the missing-key arm moves
-- from PASS to REJECT, which is what §4.2's prose ("a payload missing the keys
-- its own channel requires cannot be stored at all") always said it did.

BEGIN;

ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_payload_content_required CHECK (
    -- ONE `coalesce` WRAPPING EVERYTHING. IT IS LOAD-BEARING, AND IT IS THE
    -- WHOLE CONSTRAINT. See "THE `coalesce` IS NOT COSMETIC" in the header:
    -- without it this predicate evaluates to NULL — which a CHECK treats as
    -- PASS — for every payload MISSING a key, including the exact
    -- `{kind, subject, body}` shape #2291 was filed about. It wraps the OUTER
    -- expression, not just the inner CASE, so no arm of this constraint can
    -- return NULL by any route. Do not remove it and do not "simplify" it away.
    coalesce(
      CASE
        -- THE DRAFT EXEMPTION (see header). A draft may be empty — that is how
        -- writing a campaign starts. Note this is evaluated against the row an
        -- UPDATE would PRODUCE, so the draft -> scheduled transition on an
        -- empty campaign is refused here.
        WHEN status = 'draft' THEN true
        ELSE CASE channel_payload->>'kind'
          WHEN 'email' THEN
            jsonb_typeof(channel_payload->'subject')   = 'string'
            AND jsonb_typeof(channel_payload->'body_html') = 'string'
            AND btrim(channel_payload->>'body_html') <> ''
          WHEN 'sms' THEN
            jsonb_typeof(channel_payload->'body') = 'string'
            AND btrim(channel_payload->>'body') <> ''
          ELSE false
        END
      END,
      false
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT marketing_campaigns_payload_content_required
  ON public.marketing_campaigns IS
  'issue #2291 — a campaign that has LEFT draft must carry the content its own '
  'channel reads. email: subject present-as-string, body_html present-as-string '
  'and non-blank. sms: body present-as-string and non-blank. Any other kind '
  '(incl. rcs, which marketing-send cannot dispatch) is unstorable. DRAFTS ARE '
  'EXEMPT by decision on #2291 — a draft may be empty, which is how writing a '
  'campaign starts; the draft -> scheduled UPDATE is still checked, so an empty '
  'campaign cannot be armed. NOT VALID is preserved and VALIDATE CONSTRAINT is '
  'banned. The last line before a real customer inbox is NOT this constraint — '
  'it is the email_body_empty / email_subject_empty throws in marketing-send.';

-- ===========================================================================
-- SELF-TEST — proves the constraint exists, is NOT VALID, and actually accepts
-- and rejects the right payloads.
--
-- IT WRITES NOTHING TO `marketing_campaigns`. The cases run against a TEMP
-- table carrying the constraint's OWN definition, read back out of
-- `pg_get_constraintdef`. That is deliberate: a hand-retyped copy of the
-- predicate could drift from the real one and self-test a fiction, and
-- inserting real rows to prove a rejection would mean writing production data
-- to test a constraint that exists to protect it.
-- ===========================================================================
DO $selftest$
DECLARE
  v_def       text;
  v_validated boolean;
  v_rejected  boolean;
  v_status    text;
  v_payload   jsonb;
  -- (status, payload, must_be_accepted)
  v_cases     jsonb := $cases$[
    {"s":"scheduled","p":{"kind":"email"},                                                                 "ok":false},
    {"s":"scheduled","p":{"kind":"email","subject":"x","body_html":""},                                    "ok":false},
    {"s":"scheduled","p":{"kind":"email","subject":"x","body_html":"   "},                                 "ok":false},
    {"s":"scheduled","p":{"kind":"email","subject":"x","body":"wrong key - the #2291 defect"},             "ok":false},
    {"s":"scheduled","p":{"kind":"email","body_html":"has a body, no subject key"},                        "ok":false},
    {"s":"scheduled","p":{"kind":"email","subject":null,"body_html":"subject is json null, not a string"}, "ok":false},
    {"s":"scheduled","p":{"kind":"sms","body":""},                                                         "ok":false},
    {"s":"scheduled","p":{"kind":"sms"},                                                                   "ok":false},
    {"s":"scheduled","p":{"kind":"rcs","body":"x"},                                                        "ok":false},
    {"s":"scheduled","p":{"kind":"rcs","subject":"x","body_html":"x"},                                     "ok":false},
    {"s":"sending",  "p":{"kind":"email","subject":"x","body_html":""},                                    "ok":false},
    {"s":"sent",     "p":{"kind":"email","subject":"x","body_html":""},                                    "ok":false},
    {"s":"failed",   "p":{"kind":"email"},                                                                 "ok":false},
    {"s":"cancelled","p":{"kind":"email","subject":"x","body":"the Ari shape"},                            "ok":false},

    {"s":"scheduled","p":{"kind":"email","subject":"Doors at 9","body_html":"<p>See you.</p>","body_text":"See you.","embedded_events":[]}, "ok":true},
    {"s":"scheduled","p":{"kind":"email","subject":"","body_html":"<p>Body is what matters at rest.</p>"},  "ok":true},
    {"s":"scheduled","p":{"kind":"sms","body":"Doors at 9. Reply STOP to opt out."},                        "ok":true},

    {"s":"draft",    "p":{"kind":"email"},                                                                 "ok":true},
    {"s":"draft",    "p":{"kind":"email","subject":"","body_html":""},                                     "ok":true},
    {"s":"draft",    "p":{"kind":"email","subject":"x","body":"the Ari shape"},                             "ok":true},
    {"s":"draft",    "p":{"kind":"sms","body":""},                                                         "ok":true},
    {"s":"draft",    "p":{"kind":"rcs","body":"x"},                                                        "ok":true},
    {"s":"draft",    "p":{"kind":"email","subject":"Doors at 9","body_html":"<p>See you.</p>"},              "ok":true}
  ]$cases$::jsonb;
  v_case      jsonb;
  v_want      boolean;
BEGIN
  SELECT pg_get_constraintdef(oid), convalidated
    INTO v_def, v_validated
    FROM pg_constraint
   WHERE conname = 'marketing_campaigns_payload_content_required'
     AND conrelid = 'public.marketing_campaigns'::regclass;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '#2291 self-test: constraint marketing_campaigns_payload_content_required was not created';
  END IF;

  IF v_validated THEN
    RAISE EXCEPTION
      '#2291 self-test: constraint is VALIDATED. It must stay NOT VALID (see header) and VALIDATE CONSTRAINT is banned.';
  END IF;

  -- The two properties the whole fix rests on, asserted against the constraint
  -- as the SERVER stored it rather than as this file typed it.
  IF position('coalesce' in lower(v_def)) = 0 THEN
    RAISE EXCEPTION
      '#2291 self-test: the stored constraint has NO coalesce. Without it the predicate returns SQL NULL for a payload MISSING a key, and a CHECK treats NULL as SATISFIED — the constraint would silently accept the exact payload #2291 was filed about.';
  END IF;
  IF position('status' in lower(v_def)) = 0 THEN
    RAISE EXCEPTION
      '#2291 self-test: the stored constraint has NO status arm. The draft exemption is a decided amendment (see header) — without it, composer autosave of a new empty draft fails with check_violation and the constraint gets reverted.';
  END IF;

  -- The Phase A discriminator constraint must survive untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'marketing_campaigns_payload_kind_valid'
       AND conrelid = 'public.marketing_campaigns'::regclass
  ) THEN
    RAISE EXCEPTION '#2291 self-test: the Phase A constraint marketing_campaigns_payload_kind_valid is gone — it must be added alongside, never replaced';
  END IF;

  CREATE TEMP TABLE issue_2291_probe (
    status          text  NOT NULL,
    channel_payload jsonb NOT NULL
  ) ON COMMIT DROP;
  EXECUTE format(
    'ALTER TABLE issue_2291_probe ADD CONSTRAINT issue_2291_probe_content %s', v_def
  );

  FOR v_case IN SELECT * FROM jsonb_array_elements(v_cases) LOOP
    v_status  := v_case->>'s';
    v_payload := v_case->'p';
    v_want    := (v_case->>'ok')::boolean;
    v_rejected := false;
    BEGIN
      EXECUTE 'INSERT INTO issue_2291_probe (status, channel_payload) VALUES ($1, $2)'
        USING v_status, v_payload;
    EXCEPTION WHEN check_violation THEN
      v_rejected := true;
    END;
    IF v_rejected = v_want THEN
      RAISE EXCEPTION '#2291 self-test: status=% payload=% was % but must be %',
        v_status, v_payload,
        CASE WHEN v_rejected THEN 'REJECTED' ELSE 'ACCEPTED' END,
        CASE WHEN v_want THEN 'ACCEPTED' ELSE 'REJECTED' END;
    END IF;
  END LOOP;

  -- THE TRANSITION, ASSERTED DIRECTLY. This is what the draft exemption still
  -- buys: an empty draft is storable, and arming it is refused BY THE DATABASE,
  -- not only by schedule_campaign.
  BEGIN
    EXECUTE $x$UPDATE issue_2291_probe SET status = 'scheduled'
              WHERE status = 'draft' AND channel_payload = '{"kind":"email"}'::jsonb$x$;
    RAISE EXCEPTION '#2291 self-test: an EMPTY draft was allowed to become scheduled. The draft -> scheduled UPDATE must be refused.';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- ...and a draft that HAS content still arms cleanly, so the rule above is a
  -- content check and not a blanket freeze on the transition.
  EXECUTE $x$UPDATE issue_2291_probe SET status = 'scheduled'
            WHERE status = 'draft'
              AND channel_payload = '{"kind":"email","subject":"Doors at 9","body_html":"<p>See you.</p>"}'::jsonb$x$;
  IF NOT FOUND THEN
    RAISE EXCEPTION '#2291 self-test: the complete draft did not arm — the transition check is over-broad.';
  END IF;

  -- ...and an existing empty draft stays EDITABLE, which is the property the
  -- 11 live rows depend on (SC-7).
  EXECUTE $x$UPDATE issue_2291_probe SET channel_payload = channel_payload || '{"subject":"renamed"}'::jsonb
            WHERE status = 'draft' AND channel_payload = '{"kind":"email"}'::jsonb$x$;
  IF NOT FOUND THEN
    RAISE EXCEPTION '#2291 self-test: an existing empty draft could not be edited — the 11 live rows would be stranded.';
  END IF;

  DROP TABLE issue_2291_probe;

  RAISE NOTICE '#2291 self-test PASS — constraint present, NOT VALID preserved, coalesce and status arms both present in the STORED definition, Phase A constraint intact, 23 status/payload cases verified, empty draft refused at the scheduled transition, complete draft still arms, empty draft still editable.';
END
$selftest$;

COMMIT;
