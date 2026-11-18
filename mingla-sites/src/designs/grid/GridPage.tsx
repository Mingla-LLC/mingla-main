import { GRID } from "../../contracts/generated/designs.ts";
import { GalleryPage, galleryBlockMap, type GalleryPageProps } from "../shared/GalleryPage";
import { GRID_SIGNATURE_BLOCKS } from "./blocks/GridBlocks";

/*
 * #4453 6b — the "grid" design: the shared gallery page drawn with Grid's
 * layouts (site-contracts GRID.variants) plus its signature layouts
 * (blocks/GridBlocks). The stylesheet, public/designs/grid/1.css, is scoped to
 * html[data-design="grid"] and maps the shared role variables onto Grid's tokens.
 */
export const GRID_BLOCK_VARIANTS = galleryBlockMap(GRID, GRID_SIGNATURE_BLOCKS);

export function GridPage(props: GalleryPageProps) {
  return <GalleryPage {...props} design={GRID} blocks={GRID_BLOCK_VARIANTS} />;
}
