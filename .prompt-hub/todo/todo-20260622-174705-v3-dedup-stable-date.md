# V3 : stabiliser la clé de dédup (re-téléchargements en boucle)

## Symptôme (capture utilisateur)
Entre run 17:33 et 17:42, FF#2 / Bi-weekly / Sprint Review re-téléchargés alors
qu'ils étaient « déjà traité »/« téléchargé ». FF#2 sans date à 17:33, avec date
(14:00–15:00) à 17:42.

## Cause
Clé date-récap instable : (1) en-tête récap rendu async → lu vide puis plein ;
(2) date brute variait en espaces/format (« 12:00 –  12:25 » vs « – »).

## Fix
- `getRecapDateAcrossFrames(tabId, tries=8, delayMs=700)` : SONDE l'en-tête
  (~5,6 s) jusqu'à présence.
- `canonicalMeetingDate()` : date FR → `AAAA-MM-JJ-HHMM` (heure de début), repli
  texte normalisé. Utilisée dans `dedupKey`.
- manifest 3.0.21→3.0.22 ; version.md 0.3.3→0.3.4.

## Validation
- node --check OK.
- Test parser : « 12:00 –  12:25 » et « 12:00 – 12:25 » → même clé `2026-06-22-1200`.

## Review
- Stabilité = présence (poll) + canonisation. Lesson ajoutée.
- Limite : 1 re-download unique (forme de clé change), puis stable.
- Statut : completed.
