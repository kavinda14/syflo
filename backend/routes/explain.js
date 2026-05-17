/**
 * explain.js
 *
 * Provides a simple word/phrase explanation endpoint used by the floating popup.
 * When the user right-clicks a word in any AI response, the frontend calls this
 * route to get a short, plain-language definition and example sentence.
 * Like messages.js, it uses the local Ollama server via the OpenAI-compatible API.
 */

const express = require('express');
const { getLLMClient } = require('../llm');

module.exports = (db) => {
  // router is created inside the factory so each call gets a fresh instance.
  // If defined at module level, multiple createApp() calls (e.g. in tests)
  // would stack handlers on the same router, causing the first handler's
  // closure to handle all requests regardless of the current mock.
  const router = express.Router();

  // POST /api/explain
  // Accepts a word and optional surrounding context, returns a short explanation.
  router.post('/', async (req, res) => {
    const { word, context } = req.body;
    if (!word) return res.status(400).json({ error: 'word is required' });

    try {
      const { client, model } = getLLMClient(db);
      // Ask the model for a short, plain-text definition only — no example
      // sentence, no markdown formatting. The popup renders the response as
      // plain text, so any ** or # tokens would show up literally.
      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a concise dictionary. Give only a brief plain-prose definition (1-2 sentences) of the given word or phrase. Do not include example sentences. Do not use any markdown formatting: no asterisks, no bold, no italics, no headings, no bullet lists, no quotation marks around the word itself. Return plain text only.',
          },
          {
            role: 'user',
            content: context
              ? `Define "${word}" as used in: "${context}"`
              : `Define "${word}"`,
          },
        ],
      });

      // Return just the explanation text — the frontend handles displaying it.
      res.json({ explanation: completion.choices[0].message.content });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
