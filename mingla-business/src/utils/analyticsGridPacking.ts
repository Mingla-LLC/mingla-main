export type AnalyticsGridModuleId =
  | "visits"
  | "activity"
  | "sources"
  | "completed"
  | "pages"
  | "selectedPage"
  | "buttonTaps"
  | "regulars"
  | "customerPatterns";

export interface AnalyticsGridModule {
  id: AnalyticsGridModuleId;
  width: 5 | 6 | 7 | 12;
}

export interface AnalyticsGridOptions {
  showVisits: boolean;
  showActivity: boolean;
  showSources: boolean;
  showCompleted: boolean;
  showPages: boolean;
  showSelectedPage: boolean;
  showButtonTaps: boolean;
  showRegulars: boolean;
  showCustomerPatterns: boolean;
}

export function analyticsGridModules(
  options: AnalyticsGridOptions,
): AnalyticsGridModule[] {
  return [
    ...(options.showVisits
      ? [
          {
            id: "visits" as const,
            width: options.showActivity ? (6 as const) : (12 as const),
          },
        ]
      : []),
    ...(options.showActivity
      ? [{ id: "activity" as const, width: 6 as const }]
      : []),
    ...(options.showSources
      ? [{ id: "sources" as const, width: 12 as const }]
      : []),
    ...(options.showCompleted
      ? [{ id: "completed" as const, width: 12 as const }]
      : []),
    ...(options.showPages
      ? [
          {
            id: "pages" as const,
            width: options.showSelectedPage ? (7 as const) : (12 as const),
          },
        ]
      : []),
    ...(options.showSelectedPage
      ? [{ id: "selectedPage" as const, width: 5 as const }]
      : []),
    ...(options.showButtonTaps
      ? [{ id: "buttonTaps" as const, width: 6 as const }]
      : []),
    ...(options.showRegulars
      ? [{ id: "regulars" as const, width: 6 as const }]
      : []),
    ...(options.showCustomerPatterns
      ? [{ id: "customerPatterns" as const, width: 12 as const }]
      : []),
  ];
}

/** Pack visible modules without leaving a half-row after a hidden module. */
export function packAnalyticsGrid(
  modules: readonly AnalyticsGridModule[],
): AnalyticsGridModule[][] {
  const rows: AnalyticsGridModule[][] = [];
  let index = 0;
  while (index < modules.length) {
    const current = modules[index]!;
    if (current.width === 7 && modules[index + 1]?.width === 5) {
      rows.push([current, modules[index + 1]!]);
      index += 2;
      continue;
    }
    if (current.width === 6 && modules[index + 1]?.width === 6) {
      rows.push([current, modules[index + 1]!]);
      index += 2;
      continue;
    }
    rows.push([{ ...current, width: 12 }]);
    index += 1;
  }
  return rows;
}
