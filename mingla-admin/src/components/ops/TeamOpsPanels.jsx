// Issue #3980 — the Team dashboard's work panels, above the pipeline numbers:
// Runway (what is public in time, what is at risk), this week's Sprint by
// person, and the host cards nobody owns. The owner also gets the one-time
// "Turn next steps into cards": a preview first, then a convert of only the
// rows the owner ticks and confirms. Nothing is converted without that.
import { Fragment, useState } from "react";
import { Copy } from "lucide-react";
import { AlertCard, SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { useToast } from "../../context/ToastContext";
import { useOpsConfig } from "../../hooks/useOpsConfig";
import { useOpsTeamOverview } from "../../hooks/useOpsWork";
import * as ops from "../../services/opsService";
import {
  HOSTS_WITHOUT_OWNER_PROMPT,
  bandShort,
  bandTone,
  conversionIssue,
  conversionResultWords,
  conversionSelectable,
  dayLabel,
  hostsWithoutOwnerWords,
  opsErrorWords,
  requestKey,
  sprintLabel,
} from "../../lib/opsModel";
import { OpsChip } from "./OpsChip";

// Two teammates with the same name are told apart by their address.
function sameName(person, list) {
  const name = String(person?.name || "").trim().toLowerCase();
  return !!name && (Array.isArray(list) ? list : []).some((x) => x.email !== person.email && String(x.name || "").trim().toLowerCase() === name);
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const LINK = `inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`;

function Skeleton({ label }) {
  return (
    <SectionCard>
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">{label}</span>
        <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--gray-100)]" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--gray-100)]" />
      </div>
    </SectionCard>
  );
}

