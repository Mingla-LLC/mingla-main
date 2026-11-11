// #4255 W5: the Mingla team screens' English words, kept out of the bundle
// every Host app screen loads (bundle budget), the same way as the brand plan
// (#4270, brandPlanEnglish.ts). The team screens call addTeamEnglish() as they
// load. Other languages carry the team words in their own lazy files already.
// The top bar's two "Mingla team" labels stay in brandGroupMedia.json (eager).
import english from "./locales/en/brandGroupMedia.json";
import teamEnglish from "./locales/en/teamChat.json";

type Copy = Record<string, Record<string, string> | string>;

export function addTeamEnglish(): void {
  const copy = english as unknown as Copy;
  const current = copy.team;
  copy.team = { ...(typeof current === "object" ? current : {}), ...teamEnglish.team };
}
