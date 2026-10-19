/**
 * #3040 T-A14 [A-14, C-5..C-9] — Host Ads and Ari ad videos ride the
 * `ad_creative` lane target with a stable owner key, and the client-side
 * creative recorder is gone (the server creates the row from the READY job).
 *
 * MINGLA-INVARIANT: I-CREATIVE-FROM-JOB-ONLY | issue #3697 | video creatives are created only from a READY lane job
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import { adCreativeCoverTarget } from "../../../../../src/components/ui/coverTarget";
import {
  ariAdOwnerKey,
  hostAdOwnerKey,
  isValidAdCreativeOwnerKey,
} from "../../../../../src/services/eventCoverVideoEdgeContract";

const businessRoot = join(__dirname, "..", "..", "..", "..", "..");

describe("#3040 T-A14 — ad videos on the ad_creative target", () => {
  test("Host Ads builds an ad_creative target keyed host-ad:<draftId>", () => {
    expect(adCreativeCoverTarget("brand-1", hostAdOwnerKey("draft-123"))).toEqual({
      kind: "ad_creative",
      brandId: "brand-1",
      ownerKey: "host-ad:draft-123",
    });
  });

  test("the Ari owner key derives from the persisted proposal id, identically across mounts", () => {
    const first = ariAdOwnerKey("7d2b6a52-0f6a-4b9c-9a51-4f2b0b0b1c11");
    const second = ariAdOwnerKey("7d2b6a52-0f6a-4b9c-9a51-4f2b0b0b1c11");
    expect(first).toBe(second);
    expect(first).toBe("ari:7d2b6a52-0f6a-4b9c-9a51-4f2b0b0b1c11");
    expect(adCreativeCoverTarget("brand-1", first).kind).toBe("ad_creative");
  });

  test("owner keys follow the edge grammar; the old random per-mount key does not", () => {
    expect(isValidAdCreativeOwnerKey(hostAdOwnerKey("draft-123"))).toBe(true);
    expect(isValidAdCreativeOwnerKey(ariAdOwnerKey("p_123"))).toBe(true);
    expect(isValidAdCreativeOwnerKey("ari-ad-random")).toBe(false);
    expect(isValidAdCreativeOwnerKey("host-ad:x")).toBe(false);
  });

  test("the client-side creative recorder (recordHostAdVideo) is deleted", () => {
    expect(existsSync(join(businessRoot, "src/services/ariAdCreativeService.ts"))).toBe(false);
  });
});
