/**
 * #4111 — Reported enquiries (Admin → Community & Support).
 *
 * Pure model for the panel: state transitions, display labels and the action
 * runner. Mingla staff only ever see an enquiry after the brand or the guest
 * reports it (D8); the server enforces that, this module only shapes the page.
 *
 * Pure module: no React, no Supabase, so node:test can load it directly.
 */

export const REPORTED_ENQUIRIES_EMPTY_COPY =
  "No reported enquiries. Mingla only sees an enquiry when the brand or the guest reports it.";

export const INITIAL_REPORTED_ENQUIRIES_STATE = Object.freeze({
  status: "loading", // loading | error | ready
  loadError: null,
  rows: [],
  busy: null, // { id, kind } while an action runs
  confirmBlockId: null, // enquiry id waiting for the Block everywhere confirmation
  actionError: null, // { id, message }
  notice: null, // short confirmation after an action succeeds
});

export function reportedEnquiriesReducer(state, event) {
  switch (event.type) {
    case "load_start":
      return { ...state, status: state.status === "ready" ? "ready" : "loading", loadError: null };
    case "load_ok":
      return {
        ...state,
        status: "ready",
        loadError: null,
        rows: Array.isArray(event.rows) ? event.rows : [],
      };
    case "load_fail":
      return { ...state, status: "error", loadError: event.message, rows: [] };
    case "ask_block":
      return { ...state, confirmBlockId: event.id, actionError: null, notice: null };
    case "cancel_block":
      return { ...state, confirmBlockId: null };
    case "action_start":
      return { ...state, busy: { id: event.id, kind: event.kind }, actionError: null, notice: null };
    case "action_ok":
      return {
        ...state,
        busy: null,
        confirmBlockId: null,
        rows: state.rows.filter((row) => row.id !== event.id),
        notice: event.kind === "block"
          ? "Sender blocked everywhere. The report is closed."
          : "Report dismissed.",
      };
    case "action_fail":
      return { ...state, busy: null, actionError: { id: event.id, message: event.message } };
    default:
      return state;
  }
}

export function reporterLabel(side) {
  if (side === "brand") return "Reported by the brand";
  if (side === "guest") return "Reported by the guest";
  return "Reporter unknown";
}

export function messageAuthorLabel(message, row) {
  if (message?.who === "guest") return message.display || row?.guest_name || "Guest";
  if (message?.who === "system") return "Mingla";
  return message?.display || row?.brand_name || "Brand";
}

export function formatReportedAt(value, now = Date.now()) {
  if (!value) return "Unknown time";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "Unknown time";
  const minutes = Math.max(0, Math.round((now - at.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function messageOf(error, fallback) {
  const text = error && typeof error.message === "string" ? error.message.trim() : "";
  return text || fallback;
}

export async function loadReportedEnquiries(dispatch, service) {
  dispatch({ type: "load_start" });
  try {
    const rows = await service.listReportedEnquiries();
    dispatch({ type: "load_ok", rows });
  } catch (error) {
    dispatch({
      type: "load_fail",
      message: messageOf(error, "Couldn't load reported enquiries. Try again."),
    });
  }
}

/** kind: "dismiss" | "block". Returns true when the server accepted it. */
export async function runReportedEnquiryAction(dispatch, service, { id, kind }) {
  dispatch({ type: "action_start", id, kind });
  try {
    if (kind === "block") await service.blockEnquirySenderEverywhere(id);
    else if (kind === "dismiss") await service.dismissEnquiryReport(id);
    else throw new Error(`Unknown action: ${kind}`);
    dispatch({ type: "action_ok", id, kind });
    return true;
  } catch (error) {
    dispatch({
      type: "action_fail",
      id,
      message: messageOf(
        error,
        kind === "block"
          ? "Couldn't block this sender. Nothing changed. Try again."
          : "Couldn't dismiss this report. Nothing changed. Try again.",
      ),
    });
    return false;
  }
}
