# Todo — Corriger l’état visuel du switch Automatisation quand il est désactivé par le SW

## Objectif
Quand le service worker désactive `autoEnabled` (ex. clic sur « Arrêter »), le
switch visuel dans la popup doit immédiatement refléter OFF.

## Fichiers concernés
- `v2/popup.js` : listener `storage.onChanged`.

## Étapes
- [x] Identifier pourquoi le switch reste ON (listener `onChanged` ne surveille que `scanState`).
- [x] Ajouter `autoEnabled` dans le listener `storage.onChanged` pour mettre à jour le switch.
- [x] Valider avec `node --check`.
- [x] Mettre à jour version, releases, memory et committer.

## Review
- **Changement** : `v2/popup.js:121-127` — le listener `chrome.storage.onChanged`
  met désormais à jour `autoSwitch.checked` lorsque la clé `autoEnabled` change,
  en plus de rafraîchir `scanState`.
- **Validation** : `node --check v2/popup.js` + `v2/background.js` OK ; manifest JSON valide.
- **Livraison** : version prompt-hub 0.1.19, release note ajoutée, commit
  `fix(v2): sync auto switch visual state from storage` poussé sur
  `feature/v2-auto-download`.
- **Status** : `completed`.
