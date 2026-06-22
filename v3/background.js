// Service worker — Teams Transcript Downloader v2 (auto)
//
// Toute l'orchestration tourne ici, en arrière-plan :
//   - le traitement continue même quand la popup est fermée ;
//   - l'onglet Teams ciblé n'a pas besoin d'être actif/visible
//     (chrome.scripting cible un tabId précis) ;
//   - un onglet Teams dédié est ouvert si nécessaire ;
//   - scan limité aux N premières discussions (paramétrable, défaut 50) ;
//   - arrêt manuel possible en cours d'exécution ;
//   - si l'automatisation est activée, déclenchement auto après 1 minute.
//
// La popup n'est qu'une télécommande : elle envoie des messages
// (start/stop/extractManual/debug) et lit l'état via chrome.storage.

const DEFAULTS = { autoEnabled: false, maxChats: 50, meetingsOnly: true, intervalMin: 5 };
const TEAMS_URL = 'https://teams.microsoft.com/v2/';

// État partagé (mémoire du SW) + reflété dans chrome.storage ('scanState').
//
// Annulation par génération : chaque scan capture `scanGen` au démarrage (`myGen`).
// Il reste valide tant que `scanGen === myGen`. `cancelScan()` incrémente `scanGen`,
// ce qui invalide instantanément le scan en cours : à son prochain point de contrôle
// il sort SANS écrire d'état (le demandeur de l'arrêt — ou le nouveau scan — est
// propriétaire de l'état). Cela évite qu'un scan moribond écrase l'état idle propre.
let scanGen = 0;
let isRunning = false;
let pendingAutoStart = false; // une relance auto est demandée dès la fin du scan courant

// Onglet Teams piloté par l'automatisation (le voile y est appliqué), gardé en
// mémoire du SW en plus de chrome.storage. Aucune fenêtre dédiée n'est créée : le
// panneau latéral est attaché PAR ONGLET (pattern « side panel par site »).
let dedicatedTabId = null;

function setDedicated(tabId) {
  dedicatedTabId = tabId != null ? tabId : null;
  return chrome.storage.local.set({ dedicatedTabId });
}

function clearDedicated() {
  dedicatedTabId = null;
  return chrome.storage.local.remove('dedicatedTabId');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Sommeil annulable : se réveille tôt si le scan a été invalidé (Stop / nouveau scan),
// pour un arrêt réactif au lieu d'attendre la fin d'un long `sleep`.
async function sleepCancellable(ms, gen) {
  const step = 250;
  let waited = 0;
  while (waited < ms) {
    if (scanGen !== gen) return;
    await sleep(Math.min(step, ms - waited));
    waited += step;
  }
}

async function getSettings() {
  const s = await chrome.storage.local.get(['autoEnabled', 'maxChats', 'intervalMin']);
  return {
    autoEnabled: s.autoEnabled ?? DEFAULTS.autoEnabled,
    maxChats: Number.isFinite(s.maxChats) ? s.maxChats : DEFAULTS.maxChats,
    // Toujours ON : les discussions individuelles/groupe n'ont pas de transcript.
    meetingsOnly: true,
    intervalMin: Number.isFinite(s.intervalMin) && s.intervalMin >= 1 ? s.intervalMin : DEFAULTS.intervalMin
  };
}

// ---- Planification du scan automatique (jours + plage horaire) ----
// Réglages stockés : scheduleEnabled (bool), scheduleDays (jours autorisés au
// format getDay() : 0=dim … 6=sam), scheduleStart / scheduleEnd ("HH:MM").
const SCHEDULE_DEFAULTS = { scheduleEnabled: false, scheduleDays: [1, 2, 3, 4, 5], scheduleStart: '08:00', scheduleEnd: '18:00' };

async function getSchedule() {
  const s = await chrome.storage.local.get(['scheduleEnabled', 'scheduleDays', 'scheduleStart', 'scheduleEnd']);
  return {
    scheduleEnabled: !!s.scheduleEnabled,
    scheduleDays: Array.isArray(s.scheduleDays) ? s.scheduleDays : SCHEDULE_DEFAULTS.scheduleDays,
    scheduleStart: typeof s.scheduleStart === 'string' ? s.scheduleStart : SCHEDULE_DEFAULTS.scheduleStart,
    scheduleEnd: typeof s.scheduleEnd === 'string' ? s.scheduleEnd : SCHEDULE_DEFAULTS.scheduleEnd
  };
}

// "HH:MM" → minutes depuis minuit, ou null si invalide.
function parseHM(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || ''));
  if (!m) return null;
  const h = +m[1], mn = +m[2];
  if (h > 23 || mn > 59) return null;
  return h * 60 + mn;
}

// L'instant `now` tombe-t-il dans une fenêtre autorisée ?
// Gère les plages qui traversent minuit (début > fin).
function isWithinSchedule(sched, now = new Date()) {
  if (!sched.scheduleEnabled) return true;
  const start = parseHM(sched.scheduleStart);
  const end = parseHM(sched.scheduleEnd);
  if (start == null || end == null) return true; // réglage incomplet → pas de blocage
  const day = now.getDay();
  const cur = now.getHours() * 60 + now.getMinutes();
  if (start <= end) {
    return sched.scheduleDays.includes(day) && cur >= start && cur < end;
  }
  // Plage nocturne : la portion avant `end` appartient au jour de début (veille).
  const prevDay = (day + 6) % 7;
  return (sched.scheduleDays.includes(day) && cur >= start)
    || (sched.scheduleDays.includes(prevDay) && cur < end);
}

// Prochaine ouverture de fenêtre strictement après `from` (timestamp ms), ou null.
function nextWindowStart(sched, from = new Date()) {
  const start = parseHM(sched.scheduleStart);
  if (start == null || !sched.scheduleDays.length) return null;
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(Math.floor(start / 60), start % 60, 0, 0);
    if (d.getTime() > from.getTime() && sched.scheduleDays.includes(d.getDay())) {
      return d.getTime();
    }
  }
  return null;
}

async function setState(partial) {
  const cur = (await chrome.storage.local.get('scanState')).scanState || {};
  const next = { ...cur, ...partial, updatedAt: Date.now() };
  await chrome.storage.local.set({ scanState: next });
  updateActionUI(next).catch(() => {});
  return next;
}

// Force un retour à l’état de base (idle / prêt) en ignorant les états de scan
// en cours. Appelé lors d’un arrêt manuel pour que la popup repasse immédiatement
// au statut initial sans attendre la fin d’une opération longue.
async function resetToIdleState(message = 'Prêt.') {
  await setState({
    running: false,
    phase: 'idle',
    current: 0,
    total: 0,
    currentLabel: '',
    nextRunAt: null,
    message
  });
}

// Invalide le scan en cours (le rend obsolète). Le scan sortira à son prochain point
// de contrôle. On signale aussi l'arrêt à l'extraction injectée (boucle de scroll
// longue) via un flag dans la page, sinon la discussion courante continuerait d'être
// traitée côté Teams malgré l'arrêt.
function cancelScan() {
  scanGen++;
  signalAbortToTab().catch(() => {});
}

// Pose `window.__ttdAbort = true` dans toutes les frames de l'onglet Teams dédié.
// `frameFullExtract` lit ce flag à chaque palier de défilement et s'interrompt.
// Les scripts injectés (chrome.scripting, monde isolé) partagent le `window` du
// monde isolé par frame, donc ce flag est bien visible par l'extraction en cours.
async function signalAbortToTab() {
  const { dedicatedTabId } = await chrome.storage.local.get('dedicatedTabId');
  if (!dedicatedTabId) return;
  let frames = [];
  try { frames = await chrome.webNavigation.getAllFrames({ tabId: dedicatedTabId }); } catch (e) { return; }
  await Promise.all((frames || []).map(f =>
    chrome.scripting.executeScript({
      target: { tabId: dedicatedTabId, frameIds: [f.frameId] },
      func: () => { try { window.__ttdAbort = true; } catch (e) { /* ignore */ } }
    }).catch(() => {})
  ));
}

// ============================================================
// Icône de l'action + pastille de statut (actif / en cours / arrêté)
// ============================================================

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Dessine une icône « transcript » (document à lignes) sur fond violet Teams.
function makeIconImageData(size) {
  const c = new OffscreenCanvas(size, size);
  const x = c.getContext('2d');
  const r = size / 128;
  // fond arrondi
  x.fillStyle = '#6264a7';
  roundRectPath(x, 0, 0, size, size, 28 * r);
  x.fill();
  // page blanche
  x.fillStyle = '#ffffff';
  roundRectPath(x, 34 * r, 24 * r, 60 * r, 84 * r, 8 * r);
  x.fill();
  // lignes de transcript
  x.fillStyle = '#6264a7';
  const lx = 44 * r, lw = 40 * r, lh = 7 * r;
  [42, 60, 78, 96].forEach((yy, i) => {
    roundRectPath(x, lx, yy * r, i === 3 ? lw * 0.55 : lw, lh, 3 * r);
    x.fill();
  });
  return x.getImageData(0, 0, size, size);
}

function setAppIcon() {
  try {
    const imageData = {
      16: makeIconImageData(16),
      32: makeIconImageData(32),
      48: makeIconImageData(48),
      128: makeIconImageData(128)
    };
    chrome.action.setIcon({ imageData });
  } catch (e) { /* OffscreenCanvas indisponible : on garde l'icône PNG du manifest */ }
}

