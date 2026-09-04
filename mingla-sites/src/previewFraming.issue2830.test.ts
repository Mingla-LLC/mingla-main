import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp } from "./lib/csp";
import { MINGLA_BUSINESS_ORIGIN } from "./lib/origins";

/**
 * #2830 -- exactly ONE route may be framed, and the public site must not be.
 * Relaxing frame-ancestors across the runtime to get a preview pane would make
 * every published customer site clickjackable. That is the failure this pins.
 */
const configSource = fs.readFileSync(
  path.resolve(process.cwd(), "next.config.ts"),
  "utf8",
);

/*
 * The HTML policy moved out of next.config and into the per-request proxy when
 * it gained a nonce, so these assertions now read the one builder both use.
 */
async function policies() {
  const nonce = "test-nonce";
  return {
    publicCsp: buildCsp({ nonce, pathname: "/" }),
    previewCsp: buildCsp({ nonce, pathname: "/preview" }),
  };
}

async function configHeaders() {
  const mod = await import("../next.config");
  return await (mod.default.headers as () => Promise<
    { source: string; headers: { key: string; value: string }[] }[]
  >)();
}

describe("#2830 preview framing is scoped to one route", () => {
  it("every public page still refuses to be framed", async () => {
    const { publicCsp } = await policies();
    expect(publicCsp).toContain("frame-ancestors 'none'");
  });

  it("only /preview is framable, and only by Business web", async () => {
    const { previewCsp } = await policies();
    expect(previewCsp).toContain(
      `frame-ancestors 'self' ${MINGLA_BUSINESS_ORIGIN}`,
    );
    expect(previewCsp).not.toContain("frame-ancestors 'none'");
    expect(previewCsp).not.toContain("*");
  });

  it("the two policies differ in frame-ancestors and NOTHING else", async () => {
    const { publicCsp, previewCsp } = await policies();
    const strip = (value: string) =>
      value.replace(/frame-ancestors[^;]*;/, "frame-ancestors X;");
    expect(strip(previewCsp)).toBe(strip(publicCsp));
  });

  it("no HTML route carries a second CSP header from next.config", async () => {
    /*
     * Two Content-Security-Policy headers on one response are enforced as their
     * intersection. A static copy in next.config would silently re-block the
     * inline bootstrap scripts the nonce exists to allow, and the site would go
     * back to being unclickable with no error anywhere except the console.
     */
    const htmlRouteCsp = (await configHeaders())
      .filter((entry) => !entry.source.startsWith("/api"))
      .flatMap((entry) => entry.headers)
      .filter((header) => header.key === "Content-Security-Policy");
    expect(htmlRouteCsp).toEqual([]);
  });

  it("every page's scripts are nonced and strict-dynamic", async () => {
    const { publicCsp, previewCsp } = await policies();
    for (const csp of [publicCsp, previewCsp]) {
      expect(csp).toContain("'nonce-test-nonce'");
      expect(csp).toContain("'strict-dynamic'");
      // A bare script-src 'self' is what made every published site inert.
      expect(csp).not.toMatch(/script-src 'self';/);
    }
  });

  it("style-src keeps unsafe-inline and gains no nonce", async () => {
    // A nonce in style-src makes browsers ignore 'unsafe-inline', which would
    // black out every brand's injected theme.
    const { publicCsp } = await policies();
    const styleSrc = publicCsp.split("; ").find((d) => d.startsWith("style-src"));
    expect(styleSrc).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("the preview route is never indexable", () => {
    expect(configSource).toContain(
      'key: "X-Robots-Tag", value: "noindex, nofollow"',
    );
  });

  it("the business origin matches the CMS constant", () => {
    const cms = fs.readFileSync(
      path.resolve(process.cwd(), "../mingla-site-cms/src/lib/origins.ts"),
      "utf8",
    );
    expect(cms).toContain(`"${MINGLA_BUSINESS_ORIGIN}"`);
  });
});
