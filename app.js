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

// Bewertungsskala (vereinfacht, angelehnt an Data Volley / Click&Scout)
const EVALS = [
  {code:'#', label:'Perfekt',  cls:'ev-perfect'},
  {code:'+', label:'Gut',      cls:'ev-good'},
  {code:'!', label:'Neutral',  cls:'ev-neutral'},
  {code:'-', label:'Schwach',  cls:'ev-poor'},
  {code:'=', label:'Fehler',   cls:'ev-error'},
];
// Codes, bei denen eine '#' direkt einen Punkt für das agierende Team bedeutet
const POINT_ON_PERFECT = ['S','A','B'];

const POSITIONS = [1,2,3,4,5,6]; // FIVB-Rotationspositionen

// Richtungserfassung (wer schlägt wohin) — nur für Aufschlag und Angriff
const ZONE_SKILLS = ['S','A'];
// Court-Koordinatensystem: 0–100 (Breite) x 0–130 (Länge), Netz bei y=65.
// Position der eigenen Mannschaft (unten, eigene Grundlinie bei y=130).
const ORIGIN_BY_POSITION = {
  1:{x:83,y:125}, 2:{x:83,y:80}, 3:{x:50,y:78}, 4:{x:17,y:80}, 5:{x:17,y:105}, 6:{x:50,y:108}
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

function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return { teamName:'Eintracht Frankfurt H3', roster:[], matches:[] };
}
function saveState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
}

function getMatch(id){ return state.matches.find(m=>m.id===id); }
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
  const svg = svgEl('svg', {viewBox:`${vx} ${vy} ${vw} ${vh}`, style:'width:100%;height:auto;display:block;background:#1e293b;border-radius:10px;touch-action:none;'});
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
      const isSelected = pid===opts.selectedPlayerId;
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

function go(r){ tagging = null; subbing = null; route = r; render(); window.scrollTo(0,0); }

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

function newSet(setNumber, homeLineup, awayLineup, servingTeam){
  return { setNumber, homeScore:0, awayScore:0, homeLineup:[...homeLineup], awayLineup:[...awayLineup], servingTeam, rallies:[{actions:[]}], winner:null };
}

/* ============================ Live-Scouting ============================ */

