import { Fragment, Suspense, type ReactNode } from "react";

/*
 * #4453 website workspace (build contract D) — one section of a page, drawn
 * so the owner's private preview can find it WITHOUT changing how it looks.
 *
 * `marked` is true only on the owner's private preview, for a page whose
 * section list arrived (ArtifactPage.previewSectionIds). Everywhere else this
 * is a Fragment: the public site, a share link and the plan preview produce
 * exactly the HTML they produced before this file existed.
 *
 * When marked, the section sits inside a React Suspense boundary. Nothing in
 * a section suspends, so the boundary never shows a fallback; what it does is
 * make the server write two HTML COMMENTS around the section's markup
 * (`<!--$-->` … `<!--/$-->`), and React keeps them in the page after it
 * hydrates. A comment is not an element and has no box:
 *   - no CSS selector can see it (`>`, `+`, `~`, `:first-child`,
 *     `:nth-child`, `:last-child`, `:only-child` and `:empty` all ignore
 *     comments), so every rule between top-level sections matches as before;
 *   - it takes part in no layout (no flex or grid item, no whitespace).
 * A wrapper element (even `display: contents`) or a marker element between
 * sections would do neither: it changes which element is the first child and
 * which elements are adjacent, in all 11 designs.
 *
 * The page writes exactly ONE boundary per block, in block order, as direct
 * children of the element that holds the page's sections (an empty one for a
 * block that draws nothing), so the preview bridge can pair the n-th boundary
 * with the n-th section id. It refuses to mark anything when the count does
 * not match, so a wrong pairing is never shown (lib/previewBridgeDom.ts).
 */
export function PreviewSection({ marked, children }: { marked: boolean; children?: ReactNode }) {
  return marked ? <Suspense>{children}</Suspense> : <Fragment>{children}</Fragment>;
}