// Pastille : ● violet = en cours, ● vert = actif (auto en attente),
// ■ rouge = arrêté, rien = automatisation désactivée.
async function updateActionUI(state) {
  try {
    const st = state || (await chrome.storage.local.get('scanState')).scanState || {};
    const { autoEnabled } = await getSettings();
    let text = '', color = '#6264a7';
    if (st.running) { text = '●'; color = '#6264a7'; }
    else if (st.phase === 'stopped') { text = '■'; color = '#c62828'; }
    else if (autoEnabled) { text = '●'; color = '#2e7d32'; }
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color });
  } catch (e) { /* ignore */ }
}

// ============================================================
// Voile de protection sur l'onglet Teams dédié
//   Un voile gris semi-transparent recouvre EN PERMANENCE l'onglet piloté par
//   l'extension : on voit ce qui s'y passe mais les interactions souris/clavier de
//   l'utilisateur sont bloquées (évite les clics par erreur). Les actions de
//   l'automatisation (element.click(), scrollTop) sont programmatiques et ne sont
//   PAS interceptées par ce voile.
// ============================================================

// --- Voile BLOQUANT (gris) : actif uniquement quand l'automatisation est ON ---
// Injecté dans la page (frame 0), idempotent. Un MutationObserver le réinsère si la
// SPA Teams le retire lors d'un re-render. Bloque clic/clavier/scroll de l'utilisateur.
function pageApplyOverlay() {
  const ID = '__ttd_overlay__';
  if (document.getElementById(ID)) return { ok: true, already: true };
  const ov = document.createElement('div');
  ov.id = ID;
  ov.setAttribute('role', 'presentation');
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(55,58,74,0.42);pointer-events:auto;cursor:not-allowed;display:flex;align-items:flex-start;justify-content:center;';
  const block = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['click', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup', 'keypress', 'touchstart', 'touchmove', 'pointerdown'].forEach(t => ov.addEventListener(t, block, true));
  const badge = document.createElement('div');
  badge.textContent = '🔒 Automatisation en cours — onglet piloté par Teams Transcript Downloader';
  badge.style.cssText = 'margin-top:14px;max-width:90%;padding:8px 16px;border-radius:20px;background:rgba(98,100,167,0.96);color:#fff;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,0.25);text-align:center;';
  ov.appendChild(badge);
  document.documentElement.appendChild(ov);
  try {
    const mo = new MutationObserver(() => {
      if (!document.getElementById(ID)) document.documentElement.appendChild(ov);
    });
    mo.observe(document.documentElement, { childList: true });
    ov.__ttdObserver = mo;
  } catch (e) { /* ignore */ }
  return { ok: true };
}

function pageRemoveOverlay() {
  const el = document.getElementById('__ttd_overlay__');
  if (el) {
    try { if (el.__ttdObserver) el.__ttdObserver.disconnect(); } catch (e) { /* ignore */ }
    el.remove();
  }
  return { ok: true };
}

// --- Guide NON bloquant : « cliquez à nouveau sur l'icône » ---
// Affiché à la création de l'onglet (même automatisation OFF, pour ne pas gêner la
// navigation manuelle). pointer-events:none → ne bloque rien. Masqué à l'ouverture
// du panneau (message panelReady).
function pageApplyGuide() {
  const ID = '__ttd_guide__';
  if (document.getElementById(ID)) return { ok: true, already: true };
  const guide = document.createElement('div');
  guide.id = ID;
  guide.style.cssText = 'position:fixed;top:10px;right:18px;z-index:2147483647;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:360px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  const arrow = document.createElement('div');
  arrow.textContent = '⬆ Icône de l’extension';
  arrow.style.cssText = 'color:#3b3b46;font-size:13px;font-weight:700;text-shadow:0 1px 3px rgba(255,255,255,.7);margin-right:6px;';
  const card = document.createElement('div');
  card.style.cssText = 'background:#6264a7;color:#fff;padding:13px 16px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.4);text-align:left;';
  card.innerHTML = '<div style="font-size:15px;font-weight:700;margin-bottom:5px;">👉 Cliquez à nouveau sur l’icône de l’extension</div>'
    + '<div style="font-size:13px;font-weight:400;line-height:1.45;opacity:.96;">en haut à droite de Chrome, pour ouvrir le panneau latéral et <b>configurer</b> ou <b>lancer</b> le téléchargement des transcripts.</div>';
  guide.appendChild(arrow);
  guide.appendChild(card);
  document.documentElement.appendChild(guide);
  try {
    const mo = new MutationObserver(() => {
      if (!document.getElementById(ID)) document.documentElement.appendChild(guide);
    });
    mo.observe(document.documentElement, { childList: true });
    guide.__ttdObserver = mo;
  } catch (e) { /* ignore */ }
  return { ok: true };
}

function pageRemoveGuide() {
  const g = document.getElementById('__ttd_guide__');
  if (g) {
    try { if (g.__ttdObserver) g.__ttdObserver.disconnect(); } catch (e) { /* ignore */ }
    g.remove();
  }
  return { ok: true };
}

async function showOverlay(tabId) {
  if (!tabId) return;
  try { await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: pageApplyOverlay }); }
  catch (e) { /* onglet pas prêt / non scriptable */ }
}

async function hideOverlay(tabId) {
  if (!tabId) return;
  try { await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: pageRemoveOverlay }); }
  catch (e) { /* ignore */ }
}

async function showGuide(tabId) {
  if (!tabId) return;
  try { await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: pageApplyGuide }); }
  catch (e) { /* ignore */ }
}

async function hideGuide(tabId) {
  if (!tabId) return;
  try { await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: pageRemoveGuide }); }
  catch (e) { /* ignore */ }
}

// Voile bloquant = reflet de l'automatisation : ON → voile (empêche les clics par
// erreur pendant le scan) ; OFF → pas de voile (navigation Teams manuelle possible).
async function refreshOverlay(tabId) {
  const id = tabId != null ? tabId : dedicatedTabId;
  if (id == null) return;
  const { autoEnabled } = await getSettings();
  if (autoEnabled) await showOverlay(id);
  else await hideOverlay(id);
}

// ============================================================
// Panneau latéral attaché PAR ONGLET (pattern « side panel par site », comme
// l'extension Claude) : activé sur les onglets Teams, désactivé ailleurs. Combiné
// à openPanelOnActionClick, le clic sur l'icône ouvre le panneau sur l'onglet
// Teams courant (Chrome gère le geste → fiable), et il disparaît dès qu'on bascule
// sur un onglet non-Teams.
// ============================================================
async function syncSidePanel(tab) {
  if (!tab || tab.id == null) return;
  const url = tab.url || tab.pendingUrl || '';
  try {
    if (isTeamsUrl(url)) {
      await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'panel.html', enabled: true });
    } else {
      await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
    }
  } catch (e) { /* API indisponible (Chrome < 114) */ }
}

async function syncAllTabs() {
  try { const tabs = await chrome.tabs.query({}); for (const t of tabs) await syncSidePanel(t); }
  catch (e) { /* ignore */ }
}

// Initialisation à chaque réveil du service worker.
setAppIcon();
updateActionUI().catch(() => {});
// On gère le clic nous-mêmes (chrome.action.onClicked) pour ouvrir/cibler un onglet
// Teams → l'ouverture automatique globale doit rester désactivée.
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {}); } catch (e) { /* API indisponible */ }
// État par onglet + réhydrate l'onglet piloté + réapplique le voile éventuel.
syncAllTabs();
chrome.storage.local.get('dedicatedTabId').then((s) => {
  dedicatedTabId = s.dedicatedTabId != null ? s.dedicatedTabId : null;
  if (dedicatedTabId != null) refreshOverlay(dedicatedTabId).catch(() => {});
}).catch(() => {});

// ============================================================
// Fonctions injectées dans les frames (identiques côté logique à la V1/V2)
// ============================================================

function frameScanForTranscript() {
  const doc = document;
  const bodyText = doc.body ? doc.body.textContent : '';
  const timeMatches = bodyText.match(/\d{1,2}:\d{2}/g);
  const timeCount = timeMatches ? timeMatches.length : 0;
  const listCells = doc.querySelectorAll('[data-automationid="ListCell"]').length;
  const listItems = doc.querySelectorAll('[role="listitem"]').length;
  return {
    url: window.location.href,
    origin: window.location.origin,
    timeCount, listCells, listItems,
    bodyLength: bodyText.length,
    hasContent: bodyText.length > 100
  };
}

