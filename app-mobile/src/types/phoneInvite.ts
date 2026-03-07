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
  status: "sent" | "already_invited";
}

export interface SendPhoneInviteError {
  error: string;
  existingUserId?: string;
  existingUsername?: string;
}
