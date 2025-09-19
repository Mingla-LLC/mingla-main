import React from 'react';
import { MapPin, Clock, DollarSign, CloudRain } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/utils/currency';

interface PlanBCardProps {
  trip: {
    id: string;
    title: string;
    image: string;
    cost: number;
    duration: string;
    location: string;
    category: string;
    badges: string[];
  };
  onSelect: () => void;
  currency: string;
}

export const PlanBCard = ({ trip, onSelect, currency }: PlanBCardProps) => {
  return (
    <Card className="p-4 bg-muted/50 border-dashed">
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
          <img 
            src={trip.image} 
            alt={trip.title}
            className="w-full h-full object-cover"
          />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-2">
            <h4 className="font-medium text-sm truncate pr-2">{trip.title}</h4>
            <CloudRain className="h-4 w-4 text-blue-500 flex-shrink-0" />
          </div>
          
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <span>{formatCurrency(trip.cost, currency)}</span>
            <span>•</span>
            <Clock className="h-3 w-3" />
            <span>{trip.duration}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{trip.location}</span>
            </div>
            <Button size="sm" variant="outline" onClick={onSelect}>
              Switch
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};