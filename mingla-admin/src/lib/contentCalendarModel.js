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

export function monthKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return monthKey(new Date());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
  const start = new Date(first); start.setDate(1 - first.getDay()); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + 42);
  const days = Array.from({ length: 42 }, (_, i) => { const day = new Date(start); day.setDate(start.getDate() + i); return day; });
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

export function contentErrorWords(error) {
  const token = error?.token || "";
  if (token === "stale_write") return "This card changed since you opened it. Reload it, then apply your change again.";
  if (token === "copy_required") return "Add copy before moving this card to Design.";
  if (token === "schedule_required") return "Add a publish date, time and at least one channel before Scheduled.";
  if (token === "live_link_required") return "Add the live link, or explicitly publish without one.";
  if (token === "network") return "You’re offline. Reconnect and try again.";
  return error?.message || "That didn’t work. Try again.";
}

export function requestKey(prefix = "web") {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now()}${Math.random()}`.replace(/\D/g, "");
  return `${prefix}_${random}`.slice(0, 70).padEnd(8, "0");
}
