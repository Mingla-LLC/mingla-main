/**
 * #4304 — smoke test 2026-11-07 on the iOS simulator: opening the Brand group
 * Media panel crashed with "Cannot read property 'prototype' of undefined"
 * because Hermes on iOS has Intl but no Intl.PluralRules.
 */
import { pluralCategory } from "../index";

describe("#4304 plural category without Intl.PluralRules", () => {
  const original = Intl.PluralRules;

  afterEach(() => {
    (Intl as { PluralRules?: typeof Intl.PluralRules }).PluralRules = original;
  });

  test("uses Intl.PluralRules when the engine has it", () => {
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 3)).toBe("other");
  });

  test("falls back to one/other instead of throwing when PluralRules is missing", () => {
    (Intl as { PluralRules?: typeof Intl.PluralRules }).PluralRules = undefined;
    expect(() => pluralCategory("fr", 2)).not.toThrow();
    expect(pluralCategory("fr", 1)).toBe("one");
    expect(pluralCategory("fr", 0)).toBe("other");
    expect(pluralCategory("en", 12)).toBe("other");
  });
});