function frameFullExtract() {
  const doc = document;
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function findContainer() {
    for (const sel of [
      '#scrollToTargetTargetedFocusZone',
      '[data-tid="transcriptContainerRef"]',
      '[data-tid="transcript-pane"]',
      '[data-tid="transcript-content"]',
      '.ms-List'
    ]) {
      const el = doc.querySelector(sel);
      if (el) return el;
    }
    const listCells = doc.querySelectorAll('[data-automationid="ListCell"]');
    if (listCells.length > 0) {
      let el = listCells[0].parentElement;
      while (el) {
        if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) return el;
        el = el.parentElement;
      }
      return listCells[0].parentElement;
    }
    for (const el of doc.querySelectorAll('[role="list"]')) {
      if (el.children.length > 2) return el;
    }
    const log = doc.querySelector('[role="log"]');
    if (log) return log;
    for (const el of doc.querySelectorAll('div')) {
      if (el.children.length > 3 && el.scrollHeight > 200) {
        const text = el.textContent;
        const tm = text.match(/\d{1,2}:\d{2}/g);
        if (tm && tm.length > 3) return el;
      }
    }
    return null;
  }

  function extractEntryFromCell(cell) {
    const allText = cell.textContent.trim();
    if (!allText || allText.length < 3) return null;
    const timeMatch = allText.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    let time = timeMatch ? timeMatch[1] : '';
    let speaker = '';
    for (const sel of [
      '[class*="itemDisplayName"]', '[class*="displayName"]',
      '[class*="speaker"]', '[class*="Speaker"]',
      '[class*="author"]', '[data-tid*="speaker"]', '[data-tid*="name"]'
    ]) {
      const el = cell.querySelector(sel);
      if (el && el.textContent.trim()) { speaker = el.textContent.trim(); break; }
    }
    let message = '';
    for (const sel of [
      '[class*="eventText"]', '[class*="message"]',
      '[class*="caption"]', '[class*="Caption"]',
      '[class*="text-"]', '[data-tid*="text"]', '[data-tid*="caption"]'
    ]) {
      const el = cell.querySelector(sel);
      if (el && el.textContent.trim()) { message = el.textContent.trim(); break; }
    }
    if (!message) message = allText;
    if (!speaker && message) {
      const m = message.match(/^([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*)\s*[:\n]\s*/);
      if (m) { speaker = m[1].trim(); message = message.substring(m[0].length).trim(); }
    }
    if (time && message.startsWith(time)) message = message.substring(time.length).trim();
    if (speaker && message.startsWith(speaker)) message = message.substring(speaker.length).replace(/^[\s:]+/, '').trim();
    message = message.replace(/^\d+\s+minute.*?\d+\s+seconde\s*/, '').trim();
    message = message.replace(/^:\s*/, '').trim();
    if (!message || message.length < 2) return null;
    return { time: time || '--:--', speaker: speaker || 'Inconnu', message };
  }

  function collectEntries(container, seenKeys) {
    const entries = [];
    const cellSelectors = '[data-automationid="ListCell"], [role="listitem"]';
    let cells = container.querySelectorAll(cellSelectors);
    if (cells.length === 0) cells = container.children;
    for (const cell of cells) {
      const entry = extractEntryFromCell(cell);
      if (entry) {
        const key = entry.speaker + '|' + entry.message.substring(0, 50);
        if (!seenKeys.has(key)) { seenKeys.add(key); entries.push(entry); }
      }
    }
    return entries;
  }

  return (async () => {
    // Réinitialise le flag d'arrêt pour cette extraction (un flag posé lors d'un
    // arrêt précédent ne doit pas interrompre une nouvelle extraction).
    try { window.__ttdAbort = false; } catch (e) { /* ignore */ }
    const container = findContainer();
    if (!container) return { found: false, reason: 'no container' };

    // Trouve le vrai élément scrollable (la liste de transcript est virtualisée :
    // sans défilement on ne récupère que la portion visible → fichier incomplet).
    function scrollableAncestor(el) {
      let n = el;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        const oy = cs.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 20) return n;
        n = n.parentElement;
      }
      return null;
    }

    const allEntries = [];
    const seenKeys = new Set();
    const collect = () => { for (const e of collectEntries(container, seenKeys)) allEntries.push(e); };

    const scroller = scrollableAncestor(container)
      || (container.scrollHeight > container.clientHeight + 20 ? container : (document.scrollingElement || document.documentElement));

    // On part du haut pour tout balayer dans l'ordre.
    try { scroller.scrollTop = 0; } catch (e) { /* ignore */ }
    await sleep(600);
    collect();

    // Défilement par paliers. La liste est VIRTUALISÉE : piloter `scrollTop` en
    // absolu est fragile car le composant recalcule sa hauteur quand de nouvelles
    // cellules se chargent et remet alors `scrollTop` à 0 (« décrochage » → on
    // repart du haut en boucle). On ancre donc le défilement sur la DERNIÈRE
    // cellule rendue via `scrollIntoView` : on vise un nœud réel, c'est
    // auto-correctif (si le framework saute en haut, on re-descend vers elle).
    // Critère d'arrêt : plus aucune nouvelle entrée après plusieurs paliers.
    function lastCell() {
      let cells = container.querySelectorAll('[data-automationid="ListCell"], [role="listitem"]');
      if (!cells.length) cells = container.children;
      return cells.length ? cells[cells.length - 1] : null;
    }

    let stable = 0;
    let lastCount = -1;
    for (let i = 0; i < 400; i++) {
      // Arrêt demandé depuis le service worker : on stoppe le défilement immédiatement.
      try { if (window.__ttdAbort) break; } catch (e) { /* ignore */ }
      collect();
      if (allEntries.length === lastCount) stable++;
      else { stable = 0; lastCount = allEntries.length; }
      if (stable >= 8) break; // plus de nouvelles entrées : on a tout balayé

      const last = lastCell();
      if (last && last.scrollIntoView) {
        try { last.scrollIntoView({ block: 'end' }); } catch (e) { /* ignore */ }
      } else {
        // repli si aucune cellule ciblable : poussée relative classique
        const step = Math.max(200, Math.floor(scroller.clientHeight * 0.8));
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + step);
      }
      await sleep(600);
    }

    // Passe finale tout en bas.
    collect();
    return { found: allEntries.length > 0, entries: allEntries, scrolled: true };
  })();
}

function frameGetTitle() {
  for (const sel of ['[data-tid="chat-title"]', '[data-tid="meeting-title"]', 'h1', 'h2', '[role="heading"]']) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) return el.textContent.trim();
  }
  return null;
}

// Lit la date/heure de la réunion affichée dans l'en-tête du récapitulatif
// (data-tid="intelligent-recap-header"). Pour une réunion récurrente, cet en-tête
// reflète l'OCCURRENCE sélectionnée dans la dropdown (positionnée au préalable sur
// la plus récente), ce qui en fait un identifiant fiable et STABLE entre sessions
// — contrairement à l'empreinte de contenu, qui varie selon l'extraction.
// Le premier <span dir="auto"> de l'en-tête contient la date (ex.
// « lundi 22 juin 2026 12:00 – 12:25 ») ; les spans suivants appartiennent à la
// barre d'outils (Partager…). On valide par la présence d'une heure « HH:MM ».
function frameGetRecapDate() {
  const h = document.querySelector('[data-tid="intelligent-recap-header"]');
  if (!h) return { found: false };
  for (const span of h.querySelectorAll('span[dir="auto"]')) {
    const txt = (span.textContent || '').trim();
    if (txt && /\d{1,2}[:h]\d{2}/.test(txt)) return { found: true, date: txt };
  }
  // Repli : balayer le texte de l'en-tête pour une date avec heure.
  const all = (h.textContent || '').trim();
  const m = all.match(/.*?\d{1,2}[:h]\d{2}\s*[–-]\s*\d{1,2}[:h]\d{2}/);
  if (m) return { found: true, date: m[0].trim() };
  return { found: false };
}

