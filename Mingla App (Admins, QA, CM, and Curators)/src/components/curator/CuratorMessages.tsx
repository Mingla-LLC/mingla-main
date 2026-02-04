import React from 'react';
import { MessageCircle, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import CuratorPageLayout from './CuratorPageLayout';
import MessagesPage from '../MessagesPage';

interface CuratorMessagesProps {
  userData?: {
    name: string;
    email: string;
    id?: string;
  };
  businesses?: any[];
}

export default function CuratorMessages({ userData, businesses }: CuratorMessagesProps) {
  const currentUserId = userData?.id || userData?.email || 'curator-user';
  const currentUserName = userData?.name || 'Curator';
  
  return (
    <CuratorPageLayout
      title="Messages"
      description="Communicate with your business partners and collaborators"
      actions={
        <Button 
          variant="outline"
          className="border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Message
        </Button>
      }
    >
      <div className="h-[calc(100vh-200px)]">
        <MessagesPage 
          currentUserId={currentUserId}
          currentUserType="curator"
          currentUserName={currentUserName}
          hideHeader={true}
        />
      </div>
    </CuratorPageLayout>
  );
}
