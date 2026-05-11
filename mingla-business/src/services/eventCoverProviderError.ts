export type EventCoverProviderErrorCode =
  | "invalid_query"
  | "not_configured"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_response"
  | "auth_required";

export class EventCoverProviderError extends Error {
  code: EventCoverProviderErrorCode;
  status?: number;

  constructor(
    code: EventCoverProviderErrorCode,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "EventCoverProviderError";
    this.code = code;
    this.status = status;
  }
}