function frameChats(action, arg, meetingsOnly) {
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  const NAV_LABELS = new Set([
    'copilot', 'vues rapides', 'quick views', 'mentions',
    'discussions suivies', 'discussions épinglées', 'followed chats',
    'découverte', 'discover', 'brouillons', 'drafts',
    'activité', 'activity', 'calendrier', 'calendar', 'appels', 'calls',
    'fichiers', 'files', 'équipes', 'teams', 'récent', 'recent', 'favoris',
    'favorites', 'contacts', 'applications', 'apps', 'aide', 'help',
    'paramètres', 'settings', 'enregistré', 'saved', 'planificateur'
  ]);
  const TEAMS_MARKERS = ['afficher tous les canaux', 'voir toutes vos équipes', 'show all channels', 'see all your teams'];
  const CONTROL_PREFIXES = ['voir plus', 'afficher plus', 'see more'];
  function norm(label) { return label.toLowerCase().replace(/\s*\d+$/, '').trim(); }

  // Signatures DOM observées (debug réel) :
  //   - personne (1:1) : [data-tid="PersonaAvatar"] (+ presence-badge) ;
  //   - groupe         : photo <img>, sans icône svg ;
  //   - réunion        : icône générique span.fui-Avatar__icon (svg), sans PersonaAvatar.
  function isPerson(el) { return !!el.querySelector('[data-tid="PersonaAvatar"]'); }
  function isMeeting(el) { return !!el.querySelector('.fui-Avatar__icon') && !isPerson(el); }

  function collectChatItems(onlyMeetings) {
    const all = Array.from(document.querySelectorAll('[role="treeitem"]'));
    const items = [];
    for (const el of all) {
      if (!visible(el)) continue;
      if (el.querySelector('[role="treeitem"]')) continue;
      const label = (el.textContent || '').trim();
      const low = norm(label);
      if (label.length < 2 || NAV_LABELS.has(low)) continue;
      if (TEAMS_MARKERS.some(m => low.startsWith(m))) break;
      if (CONTROL_PREFIXES.some(c => low.startsWith(c))) continue;
      if (!el.id) continue;
      if (onlyMeetings) {
        if (!isMeeting(el)) continue;
      } else {
        // tout chat : personne, groupe (photo) ou réunion (icône)
        if (!(isPerson(el) || isMeeting(el) || el.querySelector('img'))) continue;
      }
      items.push(el);
    }
    return items;
  }

  if (action === 'list') {
    const items = collectChatItems(!!meetingsOnly);
    function whenOf(it) {
      const t = it.querySelector('time');
      let w = t ? (t.getAttribute('datetime') || t.textContent || '') : '';
      if (!w.trim()) { const ts = it.querySelector('[id^="time-"], [class*="timestamp" i]'); if (ts) w = ts.textContent || ''; }
      if (!w.trim()) { const al = it.getAttribute('aria-label'); if (al) w = al; }
      return w.trim().slice(0, 60);
    }
    return { ok: items.length > 0, items: items.map(it => ({ id: it.id, label: (it.textContent || '').trim().slice(0, 80), when: whenOf(it) })) };
  }
  const it = arg ? document.getElementById(arg) : null;
  if (!it) return { ok: false, reason: 'id not found', id: arg };
  try { it.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
  const clickable = it.querySelector('a,button,[role="link"],[tabindex]') || it;
  clickable.click();
  return { ok: true, id: arg, label: (it.textContent || '').trim().slice(0, 80) };
}

function frameClickVoirPlus() {
  function visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  const TEAMS_MARKERS = ['afficher tous les canaux', 'voir toutes vos équipes', 'show all channels', 'see all your teams'];
  const SEE_MORE = ['voir plus', 'afficher plus', 'see more'];
  const all = Array.from(document.querySelectorAll('[role="treeitem"]'));
  for (const el of all) {
    if (!visible(el)) continue;
    if (el.querySelector('[role="treeitem"]')) continue;
    const low = (el.textContent || '').trim().toLowerCase().replace(/\s*\d+$/, '').trim();
    if (TEAMS_MARKERS.some(m => low.startsWith(m))) break;
    if (SEE_MORE.some(c => low.startsWith(c))) {
      const clickable = el.querySelector('a,button,[role="link"],[tabindex]') || el;
      clickable.click();
      return { ok: true, label: (el.textContent || '').trim().slice(0, 40) };
    }
  }
  return { ok: false };
}

function frameClickByKeywords(keywords) {
  function visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  const kw = keywords.map(k => k.toLowerCase());
  const candidates = document.querySelectorAll('button,[role="tab"],[role="button"],a,[role="link"],[role="menuitem"],div[tabindex],span[tabindex]');
  for (const el of candidates) {
    if (!visible(el)) continue;
    const txt = (el.textContent || '').trim().toLowerCase();
    const aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase();
    if (!txt && !aria) continue;
    const matchTxt = txt.length <= 40 && kw.some(k => txt === k || txt.includes(k));
    const matchAria = aria.length <= 60 && kw.some(k => aria.includes(k));
    if (matchTxt || matchAria) { el.click(); return { ok: true, matched: (txt || aria).slice(0, 60) }; }
  }
  return { ok: false };
}

// Clique précisément un élément par son data-tid (onglets stables du récap).
function frameClickTid(tid) {
  const el = document.querySelector(`[data-tid="${tid}"]`);
  if (!el) return { ok: false, tid };
  const c = el.querySelector('a,button,[role="tab"],[role="link"],[tabindex]') || el;
  c.click();
  return { ok: true, tid };
}

// Ouvre l'onglet « Récapitulatif ». Quand le nom de la réunion est long, les onglets
// (Conversation, Partagé, Récapitulatif…) sont repliés dans un menu de débordement
// « +N » → l'onglet recap n'est pas directement cliquable. On l'ouvre alors d'abord,
// puis on clique Récapitulatif dans le menu.
function frameOpenRecap() {
  return (async () => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function vis(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    function clickEl(el) { (el.querySelector('a,button,[role="tab"],[role="link"],[role="menuitem"],[tabindex]') || el).click(); }
    const RECAP_KW = ['récapitulatif', 'recapitulatif', 'recap', 'récap'];

    // 1) Onglet Récapitulatif directement visible.
    let recap = document.querySelector('[data-tid="tab-item-com.microsoft.chattabs.recap"]');
    if (recap && vis(recap)) { clickEl(recap); return { ok: true, via: 'direct' }; }

    // 2) Sinon, ouvrir le menu de débordement d'onglets ("+N" / "Plus d'onglets").
    function findOverflow() {
      const cands = document.querySelectorAll('button,[role="button"],[role="tab"],[aria-haspopup],[data-tid]');
      for (const el of cands) {
        if (!vis(el)) continue;
        const txt = (el.textContent || '').trim();
        const aria = (((el.getAttribute && el.getAttribute('aria-label')) || '')).toLowerCase();
        const tid = (((el.getAttribute && el.getAttribute('data-tid')) || '')).toLowerCase();
        if (/^\+\d+$/.test(txt)) return el;                                   // bouton "+3"
        if (/(plus d.onglet|autres onglet|more tab|overflow|more items|plus d.[ée]l[ée])/.test(aria)) return el;
        if (/overflow|moreoptions|tablist.*more|more.*tab/.test(tid)) return el;
      }
      return null;
    }
    const of = findOverflow();
    if (!of) return { ok: false, reason: 'overflow not found' };
    clickEl(of);
    await sleep(800);

    // 3) Cliquer « Récapitulatif » dans le menu ouvert (data-tid si présent, sinon texte).
    recap = document.querySelector('[data-tid="tab-item-com.microsoft.chattabs.recap"]');
    if (recap && vis(recap)) { clickEl(recap); return { ok: true, via: 'overflow-tid' }; }
    const items = document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],[role="tab"],button,a');
    for (const el of items) {
      if (!vis(el)) continue;
      const t = (el.textContent || '').trim().toLowerCase();
      const a = (((el.getAttribute && el.getAttribute('aria-label')) || '')).toLowerCase();
      if (RECAP_KW.some(k => (t.length <= 40 && t.includes(k)) || a.includes(k))) {
        clickEl(el);
        return { ok: true, via: 'overflow-text', matched: (t || a).slice(0, 40) };
      }
    }
    return { ok: false, reason: 'recap item not found in overflow menu' };
  })();
}

// Réunions récurrentes : le récap affiche un sélecteur d'instance (date/heure)
// qu'il faut positionner sur l'occurrence PASSÉE la plus récente avant d'extraire,
// sinon on récupère le transcript d'une autre occurrence (ou rien).
// data-testid stable : "intelligent-recap-instance-select-dropdown".
// Renvoie { found } et, si ouvert et sélectionné, { opened, selected, count }.
function frameSelectLatestInstance() {
  return (async () => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function vis(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }

    // Parse une date FR du type "mercredi 17 juin 2026 13:30 – 14:00" → timestamp.
    function parseFrDate(s) {
      const months = {
        janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
        juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10,
        décembre: 11, decembre: 11
      };
      const m = (s || '').toLowerCase().match(/(\d{1,2})\s+([a-zàâäéèêëïîôöùûüç]+)\s+(\d{4})(?:\D+(\d{1,2})[:h](\d{2}))?/);
      if (!m) return null;
      const mon = months[m[2]];
      if (mon === undefined) return null;
      return new Date(+m[3], mon, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime();
    }

    const btn = document.querySelector('[data-testid="intelligent-recap-instance-select-dropdown"]');
    if (!btn) return { found: false };

    const current = (btn.textContent || '').trim().slice(0, 80);
    btn.click(); // ouvre la liste déroulante
    await sleep(900);

    let opts = Array.from(document.querySelectorAll('[role="option"]')).filter(vis);
    if (!opts.length) { try { btn.click(); } catch (e) { /* referme */ } return { found: true, opened: false, current }; }

    const parsed = opts.map(o => ({ el: o, text: (o.textContent || '').trim().slice(0, 80), t: parseFrDate(o.textContent || '') }));
    const now = Date.now();
    let best = null;
    // 1) occurrence passée la plus récente (t <= maintenant)
    for (const p of parsed) if (p.t != null && p.t <= now && (best == null || p.t > best.t)) best = p;
    // 2) repli : occurrence datée la plus récente toutes confondues
    if (!best) for (const p of parsed) if (p.t != null && (best == null || p.t > best.t)) best = p;
    // 3) repli : 1re option de la liste
    if (!best) best = parsed[0];

    best.el.click();
    await sleep(600);
    return { found: true, opened: true, selected: best.text, count: opts.length, current };
  })();
}

function frameDumpSidebar() {
  function info(el) {
    const cls = el.className && el.className.toString ? el.className.toString() : '';
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : '', role: el.getAttribute('role'),
      dataTid: el.getAttribute('data-tid'), id: el.id || null,
      ariaLabel: el.getAttribute('aria-label'), className: cls.slice(0, 100),
      text: (el.textContent || '').trim().slice(0, 60)
    };
  }
  const selectors = ['[role="tree"]', '[role="treeitem"]', '[data-tid="chat-list"]', '#chat-list'];
  const out = {};
  for (const sel of selectors) {
    let els = [];
    try { els = Array.from(document.querySelectorAll(sel)); } catch (e) { continue; }
    out[sel] = { count: els.length, samples: els.slice(0, 6).map(info) };
  }

  // Détail enrichi des discussions retenues, pour identifier le signal qui
  // distingue un chat de réunion d'un chat individuel/groupe.
  function vis(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  const NAV = new Set([
    'copilot', 'vues rapides', 'mentions', 'discussions suivies', 'découverte',
    'brouillons', 'activité', 'calendrier', 'appels', 'fichiers', 'équipes'
  ]);
  const TEAMS_MARKERS = ['afficher tous les canaux', 'voir toutes vos équipes'];
  function norm(s) { return s.toLowerCase().replace(/\s*\d+$/, '').trim(); }

  function detail(el) {
    // Icônes / éléments porteurs d'indices (svg, i, data-tid, classes "icon")
    const iconNodes = Array.from(el.querySelectorAll('svg, i, [data-tid], [class*="icon" i], [class*="Icon"]')).slice(0, 8);
    const icons = iconNodes.map(n => ({
      tag: (n.tagName || '').toLowerCase(),
      dataTid: n.getAttribute && n.getAttribute('data-tid'),
      aria: n.getAttribute && n.getAttribute('aria-label'),
      title: n.getAttribute && n.getAttribute('title'),
      cls: ((n.getAttribute && n.getAttribute('class')) || '').slice(0, 70)
    }));
    const txt = (el.textContent || '').trim();
    return {
      id: el.id || null,
      label: txt.slice(0, 60),
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      dataTid: el.getAttribute('data-tid'),
      hasImg: !!el.querySelector('img'),
      hasSvg: !!el.querySelector('svg'),
      // indices texte : date/heure souvent présents sur les chats de réunion
      hasDateTime: /\b\d{1,2}[:h]\d{2}\b|\b\d{1,2}\/\d{1,2}\b|lun\.|mar\.|mer\.|jeu\.|ven\.|sam\.|dim\./i.test(txt),
      icons
    };
  }

  const leaves = Array.from(document.querySelectorAll('[role="treeitem"]')).filter(el =>
    vis(el) && !el.querySelector('[role="treeitem"]') && (el.textContent || '').trim().length >= 2
  );
  const kept = [];
  for (const el of leaves) {
    const low = norm((el.textContent || '').trim());
    if (NAV.has(low)) continue;
    if (TEAMS_MARKERS.some(m => low.startsWith(m))) break;
    if (!el.id) continue;
    if (!el.querySelector('img,[role="img"]')) continue;
    kept.push(detail(el));
  }
  out.__chatCandidates = { count: kept.length, kept };
  return out;
}

