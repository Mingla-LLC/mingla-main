import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  clearExplorerPhoneForReuse,
  ExplorerPhoneReleaseError,
} from "../explorerPhoneRelease.ts";

const UID = "00000000-0000-4000-8000-000000004202";
const PHONE = "+32466178389";

interface Spec {
  authUpdateError?: boolean;
  authReadbackError?: boolean;
  readbackPhone?: string | null;
  readbackPhoneIdentity?: string | null;
  profileUpdateError?: boolean;
}

function makeClient(spec: Spec = {}) {
  const calls: Array<{ name: string; payload?: unknown }> = [];
  const builder = {
    update: (payload: unknown) => {
      calls.push({ name: "profile.update", payload });
      return builder;
    },
    eq: (_column: string, _value: string) =>
      Promise.resolve({
        error: spec.profileUpdateError
          ? { message: "profile update failed" }
          : null,
      }),
  };

  const client = {
    auth: {
      admin: {
        updateUserById: (_id: string, payload: unknown) => {
          calls.push({ name: "auth.update", payload });
          return Promise.resolve({
            data: { user: null },
            error: spec.authUpdateError
              ? { message: "auth update failed" }
              : null,
          });
        },
        getUserById: (_id: string) => {
          calls.push({ name: "auth.readback" });
          const identities = spec.readbackPhoneIdentity === undefined ? [] : [{
            provider: "phone",
            identity_data: { phone: spec.readbackPhoneIdentity },
          }];
          return Promise.resolve({
            data: {
              user: spec.authReadbackError
                ? null
                : { phone: spec.readbackPhone ?? null, identities },
            },
            error: spec.authReadbackError
              ? { message: "auth readback failed" }
              : null,
          });
        },
      },
    },
    from: (table: string) => {
      assertEquals(table, "profiles");
      return builder;
    },
  };

  return {
    client: client as unknown as Parameters<
      typeof clearExplorerPhoneForReuse
    >[0],
    calls,
  };
}

Deno.test("#4202 retained-Business deletion releases auth before profile and preserves email", async () => {
  const { client, calls } = makeClient();
  await clearExplorerPhoneForReuse(client, UID, PHONE);

  assertEquals(calls, [
    { name: "auth.update", payload: { phone: "" } },
    { name: "auth.readback" },
    { name: "profile.update", payload: { phone: null } },
  ]);
});

Deno.test("#4202 auth phone update failure cannot report deletion success", async () => {
  const { client, calls } = makeClient({ authUpdateError: true });
  const error = await assertRejects(
    () => clearExplorerPhoneForReuse(client, UID, PHONE),
    ExplorerPhoneReleaseError,
    "auth_update",
  );
  assertEquals(error.stage, "auth_update");
  assertEquals(calls, [{ name: "auth.update", payload: { phone: "" } }]);
});

Deno.test("#4202 unreadable auth readback fails before profile mutation", async () => {
  const { client, calls } = makeClient({ authReadbackError: true });
  const error = await assertRejects(
    () => clearExplorerPhoneForReuse(client, UID, PHONE),
    ExplorerPhoneReleaseError,
    "auth_readback",
  );
  assertEquals(error.stage, "auth_readback");
  assertEquals(calls.map((call) => call.name), [
    "auth.update",
    "auth.readback",
  ]);
});

Deno.test("#4202 a surviving auth.users phone fails closed", async () => {
  const { client, calls } = makeClient({ readbackPhone: PHONE });
  const error = await assertRejects(
    () => clearExplorerPhoneForReuse(client, UID, PHONE),
    ExplorerPhoneReleaseError,
    "auth_still_attached",
  );
  assertEquals(error.stage, "auth_still_attached");
  assertEquals(calls.map((call) => call.name), [
    "auth.update",
    "auth.readback",
  ]);
});

Deno.test("#4202 any surviving phone identity fails closed even when auth.users.phone is empty", async () => {
  const { client, calls } = makeClient({
    readbackPhoneIdentity: "+14155550199",
  });
  const error = await assertRejects(
    () => clearExplorerPhoneForReuse(client, UID, PHONE),
    ExplorerPhoneReleaseError,
    "auth_still_attached",
  );
  assertEquals(error.stage, "auth_still_attached");
  assertEquals(calls.map((call) => call.name), [
    "auth.update",
    "auth.readback",
  ]);
});

Deno.test("#4202 profile phone failure cannot report success after auth release", async () => {
  const { client } = makeClient({ profileUpdateError: true });
  const error = await assertRejects(
    () => clearExplorerPhoneForReuse(client, UID, PHONE),
    ExplorerPhoneReleaseError,
    "profile_update",
  );
  assertEquals(error.stage, "profile_update");
});

Deno.test("#4202 no phone is an idempotent no-op", async () => {
  const { client, calls } = makeClient();
  await clearExplorerPhoneForReuse(client, UID, null);
  assertEquals(calls, []);
});
