import { rows, Section, SectionHead, sectionId, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — faq `accordion-columns`: native <details> (opens with no
 * JavaScript). Four or more questions run in two accordions side by side
 * from 64rem, split ceil(n/2) / rest, so DOM, visual and tab order agree;
 * fewer sit in one centred column.
 */
export const FAQ_COLUMN_MIN = 4;

export function Accordion({ items }: { items: ReadonlyArray<{ question: string; answer: string }> }) {
  return (
    <div className="faq">
      {items.map((item, itemIndex) => (
        <details key={itemIndex}>
          <summary className="ring-inset">
            {item.question}
            <span className="faq__marker" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            </span>
          </summary>
          <p className="faq__answer">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

export function faqColumns<T>(items: readonly T[]): T[][] {
  if (items.length < FAQ_COLUMN_MIN) return [[...items]];
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}

export function FaqAccordionColumns({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const items = rows(block.items).map((item) => ({ question: text(item.question), answer: text(item.answer) }));
  const columns = faqColumns(items);
  const heading = text(block.heading);
  return (
    <Section labelledBy={heading ? id : undefined}>
      <div className={columns.length === 2 ? undefined : "v-faq-single"}>
        <SectionHead id={id} heading={heading} standalone />
        {columns.length === 2 ? (
          <div className="faq-columns">{columns.map((column, columnIndex) => <Accordion key={columnIndex} items={column} />)}</div>
        ) : <Accordion items={items} />}
      </div>
    </Section>
  );
}
