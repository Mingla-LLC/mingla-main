export const eventCoverVideoQueryKeys = {
  all: ["event-cover-video"] as const,
  job: (jobId: string) =>
    [...eventCoverVideoQueryKeys.all, "job", jobId] as const,
} as const;
