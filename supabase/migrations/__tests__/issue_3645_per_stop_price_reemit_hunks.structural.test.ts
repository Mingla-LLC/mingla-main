/**
 * issue #3645 bundle 2A — 20280801003645 patches the LIVE bodies of
 * biz_create_experience, biz_publish_experience and biz_update_live_experience
 * with exactly the patches in issue_3645_per_stop_price_reemit_hunks.ts, and
 * re-creates nothing, so in-place patches between the last CREATE and this
 * migration (#4420's stored area line) are kept.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { definitions } from "./issue_3645_reemit_hunks.ts";
import {
  dollarQuoted,
  PER_STOP_PRICE_PATCHES,
  TARGET,
} from "./issue_3645_per_stop_price_reemit_hunks.ts";
import {
  ariDomainRefusalMessage,
  detectAriRefusalCode,
} from "../../functions/_shared/ariRefusalCopy.ts";

const DIR = "supabase/migrations";
const TARGET_FILE = TARGET.slice(DIR.length + 1);
const SQL = Deno.readTextFileSync(TARGET);

function files(): string[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

for (const p of PER_STOP_PRICE_PATCHES) {
  Deno.test(`#3645 2A ${p.fn}: source is the latest earlier CREATE`, () => {
    let latest: string | null = null;
    for (const file of files().filter((f) => f < TARGET_FILE)) {
      if (definitions(Deno.readTextFileSync(`${DIR}/${file}`)).has(p.fn)) {
        latest = `${DIR}/${file}`;
      }
    }
    assertEquals(latest, p.source);
  });

  Deno.test(`#3645 2A ${p.fn}: the patched line is in the source exactly once`, () => {
    const body = definitions(Deno.readTextFileSync(p.source)).get(p.fn)!;
    assertEquals(count(body, p.old), 1);
    assertEquals(count(body, p.new), 0);
  });

  Deno.test(`#3645 2A ${p.fn}: no in-place patch since the source touches the line`, () => {
    // An earlier in-place patch (pg_temp.*_patch on this signature) whose text
    // overlaps ours would make the live body differ from the source here.
    const between = files().filter((f) => f > p.source.slice(DIR.length + 1) && f < TARGET_FILE);
    const trimmed = p.old.trim();
    for (const file of between) {
      const text = Deno.readTextFileSync(`${DIR}/${file}`);
      if (!text.includes(`'${p.signature}'`)) continue;
      assert(!text.includes(trimmed), `${file} patches ${p.fn}'s price line in place`);
      assert(!text.includes("v_resolved_total <= 0"), `${file} patches near ${p.fn}'s price rule`);
    }
  });

  Deno.test(`#3645 2A ${p.fn}: the migration applies exactly the declared patch`, () => {
    const call = `SELECT pg_temp.issue_3645_2a_patch(\n  '${p.signature}',\n  ${
      dollarQuoted("old", p.old)
    },\n  ${dollarQuoted("new", p.new)},\n  1\n);`;
    assertEquals(count(SQL, call), 1);
    const n = p.new;
    assert(!/v_pricing_mode\s*=\s*'whole'/.test(n), "no whole-only condition");
    assert(/IF \(NOT v_is_free\)[^\n]*v_resolved_total <= 0 THEN\n$/.test(n));
  });
}

Deno.test("#3645 2A the migration re-creates no public function and patches nothing else", () => {
  assertEquals([...definitions(SQL).keys()], []);
  assertEquals(count(SQL, "SELECT pg_temp.issue_3645_2a_patch("), PER_STOP_PRICE_PATCHES.length);
  assertEquals(count(SQL, "EXECUTE "), 1, "only the helper executes SQL");
  for (const file of files().filter((f) => f > TARGET_FILE)) {
    const later = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const p of PER_STOP_PRICE_PATCHES) {
      assert(!later.has(p.fn), `${file} re-creates ${p.fn} and would drop bundle 2A's patch`);
    }
  }
});

Deno.test("#3645 2A the patch helper refuses a shape mismatch and is re-apply safe", () => {
  assert(SQL.includes("IF v_old_count = 0 AND v_new_count = p_expected THEN\n    RETURN;"));
  assert(SQL.includes("IF v_old_count <> p_expected THEN\n    RAISE EXCEPTION 'issue_3645_2a_shape_mismatch"));
  assert(SQL.includes("v_def := pg_get_functiondef(p_signature::regprocedure);"));
});

Deno.test("#3645 2A the refusal is worded for Ari and the experience wizard", () => {
  const raw = "biz_publish_experience: experience_price_invalid";
  assertEquals(detectAriRefusalCode(raw), "experience_price_invalid");
  const ari = ariDomainRefusalMessage(raw) ?? "";
  assert(ari.length > 0, "Ari explains experience_price_invalid");
  assert(!/[a-z]+_[a-z_]+/.test(ari), "no code words in the owner sentence");
  const wizard = Deno.readTextFileSync(
    "mingla-business/src/components/experience/ExperienceCreatorWizard.tsx",
  );
  assert(/experience_price_invalid:\s*"Set a valid price, or mark the experience free\."/.test(wizard));
});

Deno.test("#3645 2A refuses to apply before its source migrations (no silent rollback of the rule)", () => {
  const guard = SQL.indexOf("DO $precondition$");
  const firstPatch = SQL.indexOf("SELECT pg_temp.issue_3645_2a_patch(");
  assert(guard > 0 && guard < firstPatch, "the precondition runs before any patch");
  assert(SQL.includes("to_regprocedure('public.issue_3281_event_date_deletable(uuid)') IS NULL"));
  assert(SQL.includes("p.prosrc LIKE '%experience_dates_have_sales%'"));
  assert(SQL.includes("RAISE EXCEPTION 'issue_3645_2a_requires_20280625003281'"));
  assert(SQL.includes("RAISE EXCEPTION 'issue_3645_2a_requires_20280428003645'"));
  // The update marker it checks survives this migration's own patch, so a
  // re-apply still passes.
  const update = definitions(Deno.readTextFileSync(PER_STOP_PRICE_PATCHES[2].source)).get(
    "biz_update_live_experience",
  )!;
  assert(update.includes("a paid whole-price experience edited to 0"));
  assert(!PER_STOP_PRICE_PATCHES[2].old.includes("a paid whole-price experience edited to 0"));
});
