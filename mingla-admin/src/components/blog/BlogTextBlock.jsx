import { sanitizeBlogRichText } from "@mingla/blog-document";

export function BlogTextBlock({ block, onChange, onSplit, onRemoveEmpty }) {
  const html = block.html ?? (block.items ? block.items.join("<br>") : "");
  return <div
    data-blog-text-block={block.id}
    contentEditable
    suppressContentEditableWarning
    className="min-h-11 rounded-lg px-3 py-2 text-base leading-7 outline-none focus:bg-orange-50/40 focus:ring-2 focus:ring-[var(--color-brand-200)]"
    dangerouslySetInnerHTML={{ __html: html }}
    onInput={(event) => onChange(sanitizeBlogRichText(event.currentTarget.innerHTML))}
    onPaste={(event) => {
      event.preventDefault();
      const incoming = event.clipboardData.getData("text/html") || event.clipboardData.getData("text/plain");
      document.execCommand("insertHTML", false, sanitizeBlogRichText(incoming));
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter" && block.type === "paragraph" && caretAtEnd(event.currentTarget)) { event.preventDefault(); onSplit?.(); }
      if (event.key === "Backspace" && !event.currentTarget.textContent?.trim()) { event.preventDefault(); onRemoveEmpty?.(); }
    }}
  />;
}

function caretAtEnd(element) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const current = selection.getRangeAt(0);
  if (!element.contains(current.endContainer)) return false;
  const tail = current.cloneRange();
  tail.selectNodeContents(element);
  tail.setStart(current.endContainer, current.endOffset);
  return tail.toString().length === 0;
}
