/* ============================================================
   H3 Scout — Volleyball Live-Scouting PWA
   Reines Vanilla JS, keine externen Abhängigkeiten, offlinefähig.
   ============================================================ */

const STORAGE_KEY = 'h3scout_v1';

const SKILLS = [
  {code:'S', label:'Aufschlag', short:'Serve'},
  {code:'R', label:'Annahme', short:'Reception'},
  {code:'A', label:'Angriff', short:'Attack'},
  {code:'B', label:'Block', short:'Block'},
  {code:'D', label:'Abwehr', short:'Dig'},
  {code:'E', label:'Zuspiel', short:'Set'},
];
const SKILL_MAP = Object.fromEntries(SKILLS.map(s=>[s.code,s]));
// "Gegner-Fehler" ist kein eigener Skill in SKILLS (taucht daher nicht in der ausführlichen
// "+"-Erfassung auf), braucht aber trotzdem einen Anzeigenamen für Rally-Liste/CSV/Statistik.
SKILL_MAP.OE = {code:'OE', label:'Gegner-Fehler', short:'OpponentError'};

// Bewertungsskala (vereinfacht, angelehnt an Data Volley / Click&Scout) — nur noch für die
// ausführliche "+"-Erfassung relevant, die 4 Schnell-Buttons unten brauchen sie nicht mehr.
const EVALS = [
  {code:'#', label:'Perfekt',  cls:'ev-perfect'},
  {code:'+', label:'Gut',      cls:'ev-good'},
  {code:'!', label:'Neutral',  cls:'ev-neutral'},
  {code:'-', label:'Schwach',  cls:'ev-poor'},
  {code:'=', label:'Fehler',   cls:'ev-error'},
];
// Codes, bei denen eine '#' direkt einen Punkt für das agierende Team bedeutet
const POINT_ON_PERFECT = ['S','A','B'];

// Schnellerfassung: Angriff/Block/Aufschlag/Gegner-Fehler sind IMMER ein Punkt — statt einer
// Bewertung (perfekt/gut/...) wird nur noch die Art der Aktion gewählt.
const ATTACK_TYPES = ['harter Angriffsschlag','platzierter Angriff','Lob / Heber','Angriff in die Lücke','Angriff über den Block','Rollshot','Hinterfeldangriff'];
const BLOCK_TYPES = ['direkter Blockpunkt','Blockberührung (Ball nicht mehr spielbar)','Block gegen Schnellangriff','Block gegen Außen/Diagonal','Block-Abpraller ins gegnerische Feld'];
const SERVE_TYPES = ['Ass (direkt ins Feld)','Annahmefehler (Ball ins Aus)','erzwungener unkontrollierter Ballwechsel'];
const OPP_ERROR_TYPES = ['Aufschlag ins Aus','Angriff ins Aus','Angriff ins Netz','Netzberührung','Übertreten der Mittellinie','Vier Ballkontakte','Falsche Rotation','Ball gehalten/geführt','Doppelberührung'];
// Für diese beiden Gegner-Fehler-Arten ist der/die Angreifer:in eindeutig identifizierbar — dort
// nach der Art optional (ein Tap, überspringbar) fragen, wer den Angriffsfehler gemacht hat, damit
// "Angriffsfehler pro Spieler" auch über den schnellen Gegner-Fehler-Button erfasst werden kann.
const OE_ATTACK_ERROR_TYPES = ['Angriff ins Aus','Angriff ins Netz'];

const POSITIONS = [1,2,3,4,5,6]; // FIVB-Rotationspositionen
const MAX_NORMAL_SUBS_PER_SET = 6; // FIVB-Regel: max. 6 reguläre Auswechslungen pro Team und Satz (Libero zählt nicht mit)

// Richtungserfassung (wer schlägt wohin) — nur für Aufschlag und Angriff
const ZONE_SKILLS = ['S','A'];
// Court-Koordinatensystem: 0–100 (Breite) x 0–130 (Länge), Netz bei y=65.
// Position der eigenen Mannschaft (unten, eigene Grundlinie bei y=130).
// (y bewusst mit Abstand zur Grundlinie bei y=130 gewählt, damit der Spieler-Kreis — Radius 8.5 —
// vollständig im Feld bleibt und nicht über die Linie in die Freizone hinausragt.)
const ORIGIN_BY_POSITION = {
  1:{x:83,y:116}, 2:{x:83,y:80}, 3:{x:50,y:78}, 4:{x:17,y:80}, 5:{x:17,y:105}, 6:{x:50,y:108}
};
// Position im Court-Koordinatensystem für ein Team (Gegner wird an der Netzlinie gespiegelt, damit
// beide Mannschaften im selben Feld realistisch stehen).
function positionCoord(team, position){
  const p = ORIGIN_BY_POSITION[position] || ORIGIN_BY_POSITION[3];
  return team==='home' ? p : {x:p.x, y:130-p.y};
}
// Ausgangspunkt einer Aktion: Aufschlag immer von Position 1, sonst die aktuelle Rotationsposition.
function originFor(team, playerId, skillCode, set){
  if(skillCode==='S') return positionCoord(team,1);
  const pos = playerPosition(team, playerId, set) || 3;
  return positionCoord(team, pos);
}

let state = loadState();
let route = {name:'home'};
// Live-Match Arbeitszustand (nicht persistiert bis Rally abgeschlossen)
let live = null;
// Laufende Aktions-Erfassung im Spielfeld: {skillCode, team, playerId, fromPoint, toPoint} oder null (kein Tagging aktiv)
let tagging = null;
// Laufender Wechsel-Dialog: {team, posIdx, newPlayerId} oder null (kein Wechsel-Dialog offen)
let subbing = null;
// App-Vorschau: läuft komplett im Arbeitsspeicher, wird NICHT in localStorage gespeichert und
// überschreibt die echten Daten des Nutzers nicht (siehe startDemo/saveState/go).
let demoMode = false;
// Zuletzt abgeschlossene Rally (egal ob per Feld-Tagging oder manuellem Punkt-Button), für die
// optionale Fehler-Erfassung danach: {matchId, rally, winningTeam} oder null (nichts mehr offen).
let lastPointRally = null;
// Laufendes Fehler-Formular: {playerIds:[...], text} oder null (Formular geschlossen)
let commenting = null;
// Aufgeklappte Rally-Details im "Letzte Rallys"-Verlauf: {matchId, rally} oder null (zugeklappt) —
// bewusst als Inline-Ausklappen statt Popup gelöst (siehe UX-Grundsatz "keine unnötigen Popups").
let expandedRally = null;
// Phase 8 (UX-Review): Satz-/Spielende wurden bisher per blockierendem alert() gemeldet — das
// widerspricht dem Grundsatz "keine unnötigen Popups". Stattdessen ein nicht-blockierender Banner
// oben auf der nächsten Seite (Live- oder Statistik-Ansicht), der bis zum Wegklicken sichtbar bleibt.
let banner = null;
// PHASE 6: Zuspieler-Auswahl-Dialog (Coach Live) — {selectedId} solange offen, sonst null. Nur ein
// Klick auf "Als Zuspieler festlegen" übernimmt die Auswahl, siehe renderCoachLive().
let zuspielerModal = null;
// UX-Kompaktierung: die "📊 Statistik (live)"-Blöcke auf der Live-Seite (Rally-Verlauf,
// Team-Kennzahlen, Rotationstabelle, Spieler-Statistik, Richtungsdiagramme) sind nicht bei jedem
// einzelnen Punkt nötig und machen die Seite sonst sehr lang — daher standardmäßig zugeklappt,
// per Klick aufklappbar. Bewusst NICHT persistiert (setzt sich bei Seitenwechsel zurück), analog zu tagging/subbing.
let liveStatsExpanded = false;

function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      // Bestehende, ggf. ältere/unvollständige Spielstände sofort beim Laden reparieren (siehe
      // repairMatch) — nie stillschweigend mit fehlenden Rotationsdaten weiterarbeiten.
      (parsed.matches||[]).forEach(repairMatch);
      return parsed;
    }
  }catch(e){}
  return { teamName:'Eintracht Frankfurt H3', roster:[], matches:[] };
}
function saveState(){
  if(demoMode) return; // Demo-Daten dürfen die echten gespeicherten Daten nie überschreiben.
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
}

function getMatch(id){
  const m = state.matches.find(m=>m.id===id);
  if(m) repairMatch(m); // Verteidigungslinie #2: auch bei jedem Zugriff nochmal absichern.
  return m;
}
function currentSet(match){ return match.sets[match.sets.length-1]; }

function setsToWin(bestOf){ return bestOf===3?2:3; }
function isDecidingSet(match){
  const win = setsToWin(match.bestOf);
  const homeWins = match.sets.filter(s=>s.winner==='home').length;
  const awayWins = match.sets.filter(s=>s.winner==='away').length;
  return (match.sets.length === (match.bestOf)) || (homeWins===win-1 && awayWins===win-1);
}
function pointsToWinSet(match){ return isDecidingSet(match) ? 15 : 25; }

function rotate(lineup){
  // Sideout-Rotation im Uhrzeigersinn: Pos1 <- Pos2 <- Pos3 ... <- Pos6 <- Pos1
  return [lineup[1],lineup[2],lineup[3],lineup[4],lineup[5],lineup[0]];
}

function playerName(team, playerId, match){
  if(team==='home'){
    const p = state.roster.find(r=>r.id===playerId);
    return p ? (p.number+' '+p.name) : '?';
  } else {
    const p = match.opponentRoster.find(r=>r.id===playerId);
    return p ? (p.number+(p.name?(' '+p.name):'')) : '?';
  }
}
function playerNumber(team, playerId, match){
  if(team==='home'){
    const p = state.roster.find(r=>r.id===playerId);
    return p ? p.number : '?';
  } else {
    const p = match.opponentRoster.find(r=>r.id===playerId);
    return p ? p.number : '?';
  }
}
// Aktuelle Rotationsposition (1–6) einer Person in der laufenden Aufstellung
function playerPosition(team, playerId, set){
  const lineup = team==='home' ? set.homeLineup : set.awayLineup;
  const idx = lineup.indexOf(playerId);
  return idx===-1 ? null : idx+1;
}

// PHASE 5/6 (Zuspieler/Läufer) — strikt getrennte Konzepte (Section 24):
//   ROTATION  = wo steht wer (bereits automatisch über set.homeLineup/rotate() abgedeckt)
//   ZUSPIELER = wer hält aktuell die Zuspieler-Rolle (set.currentSetterId, NUR vom Trainer explizit gesetzt)
//   LÄUFER    = die Rotationsposition (1–6), die der/die aktuelle Zuspieler:in GERADE einnimmt —
//               "Läufer" ist also niemals eine eigene Einstellung, sondern immer nur
//               playerPosition(...) angewandt auf set.currentSetterId.
// Wird der/die Zuspieler:in ausgewechselt, wird NIE automatisch jemand anderes zum/zur Zuspieler:in
// — es wird nur "nicht auf dem Feld" angezeigt, bis der Trainer aktiv über den ZUSPIELER-Button
// eine neue Wahl trifft (auch wenn die alte Person später wieder eingewechselt wird).
function currentSetterInfo(match, set){
  const setterId = set.currentSetterId;
  if(!setterId) return null;
  const onCourt = set.homeLineup.includes(setterId);
  const position = onCourt ? playerPosition('home', setterId, set) : null;
  return { setterId, onCourt, position, laufer: position };
}

/* ============================ Rendering-Kern ============================ */

function el(tag, attrs={}, children=[]){
  const e = document.createElement(tag);
  for(const k in attrs){
    if(k==='class') e.className = attrs[k];
    else if(k==='html') e.innerHTML = attrs[k];
    else if(k.startsWith('on') && typeof attrs[k]==='function') e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(children)?children:[children]).forEach(c=>{
    if(c==null) return;
    e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return e;
}

function svgEl(tag, attrs={}, children=[]){
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for(const k in attrs){
    if(k.startsWith('on') && typeof attrs[k]==='function') e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(children)?children:[children]).forEach(c=>{ if(c!=null) e.appendChild(c); });
  return e;
}

// Court-Koordinatensystem (unverändert, damit bereits gespeicherte Aktionen/Koordinaten gültig
// bleiben): 0–100 (Breite) x 0–130 (Länge). Rundherum kommt zusätzlich eine Freizone ins Bild,
// die man auch antippen kann (z. B. Aufschlagzone hinter der Grundlinie, Bälle im Aus).
const ZONE_MARGIN = 22;

// Interaktives Spielfeld: zeigt beide Aufstellungen als Kreise auf einem echten Court MIT Freizone.
// opts: selectableTeam ('home'|'away'|'both'|null), onSelectPlayer(team,pid), selectedPlayerId,
//       onTapTarget(x,y), previewFrom{x,y}, previewTo{x,y}, previewColor
function buildCourt(set, match, opts={}){
  const vx = -ZONE_MARGIN, vy = -ZONE_MARGIN, vw = 100+2*ZONE_MARGIN, vh = 130+2*ZONE_MARGIN;
  // Bewusst KEINE width/height-Attribute und KEIN width/height als Inline-Style: die tatsächliche
  // Größe (inkl. der Sonderregel für sehr knappe Querformat-Bildschirme, siehe .field-court svg in
  // index.html) kommt komplett aus dem Stylesheet, das per CSS-Rechnung (min()/aspect-ratio) eine
  // eindeutige, nie "verzerrt" oder mit leerem Rand ("Letterboxing") gerenderte Größe erzwingt.
  const svg = svgEl('svg', {viewBox:`${vx} ${vy} ${vw} ${vh}`, style:'display:block;background:#1e293b;border-radius:10px;touch-action:none;'});
  // Freizone (Bereich außerhalb der Spielfeldlinien, in dem z.B. der Aufschlag ausgeführt wird)
  svg.appendChild(svgEl('rect',{x:vx,y:vy,width:vw,height:vh, fill:'#24324a'}));
  // eigentliches Spielfeld
  svg.appendChild(svgEl('rect',{x:2,y:2,width:96,height:126,fill:'#3a8752',stroke:'#e8f5ea','stroke-width':1}));
  svg.appendChild(svgEl('line',{x1:2,y1:65,x2:98,y2:65,stroke:'#e8f5ea','stroke-width':1.8}));
  // Grund-Rasterlinien (3 Spalten je Feldhälfte) zur Orientierung
  [34,66].forEach(x=>{
    svg.appendChild(svgEl('line',{x1:x,y1:2,x2:x,y2:128,stroke:'#e8f5ea','stroke-width':0.4,'stroke-opacity':0.5}));
  });

  if(opts.onTapTarget){
    // Die ganze Fläche inkl. Freizone ist antippbar (Aufschlagzone, Bälle im Aus, o.ä.)
    const hit = svgEl('rect',{x:vx,y:vy,width:vw,height:vh, fill:'transparent', style:'cursor:crosshair'});
    hit.addEventListener('click', (ev)=>{
      const rect = svg.getBoundingClientRect();
      const x = Math.max(vx+1, Math.min(vx+vw-1, (ev.clientX-rect.left)/rect.width*vw + vx));
      const y = Math.max(vy+1, Math.min(vy+vh-1, (ev.clientY-rect.top)/rect.height*vh + vy));
      opts.onTapTarget(x,y);
    });
    svg.appendChild(hit);
  }

  if(opts.previewFrom){
    const c = opts.previewColor||'#facc15';
    svg.appendChild(svgEl('circle',{cx:opts.previewFrom.x,cy:opts.previewFrom.y,r:2.6, fill:'none', stroke:c,'stroke-width':1.4}));
  }
  if(opts.previewFrom && opts.previewTo){
    const c = opts.previewColor||'#facc15';
    svg.appendChild(svgEl('line',{x1:opts.previewFrom.x,y1:opts.previewFrom.y,x2:opts.previewTo.x,y2:opts.previewTo.y, stroke:c,'stroke-width':1.6,'stroke-dasharray':'3,2'}));
    svg.appendChild(svgEl('circle',{cx:opts.previewTo.x,cy:opts.previewTo.y,r:2.4,fill:c}));
  }

  ['home','away'].forEach(team=>{
    const lineup = team==='home' ? set.homeLineup : set.awayLineup;
    const teamColor = team==='home' ? '#3b82f6' : '#ef4444';
    lineup.forEach((pid,idx)=>{
      if(!pid) return;
      const pos = idx+1;
      const c = positionCoord(team,pos);
      const isServer = set.servingTeam===team && pos===1;
      const selectable = opts.selectableTeam==='both' || opts.selectableTeam===team;
      const isSelected = Array.isArray(opts.selectedPlayerId) ? opts.selectedPlayerId.includes(pid) : pid===opts.selectedPlayerId;
      const g = svgEl('g', selectable ? {style:'cursor:pointer', onclick:()=>opts.onSelectPlayer(team,pid)} : {});
      g.appendChild(svgEl('circle',{cx:c.x,cy:c.y,r:8.5, fill:teamColor, stroke: isSelected?'#facc15':'#0f172a', 'stroke-width': isSelected?2.2:1, opacity: selectable?1:0.5}));
      const text = svgEl('text',{x:c.x,y:c.y+2.8,'text-anchor':'middle','font-size':7,fill:'#fff','font-weight':700});
      text.textContent = String(playerNumber(team,pid,match));
      text.setAttribute('style','pointer-events:none');
      g.appendChild(text);
      if(isServer){
        const ball = svgEl('circle',{cx:c.x+8,cy:c.y-8,r:2.2, fill:'#facc15', stroke:'#0f172a','stroke-width':0.5});
        g.appendChild(ball);
      }
      svg.appendChild(g);
    });
  });
  return svg;
}

// Spielfeld (SVG) + die direkt dazugehörigen Aktions-Buttons als ein Baustein: auf schmalen
// Hochformat-Bildschirmen stehen sie (wie bisher) untereinander, ab Tablet-Breite bzw. im
// Querformat nebeneinander (siehe .field-row in index.html) — das Feld bleibt dabei immer der
// große, dominante Teil, die Buttons stehen als schmale Spalte drumherum.
// opts.grid2col: kompakte 2-Spalten-Anordnung für kurze Buttons (z.B. die 5 Schnell-Aktionen).
// opts.overlay: für Auswahllisten, die mehr Platz brauchen als die schmale Spalte hergibt (Art-/
// Bewertungsauswahl, Spielerlisten) — legt sich ab Tablet-Breite als Panel ÜBER einen Teil des
// Feldes, statt das Feld dafür zu verkleinern (auf schmalen Handy-Bildschirmen bleibt es einfach
// unterhalb des Feldes, wie gehabt).
function fieldRow(courtSvg, actionEls, opts={}){
  const court = el('div',{class:'field-court'},[courtSvg]);
  const items = actionEls.filter(Boolean);
  // Solange es nichts zur Auswahl gibt (z.B. während im Feld noch getippt werden muss), auch keinen
  // (Overlay-)Rahmen dafür rendern — sonst könnte selbst ein leeres Panel unnötig einen Teil des
  // Feldes verdecken.
  if(items.length===0) return el('div',{class:'field-row'},[court]);
  let cls = 'field-actions';
  if(opts.grid2col) cls += ' grid2col';
  if(opts.overlay) cls += ' overlay';
  const actions = el('div',{class:cls}, items);
  return el('div',{class:'field-row'},[court, actions]);
}

function go(r){
  tagging = null; subbing = null; commenting = null; expandedRally = null;
  if(demoMode && r.name==='home'){
    // Demo verlassen: echte (gespeicherte) Daten wiederherstellen, sobald es zurück zur Startseite geht.
    demoMode = false;
    state = loadState();
  }
  route = r; render(); window.scrollTo(0,0);
}

// Phase 8 (UX-Review): nicht-blockierender Hinweis-Banner (ersetzt frühere alert()-Meldungen bei
// Satz-/Spielende) — bleibt sichtbar, bis er weggeklickt wird, statt die Eingabe zu blockieren.
function renderBanner(main){
  if(!banner) return;
  const actions = el('div',{style:'display:flex;gap:8px;flex:0 0 auto;align-items:center;'});
  if(banner.reload){
    // PHASE 4: neue Version wurde bereits im Hintergrund installiert (Service Worker) — kein
    // erzwungener Reload (könnte mitten in einer Rally-Erfassung stören), stattdessen ein klarer,
    // nicht-blockierender Hinweis mit expliziter Aktualisieren-Aktion.
    actions.appendChild(el('button',{class:'btn secondary', style:'padding:6px 12px;font-size:12px;', onclick:()=>window.location.reload()},'Aktualisieren'));
  }
  actions.appendChild(el('button',{class:'icon-btn', style:'color:#fff;', onclick:()=>{ banner=null; render(); }},'✕'));
  main.appendChild(el('div',{class:'card', style:'background:var(--accent);color:#fff;display:flex;justify-content:space-between;align-items:center;gap:10px;'},[
    el('div',{style:'font-weight:700;font-size:14px;'}, banner.text),
    actions,
  ]));
}

function render(){
  const app = document.getElementById('app');
  app.innerHTML = '';
  const header = el('header',{class:'topbar'});
  const main = el('main');
  app.appendChild(header); app.appendChild(main);

  if(route.name==='home') return renderHome(header, main);
  if(route.name==='roster') return renderRoster(header, main);
  if(route.name==='newMatch') return renderNewMatch(header, main);
  if(route.name==='live') return renderLive(header, main);
  if(route.name==='coachLive') return renderCoachLive(header, main);
  if(route.name==='stats') return renderStats(header, main);
}

/* ============================ Home ============================ */

function renderHome(header, main){
  header.appendChild(el('h1',{},'H3 Scout'));
  const settingsBtn = el('button',{class:'icon-btn', onclick:()=>go({name:'roster'})}, '⚙');
  header.appendChild(settingsBtn);

  const card = el('div', {class:'card'});
  card.appendChild(el('h2',{}, state.teamName));
  card.appendChild(el('div',{class:'row'},[
    el('button',{class:'btn block', onclick:()=>go({name:'newMatch'})}, '+ Neues Spiel'),
  ]));
  card.appendChild(el('button',{class:'btn secondary block', style:'margin-top:8px;', onclick:()=>startDemo()},'🎬 App-Vorschau'));
  card.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-top:6px;'},'Zeigt die App sofort mit einem vorbereiteten Beispielspiel (Satz 1 & 2 bereits gespielt, 1:1) — perfekt, um sie ohne eigene Daten und ohne Zeitverlust vorzustellen. Satz 3 kannst du direkt live weiterspielen.'));
  main.appendChild(card);

  const listCard = el('div',{class:'card'});
  listCard.appendChild(el('h2',{},'Spiele'));
  if(state.matches.length===0){
    listCard.appendChild(el('div',{class:'empty'},'Noch keine Spiele erfasst.'));
  } else {
    [...state.matches].reverse().forEach(m=>{
      const homeSets = m.sets.filter(s=>s.winner==='home').length;
      const awaySets = m.sets.filter(s=>s.winner==='away').length;
      const row = el('div',{class:'matchrow', onclick:()=> go({name: m.status==='finished' ? 'stats':'live', matchId:m.id})},[
        el('div',{},[
          el('div',{class:'vs'}, state.teamName+' – '+m.opponentName),
          el('div',{class:'status'}, new Date(m.date).toLocaleDateString('de-DE') + ' · ' + (m.status==='finished'?'Beendet':'Läuft'))
        ]),
        el('div',{style:'font-size:20px;font-weight:800;'}, homeSets+':'+awaySets)
      ]);
      row.setAttribute('style','cursor:pointer');
      listCard.appendChild(row);
    });
  }
  main.appendChild(listCard);
}

/* ============================ Roster ============================ */

function renderRoster(header, main){
  header.appendChild(el('button',{class:'back', onclick:()=>go({name:'home'})},'← Zurück'));
  header.appendChild(el('h1',{},'Mannschaft'));

  const teamCard = el('div',{class:'card'});
  teamCard.appendChild(el('h2',{},'Vereinsname'));
  const nameInput = el('input',{value:state.teamName});
  nameInput.addEventListener('change', e=>{ state.teamName=e.target.value; saveState(); });
  teamCard.appendChild(nameInput);
  main.appendChild(teamCard);

  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'Kader'));
  state.roster.slice().sort((a,b)=>a.number-b.number).forEach(p=>{
    const row = el('div',{class:'list-item'},[
      el('div',{},[ el('strong',{},'#'+p.number+' '), p.name, el('span',{class:'pill', style:'margin-left:8px'}, p.position||'') ]),
      el('button',{class:'icon-btn', onclick:()=>{ state.roster = state.roster.filter(x=>x.id!==p.id); saveState(); render(); }}, '✕')
    ]);
    card.appendChild(row);
  });
  if(state.roster.length===0) card.appendChild(el('div',{class:'empty'},'Noch keine Spielerinnen/Spieler.'));

  const form = el('div',{style:'margin-top:14px; border-top:1px solid var(--line); padding-top:14px;'});
  const numI = el('input',{type:'number', placeholder:'Nr.'});
  const nameI = el('input',{placeholder:'Name'});
  const posI = el('select',{},[
    el('option',{value:''},'Position'),
    el('option',{value:'Zuspiel'},'Zuspiel'),
    el('option',{value:'Außen'},'Außen'),
    el('option',{value:'Mitte'},'Mitte'),
    el('option',{value:'Dia'},'Dia'),
    el('option',{value:'Libero'},'Libero'),
  ]);
  form.appendChild(el('label',{},'Rückennummer')); form.appendChild(numI);
  form.appendChild(el('label',{},'Name')); form.appendChild(nameI);
  form.appendChild(el('label',{},'Position')); form.appendChild(posI);
  const addBtn = el('button',{class:'btn block', style:'margin-top:12px', onclick:()=>{
    if(!numI.value || !nameI.value){ alert('Bitte Nummer und Namen angeben.'); return; }
    state.roster.push({id:uid(), number:Number(numI.value), name:nameI.value, position:posI.value});
    saveState(); render();
  }},'+ Spieler hinzufügen');
  form.appendChild(addBtn);
  card.appendChild(form);
  main.appendChild(card);
}

