-- issue #3526 [Gemini repin] — migration C of three. M-3.
--
-- WHY. `gemini` is registered monitoring_class B (reactive-only) and its
-- `depletion_signal.reactive` matches EXACTLY ONE fingerprint:
--   {"http":429,"field":"type","match":"RESOURCE_EXHAUSTED"}
-- Neither the 2026-09-17 403 PERMISSION_DENIED nor the 2026-09-21 404 NOT_FOUND
-- is in that set, so both outages were invisible to the monitor BY
-- CONFIGURATION, not by staleness. Compare `serper`, which already matches
-- 400/401/402/403/429.
--
-- A 429 means we ran out of quota. A 403 means we are being refused. A 404 on
-- a model means the model is GONE. They are different faults and they want
-- different words, so `reactive` becomes an ARRAY of matchers and each carries
-- an optional `kind`:
--   depletion  — quota exhausted (the historical meaning; the default)
--   refusal    — permission denied / key restricted / billing
--   retirement — the pinned model no longer exists for this caller
-- `api-health-probe/logic.ts matchClassBDepletion` accepts both the array and
-- the single-object shape, so every OTHER service's depletion_signal keeps
-- working untouched. Verified against the live rows for openai and serper.
--
-- WHY A NEW MIGRATION. `20261121000000_orch_1201_r2_api_health_classes.sql` is
-- APPLIED and stays byte-identical.
--
-- SAFE-MIGRATION: one UPDATE of one jsonb column on one row of a registry
-- table. Idempotent (it sets an absolute value, not a merge of the old one).
-- Scoped by `WHERE service_key = 'gemini'` — no other service is touched.
-- Reversible (ROLLBACK below restores the exact pre-#3526 value, which was
-- read off production on 2026-09-21 before this was written).

UPDATE public.api_health_services
   SET depletion_signal = jsonb_build_object(
         'status_feed', NULL,  -- AI Studio has no Atlassian status feed
         'reactive', jsonb_build_array(
           -- quota exhaustion (esp. limit:0 = billing demoted). UNCHANGED
           -- semantics — this is the matcher that existed before #3526.
           jsonb_build_object(
             'http', 429, 'match', 'RESOURCE_EXHAUSTED', 'field', 'type',
             'kind', 'depletion'),
           -- 2026-09-17: a genuine permission refusal. Was not matchable.
           jsonb_build_object(
             'http', 403, 'match', 'PERMISSION_DENIED', 'field', 'type',
             'kind', 'refusal'),
           -- 2026-09-21: the pinned model was retired out from under us.
           -- Surfaces DISTINCTLY — a retirement is not a depletion, and
           -- labelling it "depleted" would send the next reader to check
           -- billing instead of the model pin.
           jsonb_build_object(
             'http', 404, 'match', 'NOT_FOUND', 'field', 'type',
             'kind', 'retirement')
         ))
 WHERE service_key = 'gemini';

-- ROLLBACK (manual, forward-only pipeline — documented per safe-migration
-- protocol). Restores the exact value read off production 2026-09-21:
--   UPDATE public.api_health_services
--      SET depletion_signal = jsonb_build_object(
--            'status_feed', NULL,
--            'reactive', jsonb_build_object(
--              'http',429,'match','RESOURCE_EXHAUSTED','field','type'))
--    WHERE service_key = 'gemini';
