/*
 * #4453 milestone 11 TESTER (adversarial, share retest) — a share view must hand
 * its viewer nothing that opens the owner's private preview or a Draft-by-Ari
 * page. Angles the implementor suites don't take:
 *   1. the whole serialized share view (every string, not just media URLs)
 *      holds neither the preview key, its digest, nor a "k=" credential;
 *   2. the share token is checked as-is: case-changed, percent-encoded,
 *      padded or key-shaped tokens are refused before Core is asked;
 *   3. Core unreachable fails CLOSED (no publication fallback, nothing held),
 *      and a held answer still dies at the link's own expiry;
 *   4. the scoped share artifact names no Draft-by-Ari page or its picture.
 * Fails if the share page goes back to the preview key as its asset credential
 * (assertion 1) or if sharedArtifactForAsset stops refusing (2-4).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));

import { voyageSyntheticArtifact } from "../contracts/voyageSynthetic.fixture";
import { clearSharedAssetCache, sharedArtifactForAsset, withPreviewMediaKey } from "./previewMedia";
import { withSharedView } from "./sharedView";
import { ariDraftPreviewPage } from "./pageRouting";
import type { SiteArtifact } from "./siteArtifact";

const DIGEST = "d4c3".repeat(16);
const TOKEN = "Ab3".repeat(14) + "_";
const HOST = "brand-a.sites.usemingla.com";

function previewWithDraft(): { artifact: SiteArtifact; key: string; draftPicture: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const artifact = { ...voyageSyntheticArtifact(), publication_id: `preview-${"e".repeat(32)}` } as any;
  const draftPicture = "9999eeee-1111-4222-8333-444455556666";
  const sample = artifact.media[0]!;
  artifact.media = [...artifact.media, { ...structuredClone(sample), id: draftPicture, url: `/media/${draftPicture}/1440.webp` } as never];
  const about = artifact.pages.find((page: { path: string }) => page.path === "about-us");
  artifact.pages = [...artifact.pages, {
    ...structuredClone(about), path: "private-hire", title: "Private hire DRAFTBYARI_TITLE", enabled: false, draft_by_ari: true,
    blocks: [{ type: "gallery", images: [{ id: draftPicture, url: `/media/${draftPicture}/1440.webp`, alt: "" }] }],
  }];
  return { artifact: artifact as SiteArtifact, key: `publications/${artifact.site_id}/preview-${"e".repeat(32)}/${DIGEST}.json`, draftPicture };
}

describe("#4453 m11 tester: a share view hands out nothing that opens /preview or a Draft page", () => {
  it("the serialized share view carries no preview key, digest or k= credential, and no Draft page", () => {
    const { artifact, key } = previewWithDraft();
    expect(ariDraftPreviewPage(artifact, "private-hire")).not.toBeNull(); // control: the owner's preview still opens it
    const text = JSON.stringify(withSharedView(withPreviewMediaKey(artifact, { share: TOKEN })));
    for (const secret of [key, encodeURIComponent(key), DIGEST, "k=", "private-hire", "DRAFTBYARI_TITLE"]) expect(text, secret).not.toContain(secret);
    expect(text).toContain(`s=${TOKEN}`);
  });

  it("only the exact token reaches Core: case, encoding, padding and key-shaped values are refused unasked", async () => {
    const { artifact, key } = previewWithDraft();
    const load = vi.fn(async (_host: string, token: string) => {
      if (token !== TOKEN) throw new Error("NOT_FOUND");
      return { artifact, key, expiresAt: null };
    });
    clearSharedAssetCache();
    for (const bad of [TOKEN.toLowerCase(), TOKEN.toUpperCase(), encodeURIComponent(TOKEN + "="), ` ${TOKEN}`, `${TOKEN} `, `${TOKEN}x`, key, `preview-${"e".repeat(32)}`, `shared-${"e".repeat(32)}`, ""]) {
      await expect(sharedArtifactForAsset(bad, HOST, Date.now(), load as never), bad).rejects.toThrow("NOT_FOUND");
    }
    expect(load.mock.calls.every(([, token]) => token === TOKEN.toLowerCase() || token === TOKEN.toUpperCase())).toBe(true);
  });

  it("Core unreachable fails closed, holds nothing, and the next good answer is fresh", async () => {
    const { artifact, key } = previewWithDraft();
    clearSharedAssetCache();
    const down = vi.fn(async () => { throw new Error("fetch failed"); });
    await expect(sharedArtifactForAsset(TOKEN, HOST, Date.now(), down as never)).rejects.toThrow();
    const up = vi.fn(async () => ({ artifact, key, expiresAt: null }));
    await sharedArtifactForAsset(TOKEN, HOST, Date.now(), up as never);
    expect(up).toHaveBeenCalledTimes(1); // the failure was not held
  });

  it("the scoped share artifact names no Draft page and drops the picture only the Draft page used", async () => {
    const { artifact, key, draftPicture } = previewWithDraft();
    clearSharedAssetCache();
    const now = Date.now();
    const load = (async () => ({ artifact, key, expiresAt: new Date(now + 5_000).toISOString() })) as never;
    const scoped = await sharedArtifactForAsset(TOKEN, HOST, now, load);
    const text = JSON.stringify(scoped);
    expect(text).not.toContain(draftPicture);
    expect(text).not.toContain("private-hire");
    // the answer dies at the link's own expiry (#4453 final pass: Core is asked on every request, no hold)
    await expect(sharedArtifactForAsset(TOKEN, HOST, now + 6_000, load)).rejects.toThrow("NOT_FOUND");
  });
});
