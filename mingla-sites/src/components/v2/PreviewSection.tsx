import { Fragment, type ReactNode } from "react";

/*
 * #4453 website workspace (build contract D) — one section of a page, drawn
 * so the owner's private preview can find it WITHOUT changing how it looks.
 *
 * `marked` is true only on the owner's private preview, for a page whose
 * section list arrived (ArtifactPage.previewSectionIds). Everywhere else this
 * is a bare Fragment: the public site, a share link and the plan preview
 * produce exactly the HTML they produced before this file existed.
 *
 * When marked, the section is preceded by one whitespace-only TEXT NODE with
 * an exact, unusual shape (newline, tab, newline). It is the same thing as
 * the line breaks of hand-indented HTML between two block elements:
 *   - no CSS selector can see a text node (`>`, `+`, `~`, `:first-child`,
 *     `:nth-child`, `:last-child` and `:only-child` count elements only), so
 *     every rule between top-level sections matches as before;
 *   - between block-level boxes, collapsible whitespace makes no box and no
 *     line (CSS 2 §16.6.1), and in a flex or grid container it is dropped.
 *     The three containers that hold sections (`.mg-main`, `.v-main`,
 *     Atelier's `.page-content`) are plain block containers with normal
 *     white-space, and the real-browser check (e2e/preview-bridge) compares
 *     every design with and without marks pixel for pixel.
 * A wrapper element (even `display: contents`) or a marker element between
 * sections would do neither: it changes which element is the first child and
 * which elements are adjacent, and the designs do style sections that way
 * (`.mg-main > .mg-blk`, `.page-content > section`).
 *
 * Why text and not a comment: React writes text nodes on the server AND when
 * it draws a page again in the browser (which it does when the server's HTML
 * and the browser's first render disagree anywhere on the page). A marker
 * only the server writes would vanish in exactly that case.
 *
 * The page writes exactly ONE marker per block, in block order, as a direct
 * child of the element that holds the page's sections (also for a block that
 * draws nothing), so the preview bridge can pair the n-th marker with the
 * n-th section id. It refuses to mark anything when the count does not
 * match, so a wrong pairing is never shown (lib/previewBridge.ts).
 */
export const PREVIEW_SECTION_MARKER = "\n\t\n";

export function PreviewSection({ marked, children }: { marked: boolean; children?: ReactNode }) {
  return marked ? <Fragment>{PREVIEW_SECTION_MARKER}{children}</Fragment> : <Fragment>{children}</Fragment>;
}
