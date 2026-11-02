/**
 * #3355 bug 16 — creating a brand from Home's brand switcher stopped after
 * step 1. Step 1 switches the current brand; the new brand's role then loads,
 * and Home swapped from the regular surface to the venue-staff "resolving"
 * surface (and back). Each surface mounts its OWN BrandSwitcherSheet, so the
 * sheet holding the creation flow unmounted. Home now holds its surface while
 * the switcher is open.
 */
import fs from "fs";
import path from "path";
import React from "react";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (node: React.ReactElement) => {
    update: (node: React.ReactElement) => void;
    unmount: () => void;
  };
};

import { useLatchedWhileOpen } from "../useLatchedWhileOpen";

const seen: string[] = [];
function Probe({ live, open }: { live: string; open: boolean }): null {
  seen.push(useLatchedWhileOpen(live, open));
  return null;
}

function last(): string | undefined {
  return seen[seen.length - 1];
}

describe("useLatchedWhileOpen", () => {
  beforeEach(() => {
    seen.length = 0;
  });

  it("returns the live value while closed", () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      r = TestRenderer.create(<Probe live="home" open={false} />);
    });
    expect(last()).toBe("home");
    TestRenderer.act(() => r.update(<Probe live="staff" open={false} />));
    expect(last()).toBe("staff");
    r.unmount();
  });

  it("holds the value it had when opened, through role loading, until closed", () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      r = TestRenderer.create(<Probe live="home" open={false} />);
    });
    TestRenderer.act(() => r.update(<Probe live="home" open />));
    expect(last()).toBe("home");
    // Step 1 switches the brand: its role starts loading.
    TestRenderer.act(() => r.update(<Probe live="staff" open />));
    expect(last()).toBe("home");
    TestRenderer.act(() => r.update(<Probe live="home" open />));
    expect(last()).toBe("home");
    TestRenderer.act(() => r.update(<Probe live="staff" open />));
    expect(last()).toBe("home");
    // The flow finished and the sheet closed: the live surface takes over.
    TestRenderer.act(() => r.update(<Probe live="staff" open={false} />));
    expect(last()).toBe("staff");
    r.unmount();
  });

  it("latches again on the next open", () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      r = TestRenderer.create(<Probe live="staff" open={false} />);
    });
    TestRenderer.act(() => r.update(<Probe live="staff" open />));
    TestRenderer.act(() => r.update(<Probe live="home" open />));
    expect(last()).toBe("staff");
    r.unmount();
  });
});

describe("Home holds its surface while the brand switcher is open", () => {
  const home = fs.readFileSync(
    path.resolve(__dirname, "../../../app/(tabs)/home.tsx"),
    "utf8",
  );

  it("chooses the staff / scanner surface from the latched value", () => {
    expect(home).toMatch(
      /const surface = useLatchedWhileOpen\(liveSurface, sheetVisible\);/,
    );
    expect(home).toMatch(/if \(surface === "staff" && currentBrand !== null\)/);
    expect(home).toMatch(/if \(surface === "scanner"\)/);
    // No branch still reads the live role directly.
    expect(home).not.toMatch(/if \(venueStaffSurface !== null && currentBrand !== null\)/);
    expect(home).not.toMatch(/if \(isScannerOnlyRank\(callerRank\)\)/);
  });
});