/* ============================ Neues Spiel ============================ */

function renderNewMatch(header, main){
  header.appendChild(el('button',{class:'back', onclick:()=>go({name:'home'})},'← Zurück'));
  header.appendChild(el('h1',{},'Neues Spiel'));

  if(state.roster.length < 6){
    main.appendChild(el('div',{class:'card'},[
      el('h2',{},'Kader zu klein'),
      el('div',{},'Bitte lege zuerst mindestens 6 Spieler:innen im Kader an.'),
      el('button',{class:'btn', style:'margin-top:12px', onclick:()=>go({name:'roster'})},'Zum Kader')
    ]));
    return;
  }

  const setup = { opponentName:'', bestOf:5, opponentPlayers:[], homeLineup:Array(6).fill(''), awayLineup:Array(6).fill(''), servingTeam:'home' };

  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'Gegner'));
  const oppName = el('input',{placeholder:'Name des Gegners'});
  oppName.addEventListener('input', e=> setup.opponentName = e.target.value);
  card.appendChild(el('label',{},'Gegner-Team')); card.appendChild(oppName);

  card.appendChild(el('label',{},'Modus'));
  const bestOfSel = el('select',{},[
    el('option',{value:'5'},'Best of 5'),
    el('option',{value:'3'},'Best of 3'),
  ]);
  bestOfSel.addEventListener('change', e=> setup.bestOf = Number(e.target.value));
  card.appendChild(bestOfSel);

  card.appendChild(el('label',{},'Wer schlägt zuerst auf?'));
  const serveSel = el('select',{},[
    el('option',{value:'home'}, state.teamName),
    el('option',{value:'away'},'Gegner'),
  ]);
  serveSel.addEventListener('change', e=> setup.servingTeam = e.target.value);
  card.appendChild(serveSel);
  main.appendChild(card);

  // Gegner-Kader (einfach: Nummern kommagetrennt)
  const oppCard = el('div',{class:'card'});
  oppCard.appendChild(el('h2',{},'Gegner-Trikotnummern'));
  oppCard.appendChild(el('div',{style:'color:var(--muted);font-size:13px;margin-bottom:8px;'},'Mindestens 6 Nummern, mit Komma getrennt, z.B. 1,3,4,7,9,12,14'));
  const oppNums = el('input',{placeholder:'z.B. 1,3,4,7,9,12,14'});
  oppCard.appendChild(oppNums);
  main.appendChild(oppCard);

  // Aufstellung
  const lineupCard = el('div',{class:'card'});
  lineupCard.appendChild(el('h2',{},'Startaufstellung'));
  lineupCard.appendChild(el('div',{style:'color:var(--muted);font-size:13px;margin-bottom:8px;'},'Position 1 = Aufschlag. Positionen im Uhrzeigersinn (1→6→5→4→3→2).'));

  const homeGrid = el('div',{class:'grid2'});
  const awayGrid = el('div',{class:'grid2'});

  const sortedRoster = state.roster.slice().sort((a,b)=>a.number-b.number);

  function buildHomeSelect(posIdx){
    const sel = el('select',{},[el('option',{value:''},'Pos '+(posIdx+1)), ...sortedRoster.map(p=>el('option',{value:p.id},'#'+p.number+' '+p.name))]);
    sel.addEventListener('change', e=>{ setup.homeLineup[posIdx]=e.target.value; });
    return sel;
  }
  function buildAwaySelect(posIdx){
    const sel = el('select',{},[el('option',{value:''},'Pos '+(posIdx+1))]);
    sel.addEventListener('change', e=>{ setup.awayLineup[posIdx]=e.target.value; });
    sel.dataset.away='1';
    return sel;
  }

  POSITIONS.forEach(p=>{
    const box = el('div',{},[ el('label',{}, state.teamName+' · Pos '+p), buildHomeSelect(p-1) ]);
    homeGrid.appendChild(box);
  });
  POSITIONS.forEach(p=>{
    const box = el('div',{},[ el('label',{}, 'Gegner · Pos '+p), buildAwaySelect(p-1) ]);
    awayGrid.appendChild(box);
  });

  lineupCard.appendChild(el('div',{style:'font-weight:700;margin-top:6px;'},state.teamName));
  lineupCard.appendChild(homeGrid);
  lineupCard.appendChild(el('div',{style:'font-weight:700;margin-top:16px;'},'Gegner'));
  lineupCard.appendChild(awayGrid);
  main.appendChild(lineupCard);

  oppNums.addEventListener('change', ()=>{
    const nums = oppNums.value.split(',').map(s=>s.trim()).filter(Boolean);
    // Bestehende IDs für bereits vorhandene Nummern wiederverwenden, damit eine
    // nachträgliche Änderung des Feldes schon getroffene Aufstellungs-Auswahl nicht stillschweigend zerstört.
    const existing = {};
    setup.opponentPlayers.forEach(p=>{ existing[p.number]=p; });
    setup.opponentPlayers = nums.map(n=> existing[n] || {id:uid(), number:n, name:''});
    // Auswahllisten der Gegner-Positionen befüllen
    awayGrid.querySelectorAll('select').forEach((sel,idx)=>{
      const cur = sel.value;
      sel.innerHTML='';
      sel.appendChild(el('option',{value:''},'Pos '+(idx+1)));
      setup.opponentPlayers.forEach(p=> sel.appendChild(el('option',{value:p.id},'#'+p.number)));
      if(cur) sel.value=cur;
    });
  });

  const startBtn = el('button',{class:'btn block', style:'margin-top:6px', onclick:()=>{
    if(!setup.opponentName){ alert('Bitte Gegnernamen eingeben.'); return; }
    if(setup.opponentPlayers.length<6){ alert('Bitte mindestens 6 Gegner-Trikotnummern eingeben.'); return; }
    if(setup.homeLineup.some(x=>!x) || setup.awayLineup.some(x=>!x)){ alert('Bitte alle 6 Positionen für beide Teams festlegen.'); return; }

    const match = {
      id:uid(), date:Date.now(), opponentName:setup.opponentName, bestOf:setup.bestOf,
      opponentRoster: setup.opponentPlayers, status:'in_progress',
      sets: [ newSet(1, setup.homeLineup, setup.awayLineup, setup.servingTeam) ]
    };
    state.matches.push(match); saveState();
    go({name:'live', matchId:match.id});
  }},'Spiel starten');
  main.appendChild(startBtn);
}

function newSet(setNumber, homeLineup, awayLineup, servingTeam, initialSetterId){
  return {
    setNumber, homeScore:0, awayScore:0, homeLineup:[...homeLineup], awayLineup:[...awayLineup], servingTeam,
    rallies:[{actions:[]}], winner:null,
    // Unveränderliche Kopie der Start-Aufstellung dieses Satzes — nötig, um später aus einem
    // beliebigen Rotations-Schnappschuss (rally.homeRotation/awayRotation) die Rotationsnummer
    // 1–6 zu bestimmen (homeLineup/awayLineup selbst werden ja live weiterrotiert).
    startHomeLineup:[...homeLineup], startAwayLineup:[...awayLineup],
    // PHASE 5/6/7 (Zuspieler/Läufer/Wechsel-Historie): eigener, vom Trainer EXPLIZIT gesetzter
    // Zuspieler (nicht automatisch aus der Rotation abgeleitet) — wird bei einem Satzwechsel vom
    // vorherigen Satz übernommen (siehe closeRally), damit nicht jeden Satz neu ausgewählt werden muss.
    currentSetterId: initialSetterId || null,
    // Log aller Auswechslungen dieses Satzes (normal + Libero), u.a. für CSV-Export und die
    // Undo-Warnung ("seit dem letzten Ballwechsel wurde gewechselt") genutzt.
    substitutions: [],
    subSinceLastPoint: false,
  };
}

// PHASE 3 (Datenintegrität): stellt sicher, dass ein Satz IMMER eine gültige Start-Aufstellung
// besitzt. newSet() setzt startHomeLineup/startAwayLineup zwar immer, aber ältere/importierte
// Spielstände oder ein bisher nicht bekannter Randfall (z.B. manuell bearbeiteter localStorage-
// Inhalt) könnten diese Felder verlieren — computeRotationTable() würde einen solchen Satz dann
// komplett stillschweigend aus der Rotationsauswertung ausschließen. Statt das nur zu verstecken,
// wird hier bestmöglich repariert: aus der frühesten bekannten Rotations-Momentaufnahme dieses
// Satzes (rally.homeRotation/awayRotation der ersten bereits geschlossenen Rally), ersatzweise aus
// der aktuellen Aufstellung. So geht die Auswertung für diesen Satz nie mehr einfach "verloren".
function repairSet(set){
  if(!set) return set;
  if(!Array.isArray(set.homeLineup)) set.homeLineup = [];
  if(!Array.isArray(set.awayLineup)) set.awayLineup = [];
  if(!Array.isArray(set.startHomeLineup) || set.startHomeLineup.length!==6){
    const firstRally = (set.rallies||[]).find(r=>Array.isArray(r.homeRotation) && r.homeRotation.length===6);
    set.startHomeLineup = firstRally ? [...firstRally.homeRotation] : [...set.homeLineup];
  }
  if(!Array.isArray(set.startAwayLineup) || set.startAwayLineup.length!==6){
    const firstRally = (set.rallies||[]).find(r=>Array.isArray(r.awayRotation) && r.awayRotation.length===6);
    set.startAwayLineup = firstRally ? [...firstRally.awayRotation] : [...set.awayLineup];
  }
  if(!Array.isArray(set.substitutions)) set.substitutions = [];
  if(typeof set.subSinceLastPoint !== 'boolean') set.subSinceLastPoint = false;
  if(set.currentSetterId===undefined) set.currentSetterId = null;
  return set;
}
function repairMatch(match){
  if(!match || !Array.isArray(match.sets)) return match;
  match.sets.forEach(repairSet);
  return match;
}

/* ============================ App-Vorschau (Demo) ============================ */
// Zeigt die App sofort mit einem vorbereiteten Beispielspiel (beliebige Spielernamen, Satz 1+2
// bereits gespielt, 1:1), damit man sie ohne eigene Daten und ohne Zeitverlust vorstellen kann.
// Läuft komplett im Arbeitsspeicher (siehe demoMode/saveState/go) — die echten gespeicherten
// Daten des Nutzers werden dabei nie angerührt.

function demoHomeRoster(){
  return [
    {id:'demoH1', number:1, name:'Mia',  position:'Zuspiel'},
    {id:'demoH2', number:2, name:'Lea',  position:'Außen'},
    {id:'demoH3', number:3, name:'Nora', position:'Mitte'},
    {id:'demoH4', number:4, name:'Tia',  position:'Außen'},
    {id:'demoH5', number:5, name:'Ida',  position:'Mitte'},
    {id:'demoH6', number:6, name:'Zoe',  position:'Dia'},
    {id:'demoH7', number:7, name:'Ella', position:'Libero'}, // bewusst auf der Bank, zum Ausprobieren von "Wechsel"
  ];
}
function demoAwayRoster(){
  return [1,2,3,4,5,6,7].map(n=>({id:'demoA'+n, number:n, name:''}));
}

