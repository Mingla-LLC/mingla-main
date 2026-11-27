/** Server-owned, owner-safe copy for durable Ari failure replies. */
import { emitOwnerText } from "./ariOwnerEmit.ts";
import { toolOwnerCopy } from "./ariPresentation/toolLabels.ts";

export type AriFailureClass =
  | "model_unavailable"
  | "timeout"
  | "tool_failed"
  | "permission"
  | "not_found"
  | "invalid_input"
  | "rate_limited"
  | "internal";

export interface AriFailureReply {
  text: string;
  structured: {
    failure: {
      v: 1;
      class: AriFailureClass;
      retryable: boolean;
      changed_anything: boolean;
    };
  };
}

export function ariFailureClass(errorCode: string): AriFailureClass {
  const code = String(errorCode ?? "").toUpperCase();
  if (/RATE_LIMIT|TOO_MANY/.test(code)) return "rate_limited";
  if (/TIMEOUT|DEADLINE/.test(code)) return "timeout";
  if (/MODEL|GEMINI|PROVIDER|ACCEPTED_RESPONSE_FAILED/.test(code)) {
    return "model_unavailable";
  }
  if (/CHECK_UNAVAILABLE|DEPENDENCY_UNAVAILABLE/.test(code)) {
    return "tool_failed";
  }
  if (/FORBIDDEN|PERMISSION|OWNERSHIP|ROLE|ACCESS_DENIED/.test(code)) {
    return "permission";
  }
  if (/NOT_FOUND|MISSING/.test(code)) return "not_found";
  if (/INVALID|BAD_REQUEST|SCHEMA|ARG|REQUIRED/.test(code)) {
    return "invalid_input";
  }
  if (/TOOL|EDGE|RPC|EXECUTION|DOMAIN_REFUSED/.test(code)) {
    return "tool_failed";
  }
  return "internal";
}

function failureText(
  failureClass: AriFailureClass,
  toolName?: string,
  resetAt?: string,
): string {
  switch (failureClass) {
    case "model_unavailable":
      return "I couldn't finish that just now. Nothing was changed. Try again in a moment.";
    case "timeout":
      return "I ran out of time before I could finish that. Nothing was changed. Try again.";
    case "tool_failed": {
      const step = toolName ? toolOwnerCopy(toolName).title : "that change";
      return `I couldn't finish ${step.toLowerCase()}. Nothing was changed. Review the details and try again.`;
    }
    case "permission":
      return "You don't have access to change that on this brand. An owner or admin can.";
    case "not_found":
      return "I couldn't find the item you asked for. Nothing was changed. Check the name and try again.";
    case "invalid_input":
      return "I couldn't use one of those details. Nothing was changed. Check it and try again.";
    case "rate_limited":
      return resetAt
        ? `Ari is busy right now. Try again after ${resetAt}. Nothing was changed.`
        : "Ari is busy right now. Nothing was changed. Try again shortly.";
    case "internal":
    default:
      return "I couldn't finish that request. Nothing was changed. Try again shortly.";
  }
}

export function buildAriFailureReply(input: {
  errorCode: string;
  toolName?: string;
  resetAt?: string;
  changedAnything?: boolean;
}): AriFailureReply {
  const failureClass = ariFailureClass(input.errorCode);
  const changedAnything = input.changedAnything === true;
  return {
    text: emitOwnerText(
      "failure",
      failureText(
        failureClass,
        input.toolName,
        input.resetAt,
      ),
      { surface: "failure_reply" },
    ),
    structured: {
      failure: {
        v: 1,
        class: failureClass,
        retryable: [
          "model_unavailable",
          "timeout",
          "tool_failed",
          "rate_limited",
          "internal",
        ].includes(failureClass),
        changed_anything: changedAnything,
      },
    },
  };
}
