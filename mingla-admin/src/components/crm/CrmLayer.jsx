import { createPortal } from "react-dom";
import { layerStyle } from "../../lib/crmLayers";

/**
 * Draws its children in one layer of the stacking order in lib/crmLayers.js.
 *
 * The box is placed at the top of the page (document.body), outside the
 * page's own box. Two reasons: the page slides in when it mounts, and a panel
 * placed inside a moving box is sized by that box until the slide ends (a
 * card opened from a reloaded address was drawn as a short strip); and layers
 * that are siblings at the top of the page stack by their numbers alone,
 * whatever the page around them does.
 */
export function CrmLayer({ name, children }) {
  const box = (
    <div data-crm-layer={name} style={layerStyle(name)}>
      {children}
    </div>
  );
  // No page to draw into (a render outside a browser): draw in place.
  return typeof document === "undefined" ? box : createPortal(box, document.body);
}

/**
 * Everything that can open over the board, each in its layer: the card panel
 * (or the add form) in `card`, and whatever an open card asks in `dialog`.
 * `dialog` is always the later, higher layer, so a question opened from a
 * card is above the card, can be seen and takes the click meant for it.
 */
export function PipelineOverlays({ card = null, dialog = null }) {
  return (
    <>
      {card ? <CrmLayer name="card">{card}</CrmLayer> : null}
      {dialog ? <CrmLayer name="dialog">{dialog}</CrmLayer> : null}
    </>
  );
}