// Deterministischer Zufallszahlengenerator (mulberry32) — die Vorschau soll bei jedem Start immer
// dieselbe, aber realistisch aussehende Statistik zeigen (reproduzierbar, u.a. fürs Testen).
function mulberry32(seed){
  return function(){
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Punktevergabe + Rotation für EINE simulierte Rally — bewusst dieselbe Logik wie im "echten"
// closeRally() (Rotation nur beim Seitenwechsel, Aufschlagrecht wechselt mit), aber ohne dessen
// UI-Nebenwirkungen (kein go()/banner/saveState — die Vorschau läuft komplett im Speicher und wird
// erst am Ende einmal fertig zusammengebaut).
function demoApplyPoint(set, pointTo){
  const wasServing = set.servingTeam;
  const closingRally = set.rallies[set.rallies.length-1];
  closingRally.winningTeam = pointTo;
  closingRally.startServingTeam = wasServing;
  closingRally.homeRotation = [...set.homeLineup];
  closingRally.awayRotation = [...set.awayLineup];
  closingRally.homeScoreBefore = set.homeScore;
  closingRally.awayScoreBefore = set.awayScore;
  closingRally.setNumber = set.setNumber;
  if(pointTo==='home') set.homeScore++; else set.awayScore++;
  if(pointTo!==wasServing){
    if(pointTo==='home') set.homeLineup = rotate(set.homeLineup);
    else set.awayLineup = rotate(set.awayLineup);
    set.servingTeam = pointTo;
  }
}

// Simuliert einen kompletten Satz (bis 25, zwei Punkte Vorsprung) mit einem realistischen, aber
// bewusst überschaubaren Rally-Ablauf: Aufschlag -> Annahme -> Zuspiel -> Angriff -> ggf. einmal
// Block/Abwehr + Gegenangriff. Deckt dabei ALLE sechs Skills (S/R/A/B/D/E) für beide Teams ab und
// verteilt Start-/Zielpunkte breit über das ganze Feld (kontinuierlich statt nur ein paar feste
// Punkte) — wichtig, damit die feinere 36-Zonen-Heatmap in der Vorschau auch wirklich gefüllt aussieht.
function simulateSet(set, rng, homeSetterId, awaySetterId){
  const rnd = (a,b)=> a + rng()*(b-a);
  const pick = arr => arr[Math.floor(rng()*arr.length)];
  let tsCounter = 0;
  function mk(skill, team, pid, code, from, to, type){
    const a = { skill, team, playerId: pid, code, ts: Date.now()+(tsCounter++) };
    if(ZONE_SKILLS.includes(skill) && from && to){ a.fromPoint = from; a.toPoint = to; }
    if(type) a.type = type;
    return a;
  }
  // Zielbereich für einen Angriff/Aufschlag, der auf die Feldhälfte von "targetTeam" geht.
  function landingSpot(targetTeam){
    const x = rnd(4,96);
    const y = targetTeam==='home' ? rnd(70,126) : rnd(4,60);
    return {x: Math.round(x*10)/10, y: Math.round(y*10)/10};
  }
  function frontRowIdx(excludeId, lineup){
    return [1,2,3].filter(i=> lineup[i]!==excludeId);
  }
  function backRowIdx(excludeId, lineup){
    return [0,4,5].filter(i=> lineup[i]!==excludeId);
  }

  function simulateRally(){
    const rally = set.rallies[set.rallies.length-1];
    const serverTeam = set.servingTeam;
    const receiverTeam = serverTeam==='home' ? 'away' : 'home';
    const serverLineup = serverTeam==='home' ? set.homeLineup : set.awayLineup;
    const receiverLineup = receiverTeam==='home' ? set.homeLineup : set.awayLineup;
    const serverId = serverLineup[0];

    // 1) AUFSCHLAG
    const serveTarget = landingSpot(receiverTeam);
    const r1 = rng();
    if(r1 < 0.10){ // Ass
      rally.actions.push(mk('S', serverTeam, serverId, '#', positionCoord(serverTeam,1), serveTarget));
      return serverTeam;
    }
    if(r1 < 0.18){ // Aufschlagfehler
      rally.actions.push(mk('S', serverTeam, serverId, '=', positionCoord(serverTeam,1), serveTarget));
      return receiverTeam;
    }
    rally.actions.push(mk('S', serverTeam, serverId, pick(['+','+','!','-']), positionCoord(serverTeam,1), serveTarget));

    // 2) ANNAHME (Rückraum, nicht der/die Zuspieler:in)
    const receiverSetterId = receiverTeam==='home' ? homeSetterId : awaySetterId;
    const recvIdx = pick(backRowIdx(receiverSetterId, receiverLineup));
    const receiverId = receiverLineup[recvIdx];
    if(rng() < 0.05){ // Annahmefehler
      rally.actions.push(mk('R', receiverTeam, receiverId, '='));
      return serverTeam;
    }
    rally.actions.push(mk('R', receiverTeam, receiverId, pick(['#','#','+','+','!','-'])));

    // 3) ZUSPIEL
    const setterId = receiverTeam==='home' ? homeSetterId : awaySetterId;
    if(rng() < 0.02){ // sehr seltener Zuspielfehler
      rally.actions.push(mk('E', receiverTeam, setterId, '='));
      return serverTeam;
    }
    rally.actions.push(mk('E', receiverTeam, setterId, pick(['#','+','+','!'])));

    // 4) ANGRIFF (Rückraum-Zuspielerin greift so gut wie nie an)
    const attTeam1 = receiverTeam, defTeam1 = serverTeam;
    const attLineup1 = receiverLineup, defLineup1 = serverLineup;
    const att1Idx = pick(frontRowIdx(setterId, attLineup1));
    const att1Id = attLineup1[att1Idx];
    const att1From = positionCoord(attTeam1, att1Idx+1);
    const att1To = landingSpot(defTeam1);
    const r4 = rng();
    if(r4 < 0.38){ // Punkt
      rally.actions.push(mk('A', attTeam1, att1Id, '#', att1From, att1To, pick(ATTACK_TYPES)));
      return attTeam1;
    }
    if(r4 < 0.50){ // Fehler
      rally.actions.push(mk('A', attTeam1, att1Id, '=', att1From, att1To, pick(ATTACK_TYPES)));
      return defTeam1;
    }
    rally.actions.push(mk('A', attTeam1, att1Id, pick(['+','!','-']), att1From, att1To, pick(ATTACK_TYPES)));

    // 5) BLOCK-VERSUCH des verteidigenden Teams
    const defSetterId = defTeam1==='home' ? homeSetterId : awaySetterId;
    const blockIdx = pick(frontRowIdx(defSetterId, defLineup1));
    const blockId = defLineup1[blockIdx];
    if(rng() < 0.15){ // direkter Blockpunkt
      rally.actions.push(mk('B', defTeam1, blockId, '#', null, null, pick(BLOCK_TYPES)));
      return defTeam1;
    }

    // 6) ABWEHR (Rückraum des verteidigenden Teams) + verkürzter Gegenangriff, der die Rally sicher beendet
    const digIdx = pick(backRowIdx(defSetterId, defLineup1));
    const digId = defLineup1[digIdx];
    if(rng() < 0.05){ // Abwehrfehler
      rally.actions.push(mk('D', defTeam1, digId, '='));
      return attTeam1;
    }
    rally.actions.push(mk('D', defTeam1, digId, pick(['#','+','!'])));

    const att2Idx = pick(frontRowIdx(defSetterId, defLineup1));
    const att2Id = defLineup1[att2Idx];
    const att2From = positionCoord(defTeam1, att2Idx+1);
    const att2To = landingSpot(attTeam1);
    if(rng() < 0.6){
      rally.actions.push(mk('A', defTeam1, att2Id, '#', att2From, att2To, pick(ATTACK_TYPES)));
      return defTeam1;
    }
    rally.actions.push(mk('A', defTeam1, att2Id, '=', att2From, att2To, pick(ATTACK_TYPES)));
    return attTeam1;
  }

  while(true){
    const target = 25;
    const lead = Math.abs(set.homeScore - set.awayScore);
    if((set.homeScore>=target || set.awayScore>=target) && lead>=2) break;
    const winner = simulateRally();
    demoApplyPoint(set, winner);
    set.rallies.push({actions:[]});
  }
  // Die letzte (leere) Rally war nur der "nächste Ballwechsel" — für einen abgeschlossenen Satz
  // wieder entfernen, damit set.rallies exakt der Anzahl gespielter Punkte entspricht.
  set.rallies.pop();
  set.winner = set.homeScore>set.awayScore ? 'home':'away';
}

function buildDemoMatch(){
  const homePlayers = demoHomeRoster();
  const awayPlayers = demoAwayRoster();
  const homeLineup = homePlayers.slice(0,6).map(p=>p.id);
  const awayLineup = awayPlayers.slice(0,6).map(p=>p.id);
  const homeSetterId = homePlayers[0].id; // Mia — laut Kader "Zuspiel", auch als Coach-Live-Zuspielerin gesetzt
  const awaySetterId = awayPlayers[2].id; // fixe Stand-in-Zuspielerin für die Gegner-Statistik (kein eigenes Zuspieler-Feature für den Gegner)

  const rng = mulberry32(12345); // fester Seed -> jedes Mal dieselbe, aber realistische Vorschau

  const match = {
    id:'demo-match', date:Date.now(), opponentName:'Musterverein', bestOf:5,
    opponentRoster: awayPlayers, status:'in_progress',
    sets: []
  };

  // Zwei komplette, realistisch durchsimulierte Sätze (Stand nach Satz 2 typischerweise 1:1) —
  // Satz 3 bleibt bewusst frisch bei 0:0, damit direkt live weitergespielt werden kann (u.a. um
  // die Bank-Spielerin Ella als Libero einzuwechseln, siehe demoHomeRoster()).
  let curHomeLineup = homeLineup.slice();
  let curAwayLineup = awayLineup.slice();
  let servingTeam = 'home';
  for(let setNumber=1; setNumber<=2; setNumber++){
    const set = newSet(setNumber, curHomeLineup, curAwayLineup, servingTeam, homeSetterId);
    simulateSet(set, rng, homeSetterId, awaySetterId);
    match.sets.push(set);
    curHomeLineup = set.homeLineup;
    curAwayLineup = set.awayLineup;
    servingTeam = set.winner; // vereinfachte Regel, wie auch beim echten Satzübergang in closeRally()
  }
  match.sets.push(newSet(3, curHomeLineup, curAwayLineup, servingTeam, homeSetterId));

  return match;
}

function startDemo(){
  demoMode = true;
  state = { teamName:'Eintracht Frankfurt H3 (Demo)', roster: demoHomeRoster(), matches: [ buildDemoMatch() ] };
  go({name:'live', matchId:'demo-match'});
}

/* ============================ Live-Scouting ============================ */

function renderLive(header, main){
  const match = getMatch(route.matchId);
  if(!match){ go({name:'home'}); return; }
  const set = currentSet(match);
  const rally = set.rallies[set.rallies.length-1];

  header.appendChild(el('button',{class:'back', onclick:()=>go({name:'home'})}, demoMode ? '✕ Demo beenden' : '← Spiele'));
  header.appendChild(el('h1',{}, state.teamName+' – '+match.opponentName));
  header.appendChild(el('button',{class:'icon-btn', onclick:()=>go({name:'coachLive', matchId:match.id})},'🎯'));
  header.appendChild(el('button',{class:'icon-btn', onclick:()=>go({name:'stats', matchId:match.id})},'📊'));

  renderBanner(main);

  // Scoreboard
  const board = el('div',{class:'card'});
  const homeSets = match.sets.filter(s=>s.winner==='home').length;
  const awaySets = match.sets.filter(s=>s.winner==='away').length;
  board.appendChild(el('div',{style:'display:flex;justify-content:space-between;align-items:center;'},[
    el('div',{style:'text-align:center;flex:1'},[
      el('div',{style:'font-size:13px;color:var(--muted)'},state.teamName+(set.servingTeam==='home'?' 🏐':'')),
      el('div',{style:'font-size:40px;font-weight:800;color:var(--home)'}, String(set.homeScore))
    ]),
    el('div',{style:'text-align:center;color:var(--muted);font-size:13px'},['Satz '+set.setNumber, el('div',{},homeSets+':'+awaySets)]),
    el('div',{style:'text-align:center;flex:1'},[
      el('div',{style:'font-size:13px;color:var(--muted)'},match.opponentName+(set.servingTeam==='away'?' 🏐':'')),
      el('div',{style:'font-size:40px;font-weight:800;color:var(--away)'}, String(set.awayScore))
    ]),
  ]));
  board.appendChild(el('div',{style:'display:flex;gap:10px;margin-top:10px;'},[
    el('button',{class:'btn secondary', style:'flex:1', onclick:()=>manualPoint(match,'home')},'Punkt '+state.teamName),
    el('button',{class:'btn secondary', style:'flex:1', onclick:()=>manualPoint(match,'away')},'Punkt '+match.opponentName),
  ]));
  {
    const openRally = set.rallies[set.rallies.length-1];
    const undoLabel = openRally.actions.length>0
      ? '↩ Letzte Aktion rückgängig'
      : (match.pointHistory && match.pointHistory.length>0)
        ? '↩ Letzten Punkt rückgängig (Spielstand & Rotation)'
        : '↩ Rückgängig';
    board.appendChild(el('button',{class:'btn ghost block', style:'margin-top:8px', onclick:()=>undoLastAction(match)}, undoLabel));
  }
  main.appendChild(board);

  // Spielfeld: zeigt die Aufstellung UND dient direkt zum Erfassen einer Aktion — kein separates/
  // extra Feld mehr, alles läuft in dieser einen Karte. Bewusst DIREKT nach dem Spielstand (statt
  // erst nach dem seltener genutzten Wechsel-Bereich), damit die bei jedem Punkt gebrauchten
  // Buttons ohne zusätzliches Scrollen erreichbar sind.
  fieldSection(main, match, set);

  // Wechsel: eine Spielerin/ein Spieler auf einer Position gegen jemanden von der Bank tauschen.
  // Startet zugeklappt (nur der "🔄 Wechsel"-Button) — braucht dadurch kaum Platz, solange gerade
  // kein Wechsel läuft.
  substitutionSection(main, match, set);

  // Fehler-Erfassung: erscheint erst NACHDEM ein Punkt (egal ob per Feld-Tagging oder manuell)
  // erfasst wurde — dann optional Spieler(innen) des Teams, das den Punkt verloren hat, plus
  // getippter/diktierter Kommentar. Verschwindet wieder, sobald gesendet oder der nächste Punkt fällt.
  commentSection(main, match);

  // Aktionen dieser Rally
  const rallyCard = el('div',{class:'card'});
  rallyCard.appendChild(el('h2',{},'Aktuelle Rally'));
  if(rally.actions.length===0) rallyCard.appendChild(el('div',{class:'empty'},'Noch keine Aktion in dieser Rally.'));
  rally.actions.forEach(a=>{
    const ids = a.playerIds || (a.playerId ? [a.playerId] : []);
    const names = ids.map(pid=>playerName(a.team,pid,match)).join(', ');
    const skillLabel = (SKILL_MAP[a.skill]||{label:a.skill}).label;
    rallyCard.appendChild(el('div',{class:'list-item'},[
      el('div',{},[ el('strong',{}, skillLabel+' '), names||null, el('span',{class:'pill',style:'margin-left:8px'}, a.team==='home'?state.teamName:match.opponentName) ]),
      el('div',{style:'text-align:right'},[
        el('div',{style:'font-weight:800'}, a.code),
        a.type ? el('div',{style:'font-size:11px;color:var(--muted);max-width:170px;'}, a.type) : null
      ])
    ]));
  });
  main.appendChild(rallyCard);

  // Fehler-Notizen (Verlauf der gesendeten Kommentare aus der Fehler-Erfassung oben).
  errorNotesSection(main, match);

  // Statistik & Diagramme bleiben während des ganzen Spiels/Satzes erreichbar (nicht nur über die
  // separate Statistik-Seite), stehen aber standardmäßig zugeklappt — sie werden nicht bei jedem
  // einzelnen Punkt gebraucht und würden die Seite sonst stark in die Länge ziehen (mehr Scrollen).
  const statsToggleRow = el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin:18px 4px 4px;'},[
    el('div',{style:'font-weight:800;font-size:15px;color:var(--muted);'},'📊 Statistik (live)'),
    el('button',{class:'btn secondary btn-sm', onclick:()=>{ liveStatsExpanded = !liveStatsExpanded; render(); }}, liveStatsExpanded ? 'Einklappen ▲' : 'Anzeigen ▼'),
  ]);
  main.appendChild(statsToggleRow);
  if(liveStatsExpanded){
    renderRallyHistoryStrip(main, match);
    renderTeamAnalytics(main, match);
    renderRotationTable(main, match, 'home');
    renderStatTables(main, match);
    renderDirections(main, match);
  }

  const endCard = el('div',{class:'card'});
  endCard.appendChild(el('button',{class:'btn ghost block', onclick:()=>{
    if(confirm('Spiel wirklich beenden und speichern?')){ match.status='finished'; saveState(); go({name:'stats', matchId:match.id}); }
  }},'Spiel beenden'));
  main.appendChild(endCard);
}

// Einzige Spielfeld-Karte: zeigt im Ruhezustand die Aufstellung + die 6 Aktions-Buttons;
// sobald eine Aktion gewählt ist, wird dasselbe Feld interaktiv (Spieler antippen, dann
// bei Aufschlag/Angriff den Zielort antippen), gefolgt von der Bewertung — alles in einem Feld.
function fieldSection(main, match, set){
  const fieldCard = el('div',{class:'card'});
  fieldCard.appendChild(el('h2',{}, 'Spielfeld  ·  Blau: '+state.teamName+'  ·  Rot: '+match.opponentName));

  if(!tagging){
    // Ruhezustand: nur die 4 Schnell-Buttons + "+". Ein Klick auf Angriff/Block/Aufschlag/
    // Gegner-Fehler IST bereits ein Punkt — keine Bewertungsskala mehr nötig, stattdessen wird
    // danach nur noch die Art der Aktion gewählt.
    fieldCard.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:8px;'}, 'Ein Klick (außer +) ist direkt ein Punkt für das jeweilige Team.'));
    const grid = el('div',{class:'row field-quickgrid'});
    grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 45%;', onclick:()=>{ tagging = {quick:'A', team:null, playerId:'', fromPoint:null, toPoint:null}; render(); }}, 'Angriff'));
    grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 45%;', onclick:()=>{ tagging = {quick:'B', team:null, playerIds:[]}; render(); }}, 'Block'));
    grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 45%;', onclick:()=>{ tagging = {quick:'S', team:null, playerId:'', fromPoint:null, toPoint:null}; render(); }}, 'Aufschlag'));
    grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 45%;', onclick:()=>{ tagging = {quick:'OE', team:null}; render(); }}, 'Gegner-Fehler'));
    // PHASE 8: schnelle Annahme-Erfassung — Spieler + Qualität, direkt neben den anderen Schnell-
    // Buttons (statt nur versteckt in der ausführlichen "+"-Erfassung). Beendet KEINE Rally/keinen
    // Punkt, die ausführliche Erfassung über "+" bleibt vollständig unverändert erhalten.
    grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 45%;', onclick:()=>{ tagging = {quick:'R', team:null, playerId:''}; render(); }}, 'Annahme'));
    fieldCard.appendChild(fieldRow(buildCourt(set, match, {}), [grid], {grid2col:true}));
    fieldCard.appendChild(el('button',{class:'btn ghost block btn-sm', style:'margin-top:8px;', onclick:()=>{ tagging = {legacy:true, skillCode:null, team:null, playerId:'', fromPoint:null, toPoint:null}; render(); }}, '+ weitere Aktion (ausführlich, mit Bewertung)'));
  } else if(tagging.legacy){
    fieldLegacySection(fieldCard, match, set);
  } else if(tagging.quick==='OE'){
    fieldQuickOpponentErrorSection(fieldCard, match);
  } else if(tagging.quick==='B'){
    fieldQuickBlockSection(fieldCard, match, set);
  } else if(tagging.quick==='R'){
    fieldQuickReceptionSection(fieldCard, match, set);
  } else {
    fieldQuickAttackServeSection(fieldCard, match, set);
  }

  main.appendChild(fieldCard);
}

