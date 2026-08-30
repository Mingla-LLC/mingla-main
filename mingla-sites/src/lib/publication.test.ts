import { describe, expect, it } from "vitest";
import { normalizePublicHost } from "./publication";

describe("exact public host", () => {
  it("accepts only the Gogi permanent host", () => {
    expect(normalizePublicHost("GOGI.SITES.USEMINGLA.COM")).toBe("gogi.sites.usemingla.com");
    for (const host of ["other.sites.usemingla.com", "gogi.sites.usemingla.com.", "gogi.sites.usemingla.com:443", "gogi.sites.usemingla.com.evil.test"]) expect(() => normalizePublicHost(host)).toThrow("NOT_FOUND");
  });
});
