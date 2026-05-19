# Releases

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
