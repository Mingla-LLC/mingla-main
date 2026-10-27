import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("#3872 Local timers use the shared machine caller and SQL clock authority", () => {
  assertStringIncludes(source, "isAuthorizedCronCaller");
  assertStringIncludes(source, 'db.rpc("local_timer_tick"');
  assertStringIncludes(source, "new Date().toISOString()");
});
