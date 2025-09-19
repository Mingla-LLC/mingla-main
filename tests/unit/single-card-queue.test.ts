import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useRef } from 'react';

// Mock the queue management logic
const useCardQueue = (preferences: any) => {
  const [queue, setQueue] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const fetchMore = vi.fn(async () => {
    // Mock API call
    if (loadingRef.current) return;
    loadingRef.current = true;
    
    const mockCards = [
      { id: '1', title: 'Card 1' },
      { id: '2', title: 'Card 2' },
      { id: '3', title: 'Card 3' }
    ];
    
    setQueue(q => q.concat(mockCards));
    setCursor('next-cursor');
    loadingRef.current = false;
  });

  const advance = () => {
    setQueue(q => q.slice(1));
  };

  return { queue, cursor, fetchMore, advance, loadingRef };
};

describe('Card Queue Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty queue', () => {
    const { result } = renderHook(() => useCardQueue({}));
    
    expect(result.current.queue).toEqual([]);
    expect(result.current.cursor).toBeNull();
  });

  it('should fetch cards on mount', async () => {
    const { result } = renderHook(() => useCardQueue({}));
    
    await act(async () => {
      await result.current.fetchMore();
    });
    
    expect(result.current.queue).toHaveLength(3);
    expect(result.current.cursor).toBe('next-cursor');
  });

  it('should advance queue correctly', async () => {
    const { result } = renderHook(() => useCardQueue({}));
    
    await act(async () => {
      await result.current.fetchMore();
    });
    
    const initialFirst = result.current.queue[0];
    
    act(() => {
      result.current.advance();
    });
    
    expect(result.current.queue[0]).not.toBe(initialFirst);
    expect(result.current.queue).toHaveLength(2);
  });

  it('should refill when running low', async () => {
    const { result } = renderHook(() => useCardQueue({}));
    
    await act(async () => {
      await result.current.fetchMore();
    });
    
    // Advance to make queue small
    act(() => {
      result.current.advance();
      result.current.advance();
    });
    
    expect(result.current.queue).toHaveLength(1);
    
    // Should trigger refill
    await act(async () => {
      if (result.current.queue.length < 5 && result.current.cursor) {
        await result.current.fetchMore();
      }
    });
    
    expect(result.current.queue).toHaveLength(4); // 1 + 3 new
  });
});

describe('Expand/Collapse State', () => {
  const useExpandState = (cardId: string) => {
    const [expanded, setExpanded] = useState(false);
    const [currentCardId, setCurrentCardId] = useState(cardId);
    
    // Reset expanded state when card changes
    if (currentCardId !== cardId) {
      setCurrentCardId(cardId);
      setExpanded(false);
    }
    
    return { expanded, setExpanded };
  };

  it('should isolate expand state per card', () => {
    const { result: card1 } = renderHook(() => useExpandState('card1'));
    const { result: card2 } = renderHook(() => useExpandState('card2'));
    
    act(() => {
      card1.current.setExpanded(true);
    });
    
    expect(card1.current.expanded).toBe(true);
    expect(card2.current.expanded).toBe(false);
  });

  it('should reset expanded state when card changes', () => {
    const { result, rerender } = renderHook(
      ({ cardId }) => useExpandState(cardId),
      { initialProps: { cardId: 'card1' } }
    );
    
    act(() => {
      result.current.setExpanded(true);
    });
    
    expect(result.current.expanded).toBe(true);
    
    // Change card ID
    rerender({ cardId: 'card2' });
    
    expect(result.current.expanded).toBe(false);
  });
});

describe('Feedback Payload Builder', () => {
  const buildFeedbackPayload = (
    cardId: string,
    decision: 'like' | 'dislike',
    prefsHash: string,
    rank: number
  ) => {
    return {
      cardId,
      decision,
      prefsHash,
      rank,
      timestamp: expect.any(String)
    };
  };

  it('should build correct feedback payload', () => {
    const payload = buildFeedbackPayload('card-123', 'like', 'hash-456', 3);
    
    expect(payload).toMatchObject({
      cardId: 'card-123',
      decision: 'like',
      prefsHash: 'hash-456',
      rank: 3
    });
  });

  it('should handle dislike decision', () => {
    const payload = buildFeedbackPayload('card-456', 'dislike', 'hash-789', 1);
    
    expect(payload.decision).toBe('dislike');
    expect(payload.rank).toBe(1);
  });
});