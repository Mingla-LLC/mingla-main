// Issue #4255 (W4, D11) — the Messages button in the Admin top bar (between
// Search and Live, on every page). #4517: it opens the Messages page
// (#/messages), the same page the menu entry opens. It used to open a fixed
// panel inside the header; the header's backdrop blur made that panel collapse
// to nothing, and the page already holds everything the panel showed, so the
// panel is gone: one way to open Messages. One badge: unread team chats plus
// unread notifications For you (useMessages, one 30 s poll plus realtime).
// Below 768px only the icon and the badge show, so the top bar never wraps.
import { MessageSquareText } from "lucide-react";
import { useMessages, useTeamTimeZoneSync } from "../../hooks/useMessages";
import { messagesButtonLabel } from "../../lib/messagesModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function MessagesButton({ active = false }) {
  const messages = useMessages();
  // #4255 rework 2 (P1): Admin loading for a teammate saves their device zone.
  useTeamTimeZoneSync(messages.enabled ? messages.userId : null);

  if (!messages.enabled) return null;
  const count = messages.count || 0;
  const label = messagesButtonLabel(count);
  // Already on the page: stay put, so the open tab and thread are kept.
  const openMessages = () => {
    if (active) return;
    window.location.hash = "#/messages";
  };

  return (
    <button
      type="button"
      data-messages-button=""
      onClick={openMessages}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title="Messages"
      className={[
        "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border text-[13px] font-semibold transition-colors duration-150",
        "w-8 justify-center px-0 md:w-auto md:justify-start md:px-2.5",
        active
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
  );
}
