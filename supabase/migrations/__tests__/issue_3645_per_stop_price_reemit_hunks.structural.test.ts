/**
 * issue #3645 bundle 2A — biz_publish_experience and
 * biz_update_live_experience are re-emitted by 20280801003645 with exactly the
 * hunks in issue_3645_per_stop_price_reemit_hunks.ts, from their latest
 * earlier definitions, and nothing else moves.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyHunks, definitions } from "./issue_3645_reemit_hunks.ts";
import {
  PER_STOP_PRICE_REEMITS,
  TARGET,
} from "./issue_3645_per_stop_price_reemit_hunks.ts";
import {
  ariDomainRefusalMessage,
  detectAriRefusalCode,
} from "../../functions/_shared/ariRefusalCopy.ts";

const DIR = "supabase/migrations";
const TARGET_FILE = TARGET.slice(DIR.length + 1);

function files(): string[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

for (const reemit of PER_STOP_PRICE_REEMITS) {
  Deno.test(`#3645 2A ${reemit.fn}: source is the latest earlier definition`, () => {
    let latest: string | null = null;
    for (const file of files().filter((f) => f < TARGET_FILE)) {
      if (definitions(Deno.readTextFileSync(`${DIR}/${file}`)).has(reemit.fn)) {
        latest = `${DIR}/${file}`;
      }
    }
    assertEquals(latest, reemit.source);
  });

  Deno.test(`#3645 2A ${reemit.fn}: re-emit differs from its source by the authorised hunk only`, () => {
    const source = definitions(Deno.readTextFileSync(reemit.source)).get(reemit.fn);
    const target = definitions(Deno.readTextFileSync(reemit.target)).get(reemit.fn);
    assert(source !== undefined, `${reemit.fn} missing from ${reemit.source}`);
    assert(target !== undefined, `${reemit.fn} missing from ${reemit.target}`);
    assertEquals(target, applyHunks(source, reemit.hunks));
  });
}

Deno.test("#3645 2A the target defines only its declared re-emits", () => {
  const declared = PER_STOP_PRICE_REEMITS.map((r) => r.fn).sort();
  const defined = [...definitions(Deno.readTextFileSync(TARGET)).keys()].sort();
  assertEquals(defined, declared);
});

Deno.test("#3645 2A the target is still the latest definition of what it defines", () => {
  const mine = [...definitions(Deno.readTextFileSync(TARGET)).keys()];
  for (const file of files().filter((f) => f > TARGET_FILE)) {
    const later = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const name of mine) {
      assert(!later.has(name), `${file} redefines ${name}; declare its hunks against ${TARGET_FILE}`);
    }
  }
});

Deno.test("#3645 2A no zero-price refusal is limited to whole-price mode any more", () => {
  const defs = definitions(Deno.readTextFileSync(TARGET));
  for (const fn of ["biz_create_experience", "biz_publish_experience", "biz_update_live_experience"]) {
    const body = defs.get(fn)!;
    assert(!/v_pricing_mode\s*=\s*'whole'\s+AND[^\n]*v_resolved_total\s*<=\s*0/.test(body), fn);
    assert(/IF \(NOT v_is_free\)[^\n]*v_resolved_total <= 0 THEN\n\s+RAISE EXCEPTION 'experience_price_invalid';/.test(body), fn);
  }
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
  const sql = Deno.readTextFileSync(TARGET);
  const guard = sql.indexOf("DO $precondition$");
  const firstCreate = sql.indexOf("CREATE OR REPLACE FUNCTION");
  assert(guard > 0 && guard < firstCreate, "the precondition runs before any re-emit");
  assert(sql.includes("to_regprocedure('public.issue_3281_event_date_deletable(uuid)') IS NULL"));
  assert(sql.includes("p.prosrc LIKE '%experience_dates_have_sales%'"));
  assert(sql.includes("RAISE EXCEPTION 'issue_3645_2a_requires_20280625003281'"));
  assert(sql.includes("RAISE EXCEPTION 'issue_3645_2a_requires_20280428003645'"));
  // The update marker it checks survives this migration's own hunk, so a
  // re-apply still passes.
  const update = definitions(sql).get("biz_update_live_experience")!;
  assert(update.includes("a paid whole-price experience edited to 0"));
});
