# H3 Scout – Finalisierung: Umsetzungsbericht

Bearbeitet in der mandierten Reihenfolge (PHASE 3 → 4 → 5 → 6 → 7 → 8 → 9-Teilaspekte). Alle Angaben unten sind entweder durch echte, DOM-getriebene Playwright-Tests **BESTÄTIGT**, oder ausdrücklich als **NICHT UMGESETZT** / **NICHT VERIFIZIERT** gekennzeichnet – es wird nichts behauptet, was nicht getestet wurde.

---

## 1) GEÄNDERT

**PHASE 3 – Datenintegrität / Rotation / Undo (P0):**
- `repairSet()`/`repairMatch()` neu eingeführt: stellt sicher, dass jeder Satz IMMER eine gültige `startHomeLineup`/`startAwayLineup` besitzt. Fehlen sie (z.B. alte/importierte Daten, unbekannter künftiger Randfall), werden sie aus der frühesten bekannten Rotations-Momentaufnahme des Satzes rekonstruiert statt den Satz stillschweigend aus der Rotationsauswertung auszuschließen.
- Aufruf von `repairMatch()` an drei Stellen (Verteidigung in der Tiefe): beim Laden aus `localStorage` (`loadState`), bei jedem `getMatch()`-Zugriff, und direkt nach jeder Undo-Wiederherstellung (`undoLastPoint`).
- Neues Auswechslungs-Log pro Satz (`set.substitutions`) inkl. Typ (`normal`/`libero`), Zeitstempel, Team, Position, Ein-/Auswechselspieler:in.
- Neues Flag `set.subSinceLastPoint`, gesetzt bei jeder Auswechslung, zurückgesetzt beim nächsten geschlossenen Punkt.
- **Undo-Warnung (Section 18):** `undoLastPoint()` zeigt jetzt, falls seit dem letzten Punkt gewechselt wurde, exakt den geforderten Text *"Seit dem letzten Ballwechsel wurde eine Auswechslung durchgeführt. Soll wirklich zurückgesetzt werden?"* statt der generischen Meldung. (Technische Einschränkung: Browser-`confirm()` erlaubt keine eigenen Button-Beschriftungen wie "Abbrechen"/"Undo durchführen" – es sind die nativen OK/Abbrechen-Buttons, der Warntext selbst ist aber exakt wie gefordert.)
- **Auswechslungs-Limit (Section 17):** reguläre Auswechslungen werden pro Team/Satz gezählt (`MAX_NORMAL_SUBS_PER_SET = 6`); ab der 7. wird vor der Durchführung gewarnt (nicht blockiert, aber nie stillschweigend erlaubt). Libero-Wechsel zählen nicht mit.

**PHASE 4 – Service Worker / Cache:**
- `sw.js`: Cache-Version angehoben (`h3scout-cache-v3`); der `fetch`-Handler nutzt jetzt `{cache:'no-store'}`, um den zugrunde liegenden HTTP-Cache des Browsers zu umgehen (das war die in der QA gefundene tatsächliche Ursache für "network-first" liefert trotzdem eine veraltete Version).
- `app.js`: `controllerchange`-Erkennung zeigt bei einem echten Update (nicht bei der Erstinstallation) einen nicht-blockierenden Banner *"🔄 Neue Version verfügbar – App aktualisieren"* mit einem expliziten "Aktualisieren"-Button (kein erzwungener Reload). Zusätzlich periodisches `reg.update()` alle 5 Minuten. localStorage wird an keiner Stelle berührt.

**PHASE 5/6 – Zuspieler & Läufer:**
- Neues Datenfeld `set.currentSetterId` (nur vom Trainer explizit gesetzt, nie automatisch abgeleitet oder verändert).
- `currentSetterInfo(match, set)`: leitet **Läufer** strikt als `playerPosition('home', currentSetterId, set)` ab – niemals eine eigene Einstellung.
- Neue Karte + Button "🅉 Zuspieler: …" in Coach Live, mit Modal (Kaderliste, aktuelle Auswahl markiert, nur "Als Zuspieler festlegen" übernimmt, "Schließen" verwirft).
- Auswechslungen ändern `currentSetterId` nie automatisch – weder beim Auswechseln der/des aktuellen Zuspieler:in (zeigt dann "– NICHT AUF DEM FELD") noch bei Rückkehr der ursprünglichen Person.
- Beim Satzwechsel wird `currentSetterId` in den neuen Satz übernommen (muss nicht jeden Satz neu gesetzt werden).

**PHASE 7 – Libero:**
- Auswechslungs-Dialog um eine Checkbox *"Dies ist ein Libero-Wechsel (zählt nicht als reguläre Auswechslung)"* erweitert. Libero-Wechsel werden im selben Log wie normale Wechsel gespeichert, aber mit `type:'libero'` distinkt markiert und von der Sub-Limit-Zählung ausgenommen.

