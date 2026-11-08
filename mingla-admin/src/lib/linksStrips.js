// #4318 — Links page custom strips: the form rules, the save arguments and the
// reorder logic the Links page tab (components/links/LinksPagePanel.jsx) uses.
//
// Pure module: no React, no Supabase, so plain node tests can load it.
// The server (admin_links_strip_save / admin_links_strips_reorder) re-checks
// every rule here; this module only lets the form say what is wrong before a
// round trip.

export const LINKS_STRIP_TITLE_MAX = 60;

export const LINKS_STRIP_LABELS = Object.freeze(["From Mingla", "Featured", "New", "Giveaway"]);

export const LINKS_STRIP_OPENS = Object.freeze([
  Object.freeze({ id: "web", label: "Web link" }),
  Object.freeze({ id: "blog", label: "Blog post" }),
  Object.freeze({ id: "explorer", label: "Explorer app" }),
  Object.freeze({ id: "host", label: "Host app" }),
]);

// The server's rule, exactly (admin_links_strip_save in
// supabase/migrations/20280508004318_issue_4318_links_page.sql): after an
// optional http(s):// is stripped, a host of letters, digits and inner
// hyphens per label, a 2-63 letter TLD, an optional port, then any path,
// query or fragment; at most 500 characters and no other scheme.
const WEB_LINK_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(:[0-9]{1,5})?([/?#]\S*)?$/i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const WEB_LINK_MAX = 500;

/** True when the server will accept this web link. */
export function isValidStripUrl(url) {
  const value = normalizeStripUrl(url);
  return value.length > 0 && value.length <= WEB_LINK_MAX && !OTHER_SCHEME.test(value) && WEB_LINK_PATTERN.test(value);
}

export const LINKS_STRIP_MESSAGES = Object.freeze({
  title: "Add a title so people know what the strip is.",
  titleTooLong: `Keep the title to ${LINKS_STRIP_TITLE_MAX} characters.`,
  showsOn: "Choose the day the strip shows on.",
  label: "Choose a label.",
  opens: "Choose what the strip opens.",
  blog: "Choose the blog post this strip opens.",
  url: "Enter a web link like usemingla.com/host.",
});

/** The web link as stored: trimmed, with any http(s):// removed. */
export function normalizeStripUrl(url) {
  return String(url ?? "").trim().replace(/^https?:\/\//i, "");
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The first problem with a strip draft, as { field, message }, or null when
 * it can be saved. Checked in the order the form reads, top to bottom.
 */
export function validateStripDraft(draft) {
  const value = draft || {};
  const title = String(value.title ?? "").trim();
  if (!ISO_DAY.test(String(value.showsOn ?? ""))) return { field: "showsOn", message: LINKS_STRIP_MESSAGES.showsOn };
  if (!title) return { field: "title", message: LINKS_STRIP_MESSAGES.title };
  if (title.length > LINKS_STRIP_TITLE_MAX) return { field: "title", message: LINKS_STRIP_MESSAGES.titleTooLong };
  if (!LINKS_STRIP_LABELS.includes(value.label)) return { field: "label", message: LINKS_STRIP_MESSAGES.label };
  if (!LINKS_STRIP_OPENS.some((option) => option.id === value.opens)) return { field: "opens", message: LINKS_STRIP_MESSAGES.opens };
  if (value.opens === "blog" && !value.blogPostId) return { field: "blog", message: LINKS_STRIP_MESSAGES.blog };
  if (value.opens === "web" && !isValidStripUrl(value.url)) {
    return { field: "url", message: LINKS_STRIP_MESSAGES.url };
  }
  return null;
}

/**
 * The admin_links_strip_save arguments for a valid draft. Strips are not by
 * city: every strip shows on every city's view. Only a web strip sends a URL
 * and only a blog strip sends a post, so switching "Opens" never leaves a stale value behind.
 */
export function stripSaveArgs(draft) {
  return {
    p_id: draft.id || null,
    p_shows_on: draft.showsOn,
    p_title: String(draft.title ?? "").trim(),
    p_label: draft.label,
    p_opens: draft.opens,
    p_url: draft.opens === "web" ? normalizeStripUrl(draft.url) : null,
    p_blog_post_id: draft.opens === "blog" ? draft.blogPostId : null,
  };
}

/** The strips as the list RPC returns them, top of the page first. */
export function stripRows(data) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.strips) ? data.strips : [];
  return [...rows].sort((a, b) => (Number(a.position) - Number(b.position)) || String(a.id).localeCompare(String(b.id)));
}

/**
 * The list with the strip `id` moved to index `to` (clamped to the ends), or
 * null when nothing moves (unknown id, or already there).
 */
export function moveStrip(strips, id, to) {
  const from = strips.findIndex((strip) => strip.id === id);
  if (from < 0) return null;
  const target = Math.max(0, Math.min(strips.length - 1, Number(to)));
  if (!Number.isFinite(target) || target === from) return null;
  const next = [...strips];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Optimistic reorder: show `next` straight away, save its order, and put
 * `previous` back if the save fails (including a stale order, PT409). The
 * error is rethrown so the caller can say what happened.
 */
export async function runOptimisticReorder({ previous, next, apply, commit }) {
  apply(next);
  try {
    await commit(next.map((strip) => strip.id));
  } catch (error) {
    apply(previous);
    throw error;
  }
}

/** Local calendar day as YYYY-MM-DD. */
export function isoDay(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayFromIso(value) {
  if (!ISO_DAY.test(String(value ?? ""))) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The "Shows on" choices: today and the next six days. */
export function showsOnOptions(today = new Date(), days = 7) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const name = day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    return { value: isoDay(day), label: i === 0 ? `Today, ${name}` : name };
  });
}

/** The strip's mono line on the page: its label and day ("From Mingla · Thu 12"). */
export function stripMetaLine(label, showsOn, today = new Date()) {
  const day = dayFromIso(showsOn);
  if (!day) return label;
  const when = isoDay(day) === isoDay(today)
    ? "Today"
    : `${day.toLocaleDateString("en-GB", { weekday: "short" })} ${day.getDate()}`;
  return `${label} · ${when}`;
}

/** The day in words for the strips list ("Thursday 12 November"). */
export function stripDayLabel(showsOn) {
  const day = dayFromIso(showsOn);
  return day ? day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "No day";
}

/** What a strip opens, in words, for the strips list. */
export function stripOpensSummary(strip) {
  if (strip.opens === "web") return `opens ${strip.url || "a web link"}`;
  if (strip.opens === "blog") return strip.blog_title ? `opens blog: ${strip.blog_title}` : "opens a blog post";
  if (strip.opens === "host") return "opens the Host app";
  if (strip.opens === "explorer") return "opens the Explorer app";
  return "opens nothing yet";
}
