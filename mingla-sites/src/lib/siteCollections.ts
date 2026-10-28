import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import type { SiteDestination, SiteStory } from "../contracts/generated/collections.ts";
import { hrefForPath } from "../contracts/generated/routes.ts";

/*
 * #2829 W5 (AD-5) — where a destination or story lives on the site, and which
 * entry a request path names. Base paths are site settings: a destination is
 * at `/<routes.destinations>/<slug>`; a story at `/<routes.stories>/<slug>`,
 * or at `/<slug>` when stories live at the site root (`routes.stories === ""`,
 * which Young & Stamped uses). The publish-time collision check guarantees no
 * page shares one of these addresses.
 */
export type CollectionEntry =
  | { collection: "destinations"; entry: SiteDestination; path: string }
  | { collection: "stories"; entry: SiteStory; path: string };

export function destinationPath(artifact: Pick<ArtifactV2, "routes">, slug: string): string {
  return `${artifact.routes.destinations}/${slug}`;
}

export function storyPath(artifact: Pick<ArtifactV2, "routes">, slug: string): string {
  return artifact.routes.stories === "" ? slug : `${artifact.routes.stories}/${slug}`;
}

export function destinationHref(artifact: Pick<ArtifactV2, "routes">, slug: string): string {
  return hrefForPath(destinationPath(artifact, slug));
}

export function storyHref(artifact: Pick<ArtifactV2, "routes">, slug: string): string {
  return hrefForPath(storyPath(artifact, slug));
}

/** Step 3 (collection detail by base path) and step 4 (root-level story) of the resolution order. */
export function collectionEntryForPath(artifact: ArtifactV2, path: string): CollectionEntry | null {
  const segments = path.split("/");
  const { collections, routes } = artifact;
  if (segments.length === 2) {
    const [base, slug] = segments as [string, string];
    if (base === routes.destinations) {
      const entry = collections.destinations.find((row) => row.slug === slug);
      if (entry) return { collection: "destinations", entry, path };
    }
    if (routes.stories !== "" && base === routes.stories) {
      const entry = collections.stories.find((row) => row.slug === slug);
      if (entry) return { collection: "stories", entry, path };
    }
  }
  if (segments.length === 1 && routes.stories === "" && path !== "") {
    const entry = collections.stories.find((row) => row.slug === path);
    if (entry) return { collection: "stories", entry, path };
  }
  return null;
}

/** Every collection detail address (sitemap), skipping entries hidden from search. */
export function collectionEntryPaths(artifact: ArtifactV2): string[] {
  return [
    ...artifact.collections.destinations.filter((row) => row.seo?.noindex !== true).map((row) => destinationPath(artifact, row.slug)),
    ...artifact.collections.stories.filter((row) => row.seo?.noindex !== true).map((row) => storyPath(artifact, row.slug)),
  ];
}
