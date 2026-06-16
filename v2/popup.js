// Popup script pour Teams Transcript Downloader v2 (auto)
//
// V2 = V1 + automatisation de la navigation dans Teams.
// En un clic, le plugin :
//   1. cherche une discussion de type "meeting" dans la sidebar,
//   2. l'ouvre,
//   3. ouvre le récapitulatif de réunion,
//   4. clique sur "Transcript",
//   5. extrait le transcript (logique V1) et le télécharge en .txt
//      directement dans le dossier Téléchargements (sans boîte de dialogue).
//
// Le bouton "Extraire manuellement" conserve le comportement de la V1 comme
// solution de secours si la navigation automatique échoue.

document.addEventListener('DOMContentLoaded', () => {
  const autoBtn = document.getElementById('auto-btn');
  const autoSwitch = document.getElementById('auto-switch');
  const extractBtn = document.getElementById('extract-btn');
  const downloadJsonBtn = document.getElementById('download-json');
  const downloadTxtBtn = document.getElementById('download-txt');
  const statusMessage = document.getElementById('status-message');
  const previewContainer = document.getElementById('preview-container');
  const downloadOptions = document.getElementById('download-options');
  const meetingTitle = document.getElementById('meeting-title');
  const entriesCount = document.getElementById('entries-count');
  const previewContent = document.getElementById('preview-content');

  let currentTranscript = null;

  function sleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function checkTeamsTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab && tab.url && (tab.url.includes('teams.microsoft.com') || tab.url.includes('teams.cloud.microsoft'));
    } catch (error) {
      return false;
    }
  }

  function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message';
    if (type) statusMessage.classList.add(type);
  }

  function formatPreview(data) {
    meetingTitle.textContent = data.title || 'Sans titre';
    entriesCount.textContent = `${data.entries.length} entrée${data.entries.length > 1 ? 's' : ''}`;
    const previewEntries = data.entries.slice(0, 5);
    previewContent.innerHTML = previewEntries.map(entry => `
      <div class="preview-entry">
        <span class="preview-time">${entry.time || '--:--'}</span>
        <span class="preview-speaker">${entry.speaker || 'Inconnu'}:</span>
        <span class="preview-text">${escapeHtml(entry.message)}</span>
      </div>
    `).join('');
    if (data.entries.length > 5) {
      previewContent.innerHTML += `
        <div class="preview-entry" style="text-align: center; color: #999;">
          ... et ${data.entries.length - 5} entrées de plus
        </div>
      `;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================
  // Fonctions injectées dans les frames pour l'AUTOMATISATION
  // ============================================================

  // Énumère ou clique les discussions de la sidebar Teams.
  //   action === 'list'  → renvoie { ok, items: [{index, label}] }
  //   action === 'click' → clique la discussion à l'index donné
  // Une seule fonction (injectée) pour garantir la même stratégie de sélection
  // entre l'énumération et le clic (indices stables).
  function frameChats(action, index) {
    function visible(el) {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    // Conteneurs/items possibles de la liste de discussions Teams
    const itemSelectors = [
      '[data-tid="chat-list-item"]',
      '[data-tid^="chat-list-item"]',
      '[id^="chat-list-item"]',
      '[data-tid="chatListContainer"] [role="treeitem"]',
      '[data-tid="chatListContainer"] [role="listitem"]',
      '#chat-list [role="treeitem"]',
      '#chat-list [role="listitem"]',
      '[role="tree"] [role="treeitem"]'
    ];

    let items = [];
    for (const sel of itemSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length) {
        items = Array.from(found).filter(visible);
        if (items.length) break;
      }
    }

    if (items.length === 0) {
      return { ok: false, reason: 'no chat items', items: [] };
    }

    if (action === 'list') {
      return {
        ok: true,
        items: items.map((it, i) => ({
          index: i,
          label: (it.textContent || '').trim().slice(0, 80)
        }))
      };
    }

    // action === 'click'
    const it = items[index];
    if (!it) return { ok: false, reason: 'index out of range', count: items.length };
    const clickable = it.querySelector('a,button,[role="link"],[tabindex]') || it;
    clickable.click();
    return { ok: true, label: (it.textContent || '').trim().slice(0, 80) };
  }

  // Clique sur le premier élément visible dont le texte/aria correspond
  // à l'un des mots-clés fournis (onglet récapitulatif, transcript, etc.).
  function frameClickByKeywords(keywords) {
    function visible(el) {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const kw = keywords.map(k => k.toLowerCase());
    const candidates = document.querySelectorAll(
      'button,[role="tab"],[role="button"],a,[role="link"],[role="menuitem"],div[tabindex],span[tabindex]'
    );
    for (const el of candidates) {
      if (!visible(el)) continue;
      const txt = (el.textContent || '').trim().toLowerCase();
      const aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').toLowerCase();
      if (!txt && !aria) continue;
      // On évite les très longs textes (faux positifs sur des conteneurs)
      const matchTxt = txt.length <= 40 && kw.some(k => txt === k || txt.includes(k));
      const matchAria = aria.length <= 60 && kw.some(k => aria.includes(k));
      if (matchTxt || matchAria) {
        el.click();
        return { ok: true, matched: (txt || aria).slice(0, 60) };
      }
    }
    return { ok: false };
  }

  // ============================================================
  // Fonctions injectées dans les frames pour l'EXTRACTION (V1)
  // ============================================================

  // Quick scan: does this frame have transcript content?
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
      timeCount,
      listCells,
      listItems,
      bodyLength: bodyText.length,
      hasContent: bodyText.length > 100
    };
  }

  // Full extraction with scroll
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

  // ============================================================
  // Helpers d'injection
  // ============================================================

  async function runInFrame(tabId, frameId, func, args) {
    const opts = { target: { tabId, frameIds: [frameId] }, func };
    if (args !== undefined) opts.args = args;
    const results = await chrome.scripting.executeScript(opts);
    return results && results[0] ? results[0].result : undefined;
  }

  // Tente une action (clic par mots-clés) sur toutes les frames de l'onglet
  // jusqu'à la première réussite. Renvoie le résultat ou {ok:false}.
  async function clickAcrossFrames(tabId, keywords) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    for (const frame of frames) {
      try {
        const res = await runInFrame(tabId, frame.frameId, frameClickByKeywords, [keywords]);
        if (res && res.ok) return { ...res, frameId: frame.frameId, frameUrl: frame.url };
      } catch (e) {
        // frame non scriptable (cross-origin sans permission) : on ignore
      }
    }
    return { ok: false };
  }

  // Trouve la meilleure frame contenant le transcript (scan heuristique V1).
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
      } catch (e) { /* frame non scriptable */ }
    }
    return { bestFrame, bestScore };
  }

  // Extraction complète dans la frame ciblée + titre depuis la frame principale.
  async function extractFromFrame(tabId, bestFrame) {
    const extractResult = await runInFrame(tabId, bestFrame.frameId, frameFullExtract);
    let entries = [];
    if (extractResult && extractResult.found) entries = extractResult.entries;

    let title = 'Meeting Transcript';
    try {
      const t = await runInFrame(tabId, 0, frameGetTitle);
      if (t) title = t;
    } catch (e) { /* ignore */ }

    return { title, entries };
  }

  // ============================================================
  // Orchestration AUTOMATIQUE — scan de TOUTES les discussions
  // ============================================================

  const MAX_CHATS = 50; // garde-fou contre les listes très longues

  // Tente d'ouvrir récapitulatif + transcript puis d'extraire le transcript
  // de la discussion actuellement ouverte. Renvoie {title, entries} ou null.
  async function tryExtractCurrent(tabId, tabUrl) {
    // Ouvrir le récapitulatif de réunion (si présent)
    await clickAcrossFrames(tabId, ['récapitulatif', 'recapitulatif', 'recap', 'récap']);
    await sleepMs(2500);

    // Ouvrir l'onglet Transcript (si présent)
    await clickAcrossFrames(tabId, ['transcript', 'transcription']);
    await sleepMs(2500);

    const { bestFrame, bestScore } = await findTranscriptFrame(tabId);
    if (!bestFrame || bestScore < 3) return null;

    const { title, entries } = await extractFromFrame(tabId, bestFrame);
    if (!entries.length) return null;

    return { title, date: new Date().toISOString(), entries, url: tabUrl };
  }

  async function autoScanAll() {
    if (!autoSwitch.checked) {
      showStatus('Activez l\'automatisation pour lancer le scan.', 'error');
      return;
    }

    const isTeams = await checkTeamsTab();
    if (!isTeams) {
      showStatus('Veuillez ouvrir Microsoft Teams dans un onglet', 'error');
      return;
    }

    autoBtn.disabled = true;
    extractBtn.disabled = true;
    autoSwitch.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Énumère toutes les discussions de la sidebar
      showStatus('Lecture des discussions…', 'loading');
      const list = await runInFrame(tab.id, 0, frameChats, ['list', 0]);
      console.log('chat list:', list);

      if (!list || !list.ok || !list.items.length) {
        showStatus('Aucune discussion trouvée dans la sidebar Teams.', 'error');
        return;
      }

      const total = Math.min(list.items.length, MAX_CHATS);
      const seenTitles = new Set();
      let downloaded = 0;

      for (let i = 0; i < total; i++) {
        const label = list.items[i].label || `discussion ${i + 1}`;
        showStatus(`Discussion ${i + 1}/${total} : ${label}`, 'loading');

        // Ouvre la i-ème discussion
        const clickRes = await runInFrame(tab.id, 0, frameChats, ['click', i]);
        if (!clickRes || !clickRes.ok) {
          console.log(`skip ${i}: click failed`, clickRes);
          continue;
        }
        await sleepMs(2500);

        // Tente d'extraire un transcript pour cette discussion
        const transcript = await tryExtractCurrent(tab.id, tab.url);
        if (!transcript) {
          console.log(`no transcript for "${label}"`);
          continue;
        }

        // Déduplication par titre + nombre d'entrées
        const key = `${transcript.title}|${transcript.entries.length}`;
        if (seenTitles.has(key)) {
          console.log(`duplicate transcript skipped: ${key}`);
          continue;
        }
        seenTitles.add(key);

        currentTranscript = transcript;
        formatPreview(currentTranscript);
        previewContainer.classList.remove('hidden');
        downloadOptions.classList.remove('hidden');

        // Téléchargement direct du .txt dans le dossier Téléchargements
        downloadTxt(false);
        downloaded++;
        showStatus(`Téléchargé : ${transcript.title} (${transcript.entries.length} entrées) — ${downloaded} au total`, 'loading');
      }

      if (downloaded === 0) {
        showStatus(`${total} discussions scannées, aucun transcript trouvé.`, 'error');
      } else {
        showStatus(`Terminé : ${downloaded} transcript(s) téléchargé(s) sur ${total} discussions scannées.`, 'success');
      }

    } catch (error) {
      console.error('Auto-scan error:', error);
      showStatus('Erreur: ' + error.message, 'error');
    } finally {
      autoBtn.disabled = !autoSwitch.checked;
      extractBtn.disabled = false;
      autoSwitch.disabled = false;
    }
  }

  // ============================================================
  // Extraction MANUELLE (comportement V1, secours)
  // ============================================================

  async function extractTranscript() {
    const isTeams = await checkTeamsTab();
    if (!isTeams) {
      showStatus('Veuillez ouvrir Microsoft Teams dans un onglet', 'error');
      return;
    }

    showStatus('Recherche du transcript…', 'loading');
    extractBtn.disabled = true;
    autoBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      const { bestFrame, bestScore } = await findTranscriptFrame(tab.id);

      if (!bestFrame || bestScore < 3) {
        showStatus('Aucun transcript trouvé. Ouvrez le panneau Transcript dans Teams.', 'error');
        console.log('Best frame:', bestFrame, 'Best score:', bestScore);
        return;
      }

      showStatus(`Transcript trouvé dans ${bestFrame.origin}. Extraction en cours…`, 'loading');

      const { title, entries } = await extractFromFrame(tab.id, bestFrame);

      if (entries.length === 0) {
        showStatus('Conteneur trouvé mais aucune entrée extraite.', 'error');
        return;
      }

      currentTranscript = { title, date: new Date().toISOString(), entries, url: tab.url };

      showStatus(`Transcript extrait : ${entries.length} entrées`, 'success');
      formatPreview(currentTranscript);
      previewContainer.classList.remove('hidden');
      downloadOptions.classList.remove('hidden');

    } catch (error) {
      console.error('Extraction error:', error);
      showStatus('Erreur: ' + error.message, 'error');
    } finally {
      extractBtn.disabled = false;
      autoBtn.disabled = false;
    }
  }

  // ============================================================
  // Debug
  // ============================================================

  async function debugDOM() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });

      const report = { tabUrl: tab.url, frameCount: frames.length, frames: [] };

      for (const frame of frames) {
        const frameInfo = {
          frameId: frame.frameId,
          parentFrameId: frame.parentFrameId,
          url: frame.url,
          type: frame.frameType || 'unknown'
        };

        try {
          const r = await runInFrame(tab.id, frame.frameId, frameScanForTranscript);
          if (r) frameInfo.scan = r;
        } catch (e) {
          frameInfo.scanError = e.message;
        }

        report.frames.push(frameInfo);
      }

      const dataStr = JSON.stringify(report, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: 'teams-dom-debug.json', saveAs: true });
      showStatus(`Debug: ${frames.length} frames inspectés`, 'success');
    } catch (error) {
      showStatus('Debug error: ' + error.message, 'error');
    }
  }

  // ============================================================
  // Téléchargements (V2 : direct dans Téléchargements par défaut)
  // ============================================================

  function downloadJson(saveAs = false) {
    if (!currentTranscript) return;
    const dataStr = JSON.stringify(currentTranscript, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url, filename: `transcript-${sanitizeFilename(currentTranscript.title)}-${formatDate()}.json`, saveAs
    });
  }

  function downloadTxt(saveAs = false) {
    if (!currentTranscript) return;

    const formattedEntries = [];
    let curSpeaker = null, curMessage = '';

    currentTranscript.entries.forEach((entry, i) => {
      const speaker = entry.speaker || 'Inconnu';
      if (speaker === curSpeaker && entry.time === '--:--') {
        curMessage += ' ' + entry.message;
      } else {
        if (curSpeaker !== null) {
          formattedEntries.push({
            time: currentTranscript.entries[i - 1]?.time || '',
            speaker: curSpeaker, message: curMessage.trim()
          });
        }
        curSpeaker = speaker;
        curMessage = entry.message;
      }
    });
    if (curSpeaker !== null) {
      formattedEntries.push({
        time: currentTranscript.entries[currentTranscript.entries.length - 1]?.time || '',
        speaker: curSpeaker, message: curMessage.trim()
      });
    }

    const lines = [
      `Transcript: ${currentTranscript.title}`,
      `Date: ${new Date(currentTranscript.date).toLocaleString()}`,
      `URL: ${currentTranscript.url}`, '',
      '========================================', '',
      ...formattedEntries.map(e => {
        const t = e.time ? `[${e.time}] ` : '';
        return `${t}${e.speaker}: ${e.message}`;
      }),
      '', '========================================',
      `Total: ${formattedEntries.length} entrées`
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url, filename: `transcript-${sanitizeFilename(currentTranscript.title)}-${formatDate()}.txt`, saveAs
    });
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9\-_]/gi, '_').toLowerCase();
  }

  function formatDate() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  // ============================================================
  // Switch d'automatisation (état persistant)
  // ============================================================

  async function onSwitchChange() {
    const enabled = autoSwitch.checked;
    try { await chrome.storage.local.set({ autoEnabled: enabled }); } catch (e) { /* ignore */ }
    autoBtn.disabled = !enabled;
    if (enabled) {
      // Si actif, on lance automatiquement le scan de toutes les discussions.
      autoScanAll();
    } else {
      showStatus('Automatisation désactivée. Utilisez "Extraire manuellement".', 'info');
    }
  }

  // Event listeners
  autoSwitch.addEventListener('change', onSwitchChange);
  autoBtn.addEventListener('click', autoScanAll);
  extractBtn.addEventListener('click', extractTranscript);
  // Boutons de format : téléchargement direct (V2). Maj+clic = boîte de dialogue.
  downloadJsonBtn.addEventListener('click', (e) => downloadJson(e.shiftKey));
  downloadTxtBtn.addEventListener('click', (e) => downloadTxt(e.shiftKey));
  document.getElementById('debug-btn').addEventListener('click', debugDOM);

  // Initialisation : restaure l'état du switch puis vérifie l'onglet Teams.
  (async () => {
    let enabled = false;
    try {
      const stored = await chrome.storage.local.get('autoEnabled');
      enabled = !!stored.autoEnabled;
    } catch (e) { /* ignore */ }
    autoSwitch.checked = enabled;
    autoBtn.disabled = !enabled;

    const isTeams = await checkTeamsTab();
    if (!isTeams) {
      showStatus('Veuillez ouvrir Microsoft Teams', 'error');
      autoBtn.disabled = true;
      extractBtn.disabled = true;
      return;
    }

    if (enabled) {
      showStatus('Automatisation activée. Cliquez sur "Scanner toutes les discussions".', 'info');
    } else {
      showStatus('Activez l\'automatisation pour scanner toutes les discussions.', 'info');
    }
  })();
});
