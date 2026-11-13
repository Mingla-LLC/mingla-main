// Issue #4419 — where the people went: matched down to accepted, the sending
// progress, what happened after it left us (Part B), and the raw provider
// error folded away for engineering.
import { deliveryHeadline, engagementView, funnelRows } from "./campaignModel";

function Big({ cells }) {
  return (
    <div className="mb-3.5 grid grid-cols-3 gap-2">
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col gap-0.5 rounded-xl bg-[var(--gray-50)] p-2.5">
          <b className={`text-lg font-bold tabular-nums ${cell.tone === "ok" ? "text-[var(--color-success-700)]" : cell.tone === "bad" ? "text-[var(--color-error-700)]" : "text-[var(--color-text-primary)]"}`}>{cell.value}</b>
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{cell.label}</span>
        </div>
      ))}
    </div>
  );
}

export function DeliveryCard({ detail }) {
  const head = deliveryHeadline(detail);
  const rows = funnelRows(detail);
  const after = engagementView(detail);
  const raw = detail?.failure?.raw;
  return (
    <section aria-label="Delivery" className="rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-[18px]">
      <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">Delivery</h3>
      {head.kind === "progress" ? (
        <div data-progress={head.pct}>
          <div className="flex justify-between text-[13px]">
            <b className="tabular-nums text-[var(--color-text-primary)]">{head.words}</b>
            <span className="tabular-nums text-[var(--color-text-tertiary)]">{head.pct}%</span>
          </div>
          <div role="progressbar" aria-label="Sending progress" aria-valuemin={0} aria-valuemax={head.total} aria-valuenow={head.done} className="my-1.5 h-2 overflow-hidden rounded-full bg-[var(--gray-100)]">
            <i className="block h-full rounded-full bg-[#f59e0b] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${head.pct}%` }} />
          </div>
          <p className="mb-3 text-xs text-[var(--color-text-tertiary)]">{head.note}</p>
        </div>
      ) : (
        <>
          <Big cells={head.cells} />
          {head.note ? <p className="-mt-1 mb-3 text-xs text-[var(--color-text-tertiary)]">{head.note}</p> : null}
        </>
      )}
      <div className="flex flex-col text-[13px]">
        {rows.map((row, i) => (
          <div key={`${row.label}-${i}`} className={`flex justify-between py-[7px] ${i === 0 ? "" : row.kind === "total" ? "border-t border-[var(--gray-300)] font-semibold" : "border-t border-dashed border-[var(--gray-200)]"}`}>
            <span className={row.kind === "minus" ? "pl-3 text-[var(--color-text-tertiary)]" : row.kind === "total" ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}>{row.kind === "minus" ? `− ${row.label}` : row.label}</span>
            <b className="font-medium tabular-nums text-[var(--color-text-primary)]">{row.value}</b>
          </div>
        ))}
      </div>
      {after ? (
        <div data-after-it-left="" className="mt-4 border-t border-[var(--gray-200)] pt-3.5">
          <h4 className="mb-2 text-[13px] font-semibold text-[var(--color-text-primary)]">After it left us</h4>
          {after.state === "ready" ? (
            <>
              <div className="flex flex-col gap-2 text-[13px]">
                {after.rows.map((row) => (
                  <div key={row.label} className="flex justify-between gap-3">
                    <span className="text-[var(--color-text-secondary)]">
                      {row.label}
                      {row.sub ? <span className="block text-xs text-[var(--color-text-tertiary)]">{row.sub}</span> : null}
                    </span>
                    <b className="font-medium tabular-nums text-[var(--color-text-primary)]">{row.value}</b>
                  </div>
                ))}
              </div>
              {after.links.length ? (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">Top links</p>
                  <ul className="flex flex-col gap-1 text-xs">
                    {after.links.map((link) => (
                      <li key={link.url} className="flex justify-between gap-3">
                        <span className="min-w-0 break-all text-[var(--color-text-secondary)]">{link.url}</span>
                        <span className="shrink-0 tabular-nums text-[var(--color-text-tertiary)]">{link.words}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-2.5 text-[11px] text-[var(--color-text-tertiary)]">{after.note}</p>
            </>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)]">{after.text}</p>
          )}
        </div>
      ) : null}
      {raw ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-[var(--color-text-tertiary)]">Technical detail for engineering</summary>
          <div className="mt-2.5 break-words rounded-lg bg-[var(--gray-50)] px-2.5 py-2 font-mono text-[11px] text-[var(--color-text-tertiary)]">{raw}</div>
        </details>
      ) : null}
    </section>
  );
}
