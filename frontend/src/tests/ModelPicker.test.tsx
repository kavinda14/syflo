/**
 * tests/ModelPicker.test.tsx
 *
 * Composer-Modell-Pille + Drop-up (design/mockup-model-picker.html, Sektion
 * 02). Kernregeln: nur installierte Modelle sind wählbar, Thinking-Zeile nur
 * bei denk-fähigem aktivem Modell, fehlende Empfehlung ist nur ein Hinweis
 * (Download lebt in den Settings), Provider-Status in der Menü-Fußzeile.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelPicker } from '../components/ChatArea/ModelPicker';
import type { OllamaModelInfo } from '../types';

const MODELS: OllamaModelInfo[] = [
  { name: 'qwen3.5:9b', parameter_size: '9.7B', canThink: true },
  { name: 'qwen3.5:4b', parameter_size: '4B', canThink: true },
];

const defaultProps = {
  activeModel: 'qwen3.5:9b',
  models: MODELS,
  recommendedModel: 'qwen3.5:9b',
  onSelectModel: vi.fn(),
  think: false,
  onToggleThink: vi.fn(),
  onOpenSettings: vi.fn(),
};

function openMenu() {
  fireEvent.click(screen.getByTestId('model-pill'));
}

describe('ModelPicker', () => {
  beforeEach(() => {
    defaultProps.onSelectModel.mockClear();
    defaultProps.onToggleThink.mockClear();
    defaultProps.onOpenSettings.mockClear();
  });

  it('shows the active model on the pill and lists installed models on click', () => {
    render(<ModelPicker {...defaultProps} />);
    expect(screen.getByTestId('model-pill')).toHaveTextContent('qwen3.5:9b');

    openMenu();
    expect(screen.getByTestId('model-item-qwen3.5:9b')).toHaveTextContent('Recommended for this Mac');
    expect(screen.getByTestId('model-item-qwen3.5:4b')).toBeInTheDocument();
  });

  it('switching selects only installed models and closes the menu', () => {
    render(<ModelPicker {...defaultProps} />);
    openMenu();
    fireEvent.click(screen.getByTestId('model-item-qwen3.5:4b'));

    expect(defaultProps.onSelectModel).toHaveBeenCalledWith('qwen3.5:4b');
    expect(screen.queryByTestId('model-menu')).not.toBeInTheDocument();
  });

  it('offers the Thinking row only when the active model can think', () => {
    const { rerender } = render(<ModelPicker {...defaultProps} />);
    openMenu();
    expect(screen.getByTestId('thinking-row')).toHaveTextContent('Off');
    fireEvent.click(screen.getByTestId('thinking-row'));
    expect(defaultProps.onToggleThink).toHaveBeenCalled();

    // Aktives Modell ohne Denk-Fähigkeit → keine Zeile, kein Geister-Knopf.
    rerender(
      <ModelPicker
        {...defaultProps}
        activeModel="llama3.2-vision:11b"
        models={[{ name: 'llama3.2-vision:11b', canThink: false }]}
        recommendedModel={null}
      />
    );
    expect(screen.queryByTestId('thinking-row')).not.toBeInTheDocument();
  });

  it('shows a quiet hint (deep-link to Settings) when the recommended model is missing', () => {
    render(
      <ModelPicker
        {...defaultProps}
        activeModel="llama3.2-vision:11b"
        models={[{ name: 'llama3.2-vision:11b' }]}
        recommendedModel="qwen3.5:9b"
      />
    );
    openMenu();

    const hint = screen.getByTestId('model-recommend-hint');
    expect(hint).toHaveTextContent('qwen3.5:9b is recommended');
    expect(hint).toHaveTextContent('Download it in Settings');
    fireEvent.click(hint);
    expect(defaultProps.onOpenSettings).toHaveBeenCalled();
    // Der Picker selbst startet nie einen Download / Modellwechsel.
    expect(defaultProps.onSelectModel).not.toHaveBeenCalled();
  });

  it('carries the provider status in the menu footer and a manage link', () => {
    render(<ModelPicker {...defaultProps} />);
    openMenu();
    expect(screen.getByText(/Ollama · running locally/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('manage-models-row'));
    expect(defaultProps.onOpenSettings).toHaveBeenCalled();
  });

  it('surfaces a GPU-offload warning on the pill and inside the menu', () => {
    // CPU-Offloading (Modell passt nicht ganz in den VRAM) ist der häufigste
    // Grund für langsame Antworten — die Warnung kommt vom Prefix-Warm-up.
    render(
      <ModelPicker
        {...defaultProps}
        gpuWarning="Model runs only 62% on the GPU — responses will be much slower. Try a smaller model."
      />
    );
    expect(screen.getByTestId('gpu-warning-dot')).toBeInTheDocument();

    openMenu();
    expect(screen.getByTestId('gpu-warning-row')).toHaveTextContent('62% on the GPU');
  });

  it('shows no GPU warning when the model is fully GPU-resident', () => {
    render(<ModelPicker {...defaultProps} gpuWarning={null} />);
    expect(screen.queryByTestId('gpu-warning-dot')).not.toBeInTheDocument();
    openMenu();
    expect(screen.queryByTestId('gpu-warning-row')).not.toBeInTheDocument();
  });
});
