/**
 * Date and Time Utilities for Mingla
 * Handles date validation, archiving logic, and time comparisons
 */

/**
 * Check if a given date/time has elapsed (is in the past)
 */
export function hasDateElapsed(scheduledDate: string, scheduledTime?: string): boolean {
  if (!scheduledDate) return false;
  
  const now = new Date();
  const scheduled = new Date(scheduledDate);
  
  // If we have a specific time, factor it in
  if (scheduledTime) {
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    scheduled.setHours(hours, minutes, 0, 0);
  }
  
  return scheduled < now;
}

/**
 * Check if cards should be auto-archived
 * Returns an array of cards that should be moved to archive
 */
export function getCardsToArchive(entries: any[]): any[] {
  return entries.filter(entry => {
    // Don't archive if already archived
    if (entry.isArchived) return false;
    
    // Check if date has elapsed
    if (entry.dateTimePreferences?.scheduledDate) {
      return hasDateElapsed(
        entry.dateTimePreferences.scheduledDate,
        entry.dateTimePreferences.scheduledTime
      );
    }
    
    // Check if suggestedDates has elapsed
    if (entry.suggestedDates && entry.suggestedDates.length > 0) {
      const firstDate = entry.suggestedDates[0];
      return hasDateElapsed(firstDate);
    }
    
    return false;
  });
}

/**
 * Calculate time remaining until a date
 */
export function getTimeUntilDate(scheduledDate: string, scheduledTime?: string): {
  isPast: boolean;
  days: number;
  hours: number;
  minutes: number;
  humanReadable: string;
} {
  const now = new Date();
  const scheduled = new Date(scheduledDate);
  
  if (scheduledTime) {
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    scheduled.setHours(hours, minutes, 0, 0);
  }
  
  const diff = scheduled.getTime() - now.getTime();
  const isPast = diff < 0;
  
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((absDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60));
  
  let humanReadable = '';
  if (isPast) {
    if (days > 0) {
      humanReadable = `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
      humanReadable = `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      humanReadable = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }
  } else {
    if (days > 0) {
      humanReadable = `in ${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      humanReadable = `in ${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      humanReadable = `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
  }
  
  return {
    isPast,
    days,
    hours,
    minutes,
    humanReadable
  };
}

/**
 * Validate that a proposed date/time is not in the past
 */
export function validateFutureDateTime(dateStr: string, timeStr?: string): {
  isValid: boolean;
  message?: string;
} {
  const now = new Date();
  const proposed = new Date(dateStr);
  
  if (timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    proposed.setHours(hours, minutes, 0, 0);
  }
  
  if (proposed <= now) {
    return {
      isValid: false,
      message: 'Cannot propose a date and time in the past. Please select a future date and time.'
    };
  }
  
  return { isValid: true };
}

/**
 * Get the minimum datetime for input fields (current moment)
 */
export function getMinDateTime(): { minDate: string; minTime?: string } {
  const now = new Date();
  const minDate = now.toISOString().split('T')[0];
  
  return { minDate };
}

/**
 * Check if a time is in the past for today's date
 */
export function isTimePastForToday(timeStr: string): boolean {
  const now = new Date();
  const [hours, minutes] = timeStr.split(':').map(Number);
  const proposed = new Date();
  proposed.setHours(hours, minutes, 0, 0);
  
  return proposed <= now;
}
