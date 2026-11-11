/**
 * issue #3281 bundle 6 — every function 20280625003281 re-emits changed by its
 * authorised hunks only (issue_3281_b6_reemit_hunks.ts).
 *
 *   (a) the source migration holds the latest definition before the target;
 *   (b) the target body equals the source body with exactly those hunks;
 *   (c) the target defines nothing else except its new functions, and those
 *       are new (no earlier migration defines them);
 *   (d) the target is still the latest definition of everything it defines.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyHunks, definitions } from "./issue_3645_reemit_hunks.ts";
import {
  B6_NEW_FUNCTIONS,
  B6_REEMITS,
  TARGET,
} from "./issue_3281_b6_reemit_hunks.ts";
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

for (const reemit of B6_REEMITS) {
  Deno.test(`#3281 bundle 6 ${reemit.fn}: source is the latest earlier definition`, () => {
    let latest: string | null = null;
    for (const file of files().filter((f) => f < TARGET_FILE)) {
      if (definitions(Deno.readTextFileSync(`${DIR}/${file}`)).has(reemit.fn)) {
        latest = `${DIR}/${file}`;
      }
    }
    assertEquals(latest, reemit.source);
  });

  Deno.test(`#3281 bundle 6 ${reemit.fn}: re-emit differs from its source by the authorised hunks only`, () => {
    const source = definitions(Deno.readTextFileSync(reemit.source)).get(
      reemit.fn,
    );
    const target = definitions(Deno.readTextFileSync(reemit.target)).get(
      reemit.fn,
    );
    assert(source !== undefined, `${reemit.fn} missing from ${reemit.source}`);
    assert(target !== undefined, `${reemit.fn} missing from ${reemit.target}`);
    assertEquals(target, applyHunks(source, reemit.hunks));
  });
}

Deno.test("#3281 bundle 6 the target defines only its declared re-emits and new functions", () => {
  const declared = new Set([
    ...B6_REEMITS.map((r) => r.fn),
    ...B6_NEW_FUNCTIONS,
  ]);
  const defined = [...definitions(Deno.readTextFileSync(TARGET)).keys()];
  for (const name of defined) {
    assert(
      declared.has(name),
      `${TARGET} defines ${name} without declaring it`,
    );
  }
  assertEquals(defined.length, declared.size);
  for (const file of files().filter((f) => f < TARGET_FILE)) {
    const earlier = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const name of B6_NEW_FUNCTIONS) {
      assert(
        !earlier.has(name),
        `${file} already defines ${name}, so bundle 6 re-emits it`,
      );
    }
  }
});

Deno.test("#3281 bundle 6 the target is still the latest definition of what it defines", () => {
  const mine = [...definitions(Deno.readTextFileSync(TARGET)).keys()];
  for (const file of files().filter((f) => f > TARGET_FILE)) {
    const later = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const name of mine) {
      assert(
        !later.has(name),
        `${file} redefines ${name}; declare its hunks against ${TARGET_FILE}`,
      );
    }
  }
});

Deno.test("#3281 bundle 6 every delete gate uses the one deletable rule", () => {
  const defs = definitions(Deno.readTextFileSync(TARGET));
  const publish = defs.get("biz_publish_experience")!;
  const gate = publish.indexOf(
    "NOT public.issue_3281_event_date_deletable(d.id)",
  );
  const refuse = publish.indexOf(
    "RAISE EXCEPTION 'experience_dates_have_sales';",
  );
  const del = publish.indexOf(
    "DELETE FROM public.event_dates WHERE event_id = p_event_id;",
  );
  assert(
    gate > 0 && refuse > gate && del > refuse,
    "publish checks every date before deleting",
  );
  assertEquals(publish.split("DELETE FROM public.event_dates").length - 1, 1);
  const rsvp = defs.get("biz_update_live_rsvp")!;
  assertEquals(rsvp.split("DELETE FROM public.event_dates").length - 1, 1);
  assert(rsvp.includes("AND public.issue_3281_event_date_deletable(id);"));
});

Deno.test("#3281 bundle 6 the new refusal is worded for Ari and the experience wizard", () => {
  // As the database raises it, through PostgREST and callRpc.
  const raw = "biz_publish_experience: experience_dates_have_sales";
  assertEquals(detectAriRefusalCode(raw), "experience_dates_have_sales");
  const ari = ariDomainRefusalMessage(raw) ?? "";
  assert(
    ari.includes("already has bookings") && ari.endsWith("Nothing was saved."),
  );
  assert(!/[a-z]+_[a-z_]+/.test(ari), "no code words in the owner sentence");
  const wizard = Deno.readTextFileSync(
    "mingla-business/src/components/experience/ExperienceCreatorWizard.tsx",
  );
  assert(
    /experience_dates_have_sales:\s*"This experience already has bookings/.test(
      wizard,
    ),
  );
});
