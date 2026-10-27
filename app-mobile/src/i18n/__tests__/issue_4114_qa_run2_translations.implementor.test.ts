// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA run 2: the plan a11y strings (a11yOpenPlan,
// a11yOpenPlanRow) and the strings this run added are present in all 29
// locales, keep their placeholders, and are translated everywhere except
// bin, ha, ig and yo (which may stay English).
//
// FAILS-ON-REVERT: drop a key from any locale, lose a placeholder, or leave a
// translated locale in English, and the matching case fails.

const root = new URL("../locales/", import.meta.url);
const ENGLISH_OK = new Set(["en", "bin", "ha", "ig", "yo"]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const chatKeys: Record<string, string[]> = {
  a11yOpenPlan: ["{{title}}", "{{time}}"],
  a11yOpenPlanRow: ["{{text}}"],
  failedDailyLimit: [],
  linkCopied: [],
  linkCopyFailed: [],
};

Deno.test("#4114 QA run 2: every locale carries the new chat and invite strings", async () => {
  const locales: string[] = [];
  for await (const entry of Deno.readDir(root)) if (entry.isDirectory) locales.push(entry.name);
  assert(locales.length === 29, `29 locales, got ${locales.length}`);
  const en = JSON.parse(await Deno.readTextFile(new URL("en/chat.json", root)));
  const enBoard = JSON.parse(await Deno.readTextFile(new URL("en/board.json", root)));
  for (const locale of locales) {
    const chat = JSON.parse(await Deno.readTextFile(new URL(`${locale}/chat.json`, root)));
    const board = JSON.parse(await Deno.readTextFile(new URL(`${locale}/board.json`, root)));
    for (const [key, placeholders] of Object.entries(chatKeys)) {
      const value = chat[key];
      assert(typeof value === "string" && value.length > 0, `${locale}: chat.${key} missing`);
      for (const p of placeholders) assert(value.includes(p), `${locale}: chat.${key} lost ${p}`);
      if (!ENGLISH_OK.has(locale)) assert(value !== en[key], `${locale}: chat.${key} is still English`);
    }
    const body = board.boardSettingsDropdown?.inviteNotTextedBody;
    assert(typeof body === "string" && body.includes("{{phone}}"), `${locale}: board inviteNotTextedBody`);
    if (!ENGLISH_OK.has(locale)) {
      assert(body !== enBoard.boardSettingsDropdown.inviteNotTextedBody, `${locale}: inviteNotTextedBody is still English`);
    }
  }
});
