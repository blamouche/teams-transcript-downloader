# Lessons

## 2026-06-22 — Clé de déduplication basée sur une lecture DOM asynchrone
- **Contexte** : la dédup V3 keyée sur la date de l'en-tête du récap continuait de
  re-télécharger les mêmes réunions d'un run à l'autre.
- **Cause** : la valeur servant de clé (date de l'en-tête) était (1) lue de façon
  asynchrone → parfois vide, parfois pleine selon le timing, et (2) sensible au
  format (espaces/locale). Une clé qui varie = pas de dédup.
- **Règle** : quand une clé de déduplication dépend d'une lecture DOM dynamique,
  TOUJOURS (a) **sonder** jusqu'à ce que la valeur soit présente (ne pas se
  contenter d'une seule lecture), et (b) **canoniser** la valeur (format stable,
  insensible aux espaces/locale) avant de l'intégrer à la clé.
- **Bonus** : changer la FORME d'une clé persistée invalide l'historique →
  prévenir l'utilisateur d'un re-traitement unique.
