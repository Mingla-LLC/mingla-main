// Issue #4398 — Done needs the watcher. Who the signed-in person is on a card
// and what the review step lets them do, in the words the card detail shows.
// The server decides (ops_work_finish, ops_work_confirm, ops_work_send_back);
// this only picks the buttons and the sentence, so a button never shows that
// the server would refuse.

export const SEND_BACK_MIN = 5;
export const SEND_BACK_MAX = 300;

function firstName(list) {
  return (Array.isArray(list) && list[0]?.name) || "";
}

export function reviewRole(card, me) {
  const email = String(me || "").toLowerCase();
  const owner = (card?.owners || [])[0] || null;
  const watcher = (card?.watchers || [])[0] || null;
  const ownerName = firstName(card?.owners) || "The owner";
  const watcherName = firstName(card?.watchers) || "the watcher";
  const isOwner = !!email && owner?.email === email;
  const isWatcher = !!email && watcher?.email === email;
  const inReview = !!card?.review;
  const releaseCard = Array.isArray(card?.release_items);
  let words;
  if (card?.status === "done") words = card?.confirmed_by_name ? `${card.confirmed_by_name} confirmed it.` : "Closed.";
  else if (releaseCard) words = "This card closes by itself when the release record shows nothing left.";
  else if (inReview && isWatcher) words = `${card.review.requested_by_name || ownerName} says this is done. You watch it, so you confirm it or send it back.`;
  else if (inReview && isOwner) words = `You marked it done. Waiting on ${watcherName} to confirm. You cannot confirm your own card.`;
  else if (inReview) words = `Waiting on ${watcherName} to confirm.`;
  else if (isOwner) words = `When you finish, press Mark done. It goes to ${watcherName} to confirm.`;
  else if (isWatcher) words = `${ownerName} owns this. You can close it yourself; your close counts as the confirm.`;
  else words = `${ownerName} owns this. ${watcherName.charAt(0).toUpperCase()}${watcherName.slice(1)} confirms it.`;
  return { isOwner, isWatcher, inReview, canConfirm: inReview && isWatcher, words };
}

// #4398 retest (P3): the close form's words. The watcher's own close is the
// confirm, so it closes the card; anyone else's goes to the watcher first.
export function closeFormWords(card, me, columnName) {
  const role = reviewRole(card, me);
  const watcherName = firstName(card?.watchers) || "its watcher";
  if (role.isWatcher) {
    return { line: columnName ? `Moving to ${columnName} closes this card.` : "Your close counts as the confirm.", submit: "Close card", busy: "Closing…" };
  }
  return { line: `Sends it to ${watcherName} to confirm.`, submit: "Mark done", busy: "Sending…" };
}
