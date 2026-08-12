import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const PROVIDERS = ["meta", "tiktok", "google", "snapchat", "reddit"] as const;
const SHARED_DIR = new URL("../", import.meta.url);

async function readSharedFile(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(name, SHARED_DIR));
}

// Do not statically import adChannel.ts or any provider here. A static import,
// preload, or shared test-process cache would initialize the facade first and
// conceal the provider-first ESM temporal-dead-zone failure fixed by #1937.
Deno.test("#1937: every provider can be the first ad module imported in a fresh process", async () => {
  for (const provider of PROVIDERS) {
    const providerUrl = new URL(`${provider}.ts`, SHARED_DIR);
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "--quiet",
        "eval",
        `await import(${JSON.stringify(providerUrl.href)});`,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const result = await command.output();
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(
      result.code,
      0,
      `${provider}.ts must import first in a fresh process; stderr: ${stderr}`,
    );
    assertEquals(
      stderr,
      "",
      `${provider}.ts must not emit initialization errors`,
    );
  }
});

Deno.test("#1937: provider-neutral core is a leaf and providers never import the facade", async () => {
  const core = await readSharedFile("adChannelCore.ts");
  assert(
    !/from\s+["']\.\/(?:meta|tiktok|google|snapchat|reddit)\.ts["']/.test(core),
    "adChannelCore.ts must not import any provider",
  );
  assert(
    !/\bimport\s*(?:\(|[\s{*])/.test(core),
    "adChannelCore.ts must remain an import-free leaf module",
  );

  for (const provider of PROVIDERS) {
    const source = await readSharedFile(`${provider}.ts`);
    assert(
      /from\s+["']\.\/adChannelCore\.ts["']\s*;/.test(source),
      `${provider}.ts must import its channel contract from adChannelCore.ts`,
    );
    assert(
      !/from\s+["']\.\/adChannel\.ts["']\s*;/.test(source),
      `${provider}.ts must never import the registry facade`,
    );
  }
});

Deno.test("#1937: facade owns exactly one complete five-provider registry", async () => {
  const facadeSource = await readSharedFile("adChannel.ts");
  assertEquals(
    (facadeSource.match(/const\s+ADAPTER_REGISTRY\s*:/g) ?? []).length,
    1,
    "the facade must contain exactly one adapter registry",
  );

  for (const provider of PROVIDERS) {
    assertEquals(
      (facadeSource.match(
        new RegExp(`from ["']\\./${provider}\\.ts["']`, "g"),
      ) ?? [])
        .length,
      1,
      `the facade must import ${provider} exactly once`,
    );
    assertEquals(
      (facadeSource.match(
        new RegExp(`^\\s*${provider}: ${provider}Adapter`, "gm"),
      ) ?? [])
        .length,
      1,
      `the registry must contain exactly one ${provider} adapter`,
    );
  }

  const facade = await import("../adChannel.ts");
  for (const provider of PROVIDERS) {
    const adapter = facade.getAdapter(provider);
    assertEquals(adapter.platform, provider);
    for (
      const method of [
        "connect",
        "createCampaign",
        "createAdSet",
        "createAd",
        "setStatus",
        "getStatus",
        "setBudget",
      ]
    ) {
      assertEquals(
        typeof adapter[method as keyof typeof adapter],
        "function",
        `${provider}.${method} must remain available through getAdapter`,
      );
    }
  }
});
