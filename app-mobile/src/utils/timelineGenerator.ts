/**
 * Timeline Generator - Category-specific timeline logic
 * Generates timeline steps based on experience category
 */

import { TimelineData, TimelineStep } from '../types/expandedCardTypes';

interface TimelineGeneratorOptions {
  category: string;
  title: string;
  address?: string;
  priceRange?: string;
  travelTime?: string;
  duration?: string;
}

export function generateTimeline(
  options: TimelineGeneratorOptions
): TimelineData {
  const { category, title, address, priceRange, travelTime, duration } =
    options;

  switch (category) {
    case 'Take a Stroll':
      return generateStrollTimeline(title, address, priceRange, travelTime);
    case 'Sip & Chill':
      return generateSipChillTimeline(title, priceRange, travelTime);
    case 'Casual Eats':
      return generateCasualEatsTimeline(title, priceRange, travelTime);
    case 'Screen & Relax':
      return generateScreenRelaxTimeline(title, priceRange, travelTime);
    case 'Creative & Hands-On':
      return generateCreativeTimeline(title, priceRange, travelTime);
    case 'Picnics':
      return generatePicnicTimeline(title, address, priceRange, travelTime);
    case 'Play & Move':
      return generatePlayMoveTimeline(title, priceRange, travelTime);
    case 'Dining Experiences':
      return generateDiningTimeline(title, priceRange, travelTime);
    case 'Wellness Dates':
      return generateWellnessTimeline(title, priceRange, travelTime);
    case 'Freestyle':
      return generateFreestyleTimeline(title, priceRange, travelTime);
    default:
      return generateDefaultTimeline(title, priceRange, travelTime);
  }
}

function generateStrollTimeline(
  title: string,
  address: string | undefined,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Start: Café or Snack Stop',
      description: 'Begin your stroll with a coffee, pastry, or light snack',
      duration: '15-20 min',
      icon: 'cafe',
      location: address || 'Starting point',
    },
    {
      id: '2',
      title: 'Walk: Scenic Route',
      description: 'Enjoy a leisurely walk through the neighborhood, park, or waterfront',
      duration: '~30 min',
      icon: 'walk',
    },
    {
      id: '3',
      title: 'Optional Pause: Viewpoint or Rest Spot',
      description: 'Take a moment to enjoy the view or rest at a scenic spot',
      duration: '10-15 min',
      icon: 'eye',
    },
    {
      id: '4',
      title: 'Wrap-Up: Return or Nearby Café',
      description: 'Head back to your starting point or discover a new spot nearby',
      duration: '15-20 min',
      icon: 'location',
    },
  ];

  return {
    category: 'Take a Stroll',
    totalDuration: '1.5-2 hours',
    costPerPerson: priceRange || '$10-25',
    steps,
  };
}

function generateSipChillTimeline(
  title: string,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Arrive',
      description: `Arrive at ${title} and find your spot`,
      duration: travelTime || '5-10 min',
      icon: 'location',
    },
    {
      id: '2',
      title: 'Sip',
      description: 'Order your drinks and settle in',
      duration: '20-30 min',
      icon: 'cafe',
    },
    {
      id: '3',
      title: 'Chill',
      description: 'Relax, chat, and enjoy the ambience',
      duration: '45-60 min',
      icon: 'happy',
    },
    {
      id: '4',
      title: 'Wrap-Up',
      description: 'Finish up and head out',
      duration: '10 min',
      icon: 'checkmark-circle',
    },
  ];

  return {
    category: 'Sip & Chill',
    totalDuration: '~1.5 hours',
    costPerPerson: priceRange || '$15-40',
    steps,
  };
}

function generateCasualEatsTimeline(
  title: string,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Arrive',
      description: `Arrive at ${title}`,
      duration: travelTime || '5-10 min',
      icon: 'location',
    },
    {
      id: '2',
      title: 'Eat',
      description: 'Order and enjoy your meal',
      duration: '30-45 min',
      icon: 'restaurant',
    },
    {
      id: '3',
      title: 'Finish',
      description: 'Wrap up and head out',
      duration: '10 min',
      icon: 'checkmark-circle',
    },
  ];

  return {
    category: 'Casual Eats',
    totalDuration: '45-60 minutes',
    costPerPerson: priceRange || '$15-35',
    steps,
  };
}

function generateScreenRelaxTimeline(
  title: string,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Arrive',
      description: `Arrive at ${title} and get settled`,
      duration: travelTime || '10-15 min',
      icon: 'location',
    },
    {
      id: '2',
      title: 'Enjoy the Show',
      description: 'Watch the movie, show, or performance',
      duration: '1.5-2 hours',
      icon: 'film',
    },
    {
      id: '3',
      title: 'Wrap-Up',
      description: 'Head out after the show',
      duration: '10 min',
      icon: 'checkmark-circle',
    },
  ];

  return {
    category: 'Screen & Relax',
    totalDuration: '~2 hours',
    costPerPerson: priceRange || '$12-25',
    steps,
  };
}

function generateCreativeTimeline(
  title: string,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Arrive',
      description: `Arrive at ${title} and get set up`,
      duration: travelTime || '10-15 min',
      icon: 'location',
    },
    {
      id: '2',
      title: 'Create',
      description: 'Work on your project with provided materials',
      duration: '1-1.5 hours',
      icon: 'brush',
    },
    {
      id: '3',
      title: 'Optional Add-On',
      description: 'Add finishing touches or take photos',
      duration: '15-20 min',
      icon: 'camera',
    },
    {
      id: '4',
      title: 'Finish',
      description: 'Wrap up and take your creation home',
      duration: '10 min',
      icon: 'checkmark-circle',
    },
  ];

  return {
    category: 'Creative & Hands-On',
    totalDuration: '1.5-2 hours',
    costPerPerson: priceRange || '$25-60',
    steps,
  };
}

