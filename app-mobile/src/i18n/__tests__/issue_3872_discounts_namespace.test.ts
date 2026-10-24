import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const localesRoot = join(__dirname, "..", "locales");
const locales = readdirSync(localesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const flatten = (value: unknown, prefix = ""): string[] => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix.length === 0 ? key : `${prefix}.${key}`),
  );
};

describe("#3872 discounts i18n namespace", () => {
  test("all 29 locales contain the complete non-empty English key set", () => {
    expect(locales).toHaveLength(29);
    const english = JSON.parse(
      readFileSync(join(localesRoot, "en", "discounts.json"), "utf8"),
    ) as Record<string, unknown>;
    const keys = flatten(english).sort();
    expect(keys.length).toBeGreaterThan(10);

    for (const locale of locales) {
      const file = join(localesRoot, locale, "discounts.json");
      const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      expect(flatten(value).sort()).toEqual(keys);
      for (const key of keys) {
        const leaf = key.split(".").reduce<unknown>(
          (current, part) => (current as Record<string, unknown>)[part],
          value,
        );
        expect(typeof leaf === "string" && leaf.trim().length > 0).toBe(true);
      }
    }
  });
});
