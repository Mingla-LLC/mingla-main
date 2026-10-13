import { useMemo } from "react";
import { byRegionTable } from "../../lib/crmModel";

/**
 * Counts per region and stage. Choosing a region opens the board filtered to
 * it (the region's name is a button, so it works with a keyboard too).
 */
export function PipelineByRegion({ def, records, regions, onPickRegion }) {
  const rows = useMemo(() => byRegionTable(def, records, regions), [def, records, regions]);
  const th =
    "px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--table-header-bg)] border-b border-[var(--table-border)] whitespace-nowrap";

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left`}>
                Region
              </th>
              {def.stages.map((s) => (
                <th key={s.id} scope="col" className={`${th} text-right`}>
                  {s.label}
                </th>
              ))}
              <th scope="col" className={`${th} text-right`}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.regionId}
                onClick={() => onPickRegion(row.slug)}
                className="cursor-pointer border-b border-[var(--table-border)] transition-colors duration-150 hover:bg-[var(--table-row-hover)]"
              >
                <th scope="row" className="px-3 py-2 text-left font-semibold text-[var(--color-text-primary)]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPickRegion(row.slug);
                    }}
                    aria-label={`Open the board for ${row.name}`}
                    className="inline-flex min-h-10 cursor-pointer items-center rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
                  >
                    {row.name}
                  </button>
                </th>
                {def.stages.map((s) => (
                  <td
                    key={s.id}
                    className={`px-3 py-2 text-right tabular-nums ${row.counts[s.id] ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"}`}
                  >
                    {row.counts[s.id]}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--color-text-primary)]">
                  {row.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
