// Panneau latéral — Teams Transcript Downloader v3 (auto)
//
// Le panneau n'est qu'une télécommande : toute l'orchestration tourne dans le
// service worker (background.js), qui continue même panneau fermé. Ici on se
// contente d'envoyer des messages et de refléter l'état lu dans chrome.storage.

document.addEventListener('DOMContentLoaded', () => {
  const autoSwitch = document.getElementById('auto-switch');
  const meetingsOnlySwitch = document.getElementById('meetings-only');
  const maxChatsInput = document.getElementById('max-chats');
  const intervalInput = document.getElementById('interval-min');
  const autoDesc = document.getElementById('auto-desc');
  const stopBtn = document.getElementById('stop-btn');
  const extractBtn = document.getElementById('extract-btn');
  const debugBtn = document.getElementById('debug-btn');
  const debugMeetingBtn = document.getElementById('debug-meeting-btn');
  const resetBtn = document.getElementById('reset-btn');
  const statusMessage = document.getElementById('status-message');
  const progressWrap = document.getElementById('progress-wrap');
  const progressBar = document.getElementById('progress-bar');
  const summaryEl = document.getElementById('summary');
  const loaderEl = document.getElementById('loader');

  const PHASE_TYPE = {
    idle: 'info', opening: 'loading', expanding: 'loading', scanning: 'loading',
    done: 'success', stopped: 'info', error: 'error'
  };

  function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message';
    if (type) statusMessage.classList.add(type);
  }

  function send(type, extra = {}) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type, ...extra }, resp => {
        void chrome.runtime.lastError; // ignore "no receiver" si SW redémarre
        resolve(resp);
      });
    });
  }

  // ---- Rendu de l'état ----

  let countdownTimer = null;

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function renderSummary(summary) {
    if (!summary) { summaryEl.classList.add('hidden'); summaryEl.innerHTML = ''; return; }
    const t = summary.finishedAt ? new Date(summary.finishedAt).toLocaleTimeString() : '';
    summaryEl.innerHTML = `
      <div class="summary-title">Bilan du dernier scan</div>
      <ul>
        <li><b>${summary.downloaded ?? 0}</b> téléchargé(s)</li>
        <li><b>${summary.skipped ?? 0}</b> déjà traité(s)</li>
        <li><b>${summary.noTranscript ?? 0}</b> sans transcript</li>
        <li><b>${summary.total ?? 0}</b> scannée(s)</li>
      </ul>
      ${t ? `<div class="summary-time">Terminé à ${t}</div>` : ''}
    `;
    summaryEl.classList.remove('hidden');
  }

  function updateAutoDesc(intervalMin) {
    const mins = Number.isFinite(intervalMin) && intervalMin >= 1 ? intervalMin : 5;
    if (autoDesc) autoDesc.textContent = `Démarre tout de suite, puis re-scan toutes les ${mins} min`;
  }

  function render(state) {
    const running = !!(state && state.running);
    stopBtn.classList.toggle('hidden', !running);
    extractBtn.disabled = running;
    loaderEl.classList.toggle('hidden', !running); // loader pendant le scan
    stopCountdown();

    // Bilan persistant (survit au compte à rebours entre deux scans).
    renderSummary(state && state.summary);

    if (!state || !state.phase) {
      showStatus('Prêt. Activez l\'automatisation pour lancer le scan.', 'info');
      progressWrap.classList.add('hidden');
      return;
    }

    if (running && state.total > 0) {
      progressWrap.classList.remove('hidden');
      const pct = Math.min(100, Math.round((state.current / state.total) * 100));
      progressBar.style.width = pct + '%';
    } else {
      progressWrap.classList.add('hidden');
    }

    // Compte à rebours avant le prochain scan (pause d'automatisation).
    if (!running && state.phase === 'idle' && state.nextRunAt) {
      const tick = () => {
        const ms = state.nextRunAt - Date.now();
        if (ms <= 0) { showStatus('Lancement du prochain scan…', 'loading'); stopCountdown(); return; }
        const s = Math.ceil(ms / 1000);
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        showStatus(`Prochain scan dans ${mm}:${ss}`, 'info');
      };
      tick();
      countdownTimer = setInterval(tick, 1000);
      return;
    }

    showStatus(state.message || state.phase, PHASE_TYPE[state.phase] || 'info');
  }

  async function refresh() {
    const { scanState } = await chrome.storage.local.get('scanState');
    render(scanState);
  }

  // Mise à jour live quand le service worker écrit l'état.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.scanState) render(changes.scanState.newValue);
    if (changes.autoEnabled && autoSwitch) {
      autoSwitch.checked = !!changes.autoEnabled.newValue;
    }
  });

  // ---- Réglages ----

  async function loadSettings() {
    const { autoEnabled, maxChats, meetingsOnly, intervalMin } = await chrome.storage.local.get(['autoEnabled', 'maxChats', 'meetingsOnly', 'intervalMin']);
    autoSwitch.checked = !!autoEnabled;
    meetingsOnlySwitch.checked = meetingsOnly ?? true;
    maxChatsInput.value = Number.isFinite(maxChats) ? maxChats : 50;
    intervalInput.value = Number.isFinite(intervalMin) && intervalMin >= 1 ? intervalMin : 5;
    updateAutoDesc(intervalMin);
  }

  meetingsOnlySwitch.addEventListener('change', async () => {
    await chrome.storage.local.set({ meetingsOnly: meetingsOnlySwitch.checked });
  });

  intervalInput.addEventListener('change', async () => {
    let v = parseInt(intervalInput.value, 10);
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > 240) v = 240;
    intervalInput.value = v;
    updateAutoDesc(v);
    await chrome.storage.local.set({ intervalMin: v });
  });

  autoSwitch.addEventListener('change', async () => {
    const enabled = autoSwitch.checked;
    await chrome.storage.local.set({ autoEnabled: enabled });
    await send('autoEnabledChanged', { enabled });
    if (!enabled) showStatus('Automatisation désactivée.', 'info');
  });

  maxChatsInput.addEventListener('change', async () => {
    let v = parseInt(maxChatsInput.value, 10);
    if (!Number.isFinite(v) || v < 0) v = 50;
    if (v > 500) v = 500;
    maxChatsInput.value = v;
    await chrome.storage.local.set({ maxChats: v });
  });

  // ---- Actions ----

  stopBtn.addEventListener('click', () => send('stop'));
  extractBtn.addEventListener('click', () => send('extractManual'));
  resetBtn.addEventListener('click', async () => {
    if (confirm('Réinitialiser l\'historique ? Les transcripts déjà traités seront re-téléchargés au prochain scan.')) {
      await send('resetHistory');
    }
  });
  debugBtn.addEventListener('click', async () => {
    showStatus('Debug en cours…', 'loading');
    const resp = await send('debug');
    if (resp && resp.ok) showStatus(`Debug : ${resp.frames} frames (teams-dom-debug.json téléchargé).`, 'success');
    else showStatus('Debug : erreur.', 'error');
  });
  debugMeetingBtn.addEventListener('click', async () => {
    showStatus('Debug réunion en cours (ouvre la 1re réunion + récap)…', 'loading');
    const resp = await send('debugMeeting');
    if (resp && resp.ok) showStatus(`Debug réunion : ${resp.meetingCount} réunion(s) (teams-meeting-debug.json téléchargé).`, 'success');
    else showStatus('Debug réunion : erreur.', 'error');
  });

  // ---- Init ----
  loadSettings();
  refresh();
});
