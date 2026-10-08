/**
 * #3682 — audience brand must match campaign brand (adversarial).
 */
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AUDIENCE_BRAND_MISMATCH,
  assertAudienceMatchesCampaignBrand,
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

Deno.test("#3682 gate module does not soft-return on mismatch", async () => {
  const source = await Deno.readTextFile(
    new URL("../_shared/marketingAudienceBrandGate.ts", import.meta.url),
  );
  assertEquals(source.includes("return false"), false);
  assertEquals(source.includes("throw new Error(AUDIENCE_BRAND_MISMATCH)"), true);
});
