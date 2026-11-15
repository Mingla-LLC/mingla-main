/**
 * #4420 round-3 item 12 — time zones never show as slugs in the event When
 * step. Fails when the label or the picker rows go back to raw zone ids.
 */
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(__dirname, "../CreatorStep2When.tsx"), "utf8");

const timezoneDisplayName = (tz: string): string => {
  const fn = source.match(/export const timezoneDisplayName = \(tz: string\): string => \{([\s\S]*?)\n\};/);
  if (fn === null) throw new Error("timezoneDisplayName is gone");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("tz", fn[1].replace(/: string/g, ""))(tz) as string;
};

describe("#4420 time zone names", () => {
  it("reads a city, not a slug", () => {
    expect(timezoneDisplayName("America/New_York")).toBe("New York");
    expect(timezoneDisplayName("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timezoneDisplayName("UTC")).toBe("UTC");
  });

  it("labels the field and the picker rows with the name, keeping the stored id searchable", () => {
    expect(source).toContain("const name = timezoneDisplayName(draft.timezone);");
    expect(source).toContain("{timezoneDisplayName(tz)}");
    expect(source).toContain("timezoneDisplayName(tz).toLowerCase().includes(q)");
    expect(source).not.toMatch(/>\s*\{tz\}\s*</);
  });
});
