#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const paths = {
  migration:
    "supabase/migrations/20270322001902_issue_1902_public_event_lifecycle.sql",
  wrapper: "supabase/migrations/20270204001447_issue_1447_rsvp_admission.sql",
  edge: "supabase/functions/public-submit-rsvp/index.ts",
  migrationTest:
    "supabase/migrations/__tests__/issue_1902_public_event_lifecycle.test.ts",
  pg17:
    "supabase/migrations/__tests__/issue_1902_public_event_lifecycle.pg17.test.sql",
  edgeTest:
    "supabase/functions/public-submit-rsvp/__tests__/issue_1902_rsvp_end_guard.test.ts",
  invariant: "docs/INVARIANT_REGISTRY.md",
  workflow: ".github/workflows/issue-1902-rsvp-backend-safety-tests.yml",
};

const need = (source, token, label, failures) => {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
};
const forbid = (source, token, label, failures) => {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
};
const ordered = (source, tokens, label, failures) => {
  let cursor = -1;
  for (const token of tokens) {
    cursor = source.indexOf(token, cursor + 1);
    if (cursor === -1) {
      failures.push(`${label}: missing/out-of-order ${token}`);
      return;
    }
  }
};

export function violations(files, migrationNames = []) {
  const failures = [];
  const sql = files.migration ?? "";
  const submitStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.submit_event_rsvp(",
  );
  const upcomingStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.pg_public_brand_upcoming(",
  );
  const submit = sql.slice(submitStart, upcomingStart);
  const upcoming = sql.slice(upcomingStart);

  for (
    const token of [
      "v_master_count <> 1 OR v_master_end_at IS NULL",
      "v_master_end_at <= clock_timestamp()",
      "ERRCODE = 'P1901'",
      "MESSAGE = 'rsvp_event_ended'",
      "ERRCODE = 'P1902'",
      "MESSAGE = 'rsvp_date_unavailable'",
      "SECURITY DEFINER",
      "SET search_path TO 'public', 'pg_temp'",
      "FROM PUBLIC, anon, authenticated",
      "TO service_role",
    ]
  ) need(submit, token, "RSVP write boundary", failures);
  forbid(submit, "DETAIL =", "stable error privacy", failures);
  forbid(submit, "HINT =", "stable error privacy", failures);
  forbid(submit, "DROP FUNCTION", "in-place signature preservation", failures);
  ordered(
    submit,
    [
      "v_master_end_at <= clock_timestamp()",
      "SELECT COALESCE(SUM(1 + r.plus_count)",
      "UPDATE public.event_rsvps",
      "INSERT INTO public.event_rsvps",
      "DELETE FROM public.event_rsvp_guests",
      "INSERT INTO public.event_rsvp_guests",
    ],
    "guard before every RSVP mutation",
    failures,
  );

  for (
    const token of [
      "WHEN 'rsvp' THEN ed.start_at",
      "LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true",
      "e.visibility = 'public'",
      "e.published_at IS NOT NULL",
      "e.status IN ('scheduled', 'live')",
      "public.pg_brand_can_charge(e.brand_id)",
      "o.starts_at > COALESCE(p_cursor_at, now())",
      "ORDER BY o.starts_at ASC, o.published_at DESC",
      "LIMIT (LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100) + 1)",
      "FROM PUBLIC",
      "TO anon, authenticated",
    ]
  ) need(upcoming, token, "Upcoming RSVP contract", failures);

  need(
    files.wrapper ?? "",
    "v_result := public.submit_event_rsvp(",
    "delivery wrapper path",
    failures,
  );
  ordered(
    files.wrapper ?? "",
    [
      "v_result := public.submit_event_rsvp(",
      "PERFORM public.enqueue_rsvp_acknowledgement(v_rsvp_id)",
      "PERFORM public.enqueue_rsvp_pass(v_rsvp_id,p_qr_token_pepper)",
    ],
    "guarded wrapper before delivery",
    failures,
  );

  const edge = files.edge ?? "";
  ordered(
    edge,
    [
      "switch (error.code)",
      'case "P1901":',
      'return json(410, { error: "rsvp_event_ended" })',
      'case "P1902":',
      'return json(409, { error: "rsvp_date_unavailable" })',
      'const code = error.message ?? ""',
      'return json(500, { error: "rsvp_write_failed" })',
    ],
    "SQLSTATE-only Edge transport",
    failures,
  );
  const mappingStart = edge.indexOf("switch (error.code)");
  const mappingEnd = edge.indexOf(
    'const code = error.message ?? ""',
    mappingStart,
  );
  const mapping = edge.slice(mappingStart, mappingEnd);
  for (
    const token of [
      "error.message",
      "error.details",
      "error.hint",
      ".includes(",
    ]
  ) {
    forbid(mapping, token, "new SQLSTATE mapping", failures);
  }
  for (
    const token of [
      "event_id: eventId",
      "authenticated: userId !== null",
      "server_timestamp: new Date().toISOString()",
    ]
  ) need(mapping, token, "PII-minimal rejection log", failures);

  for (
    const token of [
      "issue_1902_public_event_lifecycle.test.ts",
      "issue_1902_public_event_lifecycle.tester_adversarial.test.ts",
      "issue_1902_public_event_lifecycle.pg17.test.sql",
      "issue_1902_public_event_lifecycle.pg17.tester_adversarial.test.sql",
      "issue_1902_rsvp_end_guard.test.ts",
      "issue_1902_rsvp_end_guard.tester_adversarial.test.ts",
      "issue-1902-rsvp-backend-safety.mjs --self-test",
      "issue-1902-rsvp-backend-safety.mjs",
      "deno check supabase/functions/public-submit-rsvp/index.ts",
      "Apply every migration in timestamp order",
    ]
  ) need(files.workflow ?? "", token, "dedicated blocking workflow", failures);
  forbid(
    files.workflow ?? "",
    "continue-on-error:",
    "blocking workflow",
    failures,
  );

  for (
    const token of [
      "I-RSVP-WRITE-MASTER-END-GATED",
      "I-PUBLIC-BRAND-UPCOMING-INCLUDES-RSVP",
    ]
  ) need(files.invariant ?? "", token, "DRAFT invariant", failures);
  for (const key of ["migrationTest", "pg17", "edgeTest"]) {
    need(
      files.workflow ?? "",
      path.basename(paths[key]),
      `CI-wired ${key}`,
      failures,
    );
  }

  const prefixMatches = migrationNames.filter((name) =>
    name.startsWith("20270322001902_")
  );
  if (
    prefixMatches.length !== 1 ||
    prefixMatches[0] !== path.basename(paths.migration)
  ) {
    failures.push(
      `migration prefix 20270322001902 must be unique and exact; found ${
        prefixMatches.join(", ") || "none"
      }`,
    );
  }
  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(paths).map(([key, rel]) => [
      key,
      fs.readFileSync(path.join(root, rel), "utf8"),
    ]),
  );
}

