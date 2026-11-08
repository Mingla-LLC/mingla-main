/**
 * issue #3645 bundle 2c — the float forecast counts paid sales that are not
 * attached yet through issue_3645_unattached_payout_sources, whose two arms
 * are the dark sweeps' own candidate text copied verbatim (p_now renamed to
 * p_mature_by). This test re-derives both segments from the LATEST definition
 * of each sweep and fails the moment a sweep changes without the function, so
 * the forecast can never count a different set of sales than the sweeps attach.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { definitions } from "./issue_3645_reemit_hunks.ts";

const DIR = "supabase/migrations";

function latest(fn: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (
    const file of [...Deno.readDirSync(DIR)]
      .filter((e) => e.isFile && e.name.endsWith(".sql"))
      .map((e) => e.name)
      .sort()
  ) {
    const body = definitions(Deno.readTextFileSync(`${DIR}/${file}`)).get(fn);
    if (body !== undefined) found = { file, body };
  }
  assert(found !== null, `${fn} is not defined in any migration`);
  return found;
}

function segment(body: string, start: string, end: string): string {
  const a = body.indexOf(start);
  const b = body.indexOf(end, a);
  assert(a >= 0 && b > a, `segment ${JSON.stringify(start.trim())} not found`);
  const text = body.slice(a, b);
  // Exactly one maturity comparison against p_now, so the rename is total.
  assertEquals(text.split("p_now").length - 1, 1, "expected one p_now in the candidate text");
  return text.replaceAll("p_now", "p_mature_by");
}

const SOURCES = latest("issue_3645_unattached_payout_sources").body;

Deno.test("#3645 2c the order/RSVP/venue/menu/instalment arm is the dark sweep's candidate text", () => {
  const sweep = latest("run_payout_release_dark_sweep").body;
  const text = segment(sweep, "    WITH candidates AS (\n", "    ORDER BY c.finalized_at,c.source_id\n");
  assert(
    SOURCES.includes(text),
    "run_payout_release_dark_sweep's candidates changed; copy them into issue_3645_unattached_payout_sources",
  );
});

Deno.test("#3645 2c the stay arm is the stay dark sweep's candidate text", () => {
  const stay = latest("run_stay_payout_release_dark_sweep").body;
  const text = segment(stay, "    SELECT\n      line.id AS source_id,\n", "    ORDER BY anchor_end_at, line.id\n");
  assert(
    SOURCES.includes(text),
    "run_stay_payout_release_dark_sweep's candidates changed; copy them into issue_3645_unattached_payout_sources",
  );
});

Deno.test("#3645 2c the sources function stays inlinable (STABLE sql, invoker, no SET clause)", () => {
  const header = SOURCES.slice(0, SOURCES.indexOf("AS $fn$"));
  assert(/LANGUAGE sql\s/.test(header), "must be LANGUAGE sql");
  assert(/\bSTABLE\b/.test(header), "must be STABLE");
  assert(!/SECURITY DEFINER/.test(header), "a SECURITY DEFINER function is never inlined");
  assert(!/^\s*SET\s/m.test(header), "a SET clause stops inlining; the body is schema-qualified instead");
});
