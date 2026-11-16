// #4452 §6.9 — the smart report emails (design toolEmail, stage 4), one builder
// for the four free tools, on the rebranded frame (_shared/email/shell.ts).
//
// * The subject and the headline follow the result: "<their subject>: <headline
//   plain> <headline italic> <the situation's sub, or "Here are your 3 fixes.">".
//   An unpriced trip reads "<trip>: your plan is ready (prices to follow)".
// * The body: a mono label with their subject, the serif headline with its
//   italic half, the sub, the key facts, "Your 3 fixes, in order." (numbered,
//   each with its tag), then the next-step button that fits the situation (the
//   scenario's CTA, else "Open my full report / forecast / quote / audit"), and
//   the private report link.
// * The host action bar sits above the footer (renderShell `actionBar`).
// * Every number comes from the report. Nothing is invented; a missing value
//   hides its row (and an unpriced trip shows no money at all).
// * "Next from us …" appears only when they ticked the tips box (follow-ups
//   need consent, §5.11).
//
// Pure: no I/O.

import { escapeHtml } from "../_shared/email/escape.ts";
import { renderButton } from "../_shared/email/actionBar.ts";
import { renderFacts, renderHeadline } from "../_shared/email/shell.ts";

export type GateTool = "venues" | "events" | "trips" | "experiences";

const INK = "#111110";
const MUTED = "#7C7870";
const BODY = "#3F3D39";
const HAIRLINE = "#D8D5CD";
const SITE = "https://usemingla.com";

const LABEL: Record<GateTool, string> = {
  venues: "Venue grader",
  events: "Turnout forecast",
  trips: "Trip quote",
  experiences: "Pricing audit",
};
const BASE_CTA: Record<GateTool, string> = {
  venues: "Open my full report",
  events: "Open my full forecast",
  trips: "Open my full quote",
  experiences: "Open my full audit",
};
/** The scenario copy (design TSC): the reason, its CTA and its sub. */
const SCENARIO: Record<GateTool, { reason: string; cta: string; sub: string }> = {
  venues: { reason: "no_website", cta: "Make my free Mingla page", sub: "You don’t have a website yet. Here’s what that costs you." },
  events: { reason: "free_rsvp", cta: "Set up RSVPs on Mingla", sub: "Free events fill differently. Here’s your plan." },
  trips: { reason: "group_over_15", cta: "Turn this into a bookable trip", sub: "Big groups change the maths. Here’s your quote." },
  experiences: { reason: "free_today", cta: "Start charging with Mingla", sub: "Free is costing you. Here’s what to charge." },
};
/** §5.10: the host bar's call goes to /schedule?icp=<icp>. */
export const TOOL_ICP: Record<GateTool, string> = { venues: "restaurants", events: "events", trips: "trips", experiences: "experiences" };

const rec = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency || "USD", maximumFractionDigits: n < 100 && !Number.isInteger(n) ? 2 : 0 }).format(n);
  } catch {
    return `${currency} ${Math.round(n)}`;
  }
}

/** §6.5, the same rule as the server and the page: no money when the prices did not come back. */
export function tripUnpriced(report: Record<string, unknown>): boolean {
  if (report.pricing_status === "unpriced") return true;
  const plan = rec(report.plan);
  const lines = arr(plan.cost_lines).map((l) => num(rec(l).per_person) ?? 0);
  const price = num(plan.recommended_price_per_person) ?? 0;
  return lines.reduce((s, n) => s + n, 0) <= 0 || price <= 0 || lines.filter((n) => n > 0).length < 2;
}

const EFFORT: Record<string, string> = { this_week: "This week", this_month: "This month", project: "Bigger project" };

export interface ToolEmailInput {
  tool: GateTool;
  report: Record<string, unknown>;
  reportLink: string;
  /** They ticked "Also send me tips for hosts" (the follow-ups line shows only then). */
  tips: boolean;
}

