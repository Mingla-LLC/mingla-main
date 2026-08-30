import fs from "node:fs";
import path from "node:path";

const WRITER_ROUTES = [
  "venue/[venueId]/index.tsx",
  "event/[id]/index.tsx",
  "event/[id]/edit.tsx",
  "rsvp/[id]/index.tsx",
  "rsvp/[id]/edit.tsx",
  "experience/[id]/index.tsx",
  "experience/[id]/edit.tsx",
  "trip/[id]/index.tsx",
  "trip/[id]/edit.tsx",
] as const;

test("all Recent writer routes share an import-safe registration boundary", () => {
  const appRoot = path.resolve(__dirname, "../../../app");
  for (const route of WRITER_ROUTES) {
    expect(fs.readFileSync(path.join(appRoot, route), "utf8")).toContain(
      'from "../../../src/hooks/useBusinessRecent"',
    );
  }

  jest.isolateModules(() => {
    jest.doMock("../../context/AuthContext", () => ({
      useAuth: () => ({ user: null, isAuthReady: false }),
    }));
    jest.doMock("../../lib/netinfoSafe", () => ({
      useNetInfoSafe: () => null,
    }));
    jest.doMock("expo-router", () => ({ useFocusEffect: undefined }));
    jest.doMock("@react-native-async-storage/async-storage", () => {
      throw new Error("native storage instantiated during route registration");
    });
    jest.doMock("../../services/supabase", () => {
      throw new Error("Supabase instantiated during route registration");
    });
    jest.doMock("../../services/postHogService", () => {
      throw new Error("analytics instantiated during route registration");
    });

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../useBusinessRecent");
    }).not.toThrow();
  });
});