// Liste les éléments cliquables visibles (onglets/boutons/liens) d'une frame,
// pour découvrir les libellés réels (Récapitulatif, Transcription…).
function frameListClickables() {
  function vis(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  const out = [];
  const els = document.querySelectorAll('button,[role="tab"],[role="button"],a,[role="link"],[role="menuitem"],[role="menuitemradio"]');
  for (const el of els) {
    if (!vis(el)) continue;
    const t = (el.textContent || '').trim().slice(0, 50);
    const a = ((el.getAttribute('aria-label')) || '').slice(0, 50);
    if (!t && !a) continue;
    out.push({ t, a, role: el.getAttribute('role'), tid: el.getAttribute('data-tid') });
    if (out.length >= 60) break;
  }
  return out;
}

// ============================================================
// Helpers d'injection (côté service worker)
// ============================================================

async function runInFrame(tabId, frameId, func, args) {
  const opts = { target: { tabId, frameIds: [frameId] }, func };
  if (args !== undefined) opts.args = args;
  const results = await chrome.scripting.executeScript(opts);
  return results && results[0] ? results[0].result : undefined;
}

async function clickAcrossFrames(tabId, keywords) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  for (const frame of frames) {
    try {
      const res = await runInFrame(tabId, frame.frameId, frameClickByKeywords, [keywords]);
      if (res && res.ok) return { ...res, frameId: frame.frameId };
    } catch (e) { /* frame non scriptable */ }
  }
  return { ok: false };
}

// Cherche le sélecteur d'instance (réunion récurrente) dans toutes les frames et
// positionne l'occurrence la plus récente. No-op (found:false) pour une réunion
// simple sans sélecteur.
async function selectLatestInstanceAcrossFrames(tabId) {
  let frames = [];
  try { frames = await chrome.webNavigation.getAllFrames({ tabId }); } catch (e) { return { found: false }; }
  for (const frame of frames) {
    try {
      const res = await runInFrame(tabId, frame.frameId, frameSelectLatestInstance);
      if (res && res.found) return { ...res, frameId: frame.frameId };
    } catch (e) { /* frame non scriptable */ }
  }
  return { found: false };
}

// Cherche la date/heure de la réunion (en-tête du récap) dans toutes les frames.
// L'en-tête est rendu de façon ASYNCHRONE après ouverture de la réunion : si on lit
// trop tôt on obtient '' alors qu'au scan suivant on l'obtient → la clé de dédup
// changerait d'un run à l'autre (re-téléchargement). On SONDE donc jusqu'à ce que
// l'en-tête apparaisse (la stabilité de cette lecture est la condition de la dédup).
async function getRecapDateAcrossFrames(tabId, tries = 8, delayMs = 700) {
  for (let attempt = 0; attempt < tries; attempt++) {
    let frames = [];
    try { frames = await chrome.webNavigation.getAllFrames({ tabId }); } catch (e) { return ''; }
    for (const frame of frames) {
      try {
        const res = await runInFrame(tabId, frame.frameId, frameGetRecapDate);
        if (res && res.found && res.date) return res.date;
      } catch (e) { /* frame non scriptable */ }
    }
    if (attempt < tries - 1) await sleep(delayMs);
  }
  return '';
}

async function findTranscriptFrame(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  let bestFrame = null;
  let bestScore = 0;
  for (const frame of frames) {
    try {
      const r = await runInFrame(tabId, frame.frameId, frameScanForTranscript);
      if (!r) continue;
      const score = r.timeCount + r.listCells * 5 + r.listItems * 5;
      if (score > bestScore && r.hasContent) {
        bestScore = score;
        bestFrame = { frameId: frame.frameId, frameUrl: frame.url, ...r };
      }
    } catch (e) { /* ignore */ }
  }
  return { bestFrame, bestScore };
}

async function extractFromFrame(tabId, bestFrame) {
  const extractResult = await runInFrame(tabId, bestFrame.frameId, frameFullExtract);
  let entries = [];
  if (extractResult && extractResult.found) entries = extractResult.entries;
  let title = 'Meeting Transcript';
  try { const t = await runInFrame(tabId, 0, frameGetTitle); if (t) title = t; } catch (e) { /* ignore */ }
  return { title, entries };
}

// ============================================================
// Onglet Teams dédié
// ============================================================

function isTeamsUrl(url) {
  return !!url && (url.includes('teams.microsoft.com') || url.includes('teams.cloud.microsoft'));
}

// Renvoie le tabId de l'onglet Teams piloté, en le réutilisant s'il est encore
// ouvert, sinon en créant un NOUVEL onglet Teams (on ne détourne pas un onglet
// Teams quelconque de l'utilisateur). Le panneau y est activé et le voile appliqué.
async function ensureTeamsTab() {
  const stored = await chrome.storage.local.get('dedicatedTabId');
  if (stored.dedicatedTabId != null) {
    try {
      const t = await chrome.tabs.get(stored.dedicatedTabId);
      if (t && isTeamsUrl(t.url || t.pendingUrl)) {
        await setDedicated(t.id);
        try { await chrome.sidePanel.setOptions({ tabId: t.id, path: 'panel.html', enabled: true }); } catch (e) { /* ignore */ }
        refreshOverlay(t.id).catch(() => {}); // voile seulement si automatisation ON
        return t.id;
      }
    } catch (e) { /* onglet fermé */ }
  }
  const created = await chrome.tabs.create({ url: TEAMS_URL, active: false });
  await setDedicated(created.id);
  // Active le panneau pour ce nouvel onglet (indispensable sans default_path pour
  // que sidePanel.open() ait un contenu à afficher).
  try { await chrome.sidePanel.setOptions({ tabId: created.id, path: 'panel.html', enabled: true }); } catch (e) { /* ignore */ }
  // L'onglet vient d'être créé et charge encore : le voile/guide sont appliqués
  // quand la page a fini de charger, via chrome.tabs.onUpdated (sinon l'injection
  // serait effacée par la navigation vers Teams).
  return created.id;
}

// Attend que la liste des discussions soit rendue (SPA Teams).
async function waitForChatList(tabId, gen, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (gen !== undefined && scanGen !== gen) return false;
    try {
      const list = await runInFrame(tabId, 0, frameChats, ['list', null]);
      if (list && list.ok && list.items.length) return true;
    } catch (e) { /* pas encore prêt */ }
    await sleep(2500);
  }
  return false;
}

// ============================================================
// Téléchargement (service worker → data URL, pas de Blob/URL.createObjectURL)
// ============================================================

function sanitizeFilename(name) { return name.replace(/[^a-z0-9\-_]/gi, '_').toLowerCase(); }
function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function buildTxt(transcript) {
  const formatted = [];
  let curSpeaker = null, curMessage = '';
  transcript.entries.forEach((entry, i) => {
    const speaker = entry.speaker || 'Inconnu';
    if (speaker === curSpeaker && entry.time === '--:--') {
      curMessage += ' ' + entry.message;
    } else {
      if (curSpeaker !== null) {
        formatted.push({ time: transcript.entries[i - 1]?.time || '', speaker: curSpeaker, message: curMessage.trim() });
      }
      curSpeaker = speaker; curMessage = entry.message;
    }
  });
  if (curSpeaker !== null) {
    formatted.push({ time: transcript.entries[transcript.entries.length - 1]?.time || '', speaker: curSpeaker, message: curMessage.trim() });
  }
  const lines = [
    `Transcript: ${transcript.title}`,
    `Date: ${new Date(transcript.date).toLocaleString()}`,
    `URL: ${transcript.url}`, '',
    '========================================', '',
    ...formatted.map(e => `${e.time ? `[${e.time}] ` : ''}${e.speaker}: ${e.message}`),
    '', '========================================',
    `Total: ${formatted.length} entrées`
  ];
  return lines.join('\n');
}

// Sécurité : un transcript dont le fichier fait moins de ce seuil est considéré
// comme une extraction incomplète (chargement raté) → on retente.
const MIN_TRANSCRIPT_BYTES = 10 * 1024; // 10 Ko

