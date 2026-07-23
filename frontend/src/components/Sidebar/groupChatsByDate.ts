/**
 * components/Sidebar/groupChatsByDate.ts
 *
 * Gruppiert die Root-Chats der Sidebar in relative Datums-Abschnitte
 * ("Today", "Yesterday", …) auf Basis von created_at. Die Liste kommt vom
 * Backend bereits absteigend sortiert — die Reihenfolge innerhalb der
 * Gruppen bleibt erhalten, leere Gruppen werden weggelassen.
 *
 * Wochen beginnen am Montag. Alle Grenzen werden über den Date-Konstruktor
 * berechnet (nicht über feste 24h-Offsets), damit Sommerzeit-Wechsel die
 * Tagesgrenzen nicht verschieben.
 */

import type { Chat } from '../../types';

const GROUP_LABELS = ['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Older'] as const;

export type ChatGroupLabel = (typeof GROUP_LABELS)[number];

export interface ChatGroup {
  label: ChatGroupLabel;
  chats: Chat[];
}

export function groupChatsByDate(chats: Chat[], now: Date = new Date()): ChatGroup[] {
  const startOfDay = (offsetDays: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetDays).getTime();

  const startOfToday = startOfDay(0);
  const startOfYesterday = startOfDay(1);
  // getDay(): 0 = Sonntag → auf 0 = Montag umrechnen.
  const weekday = (now.getDay() + 6) % 7;
  const startOfWeek = startOfDay(weekday);
  const startOfLastWeek = startOfDay(weekday + 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const labelFor = (iso: string): ChatGroupLabel => {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 'Older';
    if (t >= startOfToday) return 'Today';
    if (t >= startOfYesterday) return 'Yesterday';
    if (t >= startOfWeek) return 'This week';
    if (t >= startOfLastWeek) return 'Last week';
    if (t >= startOfMonth) return 'This month';
    return 'Older';
  };

  const buckets = new Map<ChatGroupLabel, Chat[]>();
  for (const chat of chats) {
    const label = labelFor(chat.created_at);
    const bucket = buckets.get(label);
    if (bucket) {
      bucket.push(chat);
    } else {
      buckets.set(label, [chat]);
    }
  }

  return GROUP_LABELS.filter(label => buckets.has(label)).map(label => ({
    label,
    chats: buckets.get(label)!,
  }));
}
