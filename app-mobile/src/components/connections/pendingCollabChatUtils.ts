// Phone-invite helpers (first used by the retired pending collab sheet; #4435
// Add people's GroupPhoneInvite keeps them).
export function buildPendingCollabPhoneE164(
  phoneInput: string,
  dialCode: string | null | undefined,
): string {
  const digits = phoneInput.replace(/\D/g, "");
  if (!dialCode || !digits) return "";
  return `${dialCode}${digits}`;
}

export function isPendingCollabPhoneValid(phoneInput: string): boolean {
  return phoneInput.replace(/\D/g, "").length >= 7;
}
