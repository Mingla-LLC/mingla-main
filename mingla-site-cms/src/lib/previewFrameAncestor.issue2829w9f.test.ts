/*
 * #2829 W9f (A18 item 2) — Studio forwards a Business Vercel preview origin
 * (`fa`) from its preview page to the runtime's /preview so that deployment
 * can frame the draft; nothing else is ever forwarded.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { businessPreviewFrameAncestor } from "./origins";

describe("#2829 W9f preview frame ancestor forwarding", () => {
  it("accepts only an exact Business Vercel preview origin", () => {
    expect(businessPreviewFrameAncestor("https://mingla-business-git-x-mingla.vercel.app"))
      .toBe("https://mingla-business-git-x-mingla.vercel.app");
    for (const bad of [null, undefined, "", "https://evil.vercel.app", "https://host.usemingla.com",
      "https://mingla-business-x.vercel.app.evil.com", "https://mingla-business-x.vercel.app/x"]) {
      expect(businessPreviewFrameAncestor(bad)).toBeNull();
    }
  });

  it("the preview page and the preview redirect both pass it through the checker", () => {
    const page = fs.readFileSync(path.resolve(process.cwd(), "src/app/(frontend)/preview/page.tsx"), "utf8");
    const endpoints = fs.readFileSync(path.resolve(process.cwd(), "src/endpoints/sitesEndpoints.ts"), "utf8");
    expect(page).toContain("businessPreviewFrameAncestor(params.fa)");
    expect(endpoints).toContain('businessPreviewFrameAncestor(url.searchParams.get("fa"))');
    expect(endpoints).toContain('target.searchParams.set("fa", frameAncestor)');
  });
});
