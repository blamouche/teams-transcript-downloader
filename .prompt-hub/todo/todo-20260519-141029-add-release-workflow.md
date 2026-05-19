# Todo — Add release workflow

Date: 2026-05-19 14:10:29
Slug: add-release-workflow

## Objectif

Mettre en place un workflow GitHub Actions qui, à chaque push de tag, crée une
release GitHub contenant un zip avec uniquement les fichiers nécessaires au
plugin Chrome.

## Contraintes

- Trigger : push d'un tag versionné (`v*`).
- Le zip ne doit contenir QUE les fichiers nécessaires au chargement de
  l'extension dans Chrome :
  - `manifest.json`
  - `content.js`
  - `popup.html`
  - `popup.css`
  - `popup.js`
  - `icons/` (icon16, icon48, icon128)
- Exclure : `.git`, `.github`, `.prompt-hub`, `CLAUDE.md`, `agents.md`,
  `README.md`, tout fichier `.md` ou outil interne.
- Le nom du zip doit refléter le tag (ex. `teams-transcript-downloader-v1.0.1.zip`).
- La release doit être publiée automatiquement avec ce zip en asset.

## Étapes

1. Créer `.github/workflows/release.yml` :
   - `on: push: tags: ['v*']`
   - Job `build-and-release` :
     - Checkout
     - Étape de packaging : créer un dossier temporaire avec uniquement les
       fichiers du plugin, puis zipper.
     - Étape de release : utiliser `softprops/action-gh-release@v2` pour
       publier la release et attacher le zip.
2. Documenter le process de release dans le `README.md` (section "Release").
3. Mettre à jour `.prompt-hub/version.md` (patch bump).
4. Mettre à jour `.prompt-hub/releases.md`.
5. Mettre à jour `.prompt-hub/memory.md`.
6. Commit + push.

## Review

- Workflow créé : `.github/workflows/release.yml`.
  - Trigger : `push: tags: ['v*']`.
  - Permissions explicites : `contents: write` (nécessaire pour
    `softprops/action-gh-release`).
  - Étapes : checkout → calcul du tag/version/nom de zip → staging des
    fichiers du plugin dans `dist/teams-transcript-downloader/` →
    `zip -r teams-transcript-downloader-<tag>.zip teams-transcript-downloader`
    → release via `softprops/action-gh-release@v2` avec
    `generate_release_notes: true`.
  - Fichiers inclus : `manifest.json`, `content.js`, `popup.html`, `popup.css`,
    `popup.js`, `icons/icon{16,48,128}.png`.
  - Exclusions implicites : tout le reste (`.git`, `.github`, `.prompt-hub`,
    `*.md`, `agents.md`, `CLAUDE.md`, etc.) car la liste de copie est
    explicite (allow-list, pas deny-list).
- README mis à jour : nouvelle section *Release* + entrée
  `.github/workflows/` dans la structure du projet.
- Workflow prompt-hub : version 0.0.1 → 0.0.2, entrée dans `releases.md`,
  log dans `memory.md`.
- Validation YAML : pas de tabulation, structure conforme.
- Status : `completed`.
