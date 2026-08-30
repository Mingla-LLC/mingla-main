import fs from "node:fs";
import path from "node:path";
import type React from "react";
import RecentRoute from "../recent";

jest.mock("expo-router", () => ({
  Redirect: "Redirect",
}));

test("/recent redirects once into Home full mode and Back removes full mode", () => {
  const redirect = RecentRoute() as React.ReactElement<{ href: string }>;
  expect(redirect.props.href).toBe("/(tabs)/home?recent=all");

  const home = fs.readFileSync(
    path.resolve(__dirname, "../(tabs)/home.tsx"),
    "utf8",
  );
  expect(home).toContain('router.push("/recent"');
  expect(home).toContain('const showFullRecent = params.recent === "all"');
  expect(home).toContain('onBack={() => router.replace("/(tabs)/home" as never)}');
});
