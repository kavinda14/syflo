#!/bin/bash
# Syflo Start-Skript
# Startet Ollama, Backend und Frontend, öffnet den Browser

set -e

SYFLO_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="$SYFLO_DIR/start.command"
LOG_DIR="$SYFLO_DIR/logs"
mkdir -p "$LOG_DIR"

cd "$SYFLO_DIR"

# Ein Wert für alle: Ollama nutzt ihn als Kontextfenster, das Backend leitet
# daraus sein Zeichen-Budget für den System-Kontext ab (ancestor-context.js).
# Exportiert, damit BEIDE Prozesse denselben Wert sehen — ein Backend-Budget
# über dem Ollama-Fenster hieße stilles Context-Shifting und toten KV-Cache.
export OLLAMA_CONTEXT_LENGTH=16384

# Kein OLLAMA_NUM_PARALLEL: Ollama erzwingt bei Vision-Modellen (unsere
# ganze Leiter) Parallel:1 — es gibt genau EINEN KV-Cache-Slot. Deshalb
# teilen sich alle Nebenaufrufe (Titel-Generierung) den Prompt-Prefix des
# Gesprächs (messages.js), statt den teuren Paper-Prefill zu verdrängen.

echo "🚀 Syflo wird gestartet..."
echo ""

# Rekursiv einen Prozess samt aller Nachfahren beenden.
# Wichtig, weil $BACKEND_PID/$FRONTEND_PID nur die Bash-Subshell sind —
# darunter laufen npm und node. Ohne Rekursion bleiben node/vite als
# Waisen weiter und blockieren Port 3001 / 5173.
kill_tree() {
  local parent=$1
  [[ -z "$parent" ]] && return
  for child in $(pgrep -P "$parent" 2>/dev/null); do
    kill_tree "$child"
  done
  kill -TERM "$parent" 2>/dev/null || true
}

# Aufräumen beim Beenden (Ctrl+C, Cmd+W, kill)
cleanup() {
  echo ""
  echo "Beende Syflo..."
  kill_tree "$BACKEND_PID"
  kill_tree "$FRONTEND_PID"
  kill_tree "$OLLAMA_PID"
  # Sicherheitsnetz: alles, was noch auf unseren Ports lauscht, beenden
  for port in 3001 5173 5174 5175 5176 5177 5178; do
    leftover=$(lsof -t -iTCP:$port -sTCP:LISTEN 2>/dev/null || true)
    [[ -n "$leftover" ]] && kill -TERM $leftover 2>/dev/null || true
  done
  echo "👋 Tschüss!"
  exit 0
}
trap cleanup INT TERM HUP

# Vorherige Instanzen schließen: nur Bash-Prozesse, die genau dieses Skript
# ausführen (eigene PID ausgenommen). Damit werden weder Editoren, die das
# Skript geöffnet haben, noch andere Terminals (z. B. Claude) angefasst.
own_pid=$$
killed_any=0
for pid in $(pgrep -f "$SCRIPT_PATH" 2>/dev/null || true); do
  [[ "$pid" == "$own_pid" ]] && continue
  cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
  case "$cmd" in
    *bash*"$SCRIPT_PATH"*|*sh*"$SCRIPT_PATH"*|"$SCRIPT_PATH"*)
      [[ "$killed_any" == 0 ]] && echo "Schließe vorherige Syflo-Instanzen..."
      killed_any=1
      pid_tty=$(ps -p "$pid" -o tty= 2>/dev/null | tr -d ' ' || true)
      kill -TERM "$pid" 2>/dev/null || true
      # Zugehöriges Terminal-Fenster schließen (best-effort, braucht Automation-Berechtigung)
      if [[ -n "$pid_tty" && "$pid_tty" != "??" && "$pid_tty" != "?" ]]; then
        osascript >/dev/null 2>&1 <<EOF || true
tell application "Terminal"
  try
    set wins to (every window whose tty is "/dev/$pid_tty")
    repeat with w in wins
      close w saving no
    end repeat
  end try
end tell
EOF
      fi
      ;;
  esac
done
[[ "$killed_any" == 1 ]] && sleep 1

