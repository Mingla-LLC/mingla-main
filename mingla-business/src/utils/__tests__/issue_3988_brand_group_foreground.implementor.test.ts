import { describe, expect, test } from "@jest/globals";
import { shouldDisplayForegroundBusinessNotification } from "../brandGroupNotificationForeground";

describe("#3988 foreground Brand-group banners", () => {
  test("suppresses only the Brand group thread currently open", () => {
    const data = {
      type: "business.brand_group_message",
      conversation_id: "conversation-3988",
    };
    expect(
      shouldDisplayForegroundBusinessNotification(
        data,
        "/messages/conversation-3988",
      ),
    ).toBe(false);
    expect(
      shouldDisplayForegroundBusinessNotification(
        data,
        "/messages/conversation-3988/",
      ),
    ).toBe(false);
    expect(
      shouldDisplayForegroundBusinessNotification(
        data,
        "/messages/another-conversation",
      ),
    ).toBe(true);
    expect(
      shouldDisplayForegroundBusinessNotification(
        {
          type: "business.community_reply",
          conversation_id: "conversation-3988",
        },
        "/messages/conversation-3988",
      ),
    ).toBe(true);
    expect(
      shouldDisplayForegroundBusinessNotification(
        { type: "business.brand_group_message" },
        "/messages/conversation-3988",
      ),
    ).toBe(true);
  });
});
