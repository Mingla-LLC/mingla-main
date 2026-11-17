/*
 * #4453 milestone 11 (spec v2.1 §3.3, decision N10, SC-AP2) — a page Ari added
 * that the owner has not accepted ("Draft by Ari") never reaches a share link:
 * the page and every link to it are dropped, even if the page were ever marked
 * enabled. The artifact contract only accepts the marker on a disabled page.
 *
 * MINGLA-INVARIANT: I-SITES-ARI-DRAFT-NEVER-SHARED | issue #4453 | a page marked draft_by_ari is removed from a share view with every link to it, and the artifact contract refuses draft_by_ari on an enabled page.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));

import { voyageSyntheticArtifact } from "../contracts/voyageSynthetic.fixture";
import { assertArtifactV2, type ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { hiddenPaths, withSharedView } from "./sharedView";

const TEAM_ID = `preview-${"d".repeat(32)}`;

function withAriDraft(enabled: boolean, publicationId: string = TEAM_ID): ArtifactV2 {
  const artifact = { ...voyageSyntheticArtifact(), publication_id: publicationId } as ArtifactV2;
  const about = artifact.pages.find((page) => page.path === "about-us")!;
  artifact.pages = [
    ...artifact.pages,
    { ...structuredClone(about), path: "private-hire", title: "Private hire", enabled, draft_by_ari: true },
  ];
  artifact.navigation = {
    ...artifact.navigation,
    items: [...artifact.navigation.items, { label: "Private hire", href: "/private-hire" }],
  };
  artifact.footer = {
    ...artifact.footer,
    columns: [...(artifact.footer.columns ?? []), { heading: "More", links: [{ label: "Private hire", href: "/private-hire" }] }],
  };
  return artifact;
}

describe("#4453 milestone 11 a Draft-by-Ari page never reaches a share link (N10)", () => {
  it("hiddenPaths hides a Draft-by-Ari page even when it is marked enabled", () => {
    expect([...hiddenPaths([{ path: "", enabled: true }, { path: "private-hire", enabled: true, draft_by_ari: true }])]).toEqual(["private-hire"]);
  });

  it("the share view drops the page, its menu entry and its footer link", () => {
    for (const enabled of [false, true]) {
      const shared = withSharedView(withAriDraft(enabled));
      expect(shared.pages.some((page) => page.path === "private-hire")).toBe(false);
      const text = JSON.stringify(shared);
      expect(text).not.toContain("/private-hire");
      expect(text).not.toContain("draft_by_ari");
    }
  });

  it("the contract accepts the marker only on a disabled page", () => {
    const disabled = withAriDraft(false, voyageSyntheticArtifact().publication_id);
    disabled.navigation = voyageSyntheticArtifact().navigation;
    disabled.footer = voyageSyntheticArtifact().footer;
    expect(() => assertArtifactV2(disabled)).not.toThrow();
    const enabled = structuredClone(disabled);
    enabled.pages.find((page) => page.path === "private-hire")!.enabled = true;
    expect(() => assertArtifactV2(enabled)).toThrow(/ARTIFACT_PAGE_PATH_MISMATCH/);
    const wrong = structuredClone(disabled) as unknown as { pages: Array<Record<string, unknown>> };
    wrong.pages.find((page) => page.path === "private-hire")!.draft_by_ari = false;
    expect(() => assertArtifactV2(wrong)).toThrow(/ARTIFACT_PAGE_PATH_MISMATCH/);
  });
});
