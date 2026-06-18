# Todo — Le bouton Arrêter doit aussi désactiver l’automatisation

## Objectif
Quand l’utilisateur clique sur « Arrêter » pendant un scan automatique ou manuel,
le switch « Automatisation » doit passer à OFF et le réglage `autoEnabled` doit
être persisté à `false`. La boucle d’automatisation ne doit pas redémarrer toute
seule ensuite.

## Fichiers concernés
- `v2/background.js` : message `stop` doit aussi désactiver `autoEnabled`.

## Étapes
- [x] Identifier le handler `stop` dans `background.js`.
- [x] Désactiver `autoEnabled` dans chrome.storage.local dans le handler `stop`.
- [x] S’assurer que la popup reflète le changement via `storage.onChanged` (déjà en place).
- [x] Valider avec `node --check`.
- [x] Mettre à jour version, releases, memory et committer.

## Review
- **Changement** : `v2/background.js` handler `stop` — ajout de
  `await chrome.storage.local.set({ autoEnabled: false })` et de
  `await updateActionUI()` ; message mis à jour en
  « Arrêté. Automatisation désactivée. ».
- **Validation** : `node --check v2/background.js` + `v2/popup.js` OK ; manifest JSON valide.
- **Livraison** : version prompt-hub 0.1.18, release note ajoutée, commit
  `feat(v2): stop button also disables automation` poussé sur
  `feature/v2-auto-download`.
- **Status** : `completed`.
