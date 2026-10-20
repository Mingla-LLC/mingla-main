// Issue #3980 — teammates' display names and GitHub usernames, set by the
// owner on Team and roles. The names show in every picker, in agent messages
// and in the agent log. The server checks that the caller is the owner in
// person; this file only names the two calls (the rpc itself lives in
// opsService.js, the one browser caller of ops_ functions).
import { listTeamProfiles, OpsError, setTeamProfile } from "./opsService";

export { OpsError };

/** Every non-revoked teammate with their name, GitHub username and email name. */
export async function listProfiles() {
  const data = await listTeamProfiles();
  return Array.isArray(data?.profiles) ? data.profiles : [];
}

/** Sets one teammate's name and GitHub username; blank clears either. */
export async function setProfile(email, displayName, githubLogin) {
  const data = await setTeamProfile(email, String(displayName ?? "").trim(), String(githubLogin ?? "").trim());
  return data?.profile ?? null;
}