function renderLive(header, main){
  const match = getMatch(route.matchId);
  if(!match){ go({name:'home'}); return; }
  const set = currentSet(match);
  const rally = set.rallies[set.rallies.length-1];

  header.appendChild(el('button',{class:'back', onclick:()=>go({name:'home'})},'← Spiele'));
  header.appendChild(el('h1',{}, state.teamName+' – '+match.opponentName));
  header.appendChild(el('button',{class:'icon-btn', onclick:()=>go({name:'stats', matchId:match.id})},'📊'));

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
  board.appendChild(el('button',{class:'btn ghost block', style:'margin-top:8px', onclick:()=>undoLastAction(match)},'↩ Letzte Aktion rückgängig'));
  main.appendChild(board);

  // Wechsel: eine Spielerin/ein Spieler auf einer Position gegen jemanden von der Bank tauschen.
  substitutionSection(main, match, set);

  // Spielfeld: zeigt die Aufstellung UND dient direkt zum Erfassen einer Aktion —
  // kein separates/extra Feld mehr, alles läuft in dieser einen Karte.
  fieldSection(main, match, set);

  // Aktionen dieser Rally
  const rallyCard = el('div',{class:'card'});
  rallyCard.appendChild(el('h2',{},'Aktuelle Rally'));
  if(rally.actions.length===0) rallyCard.appendChild(el('div',{class:'empty'},'Noch keine Aktion in dieser Rally.'));
  rally.actions.forEach(a=>{
    rallyCard.appendChild(el('div',{class:'list-item'},[
      el('div',{},[ el('strong',{}, SKILL_MAP[a.skill].label+' '), playerName(a.team,a.playerId,match), el('span',{class:'pill',style:'margin-left:8px'}, a.team==='home'?state.teamName:match.opponentName) ]),
      el('div',{style:'font-weight:800'}, a.code)
    ]));
  });
  main.appendChild(rallyCard);

  // Statistik & Diagramme sind während des ganzen Spiels/Satzes durchgehend sichtbar,
  // nicht nur über die separate Statistik-Seite.
  main.appendChild(el('div',{style:'font-weight:800;font-size:15px;margin:18px 4px 4px;color:var(--muted);'},'📊 Statistik (live)'));
  renderStatTables(main, match);
  renderDirections(main, match);

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
    fieldCard.appendChild(el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:8px;'}, 'Aktion wählen, dann direkt hier im Feld auf Spieler (und ggf. Zielort) tippen.'));
    fieldCard.appendChild(buildCourt(set, match, {}));
    const skillGrid = el('div',{class:'row', style:'margin-top:10px;'});
    SKILLS.forEach(sk=>{
      skillGrid.appendChild(el('button',{class:'btn secondary', style:'flex:1 1 30%;', onclick:()=>{ tagging = {skillCode:sk.code, team:null, playerId:'', fromPoint:null, toPoint:null}; render(); }}, sk.label));
    });
    fieldCard.appendChild(skillGrid);
  } else {
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

    fieldCard.appendChild(buildCourt(set, match, {
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
    }));

    if(needsTarget && tagging.playerId && (tagging.fromPoint || tagging.toPoint)){
      fieldCard.appendChild(el('button',{class:'btn ghost block', style:'margin-top:6px;font-size:12px;', onclick:()=>{ tagging.fromPoint=null; tagging.toPoint=null; render(); }},'↺ Start-/Zielposition neu setzen'));
    }

    const evalRow = el('div',{class:'row eval-row', style:'margin-top:10px;'});
    EVALS.forEach(ev=>{
      evalRow.appendChild(el('button',{class:'btn secondary '+ev.cls, style:'flex:1 1 18%;', onclick:()=>{
        if(!tagging.playerId){ alert('Bitte zuerst im Feld auf einen Spieler tippen.'); return; }
        if(needsTarget && (!tagging.fromPoint || !tagging.toPoint)){ alert('Bitte Start- und Zielposition im Feld antippen.'); return; }
        const t = tagging;
        tagging = null;
        logAction(match, t.skillCode, t.team, t.playerId, ev.code, t.fromPoint, t.toPoint);
      }}, ev.code+' '+ev.label));
    });
    fieldCard.appendChild(el('label',{},'Bewertung'));
    fieldCard.appendChild(evalRow);
    fieldCard.appendChild(el('button',{class:'btn ghost block', style:'margin-top:10px', onclick:()=>{ tagging=null; render(); }},'Abbrechen'));
  }

  main.appendChild(fieldCard);
}

