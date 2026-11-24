// #4572 item 9 — Ari told an owner to upload a video "in Design > Cover", a
// place that did not exist for a Home without a cover. The imagery tool now
// states the precondition, and the workspace rules forbid naming a screen the
// workspace does not list. FAILS-ON-REVERT: neither sentence exists.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("#4572 propose_site_imagery names the cover precondition and Design → Cover", async () => {
  const tools = await Deno.readTextFile(new URL("../agentSiteTools.ts", import.meta.url));
  assert(tools.includes("when get_site_workspace shows home_cover.available false, say the owner can add one in Design → Cover."));
});

Deno.test("#4572 workspace rules: only places the workspace lists; home_cover drives the cover answer", async () => {
  const rules = await Deno.readTextFile(new URL("../agentSiteWorkspaceTools.ts", import.meta.url));
  assert(rules.includes("Only describe a place in Mingla (a tab, a button) that the workspace lists; never name a screen you have not been given."));
  assert(rules.includes("Home's cover is in home_cover"));
  assert(!/upload[^.]{0,40}video[^.]{0,40}Design/i.test(rules.replace("when available is false, the owner adds one in Design → Cover (a photo first, then a video if they like)", "")));
});
