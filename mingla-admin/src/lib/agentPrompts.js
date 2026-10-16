// Issue #3802 (Wave 4) — pure, closed decisions for the Guide, prompt strips
// and personal agent activity. Server text is rendered only where the
// contract names it; tool, outcome, agent and summary values are never shown
// raw.

export const GUIDE_TABS = [
  { id: "stages", label: "How the pipeline works" },
  { id: "icp", label: "Who is who" },
  { id: "agent", label: "Working with your agent" },
  { id: "rules", label: "House rules" },
];

export const AGENT_LIMIT_LABELS = {
  requests_per_minute: "Requests per minute",
  tool_calls_per_day: "Agent requests per day",
  records_written_per_day: "Records written per day",
  items_per_request: "Items per request",
  find_page_default: "Default search results",
  find_page_max: "Maximum search results",
  record_log_default: "Default activity rows",
  record_log_max: "Maximum activity rows",
  idle_days: "Unused-key limit in days",
};

const SUCCESS_LINES = {
  get_started: "Read the Mingla guide",
  my_day: "Checked your day",
  find_records: "Searched the pipelines",
  get_record: "Opened a record",
  check_names: "Checked names",
  find_mingla_link: "Looked for a Mingla brand or place",
  check_contactable: "Checked who is contactable",
  list_beta_leads: "Read beta leads",
  team_summary: "Checked the team numbers",
  list_drafts: "Read your drafts",
  list_content: "Read the content calendar",
};

const SUMMARY_KEYS = new Set([
  "created",
  "exists",
  "logged",
  "updated",
  "moved",
  "saved",
  "discarded",
  "commented",
  "refused",
]);

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function summaryCount(summary, key) {
  if (!SUMMARY_KEYS.has(key) || !summary || typeof summary !== "object" || Array.isArray(summary) || !Object.hasOwn(summary, key)) return null;
  return safeCount(summary[key]);
}

function countFor(call, key) {
  const fromSummary = summaryCount(call?.summary, key);
  return fromSummary === null ? safeCount(call?.items) : fromSummary;
}

function counted(verb, count, singular, plural = `${singular}s`) {
  return `${verb} ${count} ${count === 1 ? singular : plural}`;
}

function successLine(call) {
  const tool = typeof call?.tool === "string" ? call.tool : "";
  if (Object.hasOwn(SUCCESS_LINES, tool)) return SUCCESS_LINES[tool];
  if (tool === "add_records") return counted("Added", countFor(call, "created"), "record");
  if (tool === "update_records") return counted("Updated", countFor(call, "updated"), "card");
  if (tool === "move_stage") return counted("Moved", countFor(call, "moved"), "card");
  if (tool === "set_owners") return counted("Updated owners on", countFor(call, "updated"), "card");
  if (tool === "log_activity") return counted("Logged", countFor(call, "logged"), "activity item", "activity items");
  if (tool === "record_reply") return counted("Recorded", countFor(call, "logged"), "reply", "replies");
  if (tool === "save_drafts") return counted("Wrote", countFor(call, "saved"), "draft");
  if (tool === "withdraw_drafts") return counted("Withdrew", countFor(call, "discarded"), "draft");
  if (tool === "add_content") return counted("Added", countFor(call, "created"), "content card");
  if (tool === "update_content") return counted("Updated", countFor(call, "updated"), "content card");
  if (tool === "assign_content") return counted("Updated owners on", countFor(call, "updated"), "content card");
  if (tool === "comment_content") return counted("Commented on", countFor(call, "commented"), "content card");
  if (tool === "move_content") return counted("Moved", countFor(call, "moved"), "content card");
  if (tool === "update_draft") {
    return (summaryCount(call?.summary, "updated") || 0) > 0 ? "Updated a draft" : "Checked a draft; no change was needed";
  }
  if (tool === "upsert_record") {
    const created = summaryCount(call?.summary, "created") || 0;
    const logged = summaryCount(call?.summary, "logged") || 0;
    const refused = summaryCount(call?.summary, "refused") || 0;
    let line = created > 0 ? "Added a record" : "Found an existing record";
    const suffix = [];
    if (logged > 0) suffix.push("logged its first touch");
    if (refused > 0) suffix.push("one touch was refused");
    if (suffix.length > 0) line += `; ${suffix.join("; ")}`;
    return line;
  }
  return "Agent request completed";
}

