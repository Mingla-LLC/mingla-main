import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, MessageCircle, Pin, RefreshCw } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { Textarea } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { listAdminCommunityPosts, runAdminQuestionAction } from "../../services/communityService";

const FILTERS = [["unanswered", "Unanswered"], ["all", "All"], ["answered", "Answered by Mingla"], ["locked", "Locked"]];

function waitedSince(value) {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000));
  return hours < 24 ? `${hours}h unanswered` : `${Math.floor(hours / 24)}d unanswered`;
}

export function QuestionsPanel() {
  const { addToast } = useToast();
  const [filter, setFilter] = useState("unanswered");
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listAdminCommunityPosts("question", filter);
      setRows(next);
      setSelectedId((current) => next.some((row) => row.id === current) ? current : next[0]?.id || null);
    } catch (error) {
      addToast({ variant: "error", title: "Could not load questions", description: error?.message });
    } finally { setLoading(false); }
  }, [addToast, filter]);
  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);

  async function act(action) {
    if (!selected) return;
    if (action === "answer" && !answer.trim()) return;
    setBusy(true);
    try {
      await runAdminQuestionAction({ postId: selected.id, action, answer });
      addToast({ variant: "success", title: action === "answer" ? "Answer posted as Mingla team" : `Question ${action}ed` });
      setAnswer("");
      await load();
    } catch (error) {
      addToast({ variant: "error", title: "Could not update question", description: error?.message });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([id, label]) => <Button key={id} size="sm" variant={filter === id ? "primary" : "secondary"} onClick={() => setFilter(id)}>{label}</Button>)}
        <Button className="ml-auto" size="sm" variant="secondary" icon={RefreshCw} onClick={() => void load()}>Refresh</Button>
      </div>
      {loading ? <div className="flex justify-center py-12"><Spinner /></div> : rows.length === 0 ? (
        <SectionCard title="No questions in this view"><p className="text-sm text-[var(--color-text-secondary)]">New Host questions will appear here.</p></SectionCard>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(340px,1fr)_minmax(360px,0.9fr)]">
          <SectionCard title={`${rows.length} question${rows.length === 1 ? "" : "s"}`} noPadding>
            <div className="divide-y divide-[var(--gray-200)]">
              {rows.map((row) => (
                <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`w-full p-4 text-left ${row.id === selectedId ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}>
                  <p className="font-semibold text-[var(--color-text-primary)]">{row.title}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]"><span>{row.author_label} · {row.comment_count} answers</span>{row.staff_answered ? <Badge variant="success">Mingla answered</Badge> : <Badge variant="warning">{waitedSince(row.created_at)}</Badge>}</div>
                </button>
              ))}
            </div>
          </SectionCard>
          {selected ? (
            <SectionCard title={selected.title} action={<div className="flex gap-1"><Button size="sm" variant="secondary" icon={Pin} onClick={() => void act(selected.pinned ? "unpin" : "pin")}>{selected.pinned ? "Unpin" : "Pin"}</Button><Button size="sm" variant="secondary" icon={Lock} onClick={() => void act(selected.locked ? "unlock" : "lock")}>{selected.locked ? "Unlock" : "Lock"}</Button><Button size="sm" variant="secondary" onClick={() => void act("hide")}>Hide</Button></div>}>
              <div className="space-y-4">
                <div className="rounded-xl bg-[var(--gray-50)] p-4"><p className="whitespace-pre-wrap text-sm">{selected.body}</p><p className="mt-2 text-xs text-[var(--color-text-tertiary)]">{selected.author_label} · {waitedSince(selected.created_at)}</p></div>
                <Textarea label="Answer · shows with your real name and Mingla team badge" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Write a helpful answer. People following this thread are notified." rows={6} />
                <div className="flex justify-end"><Button icon={MessageCircle} loading={busy} disabled={!answer.trim()} onClick={() => void act("answer")}>Post answer</Button></div>
              </div>
            </SectionCard>
          ) : null}
        </div>
      )}
    </div>
  );
}

