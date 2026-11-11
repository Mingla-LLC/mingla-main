// Issue #4383 (SC-12 / D4) — explorers can switch Mingla updates off.
//
// Runs the REAL Explorer Settings matrix (notificationPrefsMatrix.ts) over the
// category row exactly as the migration seeds it, and the REAL label and hint
// resolution AccountSettings.tsx uses (its own categoryLabel / categoryHint,
// read from the file) with real i18next and the real locale files:
//   - the row is listed under Marketing
//   - push defaults ON and is toggleable; only in-app is locked
//   - a stored push = false shows OFF
//   - the label and hint resolve to real words, not the key path, in English
//     (and in a translated locale), as do the two brand rows that showed raw
//     keys before (brand_campaign_push, brand_offering_invite)
//
// Run: deno test --allow-read --allow-net --allow-env app-mobile/src/components/profile/__tests__/issue_4383_mingla_updates_settings.implementor.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import i18next from "npm:i18next@26.0.4";
import { buildNotificationMatrix, type NotificationCategoryRow } from "../notificationPrefsMatrix.ts";

const APP = new URL("../../../../", import.meta.url);
const REPO = new URL("../", APP);
const read = (rel: string, base = APP) => Deno.readTextFile(new URL(rel, base));

// The seed row, read from the migration (one owner of the category).
async function seededRow(key: string): Promise<NotificationCategoryRow> {
  const sql = await read("supabase/migrations/20280608004383_issue_4383_communications_scheduling.sql", REPO);
  const m = sql.match(new RegExp(`\\('${key.replace(".", "\\.")}', '([^']+)', (true|false), '([a-z]+)', ARRAY\\[([^\\]]+)\\]::text\\[\\], '([a-z_]+)', (true|false)\\)`));
  assert(m, `${key} seed row found`);
  return {
    key,
    section: m[1],
    is_transactional: m[2] === "true",
    urgency: m[3],
    default_channels: [...m[4].matchAll(/'([a-z]+)'/g)].map((c) => c[1]) as NotificationCategoryRow["default_channels"],
    active: m[6] === "true",
  };
}

// AccountSettings.tsx's own label and hint resolution, run as written.
async function labelResolvers(lng: string) {
  const src = await read("src/components/profile/AccountSettings.tsx");
  const grab = (name: string) => {
    const m = src.match(new RegExp(`const ${name} = \\(key: string\\) => \\{([\\s\\S]*?)\\n  \\};`));
    assert(m, `${name} found in AccountSettings.tsx`);
    return m[1];
  };
  const instance = i18next.createInstance();
  const resources: Record<string, { settings: unknown }> = {};
  for (const code of new Set(["en", lng])) {
    resources[code] = { settings: JSON.parse(await read(`src/i18n/locales/${code}/settings.json`)) };
  }
  // The app's init options (src/i18n/index.ts) that decide missing-key output.
  const options = { resources, lng, fallbackLng: "en", ns: ["settings"], defaultNS: "common", interpolation: { escapeValue: false }, compatibilityJSON: "v4" };
  await instance.init(options as never);
  const t = instance.t.bind(instance);
  const make = (body: string) => new Function("t", "key", body) as (t: unknown, key: string) => string | null;
  const label = make(grab("categoryLabel"));
  const hint = make(grab("categoryHint"));
  return { label: (key: string) => label(t, key), hint: (key: string) => hint(t, key) };
}

Deno.test("#4383 the Mingla updates row is under Marketing; push on and toggleable; only in-app locked", async () => {
  const row = await seededRow("mingla_updates");
  assertEquals(row.section, "Marketing");
  assertEquals(row.is_transactional, true);
  const sections = buildNotificationMatrix([row], []);
  assertEquals(sections.map((s) => s.section), ["Marketing"]);
  const cells = Object.fromEntries(sections[0].rows[0].channels.map((c) => [c.channel, c]));
  assertEquals(Object.keys(cells).sort(), ["inapp", "push"]);
  assertEquals(cells.push.enabled, true, "push defaults on");
  assertEquals(cells.push.locked, false, "push can be switched off");
  assertEquals(cells.inapp.locked, true, "in-app is the only locked channel");
  // A stored push = false renders OFF.
  const off = buildNotificationMatrix([row], [{ category_key: "mingla_updates", channel: "push", enabled: false }]);
  assertEquals(off[0].rows[0].channels.find((c) => c.channel === "push")?.enabled, false);
});

Deno.test("#4383 the Host category never shows in Explorer Settings", async () => {
  const row = await seededRow("business.mingla_update");
  assertEquals(buildNotificationMatrix([row], []), []);
});

Deno.test("#4383 the label and hint are real words in English, never the key path", async () => {
  const { label, hint } = await labelResolvers("en");
  assertEquals(label("mingla_updates"), "Mingla updates");
  assertEquals(hint("mingla_updates"), "News and updates from the Mingla team.");
  assertEquals(label("brand_campaign_push"), "Messages from places you follow");
  assertEquals(hint("brand_campaign_push"), "Offers and news from places and hosts you follow.");
  assertEquals(label("brand_offering_invite"), "Invites from places you follow");
  assertEquals(hint("brand_offering_invite"), "When a place or host invites you to something.");
});

Deno.test("#4383 every locale resolves the three rows to words, not key paths", async () => {
  const codes: string[] = [];
  for await (const entry of Deno.readDir(new URL("src/i18n/locales/", APP))) if (entry.isDirectory) codes.push(entry.name);
  assert(codes.length >= 29, "locales found");
  for (const code of codes) {
    const { label, hint } = await labelResolvers(code);
    for (const key of ["mingla_updates", "brand_campaign_push", "brand_offering_invite"]) {
      const words = label(key) ?? "";
      const note = hint(key) ?? "";
      assert(words && !words.includes("notifications.prefs") && words !== key, `${code}/${key}: ${words}`);
      assert(note && !note.includes("notifications.prefs"), `${code}/${key} hint: ${note}`);
    }
  }
  assertEquals((await labelResolvers("fr")).label("mingla_updates"), "Actualités Mingla");
});
