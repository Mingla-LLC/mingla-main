import { MAISON } from "../../contracts/generated/designs.ts";
import { GalleryPage, galleryBlockMap, type GalleryPageProps } from "../shared/GalleryPage";
import { MAISON_SIGNATURE_BLOCKS } from "./blocks/MaisonBlocks";

/*
 * #4453 6a — the "maison" design: the shared gallery page drawn with Maison's
 * layouts (site-contracts MAISON.variants) plus its three signature layouts (blocks/MaisonBlocks). The stylesheet,
 * public/designs/maison/1.css, is scoped to html[data-design="maison"] and maps
 * the shared role variables onto Maison's tokens.
 */
export const MAISON_BLOCK_VARIANTS = galleryBlockMap(MAISON, MAISON_SIGNATURE_BLOCKS);

export function MaisonPage(props: GalleryPageProps) {
  return <GalleryPage {...props} design={MAISON} blocks={MAISON_BLOCK_VARIANTS} />;
}
