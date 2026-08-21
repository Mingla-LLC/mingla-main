import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

const lazyHosts = [
  "app/(tabs)/people/import.tsx",
  "src/components/people/PeoplePage.tsx",
  "src/components/people/ManualGroupDetail.tsx",
  "src/components/people/ManualGroupFlow.tsx",
];

describe("#2395 tester — deferred Manual-group UI remains actionable", () => {
  test.each(lazyHosts)(
    "%s has visible accessible loading instead of a blank Suspense fallback",
    (file) => {
      const source = read(file);
      expect(source).not.toContain("<React.Suspense fallback={null}>");
      expect(source).toContain("accessibilityLiveRegion");
      expect(source).toMatch(/Loading|Preparing|Opening/);
    },
  );

  test.each(lazyHosts)(
    "%s contains a local chunk-error boundary with an explicit retry/reset path",
    (file) => {
      const source = read(file);
      expect(source).toContain("ErrorBoundary");
      expect(source).toMatch(/Try again|Retry/);
      expect(source).toMatch(/onReset|resetKeys|retry/i);
    },
  );
});
