// Issue #3355 merge of #4404 (#4389) — the brand setup flow under the
// "Ari understands first" model (D3a / D4a), and #4389's prompt lines on both
// sides of the rollout switch.
//
//   1. With the switch on, brand setup is a registered start_flow setup: the
//      model starts it (no keyword front door), and its first card is the
//      bank country handoff to the real setup route.
//   2. D4a: the flow has only blocking steps, and each is a brand_setup item
//      #4389's migration marks blocking; nothing optional is ever a step.
//   3. With the switch off, typed words never start it (origin/main had no
//      keyword front door either) and the off prompt is origin/main's v30
//      builder, #4389's brand setup lines included.
//
// MINGLA-INVARIANT: I-ARI-BRAND-SETUP-BY-START-FLOW | issue #3355 | #4389's brand_setup flow starts from typed words only through start_flow (switch on); no keyword classifier starts it, and every step it has is a blocking brand_setup readiness item (enforced by supabase/functions/_shared/__tests__/issue_3355_merge_4389_brand_setup.implementor.test.ts).
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_merge_4389_brand_setup.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideFlowTurn, startFlowFromTool } from "../ariFlows/edge.ts";
import {
  ARI_START_FLOW_DECLARATION,
  ARI_START_FLOW_KEYS,
  parseStartFlowArgs,
} from "../ariFlows/startFlowTool.ts";
import {
  BRAND_SETUP_FLOW,
  BRAND_SETUP_FLOW_KEY,
} from "../ariFlows/brandSetup.ts";
import { classifyOfferingIntent } from "../ariFlows/index.ts";
import { BRAND_SETUP_ITEM_KEYS } from "../readinessCatalog.ts";
import { buildSystemPrompt } from "../agentSystemPrompt.ts";
import {
  buildAriTurnSystemPrompt,
  buildLegacySystemPrompt,
} from "../agentSystemPromptLegacy.ts";
import {
  current,
  freshWorld,
  MemoryStore,
  OWNER,
  turnArgs,
} from "./_issue3355WaveEFlowWorld.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

const BRAND_SETUP_WORDS = [
  "Finish setting up my brand so I can get paid",
  "Set up payments for my brand",
  "I want to finish my brand setup",
];

Deno.test("merge #4389: brand_setup is a start_flow setup the model can pick", () => {
  assert(ARI_START_FLOW_KEYS.includes(BRAND_SETUP_FLOW_KEY));
  const description = ARI_START_FLOW_DECLARATION.description;
  assertMatch(description, /brand_setup = finish setting up an existing brand/);
  const enumKeys = (ARI_START_FLOW_DECLARATION.parameters.properties.flow_key
    .enum) as readonly string[];
  assert(enumKeys.includes(BRAND_SETUP_FLOW_KEY));
  assertEquals(
    parseStartFlowArgs({ flow_key: "brand_setup", intent_text: "get paid" })
      ?.flow_key,
    "brand_setup",
  );
  // The on prompt names it among the guided setups (principle 12).
  assertMatch(
    buildSystemPrompt(null, []),
    /12\. Guided setups: .*finish setting up an existing brand to get paid.*call start_flow\./,
  );
});

Deno.test("merge #4389: start_flow(brand_setup) opens the bank country handoff", async () => {
  const store = new MemoryStore(OWNER);
  const words = "Finish setting up my brand so I can get paid";
  const decision = await startFlowFromTool({
    ...turnArgs(store, freshWorld(), words),
    call: { flow_key: "brand_setup", intent_text: "get paid" },
  });
  if (decision.kind !== "reply") throw new Error(decision.kind);
  const run = await current(store);
  assertEquals(run.flow_key, "brand_setup");
  assertEquals(run.answers.intent_text, { value: words, source: "owner" });
  assertEquals(decision.artefact?.title, "Bank country");
  assertMatch(
    JSON.stringify(decision.artefact),
    /\/brand\/[0-9a-f-]{36}\/setup\?step=country/,
  );
  // Bank, ID and tax numbers are never asked for in chat.
  assertNotMatch(decision.text, /account number|sort code|IBAN|BVN|tax id/i);
});

Deno.test("merge #4389 (D4a): every brand setup step is a blocking brand_setup item", () => {
  const sql = read(
    "supabase/migrations/20280701004389_issue_4389_brand_setup.sql",
  );
  // #4389 marks money.market and money.terms_member blocking for brand_setup
  // and seeds brand.name / money.details_submitted with blocking_for
  // brand_setup; the checker refuses anything but these four.
  assertMatch(sql, /WHERE key IN \('money\.market','money\.terms_member'\)/);
  assertMatch(sql, /brand_setup has % items, expected 4/);
  for (const step of BRAND_SETUP_FLOW.steps) {
    assertEquals(step.policy, "blocking", step.key);
  }
  assertEquals(BRAND_SETUP_FLOW.steps.map((step) => step.key), [
    "bank_country",
    "get_paid",
  ]);
  for (
    const key of [
      "money.market",
      "money.terms_member",
      "money.details_submitted",
    ]
  ) {
    assert((BRAND_SETUP_ITEM_KEYS as readonly string[]).includes(key), key);
  }
});

Deno.test("merge #4389: typed words never start brand setup (no keyword front door, either path)", async () => {
  for (const text of BRAND_SETUP_WORDS) {
    const store = new MemoryStore(OWNER);
    const decision = await decideFlowTurn(turnArgs(store, freshWorld(), text));
    assertEquals(decision.kind, "none", text);
    assertEquals(store.runs.size, 0, text);
    assert(String(classifyOfferingIntent(text)) !== BRAND_SETUP_FLOW_KEY, text);
  }
});

Deno.test("merge #4389: #4389's brand setup lines are in the on prompt and in origin/main's off prompt", () => {
  const lines = [
    "ask for its name, then its bank country, then propose create_brand",
    "Brand setup order is name → bank country → Organiser Terms and payment details on the secure screen. Never ask for, and never accept, bank, ID or tax numbers in chat (#4389).",
  ];
  const on = buildAriTurnSystemPrompt(true, null, [], {
    injectStrictReminder: false,
  });
  const off = buildAriTurnSystemPrompt(false, null, [], {
    injectStrictReminder: false,
  });
  assertEquals(off, buildLegacySystemPrompt(null, []));
  for (const line of lines) {
    assert(on.includes(line), `on: ${line}`);
    assert(off.includes(line), `off: ${line}`);
  }
  assertMatch(
    off,
    /- start_payments_onboarding — open the secure screen for a brand's ID and bank details\n- start_door_sale — open the door sale for an event with tickets prefilled\n/,
  );
  assertNotMatch(off, /start_flow/);
});
