# Todo — Adapter le libellé d’automatisation à l’intervalle paramétré

## Objectif
Rendre le petit texte sous le switch « Automatisation » dynamique : il doit refléter la valeur actuelle de `intervalMin` (par défaut 5 min) au lieu d’afficher systématiquement « toutes les 1 min ».

## Fichiers concernés
- `v2/popup.html` : ajouter un `id` sur le `<small>`.
- `v2/popup.js` : mettre à jour le texte à l’init et quand `intervalMin` change.

## Étapes
- [x] Localiser le texte statique dans `v2/popup.html`.
- [x] Ajouter un identifiant sur le `<small>` pour pouvoir le mettre à jour.
- [x] Ajouter une fonction de formatage du libellé dans `popup.js`.
- [x] Brancher la mise à jour sur `loadSettings` et sur le change de l’intervalle.
- [x] Valider avec `node --check`.
- [x] Mettre à jour `version.md` + `releases.md` et committer.

## Review
- **Changement** : `v2/popup.html:20` donne un `id="auto-desc"` au `<small>` ;
  `v2/popup.js` ajoute `updateAutoDesc(intervalMin)` et l’appelle dans
  `loadSettings` et dans le listener `change` de `#interval-min`.
- **Validation** : `node --check v2/popup.js` + `v2/background.js` OK ; manifest
  JSON valide.
- **Livraison** : version prompt-hub 0.1.14, release note ajoutée, commit
  `feat(v2): dynamic automation label from intervalMin` poussé sur
  `feature/v2-auto-download`.
- **Status** : `completed`.
