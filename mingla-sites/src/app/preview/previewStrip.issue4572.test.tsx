/*
 * #4572 item 13 — the "Private preview · not live" strip was hidden under
 * Maison's fixed header on /preview. Both owner preview pages now draw the
 * share page's 32 px strip (sticky, z 100) and push every design's fixed
 * header below it, exactly as the share page does. No design stylesheet is
 * edited (they are immutable: a change is a new version file).
 * FAILS-ON-REVERT: without PREVIEW_STRIP_CSS / PREVIEW_BANNER_STYLE on the
 * pages, the source assertions fail.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIEW_BANNER_STYLE, PREVIEW_BANNER_TEXT, PREVIEW_STRIP_CSS, SHARED_BANNER_STYLE } from "../../lib/sharedBanner";

const src = (file: string) => fs.readFileSync(path.join(process.cwd(), "src/app", file), "utf8");

describe("#4572 item 13 — the preview strip sits above the site header", () => {
  it("one strip style for every preview page, pinned above fixed headers", () => {
    expect(SHARED_BANNER_STYLE).toBe(PREVIEW_BANNER_STYLE);
    expect(PREVIEW_BANNER_STYLE).toMatchObject({ position: "sticky", top: 0, zIndex: 100, height: 32, whiteSpace: "nowrap", textOverflow: "ellipsis" });
    expect(PREVIEW_STRIP_CSS).toContain("[data-preview] :is(.mg-hd,.site-header,.v-header){top:32px !important}");
    expect(PREVIEW_BANNER_TEXT).toBe("Private preview · not live");
  });

  it("/preview (both page shapes) and /plan-preview draw the strip with the page nonce", () => {
    const preview = src("preview/page.tsx");
    expect(preview.match(/<style nonce=\{[^}]+\}>\{PREVIEW_STRIP_CSS\}<\/style>/g)).toHaveLength(2);
    expect(preview.match(/style=\{PREVIEW_BANNER_STYLE\}/g)).toHaveLength(2);
    const plan = src("plan-preview/page.tsx");
    expect(plan).toMatch(/<style nonce=\{[^}]+\}>\{PREVIEW_STRIP_CSS\}<\/style>/);
    expect(plan).toContain("style={PREVIEW_BANNER_STYLE}");
  });

  it("no immutable design stylesheet differs from origin/main", () => {
    const changed = execFileSync("git", ["diff", "--name-only", "origin/main", "--", "public/designs"], { cwd: process.cwd(), encoding: "utf8" }).trim();
    expect(changed).toBe("");
  });
});
