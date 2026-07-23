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

// Port 8890 statt SearXNGs üblichem 8888 — 8888 ist auf Entwickler-Macs oft
// von Jupyter belegt (genau daran ist die Suche hier still gestorben).
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8890';

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
function isAbortError(err) {
  return err?.name === 'AbortError' || err?.name === 'APIUserAbortError' || /abort/i.test(err?.message || '');
}

async function streamWithTools({ client, model, messages, onText, onToolEvent, onThinking, onReasoning, onPerf, extras = {}, signal }) {
  // Defensive: keep messages in a local array we can append to across rounds.
  const convo = [...messages];
  // Most realistic queries should resolve in 1-2 tool calls. Bail at 5 to
  // guarantee we never get stuck in an infinite tool-calling loop if the
  // model goes haywire.
  const MAX_ROUNDS = 5;

  // Latenz-Messung über alle Runden hinweg: Zeit bis zum ersten Token
  // (= Prefill/Prompt-Verarbeitung, der teure Teil bei großen Papern) und
  // Token-Zähler aus den usage-Chunks (stream_options.include_usage).
  const startedAt = Date.now();
  let firstTokenAt = null;
  let promptTokens = null;
  let completionTokens = 0;

  // usage-Chunks kommen als letzter Chunk mit leerem choices-Array. Bei
  // mehreren Tool-Runden ist der Prompt der letzten Runde der längste —
  // fürs Kontextfenster zählt das Maximum; generierte Tokens summieren sich.
  const trackUsage = (chunk) => {
    if (!chunk.usage) return;
    if (typeof chunk.usage.prompt_tokens === 'number') {
      promptTokens = Math.max(promptTokens ?? 0, chunk.usage.prompt_tokens);
    }
    if (typeof chunk.usage.completion_tokens === 'number') {
      completionTokens += chunk.usage.completion_tokens;
    }
  };

  const reportPerf = () => {
    if (!onPerf) return;
    const now = Date.now();
    const ttftMs = firstTokenAt ? firstTokenAt - startedAt : null;
    const decodeMs = firstTokenAt ? now - firstTokenAt : null;
    onPerf({
      ttftMs,
      totalMs: now - startedAt,
      promptTokens,
      completionTokens: completionTokens || null,
      tokensPerSecond:
        completionTokens && decodeMs > 0
          ? Math.round((completionTokens / decodeMs) * 10_000) / 10
          : null,
    });
  };

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
        ...extras,
        stream: true,
        // usage-Chunk am Stream-Ende: Prompt-/Antwort-Tokens für die
        // Latenz-Diagnose ([perf]-Logzeile und SSE-perf-Event).
        stream_options: { include_usage: true },
      }, { signal });
    } catch (err) {
      if (isAbortError(err)) return finalText;
      // Ollama returns "<model> does not support tools" for vision/embedding/
      // tool-incompatible models. Retry once without the `tools` field so the
      // user still gets an answer — they just lose web-search for this model.
      if (!toolsDisabled && /does not support tools/i.test(err?.message || '')) {
        toolsDisabled = true;
        stream = await client.chat.completions.create({
          model,
          messages: convo,
          ...extras,
          stream: true,
          stream_options: { include_usage: true },
        });
      } else if (Object.keys(extras).length > 0 && /think|reasoning/i.test(err?.message || '')) {
        // Modelle ohne Denk-Fähigkeit können an reasoning_effort scheitern —
        // dann lieber ohne das Flag antworten als gar nicht.
        stream = await client.chat.completions.create({
          model,
          messages: convo,
          ...(toolsDisabled ? {} : { tools: ALL_TOOLS }),
          stream: true,
          stream_options: { include_usage: true },
        });
      } else {
        throw err;
      }
    }

    let roundText = '';
    const toolCalls = new Map();
    let finishReason = null;
    let thinkingSeen = false;

    try {
      for await (const chunk of stream) {
        trackUsage(chunk);
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        // Denk-Modelle streamen die Gedankenkette als `reasoning`-Deltas
        // (Ollama /v1). Sie wird live an den Client weitergereicht
        // (onReasoning), damit die UI sie in einem einklappbaren Panel
        // zeigen kann — die Wartezeit fühlt sich so deutlich kürzer an.
        // Sie landet aber nie im Antwort-Text oder in der Datenbank.
        if (delta.reasoning) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          if (!thinkingSeen) {
            thinkingSeen = true;
            if (onThinking) onThinking();
          }
          if (onReasoning) onReasoning(delta.reasoning);
        }
        if (delta.content) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          roundText += delta.content;
          onText(delta.content);
        }
        if (delta.tool_calls) {
          mergeToolCallDeltas(toolCalls, delta.tool_calls);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    } catch (err) {
      // Abbruch (Stop-Button): der bereits gestreamte Text bleibt gültig —
      // ihn zurückgeben statt werfen, damit die Route ihn speichern kann.
      if (isAbortError(err)) return roundText;
      throw err;
    }

    // Plain answer — we're done.
    if (finishReason !== 'tool_calls' || toolCalls.size === 0) {
      finalText = roundText;
      reportPerf();
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
