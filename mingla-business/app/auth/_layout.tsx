import { Stack } from "expo-router";

import { color } from "../../src/constants/designSystem";
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: color.canvas },
      }}
    />
  );
}
