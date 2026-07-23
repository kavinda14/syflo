#!/bin/bash
# setup-whisper.sh
#
# Richtet die On-Device-Diktierfunktion ein (ADR-0004):
#   1. whisper-cpp (liefert whisper-server) via Homebrew, falls es fehlt
#   2. das multilinguale Modell ggml-small.bin nach models/
#
# Das Backend startet whisper-server lazy beim ersten Diktat — dieses Skript
# muss nur einmal laufen.

set -euo pipefail

SYFLO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$SYFLO_DIR/models"
MODEL_PATH="$MODEL_DIR/ggml-small.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

if ! command -v whisper-server >/dev/null 2>&1; then
  echo "whisper-server nicht gefunden — installiere whisper-cpp via Homebrew…"
  brew install whisper-cpp
else
  echo "whisper-server gefunden: $(command -v whisper-server)"
fi

if [[ -f "$MODEL_PATH" ]]; then
  echo "Modell bereits vorhanden: $MODEL_PATH"
else
  echo "Lade ggml-small.bin (~466 MB) nach $MODEL_DIR …"
  mkdir -p "$MODEL_DIR"
  curl -L --progress-bar -o "$MODEL_PATH" "$MODEL_URL"
fi

echo "Fertig. Das Backend startet whisper-server automatisch beim ersten Diktat."
