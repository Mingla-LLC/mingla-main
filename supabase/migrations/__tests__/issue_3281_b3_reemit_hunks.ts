/**
 * issue #3281 bundle 3 — the ONLY authorised hunks for every function
 * 20280523003281 re-emits. issue_3281_b3_reemit_hunks.structural.test.ts proves
 * each body equals the latest earlier definition with exactly these
 * replacements applied, so nothing else in these functions moves silently.
 * Generated; edit the hunks here and the migration together.
 */
import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const TARGET = "supabase/migrations/20280523003281_issue_3281_cancelled_dates_and_live_save.sql";

export const B3_REEMITS: Reemit[] = [
  {
    fn: "issue_3281_strip_removed_days",
    source: "supabase/migrations/20280314003281_issue_3281_extras_authoring.sql",
    target: TARGET,
    hunks: [
      {
        name: "the live save defers the strip until its tickets are written",
        old: "BEGIN\n  FOR v_ticket IN\n",
        new: "BEGIN\n  -- issue #3281: business_update_live_event_atomic writes the dates, then\n  -- the tickets, then strips once (so a ticket moved off a removed date is\n  -- judged on its new list). A direct when-save still strips here.\n  IF current_setting('mingla.issue_3281_defer_day_strip', true) = 'on' THEN\n    RETURN;\n  END IF;\n  FOR v_ticket IN\n",
      },
    ],
  },
  {
    fn: "business_update_live_event_atomic",
    source: "supabase/migrations/20280521004334_issue_4334_google_places.sql",
    target: TARGET,
    hunks: [
      {
        name: "removed-date bookkeeping for the ticket write",
        old: "  v_notice jsonb;  -- issue #3827 buyer email\n",
        new: "  v_notice jsonb;  -- issue #3827 buyer email\n  v_keys_before text[];   -- issue #3281\n  v_removed_keys text[];  -- issue #3281\n  v_ticket_patch jsonb;   -- issue #3281\n",
      },
      {
        name: "tickets are no longer written before the dates",
        old: "  IF v_core ? 'tickets' THEN\n    PERFORM public.business_patch_event_ticket_tiers(\n      p_event_id,v_core->'tickets',NULL,NULL,NULL,v_reason   -- issue #3827\n    );\n  END IF;\n\n  IF v_taxonomy IS NOT NULL THEN\n",
        new: "  IF v_taxonomy IS NOT NULL THEN\n",
      },
      {
        name: "dates, then tickets, then one strip of removed dates",
        old: "    PERFORM public.business_patch_event_when(\n      p_event_id,v_when,v_reason,p_client_revision   -- issue #3827\n    );\n  END IF;\n",
        new: "    -- issue #3281: dates first, so a ticket or extra in this same save can\n    -- name a date the save adds. Removed dates are stripped from ticket and\n    -- extra lists once the tickets are written (below), so a ticket moved\n    -- off a removed date is judged on its new list, not its old one.\n    PERFORM set_config('mingla.issue_3281_defer_day_strip','on',true);\n    -- issue #3281: the keys of the dates this save removes (before minus after).\n    SELECT COALESCE(array_agg(d.occurrence_key),'{}'::text[]) INTO v_keys_before\n      FROM public.event_dates d\n     WHERE d.event_id=p_event_id AND d.occurrence_key IS NOT NULL;\n    PERFORM public.business_patch_event_when(\n      p_event_id,v_when,v_reason,p_client_revision   -- issue #3827\n    );\n    PERFORM set_config('mingla.issue_3281_defer_day_strip','',true);\n    v_removed_keys:=ARRAY(\n      SELECT k FROM unnest(v_keys_before) k\n       WHERE NOT EXISTS (SELECT 1 FROM public.event_dates d\n                          WHERE d.event_id=p_event_id AND d.occurrence_key=k));\n  END IF;\n\n  IF v_core ? 'tickets' THEN\n    v_ticket_patch:=v_core->'tickets';\n    -- issue #3281: a ticket or extra sent with a date this save removed (the\n    -- Host trims tickets' lists, never extras') drops that date, the way the\n    -- publish path drops a deleted draft date. Only removed dates are dropped:\n    -- an unknown date is still refused, and a list left empty is refused\n    -- (*_scope_empty), never widened to every date. Kept extras that are not\n    -- sent lose a removed date here too, so they still fit their ticket.\n    IF v_mode='multi_date' AND COALESCE(cardinality(v_removed_keys),0)>0\n       AND jsonb_typeof(v_ticket_patch)='array' THEN\n      SELECT COALESCE(jsonb_agg(\n          (CASE WHEN jsonb_typeof(t.value->'validDayIds')='array'\n                THEN jsonb_set(t.value,'{validDayIds}',COALESCE((\n                  SELECT jsonb_agg(k.value ORDER BY k.n)\n                    FROM jsonb_array_elements(t.value->'validDayIds') WITH ORDINALITY k(value,n)\n                   WHERE NOT ((k.value#>>'{}') = ANY (v_removed_keys))),'[]'::jsonb))\n                ELSE t.value END)\n          || CASE WHEN jsonb_typeof(t.value->'extras')='array'\n               THEN jsonb_build_object('extras',(\n                 SELECT COALESCE(jsonb_agg((CASE WHEN jsonb_typeof(x.value->'validDayIds')='array'\n                THEN jsonb_set(x.value,'{validDayIds}',COALESCE((\n                  SELECT jsonb_agg(k.value ORDER BY k.n)\n                    FROM jsonb_array_elements(x.value->'validDayIds') WITH ORDINALITY k(value,n)\n                   WHERE NOT ((k.value#>>'{}') = ANY (v_removed_keys))),'[]'::jsonb))\n                ELSE x.value END) ORDER BY x.n),'[]'::jsonb)\n                   FROM jsonb_array_elements(t.value->'extras') WITH ORDINALITY x(value,n)))\n               ELSE '{}'::jsonb END\n          ORDER BY t.n),'[]'::jsonb)\n        INTO v_ticket_patch\n        FROM jsonb_array_elements(v_ticket_patch) WITH ORDINALITY t(value,n);\n      UPDATE public.ticket_add_ons a\n         SET valid_occurrence_keys=ARRAY(\n               SELECT k FROM unnest(a.valid_occurrence_keys) k\n                WHERE NOT (k = ANY (v_removed_keys)) ORDER BY k),\n             updated_at=now()\n        FROM public.ticket_types tt\n       WHERE tt.id=a.ticket_type_id AND tt.event_id=p_event_id\n         AND a.valid_occurrence_keys && v_removed_keys\n         AND EXISTS (SELECT 1 FROM unnest(a.valid_occurrence_keys) k\n                      WHERE NOT (k = ANY (v_removed_keys)));\n    END IF;\n    PERFORM public.business_patch_event_ticket_tiers(\n      p_event_id,v_ticket_patch,NULL,NULL,NULL,v_reason   -- issue #3827\n    );\n  END IF;\n\n  IF v_when IS NOT NULL THEN\n    -- issue #3281: the strip business_patch_event_when deferred. A list left\n    -- with no date is refused (tier_day_scope_empty), never widened.\n    PERFORM public.issue_3281_strip_removed_days(p_event_id);\n    -- issue #3281: business_patch_event_when judged offering_date_past on\n    -- the tickets stored before this save. Judge it again on the tickets\n    -- this save wrote, so a save that makes a ticket paid cannot also move\n    -- every date into the past.\n    IF EXISTS (SELECT 1 FROM public.ticket_types t\n                WHERE t.event_id=p_event_id AND t.deleted_at IS NULL\n                  AND t.available_online=true AND t.price_cents>0)\n       AND COALESCE((SELECT max(ed.end_at) FROM public.event_dates ed\n                      WHERE ed.event_id=p_event_id),'-infinity'::timestamptz)<=now() THEN\n      RAISE EXCEPTION 'offering_date_past';\n    END IF;\n  END IF;\n",
      },
    ],
  },
  {
    fn: "biz_comp_issue",
    source: "supabase/migrations/20271218024063_issue_4063_claim_writers.sql",
    target: TARGET,
    hunks: [
      {
        name: "an event whose upcoming dates are all cancelled issues no comp",
        old: "    RAISE EXCEPTION 'event_already_ended';\n  END IF;\n",
        new: "    RAISE EXCEPTION 'event_already_ended';\n  END IF;\n  -- issue #3281: every upcoming date was cancelled. Nothing can be issued,\n  -- and the event has not ended, so the answer is the one checkout gives.\n  IF NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id\n                  AND d.end_at > now() AND d.status = 'active')\n     AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id\n                  AND d.end_at > now() AND d.status <> 'active') THEN\n    RAISE EXCEPTION 'occurrence_not_available';\n  END IF;\n",
      },
      {
        name: "a cancelled date cannot be chosen for a comp",
        old: "                    WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.end_at > now()) THEN\n",
        new: "                    WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.end_at > now()\n                      AND d.status = 'active') THEN  -- issue #3281\n",
      },
    ],
  },
  {
    fn: "biz_issue_comp",
    source: "supabase/migrations/20271224003872_issue_3872_r3_foundation.sql",
    target: TARGET,
    hunks: [
      {
        name: "the occurrence resolves to an active date only",
        old: "   WHERE d.event_id=p_event_id\n     AND (d.start_at=p_occurrence_at",
        new: "   WHERE d.event_id=p_event_id AND d.status='active'  -- issue #3281\n     AND (d.start_at=p_occurrence_at",
      },
    ],
  },
  {
    fn: "biz_ticket_link_create",
    source: "supabase/migrations/20271209003827_issue_3827_private_ticket_links.sql",
    target: TARGET,
    hunks: [
      {
        name: "no link for an event whose upcoming dates are all cancelled",
        old: "    RAISE EXCEPTION 'event_ended';\n  END IF;\n",
        new: "    RAISE EXCEPTION 'event_ended';\n  END IF;\n  -- issue #3281: every upcoming date was cancelled. Nothing can be issued,\n  -- and the event has not ended, so the answer is the one checkout gives.\n  IF NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id\n                  AND d.end_at > now() AND d.status = 'active')\n     AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id\n                  AND d.end_at > now() AND d.status <> 'active') THEN\n    RAISE EXCEPTION 'occurrence_not_available';\n  END IF;\n",
      },
      {
        name: "a link cannot be pinned to a cancelled date",
        old: "     WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.end_at > now()\n  ) THEN\n",
        new: "     WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.end_at > now()\n       AND d.status = 'active'  -- issue #3281\n  ) THEN\n",
      },
    ],
  },
  {
    fn: "pg_ticket_link_signup_days",
    source: "supabase/migrations/20271211003827_issue_3827_link_cover_and_dates.sql",
    target: TARGET,
    hunks: [
      {
        name: "no sign-up once every upcoming date is cancelled",
        old: "  v_per_date := COALESCE((v_choice ->> 'requiresChoice')::boolean, false);\n",
        new: "  v_per_date := COALESCE((v_choice ->> 'requiresChoice')::boolean, false);\n  -- issue #3281: every upcoming date was cancelled. Nothing can be issued,\n  -- and the event has not ended, so the answer is the one checkout gives.\n  IF NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = v_link.event_id\n                  AND d.end_at > now() AND d.status = 'active')\n     AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = v_link.event_id\n                  AND d.end_at > now() AND d.status <> 'active') THEN\n    RAISE EXCEPTION 'occurrence_not_available';\n  END IF;\n",
      },
      {
        name: "a single date must be active",
        old: "       WHERE d.id = v_date_id AND d.event_id = v_link.event_id AND d.end_at > now()\n    ) THEN RAISE",
        new: "       WHERE d.id = v_date_id AND d.event_id = v_link.event_id AND d.end_at > now()\n         AND d.status = 'active'  -- issue #3281\n    ) THEN RAISE",
      },
      {
        name: "an all-days pass covers active dates only",
        old: "         WHERE d.event_id = v_link.event_id AND d.end_at > now()\n      );\n",
        new: "         WHERE d.event_id = v_link.event_id AND d.end_at > now()\n           AND d.status = 'active'  -- issue #3281\n      );\n",
      },
      {
        name: "every chosen date must be active",
        old: "       WHERE d.id = ANY(v_date_ids) AND d.event_id = v_link.event_id AND d.end_at > now()\n    ) <>",
        new: "       WHERE d.id = ANY(v_date_ids) AND d.event_id = v_link.event_id AND d.end_at > now()\n         AND d.status = 'active'  -- issue #3281\n    ) <>",
      },
    ],
  },
  {
    fn: "issue_3827_issue_link_signup",
    source: "supabase/migrations/20271211003827_issue_3827_link_cover_and_dates.sql",
    target: TARGET,
    hunks: [
      {
        name: "a request whose date was cancelled or ended is not issued",
        old: "      ELSE v_state END;\n  END IF;\n\n  -- Re-classify under the event lock.",
        new: "      ELSE v_state END;\n  END IF;\n\n  -- issue #3281: the request's date was cancelled, or ended, while it\n  -- waited (or, with no date of its own, every upcoming date was\n  -- cancelled). Nothing is issued and the request stays pending.\n  IF v_signup.event_date_id IS NOT NULL AND NOT EXISTS (\n    SELECT 1 FROM public.event_dates d\n     WHERE d.id = v_signup.event_date_id AND d.status = 'active' AND d.end_at > now()\n  ) THEN\n    RAISE EXCEPTION 'occurrence_not_available';\n  END IF;\n  IF v_signup.event_date_id IS NULL\n     AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = v_signup.event_id\n                      AND d.end_at > now() AND d.status = 'active')\n     AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = v_signup.event_id\n                  AND d.end_at > now() AND d.status <> 'active') THEN\n    RAISE EXCEPTION 'occurrence_not_available';\n  END IF;\n\n  -- Re-classify under the event lock.",
      },
    ],
  },
  {
    fn: "issue_3827_issue_link_signup_days",
    source: "supabase/migrations/20271211003827_issue_3827_link_cover_and_dates.sql",
    target: TARGET,
    hunks: [
      {
        name: "a cancelled or ended date is dropped before anything is counted",
        old: "    LOOP\n      v_existing := public.issue_3827_comp_order_on_date(\n",
        new: "    LOOP\n      -- issue #3281: a date cancelled, or ended, while the request waited\n      -- is dropped from it before anything is counted. An all-days pass is\n      -- then issued on the dates still pending.\n      IF NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.id = v_pass.event_date_id\n                      AND d.status = 'active' AND d.end_at > now()) THEN\n        UPDATE public.ticket_link_member_passes\n           SET status = 'declined', order_id = NULL WHERE id = v_pass.id;\n        CONTINUE;\n      END IF;\n      v_existing := public.issue_3827_comp_order_on_date(\n",
      },
      {
        name: "a request with no date left is refused and stays pending",
        old: "  v_used := public.issue_3827_link_uses_taken(v_link.id);\n",
        new: "  -- issue #3281: every date the request named is cancelled or over.\n  -- Raising rolls the drops back, so the request stays pending.\n  IF NOT EXISTS (SELECT 1 FROM public.ticket_link_member_passes p\n                  WHERE p.signup_id = v_signup.id AND p.status <> 'declined') THEN\n    RAISE EXCEPTION 'occurrence_not_available';\n  END IF;\n\n  v_used := public.issue_3827_link_uses_taken(v_link.id);\n",
      },
    ],
  },
  {
    fn: "pg_direct_event_checkout_bundle",
    source: "supabase/migrations/20280521004334_issue_4334_google_places.sql",
    target: TARGET,
    hunks: [
      {
        name: "a ticket's places left on the busiest night counts active nights only",
        old: "              FROM public.event_dates d\n             WHERE d.event_id = ev.id AND d.end_at > now()\n          )\n        ELSE GREATEST(\n",
        new: "              FROM public.event_dates d\n             WHERE d.event_id = ev.id AND d.end_at > now()\n               AND d.status = 'active'  -- issue #3281\n          )\n        ELSE GREATEST(\n",
      },
      {
        name: "a cancelled date reads sold out",
        old: "                 'soldOut', CASE\n                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL\n",
        new: "                 'soldOut', CASE\n                   -- issue #3281: forced for builds that predate `cancelled`.\n                   WHEN d.status <> 'active' THEN true\n                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL\n",
      },
      {
        name: "a cancelled date has no places left",
        old: "                 'placesLeft', CASE\n                   WHEN (CASE\n                   WHEN ev.hide_remaining_count_setting IS NULL THEN false\n                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')\n                     THEN ev.hide_remaining_count_setting::boolean\n                   ELSE true\n                 END) THEN NULL\n                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL\n",
        new: "                 'placesLeft', CASE\n                   WHEN (CASE\n                   WHEN ev.hide_remaining_count_setting IS NULL THEN false\n                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')\n                     THEN ev.hide_remaining_count_setting::boolean\n                   ELSE true\n                 END) THEN NULL\n                   WHEN d.status <> 'active' THEN 0  -- issue #3281\n                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL\n",
      },
      {
        name: "a cancelled date has no places left on any ticket",
        old: "                 'placesLeftByTicket', CASE\n                   WHEN (CASE\n                   WHEN ev.hide_remaining_count_setting IS NULL THEN false\n                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')\n                     THEN ev.hide_remaining_count_setting::boolean\n                   ELSE true\n                 END) THEN NULL\n                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL\n",
        new: "                 'placesLeftByTicket', CASE\n                   WHEN (CASE\n                   WHEN ev.hide_remaining_count_setting IS NULL THEN false\n                   WHEN pg_catalog.pg_input_is_valid(ev.hide_remaining_count_setting, 'boolean')\n                     THEN ev.hide_remaining_count_setting::boolean\n                   ELSE true\n                 END) THEN NULL\n                   -- issue #3281: every ticket on sale reads 0 on a cancelled date.\n                   WHEN d.status <> 'active' THEN (\n                     SELECT COALESCE(pg_catalog.json_object_agg(tt.id::text, 0), '{}'::json)\n                     FROM public.ticket_types tt\n                     WHERE tt.event_id = ev.id AND tt.deleted_at IS NULL\n                       AND COALESCE(tt.available_online, false)\n                       AND NOT COALESCE(tt.is_disabled, false)\n                       AND NOT COALESCE(tt.is_hidden, false)\n                   )\n                   WHEN NOT COALESCE(ev.is_recurring, false) THEN NULL\n",
      },
      {
        name: "each occurrence says whether it was cancelled",
        old: "                 'overrideLocation', d.override_location\n",
        new: "                 'overrideLocation', d.override_location,\n                 -- issue #3281 — APPENDED LAST. A cancelled date stays listed so a\n                 -- buyer who saw it reads \"Cancelled\" instead of it vanishing.\n                 'cancelled', d.status <> 'active'\n",
      },
    ],
  },
  {
    fn: "issue_3872_ticket_sale_json",
    source: "supabase/migrations/20280228003281_issue_3281_day_limited_tickets.sql",
    target: TARGET,
    hunks: [
      {
        name: "a cancelled date is listed as sold out for a day-limited ticket",
        old: "           AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL\n           AND public.issue_3313_ticket_type_occurrence_taken(tt.id,d.id)>=tt.quantity_total\n",
        new: "           AND (d.status<>'active'  -- issue #3281: a cancelled date is never on sale\n             OR (NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL\n           AND public.issue_3313_ticket_type_occurrence_taken(tt.id,d.id)>=tt.quantity_total))\n",
      },
    ],
  },
  {
    fn: "pg_public_rsvp_by_slug",
    source: "supabase/migrations/20280521004334_issue_4334_google_places.sql",
    target: TARGET,
    hunks: [
      {
        name: "the upcoming count skips cancelled dates",
        old: "              SELECT count(*)::integer AS upcoming_count\n                FROM public.event_dates d\n               WHERE d.event_id = e.id AND d.end_at > now()\n",
        new: "              SELECT count(*)::integer AS upcoming_count\n                FROM public.event_dates d\n               WHERE d.event_id = e.id AND d.end_at > now()\n                 AND d.status = 'active'  -- issue #3281\n",
      },
      {
        name: "the next date skips cancelled dates",
        old: "              SELECT d.start_at, d.end_at\n                FROM public.event_dates d\n               WHERE d.event_id = e.id AND d.end_at > now()\n",
        new: "              SELECT d.start_at, d.end_at\n                FROM public.event_dates d\n               WHERE d.event_id = e.id AND d.end_at > now()\n                 AND d.status = 'active'  -- issue #3281\n",
      },
    ],
  },
  {
    fn: "issue_3281_ticket_dates_json",
    source: "supabase/migrations/20280406003281_issue_3281_private_link_ticket_dates.sql",
    target: TARGET,
    hunks: [
      {
        name: "re-emitted in place",
        old: "CREATE FUNCTION public.issue_3281_ticket_dates_json(",
        new: "CREATE OR REPLACE FUNCTION public.issue_3281_ticket_dates_json(",
      },
      {
        name: "a link ticket is valid on active dates only",
        old: "         AND d.occurrence_key = ANY (tt.valid_occurrence_keys)\n",
        new: "         AND d.occurrence_key = ANY (tt.valid_occurrence_keys)\n         AND d.status = 'active'  -- issue #3281\n",
      },
    ],
  },
  {
    fn: "pg_ticket_link_resolve",
    source: "supabase/migrations/20280430011023_issue_1023_theme_fonts_and_gradients.sql",
    target: TARGET,
    hunks: [
      {
        name: "a link never offers a cancelled date",
        old: "      WHERE d.event_id = e.id AND d.end_at > now()\n        AND v_link.event_date_id IS NULL\n",
        new: "      WHERE d.event_id = e.id AND d.end_at > now()\n        AND d.status = 'active'  -- issue #3281\n        AND v_link.event_date_id IS NULL\n",
      },
    ],
  },
  {
    fn: "biz_update_live_rsvp",
    source: "supabase/migrations/20271128003827_issue_3827_going_box_privacy_extra_guests.sql",
    target: TARGET,
    hunks: [
      {
        name: "the kept date row",
        old: "  v_old_start      timestamptz;\n",
        new: "  v_old_start      timestamptz;\n  v_date_row       uuid;  -- issue #3281\n",
      },
      {
        name: "the date row is updated in place, never deleted and re-made",
        old: "    DELETE FROM public.event_dates WHERE event_id = p_event_id;\n    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)\n    VALUES (p_event_id, v_new_start, v_new_end, v_timezone, true);\n",
        new: "    -- issue #3281: the date row keeps its id, so everything that points at\n    -- it stays attached, and keeps its status, cancelled_at and\n    -- occurrence_key (an edit never un-cancels a date). A row is inserted\n    -- only when none exists. Extra legacy rows go, as before.\n    SELECT d.id INTO v_date_row FROM public.event_dates d\n     WHERE d.event_id = p_event_id\n     ORDER BY d.is_master DESC, d.start_at, d.id LIMIT 1;\n    IF v_date_row IS NULL THEN\n      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)\n      VALUES (p_event_id, v_new_start, v_new_end, v_timezone, true);\n    ELSE\n      DELETE FROM public.event_dates WHERE event_id = p_event_id AND id <> v_date_row;\n      UPDATE public.event_dates\n         SET start_at = v_new_start, end_at = v_new_end, timezone = v_timezone, is_master = true\n       WHERE id = v_date_row\n         AND (start_at, end_at, timezone, is_master)\n             IS DISTINCT FROM (v_new_start, v_new_end, v_timezone, true);\n    END IF;\n",
      },
    ],
  },
];
