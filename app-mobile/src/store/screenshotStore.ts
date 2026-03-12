import { create } from 'zustand';

/**
 * DEV ONLY: Global store for screenshot automation.
 * Child components subscribe to trigger flags and open their local modals.
 */

interface ScreenshotStore {
  // Home child modals
  triggerNotificationsModal: boolean;
  triggerFriendsModal: boolean;
  triggerExpandedCard: boolean;
  triggerDeckHistory: boolean;
  triggerDismissedCards: boolean;

  // Discover child modals
  triggerAddPerson: boolean;
  triggerLinkFriend: boolean;

  // Profile child modals
  triggerEditBio: boolean;
  triggerEditInterests: boolean;

  // Connections child modals
  triggerMessageInterface: boolean;
  triggerAddFriendView: boolean;
  triggerRequestsView: boolean;
  triggerBlockedUsers: boolean;

  // Board child modals
  triggerBoardSettings: boolean;
  triggerManageMembers: boolean;
  triggerInviteParticipants: boolean;

  // Collaboration sub-tabs
  triggerCollabSessionsTab: boolean;
  triggerCollabInvitesTab: boolean;
  triggerCollabCreateTab: boolean;

  // Generic
  triggerCountryPicker: boolean;

  // Actions
  setTrigger: (key: string, value: boolean) => void;
  resetAll: () => void;
}

const INITIAL_STATE = {
  triggerNotificationsModal: false,
  triggerFriendsModal: false,
  triggerExpandedCard: false,
  triggerDeckHistory: false,
  triggerDismissedCards: false,
  triggerAddPerson: false,
  triggerLinkFriend: false,
  triggerEditBio: false,
  triggerEditInterests: false,
  triggerMessageInterface: false,
  triggerAddFriendView: false,
  triggerRequestsView: false,
  triggerBlockedUsers: false,
  triggerBoardSettings: false,
  triggerManageMembers: false,
  triggerInviteParticipants: false,
  triggerCollabSessionsTab: false,
  triggerCollabInvitesTab: false,
  triggerCollabCreateTab: false,
  triggerCountryPicker: false,
};

export const useScreenshotStore = create<ScreenshotStore>((set) => ({
  ...INITIAL_STATE,
  setTrigger: (key, value) => set({ [key]: value }),
  resetAll: () => set(INITIAL_STATE),
}));
