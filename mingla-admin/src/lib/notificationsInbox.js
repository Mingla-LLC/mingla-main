// Issue #4130 (Wave 4a) — the Notifications inbox. Pure: no React, no Supabase.
//
// One inbox with tabs All / Mentions / Support / System:
//   - a real mention (a note or comment that names you) is its own row, with
//     who wrote it;
//   - Work updates (card changes, mostly made by agents) are ONE grouped row,
//     "12 Work cards changed", which opens Work: they used to fill the page as
//     143 unread "mentions" credited to "A teammate";
//   - a support alert whose ticket is already resolved is never "New";
//   - System rows are the platform problems the Dashboard also lists.

export const INBOX_TABS = Object.freeze([
  { id: "all", label: "All" },
  { id: "mentions", label: "Mentions" },
  { id: "support", label: "Support" },
  { id: "system", label: "System" },
]);

/** Is this alert still new? Read, or its ticket resolved, means no. */
export function alertIsNew(alert) {
  return !!alert && !alert.read_at && !alert.ticket_resolved;
}

function time(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * The rows of one tab, newest first. `system` is a list of
 * { id, title, detail, href, tone } (Dashboard's platform problems).
 */
export function inboxRows(inbox, tab = "all", system = []) {
  const mentions = Array.isArray(inbox?.mentions) ? inbox.mentions : [];
  const alerts = Array.isArray(inbox?.alerts) ? inbox.alerts : [];
  const rows = [];

  if (tab === "all" || tab === "mentions") {
    for (const m of mentions) {
      if (m.kind !== "mention") continue;
      rows.push({
        id: `m-${m.id}`, type: "mention", label: "Mention", isNew: !m.read_at, at: m.created_at,
        title: `${m.actor_name || "A teammate"} mentioned you`, detail: m.body_excerpt || "",
        link: m.deep_link || null, source: m,
      });
    }
  }

  if (tab === "all") {
    const updates = mentions.filter((m) => m.kind === "work_update");
    if (updates.length) {
      const unread = updates.filter((m) => !m.read_at);
      const cards = new Set(updates.map((m) => m.card_id || m.id));
      rows.push({
        id: "work-updates", type: "work_group", label: "Work updates", isNew: unread.length > 0,
        at: updates[0].created_at,
        title: `${cards.size} Work ${cards.size === 1 ? "card" : "cards"} changed`,
        detail: unread.length ? `${unread.length} unread. Grouped so mentions stand out.` : "All read.",
        link: "#/work-board", count: updates.length, unread: unread.length, items: updates,
      });
    }
  }

  if (tab === "all" || tab === "support") {
    for (const a of alerts) {
      rows.push({
        id: `a-${a.id}`, type: "support", label: "Support", isNew: alertIsNew(a), at: a.created_at,
        title: a.title || "Support alert", detail: a.ticket_resolved ? `${a.body || ""}${a.body ? " · " : ""}Resolved` : a.body || "",
        resolved: !!a.ticket_resolved, source: a,
      });
    }
  }

  if (tab === "all" || tab === "system") {
    for (const s of Array.isArray(system) ? system : []) {
      rows.push({ id: `s-${s.id}`, type: "system", label: "System", isNew: true, at: null, title: s.title, detail: s.detail, link: s.href, tone: s.tone });
    }
  }

  return rows.sort((a, b) => {
    if (a.type === "system" && b.type !== "system") return -1;
    if (b.type === "system" && a.type !== "system") return 1;
    return time(b.at) - time(a.at);
  });
}

/** Unread counts per tab, from the server's totals (not the rows on screen). */
export function tabCounts(inbox, system = []) {
  const u = inbox?.unread || {};
  const mentions = Number(u.mentions || 0);
  const work = Number(u.work_updates || 0);
  const support = Number(u.support || 0);
  const sys = Array.isArray(system) ? system.length : 0;
  return { all: mentions + work + support + sys, mentions, support, system: sys };
}

/** What "Mark all read" sends for a tab ("system" rows are not alerts). */
export function markScope(tab) {
  if (tab === "mentions") return "mentions";
  if (tab === "support") return "support";
  return "all";
}

/** An admin link from a mention or alert as an in-app hash route, or null. */
export function inAppRoute(link) {
  if (typeof link !== "string") return null;
  if (link.startsWith("#/")) return link;
  const at = link.indexOf("#/");
  if (at >= 0 && /^https:\/\/admin\.usemingla\.com\/$/.test(link.slice(0, at))) return link.slice(at);
  return null;
}
