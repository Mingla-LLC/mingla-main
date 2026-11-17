import { SUNSET } from "../../contracts/generated/designs.ts";
import { GalleryPage, galleryBlockMap, type GalleryPageProps } from "../shared/GalleryPage";
import { SUNSET_SIGNATURE_BLOCKS } from "./blocks/SunsetBlocks";

/*
 * #4453 6c — the "sunset" design: the shared gallery page drawn with Sunset's
 * layouts (site-contracts SUNSET.variants) plus its signature hero
 * (blocks/SunsetBlocks). The stylesheet, public/designs/sunset/1.css, is scoped to
 * html[data-design="sunset"] and maps the shared role variables onto Sunset's tokens.
 */
export const SUNSET_BLOCK_VARIANTS = galleryBlockMap(SUNSET, SUNSET_SIGNATURE_BLOCKS);

export function SunsetPage(props: GalleryPageProps) {
  return <GalleryPage {...props} design={SUNSET} blocks={SUNSET_BLOCK_VARIANTS} />;
}
