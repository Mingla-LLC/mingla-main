import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Flag, HelpCircle, Inbox, Lightbulb, Megaphone, RefreshCw } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { getAdminCommunityOverview } from "../../services/communityService";

function ageHours(value) {
  return value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000)) : 0;
}
function tone(hours, targetHours = 24) {
  const left = targetHours - hours;
  if (left < 2) return "text-[var(--color-error-700)]";
  if (left < 8) return "text-[var(--color-warning-700)]";
  return "text-[var(--color-success-700)]";
}

export function OverviewPanel({ onGoTab }) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({});
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getAdminCommunityOverview()); }
    catch (error) { addToast({ variant: "error", title: "Could not load overview", description: error?.message }); }
    finally { setLoading(false); }
  }, [addToast]);
  useEffect(() => { void load(); }, [load]);

  const cards = useMemo(() => {
    const announcement = data.last_announcement || {};
    const pushFailed = Number(announcement.channels?.push_failed || 0);
    const pushAccepted = Number(announcement.channels?.push_accepted || 0);
    return [
      { label: "Reports due", value: Number(data.reports_due || 0), note: `Oldest ${ageHours(data.reports_oldest)}h ago · 24h target`, hours: ageHours(data.reports_oldest), icon: Flag, tab: "moderation" },
      { label: "First posts waiting", value: Number(data.first_posts || 0), note: `Oldest waiting ${ageHours(data.first_posts_oldest)}h`, hours: ageHours(data.first_posts_oldest), icon: Clock3, tab: "moderation" },
      { label: "Unanswered tickets", value: Number(data.unanswered_tickets || 0), note: `Oldest idle ${ageHours(data.tickets_oldest)}h`, hours: ageHours(data.tickets_oldest), icon: Inbox, tab: "support" },
      { label: "Questions unanswered", value: Number(data.unanswered_questions || 0), note: `Waiting ${ageHours(data.questions_oldest)}h`, hours: ageHours(data.questions_oldest), icon: HelpCircle, tab: "questions" },
      { label: "Ideas to triage", value: Number(data.ideas_to_triage || 0), note: `Oldest waiting ${ageHours(data.ideas_oldest)}h`, hours: ageHours(data.ideas_oldest), icon: Lightbulb, tab: "ideas" },
      { label: "Last announcement", value: `${pushFailed} / ${pushAccepted + pushFailed}`, note: pushFailed ? "Pushes failed · Retry delivery" : "Push delivery is healthy", hours: pushFailed ? 99 : 0, icon: Megaphone, tab: "announcements", forceError: pushFailed > 0 },
    ];
  }, [data]);
  const needsYou = cards.filter((card) => Number(card.value) > 0 || card.forceError).sort((left, right) => right.hours - left.hours);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  return <div className="space-y-5">
    <div className="flex justify-end"><Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void load()}>Refresh</Button></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
      {cards.map((card) => { const Icon = card.icon; return <button key={card.label} type="button" onClick={() => onGoTab?.(card.tab)} className="min-h-28 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3 text-left transition hover:border-[var(--color-brand-300)] hover:shadow-sm"><div className="flex items-start justify-between gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-600)]"><Icon className="h-4 w-4" /></span><strong className="text-2xl text-[var(--color-text-primary)]">{card.value}</strong></div><p className="mt-2 text-xs font-semibold text-[var(--color-text-primary)]">{card.label}</p><p className={`mt-1 text-[11px] ${card.forceError ? "text-[var(--color-error-700)]" : tone(card.hours)}`}>{card.note}</p></button>; })}
    </div>
    <SectionCard title="Needs you" subtitle="Oldest and most urgent first">{needsYou.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Nothing needs attention right now.</p> : <ul className="divide-y divide-[var(--gray-200)]">{needsYou.map((item) => <li key={item.label} className="flex flex-wrap items-center gap-3 py-3"><Badge variant={item.forceError ? "error" : item.hours >= 16 ? "warning" : "info"}>{item.label}</Badge><span className="min-w-0 flex-1 text-sm text-[var(--color-text-secondary)]">{item.note}</span><Button size="sm" variant="secondary" onClick={() => onGoTab?.(item.tab)}>Open</Button></li>)}</ul>}</SectionCard>
  </div>;
}
