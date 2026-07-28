// ─────────────────────────────────────────────────────────────────────────────
// #1293 [sprint-rollover] — PURE selection function for the nightly sprint sweep.
//
// This module contains ZERO I/O. It is the deterministic brain of the rollover
// automation: given the board's current items, the active iteration list, and
// today's date, it decides EXACTLY which items must move onto the current sprint.
// The runner (roll.mjs) is the only thing that talks to the GitHub API; keeping the
// decision here makes it unit-testable and revert-proof (see selectMoves.test.mjs).
//
// CONTRACT
//   selectMoves({ items, iterations, todayISO }) -> Array<Move>
//
//   iterations: [{ id, title, startDate, duration }]
//     endDate (EXCLUSIVE) = startDate + duration days.
//     Current iteration = the one with startDate <= today < endDate.
//     If none exists, return [] (caller logs a warning — never guess a target).
//
//   items: [{ itemId, contentType('Issue'|'DraftIssue'), issueNumber|null,
//             statusName, sprintIterationId|null, sprintEndISO|null,
//             rollovers(number, default 0) }]
//
//   Select an item to move IFF ALL hold:
//     - statusName !== 'Done'            (never carry finished work)
//     - sprintIterationId is set         (never touch un-sprinted items)
//     - sprintIterationId !== currentId  (never move items already on current sprint)
//     - the item's sprint has ENDED: sprintEndISO <= today  (exclusive-end semantics)
//   Future sprints (sprintEndISO > today) are excluded by the ended-check.
//
//   Move: { itemId, contentType, issueNumber, fromIterationId,
//           toIterationId: currentId, newRollovers: rollovers + 1 }
// ─────────────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a date-only ("YYYY-MM-DD") or full ISO string to a UTC-midnight epoch (ms).
 * Day-granular and timezone-safe: only the calendar date portion is used.
 * @param {string} iso
 * @returns {number} epoch ms, or NaN if unparseable
 */
export function toUtcDayEpoch(iso) {
  if (typeof iso !== "string" || iso.length < 10) return NaN;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Date.UTC(y, m - 1, d);
}

/**
 * endDate (EXCLUSIVE) for an iteration, as a UTC-midnight epoch (ms).
 * @param {{ startDate: string, duration: number }} iteration
 * @returns {number}
 */
export function iterationEndEpoch(iteration) {
  return toUtcDayEpoch(iteration.startDate) + Number(iteration.duration) * MS_PER_DAY;
}

/**
 * The current iteration = the one containing today: startDate <= today < endDate.
 * The lower boundary is inclusive, so today === startDate counts as current.
 * @returns {object|null} the iteration object, or null if today is in no iteration
 */
export function findCurrentIteration(iterations, todayISO) {
  const today = toUtcDayEpoch(todayISO);
  if (Number.isNaN(today)) return null;
  for (const it of iterations || []) {
    const start = toUtcDayEpoch(it.startDate);
    const end = iterationEndEpoch(it);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    if (start <= today && today < end) return it;
  }
  return null;
}

/**
 * Decide which board items must roll over onto the current sprint.
 * PURE — no side effects, no I/O.
 * @param {{ items: object[], iterations: object[], todayISO: string }} input
 * @returns {Array<{itemId:string, contentType:string, issueNumber:(number|null),
 *   fromIterationId:string, toIterationId:string, newRollovers:number}>}
 */
export function selectMoves({ items, iterations, todayISO }) {
  const current = findCurrentIteration(iterations, todayISO);
  // No current iteration => never dump items into a guessed sprint.
  if (!current) return [];

  const currentId = current.id;
  const today = toUtcDayEpoch(todayISO);
  const moves = [];

  for (const item of items || []) {
    const statusName = item.statusName;
    const sprintIterationId = item.sprintIterationId;
    const rollovers = Number(item.rollovers) || 0;

    // --- The four selection guards (each also documented in the contract above) ---
    if (statusName === "Done") continue; // never carry finished work
    if (!sprintIterationId) continue; // never touch un-sprinted items
    if (sprintIterationId === currentId) continue; // already on the current sprint
    // Only move items whose sprint has ENDED. sprintEndISO is exclusive, so a value
    // of exactly today means the sprint is over. Missing/unparseable end => skip
    // (cannot prove it ended). Future sprints have end > today and are excluded here.
    const endEpoch = toUtcDayEpoch(item.sprintEndISO);
    if (Number.isNaN(endEpoch)) continue;
    if (!(endEpoch <= today)) continue;

    moves.push({
      itemId: item.itemId,
      contentType: item.contentType,
      issueNumber: item.issueNumber ?? null,
      fromIterationId: sprintIterationId,
      toIterationId: currentId,
      newRollovers: rollovers + 1,
    });
  }

  return moves;
}

export default selectMoves;
