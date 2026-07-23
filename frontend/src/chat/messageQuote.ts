/**
 * chat/messageQuote.ts
 *
 * Parsing for the "Ask in chat" quote convention: the composer prepends the
 * quoted selection as markdown blockquote lines ("> …") above the typed
 * question. MessageBubble strips those markers and renders the quote as a
 * styled block (design/mockup-chat-highlights-ask-in-chat.html, section 02).
 */

// Splits a user message into its leading quote (consecutive "> "-prefixed
// lines) and the actual question. Returns quote: null when the message
// doesn't start with a quote.
export function splitLeadingQuote(content: string): { quote: string | null; rest: string } {
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith('> ')) i++;
  if (i === 0) return { quote: null, rest: content };
  const quote = lines.slice(0, i).map((l) => l.slice(2)).join('\n');
  let j = i;
  while (j < lines.length && lines[j].trim() === '') j++;
  return { quote, rest: lines.slice(j).join('\n') };
}