function txtByteLength(text) {
  try { return new TextEncoder().encode(text).length; } catch (e) { return (text || '').length; }
}

async function downloadTxt(transcript) {
  const text = buildTxt(transcript);
  const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  const filename = `transcript-${sanitizeFilename(transcript.title)}-${formatDate()}.txt`;
  await chrome.downloads.download({ url, filename, saveAs: false });
}

// ============================================================
// Historique des transcripts déjà traités (persistant)
//   Clé = empreinte des PREMIÈRES entrées du transcript. L'extraction part toujours
//   du haut, donc le début est capturé de façon fiable et REPRODUCTIBLE d'un scan à
//   l'autre — contrairement à la fin (défilement virtualisé / chargement lazy, qui
//   peut tronquer) ou au titre (parfois remplacé par le libellé par défaut). Baser
//   la clé sur le début (et l'ignorer titre + total) évite de re-télécharger le même
//   transcript quand l'extraction varie légèrement.
// ============================================================

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; }
  return h >>> 0;
}

function normMsg(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function transcriptKey(t) {
  const entries = t.entries || [];
  const head = entries.slice(0, 20)
    .map(e => `${(e.speaker || '').trim().toLowerCase()}:${normMsg(e.message).slice(0, 80)}`)
    .join('\n');
  return 'h' + hashStr(head);
}

// Extrait l'ID de thread Teams (ex. "19:meeting_…@thread.v2") de l'id de l'élément
// de discussion. Cet ID est STABLE entre sessions, contrairement au contenu extrait.
function meetingThreadId(chatItemId) {
  const m = (chatItemId || '').match(/(19:[^@\s"']+@thread\.[a-z0-9]+)/i);
  return m ? m[1] : '';
}

// Canonise une date FR de réunion (« lundi 22 juin 2026 12:00 – 12:25 ») en une clé
// STABLE et insensible au rendu : « 2026-06-22-1200 » (date + heure de DÉBUT). Ainsi
// les variations d'espaces/format/locale n'altèrent pas la clé de dédup. Repli sur le
// texte normalisé si le parsing échoue (langue/format inattendu).
function canonicalMeetingDate(s) {
  const raw = (s || '').toLowerCase();
  if (!raw) return '';
  const months = {
    janvier: '01', février: '02', fevrier: '02', mars: '03', avril: '04', mai: '05',
    juin: '06', juillet: '07', août: '08', aout: '08', septembre: '09', octobre: '10',
    novembre: '11', décembre: '12', decembre: '12'
  };
  const m = raw.match(/(\d{1,2})\s+([a-zàâäéèêëïîôöùûüç]+)\s+(\d{4})\D+(\d{1,2})[:h](\d{2})/);
  if (m && months[m[2]]) {
    const day = m[1].padStart(2, '0');
    const hh = m[4].padStart(2, '0');
    return `${m[3]}-${months[m[2]]}-${day}-${hh}${m[5]}`;
  }
  return normMsg(raw);
}

// Clé de déduplication : identité = thread Teams (stable) + DATE/HEURE de la réunion
// lue dans l'en-tête du récap (data-tid="intelligent-recap-header"), canonisée. Cette
// date distingue les occurrences d'une réunion récurrente ET donne une identité fiable
// aux réunions simples (l'empreinte de contenu, elle, varie d'un scan à l'autre).
// Ordre de préférence pour la date : en-tête récap → instance sélectionnée (dropdown).
// Replis si aucune date n'est disponible : thread seul, sinon empreinte de contenu.
function dedupKey(chatItemId, transcript) {
  const tid = meetingThreadId(chatItemId);
  const inst = (lastDiag && lastDiag.instance) ? lastDiag.instance : null;
  const recapDate = (lastDiag && lastDiag.recapDate) || '';
  const dateKey = canonicalMeetingDate(recapDate || (inst ? (inst.selected || inst.current || '') : ''));
  if (tid) return 't:' + tid + '|' + dateKey;
  if (dateKey) return 'd:' + dateKey;
  return transcriptKey(transcript);
}

async function getProcessed() {
  return (await chrome.storage.local.get('processedKeys')).processedKeys || {};
}

async function saveProcessed(map) {
  await chrome.storage.local.set({ processedKeys: map });
}

// ============================================================
// Journal des runs (persistant) — affiché dans le panneau (du + récent au + ancien)
//   Chaque run : date/heure + liste des réunions scannées (nom, date/heure réunion,
//   statut : downloaded / skipped / noTranscript).
// ============================================================

const RUN_LOG_MAX = 30;

async function appendRun(run) {
  const { runLog } = await chrome.storage.local.get('runLog');
  const list = Array.isArray(runLog) ? runLog : [];
  list.unshift(run); // plus récent en tête
  await chrome.storage.local.set({ runLog: list.slice(0, RUN_LOG_MAX) });
}

// ============================================================
// Orchestration du scan
// ============================================================

let lastDiag = null; // diagnostic de la dernière tentative d'extraction

// Tente une extraction depuis la frame la plus « transcript » (recap SharePoint).
async function extractBest(tabId, tabUrl, minScore) {
  const { bestFrame, bestScore } = await findTranscriptFrame(tabId);
  if (!bestFrame || bestScore < minScore) return { transcript: null, bestScore, bestFrameUrl: bestFrame ? bestFrame.frameUrl : null };
  const { title, entries } = await extractFromFrame(tabId, bestFrame);
  if (!entries.length) return { transcript: null, bestScore, bestFrameUrl: bestFrame.frameUrl, empty: true };
  return { transcript: { title, date: new Date().toISOString(), entries, url: tabUrl }, bestScore, bestFrameUrl: bestFrame.frameUrl };
}

// Flux d'extraction d'une réunion ouverte.
// Constat (debug réel) : à l'ouverture d'une réunion, le récapitulatif charge
// déjà le transcript dans une iframe SharePoint (data-automationid="ListCell").
// On tente donc l'extraction DIRECTE d'abord (sans cliquer, ce qui détruisait
// l'iframe), puis en repli on ouvre l'onglet Récap + sous-onglet Transcript via
// leurs data-tid stables (pas de match texte destructeur).
// `forceTabs` : ignore le retour anticipé du chemin direct et passe TOUJOURS par
// l'onglet Récap + sous-onglet Transcript. Le chemin direct peut capter un aperçu
// horodaté PARTIEL du récap (peu d'entrées) sans jamais ouvrir le vrai onglet
// Transcript ; on l'utilise donc pour escalader sur une nouvelle tentative quand la
// précédente a produit un transcript trop court.
async function tryExtractCurrent(tabId, tabUrl, gen, forceTabs = false) {
  // 0) réunion récurrente : positionner l'occurrence la plus récente AVANT
  // d'extraire (no-op si pas de sélecteur d'instance).
  let instance = await selectLatestInstanceAcrossFrames(tabId);
  if (instance && instance.opened) { await sleepCancellable(4000, gen); if (scanGen !== gen) return null; }

  // 1) tentative directe (seuil élevé : un vrai transcript a un score important).
  // Ignorée en mode escalade (`forceTabs`) car le direct a déjà donné un résultat
  // trop court : on force l'ouverture du vrai onglet Transcript ci-dessous.
  if (!forceTabs) {
    let r = await extractBest(tabId, tabUrl, 30);
    if (r.transcript) {
      const recapDate = await getRecapDateAcrossFrames(tabId);
      lastDiag = { path: 'direct', instance, recapDate, bestScore: r.bestScore };
      return r.transcript;
    }
    if (scanGen !== gen) return null;
  }

  // 2) repli : onglet Récapitulatif (en dépliant le menu "+N" si le nom de réunion
  //    est long et masque l'onglet), puis sous-onglet Transcript (data-tid).
  const recap = await runInFrame(tabId, 0, frameOpenRecap);
  await sleepCancellable(4000, gen);
  if (scanGen !== gen) return null;
  const tr = await runInFrame(tabId, 0, frameClickTid, ['Transcript']);
  await sleepCancellable(5000, gen);
  if (scanGen !== gen) return null;

  // Le sélecteur d'instance n'apparaît parfois qu'après ouverture du récap : re-tenter.
  if (!(instance && instance.opened)) {
    const again = await selectLatestInstanceAcrossFrames(tabId);
    if (again && again.found) instance = again;
    if (again && again.opened) { await sleepCancellable(4000, gen); if (scanGen !== gen) return null; }
  }

  const recapDate = await getRecapDateAcrossFrames(tabId);
  const r = await extractBest(tabId, tabUrl, 8);
  lastDiag = {
    path: forceTabs ? 'forced-tabs' : 'after-tabs',
    recapDate,
    recapTab: !!(recap && recap.ok),
    recapVia: recap ? (recap.via || recap.reason || null) : null,
    transcriptTab: !!(tr && tr.ok),
    instance: instance || null,
    bestScore: r.bestScore,
    bestFrameUrl: r.bestFrameUrl,
    reason: r.transcript ? null : (r.empty ? 'frame trouvée mais 0 entrée' : 'transcript introuvable (score insuffisant)')
  };
  return r.transcript;
}

async function expandChatList(tabId, gen, maxExpand = 20) {
  for (let i = 0; i < maxExpand; i++) {
    if (scanGen !== gen) return;
    let res;
    try { res = await runInFrame(tabId, 0, frameClickVoirPlus); } catch (e) { break; }
    if (!res || !res.ok) break;
    await setState({ message: `Chargement des discussions… (${i + 1})` });
    await sleepCancellable(1500, gen);
  }
}

async function startScan(reason = 'manual') {
  if (isRunning) return;
  isRunning = true;
  const myGen = ++scanGen; // ce scan est valide tant que scanGen === myGen
  const startedAt = Date.now();
  const runMeetings = []; // journal du run : { name, when, status }
  startKeepAlive();

  // `aborted()` : le scan a-t-il été invalidé (Stop manuel ou nouveau scan) ?
  // Dans ce cas on sort SANS écrire d'état — le demandeur de l'arrêt est propriétaire
  // de l'état affiché (évite d'écraser l'état idle propre par un « Arrêté à i/total »).
  const aborted = () => scanGen !== myGen;

  try {
    const { maxChats, meetingsOnly } = await getSettings();
    await setState({ running: true, phase: 'opening', current: 0, total: 0, downloaded: 0, currentLabel: '', nextRunAt: null, summary: null, message: 'Ouverture de Teams…', reason });

    const tabId = await ensureTeamsTab();

    await setState({ phase: 'opening', message: 'Attente du chargement de Teams…' });
    const ready = await waitForChatList(tabId, myGen);
    if (aborted()) return;
    if (!ready) { await setState({ running: false, phase: 'error', message: 'Teams n\'a pas chargé la liste des discussions.' }); return; }

    await setState({ phase: 'expanding', message: 'Chargement des discussions masquées…' });
    await expandChatList(tabId, myGen);
    if (aborted()) return;

    const list = await runInFrame(tabId, 0, frameChats, ['list', null, meetingsOnly]);
    if (!list || !list.ok || !list.items.length) {
      await setState({ running: false, phase: 'error', message: meetingsOnly ? 'Aucune réunion trouvée.' : 'Aucune discussion trouvée.' });
      return;
    }

    const items = list.items.slice(0, Math.max(1, maxChats));
    const total = items.length;
    const processed = await getProcessed(); // historique persistant
    let downloaded = 0;
    let skipped = 0;
    let noTranscript = 0;
    let errored = 0;
    await setState({ phase: 'scanning', total });

    for (let i = 0; i < total; i++) {
      if (aborted()) return;

      const label = items[i].label || `discussion ${i + 1}`;
      await setState({ current: i + 1, currentLabel: label, downloaded, message: `Discussion ${i + 1}/${total} : ${label}` });

      // Extraction avec sécurité de taille : un transcript dont le fichier fait
      // moins de MIN_TRANSCRIPT_BYTES est jugé incomplet (chargement raté) → on
      // ré-ouvre la discussion et on retente (jusqu'à 3 tentatives).
      // On conserve le MEILLEUR (plus gros) transcript rencontré : une tentative
      // ultérieure peut produire moins d'entrées (frame différente) et ne doit pas
      // écraser un meilleur résultat déjà obtenu.
      let transcript = null, text = '', bytes = 0, attempts = 0;
      // Escalade : la 1re tentative essaie le chemin direct ; dès qu'une tentative
      // donne un transcript trop court, les suivantes FORCENT l'ouverture du vrai
      // onglet Transcript (le direct ne capte parfois qu'un aperçu partiel du récap).
      let forceTabs = false;
      for (let attempt = 1; attempt <= 3 && !aborted(); attempt++) {
        attempts = attempt;
        let clickRes;
        try { clickRes = await runInFrame(tabId, 0, frameChats, ['click', items[i].id]); } catch (e) { break; }
        if (!clickRes || !clickRes.ok) break;
        await sleepCancellable(4000, myGen); // laisse le récap + l'iframe transcript se charger
        if (aborted()) return;
        let t = null;
        try { t = await tryExtractCurrent(tabId, TEAMS_URL, myGen, forceTabs); } catch (e) { t = null; }
        if (aborted()) return;
        if (t) {
          const tText = buildTxt(t);
          const tBytes = txtByteLength(tText);
          if (tBytes > bytes) { transcript = t; text = tText; bytes = tBytes; }
        }
        if (bytes >= MIN_TRANSCRIPT_BYTES) break; // OK
        // Trop petit (ou rien) → escalade vers l'onglet Transcript et nouvelle
        // tentative (sauf dernière tentative).
        forceTabs = true;
        if (attempt < 3) await setState({ message: `Transcript incomplet, nouvelle tentative (${attempt + 1}/3) : ${label}` });
      }

      const when = (lastDiag && lastDiag.recapDate)
        || (lastDiag && lastDiag.instance && (lastDiag.instance.selected || lastDiag.instance.current))
        || items[i].when || '';
      const diagSnapshot = lastDiag ? JSON.parse(JSON.stringify(lastDiag)) : null;
      const dbg = { attempts, bytes, entries: transcript ? transcript.entries.length : 0, chatId: items[i].id, title: transcript ? transcript.title : null, diag: diagSnapshot };

      // Aucun transcript trouvé du tout.
      if (!transcript) {
        noTranscript++;
        runMeetings.push({ name: label, when, status: 'noTranscript', ...dbg });
        continue;
      }
      // Transcript trouvé mais fichier < 10 Ko après 3 tentatives → ERREUR (chargement incomplet).
      if (bytes < MIN_TRANSCRIPT_BYTES) {
        errored++;
        runMeetings.push({ name: label, when, status: 'error', ...dbg });
        continue;
      }

      const key = dedupKey(items[i].id, transcript);
      if (processed[key]) { // déjà traité lors d'un cycle/session précédent
        skipped++;
        runMeetings.push({ name: label, when, status: 'skipped', bytes, entries: transcript.entries.length });
        continue;
      }

      try {
        await downloadTxt(transcript);
        downloaded++;
        processed[key] = Date.now();
        await saveProcessed(processed); // persiste au fil de l'eau (survit à l'arrêt du SW)
        runMeetings.push({ name: label, when, status: 'downloaded', bytes, entries: transcript.entries.length });
      } catch (e) {
        errored++;
        runMeetings.push({ name: label, when, status: 'error', ...dbg, downloadError: String(e && e.message ? e.message : e) });
      }
      await setState({ downloaded, message: `Téléchargé : ${transcript.title} (${transcript.entries.length}) — ${downloaded} au total` });
    }

    const unit = meetingsOnly ? 'réunion(s)' : 'discussion(s)';
    let doneMsg = `Terminé : ${downloaded} téléchargé(s), ${skipped} déjà traité(s), ${noTranscript} sans transcript, ${errored} en erreur — ${total} ${unit} scannée(s).`;
    if (downloaded === 0 && skipped === 0 && lastDiag) {
      doneMsg += ` Diag : ${JSON.stringify(lastDiag)}`;
    }
    await appendRun({ startedAt, finishedAt: Date.now(), downloaded, skipped, noTranscript, errored, total, meetings: runMeetings });
    await setState({ running: false, phase: 'done', downloaded, summary: { downloaded, skipped, noTranscript, errored, total, finishedAt: Date.now() }, message: doneMsg });
  } catch (error) {
    if (!aborted()) await setState({ running: false, phase: 'error', message: 'Erreur : ' + (error && error.message ? error.message : String(error)) });
  } finally {
    isRunning = false;
    stopKeepAlive();
    // Point de sortie unique de la boucle d'automatisation :
    //   - scan invalidé (Stop / nouveau scan) → on ne planifie rien. Si une relance
    //     immédiate a été demandée pendant ce scan, on l'exécute maintenant.
    //   - sinon, si l'automatisation est active, on (re)planifie le prochain scan
    //     QUELLE QUE SOIT l'issue (done, erreur, vide…). Ainsi le compte à rebours
    //     réapparaît toujours et la boucle ne meurt jamais silencieusement.
    if (scanGen !== myGen) {
      if (pendingAutoStart) { pendingAutoStart = false; maybeStartAuto('auto'); }
    } else {
      const { autoEnabled } = await getSettings();
      if (autoEnabled) await scheduleNextRun();
    }
  }
}

// Extraction manuelle sur l'onglet actif (repli, panneau déjà ouvert).
async function extractManualActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isTeamsUrl(tab.url)) {
    await setState({ phase: 'error', message: 'Onglet actif non-Teams. Ouvrez Teams.' });
    return;
  }
  await setState({ phase: 'scanning', message: 'Extraction manuelle…' });
  const { bestFrame, bestScore } = await findTranscriptFrame(tab.id);
  if (!bestFrame || bestScore < 3) {
    await setState({ phase: 'error', message: 'Aucun transcript trouvé. Ouvrez le panneau Transcript.' });
    return;
  }
  const { title, entries } = await extractFromFrame(tab.id, bestFrame);
  if (!entries.length) { await setState({ phase: 'error', message: 'Aucune entrée extraite.' }); return; }
  const transcript = { title, date: new Date().toISOString(), entries, url: tab.url };
  await downloadTxt(transcript);
  await setState({ phase: 'done', message: `Transcript téléchargé : ${title} (${entries.length} entrées).` });
}

// ============================================================
// Keep-alive (évite la mise en veille du SW pendant un long scan)
// ============================================================

function startKeepAlive() { chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); }
function stopKeepAlive() { chrome.alarms.clear('keepalive'); }

// ============================================================
// Boucle d'automatisation
//   - activation / démarrage navigateur → scan IMMÉDIAT ;
//   - entre deux scans → pause paramétrable (intervalMin) puis re-scan.
// ============================================================

async function scheduleNextRun() {
  const { intervalMin } = await getSettings();
  const sched = await getSchedule();
  const mins = Math.max(1, intervalMin);
  let target = Date.now() + mins * 60000;
  let message = `Prochain scan dans ${mins} min…`;

  // Si le prochain tick tombe hors plage, on saute directement à l'ouverture
  // de la prochaine fenêtre autorisée plutôt que de re-scanner inutilement.
  if (sched.scheduleEnabled && !isWithinSchedule(sched, new Date(target))) {
    const next = nextWindowStart(sched, new Date());
    if (next == null) {
      await chrome.alarms.clear('autoStart');
      await setState({ phase: 'idle', nextRunAt: null, message: 'Hors plage horaire planifiée : aucun jour sélectionné.' });
      return;
    }
    target = next;
    message = 'Hors plage horaire : prochain scan planifié à l\'ouverture suivante.';
  }

  await chrome.alarms.clear('autoStart');
  chrome.alarms.create('autoStart', { when: target });
  // nextRunAt permet à la popup d'afficher un compte à rebours.
  await setState({ phase: 'idle', nextRunAt: target, message });
}

async function cancelAutoStart() {
  await chrome.alarms.clear('autoStart');
}

// Déclenche un scan auto si l'automatisation est active ET qu'on est dans la
// plage horaire autorisée ; sinon planifie l'ouverture de la prochaine fenêtre.
async function maybeStartAuto(reason = 'auto') {
  const { autoEnabled } = await getSettings();
  if (!autoEnabled || isRunning) return;
  const sched = await getSchedule();
  if (isWithinSchedule(sched)) { startScan(reason); return; }
  const next = nextWindowStart(sched, new Date());
  await chrome.alarms.clear('autoStart');
  if (next == null) {
    await setState({ phase: 'idle', nextRunAt: null, message: 'Hors plage horaire planifiée : aucun jour sélectionné.' });
    return;
  }
  chrome.alarms.create('autoStart', { when: next });
  await setState({ phase: 'idle', nextRunAt: next, message: 'Hors plage horaire : prochain scan planifié à l\'ouverture suivante.' });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoStart') {
    await maybeStartAuto('auto');
  }
  // 'keepalive' : ne rien faire, le simple réveil suffit.
});

