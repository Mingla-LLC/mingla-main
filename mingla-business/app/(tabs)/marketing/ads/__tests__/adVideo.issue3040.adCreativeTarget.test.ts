/**
 * #3040 T-A14 [A-14, C-5..C-9] — Host Ads and Ari ad videos ride the
 * `ad_creative` lane target; processing never disables the sheet; the
 * creative id comes from the server; the Ari owner key is stable.
 *
 * MINGLA-INVARIANT: I-CREATIVE-FROM-JOB-ONLY | issue #3697 | video creatives are created only from a READY lane job
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  ariAdOwnerKey,
  hostAdOwnerKey,
  isValidAdCreativeOwnerKey,
} from "../../../../../src/services/eventCoverVideoEdgeContract";

const businessRoot = join(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(businessRoot, rel), "utf8");

describe("#3040 T-A14 — ad videos on the ad_creative target", () => {
  const route = read("app/(tabs)/marketing/ads/create.tsx");
  const card = read("src/components/ari/ToolProposalCard.tsx");

  test("processing no longer feeds the sheet's disabled flag", () => {
    expect(route).not.toContain("onCoverVideoProcessingChange={setAdVideoRecording}");
    expect(route).not.toMatch(/disabled=\{adVideoRecording\}/);
    expect(route).not.toContain("adVideoRecording");
  });

  test("both surfaces target ad_creative with the server-created creative id", () => {
    expect(route).toContain('kind: "ad_creative"');
    expect(route).toContain("ownerKey: hostAdOwnerKey(draftIdRef.current");
    expect(route).toContain("patch.adCreativeId");
    expect(card).toContain('kind: "ad_creative"');
    expect(card).toContain("patch.adCreativeId");
  });

  test("recordHostAdVideo is gone", () => {
    expect(existsSync(join(businessRoot, "src/services/ariAdCreativeService.ts"))).toBe(false);
    expect(route).not.toContain("recordHostAdVideo(");
    expect(card).not.toContain("recordHostAdVideo");
    expect(card).not.toContain("ari-ad-${randomId()}");
  });

  test("the Ari owner key derives from the persisted proposal id, identically across mounts", () => {
    const first = ariAdOwnerKey("7d2b6a52-0f6a-4b9c-9a51-4f2b0b0b1c11");
    const second = ariAdOwnerKey("7d2b6a52-0f6a-4b9c-9a51-4f2b0b0b1c11");
    expect(first).toBe(second);
    expect(first).toBe("ari:7d2b6a52-0f6a-4b9c-9a51-4f2b0b0b1c11");
    expect(isValidAdCreativeOwnerKey(first)).toBe(true);
    expect(isValidAdCreativeOwnerKey(hostAdOwnerKey("draft-123"))).toBe(true);
    expect(isValidAdCreativeOwnerKey("ari-ad-random")).toBe(false);
    expect(card).toContain("proposalId?: string | null;");
    expect(read("src/components/ari/MessageList.tsx")).toContain("proposalId={item.pendingAction.pending_action_id}");
  });

  test("the infrastructure helper text is gone", () => {
    expect(route).not.toContain("canonical Bunny-backed video");
    expect(route).not.toContain("Bunny master ready");
  });
});
