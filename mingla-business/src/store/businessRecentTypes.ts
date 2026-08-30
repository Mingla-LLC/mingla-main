export type BusinessRecentEntityType =
  "venue" | "event" | "rsvp" | "experience" | "trip";

export interface BusinessRecentPointer {
  entityType: BusinessRecentEntityType;
  entityId: string;
  lastOpenedAt: string;
  operationId: string;
  title?: string;
  coverUrl?: string | null;
  coverPosterUrl?: string | null;
  coverType?: "image" | "video" | "gif" | null;
  status?: string | null;
  destination?: "detail" | "edit";
  startsAt?: string | null;
  endsAt?: string | null;
  pendingSync: boolean;
  localDraft: boolean;
}
