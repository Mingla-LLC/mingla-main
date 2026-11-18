import { NOCTURNE } from "../../contracts/generated/designs.ts";
import { GalleryPage, galleryBlockMap, type GalleryPageProps } from "../shared/GalleryPage";

/*
 * #4453 6a — the "nocturne" design: the shared gallery page drawn with Nocturne's
 * layouts (site-contracts NOCTURNE.variants). The stylesheet,
 * public/designs/nocturne/1.css, is scoped to html[data-design="nocturne"] and maps
 * the shared role variables onto Nocturne's tokens.
 */
export const NOCTURNE_BLOCK_VARIANTS = galleryBlockMap(NOCTURNE);

export function NocturnePage(props: GalleryPageProps) {
  return <GalleryPage {...props} design={NOCTURNE} blocks={NOCTURNE_BLOCK_VARIANTS} />;
}
