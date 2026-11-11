// Issue #4255 (W4, D11) — the Messages button in the Admin top bar (between
// Search and Live, on every page) and its 440px panel, anchored top right.
// The panel opens over the page, so nothing on the page is lost. One badge:
// unread team chats plus unread notifications For you (useMessages, one
// 30 s poll plus realtime). Below 768px only the icon and the badge show, so
// the top bar never wraps.
import { useEffect, useRef, useState } from "react";
import { Maximize2, MessageSquareText, X } from "lucide-react";
import { useMessages } from "../../hooks/useMessages";
import { messagesButtonLabel } from "../../lib/messagesModel";
import { MessagesBody } from "./MessagesBody";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function MessagesButton() {
  const messages = useMessages();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("notifications");
  const [threadId, setThreadId] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    // Going to another page (Open card, Open full page) closes the panel.
    const onHash = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("hashchange", onHash); };
  }, [open]);

  if (!messages.enabled) return null;
  const count = messages.count || 0;
  const label = messagesButtonLabel(count);
  const fullPage = () => {
    const q = tab === "chats" && threadId ? `?tab=chats&thread=${threadId}` : tab !== "notifications" ? `?tab=${tab}` : "";
    window.location.hash = `#/messages${q}`;
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-messages-button=""
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open ? "true" : "false"}
        aria-haspopup="dialog"
        title="Messages"
        className={[
          "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border text-[13px] font-semibold transition-colors duration-150",
          "w-8 justify-center px-0 md:w-auto md:justify-start md:px-2.5",
          open
            ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-text-primary)]"
            : "border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] hover:border-[var(--gray-300)]",
          FOCUS,
        ].join(" ")}
      >
        <MessageSquareText aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span data-messages-label="" className="hidden md:inline">Messages</span>
        {count > 0 && (
          <span data-messages-badge="" aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-[var(--color-brand-500)] px-1 text-center text-[11px] font-bold leading-[18px] tabular-nums text-white md:static md:ml-0.5">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Messages"
          tabIndex={-1}
          data-messages-panel=""
          className="fixed bottom-3 right-3 flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-[14px] border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-lg)] focus:outline-none"
          style={{ top: "calc(var(--header-height) + 8px)", zIndex: "var(--z-modal, 50)" }}
        >
          <div className="flex shrink-0 items-center gap-1 px-3 pb-1.5 pt-2.5">
            <h2 className="min-w-0 flex-1 text-[14px] font-semibold text-[var(--color-text-primary)]">Messages</h2>
            <button type="button" onClick={fullPage} className={`inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>
              <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />Open full page
            </button>
            <button type="button" aria-label="Close Messages" onClick={() => { setOpen(false); buttonRef.current?.focus(); }}
              className={`inline-grid h-8 w-8 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <MessagesBody messages={messages} tab={tab} threadId={threadId} onChange={(t, id) => { setTab(t); setThreadId(id); }} />
        </div>
      )}
    </>
  );
}
