// Issue #4398 — Done needs the watcher. Who the signed-in person is on a card
// and what the review step lets them do, in the words the card detail shows.
// The server decides (ops_work_finish, ops_work_confirm, ops_work_send_back);
// this only picks the buttons and the sentence, so a button never shows that
// the server would refuse.

export const SEND_BACK_MIN = 5;
export const SEND_BACK_MAX = 300;

function namesOf(list) {
  return (Array.isArray(list) ? list : []).map((p) => p?.name || p?.email).filter(Boolean);
}

/** #4571: "Ada", "Ada and Tunde", "Ada, Tunde and Kemi". */
export function andWords(names) {
  const n = (Array.isArray(names) ? names : []).filter(Boolean);
  return n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** #4571: "Ada", "Ada or Tunde", "Ada, Tunde or Kemi" (any one of them). */
export function orWords(names) {
  const n = (Array.isArray(names) ? names : []).filter(Boolean);
  return n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} or ${n[n.length - 1]}`;
}

/** #4571: "Waiting on Ada" or "Waiting on any of: Ada, Tunde". */
export function waitingOnWords(names) {
  const n = (Array.isArray(names) ? names : []).filter(Boolean);
  if (!n.length) return "Waiting on the watcher";
  return n.length === 1 ? `Waiting on ${n[0]}` : `Waiting on any of: ${n.join(", ")}`;
}

export function reviewRole(card, me) {
  const email = String(me || "").toLowerCase();
  // #4571: a card has one or more owners and one or more watchers; any one watcher confirms.
  const owners = Array.isArray(card?.owners) ? card.owners : [];
  const watchers = Array.isArray(card?.watchers) ? card.watchers : [];
  const ownerName = andWords(namesOf(owners)) || "The owner";
  const watcherAny = orWords(namesOf(watchers)) || "the watcher";
  const waitingOn = waitingOnWords(namesOf(watchers));
  const isOwner = !!email && owners.some((p) => p?.email === email);
  const isWatcher = !!email && watchers.some((p) => p?.email === email);
  const inReview = !!card?.review;
  const releaseCard = Array.isArray(card?.release_items);
  const owns = owners.length > 1 ? "own" : "owns";
  let words;
  if (card?.status === "done") words = card?.confirmed_by_name ? `${card.confirmed_by_name} confirmed it.` : "Closed.";
  else if (releaseCard) words = "This card closes by itself when the release record shows nothing left.";
  else if (inReview && isWatcher) words = `${card.review.requested_by_name || ownerName} says this is done. You watch it, so you confirm it or send it back.`;
  else if (inReview && isOwner) words = `You marked it done. ${waitingOn} to confirm. You cannot confirm your own card.`;
  else if (inReview) words = `${waitingOn} to confirm.`;
  else if (isOwner) words = `When you finish, press Mark done. It goes to ${watcherAny} to confirm.`;
  else if (isWatcher) words = `${ownerName} ${owns} this. You can close it yourself; your close counts as the confirm.`;
  else words = `${ownerName} ${owns} this. ${watcherAny.charAt(0).toUpperCase()}${watcherAny.slice(1)} confirms it.`;
  return { isOwner, isWatcher, inReview, canConfirm: inReview && isWatcher, words };
}

// #4398 retest (P3): the close form's words. A watcher's own close is the
// confirm, so it closes the card; anyone else's goes to the watchers first.
export function closeFormWords(card, me, columnName) {
  const role = reviewRole(card, me);
  const watcherAny = orWords(namesOf(card?.watchers)) || "its watcher";
  if (role.isWatcher) {
    return { line: columnName ? `Moving to ${columnName} closes this card.` : "Your close counts as the confirm.", submit: "Close card", busy: "Closing…" };
  }
  return { line: `Sends it to ${watcherAny} to confirm.`, submit: "Mark done", busy: "Sending…" };
}

/**
 * #4571: the board tile's people line, "Ada and Tunde own · Kemi watches",
 * "Ada, Bo and 2 more own · Kemi, Tunde watch". "—" for nobody (never made up).
 */
export function peopleLine(card) {
  const owners = namesOf(card?.owners);
  const watchers = namesOf(card?.watchers);
  if (!owners.length && !watchers.length) return "—";
  const o = owners.length > 2 ? `${owners.slice(0, 2).join(", ")} and ${owners.length - 2} more` : andWords(owners);
  const own = owners.length ? `${o} ${owners.length > 1 ? "own" : "owns"}` : "Nobody owns";
  const watch = watchers.length ? `${watchers.join(", ")} ${watchers.length > 1 ? "watch" : "watches"}` : "nobody watches";
  return `${own} · ${watch}`;
}
