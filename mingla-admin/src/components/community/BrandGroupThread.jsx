// Issue #4270 (Wave 7) — the Brand group thread, staff side. Day dividers,
// reply quotes, files, reactions, "Seen by" under my newest message, folded
// plan activity whose lines open the plan item beside the chat, a typing line,
// and sends that failed with Try again. Message actions (React, Reply, Add to
// plan, More) are real buttons that show on hover and on keyboard focus.
// It opens at the newest message and sticks there while you are near it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarPlus, MoreHorizontal, Reply, Smile } from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import { PlanActivityCard } from "./PlanActivityCard";
import { REACTION_EMOJI, clockTime, initialsOf } from "../../lib/brandGroupInbox";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-words [overflow-wrap:anywhere]";
const ACTION = `flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`;
const STICK_PX = 120;

function DayDivider({ label }) {
  return (
    <div data-day-divider="" className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--gray-200)]" />{label}<span aria-hidden="true" className="h-px flex-1 bg-[var(--gray-200)]" />
    </div>
  );
}

function reactionLabel(pill) {
  const words = `${pill.emoji}, ${pill.count} ${pill.count === 1 ? "reaction" : "reactions"}`;
  return pill.mine ? `${words}. Remove yours` : `${words}. React with ${pill.emoji}`;
}

/** The six-emoji popover. Esc closes it (and only it); focus goes back to React. */
function ReactPicker({ onPick, onClose }) {
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  return (
    <div role="menu" aria-label="Pick a reaction" data-react-picker=""
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      className="absolute bottom-full right-0 z-10 mb-1 flex gap-1 rounded-full border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1 shadow-[var(--shadow-md)]">
      {REACTION_EMOJI.map((emoji, i) => (
        <button key={emoji} ref={i === 0 ? first : undefined} type="button" role="menuitem" aria-label={`React with ${emoji}`}
          onClick={() => { onPick(emoji); onClose(); }}
          className={`flex h-9 w-9 items-center justify-center rounded-full text-[18px] hover:bg-[var(--gray-100)] ${FOCUS}`}>{emoji}</button>
      ))}
    </div>
  );
}

function MoreMenu({ selected, hasText, onSelect, onSignal, onCopy, onClose }) {
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  const item = `flex min-h-11 w-full items-center px-3 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`;
  return (
    <div role="menu" aria-label="More actions" data-more-menu=""
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      className="absolute right-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] py-1 shadow-[var(--shadow-md)]">
      <button ref={first} type="button" role="menuitem" className={item} onClick={() => { onSelect(); onClose(); }}>{selected ? "Unselect" : "Select"}</button>
      <button type="button" role="menuitem" className={item} onClick={() => { onSignal(); onClose(); }}>Create product signal</button>
      {hasText && <button type="button" role="menuitem" className={item} onClick={() => { onCopy(); onClose(); }}>Copy text</button>}
    </div>
  );
}

