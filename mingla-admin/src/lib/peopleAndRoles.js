/**
 * #3988 — People and roles: one Community & Support role per teammate.
 *
 * Off | Support teammate | Support lead. A Support teammate works both
 * Community and Support. Owners and Admins are included and may opt into the
 * Support rota for alerts and availability. The server
 * (issue_3988_admin_people / issue_3988_set_permissions) is the only source of
 * truth; this module only turns its rows and error codes into words.
 *
 * Pure module: no imports, so the Deno suite can load it directly.
 */

export const ROLE_CHOICES = Object.freeze([
  Object.freeze({ id: "off", label: "Off" }),
  Object.freeze({ id: "teammate", label: "Support teammate" }),
  Object.freeze({ id: "lead", label: "Support lead" }),
]);

export const ROLE_DOES = Object.freeze([
  "Tickets and live chats",
  "Moderation queue",
  "Answer Questions",
  "Update Ideas",
  "Brand groups and Feature Guide",
  "Availability and alerts",
]);
export const LEAD_ALSO_DOES = "Approve support → product work";

export function roleChoiceDescription(role, teamRoleLabel) {
  if (role === "teammate") return "Works both Community and Support:";
  if (role === "lead") {
    return "Everything a Support teammate does, plus approving support issues for the product team:";
  }
  return teamRoleLabel
    ? `No Community or Support tabs, and no alerts. They keep their ${teamRoleLabel} pages.`
    : "No Community or Support tabs, and no alerts.";
}

export function roleChoiceDoes(role) {
  if (role === "lead") return [...ROLE_DOES, LEAD_ALSO_DOES];
  if (role === "teammate") return [...ROLE_DOES];
  return [];
}

/** Explainer table: [label, Owner/Admin, Support teammate, Support lead, Off]. */
export const ROLE_TABLE = Object.freeze([
  ["Overview", "Yes", "Yes", "Yes", "—"],
  ["Moderation: first posts, reports, appeals", "Yes", "Yes", "Yes", "—"],
  ["Questions: answer, pin, lock", "Yes", "Yes", "Yes", "—"],
  ["Ideas: status and public reply", "Yes", "Yes", "Yes", "—"],
  ["Tickets and live chats", "Yes", "Yes", "Yes", "—"],
  ["Brand groups and Feature Guide", "Yes", "Yes", "Yes", "—"],
  ["Available switch and support alerts", "Alerts if on", "Yes", "Yes", "—"],
  ["Approve support issue → product work", "Yes", "—", "Yes", "—"],
  ["Announcements, Roadmap, Email, Product Inbox", "Yes", "—", "—", "—"],
  ["People and roles (grant / remove)", "Yes", "—", "—", "—"],
]);

export const ROLE_EXPLAINER = Object.freeze([
  Object.freeze({
    title: "Support teammate.",
    body: "Works both Community and Support. Answers Host chats and tickets, moderates first posts, reports and appeals, answers Questions and updates Ideas, posts in Brand groups, and gets alerts while available.",
  }),
  Object.freeze({
    title: "Support lead.",
    body: "Everything a Support teammate does, plus approves turning support issues into product work.",
  }),
  Object.freeze({
    title: "Owners and Admins.",
    body: "Can already do all of it, plus Announcements, Roadmap and Email. Turning the rota on just adds them to alerts and availability.",
  }),
]);

/** List cell text for a person's role. */
export function roleLabel(row) {
  switch (row?.role) {
    case "included_rota": return "Included · on rota";
    case "included": return "Included";
    case "teammate": return "Support teammate";
    case "lead": return "Support lead";
    default: return "Off";
  }
}

export function isIncludedRole(row) {
  return row?.role === "included" || row?.role === "included_rota";
}

/** The role the Manage sheet starts on for this row. */
export function initialRoleChoice(row) {
  if (row?.role === "lead") return "lead";
  if (row?.role === "teammate" || row?.role === "included_rota") return "teammate";
  return "off";
}

/** Team (current), Invited, Not on the team (old access that no longer works). */
export function groupPeople(rows) {
  /** @type {{ team: Array<Record<string, any>>, invited: Array<Record<string, any>>, former: Array<Record<string, any>> }} */
  const groups = { team: [], invited: [], former: [] };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.effective === false) groups.former.push(row);
    else if (row?.team_status === "invited") groups.invited.push(row);
    else if (row?.team_status === "active") groups.team.push(row);
  }
  return groups;
}

const SAVE_ERRORS = Object.freeze({
  not_on_team: "They're not on the Mingla team. Invite them first.",
  not_authorized: "Only Owners and Admins can change permissions.",
  still_on_team: "They're still on the team. Set their role to Off instead.",
  role_retired: "That role no longer exists. Pick Support teammate or Support lead.",
  invalid_role: "That role no longer exists. Pick Support teammate or Support lead.",
});
export const SAVE_NETWORK_ERROR = "Couldn't save. Check your connection and try again.";
export const SESSION_ERROR = "Sign in again";

/** Plain-English message for a failed save (by server code). */
export function permissionsErrorMessage(error) {
  const text = [error?.message, error?.details, error?.hint, error?.code]
    .filter((part) => typeof part === "string")
    .join(" ");
  if (/jwt expired|not_authenticated|session/i.test(text) || error?.status === 401) return SESSION_ERROR;
  for (const [code, message] of Object.entries(SAVE_ERRORS)) {
    if (new RegExp(`\\b${code}\\b`).test(text)) return message;
  }
  return SAVE_NETWORK_ERROR;
}

export function savedMessage(name) {
  return `Saved. ${name || "They"} will see the change the next time their page refreshes.`;
}
