/**
 * pdf-text.js
 *
 * Plain-text extraction from the tree's attached PDF, so the chat model can
 * actually answer questions about the paper (before this, the model had no
 * access to the document and hallucinated summaries).
 *
 * Extraction is lazy and cached: the first message in a tree with a bound
 * paper triggers pdf.js text extraction, the result is stored in
 * papers.extracted_text, and every later message reads the cached column.
 */

const fs = require('fs');
const path = require('path');

// Cap the text handed to the LLM. 40k chars ≈ 10k tokens — fits the
// OLLAMA_CONTEXT_LENGTH=16384 the start script configures (paper + history +
// answer), and is far under cloud-model limits. Truncated papers get an
// explicit marker so the model knows the tail is missing instead of
// inventing it.
const MAX_PAPER_CHARS = 40_000;

// pdf.js is ESM-only; require() can't load it from this CommonJS module, so
// the import is dynamic and cached across calls. The `new Function` wrapper
// keeps babel-jest from transpiling `import()` into `require()` — the import
// must run through Node's real ESM loader, also under Jest.
const importEsm = new Function('specifier', 'return import(specifier)');
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = importEsm('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * Extract the plain text of a PDF file, page by page, capped at
 * MAX_PAPER_CHARS. Throws on unreadable/corrupt files — callers decide how
 * to degrade.
 */
async function extractPdfText(pdfPath) {
  const { getDocument } = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const task = getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  const doc = await task.promise;
  try {
    const pages = [];
    let total = 0;
    for (let p = 1; p <= doc.numPages && total < MAX_PAPER_CHARS; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str === 'string') text += item.str;
        text += item.hasEOL ? '\n' : ' ';
      }
      const cleaned = text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
      pages.push(cleaned);
      total += cleaned.length;
    }
    let full = pages.join('\n\n');
    if (full.length > MAX_PAPER_CHARS) {
      full = `${full.slice(0, MAX_PAPER_CHARS)}\n[… paper text truncated]`;
    }
    return full;
  } finally {
    await task.destroy();
  }
}

/**
 * The paper bound to the chat's tree (ADR-0002: the ROOT chat carries
 * paper_id), with its text extracted-and-cached. Returns
 * `{ title, text }` or null when the tree has no paper or extraction fails
 * (a chat that works without paper context beats a 500).
 *
 * `extractFn` is injectable for tests.
 */
async function getTreePaperContext(db, chatId, extractFn = extractPdfText) {
  const getChat = db.prepare('SELECT id, parent_id, paper_id FROM chats WHERE id = ?');
  let chat = getChat.get(chatId);
  while (chat && chat.parent_id) chat = getChat.get(chat.parent_id);
  if (!chat || !chat.paper_id) return null;

  const paper = db
    .prepare('SELECT id, title, pdf_path, extracted_text FROM papers WHERE id = ?')
    .get(chat.paper_id);
  if (!paper) return null;

  if (typeof paper.extracted_text === 'string' && paper.extracted_text.length > 0) {
    return { title: paper.title || path.basename(paper.pdf_path), text: paper.extracted_text };
  }

  try {
    const text = await extractFn(paper.pdf_path);
    if (!text || !text.trim()) return null;
    db.prepare('UPDATE papers SET extracted_text = ? WHERE id = ?').run(text, paper.id);
    return { title: paper.title || path.basename(paper.pdf_path), text };
  } catch (err) {
    console.error(`Paper text extraction failed for ${paper.pdf_path}:`, err.message);
    return null;
  }
}

module.exports = { extractPdfText, getTreePaperContext, MAX_PAPER_CHARS };
