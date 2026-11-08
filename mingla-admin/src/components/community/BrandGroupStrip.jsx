// Issue #4270 (Wave 7) — the group list folded to a strip of avatars while
// the side panel is open beside the chat. The first button brings the full
// list back (it closes the panel); each avatar opens that group.
import { Menu } from "lucide-react";
import { GroupAvatar } from "./BrandGroupList";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function BrandGroupStrip({ groups, selectedId, onShowList, onOpen }) {
  return (
    <nav aria-label="Brand groups" data-group-strip="" className="flex min-h-0 flex-1 flex-col items-center gap-2.5 overflow-y-auto bg-[var(--color-background-secondary)] py-3.5" data-scroll="strip">
      <button type="button" aria-label="Show the full group list" onClick={onShowList}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)] ${FOCUS}`}>
        <Menu aria-hidden="true" className="h-4 w-4" />
      </button>
      {(groups || []).map((group) => {
        const current = group.conversation_id === selectedId;
        const unread = Number(group.unread_count) || 0;
        return (
          <button key={group.conversation_id} type="button" data-strip-group={group.conversation_id}
            aria-label={`Open ${group.brand_name} Brand group, ${unread} unread`}
            aria-current={current ? "true" : undefined}
            onClick={() => onOpen(group.conversation_id)}
            className={`relative shrink-0 rounded-xl ${current ? "ring-2 ring-[var(--color-brand-500)] ring-offset-2" : ""} ${FOCUS}`}>
            <GroupAvatar group={group} />
            {unread > 0 && (
              <span aria-hidden="true" className={`absolute -right-1 -top-1 min-w-[14px] rounded-full border-2 border-[var(--color-background-secondary)] px-[3px] text-center text-[10px] font-bold text-white ${group.muted ? "bg-[var(--gray-500)]" : "bg-[var(--color-brand-500)]"}`}>
                {unread}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
