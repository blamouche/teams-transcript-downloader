# Todo — Masquer les boutons debug dans la popup V2

## Objectif
Cacher les boutons « Debug DOM » et « Debug réunion » de l’interface popup ; les garder dans le DOM pour un éventuel réusage ultérieur.

## Fichiers concernés
- `v2/popup.html` : ajouter `class="hidden"` aux boutons debug.

## Étapes
- [x] Identifier les boutons debug dans `v2/popup.html`.
- [x] Ajouter `class="hidden"` aux boutons concernés.
- [x] Mettre à jour `version.md`, `releases.md`, `memory.md`.
- [x] Committer et pousser.

## Review
- **Changement** : `v2/popup.html:88-89` ajoute `class="hidden"` aux boutons
  `#debug-btn` et `#debug-meeting-btn` ; le bouton « Réinitialiser l’historique »
  reste visible.
- **Validation** : HTML relu ; handlers `popup.js` non impactés.
- **Livraison** : version prompt-hub 0.1.15, release note ajoutée, commit
  `feat(v2): hide debug buttons in popup` poussé sur `feature/v2-auto-download`.
- **Status** : `completed`.
