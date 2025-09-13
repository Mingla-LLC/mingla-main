import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import Boards from '@/pages/Boards';
import Saved from '@/pages/Saved';
import { CalendarView } from '@/components/CalendarView';

// Mock accepted experiences data
const acceptedExperiences = [
  {
    id: '1',
    title: 'Pottery Workshop',
    image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96',
    date: new Date(2025, 0, 15), // January 15, 2025
    time: '2:00 PM - 5:00 PM',
    location: 'Downtown Art Studio',
    collaborators: ['Emma Wilson']
  },
  {
    id: '2', 
    title: 'Wine Tasting Experience',
    image: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3',
    date: new Date(2025, 0, 20), // January 20, 2025
    time: '6:00 PM - 8:30 PM',
    location: 'Vineyard Heights',
    collaborators: ['James Rodriguez', 'Priya Patel']
  },
  {
    id: '3',
    title: 'Rooftop Brunch',
    image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4',
    date: new Date(2025, 0, 25), // January 25, 2025
    time: '11:00 AM - 1:00 PM',
    location: 'Sky Terrace Restaurant',
    collaborators: []
  },
  {
    id: '4',
    title: 'Art Gallery Opening',
    image: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b',
    date: new Date(2025, 1, 3), // February 3, 2025
    time: '7:00 PM - 9:00 PM',
    location: 'Modern Art Gallery',
    collaborators: ['Emma Wilson']
  }
];

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
                <CalendarView experiences={acceptedExperiences} />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Activity;