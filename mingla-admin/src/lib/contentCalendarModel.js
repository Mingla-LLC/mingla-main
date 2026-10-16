export const CONTENT_STAGES = [
  { value: "idea", label: "Idea" },
  { value: "writing", label: "Writing" },
  { value: "design", label: "Design" },
  { value: "review", label: "Review" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
];

export const CONTENT_VIEWS = [
  { value: "calendar", label: "Calendar" },
  { value: "board", label: "Board" },
  { value: "list", label: "List" },
];

export const stageIndex = (stage) => CONTENT_STAGES.findIndex((row) => row.value === stage);
export const copyIsLocked = (item) => stageIndex(item?.stage) >= stageIndex("design");

export function canMoveTo(item, to) {
  const from = stageIndex(item?.stage);
  const next = stageIndex(to);
  return from >= 0 && next >= 0 && next !== from && next <= from + 1;
}

export function moveNeedsFields(item, to) {
  if (item?.stage !== "review" || to !== "scheduled") return null;
  if (!item.publish_at) return { field: "content-publish", message: "Add a publish date and time before scheduling." };
  if (!Array.isArray(item.channels) || item.channels.length === 0) return { field: "content-channel-first", message: "Choose at least one channel before scheduling." };
  return null;
}

export function monthKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return monthKey(new Date());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return localDateKey(new Date());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseContentSearch(search) {
  const p = new URLSearchParams(search || "");
  const view = ["calendar", "board", "list"].includes(p.get("view")) ? p.get("view") : "calendar";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(p.get("month") || "") ? p.get("month") : monthKey();
  const card = /^[0-9a-f-]{36}$/i.test(p.get("card") || "") ? p.get("card") : null;
  return { view, month, card, q: (p.get("q") || "").slice(0, 160) };
}

export function monthWindow(key) {
  const [year, month] = key.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  const mondayOffset = (first.getDay() + 6) % 7;
  start.setDate(1 - mondayOffset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  const days = Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
  return { first, start, end, days };
}

export function dateTimeLocal(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function localToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function movePrompt(item, to) {
  if (item?.stage === "writing" && to === "design") return { flag: "approve_copy", title: "Approve copy?", action: "Approve and move" };
  if (item?.stage === "review" && to === "scheduled") return { flag: "approve_design", title: "Approve design?", action: "Approve and schedule" };
  if (item?.stage === "scheduled" && to === "published" && !item.live_url) return { flag: "publish_without_link", title: "Add the live link?", action: "Publish without link" };
  return null;
}

export function safeHttpsUrl(value) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function createSingleFlight(makeKey = requestKey) {
  let pending = null;
  let stableKey = null;
  let stableValue = null;
  return {
    submit(value, task) {
      if (pending) return pending;
      if (!stableKey || stableValue !== value) {
        stableKey = makeKey("web_create");
        stableValue = value;
      }
      pending = Promise.resolve().then(() => task(stableKey)).finally(() => { pending = null; });
      return pending;
    },
    reset() {
      if (!pending) { stableKey = null; stableValue = null; }
    },
    key() { return stableKey; },
    busy() { return !!pending; },
  };
}

export function createLatestOnlyGate() {
  let version = 0;
  let activeId = null;
  return {
    activate(id) { activeId = id || null; version += 1; return { id: activeId, version }; },
    ticket() { return { id: activeId, version }; },
    close() { activeId = null; version += 1; },
    accepts(ticket) { return !!ticket && ticket.id !== null && ticket.id === activeId && ticket.version === version; },
    active() { return activeId; },
  };
}

export function contentErrorWords(error) {
  const token = error?.token || "";
  if (token === "stale_write") return "This card changed since you opened it. Choose Use latest or Save mine.";
  if (token === "undo_expired") return "Undo expired. The newer change is still saved.";
  if (token === "copy_required") return "Add copy before moving this card to Design.";
  if (token === "copy_locked") return "Copy is read-only after Writing. Move the card back to Writing to revise it.";
  if (token === "copy_approval_required") return "Approve non-blank copy before Design.";
  if (token === "schedule_required") return "Add a publish date, time and at least one channel before Scheduled.";
  if (token === "live_link_required") return "Add the live link, or explicitly publish without one.";
  if (token === "duplicate_title") return "That title is already on the content calendar. Open the existing card instead.";
  if (token === "not_found") return "This card was removed. Close it and refresh the calendar.";
  if (token === "network") return "You’re offline. Reconnect and try again.";
  return error?.message || "That didn’t work. Try again.";
}

export function requestKey(prefix = "web") {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now()}${Math.random()}`.replace(/\D/g, "");
  return `${prefix}_${random}`.slice(0, 70).padEnd(8, "0");
}
