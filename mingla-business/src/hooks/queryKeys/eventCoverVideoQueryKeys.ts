export const eventCoverVideoQueryKeys = {
  all: ["event-cover-video"] as const,
  job: (jobId: string) =>
    [...eventCoverVideoQueryKeys.all, "job", jobId] as const,
  target: (kind: "event" | "brand" | "venue" | "venue_draft", identity: string) =>
    [...eventCoverVideoQueryKeys.all, "target", kind, identity] as const,
} as const;
