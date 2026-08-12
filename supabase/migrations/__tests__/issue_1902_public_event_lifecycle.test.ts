import { assert, assertEquals } from "jsr:@std/assert@1";

const migrationPath = new URL(
  "../20270322001902_issue_1902_public_event_lifecycle.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(migrationPath);
const wrapper = await Deno.readTextFile(
  new URL("../20270204001447_issue_1447_rsvp_admission.sql", import.meta.url),
);

const submitStart = sql.indexOf(
  "CREATE OR REPLACE FUNCTION public.submit_event_rsvp(",
);
const upcomingStart = sql.indexOf(
  "CREATE OR REPLACE FUNCTION public.pg_public_brand_upcoming(",
);
const submit = sql.slice(submitStart, upcomingStart);
const upcoming = sql.slice(upcomingStart);

Deno.test("master-end guard is inclusive and precedes every RSVP mutation", () => {
  const guard = submit.indexOf("v_master_end_at <= clock_timestamp()");
  assert(guard !== -1, "inclusive database-time guard is required");
  for (
    const mutation of [
      "SELECT COALESCE(SUM(1 + r.plus_count)",
      "UPDATE public.event_rsvps",
      "INSERT INTO public.event_rsvps",
      "DELETE FROM public.event_rsvp_guests",
      "INSERT INTO public.event_rsvp_guests",
      "public.biz_rsvp_mint_qr(",
    ]
  ) {
    assert(
      submit.indexOf(mutation) > guard,
      `${mutation} must occur after the master-end guard`,
    );
  }
});

Deno.test("missing or elapsed master dates raise exact stable SQLSTATEs", () => {
  for (
    const token of [
      "v_master_count <> 1 OR v_master_end_at IS NULL",
      "ERRCODE = 'P1902'",
      "MESSAGE = 'rsvp_date_unavailable'",
      "v_master_end_at <= clock_timestamp()",
      "ERRCODE = 'P1901'",
      "MESSAGE = 'rsvp_event_ended'",
    ]
  ) {
    assert(submit.includes(token), `missing SQL guard token: ${token}`);
  }
  assert(!submit.includes("DETAIL ="), "custom errors must omit DETAIL");
  assert(!submit.includes("HINT ="), "custom errors must omit HINT");
});

Deno.test("nine-argument contract, definer posture, and wrapper path remain stable", () => {
  assert(submit.includes("SECURITY DEFINER"), "base RPC stays definer");
  assert(
    submit.includes("SET search_path TO 'public', 'pg_temp'"),
    "base RPC keeps fixed search path",
  );
  assert(
    submit.includes(
      "uuid, uuid, text, text, text, text, integer, jsonb, text",
    ),
    "base RPC grant targets the nine-argument signature",
  );
  assert(
    submit.includes("TO service_role") &&
      submit.includes("FROM PUBLIC, anon, authenticated"),
    "base RPC remains service-role-only",
  );
  assert(
    wrapper.includes("v_result := public.submit_event_rsvp("),
    "delivery wrapper must keep calling the guarded base RPC",
  );
  assert(
    wrapper.indexOf("v_result := public.submit_event_rsvp(") <
      wrapper.indexOf("PERFORM public.enqueue_rsvp_acknowledgement(v_rsvp_id)"),
    "wrapper queues delivery only after the guarded call returns",
  );
});

Deno.test("Upcoming admits RSVP through canonical master start without contract drift", () => {
  assert(upcoming.includes("WHEN 'rsvp' THEN ed.start_at"));
  for (
    const token of [
      "LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true",
      "e.visibility = 'public'",
      "e.published_at IS NOT NULL",
      "e.status IN ('scheduled', 'live')",
      "public.pg_brand_can_charge(e.brand_id)",
      "o.starts_at > COALESCE(p_cursor_at, now())",
      "ORDER BY o.starts_at ASC, o.published_at DESC",
      "LIMIT (LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100) + 1)",
      "REVOKE ALL ON FUNCTION public.pg_public_brand_upcoming",
      "TO anon, authenticated",
    ]
  ) {
    assert(upcoming.includes(token), `Upcoming contract drifted: ${token}`);
  }
  assertEquals(
    (upcoming.match(/WHEN 'rsvp' THEN ed\.start_at/g) ?? []).length,
    1,
  );
});
