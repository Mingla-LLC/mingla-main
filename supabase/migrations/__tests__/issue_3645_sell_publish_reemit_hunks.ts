/**
 * issue #3645 bundle 2b — the ONLY authorised hunks for every function
 * 20280428003645 re-emits. issue_3645_sell_publish_reemit_hunks.structural.test.ts
 * proves each body equals the latest earlier definition with exactly these
 * replacements applied, so nothing else in these functions moves silently.
 * Generated; edit the hunks here and the migration together.
 */
import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const TARGET = "supabase/migrations/20280428003645_issue_3645_sell_publish_integrity.sql";

export const SELL_PUBLISH_REEMITS: Reemit[] = [
  {
    fn: "business_publish_event_draft",
    source: "supabase/migrations/20280314003281_issue_3281_extras_authoring.sql",
    target: TARGET,
    hunks: [
      {
        name: "a paid ticket must have a price of at least one minor unit",
        old: "      IF v_price < 0 THEN\n        RAISE EXCEPTION 'ticket_price_cannot_be_negative';\n      END IF;\n",
        new: "      IF v_price < 0 THEN\n        RAISE EXCEPTION 'ticket_price_cannot_be_negative';\n      END IF;\n      -- issue #3645: a paid ticket with no price (or one that rounds to 0)\n      -- would go live at 0. The wizard refuses it; the server now does too.\n      IF round(v_price * 100) <= 0 THEN\n        RAISE EXCEPTION 'paid_ticket_price_required' USING ERRCODE = '22023';\n      END IF;\n",
      },
    ],
  },
  {
    fn: "issue_1974_normalize_ticket_tiers",
    source: "supabase/migrations/20280314003281_issue_3281_extras_authoring.sql",
    target: TARGET,
    hunks: [
      {
        name: "a sub-unit paid price that rounds to 0 is refused",
        old: "    IF NOT v_free AND COALESCE(v_price,0) <= 0 THEN RAISE EXCEPTION 'paid_ticket_price_required'; END IF;\n",
        new: "    IF NOT v_free AND round(COALESCE(v_price,0) * 100) <= 0 THEN RAISE EXCEPTION 'paid_ticket_price_required'; END IF;  -- issue #3645\n",
      },
    ],
  },
  {
    fn: "biz_update_live_experience",
    source: "supabase/migrations/20280217003281_issue_3281_production_order_repair.sql",
    target: TARGET,
    hunks: [
      {
        name: "a live paid whole-price experience cannot be edited to 0",
        old: "  -- ---------- 6. Resolve the date model + date-shift gate ----------\n",
        new: "  -- issue #3645: a paid whole-price experience edited to 0 would silently\n  -- turn free. Same rule as biz_publish_experience; marking it free is the\n  -- way to make it free. Checked after the sold-ticket gates so their\n  -- answers are unchanged.\n  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND v_resolved_total <= 0 THEN\n    RAISE EXCEPTION 'experience_price_invalid';\n  END IF;\n\n  -- ---------- 6. Resolve the date model + date-shift gate ----------\n",
      },
    ],
  },
  {
    fn: "biz_publish_experience",
    source: "supabase/migrations/20271123003281_issue_3281_r3_spacing_spots.sql",
    target: TARGET,
    hunks: [
      {
        name: "event dates are materialised before the events row is written",
        old: "  -- 11. Materialise event_dates (PUBLISH only — I-4) ----------------------\n  IF p_publish THEN\n    DELETE FROM public.event_dates WHERE event_id = p_event_id;\n\n    IF v_when_mode IN ('single','recurring') THEN\n      v_date_iso := NULLIF(v_when->>'date', '');\n      IF v_date_iso IS NULL THEN\n        RAISE EXCEPTION 'event_date_required';\n      END IF;\n      v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');\n      v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);\n      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;\n      v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;\n      IF v_end <= v_start THEN\n        v_end := v_end + INTERVAL '1 day';\n      END IF;\n      -- FEATURE never-ends: 'never' rule materialises EXACTLY the master\n      -- (first) occurrence — rule carries the repeat, engine needs >=1 date.\n      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)\n      VALUES (p_event_id, v_start, v_end, v_timezone, true);\n\n      -- ORCH-1138 Leg 3 (§4.6) — RECURRENCE MATERIALISATION. The master row is\n      -- inserted above; for a `recurring` rule, expand the 2nd..Nth bookable\n      -- occurrences into real event_dates rows (bounded 52-cap, OQ-1; NO cron) so\n      -- the buyer can reserve every occurrence (not just the first). single-mode\n      -- and never-without-a-daily-preset stay master-only. I-4 preserved (publish-\n      -- time materialisation). Self-contained expander; no checkout change.\n      IF v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN\n        PERFORM public.pg_expand_experience_recurrence(\n          p_event_id, v_start, v_end, v_recurrence_rules, v_timezone\n        );\n\n        -- ORCH-1153 WS1 publish-time DRAIN GUARD (I-PROPOSED-1153-NO-DRAIN).\n        -- A recurring publish must never land in a zero-future-occurrence state\n        -- (the casualty class). If, after materialisation, the experience has no\n        -- future event_dates AND the rule is NOT count-exhausted / until-expired,\n        -- the master was anchored in the past with a non-productive rule → block\n        -- the publish (mirrors the ORCH-1075 paid-publish guard). count/until\n        -- rules whose window has legitimately closed are EXEMPT (a finite series\n        -- that has ended is allowed to publish read-only).\n        IF NOT EXISTS (\n              SELECT 1 FROM public.event_dates ed\n              WHERE ed.event_id = p_event_id AND ed.start_at > v_now\n            )\n           AND NOT public.pg_recurrence_is_terminated(v_recurrence_rules, p_event_id, v_now)\n        THEN\n          RAISE EXCEPTION 'recurring_experience_has_no_future_occurrences';\n        END IF;\n      END IF;\n      v_next_occurrence := v_start;\n\n    ELSIF v_when_mode = 'multi_date' THEN\n      IF v_multi_dates IS NULL\n         OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'\n         OR jsonb_array_length(v_multi_dates) = 0 THEN\n        RAISE EXCEPTION 'event_date_required';\n      END IF;\n\n      SELECT min(\n        (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp\n          AT TIME ZONE v_timezone\n      )\n      INTO v_min_start\n      FROM jsonb_array_elements(v_multi_dates) entry\n      WHERE NULLIF(entry->>'date', '') IS NOT NULL;\n\n      IF v_min_start IS NULL THEN\n        RAISE EXCEPTION 'event_date_required';\n      END IF;\n\n      FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)\n      LOOP\n        v_date_iso := NULLIF(v_date_entry->>'date', '');\n        IF v_date_iso IS NULL THEN\n          RAISE EXCEPTION 'event_date_required';\n        END IF;\n        v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');\n        v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);\n        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;\n        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;\n        IF v_end <= v_start THEN\n          v_end := v_end + INTERVAL '1 day';\n        END IF;\n        INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)\n        VALUES (p_event_id, v_start, v_end, v_timezone, v_start = v_min_start);\n      END LOOP;\n      v_next_occurrence := v_min_start;\n    END IF;\n\n    IF v_next_occurrence IS NOT NULL THEN\n      UPDATE public.events\n      SET theme = jsonb_set(\n            COALESCE(theme, '{}'::jsonb),\n            '{experience_meta,next_occurrence_at}',\n            to_jsonb(to_char(v_next_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')),\n            true\n          ),\n          updated_at = v_now\n      WHERE id = p_event_id;\n    END IF;\n\n    -- 11.5 DEFERRED status flip (BUG 5 ROOT CAUSE). Now that the master\n    -- event_date exists, promote the row to scheduled/public — the\n    -- biz_enforce_event_has_master_date trigger (ORCH-0792) now passes. Doing\n    -- this AFTER materialisation is what makes experience publish succeed.\n    UPDATE public.events\n    SET status       = 'scheduled',\n        visibility   = 'public',\n        published_at = COALESCE(published_at, v_now),\n        updated_at   = v_now\n    WHERE id = p_event_id;\n  END IF;\n\n",
        new: "",
      },
      {
        name: "publish materialises dates first, so one UPDATE can carry status",
        old: "  -- 8. UPDATE the events row ----------------------------------------------\n",
        new: "  -- 11. Materialise event_dates (PUBLISH only — I-4) ----------------------\n  -- issue #3645: runs BEFORE step 8 so the master date exists when step 8\n  -- moves the row out of draft (biz_enforce_event_has_master_date). It reads\n  -- only event_dates and local variables, never the events row.\n  IF p_publish THEN\n    DELETE FROM public.event_dates WHERE event_id = p_event_id;\n\n    IF v_when_mode IN ('single','recurring') THEN\n      v_date_iso := NULLIF(v_when->>'date', '');\n      IF v_date_iso IS NULL THEN\n        RAISE EXCEPTION 'event_date_required';\n      END IF;\n      v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');\n      v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);\n      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;\n      v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;\n      IF v_end <= v_start THEN\n        v_end := v_end + INTERVAL '1 day';\n      END IF;\n      -- FEATURE never-ends: 'never' rule materialises EXACTLY the master\n      -- (first) occurrence — rule carries the repeat, engine needs >=1 date.\n      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)\n      VALUES (p_event_id, v_start, v_end, v_timezone, true);\n\n      -- ORCH-1138 Leg 3 (§4.6) — RECURRENCE MATERIALISATION. The master row is\n      -- inserted above; for a `recurring` rule, expand the 2nd..Nth bookable\n      -- occurrences into real event_dates rows (bounded 52-cap, OQ-1; NO cron) so\n      -- the buyer can reserve every occurrence (not just the first). single-mode\n      -- and never-without-a-daily-preset stay master-only. I-4 preserved (publish-\n      -- time materialisation). Self-contained expander; no checkout change.\n      IF v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN\n        PERFORM public.pg_expand_experience_recurrence(\n          p_event_id, v_start, v_end, v_recurrence_rules, v_timezone\n        );\n\n        -- ORCH-1153 WS1 publish-time DRAIN GUARD (I-PROPOSED-1153-NO-DRAIN).\n        -- A recurring publish must never land in a zero-future-occurrence state\n        -- (the casualty class). If, after materialisation, the experience has no\n        -- future event_dates AND the rule is NOT count-exhausted / until-expired,\n        -- the master was anchored in the past with a non-productive rule → block\n        -- the publish (mirrors the ORCH-1075 paid-publish guard). count/until\n        -- rules whose window has legitimately closed are EXEMPT (a finite series\n        -- that has ended is allowed to publish read-only).\n        IF NOT EXISTS (\n              SELECT 1 FROM public.event_dates ed\n              WHERE ed.event_id = p_event_id AND ed.start_at > v_now\n            )\n           AND NOT public.pg_recurrence_is_terminated(v_recurrence_rules, p_event_id, v_now)\n        THEN\n          RAISE EXCEPTION 'recurring_experience_has_no_future_occurrences';\n        END IF;\n      END IF;\n      v_next_occurrence := v_start;\n\n    ELSIF v_when_mode = 'multi_date' THEN\n      IF v_multi_dates IS NULL\n         OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'\n         OR jsonb_array_length(v_multi_dates) = 0 THEN\n        RAISE EXCEPTION 'event_date_required';\n      END IF;\n\n      SELECT min(\n        (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp\n          AT TIME ZONE v_timezone\n      )\n      INTO v_min_start\n      FROM jsonb_array_elements(v_multi_dates) entry\n      WHERE NULLIF(entry->>'date', '') IS NOT NULL;\n\n      IF v_min_start IS NULL THEN\n        RAISE EXCEPTION 'event_date_required';\n      END IF;\n\n      FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)\n      LOOP\n        v_date_iso := NULLIF(v_date_entry->>'date', '');\n        IF v_date_iso IS NULL THEN\n          RAISE EXCEPTION 'event_date_required';\n        END IF;\n        v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');\n        v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);\n        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;\n        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;\n        IF v_end <= v_start THEN\n          v_end := v_end + INTERVAL '1 day';\n        END IF;\n        INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)\n        VALUES (p_event_id, v_start, v_end, v_timezone, v_start = v_min_start);\n      END LOOP;\n      v_next_occurrence := v_min_start;\n    END IF;\n\n    IF v_next_occurrence IS NOT NULL THEN\n      UPDATE public.events\n      SET theme = jsonb_set(\n            COALESCE(theme, '{}'::jsonb),\n            '{experience_meta,next_occurrence_at}',\n            to_jsonb(to_char(v_next_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')),\n            true\n          ),\n          updated_at = v_now\n      WHERE id = p_event_id;\n    END IF;\n\n  END IF;\n\n  -- 8. UPDATE the events row ----------------------------------------------\n",
      },
      {
        name: "currency and status are written in the same UPDATE",
        old: "    -- BUG 5 ROOT CAUSE — the status flip to scheduled/public is DEFERRED to a\n    -- second UPDATE in step 11.5, AFTER event_dates is materialised. The\n    -- biz_enforce_event_has_master_date trigger (ORCH-0792) fires on the\n    -- status transition into scheduled/live and requires a master event_date to\n    -- ALREADY exist; flipping status here (before materialisation) raised\n    -- event_must_have_master_date on EVERY experience publish — the silent\n    -- failure the operator hit. Keep status/visibility/published_at UNCHANGED\n    -- in this UPDATE.\n",
        new: "    -- issue #3645: on publish, currency and status move in ONE update, so the\n    -- status triggers (brand-currency stamp, draft-currency stop) see the\n    -- currency this publish writes. event_dates were materialised above, so\n    -- biz_enforce_event_has_master_date (ORCH-0792, BUG 5) passes. A draft save\n    -- leaves status, visibility and published_at unchanged.\n    status            = CASE WHEN p_publish THEN 'scheduled' ELSE status END,\n    visibility        = CASE WHEN p_publish THEN 'public' ELSE visibility END,\n    published_at      = CASE WHEN p_publish THEN COALESCE(published_at, v_now) ELSE published_at END,\n",
      },
      {
        name: "tickets are written in the currency the publish stored",
        old: "  -- 9. REPLACE experience_stops ------------------------------------------\n",
        new: "  -- issue #3645: the brand-currency trigger stamps the brand's currency on\n  -- the way out of draft (or NULL for a free-only publish on a brand with no\n  -- currency). Tickets follow what was stored, not what was sent.\n  IF p_publish THEN\n    SELECT e.currency INTO v_currency FROM public.events e WHERE e.id = p_event_id;\n  END IF;\n\n  -- 9. REPLACE experience_stops ------------------------------------------\n",
      },
    ],
  },
  {
    fn: "business_cancel_event_date",
    source: "supabase/migrations/20280216003281_issue_3281_cancel_event_date.sql",
    target: TARGET,
    hunks: [
      {
        name: "cancelling a date revokes checkouts already under way",
        old: "  IF NOT FOUND THEN\n    RAISE EXCEPTION 'occurrence_already_cancelled';\n  END IF;\n\n  RETURN jsonb_build_object(\n    'ok', true,\n    'preview', false,\n",
        new: "  IF NOT FOUND THEN\n    RAISE EXCEPTION 'occurrence_already_cancelled';\n  END IF;\n\n  -- issue #3281: checkouts already under way must not complete for a date\n  -- that no longer happens. Same path a date's time change takes (the #1930\n  -- date trigger): every open checkout on the event is revoked and re-quotes;\n  -- one already charged is refunded by the late-reversal path. The event row\n  -- is locked above, so the lock order matches that trigger.\n  PERFORM public.issue_1930_revoke_event_checkout_admissions(\n    p_event_id, 'inventory_changed');\n\n  RETURN jsonb_build_object(\n    'ok', true,\n    'preview', false,\n",
      },
    ],
  },
  {
    fn: "issue_1930_ticket_session_authorized",
    source: "supabase/migrations/20280404004271_issue_4271_door_pay.sql",
    target: TARGET,
    hunks: [
      {
        name: "a session anchored on a cancelled date is not authorised",
        old: "        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id\n          AND d.end_at > now())) THEN RETURN false; END IF;\n",
        new: "        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id\n          AND d.end_at > now() AND d.status = 'active')) THEN RETURN false; END IF;  -- issue #3281\n",
      },
      {
        name: "a session for a cancelled chosen date is not authorised",
        old: "                 WHERE d.id=i.event_date_id AND d.event_id=p_event_id\n                   AND d.end_at > now())) THEN RETURN false; END IF;\n",
        new: "                 WHERE d.id=i.event_date_id AND d.event_id=p_event_id\n                   AND d.end_at > now() AND d.status = 'active')) THEN RETURN false; END IF;  -- issue #3281\n",
      },
    ],
  },
  {
    fn: "issue_3872_checkout_day_context",
    source: "supabase/migrations/20271216013872_issue_3872_r1_ticket_checkout.sql",
    target: TARGET,
    hunks: [
      {
        name: "a cancelled date cannot be checked out",
        old: "    IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.id=ANY(v_day_ids) AND d.end_at<=now()) THEN\n",
        new: "    IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.id=ANY(v_day_ids)\n              AND (d.end_at<=now() OR d.status<>'active')) THEN  -- issue #3281\n",
      },
    ],
  },
  {
    fn: "issue_3313_event_day_choice",
    source: "supabase/migrations/20271123003281_issue_3281_r3_spacing_spots.sql",
    target: TARGET,
    hunks: [
      {
        name: "a cancelled date is not upcoming (never auto-picked)",
        old: "   WHERE d.event_id = p_event_id AND d.end_at > now();\n",
        new: "   WHERE d.event_id = p_event_id AND d.end_at > now()\n     AND d.status = 'active';  -- issue #3281\n",
      },
    ],
  },
];
