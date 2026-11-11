/**
 * #4389 AB — per-brand drafts (AR-14), the switch-while-answering rule (R-16),
 * the analytics name and the brand-bound confirmation (AR-13).
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

import {
  ariDraftFor,
  decideAriBrandSwitch,
  stashAriDraft,
} from "../ariBrandSwitch";
import { ARI_BRAND_BAR_COPY } from "../../../components/ari/ariBrandBarCopy";
import { BRAND_SETUP_EVENTS } from "../../../components/brand/brandSetupAnalytics";

describe("#4389 AR-14 drafts per brand", () => {
  test("a draft is kept for the brand it was typed in and comes back", () => {
    let d = stashAriDraft({}, "a", "Draft a post for Saturday");
    expect(ariDraftFor(d, "b")).toBe("");
    d = stashAriDraft(d, "b", "Sales today?");
    expect(ariDraftFor(d, "a")).toBe("Draft a post for Saturday");
    expect(ariDraftFor(d, "b")).toBe("Sales today?");
  });
  test("an empty draft clears the entry; no brand has its own slot", () => {
    let d = stashAriDraft({}, "a", "x");
    d = stashAriDraft(d, "a", "   ");
    expect(d).toEqual({});
    d = stashAriDraft(d, null, "first run words");
    expect(ariDraftFor(d, null)).toBe("first run words");
  });
  test("the screen stashes instead of clearing on a brand change", () => {
    const src = fs.readFileSync(path.join(__dirname, "../AriChatScreen.tsx"), "utf8");
    const at = src.indexOf("const leftBrandId = previousBrandId.current;");
    expect(at).toBeGreaterThan(0);
    const effect = src.slice(at, src.indexOf("Keyboard.dismiss();", at));
    expect(effect).toContain("stashAriDraft(");
    expect(effect).toContain("setDraftText(ariDraftFor(");
    expect(effect).not.toContain('setDraftText("")');
  });
});

describe("#4389 R-16 switching while Ari answers", () => {
  test("same brand is a no-op; idle applies; answering asks first", () => {
    expect(decideAriBrandSwitch({ currentBrandId: "a", nextBrandId: "a", answering: true })).toBe("noop");
    expect(decideAriBrandSwitch({ currentBrandId: "a", nextBrandId: "b", answering: false })).toBe("apply");
    expect(decideAriBrandSwitch({ currentBrandId: "a", nextBrandId: "b", answering: true })).toBe("confirm");
    expect(decideAriBrandSwitch({ currentBrandId: null, nextBrandId: "b", answering: true })).toBe("confirm");
  });
  test("the question uses the approved words", () => {
    expect(ARI_BRAND_BAR_COPY.busyTitle).toBe("Ari is still answering");
    expect(ARI_BRAND_BAR_COPY.busyBody("Lantern Room", "Moonlight Supper Club")).toBe(
      "Switch to Lantern Room anyway? The answer will finish in Moonlight Supper Club's chat.",
    );
    expect(ARI_BRAND_BAR_COPY.switcherTitle).toBe("Talk to Ari about");
  });
  test("ari_brand_switched is a registered event and fires with while_streaming", () => {
    expect(BRAND_SETUP_EVENTS).toContain("ari_brand_switched");
    const src = fs.readFileSync(path.join(__dirname, "../AriChatScreen.tsx"), "utf8");
    expect(src).toContain("while_streaming: true");
    expect(src).toContain("while_streaming: false");
  });
});

describe("#4389 AR-13 confirmation bound to its brand", () => {
  test("the confirm hook sends brand_id; the server compares it with the conversation's brand", () => {
    const hook = fs.readFileSync(
      path.join(__dirname, "../../../hooks/useConfirmPendingAction.ts"),
      "utf8",
    );
    expect(hook).toContain("...(brandId ? { brand_id: brandId } : {})");
    const edge = fs.readFileSync(
      path.join(__dirname, "../../../../../supabase/functions/agent-confirm-action/index.ts"),
      "utf8",
    );
    expect(edge).toContain("pending.related_brand_id ?? conversationTask?.row.brand_id ?? null");
  });
});
