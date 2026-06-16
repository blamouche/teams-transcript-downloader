# Releases

## 0.1.0 — 2026-06-16

- Nouvelle branche `feature/v2-auto-download` : gestion de **deux versions** du
  plugin côte à côte dans le dépôt.
- Restructuration : les fichiers du plugin V1 (contenu **inchangé**) sont
  déplacés dans `v1/`.
- **V2** (`v2/`) : extension distincte (manifest `2.0.0`) qui ajoute le
  téléchargement automatique des transcripts Teams. En un clic
  (« Télécharger automatiquement »), elle : (1) cherche et ouvre une discussion
  de type *meeting* dans la sidebar, (2) ouvre le récapitulatif de réunion,
  (3) clique sur l'onglet Transcript, (4) extrait (moteur V1) puis télécharge le
  `.txt` directement dans le dossier Téléchargements (`saveAs:false`).
  Le bouton « Extraire manuellement » conserve le comportement V1 en secours.
- Workflow `release.yml` : package désormais **deux** zips
  (`...-v1-<tag>.zip` et `...-v2-<tag>.zip`).
- `README.md` : section *Deux versions*, instructions d'installation/usage par
  version, structure mise à jour, section *Release* adaptée.

## 0.0.3 — 2026-05-19

- `README.md` : ajout d'une sous-section *Depuis une release GitHub
  (recommandé)* dans la section *Installation*, avec lien direct vers la page
  des releases. Le mode développeur depuis les sources est conservé comme
  alternative.

## 0.0.2 — 2026-05-19

- Ajout du workflow GitHub Actions `.github/workflows/release.yml` :
  déclenchement automatique sur push de tag `v*`, packaging d'un zip ne
  contenant que les fichiers nécessaires au chargement de l'extension Chrome
  (`manifest.json`, `content.js`, `popup.{html,css,js}`, `icons/`), publication
  d'une release GitHub avec le zip en asset et notes auto-générées.
- Documentation : nouvelle section *Release* dans le `README.md` (procédure de
  tag + push, contenu du zip).

## 0.0.1 — 2026-04-17

- Refonte du `README.md` : ajout d'une documentation technique complète (architecture à 3 composants, flux d'extraction multi-frame, heuristique de scoring, algorithme de scroll, sélecteurs utilisés, formats JSON/TXT, permissions détaillées, limitations connues).
- Initialisation du workflow prompt-hub (`version.md`, `releases.md`, `memory.md`, `lessons.md`).
