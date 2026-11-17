// deno-lint-ignore-file require-await no-explicit-any -- fakes mirror async HTTP
/*
 * #4453 milestone 7c (tester P1-2) — every design-pass refusal Core sends
 * (brand-site-control's real ariFailureFrom) reaches Ari and the owner through
 * the real propose_site_design_pass executor as Core's plain sentence, never
 * as "Ari could not reach Website tools right now." DESIGN_PASS_TRY_AGAIN
 * rides the retryable envelope.
 */
import { assert, assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapLegacyAriErrorCode } from "../agentReliability.ts";
import { SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { ariFailureFrom } from "../../brand-site-control/siteAri.ts";

const BRAND = "733bc470-45e1-4684-8896-acd7e26074ff";
const SITE = "11111111-1111-4111-8111-111111111111";
const USER = "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
const OP = "22222222-2222-4222-8222-222222222222";
const CITES = [{ kind: "owner_words", quote: "We take ten people on every trip" }];
const GENERIC = "Ari could not reach Website tools right now.";

function coreClient(response: Response) {
  return {
    functions: {
      invoke: async () => ({ data: null, error: { name: "FunctionsHttpError", context: response.clone() } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: SITE }], error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  } as any;
}

const CASES: Array<{ code: string; status: number; envelope: string; ariCode: string }> = [
  { code: "DESIGN_PASS_TRY_AGAIN", status: 503, envelope: "SERVICE_TEMPORARILY_UNAVAILABLE", ariCode: "DEPENDENCY_UNAVAILABLE" },
  { code: "DESIGN_PASS_ALREADY_RUN", status: 409, envelope: "CONFLICT", ariCode: "CONFLICT" },
  { code: "DESIGN_PASS_OFF", status: 409, envelope: "DOMAIN_ACTION_REFUSED", ariCode: "DOMAIN_ACTION_REFUSED" },
  { code: "STYLE_DOES_NOT_FIT", status: 409, envelope: "VALIDATION_FAILED", ariCode: "VALIDATION_FAILED" },
];

const executor = SITE_AGENT_TOOLS.find((item) => item.name === "propose_site_design_pass")?.executor;

for (const { code, status, envelope, ariCode } of CASES) {
  Deno.test(`#4453 m7c ${code} from Core reaches Ari as Core's sentence, not an outage`, async () => {
    assert(executor, "propose_site_design_pass is not registered");
    const core = ariFailureFrom({ error: { code } }, status);
    const coreBody = await core.clone().json();
    assertEquals(coreBody.error.code, code);
    const sentence = String(coreBody.error.message);
    assert(sentence.length > 0 && sentence !== GENERIC);
    const error = await assertRejects(
      () => executor({ brand_id: BRAND, site_id: SITE, design_key: "terra", why: "It fits.", cites: CITES }, coreClient(core), USER, { operationId: OP }),
      ToolError,
    );
    assertEquals(error.code, envelope);
    assertEquals(error.message.startsWith(sentence), true, `${code}: "${error.message}"`);
    assertNotEquals(error.message, GENERIC);
    assertEquals(mapLegacyAriErrorCode(error.code), ariCode);
  });
}

Deno.test("#4453 m7c BOOKING_THROUGH_ENQUIRY from Core reaches Ari as Core's sentence", async () => {
  assert(executor);
  const core = ariFailureFrom({ error: { code: "BOOKING_THROUGH_ENQUIRY" } }, 409);
  const sentence = String((await core.clone().json()).error.message);
  const error = await assertRejects(
    () => executor({ brand_id: BRAND, site_id: SITE, design_key: "terra", why: "It fits.", cites: CITES }, coreClient(core), USER, { operationId: OP }),
    ToolError,
  );
  assertEquals(error.code, "VALIDATION_FAILED");
  assert(error.message.startsWith(sentence));
});
