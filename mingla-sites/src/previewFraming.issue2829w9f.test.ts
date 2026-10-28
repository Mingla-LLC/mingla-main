/*
 * #2829 W9f (A18 item 2) — the preview was blank: the runtime's /preview let
 * only itself and Business web frame it, but Mingla Studio's preview page
 * frames it too (and Business frames Studio's page, and frame-ancestors checks
 * every ancestor). Studio is now allowed (production too), local mode allows
 * the loopback Business web and Studio, and a Business Vercel preview
 * deployment is allowed only by naming its exact, pattern-checked origin.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp, frameAncestorsFor } from "./lib/csp";
import { BUSINESS_PREVIEW_ORIGIN_PATTERN, MINGLA_BUSINESS_ORIGIN, MINGLA_STUDIO_ORIGIN } from "./lib/origins";

const directive = (csp: string) => csp.split("; ").find((part) => part.startsWith("frame-ancestors"))!;

describe("#2829 W9f preview frame-ancestors", () => {
  it("production /preview allows itself, Business web and Studio, and no wildcard", () => {
    const value = directive(buildCsp({ nonce: "n", pathname: "/preview" }));
    expect(value).toBe(`frame-ancestors 'self' ${MINGLA_BUSINESS_ORIGIN} ${MINGLA_STUDIO_ORIGIN}`);
    expect(MINGLA_STUDIO_ORIGIN).toBe("https://studio.sites.usemingla.com");
  });

  it("local mode adds the loopback origins (local Business web and Studio)", () => {
    const value = directive(buildCsp({ nonce: "n", pathname: "/preview", localMode: true }));
    expect(value).toContain("http://localhost:*");
    expect(value).toContain("http://127.0.0.1:*");
    expect(directive(buildCsp({ nonce: "n", pathname: "/preview" }))).not.toContain("localhost");
  });

  it("a Business Vercel preview origin is added only when it matches the one pattern", () => {
    const ok = "https://mingla-business-git-2829-mingla.vercel.app";
    expect(frameAncestorsFor("/preview", { frameAncestor: ok })).toContain(` ${ok}`);
    for (const bad of [
      "https://evil.vercel.app",
      "https://mingla-business-x.vercel.app.evil.com",
      "http://mingla-business-x.vercel.app",
      "https://mingla-business-x.vercel.app/path",
      "https://*.vercel.app",
      "https://mingla-business-x.vercel.app; script-src *",
    ]) {
      expect(frameAncestorsFor("/preview", { frameAncestor: bad })).toBe(
        `'self' ${MINGLA_BUSINESS_ORIGIN} ${MINGLA_STUDIO_ORIGIN}`,
      );
    }
  });

  it("every public page still refuses to be framed, whatever the request says", () => {
    for (const pathname of ["/", "/menu", "/preview/x"]) {
      expect(frameAncestorsFor(pathname, { localMode: true, frameAncestor: "https://mingla-business-a.vercel.app" }))
        .toBe("'none'");
    }
  });

  it("the Business preview pattern is the same one Studio and the edge functions accept", () => {
    const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
    const source = BUSINESS_PREVIEW_ORIGIN_PATTERN.source;
    expect(read("../mingla-site-cms/src/lib/origins.ts")).toContain(source);
    expect(read("../supabase/functions/_shared/businessWebOrigin.ts")).toContain(source);
  });

  it("the proxy passes ?fa= only for /preview", () => {
    const proxy = fs.readFileSync(path.resolve(process.cwd(), "src/proxy.ts"), "utf8");
    expect(proxy).toMatch(/frameAncestor: request\.nextUrl\.pathname === "\/preview"\s*\?\s*request\.nextUrl\.searchParams\.get\("fa"\)/);
  });
});