function migrationNames() {
  return fs.readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"));
}

function selfTest() {
  const valid = readFiles();
  const names = migrationNames();
  const baseline = violations(valid, names);
  if (baseline.length) {
    throw new Error(`self-test baseline invalid:\n${baseline.join("\n")}`);
  }
  const reversions = [
    [
      "migration",
      "v_master_end_at <= clock_timestamp()",
      "v_master_end_at < clock_timestamp()",
      "v_master_end_at <=",
    ],
    ["migration", "ERRCODE = 'P1901'", "ERRCODE = 'P0001'", "P1901"],
    [
      "migration",
      "WHEN 'rsvp' THEN ed.start_at",
      "WHEN 'rsvp' THEN NULL",
      "rsvp",
    ],
    [
      "edge",
      "switch (error.code)",
      "switch (error.message)",
      "switch (error.code)",
    ],
    [
      "edge",
      'return json(410, { error: "rsvp_event_ended" })',
      'return json(500, { error: "rsvp_write_failed" })',
      "410",
    ],
    [
      "wrapper",
      "v_result := public.submit_event_rsvp(",
      "v_result := public.unchecked_submit_event_rsvp(",
      "delivery wrapper",
    ],
    [
      "workflow",
      "issue_1902_public_event_lifecycle.pg17.test.sql",
      "disabled.sql",
      "pg17",
    ],
  ];
  for (const [key, before, after, expected] of reversions) {
    if (!valid[key].includes(before)) {
      throw new Error(`self-test fixture missing: ${before}`);
    }
    const broken = { ...valid, [key]: valid[key].replace(before, after) };
    if (
      !violations(broken, names).some((failure) => failure.includes(expected))
    ) {
      throw new Error(`true-source reversion not caught: ${expected}`);
    }
  }
  const duplicateNames = [...names, "20270322001902_collision.sql"];
  if (
    !violations(valid, duplicateNames).some((failure) =>
      failure.includes("must be unique")
    )
  ) {
    throw new Error("duplicate migration prefix reversion not caught");
  }
  console.log(
    `issue-1902 RSVP backend self-test PASS (${
      reversions.length + 1
    } true-source reversions)`,
  );
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = violations(readFiles(), migrationNames());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("issue-1902 RSVP backend safety gate PASS");
}
