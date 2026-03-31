// Content script pour extraire les transcripts de Teams

(function() {
  'use strict';

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Fonction pour trouver le conteneur de scroll
  function findScrollContainer() {
    const possibleContainers = [
      '#scrollToTargetTargetedFocusZone',
      '[data-tid="transcriptContainerRef"]',
      '.ms-List',
      '[role="log"]'
    ];

    for (const selector of possibleContainers) {
      const container = document.querySelector(selector);
      if (container) {
        return container;
      }
    }
    return null;
  }

  // Extraire une entrée - VERSION SIMPLE ET ROBUSTE
  function extractEntry(cell) {
    // Chercher tous les éléments texte
    const allText = cell.textContent;

    // Chercher le temps au format mm:ss ou hh:mm:ss
    const timeMatch = allText.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    let time = timeMatch ? timeMatch[1] : '';

    // Chercher le speaker dans itemDisplayName
    const nameEl = cell.querySelector('[class*="itemDisplayName-"]');
    let speaker = nameEl ? nameEl.textContent.trim() : '';

    // Extraire le message depuis eventText
    const eventTextEl = cell.querySelector('[class*="eventText-"]');
    let message = '';

    if (eventTextEl) {
      // Chercher si le speaker est inclus dans le texte
      const speakerInText = eventTextEl.querySelector('[class*="eventSpeakerName-"]');

      if (speakerInText) {
        // Événement système
        const speakerName = speakerInText.textContent.trim();
        if (!speaker) speaker = speakerName;
        message = eventTextEl.textContent.replace(speakerName, '').trim();
        message = message.replace(/^:\s*/, '');
      } else {
        // Message normal
        message = eventTextEl.textContent.trim();
      }
    } else {
      // Fallback: utiliser tout le texte
      message = allText;
    }

    // Nettoyer le message
    message = message.replace(/^\d+\s+minute.*?\d+\s+seconde\s*/, '').trim();
    message = message.replace(/^:\s*/, '').trim();

    // Si pas de speaker, c'est peut-être un événement système
    if (!speaker) {
      const isEvent = cell.querySelector('[class*="meetingEvent-"]') !== null;
      if (isEvent) {
        // Essayer d'extraire le nom depuis le début du message
        const speakerMatch = message.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*:/);
        if (speakerMatch) {
          speaker = speakerMatch[1].trim();
          message = message.replace(speakerMatch[0], '').trim();
        } else {
          speaker = 'Système';
        }
      }
    }

    if (!message || message.length < 2) return null;

    return {
      time: time || '--:--',
      speaker: speaker || 'Inconnu',
      message: message
    };
  }

  // Fonction pour scroller et charger tout le contenu
  async function scrollAndLoadAllEntries(container) {
    const allEntries = [];
    const seenKeys = new Set();

    // Sauvegarder la position initiale
    const initialScrollTop = container.scrollTop;

    console.log('Starting comprehensive scroll to load all entries...');

    let previousHeight = 0;
    let sameHeightCount = 0;
    let totalScrolls = 0;
    const maxScrolls = 500;

    while (totalScrolls < maxScrolls) {
      // Collecter les entrées actuellement visibles
      const cells = container.querySelectorAll('[data-automationid="ListCell"]');
      console.log(`Scroll ${totalScrolls}: Found ${cells.length} cells`);

      for (const cell of cells) {
        const entry = extractEntry(cell);
        if (entry) {
          // Utiliser speaker + début du message comme clé
          const key = entry.speaker + '|' + entry.message.substring(0, 50);
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allEntries.push(entry);
          }
        }
      }

      // Vérifier si on a atteint la fin
      const currentScrollTop = container.scrollTop;
      const maxScrollTop = container.scrollHeight - container.clientHeight;

      if (currentScrollTop >= maxScrollTop - 50) {
        sameHeightCount++;
        if (sameHeightCount >= 5) {
          console.log(`Reached end after ${totalScrolls} scrolls`);
          break;
        }
      } else {
        sameHeightCount = 0;
        previousHeight = container.scrollHeight;
      }

      // Scroller vers le bas
      container.scrollTop += 500;

      await sleep(400);
      totalScrolls++;
    }

    // Retourner en haut et collecter une dernière fois
    container.scrollTop = 0;
    await sleep(800);

    const finalCells = container.querySelectorAll('[data-automationid="ListCell"]');
    for (const cell of finalCells) {
      const entry = extractEntry(cell);
      if (entry) {
        const key = entry.speaker + '|' + entry.message.substring(0, 50);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allEntries.push(entry);
        }
      }
    }

    // Restaurer la position initiale
    container.scrollTop = initialScrollTop;

    console.log(`Final count: ${allEntries.length} unique entries`);

    return allEntries;
  }

  // Fonction pour extraire les entrées du transcript
  async function extractTranscriptEntries() {
    const container = findScrollContainer();

    if (!container) {
      console.error('Transcript container not found');
      return null;
    }

    console.log('Found transcript container:', container);

    const entries = await scrollAndLoadAllEntries(container);

    return entries.length > 0 ? entries : null;
  }

  // Fonction pour extraire le titre de la réunion
  function extractMeetingTitle() {
    const selectors = [
      '[data-tid="chat-title"]',
      '[data-tid="meeting-title"]',
      '.ts-header-title',
      'h1',
      '[role="heading"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        return element.textContent.trim();
      }
    }

    return 'Meeting Transcript';
  }

  // Fonction principale d'extraction
  async function extractTranscript() {
    try {
      console.log('Starting transcript extraction...');
      const title = extractMeetingTitle();
      const entries = await extractTranscriptEntries();

      if (!entries || entries.length === 0) {
        return {
          success: false,
          error: 'Aucun transcript trouvé. Assurez-vous d\'avoir ouvert le transcript dans Teams.'
        };
      }

      console.log(`Successfully extracted ${entries.length} entries`);

      return {
        success: true,
        data: {
          title,
          date: new Date().toISOString(),
          entries,
          url: window.location.href
        }
      };
    } catch (error) {
      console.error('Extraction error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Écouter les messages du popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ping') {
      sendResponse({ pong: true });
      return false;
    }

    if (request.action === 'extractTranscript') {
      extractTranscript().then(sendResponse);
      return true;
    }
  });
})();