/** One message with its actions, reactions and (my newest) Seen by. */
function MessageRow({ message, mine, roleWords, pills, seenBy, selected, canPlan, onReact, onReply, onAddToPlan, onSelect, onSignal, onCopy, onPreview }) {
  const [open, setOpen] = useState(null); // "react" | "more" | null
  const reactButton = useRef(null);
  const moreButton = useRef(null);
  const close = (which) => {
    setOpen(null);
    (which === "react" ? reactButton : moreButton).current?.focus();
  };
  const name = message.sender_display_name || "Someone";
  const meta = [name, roleWords, clockTime(message.created_at)].filter(Boolean).join(" · ");
  return (
    <div data-message={message.id} className={`group relative flex gap-2.5 ${mine ? "justify-end" : ""}`}>
      {selected && <span aria-hidden="true" className="absolute -left-2 top-0 h-full w-1 rounded bg-[var(--color-brand-500)]" />}
      {!mine && (
        <span aria-hidden="true" className="mt-5 inline-grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[var(--color-info-50)] text-[12px] font-bold text-[var(--color-info-700)]">
          {initialsOf(name).slice(0, 1)}
        </span>
      )}
      <div className={`flex min-w-0 max-w-[70%] flex-col gap-1 ${mine ? "items-end" : ""}`}>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{meta}</span>
        <div className={`flex min-w-0 flex-col gap-1.5 px-3.5 py-2.5 text-[14px] leading-5 ${mine
          ? "rounded-[16px_16px_4px_16px] bg-[var(--color-brand-500)] text-white"
          : "rounded-[16px_16px_16px_4px] border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)]"} ${selected ? "ring-2 ring-[var(--color-brand-700)] ring-offset-2" : ""}`}>
          {message.reply_content && (
            <blockquote className={`rounded-md border-l-[3px] px-2 py-1 text-[12px] ${mine ? "border-white/60 bg-white/15 text-white/90" : "border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-text-secondary)]"}`}>
              {(message.reply_sender_display_name || "Message")}: {message.reply_content}
            </blockquote>
          )}
          {message.file_id ? (
            <button type="button" onClick={() => onPreview(message)} className={`flex min-w-52 items-center gap-3 rounded-xl border border-current/20 p-2 text-left hover:bg-black/5 ${FOCUS}`}>
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black/10 text-[11px] font-bold">{message.message_type === "video" ? "▶" : message.message_type === "image" ? "IMG" : "FILE"}</span>
              <span className="min-w-0"><strong className="block truncate">{message.file_name}</strong><span className="text-[11px] opacity-70">{message.file_size ? `${(message.file_size / 1024 / 1024).toFixed(1)} MB` : "Secure shared file"} · Preview</span></span>
            </button>
          ) : <p className={`whitespace-pre-wrap ${WORDS}`}>{message.content}</p>}
        </div>
        {pills?.length > 0 && (
          <div data-reactions="" className="flex flex-wrap gap-1.5">
            {pills.map((pill) => (
              <button key={pill.emoji} type="button" aria-label={reactionLabel(pill)} aria-pressed={pill.mine ? "true" : "false"} onClick={() => onReact(pill.emoji)}
                className={`min-h-8 rounded-full px-2 text-[12px] ${pill.mine ? "border-2 border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border border-[var(--gray-200)] bg-[var(--color-background-primary)]"} ${FOCUS}`}>
                {pill.emoji} {pill.count}
              </button>
            ))}
          </div>
        )}
        {seenBy && <span data-seen-by="" className="text-[11px] text-[var(--color-text-tertiary)]">{seenBy}</span>}
      </div>
      <div data-message-actions="" className={`absolute -top-3 ${mine ? "left-0" : "right-0"} flex items-center gap-0.5 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-0.5 shadow-[var(--shadow-sm)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${open ? "opacity-100" : ""}`}>
        <div className="relative">
          <button ref={reactButton} type="button" aria-label="React" aria-haspopup="menu" aria-expanded={open === "react"} className={ACTION} onClick={() => setOpen(open === "react" ? null : "react")}>
            <Smile aria-hidden="true" className="h-4 w-4" />
          </button>
          {open === "react" && <ReactPicker onPick={onReact} onClose={() => close("react")} />}
        </div>
        <button type="button" aria-label="Reply" className={ACTION} onClick={onReply}><Reply aria-hidden="true" className="h-4 w-4" /></button>
        {canPlan && <button type="button" aria-label="Add to plan" className={ACTION} onClick={onAddToPlan}><CalendarPlus aria-hidden="true" className="h-4 w-4" /></button>}
        <div className="relative">
          <button ref={moreButton} type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open === "more"} className={ACTION} onClick={() => setOpen(open === "more" ? null : "more")}>
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </button>
          {open === "more" && (
            <MoreMenu selected={selected} hasText={!!String(message.content || "").trim() && !message.file_id}
              onSelect={onSelect} onSignal={onSignal} onCopy={onCopy} onClose={() => close("more")} />
          )}
        </div>
      </div>
    </div>
  );
}

