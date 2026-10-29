/**
 * #3355 — the local Ari rendition contract.
 *
 * These fixtures are deterministic on purpose: the gallery is a visual test
 * surface, not a second mock backend. Advanced server paths will map versioned
 * Ari response blocks onto the same `kind` vocabulary in the next phase.
 */

export type AriRenditionLineage = "Contract" | "Shipped" | "Extend" | "New";

export type AriRenditionGroup =
  | "Conversation"
  | "Plans and reasoning"
  | "Decisions and confirmations"
  | "Capability renditions"
  | "Results and recovery"
  | "Memory and trust"
  | "Research and browser";

export type AriRenditionKind =
  | "empty"
  | "answer"
  | "attachment"
  | "extract"
  | "evidence"
  | "delivery"
  | "drawer"
  | "disclosure"
  | "plan"
  | "activity"
  | "assumption"
  | "conflict"
  | "blocked"
  | "stale"
  | "proposal"
  | "choice"
  | "typed"
  | "multi"
  | "comparison"
  | "diff"
  | "handoff"
  | "danger"
  | "record"
  | "secure"
  | "fees"
  | "media"
  | "people"
  | "sites"
  | "marketing"
  | "analytics"
  | "invite"
  | "draft"
  | "publish"
  | "refusal"
  | "receipt"
  | "partial"
  | "background"
  | "recovery"
  | "protocol"
  | "completion"
  | "memory"
  | "privacy"
  | "researchScope"
  | "researchActivity"
  | "researchSource"
  | "socialProfile"
  | "connector"
  | "browserBlocked"
  | "researchReport";

export interface AriRenditionFixture {
  id: string;
  title: string;
  group: AriRenditionGroup;
  lineage: AriRenditionLineage;
  summary: string;
  kind: AriRenditionKind;
}

const f = (
  id: string,
  title: string,
  group: AriRenditionGroup,
  lineage: AriRenditionLineage,
  summary: string,
  kind: AriRenditionKind,
): AriRenditionFixture => ({ id, title, group, lineage, summary, kind });

export const ARI_RENDITION_GROUPS: readonly AriRenditionGroup[] = [
  "Conversation",
  "Plans and reasoning",
  "Decisions and confirmations",
  "Capability renditions",
  "Results and recovery",
  "Memory and trust",
  "Research and browser",
] as const;