// Ausführliche Erfassung (der bisherige, vollständige Ablauf: alle 6 Skills + 5-stufige
// Bewertungsskala). Erreichbar über den "+"-Button, für alles was nicht in die 4 Schnell-Buttons
// passt (z.B. Annahme/Abwehr/Zuspiel einzeln festhalten, oder eine differenziertere Bewertung).
function fieldLegacySection(fieldCard, match, set){
  if(!tagging.skillCode){
    fieldCard.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:8px;'}, 'Weitere Aktion — ausführliche Erfassung mit Bewertung (perfekt/gut/neutral/schwach/Fehler).'));
    const skillGrid = el('div',{class:'row'});
    SKILLS.forEach(sk=>{
      skillGrid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 30%;', onclick:()=>{ tagging.skillCode = sk.code; render(); }}, sk.label));
    });
    fieldCard.appendChild(fieldRow(buildCourt(set, match, {}), [skillGrid], {grid2col:true}));
    fieldCard.appendChild(el('button',{class:'btn ghost block btn-sm', style:'margin-top:10px', onclick:()=>{ tagging=null; render(); }},'Abbrechen'));
    return;
  }

  const skill = SKILL_MAP[tagging.skillCode];
  const needsTarget = ZONE_SKILLS.includes(tagging.skillCode);
  // Bei Aufschlag/Annahme ist das Team durch die Spielsituation vorgegeben (nur diese Seite antippbar).
  const fixedTeam = tagging.skillCode==='S' ? set.servingTeam : (tagging.skillCode==='R' ? (set.servingTeam==='home'?'away':'home') : null);
  const canEval = tagging.playerId && (!needsTarget || (tagging.fromPoint && tagging.toPoint));

  let hintText;
  if(!tagging.playerId) hintText = 'Auf den Spieler im Feld tippen, der die Aktion ausgeführt hat.';
  else if(needsTarget && !tagging.fromPoint) hintText = 'Jetzt auf die Startposition tippen (wo der Ball gespielt wurde — auch in der Freizone möglich, z.B. Aufschlagzone).';
  else if(needsTarget && !tagging.toPoint) hintText = 'Jetzt auf die Zielposition tippen (wohin gespielt wurde).';
  else hintText = 'Bewertung wählen.';
  fieldCard.appendChild(el('div',{style:'color:var(--accent);font-weight:600;font-size:13px;margin-bottom:8px;'}, skill.label+' erfassen: '+hintText));

  const courtSvg = buildCourt(set, match, {
    selectableTeam: fixedTeam || 'both',
    onSelectPlayer: (team,pid)=>{ tagging.team=team; tagging.playerId=pid; tagging.fromPoint=null; tagging.toPoint=null; render(); },
    selectedPlayerId: tagging.playerId,
    onTapTarget: (needsTarget && tagging.playerId && !canEval) ? (x,y)=>{
      if(!tagging.fromPoint) tagging.fromPoint={x,y}; else tagging.toPoint={x,y};
      render();
    } : null,
    previewFrom: needsTarget ? tagging.fromPoint : null,
    previewTo: needsTarget ? tagging.toPoint : null,
    previewColor: '#facc15'
  });

  // Der "Position neu setzen"-Button bleibt bewusst AUSSERHALB der Auswahl-Fläche (nicht im Overlay)
  // — er kann nötig sein, während noch weiter im Feld getippt wird, und darf deshalb nie einen Teil
  // des Feldes verdecken, den der/die Trainer:in als Nächstes antippen will.
  const resetBtn = (needsTarget && tagging.playerId && (tagging.fromPoint || tagging.toPoint))
    ? el('button',{class:'btn ghost btn-sm block', style:'margin-top:8px;font-size:12px;', onclick:()=>{ tagging.fromPoint=null; tagging.toPoint=null; render(); }},'↺ Start-/Zielposition neu setzen')
    : null;

  // Die Bewertungsauswahl selbst erscheint erst, wenn im Feld nichts mehr angetippt werden muss
  // (Spieler + ggf. Start/Ziel stehen fest) — deshalb ist es hier unproblematisch, sie als Overlay
  // über einen Teil des (dann großen) Feldes zu legen: es wird ja nicht mehr weiter dort getippt.
  const actionEls = [];
  if(canEval){
    const evalRow = el('div',{class:'row eval-row'});
    EVALS.forEach(ev=>{
      evalRow.appendChild(el('button',{class:'btn secondary btn-sm '+ev.cls, style:'flex:1 1 18%;', onclick:()=>{
        if(!tagging.playerId){ alert('Bitte zuerst im Feld auf einen Spieler tippen.'); return; }
        if(needsTarget && (!tagging.fromPoint || !tagging.toPoint)){ alert('Bitte Start- und Zielposition im Feld antippen.'); return; }
        const t = tagging;
        tagging = null;
        logAction(match, t.skillCode, t.team, t.playerId, ev.code, t.fromPoint, t.toPoint);
      }}, ev.code+' '+ev.label));
    });
    actionEls.push(el('label',{},'Bewertung'));
    actionEls.push(evalRow);
  }
  fieldCard.appendChild(fieldRow(courtSvg, actionEls, {overlay:true}));
  if(resetBtn) fieldCard.appendChild(resetBtn);
  fieldCard.appendChild(el('button',{class:'btn ghost block btn-sm', style:'margin-top:10px', onclick:()=>{ tagging=null; render(); }},'Abbrechen'));
}

// Schnellerfassung Angriff/Aufschlag: Spieler + Start-/Zielposition (für die Richtungsdiagramme)
// antippen, danach direkt die Art wählen — das IST der Punkt, keine separate Bewertung nötig.
function fieldQuickAttackServeSection(fieldCard, match, set){
  const isServe = tagging.quick==='S';
  const label = isServe ? 'Aufschlag' : 'Angriff';
  const types = isServe ? SERVE_TYPES : ATTACK_TYPES;
  const fixedTeam = isServe ? set.servingTeam : null; // Aufschlag: nur das aufschlagende Team kann antippbar sein
  const canPickType = tagging.playerId && tagging.fromPoint && tagging.toPoint;

  let hintText;
  if(!tagging.playerId) hintText = 'Auf den Spieler im Feld tippen, der '+(isServe?'aufgeschlagen':'angegriffen')+' hat.';
  else if(!tagging.fromPoint) hintText = 'Startposition antippen (auch in der Freizone möglich).';
  else if(!tagging.toPoint) hintText = 'Zielposition antippen.';
  else hintText = 'Art wählen — das ist direkt der Punkt.';
  fieldCard.appendChild(el('div',{style:'color:var(--accent);font-weight:600;font-size:13px;margin-bottom:8px;'}, label+' erfassen: '+hintText));

  const courtSvg = buildCourt(set, match, {
    selectableTeam: fixedTeam || 'both',
    onSelectPlayer: (team,pid)=>{ tagging.team=team; tagging.playerId=pid; tagging.fromPoint=null; tagging.toPoint=null; render(); },
    selectedPlayerId: tagging.playerId,
    onTapTarget: (tagging.playerId && !canPickType) ? (x,y)=>{
      if(!tagging.fromPoint) tagging.fromPoint={x,y}; else tagging.toPoint={x,y};
      render();
    } : null,
    previewFrom: tagging.fromPoint,
    previewTo: tagging.toPoint,
    previewColor: '#facc15'
  });

  // Der "Position neu setzen"-Button bleibt bewusst AUSSERHALB der Auswahl-Fläche (nicht im Overlay)
  // — er kann nötig sein, während noch weiter im Feld getippt wird (Ziel fehlt noch), und darf
  // deshalb nie einen Teil des Feldes verdecken, den man als Nächstes antippen will.
  const resetBtn = (tagging.playerId && (tagging.fromPoint || tagging.toPoint))
    ? el('button',{class:'btn ghost btn-sm block', style:'margin-top:8px;font-size:12px;', onclick:()=>{ tagging.fromPoint=null; tagging.toPoint=null; render(); }},'↺ Start-/Zielposition neu setzen')
    : null;

  // Die Art-Auswahl selbst erscheint erst, wenn Spieler + Start/Ziel bereits feststehen — im Feld
  // muss dann nichts mehr angetippt werden, ein Overlay über einen Teil davon ist unproblematisch.
  const actionEls = [];
  if(canPickType){
    actionEls.push(el('label',{},'Art des '+label+'s'));
    const grid = el('div',{class:'row'});
    types.forEach(type=>{
      grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 45%;', onclick:()=>{
        const t = tagging;
        tagging = null;
        logQuickPoint(match, {skillCode:t.quick, team:t.team, playerId:t.playerId, type, fromPoint:t.fromPoint, toPoint:t.toPoint});
      }}, type));
    });
    actionEls.push(grid);
  }
  fieldCard.appendChild(fieldRow(courtSvg, actionEls, {overlay:true}));
  if(resetBtn) fieldCard.appendChild(resetBtn);
  fieldCard.appendChild(el('button',{class:'btn ghost block btn-sm', style:'margin-top:10px', onclick:()=>{ tagging=null; render(); }},'Abbrechen'));
}

// PHASE 8: Schnellerfassung Annahme — Spieler antippen, dann Qualität wählen (gleiche 5-stufige
// Skala wie die ausführliche Erfassung). Beendet die Rally NICHT (Annahme ist kein Punkt), daher
// logAction() statt logQuickPoint(). Die ausführliche Annahme-Erfassung über "+ weitere Aktion"
// bleibt unverändert bestehen — beide Wege schreiben dieselben Aktionen (skill:'R') und fließen
// identisch in computeStats()/die Annahme-Analyse ein: "Schnelle Live-Erfassung + detaillierte
// Analyse später".
function fieldQuickReceptionSection(fieldCard, match, set){
  const fixedTeam = set.servingTeam==='home' ? 'away' : 'home'; // die Annahme kommt immer vom nicht-aufschlagenden Team
  const hintText = tagging.playerId ? 'Annahmequalität wählen.' : 'Auf den Spieler im Feld tippen, der angenommen hat.';
  fieldCard.appendChild(el('div',{style:'color:var(--accent);font-weight:600;font-size:13px;margin-bottom:8px;'}, 'Annahme erfassen: '+hintText));

  const courtSvg = buildCourt(set, match, {
    selectableTeam: fixedTeam,
    onSelectPlayer: (team,pid)=>{ tagging.team=team; tagging.playerId=pid; render(); },
    selectedPlayerId: tagging.playerId,
  });

  const actionEls = [];
  if(tagging.playerId){
    const evalRow = el('div',{class:'row eval-row'});
    EVALS.forEach(ev=>{
      evalRow.appendChild(el('button',{class:'btn secondary btn-sm '+ev.cls, style:'flex:1 1 18%;', onclick:()=>{
        const t = tagging;
        tagging = null;
        logAction(match, 'R', t.team, t.playerId, ev.code, null, null);
      }}, ev.code+' '+ev.label));
    });
    actionEls.push(el('label',{},'Annahmequalität'));
    actionEls.push(evalRow);
  }
  fieldCard.appendChild(fieldRow(courtSvg, actionEls, {overlay:true}));
  fieldCard.appendChild(el('button',{class:'btn ghost block btn-sm', style:'margin-top:10px', onclick:()=>{ tagging=null; render(); }},'Abbrechen'));
}

// Schnellerfassung Block: bis zu 3 Spieler:innen DESSELBEN Teams antippen (Mehrfachblock),
// danach die Art wählen — das ist direkt der Punkt für das blockende Team.
function fieldQuickBlockSection(fieldCard, match, set){
  if(tagging.type){
    // Block-Art ist schon gewählt (das war bereits der Punkt) — optional, mit einem Tap
    // überspringbar: gegen welche:n Angreifer:in ging der Block? Ohne diese Zuordnung lässt sich
    // "geblockte Angriffe pro Spieler" (Angreiferseite) nicht auswerten.
    const opponentTeam = tagging.team==='home' ? 'away' : 'home';
    const opponentRoster = (opponentTeam==='home' ? state.roster : match.opponentRoster).slice().sort((a,b)=>a.number-b.number);
    fieldCard.appendChild(el('div',{style:'color:var(--accent);font-weight:600;font-size:13px;margin-bottom:8px;'}, 'Block: '+tagging.type));
    fieldCard.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:8px;'}, 'Optional: gegen wen ging der Block?'));
    const grid = el('div',{class:'row'});
    opponentRoster.forEach(p=>{
      grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 30%;', onclick:()=>{
        const t = tagging;
        tagging = null;
        logQuickPoint(match, {skillCode:'B', team:t.team, playerIds:t.playerIds, type:t.type, blockedPlayerId:p.id, blockedTeam:opponentTeam});
      }}, '#'+p.number+(p.name?(' '+p.name):'')));
    });
    fieldCard.appendChild(grid);
    fieldCard.appendChild(el('button',{class:'btn ghost block btn-sm', style:'margin-top:10px', onclick:()=>{
      const t = tagging;
      tagging = null;
      logQuickPoint(match, {skillCode:'B', team:t.team, playerIds:t.playerIds, type:t.type});
    }},'Ohne Zuordnung speichern'));
    return;
  }

  const hintText = tagging.playerIds.length===0
    ? 'Bis zu 3 Spieler:innen des blockenden Teams antippen.'
    : ('Ausgewählt: '+tagging.playerIds.length+'/3 — weitere antippen (gleiches Team) oder Art wählen.');
  fieldCard.appendChild(el('div',{style:'color:var(--accent);font-weight:600;font-size:13px;margin-bottom:8px;'}, 'Block erfassen: '+hintText));

  const courtSvg = buildCourt(set, match, {
    selectableTeam: tagging.team || 'both',
    onSelectPlayer: (team,pid)=>{
      if(tagging.team && team!==tagging.team){ alert('Bitte nur Spieler:innen von einem Team auswählen.'); return; }
      const idx = tagging.playerIds.indexOf(pid);
      if(idx>=0){
        tagging.playerIds.splice(idx,1);
        if(tagging.playerIds.length===0) tagging.team=null;
      } else {
        if(tagging.playerIds.length>=3){ alert('Maximal 3 Spieler:innen pro Block.'); return; }
        tagging.team = team;
        tagging.playerIds.push(pid);
      }
      render();
    },
    selectedPlayerId: tagging.playerIds,
  });

  const actionEls = [];
  if(tagging.playerIds.length>0){
    const chips = el('div',{class:'row'});
    tagging.playerIds.forEach(pid=>{
      chips.appendChild(el('span',{class:'pill'}, playerName(tagging.team,pid,match)));
    });
    actionEls.push(chips);
  }
  if(tagging.playerIds.length>0){
    actionEls.push(el('label',{},'Art des Blocks'));
    const grid = el('div',{class:'row'});
    BLOCK_TYPES.forEach(type=>{
      grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 45%;', onclick:()=>{ tagging.type = type; render(); }}, type));
    });
    actionEls.push(grid);
  }
  // Bewusst OHNE Overlay: bis zu 3 Spieler:innen können nacheinander angetippt werden, solange die
  // Art noch nicht gewählt ist — ein Overlay könnte dabei genau die Spielerkreise verdecken, die als
  // Nächstes noch angetippt werden sollen. Die Auswahl bleibt daher eine schmale, aber immer
  // sichtbare Spalte neben dem (weiterhin großen) Feld.
  fieldCard.appendChild(fieldRow(courtSvg, actionEls));
  fieldCard.appendChild(el('button',{class:'btn ghost block btn-sm', style:'margin-top:10px', onclick:()=>{ tagging=null; render(); }},'Abbrechen'));
}

// Schnellerfassung Gegner-Fehler: kein Spieler nötig — nur welches Team den Punkt bekommt,
// dann welche Art Fehler es beim Gegner war. Bei "Angriff ins Aus/Netz" wird danach optional
// (überspringbar) noch gefragt, wer den Fehler gemacht hat, für die Angriffsfehler-Statistik.
function fieldQuickOpponentErrorSection(fieldCard, match){
  fieldCard.appendChild(el('div',{style:'color:var(--accent);font-weight:600;font-size:13px;margin-bottom:8px;'}, 'Gegner-Fehler erfassen'));
  if(!tagging.team){
    fieldCard.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:8px;'}, 'Welches Team bekommt den Punkt?'));
    const row = el('div',{class:'row'});
    row.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1', onclick:()=>{ tagging.team='home'; render(); }}, state.teamName));
    row.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1', onclick:()=>{ tagging.team='away'; render(); }}, match.opponentName));
    fieldCard.appendChild(row);
  } else if(tagging.type){
    // Nur für Angriffsfehler erreichbar (siehe unten) — optionale Spieler-Zuordnung.
    const erringTeam = tagging.team==='home' ? 'away' : 'home';
    const roster = (erringTeam==='home' ? state.roster : match.opponentRoster).slice().sort((a,b)=>a.number-b.number);
    fieldCard.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:8px;'}, tagging.type+' — optional: wer hat den Fehler gemacht?'));
    const grid = el('div',{class:'row'});
    roster.forEach(p=>{
      grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 30%;', onclick:()=>{
        const t = tagging;
        tagging = null;
        logQuickPoint(match, {skillCode:'OE', team:t.team, type:t.type, errorPlayerId:p.id, errorTeam:erringTeam});
      }}, '#'+p.number+(p.name?(' '+p.name):'')));
    });
    fieldCard.appendChild(grid);
    fieldCard.appendChild(el('button',{class:'btn ghost block btn-sm', style:'margin-top:10px', onclick:()=>{
      const t = tagging;
      tagging = null;
      logQuickPoint(match, {skillCode:'OE', team:t.team, type:t.type});
    }},'Ohne Zuordnung speichern'));
    return;
  } else {
    fieldCard.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:8px;'}, 'Fehlerart des Gegners wählen:'));
    const grid = el('div',{class:'row'});
    OPP_ERROR_TYPES.forEach(type=>{
      grid.appendChild(el('button',{class:'btn secondary btn-sm', style:'flex:1 1 45%;', onclick:()=>{
        if(OE_ATTACK_ERROR_TYPES.includes(type)){ tagging.type = type; render(); return; }
        const t = tagging;
        tagging = null;
        logQuickPoint(match, {skillCode:'OE', team:t.team, type});
      }}, type));
    });
    fieldCard.appendChild(grid);
  }
  fieldCard.appendChild(el('button',{class:'btn ghost block btn-sm', style:'margin-top:10px', onclick:()=>{ tagging=null; render(); }},'Abbrechen'));
}

// Phase 5: Kompakter, rein deskriptiver Zahlenvergleich zweier Spieler:innen (z.B. im Wechsel-Dialog
// "raus" vs. "rein") — zeigt Angriffseffizienz + rohe Skill-Zahlen nebeneinander, ohne eine
// Empfehlung auszusprechen ("beobachten"/"auffällig" o.ä. bleibt den Insights in Phase 7 vorbehalten,
// und selbst dort nie als Handlungsanweisung). Funktioniert auch für Bank-Spieler:innen ohne jede
// bisherige Aktion (computeStats() legt für den gesamten Kader immer einen Eintrag an).
function playerCompareBox(outId, outStats, inId, inStats){
  const wrap = el('div',{style:'margin-top:12px;padding-top:10px;border-top:1px solid var(--line);'});
  wrap.appendChild(el('div',{style:'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;'},'Vergleich (nur Zahlen)'));
  const row = el('div',{style:'display:flex;gap:10px;'});
  [{label:'Raus', s:outStats},{label:'Rein', s:inStats}].forEach(side=>{
    const att = playerAttackSummary(side.s);
    const box = el('div',{style:'flex:1;background:var(--bg2);border-radius:10px;padding:10px;'});
    box.appendChild(el('div',{style:'font-size:11px;color:var(--muted);'}, side.label));
    box.appendChild(el('div',{style:'font-weight:700;'}, '#'+side.s.number+(side.s.name?(' '+side.s.name):'')));
    box.appendChild(el('div',{style:'font-size:13px;margin-top:6px;'}, 'Angriff: '+(att.efficiencyPct==null?'–':att.efficiencyPct+'%')+' ('+att.points+'/'+att.attempts+')'));
    box.appendChild(el('div',{style:'font-size:12px;color:var(--muted);'}, 'Fehler: '+att.errors+(att.blocked?' · geblockt: '+att.blocked:'')));
    ['S','R','B'].forEach(sk=>{
      const sd = side.s.bySkill[sk];
      if(sd) box.appendChild(el('div',{style:'font-size:12px;color:var(--muted);'}, SKILL_MAP[sk].label+': '+sd.total+' ('+sd.perfect+'✓/'+sd.error+'✗)'));
    });
    row.appendChild(box);
  });
  wrap.appendChild(row);
  return wrap;
}

