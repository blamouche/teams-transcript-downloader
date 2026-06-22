# V3 : déduplication par date/heure de réunion (en-tête récap)

## Demande
Utiliser le bloc date/heure du panneau récapitulatif
(`data-tid="intelligent-recap-header"`, ex. « lundi 22 juin 2026 12:00 – 12:25 »)
pour savoir si une réunion est déjà traitée. Pour les récurrents, la date vient de
la dropdown d'occurrences (positionnée sur la plus récente).

## Implémentation
- `frameGetRecapDate()` : 1er `span[dir="auto"]` de l'en-tête contenant `HH:MM`
  (repli regex sur le texte de l'en-tête).
- `getRecapDateAcrossFrames(tabId)` : balaye toutes les frames.
- `tryExtractCurrent` : capture `recapDate` → `lastDiag.recapDate` (direct + tabs).
- `dedupKey` : `t:<threadId>|<recapDate||instanceDate>` ; replis `d:<date>` puis
  empreinte de contenu si aucune date ni thread.
- `when` du journal + diag alimentés par `recapDate`.
- manifest 3.0.20→3.0.21 ; version.md 0.3.2→0.3.3.

## Validation
- node --check v3/background.js : OK.

## Review
- Pas de régression pour récurrents (date dropdown déjà utilisée, désormais via
  l'en-tête qui la reflète). Réunions simples : date explicite au lieu de clé vide.
- Limite : la forme de clé change → re-téléchargement unique des réunions déjà
  traitées. Acceptable (demande explicite).
- Statut : completed.
