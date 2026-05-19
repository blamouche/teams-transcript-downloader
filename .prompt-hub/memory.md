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
