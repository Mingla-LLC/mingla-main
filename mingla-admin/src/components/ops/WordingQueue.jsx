// Issue #3980 (R8, B4) — Needs you › What hosts are told (owner and admins):
// each "Recently shipped" card the GitHub bridge drafted, with its wording
// editable here. Publish saves it through the roadmap editor's own path and
// closes the approval; Not needed archives the draft and closes the
// approval; Write an announcement opens the announcements tab. Nothing
// reaches hosts until a person publishes it.
import { useState } from "react";
import { Button } from "../ui/Button";
import { AlertCard, SectionCard } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { CONTROL_CLASS } from "../crm/fields";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import { upsertRoadmapCard } from "../../services/communityService";
import { useOpsPoll } from "../../hooks/useOpsWork";
import { useAuth } from "../../context/AuthContext";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import { opsErrorWords, proofFromLines, todayIso } from "../../lib/opsModel";

const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

// #4130 (Wave 1): also opened inside a roadmap wording card's Work drawer.
export function WordingCard({ card, myName, onDone }) {
  const { addToast } = useToast();
  const draft = card.roadmap || {};
  const [title, setTitle] = useState(draft.public_title || "");
  const [body, setBody] = useState(draft.public_body || "");
  const [busy, setBusy] = useState("");
  const save = (status) => upsertRoadmapCard({ id: draft.id, publicTitle: title.trim(), publicBody: body.trim(), internalNote: draft.internal_note || "", lane: draft.lane || "shipped", status });
  const publish = async () => {
    setBusy("publish");
    try {
      await save("published");
      await ops.closeWork(card.id, proofFromLines([`Published by ${myName}`]), null, card.revision);
      addToast({ variant: "success", title: "Published. Hosts see it in Recently shipped." });
      onDone();
    } catch (error) {
      addToast({ variant: "error", title: "Not published", description: opsErrorWords(error) || String(error?.message || "") });
    } finally { setBusy(""); }
  };
  const notNeeded = async () => {
    setBusy("decline");
    try {
      await ops.pushBackWork(card.id, "declined", "Not needed: hosts are not told about this one.", [], card.revision);
      if (draft.id) await save("archived");
      addToast({ variant: "success", title: "Marked not needed. Hosts see nothing." });
      onDone();
    } catch (error) {
      addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) || String(error?.message || "") });
    } finally { setBusy(""); }
  };
  return (
    <SectionCard>
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className={`text-[15px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{card.title}</h2>
        <p className={`text-[13px] text-[var(--color-text-secondary)] ${WORDS}`}>Check the wording of the drafted Recently shipped card and publish it, or say it is not needed. Nothing reaches hosts until you publish it.</p>
        {!draft.id ? (
          <AlertCard variant="warning" title="The drafted roadmap card is gone">Mark it not needed, or open the Roadmap.</AlertCard>
        ) : (
          <>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Title hosts see</span>
              <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={`${CONTROL_CLASS} min-h-11`} />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">What hosts read</span>
              <textarea value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} className={`min-h-[84px] w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`} />
            </label>
          </>
        )}
        <div className="flex min-w-0 flex-wrap gap-2">
          {draft.id && <Button className="min-h-11" loading={busy === "publish"} disabled={!!busy || title.trim().length < 1} onClick={publish}>Publish</Button>}
          <a href="#/community-support?tab=announcements" className={`inline-flex min-h-11 items-center rounded-lg border border-[var(--gray-300)] px-3 text-[13px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}>Write an announcement</a>
          <Button variant="ghost" className="min-h-11" loading={busy === "decline"} disabled={!!busy} onClick={notNeeded}>Not needed</Button>
        </div>
      </div>
    </SectionCard>
  );
}

export function WordingQueue({ onChanged }) {
  const { access } = useAuth();
  const read = useOpsPoll(() => ops.listReview(todayIso()), { key: `${access?.email || ""}|wording`, intervalMs: 30_000 });
  const cards = Array.isArray(read.data?.wording) ? read.data.wording : [];
  const people = usePeopleDirectory();
  const myName = people.people.find((p) => p.me)?.name || String(access?.email || "").split("@")[0] || "a person";
  if (read.loading) return <div className="flex flex-col gap-2" aria-busy="true"><Skeleton height={120} /></div>;
  if (read.error && !read.data) return <AlertCard variant="error" title="Couldn’t load what hosts are told" action={<Button variant="secondary" className="min-h-11" onClick={() => read.refetch()}>Try again</Button>}>{opsErrorWords(read.error)}</AlertCard>;
  if (!cards.length) return <SectionCard><p className="text-center text-[14px] font-semibold text-[var(--color-text-primary)]">You’re all caught up.</p></SectionCard>;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      {cards.map((card) => <WordingCard key={card.id} card={card} myName={myName} onDone={() => { read.refetch({ quiet: true }); onChanged?.(); }} />)}
    </div>
  );
}
