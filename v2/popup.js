// Popup — Teams Transcript Downloader v2 (auto)
//
// La popup n'est qu'une télécommande : toute l'orchestration tourne dans le
// service worker (background.js), qui continue même popup fermée. Ici on se
// contente d'envoyer des messages et de refléter l'état lu dans chrome.storage.

document.addEventListener('DOMContentLoaded', () => {
  const autoSwitch = document.getElementById('auto-switch');
  const maxChatsInput = document.getElementById('max-chats');
  const autoBtn = document.getElementById('auto-btn');
  const stopBtn = document.getElementById('stop-btn');
  const extractBtn = document.getElementById('extract-btn');
  const debugBtn = document.getElementById('debug-btn');
  const statusMessage = document.getElementById('status-message');
  const progressWrap = document.getElementById('progress-wrap');
  const progressBar = document.getElementById('progress-bar');

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

  function render(state) {
    const running = !!(state && state.running);
    autoBtn.classList.toggle('hidden', running);
    stopBtn.classList.toggle('hidden', !running);
    extractBtn.disabled = running;

    if (!state || !state.phase) {
      showStatus('Prêt. Activez l\'automatisation ou cliquez sur « Scanner maintenant ».', 'info');
      progressWrap.classList.add('hidden');
      return;
    }

    showStatus(state.message || state.phase, PHASE_TYPE[state.phase] || 'info');

    if (running && state.total > 0) {
      progressWrap.classList.remove('hidden');
      const pct = Math.min(100, Math.round((state.current / state.total) * 100));
      progressBar.style.width = pct + '%';
    } else {
      progressWrap.classList.add('hidden');
    }
  }

  async function refresh() {
    const { scanState } = await chrome.storage.local.get('scanState');
    render(scanState);
  }

  // Mise à jour live quand le service worker écrit l'état.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.scanState) render(changes.scanState.newValue);
  });

  // ---- Réglages ----

  async function loadSettings() {
    const { autoEnabled, maxChats } = await chrome.storage.local.get(['autoEnabled', 'maxChats']);
    autoSwitch.checked = !!autoEnabled;
    maxChatsInput.value = Number.isFinite(maxChats) ? maxChats : 50;
  }

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

  autoBtn.addEventListener('click', () => send('start'));
  stopBtn.addEventListener('click', () => send('stop'));
  extractBtn.addEventListener('click', () => send('extractManual'));
  debugBtn.addEventListener('click', async () => {
    showStatus('Debug en cours…', 'loading');
    const resp = await send('debug');
    if (resp && resp.ok) showStatus(`Debug : ${resp.frames} frames (teams-dom-debug.json téléchargé).`, 'success');
    else showStatus('Debug : erreur.', 'error');
  });

  // ---- Init ----
  loadSettings();
  refresh();
});
