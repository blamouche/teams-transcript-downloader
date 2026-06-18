// Content script - minimal, kept for backward compatibility
// Main extraction logic is now in popup.js using chrome.scripting.executeScript with allFrames

(function() {
  'use strict';

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ping') {
      sendResponse({ pong: true });
      return false;
    }
  });
})();
