# Tâche : V3 — Paramètres avancés (jours + plages horaires du scan auto)

## Objectif
Ajouter une section « Paramètres avancés » dans le panneau V3 permettant de
restreindre le **scan automatique** à des jours de la semaine et des plages
horaires choisis. Hors plage, l'automatisation reste active mais ne lance aucun
scan : elle planifie le prochain scan à l'ouverture de la prochaine fenêtre.

## Contraintes
- Le scan **manuel** (Extraire manuellement) reste toujours disponible.
- Réglages persistés dans `chrome.storage.local`.
- Compat ascendante : par défaut désactivé → comportement actuel inchangé.

## Plan
1. panel.html : section repliable « Paramètres avancés » (switch d'activation,
   cases jours Lun-Dim, heure début/fin).
2. panel.css : styles jours + section.
3. panel.js : load/save des nouveaux réglages.
4. background.js :
   - `getSchedule()` + défauts.
   - helpers `isWithinSchedule()`, `nextWindowStart()`, `parseHM()`.
   - `maybeStartAuto()` : gate les déclenchements auto.
   - `scheduleNextRun()` respecte la fenêtre (sinon planifie l'ouverture suivante).
   - Remplacer les `startScan('auto')` des triggers par `maybeStartAuto`.
5. Version/manifest/releases/memory.

## Review
- Implémenté : section « Paramètres avancés » (panel.html/.css/.js) + gating du
  scan auto côté SW (background.js).
- `maybeStartAuto()` centralise le gating et remplace tous les `startScan('auto')`
  des triggers (onAlarm, onStartup, onInstalled, autoEnabledChanged, pendingAutoStart).
- `scheduleNextRun()` saute à `nextWindowStart()` si le prochain tick tombe hors plage.
- Plages nocturnes (début > fin) gérées dans `isWithinSchedule()`.
- Scan manuel inchangé ; défaut OFF → rétrocompatible.
- Validation : `node --check` OK sur background.js et panel.js.
- Statut : completed (reste commit/merge/push selon convention projet).
