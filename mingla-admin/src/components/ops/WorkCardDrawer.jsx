// Issue #3980 (R7) — a work card opens in panel one over the board.
//
// Issue #4255 (W3) — the panel is 720px wide (the page decides: see
// PanelStack's firstSize) with a focus mode that fills the page; the card
// draws its own one-line header (number, breadcrumb, Thread, focus, ⋯,
// close), so the drawer is bare.
import { Drawer } from "../ui/Drawer";
import { WorkDetail } from "./WorkDetail";

export function WorkCardDrawer({ cardId, config, online, onClose, onChanged, focus = false, onFocus = null, onOpenCard = null, columns = null }) {
  if (!cardId) return null;
  return (
    <Drawer open onClose={onClose} title="Work card" bare>
      <WorkDetail key={cardId} cardId={cardId} config={config} online={online} onClose={onClose} onChanged={onChanged}
        focus={focus} onFocus={onFocus} onOpenCard={onOpenCard} columns={columns} />
    </Drawer>
  );
}