// Wechsel: Spieler:in auf einer Feldposition gegen jemanden von der Bank tauschen. Der/die
// Eingewechselte übernimmt genau den Rotationsplatz der/des Ausgewechselten, damit die Rotation
// danach weiter korrekt nach den Volleyball-Regeln läuft.
function substitutionSection(main, match, set){
  const card = el('div',{class:'card'});
  const headRow = el('div',{style:'display:flex;justify-content:space-between;align-items:center;gap:8px;'});
  headRow.appendChild(el('h2',{style:'margin:0'},'Wechsel'));
  headRow.appendChild(el('button',{class:'btn secondary', onclick:()=>{
    subbing = subbing ? null : {team:'home', posIdx:0, newPlayerId:'', isLibero:false};
    render();
  }}, subbing ? 'Schließen' : '🔄 Wechsel'));
  card.appendChild(headRow);

  if(subbing){
    const teamSel = el('select',{},[
      el('option',{value:'home'}, state.teamName),
      el('option',{value:'away'}, match.opponentName),
    ]);
    teamSel.value = subbing.team;
    teamSel.addEventListener('change', e=>{ subbing.team = e.target.value; subbing.posIdx = 0; subbing.newPlayerId=''; render(); });
    card.appendChild(el('label',{style:'margin-top:8px'},'Team'));
    card.appendChild(teamSel);

    const lineup = subbing.team==='home' ? set.homeLineup : set.awayLineup;
    const posSel = el('select',{}, lineup.map((pid,idx)=> el('option',{value:String(idx)}, 'Pos '+(idx+1)+' — '+playerName(subbing.team,pid,match))));
    posSel.value = String(subbing.posIdx);
    posSel.addEventListener('change', e=>{ subbing.posIdx = Number(e.target.value); render(); });
    card.appendChild(el('label',{},'Position / Spieler:in raus'));
    card.appendChild(posSel);

    const bench = subbing.team==='home'
      ? state.roster.filter(p=>!set.homeLineup.includes(p.id))
      : match.opponentRoster.filter(p=>!set.awayLineup.includes(p.id));
    const benchSel = el('select',{}, [el('option',{value:''},'Spieler:in wählen'), ...bench.map(p=>el('option',{value:p.id}, '#'+p.number+(p.name?(' '+p.name):'')))]);
    benchSel.value = subbing.newPlayerId||'';
    benchSel.addEventListener('change', e=>{ subbing.newPlayerId = e.target.value; render(); });
    card.appendChild(el('label',{},'Spieler:in rein (Bank)'));
    card.appendChild(benchSel);

    if(bench.length===0){
      card.appendChild(el('div',{class:'empty'},'Keine weiteren Spieler:innen auf der Bank.'));
    }

    // Phase 5: sobald raus/rein feststeht, ein rein deskriptiver Zahlenvergleich — die App bewertet
    // oder empfiehlt hier bewusst nichts, das bleibt die Entscheidung des Co-Trainers.
    if(subbing.newPlayerId){
      const outId = lineup[subbing.posIdx];
      const stats = computeStats(match);
      const outP = stats[subbing.team][outId];
      const inP = stats[subbing.team][subbing.newPlayerId];
      if(outP && inP) card.appendChild(playerCompareBox(outId, outP, subbing.newPlayerId, inP));
    }

    // PHASE 7 (Libero): ein Libero-Wechsel ist volleyballregel-technisch etwas anderes als eine
    // reguläre taktische Auswechslung (unbegrenzt wiederholbar, zählt nicht gegen das Sub-Limit) —
    // daher separat markierbar, statt einen ganz neuen Dialog zu bauen.
    const liberoRow = el('label',{style:'display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;'});
    const liberoChk = el('input',{type:'checkbox'});
    liberoChk.checked = !!subbing.isLibero;
    liberoChk.addEventListener('change', e=>{ subbing.isLibero = e.target.checked; render(); });
    liberoRow.appendChild(liberoChk);
    liberoRow.appendChild(document.createTextNode('Dies ist ein Libero-Wechsel (zählt nicht als reguläre Auswechslung)'));
    card.appendChild(liberoRow);

    card.appendChild(el('button',{class:'btn block', style:'margin-top:10px', onclick:()=>{
      if(!subbing.newPlayerId){ alert('Bitte eine Spielerin/einen Spieler von der Bank auswählen.'); return; }
      const lu = subbing.team==='home' ? set.homeLineup : set.awayLineup;
      const outId = lu[subbing.posIdx];
      const inId = subbing.newPlayerId;
      const type = subbing.isLibero ? 'libero' : 'normal';
      if(type==='normal'){
        const usedNormal = (set.substitutions||[]).filter(s=>s.team===subbing.team && s.type==='normal').length;
        if(usedNormal >= MAX_NORMAL_SUBS_PER_SET){
          const teamName = subbing.team==='home' ? state.teamName : match.opponentName;
          if(!confirm('Achtung: Dies wäre bereits die '+(usedNormal+1)+'. reguläre Auswechslung von '+teamName+' in diesem Satz (üblich max. '+MAX_NORMAL_SUBS_PER_SET+'). Trotzdem durchführen?')) return;
        }
      }
      lu[subbing.posIdx] = inId;
      set.substitutions = set.substitutions || [];
      set.substitutions.push({ts:Date.now(), team:subbing.team, posIdx:subbing.posIdx, outId, inId, type});
      set.subSinceLastPoint = true; // Section 18: Grundlage für die Undo-Warnung
      saveState();
      subbing = null;
      render();
    }},'Wechsel durchführen'));
  }

  main.appendChild(card);
}

function logAction(match, skillCode, team, playerId, code, fromPoint, toPoint){
  const set = currentSet(match);
  const rally = set.rallies[set.rallies.length-1];
  const action = {skill:skillCode, team, playerId, code, ts:Date.now()};
  if(ZONE_SKILLS.includes(skillCode) && toPoint){
    action.toPoint = {x:Math.round(toPoint.x*10)/10, y:Math.round(toPoint.y*10)/10};
    // Start- und Zielposition werden jetzt frei im Feld angetippt (statt automatisch aus der
    // Rotationsposition abgeleitet), da die echte Spielerposition leicht von der App-Position abweichen kann.
    action.fromPoint = fromPoint ? {x:Math.round(fromPoint.x*10)/10, y:Math.round(fromPoint.y*10)/10} : originFor(team, playerId, skillCode, set);
  }
  rally.actions.push(action);
  saveState();

  if(code==='='){
    // Die Aktion selbst war der Fehler des agierenden Teams -> Punkt geht ans andere Team.
    const winningTeam = team==='home'?'away':'home';
    lastPointRally = { matchId: match.id, rally, winningTeam };
    commenting = null;
    closeRally(match, winningTeam);
  } else if(code==='#' && POINT_ON_PERFECT.includes(skillCode)){
    lastPointRally = { matchId: match.id, rally, winningTeam: team };
    commenting = null;
    closeRally(match, team);
  } else {
    render();
  }
}

// Merkt sich vor jedem gewerteten Punkt den kompletten Vorzustand (alle Sätze + Spielstatus),
// damit ein bereits gewerteter Punkt (inkl. Spielstand, Rotation, Aufschlagrecht und ggf.
// Satz-/Spielende) exakt rückgängig gemacht werden kann — kein Nachrechnen der Rotation nötig,
// einfach den letzten Schnappschuss wiederherstellen.
function pushPointHistory(match){
  match.pointHistory = match.pointHistory || [];
  match.pointHistory.push({ sets: JSON.parse(JSON.stringify(match.sets)), status: match.status });
  if(match.pointHistory.length > 40) match.pointHistory.shift(); // Verlauf begrenzen
}

function undoLastPoint(match){
  if(!match.pointHistory || match.pointHistory.length===0){
    alert('Kein Punkt zum Rückgängigmachen vorhanden.');
    return;
  }
  // Section 18: falls seit dem letzten Ballwechsel bereits gewechselt wurde, deutlich davor warnen —
  // ein Undo würde diese Auswechslung mit zurücknehmen.
  const curSet = currentSet(match);
  const msg = (curSet && curSet.subSinceLastPoint)
    ? 'Seit dem letzten Ballwechsel wurde eine Auswechslung durchgeführt. Soll wirklich zurückgesetzt werden?'
    : 'Letzten Punkt wirklich rückgängig machen?\nSpielstand, Rotation und Aufschlagrecht (und ggf. Satz-/Spielende) werden zurückgesetzt.';
  if(!confirm(msg)) return;
  const snap = match.pointHistory.pop();
  match.sets = snap.sets;
  match.sets.forEach(repairSet); // Verteidigungslinie #3: direkt nach der Wiederherstellung absichern
  match.status = snap.status;
  lastPointRally = null;
  commenting = null;
  saveState();
  go({name:'live', matchId:match.id}); // auch von der Statistik-Seite aus zurück zur Live-Ansicht
}

// Schnellerfassung (Angriff/Block/Aufschlag/Gegner-Fehler): jede dieser Aktionen IST bereits der
// Punkt, daher direkt loggen und die Rally schließen — keine Bewertungsskala, stattdessen die Art
// der Aktion (opts.type) als Freitext-Tag. playerIds (Array) für Block (bis zu 3 Spieler:innen),
// playerId (einzeln) für Angriff/Aufschlag, keins von beidem für Gegner-Fehler.
function logQuickPoint(match, opts){
  const set = currentSet(match);
  const rally = set.rallies[set.rallies.length-1];
  const action = { skill: opts.skillCode, team: opts.team, code:'#', type: opts.type, ts: Date.now() };
  if(opts.playerIds && opts.playerIds.length) action.playerIds = opts.playerIds.slice();
  else if(opts.playerId) action.playerId = opts.playerId;
  if(opts.fromPoint && opts.toPoint){
    action.fromPoint = {x:Math.round(opts.fromPoint.x*10)/10, y:Math.round(opts.fromPoint.y*10)/10};
    action.toPoint = {x:Math.round(opts.toPoint.x*10)/10, y:Math.round(opts.toPoint.y*10)/10};
  }
  // Optionale Spieler-Zuordnung: wer hat bei einem Gegner-Fehler den Angriffsfehler gemacht, bzw.
  // welche:r gegnerische Angreifer:in wurde beim Block geblockt — beides freiwillig (siehe die
  // jeweiligen fieldQuick*-Funktionen), fließt in computeStats() in die Angriffsstatistik der
  // betroffenen Person ein, ohne die Punkt-/Team-Zuordnung der Aktion selbst zu verändern.
  if(opts.errorPlayerId){ action.errorPlayerId = opts.errorPlayerId; action.errorTeam = opts.errorTeam; }
  if(opts.blockedPlayerId){ action.blockedPlayerId = opts.blockedPlayerId; action.blockedTeam = opts.blockedTeam; }
  rally.actions.push(action);
  lastPointRally = { matchId: match.id, rally, winningTeam: opts.team };
  commenting = null;
  closeRally(match, opts.team);
}

function closeRally(match, pointTo){
  pushPointHistory(match);
  const set = currentSet(match);
  const wasServing = set.servingTeam;

  // Datengrundlage für Rotations-/Sideout-/Break- und Verlaufs-Auswertungen: an der geschlossenen
  // Rally selbst festhalten, wer zu diesem Zeitpunkt aufgeschlagen hat, welche Aufstellung beide
  // Teams hatten, wer gewonnen hat und wie der Spielstand VOR diesem Punkt war. Nur so bleibt das
  // später (auch nach weiteren Rotationen/Satzwechseln) rückwirkend korrekt auswertbar, ohne den
  // ganzen Satz von vorne "nachzuspielen". Alte, vor diesem Update gespeicherte Rallys haben diese
  // Felder nicht — Auswertungsfunktionen müssen das vertragen (einfach überspringen).
  const closingRally = set.rallies[set.rallies.length-1];
  closingRally.winningTeam = pointTo;
  closingRally.startServingTeam = wasServing;
  closingRally.homeRotation = [...set.homeLineup];
  closingRally.awayRotation = [...set.awayLineup];
  closingRally.homeScoreBefore = set.homeScore;
  closingRally.awayScoreBefore = set.awayScore;
  closingRally.setNumber = set.setNumber;

  if(pointTo==='home') set.homeScore++; else set.awayScore++;

  if(pointTo!==wasServing){
    // Seitenwechsel: Team, das den Punkt gewinnt (und nicht aufgeschlagen hat), rotiert und bekommt Aufschlag
    if(pointTo==='home') set.homeLineup = rotate(set.homeLineup);
    else set.awayLineup = rotate(set.awayLineup);
    set.servingTeam = pointTo;
  }

  const target = pointsToWinSet(match);
  const lead = Math.abs(set.homeScore-set.awayScore);
  if((set.homeScore>=target || set.awayScore>=target) && lead>=2){
    set.winner = set.homeScore>set.awayScore ? 'home':'away';
    const homeWins = match.sets.filter(s=>s.winner==='home').length;
    const awayWins = match.sets.filter(s=>s.winner==='away').length;
    const win = setsToWin(match.bestOf);
    if(homeWins>=win || awayWins>=win){
      match.status='finished';
      saveState();
      banner = {text:'🏆 Spiel beendet! Endstand: '+homeWins+':'+awayWins};
      go({name:'stats', matchId:match.id});
      return;
    } else {
      // Neuer Satz - gleiche Startaufstellung wie zu Satzbeginn wird hier vereinfachend beibehalten (letzte Rotation),
      // Trainer kann bei Bedarf über "Aufstellung" künftig anpassen.
      const nextServe = set.winner; // vereinfachte Regel: Satzgewinner schlägt im Folgesatz auf (bei echtem Volleyball wechselt es je nach Satzstand)
      // Zuspieler-Zuordnung wird in den neuen Satz übernommen (muss nicht jeden Satz neu gesetzt
      // werden) — Rotation/Aufstellung bleiben davon wie gehabt unberührt.
      match.sets.push(newSet(set.setNumber+1, set.homeLineup, set.awayLineup, nextServe, set.currentSetterId));
      saveState();
      banner = {text:'✅ Satz beendet: '+set.homeScore+':'+set.awayScore+'. Weiter geht’s mit Satz '+(set.setNumber+1)+'.'};
    }
  } else {
    set.subSinceLastPoint = false; // die Auswechslung(en) vor diesem Punkt sind jetzt Teil der Historie
    set.rallies.push({actions:[]});
    saveState();
  }
  render();
}

function manualPoint(match, team){
  const set = currentSet(match);
  const rally = set.rallies[set.rallies.length-1];
  lastPointRally = { matchId: match.id, rally, winningTeam: team };
  commenting = null;
  closeRally(match, team);
}

// Fehler-Erfassung: erscheint erst NACHDEM ein Punkt gefallen ist (egal ob per Feld-Tagging mit
// Spieler+Linie, oder per manuellem Punkt-Button) — dann optional eine/mehrere Spieler:innen des
// Teams auswählen, das den Punkt verloren hat, dazu einen getippten/diktierten Kommentar.
function commentSection(main, match){
  if(!lastPointRally || lastPointRally.matchId!==match.id) return;
  const rally = lastPointRally.rally;
  if(rally.comment) return; // schon erfasst — Button verschwindet

  const erringTeam = lastPointRally.winningTeam==='home' ? 'away' : 'home';
  const erringTeamName = erringTeam==='home' ? state.teamName : match.opponentName;

  const card = el('div',{class:'card'});

  if(!commenting){
    card.appendChild(el('button',{class:'btn secondary block', onclick:()=>{ commenting = {playerIds:[], text:''}; render(); }},'⚠️ Fehler erfassen'));
    main.appendChild(card);
    return;
  }

  card.appendChild(el('h2',{},'Fehler: '+erringTeamName));
  const roster = (erringTeam==='home' ? state.roster : match.opponentRoster).slice().sort((a,b)=>a.number-b.number);
  card.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:6px;'},'Spieler antippen, die den Fehler gemacht haben (einen oder mehrere, optional).'));
  const grid = el('div',{class:'row'});
  roster.forEach(p=>{
    const selected = commenting.playerIds.includes(p.id);
    grid.appendChild(el('button',{class: selected ? 'btn' : 'btn secondary', style:'flex:1 1 30%;', onclick:()=>{
      commenting.playerIds = selected ? commenting.playerIds.filter(id=>id!==p.id) : [...commenting.playerIds, p.id];
      render();
    }}, '#'+p.number+(p.name?(' '+p.name):'')));
  });
  card.appendChild(grid);

  const textarea = el('textarea',{rows:3, placeholder:'Was ist passiert? Über die Mikrofon-Taste der Tastatur diktieren oder tippen.',
    style:'width:100%;font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--bg2);color:inherit;margin-top:10px;box-sizing:border-box;'});
  textarea.value = commenting.text||'';
  textarea.addEventListener('input', e=>{ commenting.text = e.target.value; });
  card.appendChild(textarea);

  // Live-Diktat per Spracherkennung, wo der Browser das unterstützt (Chrome/Android). iPhones
  // (Safari) haben keine Web-Speech-API — dort einfach über die Mikrofon-Taste der Tastatur
  // direkt in das Textfeld diktieren, das funktioniert unabhängig davon immer.
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(SpeechRec){
    let recognizer = null, listening = false;
    const micBtn = el('button',{class:'btn secondary', style:'margin-top:8px;'}, '🎤 Diktieren starten');
    micBtn.addEventListener('click', ()=>{
      if(listening){ recognizer && recognizer.stop(); return; }
      recognizer = new SpeechRec();
      recognizer.lang = 'de-DE';
      recognizer.continuous = true;
      recognizer.interimResults = false;
      recognizer.onresult = (ev)=>{
        let added = '';
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          if(ev.results[i].isFinal) added += ev.results[i][0].transcript + ' ';
        }
        if(added.trim()){
          commenting.text = (commenting.text ? commenting.text+' ' : '') + added.trim();
          textarea.value = commenting.text;
        }
      };
      recognizer.onerror = ()=>{ listening=false; micBtn.textContent='🎤 Diktieren starten'; };
      recognizer.onend = ()=>{ listening=false; micBtn.textContent='🎤 Diktieren starten'; };
      recognizer.start();
      listening = true;
      micBtn.textContent = '⏹ Aufnahme stoppen';
    });
    card.appendChild(micBtn);
  } else {
    card.appendChild(el('div',{style:'color:var(--muted);font-size:11px;margin-top:8px;'},'Tipp: Über die Mikrofon-Taste auf der Tastatur kannst du direkt in dieses Feld diktieren.'));
  }

  const btnRow = el('div',{style:'display:flex;gap:10px;margin-top:12px;'});
  btnRow.appendChild(el('button',{class:'btn block', style:'flex:1', onclick:()=>{
    if(!commenting.text || !commenting.text.trim()){ alert('Bitte einen Kommentar eingeben oder diktieren.'); return; }
    rally.comment = { team: erringTeam, playerIds: commenting.playerIds.slice(), text: commenting.text.trim() };
    saveState();
    commenting = null;
    lastPointRally = null;
    render();
  }},'Senden'));
  btnRow.appendChild(el('button',{class:'btn ghost', style:'flex:1', onclick:()=>{ commenting=null; render(); }},'Verwerfen'));
  card.appendChild(btnRow);

  main.appendChild(card);
}

