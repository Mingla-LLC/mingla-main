// #4382 Wave 3 — the Product board's rules, with no React in them.
//
// Five columns (New, Triaged, Planned, Shipped, Told). Won't do is a filter,
// not a column. Tell reporters goes to the customer-visible tickets linked to
// the item, uses the approved "Live" wording, and can be sent once.
//
// MINGLA-INVARIANT: I-4382-PRODUCT-BOARD-COLUMNS | issue #4382 | Each Product item sits in exactly one board column named by its stage; wont_do items show only under the Won't do filter
// MINGLA-INVARIANT: I-4382-TELL-REPORTERS-ONCE-UI | issue #4382 | The Tell reporters button is offered only for a shipped item with Live wording that has not been sent, and is disabled while a send is in flight

export const BOARD_COLUMNS = Object.freeze([
  Object.freeze({ id: "new", label: "New" }),
  Object.freeze({ id: "triaged", label: "Triaged" }),
  Object.freeze({ id: "planned", label: "Planned" }),
  Object.freeze({ id: "shipped", label: "Shipped" }),
  Object.freeze({ id: "told", label: "Told" }),
]);

export const STAGE_LABEL = Object.freeze({
  new: "New",
  triaged: "Triaged",
  planned: "Planned",
  shipped: "Shipped",
  told: "Told",
  wont_do: "Won't do",
});

export const SIGNAL_TYPE_OPTIONS = Object.freeze([
  Object.freeze({ value: "bug", label: "Bug" }),
  Object.freeze({ value: "feature", label: "Idea" }),
  Object.freeze({ value: "question", label: "Question" }),
]);

export function signalTypeLabel(kind) {
  return { bug: "Bug", feature: "Idea", question: "Question", account: "Account", trust_safety: "Trust & safety" }[kind] || "Item";
}

/** The column a signal belongs to, or null (Won't do and anything unknown). */
export function columnFor(signal) {
  const state = signal?.state;
  return BOARD_COLUMNS.some((column) => column.id === state) ? state : null;
}

/** 1-based position on the New → Told stepper; 0 for Won't do / unknown. */
export function stageIndex(state) {
  const index = BOARD_COLUMNS.findIndex((column) => column.id === state);
  return index + 1;
}

/**
 * { new: [...], triaged: [...], planned: [...], shipped: [...], told: [...] }
 * or, when showWontDo, { wont_do: [...] }. Newest change first.
 */
export function groupSignals(signals, { showWontDo = false } = {}) {
  const list = (Array.isArray(signals) ? signals : [])
    .slice()
    .sort((left, right) => Date.parse(right.updated_at || 0) - Date.parse(left.updated_at || 0));
  if (showWontDo) return { wont_do: list.filter((signal) => signal.state === "wont_do") };
  const groups = Object.fromEntries(BOARD_COLUMNS.map((column) => [column.id, []]));
  for (const signal of list) {
    const column = columnFor(signal);
    if (column) groups[column].push(signal);
  }
  return groups;
}

/** Ticket sources a reporter can be told on (person or brand visible). */
export function tellRecipients(signal, ticketsById = {}) {
  return (signal?.sources || [])
    .filter((source) => source.source_kind === "support_ticket")
    .map((source) => ticketsById[source.source_id])
    .filter((ticket) => ticket && (ticket.visibility === "person" || ticket.visibility === "brand"));
}

/** The newest "Live" wording for this item that has not been sent yet. */
export function liveDraftFor(signal) {
  return (signal?.drafts || [])
    .filter((draft) => draft.customer_status === "Live" && draft.state !== "sent")
    .sort((left, right) => Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0))[0] || null;
}

/**
 * Whether "Send to N people" may be pressed, and why not.
 * Returns { canSend, reason, draft, recipients }.
 */
export function tellReportersState(signal, ticketsById = {}, { sending = false, sentOnce = false } = {}) {
  const recipients = tellRecipients(signal, ticketsById);
  const draft = liveDraftFor(signal);
  const base = { draft, recipients };
  if (signal?.state === "told" || sentOnce) return { ...base, canSend: false, reason: "Already told. This can only be sent once." };
  if (signal?.state !== "shipped") return { ...base, canSend: false, reason: "Reporters are told once the item is verified live." };
  if (!draft) return { ...base, canSend: false, reason: "No live wording yet. Verify the release first." };
  if (sending) return { ...base, canSend: false, reason: "Sending…" };
  return { ...base, canSend: true, reason: "" };
}

/** "Send to 4 people" / "Send to 1 person" / "Mark as told". */
export function tellButtonLabel(count) {
  if (!count) return "Mark as told";
  return `Send to ${count} ${count === 1 ? "person" : "people"}`;
}

/** The signal a ticket feeds, if any. */
export function signalForTicket(signals, ticketId) {
  return (signals || []).find((signal) => (signal.sources || []).some((source) => (
    source.source_kind === "support_ticket" && source.source_id === ticketId
  ))) || null;
}

function words(value) {
  return new Set(String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));
}

/**
 * Items to offer before creating a new one: open items (not told, not won't
 * do) whose title shares a word with `query`. Best match first.
 */
export function searchOpenItems(signals, query, limit = 5) {
  const wanted = words(query);
  if (wanted.size === 0) return [];
  return (signals || [])
    .filter((signal) => signal.state !== "told" && signal.state !== "wont_do")
    .map((signal) => {
      const have = words(`${signal.title} ${signal.product_area || ""}`);
      const shared = [...wanted].filter((word) => have.has(word)).length;
      return { signal, shared };
    })
    .filter((row) => row.shared > 0)
    .sort((left, right) => right.shared - left.shared)
    .slice(0, limit)
    .map((row) => row.signal);
}
