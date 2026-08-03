import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);

Deno.test("Admin Stay operations uses the deployed email identity contract", () => {
  assertStringIncludes(source, '.from("admin_users")');
  assertStringIncludes(source, '.select("id,status")');
  assertStringIncludes(source, '.eq("email", user.email)');
  assertStringIncludes(source, '.eq("status", "active")');
  assertEquals(source.includes('select("id,user_id,status")'), false);
  assertEquals(source.includes('.eq("user_id", user.id)'), false);
});

Deno.test("Admin Stay operations authenticates the JWT before the Admin lookup", () => {
  const authRead = source.indexOf("service.auth.getUser(token)");
  const adminRead = source.indexOf('.from("admin_users")');
  assert(authRead >= 0);
  assert(adminRead > authRead);
});
