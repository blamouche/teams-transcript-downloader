# Todo — Cohérence des évènements V2

Date : 2026-06-16

## Contexte
Revue de cohérence de la V2 (service worker + popup). Trois problèmes signalés par
l'utilisateur :

1. Entre deux scans le compte à rebours n'est pas visible.
2. Pendant un scan, Stop désactive tout, mais re-activer l'automatisation ne relance
   pas immédiatement.
3. Stopper un scan en cours : sur la page Teams le scan semble continuer.

## Causes racines
- (1) `scheduleNextRun()` n'est appelé que sur le chemin `done`. Toute sortie non
  heureuse (erreur, aucune réunion, Teams pas prêt, frame vide) tue la boucle
  d'automatisation sans replanifier → pas de `nextRunAt` → pas de compte à rebours.
- (2) `autoEnabledChanged` fait `if (!isRunning) startScan()`. Après Stop, le scan
  en cours continue (isRunning reste true) → le ré-clic ne lance rien.
- (3) `stopRequested` n'est testé qu'aux gros checkpoints. `frameFullExtract`
  (injecté, boucle de scroll de plusieurs minutes) et les `sleep` ne le consultent
  pas → la discussion courante continue d'être traitée.
- Connexe : le scan moribond écrit un état `stopped` qui écrase l'état idle propre
  posé par `resetToIdleState`.

## Plan
- [x] Remplacer `stopRequested` (booléen) par un compteur de génération `scanGen`.
      Un scan est valide tant que `myGen === scanGen`. `cancelScan()` incrémente
      `scanGen` → le scan en cours s'auto-invalide et sort silencieusement (sans
      écraser l'état).
- [x] Rendre l'extraction injectée interruptible : flag `window.__ttdAbort`
      (posé par `signalAbortToTab()` au Stop, lu dans la boucle de `frameFullExtract`,
      remis à false au début de chaque extraction).
- [x] Sleeps annulables (`sleepCancellable`) pour un arrêt rapide.
- [x] Déplacer la re-planification dans un point de sortie unique (`finally`) :
      replanifie après TOUTE issue non annulée si l'automatisation est active → le
      compte à rebours réapparaît toujours.
- [x] Ré-activation : si un scan tourne encore, `pendingAutoStart` → relance dès la
      fin du scan moribond ; sinon démarrage immédiat.
- [x] node --check + validation manifest.

## Review
- `v2/background.js` : `stopRequested` (booléen) remplacé par `scanGen` (génération).
  `cancelScan()` + `signalAbortToTab()` (flag `window.__ttdAbort`). `frameFullExtract`
  réinitialise et teste le flag dans sa boucle. `sleepCancellable`. `waitForChatList`
  /`expandChatList`/`tryExtractCurrent` prennent `gen`. `startScan` : checkpoints
  silencieux (`aborted()` → return sans setState) + re-planification dans `finally`
  (replanifie après toute issue non annulée si auto active ; consomme
  `pendingAutoStart` sinon). Handlers `stop` (cancelScan + pendingAutoStart=false)
  et `autoEnabledChanged` (pendingAutoStart si isRunning, sinon démarrage immédiat).
- Validé : `node --check` OK sur background.js et popup.js, manifest JSON valide.
- Limite : pas de test navigateur exécuté (environnement CLI) ; à vérifier en charge
  réelle sur Teams (notamment l'interruption effective de `frameFullExtract`).
- Statut : completed.
