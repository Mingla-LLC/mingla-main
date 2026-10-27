import { replyState } from "../localReplyState";

// #3872 walkthrough: the Local reply showed an editor even after publishing and
// gave no sign of the 24-hour edit window; failures showed raw server text.
const NOW = Date.parse("2026-10-26T12:00:00Z");
describe("Local review reply state", () => {
  it("starts with no reply", () => {
    expect(
      replyState(
        { reply: null, reply_at: null, reply_editable_until: null },
        NOW,
      ),
    ).toEqual({ kind: "none" });
  });
  it("is editable for 24 hours after publishing, with hours left", () => {
    expect(
      replyState(
        {
          reply: "Thanks!",
          reply_at: "2026-10-26T02:00:00Z",
          reply_editable_until: "2026-10-27T02:00:00Z",
        },
        NOW,
      ),
    ).toEqual({ kind: "editable", hoursLeft: 14 });
  });
  it("is final after the window closes", () => {
    expect(
      replyState(
        {
          reply: "Thanks!",
          reply_at: "2026-10-24T02:00:00Z",
          reply_editable_until: "2026-10-25T02:00:00Z",
        },
        NOW,
      ),
    ).toEqual({ kind: "locked" });
  });
});