export interface ToolEmail {
  subject: string;
  preheader: string;
  label: string;
  bodyHtml: string;
  text: string;
  /** The next-step button's text (the scenario's CTA, else the tool's). */
  cta: string;
  /** The situation the report was run for, when one applied. */
  reason: string | null;
}

interface Parts {
  who: string;
  eh: [string, string];
  sub: string | null;
  facts: Array<[string, string]>;
  fixes: Array<{ title: string; body: string; tag: string }>;
  subjectOverride?: string;
}

function fixesOf(report: Record<string, unknown>, venue: boolean): Parts["fixes"] {
  return arr(report.fixes).slice(0, 3).map((f, i) => {
    const r = rec(f);
    const tag = i === 0 ? "Biggest win"
      : venue ? (r.impact === "high" ? "High impact" : "Quick fix")
      : (EFFORT[str(r.effort)] ?? "Next");
    return { title: str(r.title), body: str(r.change) || str(r.why), tag };
  }).filter((f) => f.title !== "");
}

function partsOf(tool: GateTool, report: Record<string, unknown>, situation: Record<string, unknown> | null): Parts {
  if (tool === "venues") {
    const venue = rec(report.venue);
    const scores = rec(report.scores);
    const overall = num(scores.overall);
    const pct = rec(report.percentile);
    const checks = arr(rec(report.site_signals).checks);
    const failing = checks.filter((c) => rec(c).status === "fail").length;
    const facts: Array<[string, string]> = [];
    if (situation) facts.push(["Website on Google", "None found"]);
    if (situation && str(situation.found_via)) facts.push(["People find you on", { instagram: "Instagram", whatsapp: "WhatsApp", google_only: "Google only" }[str(situation.found_via)] ?? ""]);
    if (overall !== null) facts.push(["Score", `${Math.round(overall)} out of 100`]);
    if (str(scores.grade)) facts.push(["Grade", str(scores.grade)]);
    const better = num(pct.better_than_pct);
    if (better !== null && str(pct.city)) facts.push(["Against places nearby", `Better than ${Math.round(better)}% in ${str(pct.city)}`]);
    if (checks.length > 0) facts.push(["Site checks failing", `${failing} of ${checks.length}`]);
    return {
      who: str(venue.name) || "Your venue",
      eh: situation ? ["No website,", "yet."] : overall !== null ? [`${Math.round(overall)} out of`, "100."] : ["Your report is", "ready."],
      sub: situation ? SCENARIO.venues.sub : null,
      facts: facts.filter(([, v]) => v !== ""),
      fixes: fixesOf(report, true),
    };
  }
  if (tool === "events") {
    const ev = rec(report.event);
    const f = rec(report.forecast);
    const plan = rec(report.plan);
    const lo = num(f.total_low);
    const hi = num(f.total_high);
    const cap = num(f.capacity);
    const cur = str(plan.currency) || str(ev.currency) || "USD";
    const facts: Array<[string, string]> = [];
    if (lo !== null && hi !== null) facts.push(["Likely turnout", cap !== null ? `${lo}–${hi} of ${cap}` : `${lo}–${hi}`]);
    if (str(f.confidence)) facts.push(["Confidence", str(f.confidence)[0].toUpperCase() + str(f.confidence).slice(1)]);
    if (situation && num(situation.rsvp_goal) !== null) facts.push(["Your RSVP goal", String(num(situation.rsvp_goal))]);
    if (plan.kind === "paid_optimized" && plan.ads_worth_it === true && num(plan.recommended_budget) !== null) {
      facts.push(["Best promo budget", money(num(plan.recommended_budget) as number, cur)]);
    }
    const comps = arr(report.competitors).length;
    if (comps > 0) facts.push(["Other events that night", `${comps} nearby`]);
    return {
      who: str(ev.title) || "Your event",
      eh: lo !== null && hi !== null ? [`${lo}–${hi} people,`, "likely."] : ["Your forecast is", "ready."],
      sub: situation ? SCENARIO.events.sub : null,
      facts,
      fixes: fixesOf(report, false),
    };
  }
  if (tool === "trips") {
    const trip = rec(report.trip);
    const plan = rec(report.plan);
    const cur = str(plan.currency) || str(trip.currency) || "USD";
    const title = str(trip.title) || "Your trip";
    const unpriced = tripUnpriced(report);
    const facts: Array<[string, string]> = [];
    if (str(trip.destination)) facts.push(["Destination", str(trip.destination)]);
    if (num(trip.days) !== null) facts.push(["Length", `${num(trip.days)} days`]);
    if (num(trip.group_size) !== null) facts.push(["Group", `${num(trip.group_size)} people`]);
    if (situation) facts.push(["Coach and rooms", `${situation.coach === true ? "Coach" : "No coach"}, ${str(situation.rooms)} rooms`]);
    if (!unpriced) {
      const price = num(plan.recommended_price_per_person);
      if (price !== null) facts.push(["Charge per person", money(price, cur)]);
      if (num(plan.recommended_margin_pct) !== null) facts.push(["Your margin", `${num(plan.recommended_margin_pct)}%`]);
      if (num(plan.group_profit) !== null && (num(plan.group_profit) as number) > 0) facts.push(["Group profit", money(num(plan.group_profit) as number, cur)]);
    } else {
      facts.push(["Prices", "To follow, when live rates come back"]);
    }
    const price = num(plan.recommended_price_per_person);
    return {
      who: title,
      eh: unpriced ? ["Your plan is", "ready."] : price !== null ? [money(price, cur), "per person."] : ["Your quote is", "ready."],
      sub: situation ? SCENARIO.trips.sub : unpriced ? "Live prices didn’t come back yet. Your plan, hotels and activities are ready; prices will follow." : null,
      facts,
      fixes: fixesOf(report, false),
      subjectOverride: unpriced ? `${title}: your plan is ready (prices to follow)` : undefined,
    };
  }
  // experiences (the pricing audit)
  const exp = rec(report.experience);
  const a = rec(report.audit);
  const cur = str(a.currency) || str(exp.currency) || "USD";
  const desc = str(exp.description);
  const who = desc.length > 60 ? `${desc.slice(0, 57)}…` : desc || "Your experience";
  const extra = num(a.extra_per_head);
  const costHead = num(a.cost_per_head);
  const recPrice = num(a.recommended_price);
  const upside = num(a.monthly_upside);
  const comps = arr(report.comps).map((c) => num(rec(c).price_pp)).filter((n): n is number => n !== null && n > 0);
  const facts: Array<[string, string]> = [];
  if (situation && num(situation.session_cost) !== null) facts.push(["Each session costs you", money(num(situation.session_cost) as number, cur)]);
  if (costHead !== null) facts.push(["Your true cost per head", money(costHead, cur)]);
  if (comps.length > 0) facts.push(["Similar experiences nearby", comps.length === 1 ? money(comps[0], cur) : `${money(Math.min(...comps), cur)} to ${money(Math.max(...comps), cur)}`]);
  if (recPrice !== null) facts.push([situation ? "A fair first price" : "The price to charge", money(recPrice, cur)]);
  if (upside !== null && upside > 0) facts.push([a.verdict === "losing" ? "Swing to profit a month" : "Extra per month", money(upside, cur)]);
  return {
    who,
    eh: situation && costHead !== null ? ["You pay", `${money(costHead, cur)} a head.`]
      : a.verdict === "healthy" ? ["Priced about", "right."]
      : extra !== null && extra > 0 ? ["Raise it", `${money(extra, cur)} a seat.`]
      : ["Your audit is", "ready."],
    sub: situation ? SCENARIO.experiences.sub : null,
    facts,
    fixes: fixesOf(report, false),
  };
}

