import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, RefreshCw } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { Textarea } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { listAdminCommunityPosts, updateAdminIdea } from "../../services/communityService";

const FILTERS = [
  ["new", "Needs triage"],
  ["under_review", "Under review"],
  ["planned", "Planned"],
  ["in_progress", "In progress"],
  ["shipped", "Shipped"],
  ["not_now", "Not now"],
];

const STATUS_BADGE = {
  new: "warning",
  under_review: "info",
  planned: "brand",
  in_progress: "info",
  shipped: "success",
  not_now: "default",
};

export function IdeasPanel() {
  const { addToast } = useToast();
  const [filter, setFilter] = useState("new");
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("under_review");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listAdminCommunityPosts("idea", filter);
      setRows(next);
      setSelectedId((current) => next.some((row) => row.id === current) ? current : next[0]?.id || null);
    } catch (error) {
      addToast({ variant: "error", title: "Could not load ideas", description: error?.message });
    } finally {
      setLoading(false);
    }
  }, [addToast, filter]);

  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  useEffect(() => {
    if (!selected) return;
    setStatus(selected.workflow_status === "new" ? "under_review" : selected.workflow_status);
    setResponse(selected.public_response || "");
  }, [selected]);

  async function save({ mergeInto = null, promote = false } = {}) {
    if (!selected) return;
    if (status === "not_now" && !response.trim()) {
      addToast({ variant: "warning", title: "Explain why this is not planned" });
      return;
    }
    setBusy(true);
    try {
      const result = await updateAdminIdea({
        postId: selected.id,
        status,
        publicResponse: response,
        mergeInto,
        promote,
      });
      addToast({
        variant: "success",
        title: mergeInto ? "Ideas merged" : promote ? "Roadmap draft created" : "Idea updated",
        description: `${result?.notified ?? 0} voter${result?.notified === 1 ? "" : "s"} notified.`,
      });
      await load();
    } catch (error) {
      addToast({ variant: "error", title: "Could not update idea", description: error?.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([id, label]) => (
          <Button key={id} size="sm" variant={filter === id ? "primary" : "secondary"} onClick={() => setFilter(id)}>{label}</Button>
        ))}
        <Button className="ml-auto" size="sm" variant="secondary" icon={RefreshCw} onClick={() => void load()}>Refresh</Button>
      </div>
      {loading ? <div className="flex justify-center py-12"><Spinner /></div> : rows.length === 0 ? (
        <SectionCard title="No ideas in this view"><p className="text-sm text-[var(--color-text-secondary)]">Ideas will appear here when Hosts submit or staff update them.</p></SectionCard>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(340px,1fr)_minmax(360px,0.9fr)]">
          <SectionCard title={`${rows.length} idea${rows.length === 1 ? "" : "s"}`} noPadding>
            <div className="divide-y divide-[var(--gray-200)]">
              {rows.map((row) => (
                <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`w-full p-4 text-left ${row.id === selectedId ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-12 shrink-0 text-center"><strong className="block text-lg">{row.vote_count}</strong><span className="text-[11px] text-[var(--color-text-tertiary)]">votes</span></div>
                    <div className="min-w-0 flex-1"><p className="font-semibold text-[var(--color-text-primary)]">{row.title}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{row.author_label} · {row.comment_count} comments</p></div>
                    <Badge variant={STATUS_BADGE[row.workflow_status] || "default"}>{row.workflow_status.replaceAll("_", " ")}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>
          {selected ? (
            <SectionCard title={selected.title}>
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{selected.body}</p>
                <label className="block text-sm font-medium">Status
                  <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm">
                    {FILTERS.filter(([id]) => id !== "new").map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
                <Textarea label="Response from Mingla · public" value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Tell Hosts where this stands and why." rows={5} />
                {selected.duplicate_hint ? (
                  <div className="rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] p-3 text-sm">
                    <p>Possible duplicate: <strong>{selected.duplicate_hint.title}</strong> ({selected.duplicate_hint.votes} votes)</p>
                    <Button className="mt-2" size="sm" variant="secondary" icon={ArrowRight} loading={busy} onClick={() => void save({ mergeInto: selected.duplicate_hint.id })}>Merge into this idea</Button>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" loading={busy} onClick={() => void save({ promote: true })}>Promote to roadmap</Button>
                  <Button className="ml-auto" icon={Check} loading={busy} onClick={() => void save()}>Save and tell {selected.vote_count} voters</Button>
                </div>
              </div>
            </SectionCard>
          ) : null}
        </div>
      )}
    </div>
  );
}

