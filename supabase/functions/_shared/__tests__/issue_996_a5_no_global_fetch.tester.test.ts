/**
 * Issue #996 tester guard: execute the real A1-A6 callbacks while a
 * non-egressing global fetch sentinel is installed.
 *
 * This is intentionally an execution-time complement to the implementor's
 * source guard. Set ISSUE_996_A5_SOURCE to dynamically load an alternate copy
 * of the suite for the historical pre-fix proof.
 */

const DEFAULT_SUITE_SOURCE = new URL(
  "./issue_865_wp_bc_adversarial.tester.test.ts",
  import.meta.url,
);
const PLATFORM_URLS = [
  "business-api.tiktok.com",
  "tr.snapchat.com",
  "ads-api.reddit.com",
] as const;

type CapturedTest = {
  name: string;
  fn: () => void | Promise<void>;
};

function suiteTarget(): URL {
  const override = Deno.env.get("ISSUE_996_A5_SOURCE")?.trim();
  if (!override) return new URL(DEFAULT_SUITE_SOURCE);
  return new URL(override, `file://${Deno.cwd()}/`);
}

function captureDefinition(
  nameOrDefinition: unknown,
  maybeFn: unknown,
): CapturedTest | null {
  if (typeof nameOrDefinition === "string" && typeof maybeFn === "function") {
    return {
      name: nameOrDefinition,
      fn: maybeFn as CapturedTest["fn"],
    };
  }

  if (
    typeof nameOrDefinition === "object" &&
    nameOrDefinition !== null &&
    "name" in nameOrDefinition &&
    "fn" in nameOrDefinition &&
    typeof nameOrDefinition.name === "string" &&
    typeof nameOrDefinition.fn === "function"
  ) {
    return {
      name: nameOrDefinition.name,
      fn: nameOrDefinition.fn as CapturedTest["fn"],
    };
  }

  return null;
}

function restoreProperty(
  owner: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(owner, key, descriptor);
  } else {
    Reflect.deleteProperty(owner, key);
  }
}

Deno.test(
  "issue #996 tester: A1-A6 never fall through to global platform fetch",
  async () => {
    const target = suiteTarget();
    target.searchParams.set("issue_996_runtime_probe", "1");

    const captured: CapturedTest[] = [];
    const globalFetchAttempts: string[] = [];
    const originalTest = Object.getOwnPropertyDescriptor(Deno, "test");
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");

    const testCapture = ((nameOrDefinition: unknown, maybeFn?: unknown) => {
      const definition = captureDefinition(nameOrDefinition, maybeFn);
      if (definition) captured.push(definition);
    }) as typeof Deno.test;

    const fetchSentinel = ((
      input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      globalFetchAttempts.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ code: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    try {
      Object.defineProperty(Deno, "test", {
        ...originalTest,
        value: testCapture,
      });
      Object.defineProperty(globalThis, "fetch", {
        ...originalFetch,
        value: fetchSentinel,
      });

      await import(target.href);

      const a1ToA6 = captured.filter(({ name }) => /^A[1-6]\b/.test(name));
      if (a1ToA6.length !== 6) {
        throw new Error(
          `Issue #996 tester could not capture all A1-A6 callbacks from ${target.pathname}; ` +
            `captured ${a1ToA6.length}: ${
              a1ToA6.map(({ name }) => name).join(" | ")
            }`,
        );
      }

      for (const test of a1ToA6) {
        await test.fn();
      }

      const platformAttempts = globalFetchAttempts.filter((url) =>
        PLATFORM_URLS.some((host) => url.includes(host))
      );
      if (platformAttempts.length > 0) {
        throw new Error(
          "Issue #996: A1-A6 reached globalThis.fetch for ad-platform URLs; " +
            `no request left the process, but the sentinel recorded: ${
              platformAttempts.join(", ")
            }`,
        );
      }

      if (globalFetchAttempts.length > 0) {
        throw new Error(
          "Issue #996: A1-A6 unexpectedly reached globalThis.fetch; " +
            `no request left the process, but the sentinel recorded: ${
              globalFetchAttempts.join(", ")
            }`,
        );
      }
    } finally {
      restoreProperty(Deno, "test", originalTest);
      restoreProperty(globalThis, "fetch", originalFetch);
    }
  },
);
