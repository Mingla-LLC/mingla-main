import { Reveal } from "../Reveal";
import { rows, Section, SectionHead, sectionId, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — feature_cards `statement`: up to four larger statements
 * (a vision, a mission) on a tinted band, two across from 48rem.
 */
export function FeatureCardsStatement({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const cards = rows(block.cards).slice(0, 4);
  const heading = text(block.heading);
  return (
    <Section tinted labelledBy={heading ? id : undefined}>
      <SectionHead id={id} heading={heading} intro={text(block.intro)} standalone />
      <div className="v-statements">
        {cards.map((card, cardIndex) => (
          <Reveal key={cardIndex} delay={cardIndex}>
            <article className="tile card card--raised v-statement">
              <h3 className="v-statement__title">{text(card.title)}</h3>
              <p className="v-statement__body">{text(card.body)}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