function failureLine(outcome) {
  const token = typeof outcome === "string" ? outcome : "";
  if (["limited", "rate_limited", "daily_limit", "busy"].includes(token)) return "Was paused by a usage limit";
  if (token === "stage_changed") return "Was refused: card had moved";
  if (token === "forbidden" || token === "tool_forbidden") return "Was refused: this action isn't allowed";
  if (token === "not_found") return "Was refused: that item is no longer available";
  if (token === "do_not_contact") return "Was refused: contact rule says do not contact";
  if (token === "warm_intro_only") return "Was refused: a warm introduction is required";
  if (token === "draft_edited") return "Was refused: you already edited that draft";
  if (token === "too_many_drafts") return "Was refused: three drafts are already waiting for that card";
  if (token === "server_error" || token === "try_again") return "Agent request failed";
  if (token.startsWith("request_key") || token === "replayed_request") {
    return "Was refused: the request could not be safely repeated";
  }
  if (token.startsWith("invalid_") || token === "invalid") return "Was refused: some details were not valid";
  return "Agent request was refused";
}

/** A closed, display-safe line for one personal activity row. */
export function agentActivityLine(call) {
  const outcome = call?.outcome;
  const agent = call?.agent === "claude" ? "Claude" : call?.agent === "codex" ? "Codex" : "Agent";
  return {
    text: outcome === "ok" ? successLine(call) : failureLine(outcome),
    agent,
  };
}

export function routineByName(answer, name) {
  const routines = Array.isArray(answer?.guide?.routines) ? answer.guide.routines : [];
  const row = routines.find((routine) => routine?.name === name);
  return row && typeof row.text === "string" && row.text ? row : null;
}

/**
 * Fill the returned new_batch routine with visible labels only. The first
 * argument deliberately has exactly the four approved fields; the returned
 * routine text is a separate authority, never browser state.
 */
export function agentPrompt({ pipeline, icp, region, mine }, routineText) {
  if (typeof routineText !== "string" || !routineText) return "";
  const pipelineLabel = pipeline === "creators" ? "creators" : pipeline === "hosts" ? "hosts" : "";
  if (!pipelineLabel) return "";
  const icpLabel = typeof icp === "string" && icp.trim() ? `${icp.trim()} ` : "";
  const noRegion = region === "none";
  const regionLabel = typeof region === "string" && region.trim() && !noRegion ? region.trim() : "my regions";
  let prompt = routineText;
  if (noRegion) {
    prompt = prompt.replace("in {region} we have not contacted", "with no region yet that we have not contacted");
  }
  prompt = prompt
    .replaceAll("{count}", "20")
    .replaceAll("{icp}", icpLabel)
    .replaceAll("{pipeline}", pipelineLabel)
    .replaceAll("{region}", regionLabel)
    .replace(/\s{2,}/g, " ")
    .trim();
  return mine ? `${prompt} Keep the new cards assigned to me.` : prompt;
}

/** True only for the complete, non-empty guide shape the pages can render. */
export function validAgentGuide(answer) {
  const pipelines = answer?.config?.pipelines;
  const guide = answer?.guide;
  return !!(
    !!pipelines &&
    ["hosts", "creators"].every(
      (id) =>
        pipelines[id] &&
        Array.isArray(pipelines[id].stages) &&
        pipelines[id].stages.length > 0 &&
        Array.isArray(pipelines[id].icps) &&
        pipelines[id].icps.length > 0
    ) &&
    Array.isArray(guide?.routines) &&
    guide.routines.length > 0 &&
    Array.isArray(guide?.rules) &&
    guide.rules.length > 0 &&
    answer?.limits &&
    typeof answer.limits === "object" &&
    !Array.isArray(answer.limits)
  );
}
