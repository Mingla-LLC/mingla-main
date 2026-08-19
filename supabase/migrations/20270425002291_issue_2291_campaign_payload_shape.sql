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
-- KNOWN CONTRADICTION WITH THE #2291 SPEC — READ BEFORE APPLYING.
-- ============================================================================
-- SPEC §2 says: "The composer's ability to save an empty draft. Saving an empty
-- draft is legitimate; scheduling or sending one is not. Do not add friction to
-- autosave." SPEC §4.2 then says this constraint "leav[es] the 8 existing empty
-- drafts readable and editable."
--
-- Both cannot be true. `NOT VALID` skips only the initial table scan; every
-- future INSERT **and UPDATE** is still checked. So once this is applied:
--   * `useComposerDraft` autosave INSERTing a brand-new email draft before the
--     operator has typed a body (compose.tsx buildPayload -> body_html: "")
--     fails with `check_violation`;
--   * any UPDATE to one of the 11 existing empty rows that does not ALSO fill
--     in the body fails the same way — including a pure rename or an audience
--     change.
-- The 11 empty rows in production are themselves the proof that the composer
-- does this routinely: they exist because autosave created them.
--
-- The one-line amendment that resolves it, if Seth wants both properties, is to
-- exempt drafts — `CASE WHEN status <> 'draft' THEN <checks below> ELSE true
-- END` — which still makes it impossible to STORE a scheduled/sending/sent
-- campaign with no content, which is the actual harm. That is a SPEC amendment,
-- not an implementor decision, so this file ships the SPEC's predicate verbatim
-- and the decision is recorded on the issue.
--
-- Either way the email path is already closed: the `email_body_empty` /
-- `email_subject_empty` throws in marketing-send hold regardless of what is
-- stored, and they are the last line before a customer inbox.
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
-- keys — 11 violate on VALUE (empty string), 0 reach the NULL arm. The hole
-- opens only for the future write this issue exists to prevent.
--
-- Corrected here by wrapping the SPEC's predicate, unchanged inside, in
-- `coalesce(..., false)`. Intent is identical; only the missing-key arm moves
-- from PASS to REJECT, which is what §4.2's prose ("a payload missing the keys
-- its own channel requires cannot be stored at all") always said it did.

BEGIN;

ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_payload_content_required CHECK (
    -- `coalesce(..., false)` IS LOAD-BEARING. IT IS THE WHOLE CONSTRAINT.
    -- See "THE `coalesce` IS NOT COSMETIC" in the header. Without it this
    -- predicate evaluates to NULL — which a CHECK treats as PASS — for every
    -- payload that is MISSING a key, including the exact `{kind, subject, body}`
    -- shape #2291 was filed about. Do not remove it, and do not "simplify" it
    -- away in a later refactor.
    coalesce(
      CASE channel_payload->>'kind'
        WHEN 'email' THEN
          jsonb_typeof(channel_payload->'subject')   = 'string'
          AND jsonb_typeof(channel_payload->'body_html') = 'string'
          AND btrim(channel_payload->>'body_html') <> ''
        WHEN 'sms' THEN
          jsonb_typeof(channel_payload->'body') = 'string'
          AND btrim(channel_payload->>'body') <> ''
        ELSE false
      END,
      false
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT marketing_campaigns_payload_content_required
  ON public.marketing_campaigns IS
  'issue #2291 — a channel_payload must carry the keys its own channel reads. '
  'email: subject present-as-string, body_html present-as-string and non-blank. '
  'sms: body present-as-string and non-blank. Any other kind (incl. rcs, which '
  'marketing-send cannot dispatch) is unstorable. Deliberately NOT VALID: 11 '
  'pre-existing draft rows violate it and are user data. The last line before a '
  'real customer inbox is NOT this constraint — it is the email_body_empty / '
  'email_subject_empty throws in marketing-send.';

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
  v_case      jsonb;
  v_cases     jsonb[] := ARRAY[
    -- Must be REJECTED.
    '{"kind":"email"}'::jsonb,
    '{"kind":"email","subject":"x","body_html":""}'::jsonb,
    '{"kind":"email","subject":"x","body_html":"   "}'::jsonb,
    '{"kind":"email","subject":"x","body":"wrong key — this is the #2291 defect"}'::jsonb,
    '{"kind":"email","body_html":"has a body, no subject key"}'::jsonb,
    '{"kind":"email","subject":null,"body_html":"subject is json null, not a string"}'::jsonb,
    -- The four NULL-arm cases above/below are the ones the SPEC's uncoalesced
    -- predicate silently ACCEPTED. If a later edit drops the coalesce, these
    -- are the assertions that go red.
    '{"kind":"sms","body":""}'::jsonb,
    '{"kind":"sms"}'::jsonb,
    '{"kind":"rcs","body":"x"}'::jsonb,
    '{"kind":"rcs","subject":"x","body_html":"x"}'::jsonb
  ];
  v_accept    jsonb[] := ARRAY[
    -- Must be ACCEPTED.
    '{"kind":"email","subject":"Doors at 9","body_html":"<p>See you there.</p>","body_text":"See you there.","embedded_events":[]}'::jsonb,
    -- subject present but blank: legal AT REST (9 such drafts exist), refused
    -- at DISPATCH by email_subject_empty.
    '{"kind":"email","subject":"","body_html":"<p>Body is what matters here.</p>"}'::jsonb,
    '{"kind":"sms","body":"Doors at 9. Reply STOP to opt out."}'::jsonb
  ];
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
      '#2291 self-test: constraint is VALIDATED. It must stay NOT VALID — 11 live draft rows violate it and are user data.';
  END IF;

  -- The Phase A discriminator constraint must survive untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'marketing_campaigns_payload_kind_valid'
       AND conrelid = 'public.marketing_campaigns'::regclass
  ) THEN
    RAISE EXCEPTION '#2291 self-test: the Phase A constraint marketing_campaigns_payload_kind_valid is gone — it must be added alongside, never replaced';
  END IF;

  CREATE TEMP TABLE issue_2291_probe (channel_payload jsonb NOT NULL) ON COMMIT DROP;
  EXECUTE format(
    'ALTER TABLE issue_2291_probe ADD CONSTRAINT issue_2291_probe_content %s', v_def
  );

  FOREACH v_case IN ARRAY v_cases LOOP
    v_rejected := false;
    BEGIN
      EXECUTE 'INSERT INTO issue_2291_probe (channel_payload) VALUES ($1)' USING v_case;
    EXCEPTION WHEN check_violation THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION '#2291 self-test: payload % was ACCEPTED but must be rejected', v_case;
    END IF;
  END LOOP;

  FOREACH v_case IN ARRAY v_accept LOOP
    BEGIN
      EXECUTE 'INSERT INTO issue_2291_probe (channel_payload) VALUES ($1)' USING v_case;
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION '#2291 self-test: payload % was REJECTED but must be accepted', v_case;
    END;
  END LOOP;

  DROP TABLE issue_2291_probe;

  RAISE NOTICE '#2291 self-test PASS — constraint present, NOT VALID preserved, Phase A constraint intact, 10 rejections and 3 acceptances verified against the constraint''s own definition.';
END
$selftest$;

COMMIT;
