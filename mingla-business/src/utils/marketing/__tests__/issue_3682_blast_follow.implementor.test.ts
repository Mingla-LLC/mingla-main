/**
 * #3682 Wave 2.3 — client blast Follow URL + SMS append helpers.
 */

import { describe, expect, test } from "@jest/globals";

import {
  appendSmsFollowLine,
  brandFollowPublicUrl,
} from "../blastFollow";

describe("#3682 Wave 2.3 — blastFollow client helpers", () => {
  test("brandFollowPublicUrl deep-links with intent=follow", () => {
    expect(brandFollowPublicUrl("lantern-room")).toBe(
      "https://host.usemingla.com/b/lantern-room?intent=follow",
    );
  });

  test("appendSmsFollowLine adds Follow URL once", () => {
    const url = brandFollowPublicUrl("acme");
    const once = appendSmsFollowLine("Hello", "Acme", url);
    expect(once).toContain("Follow Acme:");
    expect(once).toContain(url);
    const twice = appendSmsFollowLine(once, "Acme", url);
    expect(twice).toBe(once);
  });
});
