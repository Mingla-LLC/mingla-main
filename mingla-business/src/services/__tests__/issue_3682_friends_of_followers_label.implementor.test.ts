/**
 * #3682 closeout — the extended ring reads "Friend of a follower." (#3774
 * "Friends of followers" wording) whether the server sends the legacy wire
 * label or the new one; anything else is still rejected as malformed.
 */
jest.mock("../supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));

import {
  FRIEND_OF_FOLLOWER_REASON_LABEL,
  parseBrandCircleReach,
} from "../brandCircleReachService";

const page = (reasonLabel: string) => ({
  schemaVersion: 1,
  state: "ready",
  snapshotVersion: 3,
  counts: { followers: 1, extended: 1, total: 2 },
  availability: {
    followers: { state: "ready", reason: null, refreshedAt: "2026-11-03T00:00:00Z", expiresAt: "2026-11-03T01:00:00Z" },
    extended: { state: "ready", reason: null, refreshedAt: "2026-11-03T00:00:00Z", expiresAt: "2026-11-03T01:00:00Z" },
  },
  rows: [
    { memberId: "a", ring: "follower", displayName: "Ada", avatarUrl: null, reasonCode: "follows_brand", reasonLabel: "Follows your brand." },
    { memberId: "b", ring: "extended", displayName: "Bola", avatarUrl: null, reasonCode: "extended_circle", reasonLabel },
  ],
  nextCursor: null,
});

describe("#3682 Friends of followers member label", () => {
  test("legacy server label is shown with the new wording", () => {
    const parsed = parseBrandCircleReach(page("In your extended circle."));
    expect(FRIEND_OF_FOLLOWER_REASON_LABEL).toBe("Friend of a follower.");
    expect(parsed.rows[1].reasonLabel).toBe("Friend of a follower.");
    expect(JSON.stringify(parsed)).not.toMatch(/extended circle/i);
    expect(parsed.rows[0].reasonLabel).toBe("Follows your brand.");
  });

  test("new server label is accepted as-is", () => {
    expect(parseBrandCircleReach(page("Friend of a follower.")).rows[1].reasonLabel)
      .toBe("Friend of a follower.");
  });

  test("an unknown label is still malformed", () => {
    expect(() => parseBrandCircleReach(page("Somebody you may know."))).toThrow();
  });
});
