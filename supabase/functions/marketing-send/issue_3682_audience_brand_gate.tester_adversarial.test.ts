/**
 * #3682 — audience brand must match campaign brand (adversarial).
 */
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AUDIENCE_BRAND_MISMATCH,
  assertAudienceMatchesCampaignBrand,
  assertAudienceQueryMatchesCampaignBrand,
} from "../_shared/marketingAudienceBrandGate.ts";

Deno.test("#3682 foreign audience brand throws audience_brand_mismatch", () => {
  assertThrows(
    () =>
      assertAudienceMatchesCampaignBrand(
        "36820000-0000-4000-8000-0000000000b2",
        "36820000-0000-4000-8000-0000000000a1",
      ),
    Error,
    AUDIENCE_BRAND_MISMATCH,
  );
});

Deno.test("#3682 null audience brand throws audience_brand_mismatch", () => {
  assertThrows(
    () =>
      assertAudienceMatchesCampaignBrand(
        null,
        "36820000-0000-4000-8000-0000000000a1",
      ),
    Error,
    AUDIENCE_BRAND_MISMATCH,
  );
});

Deno.test("#3682 empty audience brand throws audience_brand_mismatch", () => {
  assertThrows(
    () =>
      assertAudienceMatchesCampaignBrand(
        "",
        "36820000-0000-4000-8000-0000000000a1",
      ),
    Error,
    AUDIENCE_BRAND_MISMATCH,
  );
});

Deno.test(
  "#3682 brand_buyers query brand_id for another brand throws",
  async () => {
    await assertRejects(
      () =>
        assertAudienceQueryMatchesCampaignBrand(
          {},
          {
            kind: "brand_buyers",
            brand_id: "36820000-0000-4000-8000-0000000000b2",
          },
          "36820000-0000-4000-8000-0000000000a1",
        ),
      Error,
      AUDIENCE_BRAND_MISMATCH,
    );
  },
);

Deno.test(
  "#3682 event_buyers whose event belongs to another brand throws",
  async () => {
    const eventId = "36820000-0000-4000-8000-0000000000e1";
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: eventId,
                  brand_id: "36820000-0000-4000-8000-0000000000b2",
                },
                error: null,
              }),
          }),
        }),
      }),
    };
    await assertRejects(
      () =>
        assertAudienceQueryMatchesCampaignBrand(
          supabase,
          { kind: "event_buyers", event_id: eventId },
          "36820000-0000-4000-8000-0000000000a1",
        ),
      Error,
      AUDIENCE_BRAND_MISMATCH,
    );
  },
);

Deno.test("#3682 null query_definition throws audience_brand_mismatch", async () => {
  await assertRejects(
    () =>
      assertAudienceQueryMatchesCampaignBrand(
        {},
        null,
        "36820000-0000-4000-8000-0000000000a1",
      ),
    Error,
    AUDIENCE_BRAND_MISMATCH,
  );
});

Deno.test("#3682 gate module does not soft-return on mismatch", async () => {
  const source = await Deno.readTextFile(
    new URL("../_shared/marketingAudienceBrandGate.ts", import.meta.url),
  );
  assertEquals(source.includes("return false"), false);
  assertEquals(source.includes("throw new Error(AUDIENCE_BRAND_MISMATCH)"), true);
  assertEquals(source.includes("assertAudienceQueryMatchesCampaignBrand"), true);
});
