/**
 * #4238 W5 (8c) — Ari's creative rule: real people and venues only, from the
 * event's own record and the brand's own media; AI-generated media refused.
 * The prompt says it, and ad-plan create_version enforces it for Ari plans.
 *
 * MINGLA-INVARIANT: I-4238-ARI-REAL-ONLY | issue #4238 | Ari plans with AI-generated media or ad words naming a person or venue outside the event record are refused at create_version; Host plans are not checked.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ariCreativeAiGenerated,
  ariUnverifiedName,
  capitalisedNames,
} from "../adAriCreativeRule.ts";
import { ariCreativeRefusal } from "../../ad-plan/index.ts";

const RECORD = [
  "Harmattan Club",
  "Afro Nation Lagos",
  "A night with Burna Boy and DJ Spinall at The Shrine.",
  "The Shrine, Ikeja, Lagos",
];

Deno.test("SC-8.4: a venue not in the event record is refused; named ones pass", () => {
  assertEquals(
    ariUnverifiedName(
      { primary: "Dance all night at Club Quilox with us." },
      RECORD,
    ),
    "Club Quilox",
  );
  assertEquals(
    ariUnverifiedName(
      { primary: "Burna Boy live at The Shrine this Friday." },
      RECORD,
    ),
    null,
  );
  assertEquals(
    ariUnverifiedName({
      headline: "Afro Nation Lagos",
      primary: "See you there, with Wizkid Ayo.",
    }, RECORD),
    "Wizkid Ayo",
  );
});

Deno.test("adversarial: sentence-start capitals and ad words are not names", () => {
  assertEquals(capitalisedNames("Join us. Tickets are going fast."), []);
  assertEquals(capitalisedNames("Grab your spot for Friday Night Live."), []);
  assertEquals(
    ariUnverifiedName({ primary: "Don't miss it. Get Tickets Now." }, RECORD),
    null,
  );
  // A name made of record words in a different order is still a new name.
  assertEquals(
    ariUnverifiedName({ primary: "with Spinall Burna on stage" }, RECORD),
    "Spinall Burna",
  );
});

Deno.test("SC-8.3: AI-generated media is refused for Ari (row or attestation)", () => {
  assert(
    ariCreativeAiGenerated({
      creatives: [{ ai_generated: false }, { ai_generated: true }],
      mediaRights: { ai_generated: false },
    }),
  );
  assert(
    ariCreativeAiGenerated({
      creatives: [{ ai_generated: false }],
      mediaRights: { ai_generated: true },
    }),
  );
  assert(
    !ariCreativeAiGenerated({
      creatives: [{ ai_generated: false }],
      mediaRights: { ai_generated: false },
    }),
  );
});

function fakeDb(rows: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          const data = (rows[table] ?? []).filter((row) =>
            values.includes(row[key])
          );
          return Promise.resolve({ data, error: null });
        },
        maybeSingle: () => {
          const data =
            (rows[table] ?? []).find((row) =>
              filters.every(([key, value]) => row[key] === value)
            ) ?? null;
          return Promise.resolve({ data, error: null });
        },
      };
      return query;
    },
  };
}

const IDS = {
  brand: "11111111-1111-4111-8111-111111111111",
  event: "22222222-2222-4222-8222-222222222222",
  video: "33333333-3333-4333-8333-333333333333",
  aiVideo: "44444444-4444-4444-8444-444444444444",
};
const DB = fakeDb({
  brands: [{ id: IDS.brand, name: "Harmattan Club" }],
  events: [{
    id: IDS.event,
    title: "Afro Nation Lagos",
    description: RECORD[2],
    location_text: RECORD[3],
  }],
  ad_creatives: [{ id: IDS.video, ai_generated: false }, {
    id: IDS.aiVideo,
    ai_generated: true,
  }],
});

Deno.test("create_version check: an AI video, a fake venue, then a clean plan", async () => {
  const base = {
    media_rights: { ai_generated: false },
    copy: { primary: "Burna Boy at The Shrine." },
  };
  assertEquals(
    await ariCreativeRefusal(DB, {
      canonical: { ...base, creative_library_ids: [IDS.video, IDS.aiVideo] },
      brandId: IDS.brand,
      eventId: IDS.event,
    }),
    "ari_creative_ai_generated",
  );
  assertEquals(
    await ariCreativeRefusal(DB, {
      canonical: {
        ...base,
        creative_library_ids: [IDS.video],
        copy: { primary: "Party at Club Quilox." },
      },
      brandId: IDS.brand,
      eventId: IDS.event,
    }),
    "ari_copy_unverified_name:Club Quilox",
  );
  assertEquals(
    await ariCreativeRefusal(DB, {
      canonical: { ...base, creative_library_ids: [IDS.video] },
      brandId: IDS.brand,
      eventId: IDS.event,
    }),
    null,
  );
});

Deno.test("wiring: only Ari plans are checked; the prompt carries the rule", async () => {
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(
    /if \(plan\.client_kind === "ari"\) \{\s*const refusal = await ariCreativeRefusal\(/
      .test(plan),
  );
  const prompt = await Deno.readTextFile(
    new URL("../agentSystemPrompt.ts", import.meta.url),
  );
  assert(
    prompt.includes(
      "Ad words name only the people, venues and facts in the event's own record",
    ),
  );
  assert(prompt.includes("never AI-generated ones"));
});
