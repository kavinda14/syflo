/**
 * SettingsModal — Zwei-Tab-Layout (design/mockup-settings-reorg.html,
 * Variante A): Appearance (Themes, nur Close) und Model (Provider → Model →
 * API Key, nur hier Activate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    getOllamaModels: vi.fn(),
    pullOllamaModel: vi.fn(),
    deleteOllamaModel: vi.fn(),
  },
}));

import { api } from '../api';
import { SettingsModal } from '../components/SettingsModal';
import type { Settings } from '../types';

const ollamaSettings: Settings = {
  llm_provider: 'ollama',
  openai_model: 'gpt-4o-mini',
  ollama_model: 'llama3.2-vision:11b',
  model_source: 'auto',
  openai_api_key_set: false,
  custom_instructions: '',
  custom_instructions_enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getSettings).mockResolvedValue(ollamaSettings);
  vi.mocked(api.getOllamaModels).mockResolvedValue([]);
});

async function renderOpen() {
  render(<SettingsModal open={true} onClose={vi.fn()} />);
  await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
  // Warten, bis der Ladezustand weg ist und der Theme-Inhalt steht.
  await screen.findByText('Theme');
}

describe('SettingsModal – two-tab layout', () => {
  it('opens on the Appearance tab: themes visible, no Activate button', async () => {
    await renderOpen();

    expect(screen.getByRole('button', { name: /appearance/i })).toBeInTheDocument();
    expect(screen.getByText('Basic')).toBeInTheDocument();
    // Kein Activate und kein Status-Hinweis auf dem Appearance-Tab
    expect(screen.queryByRole('button', { name: /activate/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/current selection is active/i)).not.toBeInTheDocument();
  });

  it('shows the numbered provider/model flow and Activate on the Model tab', async () => {
    await renderOpen();

    fireEvent.click(screen.getByRole('button', { name: /model/i }));

    expect(screen.getByText('Ollama (local)')).toBeInTheDocument();
    expect(screen.getByText('OpenAI (Cloud)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activate/i })).toBeInTheDocument();
    // Ollama aktiv → kein API-Key-Schritt
    expect(screen.queryByText('API Key')).not.toBeInTheDocument();
  });

  it('opens directly on the Model tab with initialTab="model" (sidebar Active-model button)', async () => {
    render(<SettingsModal open={true} onClose={vi.fn()} initialTab="model" />);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());

    expect(await screen.findByText('Ollama (local)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activate/i })).toBeInTheDocument();
    // Theme-Pills gehören zum Appearance-Tab und sind hier nicht sichtbar
    expect(screen.queryByText('Theme')).not.toBeInTheDocument();
  });

  it('reveals the API key step only when OpenAI is picked', async () => {
    await renderOpen();

    fireEvent.click(screen.getByRole('button', { name: /model/i }));
    fireEvent.click(screen.getByText('OpenAI (Cloud)'));

    expect(screen.getByText('API Key')).toBeInTheDocument();
    // Ohne Key: Aktivieren blockiert + Hinweis im Footer
    expect(screen.getByText(/add an api key to activate openai/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /activate/i })).toBeDisabled();
  });
});

describe('SettingsModal – model library (mockup-model-picker.html, Sektion 03)', () => {
  const recommendation = { platform: 'darwin', totalMemGb: 24, recommendedModel: 'qwen3.5:9b' };

  it('shows the hardware banner and a Download row for the missing recommended model', async () => {
    vi.mocked(api.getOllamaModels).mockResolvedValue([
      { name: 'llama3.2-vision:11b', parameter_size: '10.7B', canThink: false },
    ]);
    render(
      <SettingsModal open onClose={vi.fn()} initialTab="model" recommendation={recommendation} />
    );
    await screen.findByTestId('hardware-banner');

    expect(screen.getByTestId('hardware-banner')).toHaveTextContent('24 GB');
    expect(screen.getByTestId('library-row-qwen3.5:9b')).toHaveTextContent('Recommended for this machine');
    // Installiert + aktiv → "Active"-Abzeichen, aber KEIN Umschalter.
    expect(screen.getByTestId('library-row-llama3.2-vision:11b')).toHaveTextContent('Active');
    expect(screen.getByTestId('download-qwen3.5:9b')).toBeInTheDocument();
  });

  it('starts the pull when Download is clicked and refreshes the library', async () => {
    vi.mocked(api.getOllamaModels).mockResolvedValue([]);
    vi.mocked(api.pullOllamaModel).mockResolvedValue(undefined);
    const onLibraryChanged = vi.fn();
    render(
      <SettingsModal
        open
        onClose={vi.fn()}
        initialTab="model"
        recommendation={recommendation}
        onLibraryChanged={onLibraryChanged}
      />
    );
    fireEvent.click(await screen.findByTestId('download-qwen3.5:9b'));

    await waitFor(() => expect(api.pullOllamaModel).toHaveBeenCalled());
    expect(vi.mocked(api.pullOllamaModel).mock.calls[0][0]).toBe('qwen3.5:9b');
    await waitFor(() => expect(onLibraryChanged).toHaveBeenCalled());
  });

  it('never offers an Ollama model dropdown — switching lives in the composer', async () => {
    vi.mocked(api.getOllamaModels).mockResolvedValue([
      { name: 'qwen3.5:9b', canThink: true },
      { name: 'qwen3.5:4b', canThink: true },
    ]);
    render(
      <SettingsModal open onClose={vi.fn()} initialTab="model" recommendation={recommendation} />
    );
    await screen.findByTestId('hardware-banner');

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(/switched from the chat composer/i)).toBeInTheDocument();
  });
});

// ─── Custom instructions (Grill 2026-07-23, Mockup Variante A · State 4) ─────
// Dritter Tab "Instructions": Freitext + An/Aus-Switch, expliziter Save-Knopf
// (kein Auto-Save — halb getippte Anweisungen dürfen nie in den Prompt).

describe('SettingsModal – custom instructions (Instructions tab)', () => {
  const savedSettings: Settings = {
    ...ollamaSettings,
    custom_instructions: 'Correct my German after every answer.',
    custom_instructions_enabled: true,
  };

  async function openInstructionsTab(settings: Settings = savedSettings) {
    vi.mocked(api.getSettings).mockResolvedValue(settings);
    render(<SettingsModal open={true} onClose={vi.fn()} />);
    await screen.findByText('Theme');
    fireEvent.click(screen.getByRole('button', { name: /instructions/i }));
  }

  it('shows the saved text, the switch and a character counter', async () => {
    await openInstructionsTab();

    const textarea = screen.getByRole('textbox', { name: /custom instructions/i });
    expect(textarea).toHaveValue('Correct my German after every answer.');
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByText('37 / 2000')).toBeInTheDocument();
    // Kein Activate hier — der Instructions-Tab hat einen eigenen Save-Knopf.
    expect(screen.queryByRole('button', { name: /activate/i })).not.toBeInTheDocument();
  });

  it('keeps Save disabled until text or switch changes', async () => {
    await openInstructionsTab();

    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('switch'));
    expect(save).toBeEnabled();
  });

  it('saves text and toggle via updateSettings and reports back', async () => {
    const updated: Settings = {
      ...savedSettings,
      custom_instructions: 'Use simple words.',
      custom_instructions_enabled: false,
    };
    vi.mocked(api.updateSettings).mockResolvedValue(updated);
    const onSaved = vi.fn();
    vi.mocked(api.getSettings).mockResolvedValue(savedSettings);
    render(<SettingsModal open={true} onClose={vi.fn()} onSaved={onSaved} />);
    await screen.findByText('Theme');
    fireEvent.click(screen.getByRole('button', { name: /instructions/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /custom instructions/i }), {
      target: { value: 'Use simple words.' },
    });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        custom_instructions: 'Use simple words.',
        custom_instructions_enabled: false,
      })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    // Nach dem Speichern ist der Stand wieder sauber — Save deaktiviert sich.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('caps the textarea at 2000 characters', async () => {
    await openInstructionsTab();

    expect(
      screen.getByRole('textbox', { name: /custom instructions/i })
    ).toHaveAttribute('maxlength', '2000');
  });
});
