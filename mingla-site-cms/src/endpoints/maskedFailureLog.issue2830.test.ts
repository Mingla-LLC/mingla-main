import { afterEach, describe, expect, it, vi } from "vitest";
import { maskedFailureLine } from "./sitesEndpoints";

describe("#2830 a masked 503 says why in the logs, and only there", () => {
  afterEach(() => vi.restoreAllMocks());

  it("carries the class and the database's own words", () => {
    const line = JSON.parse(maskedFailureLine(Object.assign(new Error('column "generate_slug" does not exist'), { name: "DatabaseError" })));
    expect(line).toEqual({ event: "sites_masked_failure", error_class: "DatabaseError", message: 'column "generate_slug" does not exist' });
  });

  it("cuts secrets and request data", () => {
    const line = maskedFailureLine(new Error(
      "connect failed " + ["postgresql:", "//user:hunter2@db.example:5432/postgres"].join("") + " token eyJabc.def.ghi for a@b.co Key (slug)=(private) value 'my secret words' " + "a".repeat(40),
    ));
    expect(line).not.toMatch(/hunter2|eyJabc|a@b\.co|private|my secret words|aaaaaaaa/);
    expect(line).toContain("[url]");
  });

  it("a thrown non-Error is still one safe line, and the length is bounded", () => {
    expect(JSON.parse(maskedFailureLine("boom")).error_class).toBe("string");
    expect(JSON.parse(maskedFailureLine(new Error("x".repeat(5000)))).message.length).toBeLessThanOrEqual(300);
  });
});
