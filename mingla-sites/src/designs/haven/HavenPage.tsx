import { HAVEN } from "../../contracts/generated/designs.ts";
import { GalleryPage, galleryBlockMap, type GalleryPageProps } from "../shared/GalleryPage";

/*
 * #4453 6a — the "haven" design: the shared gallery page drawn with Haven's
 * layouts (site-contracts HAVEN.variants). The stylesheet,
 * public/designs/haven/1.css, is scoped to html[data-design="haven"] and maps
 * the shared role variables onto Haven's tokens.
 */
export const HAVEN_BLOCK_VARIANTS = galleryBlockMap(HAVEN);

export function HavenPage(props: GalleryPageProps) {
  return <GalleryPage {...props} design={HAVEN} blocks={HAVEN_BLOCK_VARIANTS} />;
}
