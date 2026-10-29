import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import {
  ariPalette,
  ariThread,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../../constants/designSystem";
import { AriActionButton } from "../AriActionButton";
import { AriOrb } from "../AriOrb";
import type { AriRenditionFixture, AriRenditionKind } from "./ariRenditionCatalog";
import {
  AriRenditionGraphic,
  type AriRenditionGraphicVariant,
} from "./AriRenditionGraphic";
import type {
  AriRenditionActionBehaviorV1,
  AriRenditionActionStyle,
  AriRenditionActionV1,
  AriRenditionV1,
} from "./ariRenditionProtocol";

type Tone = "default" | "warning" | "danger" | "success";

interface PreviewStep {
  label: string;
  detail: string;
  state: "done" | "active" | "queued";
}

interface PreviewModel {
  userMessage?: string;
  eyebrow?: string;
  title: string;
  body: string;
  tone?: Tone;
  rows?: [string, string][];
  chips?: string[];
  selectedChip?: number;
  choices?: { title: string; detail: string; selected?: boolean }[];
  steps?: PreviewStep[];
  progress?: number;
  primaryAction?: string;
  secondaryAction?: string;
  dangerAction?: string;
  fieldLabel?: string;
  fieldValue?: string;
  code?: string;
  graphic?: AriRenditionGraphicVariant;
  sources?: string[];
}

const DEFAULT_USER_MESSAGE = "Make this event live next Friday and tell me what is missing.";

const standardRows: [string, string][] = [
  ["Brand", "The Rooftop Sessions"],
  ["Timezone", "America/New_York"],
  ["Visibility", "Paid buyers only"],
];

function modelFor(kind: AriRenditionKind, fixture: AriRenditionFixture): PreviewModel {
  const base: PreviewModel = {
    userMessage: DEFAULT_USER_MESSAGE,
    eyebrow: fixture.group,
    title: fixture.title,
    body: fixture.summary,
    rows: standardRows,
    primaryAction: "Continue",
    secondaryAction: "Review details",
  };

  switch (kind) {
    case "empty":
      return {
        eyebrow: "START WITH A GOAL",
        title: "What should we work out?",
        body: "Share a goal, flyer, voice note, document, or rough idea. Ari will build a plan and ask only for decisions that matter.",
        chips: ["Create an event", "Improve my website", "Review sales"],
      };
    case "answer":
      return {
        ...base,
        title: "I found three things to fix before publishing",
        body: "Add a refund policy, confirm who sees the exact address, and review the cover-image alt text.",
        rows: [["Recommended next step", "Confirm address privacy first"]],
        primaryAction: "Review privacy",
        secondaryAction: "Show evidence",
        sources: ["Listing draft", "Brand settings", "Public page"],
      };
    case "attachment":
      return {
        ...base,
        title: "4 attachments ready",
        body: "Ari will read the flyer, venue PDF, voice note, and cover image together.",
        chips: ["Flyer.jpg ×", "Venue.pdf ×", "Voice · 0:42 ×", "Cover.png ×"],
        primaryAction: "Send to Ari",
        secondaryAction: "Add more",
        rows: undefined,
        graphic: "media",
      };
    case "extract":
      return {
        ...base,
        eyebrow: "WHAT I FOUND",
        title: "Rooftop Sessions",
        body: "I still need the refund policy and whether the exact address should stay private.",
        rows: [["Date", "Friday 6 November · 7:00 PM"], ["Venue", "Skyline House"], ["Price", "$35"]],
        primaryAction: "Review missing details",
        secondaryAction: "Stop Ari",
        graphic: "event",
      };
    case "evidence":
      return {
        ...base,
        title: "What Ari checked",
        body: "Evidence stays compact until the host opens the supporting detail.",
        rows: [["Listing draft", "Read 2 minutes ago"], ["Refund rules", "Version 2026-09-14"], ["Public page", "Verified unpublished"]],
        sources: ["Mingla record", "Policy", "Live page"],
        primaryAction: "Open sources",
        secondaryAction: "Copy proof",
      };
    case "delivery":
      return {
        ...base,
        title: fixture.id === "new-reply" ? "Ari replied while you were reading" : "This message did not send",
        body: fixture.id === "new-reply"
          ? "Your reading position stays put until you choose to jump to the response."
          : "Your text and attachments are still here. Retry reuses the same turn identifier so the message cannot duplicate.",
        tone: fixture.id === "new-reply" ? "default" : "danger",
        rows: undefined,
        primaryAction: fixture.id === "new-reply" ? "New reply ↓" : "Retry send",
        secondaryAction: fixture.id === "new-reply" ? "Keep reading" : "Edit message",
        dangerAction: fixture.id === "new-reply" ? undefined : "Discard",
      };
    case "drawer":
      return {
        eyebrow: "CONVERSATIONS",
        title: "Today",
        body: "Brand-scoped history keeps completed work easy to find.",
        rows: [["Rooftop event setup", "Active"], ["Website refresh", "Draft"], ["Sales review", "Complete"]],
        primaryAction: "New conversation",
        secondaryAction: "Select",
      };
    case "disclosure":
      return {
        title: "Ari can help, but you stay in control",
        body: "Ari may read your Mingla workspace and propose changes. Consequential actions always show what will happen before approval.",
        rows: [["Mode", "Co-pilot"], ["Memory", "Per brand"], ["Writes", "Always confirmed"]],
        primaryAction: "Continue",
        secondaryAction: "Review privacy",
      };
    case "plan":
      return {
        ...base,
        eyebrow: fixture.id.includes("collapsed") ? "PLAN · COLLAPSED" : "LIVE PLAN · 3 OF 7",
        title: fixture.id.includes("collapsed") ? "Setup plan · 2 of 6 complete" : fixture.title,
        body: "Goal: publish a complete event without exposing the private address.",
        steps: [
          { label: "Read source material", detail: "Flyer, PDF, and transcript", state: "done" },
          { label: "Choose listing type", detail: "Event selected", state: "done" },
          { label: "Build listing details", detail: "Filling confirmed fields", state: "active" },
          { label: "Confirm price and refunds", detail: "Host decision", state: "queued" },
        ],
        progress: fixture.id.includes("collapsed") ? 34 : 43,
        rows: undefined,
        primaryAction: "Continue plan",
        secondaryAction: "Cancel plan",
      };
    case "activity":
      return {
        ...base,
        eyebrow: "WORKING · 1M 24S",
        title: "Checking the plan",
        body: "No write has happened yet.",
        steps: [
          { label: "Read listing", detail: "14 fields checked", state: "done" },
          { label: "Check brand settings", detail: "Currency and timezone matched", state: "done" },
          { label: "Compare public page", detail: "Verifying buyer-visible values", state: "active" },
          { label: "Prepare safe changes", detail: "No approval requested", state: "queued" },
        ],
        progress: 62,
        rows: undefined,
        primaryAction: "Keep waiting",
        secondaryAction: "Stop Ari",
      };
    case "assumption":
      return {
        ...base,
        title: "Two assumptions need review",
        body: "Ari will not turn inferred details into live facts without confirmation.",
        tone: "warning",
        rows: [["Doors open", "Assumed 30 minutes before start"], ["Audience", "Assumed 18+ from flyer styling"]],
        primaryAction: "Confirm assumptions",
        secondaryAction: "Edit details",
      };
    case "conflict":
      return {
        ...base,
        title: fixture.id.startsWith("memory") ? "Saved preference conflicts with this event" : "I found conflicting dates",
        body: "Choose the value that should become the source of truth.",
        tone: "warning",
        rows: undefined,
        choices: [
          { title: "Friday 6 November", detail: "Flyer · uploaded today", selected: true },
          { title: "Saturday 7 November", detail: "Existing draft · 12 days ago" },
        ],
        primaryAction: "Resolve conflict",
        secondaryAction: "Open sources",
      };
    case "blocked":
      return {
        ...base,
        title: "Waiting on payout setup",
        body: "Owner: Seth. The event can stay in draft, but it cannot publish until payout is complete.",
        tone: "warning",
        rows: [["Ari can continue", "Media, copy, tickets"], ["Ari cannot continue", "Publish, paid promotion"]],
        primaryAction: "Continue safe work",
        secondaryAction: "Open payout setup",
      };
    case "stale":
      return {
        ...base,
        title: fixture.id === "expired" ? "This approval expired" : "This plan is out of date",
        body: "The listing changed in another session. Ari must re-read it before any write.",
        tone: "warning",
        rows: undefined,
        primaryAction: "Refresh and resume",
        secondaryAction: "Discard old proposal",
      };
    case "proposal":
      return {
        ...base,
        title: "I recommend an Event listing",
        body: "It fits a scheduled, ticketed experience with a defined venue.",
        rows: undefined,
        chips: ["Event", "Experience", "Trip"],
        selectedChip: 0,
        primaryAction: "Use Event",
        secondaryAction: "Compare types",
      };
    case "choice":
      return {
        ...base,
        title: "Who should see the exact address?",
        body: "Ari will use the same rule for the listing and buyer email.",
        rows: undefined,
        chips: ["Paid buyers only", "Everyone", "Send manually"],
        selectedChip: 0,
      };
    case "typed":
      return {
        ...base,
        title: "Add the refund policy",
        body: "Use your own words. Ari will show the buyer-facing version before saving.",
        rows: undefined,
        fieldLabel: "Refund policy",
        fieldValue: "Full refund until 48 hours before the event.",
        primaryAction: "Continue",
        secondaryAction: "Use a template",
      };
    case "multi":
      return {
        ...base,
        title: "What should Ari prepare?",
        body: "Select one or more. Nothing publishes without a separate review.",
        rows: undefined,
        chips: ["Listing draft", "Buyer email", "Instagram caption", "Owner handover"],
        selectedChip: 1,
        primaryAction: "Prepare 2 items",
      };
    case "comparison":
      return {
        ...base,
        title: "Choose a ticket structure",
        body: "Both work. The difference is buyer choice and operating complexity.",
        rows: undefined,
        choices: [
          { title: "One ticket · $35", detail: "Fastest setup · simplest flow", selected: true },
          { title: "General + VIP", detail: "Higher upside · needs capacity and benefits" },
        ],
        primaryAction: "Use one ticket",
        secondaryAction: "Ask a question",
      };
    case "diff":
      return {
        ...base,
        title: "Review the change",
        body: "Only the named fields will be updated.",
        rows: [["Start time", "7:00 PM → 7:30 PM"], ["Buyer email", "Will notify 42 buyers"], ["Reason", "Venue access changed"]],
        fieldLabel: "Buyer-facing reason",
        fieldValue: "Venue doors now open at 7:00 PM.",
        primaryAction: "Approve changes",
        secondaryAction: "Edit fields",
      };
    case "handoff":
      return {
        ...base,
        title: fixture.id === "terms" ? "Organiser Terms require your acceptance" : "A secure screen is required",
        body: "Ari cannot enter bank details, accept legal terms, or impersonate a person. Your plan waits here safely.",
        rows: [["Next", "Complete the protected step"], ["Return state", "Ari resumes automatically"], ["Already saved", "Draft and media"]],
        primaryAction: "Open secure setup",
        secondaryAction: "Keep working in draft",
      };
    case "danger":
      return {
        ...base,
        title: "Cancel 42 paid orders?",
        body: "This sends buyer notices and may create refund obligations. It cannot be undone.",
        tone: "danger",
        rows: [["Orders", "42"], ["Gross value", "$1,470"], ["Buyer notice", "Required"]],
        fieldLabel: "Type CANCEL 42 ORDERS",
        fieldValue: "CANCEL 42 ORDERS",
        primaryAction: "Confirm cancellation",
        secondaryAction: "Go back",
      };
    case "record":
      return {
        ...base,
        title: fixture.title,
        body: fixture.summary,
        rows: fixture.id === "location"
          ? [["Public", "Downtown Brooklyn, NY"], ["After purchase", "123 Example Street · Floor 8"], ["Private ops", "Loading code and contact"]]
          : fixture.id === "event-confirm"
            ? [["Date", "Fri 6 Nov · 7:30 PM"], ["Tickets", "General $35 · 100"], ["Refunds", "Full until 48 hours before"]]
            : standardRows,
        primaryAction: "Confirm",
        secondaryAction: "Edit",
      };
    case "secure":
      return {
        ...base,
        title: "Do not paste bank details here",
        body: "I removed the number from this conversation. Enter it only in Mingla's protected payout screen.",
        tone: "warning",
        rows: undefined,
        primaryAction: "Open secure bank entry",
        secondaryAction: "Continue listing setup",
      };
    case "fees":
      return {
        ...base,
        title: "Who pays the fees?",
        body: "For this $35 ticket, the current configuration passes the service fee to the buyer.",
        rows: [["Ticket", "$35.00"], ["Buyer fee", "$3.15"], ["Buyer total", "$38.15"], ["Host payout", "$35 before processor adjustments"]],
        sources: ["Fee policy · effective 14 September 2026"],
        primaryAction: undefined,
        secondaryAction: "Open policy",
      };
    case "media":
      return {
        ...base,
        title: "Media is ready for review",
        body: "Ari extracted the cover, gallery, short video, and transcript.",
        rows: [["Cover crop", "1:1 and 16:9 ready"], ["Alt text", "Drafted · needs review"], ["Video", "0:18 · captions present"]],
        graphic: "media",
        primaryAction: "Review media",
        secondaryAction: "Replace cover",
      };
    case "people":
      return {
        ...base,
        title: "Import preview · 86 people",
        body: "Ari mapped the CSV without saving it. 79 rows are ready and 7 need attention.",
        rows: [["Ready", "79"], ["Missing email", "4"], ["Duplicate member", "2"], ["Unknown role", "1"]],
        primaryAction: "Review 7 rows",
        secondaryAction: "Import 79 ready",
      };
    case "sites":
      return {
        ...base,
        title: "Private website preview",
        body: "Hero, event rail, and contact section updated.",
        rows: [["Draft version", "v18"], ["Broken links", "0"], ["Missing alt text", "1"], ["Rollback", "v17 ready"]],
        graphic: "site",
        primaryAction: "Review 1 issue",
        secondaryAction: "Publish after review",
      };
    case "marketing":
      return {
        ...base,
        title: "Campaign proposal",
        body: "Ari prepared the audience and creative, but the host controls budget and launch.",
        rows: [["Goal", "Sell final 40 tickets"], ["Audience", "Past buyers + local lookalike"], ["Budget", "$120 over 4 days"], ["Creative", "2 variants ready"]],
        primaryAction: "Review campaign",
        secondaryAction: "Change budget",
      };
    case "analytics":
      return {
        ...base,
        title: "Ticket sales are 18% ahead",
        body: "Compared with the previous event at the same point before start.",
        rows: [["Sold", "58 of 100"], ["Gross", "$2,030"], ["Refund rate", "1.7%"], ["Comparison", "+9 tickets"]],
        sources: ["Orders ledger · through 2:14 PM today"],
        primaryAction: "Open orders",
        secondaryAction: "Explain the change",
      };
    case "invite":
      return {
        ...base,
        title: "Invite the accountable owner",
        body: "Ari prepares the invite while the operator continues the draft.",
        rows: [["Role", "Owner"], ["Access", "Brand, payouts, publishing"], ["Your access", "Remains operator"]],
        fieldLabel: "Owner email",
        fieldValue: "owner@example.com",
        primaryAction: "Send invite",
        secondaryAction: "Copy invite link",
      };
    case "draft":
      return {
        ...base,
        title: "Hand-over draft",
        body: "Ready to send in WhatsApp or email.",
        rows: undefined,
        code: "The Rooftop Sessions draft is ready. Please review payout setup and accept the Organiser Terms before publishing.",
        primaryAction: "Copy message",
        secondaryAction: "Edit tone",
      };
    case "publish":
      return {
        ...base,
        title: "Ready to publish",
        body: "Ari checked the host view and buyer view against the same confirmed values.",
        tone: "success",
        rows: [["Required fields", "Complete"], ["Tickets and refunds", "Confirmed"], ["Address privacy", "Confirmed"], ["Payout and Terms", "Complete"]],
        graphic: "event",
        primaryAction: "Publish event",
        secondaryAction: "Preview buyer view",
      };
    case "refusal":
      return {
        ...base,
        title: "I can't accept the Terms for you",
        body: "That decision must come from an authorized person. I can summarize what changed and keep preparing everything else.",
        tone: "warning",
        rows: undefined,
        primaryAction: "Summarize changes",
        secondaryAction: "Continue safe work",
      };
    case "receipt":
      return {
        ...base,
        title: "Event published",
        body: "The public page is live and matches the confirmed buyer view.",
        tone: "success",
        rows: [["Public link", "mingla.app/e/rooftop"], ["Published", "2:18 PM today"], ["Version", "evt_v42"], ["Verification", "Public page checked"]],
        primaryAction: "Open public page",
        secondaryAction: "Create campaign",
      };
    case "partial":
      return {
        ...base,
        title: fixture.id === "cancelled" ? "Ari stopped safely" : "7 of 9 changes completed",
        body: fixture.id === "cancelled" ? "The draft was saved. No tickets were created and nothing was published." : "Two items need human action; completed work was not rolled back.",
        tone: "warning",
        rows: [["Completed", "Listing, media, tickets, privacy"], ["Failed", "Owner invite · email bounced"], ["Waiting", "Organiser Terms"], ["Skipped", "Publish"]],
        primaryAction: fixture.id === "cancelled" ? "Resume plan" : "Fix owner email",
        secondaryAction: "Review remaining work",
      };
    case "background":
      return {
        ...base,
        title: "Image processing continues in the background",
        body: "You can leave this conversation. Ari will notify you when every crop and caption is ready.",
        rows: [["Completed", "5 of 8 assets"], ["Estimated", "About 2 minutes"], ["Next", "Accessibility review"]],
        progress: 62,
        primaryAction: "Notify me",
        secondaryAction: "Stop processing",
      };
    case "recovery":
      return {
        ...base,
        title: fixture.id === "network-recovery" ? "Mingla is temporarily unavailable" : "Ari lost access to this brand",
        body: fixture.id === "network-recovery"
          ? "This turn is preserved. Ari will retry reads and will not repeat a completed write."
          : "Your message is saved, but no workspace read or write can continue until access is restored.",
        tone: fixture.id === "network-recovery" ? "warning" : "danger",
        rows: undefined,
        primaryAction: fixture.id === "network-recovery" ? "Retry now" : "Switch brand",
        secondaryAction: fixture.id === "network-recovery" ? "Work offline" : "Sign in again",
      };
    case "protocol":
      return {
        ...base,
        title: "Update Mingla to continue",
        body: "Ari prepared a response this app version cannot display safely. No action was run.",
        tone: "warning",
        rows: [["Task state", "Paused before confirmation"], ["Safe fallback", "Text summary available"]],
        primaryAction: "Check for update",
        secondaryAction: "Copy text summary",
      };
    case "completion":
      return {
        ...base,
        title: "Goal complete",
        body: "The event is live, verified, and ready for buyers.",
        tone: "success",
        rows: [["Ari completed", "Draft, media, tickets, publish"], ["Host confirmed", "Refunds, privacy, money"], ["Remaining owner", "Monitor sales after 24 hours"], ["Proof", "Public link + evt_v42"]],
        primaryAction: "Open live event",
        secondaryAction: "Plan the next step",
      };
    case "memory":
      return {
        ...base,
        title: fixture.id === "remember" ? "Remember this for future events?" : fixture.id === "memory-manager" ? "What Ari remembers" : "Preference saved",
        body: fixture.id === "remember"
          ? "Exact addresses are shown only to paid buyers. This applies to The Rooftop Sessions, not other brands."
          : "Every memory carries scope, source, last verification, correction history, and a forget control.",
        rows: fixture.id === "memory-manager" ? [["The Rooftop Sessions", "4 memories"], ["Brooklyn Supper Club", "2 memories"], ["Personal preferences", "3 memories"]] : [["Scope", "The Rooftop Sessions"], ["Source", "Confirmed in this conversation"], ["Last verified", "29 October 2026"]],
        primaryAction: fixture.id === "remember" ? "Remember for this brand" : "Edit memory",
        secondaryAction: fixture.id === "remember" ? "Use once" : "Forget",
      };
    case "privacy":
      return {
        ...base,
        title: "Your Ari data",
        body: "Control conversations, attachments, memories, and activity records separately.",
        rows: [["Export", "Conversations + memory"], ["Delete conversations", "Keeps saved preferences"], ["Forget all memory", "Keeps history"], ["Delete all Ari data", "Permanent"]],
        primaryAction: "Export my data",
        secondaryAction: "Manage deletion",
      };
    case "researchScope":
      return {
        userMessage: "Research @rooftopsessions and tell me if they are a strong partner.",
        eyebrow: "RESEARCH SCOPE",
        title: "Choose the depth",
        body: "Ari will use public sources only and cite every finding.",
        rows: [["Quick", "3 searches · 6 pages · about 45 sec"], ["Deep", "8 searches · 20 pages · about 3 min"], ["Browser fallback", "At most 2 rendered pages"]],
        choices: [{ title: "Quick research", detail: "Enough for a first partnership read", selected: true }, { title: "Deep research", detail: "More sources and contradiction checks" }],
        primaryAction: "Start quick research",
        secondaryAction: "Edit scope",
        graphic: "research",
      };
    case "researchActivity":
      return {
        userMessage: "Research @rooftopsessions and tell me if they are a strong partner.",
        eyebrow: "RESEARCHING · 38S",
        title: "Checking public sources",
        body: "No connected account or private content is being used.",
        steps: [
          { label: "Resolve the handle", detail: "X and YouTube matched", state: "done" },
          { label: "Read recent public content", detail: "6 sources checked", state: "done" },
          { label: "Compare audience and events", detail: "Looking for contradictions", state: "active" },
          { label: "Write a cited brief", detail: "No unsupported claims", state: "queued" },
        ],
        progress: 68,
        primaryAction: "Keep researching",
        secondaryAction: "Stop research",
        graphic: "research",
      };
    case "researchSource":
      return {
        userMessage: "Show me the evidence for their event cadence.",
        eyebrow: "SOURCE · PUBLIC WEB",
        title: "Weekly rooftop events",
        body: "The organizer's public event page lists four Friday events across the next five weeks.",
        rows: [["Publisher", "Rooftop Sessions"], ["Published", "24 October 2026"], ["Accessed", "Today · 2:14 PM"], ["Evidence", "4 dated event cards"]],
        sources: ["Open source", "Copy citation", "View archived digest"],
        primaryAction: "Open source",
        secondaryAction: "Compare another source",
        graphic: "research",
      };
    case "socialProfile":
      return {
        userMessage: "Read @rooftopsessions and summarize their audience.",
        eyebrow: "PUBLIC SOCIAL SNAPSHOT",
        title: "@rooftopsessions",
        body: "Nightlife and food-led events for a Brooklyn audience. Metrics are a timestamped snapshot, not a promise of reach.",
        rows: [["Verified", "Yes"], ["Followers", "18.4K · refreshed today"], ["Recent cadence", "3 posts per week"], ["Strong themes", "Rooftops · DJs · dinner"]],
        sources: ["X profile", "YouTube channel", "Public website"],
        primaryAction: "Open cited examples",
        secondaryAction: "Refresh snapshot",
        graphic: "social",
      };
    case "connector":
      return {
        userMessage: "Use our connected TikTok account in the research.",
        eyebrow: "READ-ONLY CONNECTION",
        title: "Connect TikTok?",
        body: "Mingla will request only profile and public-video read scopes. Tokens stay encrypted on the server and can be revoked.",
        rows: [["Can read", "Your profile and public videos"], ["Cannot do", "Post, message, follow, or delete"], ["Scope", "This Mingla brand"]],
        primaryAction: "Review TikTok permissions",
        secondaryAction: "Use public sources only",
        graphic: "social",
      };
    case "browserBlocked":
      return {
        userMessage: "Read this page and include it in the brief.",
        eyebrow: "BROWSER STOPPED SAFELY",
        title: "This page could not be read",
        body: "The site presented a CAPTCHA. Ari will not bypass it or pretend the page was checked.",
        tone: "warning",
        rows: [["Page", "example.com/private-report"], ["Reason", "Human verification required"], ["Research state", "Other sources preserved"]],
        primaryAction: "Continue without it",
        secondaryAction: "Open page myself",
      };
    case "researchReport":
      return {
        userMessage: "Research @rooftopsessions and tell me if they are a strong partner.",
        eyebrow: "CITED RESEARCH REPORT",
        title: "Strong event fit; audience quality still uncertain",
        body: "They run recurring nightlife events in the right market and have consistent public activity. Public data does not prove ticket conversion.",
        rows: [["Supported", "Recurring events · local fit · active channels"], ["Uncertain", "Buyer conversion · email-list size"], ["Conflict", "Capacity differs across two pages"], ["Freshness", "6 sources · refreshed today"]],
        sources: ["6 citations", "2 social profiles", "1 conflict"],
        primaryAction: "Prepare outreach brief",
        secondaryAction: "Review all citations",
        graphic: "research",
      };
    default:
      return base;
  }
}

function protocolId(value: string, fallback: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || fallback;
}

function exampleBehavior(label: string): AriRenditionActionBehaviorV1 {
  const normalized = label.toLowerCase();
  if (normalized.includes("retry")) return { type: "local", command: "retry" };
  if (normalized.includes("stop")) return { type: "local", command: "stop" };
  if (normalized.includes("resume")) return { type: "local", command: "resume" };
  if (normalized.includes("copy")) return { type: "local", command: "copy" };
  if (normalized.includes("dismiss") || normalized.includes("keep reading")) {
    return { type: "local", command: "dismiss" };
  }
  return { type: "reply", message: label };
}

function exampleAction(
  label: string,
  style: AriRenditionActionStyle,
  index: number,
): AriRenditionActionV1 {
  return {
    id: `${style}-${protocolId(label, String(index))}`,
    label,
    style,
    behavior: exampleBehavior(label),
  };
}

function exampleVisualState(fixture: AriRenditionFixture): Pick<AriRenditionV1, "state" | "transition_label"> {
  if (["live-plan", "research-source"].includes(fixture.id)) {
    return { state: "loading", transition_label: "Ari is assembling verified details…" };
  }
  if (["activity", "background", "research-activity"].includes(fixture.id)) {
    return { state: "transitioning", transition_label: "Working through the next safe step…" };
  }
  if (["receipt", "completion", "memory-receipt"].includes(fixture.id)) {
    return { state: "submitted", transition_label: "Completed and verified" };
  }
  if (["delivery", "access-recovery", "network-recovery", "browser-blocked"].includes(fixture.id)) {
    return { state: "error", transition_label: "Needs attention" };
  }
  if (["stale-plan", "expired", "protocol"].includes(fixture.id)) {
    return { state: "disabled", transition_label: "This state is no longer actionable" };
  }
  return { state: "ready" };
}

/**
 * Build one deterministic message payload for the local contract harness.
 * The output is byte-compatible with the payload persisted by the server; the
 * gallery never renders a separate design-only view model.
 */
export function buildAriRenditionExample(fixture: AriRenditionFixture): {
  userMessage?: string;
  rendition: AriRenditionV1;
} {
  const model = modelFor(fixture.kind, fixture);
  const actions: AriRenditionActionV1[] = [];
  if (model.primaryAction) actions.push(exampleAction(model.primaryAction, "primary", actions.length));
  if (model.secondaryAction) actions.push(exampleAction(model.secondaryAction, "secondary", actions.length));
  if (model.dangerAction) actions.push(exampleAction(model.dangerAction, "danger", actions.length));
  return {
    ...(model.userMessage ? { userMessage: model.userMessage } : {}),
    rendition: {
      schema_version: 1,
      rendition_id: fixture.id,
      kind: fixture.kind,
      ...exampleVisualState(fixture),
      title: model.title,
      body: model.body,
      ...(model.eyebrow ? { eyebrow: model.eyebrow } : {}),
      ...(model.tone ? { tone: model.tone } : {}),
      ...(model.rows ? {
        rows: model.rows.map(([label, value]) => ({ label, value })),
      } : {}),
      ...(model.chips ? {
        chips: model.chips.map((label, index) => ({
          id: protocolId(label, `chip-${index}`),
          label,
          selected: model.selectedChip === index || (fixture.kind === "multi" && index < 2),
        })),
      } : {}),
      ...(model.choices ? {
        choices: model.choices.map((choice, index) => ({
          id: protocolId(choice.title, `choice-${index}`),
          label: choice.title,
          detail: choice.detail,
          ...(typeof choice.selected === "boolean" ? { selected: choice.selected } : {}),
        })),
      } : {}),
      ...(model.steps ? {
        steps: model.steps.map((step, index) => ({
          id: protocolId(step.label, `step-${index}`),
          ...step,
        })),
      } : {}),
      ...(typeof model.progress === "number" ? { progress: model.progress } : {}),
      ...(actions.length ? { actions } : {}),
      ...(model.fieldLabel ? {
        field: {
          id: protocolId(model.fieldLabel, "field"),
          label: model.fieldLabel,
          value: model.fieldValue ?? "",
          editable: true,
          ...(fixture.kind === "danger" && model.fieldValue
            ? { confirmationPhrase: model.fieldValue }
            : {}),
        },
      } : {}),
      ...(model.code ? { code: model.code } : {}),
      ...(model.graphic ? { graphic: model.graphic } : {}),
      ...(model.sources ? {
        sources: model.sources.map((label, index) => ({
          id: protocolId(label, `source-${index}`),
          label,
        })),
      } : {}),
    },
  };
}

export interface AriRenditionInteraction {
  rendition: AriRenditionV1;
  action: AriRenditionActionV1;
  selectedOptionIds: string[];
  fieldValue: string;
}

const AriRenditionStatus: React.FC<{
  state: NonNullable<AriRenditionV1["state"]>;
  label?: string;
}> = ({ state, label }) => {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0.72);

  useEffect(() => {
    if ((state === "loading" || state === "transitioning") && !reduceMotion) {
      pulse.value = withRepeat(
        withSpring(1, {
          damping: 8,
          stiffness: 105,
          mass: 0.9,
        }),
        -1,
        true,
      );
    } else {
      pulse.value = 0.72;
    }
    return (): void => cancelAnimation(pulse);
  }, [pulse, reduceMotion, state]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  if (state === "ready") return null;

  if (state === "loading") {
    return (
      <View
        style={[styles.stateRibbon, styles.stateRibbonLoading]}
        accessibilityLabel={label ?? "Ari is loading"}
        accessibilityLiveRegion="polite"
      >
        <View style={styles.stateLabelRow}>
          <Animated.View style={[styles.stateDot, styles.stateDotActive, pulseStyle]} />
          <Text style={styles.stateLabel}>{label ?? "Ari is preparing this response…"}</Text>
        </View>
        <View style={styles.skeletonRows}>
          <Animated.View style={[styles.skeletonRow, styles.skeletonWide, pulseStyle]} />
          <Animated.View style={[styles.skeletonRow, styles.skeletonMedium, pulseStyle]} />
          <Animated.View style={[styles.skeletonRow, styles.skeletonShort, pulseStyle]} />
        </View>
      </View>
    );
  }

  const symbol = state === "submitted"
    ? "✓"
    : state === "error"
      ? "!"
      : state === "disabled"
        ? "—"
        : "•";
  return (
    <View
      style={[
        styles.stateRibbon,
        state === "transitioning" && styles.stateRibbonTransitioning,
        state === "submitted" && styles.stateRibbonSubmitted,
        state === "error" && styles.stateRibbonError,
        state === "disabled" && styles.stateRibbonDisabled,
      ]}
      accessibilityLabel={label ?? state}
      accessibilityLiveRegion="polite"
    >
      <Animated.View
        style={[
          styles.stateSymbol,
          state === "transitioning" && pulseStyle,
        ]}
      >
        <Text style={styles.stateSymbolText}>{symbol}</Text>
      </Animated.View>
      <Text style={styles.stateLabel}>{label ?? state}</Text>
    </View>
  );
};

/**
 * Production structured-message renderer. MessageList uses this component for
 * persisted server payloads; the local gallery uses MessageList, so QA and the
 * live thread cannot drift onto separate markup.
 */
export const AriRenditionCard: React.FC<{
  rendition: AriRenditionV1;
  showOrb?: boolean;
  onAction?: (interaction: AriRenditionInteraction) => void;
}> = ({ rendition, showOrb = true, onAction }) => {
  const reduceMotion = useReducedMotion();
  const entranceOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const entranceOffset = useSharedValue(reduceMotion ? 0 : 8);
  const initialSelection = [...(rendition.chips ?? []), ...(rendition.choices ?? [])]
    .filter((option) => option.selected)
    .map((option) => option.id);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(initialSelection);
  const [fieldValue, setFieldValue] = useState(rendition.field?.value ?? "");
  const isMulti = rendition.kind === "multi";
  const visualState = rendition.state ?? "ready";
  const interactionLocked = visualState === "loading" ||
    visualState === "submitted" ||
    visualState === "disabled";

  useEffect(() => {
    if (reduceMotion) {
      entranceOpacity.value = 1;
      entranceOffset.value = 0;
      return;
    }
    entranceOpacity.value = withTiming(1, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
    entranceOffset.value = withSpring(0, {
      damping: 18,
      stiffness: 175,
      mass: 0.72,
    });
    return (): void => {
      cancelAnimation(entranceOpacity);
      cancelAnimation(entranceOffset);
    };
  }, [entranceOffset, entranceOpacity, reduceMotion]);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entranceOpacity.value,
    transform: [{ translateY: entranceOffset.value }],
  }));

  const selectOption = (optionId: string): void => {
    setSelectedOptionIds((current) => {
      if (isMulti) {
        return current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
      }
      return [optionId];
    });
  };
  const confirmationReady = !rendition.field?.confirmationPhrase ||
    fieldValue.trim() === rendition.field.confirmationPhrase;

  return (
    <Animated.View
      style={[styles.renditionHost, entranceStyle]}
      accessibilityLabel={`${rendition.title} Ari rendition. ${rendition.body}`}
    >
      <View style={styles.renditionOrb}>
        {showOrb ? (
          <AriOrb
            size="sm"
            thinking={visualState === "loading" || visualState === "transitioning"}
            decorative
          />
        ) : <View style={styles.renditionOrbSpacer} />}
      </View>
      <View style={styles.renditionContent}>
        {rendition.graphic ? <AriRenditionGraphic variant={rendition.graphic} /> : null}
        <View style={[
          styles.card,
          toneStyle(rendition.tone),
          visualState === "error" && styles.cardDanger,
          visualState === "submitted" && styles.cardSuccess,
          visualState === "disabled" && styles.cardDisabled,
        ]}>
          <AriRenditionStatus state={visualState} label={rendition.transition_label} />
          {rendition.eyebrow ? <Text style={styles.eyebrow}>{rendition.eyebrow.toUpperCase()}</Text> : null}
          <Text style={styles.cardTitle}>{rendition.title}</Text>
          <Text style={styles.cardBody}>{rendition.body}</Text>

          {typeof rendition.progress === "number" ? (
            <View
              style={styles.progressTrack}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: rendition.progress }}
            >
              <View style={[styles.progressFill, { width: `${rendition.progress}%` }]} />
            </View>
          ) : null}

          {rendition.steps?.length ? (
            <View style={styles.steps}>
              {rendition.steps.map((step) => (
                <View key={step.id} style={styles.step}>
                  <View style={[
                    styles.stepMarker,
                    step.state === "done" && styles.stepMarkerDone,
                    step.state === "active" && styles.stepMarkerActive,
                  ]}>
                    <Text style={styles.stepMarkerText}>{step.state === "done" ? "✓" : step.state === "active" ? "•" : "·"}</Text>
                  </View>
                  <View style={styles.stepCopy}>
                    <Text style={styles.stepTitle}>{step.label}</Text>
                    <Text style={styles.stepDetail}>{step.detail}</Text>
                  </View>
                  <Text style={styles.stepState}>{step.state === "active" ? "Now" : step.state === "done" ? "Done" : "Next"}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {rendition.rows?.length ? (
            <View style={styles.rows}>
              {rendition.rows.map((row) => (
                <View key={`${row.label}-${row.value}`} style={styles.row}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowValue}>{row.value}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {rendition.choices?.length ? (
            <View style={styles.choiceGrid} accessibilityRole="radiogroup">
              {rendition.choices.map((choice) => {
                const selected = selectedOptionIds.includes(choice.id);
                return (
                  <Pressable
                    key={choice.id}
                    disabled={interactionLocked}
                    onPress={() => selectOption(choice.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: interactionLocked }}
                    style={({ pressed }) => [
                      styles.choice,
                      selected && styles.choiceSelected,
                      interactionLocked && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.choiceTitle}>{choice.label}</Text>
                    {choice.detail ? <Text style={styles.choiceDetail}>{choice.detail}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {rendition.field ? (
            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>{rendition.field.label.toUpperCase()}</Text>
              <TextInput
                editable={rendition.field.editable !== false && !interactionLocked}
                multiline
                value={fieldValue}
                placeholder={rendition.field.placeholder}
                placeholderTextColor={ariThread.tertiaryText}
                onChangeText={setFieldValue}
                accessibilityLabel={rendition.field.label}
                style={styles.field}
              />
            </View>
          ) : null}

          {rendition.code ? (
            <View style={styles.codeBox}>
              <Text selectable style={styles.codeText}>{rendition.code}</Text>
            </View>
          ) : null}

          {rendition.sources?.length ? (
            <View style={styles.chips}>
              {rendition.sources.map((source) => (
                <View key={source.id} style={styles.sourceChip}>
                  <Text style={styles.sourceChipText}>{source.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {rendition.chips?.length ? (
          <View style={styles.chips}>
            {rendition.chips.map((chip) => {
              const selected = selectedOptionIds.includes(chip.id);
              return (
                <Pressable
                  key={chip.id}
                  disabled={interactionLocked}
                  onPress={() => selectOption(chip.id)}
                  accessibilityRole={isMulti ? "checkbox" : "radio"}
                  accessibilityState={isMulti
                    ? { checked: selected, disabled: interactionLocked }
                    : { selected, disabled: interactionLocked }}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chipSelected,
                    interactionLocked && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{chip.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {rendition.actions?.length && visualState !== "submitted" ? (
          <View style={styles.actions}>
            {rendition.actions.map((action) => {
              const disabled = interactionLocked || action.disabled === true ||
                (action.style === "primary" && !confirmationReady);
              return (
                <AriActionButton
                  key={action.id}
                  disabled={disabled}
                  label={action.label}
                  variant={action.style}
                  onPress={() => onAction?.({ rendition, action, selectedOptionIds, fieldValue })}
                  accessibilityLabel={action.label}
                />
              );
            })}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
};

const NOOP = (): void => undefined;

const toneStyle = (tone: Tone | undefined): object | undefined => {
  if (tone === "warning") return styles.cardWarning;
  if (tone === "danger") return styles.cardDanger;
  if (tone === "success") return styles.cardSuccess;
  return undefined;
};

export const AriRenditionPreview: React.FC<{ fixture: AriRenditionFixture }> = ({ fixture }) => {
  const model = useMemo(() => modelFor(fixture.kind, fixture), [fixture]);

  return (
    <View
      style={styles.window}
      accessibilityLabel={`${fixture.title} rendition preview. ${fixture.summary}`}
    >
      <View style={styles.header}>
        <View style={styles.headerIdentity}>
          <AriOrb size="sm" decorative />
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Ari</Text>
            <Text style={styles.headerMeta}>Working in The Rooftop Sessions</Text>
          </View>
        </View>
        <Pressable
          onPress={NOOP}
          accessibilityRole="button"
          accessibilityLabel="Conversation options"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Text style={styles.iconButtonText}>•••</Text>
        </Pressable>
      </View>

      <View style={styles.thread}>
        {model.userMessage ? (
          <View style={styles.userBubble}>
            <Text style={styles.userBubbleText}>{model.userMessage}</Text>
          </View>
        ) : null}

        {fixture.kind === "empty" ? (
          <View style={styles.emptyHero}>
            <AriOrb size="lg" decorative />
            <Text style={styles.emptyTitle}>{model.title}</Text>
            <Text style={styles.emptyBody}>{model.body}</Text>
          </View>
        ) : null}

        {model.graphic ? <AriRenditionGraphic variant={model.graphic} /> : null}

        {fixture.kind !== "empty" ? (
          <View style={[styles.card, toneStyle(model.tone)]}>
            {model.eyebrow ? <Text style={styles.eyebrow}>{model.eyebrow.toUpperCase()}</Text> : null}
            <Text style={styles.cardTitle}>{model.title}</Text>
            <Text style={styles.cardBody}>{model.body}</Text>

            {typeof model.progress === "number" ? (
              <View
                style={styles.progressTrack}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: model.progress }}
              >
                <View style={[styles.progressFill, { width: `${model.progress}%` }]} />
              </View>
            ) : null}

            {model.steps?.length ? (
              <View style={styles.steps}>
                {model.steps.map((step) => (
                  <View key={step.label} style={styles.step}>
                    <View style={[
                      styles.stepMarker,
                      step.state === "done" && styles.stepMarkerDone,
                      step.state === "active" && styles.stepMarkerActive,
                    ]}>
                      <Text style={styles.stepMarkerText}>{step.state === "done" ? "✓" : step.state === "active" ? "•" : "·"}</Text>
                    </View>
                    <View style={styles.stepCopy}>
                      <Text style={styles.stepTitle}>{step.label}</Text>
                      <Text style={styles.stepDetail}>{step.detail}</Text>
                    </View>
                    <Text style={styles.stepState}>{step.state === "active" ? "Now" : step.state === "done" ? "Done" : "Next"}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {model.rows?.length ? (
              <View style={styles.rows}>
                {model.rows.map(([label, value]) => (
                  <View key={`${label}-${value}`} style={styles.row}>
                    <Text style={styles.rowLabel}>{label}</Text>
                    <Text style={styles.rowValue}>{value}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {model.choices?.length ? (
              <View style={styles.choiceGrid}>
                {model.choices.map((choice) => (
                  <Pressable
                    key={choice.title}
                    onPress={NOOP}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: choice.selected }}
                    style={({ pressed }) => [
                      styles.choice,
                      choice.selected && styles.choiceSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.choiceTitle}>{choice.title}</Text>
                    <Text style={styles.choiceDetail}>{choice.detail}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {model.fieldLabel ? (
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>{model.fieldLabel.toUpperCase()}</Text>
                <TextInput
                  editable={false}
                  multiline
                  value={model.fieldValue}
                  accessibilityLabel={model.fieldLabel}
                  style={styles.field}
                />
              </View>
            ) : null}

            {model.code ? (
              <View style={styles.codeBox}>
                <Text style={styles.codeText}>{model.code}</Text>
              </View>
            ) : null}

            {model.sources?.length ? (
              <View style={styles.chips}>
                {model.sources.map((source) => (
                  <View key={source} style={styles.sourceChip}>
                    <Text style={styles.sourceChipText}>{source}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {model.chips?.length ? (
          <View style={styles.chips}>
            {model.chips.map((chip, index) => (
              <Pressable
                key={chip}
                onPress={NOOP}
                accessibilityRole="button"
                accessibilityState={{ selected: model.selectedChip === index || (fixture.kind === "multi" && index < 2) }}
                style={({ pressed }) => [
                  styles.chip,
                  (model.selectedChip === index || (fixture.kind === "multi" && index < 2)) && styles.chipSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[
                  styles.chipText,
                  (model.selectedChip === index || (fixture.kind === "multi" && index < 2)) && styles.chipTextSelected,
                ]}>{chip}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {model.primaryAction || model.secondaryAction || model.dangerAction ? (
          <View style={styles.actions}>
            {model.primaryAction ? (
              <Pressable
                onPress={NOOP}
                accessibilityRole="button"
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.primaryButtonText}>{model.primaryAction}</Text>
              </Pressable>
            ) : null}
            {model.secondaryAction ? (
              <Pressable
                onPress={NOOP}
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryButtonText}>{model.secondaryAction}</Text>
              </Pressable>
            ) : null}
            {model.dangerAction ? (
              <Pressable
                onPress={NOOP}
                accessibilityRole="button"
                style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
              >
                <Text style={styles.dangerButtonText}>{model.dangerAction}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.composer}>
        <Pressable
          onPress={NOOP}
          accessibilityRole="button"
          accessibilityLabel="Add attachment"
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <Text style={styles.addButtonText}>＋</Text>
        </Pressable>
        <View style={styles.composerField}>
          <Text style={styles.composerPlaceholder}>Ask Ari or add context…</Text>
        </View>
        <Pressable
          onPress={NOOP}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}
        >
          <Text style={styles.sendButtonText}>↑</Text>
        </Pressable>
      </View>
    </View>
  );
};

const cardBorder = Platform.OS === "android" ? "#30343b" : glass.border.profileElevated;

const styles = StyleSheet.create({
  renditionHost: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
  },
  renditionOrb: {
    width: 32,
    marginTop: 2,
    marginRight: ariThread.orbGap,
  },
  renditionOrbSpacer: {
    width: 24,
    height: 24,
  },
  renditionContent: {
    flex: 1,
    minWidth: 0,
    maxWidth: ariThread.bubbleMaxWidth,
    gap: spacing.sm,
  },
  window: {
    width: "100%",
    maxWidth: 720,
    minHeight: 610,
    backgroundColor: canvas.depth,
    borderWidth: 1,
    borderColor: "#30343b",
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  header: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "#2b3036",
  },
  headerIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerCopy: { gap: 1 },
  headerTitle: { color: textTokens.primary, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  headerMeta: { color: ariThread.tertiaryText, fontSize: 11, lineHeight: 15 },
  iconButton: {
    minWidth: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ariThread.composerSurface,
    borderWidth: 1,
    borderColor: "#30343b",
  },
  iconButtonText: { color: textTokens.primary, fontSize: 14, lineHeight: 18, letterSpacing: 1 },
  thread: { flex: 1, padding: spacing.md, gap: spacing.md },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "88%",
    borderRadius: ariThread.bubbleRadius,
    borderBottomRightRadius: ariThread.bubbleTail,
    backgroundColor: ariPalette.userBubble,
    paddingHorizontal: ariThread.bubblePadH,
    paddingVertical: ariThread.bubblePadV,
  },
  userBubbleText: { color: ariThread.onUserBubble, fontSize: 14, lineHeight: 20, fontWeight: "500" },
  emptyHero: { alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: textTokens.primary, fontSize: 21, lineHeight: 28, fontWeight: "700", textAlign: "center", marginTop: spacing.sm },
  emptyBody: { color: ariThread.secondaryText, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 460 },
  card: {
    backgroundColor: Platform.OS === "android" ? ariThread.ariBubbleAndroid : glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: cardBorder,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardWarning: { borderColor: "#f07a3d", backgroundColor: "#0b0c0f" },
  cardDanger: { borderColor: "#f07a3d", backgroundColor: "#0b0c0f" },
  cardSuccess: { borderColor: "rgba(255,255,255,0.38)", backgroundColor: "#0b0c0f" },
  cardDisabled: { opacity: 0.58, borderColor: "rgba(255,255,255,0.22)" },
  stateRibbon: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    backgroundColor: "#0b0c0f",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  stateRibbonLoading: {
    flexDirection: "column",
    alignItems: "stretch",
    backgroundColor: "#0b0c0f",
  },
  stateRibbonTransitioning: { borderColor: "#f07a3d", backgroundColor: "#0b0c0f" },
  stateRibbonSubmitted: { borderColor: "rgba(255,255,255,0.42)", backgroundColor: "#0b0c0f" },
  stateRibbonError: { borderColor: "#f07a3d", backgroundColor: "#0b0c0f" },
  stateRibbonDisabled: { borderColor: "rgba(255,255,255,0.18)", backgroundColor: "#0b0c0f" },
  stateLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stateDot: { width: 8, height: 8, borderRadius: 4 },
  stateDotActive: { backgroundColor: ariPalette.flame },
  stateSymbol: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.09)",
  },
  stateSymbolText: { color: textTokens.primary, fontSize: 12, lineHeight: 15, fontWeight: "800" },
  stateLabel: { flex: 1, color: textTokens.primary, fontSize: 11, lineHeight: 16, fontWeight: "600" },
  skeletonRows: { width: "100%", gap: spacing.xs, paddingLeft: spacing.lg },
  skeletonRow: { height: 7, borderRadius: radius.full, backgroundColor: "rgba(255,255,255,0.36)" },
  skeletonWide: { width: "88%" },
  skeletonMedium: { width: "71%" },
  skeletonShort: { width: "52%" },
  eyebrow: { color: ariThread.tertiaryText, fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 1 },
  cardTitle: { color: textTokens.primary, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  cardBody: { color: ariThread.secondaryText, fontSize: 14, lineHeight: 21 },
  rows: { marginTop: spacing.xs },
  row: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#30343b", paddingVertical: spacing.sm },
  rowLabel: {
    width: "34%",
    flexShrink: 0,
    color: ariThread.secondaryText,
    fontSize: 12,
    lineHeight: 17,
  },
  rowValue: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    color: textTokens.primary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    textAlign: "right",
  },
  progressTrack: { height: 7, borderRadius: radius.full, overflow: "hidden", backgroundColor: "#2a3035", marginTop: spacing.xs },
  progressFill: { height: "100%", borderRadius: radius.full, backgroundColor: ariPalette.flame },
  steps: { marginTop: spacing.xs },
  step: { minHeight: 52, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#30343b" },
  stepMarker: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#2a3035" },
  stepMarkerDone: { backgroundColor: ariPalette.flame },
  stepMarkerActive: { backgroundColor: ariPalette.userBubble },
  stepMarkerText: { color: "#ffffff", fontSize: 11, lineHeight: 14, fontWeight: "700" },
  stepCopy: { flex: 1, gap: 1 },
  stepTitle: { color: textTokens.primary, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  stepDetail: { color: ariThread.secondaryText, fontSize: 11, lineHeight: 16 },
  stepState: { color: ariThread.tertiaryText, fontSize: 10, lineHeight: 14 },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  choice: { flexGrow: 1, flexBasis: 180, minHeight: 74, borderRadius: radius.md, borderWidth: 1, borderColor: "#394047", padding: spacing.md, backgroundColor: canvas.depth, gap: spacing.xs },
  choiceSelected: { borderColor: ariPalette.flame, backgroundColor: "#231b18" },
  choiceTitle: { color: textTokens.primary, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  choiceDetail: { color: ariThread.secondaryText, fontSize: 11, lineHeight: 16 },
  fieldWrap: { gap: spacing.xs, marginTop: spacing.xs },
  fieldLabel: { color: ariThread.tertiaryText, fontSize: 10, lineHeight: 14, fontWeight: "700", letterSpacing: 0.8 },
  field: { minHeight: 48, borderWidth: 1, borderColor: "#3b434a", borderRadius: radius.md, backgroundColor: canvas.depth, color: textTokens.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14, lineHeight: 20 },
  codeBox: { borderWidth: 1, borderColor: "#30343b", borderRadius: radius.md, backgroundColor: "#090b0e", padding: spacing.md },
  codeText: { color: "#d6dbdd", fontSize: 12, lineHeight: 18, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: "#3a4249", borderRadius: radius.full, backgroundColor: ariThread.composerSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipSelected: { backgroundColor: ariPalette.userBubble, borderColor: ariPalette.userBubble },
  chipText: { color: textTokens.primary, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  chipTextSelected: { color: ariThread.onUserBubble },
  sourceChip: { minHeight: 32, justifyContent: "center", borderRadius: radius.full, backgroundColor: "#242a30", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  sourceChipText: { color: "#f2aa78", fontSize: 11, lineHeight: 15, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  primaryButton: {
    minHeight: 46,
    justifyContent: "center",
    alignItems: "stretch",
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "#f07a3d",
    backgroundColor: "#f07a3d",
  },
  primaryButtonFill: {
    minHeight: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryButtonText: {
    color: ariThread.onUserBubble,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: -0.12,
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(133, 145, 155, 0.34)",
    backgroundColor: "rgba(31, 36, 42, 0.82)",
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: { color: textTokens.primary, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  dangerButton: { minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: 22, borderWidth: 1, borderColor: "#f07a3d", backgroundColor: "#0b0c0f", paddingHorizontal: spacing.md },
  dangerButtonText: { color: "#f07a3d", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  disabled: { opacity: 0.42 },
  composer: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderTopColor: "#2b3036", backgroundColor: "#111418", padding: spacing.sm },
  addButton: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#30343b", backgroundColor: ariThread.composerSurface },
  addButtonText: { color: textTokens.primary, fontSize: 22, lineHeight: 25 },
  composerField: { minHeight: 46, flex: 1, borderWidth: 1, borderColor: "#343c42", borderRadius: radius.lg, backgroundColor: ariThread.composerSurface, justifyContent: "center", paddingHorizontal: spacing.md },
  composerPlaceholder: { color: ariThread.tertiaryText, fontSize: 13, lineHeight: 18 },
  sendButton: { width: 46, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: ariPalette.userBubble },
  sendButtonText: { color: ariThread.onUserBubble, fontSize: 22, lineHeight: 25, fontWeight: "700" },
  pressed: { opacity: 0.72 },
});