// Verlauf der gesendeten Fehler-Kommentare (neueste zuerst).
function errorNotesSection(main, match){
  const entries = [];
  match.sets.forEach(set=>{
    set.rallies.forEach(rally=>{
      if(rally.comment) entries.push({set, rally});
    });
  });
  if(entries.length===0) return;
  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'🗒 Fehler-Notizen'));
  entries.slice(-15).reverse().forEach(({set, rally})=>{
    const c = rally.comment;
    const teamName = c.team==='home' ? state.teamName : match.opponentName;
    const names = (c.playerIds||[]).map(pid=>playerName(c.team, pid, match)).join(', ');
    const row = el('div',{class:'list-item'});
    row.appendChild(el('div',{},[
      el('strong',{}, teamName+' '),
      names ? el('span',{class:'pill', style:'margin-left:4px'}, names) : null,
      el('span',{style:'color:var(--muted);margin-left:8px;font-size:12px;'}, 'Satz '+set.setNumber)
    ]));
    row.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-top:4px;'}, c.text));
    card.appendChild(row);
  });
  main.appendChild(card);
}

function undoLastAction(match){
  const set = currentSet(match);
  const rally = set.rallies[set.rallies.length-1];
  if(rally.actions.length>0){
    // Noch offene Rally: nur den letzten Tag (Spieler/Linie/Bewertung) zurücknehmen, es wurde
    // noch kein Punkt gewertet.
    rally.actions.pop();
    saveState(); render();
  } else if(match.pointHistory && match.pointHistory.length>0){
    // Die aktuelle Rally ist leer -> der letzte Punkt wurde bereits gewertet. Diesen komplett
    // rückgängig machen (Spielstand, Rotation, Aufschlagrecht, ggf. Satz-/Spielende).
    undoLastPoint(match);
  } else {
    alert('Nichts zum Rückgängigmachen.');
  }
}

/* ============================ Statistik ============================ */

// opts.setNumber: nur diesen Satz auswerten. opts.lastN: nur die letzten N Rallys (über alle
// betrachteten Sätze hinweg, in Spielreihenfolge) — für Trend-Vergleiche ("ganzes Spiel" vs.
// "letzte 10 Rallys"). Ohne opts: wie bisher das gesamte Spiel, inkl. der aktuell noch offenen
// Rally (damit die Live-Statistik weiterhin sofort mitläuft, auch bevor ein Punkt fällt).
function computeStats(match, opts={}){
  const stats = { home:{}, away:{} };
  ['home','away'].forEach(team=>{
    const roster = team==='home' ? state.roster : match.opponentRoster;
    roster.forEach(p=>{ stats[team][p.id] = { number:p.number, name:p.name||'', bySkill:{}, blockedAgainst:0 }; });
  });
  function ensure(team, pid){
    const t = stats[team];
    if(!t[pid]) t[pid] = { number: playerNumber(team,pid,match), name:'', bySkill:{}, blockedAgainst:0 };
    return t[pid];
  }
  function creditSkill(p, skill, code){
    if(!p.bySkill[skill]) p.bySkill[skill] = {total:0, perfect:0, good:0, neutral:0, poor:0, error:0};
    const s = p.bySkill[skill];
    s.total++;
    if(code==='#') s.perfect++;
    else if(code==='+') s.good++;
    else if(code==='!') s.neutral++;
    else if(code==='-') s.poor++;
    else if(code==='=') s.error++;
  }
  let sets = match.sets;
  if(opts.setNumber!=null) sets = sets.filter(s=>s.setNumber===opts.setNumber);
  let rallies = [];
  sets.forEach(set=> rallies.push(...set.rallies));
  if(opts.lastN!=null) rallies = rallies.slice(-opts.lastN);

  rallies.forEach(rally=>{
    rally.actions.forEach(a=>{
      // Block (Schnellerfassung) kann mehrere Spieler:innen haben (a.playerIds); alle anderen
      // Aktionen genau eine:n (a.playerId); Gegner-Fehler hat gar keine:n (ids bleibt leer).
      const ids = a.playerIds || (a.playerId ? [a.playerId] : []);
      ids.forEach(pid=> creditSkill(ensure(a.team, pid), a.skill, a.code));
      // Optionale Zuordnung bei Gegner-Fehler: der Angriffsfehler wird der Person angerechnet,
      // die ihn tatsächlich begangen hat (unter "A" als Fehler gezählt) — unabhängig davon,
      // welchem Team der Punkt selbst gutgeschrieben wird.
      if(a.errorPlayerId) creditSkill(ensure(a.errorTeam, a.errorPlayerId), 'A', '=');
      // Optionale Zuordnung beim Block: wer wurde geblockt — eigene Kennzahl, kein "Fehler" in
      // der Bewertungsskala, da hierfür keine allgemeingültige Einzelschuld existiert.
      if(a.blockedPlayerId) ensure(a.blockedTeam, a.blockedPlayerId).blockedAgainst++;
    });
  });
  return stats;
}

// Angriffs-Kennzahlen einer Person aus computeStats()-Rohdaten ableiten. "Versuche" gibt es in
// dieser App bewusst nicht im Data-Volley-Sinn (jede Ballberührung), da nur die punktentscheidende
// Aktion pro Rally erfasst wird — hier daher pragmatisch definiert als Punkte + Fehler + geblockte
// Angriffe. Effizienz-Formel wie vom Trainer vorgegeben: (Punkte − Fehler − geblockt) / Versuche.
function playerAttackSummary(p){
  const a = (p.bySkill && p.bySkill.A) || {total:0, perfect:0, error:0};
  const blocked = p.blockedAgainst||0;
  const attempts = a.total + blocked;
  return {
    points: a.perfect, errors: a.error, blocked, attempts,
    efficiencyPct: attempts ? Math.round((a.perfect - a.error - blocked)/attempts*100) : null,
  };
}

/* ============================ Automatische Analyse: Team / Rotation / Verlauf ============================ */
// Baut auf den in closeRally() an jeder geschlossenen Rally hinterlegten Feldern auf: winningTeam,
// startServingTeam, homeRotation/awayRotation (Aufstellungs-Schnappschuss), homeScoreBefore/
// awayScoreBefore, setNumber. Rallys aus der Zeit vor diesem Update haben diese Felder nicht und
// werden hier übersprungen — für bereits laufende Spiele füllt sich die Historie ab jetzt auf.

// Rotationsnummer (1–6) einer Aufstellungs-Momentaufnahme relativ zur Start-Aufstellung des Satzes.
// rotate() verschiebt jede Person um einen Index nach unten (Wraparound 0→5). Die Person, die zu
// Satzbeginn auf Position 1 (Index 0) stand, steht nach k Rotationen auf Index (6−k) mod 6 — daraus
// lässt sich k (und damit die Rotationsnummer k+1) eindeutig zurückrechnen, ohne den Satz von vorne
// nachzuspielen. Beispiel: 0 Rotationen → Index 0 → Rotation 1; 1 Rotation → Index 5 → Rotation 2; …
function rotationNumberOf(startLineup, currentLineup){
  if(!startLineup || !currentLineup) return null;
  const idx = currentLineup.indexOf(startLineup[0]);
  if(idx===-1) return null;
  return ((6 - idx) % 6) + 1;
}

// Klassifiziert, WIE eine geschlossene Rally entschieden wurde (Punktverteilung, Coach-Live,
// Insights, Verlaufsanzeige). Bei der Schnellerfassung ist das die (einzige) letzte Aktion; bei der
// ausführlichen "+"-Erfassung die Aktion, die die Rally per '#'-Punkt oder '='-Fehler beendet hat.
// Ein manueller "Punkt {Team}"-Klick hinterlässt keine Aktion — dann bleibt die Art unbekannt.
function pointTypeOf(rally){
  if(!rally.actions || rally.actions.length===0) return {category:'Manuell', skill:null};
  const last = rally.actions[rally.actions.length-1];
  if(last.skill==='OE') return {category:'Gegnerfehler', skill:'OE'};
  if(last.code==='='){
    const label = last.skill==='S' ? 'Aufschlagfehler' : last.skill==='R' ? 'Annahmefehler'
      : last.skill==='A' ? 'Angriffsfehler' : last.skill==='B' ? 'Blockfehler'
      : (SKILL_MAP[last.skill]||{label:last.skill}).label+'-Fehler';
    return {category:label, skill:last.skill};
  }
  if(last.code==='#' && last.skill==='S') return {category:'Ass', skill:'S'};
  if(last.code==='#' && last.skill==='A') return {category:'Angriffspunkt', skill:'A'};
  if(last.code==='#' && last.skill==='B') return {category:'Blockpunkt', skill:'B'};
  return {category:'Sonstiger Punkt', skill:last.skill};
}

// Flacht alle "neuen" (mit winningTeam getaggten) Rallys chronologisch ab, optional gefiltert auf
// einen Satz und/oder die letzten N Rallys — Basis für Sideout/Break, Rotationstabelle, Verlauf.
function computeRallyLog(match, opts={}){
  let log = [];
  match.sets.forEach(set=>{
    if(opts.setNumber!=null && set.setNumber!==opts.setNumber) return;
    set.rallies.forEach(rally=>{
      if(rally.winningTeam===undefined) return; // alte Rally ohne die neuen Felder
      log.push(rally);
    });
  });
  if(opts.lastN!=null) log = log.slice(-opts.lastN);
  return log;
}

// Team-Kennzahlen: Sideout %, Break %, Angriff/Block/Aufschlag-Summen + Effizienz, Fehlerzahlen,
// Punkteverteilung. Sideout%/Break% kommen aus dem Rally-Log (brauchen startServingTeam), die
// übrigen aus computeStats() mit denselben Filtern (opts wird 1:1 durchgereicht).
//   Sideout % = gewonnene Rallys, in denen das Team NICHT aufgeschlagen hat / alle solchen Rallys
//   Break %   = gewonnene Rallys, in denen das Team SELBST aufgeschlagen hat / alle solchen Rallys
function computeTeamAnalytics(match, opts={}){
  const log = computeRallyLog(match, opts);
  const stats = computeStats(match, opts);
  const result = {};
  ['home','away'].forEach(team=>{
    let sideoutWon=0, sideoutTotal=0, breakWon=0, breakTotal=0;
    const distribution = {};
    log.forEach(rally=>{
      const receiving = rally.startServingTeam!==team;
      if(receiving){ sideoutTotal++; if(rally.winningTeam===team) sideoutWon++; }
      else { breakTotal++; if(rally.winningTeam===team) breakWon++; }
      if(rally.winningTeam===team){
        const pt = pointTypeOf(rally);
        distribution[pt.category] = (distribution[pt.category]||0)+1;
      }
    });

    let attackPts=0, attackErr=0, attackAtt=0, aces=0, serveErr=0, blockPts=0, receptionErr=0, blockedAgainst=0;
    Object.values(stats[team]).forEach(p=>{
      const a=p.bySkill.A, s=p.bySkill.S, b=p.bySkill.B, r=p.bySkill.R;
      if(a){ attackPts+=a.perfect; attackErr+=a.error; attackAtt+=a.total; }
      if(s){ aces+=s.perfect; serveErr+=s.error; }
      if(b){ blockPts+=b.perfect; }
      if(r){ receptionErr+=r.error; }
      blockedAgainst += p.blockedAgainst||0;
    });
    attackAtt += blockedAgainst;

    // Team-Gesamtfehlerzahl direkt aus dem rohen Aktionslog (nicht aus den Spieler-Summen), damit
    // eine übersprungene optionale Spieler-Zuordnung (siehe fieldQuickOpponentErrorSection /
    // fieldQuickBlockSection) die TEAM-Zahl nicht verfälscht — die Person kann fehlen, der Fehler
    // selbst ist trotzdem gezählt.
    let totalErrors=0;
    log.forEach(rally=>{
      rally.actions.forEach(a=>{
        if(a.skill==='OE'){ if(a.team!==team) totalErrors++; }
        else if(a.code==='=' && a.team===team) totalErrors++;
      });
    });

    result[team] = {
      sideoutPct: sideoutTotal? Math.round(sideoutWon/sideoutTotal*100) : null, sideoutWon, sideoutTotal,
      breakPct: breakTotal? Math.round(breakWon/breakTotal*100) : null, breakWon, breakTotal,
      attackPts, attackErr, attackAtt, blockedAgainst,
      attackEff: attackAtt? Math.round((attackPts-attackErr-blockedAgainst)/attackAtt*100) : null,
      aces, serveErr, blockPts, receptionErr, totalErrors,
      distribution,
    };
  });
  return result;
}

// Rotationstabelle 1–6 für ein Team: gewonnene/verlorene Punkte, Differenz, Sideout%/Break%,
// Rallyanzahl — jeweils bezogen auf die Aufstellung, die das Team WÄHREND der jeweiligen Rally
// hatte (rally.homeRotation/awayRotation), nicht auf die aktuelle.
function computeRotationTable(match, team, opts={}){
  const log = computeRallyLog(match, opts);
  const table = {};
  for(let i=1;i<=6;i++) table[i] = {won:0, lost:0, rallies:0, sideoutWon:0, sideoutTotal:0, breakWon:0, breakTotal:0};
  log.forEach(rally=>{
    const set = match.sets.find(s=>s.setNumber===rally.setNumber);
    if(!set || !set.startHomeLineup) return; // Satz von vor diesem Update, keine Start-Aufstellung bekannt
    const startLineup = team==='home' ? set.startHomeLineup : set.startAwayLineup;
    const rotSnapshot = team==='home' ? rally.homeRotation : rally.awayRotation;
    const rot = rotationNumberOf(startLineup, rotSnapshot);
    if(!rot) return;
    const row = table[rot];
    row.rallies++;
    if(rally.winningTeam===team) row.won++; else row.lost++;
    const receiving = rally.startServingTeam!==team;
    if(receiving){ row.sideoutTotal++; if(rally.winningTeam===team) row.sideoutWon++; }
    else { row.breakTotal++; if(rally.winningTeam===team) row.breakWon++; }
  });
  Object.values(table).forEach(row=>{
    row.diff = row.won - row.lost;
    row.sideoutPct = row.sideoutTotal? Math.round(row.sideoutWon/row.sideoutTotal*100) : null;
    row.breakPct = row.breakTotal? Math.round(row.breakWon/row.breakTotal*100) : null;
  });
  return table;
}

// W/L-Verlauf (aus unserer/"home"-Sicht) — für die kompakte "Letzte Rallys"-Anzeige und um Momentum
// auf einen Blick erkennbar zu machen.
function computeWinLossHistory(match, opts={}){
  return computeRallyLog(match, opts).map(rally=> rally.winningTeam==='home' ? 'W' : 'L');
}

// Alle Richtungslinien eines Teams zusammen (unabhängig vom einzelnen Spieler), gefiltert auf
// EINEN Skill (S oder A) — Aufschlag- und Angriffsrichtungen sollen getrennte Diagramme sein.
function computeTeamDirections(match, skillCode){
  const dirs = { home:{lines:[]}, away:{lines:[]} };
  match.sets.forEach(set=>{
    set.rallies.forEach(rally=>{
      rally.actions.forEach(a=>{
        if(a.skill!==skillCode || !a.toPoint || !a.fromPoint) return;
        dirs[a.team].lines.push({ skill:a.skill, fromPoint:a.fromPoint, toPoint:a.toPoint, code:a.code });
      });
    });
  });
  return dirs;
}

// Wie computeTeamDirections, aber pro Spieler statt zusammengefasst — ebenfalls auf einen Skill gefiltert.
function computeDirections(match, skillCode){
  const dirs = { home:{}, away:{} };
  match.sets.forEach(set=>{
    set.rallies.forEach(rally=>{
      rally.actions.forEach(a=>{
        if(a.skill!==skillCode || !a.toPoint || !a.fromPoint) return;
        const t = dirs[a.team];
        if(!t[a.playerId]) t[a.playerId] = { number: playerNumber(a.team,a.playerId,match), lines:[] };
        t[a.playerId].lines.push({ skill:a.skill, fromPoint:a.fromPoint, toPoint:a.toPoint, code:a.code });
      });
    });
  });
  return dirs;
}

// Farbe der Linien richtet sich nach dem TEAM (nicht mehr nach der Bewertung des einzelnen Zugs):
// die Schnellerfassung zieht ohnehin so gut wie immer nur bei einem Punkt eine Linie (Fehler werden
// meist ohne Start-/Zielposition über "Gegner-Fehler" erfasst) — eine Grün/Grau/Rot-Unterscheidung
// nach Bewertung brachte dadurch kaum echten Zusatzwert. Stattdessen jetzt klar nach Team: Grün =
// eigenes Team, Rot = Gegner — auf einen Blick erkennbar, welche Linien wem gehören.
function directionSVG(playerDirs, team){
  const parts = [];
  parts.push('<rect x="2" y="2" width="96" height="126" fill="none" stroke="#3a4a6b" stroke-width="1"/>');
  parts.push('<line x1="2" y1="65" x2="98" y2="65" stroke="#3a4a6b" stroke-width="1.5"/>');
  const color = team==='home' ? '#22c55e' : '#ef4444';
  playerDirs.lines.forEach(l=>{
    const from = l.fromPoint, to = l.toPoint;
    parts.push(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}" stroke-width="1.4" stroke-opacity="0.85"/>`);
    parts.push(`<circle cx="${to.x}" cy="${to.y}" r="1.8" fill="${color}"/>`);
  });
  return `<svg viewBox="0 0 100 130" style="width:100%;height:auto;background:var(--bg2);border-radius:8px;display:block;">${parts.join('')}</svg>`;
}

// Überschriften je Skill für die (jetzt getrennten) Richtungsdiagramme.
const DIRECTION_TITLES = { S:'Aufschlagrichtungen', A:'Angriffsrichtungen' };

