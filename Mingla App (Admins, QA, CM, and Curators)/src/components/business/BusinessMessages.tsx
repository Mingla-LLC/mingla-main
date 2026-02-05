import React from 'react';
import { MessageCircle, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import BusinessPageLayout from './BusinessPageLayout';
import MessagesPage from '../MessagesPage';

interface BusinessMessagesProps {
  businessData?: {
    name: string;
    email: string;
    id?: string;
  };
}

/**
 * Business Messages Page
 * Uses the same MessagesPage component with consistent business layout
 * Matches the exact design and functionality of CuratorMessages
 */
export default function BusinessMessages({ businessData }: BusinessMessagesProps) {
  // Get business info from localStorage if not in props
  const businesses = JSON.parse(localStorage.getItem('mingla_businesses') || '[]');
  const currentBusiness = businesses.find((b: any) => 
    b.email === businessData?.email || b.id === businessData?.id
  );
  
  const currentUserId = currentBusiness?.id || businessData?.id || businessData?.email || 'business-user';
  const currentUserName = businessData?.name || currentBusiness?.name || 'Business User';
  
  return (
    <BusinessPageLayout
      title="Messages"
      description="Communicate with curators, partners, and customers"
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
          currentUserType="business"
          currentUserName={currentUserName}
          hideHeader={true}
        />
      </div>
    </BusinessPageLayout>
  );
}