chrome.runtime.onInstalled.addListener(async () => {
  await maybeStartAuto('auto');
});

chrome.runtime.onStartup.addListener(async () => {
  await maybeStartAuto('auto');
});

// Clic sur l'icône : ouvre/cible un onglet Teams et y attache la sidebar.
//   - Si l'onglet Teams piloté est déjà connu, ouverture SYNCHRONE du panneau
//     dessus (geste utilisateur préservé → fiable).
//   - Sinon, ouverture d'un nouvel onglet Teams puis tentative d'attache du
//     panneau (au tout premier clic, le geste peut expirer après la création de
//     l'onglet → un second clic l'affichera, l'onglet étant alors connu).
chrome.action.onClicked.addListener((tab) => {
  // Cible déjà activée (panneau prêt) → ouverture synchrone, sans aucun await.
  const syncTarget = (dedicatedTabId != null) ? dedicatedTabId
    : (tab && isTeamsUrl(tab.url) ? tab.id : null);
  if (syncTarget != null) {
    try { const p = chrome.sidePanel.open({ tabId: syncTarget }); if (p && p.catch) p.catch(() => {}); }
    catch (e) { /* API indisponible */ }
  }
  (async () => {
    const tid = await ensureTeamsTab();                 // réutilise/crée l'onglet Teams (+ voile + panneau activé)
    try { await chrome.tabs.update(tid, { active: true }); } catch (e) { /* ignore */ }
    try { await chrome.sidePanel.open({ tabId: tid }); } catch (e) { /* geste expiré → reclic affichera */ }
  })().catch(() => {});
});

