// Calendar utility functions for creating calendar events on different platforms

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
  // Get the suggested date or create a default one
  const startDate = entry.suggestedDates?.[0] 
    ? new Date(entry.suggestedDates[0])
    : new Date();

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

  // Add date/time preferences if available
  if (entry.dateTimePreferences) {
    descriptionParts.push(
      '',
      'Your Preferences:',
      `• Preferred Time: ${entry.dateTimePreferences.timeOfDay}`,
      `• Preferred Day: ${entry.dateTimePreferences.dayOfWeek}`,
      `• Planning Window: ${entry.dateTimePreferences.planningTimeframe}`
    );
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