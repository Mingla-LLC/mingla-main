/**
 * Message grouping utility for compact chat display.
 * Pure function — no dependencies on React or services.
 */

export interface MessageForGrouping {
  id: string;
  senderId: string;
  timestamp: string;
}

export interface GroupedMessage<T extends MessageForGrouping = MessageForGrouping> {
  message: T;
  groupPosition: 'solo' | 'first' | 'middle' | 'last';
  showTimestamp: boolean;
}

const TWO_MINUTES_MS = 2 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Takes a sorted messages array (chronological order, oldest first)
 * and returns grouped messages with metadata for rendering.
 *
 * Grouping rules:
 * - Same sender AND within 2 minutes of previous message → same group
 * - Different sender OR >2 minute gap → new group
 *
 * Group position:
 * - 'solo': only message in its group
 * - 'first': first message in a group of 2+
 * - 'middle': middle message(s) in a group of 3+
 * - 'last': last message in a group of 2+
 *
 * Timestamp display:
 * - Always true for the very first message
 * - True when gap between this message and the previous one is >5 minutes
 */
export function groupMessages<T extends MessageForGrouping>(messages: T[]): GroupedMessage<T>[] {
  if (messages.length === 0) return [];

  const result: GroupedMessage<T>[] = [];

  // First pass: identify group boundaries
  const groupStarts: number[] = [0]; // Index 0 always starts a group

  for (let i = 1; i < messages.length; i++) {
    const curr = messages[i];
    const prev = messages[i - 1];
    const timeDiff = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
    const sameSender = curr.senderId === prev.senderId;
    const withinTwoMin = timeDiff < TWO_MINUTES_MS;

    if (!sameSender || !withinTwoMin) {
      groupStarts.push(i);
    }
  }

  // Second pass: assign positions and timestamps
  for (let g = 0; g < groupStarts.length; g++) {
    const start = groupStarts[g];
    const end = (g + 1 < groupStarts.length) ? groupStarts[g + 1] : messages.length;
    const groupSize = end - start;

    for (let i = start; i < end; i++) {
      const positionInGroup = i - start;
      let groupPosition: 'solo' | 'first' | 'middle' | 'last';

      if (groupSize === 1) {
        groupPosition = 'solo';
      } else if (positionInGroup === 0) {
        groupPosition = 'first';
      } else if (positionInGroup === groupSize - 1) {
        groupPosition = 'last';
      } else {
        groupPosition = 'middle';
      }

      // Timestamp: show if first message OR gap > 5 minutes from previous message
      let showTimestamp = false;
      if (i === 0) {
        showTimestamp = true;
      } else {
        const timeDiff = new Date(messages[i].timestamp).getTime() - new Date(messages[i - 1].timestamp).getTime();
        if (timeDiff > FIVE_MINUTES_MS) {
          showTimestamp = true;
        }
      }

      result.push({
        message: messages[i],
        groupPosition,
        showTimestamp,
      });
    }
  }

  return result;
}
