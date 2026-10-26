import fs from "node:fs";
import path from "node:path";

import {
  brandGroupMentionTarget,
  insertBrandGroupMention,
  retainedBrandGroupMentions,
} from "../brandGroupMentions";

const ROOT = path.resolve(__dirname, "../../..");

describe("#3988 Brand group composer and mentions", () => {
  test("finds the active token and inserts a selected teammate without losing following text", () => {
    const value = "Hello @am tomorrow";
    const target = brandGroupMentionTarget(value, "Hello @am".length);
    expect(target).toEqual({ start: 6, end: 9, query: "am" });

    const inserted = insertBrandGroupMention(value, target!, {
      user_id: "user-1",
      display_name: "  Amina   Bello ",
      username: "amina",
    });
    expect(inserted.value).toBe("Hello @Amina Bello  tomorrow");
    expect(inserted.caret).toBe("Hello @Amina Bello ".length);
    expect(inserted.mention).toEqual({ userId: "user-1", displayName: "Amina Bello" });
  });

  test("does not reopen autocomplete after a completed name and drops deleted recipients", () => {
    expect(brandGroupMentionTarget("Thanks @Amina Bello for this", 19)).toBeNull();
    expect(retainedBrandGroupMentions("Thanks everyone", [
      { userId: "user-1", displayName: "Amina Bello" },
    ])).toEqual([]);
    expect(retainedBrandGroupMentions("Thanks @Amina Belloza", [
      { userId: "user-1", displayName: "Amina Bello" },
    ])).toEqual([]);
    expect(retainedBrandGroupMentions("Thanks @Amina Bello, please confirm", [
      { userId: "user-1", displayName: "Amina Bello" },
    ])).toHaveLength(1);
  });

  test("route uses the sanctioned native lift and visible web viewport, and sends validated IDs", () => {
    const route = fs.readFileSync(path.join(ROOT, "app/messages/[conversationId].tsx"), "utf8");
    expect(route).toContain('from "../../src/wrappers/SmartKeyboardAvoidingView"');
    expect(route).toContain('keyboardVerticalOffset={DONE_BAR_OCCUPIED}');
    expect(route).toContain("liftedBottomSpacer(");
    expect(route).toContain('Platform.OS === "web" && windowHeight > 0');
    expect(route).toContain('keyboardShouldPersistTaps="handled"');
    expect(route).toContain("listBrandGroupMentionCandidates");
    expect(route).toContain("mentionedUserIds: selectedMentions.map");
  });
});
