/*
 * #4453 milestone 5, tester (retest of P1-3). The availability section once
 * used `mg-avail`, a class the shared library already gave to the inline-flex
 * availability pill, so on Voyage the section grew to its rail and the phone
 * page scrolled sideways (1,336 px on a 375 px screen). Guard the cause, not
 * only the symptom: every booking section's own class (and its __parts) is
 * used by no other layout, and the shared stylesheet keeps each section a
 * block that cannot grow past its column.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..", "..");
const BOOKING = path.join(root, "src/designs/shared/blocks/Booking.tsx");
const CSS = fs.readFileSync(path.join(root, "public/designs/_shared/blocks-2.css"), "utf8");
const SECTIONS = ["mg-slots", "mg-tiers", "mg-steps"] as const;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && full !== BOOKING ? [full] : [];
  });
}

describe("#4453 M5 retest: booking section classes never clash with another layout's", () => {
  const booking = fs.readFileSync(BOOKING, "utf8");
  const others = sources(path.join(root, "src")).map((file) => [file, fs.readFileSync(file, "utf8")] as const);

  it.each(SECTIONS)("%s is the booking section's class", (cls) => {
    expect(booking).toMatch(new RegExp(`className=\\{?["\`]${cls}[\\s"\`]`));
  });

  it.each(SECTIONS)("no other layout uses %s or its parts", (cls) => {
    const clash = others.filter(([, text]) => new RegExp(`["'\` ]${cls}(?:__[a-z-]+)?["'\` ]`).test(text)).map(([file]) => path.relative(root, file));
    expect(clash).toEqual([]);
  });

  it.each(SECTIONS)("the shared stylesheet keeps %s a block that cannot outgrow its column", (cls) => {
    const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => selector.split(",").some((s) => s.trim().endsWith(`.${cls}`)));
    expect(rules.length).toBeGreaterThan(0);
    const display = rules.map(([, , body]) => /display:\s*([a-z-]+)/.exec(body)?.[1]).filter(Boolean);
    expect(display.at(-1)).toBe("block");
    expect(display.some((value) => /^inline/.test(value!))).toBe(false);
    expect(rules.some(([, , body]) => /min-width:\s*0/.test(body) && /max-width:\s*100%/.test(body))).toBe(true);
  });

  it("the old pill class is not on any booking section", () => {
    expect(booking).not.toMatch(/className=\{?["`][^"`]*\bmg-avail\b/);
  });
});
