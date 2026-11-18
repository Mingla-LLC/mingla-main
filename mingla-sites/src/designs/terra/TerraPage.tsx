import { TERRA } from "../../contracts/generated/designs.ts";
import { GalleryPage, galleryBlockMap, type GalleryPageProps } from "../shared/GalleryPage";
import { TERRA_SIGNATURE_BLOCKS } from "./blocks/TerraBlocks";

/*
 * #4453 6b — the "terra" design: the shared gallery page drawn with Terra's
 * layouts (site-contracts TERRA.variants) plus its signature layouts
 * (blocks/TerraBlocks). The stylesheet, public/designs/terra/1.css, is scoped to
 * html[data-design="terra"] and maps the shared role variables onto Terra's tokens.
 */
export const TERRA_BLOCK_VARIANTS = galleryBlockMap(TERRA, TERRA_SIGNATURE_BLOCKS);

export function TerraPage(props: GalleryPageProps) {
  return <GalleryPage {...props} design={TERRA} blocks={TERRA_BLOCK_VARIANTS} />;
}