// Wechsel: Spieler:in auf einer Feldposition gegen jemanden von der Bank tauschen. Der/die
// Eingewechselte übernimmt genau den Rotationsplatz der/des Ausgewechselten, damit die Rotation
// danach weiter korrekt nach den Volleyball-Regeln läuft.
function substitutionSection(main, match, set){
  const card = el('div',{class:'card'});
  const headRow = el('div',{style:'display:flex;justify-content:space-between;align-items:center;gap:8px;'});
  headRow.appendChild(el('h2',{style:'margin:0'},'Wechsel'));
  headRow.appendChild(el('button',{class:'btn secondary', onclick:()=>{
    subbing = subbing ? null : {team:'home', posIdx:0, newPlayerId:''};
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
    benchSel.addEventListener('change', e=>{ subbing.newPlayerId = e.target.value; });
    card.appendChild(el('label',{},'Spieler:in rein (Bank)'));
    card.appendChild(benchSel);

    if(bench.length===0){
      card.appendChild(el('div',{class:'empty'},'Keine weiteren Spieler:innen auf der Bank.'));
    }

    card.appendChild(el('button',{class:'btn block', style:'margin-top:10px', onclick:()=>{
      if(!subbing.newPlayerId){ alert('Bitte eine Spielerin/einen Spieler von der Bank auswählen.'); return; }
      const lu = subbing.team==='home' ? set.homeLineup : set.awayLineup;
      lu[subbing.posIdx] = subbing.newPlayerId;
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
    closeRally(match, team==='home'?'away':'home');
  } else if(code==='#' && POINT_ON_PERFECT.includes(skillCode)){
    closeRally(match, team);
  } else {
    render();
  }
}

function closeRally(match, pointTo){
  const set = currentSet(match);
  const wasServing = set.servingTeam;
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
      alert('Spiel beendet! Endstand: '+homeWins+':'+awayWins);
      go({name:'stats', matchId:match.id});
      return;
    } else {
      // Neuer Satz - gleiche Startaufstellung wie zu Satzbeginn wird hier vereinfachend beibehalten (letzte Rotation),
      // Trainer kann bei Bedarf über "Aufstellung" künftig anpassen.
      const nextServe = set.winner; // vereinfachte Regel: Satzgewinner schlägt im Folgesatz auf (bei echtem Volleyball wechselt es je nach Satzstand)
      match.sets.push(newSet(set.setNumber+1, set.homeLineup, set.awayLineup, nextServe));
      saveState();
      alert('Satz beendet: '+set.homeScore+':'+set.awayScore+'. Weiter geht’s mit Satz '+(set.setNumber+1)+'.');
    }
  } else {
    set.rallies.push({actions:[]});
    saveState();
  }
  render();
}

function manualPoint(match, team){
  closeRally(match, team);
}

function undoLastAction(match){
  const set = currentSet(match);
  const rally = set.rallies[set.rallies.length-1];
  if(rally.actions.length>0){
    rally.actions.pop();
    saveState(); render();
  } else if(set.rallies.length>1){
    // Letzten Punkt rückgängig machen ist bei Rotation komplex - wir entfernen nur die leere Rally
    set.rallies.pop();
    saveState(); render();
  } else {
    alert('Nichts zum Rückgängigmachen in dieser Rally.');
  }
}

/* ============================ Statistik ============================ */

function computeStats(match){
  const stats = { home:{}, away:{} };
  ['home','away'].forEach(team=>{
    const roster = team==='home' ? state.roster : match.opponentRoster;
    roster.forEach(p=>{ stats[team][p.id] = { number:p.number, name:p.name||'', bySkill:{} }; });
  });
  match.sets.forEach(set=>{
    set.rallies.forEach(rally=>{
      rally.actions.forEach(a=>{
        const t = stats[a.team];
        if(!t[a.playerId]) t[a.playerId] = { number: playerNumber(a.team,a.playerId,match), name:'', bySkill:{} };
        const p = t[a.playerId];
        if(!p.bySkill[a.skill]) p.bySkill[a.skill] = {total:0, perfect:0, good:0, neutral:0, poor:0, error:0};
        const s = p.bySkill[a.skill];
        s.total++;
        if(a.code==='#') s.perfect++;
        else if(a.code==='+') s.good++;
        else if(a.code==='!') s.neutral++;
        else if(a.code==='-') s.poor++;
        else if(a.code==='=') s.error++;
      });
    });
  });
  return stats;
}

// Alle Richtungslinien eines Teams zusammen (unabhängig vom einzelnen Spieler) —
// für das neue Team-Gesamtdiagramm (eines für uns, eines für den Gegner).
function computeTeamDirections(match){
  const dirs = { home:{lines:[]}, away:{lines:[]} };
  match.sets.forEach(set=>{
    set.rallies.forEach(rally=>{
      rally.actions.forEach(a=>{
        if(!ZONE_SKILLS.includes(a.skill) || !a.toPoint || !a.fromPoint) return;
        dirs[a.team].lines.push({ skill:a.skill, fromPoint:a.fromPoint, toPoint:a.toPoint, code:a.code });
      });
    });
  });
  return dirs;
}

function computeDirections(match){
  const dirs = { home:{}, away:{} };
  match.sets.forEach(set=>{
    set.rallies.forEach(rally=>{
      rally.actions.forEach(a=>{
        if(!ZONE_SKILLS.includes(a.skill) || !a.toPoint || !a.fromPoint) return;
        const t = dirs[a.team];
        if(!t[a.playerId]) t[a.playerId] = { number: playerNumber(a.team,a.playerId,match), lines:[] };
        t[a.playerId].lines.push({ skill:a.skill, fromPoint:a.fromPoint, toPoint:a.toPoint, code:a.code });
      });
    });
  });
  return dirs;
}

function directionSVG(playerDirs){
  const parts = [];
  parts.push('<rect x="2" y="2" width="96" height="126" fill="none" stroke="#3a4a6b" stroke-width="1"/>');
  parts.push('<line x1="2" y1="65" x2="98" y2="65" stroke="#3a4a6b" stroke-width="1.5"/>');
  playerDirs.lines.forEach(l=>{
    const from = l.fromPoint, to = l.toPoint;
    const color = (l.code==='#'||l.code==='+') ? '#22c55e' : (l.code==='=' ? '#ef4444' : '#94a3b8');
    parts.push(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}" stroke-width="1.4" stroke-opacity="0.85"/>`);
    parts.push(`<circle cx="${to.x}" cy="${to.y}" r="1.8" fill="${color}"/>`);
  });
  return `<svg viewBox="0 0 100 130" style="width:100%;height:auto;background:var(--bg2);border-radius:8px;display:block;">${parts.join('')}</svg>`;
}

function renderDirections(main, match){
  const dirs = computeDirections(match);
  const teamDirs = computeTeamDirections(match);
  ['home','away'].forEach(team=>{
    const teamName = team==='home'?state.teamName:match.opponentName;
    const teamLines = teamDirs[team].lines;
    const entries = Object.entries(dirs[team]).filter(([id,d])=>d.lines.length>0);
    if(entries.length===0 && teamLines.length===0) return;
    const card = el('div',{class:'card printable'});
    card.appendChild(el('h2',{}, 'Richtungen (Aufschlag/Angriff) · '+teamName));

    if(teamLines.length>0){
      card.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:4px;text-align:center;font-weight:700;'}, 'Team gesamt · '+teamName));
      card.appendChild(el('div',{style:'max-width:220px;margin:0 auto 16px;'}, el('div',{html: directionSVG({lines:teamLines})})));
    }

    if(entries.length>0){
      card.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:6px;text-align:center;'}, 'Pro Spieler'));
      const grid = el('div',{style:'display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:12px;'});
      entries.sort((a,b)=> (a[1].number>b[1].number?1:-1)).forEach(([pid,d])=>{
        const box = el('div',{});
        box.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:4px;text-align:center;'}, '#'+d.number));
        box.appendChild(el('div',{html: directionSVG(d)}));
        grid.appendChild(box);
      });
      card.appendChild(grid);
    }
    card.appendChild(el('div',{style:'color:var(--muted); font-size:11px; margin-top:8px;'},'Linie = Aufschlag- bzw. Angriffsrichtung (unten = eigene Seite, oben = Gegnerfeld). Grün = Punkt/gut, Grau = weiter, Rot = Fehler.'));
    main.appendChild(card);
  });
}

function renderStats(header, main){
  const match = getMatch(route.matchId);
  if(!match){ go({name:'home'}); return; }
  header.appendChild(el('button',{class:'back', onclick:()=>go({name:'home'})},'← Spiele'));
  header.appendChild(el('h1',{},'Statistik'));
  if(match.status!=='finished'){
    header.appendChild(el('button',{class:'icon-btn', onclick:()=>go({name:'live', matchId:match.id})},'🏐'));
  }

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
  main.appendChild(summary);

  renderStatTables(main, match);
  renderDirections(main, match);
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
  let rows = [['Satz','Rally','Team','Skill','Spieler','Bewertung','Von(x,y)','Ziel(x,y)']];
  match.sets.forEach(set=>{
    set.rallies.forEach((rally,ri)=>{
      rally.actions.forEach(a=>{
        const from = a.fromPoint ? (a.fromPoint.x+','+a.fromPoint.y) : '';
        const to = a.toPoint ? (a.toPoint.x+','+a.toPoint.y) : '';
        rows.push([set.setNumber, ri+1, a.team==='home'?state.teamName:match.opponentName, SKILL_MAP[a.skill].label, playerName(a.team,a.playerId,match), a.code, from, to]);
      });
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

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
