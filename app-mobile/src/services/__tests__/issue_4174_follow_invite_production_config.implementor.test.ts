// @ts-nocheck -- Deno-runtime source contract.

const indexSource = await Deno.readTextFile(
  new URL("../../../app/index.tsx", import.meta.url),
);
const supabaseSource = await Deno.readTextFile(
  new URL("../supabase.ts", import.meta.url),
);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("Explorer follow-invite reads the canonical production Supabase authority", () => {
  assert(
    /export const supabaseUrl = SUPABASE_URL;/.test(supabaseSource),
    "supabaseUrl must remain exported from the app's single project owner",
  );
  assert(
    /const supabaseAnonKey = ['"][^'"]+['"];/.test(supabaseSource) &&
      /export \{ supabaseAnonKey \};/.test(supabaseSource),
    "the public anon key must be exported from the existing client authority",
  );
  assert(
    /import\s*\{[\s\S]*?supabase[\s\S]*?supabaseAnonKey[\s\S]*?supabaseUrl[\s\S]*?\}\s*from\s*["']\.\.\/src\/services\/supabase["']/.test(
      indexSource,
    ),
    "app/index.tsx must import the canonical Supabase URL and anon key",
  );
  assert(
    !indexSource.includes("process.env.EXPO_PUBLIC_SUPABASE_URL"),
    "follow-invite must not depend on the intentionally absent EAS Supabase URL variable",
  );
  assert(
    !indexSource.includes("process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY"),
    "follow-invite must not depend on the intentionally absent EAS anon-key variable",
  );
  assert(
    (indexSource.match(/supabaseUrl\.replace\(\/\\\/\$\/, ""\)/g) ?? []).length === 3,
    "all three follow-invite peeks must build from the canonical URL",
  );
  assert(
    (indexSource.match(/apikey: supabaseAnonKey/g) ?? []).length === 3,
    "all three follow-invite peeks must send the canonical anon key",
  );
});
