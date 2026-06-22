# Fix V3 : transcript trop court → erreur (extraction directe partielle)

## Contexte
Run de debug `ttd-debug-run-2026-06-18T16-09-20-746Z.json` : la réunion
« DXD ISPARK "Spotlight" Sessions : 30 mn Focus RH » termine en `status: error`.
Diag : `path: "direct"`, `bestScore: 132`, 16 entrées, 3067 octets, 3 tentatives.

## Cause racine
`tryExtractCurrent` tente l'extraction DIRECTE en premier et retourne dès qu'un
résultat non vide est trouvé (`if (r.transcript) return`). Sur cette page le récap
expose un aperçu horodaté partiel (score 132, 16 entrées) qui satisfait le chemin
direct → l'onglet Transcript (`data-tid="Transcript"`, non sélectionné) n'est
JAMAIS cliqué. La boucle de retry rejoue le MÊME chemin direct 3 fois → toujours
16 entrées < 10 Ko → erreur. Aucune escalade vers le vrai onglet Transcript.

## Correctif
1. `tryExtractCurrent(tabId, tabUrl, gen, forceTabs)` : quand `forceTabs` est vrai,
   sauter le retour anticipé du chemin direct et passer par Récap + onglet
   Transcript avant d'extraire.
2. Boucle de retry : après une tentative trop petite, forcer `forceTabs=true` pour
   les tentatives suivantes (escalade au lieu de répéter).
3. Conserver le MEILLEUR transcript (plus gros) entre tentatives.

## Validation
- Vérifier la cohérence JS (node --check).
- Relire le flux : direct d'abord, escalade onglet ensuite, best conservé.

## Review
- `tryExtractCurrent(tabId, tabUrl, gen, forceTabs=false)` : le retour anticipé du
  chemin direct est gardé par `if (!forceTabs)`. Diag `path: 'forced-tabs'`.
- Boucle de retry (startScan) : 1re tentative directe ; après tout résultat trop
  court, `forceTabs=true` pour les suivantes. Conserve le plus gros transcript
  (comparaison par octets) → une tentative plus pauvre n'écrase plus une meilleure.
- `node --check v3/background.js` : OK.
- `manifest.json` v3 3.0.19 → 3.0.20 ; version.md 0.3.1 → 0.3.2 ; releases.md + memory.md.
- Limite connue : si après `forced-tabs` le transcript reste < 10 Ko, c'est une
  réunion réellement courte → faux positif du garde-fou 10 Ko (à traiter plus tard
  via un critère de stabilité du nombre d'entrées).
- Statut : completed.
