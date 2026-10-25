import { brandGroupMediaKeys } from "../brandGroupMediaKeys";

describe("#3988 brand-group media query isolation", () => {
  it("scopes every list to conversation, kind, and authenticated user", () => {
    expect(brandGroupMediaKeys.list("conversation-a", "media", "user-1")).toEqual([
      "brandGroupMedia", "list", "conversation-a", "media", "user-1",
    ]);
    expect(brandGroupMediaKeys.list("conversation-a", "files", "user-1"))
      .not.toEqual(brandGroupMediaKeys.list("conversation-a", "media", "user-1"));
    expect(brandGroupMediaKeys.list("conversation-a", "media", "user-2"))
      .not.toEqual(brandGroupMediaKeys.list("conversation-a", "media", "user-1"));
  });

  it("makes metadata keys order-independent without crossing conversations", () => {
    expect(brandGroupMediaKeys.meta("conversation-a", ["file-b", "file-a"], "user-1"))
      .toEqual(brandGroupMediaKeys.meta("conversation-a", ["file-a", "file-b"], "user-1"));
    expect(brandGroupMediaKeys.meta("conversation-b", ["file-a", "file-b"], "user-1"))
      .not.toEqual(brandGroupMediaKeys.meta("conversation-a", ["file-a", "file-b"], "user-1"));
  });
});
