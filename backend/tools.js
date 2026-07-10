/**
 * tools.js
 *
 * LLM-Tools, die das Modell während eines Chat-Completion-Calls aufrufen
 * kann. Aktuell: `web_search` via lokalem SearXNG.
 *
 * Streaming-Tool-Use-Flow (OpenAI-kompatibel, funktioniert auch mit Ollama
 * Llama 3.1+):
 *
 *   1. Wir schicken die `tools`-Definition beim ersten Completion-Call mit
 *   2. Das LLM streamt entweder Text (normaler Fall) oder tool_call-Fragmente
 *   3. Bei finish_reason === 'tool_calls': wir mergen die Fragmente, führen
 *      jede Tool-Funktion aus, hängen die Ergebnisse an die History und
 *      starten einen neuen Stream-Call
 *   4. Loop bis finish_reason === 'stop'
 */

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888';

// Tool-Definition im OpenAI-Function-Calling-Format. Auch Ollama-Llama-3.1+
// versteht dieses Schema (via OpenAI-kompatiblem Endpoint).
const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the public web for up-to-date information. Use this when the user asks about ' +
      'current events, recent developments, specific facts you are uncertain about, or anything ' +
      'after your training cutoff. Do NOT use for general knowledge, math, code reasoning, ' +
      'or questions you can already answer confidently.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query, in the language and phrasing most likely to return relevant results (usually English).',
        },
      },
      required: ['query'],
    },
  },
};

const ALL_TOOLS = [WEB_SEARCH_TOOL];

// Map tool name → implementation. Each impl receives the parsed args object
// and must return a string (which is what gets fed back to the LLM).
const TOOL_IMPLS = {
  web_search: async ({ query }) => {
    if (!query || typeof query !== 'string') {
      return JSON.stringify({ error: 'Missing required "query" argument' });
    }
    const url = new URL('/search', SEARXNG_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('safesearch', '0');
    try {
      const r = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) {
        return JSON.stringify({ error: `Search backend responded HTTP ${r.status}` });
      }
      const data = await r.json();
      // Top 6 results, trimmed to what's useful for an LLM. We want enough
      // diversity for synthesis but not so much that it blows the context window.
      const results = (data.results || []).slice(0, 6).map(r => ({
        title: r.title,
        url: r.url,
        snippet: (r.content || '').slice(0, 400),
      }));
      return JSON.stringify({ query, results });
    } catch (err) {
      const msg = err?.cause?.code === 'ECONNREFUSED'
        ? `Could not reach the search backend at ${SEARXNG_URL}. The SearXNG container may not be running.`
        : err.message || 'Search failed';
      return JSON.stringify({ error: msg });
    }
  },
};

/**
 * Streaming-Chunks von OpenAI haben tool_calls als Fragmente, die per
 * `index` zusammengesetzt werden müssen. `accumulator` ist ein Map(index → {
 *   id, name, arguments (string, JSON-encoded) }).
 */
function mergeToolCallDeltas(accumulator, deltas) {
  for (const delta of deltas) {
    const idx = delta.index;
    if (!accumulator.has(idx)) {
      accumulator.set(idx, { id: '', name: '', arguments: '' });
    }
    const entry = accumulator.get(idx);
    if (delta.id) entry.id = delta.id;
    if (delta.function?.name) entry.name = delta.function.name;
    if (delta.function?.arguments) entry.arguments += delta.function.arguments;
  }
}

/**
 * Runs the streamed completion-with-tools loop. Calls `onText(delta)` for
 * every text chunk and `onToolEvent({ phase, ...meta })` so the caller can
 * forward both to the frontend (text streaming + "Searching the web…" UX).
 *
 * `phase` is 'call' (tool about to run, with args) or 'result' (tool finished,
 * with structured payload — currently the search results array so the UI can
 * cite sources).
 *
 * Returns the final assistant text once finish_reason becomes 'stop'.
 */
async function streamWithTools({ client, model, messages, onText, onToolEvent }) {
  // Defensive: keep messages in a local array we can append to across rounds.
  const convo = [...messages];
  // Most realistic queries should resolve in 1-2 tool calls. Bail at 5 to
  // guarantee we never get stuck in an infinite tool-calling loop if the
  // model goes haywire.
  const MAX_ROUNDS = 5;

  let finalText = '';
  // Once we discover the model can't handle tools at all, stay in plain-stream
  // mode for the rest of the loop. Vision-tuned Ollama models throw on the
  // create() call itself with "does not support tools" — handled below.
  // OpenAI's search-preview models already have built-in web search; passing
  // our `tools` definition alongside causes API errors. Detect them by name
  // and skip our tool wiring from the start.
  let toolsDisabled = /search-preview/i.test(model);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let stream;
    try {
      stream = await client.chat.completions.create({
        model,
        messages: convo,
        ...(toolsDisabled ? {} : { tools: ALL_TOOLS }),
        stream: true,
      });
    } catch (err) {
      // Ollama returns "<model> does not support tools" for vision/embedding/
      // tool-incompatible models. Retry once without the `tools` field so the
      // user still gets an answer — they just lose web-search for this model.
      if (!toolsDisabled && /does not support tools/i.test(err?.message || '')) {
        toolsDisabled = true;
        stream = await client.chat.completions.create({ model, messages: convo, stream: true });
      } else {
        throw err;
      }
    }

    let roundText = '';
    const toolCalls = new Map();
    let finishReason = null;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) {
        roundText += delta.content;
        onText(delta.content);
      }
      if (delta.tool_calls) {
        mergeToolCallDeltas(toolCalls, delta.tool_calls);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    // Plain answer — we're done.
    if (finishReason !== 'tool_calls' || toolCalls.size === 0) {
      finalText = roundText;
      break;
    }

    // Tool calls requested. Persist the assistant message that contained them
    // (text + tool_calls go together in the same assistant message).
    const assistantToolCalls = [...toolCalls.values()].map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments || '{}' },
    }));
    convo.push({
      role: 'assistant',
      content: roundText || null,
      tool_calls: assistantToolCalls,
    });

    // Execute every requested tool and append a `tool` message per call. The
    // model needs a `tool` message for every `tool_call` it produced — missing
    // one would make the next request fail.
    for (const tc of assistantToolCalls) {
      const impl = TOOL_IMPLS[tc.function.name];
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch (_) { /* invalid JSON → empty args */ }

      onToolEvent({ phase: 'call', name: tc.function.name, args: parsedArgs });

      let result;
      if (!impl) {
        result = JSON.stringify({ error: `Unknown tool: ${tc.function.name}` });
      } else {
        result = await impl(parsedArgs);
      }

      // Surface a structured event so the frontend can display sources.
      let parsedResult = null;
      try { parsedResult = JSON.parse(result); } catch (_) { /* tool returned non-JSON; keep raw */ }
      onToolEvent({ phase: 'result', name: tc.function.name, result: parsedResult });

      convo.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return finalText;
}

module.exports = { ALL_TOOLS, streamWithTools };
