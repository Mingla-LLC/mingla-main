// Issue #4398 — Messages > Mingla activity: what Mingla's bots did, edits and
// system alerts, unread in Admin only and never pushed. The server groups them
// one line per kind per day (team_activity); this module only words each line.
// Pure, so it is tested without a browser.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Today", "Yesterday" or "Wed 11 Nov", for a YYYY-MM-DD day against today. */
export function activityDayLabel(day, today) {
  const t = Date.parse(`${day}T00:00:00Z`);
  const n = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return String(day || "");
  const diff = Math.round((n - t) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const d = new Date(t);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The one parent every item of a group shares, if they share one. */
function sharedParent(items) {
  const parents = (items || []).map((i) => i?.card?.parent).filter(Boolean);
  if (!parents.length || parents.length !== (items || []).length) return null;
  return parents.every((p) => p.number === parents[0].number) ? parents[0] : null;
}

/** { head, sub } for one group line. */
export function activityGroupWords(group) {
  const n = Number(group?.count || 0);
  const parent = sharedParent(group?.items);
  const under = parent ? ` under #${parent.number} ${parent.title}` : "";
  switch (group?.kind === "bot" ? `bot:${group.group}` : group?.kind) {
    case "bot:added": return { head: `Mingla added ${plural(n, "card", "cards")}${under}`, sub: "Each takes its main task’s owner and watcher." };
    case "bot:closed": return { head: `Mingla closed ${plural(n, "card", "cards")} because the problem was fixed`, sub: "Proven by the data, so no one had to confirm them." };
    case "bot:changed": return { head: `Mingla changed ${plural(n, "card", "cards")}${under}`, sub: "Re-dated, reopened or updated by Mingla." };
    case "guide": return { head: `${plural(n, "Feature Guide entry", "Feature Guide entries")} turned Live`, sub: "Notices, not work. They used to be cards." };
    case "edit": return { head: `${plural(n, "card", "cards")} edited`, sub: "Text, links or due dates. Edits go here, never to your phone." };
    case "alert": return { head: plural(n, "system alert", "system alerts"), sub: "For Admin only." };
    default: return { head: plural(n, "update", "updates"), sub: "" };
  }
}

/** Groups by day, newest first, each with its words: [{ day, label, groups }]. */
export function activityDays(groups, today) {
  const byDay = new Map();
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!byDay.has(g.day)) byDay.set(g.day, []);
    byDay.get(g.day).push({ ...g, ...activityGroupWords(g) });
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({ day, label: activityDayLabel(day, today), groups: list }));
}
