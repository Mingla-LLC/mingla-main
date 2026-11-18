import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POP } from "../../contracts/generated/designs.ts";

/*
 * #4453 — Pop polish, found on Gameland Lagos's live site: 75 px section
 * headings, offering cards about 1,050 px tall (three phone screens each),
 * tilted cards that read as misaligned, and the bookable-times section 60 px
 * left of every other section. Guards the fixes in public/designs/pop/1.css.
 */
const css = fs.readFileSync(path.join(process.cwd(), "public/designs/pop/1.css"), "utf8");
const maxPx = (value: string) => Number(/,\s*([\d.]+)px\)\s*$/.exec(value.trim())?.[1]);
const lastVar = (name: string) => {
  const all = [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))];
  return all[all.length - 1]?.[1] ?? "";
};

describe("#4453 Pop polish", () => {
  it("stays on version 1: a bump would fail every published Pop site (artifact design version must match)", () => {
    expect(POP.version).toBe(1);
    expect(fs.existsSync(path.join(process.cwd(), "public/designs/pop/2.css"))).toBe(false);
  });

  it("keeps a calm type scale: section headings at most 60 px, the intro at most 32 px", () => {
    expect(maxPx(lastVar("--mg-h2-size"))).toBeLessThanOrEqual(60);
    expect(maxPx(lastVar("--mg-man-size"))).toBeLessThanOrEqual(32);
    expect(css).toMatch(/\.mg-nl-photo h2 \{ font-size: clamp\(34px, 4\.6vw, 68px\); \}/);
  });

  it("puts the bookable-times section on the same content edge as every other section", () => {
    expect(css).toMatch(/\.mg-slots \.mg-wrap \{ max-width: var\(--mg-max\); \}/);
  });

  it("keeps cards short and straight: a three-line blurb, no tilt, portrait cover untouched", () => {
    expect(css).toMatch(/\.mg-ocard__blurb \{[^}]*-webkit-line-clamp: 3;/);
    expect(css).toMatch(/\.mg-ocard:nth-child\(n\) \{ transform: none; \}/);
    const polish = css.slice(css.indexOf("polish (#4453"));
    expect(polish).not.toMatch(/\.mg-ocard \.mg-ph \{[^}]*aspect-ratio/);
  });

  it("turns two or more cards into a swipe row on phones", () => {
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*[^{]*\.mg-ocards:has\(> \.mg-ocard \+ \.mg-ocard\) \{ display: flex; overflow-x: auto; scroll-snap-type: x mandatory;/);
  });
});
