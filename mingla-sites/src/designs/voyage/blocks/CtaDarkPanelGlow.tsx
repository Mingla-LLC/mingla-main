import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { BtnIcon, Section, sectionId, SiteLink, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — cta `dark-panel-glow`: a rounded dark panel lit by two accent
 * glows, the heading and sentence centred over one light pill button.
 */
export function CtaDarkPanelGlow({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  // #4572: "/" was the old owner-editor placeholder, not a chosen target.
  // Keep the panel copy and hide its action until the owner adds a real link.
  const href = block.href === "/" ? null : block.href;
  return (
    <Section labelledBy={id}>
      <div className="cta-panel on-dark">
        <h2 id={id} className="v-cta__title">{text(block.heading)}</h2>
        {text(block.body) ? <p className="lede v-cta__body">{text(block.body)}</p> : null}
        {isSafeHref(href) && text(block.label) ? <SiteLink href={String(href)} className="btn btn--on-teal v-cta__action">{text(block.label)}<BtnIcon /></SiteLink> : null}
      </div>
    </Section>
  );
}
