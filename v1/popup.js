// Popup script pour Teams Transcript Downloader

document.addEventListener('DOMContentLoaded', () => {
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

  // ---- Extraction functions (injected into frames) ----

  // Quick scan: does this frame have transcript content?
  function frameScanForTranscript() {
    const doc = document;
    const bodyText = doc.body ? doc.body.textContent : '';

    // Count time patterns as a heuristic for transcript content
    const timeMatches = bodyText.match(/\d{1,2}:\d{2}/g);
    const timeCount = timeMatches ? timeMatches.length : 0;

    // Count potential transcript entries
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

    // Find container
    function findContainer() {
      // Known selectors
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

      // Walk up from ListCells
      const listCells = doc.querySelectorAll('[data-automationid="ListCell"]');
      if (listCells.length > 0) {
        let el = listCells[0].parentElement;
        while (el) {
          if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) return el;
          el = el.parentElement;
        }
        // If no scrollable parent, return the direct parent
        return listCells[0].parentElement;
      }

      // role="list" with children
      for (const el of doc.querySelectorAll('[role="list"]')) {
        if (el.children.length > 2) return el;
      }

      // role="log"
      const log = doc.querySelector('[role="log"]');
      if (log) return log;

      // Any div with multiple time patterns
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

      // Speaker
      let speaker = '';
      for (const sel of [
        '[class*="itemDisplayName"]', '[class*="displayName"]',
        '[class*="speaker"]', '[class*="Speaker"]',
        '[class*="author"]', '[data-tid*="speaker"]', '[data-tid*="name"]'
      ]) {
        const el = cell.querySelector(sel);
        if (el && el.textContent.trim()) { speaker = el.textContent.trim(); break; }
      }

      // Message
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

      // Parse "Name: message" pattern
      if (!speaker && message) {
        const m = message.match(/^([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*)\s*[:\n]\s*/);
        if (m) { speaker = m[1].trim(); message = message.substring(m[0].length).trim(); }
      }

      // Clean
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

    // Main async extraction
    return (async () => {
      const container = findContainer();
      if (!container) return { found: false, reason: 'no container' };

      const allEntries = [];
      const seenKeys = new Set();
      const initialScrollTop = container.scrollTop;
      const isScrollable = container.scrollHeight > container.clientHeight + 50;

      if (!isScrollable) {
        // Not scrollable - just collect what's visible
        const entries = collectEntries(container, seenKeys);
        return { found: entries.length > 0, entries, scrolled: false };
      }

      // Scroll through the entire container
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

      // Back to top for final collection
      container.scrollTop = 0;
      await sleep(800);
      const finalEntries = collectEntries(container, seenKeys);
      allEntries.push(...finalEntries);

      container.scrollTop = initialScrollTop;

      return { found: allEntries.length > 0, entries: allEntries, scrolled: true, scrollCount: scrolls };
    })();
  }

  // Get meeting title
  function frameGetTitle() {
    for (const sel of ['[data-tid="chat-title"]', '[data-tid="meeting-title"]', 'h1', 'h2', '[role="heading"]']) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  // ---- Main extraction logic ----

  async function extractTranscript() {
    const isTeams = await checkTeamsTab();
    if (!isTeams) {
      showStatus('Veuillez ouvrir Microsoft Teams dans un onglet', 'error');
      return;
    }

    showStatus('Recherche du transcript...', 'loading');
    extractBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Step 1: List all frames in the tab to find the Recap iframe
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      console.log('All frames:', frames);

      // Step 2: Scan each frame for transcript content
      const scanResults = [];
      for (const frame of frames) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [frame.frameId] },
            func: frameScanForTranscript
          });
          if (results && results[0]) {
            scanResults.push({ frameId: frame.frameId, frameUrl: frame.url, ...results[0].result });
          }
        } catch (e) {
          console.log(`Cannot scan frame ${frame.frameId} (${frame.url}):`, e.message);
        }
      }

      console.log('Scan results:', scanResults);

      // Find the frame with transcript content (most time patterns + list items)
      let bestFrame = null;
      let bestScore = 0;
      for (const sr of scanResults) {
        const score = sr.timeCount + sr.listCells * 5 + sr.listItems * 5;
        if (score > bestScore && sr.hasContent) {
          bestScore = score;
          bestFrame = sr;
        }
      }

      if (!bestFrame || bestScore < 3) {
        showStatus('Aucun transcript trouvé. Ouvrez le panneau Transcript dans Teams.', 'error');
        console.log('Best frame:', bestFrame, 'Best score:', bestScore);
        extractBtn.disabled = false;
        return;
      }

      console.log('Found transcript in frame:', bestFrame);
      showStatus(`Transcript trouvé dans ${bestFrame.origin}. Extraction en cours...`, 'loading');

      // Step 3: Full extraction in the transcript frame
      const extractResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [bestFrame.frameId] },
        func: frameFullExtract
      });

      let entries = [];
      if (extractResults && extractResults[0] && extractResults[0].result && extractResults[0].result.found) {
        entries = extractResults[0].result.entries;
      }

      if (entries.length === 0) {
        showStatus('Conteneur trouvé mais aucune entrée extraite.', 'error');
        extractBtn.disabled = false;
        return;
      }

      // Step 4: Get title from main frame
      let title = 'Meeting Transcript';
      try {
        const titleResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          func: frameGetTitle
        });
        if (titleResults && titleResults[0] && titleResults[0].result) {
          title = titleResults[0].result;
        }
      } catch (e) { /* ignore */ }

      currentTranscript = { title, date: new Date().toISOString(), entries, url: tab.url };

      showStatus(`Transcript extrait : ${entries.length} entrées`, 'success');
      formatPreview(currentTranscript);
      previewContainer.classList.remove('hidden');
      downloadOptions.classList.remove('hidden');
      extractBtn.classList.add('hidden');

    } catch (error) {
      console.error('Extraction error:', error);
      showStatus('Erreur: ' + error.message, 'error');
    } finally {
      extractBtn.disabled = false;
    }
  }

  // ---- Debug ----

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
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [frame.frameId] },
            func: frameScanForTranscript
          });
          if (results && results[0]) {
            frameInfo.scan = results[0].result;
          }
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

  // ---- Downloads ----

  function downloadJson() {
    if (!currentTranscript) return;
    const dataStr = JSON.stringify(currentTranscript, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url, filename: `transcript-${sanitizeFilename(currentTranscript.title)}-${formatDate()}.json`, saveAs: true
    });
  }

  function downloadTxt() {
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
      url, filename: `transcript-${sanitizeFilename(currentTranscript.title)}-${formatDate()}.txt`, saveAs: true
    });
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9\-_]/gi, '_').toLowerCase();
  }

  function formatDate() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  // Event listeners
  extractBtn.addEventListener('click', extractTranscript);
  downloadJsonBtn.addEventListener('click', downloadJson);
  downloadTxtBtn.addEventListener('click', downloadTxt);
  document.getElementById('debug-btn').addEventListener('click', debugDOM);

  checkTeamsTab().then(isTeams => {
    if (!isTeams) {
      showStatus('Veuillez ouvrir Microsoft Teams', 'error');
      extractBtn.disabled = true;
    }
  });
});
