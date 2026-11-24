/*
 * #4572 item 1 (D5) — a refused preview GET answers the frame with a small
 * page that tells its parent what happened, never the JSON envelope, and
 * never posts to "*". FAILS-ON-REVERT: previewDraft returning safeFailure()
 * sends application/json `{"ok":false,...}` into the frame.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIEW_FAILED, PREVIEW_STALE, previewMessageTargets, previewRefusal, previewRefusalResponse } from "../lib/previewRefusal";

const ORIGINS = ["https://host.usemingla.com", "https://studio.sites.usemingla.com", null];

describe("#4572 item 1 — preview refusal page", () => {
  it("a stale draft says it is updating and posts PREVIEW_STALE (409)", async () => {
    const response = previewRefusalResponse("REVISION_CONFLICT", ORIGINS);
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    const html = await response.text();
    expect(html).toContain("Your draft just changed. Updating preview…");
    expect(html).toContain(PREVIEW_STALE);
    expect(html).not.toContain('{"ok":false');
  });

  it("FORBIDDEN and NOT_FOUND keep their status, never show JSON, and post PREVIEW_FAILED", async () => {
    for (const [code, status] of [["FORBIDDEN", 403], ["NOT_FOUND", 404], ["SESSION_EXPIRED", 403], ["SERVICE_TEMPORARILY_UNAVAILABLE", 503], ["INVALID_STATE", 409]] as const) {
      const response = previewRefusalResponse(code, ORIGINS);
      expect(response.status, code).toBe(status);
      const html = await response.text();
      expect(html).toContain("We couldn't load the preview.");
      expect(html).toContain(PREVIEW_FAILED);
      expect(html).not.toMatch(/"ok":|"error":/);
    }
  });

  it("posts only to Mingla's own origins, never '*', and frames only for them", async () => {
    const response = previewRefusalResponse("REVISION_CONFLICT", [...ORIGINS, "javascript:alert(1)", "*"]);
    const html = await response.text();
    expect(html).not.toMatch(/postMessage\(m,\s*["']\*["']\)/);
    expect(html).toContain('["https://host.usemingla.com","https://studio.sites.usemingla.com"]');
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors https://host.usemingla.com https://studio.sites.usemingla.com");
    expect(previewMessageTargets(["*", "", "https://a.example", "https://a.example"])).toEqual(["https://a.example"]);
    expect(previewRefusal("REVISION_CONFLICT").type).toBe(PREVIEW_STALE);
  });

  it("previewDraft's catch answers with the page", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/endpoints/sitesEndpoints.ts"), "utf8");
    const body = source.slice(source.indexOf("async function previewDraft("), source.indexOf("async function", source.indexOf("async function previewDraft(") + 30));
    expect(body).toContain("return previewDraftRefusal(req, error);");
    expect(body).not.toContain("return safeFailure(error);");
  });
});
