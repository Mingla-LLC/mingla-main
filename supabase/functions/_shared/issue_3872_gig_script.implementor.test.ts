import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "./agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "./agentToolAuthorization.ts";
import { validateGigScript } from "./gigScript.ts";
const good = {
  sections: [{
    on_screen: "Dinner from ₦25,000",
    voiceover: "A real first-timer reaction #ad",
    shot_notes: "Show the entrance",
  }],
  disclosure: "#ad",
  estimated_seconds: 25,
};
Deno.test("#3872 Ari script requires disclosure and format length", () => {
  assert(
    validateGigScript({
      script: good,
      lengthMin: 20,
      lengthMax: 30,
      displayPrice: "₦25,000",
      listingFacts: ["Dinner from ₦25,000"],
    }).ok,
  );
  const bad = validateGigScript({
    script: {
      ...good,
      disclosure: "",
      sections: [{ ...good.sections[0], voiceover: "A reaction" }],
      estimated_seconds: 40,
    },
    lengthMin: 20,
    lengthMax: 30,
    displayPrice: "₦25,000",
    listingFacts: [],
  });
  assertEquals(bad, {
    ok: false,
    reasons: ["disclosure_required", "length_out_of_format"],
  });
});
Deno.test("#3872 Ari script rejects invented prices and guarantees", () => {
  const result = validateGigScript({
    script: {
      ...good,
      sections: [{
        on_screen: "Guaranteed fun for $10 #ad",
        voiceover: "Guaranteed",
        shot_notes: "Show it",
      }],
    },
    lengthMin: 20,
    lengthMax: 30,
    displayPrice: "₦25,000",
    listingFacts: ["Dinner from ₦25,000"],
  });
  assertEquals(result, {
    ok: false,
    reasons: ["price_not_server_fact", "unsupported_claim"],
  });
});
Deno.test("#3872 Ari exposes one server-side read-only draft tool with brand authorization", () => {
  assert(DOMAIN_TOOLS.some((tool) => tool.name === "draft_gig_script"));
  assert(DOMAIN_READ_ONLY.has("draft_gig_script"));
  assertEquals(AGENT_TOOL_AUTHORIZATION.draft_gig_script, {
    requiredRole: "marketing_manager",
    resource: "brand",
  });
});
