import type { RichTextDoc } from "../../../contracts/generated/richText.ts";
import { RichText } from "../../../components/v2/RichText";
import { Section, sectionId, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — rich_text `prose`: the safe rich-text tree in a 68ch reading
 * column (narrow: the column is centred and the heading shares its edge) or
 * across the full shell.
 */
export function RichTextProse({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const full = text(block.width) === "full";
  const heading = text(block.heading);
  return (
    <Section labelledBy={heading ? id : undefined}>
      <div className={full ? undefined : "v-narrow"}>
        {text(block.eyebrow) && text(block.eyebrow) !== heading ? <p className="eyebrow v-prose-eyebrow">{text(block.eyebrow)}</p> : null}
        {heading ? <h2 id={id} className="v-prose-heading">{heading}</h2> : null}
        <div className={`prose${full ? " prose--full" : ""}`}><RichText doc={block.body as RichTextDoc} /></div>
      </div>
    </Section>
  );
}
