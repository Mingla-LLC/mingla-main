import { useMemo } from "react";
import { DataTable } from "../ui/Table";
import { StageBadge } from "./StageBadge";
import { DueBadge } from "./DueBadge";
import { displayOwners, icpLabel, regionName, sortForList } from "../../lib/crmModel";

const MUTED = "text-[var(--color-text-muted)]";

/**
 * The list view. Sorted by due date (overdue first, no date last), then name.
 * A click anywhere on a row opens the card; with a keyboard, the name is a
 * button, so Tab then Enter opens it.
 */
export function PipelineList({ def, records, regions, team, today, loading = false, onOpen }) {
  const rows = useMemo(() => sortForList(records), [records]);
  const singular = def?.singular === "creator" ? "Creator" : "Host";

  const columns = useMemo(
    () => [
      {
        key: "name",
        label: singular,
        render: (_v, row) => (
          <button
            type="button"
            data-open-record={row.id}
            onClick={() => onOpen(row)}
            title={row.name}
            className="flex min-h-11 w-full max-w-full cursor-pointer items-center truncate rounded text-left font-semibold text-[var(--color-text-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
          >
            {row.name}
          </button>
        ),
      },
      { key: "icp", label: "ICP", render: (_v, row) => icpLabel(def, row.icp) || <span className={MUTED}>None</span> },
      {
        key: "region_id",
        label: "Region",
        render: (_v, row) => regionName(regions, row.region_id) || <span className={MUTED}>None</span>,
      },
      { key: "stage", label: "Stage", render: (_v, row) => <StageBadge def={def} stage={row.stage} /> },
      { key: "owners", label: "Owners", render: (_v, row) => displayOwners(row, team) },
      {
        key: "next_action",
        label: "Next action",
        render: (_v, row) => row.next_action || <span className={MUTED}>None</span>,
      },
      {
        key: "due_on",
        label: "Due",
        render: (_v, row) =>
          row.due_on ? <DueBadge dueOn={row.due_on} today={today} /> : <span className={MUTED}>None</span>,
      },
    ],
    [def, regions, team, today, onOpen, singular]
  );

  // DataTable has no row handler of its own; one listener on the wrapper turns
  // a click anywhere in a row into "open that card".
  const handleClick = (e) => {
    if (e.target.closest("button, a, input, select")) return;
    const row = e.target.closest("tr");
    const id = row?.querySelector("[data-open-record]")?.getAttribute("data-open-record");
    const record = id ? rows.find((r) => r.id === id) : null;
    if (record) onOpen(record);
  };

  return (
    <div onClick={handleClick}>
      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        getRowId={(r) => r.id}
        rowClassName={() => "cursor-pointer"}
        emptyMessage="Nothing to show."
      />
    </div>
  );
}
