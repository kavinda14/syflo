# SearXNG — Web-Suche für FlowTalk

Lokale, selbst-gehostete Meta-Suchmaschine. Aggregiert Google, Brave, Bing,
DuckDuckGo, Wikipedia, GitHub, StackOverflow und ~90 weitere Quellen.
Keine API-Keys, keine Drittanbieter-Verträge, keine Anfragelimits.

## Einmalige Installation

### 1. Docker Desktop installieren

Falls noch nicht vorhanden:

```bash
brew install --cask docker
```

Oder von Hand: <https://www.docker.com/products/docker-desktop/>

Nach der Installation **Docker Desktop einmal starten** (Whale-Icon in der
Menüleiste muss aktiv sein). Beim ersten Start fragt es eventuell nach Login —
das ist optional, kann übersprungen werden.

### 2. SearXNG starten

```bash
docker compose -f searxng/docker-compose.yml up -d
```

Beim ersten Mal lädt Docker das Image (~150 MB) — danach geht's in Sekunden.

Test:

```bash
curl "http://localhost:8890/search?q=quantum+mechanics&format=json" | head -50
```

Sollte JSON mit `results: [...]` zurückgeben.

## Tägliche Nutzung

SearXNG läuft im Hintergrund und startet mit Docker Desktop neu. Manuelle Befehle:

```bash
# Status
docker compose -f searxng/docker-compose.yml ps

# Logs ansehen
docker compose -f searxng/docker-compose.yml logs -f

# Stoppen
docker compose -f searxng/docker-compose.yml down

# Neustarten
docker compose -f searxng/docker-compose.yml restart
```

## Konfiguration

Die wichtigsten Einstellungen liegen in `settings.yml`. Nach Änderungen
Container neu starten:

```bash
docker compose -f searxng/docker-compose.yml restart
```

## Wenn etwas nicht klappt

- **`Cannot connect to the Docker daemon`** → Docker Desktop ist nicht
  gestartet. Whale-Icon in der Menüleiste prüfen.
- **Anfragen scheitern mit 403** → Eine Engine hat dich temporär blockiert.
  SearXNG nimmt automatisch eine andere; einfach erneut suchen.
- **Port 8888 schon belegt** → In `docker-compose.yml` den linken Port ändern
  (`"9999:8080"`) und Backend `.env` anpassen.
