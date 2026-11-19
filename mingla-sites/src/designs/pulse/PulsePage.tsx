import { PULSE } from "../../contracts/generated/designs.ts";
import { GalleryPage, galleryBlockMap, type GalleryPageProps } from "../shared/GalleryPage";
import { PULSE_SIGNATURE_BLOCKS } from "./blocks/PulseBlocks";

/*
 * #4453 6c — the "pulse" design: the shared gallery page drawn with Pulse's
 * layouts (site-contracts PULSE.variants) plus its signature hero
 * (blocks/PulseBlocks). The stylesheet, public/designs/pulse/1.css, is scoped to
 * html[data-design="pulse"] and maps the shared role variables onto Pulse's tokens.
 */
export const PULSE_BLOCK_VARIANTS = galleryBlockMap(PULSE, PULSE_SIGNATURE_BLOCKS);

export function PulsePage(props: GalleryPageProps) {
  return <GalleryPage {...props} design={PULSE} blocks={PULSE_BLOCK_VARIANTS} />;
}