export const ARI_RENDITION_FIXTURES: readonly AriRenditionFixture[] = [
  f("empty", "Empty Ari after first sign-in", "Conversation", "Contract", "A calm start with example goals, disclosure, and one obvious first action.", "empty"),
  f("thread", "Thread and rich bubbles", "Conversation", "Extend", "Readable turns with semantic spacing, lists, code, and tappable links.", "answer"),
  f("attachment-tray", "Attachment tray", "Conversation", "Shipped", "Photos, documents, voice, camera, removal, and limits before send.", "attachment"),
  f("flyer-extract", "Flyer + text extraction summary", "Conversation", "Contract", "Ari separates extracted facts, inferences, and missing decisions.", "extract"),
  f("semantic-answer", "Semantic answer", "Conversation", "Extend", "Structured output stays readable without duplicating the same prose in cards.", "answer"),
  f("evidence", "Evidence and sources", "Conversation", "New", "Compact proof with freshness, provenance, and expandable source detail.", "evidence"),
  f("new-reply", "New reply and scroll anchor", "Conversation", "Shipped", "A new-reply control preserves the host's reading position.", "delivery"),
  f("delivery", "Send retry, edit, and discard", "Conversation", "Shipped", "A failed local turn remains recoverable without duplicate messages.", "delivery"),
  f("history", "Conversation drawer", "Conversation", "Shipped", "Brand-scoped history, rename, delete, selection, and read-only legacy states.", "drawer"),
  f("disclosure", "Disclosure and Ari settings", "Conversation", "Extend", "AI boundaries, preferences, memory, and privacy use web-safe controls.", "disclosure"),

  f("journey", "Journey and rules overview", "Plans and reasoning", "Contract", "The onboarding journey generalizes to any multi-step goal.", "plan"),
  f("plan-collapsed", "Onboarding plan · collapsed", "Plans and reasoning", "Contract", "A persistent one-line plan summary never steals the thread.", "plan"),
  f("plan-expanded", "Onboarding plan · expanded", "Plans and reasoning", "Contract", "Steps, ownership, evidence, blockers, and confirmations stay together.", "plan"),
  f("live-plan", "Live task plan", "Plans and reasoning", "New", "A server-authored plan can drive any capability through one renderer.", "plan"),
  f("activity", "Multi-step activity", "Plans and reasoning", "New", "The current step, checked systems, elapsed work, stop, and wait controls.", "activity"),
  f("assumptions", "Assumption review", "Plans and reasoning", "New", "Known facts and assumptions are separated before consequential work.", "assumption"),
  f("source-conflict", "Source conflict", "Plans and reasoning", "New", "Conflicting facts show provenance and require an explicit resolution.", "conflict"),
  f("blocked", "Blocked, waiting, and resume", "Plans and reasoning", "New", "Ari names the owner and next action instead of silently stalling.", "blocked"),
  f("stale-plan", "Stale plan, cancel, and restart", "Plans and reasoning", "New", "Plans survive reconnects while unsafe stale approvals expire.", "stale"),

  f("listing-proposal", "Listing-type proposal", "Decisions and confirmations", "Contract", "Ari recommends a listing shape and explains the tradeoff.", "proposal"),
  f("brand-confirm", "Brand confirm card", "Decisions and confirmations", "Contract", "A brand choice is explicit, scoped, and reversible.", "record"),
  f("single-select", "Single-select prompt", "Decisions and confirmations", "Shipped", "Mutually exclusive choices retain a clear submitted state.", "choice"),
  f("typed-detail", "Typed clarification", "Decisions and confirmations", "Shipped", "Precise host language is captured without losing plan context.", "typed"),
  f("multi-select", "Multi-select prompt", "Decisions and confirmations", "Shipped", "Several applicable choices show their minimum and maximum.", "multi"),
  f("comparison", "Comparison decision", "Decisions and confirmations", "New", "Side-by-side tradeoffs clarify plans, prices, dates, and policies.", "comparison"),
  f("inline-edit", "Inline edit and diff review", "Decisions and confirmations", "New", "The host edits proposed fields and sees exactly what changes.", "diff"),
  f("safe-handoff", "Safe screen handoff", "Decisions and confirmations", "New", "Ari explains the human-only screen and waits for the host to return.", "handoff"),
  f("high-risk", "Money and destructive confirmation", "Decisions and confirmations", "Extend", "Impact, scope, irreversibility, reason, and typed confirmation.", "danger"),

  f("terms", "Organiser Terms", "Capability renditions", "Contract", "Version, scope, and human acceptance without pretending Ari can consent.", "handoff"),
  f("bank-ng", "Nigeria secure bank entry", "Capability renditions", "Contract", "Pasted bank data is rejected and moved to a protected surface.", "secure"),
  f("payout-rail", "Card-rail payout handoff", "Capability renditions", "Contract", "Regional processor setup has a truthful return state.", "handoff"),
  f("fees", "Fees and who pays", "Capability renditions", "Contract", "A factual fee breakdown includes source, effective date, and scenario math.", "fees"),
  f("event-confirm", "Event, tiers, refunds, and dates", "Capability renditions", "Contract", "Commercial rules are reviewed in the form buyers will see.", "record"),
  f("location", "Location and address privacy", "Capability renditions", "Contract", "Public area, buyer-only directions, and private operations stay separate.", "record"),
  f("media", "Cover, logo, gallery, video, and files", "Capability renditions", "Contract", "Preview, crop, order, alt text, transcript, and attribution.", "media"),
  f("people", "People and CSV import", "Capability renditions", "New", "Columns, invalid rows, duplicates, and changes are reviewed before import.", "people"),
  f("sites", "Sites plan, draft, live preview, and publish", "Capability renditions", "New", "Private preview, version diff, readiness, rollback, and live proof.", "sites"),
  f("marketing", "Ads, campaigns, creators, and referrals", "Capability renditions", "New", "Budget, audience, creative, approval boundary, and follow-up.", "marketing"),
  f("analytics", "Analytics, sales, and records", "Capability renditions", "New", "Metrics carry range, definition, source, comparison, and drill-through.", "analytics"),
  f("team-invite", "Owner invite · operator mode", "Capability renditions", "Contract", "Invite the accountable owner without losing operator progress.", "invite"),
  f("handover-draft", "Hand-over message draft", "Capability renditions", "Contract", "A channel-ready handover carries context, links, and open decisions.", "draft"),

  f("publish", "Publish and buyer view", "Results and recovery", "Contract", "A final readiness checklist matches the public buyer experience.", "publish"),
  f("live-edit", "Live edit and buyer email truth", "Results and recovery", "Contract", "Before/after values include notification impact and reason.", "diff"),
  f("refusal", "Friendly refusal", "Results and recovery", "Contract", "A boundary preserves work and offers the nearest safe alternative.", "refusal"),
  f("receipt", "Success receipt", "Results and recovery", "New", "What changed, where, when, identifiers, undo, and verification.", "receipt"),
  f("partial", "Partial success", "Results and recovery", "New", "Completed, failed, skipped, and human-owned work stay distinct.", "partial"),
  f("background", "Background or long-running task", "Results and recovery", "New", "A durable job state supports leaving and returning without fake completion.", "background"),
  f("access-recovery", "Access, session, tenant, and brand recovery", "Results and recovery", "Extend", "Permissions, expired sessions, and wrong scope share one recovery language.", "recovery"),
  f("network-recovery", "Offline, rate-limit, and degraded service", "Results and recovery", "Extend", "The turn is preserved and retries cannot duplicate writes.", "recovery"),
  f("cancelled", "Stopped, cancelled, and resumable", "Results and recovery", "Extend", "Ari names what stopped, what changed, and whether it can resume.", "partial"),
  f("expired", "Expired or superseded proposal", "Results and recovery", "New", "Unsafe approvals expire and point to the newer source of truth.", "stale"),
  f("protocol", "Protocol update required", "Results and recovery", "New", "Unsupported blocks fall back safely and cannot expose an action.", "protocol"),
  f("completion", "Completion summary and remaining owners", "Results and recovery", "New", "Proof, human remainders, owners, and the next checkpoint close the loop.", "completion"),

  f("remember", "Remember this?", "Memory and trust", "New", "Ari asks before saving a durable preference or operating fact.", "memory"),
  f("memory-receipt", "Memory saved receipt", "Memory and trust", "New", "Scope, provenance, last verification, correction, and forget stay visible.", "memory"),
  f("memory-conflict", "Memory conflict and correction", "Memory and trust", "New", "Live records outrank stale memory and the host resolves the conflict.", "conflict"),
  f("memory-manager", "Memory manager", "Memory and trust", "New", "Review, edit, forget, and reassign memories by person and brand.", "memory"),
  f("privacy", "Privacy, export, and delete", "Memory and trust", "Extend", "Granular controls replace a delete-everything-only endpoint.", "privacy"),

  f("research-scope", "Research scope and budget", "Research and browser", "New", "The host sees sources, depth, time, and spend boundaries before a deep run.", "researchScope"),
  f("research-activity", "Search plan and live source activity", "Research and browser", "New", "Queries, checked sources, elapsed work, and stop controls remain truthful.", "researchActivity"),
  f("research-source", "Source and evidence card", "Research and browser", "New", "Each claim carries URL, publisher, date, access method, and supporting excerpt.", "researchSource"),
  f("social-profile", "Social profile snapshot", "Research and browser", "New", "Handle, verification, metrics, themes, examples, and timestamp stay cited.", "socialProfile"),
  f("connector", "Connected-account permission handoff", "Research and browser", "New", "Read-only OAuth scopes and token handling are explicit before connection.", "connector"),
  f("browser-blocked", "Browser blocked or unavailable", "Research and browser", "New", "CAPTCHA, robots, access, and unsupported pages fail honestly without bypass.", "browserBlocked"),
  f("research-report", "Research report and freshness", "Research and browser", "New", "Findings, conflicts, uncertainty, citations, freshness, and next action share one result.", "researchReport"),
] as const;

export const ARI_RENDITION_TOTAL = 65 as const;