# Sicherheitsnetz: alle Prozesse beenden, die noch auf unseren Ports lauschen.
# Fängt Waisen-Prozesse von alten/abgestürzten Instanzen ab — sonst weicht der
# neue vite z. B. von 5173 auf 5174 aus und der Browser zeigt veralteten Code.
for port in 3001 5173 5174 5175 5176 5177 5178; do
  leftover=$(lsof -t -iTCP:$port -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$leftover" ]]; then
    echo "Räume Port $port (PID $leftover)..."
    kill -TERM $leftover 2>/dev/null || true
  fi
done
[[ "$killed_any" == 1 ]] || sleep 0.3

# Auf einen HTTP-Endpoint warten, bis er antwortet (oder Timeout).
# Gibt 0 bei Erfolg, 1 bei Timeout zurück.
wait_for() {
  local url=$1 max_tries=${2:-30}
  for i in $(seq 1 "$max_tries"); do
    if curl -s -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# 1. Ollama
if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "Ollama läuft bereits"
else
  if ! command -v ollama >/dev/null 2>&1; then
    echo "FEHLER: 'ollama' ist nicht installiert (brew install ollama)"
    exit 1
  fi
  echo "Starte Ollama..."
  # Kontextfenster statt der 4096-Default: der Chat bekommt den Volltext des
  # angehängten Papers in den System-Prompt — mit 4096 würde Ollama den
  # Paper-Text stillschweigend abschneiden. Wert: export oben im Skript.
  ollama serve >"$LOG_DIR/ollama.log" 2>&1 &
  OLLAMA_PID=$!
  if wait_for http://localhost:11434/api/tags 20; then
    echo "Ollama bereit"
  else
    echo "Ollama antwortet nicht (siehe $LOG_DIR/ollama.log)"
  fi
fi

# 1.5 SearXNG (Web-Suche im Chat) — best effort: ohne laufenden Container
# stirbt die web_search-Funktion still (das Modell bekommt nur einen Fehler-
# String). Keine Container-Laufzeit ist NICHT fatal — der Chat läuft weiter,
# nur ohne Web-Suche. Port 8890, siehe searxng/docker-compose.yml.
# Laufzeit ist Colima (Entscheidung 2026-07-22): schlanke VM (~1 GB Deckel)
# statt Docker Desktop, Autostart über `brew services start colima`. Der
# colima-start hier ist nur das Sicherheitsnetz, falls der Dienst aus ist.
if curl -s -m 2 http://localhost:8890/ >/dev/null 2>&1; then
  echo "SearXNG läuft bereits"
elif command -v docker >/dev/null 2>&1; then
  if ! docker info >/dev/null 2>&1 && command -v colima >/dev/null 2>&1; then
    echo "Starte Colima..."
    colima start >"$LOG_DIR/colima.log" 2>&1 || true
  fi
  if docker info >/dev/null 2>&1; then
    echo "Starte SearXNG (Port 8890)..."
    docker compose -f "$SYFLO_DIR/searxng/docker-compose.yml" up -d >"$LOG_DIR/searxng.log" 2>&1 \
      && echo "SearXNG bereit" \
      || echo "SearXNG konnte nicht starten (siehe $LOG_DIR/searxng.log) — Web-Suche deaktiviert"
  else
    echo "Keine Container-Laufzeit erreichbar (colima start fehlgeschlagen?) — Web-Suche deaktiviert"
  fi
else
  echo "Docker-CLI ist nicht installiert — Web-Suche im Chat ist deaktiviert"
fi

# 2. Backend
echo "Starte Backend (Port 3001)..."
(cd "$SYFLO_DIR/backend" && npm run dev) >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
if wait_for http://localhost:3001/api/chats 20; then
  echo "Backend bereit"
else
  echo "Backend antwortet nicht (siehe $LOG_DIR/backend.log)"
fi

# 3. Frontend
echo "Starte Frontend (Port 5173)..."
(cd "$SYFLO_DIR/frontend" && npm run dev) >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
if wait_for http://localhost:5173 30; then
  echo "Frontend bereit"
  echo "Öffne Browser..."
  open http://localhost:5173
else
  echo "Frontend antwortet nicht (siehe $LOG_DIR/frontend.log)"
fi

echo ""
echo "✅ Syflo läuft!"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:3001"
echo "   Ollama:   http://localhost:11434"
echo "   Logs:     $LOG_DIR"
echo ""
echo "Drücke Ctrl+C zum Beenden."

# Auf Beenden warten
wait
