# Todo — Retirer le bouton « Scanner maintenant »

## Objectif
Le bouton « Scanner maintenant » est redondant avec l’activation du switch d’automatisation. Le retirer de la popup et nettoyer les gestionnaires / messages associés.

## Fichiers concernés
- `v2/popup.html` : supprimer le bouton `#auto-btn`.
- `v2/popup.js` : supprimer la référence au bouton et le listener `start`.

## Étapes
- [x] Repérer le bouton et ses références dans popup.{html,js}.
- [x] Supprimer `#auto-btn` de `popup.html`.
- [x] Supprimer la constante et le listener dans `popup.js`.
- [x] Mettre à jour version, releases, memory et committer.

## Review
- **Changement** : `v2/popup.html:69-73` supprime le bouton « Scanner maintenant » ;
  `v2/popup.js` retire la constante `autoBtn`, son `toggle('hidden')` dans `render()`,
  et le listener `click` envoyant le message `start`.
- **Validation** : `node --check v2/popup.js` + `v2/background.js` OK ; manifest JSON valide.
- **Livraison** : version prompt-hub 0.1.17, release note ajoutée, commit
  `feat(v2): remove redundant scan-now button` poussé sur `feature/v2-auto-download`.
- **Status** : `completed`.
