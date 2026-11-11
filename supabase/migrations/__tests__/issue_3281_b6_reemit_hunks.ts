/**
 * issue #3281 bundle 6 — the ONLY authorised hunks for every function
 * 20280625003281 re-emits. issue_3281_b6_reemit_hunks.structural.test.ts proves
 * each body equals its latest earlier definition with exactly these
 * replacements applied. Generated; edit the hunks here and the migration together.
 */
import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const TARGET =
  "supabase/migrations/20280625003281_issue_3281_dates_never_orphan.sql";

/** Functions this migration defines for the first time. */
export const B6_NEW_FUNCTIONS = ["issue_3281_event_date_deletable"];

export const B6_REEMITS: Reemit[] = [
  {
    "fn": "issue_3281_explorer_date_listable_rows",
    "source":
      "supabase/migrations/20280327003281_issue_3281_explorer_listing_per_date.sql",
    "target": TARGET,
    "hunks": [
      {
        "name":
          "a cancelled date is never listed, also for an event that sells nothing online",
        "old":
          "   WHERE d.id = p_event_date_id\n     AND d.event_id = p_event_id\n",
        "new":
          "   WHERE d.id = p_event_date_id\n     AND d.event_id = p_event_id\n     -- #3281 bundle 6: a cancelled date is never listed. The buyable-tier\n     -- arm below already said so; an event that sells nothing online (free,\n     -- door-only, RSVP) was listed on its cancelled dates.\n     AND d.cancelled_at IS NULL\n",
      },
    ],
  },
  {
    "fn": "biz_publish_experience",
    "source":
      "supabase/migrations/20280428003645_issue_3645_sell_publish_integrity.sql",
    "target": TARGET,
    "hunks": [
      {
        "name": "publishing again never deletes a date that holds sales",
        "old":
          "  IF p_publish THEN\n    DELETE FROM public.event_dates WHERE event_id = p_event_id;\n",
        "new":
          "  IF p_publish THEN\n    -- #3281 bundle 6: publishing again rebuilds every date. A date that\n    -- holds sales, a pass, a check-in or a payout is never deleted (its\n    -- orders would lose their date); live changes go through\n    -- biz_update_live_experience, which edits dates in place.\n    IF EXISTS (\n      SELECT 1 FROM public.event_dates d\n       WHERE d.event_id = p_event_id\n         AND NOT public.issue_3281_event_date_deletable(d.id)\n    ) THEN\n      RAISE EXCEPTION 'experience_dates_have_sales';\n    END IF;\n    DELETE FROM public.event_dates WHERE event_id = p_event_id;\n",
      },
    ],
  },
  {
    "fn": "biz_update_live_rsvp",
    "source":
      "supabase/migrations/20280523003281_issue_3281_cancelled_dates_and_live_save.sql",
    "target": TARGET,
    "hunks": [
      {
        "name": "an extra legacy date row that something holds is kept",
        "old":
          "      DELETE FROM public.event_dates WHERE event_id = p_event_id AND id <> v_date_row;\n",
        "new":
          "      -- #3281 bundle 6: only extra rows nothing holds are removed.\n      DELETE FROM public.event_dates WHERE event_id = p_event_id AND id <> v_date_row\n        AND public.issue_3281_event_date_deletable(id);\n",
      },
    ],
  },
];
