/*
 * #4453 M8 tester — adversarial angle: what a client can still reach or see
 * AFTER withSharedView, beyond the implementor's nav/footer happy path.
 * Expected: nothing in the shared artifact points at a page the share removed.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));

import { voyageSyntheticArtifact } from "../contracts/voyageSynthetic.fixture";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { resolveSitePath } from "./pageRouting";
import { withSharedView } from "./sharedView";
import { SHARE_TOKEN } from "./shareLinks";

const TEAM_ID = `preview-${"c".repeat(32)}`;

function withDraftPage(): ArtifactV2 {
  const base = { ...voyageSyntheticArtifact(), publication_id: TEAM_ID } as ArtifactV2;
  const template = base.pages[1]!;
  return {
    ...base,
    pages: [...base.pages, { ...template, path: "private-hire", enabled: false }],
    navigation: {
      ...base.navigation,
      header_cta: { label: "Private hire", href: "/private-hire" },
      items: [...base.navigation.items, { label: "More", href: "/more", children: [{ label: "Private hire", href: "/private-hire?x=1#top" }] }],
    },
  } as ArtifactV2;
}

describe("#4453 M8 (tester) the shared view points at nothing it removed", () => {
  it("the removed page is not routable and not the header button's target", () => {
    const shared = withSharedView(withDraftPage());
    expect(resolveSitePath(shared, "private-hire").kind).toBe("not_found");
    expect(shared.navigation.header_cta?.href).not.toBe("/private-hire");
  });

  it("a menu child pointing at the removed page with a query or hash is dropped too", () => {
    const shared = withSharedView(withDraftPage());
    const hrefs = shared.navigation.items.flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)]);
    expect(hrefs.some((href) => href.startsWith("/private-hire"))).toBe(false);
  });

  it("share tokens: only 43 url-safe characters are looked up at all", () => {
    for (const bad of ["", "short", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}/`, `${"a".repeat(42)}%`, `${"a".repeat(41)}..`, "a".repeat(43) + "\n"]) {
      expect(SHARE_TOKEN.test(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(SHARE_TOKEN.test("a".repeat(43))).toBe(true);
  });
});

describe("#4453 M8 (tester, retest) a link inside rich text", () => {
  it("a rich-text link to a removed page is dropped; a link to a live page stays", () => {
    const base = withDraftPage();
    const home = base.pages[0]!;
    const richText = { type: "rich_text", body: [{ type: "paragraph", children: [
      { type: "text", text: "Ask about " },
      { type: "link", href: "/private-hire", children: [{ type: "text", text: "SECRET-DRAFT-PAGE" }] },
      { type: "link", href: "/trips", children: [{ type: "text", text: "our trips" }] },
    ] }] };
    const shared = withSharedView({ ...base, pages: [{ ...home, blocks: [...home.blocks, richText] }, ...base.pages.slice(1)] } as ArtifactV2);
    const text = JSON.stringify(shared.pages);
    expect(text).not.toContain("SECRET-DRAFT-PAGE");
    expect(text).not.toContain("/private-hire");
    expect(text).toContain("our trips");
  });
});
