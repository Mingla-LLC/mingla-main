// Issue #3980 (R7, G5) — Needs attention, its own tab on Work (never stacked
// with the board): a chip per group with its count (the count is the length
// of the list the server sent), the selected group's list with a one-click
// fix (Assign to me, Fill in) and Open, a prompt for your agent, and the
// live totals line.
import { useState } from "react";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import { setOwners } from "../../services/crmService";
import { buildCrmHash } from "../../lib/crmUrl";
import { ATTENTION_GROUPS, attentionCounts, attentionPrompt, opsErrorWords } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";


export function AttentionChips({ data, selected, onPick, onlyHot = false }) {
  const counts = attentionCounts(data);
  return (
    <div role={onlyHot ? undefined : "group"} aria-label={onlyHot ? undefined : "Needs attention groups"} className="flex min-w-0 flex-wrap gap-1.5">
      {ATTENTION_GROUPS.filter((g) => !onlyHot || counts[g.key] > 0).map((g) => (
        <button
          key={g.key}
          type="button"
          aria-pressed={onlyHot ? undefined : selected === g.key}
          onClick={() => onPick(g.key)}
          className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold ${selected === g.key && !onlyHot ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-background-primary)]" : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]"} ${FOCUS}`}
        >
          {g.label}
          <b className={`tabular-nums ${selected === g.key && !onlyHot ? "" : counts[g.key] ? "text-[var(--color-error-700)]" : ""}`}>{counts[g.key]}</b>
        </button>
      ))}
    </div>
  );
}

export function NeedsAttention({ read, group, onGroup, me, onOpenCard, online }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState("");
  const data = read.data;
  const counts = attentionCounts(data);
  const selected = group || ATTENTION_GROUPS.find((g) => counts[g.key] > 0)?.key || "noowner";
  const label = ATTENTION_GROUPS.find((g) => g.key === selected)?.label || "";
  const items = Array.isArray(data?.groups?.[selected]) ? data.groups[selected] : [];
  const totals = data?.live_totals || null;

  const assignToMe = async (item) => {
    if (!me) return;
    setBusy(item.id);
    try {
      if (item.kind === "host") await setOwners(item.id, [me]);
      else {
        const card = (await ops.getWork(item.id))?.card;
        await ops.updateWork(item.id, { owners: [...new Set([...(card?.owners || []).map((p) => p.email), me])] }, card?.revision);
      }
      addToast({ variant: "success", title: `${item.title} is yours now.` });
      await read.refetch({ quiet: true });
    } catch (error) {
      addToast({ variant: "error", title: "Not assigned", description: opsErrorWords(error) });
    } finally { setBusy(""); }
  };
  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(attentionPrompt(label)); addToast({ variant: "success", title: "Prompt copied. Paste it to your agent." }); }
    catch { addToast({ variant: "error", title: "Couldn’t copy", description: attentionPrompt(label) }); }
  };

  if (read.loading && !data) return <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading Needs attention"><Skeleton height={44} /><Skeleton height={56} /><Skeleton height={56} /></div>;
  if (read.error && !data) return <AlertCard variant="error" title="Couldn’t load Needs attention" action={<Button variant="secondary" className="min-h-11" onClick={() => read.refetch()}>Try again</Button>}>{opsErrorWords(read.error)}</AlertCard>;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <AttentionChips data={data} selected={selected} onPick={onGroup} />
        <Button variant="secondary" size="sm" className="min-h-11" onClick={copyPrompt}>Ask my agent to fix these</Button>
      </div>
      <section aria-labelledby="attention-list-heading" className="min-w-0 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
        <h2 id="attention-list-heading" className="flex items-center justify-between border-b border-[var(--gray-200)] px-4 py-2.5 text-[13px] font-semibold text-[var(--color-text-primary)]">
          <span>{label}</span><span className="tabular-nums text-[var(--color-text-tertiary)]">{items.length}</span>
        </h2>
        {items.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-[var(--color-text-tertiary)]">All clear.</p>
        ) : (
          <ul className="divide-y divide-[var(--gray-100)]">
            {items.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13.5px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{item.title}</span>
                  <span className={`block text-[12.5px] text-[var(--color-text-tertiary)] ${WORDS}`}>{item.reason}</span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {item.fix === "assign_me" && me && <Button variant="secondary" size="sm" className="min-h-11" disabled={!online || busy === item.id} loading={busy === item.id} onClick={() => assignToMe(item)}>Assign to me</Button>}
                  {item.fix === "fill_in" && <a href={buildCrmHash("hosts", { card: item.id, fill: true })} className={`inline-flex min-h-11 items-center rounded-full border border-[var(--gray-300)] px-3 text-[12.5px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}>Fill in</a>}
                  {item.kind === "host"
                    ? <a href={buildCrmHash("hosts", { card: item.id })} className={`inline-flex min-h-11 items-center rounded-full px-3 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Open</a>
                    : <button type="button" onClick={() => onOpenCard(item.id)} className={`inline-flex min-h-11 items-center rounded-full px-3 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Open</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {totals && (
        <p className={`text-[12.5px] text-[var(--color-text-tertiary)] ${WORDS}`}>
          On the live board today: {totals.hosts_no_owner} hosts with no owner · {totals.overdue} overdue · {totals.no_contact} with no contact · {totals.no_region} with no region · {totals.no_icp} with no type · {totals.brands_without_card} brands on Mingla with no host card.
        </p>
      )}
    </div>
  );
}