const HOST_GET = `${SITE}/host/get`;

export function buildToolReportEmail({ tool, report, reportLink, tips }: ToolEmailInput): ToolEmail {
  const followup = rec(report.followup);
  const situation = str(followup.reason) === SCENARIO[tool].reason ? followup : null;
  const p = partsOf(tool, report, situation);
  const n = p.fixes.length;
  const subjectTail = p.sub ?? (n === 3 ? "Here are your 3 fixes." : n === 1 ? "Here is your fix." : n > 0 ? `Here are your ${n} fixes.` : "Your report is ready.");
  const subject = (p.subjectOverride ?? `${p.who}: ${p.eh[0]} ${p.eh[1]} ${subjectTail}`).replace(/\s+/g, " ").trim().slice(0, 180);
  const cta = situation ? SCENARIO[tool].cta : BASE_CTA[tool];
  const ctaHref = situation ? HOST_GET : reportLink;
  const intro = p.sub ?? "We checked it live today. Here is what matters most, in order.";

  const html: string[] = [];
  html.push(`<p style="margin:0 0 10px 0;font-family:'Geist Mono',Menlo,Consolas,monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};">${escapeHtml(p.who)}</p>`);
  html.push(renderHeadline(p.eh[0], p.eh[1]));
  html.push(`<p style="margin:0 0 6px 0;">${escapeHtml(intro)}</p>`);
  if (p.facts.length > 0) html.push(renderFacts(p.facts));
  if (p.fixes.length > 0) {
    html.push(`<p style="margin:22px 0 12px 0;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-size:24px;line-height:1.1;color:${INK};">Your ${p.fixes.length === 3 ? "3 " : ""}fixes, <em>in order.</em></p>`);
    html.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${
      p.fixes.map((f, i) => `<tr><td width="40" valign="top" style="padding:0 12px 14px 0;"><span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:${INK};color:#FFFFFF;text-align:center;font-size:12px;font-weight:600;">${i + 1}</span></td><td valign="top" style="padding:0 0 14px 0;font-size:15px;line-height:1.5;color:${BODY};"><b style="color:${INK};">${escapeHtml(f.title)}</b> <span style="font-family:'Geist Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;border:1px solid ${HAIRLINE};border-radius:999px;padding:1px 7px;color:${MUTED};white-space:nowrap;">${escapeHtml(f.tag)}</span>${f.body ? `<br />${escapeHtml(f.body)}` : ""}</td></tr>`).join("")
    }</table>`);
  }
  html.push(`<p style="margin:20px 0 8px 0;">${renderButton(cta, ctaHref, "primary")}</p>`);
  html.push(`<p style="margin:0 0 4px 0;font-size:13px;color:${MUTED};">${situation ? `Your full report: <a href="${escapeHtml(reportLink)}" style="color:${INK};text-decoration:underline;">${escapeHtml(BASE_CTA[tool])}</a>. ` : ""}This link is just for you and works for 30 days.</p>`);
  html.push(`<p style="margin:14px 0 0 0;font-size:12px;color:${MUTED};">Every number above comes from your answers and live research today.${tips ? " Next from us: day 2, “Fix #1 in ten minutes”; day 7, a free re-check." : ""}</p>`);

  const text: string[] = [p.who.toUpperCase(), `${p.eh[0]} ${p.eh[1]}`, intro, ""];
  for (const [k, v] of p.facts) text.push(`${k}: ${v}`);
  if (p.fixes.length > 0) {
    text.push("", `YOUR ${p.fixes.length === 3 ? "3 " : ""}FIXES, IN ORDER`);
    p.fixes.forEach((f, i) => text.push(`${i + 1}. ${f.title} [${f.tag}]${f.body ? ` ${f.body}` : ""}`));
  }
  text.push("", `${cta}: ${ctaHref}`);
  if (situation) text.push(`${BASE_CTA[tool]}: ${reportLink}`);
  text.push("This link is just for you and works for 30 days.");
  if (tips) text.push("", "Next from us: day 2, “Fix #1 in ten minutes”; day 7, a free re-check.");

  return {
    subject,
    preheader: `${p.eh[0]} ${p.eh[1]} ${intro}`.slice(0, 140),
    label: LABEL[tool],
    bodyHtml: html.join("\n"),
    text: text.join("\n"),
    cta,
    reason: situation ? SCENARIO[tool].reason : null,
  };
}
