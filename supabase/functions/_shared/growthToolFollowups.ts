// #4452 §6.2 — the free tools' adaptive follow-up answers (design TSC).
//
// Each tool's intake can ask one extra question when an answer calls for it
// ("Asked because …"). The answers ride on the run input as `input.followup`.
// This module is the one server-side validator: bounded numbers and enums only
// (never free text), and only for the scenario that asks them. A follow-up
// sent for the wrong scenario is rejected (400 fields:["followup"]), so a
// crafted body cannot steer a paid event's prompt with RSVP answers. Absent or
// null means today's behaviour, byte for byte: no key in the persisted input,
// no prompt lines.
//
// Pure: no I/O.

export type FollowupTool = "venues" | "events" | "trips" | "experiences";

export interface VenueFollowup {
  reason: "no_website";
  found_via: "instagram" | "whatsapp" | "google_only";
}
export interface EventFollowup {
  reason: "free_rsvp";
  rsvp_goal: number;
  no_shows: "lots" | "few";
}
export interface TripFollowup {
  reason: "group_over_15";
  coach: boolean;
  rooms: "twin" | "single";
}
export interface PricingFollowup {
  reason: "free_today";
  session_cost: number;
  deposit: "probably" | "not_sure";
}
export type ToolFollowup = VenueFollowup | EventFollowup | TripFollowup | PricingFollowup;

/** The facts each scenario is decided by (already validated by the tool). */
export interface FollowupContext {
  /** venues: the normalised website, or "" when none was given. */
  website?: string;
  /** venues: the place pool id of the Google pick. */
  placeId?: string | null;
  /** events: the ticket price (0 = free). */
  ticketPrice?: number;
  /** trips: the group size. */
  groupSize?: number;
  /** pricing: the current price (0 = free). */
  currentPrice?: number;
}

/** Trips ask about a coach and rooms from 16 people ("groups over 15"). */
export const TRIP_GROUP_THRESHOLD = 16;

export type FollowupParse<T> = { ok: true; value: T | null } | { ok: false };

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function boundedInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}
function boundedMoney(v: unknown, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) return null;
  return Math.round(v * 100) / 100;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? v as T : null;
}
function onlyKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(o).every((k) => keys.includes(k));
}

/** Is this tool's adaptive question asked, for these facts? */
export function followupApplies(tool: FollowupTool, ctx: FollowupContext): boolean {
  switch (tool) {
    case "venues":
      return (ctx.website ?? "") === "" && typeof ctx.placeId === "string" && ctx.placeId.length > 0;
    case "events":
      return ctx.ticketPrice === 0;
    case "trips":
      return typeof ctx.groupSize === "number" && ctx.groupSize >= TRIP_GROUP_THRESHOLD;
    case "experiences":
      return ctx.currentPrice === 0;
  }
}

/**
 * Validate `input.followup` for one tool. `undefined` / `null` → {ok, value:null}
 * (today's behaviour). Anything else must be the exact shape for this tool AND
 * the scenario must apply, or the run is rejected.
 */
export function parseToolFollowup(
  tool: FollowupTool,
  raw: unknown,
  ctx: FollowupContext,
): FollowupParse<ToolFollowup> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isObj(raw) || !followupApplies(tool, ctx)) return { ok: false };
  switch (tool) {
    case "venues": {
      const found_via = oneOf(raw.found_via, ["instagram", "whatsapp", "google_only"] as const);
      if (!found_via || !onlyKeys(raw, ["reason", "found_via"]) || (raw.reason !== undefined && raw.reason !== "no_website")) return { ok: false };
      return { ok: true, value: { reason: "no_website", found_via } };
    }
    case "events": {
      const rsvp_goal = boundedInt(raw.rsvp_goal, 1, 500000);
      const no_shows = oneOf(raw.no_shows, ["lots", "few"] as const);
      if (rsvp_goal === null || !no_shows || !onlyKeys(raw, ["reason", "rsvp_goal", "no_shows"]) || (raw.reason !== undefined && raw.reason !== "free_rsvp")) return { ok: false };
      return { ok: true, value: { reason: "free_rsvp", rsvp_goal, no_shows } };
    }
    case "trips": {
      const coach = typeof raw.coach === "boolean" ? raw.coach : null;
      const rooms = oneOf(raw.rooms, ["twin", "single"] as const);
      if (coach === null || !rooms || !onlyKeys(raw, ["reason", "coach", "rooms"]) || (raw.reason !== undefined && raw.reason !== "group_over_15")) return { ok: false };
      return { ok: true, value: { reason: "group_over_15", coach, rooms } };
    }
    case "experiences": {
      const session_cost = boundedMoney(raw.session_cost, 10000000);
      const deposit = oneOf(raw.deposit, ["probably", "not_sure"] as const);
      if (session_cost === null || !deposit || !onlyKeys(raw, ["reason", "session_cost", "deposit"]) || (raw.reason !== undefined && raw.reason !== "free_today")) return { ok: false };
      return { ok: true, value: { reason: "free_today", session_cost, deposit } };
    }
  }
}

const FOUND_VIA: Record<VenueFollowup["found_via"], string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google_only: "Google only",
};

/**
 * The research-prompt lines for a follow-up (empty for null, so a run without
 * the new answers builds today's prompt exactly). Values are enums and bounded
 * numbers, never visitor text.
 */
export function followupPromptLines(followup: ToolFollowup | null | undefined, currency = ""): string[] {
  if (!followup) return [];
  switch (followup.reason) {
    case "no_website":
      return [
        "SITUATION: Google lists NO website for this venue (asked because Google lists no website).",
        `Where people find them today: ${FOUND_VIA[followup.found_via]}.`,
        "Do not treat this as a broken site. Make the grades, reasons and fixes about getting a simple page:",
        "a free Mingla page with the menu, photos, booking and directions in one link, then putting that link",
        "on their Google profile and their Instagram bio. Never invent a website address.",
      ];
    case "free_rsvp":
      return [
        "SITUATION: a FREE, RSVP-only event (asked because it's free).",
        `RSVP goal: ${followup.rsvp_goal}. No-shows before: ${followup.no_shows === "lots" ? "yes, lots" : "a few"}.`,
        "Forecast the show-up rate of RSVPs and how many RSVPs to aim for to fill the room; fixes should cover",
        "reminders and other ways to cut no-shows.",
      ];
    case "group_over_15":
      return [
        "SITUATION: a group over 15 people (asked because groups over 15 need transport).",
        `Coach between stops: ${followup.coach ? "yes" : "no"}. Rooms: ${followup.rooms}.`,
        followup.coach
          ? "Price a coach for the whole trip and split it per person; price rooms as " + followup.rooms + " occupancy."
          : "No coach; price rooms as " + followup.rooms + " occupancy.",
      ];
    case "free_today":
      return [
        "SITUATION: the experience is FREE today (asked because it's free today).",
        `What each session costs the host: ${followup.session_cost}${currency ? ` ${currency}` : ""}.`,
        `Would guests pay a deposit: ${followup.deposit === "probably" ? "probably" : "not sure"}.`,
        "Show what they pay out of pocket per head and a fair first price; fixes should cover switching from free to paid.",
      ];
  }
}
