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

const DEFAULTS = { autoEnabled: false, maxChats: 50 };
const TEAMS_URL = 'https://teams.microsoft.com/v2/';
const RESCAN_DELAY_MIN = 1; // pause entre deux scans (boucle d'automatisation)

// État partagé (mémoire du SW) + reflété dans chrome.storage ('scanState').
let stopRequested = false;
let isRunning = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getSettings() {
  const s = await chrome.storage.local.get(['autoEnabled', 'maxChats']);
  return {
    autoEnabled: s.autoEnabled ?? DEFAULTS.autoEnabled,
    maxChats: Number.isFinite(s.maxChats) ? s.maxChats : DEFAULTS.maxChats
  };
}

async function setState(partial) {
  const cur = (await chrome.storage.local.get('scanState')).scanState || {};
  const next = { ...cur, ...partial, updatedAt: Date.now() };
  await chrome.storage.local.set({ scanState: next });
  return next;
}

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
    const container = findContainer();
    if (!container) return { found: false, reason: 'no container' };
    const allEntries = [];
    const seenKeys = new Set();
    const initialScrollTop = container.scrollTop;
    const isScrollable = container.scrollHeight > container.clientHeight + 50;
    if (!isScrollable) {
      const entries = collectEntries(container, seenKeys);
      return { found: entries.length > 0, entries, scrolled: false };
    }
    let sameCount = 0;
    let scrolls = 0;
    while (scrolls < 500) {
      const entries = collectEntries(container, seenKeys);
      allEntries.push(...entries);
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (container.scrollTop >= maxScroll - 50) {
        sameCount++;
        if (sameCount >= 5) break;
      } else {
        sameCount = 0;
      }
      container.scrollTop += 500;
      await sleep(400);
      scrolls++;
    }
    container.scrollTop = 0;
    await sleep(800);
    const finalEntries = collectEntries(container, seenKeys);
    allEntries.push(...finalEntries);
    container.scrollTop = initialScrollTop;
    return { found: allEntries.length > 0, entries: allEntries, scrolled: true, scrollCount: scrolls };
  })();
}

function frameGetTitle() {
  for (const sel of ['[data-tid="chat-title"]', '[data-tid="meeting-title"]', 'h1', 'h2', '[role="heading"]']) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) return el.textContent.trim();
  }
  return null;
}

