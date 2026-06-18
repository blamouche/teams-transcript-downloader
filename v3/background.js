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
  const s = await chrome.storage.local.get(['autoEnabled', 'maxChats', 'meetingsOnly', 'intervalMin']);
  return {
    autoEnabled: s.autoEnabled ?? DEFAULTS.autoEnabled,
    maxChats: Number.isFinite(s.maxChats) ? s.maxChats : DEFAULTS.maxChats,
    meetingsOnly: s.meetingsOnly ?? DEFAULTS.meetingsOnly,
    intervalMin: Number.isFinite(s.intervalMin) && s.intervalMin >= 1 ? s.intervalMin : DEFAULTS.intervalMin
  };
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
    return { ok: items.length > 0, items: items.map(it => ({ id: it.id, label: (it.textContent || '').trim().slice(0, 80) })) };
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
  // Automatisation ON → voile bloquant. OFF → seulement le guide « cliquez à
  // nouveau » (non bloquant) pour laisser naviguer dans Teams manuellement.
  const { autoEnabled } = await getSettings();
  if (autoEnabled) showOverlay(created.id).catch(() => {});
  else showGuide(created.id).catch(() => {});
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

async function downloadTxt(transcript) {
  const text = buildTxt(transcript);
  const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  const filename = `transcript-${sanitizeFilename(transcript.title)}-${formatDate()}.txt`;
  await chrome.downloads.download({ url, filename, saveAs: false });
}

// ============================================================
// Historique des transcripts déjà traités (persistant)
//   Clé = signature de CONTENU (titre + nb entrées + hash du texte), stable
//   entre cycles et sessions (les id de la sidebar, eux, changent à chaque
//   session). Évite de re-télécharger la même réunion à chaque boucle.
// ============================================================

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; }
  return h >>> 0;
}

function transcriptKey(t) {
  const body = t.entries.map(e => `${e.speaker}:${e.message}`).join('\n');
  return `${t.title}|${t.entries.length}|${hashStr(body)}`;
}

async function getProcessed() {
  return (await chrome.storage.local.get('processedKeys')).processedKeys || {};
}

async function saveProcessed(map) {
  await chrome.storage.local.set({ processedKeys: map });
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
async function tryExtractCurrent(tabId, tabUrl, gen) {
  // 0) réunion récurrente : positionner l'occurrence la plus récente AVANT
  // d'extraire (no-op si pas de sélecteur d'instance).
  let instance = await selectLatestInstanceAcrossFrames(tabId);
  if (instance && instance.opened) { await sleepCancellable(4000, gen); if (scanGen !== gen) return null; }

  // 1) tentative directe (seuil élevé : un vrai transcript a un score important)
  let r = await extractBest(tabId, tabUrl, 30);
  if (r.transcript) { lastDiag = { path: 'direct', instance, bestScore: r.bestScore }; return r.transcript; }
  if (scanGen !== gen) return null;

  // 2) repli : onglet Récapitulatif puis sous-onglet Transcript (data-tid)
  const recap = await runInFrame(tabId, 0, frameClickTid, ['tab-item-com.microsoft.chattabs.recap']);
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

  r = await extractBest(tabId, tabUrl, 8);
  lastDiag = {
    path: 'after-tabs',
    recapTab: !!(recap && recap.ok),
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
    await setState({ phase: 'scanning', total });

    for (let i = 0; i < total; i++) {
      if (aborted()) return;

      const label = items[i].label || `discussion ${i + 1}`;
      await setState({ current: i + 1, currentLabel: label, downloaded, message: `Discussion ${i + 1}/${total} : ${label}` });

      let clickRes;
      try { clickRes = await runInFrame(tabId, 0, frameChats, ['click', items[i].id]); } catch (e) { continue; }
      if (!clickRes || !clickRes.ok) continue;
      await sleepCancellable(4000, myGen); // laisse le récapitulatif + l'iframe transcript se charger
      if (aborted()) return;

      let transcript;
      try { transcript = await tryExtractCurrent(tabId, TEAMS_URL, myGen); } catch (e) { transcript = null; }
      if (aborted()) return;
      if (!transcript) { noTranscript++; continue; }

      const key = transcriptKey(transcript);
      if (processed[key]) { // déjà traité lors d'un cycle/session précédent
        skipped++;
        continue;
      }

      try {
        await downloadTxt(transcript);
        downloaded++;
        processed[key] = Date.now();
        await saveProcessed(processed); // persiste au fil de l'eau (survit à l'arrêt du SW)
      } catch (e) { /* ignore download error */ }
      await setState({ downloaded, message: `Téléchargé : ${transcript.title} (${transcript.entries.length}) — ${downloaded} au total` });
    }

    const unit = meetingsOnly ? 'réunion(s)' : 'discussion(s)';
    let doneMsg = `Terminé : ${downloaded} téléchargé(s), ${skipped} déjà traité(s), ${noTranscript} sans transcript — ${total} ${unit} scannée(s).`;
    if (downloaded === 0 && skipped === 0 && lastDiag) {
      doneMsg += ` Diag : ${JSON.stringify(lastDiag)}`;
    }
    await setState({ running: false, phase: 'done', downloaded, summary: { downloaded, skipped, noTranscript, total, finishedAt: Date.now() }, message: doneMsg });
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
      if (pendingAutoStart) { pendingAutoStart = false; startScan('auto'); }
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
  const mins = Math.max(1, intervalMin);
  await chrome.alarms.clear('autoStart');
  chrome.alarms.create('autoStart', { delayInMinutes: mins });
  // nextRunAt permet à la popup d'afficher un compte à rebours.
  await setState({ phase: 'idle', nextRunAt: Date.now() + mins * 60000, message: `Prochain scan dans ${mins} min…` });
}

async function cancelAutoStart() {
  await chrome.alarms.clear('autoStart');
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoStart') {
    const { autoEnabled } = await getSettings();
    if (autoEnabled && !isRunning) startScan('auto');
  }
  // 'keepalive' : ne rien faire, le simple réveil suffit.
});

chrome.runtime.onInstalled.addListener(async () => {
  const { autoEnabled } = await getSettings();
  if (autoEnabled && !isRunning) startScan('auto');
});

chrome.runtime.onStartup.addListener(async () => {
  const { autoEnabled } = await getSettings();
  if (autoEnabled && !isRunning) startScan('auto');
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
  // Un rechargement de l'onglet piloté efface le voile/guide injectés : on les
  // réapplique quand la page a fini de charger (la navigation SPA ne recharge pas →
  // le MutationObserver suffit dans ce cas). Le voile suit l'état de l'automatisation.
  if (changeInfo.status === 'complete' && tabId === dedicatedTabId) {
    refreshOverlay(tabId).catch(() => {});
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
          else startScan('auto');
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
