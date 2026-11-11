// Issue #4383 — the Push composer's "Opens" choices and its wording.
//
// The one source of truth for where a push may open is
// supabase/functions/_shared/adminPushDestinations.ts; this file restates its
// app, value and label columns for the Admin screen, and
// supabase/functions/_shared/__tests__/issue_4383_admin_push.implementor.test.ts
// asserts the two (and the migration's SQL) agree. Never add a row here alone.
//
// Pure module: no React, no Supabase, so the plain node tests run it.

export const EXPLORER_DESTINATIONS = Object.freeze([
  Object.freeze({ value: "explore", label: "Explore" }),
  Object.freeze({ value: "discover", label: "Discover" }),
  Object.freeze({ value: "likes", label: "Likes" }),
]);

export const HOST_DESTINATIONS = Object.freeze([
  Object.freeze({ value: "community", label: "Community (Account, Support)" }),
  Object.freeze({ value: "home", label: "Home" }),
]);

export const DEFAULT_EXPLORER_DESTINATION = "explore";
export const DEFAULT_HOST_DESTINATION = "community";

export const PUSH_AUDIENCES = Object.freeze([
  Object.freeze({ value: "hosts", label: "Hosts", app: "Host app" }),
  Object.freeze({ value: "explorers", label: "Explorers", app: "Explorer app" }),
  Object.freeze({ value: "both", label: "Hosts and explorers", app: "Explorer app and Host app" }),
]);

export const PUSH_TITLE_MAX = 65;
export const PUSH_BODY_MAX = 178;
// The drain sends a broadcast at 12 a minute (the migration's pacing).
export const PUSH_ROWS_PER_MINUTE = 12;

export function audienceLabel(value) {
  return PUSH_AUDIENCES.find((a) => a.value === value)?.label || "Unknown audience";
}

export function audienceApps(value) {
  return PUSH_AUDIENCES.find((a) => a.value === value)?.app || "";
}

export function sendsToHosts(audience) {
  return audience === "hosts" || audience === "both";
}

export function sendsToExplorers(audience) {
  return audience === "explorers" || audience === "both";
}

export function explorerDestinationLabel(value) {
  return EXPLORER_DESTINATIONS.find((d) => d.value === value)?.label || null;
}

export function hostDestinationLabel(value) {
  return HOST_DESTINATIONS.find((d) => d.value === value)?.label || null;
}

/** "Explorer app: Discover · Host app: Home" for the review modal and lists. */
export function opensLabel(push) {
  const parts = [];
  if (sendsToExplorers(push?.audience)) parts.push(`Explorer app: ${explorerDestinationLabel(push.explorer_target) || "Explore"}`);
  if (sendsToHosts(push?.audience)) parts.push(`Host app: ${hostDestinationLabel(push.host_target) || "Community"}`);
  return parts.join(" · ");
}

/**
 * How many outbox rows a push makes (each person once per app they are sent
 * in), from the live counts, and roughly how long the paced send takes.
 */
export function pushReach(audience, counts) {
  const hosts = Number(counts?.hosts) || 0;
  const explorers = Number(counts?.explorers) || 0;
  const people = audience === "hosts" ? hosts : audience === "explorers" ? explorers : (Number(counts?.both) || 0);
  const rows = (sendsToHosts(audience) ? hosts : 0) + (sendsToExplorers(audience) ? explorers : 0);
  return { people, rows, minutes: Math.max(1, Math.ceil(rows / PUSH_ROWS_PER_MINUTE)) };
}
