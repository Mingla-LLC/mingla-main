// Issue #4420 (step 4) — a ticket's reporters and the conversations they came
// from, read LIVE from the database (ops_ticket_conversations): the customer's
// messages and photos and the internal notes, in order.
//
// Only Support staff are sent the conversations. Anyone else gets the number
// of reporters and "Support access needed to read these conversations": this
// component renders conversation content ONLY from an answer whose access is
// "support" (lib/ticketModel.js conversationsView), never from anything else.
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { PhotoLightbox } from "../ui/PhotoLightbox";
import { Skeleton } from "../ui/Skeleton";
import { VoiceNotePlayer } from "../support/SupportThread";
import { signAttachmentUrls } from "../../services/supportDeskService";
import { useOpsPoll } from "../../hooks/useOpsWork";
import { useAuth } from "../../context/AuthContext";
import * as ops from "../../services/opsService";
import { opsErrorWords } from "../../lib/opsModel";
import { timeAgo } from "../../lib/formatters";
import { conversationHref, conversationsView, messageKind, reporterRowWords } from "../../lib/ticketModel";

const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

function Message({ message, urls, onOpenImage, who }) {
  const kind = messageKind(message);
  if (kind === "system") return <p className="text-center text-[12px] italic text-[var(--color-text-tertiary)]">{message.content}</p>;
  const images = (message.attachments || []).filter((a) => a.kind === "image");
  const voice = (message.attachments || []).filter((a) => a.kind === "audio");
  const note = kind === "note";
  return (
    <div data-message-kind={kind} className={`flex min-w-0 flex-col ${kind === "staff" ? "items-end" : "items-start"}`}>
      <span className="mb-0.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">
        {note ? `Internal note · staff only · ${timeAgo(message.created_at)}` : `${who} · ${timeAgo(message.created_at)}`}
      </span>
      <div className={["max-w-[92%] rounded-2xl px-3 py-2 text-[13px]",
        note ? "w-full border-2 border-dashed border-[var(--color-warning-500)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]" : kind === "staff" ? "bg-[var(--color-brand-500)] text-white" : "bg-[var(--gray-100)] text-[var(--color-text-primary)]"].join(" ")}>
        {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {images.map((a) => (urls[a.storage_path] ? (
              <button key={a.id} type="button" aria-label="Open image full size" onClick={() => onOpenImage(a.id)}
                className={`h-20 w-20 overflow-hidden rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] ${FOCUS}`}>
                <img src={urls[a.storage_path]} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ) : (
              <span key={a.id} className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-black/20 p-1 text-center text-[10px]">Couldn’t open</span>
            )))}
          </div>
        )}
        {voice.map((a) => <VoiceNotePlayer key={a.id} url={urls[a.storage_path]} durationMs={a.duration_ms} />)}
      </div>
    </div>
  );
}

/**
 * Reporters (one row per linked conversation) and, for Support staff, the
 * conversations themselves. `cardId` is the ticket; `reporterCount` is the
 * count the card already carries (shown while the read is loading).
 */
export function TicketConversations({ cardId, reporterCount = 0 }) {
  const { access } = useAuth();
  const read = useOpsPoll(() => ops.fetchTicketConversations(cardId), { key: `${access?.email || ""}|ticket-conversations|${cardId}`, intervalMs: 20_000, enabled: !!cardId });
  const view = useMemo(() => (read.data ? conversationsView(read.data) : null), [read.data]);
  const conversations = useMemo(() => (view?.mode === "support" ? view.conversations : []), [view]);

  // Photos are signed from support-attachments, only for Support staff's answer.
  const [urls, setUrls] = useState({});
  const [signError, setSignError] = useState("");
  const paths = useMemo(() => conversations.flatMap((c) => (c.messages || []).flatMap((m) => (m.attachments || []).map((a) => a.storage_path))).filter(Boolean), [conversations]);
  const pathKey = paths.join("|");
  useEffect(() => {
    let live = true;
    if (!pathKey) { setUrls({}); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect
    signAttachmentUrls(pathKey.split("|")).then((signed) => { if (live) { setUrls(signed); setSignError(""); } })
      .catch((error) => { if (live) setSignError(error?.message || "Couldn’t open the photos."); });
    return () => { live = false; };
  }, [pathKey]);

  const [viewer, setViewer] = useState(null);
  const images = conversations.flatMap((c) => (c.messages || []).flatMap((m) => (m.attachments || []).filter((a) => a.kind === "image" && urls[a.storage_path])));
  const imageIndex = new Map(images.map((a, i) => [a.id, i]));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section aria-label="Reporters" data-ticket-reporters="" className="flex min-w-0 flex-col gap-1.5">
        <h3 className={LABEL}>Reporters</h3>
        {read.loading ? (
          <Skeleton height={36} />
        ) : read.error && !read.data ? (
          <p role="alert" className="text-[13px] text-[var(--color-error-700)]">
            {opsErrorWords(read.error)} <button type="button" onClick={() => read.refetch()} className={`font-semibold underline ${FOCUS}`}>Try again</button>
          </p>
        ) : view?.mode === "support" ? (
          conversations.length === 0 ? <p className="text-[12.5px] text-[var(--color-text-tertiary)]">No conversation is linked yet.</p> : (
            <ul className="flex min-w-0 flex-col gap-1">
              {conversations.map((c) => (
                <li key={c.support_ticket_id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--gray-50)] px-2.5 py-1.5 text-[13px]">
                  <span className="min-w-0 break-words"><span className="font-semibold text-[var(--color-text-primary)]">{c.customer_name || "Customer"}</span> <span className="text-[var(--color-text-tertiary)]">· {reporterRowWords(c)}</span></span>
                  <a href={conversationHref(c.support_ticket_id)} className={`inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>Open in Support <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></a>
                </li>
              ))}
            </ul>
          )
        ) : view?.mode === "count" ? (
          <p data-support-required="" className="text-[13px] text-[var(--color-text-secondary)]">{view.words}</p>
        ) : (
          <p className="text-[13px] text-[var(--color-text-secondary)]">{reporterCount} {reporterCount === 1 ? "reporter" : "reporters"}.</p>
        )}
      </section>

      {view?.mode === "support" && conversations.length > 0 && (
        <section aria-label="Conversations" data-ticket-conversations="" className="flex min-w-0 flex-col gap-3">
          <h3 className={LABEL}>Conversations <span className="font-normal normal-case tracking-normal">· read live; internal notes are staff only</span></h3>
          {signError && <p role="alert" className="text-[12.5px] text-[var(--color-error-700)]">{signError}</p>}
          {conversations.map((c) => (
            <div key={c.support_ticket_id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--gray-200)] p-3">
              <p className="text-[12.5px] font-semibold text-[var(--color-text-primary)]">{c.customer_name || "Customer"} · {reporterRowWords(c)}</p>
              {(c.messages || []).length === 0 ? <p className="text-[12.5px] text-[var(--color-text-tertiary)]">No messages yet.</p> : (c.messages || []).map((m) => (
                <Message key={m.id} message={m} urls={urls} who={messageKind(m) === "customer" ? (c.customer_name || "Customer") : "Mingla"} onOpenImage={(id) => setViewer(imageIndex.get(id) ?? 0)} />
              ))}
            </div>
          ))}
        </section>
      )}
      {viewer !== null && images.length > 0 && <PhotoLightbox photos={images.map((a) => urls[a.storage_path])} startIndex={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