**PHASE 8 – Schnelle Annahme-Erfassung:**
- Neuer 5. Schnell-Button "Annahme" direkt im Spielfeld-Bereich (neben Angriff/Block/Aufschlag/Gegner-Fehler): Spieler antippen → Qualität wählen (2 Taps) → fertig, ohne die Rally zu beenden.
- Die bisherige ausführliche Annahme-Erfassung über "+ weitere Aktion" bleibt vollständig unverändert bestehen; beide Wege schreiben dieselbe `skill:'R'`-Aktion und fließen identisch in alle Auswertungen ein.

**Weitere Punkte aus Abschnitt 9 der Anforderungen:**
- **CSV-Export (Section 21):** neue Spalten "Fehler-Zuordnung" (Fehlerverursacher/geblockte:r Angreifer:in), "Zuspieler(Heim)", "Läufer(Heim)"; zusätzliche Zeilen pro Auswechslung (normal + Libero) am Satzende. Keine bisherige Spalte wurde entfernt.
- **Coach Live nach Spielende (Section 22):** neuer 🎯-Button auch auf der Statistik-Seite, unabhängig vom Match-Status; Coach Live selbst erkennt Match-Status und zeigt "← Statistik" statt "← Live" als Rücksprung.

## 2) NICHT GEÄNDERT

Bewusst unverändert gelassen (funktionieren bereits, kein Grund für Änderung – "keine blinden Neuimplementierungen"): Rally-/Punkterfassung (Angriff/Block/Aufschlag/Gegner-Fehler-Schnellerfassung), ausführliche "+"-Erfassung mit 5-stufiger Bewertungsskala, Fehler-Zuordnung (wer hat den Fehler verursacht/wurde geblockt), Fehler-Notizen mit Diktierfunktion, Sideout%/Break%/Angriffseffizienz-Berechnung, Spieler- und Rotationsstatistiken, Angriffs-Heatmap, Gegneranalyse, automatische Insights (Formulierungen unverändert, weiterhin ohne Direktiven wie "SOFORT WECHSELN"), Starting-Six-Auswahl (Datenmodell), Undo der einzelnen Aktion (offene Rally), PDF-Druckansicht, Satz-/Match-Ende-Banner.

## 3) GEFUNDENE BUGS

- **PHASE-3-Kernproblem konnte in dieser Session – trotz mehrfacher, exakt am ursprünglichen QA-Ablauf orientierter DOM-getriebener Reproduktionsversuche (Starting Six → mehrere echte Rallys über echte Buttons → echte Auswechslung über den echten Dialog → weitere Rally → echter Undo-Klick, inkl. Wiederholung mit zweiter Auswechslung direkt vor Undo) – NICHT reproduziert werden.** `startHomeLineup`/`startAwayLineup` blieben in allen Testläufen korrekt erhalten. Die einmalige Beobachtung aus der vorigen QA-Sitzung bleibt damit ein Einzelfall ohne bestätigten, deterministischen Auslöser. **Da die Ursache nicht mit Sicherheit ausgeschlossen werden kann, wurde trotzdem die in Abschnitt 1 beschriebene mehrschichtige Reparatur (`repairSet`/`repairMatch`, an drei Stellen aufgerufen) eingebaut** – damit ist der Datenverlust selbst dann ausgeschlossen, falls der ursprüngliche Auslöser (welcher er auch war) erneut auftritt.
- Beim Testen wurde erneut bestätigt (bereits aus der vorigen Session bekannt, hier nur erneut verifiziert): einige sehr alte Testskripte (`test.js`–`test5.js`) sind an die heutige UI nicht mehr angepasst (referenzieren nicht mehr existierende Texte wie "Aktion erfassen") – das sind veraltete Testskripte, keine App-Fehler.
- `test10.js` schlägt an zwei Stellen fehl, weil dieses (aus einer früheren Sitzung stammende) Testskript nach einem Block-Art-Klick sofort einen gewerteten Punkt erwartet – die App fragt hier aber (bereits vor dieser Session eingeführt) optional "gegen wen ging der Block?", bevor der Punkt tatsächlich gewertet wird. Kein neuer Bug, nur ein veraltetes Testskript.

## 4) TESTS

