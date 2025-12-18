import * as Calendar from 'expo-calendar';
import { Platform, Alert } from 'react-native';

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
    if (card.priceRange && card.priceRange !== 'TBD') {
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
}

