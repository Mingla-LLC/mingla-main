// Calendar utility functions for creating calendar events on different platforms

// Helper function to create a Date from dateTimePreferences
const createDateFromPreferences = (preferences?: any): Date => {
  const now = new Date();
  const resultDate = new Date(now);
  
  // Default to 1 week from now at 2pm
  resultDate.setDate(now.getDate() + 7);
  resultDate.setHours(14, 0, 0, 0);
  
  if (!preferences) {
    return resultDate;
  }
  
  // Parse timeframe
  const timeframe = preferences.planningTimeframe?.toLowerCase() || '';
  if (timeframe.includes('this week')) {
    resultDate.setDate(now.getDate() + 3);
  } else if (timeframe.includes('this month')) {
    resultDate.setDate(now.getDate() + 7);
  } else if (timeframe.includes('next month')) {
    resultDate.setMonth(now.getMonth() + 1);
    resultDate.setDate(15);
  } else if (timeframe.includes('3 months')) {
    resultDate.setMonth(now.getMonth() + 2);
  }
  
  // Parse day of week
  const dayPref = preferences.dayOfWeek?.toLowerCase() || '';
  if (dayPref.includes('weekend')) {
    // Set to next Saturday
    const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7;
    resultDate.setDate(now.getDate() + daysUntilSaturday);
  } else if (dayPref.includes('weekday')) {
    // Set to next Monday if currently weekend
    if (now.getDay() === 0 || now.getDay() === 6) {
      const daysUntilMonday = now.getDay() === 0 ? 1 : 2;
      resultDate.setDate(now.getDate() + daysUntilMonday);
    }
  }
  
  // Parse time of day
  const timePref = preferences.timeOfDay?.toLowerCase() || '';
  if (timePref.includes('early morning')) {
    resultDate.setHours(7, 30, 0, 0);
  } else if (timePref.includes('morning')) {
    resultDate.setHours(10, 0, 0, 0);
  } else if (timePref.includes('afternoon')) {
    resultDate.setHours(14, 0, 0, 0);
  } else if (timePref.includes('evening')) {
    resultDate.setHours(18, 0, 0, 0);
  } else if (timePref.includes('night')) {
    resultDate.setHours(20, 0, 0, 0);
  }
  
  return resultDate;
};

export interface CalendarEvent {
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  url?: string;
}

