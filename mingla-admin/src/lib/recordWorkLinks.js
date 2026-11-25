// Issue #4571 (design v5) — link an EXISTING Work card to a host or creator
// from the record's own panel, and unlink it, through the same person-facing
// functions the Work card uses (WorkDetail):
//   link    ops_work_update(card, { links: [...its links, this record] }, revision)
//   unlink  ops_work_link_remove(card, kind, record, false, revision)
// The card is read first (ops_work_get) so the write carries its current
// revision; the server is the authority and refuses a closed card, a 21st
// link (too_many_links) and a stale revision (PT409). The checks below only
// put the same refusal into words before a request is spent. No new RPC.
//
// `ops` is the opsService module (passed in so tests can stand in for it).

export const WORK_LINK_MAX = 20;

/** The link kind a record is on a Work card: host or creator. */
export function recordLinkKind(record) {
  return record?.pipeline === "creators" ? "creator" : "host";
}

export class WorkLinkRefused extends Error {
  constructor(token, message) {
    super(message);
    this.token = token;
  }
}

function sameLink(l, kind, id) {
  return l && l.kind === kind && l.id === id;
}

/** Link card `cardId` to `record`. Resolves to { card, already } or throws (server error or WorkLinkRefused). */
export async function linkWorkToRecord(ops, cardId, record) {
  const kind = recordLinkKind(record);
  const read = await ops.getWork(cardId);
  const card = read?.card || null;
  if (!card) throw new WorkLinkRefused("not_found", "That Work card is no longer here.");
  const links = Array.isArray(card.links) ? card.links : [];
  if (links.some((l) => sameLink(l, kind, record.id))) return { card, already: true };
  if (card.status === "done" || card.closed_at) {
    throw new WorkLinkRefused("card_closed", `Card ${card.number} is closed, so its links can't change. Reopen it on Work first.`);
  }
  if (links.length >= WORK_LINK_MAX) {
    throw new WorkLinkRefused("too_many_links", `Card ${card.number} already links ${WORK_LINK_MAX} records. Remove one first.`);
  }
  const next = [...links.map((l) => ({ kind: l.kind, id: l.id })), { kind, id: record.id }];
  const answer = await ops.updateWork(card.id, { links: next }, card.revision);
  return { card: answer?.card || card, already: false };
}

/** Unlink card `cardId` from `record`. Resolves to { card } or throws. */
export async function unlinkWorkFromRecord(ops, cardId, record) {
  const kind = recordLinkKind(record);
  const read = await ops.getWork(cardId);
  const card = read?.card || null;
  if (!card) throw new WorkLinkRefused("not_found", "That Work card is no longer here.");
  if (card.status === "done" || card.closed_at) {
    throw new WorkLinkRefused("card_closed", `Card ${card.number} is closed, so its links can't change. Reopen it on Work first.`);
  }
  const links = Array.isArray(card.links) ? card.links : [];
  if (!links.some((l) => sameLink(l, kind, record.id))) {
    throw new WorkLinkRefused("not_linked", `Card ${card.number} reaches this ${kind} through another link (its brand or a subtask), not a direct one. Change it on the Work card.`);
  }
  const answer = await ops.removeLink(card.id, { kind, id: record.id }, false, card.revision);
  return { card: answer?.card || card };
}

/**
 * The picker's rows: ops_link_search('card', q) results (id, label, "Card N"),
 * joined to the open cards the Work list found for the same words, which carry
 * the number, status and owners. Only open cards can be linked, and cards
 * already on this record are left out.
 */
export function workPickerRows(searchResults, openCards, linkedIds = []) {
  const open = new Map((Array.isArray(openCards) ? openCards : []).filter(Boolean).map((c) => [c.id, c]));
  const linked = new Set(linkedIds);
  return (Array.isArray(searchResults) ? searchResults : [])
    .filter((r) => r && open.has(r.id) && !linked.has(r.id))
    .map((r) => {
      const c = open.get(r.id);
      return { id: r.id, number: c.number ?? null, title: c.title || r.label || "", status: c.status || "", owners: Array.isArray(c.owners) ? c.owners : [], due_on: c.due_on || null };
    });
}

/** "To do" / "In progress" / "Waiting on a person" for a Work card's status. */
export function workStatusWords(status) {
  return { todo: "To do", doing: "In progress", person: "Waiting on a person", done: "Done" }[status] || "";
}

/** How many of a record's Work rows are open (the card's "N open"). */
export function openWorkCount(rows) {
  return (Array.isArray(rows) ? rows : []).filter((c) => c && c.status !== "done").length;
}
