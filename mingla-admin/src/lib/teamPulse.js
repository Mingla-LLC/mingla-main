// Issue #4130 (Wave 1) — the Team dashboard's row of numbers and pipeline
// charts, shaped from what the server counted (crm_team_pulse,
// crm_team_summary, ops_team_overview, ops_work_list). Pure module.

export const PULSE_PERIODS = Object.freeze([
  Object.freeze({ value: "week", label: "This week" }),
  Object.freeze({ value: "30d", label: "Last 30 days" }),
]);

/** The period the numbers cover: Monday 00:00 local, or the last 30 days. */
export function pulseRange(period, now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (period === "30d") return { from: new Date(d.getTime() - 30 * 86_400_000), to: d, before: "the 30 days before" };
  const dow = (d.getDay() + 6) % 7;
  return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow), to: d, before: "last week" };
}

function delta(now, before, what) {
  const a = Number(now);
  const b = Number(before);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { note: "", up: undefined };
  if (a === b) return { note: `same as ${what}`, up: undefined };
  return a > b ? { note: `+${a - b} vs ${what}`, up: true } : { note: `${b - a} fewer than ${what}`, up: false };
}

function stageLabel(config, pipeline, id, fallback) {
  const stages = config?.pipelines?.[pipeline]?.stages;
  return (Array.isArray(stages) ? stages : []).find((s) => s.id === id)?.label || fallback;
}

/**
 * The six numbers, in the approved order. Each is { key, label, value, note,
 * up, alert, href }. A number whose read failed is null and the tile says so;
 * nothing is shown as 0 that was not counted.
 */
export function pulseTiles({ pulse, targets, runway, waiting, config, period }) {
  const range = pulseRange(period);
  const now = pulse?.now || null;
  const before = pulse?.before || null;
  const tiles = [];
  const contacted = delta(now?.hosts_contacted, before?.hosts_contacted, range.before);
  tiles.push({ key: "contacted", label: "Hosts contacted", value: now ? Number(now.hosts_contacted) || 0 : null, note: contacted.note, up: contacted.up, href: "#/outreach?tab=hosts" });
  const list = Array.isArray(targets) ? targets : [];
  const goal = list.reduce((n, t) => n + (Number(t.monthly_target) || 0), 0);
  const done = list.reduce((n, t) => n + (Number(t.done) || 0), 0);
  tiles.push({
    key: "onboarded", label: "Hosts onboarded", value: now ? Number(now.hosts_onboarded) || 0 : null,
    note: goal > 0 ? `${done} of ${goal} this month's target` : "no target set this month",
    up: goal > 0 ? done >= goal : undefined, href: "#/outreach?tab=hosts",
  });
  const counts = runway?.counts || null;
  const atRisk = Array.isArray(runway?.at_risk) ? runway.at_risk.length : 0;
  const events = counts ? ["full", "tight", "organic", "missed", "not_live"].reduce((n, k) => n + (Number(counts[k]) || 0), 0) : null;
  tiles.push({
    key: "events", label: "Events in the next 90 days", value: events,
    note: counts ? (atRisk > 0 ? `${atRisk} short on promotion time` : "all on time") : "", up: counts ? atRisk === 0 : undefined,
    alert: atRisk > 0, href: "#/content-calendar",
  });
  const booked = stageLabel(config, "creators", "booked", "Booked");
  const creators = delta(now?.moves?.creators?.booked ?? 0, before?.moves?.creators?.booked ?? 0, range.before);
  tiles.push({ key: "creators", label: `Creators moved to ${booked}`, value: now ? Number(now.moves?.creators?.booked) || 0 : null, note: now ? creators.note : "", up: creators.up, href: "#/outreach?tab=creators" });
  const leads = delta(now?.beta_leads, before?.beta_leads, range.before);
  tiles.push({ key: "leads", label: "New beta leads", value: now ? Number(now.beta_leads) || 0 : null, note: leads.note, up: leads.up, href: "#/inbound" });
  tiles.push({ key: "waiting", label: "Cards waiting on a person", value: Number.isFinite(Number(waiting)) && waiting !== null ? Number(waiting) : null, note: "", up: undefined, href: "#/work-board" });
  return tiles;
}

/** One pipeline's stages in order, with how many records moved into each. */
export function stageMoves(config, pipeline, moves) {
  const stages = config?.pipelines?.[pipeline]?.stages;
  const m = moves && typeof moves === "object" ? moves : {};
  return (Array.isArray(stages) ? stages : []).map((s) => ({ id: s.id, label: s.label || s.id, moved: Number(m[s.id]) || 0 }));
}
