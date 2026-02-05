// Messages Page Type Definitions

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderType: 'curator' | 'business';
  senderAvatar?: string;
  content: string;
  timestamp: Date;
  read: boolean;
  type?: 'text' | 'image' | 'file' | 'negotiation' | 'experience';
  attachmentUrl?: string;
  metadata?: {
    // For negotiation messages
    proposedCommission?: number;
    finalCommission?: number;
    status?: 'proposed' | 'accepted' | 'rejected' | 'counter';
    // For experience messages
    experienceId?: string;
    experienceName?: string;
    experiencePrice?: number;
    experienceLocation?: string;
  };
}

export interface Collaboration {
  id: string;
  experienceId: string;
  experienceName: string;
  curatorId: string;
  curatorName: string;
  businessId: string;
  businessName: string;
  status: 'pending' | 'active' | 'completed';
  createdAt: string;
  commission?: number;
  experiencePrice?: number;
  experienceLocation?: string;
  experienceCategory?: string;
  experienceDuration?: string;
}

export interface MessagesPageProps {
  currentUserId: string;
  currentUserType: 'curator' | 'business';
  currentUserName: string;
  hideHeader?: boolean;
}

export interface ConversationListProps {
  collaborations: Collaboration[];
  selectedCollaboration: Collaboration | null;
  unreadCounts: Record<string, number>;
  searchQuery: string;
  currentUserType: 'curator' | 'business';
  isMobileView: boolean;
  hideHeader?: boolean;
  onSelectCollaboration: (collab: Collaboration) => void;
  onSearchChange: (query: string) => void;
}

export interface ChatViewProps {
  selectedCollaboration: Collaboration | null;
  messages: Message[];
  newMessage: string;
  isTyping: boolean;
  currentUserId: string;
  currentUserType: 'curator' | 'business';
  currentUserName: string;
  isMobileView: boolean;
  sharedExperiences: any[];
  onBack: () => void;
  onSendMessage: () => void;
  onMessageChange: (value: string) => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
  onExportChat: () => void;
  onShowCollabDetails: () => void;
  onShowNegotiationModal: () => void;
  onShowExperienceTagMenu: () => void;
  onTagExperience: (experience: any) => void;
  onAcceptNegotiation: (messageId: string, commission: number) => void;
  onRejectNegotiation: (messageId: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  scrollAreaRef: React.RefObject<HTMLDivElement>;
}

export interface MessageBubbleProps {
  message: Message;
  currentUserId: string;
  currentUserType: 'curator' | 'business';
  onAcceptNegotiation?: (messageId: string, commission: number) => void;
  onRejectNegotiation?: (messageId: string) => void;
}

export interface NegotiationModalProps {
  isOpen: boolean;
  proposedCommission: string;
  proposalReason: string;
  onClose: () => void;
  onProposedCommissionChange: (value: string) => void;
  onProposalReasonChange: (value: string) => void;
  onSubmit: () => void;
}

export interface CollaborationDetailsProps {
  isOpen: boolean;
  collaboration: Collaboration | null;
  sharedExperiences: any[];
  currentUserType: 'curator' | 'business';
  onClose: () => void;
}
