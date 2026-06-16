# Todo — Arrêter le scan doit revenir immédiatement à l’état de base

## Objectif
Quand l’utilisateur clique sur « Arrêter » en cours de scan, la popup doit revenir immédiatement à son état de base (idle / prêt), sans attendre la fin du traitement en cours ni rester sur un message d’arrêt intermédiaire.

## Fichiers concernés
- `v2/background.js` : message `stop` doit réinitialiser l’état à idle immédiatement.

## Étapes
- [x] Identifier le comportement actuel dans `background.js`.
- [x] Faire en sorte que `stop` force un état `idle` immédiat dans `background.js`.
- [x] Empêcher le scan en cours d’écraser cet état idle avec des mises à jour intermédiaires (le scan vérifie `stopRequested` avant chaque `setState` ; l’état idle initial est écrit une seule fois).
- [x] Valider avec `node --check`.
- [x] Mettre à jour version, releases, memory et committer.

## Review
- **Changement** : `v2/background.js:42-58` ajoute `resetToIdleState()` ; le
  handler du message `stop` (ligne ~853) appelle `resetToIdleState()` au lieu de
  simplement écrire `message: 'Arrêt demandé…'`.
- **Validation** : `node --check v2/background.js` + `v2/popup.js` OK ; manifest JSON valide.
- **Livraison** : version prompt-hub 0.1.16, release note ajoutée, commit
  `feat(v2): reset to idle state immediately on stop` poussé sur
  `feature/v2-auto-download`.
- **Status** : `completed`.
