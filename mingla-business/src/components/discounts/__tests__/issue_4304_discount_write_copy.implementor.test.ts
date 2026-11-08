/**
 * #4304 — the manual discount editor words every writer refusal in plain
 * English from the one shared source Ari also reads
 * (packages/offering-rendering/discountWriteRefusalCopy.ts).
 */
import fs from "fs";
import path from "path";
import {
  DISCOUNT_WRITE_FALLBACK_HOST_COPY,
  DISCOUNT_WRITE_REFUSAL_COPY,
  DISCOUNT_WRITE_REFUSALS,
  discountWriteHostCopy,
} from "@mingla/offering-rendering/discountWriteRefusalCopy";

const NEW_DETAILS = [
  "target_shape_invalid",
  "code_shape_invalid",
  "value_shape_invalid",
  "currency_missing",
  "name_invalid",
  "schedule_invalid",
  "code_taken",
  "invalid_input",
] as const;

describe("#4304 discount write refusal copy", () => {
  test.each(NEW_DETAILS)("%s has plain host copy", (detail) => {
    const copy = discountWriteHostCopy(detail);
    expect(copy).not.toBe(DISCOUNT_WRITE_FALLBACK_HOST_COPY);
    expect(copy).not.toMatch(/[a-z]+_[a-z]+/);
    expect(copy.length).toBeGreaterThan(10);
  });

  test("unknown details fall back to the generic sentence", () => {
    expect(discountWriteHostCopy("internal")).toBe(
      DISCOUNT_WRITE_FALLBACK_HOST_COPY,
    );
    expect(discountWriteHostCopy(undefined)).toBe(
      DISCOUNT_WRITE_FALLBACK_HOST_COPY,
    );
    expect(discountWriteHostCopy("toString")).toBe(
      DISCOUNT_WRITE_FALLBACK_HOST_COPY,
    );
  });

  test("Ari and the editor word the same set of refusals", () => {
    expect(Object.keys(DISCOUNT_WRITE_REFUSAL_COPY).sort()).toEqual(
      Object.keys(DISCOUNT_WRITE_REFUSALS).sort(),
    );
    for (const copy of Object.values(DISCOUNT_WRITE_REFUSAL_COPY)) {
      expect(copy.endsWith("Nothing was saved.")).toBe(true);
    }
  });

  test("the editor reads the shared copy, with no private wording chain", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../DiscountEditSheet.tsx"),
      "utf8",
    );
    expect(source).toContain("setError(discountWriteHostCopy(detail))");
    expect(source).not.toContain('detail === "code_taken"');
  });
});
