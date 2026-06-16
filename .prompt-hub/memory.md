# Memory

## 2026-04-17 09:30 — agent (Claude)

- Action : Initialisation du workflow prompt-hub et mise à jour du `README.md` avec la documentation technique.
- Fichiers modifiés : `README.md`, `.prompt-hub/version.md` (créé), `.prompt-hub/releases.md` (créé), `.prompt-hub/memory.md` (créé), `.prompt-hub/lessons.md` (créé), `.prompt-hub/todo/todo-20260417-093000-update-readme-tech-doc.md` (créé).
- Outcome : success.
- Next : commit `docs: expand README with technical documentation` puis push.

## 2026-05-19 14:10 — agent (Claude)

- Action : Ajout du workflow GitHub Actions de release automatique. À chaque
  push de tag `v*`, un zip ne contenant que les fichiers du plugin est
  construit et attaché à une release GitHub.
- Fichiers modifiés : `.github/workflows/release.yml` (créé), `README.md`
  (section *Release* + structure), `.prompt-hub/version.md` (0.0.1 → 0.0.2),
  `.prompt-hub/releases.md`, `.prompt-hub/todo/todo-20260519-141029-add-release-workflow.md`
  (créé).
- Outcome : success.
- Next : commit `ci: add tag-triggered release workflow with plugin-only zip`
  puis push.

## 2026-05-19 14:20 — agent (Claude)

- Action : Tag `v1.0.0` créé et poussé, workflow GitHub Actions exécuté avec
  succès en ~11 s, release publiée avec
  `teams-transcript-downloader-v1.0.0.zip` en asset.
- Outcome : success.

## 2026-05-19 14:25 — agent (Claude)

- Action : Ajout d'une sous-section *Depuis une release GitHub (recommandé)*
  dans la section *Installation* du `README.md`, avec lien vers la page des
  releases du dépôt.
- Fichiers modifiés : `README.md`, `.prompt-hub/version.md` (0.0.2 → 0.0.3),
  `.prompt-hub/releases.md`.
- Outcome : success.
- Next : commit `docs: link to GitHub releases in install instructions` puis
  push.

## 2026-06-16 14:00 — agent (Claude)

- Action : Création de la branche `feature/v2-auto-download` pour gérer deux
  versions du plugin. Déplacement des fichiers V1 (inchangés) dans `v1/`.
  Création de la V2 (`v2/`, manifest 2.0.0) = logique V1 + orchestration de
  navigation automatique dans Teams (sidebar meeting → récapitulatif →
  transcript) + téléchargement direct du `.txt` (`saveAs:false`). Conservation
  d'un bouton d'extraction manuelle de secours. Mise à jour de `release.yml`
  (deux zips v1/v2) et du `README.md`.
- Décisions utilisateur : dossiers v1/v2 séparés ; mode auto + manuel ;
  téléchargement direct dans Téléchargements.
- Fichiers : `v1/*` (déplacés), `v2/manifest.json`, `v2/popup.html`,
  `v2/popup.js`, `v2/popup.css`, `v2/content.js`, `v2/icons/*` (créés),
  `.github/workflows/release.yml`, `README.md`, `.prompt-hub/version.md`
  (0.0.3 → 0.1.0), `.prompt-hub/releases.md`,
  `.prompt-hub/todo/todo-20260616-140000-v2-auto-download.md` (créé).
- Outcome : success (sélecteurs d'automatisation Teams à valider en conditions
  réelles — implémentation défensive avec repli manuel).
- Next : commit `feat: add V2 with automatic transcript download` puis push.

## 2026-06-16 14:30 — agent (Claude)

- Action : V2 — ajout d'un switch d'automatisation (persistant,
  `chrome.storage.local`, permission `storage`). Actif → scan de TOUTES les
  discussions de la sidebar Teams via `frameChats('list'|'click', i)` ;
  pour chacune, `tryExtractCurrent` ouvre recap + transcript, extrait et
  télécharge le `.txt` (`saveAs:false`). Déduplication titre+nb entrées,
  plafond 50. Remplacement de `autoDownload`/`frameClickMeeting` par
  `autoScanAll`. Activer le switch lance le scan immédiatement.
- Fichiers : `v2/popup.html`, `v2/popup.css`, `v2/popup.js`,
  `v2/manifest.json` (+ permission storage), `README.md`,
  `.prompt-hub/version.md` (0.1.0 → 0.1.1), `.prompt-hub/releases.md`.
- Validation : `node --check` OK, manifest JSON valide, pas de réf morte.
- Outcome : success (sélecteurs Teams toujours à valider en réel).
- Next : commit `feat(v2): add automation switch to scan all chats` puis push.

## 2026-06-16 14:45 — agent (Claude)

- Action : L'utilisateur a fourni un "code source" de page Teams = en fait le
  shell HTML d'amorçage (React + bundle lodash), pas la sidebar rendue. Noms de
  réunions cités : "Pierre-Ben", "FF #2 Soheir", "Bi-weekly AI F..." → les
  discussions meeting n'ont PAS de mot-clé dans leur nom, ce qui valide le choix
  du scan-all sans filtre. Ajout d'un diagnostic `frameDumpSidebar` injecté,
  intégré au rapport *Debug DOM* (clé `sidebar`), pour récupérer les vrais
  sélecteurs DOM et fiabiliser `frameChats`.
- Fichiers : `v2/popup.js`, `.prompt-hub/version.md` (0.1.1 → 0.1.2),
  `.prompt-hub/releases.md`.
- Outcome : success. EN ATTENTE du JSON de debug (section `sidebar`) de
  l'utilisateur pour verrouiller les sélecteurs de la liste de discussions.
- Next : commit `chore(v2): dump sidebar structure in Debug DOM` puis push.
