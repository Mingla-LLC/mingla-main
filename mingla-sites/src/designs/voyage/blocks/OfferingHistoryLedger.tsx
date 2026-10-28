import { formatCalendarDay } from "../../../contracts/generated/collections.ts";
import { historyLedger, ledgerDepartureCount } from "../../../contracts/generated/history.ts";
import { formatDayRange, HeadRow, rows, Section, sectionId, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — offering_history `ledger`: the record of trips already run, as
 * a register on a white panel laid on a tinted band. The total is COUNTED
 * from the rows (never typed), with the span from the first to the latest
 * departure; a run of the same trip is one row listing every departure.
 * Nothing here can be booked. A row shows "See the trip" (its Mingla page)
 * only when the owner chose to link it.
 */
export function OfferingHistoryLedger({ block, index, ctx }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const live = ctx.live;
  const language = ctx.artifact.language;
  const kind = ["trip", "event", "experience", "all"].includes(text(block.kind)) ? (text(block.kind) as "trip") : "trip";
  const series = rows(block.series).map((row) => ({ label: text(row.label), offering_ids: rows(row.offering_ids).map((item) => ({ id: text(item.id) })) }));
  const linked = new Set(rows(block.linked_offering_ids).map((row) => text(row.id)));
  const entries = live ? historyLedger(live.offerings, live.now, { kind, series, offering_ids: rows(block.offering_ids).map((row) => ({ id: text(row.id) })) }) : [];
  const link = { label: text(block.cta_label), href: block.cta_href };
  if (!entries.length) {
    return (
      <Section tinted labelledBy={id} source={live?.source ?? "none"}>
        <HeadRow id={id} heading={text(block.heading)} intro={text(block.intro)} link={link} />
        <div className="history on-light"><p className="history__span">{live ? "Nothing to show here yet." : "This list is unavailable right now."}</p></div>
      </Section>
    );
  }
  const total = ledgerDepartureCount(entries);
  const dates = entries.flatMap((entry) => (entry.kind === "series" ? entry.departures.map((d) => d.date) : [entry.departure.date]))
    .filter((date): date is string => Boolean(date))
    .sort();
  const span = formatDayRange(dates[0] ?? null, dates[dates.length - 1] ?? null, language);
  return (
    <Section tinted labelledBy={id} source={live?.source ?? "none"}>
      <HeadRow id={id} heading={text(block.heading)} intro={text(block.intro)} link={link} />
      <div className="history on-light">
        <p className="history__stat">
          <span className="history__count tnum">{total}</span>{" "}
          <span className="history__unit">{total === 1 ? "trip run" : "trips run"}</span>{" "}
          {span ? <span className="history__span tnum">{span}</span> : null}
        </p>
        <ol className="history__list">
          {entries.map((entry) => {
            if (entry.kind === "series") {
              return (
                <li key={entry.key} className="history__row">
                  <p className="history__date tnum">{formatDayRange(entry.first, entry.last, language)}</p>
                  <div>
                    <h3 className="history__title">{entry.name}</h3>
                    <p className="history__place">{entry.place ? `${entry.place} · ` : ""}{entry.departures.length} departures</p>
                    <ul className="history__runs">
                      {[...entry.departures].reverse().map((run) => (
                        <li key={run.id} className="history__run">
                          <span className="history__run-date tnum">{run.date ? <time dateTime={run.date}>{formatCalendarDay(run.date, language)}</time> : null}</span>
                          <span className="history__run-name">{run.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            }
            const departure = entry.departure;
            return (
              <li key={entry.key} className="history__row">
                <p className="history__date tnum">{departure.date ? <time dateTime={departure.date}>{formatCalendarDay(departure.date, language)}</time> : null}</p>
                <div>
                  <h3 className="history__title">{departure.title}</h3>
                  {departure.place ? <p className="history__place">{departure.place}</p> : null}
                  {linked.has(departure.id) ? <p className="v-history__link"><a href={departure.href} className="link">See the trip</a></p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Section>
  );
}