// Format date for calendar URLs (YYYYMMDDTHHMMSSZ format)
const formatDateForCalendar = (date: Date): string => {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

// Create Google Calendar URL
export const createGoogleCalendarUrl = (event: CalendarEvent): string => {
  const startDate = formatDateForCalendar(event.startDate);
  const endDate = formatDateForCalendar(event.endDate);
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${startDate}/${endDate}`,
    details: event.description || '',
    location: event.location || '',
    ...(event.url && { url: event.url })
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

// Create Outlook Calendar URL
export const createOutlookCalendarUrl = (event: CalendarEvent): string => {
  const startDate = event.startDate.toISOString();
  const endDate = event.endDate.toISOString();
  
  const params = new URLSearchParams({
    subject: event.title,
    startdt: startDate,
    enddt: endDate,
    body: event.description || '',
    location: event.location || '',
    ...(event.url && { url: event.url })
  });

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
};

// Create Apple Calendar (.ics) file content
export const createIcsContent = (event: CalendarEvent): string => {
  const startDate = formatDateForCalendar(event.startDate);
  const endDate = formatDateForCalendar(event.endDate);
  const timestamp = formatDateForCalendar(new Date());
  const uid = `${timestamp}@mingla.app`;

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mingla//Calendar Event//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${timestamp}`,
    `DTSTART:${startDate}`,
    `DTEND:${endDate}`,
    `SUMMARY:${event.title}`,
    ...(event.description ? [`DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`] : []),
    ...(event.location ? [`LOCATION:${event.location}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  return icsContent;
};

// Download ICS file
export const downloadIcsFile = (event: CalendarEvent, filename?: string): void => {
  const icsContent = createIcsContent(event);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `${event.title.replace(/[^a-z0-9]/gi, '_')}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Detect platform and provide appropriate calendar action
export const addToCalendar = (event: CalendarEvent): void => {
  const userAgent = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(userAgent);
  const isAndroid = /android/.test(userAgent);
  const isMac = /macintosh|mac os x/.test(userAgent);
  const isWindows = /windows/.test(userAgent);

  if (isIOS || isMac) {
    // For iOS and Mac, download ICS file which will open in native calendar
    downloadIcsFile(event);
  } else if (isAndroid) {
    // For Android, try Google Calendar first, fallback to ICS
    try {
      const googleUrl = createGoogleCalendarUrl(event);
      window.open(googleUrl, '_blank');
    } catch (error) {
      downloadIcsFile(event);
    }
  } else if (isWindows) {
    // For Windows, try Outlook, fallback to Google Calendar
    try {
      const outlookUrl = createOutlookCalendarUrl(event);
      window.open(outlookUrl, '_blank');
    } catch (error) {
      const googleUrl = createGoogleCalendarUrl(event);
      window.open(googleUrl, '_blank');
    }
  } else {
    // Default to Google Calendar for other platforms
    const googleUrl = createGoogleCalendarUrl(event);
    window.open(googleUrl, '_blank');
  }
};

// Create calendar event from activity entry
export const createCalendarEventFromEntry = (entry: any): CalendarEvent => {
  // Get the scheduled date if it exists, otherwise use suggested dates or preferences
  let startDate: Date;
  
  if (entry.dateTimePreferences?.scheduledDate) {
    // Use the actual scheduled date/time
    startDate = new Date(entry.dateTimePreferences.scheduledDate);
    
    // If there's a specific scheduled time, ensure it's set
    if (entry.dateTimePreferences.scheduledTime && !isNaN(startDate.getTime())) {
      const [hours, minutes] = entry.dateTimePreferences.scheduledTime.split(':').map(Number);
      if (!isNaN(hours) && !isNaN(minutes)) {
        startDate.setHours(hours, minutes, 0, 0);
      }
    }
  } else if (entry.suggestedDates?.[0]) {
    // Check if it's already a valid date string
    const suggestedDate = entry.suggestedDates[0];
    const parsedDate = typeof suggestedDate === 'string' && suggestedDate.date 
      ? new Date(suggestedDate.date) 
      : typeof suggestedDate === 'object' && suggestedDate.date
      ? new Date(suggestedDate.date)
      : new Date(suggestedDate);
    
    // Validate the date
    if (!isNaN(parsedDate.getTime())) {
      startDate = parsedDate;
    } else {
      // If parsing fails, create a date based on preferences
      startDate = createDateFromPreferences(entry.dateTimePreferences);
    }
  } else {
    // No suggested dates, create from preferences
    startDate = createDateFromPreferences(entry.dateTimePreferences);
  }

  // Create end date based on purchase option duration or default 2 hours
  const endDate = new Date(startDate);
  if (entry.purchaseOption?.duration) {
    // Parse duration (e.g., "2 hours", "3.5 hours", "1 day")
    const durationMatch = entry.purchaseOption.duration.match(/(\d+(?:\.\d+)?)\s*(hour|day)/i);
    if (durationMatch) {
      const value = parseFloat(durationMatch[1]);
      const unit = durationMatch[2].toLowerCase();
      if (unit === 'hour') {
        endDate.setHours(endDate.getHours() + value);
      } else if (unit === 'day') {
        endDate.setDate(endDate.getDate() + value);
      }
    } else {
      endDate.setHours(endDate.getHours() + 2); // Default fallback
    }
  } else {
    endDate.setHours(endDate.getHours() + 2);
  }

  // Enhanced title for purchased experiences
  let title = entry.experience?.title || 'Mingla Experience';
  if (entry.purchaseOption) {
    title = `${title} - ${entry.purchaseOption.title}`;
  }

  // Enhanced description with purchase and preference details
  const descriptionParts = [
    entry.experience?.fullDescription || entry.experience?.description || '',
    ''
  ];

  // Add purchase details if this is a purchased experience
  if (entry.purchaseOption) {
    descriptionParts.push(
      '🛍️ PURCHASED EXPERIENCE',
      '',
      `Purchase Details:`,
      `• Option: ${entry.purchaseOption.title}`,
      `• Price: ${entry.purchaseOption.price} ${entry.purchaseOption.currency || 'USD'}`,
      `• Includes: ${entry.purchaseOption.includes?.join(', ') || 'See details'}`,
      ...(entry.purchaseOption.duration ? [`• Duration: ${entry.purchaseOption.duration}`] : []),
      ...(entry.purchaseOption.purchasedAt ? [`• Purchased: ${new Date(entry.purchaseOption.purchasedAt).toLocaleDateString()}`] : []),
      ''
    );
  }

  // Add experience details
  descriptionParts.push(
    `Category: ${entry.experience?.category || 'Experience'}`,
    `Price Range: ${entry.experience?.priceRange || 'TBD'}`,
    `Rating: ${entry.experience?.rating || 'N/A'} stars`,
    `Travel Time: ${entry.experience?.travelTime || 'TBD'}`,
    `Distance: ${entry.experience?.distance || 'TBD'}`
  );

  // Add highlights
  if (entry.experience?.highlights) {
    descriptionParts.push(
      '',
      'Highlights:',
      ...entry.experience.highlights.map((h: string) => `• ${h}`)
    );
  }

  // Add date/time information
  if (entry.dateTimePreferences) {
    if (entry.dateTimePreferences.scheduledDate) {
      // Show actual scheduled date/time
      const scheduledDate = new Date(entry.dateTimePreferences.scheduledDate);
      descriptionParts.push(
        '',
        '📅 Scheduled For:',
        `• ${scheduledDate.toLocaleString('en-US', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        })}`
      );
    } else {
      // Show general preferences
      descriptionParts.push(
        '',
        'Your Preferences:',
        `• Preferred Time: ${entry.dateTimePreferences.timeOfDay}`,
        `• Preferred Day: ${entry.dateTimePreferences.dayOfWeek}`,
        `• Planning Window: ${entry.dateTimePreferences.planningTimeframe}`
      );
    }
  }

  // Add session information
  if (entry.sessionName && entry.sessionName !== 'Solo Session') {
    descriptionParts.push(
      '',
      `Collaboration Session: ${entry.sessionName}`
    );
  } else {
    descriptionParts.push(
      '',
      'Solo Experience'
    );
  }

  descriptionParts.push(
    '',
    'Organized via Mingla App',
    '',
    `Contact: ${entry.experience?.phoneNumber || 'See website'}`,
    `Hours: ${entry.experience?.openingHours || 'See website'}`
  );

  const event: CalendarEvent = {
    title,
    description: descriptionParts.join('\n'),
    location: entry.experience?.address || 'Location TBD',
    startDate,
    endDate,
    url: entry.experience?.website
  };

  return event;
};