/**
 * Issue #4114 Wave 4: the displayable link for a message's media.
 * A stored path resolves to a cached short-lived signed URL; a pre-Wave-4
 * public URL or this phone's local file is used as it is.
 */
import { useCallback, useEffect, useState } from "react";
import { peekChatMediaUrl, resolveChatMediaUrl } from "../../services/chatMediaUploadService";

export interface ChatMediaUrlState {
  url: string | null;
  status: "idle" | "loading" | "ready" | "error";
  retry: () => void;
}

export function useChatMediaUrl(fileUrl: string | null | undefined): ChatMediaUrlState {
  const cached = peekChatMediaUrl(fileUrl);
  const [url, setUrl] = useState<string | null>(cached);
  const [status, setStatus] = useState<ChatMediaUrlState["status"]>(cached ? "ready" : fileUrl ? "loading" : "idle");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!fileUrl) {
      setUrl(null);
      setStatus("idle");
      return () => {
        active = false;
      };
    }
    const hit = peekChatMediaUrl(fileUrl);
    if (hit) {
      setUrl(hit);
      setStatus("ready");
      return () => {
        active = false;
      };
    }
    setStatus("loading");
    resolveChatMediaUrl(fileUrl)
      .then((resolved) => {
        if (!active) return;
        setUrl(resolved);
        setStatus(resolved ? "ready" : "error");
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.warn("[useChatMediaUrl] could not get a link for chat media", error);
        setUrl(null);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [fileUrl, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { url, status, retry };
}
