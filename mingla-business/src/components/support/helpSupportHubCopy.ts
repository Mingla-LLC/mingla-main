/**
 * #4420 — the Help & Support shell's words (locales/en/hostSupport.hub.json).
 *
 * The shell (screen, tabs, Announcements, the Support column frame) loads
 * with the route; the conversation's own words stay in hostSupport.json and
 * load with the support chunk. Keeping them apart keeps the support model out
 * of the shell, so nothing shared between the two is hoisted into the web
 * boot chunk. English only until the Host app's support translations land
 * (same rule as supportCopy).
 */
import copy from "../../i18n/locales/en/hostSupport.hub.json";

type CopyTree = { [key: string]: string | CopyTree };

export function hubCopy(key: string, variables: Record<string, string | number> = {}): string {
  let current: string | CopyTree = copy as CopyTree;
  for (const part of key.split(".")) {
    if (typeof current === "string" || !(part in current)) return key;
    current = current[part];
  }
  if (typeof current !== "string") return key;
  return current.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : token,
  );
}
