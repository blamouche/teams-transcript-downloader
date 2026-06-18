# Todo — V2 : téléchargement automatique des transcripts Teams

Timestamp : 20260616-140000
Branche : `feature/v2-auto-download`

## Objectif

Gérer deux versions du plugin côte à côte dans le dépôt :

- **V1** (inchangée) : extraction manuelle du transcript depuis le panneau
  Teams déjà ouvert, déplacée dans `v1/`.
- **V2** (nouvelle, `v2/`) : tout ce que fait V1 + automatisation complète.
  En un clic, V2 :
  1. inspecte le contenu de la fenêtre Teams,
  2. cherche une discussion de type « meeting » dans la sidebar,
  3. ouvre cette discussion,
  4. ouvre le récapitulatif de réunion,
  5. clique sur « Transcript »,
  6. extrait puis télécharge le transcript en `.txt` directement dans le
     dossier Téléchargements (comme V1, mais sans boîte de dialogue).

## Décisions utilisateur

- Structure : dossiers `v1/` et `v2/` séparés (deux extensions complètes).
- Mode V2 : automatique **+** bouton manuel de secours (logique V1 conservée).
- Téléchargement V2 : direct dans Téléchargements (`saveAs:false`).

## Étapes

- [x] Créer la branche `feature/v2-auto-download`.
- [x] Déplacer les fichiers du plugin V1 dans `v1/` (contenu identique).
- [x] Copier les assets communs (icons, content.js, popup.css) dans `v2/`.
- [x] `v2/manifest.json` : version 2.0.0, nom distinct.
- [x] `v2/popup.html` : bouton « Télécharger automatiquement » + bouton manuel.
- [x] `v2/popup.js` : logique V1 + orchestration auto (navigation Teams) +
      téléchargement direct.
- [x] Mettre à jour `.github/workflows/release.yml` (packager v1 et v2).
- [x] Mettre à jour `README.md` (structure, V1/V2).
- [x] Mettre à jour prompt-hub (version 0.1.0, releases, memory).
- [x] Commit + push.

## Notes techniques

- L'automatisation Teams repose sur des sélecteurs DOM fragiles (sidebar chat,
  onglet récapitulatif, onglet transcript) + iframe du recap. Implémentation
  défensive multi-sélecteurs + mots-clés (fr/en), avec repli sur le mode manuel
  en cas d'échec à n'importe quelle étape. À valider en conditions réelles.

## Review

- Statut : **completed**.
- Livré : branche `feature/v2-auto-download`, V1 déplacée dans `v1/` (contenu
  identique, vérifié par `node --check` et diff = renommage), V2 complète dans
  `v2/` (manifest 2.0.0). Orchestration auto : `frameClickMeeting`,
  `frameClickByKeywords`, `clickAcrossFrames`, `findTranscriptFrame`,
  `autoDownload`. Téléchargement direct (`saveAs:false`, Maj+clic = dialogue).
  Workflow release packageant deux zips. README et prompt-hub à jour.
- Validation : syntaxe JS OK (`node --check`), JSON manifests valides.
- Limitation initiale : sélecteurs DOM Teams fragiles, non testés en réel.
  → Résolue via 2 itérations de *Debug DOM* fournies par l'utilisateur :
  sélecteurs sidebar verrouillés (treeitems id+avatar, clic par id, dépliage
  "Voir plus", arrêt à la zone Équipes).
- **Validé en conditions réelles le 2026-06-16** (« ça fonctionne ») sur le
  tenant Teams v2. Scan complet des discussions, ouverture récap→transcript et
  téléchargement .txt direct opérationnels. Repli manuel conservé.
- Versions finales : V1 = v1/ (inchangée) ; V2 = v2/ (manifest 2.0.0).
  Version prompt-hub 0.1.4.
