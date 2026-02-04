/**
 * Activity Screen - Calendar and saved experiences
 * Three tabs: Boards, Saved, and Locked-In (calendar)
 */

import React from 'react';
import ActivityPage from '../components/ActivityPage';

interface ActivityScreenProps {
  onSendInvite: (friend: any) => void;
  userPreferences: any;
  accountPreferences: any;
  calendarEntries: any[];
  savedCards: any[];
  onScheduleFromSaved: (card: any) => void;
  onPurchaseFromSaved: (card: any, option: any) => void;
  onRemoveFromCalendar: (entry: any) => void;
  onRemoveSaved: (card: any) => void;
  onShareCard: (card: any) => void;
  onProposeNewDate: (entry: any) => void;
  boardsSessions: any[];
  onUpdateBoardSession: (board: any) => void;
  navigationData: any;
  onNavigationComplete: () => void;
  onPromoteToAdmin: (memberId: string, boardId: string) => void;
  onDemoteFromAdmin: (memberId: string, boardId: string) => void;
  onRemoveMember: (memberId: string, boardId: string) => void;
  onLeaveBoard: (boardId: string) => void;
  onOpenReview: (card: any) => void;
}

export default function ActivityScreen(props: ActivityScreenProps) {
  return <ActivityPage {...props} />;
}
