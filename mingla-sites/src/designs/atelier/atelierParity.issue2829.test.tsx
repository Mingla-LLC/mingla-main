/*
 * #2829 W3 exit 1 (markup half) — gögi rebuilt from tokens draws the SAME
 * page. Every page of the gögi-shaped fixture, rendered by the v1 renderer
 * and by atelier from upgradeV1ToV2, produces identical markup apart from the
 * v1 theme <style> (atelier's colours arrive as tokens instead). The
 * screenshot diff on the local stack is the visual half.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestaurantV1 } from "../../components/RestaurantV1";
import { upgradeV1ToV2 } from "../../contracts/generated/upgradeV1ToV2.ts";
import { gogiV1Fixture } from "../../contracts/gogiV1.fixture";
import { sitePages } from "../../lib/pageRouting";
import { AtelierPage } from "./AtelierPage";

const withoutTheme = (html: string) => html.replace(/<style data-site-theme="1">[^<]*<\/style>/, "");
// React's useId values depend on tree position (v1 renders a theme element
// first); the ids are paired correctly within each document either way.
const ids = (html: string) => html.replace(/_R_[A-Za-z0-9]+_/g, "_ID_");

describe("#2829 atelier reproduces the v1 markup", () => {
  const v1 = gogiV1Fixture();
  const v2 = upgradeV1ToV2(v1);
  const v1Pages = sitePages(v1);
  const v2Pages = sitePages(v2);

  it("has the same pages", () => {
    expect(v2Pages.map((page) => page.path)).toEqual(v1Pages.map((page) => page.path));
  });

  for (const page of sitePages(gogiV1Fixture())) {
    it(`/${page.path} is identical`, () => {
      const before = withoutTheme(renderToStaticMarkup(<RestaurantV1 artifact={v1} page={v1Pages.find((p) => p.path === page.path)} />));
      const after = renderToStaticMarkup(<AtelierPage artifact={v2} page={v2Pages.find((p) => p.path === page.path)} />);
      expect(ids(after)).toBe(ids(before));
    });
  }

  it("rich text with headings and lists renders as elements, never as HTML strings", () => {
    const rich = upgradeV1ToV2(gogiV1Fixture());
    const block = rich.pages[0]!.blocks.find((b) => b.type === "rich_text") as Record<string, unknown>;
    block.body = {
      type: "doc",
      children: [
        { type: "heading", level: 3, children: [{ type: "text", text: "Hours" }] },
        { type: "list", ordered: false, items: [{ type: "list_item", children: [{ type: "text", text: "<b>late</b>", marks: ["bold"] }] }] },
        { type: "paragraph", children: [{ type: "link", href: "https://example.com", children: [{ type: "text", text: "Map" }] }] },
      ],
    };
    const html = renderToStaticMarkup(<AtelierPage artifact={rich} page={sitePages(rich)[0]} />);
    expect(html).toContain("<h3>Hours</h3>");
    expect(html).toContain("<ul><li><strong>&lt;b&gt;late&lt;/b&gt;</strong></li></ul>");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Map<span class="sr-only"> (opens in a new tab)</span></a>');
  });
});
