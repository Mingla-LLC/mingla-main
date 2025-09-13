import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Friends } from '@/pages/Friends';
import { Inbox } from '@/pages/Inbox';

const Connections = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'friends');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && (tab === 'friends' || tab === 'inbox')) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams({ tab: value });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <h1 className="text-2xl font-bold">Connections</h1>
        <p className="text-muted-foreground">Manage your friends and messages</p>
      </div>

      {/* Main Content */}
      <div className="px-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="friends">Friends</TabsTrigger>
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
          </TabsList>

          <TabsContent value="friends" className="mt-6">
            <Friends />
          </TabsContent>

          <TabsContent value="inbox" className="mt-6">
            <Inbox />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Connections;