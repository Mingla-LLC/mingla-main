/**
 * #3682 — audience brand must match campaign brand (happy).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertAudienceMatchesCampaignBrand } from "../_shared/marketingAudienceBrandGate.ts";

Deno.test("#3682 matching audience brand passes", () => {
  const brandId = "36820000-0000-4000-8000-0000000000a1";
  assertAudienceMatchesCampaignBrand(brandId, brandId);
});

Deno.test("#3682 gate is imported by marketing-send send paths", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertEquals(
    source.includes(
      'import { assertAudienceMatchesCampaignBrand } from "../_shared/marketingAudienceBrandGate.ts"',
    ),
    true,
  );
  // Both email and SMS dispatch call the gate after audience load.
  const emailIdx = source.indexOf("async function sendEmail");
  const smsIdx = source.indexOf("async function sendSms");
  const gateInEmail = source.indexOf(
    "assertAudienceMatchesCampaignBrand(audience.brand_id, campaign.brand_id)",
    emailIdx,
  );
  const gateInSms = source.indexOf(
    "assertAudienceMatchesCampaignBrand(audience.brand_id, campaign.brand_id)",
    smsIdx,
  );
  assertEquals(gateInEmail > emailIdx && gateInEmail < smsIdx, true);
  assertEquals(gateInSms > smsIdx, true);
});