function renderDirections(main, match){
  // Aufschlag- und Angriffsrichtungen sind zwei getrennte Diagramm-Blöcke (je eigenes Set an Karten),
  // nicht mehr gemeinsam in einem Diagramm gemischt.
  ZONE_SKILLS.forEach(skillCode=>{
    const dirs = computeDirections(match, skillCode);
    const teamDirs = computeTeamDirections(match, skillCode);
    ['home','away'].forEach(team=>{
      const teamName = team==='home'?state.teamName:match.opponentName;
      const teamLines = teamDirs[team].lines;
      const entries = Object.entries(dirs[team]).filter(([id,d])=>d.lines.length>0);
      if(entries.length===0 && teamLines.length===0) return;
      const card = el('div',{class:'card printable'});
      card.appendChild(el('h2',{}, DIRECTION_TITLES[skillCode]+' · '+teamName));

      if(teamLines.length>0){
        card.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:4px;text-align:center;font-weight:700;'}, 'Team gesamt · '+teamName));
        card.appendChild(el('div',{style:'max-width:220px;margin:0 auto 16px;'}, el('div',{html: directionSVG({lines:teamLines}, team)})));
      }

      if(entries.length>0){
        card.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:6px;text-align:center;'}, 'Pro Spieler'));
        const grid = el('div',{style:'display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:12px;'});
        entries.sort((a,b)=> (a[1].number>b[1].number?1:-1)).forEach(([pid,d])=>{
          const box = el('div',{});
          box.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:4px;text-align:center;'}, '#'+d.number));
          box.appendChild(el('div',{html: directionSVG(d, team)}));
          grid.appendChild(box);
        });
        card.appendChild(grid);
      }
      card.appendChild(el('div',{style:'color:var(--muted); font-size:11px; margin-top:8px;'},'Linie = '+(skillCode==='S'?'Aufschlag':'Angriff')+'richtung (unten = eigene Seite, oben = Gegnerfeld). '+(team==='home'?'Grün = '+state.teamName:'Rot = '+teamName)+'.'));
      main.appendChild(card);
    });
  });
}

function renderStats(header, main){
  const match = getMatch(route.matchId);
  if(!match){ go({name:'home'}); return; }
  header.appendChild(el('button',{class:'back', onclick:()=>go({name:'home'})}, demoMode ? '✕ Demo beenden' : '← Spiele'));
  header.appendChild(el('h1',{},'Statistik'));
  // Section 22: Coach Live bleibt auch nach Spielende erreichbar (nutzt weiterhin die gespeicherten Daten).
  header.appendChild(el('button',{class:'icon-btn', onclick:()=>go({name:'coachLive', matchId:match.id})},'🎯'));
  if(match.status!=='finished'){
    header.appendChild(el('button',{class:'icon-btn', onclick:()=>go({name:'live', matchId:match.id})},'🏐'));
  }

  renderBanner(main);

  const homeSets = match.sets.filter(s=>s.winner==='home').length;
  const awaySets = match.sets.filter(s=>s.winner==='away').length;
  const summary = el('div',{class:'card'});
  summary.appendChild(el('h2',{},state.teamName+' vs '+match.opponentName));
  summary.appendChild(el('div',{style:'font-size:32px;font-weight:800;text-align:center;'}, homeSets+':'+awaySets));
  summary.appendChild(el('div',{style:'display:flex;justify-content:center;gap:14px;color:var(--muted);font-size:13px;flex-wrap:wrap;'},
    match.sets.map(s=>el('span',{}, 'S'+s.setNumber+': '+s.homeScore+'-'+s.awayScore))
  ));
  summary.appendChild(el('div',{class:'row', style:'margin-top:12px'},[
    el('button',{class:'btn secondary', style:'flex:1', onclick:()=>exportCSV(match)},'CSV exportieren'),
    el('button',{class:'btn secondary', style:'flex:1', onclick:()=>window.print()},'Als PDF drucken'),
  ]));
  if(match.status==='finished' && match.pointHistory && match.pointHistory.length>0){
    summary.appendChild(el('button',{class:'btn ghost block', style:'margin-top:8px', onclick:()=>undoLastPoint(match)},'↩ Letzten Punkt rückgängig (Spiel wieder öffnen)'));
  }
  main.appendChild(summary);

  renderTeamAnalytics(main, match);
  renderInsights(main, match);
  renderRotationTable(main, match, 'home');
  renderRotationTable(main, match, 'away');
  renderPlayerAttackTable(main, match, 'home');
  renderPlayerAttackTable(main, match, 'away');
  renderOpponentAnalysis(main, match);
  renderAttackHeatmap(main, match);
  renderStatTables(main, match);
  renderDirections(main, match);
}

// Kompakter W/L-Verlauf der letzten Rallys (aus unserer Sicht), auf einen Blick erkennbares
// Momentum. Klick auf eine Rally klappt ihre Details darunter ein/aus (kein Popup).
function renderRallyHistoryStrip(main, match){
  const log = computeRallyLog(match, {lastN:12});
  if(log.length===0) return;
  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'Letzte Rallys'));
  const row = el('div',{style:'display:flex;gap:4px;flex-wrap:wrap;'});
  log.forEach(rally=>{
    const win = rally.winningTeam==='home';
    const isOpen = expandedRally && expandedRally.matchId===match.id && expandedRally.rally===rally;
    const b = el('button',{
      class:'btn '+(win?'':'secondary'),
      style:'flex:0 0 auto;width:34px;height:34px;padding:0;font-weight:800;'+(win?'':'opacity:0.75;')+(isOpen?'outline:2px solid var(--accent);':''),
      onclick:()=>{ expandedRally = isOpen ? null : {matchId:match.id, rally}; render(); }
    }, win?'W':'L');
    row.appendChild(b);
  });
  card.appendChild(row);

  if(expandedRally && expandedRally.matchId===match.id && log.includes(expandedRally.rally)){
    const rally = expandedRally.rally;
    const pt = pointTypeOf(rally);
    const win = rally.winningTeam==='home';
    const winnerName = win ? state.teamName : match.opponentName;
    const scoreAfterHome = rally.homeScoreBefore + (win?1:0);
    const scoreAfterAway = rally.awayScoreBefore + (win?0:1);
    const detail = el('div',{style:'margin-top:10px;padding-top:10px;border-top:1px solid var(--line);font-size:13px;'});
    detail.appendChild(el('div',{},[el('strong',{},'Satz '+rally.setNumber+' · '+winnerName+' punktet'), ' — '+pt.category]));
    detail.appendChild(el('div',{style:'color:var(--muted);margin-top:4px;'}, rally.homeScoreBefore+':'+rally.awayScoreBefore+' → '+scoreAfterHome+':'+scoreAfterAway));
    card.appendChild(detail);
  }
  main.appendChild(card);
}

// Team-Kennzahlen: Sideout %, Break %, Angriffseffizienz, Fehler, Punkteverteilung — für beide
// Teams nebeneinander. Rundet keine Prozentwerte auf Nachkommastellen (siehe Grundprinzip: keine
// unnötigen Dezimalstellen), zeigt "–" statt 0/0, wenn es noch keine passende Situation gab.
function renderTeamAnalytics(main, match){
  const a = computeTeamAnalytics(match);
  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'📈 Team-Kennzahlen'));
  const wrap = el('div',{style:'display:flex;gap:14px;flex-wrap:wrap;'});
  ['home','away'].forEach(team=>{
    const t = a[team];
    const box = el('div',{style:'flex:1;min-width:220px;'});
    box.appendChild(el('div',{style:'font-weight:700;margin-bottom:6px;'}, team==='home'?state.teamName:match.opponentName));
    const line = (label,val)=> el('div',{style:'display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px solid var(--line);'},[
      el('span',{style:'color:var(--muted)'},label), el('span',{style:'font-weight:700'},val)
    ]);
    box.appendChild(line('Sideout %', t.sideoutPct==null?'–':t.sideoutPct+'% ('+t.sideoutWon+'/'+t.sideoutTotal+')'));
    box.appendChild(line('Break %', t.breakPct==null?'–':t.breakPct+'% ('+t.breakWon+'/'+t.breakTotal+')'));
    box.appendChild(line('Angriffseffizienz', t.attackEff==null?'–':t.attackEff+'% ('+t.attackPts+'/'+t.attackAtt+')'));
    box.appendChild(line('Aufschlag-Asse', String(t.aces)));
    box.appendChild(line('Aufschlagfehler', String(t.serveErr)));
    box.appendChild(line('Blockpunkte', String(t.blockPts)));
    box.appendChild(line('Angriffsfehler', String(t.attackErr)));
    box.appendChild(line('Annahmefehler', String(t.receptionErr)));
    box.appendChild(line('Fehler gesamt', String(t.totalErrors)));
    const distEntries = Object.entries(t.distribution).sort((x,y)=>y[1]-x[1]);
    if(distEntries.length){
      box.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-top:8px;'},'Punkteverteilung'));
      distEntries.forEach(([cat,n])=> box.appendChild(el('div',{style:'font-size:12px;display:flex;justify-content:space-between;'},[el('span',{},cat), el('span',{},String(n))])));
    }
    wrap.appendChild(box);
  });
  card.appendChild(wrap);
  card.appendChild(el('div',{style:'color:var(--muted);font-size:11px;margin-top:10px;'},'Sideout % = gewonnene Rallys ohne eigenen Aufschlag / alle solchen Rallys. Break % = gewonnene Rallys mit eigenem Aufschlag / alle solchen Rallys. Basiert nur auf Rallys, die nach dem Rotations-Update erfasst wurden.'));
  main.appendChild(card);
}

// Rotationstabelle 1–6 für ein Team — zeigt, welche Rotation aktuell funktioniert und welche nicht.
function renderRotationTable(main, match, team){
  const table = computeRotationTable(match, team);
  const hasAny = Object.values(table).some(r=>r.rallies>0);
  if(!hasAny) return; // z.B. ganz frisches Spiel oder nur alte Rallys ohne Rotations-Daten
  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'🔄 Rotation · '+(team==='home'?state.teamName:match.opponentName)));
  const tbl = el('table',{style:'width:100%;border-collapse:collapse;font-size:13px;'});
  tbl.appendChild(el('tr',{},[
    el('th',{style:thStyle()},'Rot.'), el('th',{style:thStyle()},'Gew.'), el('th',{style:thStyle()},'Verl.'),
    el('th',{style:thStyle()},'+/-'), el('th',{style:thStyle()},'Sideout'), el('th',{style:thStyle()},'Break')
  ]));
  for(let i=1;i<=6;i++){
    const r = table[i];
    const diffColor = r.diff>0 ? 'var(--home)' : (r.diff<0 ? 'var(--away)' : 'inherit');
    tbl.appendChild(el('tr',{},[
      el('td',{style:tdStyle()}, String(i)),
      el('td',{style:tdStyle()}, String(r.won)),
      el('td',{style:tdStyle()}, String(r.lost)),
      el('td',{style:tdStyle()+'font-weight:800;color:'+diffColor}, (r.diff>0?'+':'')+r.diff),
      el('td',{style:tdStyle()}, r.sideoutTotal? r.sideoutPct+'%' : '–'),
      el('td',{style:tdStyle()}, r.breakTotal? r.breakPct+'%' : '–'),
    ]));
  }
  card.appendChild(tbl);
  main.appendChild(card);
}

/* ============================ Phase 4: "Coach Live"-Dashboard ============================ */
// Eigene, sehr kompakte Ansicht für den Blick in 1-2 Sekunden während des Satzes — nur die
// Kennzahlen, die für eine Entscheidung im Moment relevant sind. Rein deskriptiv (nur Zahlen),
// keine Handlungsempfehlung — das kommt erst mit den vorsichtig formulierten "Insights" (Phase 7).
// Mindest-Versuchszahl, ab der eine einzelne Angriffs-Kennzahl überhaupt aussagekräftig ist —
// verhindert, dass eine einzelne Aktion (0% oder 100%) fälschlich als Muster erscheint.
const MIN_ATTACK_ATTEMPTS = 3;

// Bester und (nur falls wirklich auffällig schwach) "zu beobachtender" Angreifer eines Teams,
// aus den Rohdaten von computeStats() über playerAttackSummary() abgeleitet.
function bestAndWorstAttacker(stats, team){
  const entries = Object.entries(stats[team]).map(([pid,p])=>({
    pid, number:p.number, name:p.name,
    ...playerAttackSummary(p),
  })).filter(p=>p.attempts>=MIN_ATTACK_ATTEMPTS && p.efficiencyPct!=null);
  if(entries.length===0) return {best:null, worst:null};
  const sorted = [...entries].sort((a,b)=> b.efficiencyPct - a.efficiencyPct || b.points - a.points);
  const best = sorted[0];
  const worstCandidate = sorted[sorted.length-1];
  // "Beobachten" wird bewusst nur gezeigt, wenn die Effizienz wirklich negativ ist (mehr Fehler+
  // geblockt als Punkte) — nicht schon, wenn jemand einfach nicht der Beste ist.
  const worst = (worstCandidate && worstCandidate.pid!==best.pid && worstCandidate.efficiencyPct<0) ? worstCandidate : null;
  return {best, worst};
}

function renderCoachLive(header, main){
  const match = getMatch(route.matchId);
  if(!match){ go({name:'home'}); return; }
  const set = currentSet(match);

  header.appendChild(el('button',{class:'back', onclick:()=>go({name: match.status==='finished'?'stats':'live', matchId:match.id})}, match.status==='finished' ? '← Statistik' : '← Live'));
  header.appendChild(el('h1',{},'🎯 Coach Live'));

  const analytics = computeTeamAnalytics(match);
  const stats = computeStats(match);
  const home = analytics.home;
  const homeSets = match.sets.filter(s=>s.winner==='home').length;
  const awaySets = match.sets.filter(s=>s.winner==='away').length;

  // Kopfzeile: identischer Spielstand wie in der Live-Ansicht, damit nie zwei unterschiedliche
  // Zahlen an unterschiedlichen Stellen zu sehen sind.
  const head = el('div',{class:'card'});
  head.appendChild(el('div',{style:'display:flex;justify-content:space-between;align-items:baseline;'},[
    el('div',{style:'font-size:13px;color:var(--muted);font-weight:700;'}, 'Satz '+set.setNumber+' ('+homeSets+':'+awaySets+')'),
    el('div',{style:'font-size:30px;font-weight:800;'}, set.homeScore+':'+set.awayScore),
  ]));
  head.appendChild(el('div',{style:'text-align:right;font-size:12px;color:var(--muted);margin-top:2px;'},
    (set.servingTeam==='home'?state.teamName:match.opponentName)+' am Aufschlag 🏐'));
  main.appendChild(head);

  // 2x2-Kachelraster der wichtigsten Live-Kennzahlen — keine Nachkommastellen, "–" statt 0/0.
  function metricBox(label, value, sub){
    const children = [
      el('div',{style:'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;'}, label),
      el('div',{style:'font-size:24px;font-weight:800;margin-top:2px;'}, value),
    ];
    if(sub) children.push(el('div',{style:'font-size:11px;color:var(--muted);margin-top:2px;'}, sub));
    return el('div',{style:'background:var(--card2);border-radius:12px;padding:10px;text-align:center;'}, children);
  }
  const startLineup = set.startHomeLineup;
  const currentRot = startLineup ? rotationNumberOf(startLineup, set.homeLineup) : null;
  const rotRow = currentRot ? computeRotationTable(match,'home')[currentRot] : null;

  const grid = el('div',{class:'card'});
  grid.appendChild(el('div',{style:'display:grid;grid-template-columns:1fr 1fr;gap:10px;'},[
    metricBox('Sideout', home.sideoutPct==null?'–':home.sideoutPct+'%', home.sideoutTotal? home.sideoutWon+'/'+home.sideoutTotal : null),
    metricBox('Break', home.breakPct==null?'–':home.breakPct+'%', home.breakTotal? home.breakWon+'/'+home.breakTotal : null),
    metricBox('Angriff', home.attackEff==null?'–':home.attackEff+'%', home.attackAtt? home.attackPts+'/'+home.attackAtt : null),
    metricBox('Rotation', currentRot? String(currentRot) : '–', rotRow && rotRow.rallies? (rotRow.diff>0?'+':'')+rotRow.diff+' ('+rotRow.won+'S/'+rotRow.lost+'N)' : null),
  ]));
  main.appendChild(grid);

  // Auffällige Spieler:innen — nur Zahlen, bewusst zurückhaltend formuliert (siehe Kommentar oben).
  const {best, worst} = bestAndWorstAttacker(stats, 'home');
  const oppBest = bestAndWorstAttacker(stats, 'away').best;
  if(best || worst || oppBest){
    const card = el('div',{class:'card'});
    function line(label, p, color){
      return el('div',{style:'padding:8px 0;border-bottom:1px solid var(--line);'},[
        el('div',{style:'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;'}, label),
        el('div',{style:'font-size:14px;font-weight:700;margin-top:2px;'+(color?'color:'+color+';':'')},
          '#'+p.number+(p.name?' '+p.name:'')+' — '+p.efficiencyPct+'% ('+p.points+'/'+p.attempts+')'),
      ]);
    }
    if(best) card.appendChild(line('Bester Angriff', best, 'var(--home)'));
    if(worst) card.appendChild(line('Beobachten', worst, 'var(--away)'));
    if(oppBest) card.appendChild(line('Gegner auffällig', oppBest, null));
    main.appendChild(card);
  } else {
    main.appendChild(el('div',{class:'card empty'}, 'Noch zu wenige Angriffs-Daten (mind. '+MIN_ATTACK_ATTEMPTS+' Versuche pro Spieler:in) für eine Einschätzung.'));
  }

  // PHASE 5/6: Zuspieler/Läufer — kompakt, siehe currentSetterInfo() für die Ableitungslogik.
  const setterInfo = currentSetterInfo(match, set);
  const setterCard = el('div',{class:'card'});
  const setterLabel = setterInfo
    ? ('Zuspieler: #'+playerName('home',setterInfo.setterId,match)+(setterInfo.onCourt ? '' : ' – NICHT AUF DEM FELD'))
    : 'Zuspieler: – (noch nicht festgelegt)';
  setterCard.appendChild(el('button',{class:'btn secondary block', onclick:()=>{ zuspielerModal = {selectedId: setterInfo?setterInfo.setterId:''}; render(); }}, '🅉 '+setterLabel));
  if(setterInfo && setterInfo.onCourt){
    setterCard.appendChild(el('div',{style:'display:flex;gap:18px;margin-top:8px;font-size:13px;color:var(--muted);'},[
      el('div',{},'Position: '+setterInfo.position),
      el('div',{},'Läufer: '+setterInfo.laufer),
    ]));
  }
  main.appendChild(setterCard);

  if(zuspielerModal){
    const modalCard = el('div',{class:'card', style:'border:2px solid var(--accent);'});
    modalCard.appendChild(el('h2',{},'Zuspieler festlegen'));
    modalCard.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:8px;'},
      'Aktueller Zuspieler / '+(setterInfo? ('#'+playerNumber('home',setterInfo.setterId,match)) : '–')));
    const list = el('div',{class:'row'});
    state.roster.slice().sort((a,b)=>a.number-b.number).forEach(p=>{
      const selected = zuspielerModal.selectedId===p.id;
      list.appendChild(el('button',{class: selected?'btn':'btn secondary', style:'flex:1 1 30%;', onclick:()=>{ zuspielerModal.selectedId=p.id; render(); }}, '#'+p.number+(p.name?' '+p.name:'')));
    });
    modalCard.appendChild(list);
    const btnRow = el('div',{style:'display:flex;gap:10px;margin-top:12px;'});
    btnRow.appendChild(el('button',{class:'btn block', style:'flex:1', onclick:()=>{
      if(!zuspielerModal.selectedId){ alert('Bitte eine Spielerin/einen Spieler auswählen.'); return; }
      set.currentSetterId = zuspielerModal.selectedId; // Rotation bleibt unangetastet — nur die Rollenzuordnung ändert sich.
      saveState();
      zuspielerModal = null;
      render();
    }}, 'Als Zuspieler festlegen'));
    btnRow.appendChild(el('button',{class:'btn ghost', style:'flex:1', onclick:()=>{ zuspielerModal=null; render(); }}, 'Schließen'));
    modalCard.appendChild(btnRow);
    main.appendChild(modalCard);
  }

  renderRallyHistoryStrip(main, match);
}

