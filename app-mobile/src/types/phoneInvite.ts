export interface PendingInvite {
  id: string;
  inviterId: string;
  phoneE164: string;
  status: "pending" | "converted" | "cancelled";
  convertedUserId: string | null;
  convertedAt: string | null;
  createdAt: string;
}

export interface SendPhoneInviteResponse {
  success: boolean;
  inviteId: string;
  status: "sent" | "skipped" | "deferred" | "send_failed" | "already_invited";
  /**
   * Issue #4114 QA run 2: whether the invite TEXT went out (the invite row
   * exists either way). Same shape as send-pair-request since Wave 2b. Absent
   * from an older server, which the app treats as not texted.
   */
  smsStatus?: "sent" | "failed";
  smsProviderStatus?: string;
  /** The link to share when the text did not go out. */
  inviteLink?: string;
}

export interface SendPhoneInviteError {
  error: string;
  existingUserId?: string;
  existingUsername?: string;
}
