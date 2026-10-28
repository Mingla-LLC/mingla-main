import { FeatureIcon } from "../icons";
import { Reveal } from "../Reveal";
import { rows, Section, SectionHead, sectionId, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — feature_cards `tile-bar`: up to six cards, each with an accent
 * bar down its leading edge and an optional built-in icon on a tinted tile.
 * Count-aware: 1 card fills the row, 2 share it, 3 sit three across from
 * 64rem, 4 sit two then four across.
 */
export function FeatureCardsTileBar({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const cards = rows(block.cards).slice(0, 6);
  const heading = text(block.heading);
  return (
    <Section labelledBy={heading ? id : undefined}>
      <SectionHead id={id} heading={heading} intro={text(block.intro)} standalone />
      <div className="v-tiles" data-count={cards.length}>
        {cards.map((card, cardIndex) => (
          <Reveal key={cardIndex} delay={cardIndex}>
            <article className="tile card card--raised v-tile">
              {card.icon ? <span className="tile-icon"><FeatureIcon name={card.icon} /></span> : null}
              <h3 className="card__title v-tile__title">{text(card.title)}</h3>
              <p className="card__body v-tile__body">{text(card.body)}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
