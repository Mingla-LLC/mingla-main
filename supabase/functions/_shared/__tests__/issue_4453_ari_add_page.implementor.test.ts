// deno-lint-ignore-file require-await no-explicit-any -- fakes mirror async HTTP
/*
 * #4453 milestone 11 (spec v2.1 §3) — "Add a page with Ari", Core's side:
 *   - both tools exist only on the switch-ON path (ARI_UNDERSTAND_FIRST_ONLY_TOOLS),
 *     so the frozen switch-OFF declarations stay origin/main's (#3355);
 *   - their schemas are closed and use no const/oneOf (ariToolSchemas rule);
 *   - every new refusal Core sends (brand-site-control's real ariFailureFrom)
 *     reaches Ari and the owner through the real executor as Core's sentence,
 *     never as "Ari could not reach Website tools right now."
 *   - the owner's answers route maps onto the content action `ari_page_answer`.
 */
import { assert, assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapLegacyAriErrorCode } from "../agentReliability.ts";
import { SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { ARI_UNDERSTAND_FIRST_ONLY_TOOLS } from "../ariRolloutTurn.ts";
import { ARI_PAGE_CODES, ARI_PAGE_MESSAGES } from "../siteContracts/ariPage.ts";
import { ariFailureFrom, ARI_DESIGNER_ACTIONS } from "../../brand-site-control/siteAri.ts";
import { handleSiteContentRoute } from "../../brand-site-control/siteContent.ts";

const BRAND = "733bc470-45e1-4684-8896-acd7e26074ff";
const SITE = "11111111-1111-4111-8111-111111111111";
const USER = "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
const OP = "22222222-2222-4222-8222-222222222222";
const REQUEST = "Add a page about private hire";
const CITES = [{ kind: "owner_words", quote: REQUEST }];
const GENERIC = "Ari could not reach Website tools right now.";
const TOOLS = ["propose_site_page", "answer_site_page_question"];

function coreClient(response: Response) {
  return {
    functions: { invoke: async () => ({ data: null, error: { name: "FunctionsHttpError", context: response.clone() } }) },
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: SITE }], error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  } as any;
}

Deno.test("#4453 m11 both tools are switch-ON only, closed, with no const/oneOf", () => {
  for (const name of TOOLS) {
    assert(ARI_UNDERSTAND_FIRST_ONLY_TOOLS.has(name), `${name} must be on-path only`);
    assert(ARI_DESIGNER_ACTIONS.has(name), `${name} must be a Core designer action`);
    const tool = SITE_AGENT_TOOLS.find((item) => item.name === name);
    assert(tool, `${name} is not registered`);
    assertEquals((tool.parameters as { additionalProperties?: unknown }).additionalProperties, false);
    const text = JSON.stringify(tool.parameters);
    assert(!text.includes('"const"') && !text.includes('"oneOf"'), `${name} uses const or oneOf`);
  }
});

const ENVELOPE: Record<string, string> = {
  ARI_ADD_PAGE_OFF: "DOMAIN_ACTION_REFUSED",
  ARI_PAGE_LIMIT: "DOMAIN_ACTION_REFUSED",
  ARI_DRAFT_PAGES_OPEN: "DOMAIN_ACTION_REFUSED",
  ARI_PAGE_RATE_LIMITED: "SERVICE_TEMPORARILY_UNAVAILABLE",
  HAVE_WITHOUT_SOURCE: "VALIDATION_FAILED",
  UNSELLABLE_OFFER: "VALIDATION_FAILED",
  ARI_PAGE_NOT_ALLOWED: "DOMAIN_ACTION_REFUSED",
  ARI_PAGE_DUPLICATE: "CONFLICT",
  QUESTION_NOT_FOUND: "VALIDATION_FAILED",
  PAGE_NOT_ARI_DRAFT: "VALIDATION_FAILED",
};

const executor = SITE_AGENT_TOOLS.find((item) => item.name === "propose_site_page")?.executor;

for (const code of ARI_PAGE_CODES) {
  Deno.test(`#4453 m11 ${code} from Core reaches Ari as Core's sentence, not an outage`, async () => {
    assert(executor);
    const core = ariFailureFrom({ error: { code, problems: ["one plain sentence"] } }, 409);
    const body = await core.clone().json();
    assertEquals(body.error.code, code);
    assertEquals(body.error.message, ARI_PAGE_MESSAGES[code]);
    const error = await assertRejects(
      () => executor({
        brand_id: BRAND, site_id: SITE, expected_site_revision: "a".repeat(64), request: REQUEST,
        page: { title: "Private hire", menu_label: "Private hire", slug: "private-hire" },
        blocks: [{ type: "page_header", variant: "neutral", heading: "Private hire" }], why: "The owner asked.", cites: CITES,
      }, coreClient(core), USER, { operationId: OP }),
      ToolError,
    );
    assertEquals(error.code, ENVELOPE[code], code);
    assert(error.message.startsWith(ARI_PAGE_MESSAGES[code]), `${code}: "${error.message}"`);
    assertNotEquals(error.message, GENERIC);
    assert(mapLegacyAriErrorCode(error.code).length > 0);
  });
}

Deno.test("#4453 m11 the owner's answers route is the content action ari_page_answer, behind the flag", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const studio: Array<Record<string, unknown>> = [];
  const ctx = (flagOn: boolean) => ({
    userId: USER,
    userRpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: { brand_id: BRAND, user_id: USER, rank: 20 }, error: null };
    },
    serviceRpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: fn === "brand_site_flag_on" ? flagOn : null, error: null };
    },
    callCmsRaw: async (args: { payload: Record<string, unknown> }) => {
      studio.push(args.payload);
      return { status: 200, body: { ok: true, data: { page_id: "p9", remaining_questions: 0 } } };
    },
    activeArtifactKey: async () => null,
    tripCovers: async () => ({}),
  });
  const path = `/v1/sites/${SITE}/pages/33333333-3333-4333-8333-333333333333/answers`;
  const input = { operation_id: OP, question_key: "ada_role", answer: "Head chef" };
  const off = await handleSiteContentRoute(path, "POST", input, ctx(false));
  assertEquals((await off!.json()).error.code, "ARI_ADD_PAGE_OFF");
  assertEquals(studio.length, 0);
  const on = await handleSiteContentRoute(path, "POST", input, ctx(true));
  assertEquals(on!.status, 200);
  assertEquals(studio[0]!.action, "ari_page_answer");
  assertEquals(studio[0]!.args, { page_id: "33333333-3333-4333-8333-333333333333", question_key: "ada_role", answer: "Head chef" });
  assert(calls.some((call) => call.fn === "brand_site_content_authorize" && call.args.p_action === "ari_page_answer"));
});
