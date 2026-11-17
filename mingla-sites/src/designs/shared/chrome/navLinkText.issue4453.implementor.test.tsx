/*
 * #4453 final rework — Lighthouse link-text (SEO 92 on Nocturne and Pop): an
 * owner's menu group titled "More" that links to a page is a link with no
 * meaning. The link keeps the owner's visible label and carries the page's
 * name (from the owner's own sub-menu) as visually hidden text; the footer's
 * Pages column does not repeat the group as its own "More" link.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { voyageSyntheticArtifact } from "../../../contracts/voyageSynthetic.fixture";
import { descriptiveSuffix, SharedFooter, SharedHeader } from "./SharedChrome";

const items = [
  { label: "Trips", href: "/trips" },
  { label: "Places", href: "/places" },
  { label: "More", href: "/about-us", children: [
    { label: "About us", href: "/about-us" },
    { label: "Contact", href: "/contact-us" },
  ] },
];

/** Every link's text as a reader (and Lighthouse's innerText) gets it. */
function linkTexts(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
}

describe("#4453 generic menu labels get the page's name", () => {
  it("names the page the link opens, from the owner's sub-menu, never invents one", () => {
    expect(descriptiveSuffix(items[2])).toBe("About us");
    // P3-1: the hidden name is the page the link opens (same href), never another child.
    expect(descriptiveSuffix({ label: "More", href: "/x", children: [{ label: "Team", href: "/team" }] })).toBeNull();
    expect(descriptiveSuffix({ label: "More", href: "/contact-us", children: [
      { label: "About us", href: "/about-us" },
      { label: "Contact", href: "/contact-us" },
    ] })).toBe("Contact");
    expect(descriptiveSuffix({ label: "More", href: "/x" })).toBeNull();
    expect(descriptiveSuffix({ label: "Trips", href: "/trips" })).toBeNull();
  });

  it.each(["glass", "center", "pill"] as const)("%s header: no link reads just \"More\"", (variant) => {
    const html = renderToStaticMarkup(<SharedHeader variant={variant} items={items} path="/" logo={null} siteName="Fixture" cta={null} place={undefined} />);
    const texts = linkTexts(html);
    expect(texts).toContain("More: About us");
    expect(texts.filter((text) => text.toLowerCase() === "more")).toEqual([]);
    // The visible label stays the owner's: the page name is visually hidden.
    expect(html).toContain('More<span class="mg-vh">: About us</span>');
  });

  it("footer Pages column does not repeat the group as a \"More\" link", () => {
    const artifact = voyageSyntheticArtifact();
    const html = renderToStaticMarkup(<SharedFooter variant="columns" artifact={{ ...artifact, footer: { ...artifact.footer, columns: [] } }} items={items} />);
    const texts = linkTexts(html);
    expect(texts.filter((text) => text.toLowerCase() === "more")).toEqual([]);
    expect(texts).toContain("About us");
  });
});
