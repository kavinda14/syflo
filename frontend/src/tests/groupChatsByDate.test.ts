import { describe, it, expect } from 'vitest';
import { groupChatsByDate } from '../components/Sidebar/groupChatsByDate';
import type { Chat } from '../types';

// Mittwoch, 2026-07-22, 12:00 lokale Zeit — Wochenstart (Montag) ist der 20.
const NOW = new Date(2026, 6, 22, 12, 0, 0);

function chat(id: string, createdAt: Date | string): Chat {
  return {
    id,
    title: `Chat ${id}`,
    parent_id: null,
    parent_word: null,
    created_at: typeof createdAt === 'string' ? createdAt : createdAt.toISOString(),
  };
}

describe('groupChatsByDate', () => {
  it('returns an empty array for no chats', () => {
    expect(groupChatsByDate([], NOW)).toEqual([]);
  });

  it('sorts chats into the right buckets', () => {
    const groups = groupChatsByDate(
      [
        chat('today', new Date(2026, 6, 22, 9, 0)),
        chat('yesterday', new Date(2026, 6, 21, 23, 59)),
        chat('this-week', new Date(2026, 6, 20, 8, 0)),
        chat('last-week', new Date(2026, 6, 15, 8, 0)),
        chat('this-month', new Date(2026, 6, 3, 8, 0)),
        chat('older', new Date(2026, 4, 30, 8, 0)),
      ],
      NOW
    );
    expect(groups.map(g => g.label)).toEqual([
      'Today',
      'Yesterday',
      'This week',
      'Last week',
      'This month',
      'Older',
    ]);
    expect(groups.map(g => g.chats.map(c => c.id))).toEqual([
      ['today'],
      ['yesterday'],
      ['this-week'],
      ['last-week'],
      ['this-month'],
      ['older'],
    ]);
  });

  it('omits empty groups', () => {
    const groups = groupChatsByDate(
      [chat('a', new Date(2026, 6, 22, 9, 0)), chat('b', new Date(2026, 4, 1))],
      NOW
    );
    expect(groups.map(g => g.label)).toEqual(['Today', 'Older']);
  });

  it('keeps the incoming order inside a group', () => {
    const groups = groupChatsByDate(
      [chat('newer', new Date(2026, 6, 22, 11, 0)), chat('older', new Date(2026, 6, 22, 8, 0))],
      NOW
    );
    expect(groups[0].chats.map(c => c.id)).toEqual(['newer', 'older']);
  });

  it('treats the week as starting on Monday', () => {
    // Sonntag, 19.07. liegt vor Montag, 20.07. → "Last week", nicht "This week".
    const groups = groupChatsByDate([chat('sunday', new Date(2026, 6, 19, 20, 0))], NOW);
    expect(groups[0].label).toBe('Last week');
  });

  it('puts a month-old chat from the current month into "This month"', () => {
    // 1. Juli liegt im aktuellen Monat, aber vor der letzten Woche.
    const groups = groupChatsByDate([chat('early-july', new Date(2026, 6, 1, 10, 0))], NOW);
    expect(groups[0].label).toBe('This month');
  });

  it('puts unparseable dates into "Older"', () => {
    const groups = groupChatsByDate([chat('broken', 'not-a-date')], NOW);
    expect(groups[0].label).toBe('Older');
  });
});
