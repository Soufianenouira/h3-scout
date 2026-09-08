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

let state = loadState();
let route = {name:'home'};
// Live-Match Arbeitszustand (nicht persistiert bis Rally abgeschlossen)
let live = null;

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

function go(r){ route = r; render(); window.scrollTo(0,0); }

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

  // Aufstellung (Rotation) beider Teams
  main.appendChild(lineupView('Deine Aufstellung', set.homeLineup, 'home', match, set));
  main.appendChild(lineupView('Gegner-Aufstellung', set.awayLineup, 'away', match, set));

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

  // Aktions-Buttons
  const actionCard = el('div',{class:'card'});
  actionCard.appendChild(el('h2',{},'Aktion erfassen'));
  const skillGrid = el('div',{class:'row'});
  SKILLS.forEach(sk=>{
    skillGrid.appendChild(el('button',{class:'btn secondary', style:'flex:1 1 30%;', onclick:()=>openActionPanel(match, sk.code)}, sk.label));
  });
  actionCard.appendChild(skillGrid);
  main.appendChild(actionCard);

  const panelHolder = el('div',{id:'actionPanel'});
  main.appendChild(panelHolder);

  const endCard = el('div',{class:'card'});
  endCard.appendChild(el('button',{class:'btn ghost block', onclick:()=>{
    if(confirm('Spiel wirklich beenden und speichern?')){ match.status='finished'; saveState(); go({name:'stats', matchId:match.id}); }
  }},'Spiel beenden'));
  main.appendChild(endCard);
}

function lineupView(title, lineup, team, match, set){
  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{}, title + (set.servingTeam===team? '  ·  Aufschlag':'')));
  const grid = el('div',{style:'display:grid; grid-template-columns:repeat(3,1fr); gap:8px;'});
  // Anzeige: vorne (4,3,2) oben, hinten (5,6,1) unten - vereinfachte Visualisierung
  const order = [3,2,1,4,5,0]; // Index in lineup array (0-basiert Pos1..6) für Positionen 4,3,2,5,6,1
  const labels = [4,3,2,5,6,1];
  order.forEach((idx,i)=>{
    const pid = lineup[idx];
    const isServer = (labels[i]===1);
    grid.appendChild(el('div',{style:`background:${isServer?'var(--accent)':'var(--bg2)'};border-radius:10px;padding:10px;text-align:center;`},[
      el('div',{style:'font-size:10px;color:'+(isServer?'#dbeafe':'var(--muted)')}, 'Pos '+labels[i]),
      el('div',{style:'font-weight:700'}, pid? playerNumber(team,pid,match) : '–')
    ]));
  });
  card.appendChild(grid);
  return card;
}

function openActionPanel(match, skillCode){
  const set = currentSet(match);
  const skill = SKILL_MAP[skillCode];
  const holder = document.getElementById('actionPanel');
  holder.innerHTML='';

  const state_panel = { team: skillCode==='S' ? set.servingTeam : (skillCode==='R'? (set.servingTeam==='home'?'away':'home') : set.servingTeam), playerId:'', code:'' };

  const card = el('div',{class:'card'});
  card.appendChild(el('h2',{}, skill.label+' erfassen'));

  const teamRow = el('div',{class:'row team-row', style:'margin-bottom:10px;'},[
    el('button',{class:'btn '+(state_panel.team==='home'?'':'secondary'), style:'flex:1', onclick:()=>{ state_panel.team='home'; renderPlayerButtons(); }}, state.teamName),
    el('button',{class:'btn '+(state_panel.team==='away'?'':'secondary'), style:'flex:1', onclick:()=>{ state_panel.team='away'; renderPlayerButtons(); }}, match.opponentName),
  ]);
  card.appendChild(teamRow);

  const playerHolder = el('div',{class:'row player-row', style:'margin-bottom:10px;'});
  card.appendChild(playerHolder);

  function renderPlayerButtons(){
    // Team-Umschalter aktualisieren
    teamRow.children[0].className = 'btn '+(state_panel.team==='home'?'':'secondary');
    teamRow.children[1].className = 'btn '+(state_panel.team==='away'?'':'secondary');
    playerHolder.innerHTML='';
    const lineup = state_panel.team==='home' ? set.homeLineup : set.awayLineup;
    lineup.forEach((pid)=>{
      if(!pid) return;
      const label = playerNumber(state_panel.team,pid,match);
      const btn = el('button',{class:'btn '+(state_panel.playerId===pid?'':'secondary'), style:'flex:1 1 14%;', onclick:()=>{ state_panel.playerId=pid; renderPlayerButtons(); }}, '#'+label);
      playerHolder.appendChild(btn);
    });
  }
  renderPlayerButtons();

  const evalRow = el('div',{class:'row eval-row'});
  EVALS.forEach(ev=>{
    evalRow.appendChild(el('button',{class:'btn secondary '+ev.cls, style:'flex:1 1 18%;', onclick:()=>{
      if(!state_panel.playerId){ alert('Bitte Spieler auswählen.'); return; }
      logAction(match, skillCode, state_panel.team, state_panel.playerId, ev.code);
      holder.innerHTML='';
    }}, ev.code+' '+ev.label));
  });
  card.appendChild(el('label',{},'Bewertung'));
  card.appendChild(evalRow);

  card.appendChild(el('button',{class:'btn ghost block', style:'margin-top:10px', onclick:()=>{ holder.innerHTML=''; }},'Abbrechen'));
  holder.appendChild(card);
}

function logAction(match, skillCode, team, playerId, code){
  const set = currentSet(match);
  const rally = set.rallies[set.rallies.length-1];
  rally.actions.push({skill:skillCode, team, playerId, code, ts:Date.now()});
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
  let rows = [['Satz','Rally','Team','Skill','Spieler','Bewertung']];
  match.sets.forEach(set=>{
    set.rallies.forEach((rally,ri)=>{
      rally.actions.forEach(a=>{
        rows.push([set.setNumber, ri+1, a.team==='home'?state.teamName:match.opponentName, SKILL_MAP[a.skill].label, playerName(a.team,a.playerId,match), a.code]);
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
