import React, { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Calendar, Clock, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AcceptedExperience {
  id: string;
  title: string;
  image: string;
  date: Date;
  time: string;
  location: string;
  collaborators?: string[];
}

interface CalendarViewProps {
  experiences: AcceptedExperience[];
}

export const CalendarView = ({ experiences }: CalendarViewProps) => {
  const [currentDate, setCurrentDate] = useState(new Date());

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
    return experiences.filter(exp => {
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
        {experiences
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
          ))}
      </div>
    </div>
  );
};