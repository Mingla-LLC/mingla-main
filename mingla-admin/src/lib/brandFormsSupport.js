// #4541 R7.1 — the forms support view's model (pure, so `node --test` covers it).
//
// Reads `admin_brand_forms_support(p_brand_id)`: counts, statuses, failures and
// switches only. It never carries answer content or guest contacts, and this
// model keeps it that way: it reads only the keys listed below and drops
// anything else the server might add.

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const text = (v) => (typeof v === "string" && v.length > 0 ? v : null);

const STATUS_LABEL = { draft: "Draft", live: "Live", closed: "Closed", archived: "Archived" };
const MODE_LABEL = {
  optional_on_page: "On the page, optional",
  required_step: "Before they finish",
  after_purchase: "After they buy or RSVP",
};
const SWITCH_LABEL = {
  BRAND_FORMS_KILL_SWITCH: "Forms off switch",
  BRAND_FORMS_PUSH: "Form requests by push",
  BRAND_FORMS_PUSH_EMAIL_ALONGSIDE: "Email alongside push",
};

export const OPEN_REPLY_LIMIT_MAX = 5000;

/** A valid daily limit of Unknown replies (0..5000), or null. */
export function parseOpenReplyLimit(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= OPEN_REPLY_LIMIT_MAX ? n : null;
}

/** The view of one brand's forms support read. Throws on a payload that is not one. */
export function brandFormsSupportView(data) {
  if (!isRecord(data) || !Array.isArray(data.forms)) throw new Error("brand_forms_support_shape");
  const forms = data.forms.filter(isRecord).map((f) => ({
    id: text(f.id) ?? "",
    name: text(f.name) ?? "Untitled form",
    status: STATUS_LABEL[f.status] ?? String(f.status ?? ""),
    liveVersion: typeof f.liveVersion === "number" ? `v${f.liveVersion}` : "Not published",
    doorFullAnswers: f.doorFullAnswers === true ? "On" : "Off",
    doorFullAnswersInvited: f.doorFullAnswersInvited === true ? "On" : "Off",
    openReplyLimitPerDay: count(f.openReplyLimitPerDay),
    blastKnown: count(f.blastKnown),
    blastUnknown: count(f.blastUnknown),
    hidden: count(f.hidden),
  }));
  const pages = (Array.isArray(data.pages) ? data.pages : []).filter(isRecord).map((p) => ({
    eventId: text(p.eventId) ?? "",
    eventTitle: text(p.eventTitle) ?? "Untitled page",
    formId: text(p.formId) ?? "",
    mode: MODE_LABEL[p.mode] ?? String(p.mode ?? ""),
    autoRemind: p.autoRemind === true ? "On" : "Off",
    answered: count(p.answered),
    toAnswer: count(p.toAnswer),
    notAsked: count(p.notAsked),
  }));
  const sends = (Array.isArray(data.requestSends30d) ? data.requestSends30d : []).filter(isRecord).map((r) => ({
    status: text(r.status) ?? "unknown",
    reason: text(r.reason),
    count: count(r.count),
  }));
  const stuck = isRecord(data.stuckCheckoutAnswers) ? data.stuckCheckoutAnswers : {};
  const switches = isRecord(data.switches) ? data.switches : {};
  const share = data.formReadyAppShare14d;
  return {
    forms,
    pages,
    sends,
    stuckCheckout: { count: count(stuck.count), oldest: text(stuck.oldest) },
    doorReads7d: count(data.doorReads7d),
    switches: Object.keys(SWITCH_LABEL).map((key) => ({
      key,
      label: SWITCH_LABEL[key],
      value: switches[key] === true ? "On" : switches[key] === false ? "Off" : "Not set",
    })),
    formReadyShare:
      typeof share === "number" && Number.isFinite(share)
        ? `Form-ready app share (14 days): ${share}%`
        : "Form-ready app share (14 days): no app users seen",
  };
}

/** One delivery line: "sent · 12", "skipped (no_texts_left) · 3". */
export function sendLine(row) {
  return `${row.status}${row.reason ? ` (${row.reason})` : ""} · ${row.count}`;
}

/** The plain-words error for a refused read or write. */
export function supportErrorMessage(error) {
  const message = isRecord(error) && typeof error.message === "string" ? error.message : String(error ?? "");
  if (message.includes("forbidden") || (isRecord(error) && error.code === "42501")) {
    return "This view is for Mingla admins and support only.";
  }
  if (message.includes("brand_not_found")) return "That brand wasn't found.";
  if (message.includes("limit_invalid")) return "The limit must be a whole number from 0 to 5000.";
  if (message.includes("form_not_found")) return "That form wasn't found.";
  return "Couldn't load forms support. Check your connection and try again.";
}
