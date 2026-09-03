import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

async function policies() {
  const mod = await import("../next.config");
  const headers = await (mod.default.headers as () => Promise<
    { source: string; headers: { key: string; value: string }[] }[]
  >)();
  const csp = (source: string) =>
    headers.find((entry) => entry.source === source)?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value ?? "";
  return { publicCsp: csp("/:path*"), previewCsp: csp("/preview") };
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
