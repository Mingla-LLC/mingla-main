export interface WaitlistSpotOpenSmsInput {
  eventTitle: string;
  ticketTypeName: string;
  claimUrl: string;
}

export function renderWaitlistSpotOpenSms(
  input: WaitlistSpotOpenSmsInput,
): string {
  const ticketTypeName = input.ticketTypeName.trim().length > 0
    ? input.ticketTypeName.trim()
    : "ticket";
  const eventTitle = input.eventTitle.trim().length > 0
    ? input.eventTitle.trim()
    : "your event";
  return `Mingla: A ${ticketTypeName} spot just opened for ${eventTitle}. Claim within 24h: ${input.claimUrl}`;
}
