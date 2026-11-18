// MINGLA-INVARIANT: I-SITES-PLAN-PREVIEW-HOST-ONLY | issue #4453 | a plan key renders only on the reserved preview host and only within 24 h; a site preview key never parses as a plan key (and vice versa); the route is noindex, no-store and no-referrer.
/*
 * #4453 milestone 10 — the runtime's plan preview (/plan-preview).
 *
 * invariant: I-SITES-PLAN-PREVIEW-HOST-ONLY — a plan key renders only on the
 * reserved preview host and only within 24 h; a site preview key never parses
 * as a plan key (and vice versa); the route is noindex/no-store/no-referrer.
 * invariant: I-SITES-SAMPLE-NEVER-PUBLISHED (runtime side) — sample listings
 * render only from a plan artifact's plan_samples, each tagged "Sample", with
 * no link to Mingla, no price and no date, and the page shows the sample strip.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const { headers, objects } = vi.hoisted(() => ({ headers: vi.fn(), objects: new Map<string, Uint8Array>() }));
vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({ usePathname: () => "/plan-preview", notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("./config", () => ({ runtimeConfig: () => ({ mode: "production", artifactBucket: "artifacts", allowedHostSuffix: "sites.usemingla.com", localExtraHosts: [], runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("./storageReader", () => ({
  readPrivateObject: async (_bucket: string, key: string) => {
    const bytes = objects.get(key);
    return bytes ? new Response(Buffer.from(bytes)) : new Response(null, { status: 404 });
  },
}));

import PlanPreviewPage from "../app/plan-preview/page";
import { voyageSyntheticArtifact } from "../contracts/voyageSynthetic.fixture";
import { parsePlanPreviewKey, PLAN_PREVIEW_HOST, SAMPLE_STRIP } from "../contracts/generated/planPreview.ts";
import { parsePreviewArtifactKey } from "./previewArtifact";
import { isPlanPreviewHost } from "./planPreviewArtifact";
import { isPrivatePreviewPath } from "../proxy";
import { frameAncestorsFor } from "./csp";

const BRAND = "aaaaaaaa-1111-4111-8111-1111111110b1";
const hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function store(overrides: Record<string, unknown> = {}, samples = true): string {
  const base = voyageSyntheticArtifact() as unknown as Record<string, unknown>;
  const artifact = {
    ...base,
    brand_id: BRAND,
    generated_at: new Date().toISOString(),
    preview_kind: "plan",
    // Real rows are never mixed with samples of the same kind.
    ...(samples ? { offerings_snapshot: [] } : {}),
    ...(samples ? { plan_samples: { strip: SAMPLE_STRIP, listings: [{ sample: true, kind: "trip", title: "A long weekend by the sea", summary: "A small-group trip." }] } } : {}),
    ...overrides,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(artifact));
  const key = `plan-previews/${BRAND}/plan-${"a".repeat(32)}/${hex(bytes)}.json`;
  objects.set(key, bytes);
  return key;
}
const host = (name: string) => headers.mockResolvedValue(new Headers({ host: name, "x-nonce": "bm9uY2U=" }));
const render = async (key: string, path = "") => renderToStaticMarkup(await PlanPreviewPage({ searchParams: Promise.resolve({ k: key, path }) }) as ReactElement);

beforeEach(() => { objects.clear(); });

describe("#4453 M10 /plan-preview", () => {
  it("renders on the reserved host with the plan banner, the sample strip and Sample-tagged cards that never link out", async () => {
    host(PLAN_PREVIEW_HOST);
    const html = await render(store());
    expect(html).toContain("Preview · nothing built yet");
    expect(html).toContain(SAMPLE_STRIP);
    const voyage = voyageSyntheticArtifact() as unknown as { pages: { path: string; blocks: { type: string }[] }[] };
    const gridPage = voyage.pages.find((page) => page.blocks.some((block) => block.type === "offering_grid"));
    if (gridPage) {
      const grid = await render(store(), gridPage.path);
      expect(grid).toContain("A long weekend by the sea");
      expect(grid).toContain("Sample listing");
      expect(grid).toMatch(/>Sample</);
      // The sample's placeholder address never becomes a link.
      expect(grid).not.toContain('href="https://host.usemingla.com/"');
      // Rework P3-4: a sample card is not a link at all (no "#"), and never says "on Mingla".
      expect(grid).not.toMatch(/href="#"/);
      // Every card that names a sample title carries no link and no "on Mingla" (any design's card markup).
      const sampleCards = [...grid.matchAll(/<article\b(?:(?!<\/article>)[\s\S])*<\/article>/g)].map((m) => m[0])
        .filter((card) => card.includes("A long weekend by the sea") || card.includes("Mountains in the spring"));
      expect(sampleCards.length).toBeGreaterThan(0);
      for (const card of sampleCards) {
        expect(card).not.toMatch(/<a\b/);
        expect(card).not.toContain("on Mingla");
      }
    }
    // Rework P3-5: a plan preview is a preview: no analytics consent banner over the frame.
    expect(html).not.toContain("Your choice");
    expect(html).not.toContain("Analytics choices");
    for (const href of [...html.matchAll(/<a\b[^>]*\shref="(\/[^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"))) {
      if (href.startsWith("/media/") || href.startsWith("/fonts/") || href.startsWith("/om/")) continue;
      expect(href.startsWith("/plan-preview?")).toBe(true);
    }
  });

  it("SC-PP5: a plan key on a site host, an old key, a wrong digest or a missing marker is a 404", async () => {
    host("youngandstamped.sites.usemingla.com");
    await expect(render(store())).rejects.toThrow("NOT_FOUND");
    host(PLAN_PREVIEW_HOST);
    await expect(render(store({ generated_at: new Date(Date.now() - 25 * 3_600_000).toISOString() }))).rejects.toThrow("NOT_FOUND");
    const key = store();
    await expect(render(key.replace(/[0-9a-f]{64}\.json$/, `${"0".repeat(64)}.json`))).rejects.toThrow("NOT_FOUND");
    await expect(render(store({ preview_kind: undefined }))).rejects.toThrow("NOT_FOUND");
    await expect(render(store({ brand_id: "aaaaaaaa-1111-4111-8111-1111111110b2" }))).rejects.toThrow("NOT_FOUND");
  });

  it("keys never cross: a site preview key is not a plan key, and a plan key is not a site preview key", () => {
    const planKey = `plan-previews/${BRAND}/plan-${"a".repeat(32)}/${"d".repeat(64)}.json`;
    const siteKey = `publications/${BRAND}/preview-${"c".repeat(32)}/${"d".repeat(64)}.json`;
    expect(parsePreviewArtifactKey(planKey)).toBeNull();
    expect(parsePlanPreviewKey(siteKey)).toBeNull();
    expect(parsePlanPreviewKey(planKey.replace("plan-", "preview-"))).toBeNull();
    expect(isPlanPreviewHost("youngandstamped.sites.usemingla.com", false)).toBe(false);
    expect(isPlanPreviewHost("localhost:3671", false)).toBe(false);
    expect(isPlanPreviewHost(PLAN_PREVIEW_HOST, false)).toBe(true);
  });

  it("is private (noindex, no-store) and framed only like the team preview", () => {
    expect(isPrivatePreviewPath("/plan-preview")).toBe(true);
    expect(frameAncestorsFor("/plan-preview")).toBe(frameAncestorsFor("/preview"));
    expect(frameAncestorsFor("/")).toBe("'none'");
  });
});
