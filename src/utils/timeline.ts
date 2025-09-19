interface Location {
  lat: number;
  lng: number;
  name?: string;
}

interface TimelineStep {
  time: string;
  activity: string;
  location: Location;
  icon: string;
  duration: string; // Changed to string to match MapTimeline interface
}

export function calculateMeetupPoint(userLocation: Location, destination: Location): Location {
  // Calculate midpoint between user and destination
  const midLat = (userLocation.lat + destination.lat) / 2;
  const midLng = (userLocation.lng + destination.lng) / 2;
  
  return {
    lat: midLat,
    lng: midLng,
    name: "Suggested meetup point"
  };
}

export function calculateDistance(loc1: Location, loc2: Location): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
  const dLng = (loc2.lng - loc1.lng) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) * 
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export function generateRealTimeline(
  userLocation: Location, 
  destination: Location,
  tripDuration: string,
  category: string
): TimelineStep[] {
  const meetupPoint = calculateMeetupPoint(userLocation, destination);
  const distanceToMeetup = calculateDistance(userLocation, meetupPoint);
  const distanceToDestination = calculateDistance(meetupPoint, destination);
  
  // Calculate travel times (assuming 25 mph average speed for city travel)
  const travelTimeToMeetup = Math.ceil(distanceToMeetup / 25 * 60); // minutes
  const travelTimeToDestination = Math.ceil(distanceToDestination / 25 * 60); // minutes
  
  // Parse trip duration
  const durationMatch = tripDuration.match(/(\d+)/);
  const activityDuration = durationMatch ? parseInt(durationMatch[1]) * 60 : 120; // default 2 hours
  
  const now = new Date();
  const steps: TimelineStep[] = [];
  let currentTime = new Date(now.getTime() + 30 * 60000); // Start 30 minutes from now
  
  // Step 1: Meet up
  if (distanceToMeetup > 0.5) { // Only add meetup if it's more than 0.5 miles away
  steps.push({
    time: currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    activity: `Meet at ${meetupPoint.name || 'meetup point'}`,
    location: meetupPoint,
    icon: '🤝',
    duration: '10 min'
  });
    currentTime = new Date(currentTime.getTime() + 10 * 60000);
  }
  
  // Step 2: Travel to destination
  if (travelTimeToDestination > 5) {
    currentTime = new Date(currentTime.getTime() + travelTimeToDestination * 60000);
    steps.push({
      time: currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      activity: `Arrive at destination`,
      location: destination,
      icon: '📍',
      duration: '5 min'
    });
    currentTime = new Date(currentTime.getTime() + 5 * 60000);
  }
  
  // Step 3: Main activity
  const activityIcons = {
    dining: '🍽️',
    food: '🍽️',
    culture: '🎨',
    outdoor: '🌳',
    entertainment: '🎭',
    shopping: '🛍️',
    sports: '⚽',
    default: '✨'
  };
  
  const categoryLower = category.toLowerCase();
  const activityIcon = Object.entries(activityIcons).find(([key]) => 
    categoryLower.includes(key)
  )?.[1] || activityIcons.default;
  
  steps.push({
    time: currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    activity: `Enjoy ${category.toLowerCase()}`,
    location: destination,
    icon: activityIcon,
    duration: `${Math.round(activityDuration / 60)}h ${activityDuration % 60}m`
  });
  
  // Step 4: Optional wrap-up activity
  currentTime = new Date(currentTime.getTime() + activityDuration * 60000);
  if (categoryLower.includes('dining') || categoryLower.includes('food')) {
    steps.push({
      time: currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      activity: 'Coffee & conversation',
      location: { ...destination, name: `Near ${destination.name}` },
      icon: '☕',
      duration: '30 min'
    });
  } else if (categoryLower.includes('culture') || categoryLower.includes('art')) {
    steps.push({
      time: currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      activity: 'Discuss & reflect',
      location: { ...destination, name: `Near ${destination.name}` },
      icon: '💭',
      duration: '20 min'
    });
  } else {
    steps.push({
      time: currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      activity: 'Wrap up & photos',
      location: destination,
      icon: '📸',
      duration: '15 min'
    });
  }
  
  return steps;
}