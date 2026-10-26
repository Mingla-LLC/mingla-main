/**
 * #4111 Wave D — enquiry threads as Friends-tab chat rows (D3).
 *
 * PURE. Each enquiry is its OWN row: never merged with that brand's event or
 * trip chats, never folded into a "brand channel". The row carries
 * `isEnquiry: true` and `chatKind: "enquiry"` — the names #4114's redesigned
 * ChatListItem reads — plus the enquiry fields the row and thread need.
 */
import type { Conversation } from "../../hooks/useMessages";
import type { MyEnquiryRow } from "../../services/brandEnquiryService";

export interface EnquiryRowMeta {
  enquiryId: string;
  brandId: string;
  brandName: string;
  brandSlug: string | null;
  brandLogoUrl: string | null;
  topicLabel: string | null;
  status: MyEnquiryRow["status"];
  /** Last message preview, already prefixed for the guest's own messages by the row. */
  lastMessageFromBrand: boolean;
}

export type EnquiryConversation = Conversation & {
  linked_entity_type: "brand_enquiry";
  isEnquiry: true;
  chatKind: "enquiry";
  enquiry: EnquiryRowMeta;
};

export function toEnquiryConversation(row: MyEnquiryRow, userId: string): EnquiryConversation {
  return {
    id: row.conversationId,
    name: row.brandName,
    linked_entity_type: "brand_enquiry",
    created_by: userId,
    created_at: row.lastActivityAt || row.createdAt,
    participants: [],
    unread_count: row.unreadCount,
    messages: [],
    last_message:
      row.lastMessage === null
        ? undefined
        : {
            id: row.lastMessage.id,
            conversation_id: row.conversationId,
            sender_id: null,
            content: row.lastMessage.body,
            message_type: "text",
            created_at: row.lastMessage.at,
            sender_name: row.lastMessage.fromBrand ? row.brandName : undefined,
            is_read: !row.lastMessage.fromBrand || row.unreadCount === 0,
          },
    isEnquiry: true,
    chatKind: "enquiry",
    enquiry: {
      enquiryId: row.enquiryId,
      brandId: row.brandId,
      brandName: row.brandName,
      brandSlug: row.brandSlug,
      brandLogoUrl: row.brandLogoUrl,
      topicLabel: row.topicLabel,
      status: row.status,
      lastMessageFromBrand: row.lastMessage?.fromBrand === true,
    },
  };
}

export function isEnquiryConversation(value: unknown): value is EnquiryConversation {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { isEnquiry?: unknown }).isEnquiry === true &&
    typeof (value as { enquiry?: { enquiryId?: unknown } }).enquiry?.enquiryId === "string"
  );
}

const normalize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const activityMs = (conversation: Conversation): number => {
  const ms = Date.parse(conversation.last_message?.created_at || conversation.created_at);
  return Number.isFinite(ms) ? ms : 0;
};

const isPinnedFirst = (conversation: Conversation): boolean =>
  Boolean((conversation as { __pendingInvite?: unknown }).__pendingInvite);

/**
 * The Friends-tab list with enquiries woven in by recency. Pending session
 * invites keep their place at the top; a search filters enquiries by brand,
 * topic and last message. Rows are never de-duplicated against other chats:
 * an enquiry conversation never appears in `regular` (its access list
 * excludes it), and an enquiry is never collapsed into another row.
 */
export function mergeEnquiryConversations<T extends Conversation>(
  regular: readonly T[],
  enquiries: readonly EnquiryConversation[],
  searchQuery: string,
): (T | EnquiryConversation)[] {
  const q = normalize(searchQuery);
  const matching = q.length === 0
    ? enquiries
    : enquiries.filter((row) =>
        [row.enquiry.brandName, row.enquiry.topicLabel ?? "", row.last_message?.content ?? ""]
          .some((candidate) => normalize(candidate).includes(q)),
      );
  if (matching.length === 0) return [...regular];
  const pinned = regular.filter(isPinnedFirst);
  const rest: (T | EnquiryConversation)[] = [...regular.filter((c) => !isPinnedFirst(c)), ...matching];
  rest.sort((a, b) => activityMs(b) - activityMs(a));
  return [...pinned, ...rest];
}