// Active/désactive le panneau par onglet quand on change d'onglet ou que l'URL
// change → le panneau n'apparaît que sur les onglets Teams et disparaît dès qu'on
// bascule sur un autre onglet.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { const tab = await chrome.tabs.get(tabId); await syncSidePanel(tab); } catch (e) { /* ignore */ }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) syncSidePanel(tab).catch(() => {});
  // Quand l'onglet piloté a fini de charger (création initiale ou rechargement),
  // on applique l'habillage : automatisation ON → voile bloquant ; OFF → guide
  // non bloquant « cliquez à nouveau » (et pas de voile, pour naviguer librement).
  if (changeInfo.status === 'complete' && tabId === dedicatedTabId) {
    (async () => {
      const { autoEnabled } = await getSettings();
      if (autoEnabled) { await showOverlay(tabId); await hideGuide(tabId); }
      else { await hideOverlay(tabId); await showGuide(tabId); }
    })().catch(() => {});
  }
});

// Si l'onglet piloté est fermé, on oublie son id.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (dedicatedTabId === tabId) clearDedicated().catch(() => {});
});

// ============================================================
// Messages depuis la popup
// ============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'panelReady':
        // Le panneau latéral est ouvert → on masque le guide « cliquez à nouveau »
        // sur le voile de l'onglet piloté (le voile lui-même reste).
        if (dedicatedTabId != null) hideGuide(dedicatedTabId).catch(() => {});
        sendResponse({ ok: true });
        break;
      case 'start':
        startScan('manual');
        sendResponse({ ok: true });
        break;
      case 'stop':
        cancelScan();                // invalide le scan en cours + signale l'arrêt à l'extraction injectée
        pendingAutoStart = false;    // un Stop annule toute relance auto en attente
        await cancelAutoStart();     // n'enchaîne pas le prochain scan de la boucle
        await chrome.storage.local.set({ autoEnabled: false });
        await resetToIdleState('Arrêté. Automatisation désactivée.');
        await updateActionUI();
        await refreshOverlay(); // automatisation OFF → on retire le voile
        sendResponse({ ok: true });
        break;
      case 'extractManual':
        extractManualActiveTab();
        sendResponse({ ok: true });
        break;
      case 'resetHistory': {
        await chrome.storage.local.remove('processedKeys');
        await setState({ phase: 'idle', message: 'Historique réinitialisé : tout sera re-téléchargé au prochain scan.' });
        sendResponse({ ok: true });
        break;
      }
      case 'autoEnabledChanged':
        if (msg.enabled) {
          // Démarrage immédiat. Si un scan est encore en train de s'arrêter
          // (ex. juste après un Stop), on demande une relance dès sa fin pour que
          // l'activation reprenne aussitôt sans attendre l'intervalle.
          await cancelAutoStart(); // évite un double déclenchement si une alarme traîne
          if (isRunning) pendingAutoStart = true;
          else await maybeStartAuto('auto'); // démarre maintenant si dans la plage, sinon planifie
        } else {
          pendingAutoStart = false;
          await cancelAutoStart();
        }
        await updateActionUI();
        await refreshOverlay(); // ON → voile bloquant ; OFF → retiré (navigation manuelle)
        sendResponse({ ok: true });
        break;
      case 'debug': {
        const tabId = await ensureTeamsTab();
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        const report = { frameCount: frames.length, frames: [] };
        for (const frame of frames) {
          const fi = { frameId: frame.frameId, url: frame.url };
          try { fi.scan = await runInFrame(tabId, frame.frameId, frameScanForTranscript); } catch (e) { fi.scanError = e.message; }
          report.frames.push(fi);
        }
        try { report.sidebar = await runInFrame(tabId, 0, frameDumpSidebar); } catch (e) { report.sidebarError = e.message; }
        const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2));
        await chrome.downloads.download({ url, filename: 'teams-dom-debug.json', saveAs: false });
        sendResponse({ ok: true, frames: frames.length });
        break;
      }
      case 'debugMeeting': {
        // Ouvre la 1re réunion et capture, à chaque étape, les frames + libellés
        // cliquables, pour identifier les onglets Récapitulatif / Transcription.
        const tabId = await ensureTeamsTab();
        await setState({ phase: 'opening', message: 'Debug réunion : ouverture de Teams…' });
        const ready = await waitForChatList(tabId);
        const report = { ready };
        async function snapshot() {
          const frames = await chrome.webNavigation.getAllFrames({ tabId });
          const res = [];
          for (const f of frames) {
            const e = { frameId: f.frameId, url: f.url };
            try { e.scan = await runInFrame(tabId, f.frameId, frameScanForTranscript); } catch (err) { e.err = err.message; }
            try { e.clickables = await runInFrame(tabId, f.frameId, frameListClickables); } catch (err) { /* ignore */ }
            res.push(e);
          }
          return res;
        }
        const list = await runInFrame(tabId, 0, frameChats, ['list', null, true]);
        report.meetingCount = list && list.items ? list.items.length : 0;
        if (report.meetingCount > 0) {
          const first = list.items[0];
          report.opened = first.label;
          await runInFrame(tabId, 0, frameChats, ['click', first.id, true]);
          await sleep(3500);
          report.afterOpen = await snapshot();
          report.recapClick = await clickAcrossFrames(tabId, ['récapitulatif', 'recapitulatif', 'recap', 'récap']);
          await sleep(4000);
          report.afterRecap = await snapshot();
          report.transcriptClick = await clickAcrossFrames(tabId, ['transcription', 'transcript', 'afficher la transcription', 'show transcript']);
          await sleep(4000);
          report.afterTranscript = await snapshot();
        }
        const u = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2));
        await chrome.downloads.download({ url: u, filename: 'teams-meeting-debug.json', saveAs: false });
        await setState({ phase: 'idle', message: `Debug réunion terminé (${report.meetingCount} réunion(s)).` });
        sendResponse({ ok: true, meetingCount: report.meetingCount });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // réponse asynchrone
});
