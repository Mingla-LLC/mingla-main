/*
 * #4453 m11 rework (spec v2.1 §3.2-§3.3, SC-AP-Web, SC-N3, N10) — the owner's
 * PRIVATE preview opens a Draft page from Ari so the editor can show it; the
 * live resolver (live site, sitemap) and share links never do.
 *
 * MINGLA-INVARIANT: I-SITES-ARI-DRAFT-PREVIEW-ONLY | issue #4453 | a draft_by_ari page resolves only through ariDraftPreviewPage (the private /preview route); resolveSitePath, isIndexable and the share view never return it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));

import { voyageSyntheticArtifact } from "../contracts/voyageSynthetic.fixture";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { ariDraftPreviewPage, navigablePages, resolveSitePath } from "./pageRouting";
import { withSharedView } from "./sharedView";

function withAriDraft(marked = true): ArtifactV2 {
  const artifact = { ...voyageSyntheticArtifact(), publication_id: `preview-${"e".repeat(32)}` } as ArtifactV2;
  const about = artifact.pages.find((page) => page.path === "about-us")!;
  artifact.pages = [
    ...artifact.pages,
    { ...structuredClone(about), path: "private-hire", title: "Private hire", enabled: false, ...(marked ? { draft_by_ari: true as const } : {}) },
  ];
  return artifact;
}

describe("#4453 m11 rework the private preview opens a Draft page from Ari", () => {
  it("ariDraftPreviewPage returns the Draft page at its exact path", () => {
    const page = ariDraftPreviewPage(withAriDraft(), "private-hire");
    expect(page).toMatchObject({ path: "private-hire", title: "Private hire", enabled: false });
  });

  it("an ordinary disabled page, home, or another path is not opened", () => {
    expect(ariDraftPreviewPage(withAriDraft(false), "private-hire")).toBeNull();
    expect(ariDraftPreviewPage(withAriDraft(), "")).toBeNull();
    expect(ariDraftPreviewPage(withAriDraft(), "private-hire/x")).toBeNull();
  });

  it("the live resolver (live site, sitemap) and the menu still never reach it", () => {
    const artifact = withAriDraft();
    expect(resolveSitePath(artifact, "private-hire")).toEqual({ kind: "not_found" });
    expect(navigablePages(artifact).some((page) => page.path === "private-hire")).toBe(false);
  });

  it("a share view of the same preview artifact still drops it", () => {
    const shared = withSharedView(withAriDraft());
    expect(shared.pages.some((page) => page.path === "private-hire")).toBe(false);
    expect(JSON.stringify(shared)).not.toContain("private-hire");
  });

  it("only the private /preview route calls it (never the live route, the sitemap or the share route)", () => {
    const root = join(__dirname, "..", "app");
    expect(readFileSync(join(root, "preview", "page.tsx"), "utf8")).toContain("ariDraftPreviewPage(artifact, previewPath)");
    for (const file of [join("[[...path]]", "page.tsx"), "sitemap.ts", join("preview", "share", "[token]", "page.tsx")]) {
      expect(readFileSync(join(root, file), "utf8")).not.toContain("ariDraftPreviewPage");
    }
  });
});
