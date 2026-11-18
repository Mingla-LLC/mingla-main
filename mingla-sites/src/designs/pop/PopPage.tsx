import { POP } from "../../contracts/generated/designs.ts";
import { GalleryPage, galleryBlockMap, type GalleryPageProps } from "../shared/GalleryPage";
import { POP_SIGNATURE_BLOCKS } from "./blocks/PopBlocks";

/*
 * #4453 6c — the "pop" design: the shared gallery page drawn with Pop's
 * layouts (site-contracts POP.variants) plus its signature hero
 * (blocks/PopBlocks). The stylesheet, public/designs/pop/1.css, is scoped to
 * html[data-design="pop"] and maps the shared role variables onto Pop's tokens.
 */
export const POP_BLOCK_VARIANTS = galleryBlockMap(POP, POP_SIGNATURE_BLOCKS);

export function PopPage(props: GalleryPageProps) {
  return <GalleryPage {...props} design={POP} blocks={POP_BLOCK_VARIANTS} />;
}
