import { createHash } from "node:crypto";
import { isSharedPreviewPublication, SHARED_PUBLICATION_PREFIX } from "./previewPublication";
import { isV2Artifact, type SiteArtifact } from "./siteArtifact";

/*
 * #4453 M8 (spec v2 §7, v2.1 N10) — what a private share link shows.
 *
 * The link opens the SAME renderer as the team's preview, with these
 * differences decided here, on the server, before anything renders:
 *   1. The artifact is re-labelled `preview-shared-…` so the owner-only hints
 *      (an empty offering grid's "new trips will appear here") are never drawn
 *      for a client (`showsDraftHints`). A private link is a preview the owner
 *      chose to send, so unreviewed sections on enabled pages may show, with no
 *      Draft UI; nothing that must never be public (unconfirmed reviews,
 *      unanswered setup fields, owner prompts) is added to it.
 *   2. A page that is not enabled, or is a Draft by Ari (milestone 11, N10), is
 *      removed, and so is EVERY link to it, from
 *      any source: menu, header button, footer, a block's button or in-page
 *      link. One walk over the whole artifact (`withoutLinksTo`), not a list of
 *      known places.
 * A new object; the stored preview artifact is never changed.
 */

/**
 * #4453 final pass (tester P4-1, comment 6945336387) — the share view's publication id, derived from the
 * preview id with a one-way hash, so the share view carries no character of the preview id. Server only
 * (node:crypto); an id that is already a share id is kept.
 */
export function sharedViewPublicationId(publicationId: string): string {
  if (isSharedPreviewPublication(publicationId)) return publicationId;
  const digest = createHash("sha256").update(`mingla-share-view|${publicationId}`).digest("hex").slice(0, 32);
  return `${SHARED_PUBLICATION_PREFIX}${digest}`;
}

/** The page path a same-site href names ("/a/b?x#y" -> "a/b"), or null for anything else. */
function sitePathOf(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  return href.replace(/^\/+/, "").split(/[?#]/)[0]!.replace(/\/+$/, "");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isHrefKey = (key: string): boolean => key === "href" || key.endsWith("_href");

/**
 * The value with every link to a hidden path taken out:
 * an object with an `href` (a nav entry, a button, a footer link) to a hidden path
 * disappears from its array or property; a bare `*_href` field is dropped.
 */
export function withoutLinksTo<T>(value: T, hidden: ReadonlySet<string>): T {
  const hides = (node: unknown): boolean => {
    if (!isRecord(node) || typeof node.href !== "string") return false;
    const path = sitePathOf(node.href);
    return path !== null && hidden.has(path);
  };
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.filter((item) => !hides(item)).map(walk);
    if (!isRecord(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (hides(child)) continue;
      if (isHrefKey(key) && typeof child === "string") {
        const path = sitePathOf(child);
        if (path !== null && hidden.has(path)) continue;
      }
      out[key] = walk(child);
    }
    return out;
  };
  return walk(value) as T;
}

const trimPath = (path: string): string => path.replace(/^\/+|\/+$/g, "");

/**
 * The page tree as one walk: a page is hidden when it is disabled, or when any
 * page above it in the path ("a" above "a/b") is disabled, even if it is enabled
 * itself. Links to every hidden page are removed by `withoutLinksTo`.
 */
export function hiddenPaths(pages: ReadonlyArray<{ path: string; enabled: boolean; draft_by_ari?: true }>): Set<string> {
  // #4453 milestone 11 (decision N10) — a Draft-by-Ari page is left out of share links even if it were ever enabled.
  const disabled = new Set(pages.filter((page) => !page.enabled || page.draft_by_ari === true).map((page) => trimPath(page.path)));
  const hidden = new Set(disabled);
  for (const page of pages) {
    const path = trimPath(page.path);
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      if (disabled.has(parts.slice(0, depth).join("/"))) hidden.add(path);
    }
  }
  return hidden;
}

export function withSharedView<T extends SiteArtifact>(artifact: T): T {
  const relabelled = { ...artifact, publication_id: sharedViewPublicationId(artifact.publication_id) } as T;
  if (!isV2Artifact(relabelled)) return relabelled;
  const hidden = hiddenPaths(relabelled.pages);
  if (hidden.size === 0) return relabelled;
  const { pages, ...rest } = relabelled;
  return { ...withoutLinksTo(rest, hidden), pages: pages.filter((page) => !hidden.has(trimPath(page.path))).map((page) => withoutLinksTo(page, hidden)) } as T;
}
