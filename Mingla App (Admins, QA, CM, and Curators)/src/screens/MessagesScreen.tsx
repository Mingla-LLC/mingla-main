/**
 * Messages Screen - Collaboration chat and messaging
 * Communication between curators and businesses
 */

import React from 'react';
import MessagesPage from '../components/MessagesPage';

interface MessagesScreenProps {
  currentUserId: string;
  currentUserType: 'curator' | 'business';
  currentUserName: string;
}

export default function MessagesScreen(props: MessagesScreenProps) {
  return <MessagesPage {...props} />;
}
