// #4452 §5.7 — the document operations the shared body editor applies. Pure, so
// Communications › Email and the forms automation step edit a document the
// same way (the same block shapes the senders render).

export function blockId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

/** A new empty text block. */
export function textBlock(html = "<p><br></p>") {
  return { id: blockId(), type: "rich_text", html };
}

export function updateBlock(doc, id, patch) {
  return doc.map((block) => (block.id === id ? { ...block, ...patch } : block));
}

/** Removing the last block leaves one empty text block, never an empty document. */
export function removeBlock(doc, id, fallback = () => [textBlock()]) {
  const next = doc.filter((block) => block.id !== id);
  return next.length ? next : fallback();
}

export function appendDivider(doc) {
  return [...doc, { id: blockId(), type: "divider" }, textBlock()];
}

export function appendText(doc) {
  return [...doc, textBlock()];
}

/** The document with the active block's live HTML (what the admin sees right now). */
export function flushActive(doc, activeId, liveHtml) {
  if (!activeId || typeof liveHtml !== "string") return doc;
  return doc.map((block) => (block.id === activeId ? { ...block, html: liveHtml } : block));
}

/** Only https:// and mailto: links (the composer rule). Returns the href or null. */
export function safeLinkHref(raw) {
  try {
    const parsed = new URL(String(raw || "").trim());
    const ok = parsed.protocol === "https:" ||
      (parsed.protocol === "mailto:" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.pathname));
    return ok ? parsed.toString() : null;
  } catch {
    return null;
  }
}