function frameChats(action, arg) {
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

  function collectChatItems() {
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
      if (!el.querySelector('img,[role="img"]')) continue;
      items.push(el);
    }
    return items;
  }

  if (action === 'list') {
    const items = collectChatItems();
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

// Renvoie un tabId Teams utilisable, en réutilisant l'onglet dédié précédent,
// sinon un onglet Teams existant, sinon en créant un nouvel onglet (non actif).
async function ensureTeamsTab() {
  const { dedicatedTabId } = await chrome.storage.local.get('dedicatedTabId');
  if (dedicatedTabId) {
    try {
      const t = await chrome.tabs.get(dedicatedTabId);
      if (t && isTeamsUrl(t.url || t.pendingUrl)) return t.id;
    } catch (e) { /* onglet fermé */ }
  }
  const existing = await chrome.tabs.query({ url: ['https://teams.microsoft.com/*', 'https://teams.cloud.microsoft/*'] });
  if (existing.length) {
    await chrome.storage.local.set({ dedicatedTabId: existing[0].id });
    return existing[0].id;
  }
  const created = await chrome.tabs.create({ url: TEAMS_URL, active: false });
  await chrome.storage.local.set({ dedicatedTabId: created.id });
  return created.id;
}

// Attend que la liste des discussions soit rendue (SPA Teams).
async function waitForChatList(tabId, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (stopRequested) return false;
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
// Orchestration du scan
// ============================================================

async function tryExtractCurrent(tabId, tabUrl) {
  const recap = await clickAcrossFrames(tabId, ['récapitulatif', 'recapitulatif', 'recap', 'récap']);
  if (recap.ok) await sleep(3000);
  const transcript = await clickAcrossFrames(tabId, ['transcript', 'transcription']);
  if (transcript.ok) await sleep(3000);
  else if (!recap.ok) return null;
  const { bestFrame, bestScore } = await findTranscriptFrame(tabId);
  if (!bestFrame || bestScore < 3) return null;
  const { title, entries } = await extractFromFrame(tabId, bestFrame);
  if (!entries.length) return null;
  return { title, date: new Date().toISOString(), entries, url: tabUrl };
}

async function expandChatList(tabId, maxExpand = 20) {
  for (let i = 0; i < maxExpand; i++) {
    if (stopRequested) return;
    let res;
    try { res = await runInFrame(tabId, 0, frameClickVoirPlus); } catch (e) { break; }
    if (!res || !res.ok) break;
    await setState({ message: `Chargement des discussions… (${i + 1})` });
    await sleep(1500);
  }
}

async function startScan(reason = 'manual') {
  if (isRunning) return;
  isRunning = true;
  stopRequested = false;
  startKeepAlive();

  try {
    const { maxChats } = await getSettings();
    await setState({ running: true, phase: 'opening', current: 0, total: 0, downloaded: 0, currentLabel: '', message: 'Ouverture de Teams…', reason });

    const tabId = await ensureTeamsTab();

    await setState({ phase: 'opening', message: 'Attente du chargement de Teams…' });
    const ready = await waitForChatList(tabId);
    if (stopRequested) { await setState({ running: false, phase: 'stopped', message: 'Arrêté.' }); return; }
    if (!ready) { await setState({ running: false, phase: 'error', message: 'Teams n\'a pas chargé la liste des discussions.' }); return; }

    await setState({ phase: 'expanding', message: 'Chargement des discussions masquées…' });
    await expandChatList(tabId);
    if (stopRequested) { await setState({ running: false, phase: 'stopped', message: 'Arrêté.' }); return; }

    const list = await runInFrame(tabId, 0, frameChats, ['list', null]);
    if (!list || !list.ok || !list.items.length) {
      await setState({ running: false, phase: 'error', message: 'Aucune discussion trouvée.' });
      return;
    }

    const items = list.items.slice(0, Math.max(1, maxChats));
    const total = items.length;
    const seenTitles = new Set();
    let downloaded = 0;
    await setState({ phase: 'scanning', total });

    for (let i = 0; i < total; i++) {
      if (stopRequested) { await setState({ running: false, phase: 'stopped', message: `Arrêté à ${i}/${total}. ${downloaded} téléchargé(s).` }); return; }

      const label = items[i].label || `discussion ${i + 1}`;
      await setState({ current: i + 1, currentLabel: label, downloaded, message: `Discussion ${i + 1}/${total} : ${label}` });

      let clickRes;
      try { clickRes = await runInFrame(tabId, 0, frameChats, ['click', items[i].id]); } catch (e) { continue; }
      if (!clickRes || !clickRes.ok) continue;
      await sleep(2500);

      let transcript;
      try { transcript = await tryExtractCurrent(tabId, TEAMS_URL); } catch (e) { transcript = null; }
      if (!transcript) continue;

      const key = `${transcript.title}|${transcript.entries.length}`;
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);

      try { await downloadTxt(transcript); downloaded++; } catch (e) { /* ignore download error */ }
      await setState({ downloaded, message: `Téléchargé : ${transcript.title} (${transcript.entries.length}) — ${downloaded} au total` });
    }

    await setState({ running: false, phase: 'done', downloaded, message: `Terminé : ${downloaded} transcript(s) sur ${total} discussions.` });
    // Boucle d'automatisation : si toujours activée et non arrêtée, on relance
    // après une pause d'1 minute.
    const { autoEnabled } = await getSettings();
    if (autoEnabled && !stopRequested) await scheduleNextRun();
  } catch (error) {
    await setState({ running: false, phase: 'error', message: 'Erreur : ' + (error && error.message ? error.message : String(error)) });
  } finally {
    isRunning = false;
    stopKeepAlive();
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
//   - entre deux scans → pause de RESCAN_DELAY_MIN minute(s) puis re-scan.
// ============================================================

async function scheduleNextRun() {
  await chrome.alarms.clear('autoStart');
  chrome.alarms.create('autoStart', { delayInMinutes: RESCAN_DELAY_MIN });
  await setState({ phase: 'idle', message: `Prochain scan dans ${RESCAN_DELAY_MIN} min…` });
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

// Si l'onglet dédié est fermé, on oublie son id.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { dedicatedTabId } = await chrome.storage.local.get('dedicatedTabId');
  if (dedicatedTabId === tabId) await chrome.storage.local.remove('dedicatedTabId');
});

// ============================================================
// Messages depuis la popup
// ============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'start':
        startScan('manual');
        sendResponse({ ok: true });
        break;
      case 'stop':
        stopRequested = true;
        await cancelAutoStart(); // n'enchaîne pas le prochain scan de la boucle
        await setState({ message: 'Arrêt demandé…' });
        sendResponse({ ok: true });
        break;
      case 'extractManual':
        extractManualActiveTab();
        sendResponse({ ok: true });
        break;
      case 'autoEnabledChanged':
        if (msg.enabled) {
          // Démarrage immédiat ; la boucle se replanifie ensuite (pause 1 min).
          if (!isRunning) startScan('auto');
        } else {
          await cancelAutoStart();
        }
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
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // réponse asynchrone
});
