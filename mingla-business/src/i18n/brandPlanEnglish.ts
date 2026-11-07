// #4270: the brand plan's English words, kept out of the bundle every Host app
// screen loads (bundle budget). The plan's own modules call addPlanEnglish() as
// they load, before they render. It adds the words to the English copy object the
// translation module already uses (the same module instance), so lookups and the
// English fallback find them. Other languages carry the plan words in their own
// lazy files already.
import english from "./locales/en/brandGroupMedia.json";
import planEnglish from "./locales/en/brandPlan.json";

type Copy = Record<string, Record<string, string> | string>;

export function addPlanEnglish(): void {
  const copy = english as unknown as Copy;
  const current = copy.plan;
  copy.plan = { ...(typeof current === "object" ? current : {}), ...planEnglish.plan };
}
