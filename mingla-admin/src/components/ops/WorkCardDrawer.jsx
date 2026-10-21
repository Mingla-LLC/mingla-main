// Issue #3980 (R7) — a work card opens in the right-side drawer over the
// board (scrim, focus kept inside, Esc closes), like a host card. Inside is
// the card itself: where it came from, what needs attention, then the
// whole detail.
import { Drawer } from "../ui/Drawer";
import { WorkDetail } from "./WorkDetail";

export function WorkCardDrawer({ cardId, config, online, onClose, onChanged }) {
  if (!cardId) return null;
  return (
    <Drawer open onClose={onClose} title="Work card" header={<p className="pt-2 text-[13px] font-semibold text-[var(--color-text-secondary)]">Work card</p>}>
      <WorkDetail key={cardId} cardId={cardId} config={config} online={online} inDrawer onBack={onClose} onChanged={onChanged} />
    </Drawer>
  );
}
