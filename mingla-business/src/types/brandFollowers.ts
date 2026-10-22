export type BrandFollowerSourcesThisWeek = {
  checkout: number;
  brandPage: number;
  emailInvite: number;
  other: number;
};

export type BrandFollowerSummary = {
  schemaVersion: 1;
  total: number;
  newThisWeek: number;
  sourcesThisWeek: BrandFollowerSourcesThisWeek;
  trend: [number, number, number, number, number, number, number];
  asOf: string;
};