function generatePicnicTimeline(
  title: string,
  address: string | undefined,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Start: Grocery Stop',
      description: 'Pick up picnic supplies and food',
      duration: '15-20 min',
      icon: 'storefront',
      location: 'Grocery store or market',
    },
    {
      id: '2',
      title: 'Travel: Route to Picnic Spot',
      description: 'Head to your chosen picnic location',
      duration: travelTime || '10-15 min',
      icon: 'car',
    },
    {
      id: '3',
      title: 'Picnic: Main Experience',
      description: 'Set up and enjoy your picnic',
      duration: '1-1.5 hours',
      icon: 'leaf',
      location: address || 'Picnic spot',
    },
    {
      id: '4',
      title: 'Optional Add-On: Activity Suggestion',
      description: 'Play games, take a walk, or enjoy the scenery',
      duration: '30-45 min',
      icon: 'game-controller',
    },
    {
      id: '5',
      title: 'End: Park or Scenic Overlook',
      description: 'Clean up and enjoy final views before leaving',
      duration: '15 min',
      icon: 'eye',
    },
  ];

  return {
    category: 'Picnics',
    totalDuration: '1.5-3 hours',
    costPerPerson: priceRange || '$15-30',
    steps,
  };
}

function generatePlayMoveTimeline(
  title: string,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Arrive',
      description: `Arrive at ${title} and get ready`,
      duration: travelTime || '10-15 min',
      icon: 'location',
    },
    {
      id: '2',
      title: 'Play',
      description: 'Enjoy the main activity',
      duration: '1-1.5 hours',
      icon: 'basketball',
    },
    {
      id: '3',
      title: 'Rest or Celebrate',
      description: 'Take a break or celebrate your game',
      duration: '15-20 min',
      icon: 'trophy',
    },
    {
      id: '4',
      title: 'Wrap-Up',
      description: 'Head out after your activity',
      duration: '10 min',
      icon: 'checkmark-circle',
    },
  ];

  return {
    category: 'Play & Move',
    totalDuration: '1-2.5 hours',
    costPerPerson: priceRange || '$20-50',
    steps,
  };
}

function generateDiningTimeline(
  title: string,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Arrive',
      description: `Arrive at ${title} and be seated`,
      duration: travelTime || '10-15 min',
      icon: 'location',
    },
    {
      id: '2',
      title: 'Dine',
      description: 'Enjoy your multi-course meal',
      duration: '1.5-2 hours',
      icon: 'restaurant',
    },
    {
      id: '3',
      title: 'Optional Moment',
      description: 'Dessert, coffee, or after-dinner drinks',
      duration: '20-30 min',
      icon: 'wine',
    },
    {
      id: '4',
      title: 'Finish',
      description: 'Complete your dining experience',
      duration: '10 min',
      icon: 'checkmark-circle',
    },
  ];

  return {
    category: 'Dining Experiences',
    totalDuration: '1.5-3 hours',
    costPerPerson: priceRange || '$50-150',
    steps,
  };
}

function generateWellnessTimeline(
  title: string,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Arrive',
      description: `Arrive at ${title} and check in`,
      duration: travelTime || '10-15 min',
      icon: 'location',
    },
    {
      id: '2',
      title: 'Experience',
      description: 'Enjoy your wellness treatment or class',
      duration: '1-1.5 hours',
      icon: 'leaf',
    },
    {
      id: '3',
      title: 'Optional Add-On',
      description: 'Relaxation time or additional services',
      duration: '15-20 min',
      icon: 'sparkles',
    },
    {
      id: '4',
      title: 'Finish',
      description: 'Complete your wellness experience',
      duration: '10 min',
      icon: 'checkmark-circle',
    },
  ];

  return {
    category: 'Wellness Dates',
    totalDuration: '1-2 hours',
    costPerPerson: priceRange || '$40-100',
    steps,
  };
}

function generateFreestyleTimeline(
  title: string,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Arrive',
      description: `Arrive at ${title}`,
      duration: travelTime || '10-15 min',
      icon: 'location',
    },
    {
      id: '2',
      title: 'Explore',
      description: 'Discover and experience the venue or event',
      duration: '1-2 hours',
      icon: 'compass',
    },
    {
      id: '3',
      title: 'Optional Add-On',
      description: 'Extend your visit or try something extra',
      duration: '30-45 min',
      icon: 'add-circle',
    },
    {
      id: '4',
      title: 'Wrap-Up',
      description: 'Conclude your freestyle experience',
      duration: '15 min',
      icon: 'checkmark-circle',
    },
  ];

  return {
    category: 'Freestyle',
    totalDuration: '2-4 hours',
    costPerPerson: priceRange || '$20-80',
    steps,
  };
}

function generateDefaultTimeline(
  title: string,
  priceRange: string | undefined,
  travelTime: string | undefined
): TimelineData {
  const steps: TimelineStep[] = [
    {
      id: '1',
      title: 'Arrive',
      description: `Arrive at ${title}`,
      duration: travelTime || '10-15 min',
      icon: 'location',
    },
    {
      id: '2',
      title: 'Experience',
      description: 'Enjoy your experience',
      duration: '1-2 hours',
      icon: 'star',
    },
    {
      id: '3',
      title: 'Wrap-Up',
      description: 'Complete your visit',
      duration: '10 min',
      icon: 'checkmark-circle',
    },
  ];

  return {
    category: 'General',
    totalDuration: '1.5-2.5 hours',
    costPerPerson: priceRange || '$20-50',
    steps,
  };
}

