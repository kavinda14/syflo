/**
 * messages.js
 *
 * Nimmt User-Nachrichten an (text + optionale Datei-Anhänge per multipart),
 * speichert die Dateien, baut multimodale Anfragen für llama3.2-vision und
 * streamt die Antwort per SSE zurück.
 *
 * Datei-Handling:
 *   - Bilder (image/*): per data-URL als image_url an das Vision-Modell
 *   - Text-Dateien (text/*, application/json): Inhalt einlesen und in den Prompt einbetten
 *   - Sonstige Dateien: nur Name/Mimetype erwähnen (Modell kann Binär nicht lesen)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getLLMClient, getSetting, noThinkExtras, extendOllamaKeepAlive, getOllamaGpuResidency } = require('../llm');
const { streamWithTools, ALL_TOOLS } = require('../tools');
const { getTreePaperContext } = require('../pdf-text');
const {
  buildAncestorContext,
  renderAncestorText,
  applyContextBudget,
  MAX_SYSTEM_CONTEXT_CHARS,
  CONTEXT_WINDOW_TOKENS,
} = require('../ancestor-context');

const MAX_TEXT_FILE_BYTES = 64 * 1024;

module.exports = (db, UPLOADS_DIR, options = {}) => {
  // Injectable for tests: (pdfPath) => Promise<string>.
  const extractPdfTextFn = options.extractPdfTextFn;
  const router = express.Router({ mergeParams: true });

  // Anhänge ins chat-spezifische Verzeichnis legen, damit man pro Chat
  // aufräumen kann und keine Dateinamen-Kollisionen entstehen.
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(UPLOADS_DIR, req.params.chatId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      // Dateiname: <id>-<originalname> — id für Eindeutigkeit, originalname für Lesbarkeit
      const id = crypto.randomUUID();
      // Originalnamen säubern (keine Pfade)
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      file.attachmentId = id;
      cb(null, `${id}-${safe}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB pro Datei
  });

  // Hilfsfunktion: liest eine Datei und gibt sie als data-URL zurück.
  function fileToDataUrl(fullPath, mimetype) {
    const data = fs.readFileSync(fullPath);
    return `data:${mimetype};base64,${data.toString('base64')}`;
  }

  // Hilfsfunktion: liest eine Textdatei (begrenzt auf MAX_TEXT_FILE_BYTES)
  function readTextFile(fullPath) {
    const stat = fs.statSync(fullPath);
    const len = Math.min(stat.size, MAX_TEXT_FILE_BYTES);
    const fd = fs.openSync(fullPath, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd);
    return buf.toString('utf-8') + (stat.size > len ? '\n[…gekürzt]' : '');
  }

  // Wandelt einen DB-Anhang in den OpenAI-Multimodal-Content-Eintrag.
  // Gibt entweder ein image_url-Objekt zurück, oder null (bei Textdateien wird
  // der Inhalt in den Prompt-Text eingebettet — separat behandelt).
  function attachmentToMultimodalContent(att) {
    if (att.mimetype.startsWith('image/')) {
      return {
        type: 'image_url',
        image_url: { url: fileToDataUrl(att.path, att.mimetype) },
      };
    }
    return null;
  }

  // Baut den Text-Annex für nicht-bildliche Anhänge:
  // - Text-Dateien: kompletter Inhalt
  // - Sonstige: nur Verweis auf Dateiname
  function buildAttachmentTextAnnex(attachments) {
    const parts = [];
    for (const att of attachments) {
      if (att.mimetype.startsWith('image/')) continue;
      const isText = att.mimetype.startsWith('text/') ||
                     att.mimetype === 'application/json' ||
                     /\.(md|txt|csv|log|js|ts|py|html|css|json|yaml|yml)$/i.test(att.filename);
      if (isText) {
        try {
          const content = readTextFile(att.path);
          parts.push(`\n\n[Anhang ${att.alias} — ${att.filename}]\n\`\`\`\n${content}\n\`\`\``);
        } catch (_) {
          parts.push(`\n\n[Anhang ${att.alias} — ${att.filename}, Fehler beim Lesen]`);
        }
      } else {
        parts.push(`\n\n[Anhang ${att.alias} — ${att.filename}, Typ ${att.mimetype} (Binärdatei, kann nicht gelesen werden)]`);
      }
    }
    return parts.join('');
  }

  // Baut den textuellen Gesprächskontext eines Chats: System-Prompt (inkl.
  // Paper-Volltext bei gebundenem PDF, ADR-0002, und geerbtem Vorfahren-
  // Kontext bei Branches) plus die Nachrichten-Historie. Wird von der echten
  // Nachricht (dropLastMessage: die aktuelle User-Nachricht kommt multimodal
  // dazu) UND vom Prefix-Warm-up (kompletter Stand) verwendet — beide müssen
  // denselben Prompt-Prefix erzeugen, sonst greift Ollamas KV-Cache nicht.
  async function buildSystemAndHistory(chat, { dropLastMessage }) {
    const contextMessages = [];
    // Regel (5) ist eine Latenz-Maßnahme: auf lokaler Hardware kostet jedes
    // generierte Token ~40 ms — eine 950-Token-Antwort allein ~40 s. Kürze
    // als Default macht Antworten spürbar schneller fertig.
    let systemBase = 'You are a friendly and helpful assistant. Formatting rules: (1) Use proper Markdown for headings — always include a SPACE between the hash characters and the heading text: `# Heading`, `## Subheading`, `### Sub-subheading`. Never write `#Heading` without a space — it will not render as a heading. (2) Do NOT use emojis. Keep prose plain so it reads cleanly. (3) When explaining concepts, always use analogies and real-world comparisons to make things easy to understand. (4) When the user attaches images, examine them carefully and describe what you see when relevant. (5) Be concise by default: answer in a few short paragraphs at most, and expand only when the user explicitly asks for more depth or detail. (6) When the user asks about current or real-time information (news, weather, prices, recent events) or explicitly asks you to search the web, ALWAYS call the web_search tool first and base your answer on its results — never invent real-time information from memory, and never claim the tool is unavailable without having called it. (7) ALWAYS reply in the language of the user\'s most recent message — German message, German reply; English message, English reply. If a message mixes languages, reply in its dominant language.';

    // Custom instructions (CONTEXT.md): Nutzer-Freitext aus den Settings —
    // direkt nach den Basisregeln und VOR Paper-/Ancestor-Kontext, damit sie
    // das Budget-Trimming nie erfasst. Die explizite Vorrang-Zeile ist nötig,
    // weil kleine lokale Modelle Regel-Konflikte sonst unvorhersehbar lösen.
    const customInstructions = getSetting(db, 'custom_instructions');
    if (getSetting(db, 'custom_instructions_enabled') === 'true' && customInstructions.trim()) {
      systemBase +=
        '\n\nThe user has set the following custom instructions. Follow them; they take precedence over the style rules above.\n' +
        '--- CUSTOM INSTRUCTIONS START ---\n' +
        customInstructions +
        '\n--- CUSTOM INSTRUCTIONS END ---';
    }

    // Volltext des an den Chat-Tree gebundenen Papers (ADR-0002) in den
    // System-Prompt — ohne ihn kennt das Modell das PDF nicht und halluziniert
    // Zusammenfassungen. Extraktion ist lazy und in papers.extracted_text
    // gecacht; Fehler degradieren still zu "kein Paper-Kontext".
    const paperContext = await getTreePaperContext(db, chat.id, extractPdfTextFn);

    // Geerbter Gesprächskontext (Design 2026-07-20): ganzer Pfad bis zur
    // Wurzel — Eltern wörtlich, Großeltern+ als gecachte Summary, dazu die
    // parent_word-Kette. Summary-Fehler degradieren still zum Kontext ohne
    // die betroffene Summary; der Lazy-Pfad hier ist das Sicherheitsnetz
    // hinter dem Warm-up bei der Branch-Erstellung.
    let ancestor = null;
    if (chat.parent_id) {
      try {
        ancestor = await buildAncestorContext(db, chat.id);
      } catch (_) { /* ohne Ancestor-Kontext weitermachen */ }
    }

    // Opfer-Reihenfolge, wenn alles zusammen zu groß wird:
    // Paper → Vorfahren-Summaries (älteste zuerst) → nie das Eltern-Transkript.
    const fitted = applyContextBudget(
      {
        paperText: paperContext ? paperContext.text : null,
        summaries: ancestor ? ancestor.summaries : [],
        parentTranscript: ancestor ? ancestor.parentTranscript : null,
      },
      MAX_SYSTEM_CONTEXT_CHARS
    );

    if (paperContext && fitted.paperText) {
      systemBase +=
        `\n\nA research paper is attached to this conversation: "${paperContext.title}". ` +
        'Its full text is included below. Base every answer about the paper on this text; ' +
        'if something is not covered by it, say so instead of guessing.\n' +
        '--- PAPER TEXT START ---\n' +
        fitted.paperText +
        '\n--- PAPER TEXT END ---';
    }

    if (ancestor) {
      const ancestorText = renderAncestorText({
        chain: ancestor.chain,
        summaries: fitted.summaries,
        parentTranscript: fitted.parentTranscript,
      });
      contextMessages.push({
        role: 'system',
        content: `${systemBase} The user is exploring the term "${chat.parent_word}" from a previous conversation. Context:\n\n${ancestorText}`,
      });
    } else {
      contextMessages.push({ role: 'system', content: systemBase });
    }

    // Historie (nur Text — alte Anhänge werden im Kontext nicht erneut hochgeschickt,
    // sonst wird der Prompt zu groß)
    const history = db.prepare(
      'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC'
    ).all(chat.id);
    const included = dropLastMessage ? history.slice(0, -1) : history;
    included.forEach(m => contextMessages.push({ role: m.role, content: m.content }));

    return contextMessages;
  }

  // Der eine laufende Warm-up (mehr als einen gibt es nie sinnvoll). Ein
  // Warm-up ist reine Vorleistung — er darf NIE eine echte Anfrage blockieren.
  // Auf Ollamas begrenzten Slots hieße das sonst: der Nutzer wartet bis zu
  // ~40 s (Paper-Prefill) in der Warteschlange, bevor seine Frage überhaupt
  // anläuft (gemessen 2026-07-21). Deshalb: neue echte Nachricht ODER neuer
  // Warm-up → laufenden Warm-up sofort abbrechen. Der bereits verarbeitete
  // Prefix bleibt in Ollamas Cache erhalten — abgebrochene Vorarbeit ist
  // also nicht verloren.
  let activeWarmup = null;
  function abortActiveWarmup() {
    if (activeWarmup) activeWarmup.abort();
    activeWarmup = null;
  }

  // POST /api/chats/:chatId/messages/warmup — Prefix-Warm-up: liest den
  // kompletten Chat-Kontext (v. a. den Paper-Volltext) einmal mit einem
  // 1-Token-Aufruf ein, damit Ollamas KV-Cache warm ist, bevor der Nutzer
  // seine Frage abschickt — und pinnt das Modell für 1 h in den Speicher.
  // Fire-and-forget vom Frontend beim Öffnen eines Chats; Fehler sind nie
  // fatal (warmed:false statt 5xx).
  router.post('/warmup', async (req, res) => {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    abortActiveWarmup();
    const warmupAbort = new AbortController();
    activeWarmup = warmupAbort;

    try {
      const { client, model, provider } = getLLMClient(db);
      if (provider !== 'ollama') {
        return res.json({ warmed: false, reason: 'local models only' });
      }
      const contextMessages = await buildSystemAndHistory(chat, { dropLastMessage: false });
      try {
        await client.chat.completions.create({
          model,
          messages: contextMessages,
          // Gleiche Tools wie die echte Anfrage — sonst weicht der Prompt-
          // Prefix ab und der Cache greift nicht.
          tools: ALL_TOOLS,
          ...noThinkExtras(provider),
          max_tokens: 1,
        }, { signal: warmupAbort.signal });
      } catch (err) {
        if (!/does not support tools/i.test(err?.message || '')) throw err;
        await client.chat.completions.create({
          model,
          messages: contextMessages,
          ...noThinkExtras(provider),
          max_tokens: 1,
        }, { signal: warmupAbort.signal });
      }
      await extendOllamaKeepAlive(model);
      // GPU-Residency-Check: liegt das Modell nur teilweise im VRAM, ist
      // jede Antwort 10–20× langsamer — das Frontend zeigt dann eine Warnung.
      const gpu = await getOllamaGpuResidency(model);
      if (gpu && gpu.vramPercent < 100) {
        console.warn(
          `[perf] ${model} liegt nur zu ${gpu.vramPercent}% im GPU-Speicher — ` +
          'teilweises CPU-Offloading macht Antworten 10-20x langsamer. ' +
          'Kleineres Modell wählen oder Speicher freigeben.'
        );
      }
      res.json({ warmed: true, ...(gpu ? { gpu } : {}) });
    } catch (err) {
      res.json({ warmed: false, reason: err.message });
    } finally {
      if (activeWarmup === warmupAbort) activeWarmup = null;
    }
  });

  // POST /api/chats/:chatId/messages
  // Akzeptiert sowohl JSON (alte Clients) als auch multipart/form-data (mit Dateien).
  // Multipart-Felder: text, aliases (JSON-Array), files (Datei-Inputs)
  router.post('/', upload.array('files', 8), async (req, res) => {
    // Inhalt aus JSON oder Multipart
    const content = req.body.content || req.body.text || '';
    const aliases = req.body.aliases ? JSON.parse(req.body.aliases) : [];
    if (!content && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ error: 'content or files required' });
    }

    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // User-Nachricht speichern
    const userMsgId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userMsgId, req.params.chatId, 'user', content, now);

    // Anhänge speichern
    const attachments = [];
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const alias = aliases[i] || `@datei${i + 1}`;
        const id = file.attachmentId;
        db.prepare(
          `INSERT INTO attachments (id, message_id, chat_id, alias, filename, mimetype, path, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, userMsgId, req.params.chatId, alias, file.originalname, file.mimetype, file.path, file.size, now);
        attachments.push({
          id, message_id: userMsgId, alias,
          filename: file.originalname, mimetype: file.mimetype, path: file.path, size: file.size,
        });
      }
    }

    // Kontext aufbauen — System-Prompt (+ Paper + Vorfahren) + Historie.
    // Letzte (aktuelle) User-Nachricht weglassen — die fügen wir multimodal hinzu.
    const contextMessages = await buildSystemAndHistory(chat, { dropLastMessage: true });

    // Aktuelle User-Nachricht: multimodal mit Bildern + Text-Annex für andere Dateien
    const imageContents = attachments.map(attachmentToMultimodalContent).filter(Boolean);
    const textAnnex = buildAttachmentTextAnnex(attachments);
    const fullText = content + textAnnex;

    if (imageContents.length > 0) {
      contextMessages.push({
        role: 'user',
        content: [{ type: 'text', text: fullText }, ...imageContents],
      });
    } else {
      contextMessages.push({ role: 'user', content: fullText });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Echte Fragen haben Vorfahrt: einen eventuell laufenden Warm-up sofort
    // abbrechen, damit diese Anfrage nicht hinter ihm in Ollamas
    // Warteschlange hängt.
    abortActiveWarmup();

    try {
      const { client, model, provider } = getLLMClient(db);

      // Denken ist standardmäßig AUS (Antworten starten sofort). Nur wenn der
      // Client explizit think=true schickt, darf das Modell seine Gedanken-
      // kette laufen lassen. Ollama /v1 übersetzt reasoning_effort 'none'
      // in think=false; die Gedanken streamen als eigene reasoning-Events
      // an die UI (einklappbares Panel), aber nie in Antwort-Text oder DB.
      const thinkOn = String(req.body.think) === 'true';
      const extras = thinkOn ? {} : noThinkExtras(provider);

      // Stop-Button: Wenn der Client die Verbindung schließt, brechen wir die
      // Upstream-Anfrage ab — Ollama/OpenAI hören sofort auf zu generieren.
      const upstreamAbort = new AbortController();
      req.on('close', () => upstreamAbort.abort());

      // Tool-Use-Loop: das LLM darf eigenständig web_search aufrufen. Beim
      // Tool-Call streamen wir spezielle SSE-Events ans Frontend, damit es
      // "Searching the web…" anzeigen und die Quellen unter der Antwort
      // auflisten kann.
      const fullContent = await streamWithTools({
        client,
        model,
        messages: contextMessages,
        extras,
        signal: upstreamAbort.signal,
        onText: (delta) => {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        },
        onToolEvent: (evt) => {
          res.write(`data: ${JSON.stringify({ tool: evt })}\n\n`);
        },
        onThinking: () => {
          res.write(`data: ${JSON.stringify({ thinking: true })}\n\n`);
        },
        onReasoning: (delta) => {
          res.write(`data: ${JSON.stringify({ reasoning: delta })}\n\n`);
        },
        onPerf: (perf) => {
          // Eine [perf]-Zeile pro Antwort: die Basis für jede Latenz-Diagnose
          // (Prefill vs. Decode) und für scripts/benchmark.js.
          console.log(
            `[perf] model=${model} prompt_tokens=${perf.promptTokens ?? '?'} ` +
            `ttft_ms=${perf.ttftMs ?? '?'} gen_tokens=${perf.completionTokens ?? '?'} ` +
            `tok_s=${perf.tokensPerSecond ?? '?'} total_ms=${perf.totalMs}`
          );
          // Prompt nahe am Kontextfenster heißt Context-Shifting: Ollama
          // wirft vorne Tokens weg, der Prefix ändert sich bei jeder Anfrage
          // und der KV-Cache greift nie — genau das soll das abgeleitete
          // Zeichen-Budget verhindern. Diese Warnung ist das Sicherheitsnetz.
          if (provider === 'ollama' && perf.promptTokens && perf.promptTokens > CONTEXT_WINDOW_TOKENS * 0.9) {
            console.warn(
              `[perf] Prompt (${perf.promptTokens} Tokens) ist nahe am Kontextfenster ` +
              `(${CONTEXT_WINDOW_TOKENS}) — Context-Shifting droht, KV-Cache wird unwirksam.`
            );
          }
          res.write(`data: ${JSON.stringify({ perf })}\n\n`);
        },
      });

      // Nach jeder Antwort die Modell-TTL wieder auf 1 h ziehen — sonst fällt
      // sie auf Ollamas 5-Minuten-Default zurück und der Paper-Cache stirbt.
      if (provider === 'ollama') extendOllamaKeepAlive(model);

      // Stop-Button (Nutzerentscheid 2026-07-22): die halb generierte Antwort
      // wird NICHT gespeichert — an ihrer Stelle steht nur der Marker, den
      // das Frontend als graue "Interrupted"-Zeile rendert (gleicher String
      // wie INTERRUPTED_MARKER in frontend/src/types).
      const aborted = upstreamAbort.signal.aborted;
      const assistantContent = aborted ? '*Interrupted*' : fullContent;

      const assistantMsgId = crypto.randomUUID();
      const assistantNow = new Date().toISOString();
      db.prepare(
        'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(assistantMsgId, req.params.chatId, 'assistant', assistantContent, assistantNow);

      // Titel-Generierung wie bisher — nach einem Abbruch überspringen (der
      // Client ist weg, und ein weiterer LLM-Aufruf wäre nur Wartezeit für
      // die nächste echte Frage).
      const msgCount = db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE chat_id = ?'
      ).get(req.params.chatId);

      if (!aborted && (chat.title === 'New Chat' || msgCount.count <= 2)) {
        // Hard caps so the sidebar list and mindmap stay readable even if the
        // LLM ignores the word-limit instruction (some smaller models do).
        const MAX_TITLE_WORDS = 4;
        const MAX_TITLE_CHARS = 40;

        // Fallback: first few words of the user's message, in case the LLM call fails.
        let newTitle = (content || 'Chat')
          .trim()
          .split(/\s+/)
          .slice(0, MAX_TITLE_WORDS)
          .join(' ');

        try {
          const { client: titleClient, model: titleModel, provider: titleProvider } = getLLMClient(db);
          const titleInstruction = {
            role: 'user',
            content:
              'Generate a 2 to 4 word title for this chat. ' +
              'Write the title in the language of the conversation (a German chat gets a German title). ' +
              'Output ONLY the title — no quotes, no punctuation, no markdown, no labels, no extra commentary. ' +
              'Examples: React hooks tutorial / Bicycle repair guide / Berlin trip planning / Linear algebra basics.',
          };
          // Ollama hat genau EINEN KV-Cache-Slot (Vision-Modelle erzwingen
          // Parallel:1). Ein Standalone-Titel-Prompt würde den teuren
          // Paper-Prefix verdrängen — die nächste Frage zahlt dann den
          // vollen Prefill erneut (~40 s gemessen, 2026-07-21). Deshalb:
          // dieselbe Prompt-Basis wie das Gespräch (inkl. tools, sonst
          // weicht der gerenderte Prefix ab) + Titel-Frage hinten dran —
          // Cache-Treffer statt Verdrängung. Cloud-Provider behalten den
          // billigen Mini-Prompt (dort zählt jedes Input-Token, nicht der
          // lokale Cache).
          const titleMessages = titleProvider === 'ollama'
            ? [...contextMessages, { role: 'assistant', content: fullContent }, titleInstruction]
            : [titleInstruction, { role: 'user', content: content || 'New chat' }];
          let titleCompletion;
          try {
            titleCompletion = await titleClient.chat.completions.create({
              model: titleModel,
              // Für einen 4-Wort-Titel darf kein Denk-Modell minutenlang grübeln.
              ...noThinkExtras(titleProvider),
              messages: titleMessages,
              ...(titleProvider === 'ollama' ? { tools: ALL_TOOLS } : {}),
            });
          } catch (err) {
            if (!/does not support tools/i.test(err?.message || '')) throw err;
            titleCompletion = await titleClient.chat.completions.create({
              model: titleModel,
              ...noThinkExtras(titleProvider),
              messages: titleMessages,
            });
          }
          const raw = titleCompletion.choices[0]?.message?.content || '';
          if (raw.trim()) newTitle = raw.trim();
        } catch (_) { /* Fallback genügt */ }

        // Sanitize whatever the LLM returned: strip wrapping quotes/backticks,
        // strip trailing punctuation, drop any line breaks the model added, and
        // enforce the word + character caps.
        newTitle = newTitle
          .replace(/[\r\n]+/g, ' ')
          .replace(/^["'`*_]+|["'`*_.!?,;:]+$/g, '')
          .trim()
          .split(/\s+/)
          .slice(0, MAX_TITLE_WORDS)
          .join(' ');
        if (newTitle.length > MAX_TITLE_CHARS) {
          newTitle = newTitle.slice(0, MAX_TITLE_CHARS - 1).trimEnd() + '…';
        }
        if (!newTitle) newTitle = 'New Chat';

        db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(newTitle, req.params.chatId);
      }

      // Anhänge mit URLs für Frontend
      const userAttachments = attachments.map(a => ({
        id: a.id, alias: a.alias, filename: a.filename, mimetype: a.mimetype, size: a.size,
        url: `/uploads/${req.params.chatId}/${a.id}-${a.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}`,
      }));

      const userMessage = {
        id: userMsgId, chat_id: req.params.chatId, role: 'user', content, created_at: now,
        attachments: userAttachments,
      };
      const assistantMessage = {
        id: assistantMsgId, chat_id: req.params.chatId, role: 'assistant', content: assistantContent, created_at: assistantNow,
        attachments: [],
      };

      res.write(`data: ${JSON.stringify({ done: true, userMessage, assistantMessage })}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  });

  return router;
};
