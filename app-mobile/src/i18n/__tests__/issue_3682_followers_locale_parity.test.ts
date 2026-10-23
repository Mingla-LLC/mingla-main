const root = new URL("../locales/", import.meta.url);
const required = [
  "first",
  "count_zero",
  "count_one",
  "count_two",
  "count_few",
  "count_many",
  "count_other",
  "a11y_none",
  "a11y_exact_zero",
  "a11y_exact_one",
  "a11y_exact_two",
  "a11y_exact_few",
  "a11y_exact_many",
  "a11y_exact_other",
  "a11y_approx",
] as const;

const englishCases = [
  [0, "Be the first to follow"],
  [1, "1 follower"],
  [2, "2 followers"],
  [842, "842 followers"],
  [999, "999 followers"],
  [1_000, "1k followers"],
  [1_050, "1k followers"],
  [1_100, "1.1k followers"],
  [1_204, "1.2k followers"],
  [1_999, "1.9k followers"],
  [9_999, "9.9k followers"],
  [10_000, "10k followers"],
  [12_480, "12k followers"],
  [999_999, "999k followers"],
  [1_000_000, "1M followers"],
  [1_240_000, "1.2M followers"],
  [12_500_000, "12M followers"],
  [1_000_000_000, "1B followers"],
] as const;

function compact(count: number): string {
  const tier = (unit: number, divisor: number, suffix: string) => {
    if (count >= unit * 10) return `${Math.floor(count / unit)}${suffix}`;
    const tenths = Math.floor(count / divisor);
    return tenths % 10 === 0
      ? `${Math.floor(tenths / 10)}${suffix}`
      : `${Math.floor(tenths / 10)}.${tenths % 10}${suffix}`;
  };
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return tier(1_000, 100, "k");
  if (count < 1_000_000_000) return tier(1_000_000, 100_000, "M");
  return tier(1_000_000_000, 100_000_000, "B");
}

Deno.test("#3682 follower copy is complete and translated in all 29 locales", async () => {
  const languages: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.isDirectory) languages.push(entry.name);
  }
  languages.sort();
  if (languages.length !== 29) throw new Error(`expected 29 locales, got ${languages.length}`);

  const english = JSON.parse(
    await Deno.readTextFile(new URL("en/followers.json", root)),
  ) as Record<string, unknown>;
  for (const language of languages) {
    const file = new URL(`${language}/followers.json`, root);
    const copy = JSON.parse(await Deno.readTextFile(file)) as Record<string, unknown>;
    const keys = Object.keys(copy).sort();
    if (keys.join("|") !== [...required].sort().join("|")) {
      throw new Error(`${language} follower keys differ from the contract`);
    }
    for (const key of required) {
      if (typeof copy[key] !== "string" || copy[key].length === 0) {
        throw new Error(`${language}/${key} is empty`);
      }
    }
    if (
      language !== "en" &&
      required.every((key) => copy[key] === english[key])
    ) {
      throw new Error(`${language} is an English fallback`);
    }
  }
});

Deno.test("#3682 Russian count 3 selects the few-form copy", async () => {
  const russian = JSON.parse(
    await Deno.readTextFile(new URL("ru/followers.json", root)),
  ) as Record<string, string>;
  const rendered = russian.count_few
    .replace("{{formatted}}", "3")
    .replace("{{count}}", "3");
  if (rendered !== "3 подписчика") {
    throw new Error(`unexpected Russian few form: ${rendered}`);
  }
});

Deno.test("#3682 English locale renders the complete formatter contract", async () => {
  const english = JSON.parse(
    await Deno.readTextFile(new URL("en/followers.json", root)),
  ) as Record<string, string>;
  for (const [count, expected] of englishCases) {
    const template = count === 0
      ? english.first
      : count === 1
        ? english.count_one
        : english.count_other;
    const rendered = template
      .replace("{{formatted}}", compact(count))
      .replace("{{count}}", String(count));
    if (rendered !== expected) {
      throw new Error(`English count ${count}: expected ${expected}, got ${rendered}`);
    }
  }
});

Deno.test("#3682 follower label hook owns translation words and English a11y delegation", async () => {
  const hook = await Deno.readTextFile(
    new URL("../../hooks/useFollowerCountLabels.ts", import.meta.url),
  );
  for (const signature of [
    "useTranslation('followers')",
    "t('first')",
    "t('count', { count, formatted })",
    "t('a11y_none')",
    "t('a11y_exact', { count })",
    "formatFollowerCountA11y(count)",
  ]) {
    if (!hook.includes(signature)) throw new Error(`missing hook wiring: ${signature}`);
  }
});
