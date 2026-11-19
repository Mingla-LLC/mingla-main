import { JOURNAL } from "../../contracts/generated/designs.ts";
import { GalleryPage, galleryBlockMap, type GalleryPageProps } from "../shared/GalleryPage";
import { JOURNAL_SIGNATURE_BLOCKS } from "./blocks/JournalBlocks";

/*
 * #4453 6b — the "journal" design: the shared gallery page drawn with Journal's
 * layouts (site-contracts JOURNAL.variants) plus its signature layouts
 * (blocks/JournalBlocks). The stylesheet, public/designs/journal/1.css, is scoped to
 * html[data-design="journal"] and maps the shared role variables onto Journal's tokens.
 */
export const JOURNAL_BLOCK_VARIANTS = galleryBlockMap(JOURNAL, JOURNAL_SIGNATURE_BLOCKS);

export function JournalPage(props: GalleryPageProps) {
  return <GalleryPage {...props} design={JOURNAL} blocks={JOURNAL_BLOCK_VARIANTS} />;
}
