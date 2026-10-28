import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { reportPreviewBuilt } from "./previewBuiltReport";

/*
 * #2829 W10 — every preview Studio builds becomes the site's newest preview
 * in Core (what its private share links show): the report names the site
 * and the exact object key the builder stored; a failed report is observed
 * and never breaks the preview the owner opened. previewDraft makes the
 * report after building, before handing off to the runtime.
 */
const SITE = "aaaaaaaa-1111-4111-8111-111111111111";
const KEY = `publications/${SITE}/preview-${"c".repeat(32)}/${"d".repeat(64)}.json`;

describe("#2829 W10 preview built report", () => {
  it("reports the site's new preview key to Core, bound to the site", async () => {
    const report = vi.fn(async () => ({ ok: true }));
    expect(await reportPreviewBuilt(SITE, KEY, report)).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    const [route, site, operation, payload] = report.mock.calls[0] as unknown as [string, string, string, Record<string, unknown>];
    expect(route).toBe(`/internal/v1/sites/${SITE}/preview-artifacts`);
    expect(site).toBe(SITE);
    expect(operation).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload).toEqual({ artifact_key: KEY });
  });

  it("a failed report is observed and answered false, never thrown", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((line: unknown) => { lines.push(String(line)); });
    const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => { lines.push(String(line)); });
    const log = vi.spyOn(console, "log").mockImplementation((line: unknown) => { lines.push(String(line)); });
    const error = vi.spyOn(console, "error").mockImplementation((line: unknown) => { lines.push(String(line)); });
    try {
      expect(await reportPreviewBuilt(SITE, KEY, async () => { throw new Error("CORE_UNAVAILABLE"); })).toBe(false);
      expect(lines.join("\n")).toContain("cms.preview_built.report_failed");
    } finally {
      spy.mockRestore();
      info.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("previewDraft reports the built key before redirecting to the runtime", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/endpoints/sitesEndpoints.ts"), "utf8");
    const preview = source.slice(source.indexOf("async function previewDraft"));
    const built = preview.indexOf("buildPublicationArtifact(req, {");
    const reported = preview.indexOf("await reportPreviewBuilt(grant.site_id, built.artifactKey)");
    const redirected = preview.indexOf("status: 302");
    expect(built).toBeGreaterThan(-1);
    expect(reported).toBeGreaterThan(built);
    expect(redirected).toBeGreaterThan(reported);
  });
});
