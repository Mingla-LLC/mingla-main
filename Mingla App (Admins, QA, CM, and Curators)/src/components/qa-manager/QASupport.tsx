import React, { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import SupportTicketsSection from '../SupportTicketsSection';
import LiveChatSupport from '../LiveChatSupport';
import QAPageLayout from './QAPageLayout';

export default function QASupport({ userData }: any) {
  const [showLiveChat, setShowLiveChat] = useState(false);

  return (
    <QAPageLayout
      title="Support Center"
      description="Handle user support tickets and live chat"
      actions={
        <Button
          onClick={() => setShowLiveChat(!showLiveChat)}
          className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] hover:from-[#d6691f] hover:to-[#eb7825] text-white"
        >
          <MessageCircle className="w-4 h-4 mr-2" />
          {showLiveChat ? 'Hide' : 'Show'} Live Chat
        </Button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Support Tickets */}
        <div className={showLiveChat ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <SupportTicketsSection isQAView={true} />
        </div>

        {/* Live Chat (Conditional) */}
        {showLiveChat && (
          <div className="lg:col-span-1">
            <Card className="border border-gray-200 overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-[#eb7825] to-[#d6691f]">
                <h3 className="text-white">Live Chat Queue</h3>
                <p className="text-white/80 text-sm">Active conversations</p>
              </div>
              <LiveChatSupport isQAView={true} />
            </Card>
          </div>
        )}
      </div>
    </QAPageLayout>
  );
}
