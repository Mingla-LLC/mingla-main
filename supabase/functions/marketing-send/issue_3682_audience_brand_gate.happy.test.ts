/**
 * #3682 — audience brand must match campaign brand (happy).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertAudienceMatchesCampaignBrand,
  assertAudienceQueryMatchesCampaignBrand,
} from "../_shared/marketingAudienceBrandGate.ts";

Deno.test("#3682 matching audience brand passes", () => {
  const brandId = "36820000-0000-4000-8000-0000000000a1";
  assertAudienceMatchesCampaignBrand(brandId, brandId);
});

Deno.test("#3682 matching brand_buyers query brand passes", async () => {
  const brandId = "36820000-0000-4000-8000-0000000000a1";
  await assertAudienceQueryMatchesCampaignBrand(
    { from: () => {
      throw new Error("events lookup must not run for brand_buyers");
    } },
    { kind: "brand_buyers", brand_id: brandId },
    brandId,
  );
});

Deno.test("#3682 matching event_buyers live event brand passes", async () => {
  const brandId = "36820000-0000-4000-8000-0000000000a1";
  const eventId = "36820000-0000-4000-8000-0000000000e1";
  const supabase = {
    from: (table: string) => {
      assertEquals(table, "events");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: eventId, brand_id: brandId },
                error: null,
              }),
          }),
        }),
      };
    },
  };
  await assertAudienceQueryMatchesCampaignBrand(
    supabase,
    { kind: "event_buyers", event_id: eventId },
    brandId,
  );
});

Deno.test("#3682 gate is imported by marketing-send send paths", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertEquals(
    source.includes(
      'assertAudienceQueryMatchesCampaignBrand,',
    ),
    true,
  );
  // Both email and SMS dispatch call owner + query gates after audience load.
  const emailIdx = source.indexOf("async function sendEmail");
  const smsIdx = source.indexOf("async function sendSms");
  const ownerInEmail = source.indexOf(
    "assertAudienceMatchesCampaignBrand(audience.brand_id, campaign.brand_id)",
    emailIdx,
  );
  const queryInEmail = source.indexOf(
    "assertAudienceQueryMatchesCampaignBrand",
    emailIdx,
  );
  const ownerInSms = source.indexOf(
    "assertAudienceMatchesCampaignBrand(audience.brand_id, campaign.brand_id)",
    smsIdx,
  );
  const queryInSms = source.indexOf(
    "assertAudienceQueryMatchesCampaignBrand",
    smsIdx,
  );
  assertEquals(ownerInEmail > emailIdx && ownerInEmail < smsIdx, true);
  assertEquals(queryInEmail > emailIdx && queryInEmail < smsIdx, true);
  assertEquals(ownerInSms > smsIdx, true);
  assertEquals(queryInSms > smsIdx, true);
});
