import React from "react";

import type { TurnoutReport } from "../../../types/growthTools";
import { IntelReportSheet } from "../IntelReportSheet";

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    children,
    ...props
  }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("MockSheet", props, children),
}));

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => {
    root: { findByProps: (props: Record<string, unknown>) => unknown };
    unmount: () => void;
  };
};

describe("#1008 full turnout report row identity", () => {
  it("opens the real-result report sheet with repeated engine factor keys", () => {
    const report = {
      forecast: {
        total_low: 86,
        total_high: 150,
        capacity: 150,
        confidence: "medium",
      },
      factors: [
        {
          key: "weather",
          label: "Weather",
          status: "help",
          detail: "Clear conditions support attendance.",
        },
        {
          key: "weather",
          label: "Conditions",
          status: "help",
          detail: "Dry conditions support arrival.",
        },
        {
          key: "weather",
          label: "Travel",
          status: "watch",
          detail: "Traffic can soften late arrivals.",
        },
      ],
      meta: { research_source: "grounded", schema_version: 1 },
    } as TurnoutReport;
    const originalError = console.error;
    const keyWarnings: string[] = [];
    console.error = (...args: unknown[]): void => {
      const message = args.map(String).join(" ");
      if (
        message.includes("Encountered two children with the same key") ||
        message.includes("Each child in a list should have a unique")
      ) {
        keyWarnings.push(message);
      } else {
        originalError(...args);
      }
    };

    let sheet:
      | {
          root: { findByProps: (props: Record<string, unknown>) => unknown };
          unmount: () => void;
        }
      | undefined;
    try {
      act(() => {
        sheet = create(
          <IntelReportSheet
            visible
            report={report}
            onClose={() => undefined}
          />,
        );
      });
      expect(
        sheet?.root.findByProps({ testID: "turnout-report-sheet" }),
      ).toBeDefined();
      expect(
        sheet?.root.findByProps({ testID: "turnout-full-report" }),
      ).toBeDefined();
      expect(keyWarnings).toEqual([]);
    } finally {
      if (sheet !== undefined) {
        act(() => sheet?.unmount());
      }
      console.error = originalError;
    }
  });
});
