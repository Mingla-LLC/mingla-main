// Issue #4130 (Wave 1) — what the old Needs you page did, inside the Work
// card that waits on a person:
//   * CardDrafts: a card waiting to send a message shows the message drafts
//     for the hosts and creators it is linked to, with every action the old
//     page had (edit, copy and mark sent, discard, restore, undo). It is the
//     same drafts screen (pages/DraftsPage.jsx), embedded.
//   * CardWording: a "Recently shipped" roadmap card shows the wording editor
//     (owner and admins): publish it to hosts, or say it is not needed.
// Spend and publish approvals are the card's own actions (WorkDetail).
import { AlertCard } from "../ui/Card";
import { DraftsPage } from "../../pages/DraftsPage";
import { useAuth } from "../../context/AuthContext";
import { useOpsPoll } from "../../hooks/useOpsWork";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import * as ops from "../../services/opsService";
import { isRoadmapApproval, opsErrorWords, todayIso } from "../../lib/opsModel";
import { cardRecordIds, isSendCard } from "../../lib/workViews";
import { WordingCard } from "./WordingQueue";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

function Block({ title, children }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] p-3">
      <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
      {children}
    </section>
  );
}

export function CardDrafts({ card }) {
  if (!isSendCard(card)) return null;
  const records = cardRecordIds(card).slice(0, 3);
  return (
    <Block title="Message to send">
      <p className="text-[12.5px] text-[var(--color-text-secondary)]">Send it yourself on the real channel, then mark it sent here. The card stays waiting on a person until then.</p>
      {records.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          This card is not linked to a host or creator, so its draft is not shown here.{" "}
          <a href="#/work-board?drafts=all" className={`font-semibold text-[var(--color-brand-700)] underline ${FOCUS}`}>Open all my drafts</a>
        </p>
      ) : (
        records.map((id) => <DraftsPage key={id} embedded={{ search: `record=${id}` }} />)
      )}
    </Block>
  );
}

export function CardWording({ card, onChanged }) {
  const { access } = useAuth();
  const canTell = access?.role === "owner" || access?.role === "admin";
  const show = canTell && isRoadmapApproval(card) && card?.status === "person" && !card?.archived;
  const read = useOpsPoll(() => ops.listReview(todayIso()), { key: `${access?.email || ""}|wording-card|${card?.id || ""}`, intervalMs: 0, enabled: show });
  const people = usePeopleDirectory();
  if (!show) return null;
  const myName = people.people.find((p) => p.me)?.name || String(access?.email || "").split("@")[0] || "a person";
  const wording = (Array.isArray(read.data?.wording) ? read.data.wording : []).find((c) => c.id === card.id);
  return (
    <Block title="What hosts are told">
      {read.loading ? (
        <p className="text-[13px] text-[var(--color-text-tertiary)]" aria-busy="true">Loading the wording…</p>
      ) : read.error ? (
        <AlertCard variant="error" title="Couldn’t load the wording">{opsErrorWords(read.error)}</AlertCard>
      ) : wording ? (
        <WordingCard card={wording} myName={myName} onDone={() => { read.refetch({ quiet: true }); onChanged?.(); }} />
      ) : (
        <p className="text-[13px] text-[var(--color-text-secondary)]">The drafted wording is not waiting any more.</p>
      )}
    </Block>
  );
}
