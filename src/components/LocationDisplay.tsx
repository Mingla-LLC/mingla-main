import React from 'react';
import { Badge } from '@/components/ui/badge';
import { MapPin, Loader2 } from 'lucide-react';
import { useGeolocation } from '@/hooks/useGeolocation';

export const LocationDisplay: React.FC = () => {
  const { loading, error, formatLocation } = useGeolocation({
    autoStart: true,
    timeout: 15000,
    maximumAge: 600000 // 10 minutes
  });

  if (loading) {
    return (
      <Badge variant="outline" className="mt-1 text-xs">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        Detecting location...
      </Badge>
    );
  }

  if (error) {
    return (
      <Badge variant="outline" className="mt-1 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 mr-1" />
        Location unavailable
      </Badge>
    );
  }

  const location = formatLocation();
  
  if (!location) {
    return (
      <Badge variant="outline" className="mt-1 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 mr-1" />
        Location not found
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="mt-1 text-xs">
      <MapPin className="h-3 w-3 mr-1" />
      {location}
    </Badge>
  );
};