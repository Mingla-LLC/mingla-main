/**
 * #4111 Wave D — the Friends tab's enquiry rows, as one hook so ConnectionsPage
 * only weaves them in (see `mergeEnquiryConversations`) and renders
 * `EnquiryChatListRow`. Opening a row pushes the dedicated thread route.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useMyEnquiryRows } from "../../hooks/useBrandEnquiries";
import { postHogService } from "../../services/postHogService";
import { toastManager } from "../ui/Toast";
import { toEnquiryConversation, type EnquiryConversation } from "./enquiryChatRows";

export interface EnquiryChatRows {
  conversations: EnquiryConversation[];
  refetch: () => Promise<unknown>;
  open: (conversation: EnquiryConversation) => void;
}

const NONE: EnquiryConversation[] = [];

export function useEnquiryChatRows(userId: string | null): EnquiryChatRows {
  const router = useRouter();
  const query = useMyEnquiryRows(userId);
  const conversations = useMemo(
    () => (userId === null || query.data === undefined ? NONE : query.data.map((row) => toEnquiryConversation(row, userId))),
    [query.data, userId],
  );
  const { refetch } = query;
  // A failed read is said out loud once per failure (pull to refresh retries).
  const { t } = useTranslation("enquiry");
  useEffect(() => {
    if (query.isError && query.errorUpdatedAt > 0) {
      toastManager.show(t("enquiry:list_failed"), "error");
    }
  }, [query.errorUpdatedAt, query.isError, t]);
  const open = useCallback(
    (conversation: EnquiryConversation): void => {
      postHogService.capture("brand_enquiry_thread_opened", {
        surface: "consumer_native",
        source: "chat_list",
        brand_id: conversation.enquiry.brandId,
      });
      router.push(`/enquiry/${encodeURIComponent(conversation.enquiry.enquiryId)}` as never);
    },
    [router],
  );
  return { conversations, refetch, open };
}
