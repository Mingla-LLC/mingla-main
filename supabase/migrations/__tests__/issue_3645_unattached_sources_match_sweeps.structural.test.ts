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

// The forecast's net is the net each attach function stores. If either attach
// formula changes (for example deducting the provider fee again), this fails
// until issue_3645_unattached_payout_sources is changed to match.
Deno.test("#3645 2c the forecast net is the net attach_payout_release stores", () => {
  const attach = latest("attach_payout_release").body;
  assert(
    attach.includes(
      "v_net := greatest(0, p_gross_cents - p_refunded_cents - p_disputed_cents\n    - p_mingla_fee_cents);",
    ),
    "attach_payout_release's net changed; change the forecast net to match",
  );
  assert(
    SOURCES.includes(
      "greatest(0, sale.gross_cents::bigint - sale.refunded_cents\n      - sale.disputed_cents - sale.mingla_fee_cents)",
    ),
  );
});

Deno.test("#3645 2c the forecast net is the net issue_1389_attach_stay_payout_release stores", () => {
  const attach = latest("issue_1389_attach_stay_payout_release").body;
  assert(
    attach.includes(
      "v_net := greatest(\n    0,\n    p_gross_cents - p_refunded_cents - p_mingla_fee_cents\n  );",
    ),
    "issue_1389_attach_stay_payout_release's net changed; change the forecast net to match",
  );
  assert(
    SOURCES.includes(
      "greatest(0, stay.gross_cents::bigint - stay.refunded_cents\n      - stay.mingla_fee_cents)",
    ),
  );
});

// Each sweep can still skip a candidate inside its loop, before attaching. The
// forecast does not see those skips, so they are pinned: a new or changed skip
// fails here until the forecast accounts for it.
Deno.test("#3645 2c the sweeps' per-row skips before attach are the known ones", () => {
  const sweep = latest("run_payout_release_dark_sweep").body;
  const loopStart = sweep.indexOf("  LOOP\n", sweep.indexOf("    ORDER BY c.finalized_at,c.source_id\n"));
  const attachAt = sweep.indexOf("    v_release_id:=public.attach_payout_release(", loopStart);
  assert(loopStart >= 0 && attachAt > loopStart);
  assertEquals(
    sweep.slice(loopStart, attachAt),
    "  LOOP\n" +
      "    PERFORM pg_advisory_xact_lock(\n" +
      "      hashtextextended(v_row.source_type||':'||v_row.source_id::text,0)\n" +
      "    );\n" +
      // The same unreconciled-refund rule is already inside the candidate text
      // for these three arms, so the forecast excludes them too.
      "    IF v_row.source_type IN ('venue_reservation','rsvp_contribution','venue_menu_order') AND EXISTS (\n" +
      "      SELECT 1 FROM public.source_refunds sr\n" +
      "      WHERE sr.source_type=v_row.source_type AND sr.source_id=v_row.source_id\n" +
      "        AND sr.financial_state<>'reconciled'\n" +
      "    ) THEN CONTINUE; END IF;\n",
  );
  const stay = latest("run_stay_payout_release_dark_sweep").body;
  const stayLoop = stay.indexOf("  LOOP\n", stay.indexOf("    ORDER BY anchor_end_at, line.id\n"));
  const stayAttach = stay.indexOf("    v_release_id := public.issue_1389_attach_stay_payout_release(", stayLoop);
  assert(stayLoop >= 0 && stayAttach > stayLoop);
  assertEquals(stay.slice(stayLoop, stayAttach), "  LOOP\n");
});
