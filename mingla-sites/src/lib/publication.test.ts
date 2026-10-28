import { describe, expect, it } from "vitest";
import { normalizePublicHost } from "./publication";

// #2829 — converted: the runtime serves EVERY brand's `<label>.<suffix>`
// host; which ones are live is Core's answer. The shape rules still hold.
describe("public host shape", () => {
  it("accepts any brand's subdomain and refuses everything else", () => {
    expect(normalizePublicHost("GOGI.SITES.USEMINGLA.COM")).toBe("gogi.sites.usemingla.com");
    expect(normalizePublicHost("young-stamped.sites.usemingla.com")).toBe("young-stamped.sites.usemingla.com");
    for (const host of [
      "gogi.sites.usemingla.com.",
      "gogi.sites.usemingla.com:443",
      "gogi.sites.usemingla.com.evil.test",
      "a.b.sites.usemingla.com",
      "sites.usemingla.com",
      "-bad.sites.usemingla.com",
      "evil.example.com",
    ]) expect(() => normalizePublicHost(host)).toThrow("NOT_FOUND");
  });

  it("a local scope accepts its own suffix, strips the dev port, and nothing else", () => {
    const local = { suffix: "sites.localhost", extraHosts: ["custom.test"], allowPort: true };
    expect(normalizePublicHost("gogi-fixture.sites.localhost:3100", local)).toBe("gogi-fixture.sites.localhost");
    expect(normalizePublicHost("custom.test:3100", local)).toBe("custom.test");
    expect(() => normalizePublicHost("gogi.sites.usemingla.com", local)).toThrow("NOT_FOUND");
  });
});
