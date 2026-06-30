# Replik

Eine App für Schauspielende zum Textlernen.

## Struktur

- `index.html` — die ganze App (Frontend), läuft im Browser
- `api/analyze.js` — kleine Server-Funktion, hält den Anthropic-API-Key versteckt und leitet Analyse-Anfragen weiter

## Deployment

Dieses Projekt ist für Vercel vorbereitet. Beim Import auf vercel.com muss eine Umgebungsvariable gesetzt werden:

- `ANTHROPIC_API_KEY` — dein Anthropic API-Key (beginnt mit `sk-ant-`)

Diese Variable wird nur serverseitig verwendet (in `api/analyze.js`) und ist im Browser-Code niemals sichtbar.
