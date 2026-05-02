/**
 * components/ChatArea/MessageBubble.tsx
 *
 * Renders a single message in the conversation.
 *
 * User messages: right-aligned subtle bubble.
 * Assistant messages: left-aligned plain text on the white chat background.
 *
 * Branch words: words used to create child chats are rendered as blue
 * underlined hyperlinks inside assistant messages. Clicking navigates
 * to that child chat.
 */

import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThinkingIndicator } from './ThinkingIndicator';
import type { Message } from '../../types';

// ReactMarkdown's defaultUrlTransform strips URLs with unknown schemes (anything
// besides http, https, mailto, tel) for safety. Our internal "branch:<chatId>"
// links would be wiped out, so we let those through and defer to the default
// behaviour for everything else.
const urlTransform = (url: string) =>
  url.startsWith('branch:') ? url : defaultUrlTransform(url);

interface BranchWord {
  word: string;
  chatId: string;
}

interface Props {
  message: Message;
  isStreaming?: boolean;
  onWordRightClick: (word: string, context: string, x: number, y: number) => void;
  branchWords?: BranchWord[];
  onBranchClick?: (chatId: string) => void;
}

// Escape special regex characters in a string.
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-process markdown content: replace branch words with markdown link syntax
// so ReactMarkdown can render them as clickable links.
// e.g. "quantum mechanics" becomes "[quantum](branch:chat-id)"
function insertBranchLinks(content: string, branchWords: BranchWord[]): string {
  let result = content;
  for (const { word, chatId } of branchWords) {
    const regex = new RegExp(`\\b(${escapeRegex(word)})\\b`, 'gi');
    result = result.replace(regex, `[$1](branch:${chatId})`);
  }
  return result;
}

export function MessageBubble({ message, isStreaming, onWordRightClick, branchWords, onBranchClick }: Props) {
  const isUser = message.role === 'user';

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isUser) return;
    e.preventDefault();
    const selection = window.getSelection()?.toString().trim();
    const word = selection || getWordAtPoint(e);
    if (word) {
      onWordRightClick(word, message.content, e.clientX, e.clientY);
    }
  };

  // User messages: gray bubble, right-aligned.
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="bg-gray-100 text-gray-900 select-text"
          style={{
            maxWidth: '42rem',
            borderRadius: '2rem',
            padding: '0.75rem 1.125rem',
            lineHeight: 1.65,
            fontSize: '15px',
          }}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // Pre-process content to embed branch word links if any are provided.
  const processedContent = branchWords && branchWords.length > 0 && message.content
    ? insertBranchLinks(message.content, branchWords)
    : message.content;

  // Assistant messages: left-aligned on the white chat background.
  return (
    <div className="flex items-start">
      <div
        onContextMenu={handleContextMenu}
        className="max-w-none py-1 text-sm leading-relaxed select-text cursor-text prose prose-sm"
        style={{ maxWidth: '46rem' }}
      >
        {processedContent ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={urlTransform}
            components={{
              // Branch links: rendered as blue underlined buttons (not real <a> tags).
              a({ href, children }) {
                if (href?.startsWith('branch:') && onBranchClick) {
                  const chatId = href.replace('branch:', '');
                  return (
                    <button
                      onClick={() => onBranchClick(chatId)}
                      className="text-blue-600 underline underline-offset-2 hover:text-blue-800 font-medium cursor-pointer"
                    >
                      {children}
                    </button>
                  );
                }
                return <a href={href}>{String(children)}</a>;
              },
              code({ className, children, ...props }: any) {
                const isBlock = className?.includes('language-');
                if (isBlock) {
                  return (
                    <pre className="bg-gray-950 text-gray-100 rounded-xl p-4 overflow-x-auto text-xs my-3">
                      <code {...props}>{children}</code>
                    </pre>
                  );
                }
                return (
                  <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                    {children}
                  </code>
                );
              },
              p({ children }) {
                return <p className="mb-3 last:mb-0">{children}</p>;
              },
              ul({ children }) {
                return (
                  <ul className="list-disc list-outside pl-6 mb-3 space-y-1 marker:text-gray-400 [&_ul]:list-[circle] [&_ul_ul]:list-[square]">
                    {children}
                  </ul>
                );
              },
              ol({ children }) {
                return (
                  <ol className="list-decimal list-outside pl-6 mb-3 space-y-1 marker:text-gray-400 [&_ol]:list-[lower-alpha] [&_ol_ol]:list-[lower-roman]">
                    {children}
                  </ol>
                );
              },
              li({ children }) {
                return (
                  <li className="pl-1 leading-relaxed [&>ul]:mt-1 [&>ul]:mb-0 [&>ol]:mt-1 [&>ol]:mb-0">
                    {children}
                  </li>
                );
              },
              h1({ children }) { return <h1 className="text-lg font-bold mb-2 mt-4">{children}</h1>; },
              h2({ children }) { return <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>; },
              h3({ children }) { return <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>; },
              blockquote({ children }) {
                return <blockquote className="border-l-4 border-gray-200 pl-4 text-gray-500 my-2">{children}</blockquote>;
              },
            }}
          >
            {processedContent}
          </ReactMarkdown>
        ) : null}

        {isStreaming && !processedContent && <ThinkingIndicator />}

        {isStreaming && processedContent && (
          <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse rounded-sm ml-0.5" />
        )}
      </div>
    </div>
  );
}

function getWordAtPoint(e: React.MouseEvent): string {
  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (!range) return '';
  const el = range.startContainer;
  const text = el.textContent || '';
  const offset = range.startOffset;
  const words = text.split(/\s+/);
  let pos = 0;
  for (const word of words) {
    pos += word.length + 1;
    if (pos > offset) return word.replace(/[^a-zA-Z0-9äöüÄÖÜß-]/g, '');
  }
  return '';
}
