import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { availableStaffIds } from "./alertRecipients.ts";

type Call = { fn: string };

function client(result: { data: unknown; error: unknown }, calls: Call[]) {
  return {
    rpc(fn: "issue_3988_support_alert_recipients") {
      calls.push({ fn });
      return Promise.resolve(result);
    },
  };
}

Deno.test("reply alerts go to the database's effective roster, nothing else", async () => {
  const calls: Call[] = [];
  // The RPC already dropped the available row of someone who is not on the team.
  const ids = await availableStaffIds(client({ data: ["team-a", "team-b"], error: null }, calls));
  assertEquals(ids, ["team-a", "team-b"]);
  assertEquals(calls, [{ fn: "issue_3988_support_alert_recipients" }]);
});

Deno.test("a failed roster read alerts nobody instead of guessing", async () => {
  const calls: Call[] = [];
  const original = console.error;
  console.error = () => {};
  try {
    assertEquals(await availableStaffIds(client({ data: null, error: { message: "boom" } }, calls)), []);
  } finally {
    console.error = original;
  }
  assertEquals(await availableStaffIds(client({ data: [null, 7, ""], error: null }, calls)), []);
});

Deno.test("notify-support no longer reads support_staff rows directly", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(source.includes('from("support_staff")'), false);
  assertEquals(source.includes('import { availableStaffIds } from "./alertRecipients.ts";'), true);
  assertEquals(/availableStaffIds\(admin\)/.test(source), true);
});
