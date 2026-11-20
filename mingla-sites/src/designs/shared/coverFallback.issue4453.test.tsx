/*
 * #4453 — an offering card with no usable cover (none, or a video cover the
 * feed cannot serve as a picture) showed an empty box on Gameland Lagos's live
 * site (Private Hire, Karaoke & Games Night). It now shows a designed face with
 * the title, decorative only, in every design; Pop draws it as a sticker, and
 * Pop draws a lone card (the next event) as a wide spotlight.
 */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Cover } from "./blocks/Offerings";

type CoverProps = Parameters<typeof Cover>[0];
const item = (card: Partial<CoverProps["item"]["card"]>) => ({ card: { id: "o1", title: "Karaoke & Games Night", coverUrl: null, coverSrcSet: null, detailHref: null, ...card } }) as unknown as CoverProps["item"];
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), "public/designs", file), "utf8");

describe("#4453 card cover fallback", () => {
  it("draws the title face, hidden from readers, when there is no cover", () => {
    const html = renderToStaticMarkup(<Cover item={item({})} face sizes="100vw" />);
    expect(html).toContain('class="mg-ph-none" aria-hidden="true"');
    expect(html).toContain("Karaoke &amp; Games Night");
    expect(html).not.toContain("<img");
  });

  it("draws nothing on layouts that did not ask for the face (Journal keeps no plate)", () => {
    expect(renderToStaticMarkup(<Cover item={item({})} sizes="100vw" />)).toBe("");
  });

  it("keeps the picture when there is one", () => {
    const html = renderToStaticMarkup(<Cover item={item({ coverUrl: "/om/abc/original" })} sizes="100vw" />);
    expect(html).toContain('<img src="/om/abc/original"');
    expect(html).not.toContain("mg-ph-none");
  });

  it("links the face to the detail page like a picture, out of the tab order", () => {
    const html = renderToStaticMarkup(<Cover item={item({ detailHref: "/events/karaoke" })} face sizes="100vw" />);
    expect(html).toMatch(/<a class="mg-to-detail-img" href="\/events\/karaoke" tabindex="-1" aria-hidden="true"><span class="mg-ph-none"/);
  });

  it("styles the face in the shared library and as a Pop sticker; Pop's lone card is a spotlight", () => {
    expect(read("_shared/blocks-2.css")).toMatch(/\.mg-ph-none \{ position: absolute; inset: 0;/);
    const pop = read("pop/1.css");
    expect(pop).toMatch(/\.mg-ph-none \{ background: var\(--c-highlight-200\);/);
    expect(pop).toMatch(/\.mg-ocards--c1 > \.mg-ocard \{ display: grid; grid-template-columns: minmax\(0, 5fr\) minmax\(0, 7fr\); \}/);
  });
});
