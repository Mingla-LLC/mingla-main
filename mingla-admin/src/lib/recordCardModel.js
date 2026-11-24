// Issue #4571 (design v5) — the pure rules behind a host or creator card on
// the board: the amber problem count and the one status line. No React.
import { cadenceWords } from "./crmModel.js";
import { hostMissing, hostReasons, localWhen } from "./opsModel.js";

/**
 * #4571 design v5: what needs fixing on a host card (No owner; Missing type,
 * region, contact), shown as ONE amber count with the list on hover instead of
 * a stack of red pills. Creators have none (as before).
 */
export function cardProblems(def, record) {
  if (def?.id !== "hosts" || !record) return [];
  return hostReasons(record, hostMissing(record));
}

/**
 * #4571 design v5: the card's one status line, the single most useful fact,
 * in this order: where a stale card is stuck, a reply waiting, the Demo booked
 * lock, the next demo, the host's next event (or No next event), the follow-up
 * round. Nothing is invented: no fact, no line.
 */
export function cardStatus(def, record, { stageTag = "", hostRow = null } = {}) {
  if (stageTag) return { k: "warn", kind: "stale", words: stageTag };
  if (record.suggest_replied) return { k: "info", kind: "reply", words: "Replied by email? Open to move it." };
  if (record.demo_gate?.locked) return { k: "err", kind: "lock", words: "Demo booked locked" };
  if (record.next_demo?.call_at) return { k: "ok", kind: "demo", words: `Demo ${localWhen(record.next_demo.call_at)}` };
  if (hostRow?.next || hostRow?.needs_next) return { k: "event", kind: "event", words: "" };
  const round = cadenceWords(record);
  if (round) return { k: "none", kind: "round", words: round };
  return null;
}

