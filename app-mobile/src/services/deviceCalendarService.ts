import * as Calendar from 'expo-calendar';
import { Platform, Alert } from 'react-native';
import { googleLevelToTierSlug, tierLabel, tierRangeLabel } from '../constants/priceTiers';

export interface DeviceCalendarEvent {
  title: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
  location?: string;
  url?: string;
  timeZone?: string;
  alarms?: Array<{
    relativeOffset: number; // minutes before event
    method: Calendar.AlarmMethod;
  }>;
}

export class DeviceCalendarService {
  /**
   * Request calendar permissions
   */
  static async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Error requesting calendar permissions:', error);
      return false;
    }
  }

  /**
   * Check if calendar permissions are granted
   */
  static async hasPermissions(): Promise<boolean> {
    try {
      const { status } = await Calendar.getCalendarPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Error checking calendar permissions:', error);
      return false;
    }
  }

  /**
   * Get the default calendar ID for the device
   */
  static async getDefaultCalendarId(): Promise<string | null> {
    try {
      const calendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes.EVENT
      );
      
      // Prefer the default calendar or first writable calendar
      const defaultCalendar = calendars.find(
        (cal) => cal.allowsModifications && (cal.isPrimary || cal.source.name === 'Default')
      );
      
      if (defaultCalendar) {
        return defaultCalendar.id;
      }

      // Fallback to first writable calendar
      const writableCalendar = calendars.find(
        (cal) => cal.allowsModifications
      );
      
      return writableCalendar?.id || null;
    } catch (error) {
      console.error('Error getting default calendar:', error);
      return null;
    }
  }

  /**
   * Add an event to the device calendar
   */
  static async addEventToDeviceCalendar(
    event: DeviceCalendarEvent
  ): Promise<string | null> {
    try {
      // Check permissions
      const hasPermissions = await this.hasPermissions();
      if (!hasPermissions) {
        const granted = await this.requestPermissions();
        if (!granted) {
          Alert.alert(
            'Calendar Permission Required',
            'Please enable calendar permissions in your device settings to add events to your calendar.'
          );
          return null;
        }
      }

      // Get default calendar ID
      const calendarId = await this.getDefaultCalendarId();
      if (!calendarId) {
        Alert.alert(
          'No Calendar Available',
          'No writable calendar found on your device. Please set up a calendar app.'
        );
        return null;
      }

      // Create the event
      const eventId = await Calendar.createEventAsync(calendarId, {
        title: event.title,
        startDate: event.startDate,
        endDate: event.endDate,
        notes: event.notes,
        location: event.location,
        url: event.url,
        timeZone: event.timeZone || undefined,
        alarms: event.alarms || [
          {
            relativeOffset: -15, // 15 minutes before
            method: Calendar.AlarmMethod.ALERT,
          },
        ],
      });

      return eventId;
    } catch (error: any) {
      console.error('Error adding event to device calendar:', error);
      Alert.alert(
        'Failed to Add to Calendar',
        error.message || 'Could not add event to your device calendar. Please try again.'
      );
      return null;
    }
  }

  /**
   * Update an existing phone calendar event by its ID.
   * Uses expo-calendar's Calendar.updateEventAsync.
   */
  static async updateEventOnDeviceCalendar(
    eventId: string,
    updates: {
      title?: string;
      startDate?: Date;
      endDate?: Date;
      location?: string;
      notes?: string;
    }
  ): Promise<void> {
    try {
      const { status } = await Calendar.getCalendarPermissionsAsync();
      if (status !== 'granted') return;
      await Calendar.updateEventAsync(eventId, updates);
    } catch (err) {
      console.warn('[DeviceCalendar] Failed to update event:', err);
      throw err;
    }
  }

  /**
   * Create a device calendar event from a saved card
   */
  static createEventFromCard(
    card: any,
    scheduledAt: Date,
    durationMinutes: number = 120 // Default 2 hours
  ): DeviceCalendarEvent {
    const endDate = new Date(scheduledAt);
    endDate.setMinutes(endDate.getMinutes() + durationMinutes);

    // Build notes with card details
    const notesParts: string[] = [];
    if (card.description) {
      notesParts.push(card.description);
    }
    if (card.fullDescription && card.fullDescription !== card.description) {
      notesParts.push(`\n${card.fullDescription}`);
    }
    if (card.highlights && card.highlights.length > 0) {
      notesParts.push(`\n\nHighlights:\n${card.highlights.join('\n• ')}`);
    }
    if (card.priceTier || card.priceLevel != null) {
      const tier = card.priceTier ?? googleLevelToTierSlug(card.priceLevel);
      notesParts.push(`\n\nPrice: ${tierLabel(tier)} (${tierRangeLabel(tier)})`);
    } else if (card.priceRange && card.priceRange !== 'TBD') {
      notesParts.push(`\n\nPrice: ${card.priceRange}`);
    }
    if (card.rating) {
      notesParts.push(`\n\nRating: ${card.rating}/5 (${card.reviewCount || 0} reviews)`);
    }

    return {
      title: card.title || 'Scheduled Experience',
      startDate: scheduledAt,
      endDate: endDate,
      notes: notesParts.join('\n') || undefined,
      location: card.address || undefined,
      url: card.website || undefined,
      alarms: [
        {
          relativeOffset: -15, // 15 minutes before
          method: Calendar.AlarmMethod.ALERT,
        },
        {
          relativeOffset: -60, // 1 hour before
          method: Calendar.AlarmMethod.ALERT,
        },
      ],
    };
  }

  /**
   * Create a device calendar event from a curated multi-stop plan
   */
  static createEventFromCuratedCard(
    card: any,
    startDate: Date,
    totalDurationMinutes: number
  ): DeviceCalendarEvent {
    const stops = card.stops || [];
    const stopNames = stops.map((s: any) => s.placeName).join(' → ');
    const stopDetails = stops
      .map((s: any, i: number) => {
        const priceLine = s.priceTier
          ? `\nPrice: ${tierLabel(s.priceTier)} (${tierRangeLabel(s.priceTier)})`
          : '';
        return `Stop ${i + 1}: ${s.placeName}\nAddress: ${s.address}\nRating: ${s.rating}⭐${priceLine}`;
      })
      .join('\n\n');

    return {
      title: `Mingla Plan: ${stopNames}`,
      startDate,
      endDate: new Date(startDate.getTime() + totalDurationMinutes * 60000),
      notes: [
        card.tagline || '',
        '',
        `Total estimated time: ${totalDurationMinutes} minutes`,
        `Estimated cost: $${card.totalPriceMin ?? 0}–$${card.totalPriceMax ?? 0}`,
        '',
        '--- Stops ---',
        stopDetails,
      ].join('\n'),
      location: stops[0]?.address || '',
      alarms: [
        {
          relativeOffset: -30,
          method: Calendar.AlarmMethod.ALERT,
        },
      ],
    };
  }

  /**
   * Remove an event from the device calendar by ID
   */
  static async removeEventFromDeviceCalendar(
    eventId: string
  ): Promise<boolean> {
    try {
      // Check permissions
      const hasPermissions = await this.hasPermissions();
      if (!hasPermissions) {
        console.warn("Calendar permissions not granted, cannot remove event");
        return false;
      }

      // Delete the event
      await Calendar.deleteEventAsync(eventId);
      return true;
    } catch (error: any) {
      console.error("Error removing event from device calendar:", error);
      // Don't throw - this is a best-effort operation
      return false;
    }
  }

  /**
   * Find and remove a calendar event by matching title and date
   * This is a fallback when we don't have the event ID stored
   */
  static async removeEventByTitleAndDate(
    title: string,
    startDate: Date
  ): Promise<boolean> {
    try {
      // Check permissions
      const hasPermissions = await this.hasPermissions();
      if (!hasPermissions) {
        console.warn("Calendar permissions not granted, cannot remove event");
        return false;
      }

      // Get default calendar ID
      const calendarId = await this.getDefaultCalendarId();
      if (!calendarId) {
        return false;
      }

      // Get events for the date range (same day)
      const startOfDay = new Date(startDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startDate);
      endOfDay.setHours(23, 59, 59, 999);

      const events = await Calendar.getEventsAsync(
        [calendarId],
        startOfDay,
        endOfDay
      );

      // Find matching event by title
      const matchingEvent = events.find(
        (event) => event.title === title
      );

      if (matchingEvent) {
        await Calendar.deleteEventAsync(matchingEvent.id);
        return true;
      }

      return false;
    } catch (error: any) {
      console.error("Error removing event by title and date:", error);
      return false;
    }
  }

  /**
   * Get all calendars on the device (including synced Google Calendar, iCloud, etc.)
   */
  static async getCalendars(): Promise<Calendar.Calendar[]> {
    try {
      const hasPermissions = await this.hasPermissions();
      if (!hasPermissions) {
        const granted = await this.requestPermissions();
        if (!granted) {
          return [];
        }
      }

      const calendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes.EVENT
      );
      return calendars;
    } catch (error) {
      console.error('Error getting calendars:', error);
      return [];
    }
  }

  /**
   * Find the Google Calendar "Holidays" calendar if it exists
   */
  static async getHolidayCalendarId(): Promise<string | null> {
    try {
      const calendars = await this.getCalendars();
      
      // Look for holiday calendar (Google Calendar syncs holidays automatically)
      const holidayCalendar = calendars.find(
        (cal) => 
          cal.title?.toLowerCase().includes('holiday') ||
          cal.title?.toLowerCase().includes('holidays') ||
          cal.source?.name?.toLowerCase().includes('holiday')
      );
      
      return holidayCalendar?.id || null;
    } catch (error) {
      console.error('Error getting holiday calendar:', error);
      return null;
    }
  }

  /**
   * Fetch upcoming events from the device calendar (including synced Google Calendar)
   * This will include holidays if the user has the Google "Holidays" calendar enabled
   */
  static async getUpcomingEvents(
    daysAhead: number = 365,
    calendarIds?: string[]
  ): Promise<Calendar.Event[]> {
    try {
      const hasPermissions = await this.hasPermissions();
      if (!hasPermissions) {
        const granted = await this.requestPermissions();
        if (!granted) {
          return [];
        }
      }

      // If no specific calendars provided, get all calendars
      let calendars: string[] = calendarIds || [];
      if (calendars.length === 0) {
        const allCalendars = await this.getCalendars();
        calendars = allCalendars.map(cal => cal.id);
      }

      if (calendars.length === 0) {
        return [];
      }

      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + daysAhead);

      const events = await Calendar.getEventsAsync(
        calendars,
        startDate,
        endDate
      );

      return events;
    } catch (error) {
      console.error('Error getting upcoming events:', error);
      return [];
    }
  }

  /**
   * Fetch holidays specifically from the device calendar
   * Uses the Holidays calendar if available, otherwise returns empty array
   */
  static async getHolidaysFromCalendar(
    daysAhead: number = 365
  ): Promise<Array<{
    id: string;
    name: string;
    date: Date;
    description: string;
    isAllDay: boolean;
  }>> {
    try {
      const holidayCalendarId = await this.getHolidayCalendarId();
      
      if (!holidayCalendarId) {
        console.log('No holiday calendar found on device');
        return [];
      }

      const events = await this.getUpcomingEvents(daysAhead, [holidayCalendarId]);
      
      return events.map(event => ({
        id: event.id,
        name: event.title,
        date: new Date(event.startDate),
        description: event.notes || '',
        isAllDay: event.allDay || false,
      }));
    } catch (error) {
      console.error('Error getting holidays from calendar:', error);
      return [];
    }
  }
}
