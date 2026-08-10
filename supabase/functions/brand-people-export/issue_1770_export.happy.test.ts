import { csvCell, csvFromRows } from "./csv.ts";
import { handler } from "./index.ts";

const edgeSource = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const migrationSource = await Deno.readTextFile(
  new URL(
    "../../migrations/20270305001770_issue_1770_ring1_brand_people_foundation.sql",
    import.meta.url,
  ),
);

Deno.test("issue #1770 export is RFC-4180 shaped and neutralizes formula cells", () => {
  for (const value of ["=SUM(1,1)", "+cmd", "-1+2", "@payload"]) {
    if (!csvCell(value).startsWith("\"'")) {
      throw new Error("formula injection was not neutralized");
    }
  }
  const csv = csvFromRows([{
    name: 'A "quoted" name',
    email: "safe@example.test",
  }]);
  if (!csv.includes('"A ""quoted"" name"') || !csv.endsWith("\r\n")) {
    throw new Error("RFC-4180 escaping drifted");
  }
});

Deno.test("issue #1770 export POST only queues and GET signs without path disclosure", () => {
  for (
    const token of [
      'service.rpc(\n      "biz_get_brand_people_export_storage"',
      ".createSignedUrl(storagePath, 60)",
      "result: job.result",
      "return json(jobData as Record<string, unknown>, 202)",
    ]
  ) {
    if (!edgeSource.includes(token)) {
      throw new Error(`private export handoff drifted: ${token}`);
    }
  }
  for (
    const forbidden of [
      "job.storagePath",
      "biz_brand_people_export_rows",
      ".upload(",
      "csvFromRows",
      "biz_complete_brand_people_export",
    ]
  ) {
    if (edgeSource.includes(forbidden)) {
      throw new Error(
        `authenticated export must not do worker I/O: ${forbidden}`,
      );
    }
  }
});

Deno.test("issue #1770 export persists and executes only canonical server filters", () => {
  for (
    const required of [
      "p_filter_snapshot<>'{}'::jsonb",
      "p_filter NOT IN ('all','reachable','suppressed')",
      "p_filter NOT IN ('all','rsvpd','ticketed','not_yet','suppressed')",
      "v_snapshot:=jsonb_build_object('filter',p_filter,'search',v_search,'sort',p_sort)",
      "v_job.filter_json->>'filter'='suppressed'",
      "v_job.filter_json->>'search'=''",
    ]
  ) {
    if (!migrationSource.includes(required)) {
      throw new Error(`canonical export contract drifted: ${required}`);
    }
  }
  for (
    const forbidden of [
      "'snapshot',p_filter_snapshot",
      "'eventId',p_event_id",
    ]
  ) {
    if (migrationSource.includes(forbidden)) {
      throw new Error(`caller-controlled export state persisted: ${forbidden}`);
    }
  }
});

// [TEST-MOD-APPROVED #1770] Supabase-js sends x-client-info on browser calls;
// drive the real OPTIONS handler so this cannot regress behind a source-only pin.
Deno.test("issue #1770 export browser preflight allows Supabase client headers", async () => {
  const response = await handler(
    new Request("https://edge.test/brand-people-export", {
      method: "OPTIONS",
    }),
  );
  if (response.status !== 200) {
    throw new Error("OPTIONS preflight did not succeed");
  }
  const allowed = response.headers.get("Access-Control-Allow-Headers") ?? "";
  if (!allowed.includes("x-client-info")) {
    throw new Error("Supabase browser x-client-info header was rejected");
  }
  const methods = response.headers.get("Access-Control-Allow-Methods") ?? "";
  if (!methods.includes("GET") || !methods.includes("POST")) {
    throw new Error("export preflight omitted a supported method");
  }
  if (response.headers.get("Cache-Control") !== "no-store") {
    throw new Error("preflight lost no-store policy");
  }
});
