# Tâche : Mise à jour du README avec la documentation technique

## Objectif

Enrichir le `README.md` existant avec la documentation technique détaillée du projet (architecture, fonctionnement interne, extraction multi-frame, permissions, flux d'exécution).

## Plan

- [x] Lire le code source (`manifest.json`, `content.js`, `popup.js`, `popup.html`)
- [x] Identifier les éléments techniques à documenter :
  - Architecture (popup + content script + scripting API)
  - Extraction multi-frame (getAllFrames + scan + score)
  - Heuristique de sélection du meilleur frame
  - Algorithme d'extraction (findContainer, extractEntryFromCell, scroll progressif)
  - Formats d'export (JSON, TXT avec fusion des messages)
  - Debug DOM
- [x] Restructurer le README avec une section "Architecture technique"
- [x] Documenter les permissions host (`<all_urls>`) et pourquoi (Teams Recap iframe)
- [x] Lister les sélecteurs DOM utilisés
- [x] Documenter le flux d'exécution étape par étape
- [x] Mettre à jour la section "Développement"
- [x] Incrémenter la version et mettre à jour le changelog
- [x] Commit + push

## Revue

Documentation technique ajoutée : architecture à trois couches (popup / content script / `chrome.scripting`), flux d'extraction en 4 étapes, heuristique de scoring multi-frame, algorithme de scroll progressif, formats de sortie, permissions détaillées.

Statut : completed
