// Issue #4270 (Wave 3) — the brand plan on the host card: words, the week
// grouping, the Add to plan form's checks and the link button. Pure helpers
// (no React) so the Plan block and its tests share one definition.

/** The help under Post or Task (the design's KIND_HELP). */
export const KIND_HELP = {
  task: "Task: becomes a Work card in To do, sorted by its due date.",
  post: "Post: goes on the Calendar for this brand as an Idea with this date, and always shows on the host's plan. No Work card.",
};

/** The words a host sees for a post (and a task's status). */
export const HOST_STATE_WORDS = {
  planned: "Planned",
  being_made: "Being made",
  in_review: "In review",
  scheduled: "Scheduled",
  posted: "Posted",
  todo: "To do",
  doing: "In progress",
  done: "Done",
  live: "Live now",
  draft: "Draft",
  happened: "Happened",
  on_mingla: "On Mingla",
  promised: "Promised",
};

export const PLAN_KIND_WORDS = { post: "Post", task: "Task", event: "Event", experience: "Experience", trip: "Trip", promised: "Promised" };

/** "Being made · Wed 12 Nov" for the Calendar drawer's Host sees line. */
export function hostSeesWords(item) {
  if (!item || !item.brand_id) return "No brand";
  const words = item.host_state_words || HOST_STATE_WORDS[item.host_state] || "";
  if (!words) return "Not on the plan: add a date";
  return item.publish_at ? `${words} · ${planDay(String(item.publish_at).slice(0, 10))}` : words;
}

/** "Wed 12 Nov". */
export function planDay(value) {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of a date (ISO, "2026-11-09"). */
export function mondayOf(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(String(iso).slice(0, 10), -dow);
}

/**
 * The plan by week: [{ key, label, items, today }]. "This week", "Next
 * week", then "Week of 17 Nov"; earlier weeks say "Week of". Items keep the
 * server's order (date, then kind, then title). `today` marks the week that
 * holds today, with `todayIndex`: where the Today line goes in its list.
 */
export function planWeeks(items, today) {
  const thisMonday = mondayOf(today);
  const nextMonday = addDays(thisMonday, 7);
  const weeks = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.on) continue;
    const key = mondayOf(item.on);
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(item);
  }
  if (!weeks.has(thisMonday)) weeks.set(thisMonday, []);
  return [...weeks.keys()].sort().map((key) => {
    const list = weeks.get(key);
    const label = key === thisMonday ? "This week" : key === nextMonday ? "Next week" : `Week of ${planDay(key).replace(/^\w+ /, "")}`;
    const isToday = key === thisMonday;
    return { key, label, items: list, today: isToday, todayIndex: isToday ? list.filter((i) => String(i.on) < today).length : -1 };
  });
}

/** "canva.com" from a plan link. */
export function linkSite(url) {
  const v = String(url || "");
  if (!/^https:\/\/[^/?#:@\\]/.test(v)) return "";
  // URL reads a site the way the browser will open it: a non-Latin site name
  // comes back as its real address (xn--...), the same as the server's label.
  try {
    return new URL(v).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// The same characters the server refuses (brand_plan_link_hidden): control
// characters, unusual spaces and invisible formatting characters, so the site
// name on a link's button always reads as the site it opens.
const LINK_HIDDEN = /[\u0000-\u0020\u007F-\u00A0\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200F\u2028-\u202F\u205F-\u206F\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/u;

// The same site rule as the server (brand_plan_link_host): there must be a site,
// short enough to be an address, that a person can read as what it opens. Refused:
// "www." with nothing after it, anything that folds into a character that breaks a
// site name or into an extra full stop, % (a browser decodes it into another site)
// and an IP address in any spelling.
function hasPlanSite(value) {
  const raw = /^https:\/\/([^/?#:]+)/.exec(value)?.[1];
  if (!raw || [...raw].length > 253) return false;
  const stops = raw.replace(/[\u3002\uFF0E\uFF61]/g, ".");
  const host = stops.toLowerCase().normalize("NFKC").toLowerCase();
  const lastLabel = host.replace(/\.$/, "").split(".").pop() ?? "";
  return !/[/?#@:\\\s%<>^|[\]]/.test(host)
    && /[^.]/.test(host.replace(/^www\./, ""))
    && host.split(".").length === stops.split(".").length
    && !/^(\d+|0x[0-9a-f]*)$/.test(lastLabel);
}

/**
 * A plan link must be https, in lower case like the server wants it, with
 * a site, nothing hidden and nothing before the site name. "" means no link.
 */
export function planLinkProblem(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const ok = /^https:\/\/[^\s]+$/.test(v) && v.length >= 9 && v.length <= 2000 && !LINK_HIDDEN.test(v) && !/^https:\/\/[^/?#]*[@\\]/.test(v) && hasPlanSite(v);
  return ok ? "" : "Links start with https://";
}

export function emptyPlanForm(owners = []) {
  return { type: "post", title: "", on: "", link: "", note: "", owners: owners.slice(), watchers: [] };
}

/**
 * Who owns and watches a new task, as the server says (D6, D21): the form
 * shows exactly this and sends what it shows. Before the plan has loaded, the
 * host card's owners and no watchers.
 */
export function planTaskDefaults(plan, hostOwners = []) {
  const d = plan?.task_defaults;
  return {
    owners: Array.isArray(d?.owners) ? d.owners.slice() : hostOwners.slice(),
    watchers: Array.isArray(d?.watchers) ? d.watchers.slice() : [],
  };
}

/** The Add to plan form's problems, in the order the fields appear. */
export function planFormProblems(form, today) {
  const out = [];
  const title = String(form?.title || "").trim();
  if (!title) out.push({ field: "title", message: "Say what it is." });
  else if (title.length > 160) out.push({ field: "title", message: "Say what it is in up to 160 characters." });
  else if (form?.type === "task" && title.length < 3) out.push({ field: "title", message: "Say what it is in 3 to 160 characters." });
  if (!form?.on) out.push({ field: "on", message: "Pick a date." });
  else if (today && form.on < today) out.push({ field: "on", message: "Pick today or a later date." });
  const link = planLinkProblem(form?.link);
  if (link) out.push({ field: "link", message: link });
  if (String(form?.note || "").length > 500) out.push({ field: "note", message: "A note is up to 500 characters." });
  if (form?.type === "task" && !(form.owners || []).length) out.push({ field: "owners", message: "Pick at least one owner." });
  return out;
}

/** What ops_brand_plan_add receives. */
export function planAddItem(form) {
  const item = { type: form.type === "task" ? "task" : "post", title: String(form.title || "").trim(), on: form.on };
  const link = String(form.link || "").trim();
  const note = String(form.note || "").trim();
  if (link) item.link = link;
  if (note) item.note = note;
  if ((form.owners || []).length) item.owners = form.owners.slice();
  if (item.type === "task") item.watchers = (form.watchers || []).slice();
  return item;
}

/** The toast after adding. */
export function planAddedWords(answer) {
  if (!answer || answer.status !== "added") return "";
  const item = answer.item || {};
  if (answer.kind === "post") return `Post added to the Calendar as an Idea for ${planDay(item.on)}. It is on the host's plan.`;
  const names = (item.owners || []).map((o) => o.name).filter(Boolean);
  return `Added. Card ${item.number ?? ""} is in To do for ${names.length ? names.join(", ") : "its owners"}.`;
}

/** A quiet system line in a Brand group (a plan change): no sender, type system. */
export function isPlanLine(message) {
  return !!message && message.message_type === "system" && !message.sender_id;
}
