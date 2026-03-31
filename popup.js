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

  // Vérifier si on est sur Teams
  async function checkTeamsTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab && tab.url && tab.url.includes('teams.microsoft.com');
    } catch (error) {
      return false;
    }
  }

  // Afficher un message de statut
  function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message';
    if (type) {
      statusMessage.classList.add(type);
    }
  }

  // Formater les données pour l'aperçu
  function formatPreview(data) {
    meetingTitle.textContent = data.title || 'Sans titre';
    entriesCount.textContent = `${data.entries.length} entrée${data.entries.length > 1 ? 's' : ''}`;

    // Afficher les 5 premières entrées
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

  // Échapper le HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Vérifier si le content script est chargé et l'injecter si nécessaire
  async function ensureContentScript(tabId) {
    try {
      // Essayer d'envoyer un ping pour vérifier si le content script répond
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      return true;
    } catch (error) {
      // Le content script n'est pas chargé, l'injecter
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        });
        // Attendre un peu que le script s'initialise
        await new Promise(resolve => setTimeout(resolve, 100));
        return true;
      } catch (injectError) {
        console.error('Failed to inject content script:', injectError);
        return false;
      }
    }
  }

  // Extraire le transcript
  async function extractTranscript() {
    const isTeams = await checkTeamsTab();

    if (!isTeams) {
      showStatus('Veuillez ouvrir Microsoft Teams dans un onglet', 'error');
      return;
    }

    showStatus('Chargement du transcript en cours... Cela peut prendre du temps pour les longs meetings.', 'loading');
    extractBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // S'assurer que le content script est chargé
      const scriptLoaded = await ensureContentScript(tab.id);
      if (!scriptLoaded) {
        showStatus('Impossible de charger le script d\'extraction', 'error');
        extractBtn.disabled = false;
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'extractTranscript'
      });

      if (response.success) {
        currentTranscript = response.data;
        showStatus('Transcript extrait avec succès !', 'success');
        formatPreview(currentTranscript);
        previewContainer.classList.remove('hidden');
        downloadOptions.classList.remove('hidden');
        extractBtn.classList.add('hidden');
      } else {
        showStatus(response.error || 'Erreur lors de l\'extraction', 'error');
      }
    } catch (error) {
      console.error('Extraction error:', error);
      if (error.message && error.message.includes('Receiving end does not exist')) {
        showStatus('Erreur de connexion. Essayez de rafraîchir la page Teams.', 'error');
      } else {
        showStatus('Erreur: ' + error.message, 'error');
      }
    } finally {
      extractBtn.disabled = false;
    }
  }

  // Télécharger en JSON
  function downloadJson() {
    if (!currentTranscript) return;

    const dataStr = JSON.stringify(currentTranscript, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const filename = `transcript-${sanitizeFilename(currentTranscript.title)}-${formatDate()}.json`;

    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
  }

  // Télécharger en TXT
  function downloadTxt() {
    if (!currentTranscript) return;

    // Regrouper les entrées par speaker pour éviter les répétitions
    const formattedEntries = [];
    let currentSpeaker = null;
    let currentMessage = '';

    currentTranscript.entries.forEach((entry, index) => {
      const time = entry.time || '';
      const speaker = entry.speaker || 'Inconnu';

      // Si c'est le même speaker, concaténer le message
      if (speaker === currentSpeaker && time === '') {
        currentMessage += ' ' + entry.message;
      } else {
        // Sauvegarder l'entrée précédente si elle existe
        if (currentSpeaker !== null) {
          formattedEntries.push({
            time: currentTranscript.entries[index - 1]?.time || '',
            speaker: currentSpeaker,
            message: currentMessage.trim()
          });
        }
        // Commencer une nouvelle entrée
        currentSpeaker = speaker;
        currentMessage = entry.message;
      }
    });

    // Ajouter la dernière entrée
    if (currentSpeaker !== null) {
      const lastEntry = currentTranscript.entries[currentTranscript.entries.length - 1];
      formattedEntries.push({
        time: lastEntry?.time || '',
        speaker: currentSpeaker,
        message: currentMessage.trim()
      });
    }

    const lines = [
      `Transcript: ${currentTranscript.title}`,
      `Date: ${new Date(currentTranscript.date).toLocaleString()}`,
      `URL: ${currentTranscript.url}`,
      '',
      '========================================',
      '',
      ...formattedEntries.map(entry => {
        const time = entry.time ? `[${entry.time}] ` : '';
        const speaker = entry.speaker ? `${entry.speaker}: ` : '';
        return `${time}${speaker}${entry.message}`;
      }),
      '',
      '========================================',
      `Total: ${formattedEntries.length} entrées`
    ];

    const dataStr = lines.join('\n');
    const blob = new Blob([dataStr], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const filename = `transcript-${sanitizeFilename(currentTranscript.title)}-${formatDate()}.txt`;

    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
  }

  // Sanitizer le nom de fichier
  function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9\-_]/gi, '_').toLowerCase();
  }

  // Formater la date pour le nom de fichier
  function formatDate() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }

  // Event listeners
  extractBtn.addEventListener('click', extractTranscript);
  downloadJsonBtn.addEventListener('click', downloadJson);
  downloadTxtBtn.addEventListener('click', downloadTxt);

  // Vérifier au chargement
  checkTeamsTab().then(isTeams => {
    if (!isTeams) {
      showStatus('Veuillez ouvrir Microsoft Teams', 'error');
      extractBtn.disabled = true;
    }
  });
});
