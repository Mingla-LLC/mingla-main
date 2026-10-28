import { isSafeHref } from "../../../contracts/generated/safety.ts";

/*
 * #2829 W7 (AD-4) — the design-neutral layouts of the restaurant blocks
 * (menu, menu taster, menu link, reservation, hours, ticker, contact button)
 * for designs without a restaurant layout of their own (voyage). The menu is
 * shown read-only: online ordering stays with the restaurant design, which
 * draws the cart. Prices are Mingla's, in their own currency, or absent.
 */
type Block = Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export function menuPrice(minor: unknown, currency: unknown): string | null {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
  } catch {
    return null;
  }
}

function Shell({ block, children, fallback = "" }: { block: Block; children: React.ReactNode; fallback?: string }) {
  const heading = text(block.heading) || fallback;
  return (
    <section className="nb-block">
      <div className="nb-shell">
        {text(block.eyebrow) && text(block.eyebrow) !== heading ? <p className="eyebrow">{text(block.eyebrow)}</p> : null}
        {heading ? <h2>{heading}</h2> : null}
        {children}
      </div>
    </section>
  );
}

function Action({ href, label }: { href: unknown; label: string }) {
  if (!isSafeHref(href) || !label) return null;
  return <p className="nb-action"><a className="btn btn--primary" href={href}>{label}</a></p>;
}

export function MenuNeutral({ block }: { block: Block }) {
  const sectionLimit = typeof block.section_limit === "number" ? block.section_limit : undefined;
  const itemLimit = typeof block.item_limit === "number" ? block.item_limit : undefined;
  return (
    <Shell block={block} fallback="Menu">
      {text(block.note) ? <p className="nb-note">{text(block.note)}</p> : null}
      {rows(block.sections).slice(0, sectionLimit).map((section, sectionIndex) => (
        <div className="nb-menu-section" key={sectionIndex}>
          <h3>{text(section.name)}</h3>
          {text(section.description) ? <p className="nb-note">{text(section.description)}</p> : null}
          <ul className="nb-menu">
            {rows(section.items).slice(0, itemLimit).map((item, itemIndex) => {
              const price = menuPrice(item.price_minor, item.currency);
              return (
                <li key={itemIndex}>
                  <span className="nb-menu-name">{text(item.name)}</span>
                  {price ? <span className="nb-menu-price">{price}</span> : null}
                  {text(item.description) ? <span className="nb-note">{text(item.description)}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <Action href={block.cta_href} label={text(block.cta_label)} />
    </Shell>
  );
}

export function LinkNeutral({ block }: { block: Block }) {
  const href = block.type === "venue_reservation" ? block.url : block.href;
  const label = block.type === "venue_reservation" ? "Continue with Mingla" : text(block.label);
  return (
    <Shell block={block}>
      {text(block.body) ? <p>{text(block.body)}</p> : null}
      <Action href={href} label={label} />
    </Shell>
  );
}

export function HoursNeutral({ block }: { block: Block }) {
  return (
    <Shell block={block} fallback="Hours & location">
      <p>{text(block.address)}</p>
      <dl className="nb-hours">
        {rows(block.hours).map((row, index) => <div key={index}><dt>{text(row.day)}</dt><dd>{text(row.value)}</dd></div>)}
      </dl>
      {isSafeHref(block.map_url) ? <p><a className="link" href={block.map_url}>Open map</a></p> : null}
    </Shell>
  );
}

export function TickerNeutral({ block }: { block: Block }) {
  const phrases = rows(block.phrases).map((row) => text(row.text)).filter(Boolean);
  if (phrases.length < 2) return null;
  return (
    <section className="nb-block nb-ticker">
      <ul className="nb-shell">{phrases.map((phrase, index) => <li key={index}>{phrase}</li>)}</ul>
    </section>
  );
}
