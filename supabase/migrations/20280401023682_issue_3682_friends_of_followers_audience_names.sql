-- #3682 closeout — rename stored "Extended circle" system audiences to
-- "Friends of followers" (#3774 wording). 20270805003682 renames a row only
-- when the audience is re-ensured; rows created by #1778 before that keep the
-- old name in campaign lists until then. Data-only, idempotent, no triggers on
-- marketing_audiences. The get_brand_circle_reach member wire label is left
-- unchanged on purpose: installed Host binaries validate it exactly, and the
-- Host client now maps it to "Friend of a follower." for display.

BEGIN;

UPDATE public.marketing_audiences
   SET name = 'Friends of followers'
 WHERE is_system_generated
   AND query_definition ->> 'kind' = 'brand_circle_extended'
   AND name = 'Extended circle';

COMMIT;
