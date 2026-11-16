// #4452 T-1.9b: deterministic answer and definition vectors for the contract
// parity proof. The TS contract computes the expected result of each vector;
// the pg17 suite issue_4452_forms_core.implementor.pg17.test.sql embeds the
// same JSON and asserts the SQL mirror returns exactly that. The Deno parity
// test regenerates the JSON and fails when the embedded copy drifts.
//
// Regenerate the embedded block (after a deliberate contract change):
//   deno run --allow-read --allow-write supabase/functions/_shared/__tests__/issue_4452_forms_contract_vectors.ts --write

import {
  type FormDefinition,
  validateAnswers,
  validateDefinition,
} from "../formsContract.ts";

export const SQL_SUITE =
  "supabase/migrations/__tests__/issue_4452_forms_core.implementor.pg17.test.sql";
export const BEGIN_MARK = "-- BEGIN #4452 CONTRACT VECTORS (generated; do not edit by hand)";
export const END_MARK = "-- END #4452 CONTRACT VECTORS";
export const TODAY = "2026-11-16";

/** A small seeded PRNG (mulberry32) so the vectors never change between runs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CREATORS_DEF: FormDefinition = {
  v: 1,
  audience: "creator",
  fields: [
    { key: "name", type: "name", label: "Your name", required: true, locked: true },
    { key: "email", type: "email", label: "Email", required: true, locked: true },
    { key: "phone", type: "phone", label: "Phone", required: true, locked: true },
    { key: "what_do_you_make", type: "single", label: "What do you make?", required: true, options: ["Video", "Photo", "Both"] },
    { key: "format", type: "multi", label: "Which formats?", required: true, options: ["Reels", "Stories", "Long video"], show_if: { field_key: "what_do_you_make", op: "is", value: "Video" } },
    { key: "portfolio", type: "short", label: "Portfolio link", required: false, show_if: { field_key: "what_do_you_make", op: "is", value: "Photo" } },
    { key: "your_main_social", type: "social", label: "Your main social", required: true },
    { key: "city", type: "dropdown", source: "google_city", label: "Your city", required: true },
    { key: "about", type: "long", label: "About your work", required: false },
    { key: "start", type: "date", label: "When can you start?", required: false },
    { key: "consent", type: "consent", label: "Send me creator tips and new gigs by email. Unsubscribe any time.", required: false },
  ],
  ads: { lead_on: true, goal: "call_booked" },
  routing: { card: { on: false } },
};

const NAMES: unknown[] = ["Ada Okafor", "  Ada  ", "A", "Chidi\u0007 Eze", "", null, 42, "Zoë Ñúñez", "x".repeat(81), "Ama\nKoffi"];
const EMAILS: unknown[] = [
  "ada@example.org", " ADA@Example.ORG ", "ada@gmial.com", "ada@gmail.co", "ada@example", "ada@@example.org",
  "", null, "ad a@example.org", "ada@example.c", "a".repeat(250) + "@x.org", "ada@hotmial.com", 7,
];
const PHONES: unknown[] = [
  { country: "NG", dial: "+234", number: "801 234 5678" },
  { country: "IE", dial: "+353", number: "(0)87 123 4567" },
  { country: "IE", dial: "+353", number: "+353 87 123 4567" },
  { country: "US", dial: "+1", number: "12" },
  { country: "us", dial: "+1", number: "919 555 0100" },
  { country: "GB", dial: "44", number: "7700 900123" },
  null,
  "08012345678",
  { country: "GB", dial: "+44", number: "07700 900123" },
];
const MAKES: unknown[] = ["Video", "Photo", "Both", "video", "", null, ["Video"]];
const FORMATS: unknown[] = [["Reels"], ["Reels", "Stories"], [], ["Reels", "Reels"], ["TikTok"], "Reels", undefined];
const SOCIALS: unknown[] = [
  { platform: "instagram", value: "@ada.films" },
  { platform: "tiktok", value: "ada_films" },
  { platform: "youtube", value: "https://youtube.com/@ada" },
  { platform: "website", value: "ada.films" },
  { platform: "website", value: "https://ada.films" },
  { platform: "myspace", value: "@ada" },
  { platform: "instagram", value: "@a" },
  null,
];
const CITIES: unknown[] = [
  { label: "Lagos, Nigeria", city: "Lagos", region: "Lagos", country: "NG" },
  { label: "Raleigh", free: true },
  { label: "L" },
  "Lagos",
  { label: "Dublin", city: 12 },
  null,
];
const ABOUTS: unknown[] = ["I mostly shoot food.\nAnd people.", "x".repeat(2001), "", 5, undefined];
const STARTS: unknown[] = ["2026-11-20", "2026-11-01", { from: "2026-11-21", to: "2026-11-22" }, { from: "2026-11-22", to: "2026-11-21" }, "2026-02-30", undefined];
const CONSENTS: unknown[] = [true, false, "true", 1, undefined];

function pick<T>(r: () => number, list: T[]): T {
  return list[Math.floor(r() * list.length)];
}

export interface AnswerVector {
  i: number;
  answers: Record<string, unknown>;
  expected: ReturnType<typeof validateAnswers>;
}

export function answerVectors(n = 300): AnswerVector[] {
  const r = rng(4452);
  const out: AnswerVector[] = [];
  for (let i = 0; i < n; i++) {
    const a: Record<string, unknown> = {};
    const set = (k: string, v: unknown) => {
      if (v !== undefined) a[k] = v;
    };
    set("name", pick(r, NAMES));
    set("email", pick(r, EMAILS));
    set("phone", pick(r, PHONES));
    set("what_do_you_make", pick(r, MAKES));
    set("format", pick(r, FORMATS));
    if (r() < 0.4) set("portfolio", r() < 0.5 ? "https://ada.photos" : "x".repeat(121));
    set("your_main_social", pick(r, SOCIALS));
    set("city", pick(r, CITIES));
    set("about", pick(r, ABOUTS));
    set("start", pick(r, STARTS));
    set("consent", pick(r, CONSENTS));
    if (r() < 0.05) a["sneaky"] = "x";
    // Every 10th vector is fully valid, so both outcomes are well covered.
    if (i % 10 === 0) {
      a.name = "Ada Okafor";
      a.email = "ada@example.org";
      a.phone = { country: "NG", dial: "+234", number: "801 234 5678" };
      a.what_do_you_make = i % 20 === 0 ? "Video" : "Both";
      if (a.what_do_you_make === "Video") a.format = ["Reels"];
      else delete a.format;
      delete a.portfolio;
      delete a.sneaky;
      a.your_main_social = { platform: "instagram", value: "@ada.films" };
      a.city = { label: "Lagos, Nigeria", city: "Lagos", country: "NG" };
      a.about = "My best work is food.";
      a.start = "2026-11-20";
    }
    out.push({ i, answers: a, expected: validateAnswers(CREATORS_DEF, a, TODAY) });
  }
  return out;
}

export interface DefinitionVector {
  name: string;
  def: unknown;
  expected: ReturnType<typeof validateDefinition>;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function definitionVectors(): DefinitionVector[] {
  const cases: Array<[string, (d: Record<string, any>) => void]> = [
    ["creators form is valid", () => {}],
    ["R-1 no email field", (d) => d.fields.splice(1, 1)],
    ["R-1 two email fields", (d) => d.fields.push({ key: "email2", type: "email", label: "Other", required: true })],
    ["R-1 email optional", (d) => (d.fields[1].required = false, d.fields[1].locked = false)],
    ["R-2 two phones", (d) => d.fields.push({ key: "phone2", type: "phone", label: "Other", required: false })],
    ["R-3 consent required", (d) => (d.fields[10].required = true)],
    ["R-5 bad audience", (d) => (d.audience = "explorer")],
    ["R-6 locked but optional", (d) => (d.fields[0].required = false)],
    ["R-7 duplicate key", (d) => (d.fields[4].key = "name")],
    ["R-7 show_if refers forward", (d) => (d.fields[3].show_if = { field_key: "city", op: "is", value: "Lagos" })],
    ["R-7 show_if on a text field", (d) => (d.fields[9].show_if = { field_key: "about", op: "is", value: "x" })],
    ["bad key", (d) => (d.fields[8].key = "About")],
    ["bad type", (d) => (d.fields[8].type = "upload")],
    ["options duplicate", (d) => (d.fields[3].options = ["Video", "Video"])],
    ["options empty", (d) => (d.fields[3].options = [])],
    ["options on a text field", (d) => (d.fields[8].options = ["a"])],
    ["label too long", (d) => (d.fields[8].label = "x".repeat(121))],
    ["help too long", (d) => (d.fields[8].help = "x".repeat(201))],
    ["bad dropdown source", (d) => (d.fields[7].source = "maps")],
    ["ads missing", (d) => delete d.ads],
    ["bad goal", (d) => (d.ads.goal = "sale")],
    ["R-25 card on for a local form", (d) => (d.audience = "local", d.routing = { card: { on: true, pipeline: "creators" } })],
    ["R-25 card on without pipeline", (d) => (d.routing = { card: { on: true } })],
    ["R-25 card pipeline mismatch", (d) => (d.routing = { card: { on: true, pipeline: "hosts" } })],
    ["card on creators ok", (d) => (d.routing = { card: { on: true, pipeline: "creators" }, owner: { mode: "unassigned" } })],
    ["R-26 owner without card", (d) => (d.routing = { card: { on: false }, owner: { mode: "unassigned" } })],
    ["owner person needs one email", (d) => (d.routing = { card: { on: true, pipeline: "creators" }, owner: { mode: "person", emails: [] } })],
    ["round robin ok", (d) => (d.routing = { card: { on: true, pipeline: "creators" }, owner: { mode: "round_robin", emails: ["a@usemingla.com", "b@usemingla.com"] } })],
    ["own page bad slug", (d) => (d.own_page = { on: true, slug: "Creators!" })],
    ["own page reserved slug", (d) => (d.own_page = { on: true, slug: "thanks" })],
    ["own page ok", (d) => (d.own_page = { on: true, slug: "creators", index: false, h: "Join the", em: "creator list.", bg: "night" })],
    ["own page headline too long", (d) => (d.own_page = { on: false, h: "x".repeat(29) })],
    ["no fields", (d) => (d.fields = [])],
  ];
  return cases.map(([name, mutate]) => {
    const d = clone(CREATORS_DEF) as unknown as Record<string, any>;
    mutate(d);
    return { name, def: d, expected: validateDefinition(d) };
  });
}

export function vectorsJson(): string {
  return JSON.stringify({ today: TODAY, def: CREATORS_DEF, answers: answerVectors(), definitions: definitionVectors() });
}

/** The exact SQL block embedded in the pg17 suite. */
export function sqlBlock(): string {
  const json = vectorsJson();
  if (json.includes("$vec$")) throw new Error("vector JSON contains the dollar-quote tag");
  return `${BEGIN_MARK}\nSELECT set_config('issue4452.vectors', $vec$${json}$vec$, false);\n${END_MARK}`;
}

if (import.meta.main && Deno.args.includes("--write")) {
  const path = new URL(`../../../../${SQL_SUITE}`, import.meta.url);
  const text = await Deno.readTextFile(path);
  const start = text.indexOf(BEGIN_MARK);
  const end = text.indexOf(END_MARK);
  if (start < 0 || end < 0) throw new Error("markers not found in the SQL suite");
  await Deno.writeTextFile(path, text.slice(0, start) + sqlBlock() + text.slice(end + END_MARK.length));
  console.log("wrote", SQL_SUITE);
}
