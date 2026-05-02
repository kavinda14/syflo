/**
 * messages.js
 *
 * Handles sending user messages and streaming AI responses for a given chat.
 * Uses Ollama's OpenAI-compatible API so we can reuse the OpenAI SDK without
 * any additional packages — just by pointing the base URL to the local Ollama server.
 * Responses are streamed back to the client using Server-Sent Events (SSE) so the
 * frontend can display text word-by-word as it arrives instead of waiting for the
 * full response.
 */

const express = require('express');
const OpenAI = require('openai');

module.exports = (db) => {
  const router = express.Router({ mergeParams: true });

  // Point the OpenAI SDK to the local Ollama server instead of OpenAI's API.
  // Ollama exposes an OpenAI-compatible endpoint at port 11434, so no API key is needed.
  const openai = new OpenAI({
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama',
  });

  // POST /api/chats/:chatId/messages
  // Accepts a user message, saves it, streams the AI reply, then saves the reply.
  router.post('/', async (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });

    // Load the chat to check if it exists and whether it has a parent chat.
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // Persist the user's message to the database before calling the AI.
    const userMsgId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userMsgId, req.params.chatId, 'user', content, now);

    // Build the message array that will be sent to the AI model.
    // If this chat was branched from a parent, include the parent conversation as context
    // so the AI understands where the conversation came from.
    const contextMessages = [];
    if (chat.parent_id) {
      const parentMessages = db.prepare(
        'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC'
      ).all(chat.parent_id);
      contextMessages.push({
        role: 'system',
        content: `You are a friendly and helpful assistant. Emoji usage rule: place ONE relevant emoji at the start of each markdown heading (#, ##, ###) or bolded section title to act as a visual anchor for that section. Do NOT use emojis inside regular sentences, paragraphs, or list items — keep prose plain so it reads cleanly. When explaining concepts, always use analogies and real-world comparisons to make things easy to understand — e.g. "think of it like..." or "it's similar to...". The user is exploring the term "${chat.parent_word}" from a previous conversation. Context:\n\n${parentMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`,
      });
    } else {
      contextMessages.push({ role: 'system', content: 'You are a friendly and helpful assistant. Emoji usage rule: place ONE relevant emoji at the start of each markdown heading (#, ##, ###) or bolded section title to act as a visual anchor for that section. Do NOT use emojis inside regular sentences, paragraphs, or list items — keep prose plain so it reads cleanly. When explaining concepts, always use analogies and real-world comparisons to make things easy to understand — e.g. "think of it like..." or "it\'s similar to...".' });
    }

    // Append the full message history of this chat so the AI has conversation memory.
    const history = db.prepare(
      'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC'
    ).all(req.params.chatId);
    history.forEach(m => contextMessages.push({ role: m.role, content: m.content }));

    // Set Server-Sent Events headers so the browser can consume chunks as they arrive.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      // Call Ollama with streaming enabled. Each chunk contains a small piece of text.
      const stream = await openai.chat.completions.create({
        model: 'phi4',
        messages: contextMessages,
        stream: true,
      });

      // Forward each text delta to the client as a JSON SSE event.
      let fullContent = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullContent += delta;
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }

      // Once streaming is complete, save the full assistant reply to the database.
      const assistantMsgId = crypto.randomUUID();
      const assistantNow = new Date().toISOString();
      db.prepare(
        'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(assistantMsgId, req.params.chatId, 'assistant', fullContent, assistantNow);

      // After the very first exchange (2 messages), update the chat title to something
      // meaningful. Try AI-generated title first; fall back to the first few words of
      // the user's message so "New Chat" is always replaced.
      const msgCount = db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE chat_id = ?'
      ).get(req.params.chatId);

      if (chat.title === 'New Chat' || msgCount.count <= 2) {
        const words = content.trim().split(/\s+/);
        let newTitle = words.slice(0, 5).join(' ');
        if (words.length > 5) newTitle += '…';

        try {
          const titleCompletion = await openai.chat.completions.create({
            model: 'phi4',
            messages: [
              { role: 'system', content: 'Generate a short 3-5 word title for this chat. Return only the title, no punctuation.' },
              { role: 'user', content },
            ],
          });
          newTitle = titleCompletion.choices[0].message.content.trim();
        } catch (_) { /* AI title failed — word-based fallback will be used */ }

        db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(newTitle, req.params.chatId);
      }

      // Send a final SSE event containing both saved message objects so the
      // frontend can replace its temporary optimistic messages with the real ones.
      const userMessage = { id: userMsgId, chat_id: req.params.chatId, role: 'user', content, created_at: now };
      const assistantMessage = { id: assistantMsgId, chat_id: req.params.chatId, role: 'assistant', content: fullContent, created_at: assistantNow };

      res.write(`data: ${JSON.stringify({ done: true, userMessage, assistantMessage })}\n\n`);
      res.end();
    } catch (err) {
      // Send the error through the stream so the frontend can surface it.
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  });

  return router;
};
