// Issue #4130 (Wave 1) — what the old Needs you page did, inside the Work
// card that waits on a person.
//
// Issue #4255 (W3, D6): the "Message to send" block (CardDrafts) is gone.
// People review agent drafts in their Claude or Codex chat; a draft for a
// person is a subtask they own ("Send <who> the message"), and the full
// drafts screen stays on the Drafts page.
//   * CardWording: a "Recently shipped" roadmap card shows the wording editor
//     (owner and admins): publish it to hosts, or say it is not needed.
// Spend and publish approvals are the card's own actions (WorkDetail).
import { AlertCard } from "../ui/Card";
import { useAuth } from "../../context/AuthContext";
import { useOpsPoll } from "../../hooks/useOpsWork";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import * as ops from "../../services/opsService";
import { isRoadmapApproval, isTagged, opsErrorWords, todayIso } from "../../lib/opsModel";
import { isFullAdmin } from "../../lib/access";
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

export function CardWording({ card, onChanged, onOpenSide = null }) {
  const { access } = useAuth();
  const canTell = isFullAdmin(access);
  const show = canTell && isRoadmapApproval(card) && isTagged(card);
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
        <WordingCard card={wording} myName={myName} onDone={() => { read.refetch({ quiet: true }); onChanged?.(); }} onOpenSide={onOpenSide} />
      ) : (
        <p className="text-[13px] text-[var(--color-text-secondary)]">The drafted wording is not waiting any more.</p>
      )}
    </Block>
  );
}