// Phase 5: Angriffsanalyse pro Spieler:in eines Teams — sortiert nach Effizienz, damit auf einen
// Blick sichtbar ist, wer aktuell trifft und wer nicht. Nur Personen mit mindestens einem Versuch
// (Bank-Spieler:innen ohne jede Aktion würden sonst die Liste unnötig füllen).
function renderPlayerAttackTable(main, match, team){
  const stats = computeStats(match);
  const rows = Object.values(stats[team]).map(p=>({...p, ...playerAttackSummary(p)})).filter(p=>p.attempts>0);
  if(rows.length===0) return;
  rows.sort((a,b)=> (b.efficiencyPct==null?-999:b.efficiencyPct) - (a.efficiencyPct==null?-999:a.efficiencyPct));
  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'🏐 Angriffsanalyse · '+(team==='home'?state.teamName:match.opponentName)));
  const tbl = el('table',{style:'width:100%;border-collapse:collapse;font-size:13px;'});
  tbl.appendChild(el('tr',{},[
    el('th',{style:thStyle()},'#'), el('th',{style:thStyle()},'Pkt'), el('th',{style:thStyle()},'Fehl'),
    el('th',{style:thStyle()},'Gebl.'), el('th',{style:thStyle()},'Vers.'), el('th',{style:thStyle()},'Eff.'),
  ]));
  rows.forEach(p=>{
    tbl.appendChild(el('tr',{},[
      el('td',{style:tdStyle()}, '#'+p.number+(p.name?(' '+p.name):'')),
      el('td',{style:tdStyle()}, String(p.points)),
      el('td',{style:tdStyle()}, String(p.errors)),
      el('td',{style:tdStyle()}, String(p.blocked)),
      el('td',{style:tdStyle()}, String(p.attempts)),
      el('td',{style:tdStyle()+'font-weight:700'}, p.efficiencyPct==null?'–':p.efficiencyPct+'%'),
    ]));
  });
  card.appendChild(tbl);
  main.appendChild(card);
}

/* ============================ Phase 6: Gegneranalyse & Angriffs-Heatmap ============================ */

// Bevorzugte Angriffsart eines Teams, aus dem "type"-Feld der Schnellerfassung (z.B. "Rollshot",
// "Angriff über den Block") — nur bei Angriffen (Skill 'A') gesetzt.
function computeAttackTypeDistribution(match, team){
  const dist = {};
  match.sets.forEach(set=> set.rallies.forEach(rally=> rally.actions.forEach(a=>{
    if(a.team!==team || a.skill!=='A' || !a.type) return;
    dist[a.type] = (dist[a.type]||0)+1;
  })));
  return dist;
}

// Feinere Feldbereichs-Einteilung für die Heatmap: HEATMAP_GRID Spalten × HEATMAP_GRID Reihen je
// Hälfte (6×6 = 36 Zonen statt vorher 3×3 = 9, für mehr Präzision) — bewusst eine einfache
// Orientierungshilfe, keine offizielle FIVB-Zonennummerierung.
const HEATMAP_GRID = 6;
function courtZoneOf(point){
  if(!point) return null;
  const col = Math.max(0, Math.min(HEATMAP_GRID-1, Math.floor(point.x / (100/HEATMAP_GRID))));
  const onAwayHalf = point.y < 65;
  const rel = onAwayHalf ? (65-point.y)/65 : (point.y-65)/65; // 0 = netznah, 1 = Grundlinie
  const row = Math.max(0, Math.min(HEATMAP_GRID-1, Math.floor(rel*HEATMAP_GRID)));
  return { half: onAwayHalf?'away':'home', row, col, zone: row*HEATMAP_GRID+col };
}

// Angriffs-Heatmap: zählt erfasste Angriffe (mit Start-/Zielpunkt) je Landezone, getrennt nach
// Punkt und Fehler — filterbar nach Team/Spieler:in/Satz. In der Praxis landet ein Angriff so gut
// wie immer auf der gegnerischen Hälfte; beide Hälften werden hier zur einfacheren Anzeige auf
// dieselben 9 Zonen zusammengeführt (siehe renderAttackHeatmap).
function computeAttackHeatmap(match, opts={}){
  const zones = {};
  match.sets.forEach(set=>{
    if(opts.setNumber!=null && set.setNumber!==opts.setNumber) return;
    set.rallies.forEach(rally=> rally.actions.forEach(a=>{
      if(a.skill!=='A' || !a.toPoint) return;
      if(opts.team && a.team!==opts.team) return;
      if(opts.playerId && a.playerId!==opts.playerId) return;
      const z = courtZoneOf(a.toPoint);
      if(!z) return;
      if(!zones[z.zone]) zones[z.zone] = {zone:z.zone, total:0, point:0, error:0};
      zones[z.zone].total++;
      if(a.code==='#') zones[z.zone].point++;
      else if(a.code==='=') zones[z.zone].error++;
    }));
  });
  return zones;
}

// Gegneranalyse: bevorzugte Angriffsart + auffällig fehleranfällige Annahme-Spieler:innen (sofern
// über die ausführliche "+"-Erfassung Annahme-Daten vorliegen — die Schnellerfassung erfasst keine
// eigene Annahme-Aktion). Die eigentliche "stärkste Angreifer:in"-Liste liefert bereits
// renderPlayerAttackTable(main, match, 'away') und wird hier bewusst nicht dupliziert.
function renderOpponentAnalysis(main, match){
  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'🔎 Gegneranalyse · '+match.opponentName));

  const dist = computeAttackTypeDistribution(match, 'away');
  const distEntries = Object.entries(dist).sort((a,b)=>b[1]-a[1]);
  if(distEntries.length){
    card.appendChild(el('div',{style:'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:4px;'},'Bevorzugte Angriffsart'));
    distEntries.forEach(([type,n])=> card.appendChild(el('div',{style:'display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px solid var(--line);'},[
      el('span',{},type), el('span',{style:'font-weight:700'},String(n))
    ])));
  }

  const stats = computeStats(match);
  const weakReceivers = Object.values(stats.away)
    .filter(p=>p.bySkill.R && p.bySkill.R.total>=3)
    .map(p=>({...p, errRate: Math.round(p.bySkill.R.error/p.bySkill.R.total*100)}))
    .sort((a,b)=>b.errRate-a.errRate).slice(0,3);
  if(weakReceivers.length){
    card.appendChild(el('div',{style:'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:12px;'},'Annahme — auffällig'));
    weakReceivers.forEach(p=> card.appendChild(el('div',{style:'display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px solid var(--line);'},[
      el('span',{},'#'+p.number+(p.name?(' '+p.name):'')), el('span',{style:'font-weight:700'}, p.errRate+'% Fehler ('+p.bySkill.R.error+'/'+p.bySkill.R.total+')')
    ])));
  }

  if(distEntries.length===0 && weakReceivers.length===0){
    card.appendChild(el('div',{class:'empty'},'Noch zu wenige erfasste Angriffs-/Annahme-Daten des Gegners.'));
  }
  main.appendChild(card);
}

// Heatmap: je Team eine HEATMAP_GRID×HEATMAP_GRID-Kachel-Übersicht (36 Zonen), wo die erfassten
// Angriffe gelandet sind. Farbintensität relativ zur meistgenutzten Zone dieses Teams (rein visuell,
// keine absolute Skala). Bei so vielen, entsprechend kleinen Kacheln passt die Punkt/Fehler-
// Aufschlüsselung nicht mehr lesbar als Text hinein — die Gesamtzahl bleibt sichtbar, die
// Aufschlüsselung steht zusätzlich als Tooltip (title) auf der Kachel.
function renderAttackHeatmap(main, match){
  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'🔥 Angriffs-Heatmap'));
  card.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:8px;'},'Zielbereiche der erfassten Angriffe, in '+(HEATMAP_GRID*HEATMAP_GRID)+' Zonen ('+HEATMAP_GRID+'×'+HEATMAP_GRID+'). Zahl je Kachel = Gesamt, antippen/Maus drüber für Punkt ✓ / Fehler ✗. Oben = netznah, unten = Grundlinie.'));
  const wrap = el('div',{style:'display:flex;gap:16px;flex-wrap:wrap;'});
  ['home','away'].forEach(team=>{
    const zones = computeAttackHeatmap(match, {team});
    const cells = []; let maxTotal = 0;
    const zoneCount = HEATMAP_GRID*HEATMAP_GRID;
    for(let i=0;i<zoneCount;i++){ const z = zones[i]||{total:0,point:0,error:0}; cells.push(z); if(z.total>maxTotal) maxTotal = z.total; }
    const box = el('div',{style:'flex:1;min-width:200px;'});
    box.appendChild(el('div',{style:'font-weight:700;margin-bottom:6px;'}, (team==='home'?state.teamName:match.opponentName)+' greift an'));
    const grid = el('div',{style:'display:grid;grid-template-columns:repeat('+HEATMAP_GRID+',1fr);gap:2px;max-width:280px;'});
    cells.forEach(z=>{
      const alpha = z.total ? 0.15 + 0.65*(z.total/maxTotal) : 0.06;
      grid.appendChild(el('div',{
        title: z.total ? (z.total+' gesamt · '+z.point+' Punkt ✓ · '+z.error+' Fehler ✗') : 'Keine Angriffe in dieser Zone',
        style:'aspect-ratio:1;border-radius:3px;background:rgba(59,130,246,'+alpha.toFixed(2)+');display:flex;align-items:center;justify-content:center;'
      },[
        z.total ? el('div',{style:'font-weight:700;font-size:9.5px;'}, String(z.total)) : null,
      ]));
    });
    box.appendChild(grid);
    if(maxTotal===0) box.appendChild(el('div',{class:'empty', style:'padding:8px 0;'},'Noch keine Angriffe mit Zielpunkt erfasst.'));
    wrap.appendChild(box);
  });
  card.appendChild(wrap);
  main.appendChild(card);
}

/* ============================ Phase 7: Automatische Insights ============================ */
// Bewusst zurückhaltend formulierte Beobachtungen aus den bereits berechneten Kennzahlen — NIE als
// Handlungsanweisung ("wechseln!", "Taktik ändern!"), immer nur "auffällig"/"beobachten"/"aktuell".
// Die Entscheidung, ob und wie reagiert wird, bleibt beim Co-Trainer (siehe Grundprinzip der
// gesamten App: "Der Co-Trainer erfasst wenig. Die App denkt viel." — nicht "Die App entscheidet").
function computeInsights(match){
  const insights = [];
  const stats = computeStats(match);

  const rot = computeRotationTable(match, 'home');
  Object.entries(rot).forEach(([num,r])=>{
    if(r.rallies>=4 && r.diff<=-2){
      insights.push('Rotation '+num+' aktuell auffällig ('+r.won+' gewonnen, '+r.lost+' verloren in '+r.rallies+' Rallys).');
    }
  });

  Object.values(stats.home).forEach(p=>{
    const att = playerAttackSummary(p);
    if(att.attempts<MIN_ATTACK_ATTEMPTS || att.efficiencyPct==null) return;
    if(att.efficiencyPct>=50) insights.push('#'+p.number+(p.name?(' '+p.name):'')+' aktuell sehr effizient im Angriff ('+att.efficiencyPct+'%, '+att.points+'/'+att.attempts+').');
    else if(att.efficiencyPct<0) insights.push('#'+p.number+(p.name?(' '+p.name):'')+' aktuell wenig effizient im Angriff ('+att.efficiencyPct+'%) — möglicherweise beobachten.');
  });

  Object.values(stats.away).forEach(p=>{
    const att = playerAttackSummary(p);
    if(att.attempts<MIN_ATTACK_ATTEMPTS || att.efficiencyPct==null) return;
    if(att.efficiencyPct>=50) insights.push('Gegner #'+p.number+(p.name?(' '+p.name):'')+' aktuell sehr erfolgreich im Angriff ('+att.efficiencyPct+'%) — mögliche Option: gezielt verteidigen.');
  });

  const recent = computeTeamAnalytics(match, {lastN:6}).home;
  if(recent.totalErrors>=3){
    insights.push('In den letzten Rallys mehrere eigene Fehler ('+recent.totalErrors+') — evtl. beobachten.');
  }

  return insights;
}

function renderInsights(main, match){
  const insights = computeInsights(match);
  if(insights.length===0) return; // kein erzwungener Platzhalter — s. Grundprinzip "wenig erfassen, wenig unnötiger Text"
  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{},'💡 Insights'));
  insights.forEach(text=> card.appendChild(el('div',{style:'font-size:13px;padding:6px 0;border-bottom:1px solid var(--line);'}, text)));
  card.appendChild(el('div',{style:'color:var(--muted);font-size:11px;margin-top:8px;'},'Automatische Beobachtungen aus den erfassten Zahlen — keine Handlungsempfehlung, die Entscheidung bleibt bei dir.'));
  main.appendChild(card);
}

// Statistik-Tabellen pro Team — wird sowohl auf der eigenen Statistik-Seite als auch
// live während des Spiels (in renderLive) verwendet, damit nichts doppelt gepflegt wird.
function renderStatTables(main, match){
  const stats = computeStats(match);
  ['home','away'].forEach(team=>{
    const card = el('div',{class:'card printable'});
    card.appendChild(el('h2',{}, team==='home'?state.teamName:match.opponentName));
    const table = el('table',{style:'width:100%; border-collapse:collapse; font-size:13px;'});
    const head = el('tr',{},[
      el('th',{style:thStyle()},'#'),
      ...SKILLS.map(sk=>el('th',{style:thStyle()},sk.code))
    ]);
    table.appendChild(head);
    Object.values(stats[team]).sort((a,b)=>a.number-b.number).forEach(p=>{
      const row = [el('td',{style:tdStyle()}, '#'+p.number+(p.name?(' '+p.name):''))];
      SKILLS.forEach(sk=>{
        const s = p.bySkill[sk.code];
        if(!s){ row.push(el('td',{style:tdStyle()},'–')); return; }
        const eff = s.total? Math.round(((s.perfect - s.error)/s.total)*100) : 0;
        row.push(el('td',{style:tdStyle()}, s.total+' ('+eff+'%)'));
      });
      table.appendChild(el('tr',{}, row));
    });
    card.appendChild(table);
    card.appendChild(el('div',{style:'color:var(--muted); font-size:11px; margin-top:8px;'},'Zahlen = Aktionen gesamt, Klammer = Effizienz ((Perfekt−Fehler)/Aktionen). S=Aufschlag R=Annahme A=Angriff B=Block D=Abwehr E=Zuspiel.'));
    main.appendChild(card);
  });
}
function thStyle(){ return 'text-align:center;padding:6px 4px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:600;'; }
function tdStyle(){ return 'text-align:center;padding:6px 4px;border-bottom:1px solid var(--line);'; }

function exportCSV(match){
  // Section 21: CSV soll möglichst ALLE relevanten Rally-Daten enthalten, ohne bereits exportierte
  // Spalten zu verlieren — deshalb werden die bisherigen Spalten unverändert beibehalten und nur
  // ergänzt: Fehler-Zuordnung (wer hat den Fehler verursacht / wer wurde geblockt), Zuspieler/Läufer
  // zum Zeitpunkt der jeweiligen Rally, sowie eigene Zeilen für Auswechslungen (normal + Libero).
  let rows = [['Satz','Rally','Team','Skill','Art','Spieler','Bewertung','Von(x,y)','Ziel(x,y)','Fehler-Zuordnung','Kommentar','Zuspieler(Heim)','Läufer(Heim)']];
  match.sets.forEach(set=>{
    set.rallies.forEach((rally,ri)=>{
      let setterNum = '', laufer = '';
      if(set.currentSetterId){
        setterNum = playerNumber('home', set.currentSetterId, match);
        if(Array.isArray(rally.homeRotation)){
          const idx = rally.homeRotation.indexOf(set.currentSetterId);
          laufer = idx===-1 ? 'nicht auf Feld' : String(idx+1);
        }
      }
      rally.actions.forEach(a=>{
        const from = a.fromPoint ? (a.fromPoint.x+','+a.fromPoint.y) : '';
        const to = a.toPoint ? (a.toPoint.x+','+a.toPoint.y) : '';
        const ids = a.playerIds || (a.playerId ? [a.playerId] : []);
        const names = ids.map(pid=>playerName(a.team,pid,match)).join(', ');
        const skillLabel = (SKILL_MAP[a.skill]||{label:a.skill}).label;
        let attrib = '';
        if(a.errorPlayerId) attrib = 'Fehlerverursacher: '+playerName(a.errorTeam, a.errorPlayerId, match);
        else if(a.blockedPlayerId) attrib = 'Geblockter Angreifer: '+playerName(a.blockedTeam, a.blockedPlayerId, match);
        rows.push([set.setNumber, ri+1, a.team==='home'?state.teamName:match.opponentName, skillLabel, a.type||'', names, a.code, from, to, attrib, '', setterNum, laufer]);
      });
      // Diktierter/getippter Fehler-Kommentar zum Team, das diesen Punkt verloren hat.
      if(rally.comment){
        const cTeamName = rally.comment.team==='home' ? state.teamName : match.opponentName;
        const names = (rally.comment.playerIds||[]).map(pid=>playerName(rally.comment.team, pid, match)).join(', ');
        rows.push([set.setNumber, ri+1, cTeamName, 'Fehler-Notiz', '', names, '', '', '', '', rally.comment.text, setterNum, laufer]);
      }
    });
    (set.substitutions||[]).forEach(s=>{
      const teamName = s.team==='home' ? state.teamName : match.opponentName;
      const outName = playerName(s.team, s.outId, match);
      const inName = playerName(s.team, s.inId, match);
      rows.push([set.setNumber, '', teamName, s.type==='libero'?'Libero-Wechsel':'Auswechslung', '', outName+' → '+inName, '', '', '', '', '', '', '']);
    });
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'h3scout_'+match.opponentName.replace(/\s+/g,'_')+'_'+new Date(match.date).toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ============================ Start ============================ */

render();

// PHASE 4: robuste Update-Erkennung. Der Service Worker selbst holt Assets bereits "network-first"
// UND ohne den normalen HTTP-Cache des Browsers zu benutzen (siehe sw.js, fetch mit
// {cache:'no-store'}) — das behebt das in der QA gefundene Risiko, dass trotz "network-first"
// still eine veraltete, aus dem HTTP-Cache bediente Version lief. Zusätzlich: sobald ein bereits im
// Hintergrund installierter neuer Service Worker aktiv wird, einen nicht-blockierenden Hinweis
// zeigen (kein alert(), kein erzwungener Reload) — localStorage/Spielstände werden dabei nie
// angefasst, ein Service Worker hat darauf gar keinen Zugriff.
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{
      // Regelmäßig aktiv nach einer neueren Version suchen (z.B. wenn die App lange offen bleibt).
      setInterval(()=>{ reg.update().catch(()=>{}); }, 5*60*1000);
    }).catch(()=>{});
    let alreadyControlled = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', ()=>{
      // Nur zeigen, wenn zuvor bereits eine andere Version aktiv war (echtes Update) — nicht bei der
      // allerersten Installation, wo es noch nichts zu "aktualisieren" gibt.
      if(!alreadyControlled){ alreadyControlled = true; return; }
      banner = { text:'🔄 Neue Version verfügbar – App aktualisieren', reload:true };
      render();
    });
  });
}
