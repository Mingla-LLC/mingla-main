/*
 * #2829 W8 — when a brand's own domain becomes the main address (or the
 * Mingla subdomain takes over again after a disconnect or a 7-day drift
 * fallback), the NEXT publish must carry a canonical on the new main address:
 * the runtime only serves an artifact whose canonical is one of the site's own
 * addresses, and always presents the current primary. Core signs the site's
 * current main address into every publish; the publish handler moves the
 * tenant's copy to it BEFORE the artifact is built and probed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(process.cwd(), "src/endpoints/sitesEndpoints.ts"), "utf8");

function publishBody(): string {
  const start = source.indexOf("async function publish(req: PayloadRequest)");
  expect(start).toBeGreaterThan(0);
  const end = source.indexOf("\nasync function ", start + 10);
  return source.slice(start, end > 0 ? end : undefined);
}

describe("#2829 W8 the publish follows Core's main address", () => {
  it("updates the tenant's primary host from the signed body before building and probing", () => {
    const body = publishBody();
    const sync = body.indexOf("primaryHostnameFromCore(body.primary_hostname)");
    const update = body.indexOf("data: { primary_hostname: corePrimary }");
    const build = body.indexOf("buildPublicationArtifact(");
    const probe = body.indexOf("probePublicationCandidate(");
    expect(sync).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(sync);
    // The value comes from the verified Core envelope's body, read after the
    // signature check, never from a Studio session.
    expect(body.indexOf("verifyCoreRequest(")).toBeLessThan(sync);
    expect(build === -1 || build > update).toBe(true);
    expect(probe).toBeGreaterThan(update);
  });

  it("accepts only a hostname", async () => {
    const helperStart = source.indexOf("export function primaryHostnameFromCore");
    expect(helperStart).toBeGreaterThan(0);
    const helperSource = source.slice(helperStart, source.indexOf("\n}\n", helperStart) + 2)
      .replace("export function primaryHostnameFromCore(value: unknown): string | null", "return function (value)")
      .replace(/^/, "");
    const helper = new Function(helperSource.replace(/: unknown|: string \| null/g, ""))() as (value: unknown) => string | null;
    expect(helper("youngandstamped.com")).toBe("youngandstamped.com");
    expect(helper("www.brand.co.uk")).toBe("www.brand.co.uk");
    for (const bad of [null, "", "https://brand.com", "brand.com/x", "BRAND.COM", "a", 42, "brand.com."]) {
      expect(helper(bad)).toBeNull();
    }
  });
});
