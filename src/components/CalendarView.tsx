import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Calendar, Clock, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/appStore';
import { useExperiences } from '@/hooks/useExperiences';

interface CalendarViewProps {
  // Remove the experiences prop since we'll fetch from store
}

export const CalendarView = ({}: CalendarViewProps) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const { saves } = useAppStore();
  const { experiences } = useExperiences();

  // Demo experiences for calendar showcase
  const demoExperiences = [
    {
      id: 'demo-exp-1',
      title: 'Central Park Morning Walk',
      image: 'https://images.unsplash.com/photo-1566404791232-af9fe0ae8f8b?w=400',
      date: new Date(2025, 8, 23, 14, 0), // September 23, 2025 2:00 PM
      time: '2:00 PM - 3:30 PM',
      location: 'Central Park, NYC',
      collaborators: ['Sarah J.', 'Mike C.']
    },
    {
      id: 'demo-exp-2',
      title: 'Artisan Coffee Experience',
      image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400',
      date: new Date(2025, 8, 30, 16, 30), // September 30, 2025 4:30 PM
      time: '4:30 PM - 6:00 PM',
      location: 'Blue Bottle Coffee',
      collaborators: ['Emma D.']
    },
    {
      id: 'demo-exp-3',
      title: 'Brooklyn Food Tour',
      image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400',
      date: new Date(2025, 9, 7, 18, 0), // October 7, 2025 6:00 PM
      time: '6:00 PM - 8:30 PM',
      location: 'Brooklyn Heights',
      collaborators: ['Mike C.', 'Lisa W.', 'Alex R.']
    },
    {
      id: 'demo-exp-4',
      title: 'Modern Art Gallery',
      image: 'https://images.unsplash.com/photo-1544967882-6abcd0847e50?w=400',
      date: new Date(2025, 9, 14, 15, 30), // October 14, 2025 3:30 PM
      time: '3:30 PM - 5:00 PM',
      location: 'Whitney Museum',
      collaborators: ['Sarah J.']
    },
    {
      id: 'demo-exp-5',
      title: 'Rooftop Bar Views',
      image: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=400',
      date: new Date(2025, 9, 21, 17, 0), // October 21, 2025 5:00 PM
      time: '5:00 PM - 7:30 PM',
      location: 'Manhattan Skyline',
      collaborators: ['Emma D.', 'Alex R.']
    },
    {
      id: 'demo-exp-6',
      title: 'Weekend Market Stroll',
      image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400',
      date: new Date(2025, 9, 28, 13, 0), // October 28, 2025 1:00 PM
      time: '1:00 PM - 3:00 PM',
      location: 'Union Square Market',
      collaborators: ['Lisa W.']
    }
  ];

  // Transform saves with scheduled_at into calendar experiences, fallback to demo
  const acceptedExperiences = useMemo(() => {
    const scheduledSaves = saves.filter(save => 
      save.status === 'scheduled' && save.scheduled_at
    );
    
    if (scheduledSaves.length === 0) {
      // Return demo experiences when no real saves exist
      return demoExperiences;
    }
    
    return scheduledSaves.map(save => {
      const experience = experiences.find(exp => exp.id === save.experience_id);
      if (!experience) return null;
      
      return {
        id: save.experience_id,
        title: experience.title,
        image: experience.image_url || 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085',
        date: new Date(save.scheduled_at!),
        time: '2:00 PM - 4:00 PM', // Default time, could be enhanced
        location: 'Local Area', // Could be enhanced with real location data
        collaborators: [] // Could be enhanced with collaboration data
      };
    }).filter(Boolean) as Array<{
      id: string;
      title: string;
      image: string;
      date: Date;
      time: string;
      location: string;
      collaborators: string[];
    }>;
  }, [saves, experiences]);

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getExperiencesForDate = (date: Date) => {
    return acceptedExperiences.filter(exp => {
      const expDate = new Date(exp.date);
      return expDate.getDate() === date.getDate() &&
             expDate.getMonth() === date.getMonth() &&
             expDate.getFullYear() === date.getFullYear();
    });
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const daysInMonth = getDaysInMonth(currentDate);
  const firstDay = getFirstDayOfMonth(currentDate);

  const calendarDays = useMemo(() => {
    const days = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }
    
    return days;
  }, [daysInMonth, firstDay]);

  const today = new Date();
  const isToday = (day: number | null) => {
    if (!day) return false;
    return day === today.getDate() &&
           currentDate.getMonth() === today.getMonth() &&
           currentDate.getFullYear() === today.getFullYear();
  };

  return (
    <div className="space-y-4">
      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={goToPreviousMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Calendar Grid */}
      <Card>
        <CardContent className="p-4">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {dayNames.map(day => (
              <div key={day} className="p-2 text-center text-sm font-medium text-muted-foreground">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, index) => {
              if (!day) {
                return <div key={index} className="p-2 h-20" />;
              }

              const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
              const dayExperiences = getExperiencesForDate(date);

              return (
                <div
                  key={day}
                  className={cn(
                    "p-2 h-20 border rounded-md cursor-pointer hover:bg-muted/50 transition-colors",
                    isToday(day) && "bg-primary/10 border-primary",
                    dayExperiences.length > 0 && "bg-accent/20"
                  )}
                >
                  <div className="text-sm font-medium mb-1">{day}</div>
                  {dayExperiences.slice(0, 2).map((exp, idx) => (
                    <div
                      key={exp.id}
                      className="text-xs bg-primary/80 text-primary-foreground rounded px-1 py-0.5 mb-0.5 truncate"
                      title={exp.title}
                    >
                      {exp.title}
                    </div>
                  ))}
                  {dayExperiences.length > 2 && (
                    <div className="text-xs text-muted-foreground">
                      +{dayExperiences.length - 2} more
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

        {/* Upcoming Experiences */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Upcoming This Month</h3>
          {acceptedExperiences.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">No accepted experiences yet.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Swipe right on experiences and accept them to see them here.
              </p>
            </Card>
          ) : (
            acceptedExperiences
              .filter(exp => {
                const expDate = new Date(exp.date);
                return expDate.getMonth() === currentDate.getMonth() &&
                       expDate.getFullYear() === currentDate.getFullYear() &&
                       expDate >= today;
              })
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
              .map(exp => (
                <Card key={exp.id} className="p-4">
                  <div className="flex items-center gap-4">
                    <img 
                      src={exp.image} 
                      alt={exp.title}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                    <div className="flex-1 space-y-1">
                      <h4 className="font-medium">{exp.title}</h4>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {exp.date.toLocaleDateString()}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {exp.time}
                        </div>
                        <div className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          {exp.location}
                        </div>
                      </div>
                      {exp.collaborators && exp.collaborators.length > 0 && (
                        <div className="flex items-center gap-1 text-sm">
                          <span className="text-muted-foreground">With:</span>
                          <span className="text-primary">{exp.collaborators.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))
          )}
        </div>
    </div>
  );
};