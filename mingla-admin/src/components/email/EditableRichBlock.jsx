import { useLayoutEffect, useRef } from "react";
import { sanitizeLocalRichText } from "./richText";

// #4419: one editable body block. The DOM is the source of truth while the
// admin types: HTML is written into it only when the incoming `html` differs
// from what the node already holds (first mount, a loaded template or draft,
// "Duplicate as new", New email). Typing, and toolbar actions that already
// changed the DOM (bold, link, token), report their HTML up and match the node,
// so nothing is rewritten and the caret stays where the admin left it. The old
// React-managed innerHTML rewrote the block after every keystroke and sent the
// caret to the start, so "abc" came out as "cba".
export function EditableRichBlock({ html, editorRef, onFocus, onHtmlChange, className }) {
  const nodeRef = useRef(null);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    if (node.innerHTML === html) return;
    node.innerHTML = sanitizeLocalRichText(html);
  }, [html]);

  return (
    <div
      ref={(node) => {
        nodeRef.current = node;
        editorRef?.(node);
      }}
      contentEditable
      suppressContentEditableWarning
      onFocus={onFocus}
      onInput={(event) => onHtmlChange(event.currentTarget.innerHTML)}
      className={className}
    />
  );
}