function RunwayPanel({ runway }) {
  const counts = runway?.counts || {};
  const atRisk = Array.isArray(runway?.at_risk) ? runway.at_risk : [];
  return (
    <SectionCard title="Runway" subtitle="Next 90 days" action={<a href="#/content-calendar" className={LINK}>Open calendar</a>}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <OpsChip tone="success">{counts.full || 0} ready to promote</OpsChip>
          <OpsChip tone="warning">{counts.tight || 0} promote now</OpsChip>
          <OpsChip tone="error">{(counts.organic || 0) + (counts.missed || 0)} too late for promo</OpsChip>
          <OpsChip tone="info">{counts.not_live || 0} not live yet</OpsChip>
        </div>
        {atRisk.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Nothing at risk: every event in the next 90 days is public in time or has more than two weeks to go live.</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1">
            {atRisk.map((row) => (
              <li key={`${row.anchor_kind}:${row.anchor_id}`}>
                <a
                  href={`#/content-calendar?event=${row.anchor_kind}:${row.anchor_id}&month=${String(row.start_on || "").slice(0, 7)}`}
                  className={`flex min-h-11 min-w-0 items-start justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--gray-50)] ${FOCUS}`}
                >
                  <span className="min-w-0 break-words text-[13px] text-[var(--color-text-primary)]">
                    {row.title} · {dayLabel(row.start_on)}{Array.isArray(row.owners) && row.owners.length ? ` · ${row.owners.join(", ")}` : " · no owner"}
                  </span>
                  <OpsChip tone={bandTone(row.band)} dashed={row.anchor_kind === "expected" || row.band === "missed"}>{bandShort(row)}</OpsChip>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

function SprintPanel({ sprint, hostsWithoutOwner }) {
  const { addToast } = useToast();
  const people = Array.isArray(sprint?.by_person) ? sprint.by_person : [];
  const ownerless = hostsWithoutOwnerWords(hostsWithoutOwner);
  return (
    <SectionCard title={sprintLabel(sprint?.week || "")} action={<a href="#/work-board" className={LINK}>Open board</a>}>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="break-words text-[13px] text-[var(--color-text-secondary)]">{sprint?.goal || "No goal set"}</p>
        {people.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Nobody is on the team yet.</p>
        ) : (
          <table className="w-full table-fixed text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <th scope="col" className="w-[34%] py-1 font-semibold">Person</th>
                <th scope="col" className="py-1 font-semibold">Open</th>
                <th scope="col" className="py-1 font-semibold">Needs a person</th>
                <th scope="col" className="py-1 font-semibold">Agent closed</th>
                <th scope="col" className="py-1 font-semibold">Carried</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--gray-100)]">
              {people.map((p) => (
                <Fragment key={p.email}>
                <tr>
                  <th scope="row" className="break-words py-1.5 font-medium text-[var(--color-text-primary)]">{p.name}{sameName(p, people) && <span className="sr-only"> ({p.email})</span>}</th>
                  <td className="py-1.5 tabular-nums">{p.open}</td>
                  <td className="py-1.5 tabular-nums">{p.needs_person}</td>
                  <td className="py-1.5 tabular-nums">{p.closed_by_agent}</td>
                  <td className="py-1.5 tabular-nums">{p.carried}</td>
                </tr>
                {/* Two teammates with one name: the address on its own line, the whole table wide, so it never breaks mid-word. */}
                {sameName(p, people) && <tr aria-hidden="true" className="!border-t-0"><td colSpan={5} className="pb-1.5 pt-0 text-[11.5px] text-[var(--color-text-tertiary)]">{p.email}</td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {ownerless && (
          <div className="flex min-w-0 flex-col gap-2 rounded-lg bg-[var(--color-warning-50)] p-3">
            <p className="break-words text-[13px] text-[var(--color-warning-700)]">{ownerless}</p>
            <p className="break-words font-mono text-[12px] text-[var(--color-text-secondary)]">{HOSTS_WITHOUT_OWNER_PROMPT}</p>
            <button
              type="button"
              onClick={async () => {
                try { await navigator.clipboard.writeText(HOSTS_WITHOUT_OWNER_PROMPT); addToast({ variant: "success", title: "Prompt copied." }); }
                catch { addToast({ variant: "error", title: "Couldn’t copy", description: "Select the text and copy it yourself." }); }
              }}
              className={`inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}
            >
              <Copy aria-hidden="true" className="h-3.5 w-3.5" /> Copy prompt
            </button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function NextStepConversion({ online, team }) {
  const { addToast } = useToast();
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState([]);
  const [fallback, setFallback] = useState("");
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];
  const selectable = rows.filter((r) => conversionSelectable(r, fallback));
  const chosen = picked.filter((id) => selectable.some((r) => r.record_id === id));

  const load = async () => {
    setState("loading"); setError(null); setResult(null);
    try {
      const answer = await ops.previewNextActions(600);
      setPreview(answer);
      setPicked((Array.isArray(answer?.rows) ? answer.rows : []).filter((r) => !r.issue).map((r) => r.record_id));
      setState("preview");
    } catch (e) { setError(e); setState("idle"); }
  };

  // The convert runs only from the confirm step, for the rows ticked there.
  const convert = async () => {
    if (state !== "confirm" || chosen.length === 0) return;
    setState("converting"); setError(null);
    try {
      const answer = await ops.convertNextActions(chosen, fallback || null, requestKey("convert"));
      setResult(answer);
      addToast({ variant: "success", title: `${answer?.added || 0} cards added. Owners were told.` });
      const fresh = await ops.previewNextActions(600);
      setPreview(fresh); setPicked([]);
      setState("preview");
    } catch (e) { setError(e); setState("confirm"); }
  };

  return (
    <SectionCard title="Turn next steps into cards" subtitle="Owner only">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-[13px] text-[var(--color-text-secondary)]">Each host or creator is converted once. Their next step text stays on the card, and the host and creator cards are not changed. Each card is titled with the next step and the name, so the same next step on two records makes two cards; a host and a creator with the same name and next step share one card.</p>
        {error && <p role="alert" className="break-words text-[13px] text-[var(--color-error-700)]">{opsErrorWords(error)}</p>}
        {result && (
          <p role="status" className="text-[13px] text-[var(--color-text-primary)]">{conversionResultWords(result)}</p>
        )}
        {state === "idle" || state === "loading" ? (
          <Button variant="secondary" className="min-h-11 self-start" disabled={!online || state === "loading"} onClick={load}>{state === "loading" ? "Loading…" : "Preview"}</Button>
        ) : (
          <>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <OpsChip tone="success">{preview?.totals?.ready || 0} ready</OpsChip>
              <OpsChip tone="warning">{preview?.totals?.no_owner || 0} no owner</OpsChip>
              <OpsChip>{preview?.totals?.already_converted || 0} already converted</OpsChip>
              <OpsChip>{preview?.totals?.skipped || 0} skipped</OpsChip>
              {preview?.totals?.truncated && <OpsChip tone="info">First {rows.length} of {preview.totals.eligible}</OpsChip>}
            </div>
            <label className="flex min-w-0 flex-col gap-1 sm:max-w-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Owner for records nobody owns</span>
              <select value={fallback} disabled={state === "converting"} onChange={(e) => setFallback(e.target.value)} className={`min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] ${FOCUS}`}>
                <option value="">Leave them out</option>
                {team.map((p) => <option key={p.email} value={p.email}>{sameName(p, team) ? `${p.name} (${p.email})` : p.name}</option>)}
              </select>
            </label>
            {rows.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-secondary)]">No open host or creator has a next step written on it.</p>
            ) : (
              <ul className="flex max-h-[480px] min-w-0 flex-col divide-y divide-[var(--gray-100)] overflow-y-auto">
                {rows.map((r) => {
                  const issue = conversionIssue(r.issue);
                  const can = conversionSelectable(r, fallback);
                  return (
                    <li key={r.record_id} className="flex min-w-0 items-start gap-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Convert the next step for ${r.name}`}
                        disabled={!can || state === "converting"}
                        checked={can && picked.includes(r.record_id)}
                        onChange={(e) => setPicked(e.target.checked ? [...picked, r.record_id] : picked.filter((id) => id !== r.record_id))}
                        className="mt-1 h-5 w-5 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[13px] font-medium text-[var(--color-text-primary)]">{r.name}</span>
                        <span className="block break-words text-[12px] text-[var(--color-text-secondary)]">{r.proposed?.title ? `Card: ${r.proposed.title}` : r.next_action}</span>
                        {r.reason && <span className="block break-words text-[12px] text-[var(--color-text-tertiary)]">{r.reason}</span>}
                        <span className="block text-[12px] text-[var(--color-text-tertiary)]">Due {dayLabel(r.proposed?.due_on)}{Array.isArray(r.owners) && r.owners.length ? ` · ${r.owners.map((o) => o.name).join(", ")}` : ""}</span>
                      </span>
                      {issue && <OpsChip tone={issue.tone}>{issue.label}</OpsChip>}
                    </li>
                  );
                })}
              </ul>
            )}
            {state === "confirm" || state === "converting" ? (
              <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] p-3">
                <p className="text-[13px] text-[var(--color-warning-700)]">Add {chosen.length} cards now? Each owner is told. This cannot be run twice for the same record.</p>
                <div className="flex flex-wrap gap-2">
                  <Button className="min-h-11" disabled={!online || state === "converting" || chosen.length === 0} onClick={convert}>{state === "converting" ? "Adding…" : `Yes, add ${chosen.length} cards`}</Button>
                  <Button variant="ghost" className="min-h-11" disabled={state === "converting"} onClick={() => setState("preview")}>Not yet</Button>
                </div>
              </div>
            ) : (
              <Button className="min-h-11 self-start" disabled={!online || chosen.length === 0} onClick={() => setState("confirm")}>Convert selected ({chosen.length})</Button>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}

export function TeamOpsPanels({ online }) {
  const overview = useOpsTeamOverview();
  const config = useOpsConfig();
  const canConvert = !!config.data?.me?.can_convert;
  const team = Array.isArray(config.data?.team) ? config.data.team : [];
  if (overview.loading) {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton label="Loading the runway…" />
        <Skeleton label="Loading the sprint…" />
      </div>
    );
  }
  if (overview.error && !overview.data) {
    return (
      <AlertCard variant="error" title="Couldn’t load the runway and the sprint" action={<Button variant="secondary" className="min-h-11" onClick={() => overview.refetch()}>Try again</Button>}>
        {opsErrorWords(overview.error)}
      </AlertCard>
    );
  }
  const data = overview.data || {};
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <RunwayPanel runway={data.runway} />
        <SprintPanel sprint={data.sprint} hostsWithoutOwner={data.hosts_without_owner} />
      </div>
      {canConvert && <NextStepConversion online={online} team={team} />}
    </div>
  );
}
