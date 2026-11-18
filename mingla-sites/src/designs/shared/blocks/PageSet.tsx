import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { Arrow, Blk, Go, Photo, rows, SecHead, sectionId, text, type SharedBlockProps } from "../parts";

/*
 * #4453 milestone 7b (spec v2.1 §1.1, §1.3) — the page-set blocks, drawn once
 * for every design from token variables only:
 *   `page_links:cards` / `page_links:list` — "Keep exploring": the pages the
 *     builder picked from the menu at publish (never typed). A page without a
 *     description is drawn as a list row even in `cards`.
 *   `facts_table:split` — the owner's own facts (setup Q8), verbatim; a row
 *     with no value is not drawn.
 */
type PageLink = { label: string; href: string; description: string; media: unknown };

export function pageLinkItems(value: unknown): PageLink[] {
  return rows(value)
    .map((row) => ({ label: text(row.label), href: text(row.href), description: text(row.description), media: row.media_url }))
    .filter((row) => row.label && row.href && isSafeHref(row.href))
    .slice(0, 4);
}

function PageLinks({ block, index, ctx, list }: SharedBlockProps & { list: boolean }) {
  const items = pageLinkItems(block.items);
  if (items.length < 2) return null;
  const id = sectionId(block, index);
  return (
    <Blk id={id} className={`mg-plinks mg-plinks--${list ? "list" : "cards"}`} labelledBy={`${id}-h`}>
      <SecHead id={`${id}-h`} eyebrow={text(block.eyebrow)} heading={text(block.heading) || "Keep exploring"} />
      <ul className="mg-plinks__list">
        {items.map((item, itemIndex) => {
          const asCard = !list && Boolean(item.description);
          return (
            <li key={`${item.href}-${itemIndex}`} className={asCard ? "mg-plink mg-plink--card" : "mg-plink mg-plink--row"} data-mg-rise="">
              <Go href={item.href} className="mg-plink__a">
                {asCard && item.media ? <span className="mg-plink__m"><Photo artifact={ctx.artifact} url={item.media} alt="" sizes="(max-width: 720px) 100vw, 25vw" /></span> : null}
                <span className="mg-plink__t">{item.label}</span>
                {item.description ? <span className="mg-plink__d">{item.description}</span> : null}
                <span className="mg-plink__go" aria-hidden="true"><Arrow /></span>
              </Go>
            </li>
          );
        })}
      </ul>
    </Blk>
  );
}

export function PageLinksCards(props: SharedBlockProps) {
  return <PageLinks {...props} list={false} />;
}

export function PageLinksList(props: SharedBlockProps) {
  return <PageLinks {...props} list />;
}

export function factRows(value: unknown): Array<{ label: string; value: string }> {
  return rows(value)
    .map((row) => ({ label: text(row.label), value: text(row.value) }))
    .filter((row) => row.label && row.value)
    .slice(0, 8);
}

/** `facts_table:split` — heading on one side, the owner's facts on the other. */
export function FactsTableSplit({ block, index }: SharedBlockProps) {
  const facts = factRows(block.items);
  if (!facts.length) return null;
  const id = sectionId(block, index);
  return (
    <Blk id={id} className="mg-facts" labelledBy={`${id}-h`}>
      <div className="mg-facts__grid">
        <SecHead id={`${id}-h`} eyebrow={text(block.eyebrow)} heading={text(block.heading) || "Good to know"} />
        <dl className="mg-facts__list">
          {facts.map((fact, factIndex) => (
            <div key={factIndex} className="mg-fact" data-mg-rise="">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Blk>
  );
}
