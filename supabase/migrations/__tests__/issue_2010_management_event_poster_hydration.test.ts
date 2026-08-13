import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20270402002010_issue_2010_management_event_poster_hydration.sql",
    import.meta.url,
  ),
);

const latestPrior = await Deno.readTextFile(
  new URL("../20270116000869_issue_868_cover_gallery_read_layer.sql", import.meta.url),
);

const selectList = (sql: string): string => {
  const match = sql.match(
    /CREATE OR REPLACE VIEW public\.business_management_events_view[\s\S]*?AS\s+SELECT([\s\S]*?)FROM public\.events e/,
  );
  if (match === null) throw new Error("management view SELECT list missing");
  return match[1].replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
};

Deno.test("#2010 appends only the authoritative poster to the latest management projection", () => {
  const before = selectList(latestPrior);
  const after = selectList(migration);

  assertEquals(after, `${before}, e.cover_media_poster_url`);
  assert(after.endsWith("e.cover_media_gallery, e.cover_media_poster_url"));
});

Deno.test("#2010 preserves management-view security, grants, joins and filters", () => {
  for (const contract of [
    "WITH (security_invoker = true)",
    "JOIN public.brands b ON b.id = e.brand_id",
    "LEFT JOIN public.event_dates ed",
    "ON ed.event_id = e.id AND ed.is_master = true",
    "WHERE e.deleted_at IS NULL",
    "AND b.deleted_at IS NULL",
    "AND e.status IN ('scheduled', 'live', 'ended', 'cancelled')",
    "GRANT SELECT ON public.business_management_events_view TO authenticated, service_role",
    "REVOKE SELECT ON public.business_management_events_view FROM anon",
  ]) {
    assertStringIncludes(migration, contract);
  }
  assertEquals(/DROP\s+(VIEW|TABLE)/i.test(migration), false);
  assertEquals(/GRANT\s+SELECT[\s\S]*\bTO\s+anon\b/i.test(migration), false);
});
