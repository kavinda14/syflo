/**
 * components/SettingsModal/index.tsx
 *
 * Modal zum Umschalten zwischen lokalem Ollama-Modell und OpenAI-API.
 * Lädt die aktuellen Settings beim Öffnen, schickt nur geänderte Felder
 * beim Speichern zurück. Der API-Key wird im Frontend nur lokal in einem
 * useState gehalten — er wird nicht aus dem Backend zurückgelesen.
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Eye, EyeOff, Check, ExternalLink, Info, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import type { LLMProvider, Settings } from '../../types';

type OllamaModel = { name: string; size?: number; parameter_size?: string };

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  // Called whenever the user successfully activates a new configuration so the
  // rest of the app (e.g. the sidebar status badge) can re-fetch settings.
  onSaved?: (s: Settings) => void;
}

// OpenAI models exposed in the settings dropdown.
// "search-preview" variants have OpenAI's own built-in web search — for those,
// the backend skips its own SearXNG tool-call wiring (see backend/tools.js).
// All four can handle images.
const OPENAI_MODELS = [
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini — small, fast, cheap' },
  { id: 'gpt-4o', label: 'gpt-4o — multimodal, more powerful' },
  { id: 'gpt-4o-mini-search-preview', label: 'gpt-4o-mini-search — built-in web search (no SearXNG)' },
  { id: 'gpt-4o-search-preview', label: 'gpt-4o-search — built-in web search, best quality' },
];

export function SettingsModal({ open, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [provider, setProvider] = useState<LLMProvider>('ollama');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini');
  const [ollamaModel, setOllamaModel] = useState('llama3.2-vision:11b');
  const [keyInput, setKeyInput] = useState('');
  const [keySet, setKeySet] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Ollama models pulled locally. Loaded once per modal-open; the user can
  // refresh manually after running `ollama pull`. Empty array = either nothing
  // installed or Ollama not reachable — UI falls back to a text input.
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);

  const loadOllamaModels = () => {
    setOllamaModelsLoading(true);
    api.getOllamaModels()
      .then(setOllamaModels)
      .finally(() => setOllamaModelsLoading(false));
  };

  // `original` spiegelt die zuletzt gespeicherten/geladenen Werte. Wir vergleichen
  // damit die aktuellen Form-Werte, um den "Save"-Button nur dann freizugeben,
  // wenn wirklich etwas geändert wurde — und um den "Active"-Status oben zu zeigen.
  const [original, setOriginal] = useState<Settings | null>(null);

  const applySettings = (s: Settings) => {
    setProvider(s.llm_provider);
    setOpenaiModel(s.openai_model);
    setOllamaModel(s.ollama_model);
    setKeySet(s.openai_api_key_set);
    setOriginal(s);
  };

  // Bei jedem Öffnen frisch laden, damit Wechsel von außerhalb nicht überschrieben werden.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setKeyInput('');
    setShowKey(false);
    setLoading(true);
    api.getSettings()
      .then(applySettings)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
    loadOllamaModels();
  }, [open]);

  // "Dirty" = irgendein Feld weicht von den zuletzt gespeicherten Werten ab.
  // Auch ein nicht-leeres Key-Eingabefeld zählt als dirty (auch wenn wir den
  // gespeicherten Key nicht kennen — jeder eingetippte Wert ist eine Absicht).
  const dirty = useMemo(() => {
    if (!original) return false;
    return (
      provider !== original.llm_provider ||
      openaiModel !== original.openai_model ||
      ollamaModel !== original.ollama_model ||
      keyInput.length > 0
    );
  }, [original, provider, openaiModel, ollamaModel, keyInput]);

  // OpenAI braucht zwingend einen Key. Aktivierung wird blockiert, solange
  // weder ein gespeicherter noch ein neu eingegebener Key existiert.
  const needsKey = provider === 'openai' && !keyInput && !original?.openai_api_key_set;
  const canActivate = dirty && !needsKey;

  // Esc schließt das Modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: Parameters<typeof api.updateSettings>[0] = {
        llm_provider: provider,
        openai_model: openaiModel,
        ollama_model: ollamaModel,
      };
      // Nur senden, wenn der User wirklich was getippt hat (auch leerer String =
      // explizites Löschen, das schicken wir nur, wenn der User auf "Key entfernen" geht).
      if (keyInput.length > 0) patch.openai_api_key = keyInput;

      const result = await api.updateSettings(patch);
      applySettings(result);   // setzt `original` neu → dirty wird false → Button deaktiviert sich
      setKeyInput('');
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      onSaved?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateSettings({ openai_api_key: '' });
      applySettings(result);
      setKeyInput('');
      onSaved?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove API key');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Settings</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-6 justify-center">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading settings…</span>
            </div>
          ) : (
            <>
              {/* Provider-Auswahl */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                  LLM Provider
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['ollama', 'openai'] as LLMProvider[]).map(p => {
                    const isSelected = provider === p;
                    // "Currently active" = was gerade tatsächlich von FlowTalk
                    // verwendet wird (zuletzt gespeichert). Kann sich vom
                    // gerade ausgewählten Form-Wert unterscheiden, solange
                    // der User noch nicht "Activate" geklickt hat.
                    const isCurrentlyActive = original?.llm_provider === p;
                    const label = p === 'ollama' ? 'Ollama (local)' : 'OpenAI (Cloud)';
                    const costHint = p === 'ollama' ? 'Free' : 'Pay per use';
                    // Beide Kosten-Badges in derselben neutralen Grau-Variante,
                    // damit nichts "schreit" — der Text trägt die Info.
                    const costClass = 'text-gray-600 bg-gray-100';
                    return (
                      <button
                        key={p}
                        onClick={() => setProvider(p)}
                        className={`relative px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                            : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {isCurrentlyActive && (
                          <span
                            className="absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-green-700"
                            title="Currently in use"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Active
                          </span>
                        )}
                        <div>{label}</div>
                        <div className={`mt-1 inline-block text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${costClass}`}>
                          {costHint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Modell-Auswahl je nach Provider.
                  Feste Mindesthöhe, damit das Modal nicht springt, wenn der
                  User zwischen Providern wechselt. Wert orientiert sich am
                  längsten Fall: OpenAI ohne gesetzten Key (Help-Block sichtbar). */}
              <div className="space-y-5 min-h-[440px]">
              {provider === 'openai' ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                      OpenAI Model
                    </label>
                    <select
                      value={openaiModel}
                      onChange={e => setOpenaiModel(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                    >
                      {OPENAI_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* API-Key */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                      OpenAI API Key
                      {keySet && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                          <Check size={10} />
                          saved
                        </span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showKey ? 'text' : 'password'}
                          value={keyInput}
                          onChange={e => setKeyInput(e.target.value)}
                          placeholder={keySet ? '••••••••••  (overwrite)' : 'sk-…'}
                          className="w-full px-3 py-2 pr-9 rounded-lg border border-gray-200 text-sm font-mono focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey(s => !s)}
                          aria-label={showKey ? 'Hide API key' : 'Show API key'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                        >
                          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      {keySet && (
                        <button
                          onClick={handleClearKey}
                          disabled={saving}
                          className="px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
                      The key is stored only in the local backend and is never sent back to the frontend.
                    </p>
                  </div>

                  {/* Guide block — shown only when no key is configured yet.
                      Helps brand-new OpenAI users land on the right page and
                      understand the actual cost (which is tiny for gpt-4o-mini). */}
                  {!keySet && (
                    <div className="rounded-lg bg-blue-50/60 border border-blue-100 p-3.5 space-y-3">
                      <div className="flex items-start gap-2">
                        <Info size={14} className="text-blue-600 mt-0.5 shrink-0" />
                        <div className="text-xs text-gray-700">
                          <p className="font-semibold text-gray-900 mb-1">Don't have an API key yet?</p>
                          <p className="leading-relaxed">
                            You'll need a free OpenAI account and a $5 starter balance.
                            Creating the key takes about a minute.
                          </p>
                        </div>
                      </div>

                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                      >
                        Get your API key
                        <ExternalLink size={11} />
                      </a>

                      <div className="border-t border-blue-100 pt-2.5 text-[11px] text-gray-600 leading-relaxed">
                        <p className="font-semibold text-gray-800 mb-1.5">What $5 gets you</p>
                        <div className="space-y-1">
                          <div className="flex items-baseline justify-between">
                            <span className="text-gray-700">gpt-4o-mini</span>
                            <span className="font-semibold text-gray-900">~10,000 messages</span>
                          </div>
                          <div className="flex items-baseline justify-between">
                            <span className="text-gray-700">gpt-4o</span>
                            <span className="font-semibold text-gray-900">~500 messages</span>
                          </div>
                        </div>
                        <a
                          href="https://openai.com/api/pricing/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-blue-700 hover:underline"
                        >
                          Full pricing
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Ollama Model
                      </label>
                      <button
                        type="button"
                        onClick={loadOllamaModels}
                        disabled={ollamaModelsLoading}
                        title="Refresh model list"
                        aria-label="Refresh model list"
                        className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40"
                      >
                        <RefreshCw size={12} className={ollamaModelsLoading ? 'animate-spin' : ''} />
                      </button>
                    </div>

                    {ollamaModels.length > 0 ? (
                      <select
                        value={ollamaModel}
                        onChange={e => setOllamaModel(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                      >
                        {/* If the saved model isn't in the local list (e.g. user
                            deleted it from Ollama), still show it so they don't
                            silently lose their selection. */}
                        {!ollamaModels.some(m => m.name === ollamaModel) && (
                          <option value={ollamaModel}>{ollamaModel} (not installed)</option>
                        )}
                        {ollamaModels.map(m => (
                          <option key={m.name} value={m.name}>
                            {m.name}
                            {m.parameter_size ? ` — ${m.parameter_size}` : ''}
                            {m.size ? ` · ${formatSize(m.size)}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={ollamaModel}
                          onChange={e => setOllamaModel(e.target.value)}
                          placeholder="e.g. llama3.2-vision:11b"
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                        />
                        <p className="mt-1.5 text-[11px] text-amber-700 leading-relaxed">
                          Ollama isn't reachable at localhost:11434 — start it to pick from your installed models.
                        </p>
                      </>
                    )}
                  </div>

                  {/* Compact note: models run locally + install link. The full
                      "Free & private" pitch was overkill once a dropdown is
                      showing actual installed models. */}
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Models run on your machine — nothing leaves your computer.{' '}
                    <a
                      href="https://ollama.com/download"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-700 font-medium hover:underline inline-flex items-center gap-0.5"
                    >
                      Install Ollama
                      <ExternalLink size={10} />
                    </a>
                  </p>
                </>
              )}
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-100">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — status hint on the left tells the user exactly what to do
            in plain words instead of generic "unsaved changes". */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-gray-50 border-t border-gray-100">
          <div className="mr-auto text-xs flex items-center gap-1.5">
            {savedFlash ? (
              <span className="text-green-700 flex items-center gap-1 font-medium">
                <Check size={12} />
                Activated
              </span>
            ) : needsKey ? (
              <span className="text-amber-700 font-medium">
                Add an API key to activate OpenAI
              </span>
            ) : dirty ? (
              <span className="text-amber-700 font-medium">
                Click Activate to apply your selection
              </span>
            ) : original ? (
              <span className="text-gray-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Current selection is active
              </span>
            ) : null}
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !canActivate}
            title={
              needsKey
                ? 'Enter an OpenAI API key first'
                : !dirty && !saving
                  ? 'No changes to activate'
                  : 'Apply and activate this configuration'
            }
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Activating…' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}
