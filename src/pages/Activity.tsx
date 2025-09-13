import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import Boards from '@/pages/Boards';
import Saved from '@/pages/Saved';
import { CalendarView } from '@/components/CalendarView';

const Activity = () => {
  const [savedTab, setSavedTab] = useState('liked');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 pt-12 pb-6">
        <h1 className="text-2xl font-bold">Activity</h1>
        <p className="text-muted-foreground">Manage your boards and saved experiences</p>
      </div>

      {/* Main Content */}
      <div className="px-6">
        <Tabs defaultValue="boards" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="boards">Boards</TabsTrigger>
            <TabsTrigger value="saved">Saved</TabsTrigger>
          </TabsList>

          <TabsContent value="boards" className="mt-6">
            <Boards />
          </TabsContent>

          <TabsContent value="saved" className="mt-6">
            <Tabs value={savedTab} onValueChange={setSavedTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="liked">Liked</TabsTrigger>
                <TabsTrigger value="accepted">Accepted</TabsTrigger>
              </TabsList>

              <TabsContent value="liked" className="mt-4">
                <Saved />
              </TabsContent>

              <TabsContent value="accepted" className="mt-4">
                <CalendarView />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Activity;