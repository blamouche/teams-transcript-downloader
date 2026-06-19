# CI — Release packagée à chaque commit sur main

## Objectif
Déclencher une release GitHub à **chaque commit sur `main`**, avec **un zip par
version** (v1, v2, v3) en assets.

## Constat
`.github/workflows/release.yml` existait déjà mais se déclenchait sur les **tags
`v*`** (`on.push.tags`). La logique de build (boucle v1/v2/v3, un zip par
version) est correcte et conservée.

## Plan
1. Changer le déclencheur : `on.push.branches: [main]` (au lieu des tags).
2. Générer un tag/nom de release **unique par commit** : `v<version>-<short_sha>`
   où `<version>` vient de `.prompt-hub/version.md`. Évite la collision de tag.
3. Conserver la boucle de packaging v1/v2/v3 → un zip chacun.
4. Publier la release (assets = les 3 zips, notes auto-générées).
5. MAJ README (section Release), version, releases, memory.

## Review
- _(à compléter)_