/** A send that is on its way, or that failed (with Try again and Delete). */
function PendingBubble({ item, onRetry, onDelete }) {
  return (
    <div data-pending={item.state} className="flex justify-end">
      <div className="flex max-w-[70%] flex-col items-end gap-1">
        <div className={`rounded-[16px_16px_4px_16px] px-3.5 py-2.5 text-[14px] leading-5 ${item.state === "failed" ? "border border-[var(--color-error-500)] bg-[var(--color-error-50)] text-[var(--color-text-primary)]" : "bg-[var(--color-brand-500)] text-white opacity-70"}`}>
          <p className={`whitespace-pre-wrap ${WORDS}`}>{item.content}</p>
        </div>
        {item.state === "failed" ? (
          <div role="alert" className="flex flex-wrap items-center justify-end gap-2 text-[12px]">
            <span className="font-semibold text-[var(--color-error-700)]">{item.error}</span>
            <button type="button" onClick={() => onRetry(item)} className={`min-h-9 rounded-lg px-2 font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>Try again</button>
            <button type="button" onClick={() => onDelete(item)} className={`min-h-9 rounded-lg px-2 text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Delete</button>
          </div>
        ) : <span role="status" className="text-[11px] text-[var(--color-text-tertiary)]">Sending…</span>}
      </div>
    </div>
  );
}

export function BrandGroupThread({
  group, entries, pending = [], loading, myUserId, roleWordsFor, reactions, seenBy, typing,
  planItems, onOpenSide, canPlan, selectedIds = [], onReact, onReply, onAddToPlan, onToggleSelect,
  onSignal, onCopy, onPreview, onRetrySend, onDeleteSend,
}) {
  const scroller = useRef(null);
  const [showNew, setShowNew] = useState(false);
  const opened = useRef("");
  const count = (entries?.length || 0) + pending.length;
  const nearBottom = useRef(true);

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowNew(false);
  };
  // Opens at the newest message; new messages keep it there when you are near it.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !group) return;
    if (opened.current !== group.conversation_id) {
      if (loading || !count) return;
      opened.current = group.conversation_id;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
    else setShowNew(true);
  }, [group, count, loading]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
    if (nearBottom.current) setShowNew(false);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[var(--color-background-primary)]">
      <div ref={scroller} onScroll={onScroll} data-scroll="thread" role="log" aria-label={`Messages with ${group?.brand_name || "this brand"}`} aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-[22px]">
        <div className="flex flex-col gap-3.5">
          {loading && !entries?.length ? (
            <div aria-busy="true" className="flex flex-col gap-4">
              <Skeleton width="45%" height={42} /><div className="self-end"><Skeleton width={220} height={42} /></div><Skeleton width="60%" height={54} />
            </div>
          ) : !entries?.length && !pending.length ? (
            <p className="rounded-xl border border-[var(--gray-200)] p-5 text-[13px] text-[var(--color-text-secondary)]">This is the official Brand group. Start the first conversation here.</p>
          ) : null}
          {(entries || []).map((entry) => {
            if (entry.type === "day") return <DayDivider key={entry.key} label={entry.label} />;
            if (entry.type === "plan") {
              return <PlanActivityCard key={entry.key} lines={entry.lines} items={planItems} brandName={group?.brand_name} onOpen={onOpenSide} />;
            }
            const message = entry.message;
            const mine = !!myUserId && message.sender_id === myUserId;
            return (
              <MessageRow
                key={entry.key}
                message={message}
                mine={mine}
                roleWords={roleWordsFor(message)}
                pills={reactions?.get?.(message.id)}
                seenBy={seenBy?.messageId === message.id ? seenBy.text : ""}
                selected={selectedIds.includes(message.id)}
                canPlan={canPlan}
                onReact={(emoji) => onReact(message.id, emoji)}
                onReply={() => onReply(message)}
                onAddToPlan={() => onAddToPlan(message)}
                onSelect={() => onToggleSelect(message.id)}
                onSignal={() => onSignal(message)}
                onCopy={() => onCopy(message)}
                onPreview={onPreview}
              />
            );
          })}
          {pending.map((item) => <PendingBubble key={item.localId} item={item} onRetry={onRetrySend} onDelete={onDeleteSend} />)}
          {typing && (
            <p data-typing="" aria-live="polite" className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]">
              <span aria-hidden="true" className="inline-flex gap-0.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--gray-400)]" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--gray-400)]" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--gray-400)]" /></span>
              {typing}
            </p>
          )}
        </div>
      </div>
      {showNew && (
        <button type="button" onClick={toBottom} className={`absolute bottom-3 left-1/2 min-h-9 -translate-x-1/2 rounded-full bg-[var(--color-text-primary)] px-3 text-[12px] font-semibold text-[var(--color-background-primary)] shadow-[var(--shadow-md)] ${FOCUS}`}>
          New messages ↓
        </button>
      )}
    </div>
  );
}