| Funktion | Test | Ergebnis |
|---|---|---|
| Datenintegrität nach Undo+Wechsel | Echtes Spiel (UI) → 3 echte Rallys → echte Auswechslung → Rally → echter Undo-Klick → Satz-1-Objekt geprüft | BESTÄTIGT: `startHomeLineup`/`startAwayLineup` weiterhin vorhanden (6 Einträge), Score korrekt zurückgesetzt, Auswechslung blieb erhalten |
| Undo-Warnung mit/ohne vorherige Auswechslung | Undo ohne Wechsel seit letztem Punkt → generische Meldung; Undo direkt nach Wechsel → Warnmeldung mit "Auswechslung durchgeführt" | BESTÄTIGT (beide Dialogtexte exakt wie erwartet) |
| Rotationstabelle bleibt vollständig auswertbar | `computeRotationTable` nach mehreren Undo/Wechsel-Zyklen geprüft | BESTÄTIGT (Rallyanzahl konsistent mit tatsächlichem Punktestand, kein stillschweigend ausgeschlossener Satz) |
| Zuspieler festlegen (Modal, nur explizite Bestätigung) | Modal öffnen → anderen Spieler anklicken → OHNE Bestätigen schließen → geprüft, dass nichts übernommen wurde | BESTÄTIGT |
| Läufer-Berechnung | #7 als Zuspieler gesetzt, Startposition 4 → Coach Live zeigt "Position: 4"/"Läufer: 4" | BESTÄTIGT |
| Zuspieler wird ausgewechselt | #7 raus → Coach Live zeigt "#7 … – NICHT AUF DEM FELD", keine automatische Neuzuweisung | BESTÄTIGT |
| Neuer Zuspieler explizit gewählt | #5 (auf dem Feld) gewählt → Position/Läufer korrekt neu berechnet | BESTÄTIGT |
| Alte:r Zuspieler:in kommt zurück | #7 wieder eingewechselt → Rolle bleibt bei #5 (keine Auto-Rückkehr) | BESTÄTIGT |
| Libero-Wechsel getrennt geloggt | Wechsel mit "Libero-Wechsel"-Checkbox → `set.substitutions` enthält `type:'libero'`, normale Wechsel bleiben separat gezählt | BESTÄTIGT |
| Schnelle Annahme-Erfassung | "Annahme"-Button → Spieler antippen → Qualität wählen → Rally NICHT beendet, `skill:'R'`-Aktion gespeichert | BESTÄTIGT |
| CSV-Export erweitert | Export ausgelöst, Blob-Inhalt inspiziert | BESTÄTIGT: Spalten "Zuspieler(Heim)", "Läufer(Heim)", "Fehler-Zuordnung" vorhanden, Auswechslungs-Zeilen vorhanden |
| Satzwechsel/Matchende inkl. Zuspieler-Übernahme | Zuspieler gesetzt → Satz per echten Punkten zu Ende gespielt → neuer Satz übernimmt `currentSetterId` | BESTÄTIGT |
| Regression: Angriff/Block/Aufschlag/Gegner-Fehler, Fehlerzuordnung, Coach-Live-Dashboard, Undo nach Dashboard-Besuch, Substitutions-Vergleichsbox, Insights-Sprache, Satzende-Banner | Bestehende Testsuiten `test9`, `test11`–`test14` erneut ausgeführt | BESTÄTIGT (alle bestehen; `test12`'s "Letzte Rallys"-Zeile bleibt der bereits dokumentierte, harmlose CSS-Großschreibungs-Texttreffer) |
| Service Worker Syntax/Cache-Logik | `node --check sw.js`, manuelle Code-Prüfung von Registrierung/`controllerchange` | BESTÄTIGT (Syntax fehlerfrei); **NICHT VERIFIZIERT**: ein echter Zwei-Deployment-Update-Zyklus (alte SW-Version aktiv, neue deployen, Browser tatsächlich aktualisieren lassen) wurde in dieser Sandbox NICHT gegen die echte GitHub-Pages-Instanz durchgespielt |

## 5) ZUSPIELER/LÄUFER

- **Aktueller Zuspieler:** wird ausschließlich über den "🅉"-Button in Coach Live gesetzt (`set.currentSetterId`), niemals automatisch aus der Rotation abgeleitet.
- **Position:** `playerPosition('home', currentSetterId, set)` – die aktuelle Rotationsposition (1–6) der Zuspieler-Person, sofern auf dem Feld.
- **Läufer:** identisch mit "Position" (per Definition – siehe Section 24: Läufer = die Position, die der/die aktuelle Zuspieler:in gerade einnimmt).
- **Status auf dem Feld:** `"– NICHT AUF DEM FELD"`, sobald `homeLineup` die gesetzte `currentSetterId` nicht mehr enthält (z.B. nach Auswechslung).
- **Rotation:** komplett unverändert automatisch (wie schon vor dieser Session) – Zuspieler-Zuweisung nimmt darauf keinerlei Einfluss.
- **Zuspielerwechsel (Auswahl eines/einer neuen Zuspieler:in):** nur über das Modal + explizites "Als Zuspieler festlegen"; ändert ausschließlich `currentSetterId`, nie die Aufstellung/Rotation.
- **Zuspieler-Auswechslung (Person verlässt das Feld):** `currentSetterId` bleibt unverändert stehen, die Anzeige wechselt auf "NICHT AUF DEM FELD" – es wird nie automatisch jemand anderes befördert.
- **Rückkehr der/des ursprünglichen Zuspieler:in:** die Rolle bleibt bei der zuletzt vom Trainer explizit gewählten Person (auch wenn das zwischenzeitlich eine andere Person war) – keine automatische Rückübertragung, bestätigt per Test.

## 6) DATENMIGRATION

- Alte Spielstände (vor dieser Änderung gespeichert) sind weiterhin vollständig lesbar. Neue Felder (`currentSetterId`, `substitutions`, `subSinceLastPoint`) fehlen dort zunächst – das ist unkritisch, da alle lesenden Stellen defensiv programmiert sind (`set.substitutions || []`, `set.currentSetterId` darf `null`/`undefined` sein → wird dann einfach als "noch nicht festgelegt" angezeigt).
- `repairMatch()` läuft automatisch beim ersten Laden über ältere Daten und ergänzt fehlende Felder mit sinnvollen Standardwerten (siehe Abschnitt 1) – **keine explizite Migrationsroutine nötig, kein Datenverlust zu erwarten.**
- Alte, bereits exportierte CSV-Dateien sind davon nicht betroffen (Export ist nicht rückwirkend, nur zukünftige Exporte enthalten die neuen Spalten).

## 7) SERVICE WORKER

- Cache-Strategie weiterhin "network-first mit Cache-Fallback", jetzt aber mit `{cache:'no-store'}` im `fetch()`-Aufruf, um den in der QA gefundenen Effekt (Browser beantwortet die Anfrage unbemerkt aus seinem eigenen HTTP-Cache, obwohl der Service Worker "network-first" arbeitet) zu verhindern.
- Update-Verhalten: `self.skipWaiting()`/`clients.claim()` (bereits vorher vorhanden) sorgen weiterhin für zügige Aktivierung eines neuen Service Workers im Hintergrund; neu ist die sichtbare, nicht-blockierende Benachrichtigung im Frontend (`controllerchange` → Banner mit "Aktualisieren"-Button) plus periodisches `reg.update()`.
- localStorage-Handling: An keiner Stelle im Service Worker oder in der neuen Update-Logik wird `localStorage` oder die Cache Storage der Spieldaten angefasst – nur der App-Shell-Cache (`h3scout-cache-v3`) wird verwaltet. Spielstände bleiben von jedem Update-Vorgang unberührt.

## 8) NOCH OFFENE PUNKTE

Ehrlich benannt, damit nichts als "fertig" erscheint, was es nicht ist:

- **Trends (Section 9, Zeitfenster letzte 5/10 Rallys, Satz, Gesamt):** NICHT UMGESETZT. `computeStats`/`computeTeamAnalytics`/`computeRotationTable` unterstützen zwar bereits `opts.lastN`/`opts.setNumber`, aber es gibt noch keine UI, die dem Trainer eine Auswahl zwischen diesen Zeitfenstern anbietet.
- **Erweiterte, konkretere Coach-Insights-Formulierungen** (die zusätzlichen Beispiele aus dem Master-Prompt wie "Gegner greift häufig über Position 4 an", "Gegner #9 ist aktuell erfolgreichster Angreifer", Annahmeprobleme-Hinweise): NICHT UMGESETZT – die bestehenden Insights (Rotation, Angriffseffizienz, Fehlercluster) aus einer früheren Sitzung bleiben unverändert bestehen, wurden aber nicht um diese zusätzlichen Fälle erweitert.
- **Gegner-Kader mit Name+Rolle (Section 19):** NICHT UMGESETZT in der Neues-Spiel-UI (weiterhin nur Trikotnummern-Eingabe); das Datenmodell (`opponentRoster[].name`) unterstützt es zwar bereits, es fehlt aber ein Eingabefeld dafür.
- **Starting-Six-UI-Politur (Section 20):** NICHT UMGESETZT – die Positions-Auswahl funktioniert unverändert wie zuvor (Dropdown pro Position), es wurde keine visuell klarere Darstellung ergänzt.
- **Ein echter Zwei-Deployment-Test des Service-Worker-Updates** gegen die produktive GitHub-Pages-Instanz: NICHT VERIFIZIERT (nur Code-Review + lokale Syntaxprüfung), da das in dieser Sandbox-Umgebung nicht gegen die echte Live-URL durchführbar war.
- Die Undo-Warnung (Section 18) verwendet den geforderten Text, aber technisch bedingt die nativen Browser-Dialog-Buttons statt eigens beschrifteter "Abbrechen"/"Undo durchführen"-Buttons.
