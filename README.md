# H3 Scout – Volleyball Live-Scouting (PWA)

Eine Offline-fähige Web-App im Stil von Click&Scout: Aufschlag, Annahme, Angriff,
Block, Abwehr und Zuspiel live während des Spiels erfassen, automatische Rotation
und Punktestand, Statistik pro Spieler/Team, CSV-Export und Druckansicht.

Alles läuft rein im Browser (kein Server, keine Datenbank) – die Daten werden
lokal auf dem jeweiligen Gerät gespeichert (`localStorage`).

## Hosting in 5 Minuten (GitHub Pages)

1. Neues Repository auf GitHub anlegen (z. B. `h3-scout`), öffentlich oder privat.
2. Diese Dateien in das Repo hochladen (per `git push` oder direkt im Browser
   über "Add file → Upload files"): `index.html`, `app.js`, `manifest.json`,
   `sw.js`, den Ordner `icons/`.
3. Im Repo unter **Settings → Pages** als Quelle den Branch `main` (Root)
   auswählen und speichern.
4. Nach ca. 1 Minute ist die App unter `https://<dein-github-name>.github.io/h3-scout/`
   erreichbar.

## Alternative ohne GitHub: Netlify Drop

Auf https://app.netlify.com/drop den ganzen Ordner per Drag & Drop ablegen –
sofort ist ein Link fertig (z. B. `h3-scout.netlify.app`), spätere Updates
einfach erneut hochziehen.

## Installation für die Teammates (iPhone/Android)

1. Link öffnen (Safari auf iPhone, Chrome auf Android).
2. iPhone: Teilen-Symbol → "Zum Home-Bildschirm".
   Android: Chrome-Menü → "App installieren" bzw. "Zum Startbildschirm hinzufügen".
3. Danach liegt "H3 Scout" als eigenes App-Icon auf dem Homescreen und startet
   im Vollbild – auch ganz ohne Internet (z. B. in der Halle).

## Kurzanleitung

1. **Kader anlegen** (Zahnrad-Symbol oben rechts): eigene Spieler:innen mit
   Rückennummer, Name, Position.
2. **Neues Spiel**: Gegner, Modus (Best of 3/5), Aufschlagrecht, Gegner-Trikot-
   nummern (kommagetrennt) und Startaufstellung (Positionen 1–6) für beide
   Teams festlegen.
3. **Live-Scouting**: Aktion (z. B. Angriff) antippen → Team ggf. umschalten
   (Standardauswahl: Aufschlag/Annahme werden automatisch dem aufschlagenden
   bzw. annehmenden Team zugeordnet; bei Angriff/Block/Abwehr/Zuspiel bitte
   kurz prüfen, welches Team gerade am Ball war, und bei Bedarf umschalten) →
   Spieler antippen → Bewertung (# perfekt … = Fehler) antippen.
   - „#" bei Aufschlag/Angriff/Block beendet die Rally direkt mit Punkt.
   - „=" beendet die Rally immer mit Punkt für das andere Team.
   - Alles dazwischen läuft einfach weiter, bis die Rally regulär (oder über
     die manuellen "Punkt"-Buttons) beendet wird.
4. **Statistik** (Balkendiagramm-Symbol oben rechts): Aktionen und Effizienz
   pro Spieler:in und Team, CSV-Export für Excel, Druckansicht für PDF.

## Bekannte Vereinfachungen (bewusst, für die erste Version)

- Nur ein 5-stufiges Bewertungsschema (#, +, !, -, =) für alle 6 Grund-
  elemente – keine Zonen-/Richtungs-Erfassung wie im großen Data-Volley-System.
- Kein Libero-Sondertausch, keine Auszeiten/Auswechslungen als eigene Events.
- Spieldaten bleiben lokal auf dem Gerät, das gescoutet hat (kein Abgleich
  zwischen mehreren Geräten/Trainer:innen).
- Nach einem Satzende wird die zuletzt aktive Rotation als Start für den neuen
  Satz übernommen; die Aufstellung lässt sich aktuell nicht zwischen den
  Sätzen neu editieren (kommt bei Bedarf in einer nächsten Version).

Rückmeldungen und Wünsche für die nächste Version gerne einfach melden.
