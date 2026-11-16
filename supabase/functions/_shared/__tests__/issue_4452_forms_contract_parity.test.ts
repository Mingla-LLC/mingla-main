// #4452 T-1.9a / T-1.9b (SC-24, SC-25): one form rule set.
//
// T-1.9a  mingla-marketing/lib/forms/contract.ts is byte-identical to
//         _shared/formsContract.ts except the first (header) line.
// T-1.9b  the vectors embedded in the pg17 suite equal what the TS contract
//         computes today (the pg17 suite then proves SQL returns the same).
//         A contract change without regenerating the vectors fails here.
// Plus direct unit checks of the rules the server relies on.
//
// MINGLA-INVARIANT: I-4452-ONE-FORM-RULESET | issue #4452 | proved here and in issue_4452_forms_core pg17 T-1.9b.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emailTypoFix,
  validateAnswers,
  validateDefinition,
  validateFlow,
  emailKinds,
} from "../formsContract.ts";
import { BEGIN_MARK, CREATORS_DEF, END_MARK, SQL_SUITE, sqlBlock, TODAY } from "./issue_4452_forms_contract_vectors.ts";

const ROOT = new URL("../../../../", import.meta.url);

Deno.test("T-1.9a SC-24 the marketing copy is byte-identical except the header line", async () => {
  const a = await Deno.readTextFile(new URL("supabase/functions/_shared/formsContract.ts", ROOT));
  const b = await Deno.readTextFile(new URL("mingla-marketing/lib/forms/contract.ts", ROOT));
  assertEquals(b.split("\n").slice(1).join("\n"), a.split("\n").slice(1).join("\n"));
});

Deno.test("T-1.9b SC-25 the pg17 suite embeds exactly today's TS vectors", async () => {
  const text = await Deno.readTextFile(new URL(SQL_SUITE, ROOT));
  const start = text.indexOf(BEGIN_MARK);
  const end = text.indexOf(END_MARK);
  assert(start >= 0 && end > start, "vector markers present");
  assertEquals(text.slice(start, end + END_MARK.length), sqlBlock(),
    "regenerate with: deno run --allow-read --allow-write supabase/functions/_shared/__tests__/issue_4452_forms_contract_vectors.ts --write");
});

Deno.test("R-10 a typo domain is blocking and the fix replaces the domain", () => {
  const r = validateAnswers(CREATORS_DEF, {
    name: "Ada Okafor", email: "ada@gmial.com",
    phone: { country: "NG", dial: "+234", number: "801 234 5678" }, what_do_you_make: "Photo",
    your_main_social: { platform: "instagram", value: "@ada" }, city: { label: "Lagos" },
  }, TODAY);
  assertEquals(r.ok, false);
  assertEquals(r.errors, [{ key: "email", code: "typo" }]);
  assertEquals(emailTypoFix("ada@gmial.com"), "ada@gmail.com");
});

Deno.test("R-18 / SC-36 consent is true only for a real boolean true", () => {
  const base = {
    name: "Ada Okafor", email: "ada@example.org",
    phone: { country: "NG", dial: "+234", number: "801 234 5678" }, what_do_you_make: "Photo",
    your_main_social: { platform: "instagram", value: "@ada" }, city: { label: "Lagos" },
  };
  assertEquals(validateAnswers(CREATORS_DEF, { ...base, consent: true }, TODAY).consent, true);
  assertEquals(validateAnswers(CREATORS_DEF, { ...base, consent: "true" }, TODAY).consent, false);
  assertEquals(validateAnswers(CREATORS_DEF, { ...base }, TODAY).consent, false);
});

Deno.test("R-19 a hidden required field is not required and its value is dropped", () => {
  const r = validateAnswers(CREATORS_DEF, {
    name: "Ada Okafor", email: "ada@example.org",
    phone: { country: "NG", dial: "+234", number: "801 234 5678" }, what_do_you_make: "Photo",
    format: ["Reels"], your_main_social: { platform: "instagram", value: "@ada" }, city: { label: "Lagos" },
  }, TODAY);
  assert(r.ok);
  assertEquals("format" in r.values, false);
});

Deno.test("R-20 / SC-34 an unknown answer key is rejected", () => {
  const r = validateAnswers(CREATORS_DEF, { email: "a@example.org", __proto__x: "1" }, TODAY);
  assert(r.errors.some((e) => e.key === "__proto__x" && e.code === "unknown_field"));
});

Deno.test("R-25 / R-26 (A1-SC-16): no card on a local form; no owner without a card", () => {
  const local = { ...structuredClone(CREATORS_DEF), audience: "local", routing: { card: { on: true, pipeline: "creators" } } };
  assert(validateDefinition(local).some((e) => e.code === "card_local"));
  const owner = { ...structuredClone(CREATORS_DEF), routing: { card: { on: false }, owner: { mode: "unassigned" } } };
  assert(validateDefinition(owner).some((e) => e.code === "owner_without_card"));
  assertEquals(validateDefinition(CREATORS_DEF), []);
});

Deno.test("F-6 / F-4 / F-9 flow rules", () => {
  const flow = {
    v: 1 as const,
    steps: [
      { id: "s0", type: "email" as const, name: "Welcome", to: "person", from: "creators", reply_to: "team", subject: "Hi {first_name}", doc: [{ type: "paragraph", text: "x" }], show_answers: false },
      { id: "w1", type: "wait" as const, n: 2, unit: "days", at10: true, skip_weekends: false },
      { id: "s1", type: "email" as const, name: "Nudge", to: "person", from: "creators", reply_to: "team", subject: "{nickname}", doc: [{ type: "paragraph", text: "x" }], show_answers: false },
      { id: "st", type: "stage" as const, stage: "contacted" },
    ],
  };
  assertEquals(emailKinds(flow), { s0: "confirmation", s1: "follow_up" });
  const errs = validateFlow(flow, { def: CREATORS_DEF, cardOn: false, stages: [] }).map((e) => e.code);
  assert(errs.includes("unknown_token:nickname"), "F-9 names the token");
  assert(errs.includes("stage_needs_card"), "F-4 stage needs the card");
});
