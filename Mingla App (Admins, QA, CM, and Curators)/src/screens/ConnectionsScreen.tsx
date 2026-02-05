/**
 * Connections Screen - Friends and networking
 * Manage friends, send invites, and collaborate
 */

import React from 'react';
import ConnectionsPage from '../components/ConnectionsPage';

interface ConnectionsScreenProps {
  onSendCollabInvite: (friend: any) => void;
  onAddToBoard: (card: any, board: any) => void;
  onShareSavedCard: (card: any, friend: any) => void;
  onRemoveFriend: (friend: any) => void;
  onBlockUser: (user: any) => void;
  onReportUser: (user: any, reason: string) => void;
  accountPreferences: any;
  boardsSessions: any[];
  currentMode: string;
  onModeChange: (mode: string) => void;
  onUpdateBoardSession: (board: any) => void;
  onCreateSession: (session: any) => void;
  onNavigateToBoard: (boardId: string) => void;
  friendsList: any[];
}

export default function ConnectionsScreen(props: ConnectionsScreenProps) {
  return <ConnectionsPage {...props} />;
}
