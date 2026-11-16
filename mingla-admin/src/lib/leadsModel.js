// #4452 A1.8 — the Leads list's pure rules: the filter <-> address mapping,
// row and drawer wording, the selection banner and the CSV. No React, no
// Supabase (the node tests load it directly).
//
// The search text never goes in the address: `q` lives in component state
// only (A1.8). Every other filter is in the hash query, so a link reproduces
// the view.

export const LABELS = Object.freeze([
  { value: "host", label: "Host" },
  { value: "creator", label: "Creator" },
  { value: "local", label: "Local" },
  { value: "explorer", label: "Explorer" },
]);
export const SOURCES = Object.freeze([
  { value: "form", label: "Form" },
  { value: "book_a_call", label: "Book a call" },
  { value: "tool", label: "Free tool" },
  { value: "beta", label: "Beta" },
]);
export const EMAIL_STATUS_LABELS = Object.freeze({
  unsubscribed: "Unsubscribed",
  follow_ups_active: "Follow-ups on",
  follow_ups_stopped: "Emails stopped",
  emailed: "Emailed",
  never_emailed: "Not emailed",
});
const LABEL_NAME = Object.fromEntries(LABELS.map((l) => [l.value, l.label]));
const SOURCE_NAME = Object.fromEntries(SOURCES.map((s) => [s.value, s.label]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The server filter from the address (never `q`) plus the search box. */
export function filterFromQuery(search, q = "") {
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  const f = {};
  const label = p.get("label");
  if (label === "stopped") f.email_status = "follow_ups_stopped";
  else if (LABEL_NAME[label]) f.labels = [label];
  // #4452: beta-leads and tool-leads redirect here (their old ?tab=beta /
  // ?tab=tools address), opening on that source; ?source= is the filter.
  const legacyTab = { beta: "beta", tools: "tool" }[p.get("tab")];
  const source = p.get("source") || legacyTab;
  if (SOURCE_NAME[source]) f.sources = [source];
  const form = p.get("form");
  if (form && UUID.test(form)) f.form_id = form.toLowerCase();
  const page = p.get("page");
  if (page && page.startsWith("/") && page.length <= 300) f.page_path = page;
  for (const k of ["consent", "in_pipeline"]) if (["yes", "no"].includes(p.get(k))) f[k] = p.get(k);
  const status = p.get("email_status");
  if (!f.email_status && EMAIL_STATUS_LABELS[status]) f.email_status = status;
  for (const k of ["from", "to"]) if (DAY.test(p.get(k) || "")) f[k] = p.get(k);
  for (const k of ["utm_source", "utm_campaign"]) {
    const v = (p.get(k) || "").trim();
    if (v && v.length <= 150) f[k] = v;
  }
  if (p.get("test") === "1") f.show_test = true;
  const text = typeof q === "string" ? q.trim() : "";
  if (text.length >= 1 && text.length <= 80) f.q = text;
  return f;
}

/** Set one address key (or clear it), keeping the rest. `q` is refused. */
export function querySet(search, key, value) {
  if (key === "q") throw new Error("the search text never goes in the address");
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  if (value === null || value === undefined || value === "" || value === false) p.delete(key);
  else p.set(key, value === true ? "1" : String(value));
  return p.toString();
}

export const labelName = (v) => LABEL_NAME[v] || "Lead";
export const sourceName = (v) => SOURCE_NAME[v] || "Other";

/** One table row as it reads. */
export function leadRowView(row) {
  const labels = Array.isArray(row?.labels) ? row.labels : [];
  const latest = row?.latest || {};
  const cameFrom = latest.form_name || latest.page_path || sourceName(latest.source);
  const utm = [latest.utm_source, latest.utm_campaign].filter(Boolean).join(" / ");
  return {
    id: row?.id,
    name: (row?.name || "").trim() || "No name",
    email: row?.email || "",
    label: labelName(row?.primary_label),
    moreLabels: Math.max(labels.length - 1, 0),
    source: sourceName(latest.source),
    cameFrom,
    utm: utm || "direct",
    emailStatus: EMAIL_STATUS_LABELS[row?.email_status] || "Not emailed",
    emailStatusKey: row?.email_status || "never_emailed",
    when: row?.last_seen_at || null,
    isTest: row?.is_test === true,
    crm: row?.crm || null,
  };
}

/** The drawer's consent line. */
export function consentLine(lead, formatDate = (d) => d) {
  if (lead?.marketing_consent === true) {
    const parts = [`Agreed to marketing email on ${formatDate(lead.consent_at)}`];
    if (lead.consent_source) parts.push(sourceName(lead.consent_source));
    return parts.join(" · ");
  }
  return "No marketing consent";
}

/** The drawer's ad line: the platform only, never a click id. */
export function adLine(ad) {
  if (ad === "ads_off") return "Ad cookies off";
  if (typeof ad === "string" && ad.endsWith("_click")) {
    const p = ad.replace(/_click$/, "");
    const name = { meta: "Meta", google: "Google", tiktok: "TikTok", snap: "Snapchat", reddit: "Reddit" }[p];
    return name ? `Came from a ${name} ad` : "Came from an ad";
  }
  return "No ad";
}

/**
 * The marketable count of selected rows, by the rules of
 * public.leads_audience_counts (not test, not unsubscribed, consent yes), so
 * the banner and the composer's estimate agree. "Select all matching" and the
 * Email hand-off use the server's own count.
 */
export function marketableOf(rows) {
  return rows.filter((r) => !r.is_test && r.email_status !== "unsubscribed" && r.marketing_consent === true).length;
}

/** The selection banner (design ch. 10, exact copy). */
export function selectionBanner(counts) {
  const n = Number(counts?.selected || 0);
  const ok = Number(counts?.marketable || 0);
  return {
    strong: `${n.toLocaleString()} selected.`,
    rest: `${ok.toLocaleString()} can get a marketing email; ${(n - ok).toLocaleString()} left out (no consent or unsubscribed). One-to-one replies are always allowed.`,
  };
}

export const firstName = (name) => (typeof name === "string" && name.trim() ? name.trim().split(/\s+/)[0] : "them");

/** The pipeline a lead's card goes to: creators for a creator, else hosts. */
export function pipelineFor(lead) {
  return lead?.primary_label === "creator" ? "creators" : "hosts";
}

/** The new pipeline card's fields: the name and the email as a contact detail. */
export function leadCardFields(lead) {
  const fields = { name: (lead?.name || "").trim() || lead?.email || "New lead", source: "inbound" };
  if (lead?.email) {
    fields.identifiers = [{ kind: "email", value: lead.email }];
    fields.channel = "email";
  }
  return fields;
}

function csvCell(v) {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Formula injection guard: a cell that starts like a formula is quoted text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The export as CSV text (columns, then each answer field). */
export function leadsCsv(exported) {
  const cols = Array.isArray(exported?.columns) ? exported.columns : [];
  const answers = Array.isArray(exported?.answer_fields) ? exported.answer_fields : [];
  const head = [...cols, ...answers.map((a) => a.label || a.key)];
  const lines = [head.map(csvCell).join(",")];
  for (const row of Array.isArray(exported?.rows) ? exported.rows : []) {
    const values = cols.map((c) => row?.[c]);
    const ans = row?.answers || {};
    lines.push([...values, ...answers.map((a) => ans[a.key])].map(csvCell).join(","));
  }
  return lines.join("\n");
}

/** The friendly words for the leads errors the server can return. */
export function leadsErrorWords(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  if (/selection_limit|PT429/.test(text)) return "You've made a lot of selections this hour. Try again in a little while.";
  if (/lead_already_linked/.test(text)) return "This lead is already on a pipeline card.";
  if (/bad_filter/.test(text)) return "One of the filters isn't valid. Clear the filters and try again.";
  if (/42501|forbidden|not allowed/i.test(text)) return "You don't have access to this. Ask an admin.";
  return "The server didn't answer. Check your connection and try again.";
}
