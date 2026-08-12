import { assert, assertEquals } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  new URL(
    "../20270322001902_issue_1902_public_event_lifecycle.sql",
    import.meta.url,
  ),
);
const workflow = await Deno.readTextFile(
  new URL(
    "../../../.github/workflows/issue-1902-rsvp-backend-safety-tests.yml",
    import.meta.url,
  ),
);

const submitStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.submit_event_rsvp(",
);
const upcomingStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.pg_public_brand_upcoming(",
);
const submit = migration.slice(submitStart, upcomingStart);
const upcoming = migration.slice(upcomingStart);

Deno.test("ambiguous/missing/null master truth fails before validation and every mutation", () => {
  const resolution = submit.indexOf("SELECT count(*)::integer, max(ed.end_at)");
  const unavailable = submit.indexOf(
    "v_master_count <> 1 OR v_master_end_at IS NULL",
  );
  const validation = submit.indexOf(
    "IF p_rsvp_status NOT IN ('going', 'not_going', 'maybe')",
  );
  assert(resolution !== -1 && unavailable > resolution);
  assert(
    validation > unavailable,
    "date truth must fail before friendly validation",
  );
  assert(submit.includes("WHERE ed.event_id = p_event_id"));
  assert(submit.includes("AND ed.is_master IS TRUE"));
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
      submit.indexOf(mutation) > unavailable,
      `${mutation} escaped the fail-closed date boundary`,
    );
  }
});

Deno.test("inclusive server clock boundary and exact private SQLSTATE contract resist drift", () => {
  assertEquals(
    (submit.match(/v_master_end_at <= clock_timestamp\(\)/g) ?? []).length,
    1,
  );
  for (
    const [state, message] of [
      ["P1901", "rsvp_event_ended"],
      ["P1902", "rsvp_date_unavailable"],
    ]
  ) {
    const block = new RegExp(
      `ERRCODE = '${state}',\\s+MESSAGE = '${message}'`,
    );
    assert(block.test(submit), `missing exact ${state}/${message} pair`);
  }
  assert(
    !/ERRCODE\s*=\s*'P190[12]'[\s\S]{0,160}(DETAIL|HINT)\s*=/.test(submit),
  );
});

Deno.test("Upcoming keeps public/readiness/cursor/order/limit+1/no-price semantics for RSVP", () => {
  for (
    const token of [
      "WHEN 'rsvp' THEN ed.start_at",
      "e.visibility = 'public'",
      "e.published_at IS NOT NULL",
      "e.status IN ('scheduled', 'live')",
      "public.pg_brand_can_charge(e.brand_id)",
      "o.starts_at > COALESCE(p_cursor_at, now())",
      "ORDER BY o.starts_at ASC, o.published_at DESC",
      "LIMIT (LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100) + 1)",
      "SELECT min(tt.price_cents)",
      "REVOKE ALL ON FUNCTION public.pg_public_brand_upcoming",
      "TO anon, authenticated",
    ]
  ) assert(upcoming.includes(token), `Upcoming lost ${token}`);
  assert(
    !upcoming.includes("COALESCE((\n        SELECT min(tt.price_cents)"),
    "Upcoming must not synthesize a zero price when RSVP has no ticket rows",
  );
});

Deno.test("dedicated CI invokes every tester proof including the actual handler over HTTP", () => {
  for (
    const token of [
      "issue_1902_rsvp_end_guard.tester_adversarial.test.ts",
      "issue_1902_public_event_lifecycle.tester_adversarial.test.ts",
      "issue_1902_public_event_lifecycle.pg17.tester_adversarial.test.sql",
      "--allow-run",
      "--allow-net",
      'grep -Fq "actual public-submit-rsvp HTTP handler" "$test_file"',
    ]
  ) assert(workflow.includes(token), `CI does not enforce ${token}`);
});
