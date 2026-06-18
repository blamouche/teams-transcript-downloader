# Releases

## 0.2.13 — 2026-06-18

- **V2 & V3 / Déduplication plus robuste (transcripts re-téléchargés)**. L'ancienne
  clé `titre | nb entrées | hash de tout le corps` était fragile : la fin du
  transcript peut être tronquée différemment d'un scan à l'autre (défilement
  virtualisé / lazy-load) et le titre peut basculer vers le libellé par défaut
  « Meeting Transcript » → la clé changeait → re-téléchargement. Nouvelle clé =
  empreinte des **20 premières entrées** (locuteur + message normalisé), toujours
  extraites de façon fiable car l'extraction part du haut ; titre et total ignorés.
  `v2/manifest.json` 2.5.0 → 2.5.1, `v3/manifest.json` 3.0.11 → 3.0.12.
- Note : le format de clé change → au 1er scan après mise à jour, les transcripts
  déjà connus sont re-téléchargés une dernière fois, puis l'historique redevient
  stable.

## 0.2.12 — 2026-06-18

- **CI / Release : le build de package couvre désormais V3**. Le workflow
  `.github/workflows/release.yml` ne packageait que V1 et V2 et copiait des fichiers
  `popup.*` codés en dur (absents de V3). Réécrit pour : boucler sur `v1 v2 v3`,
  copier l'intégralité du dossier de chaque version (agnostique aux noms —
  `popup.*`/`panel.*`, `background.js` optionnel), produire un zip par version et
  les publier tous en assets de la release. README mis à jour (3 versions).

## 0.2.11 — 2026-06-18

- **V3 / Le guide ne s'affichait pas au chargement de l'onglet**. Le guide (et le
  voile) étaient injectés juste après `chrome.tabs.create`, alors que l'onglet
  chargeait encore (about:blank → Teams) : l'injection était effacée par la
  navigation. Désormais l'habillage est appliqué quand la page a **fini de charger**,
  dans `chrome.tabs.onUpdated` (statut `complete`) pour l'onglet piloté :
  automatisation ON → voile bloquant ; OFF → guide « cliquez à nouveau » non
  bloquant. Manifest 3.0.10 → 3.0.11.

## 0.2.10 — 2026-06-18

- **V3 / Voile gris piloté par l'automatisation + guide séparé**. Le voile
  **bloquant** ne s'active plus que quand l'**automatisation est ON** (empêche les
  clics par erreur pendant le scan) ; **automatisation OFF**, il est retiré pour
  pouvoir naviguer dans Teams manuellement (`refreshOverlay` appelé sur
  `autoEnabledChanged`, `stop`, création/rechargement de l'onglet, et au réveil du
  SW). Le **guide** « cliquez à nouveau sur l'icône » est désormais **séparé** du
  voile : élément non bloquant (`pointer-events:none`) affiché à la création de
  l'onglet quand l'automatisation est OFF, masqué dès l'ouverture du panneau
  (`panelReady` → `pageRemoveGuide`). Manifest 3.0.9 → 3.0.10.

## 0.2.9 — 2026-06-18

- **V3 / Guide visuel sur le voile : « cliquez à nouveau sur l'icône »**.
  Limitation Chrome assumée (geste utilisateur → 2 clics la 1re fois). Pour guider
  l'utilisateur, le voile gris affiche désormais, près du coin haut-droit (où se
  trouve l'icône de l'extension), une carte « 👉 Cliquez à nouveau sur l'icône de
  l'extension … pour ouvrir le panneau et configurer / lancer le téléchargement »,
  avec une flèche « ⬆ Icône de l'extension ». Le guide est masqué automatiquement
  dès que le panneau s'ouvre : `panel.js` envoie `panelReady`, et le service worker
  masque le guide (`pageHideOverlayGuide`) sur l'onglet piloté (le voile reste).
  Manifest 3.0.8 → 3.0.9.

## 0.2.8 — 2026-06-18

- **V3 / Le clic ouvre un onglet Teams dédié + attache la sidebar**. Retour à
  `chrome.action.onClicked` (`openPanelOnActionClick: false`). Au clic : ouverture
  synchrone du panneau sur l'onglet Teams piloté si son id est déjà connu (geste
  préservé) ; sinon `ensureTeamsTab` ouvre un NOUVEL onglet Teams (ne détourne plus
  un onglet Teams existant de l'utilisateur), l'active et tente d'attacher le
  panneau. `ensureTeamsTab` active désormais le panneau de l'onglet
  (`setOptions enabled+path`, nécessaire sans `default_path`). La disparition au
  changement d'onglet (syncSidePanel) est conservée. Manifest 3.0.7 → 3.0.8.
- Limite : au tout premier clic, le geste peut expirer après la création de
  l'onglet → un second clic affiche la sidebar (l'onglet est alors connu, ouverture
  synchrone fiable).

## 0.2.7 — 2026-06-18

- **V3 / Le panneau ne disparaissait pas au changement d'onglet**. Cause : le
  `side_panel.default_path` du manifest gardait le panneau activé GLOBALEMENT, donc
  le `setOptions({ enabled:false })` par onglet ne le fermait pas. `default_path`
  retiré du manifest : seuls les onglets Teams (activés explicitement par
  `syncSidePanel`) ont le panneau → il disparaît dès qu'on passe sur un onglet non
  activé. `openPanelOnActionClick` + chemin par onglet suffisent à l'ouvrir au clic.
  Manifest 3.0.6 → 3.0.7.

## 0.2.6 — 2026-06-18

- **V3 / Panneau latéral attaché à l'onglet Teams (modèle « comme Claude »)**.
  Refonte : on n'ouvre plus de fenêtre dédiée. Le panneau suit le pattern
  « side panel par site » :
  - `setPanelBehavior({ openPanelOnActionClick: true })` → Chrome ouvre le panneau
    au clic (gère le geste utilisateur → fiable, un seul clic), et seulement sur les
    onglets où il est activé.
  - `syncSidePanel` (+ listeners `tabs.onActivated` / `tabs.onUpdated` + `syncAllTabs`
    au démarrage) active le panneau (`setOptions enabled+path`) sur les onglets Teams
    et le désactive ailleurs → il **disparaît quand on change d'onglet**.
  - Suppression de `chrome.action.onClicked`, de la création de fenêtre
    (`chrome.windows.create`) et de tout le suivi `dedicatedWindowId`.
  - `ensureTeamsTab` revient à un ONGLET (réutilise l'onglet piloté / un onglet
    Teams existant, sinon crée un onglet). Le voile reste appliqué sur l'onglet
    piloté. Manifest 3.0.5 → 3.0.6.

## 0.2.5 — 2026-06-18

- **V3 / Tentatives d'ouverture du panneau sur la fenêtre dédiée (1er clic)**. Au
  1er clic (fenêtre pas encore créée), on appelle maintenant `sidePanel.open()`
  IMMÉDIATEMENT après `windows.create` (un seul `await` avant → meilleure chance de
  conserver le geste utilisateur), au lieu de passer par tout `ensureTeamsTab`. Ajout
  d'une nouvelle tentative différée de 0,5 s (demande utilisateur). Avertissement :
  `chrome.sidePanel.open()` exige un geste utilisateur actif ; l'appel différé peut
  être refusé par Chrome — dans ce cas un clic sur l'icône depuis la fenêtre Teams
  affiche le panneau. Manifest 3.0.4 → 3.0.5.

## 0.2.4 — 2026-06-18

- **V3 / Le panneau ne doit s'attacher qu'à la fenêtre Teams dédiée**. Avant, au
  1er clic (fenêtre dédiée pas encore créée), le panneau s'ouvrait sur la fenêtre
  COURANTE (fenêtre 1). Désormais `action.onClicked` ne cible jamais la fenêtre
  courante : ouverture synchrone sur la fenêtre dédiée si son id est connu, sinon
  création de la fenêtre puis tentative d'attache du panneau sur elle. Si le geste
  utilisateur a expiré après `windows.create`, un clic sur l'icône depuis la
  fenêtre Teams affiche le panneau (id alors connu). Manifest 3.0.3 → 3.0.4.

## 0.2.3 — 2026-06-18

- **V3 / Correctif : le panneau ne s'affichait jamais (ouverture synchrone)**. En
  service worker MV3, `chrome.sidePanel.open()` échoue dès qu'un `await` précède
  l'appel (le geste utilisateur expire) ; et sans `default_path` il n'a aucun
  contenu. Deux changements :
  - `side_panel.default_path` rétabli dans le manifest (le panneau a un contenu).
  - Le handler `action.onClicked` n'est plus `async` : `chrome.sidePanel.open()` est
    appelé **en premier, de façon synchrone**, ciblant la fenêtre Teams dédiée si
    son id est connu (gardé EN MÉMOIRE du SW, réhydraté au démarrage), sinon la
    fenêtre courante. Le travail asynchrone (création de la fenêtre, voile, focus)
    suit sans bloquer l'ouverture.
  - Ainsi le panneau s'affiche dès le 1er clic ; une fois la fenêtre Teams créée,
    les clics suivants attachent le panneau à cette fenêtre.
  - Compromis : avec `default_path`, le panneau redevient disponible globalement
    (et le 1er clic l'affiche sur la fenêtre courante). La restriction stricte
    « uniquement l'onglet Teams » est incompatible avec une ouverture synchrone
    fiable. Manifest 3.0.2 → 3.0.3.

## 0.2.2 — 2026-06-18

- **V3 / Correctif : le panneau latéral ne s'affichait pas**. `chrome.sidePanel.open()`
  exige un geste utilisateur actif ; il était appelé après de nombreux `await`
  (tout `ensureTeamsTab` : storage + `windows.create` + `setOptions`, puis encore
  storage + `windows.update`), donc le geste était expiré → aucune ouverture. Le
  handler `action.onClicked` est resserré : si la fenêtre dédiée existe déjà, on
  appelle `open()` après un seul `await` léger (`windows.get`) ; sinon on crée la
  fenêtre puis on tente `open()`. Manifest 3.0.1 → 3.0.2.
- Limite connue : au tout premier clic (création de la fenêtre), l'`await` de
  `windows.create` peut faire expirer le geste → le panneau reste activé pour
  l'onglet et un second clic l'affiche. Les clics suivants l'attachent directement.

## 0.2.1 — 2026-06-18

- **V3 : panneau latéral ciblé sur une fenêtre Teams dédiée**. Affinage du
  comportement du panneau :
  - Le clic sur l'icône (`chrome.action.onClicked`) **ouvre une fenêtre Teams
    dédiée** (`chrome.windows.create`) — ou la refocalise si elle existe déjà — puis
    y **attache le panneau** via `chrome.sidePanel.open({ windowId })`.
  - Le panneau n'est activé que pour l'onglet dédié (`sidePanel.setOptions({ tabId,
    enabled:true })`) ; `side_panel.default_path` retiré du manifest → **aucun autre
    onglet/fenêtre n'a de panneau**. `openPanelOnActionClick` repassé à `false`.
  - On ne réutilise plus les onglets Teams existants de l'utilisateur :
    `ensureTeamsTab` crée toujours une fenêtre dédiée, donc les onglets de
    l'utilisateur ne sont jamais recouverts par le voile.
  - Nettoyage des id (`dedicatedTabId`/`dedicatedWindowId`) à la fermeture de
    l'onglet ou de la fenêtre dédiée. Manifest 3.0.0 → 3.0.1.

## 0.2.0 — 2026-06-18

- **V3 : nouvelle version (panneau latéral + voile sur l'onglet dédié)**. Branche
  `feature/v3-side-panel`, dossier `v3/` copié de `v2/`. Même moteur que V2, avec :
  - **UI en panneau latéral** (`chrome.sidePanel`) au lieu d'un popup : le clic sur
    l'icône ouvre le panneau à droite (comme l'extension Claude) via
    `setPanelBehavior({ openPanelOnActionClick: true })`. `popup.{html,css,js}` →
    `panel.{html,css,js}` (largeur fluide), `manifest` avec `side_panel.default_path`
    et `action` sans `default_popup`, permission `sidePanel`.
  - **Voile gris semi-transparent EN PERMANENCE sur l'onglet Teams dédié** : injecté
    en frame 0 via `chrome.scripting` (idempotent), il bloque clic/clavier/scroll de
    l'utilisateur (`pointer-events` + listeners en capture) et affiche un bandeau
    « Onglet piloté… ». Un `MutationObserver` le réinsère si la SPA le retire ;
    `chrome.tabs.onUpdated` le réapplique après un rechargement. Appliqué dès que
    l'onglet dédié existe (même automatisation OFF). Les actions automatisées
    (`element.click()`, `scrollTop`) étant programmatiques, elles ne sont pas
    bloquées par le voile.
  - V1 et V2 inchangées. README mis à jour (3 versions).

## 0.1.22 — 2026-06-18

- **V2 / Extraction : défilement robuste de la liste virtualisée**. La boucle de
  scroll pilotait `scrollTop` en absolu (`scrollTop += step`). Sur la liste de
  transcript virtualisée (`.ms-List`), le composant recalcule sa hauteur au fur et
  à mesure des chargements et remet `scrollTop` à 0 → « décrochage » : le scroll
  repartait du haut et la boucle tournait jusqu'à 800 fois sans atteindre le bas.
  Désormais le défilement s'ancre sur la DERNIÈRE cellule rendue via
  `scrollIntoView({block:'end'})` (nœud réel, auto-correctif face aux sauts de
  scroll), avec arrêt dès que plus aucune nouvelle entrée n'apparaît après
  plusieurs paliers (max ramené de 800 à 400 itérations).

## 0.1.21 — 2026-06-18

- **V2 / Réunions récurrentes : sélection de l'occurrence la plus récente**. Le
  récap d'une réunion récurrente présente un sélecteur d'instance
  (`data-testid="intelligent-recap-instance-select-dropdown"`, ex. « mercredi 17
  juin 2026 13:30 – 14:00 »). Avant d'extraire, le scan ouvre désormais ce
  sélecteur, parse les dates FR des options et positionne l'occurrence PASSÉE la
  plus récente (repli : occurrence datée la plus récente, puis 1re option). No-op
  pour une réunion simple sans sélecteur. Nouvelle fonction injectée
  `frameSelectLatestInstance` + helper `selectLatestInstanceAcrossFrames`, appelés
  dans `tryExtractCurrent` avant la tentative directe et re-tentés après ouverture
  du récap. Le diagnostic `lastDiag` inclut l'instance choisie.

## 0.1.20 — 2026-06-16

- **V2 / Cohérence des évènements : refonte de la sémantique d'arrêt et de la
  boucle d'automatisation**. Trois problèmes corrigés :
  1. *Compte à rebours invisible entre deux scans* : `scheduleNextRun()` n'était
     appelé que sur le chemin heureux `done`. Toute autre issue (erreur, aucune
     réunion, Teams pas prêt, frame vide) tuait la boucle sans replanifier. La
     re-planification est désormais dans un point de sortie unique (`finally`) :
     dès que l'automatisation est active, le prochain scan est planifié quelle que
     soit l'issue → le compte à rebours réapparaît toujours.
  2. *Ré-activation sans relance immédiate* : après un Stop, le scan moribond
     gardait `isRunning = true`, donc `if (!isRunning) startScan()` ne faisait rien.
     Ajout d'un drapeau `pendingAutoStart` : si un scan est encore en train de
     s'arrêter, la relance s'exécute dès sa fin ; sinon démarrage immédiat.
  3. *Scan qui continue côté Teams après Stop* : `stopRequested` n'était testé
     qu'aux gros checkpoints ; l'extraction injectée (`frameFullExtract`, boucle de
     défilement de plusieurs minutes) et les `sleep` l'ignoraient. Introduction d'un
     flag `window.__ttdAbort` posé dans les frames Teams au Stop et lu par la boucle
     de défilement, plus des `sleepCancellable` → l'extraction s'interrompt vite.
  - Remplacement du booléen `stopRequested` par un compteur de génération `scanGen` :
    un scan invalidé sort sans écrire d'état, ce qui empêche un scan moribond
    d'écraser l'état idle propre posé par `resetToIdleState`.

## 0.1.19 — 2026-06-16

- **V2 / UI : correction du switch Automatisation qui restait visuellement ON**.
  Le listener `storage.onChanged` de la popup ne surveillait que `scanState` ;
  quand le service worker écrivait `autoEnabled: false` (ex. clic sur « Arrêter »),
  le switch conservait son ancien état. La popup met à jour maintenant
  `autoSwitch.checked` en temps réel lorsque la clé `autoEnabled` change dans
  `chrome.storage.local`.

## 0.1.18 — 2026-06-16

- **V2 / UX : Arrêter désactive aussi l’automatisation**. Le bouton « Arrêter »
  met désormais `autoEnabled` à `false` dans `chrome.storage.local` en plus
  d’annuler l’alarme de scan en cours. Le switch « Automatisation » se décoche
  automatiquement via le listener `storage.onChanged` de la popup, et la pastille
  d’icône est rafraîchie. Cela évite que la boucle automatique ne redémarre
  toute seule après un arrêt manuel.

## 0.1.17 — 2026-06-16

- **V2 / UI : suppression du bouton « Scanner maintenant »**. Le scan démarre
  via le switch « Automatisation », rendant le bouton manuel redondant. Le bouton
  a été retiré de `popup.html` et son listener supprimé de `popup.js`. Le handler
  `start` reste disponible dans `background.js` pour les déclenchements automatiques
  (switch, onStartup, onInstalled) et les besoins de debug internes.

## 0.1.16 — 2026-06-16

- **V2 / UX : retour immédiat à l’état de base sur arrêt manuel**. Avant,
  cliquer sur « Arrêter » pendant un scan laissait la popup sur un message
  intermédiaire (« Arrêt demandé… ») jusqu’à la fin de l’opération en cours,
  qui peut être longue (ouverture de réunion + extraction). Désormais le
  service worker force immédiatement un état `idle` (running=false, phase=idle,
  compteurs réinitialisés) ; le scan s’arrête en arrière-plan dès qu’il atteint
  son prochain point de contrôle, sans écraser l’état de base affiché.

## 0.1.15 — 2026-06-16

- **V2 / UI : masquage des boutons de debug**. Les boutons « Debug DOM » et
  « Debug réunion » dans la popup sont désormais cachés (`class="hidden"`).
  Ils restent dans le DOM et les gestionnaires dans `popup.js` sont inchangés,
  ce qui permet de les réactiver facilement si besoin.

## 0.1.14 — 2026-06-16

- **V2 / libellé d’automatisation dynamique** (extension inchangée 2.5.0). Le
  texte sous le switch « Automatisation » affichait systématiquement
  « re-scan toutes les 1 min » alors que l’intervalle paramétrable est de 5 min
  par défaut. Le libellé est désormais mis à jour dynamiquement en fonction de
  `intervalMin`, à l’ouverture de la popup et à chaque modification du champ
  « Intervalle entre scans ».

## 0.1.13 — 2026-06-16

- **V2 / retours visuels** (extension 2.4.2 → 2.5.0).
  - **Loader** (spinner animé) dans la popup pendant tout le scan
    (`state.running`).
  - **Nouvelle icône** dessinée à la volée dans le service worker
    (`OffscreenCanvas` + `chrome.action.setIcon`) : document à lignes
    (« transcript ») sur fond violet Teams — pas de convertisseur SVG dispo, donc
    rendu programmatique 16/32/48/128.
  - **Pastille de statut** sur l'icône via `chrome.action.setBadgeText` :
    ● violet = scan en cours, ● vert = automatisation active (en attente),
    ■ rouge = arrêté, rien = automatisation désactivée. Mise à jour à chaque
    changement d'état (`updateActionUI` appelé dans `setState`).

## 0.1.12 — 2026-06-16

- **V2 / bilan de fin persistant** (extension 2.4.1 → 2.4.2). Le message de
  bilan était aussitôt écrasé par le compte à rebours du prochain scan → jamais
  visible en mode automatique. Ajout d'un **bloc « Bilan du dernier scan »**
  dédié et persistant dans la popup (téléchargés / déjà traités / sans
  transcript / scannées + heure de fin), alimenté par `scanState.summary`
  (réinitialisé au début d'un scan, conservé pendant la pause). Le bilan
  s'affiche aussi en cas d'arrêt manuel.

## 0.1.11 — 2026-06-16

- **V2 / transcript incomplet corrigé** (extension 2.4.0 → 2.4.1). Le transcript
  du récap est une **liste virtualisée** : l'ancien défilement s'arrêtait trop
  tôt (et ne récupérait que la portion visible si le conteneur détecté n'était
  pas scrollable) → fichier tronqué.
  - `frameFullExtract` réécrit : détection du **vrai élément scrollable**
    (ancêtre `overflow:auto/scroll`, sinon le conteneur, sinon le document),
    défilement par paliers (~80 % de la hauteur visible) avec **attente de 600 ms**
    pour le rendu lazy, et arrêt seulement quand le nombre d'entrées est
    **stable (8 lectures) ET arrivé en bas** (jusqu'à 800 paliers).

## 0.1.10 — 2026-06-16

- **V2 / extraction du transcript corrigée** (extension 2.3.1 → 2.4.0). Le
  `teams-meeting-debug.json` a montré que le récapitulatif charge le transcript
  dans une iframe SharePoint (`xplatplugins…hv=Recap`, `data-automationid=
  "ListCell"`) **dès l'ouverture de la réunion**, et que nos clics texte
  « récapitulatif » puis « transcript » **détruisaient** cette iframe.
  - `tryExtractCurrent` : extraction **directe** d'abord (seuil de score élevé) ;
    en repli seulement, clics **par `data-tid` stables**
    (`tab-item-com.microsoft.chattabs.recap` puis sous-onglet `Transcript`) au
    lieu de matches texte destructeurs. Ajout de `frameClickTid`.
  - Délai après ouverture porté à 4 s (chargement de l'iframe recap).
- **Réglages & UX** (demandes utilisateur) :
  - Automatisation **OFF par défaut** (déjà le cas, confirmé) ; aucun scan à
    l'installation.
  - **Intervalle entre scans paramétrable** (`intervalMin`, défaut 5 min,
    min 1) — champ dans la popup, utilisé par `scheduleNextRun`.
  - **Compte à rebours** avant le prochain scan (popup, via `nextRunAt`).
  - **Bilan de fin enrichi** : « X téléchargé(s), Y déjà traité(s), Z sans
    transcript — N réunion(s) scannée(s) » (+ `summary` dans l'état).

## 0.1.9 — 2026-06-16

- **V2 / diagnostic d'extraction** (extension 2.3.0 → 2.3.1). Le scan trouve les
  réunions mais aucun transcript n'est téléchargé → instrumentation pour
  localiser l'échec (ouverture récap/transcription en arrière-plan).
  - `tryExtractCurrent` enregistre `lastDiag` (recap cliqué ? transcript
    cliqué ? libellés, meilleur score de frame). Affiché dans le bilan de fin
    si 0 téléchargement.
  - Mots-clés transcript élargis (« transcription », « afficher la
    transcription », « show transcript »), délais portés à 3,5 s.
  - Nouveau bouton **« Debug réunion »** (message `debugMeeting`) : ouvre la 1re
    réunion, tente récap→transcription et dumpe, à chaque étape, les frames
    (scan) + les libellés cliquables (`frameListClickables`) dans
    `teams-meeting-debug.json`. Objectif : récupérer les vrais libellés/onglets
    du récap pour fiabiliser la navigation.

## 0.1.8 — 2026-06-16

- **V2 / historique persistant des transcripts traités** (extension 2.2.0 →
  2.3.0). Avant : déduplication seulement à l'intérieur d'un scan → la boucle
  d'1 min re-téléchargeait les mêmes réunions à chaque cycle. Désormais une
  signature de **contenu** (`titre|nb entrées|hash du texte`, stable entre
  cycles et sessions contrairement aux id de sidebar) est stockée dans
  `chrome.storage.local` (`processedKeys`) et vérifiée avant chaque
  téléchargement ; les transcripts déjà traités sont ignorés.
- Persistance au fil de l'eau (survit à l'arrêt du service worker). Bilan de
  fin enrichi : « X nouveau(x), Y déjà traité(s) ».
- Bouton **« Réinitialiser l'historique »** (popup) + message `resetHistory`.

## 0.1.7 — 2026-06-16

- **V2 / filtre « Réunions uniquement »** (extension 2.1.0 → 2.2.0, activé par
  défaut). Signal DOM confirmé par le debug réel : une discussion est une
  réunion ssi elle contient `span.fui-Avatar__icon` (icône générique) **sans**
  `[data-tid="PersonaAvatar"]`. Les chats individuels (PersonaAvatar +
  presence-badge) et de groupe (photo `img`) sont ignorés.
- `frameChats(action, arg, meetingsOnly)` : nouvelle classification
  `isPerson`/`isMeeting`. En mode réunions, ne retient que les réunions ; sinon
  retient personne + groupe + réunion (les réunions étaient auparavant exclues
  car sans `img`). Réglage `meetingsOnly` persistant + toggle popup.

## 0.1.6 — 2026-06-16

- **V2 / diagnostic enrichi** (préparation filtre « réunions uniquement »).
  `frameDumpSidebar.__chatCandidates` détaille désormais chaque discussion
  retenue : `ariaLabel`, `title`, `dataTid`, `hasImg`, `hasSvg`, `hasDateTime`
  et liste d'`icons` (tag/data-tid/aria/title/classe). Objectif : identifier
  l'icône commune aux chats de réunion (signalée par l'utilisateur) pour
  distinguer réunions vs chats individuels/groupe. Filtre à implémenter une
  fois le sélecteur d'icône confirmé.

## 0.1.5 — 2026-06-16

- **V2 / passage en arrière-plan** (manifest extension 2.0.0 → 2.1.0). Toute
  l'orchestration migre dans un **service worker** (`background.js`) :
  - le traitement **continue popup fermée** ;
  - l'onglet Teams ciblé **n'a pas besoin d'être actif** (scripting par `tabId`),
    travail en parallèle possible sur d'autres onglets ;
  - **onglet Teams dédié** ouvert automatiquement (non actif) si absent
    (réutilisé sinon ; oublié à sa fermeture) ;
  - **nombre de discussions paramétrable** (défaut 50, `0` = toutes) ;
  - **bouton Arrêter** (drapeau `stopRequested` vérifié à chaque itération) ;
  - **boucle d'automatisation** : démarrage **immédiat** à l'activation et au
    démarrage du navigateur, puis **pause d'1 min entre deux scans** avant de
    relancer (`chrome.alarms`) ; **Arrêter** annule la prochaine itération ;
    keep-alive du SW pendant les longs scans.
- Téléchargement via **`data:` URL** (le SW n'a pas `URL.createObjectURL`).
- La popup devient une **télécommande** : messages (start/stop/extractManual/
  debug/autoEnabledChanged) au SW + rendu de l'état lu dans `chrome.storage`
  (clé `scanState`), barre de progression, mise à jour live.
- Nouvelles permissions V2 : `tabs`, `alarms`. Workflow release : copie
  conditionnelle de `background.js` dans le zip V2.

## 0.1.4 — 2026-06-16

- **V2 / scan fiabilisé** (2e debug réel). Le bloc Discussions est isolé
  proprement : chats = treeitems feuilles **avec `id` + avatar**, arrêt au 1er
  marqueur de la zone Équipes (« Afficher tous les canaux », « Voir toutes vos
  équipes ») ; canaux (sans avatar) et contrôles (`id` nul) écartés.
- **Clic par `id`** (`getElementById`) au lieu de l'index → robuste aux
  re-rendus / virtualisation.
- **Dépliage « Voir plus »** (`frameClickVoirPlus`, jusqu'à 20 fois) pour charger
  les discussions masquées avant le scan. Plafond porté à 250.
- **Skip rapide** dans `tryExtractCurrent` : si ni récapitulatif ni transcript
  ne sont cliquables, la discussion est ignorée sans attente.
- Décisions utilisateur : périmètre = toutes les discussions (hors canaux) ;
  pas d'étape de confirmation (ouvrir et tester chacune).

## 0.1.3 — 2026-06-16

- **V2 / sélecteurs réels** : exploitation du diagnostic *Debug DOM* fourni par
  l'utilisateur (Teams `teams.microsoft.com/v2/`). La sidebar est un unique
  `[role="tree"]` (`data-tid="simple-collab-dnd-rail"`) de 145
  `[role="treeitem"]` mêlant navigation et discussions. `frameChats` réécrit
  pour cibler `[role="treeitem"]` puis filtrer : visibles, feuilles (sans
  treeitem imbriqué), hors libellés de navigation (Copilot, Mentions, Activité,
  Calendrier… fr/en, badge numérique ignoré). Ajout d'un `scrollIntoView` avant
  clic (listes virtualisées) et de l'`id` dans les résultats.
- Diagnostic enrichi : `frameDumpSidebar` renvoie `__chatCandidates`
  (discussions retenues `kept` avec id/hasImg/label + `excludedAsNav`) pour
  vérifier le filtrage.
- Caveat connu : liste de discussions potentiellement virtualisée (seuls les
  items visibles sont dans le DOM) — à valider sur le prochain debug.

## 0.1.2 — 2026-06-16

- **V2 / diagnostic** : le bouton *Debug DOM* dumpe désormais aussi la structure
  réelle de la sidebar (fonction injectée `frameDumpSidebar`) sous la clé
  `sidebar` du JSON — comptes et échantillons (role, data-tid, id, aria-label,
  classes, texte) pour une série de sélecteurs candidats. Objectif : identifier
  les vrais sélecteurs des éléments de discussion (rendus côté client par React,
  donc absents du `view-source`) et fiabiliser `frameChats`.

## 0.1.1 — 2026-06-16

- **V2** : ajout d'un **switch d'automatisation** (état persistant via
  `chrome.storage.local`, permission `storage` ajoutée). Quand il est actif, la
  V2 **scanne toutes les discussions** de la sidebar Teams (parcours par index)
  et, pour chacune, ouvre le récapitulatif, l'onglet Transcript, extrait et
  télécharge le `.txt` directement dans Téléchargements. Déduplication par
  titre + nombre d'entrées, garde-fou à 50 discussions. Activer le switch lance
  immédiatement le scan ; le bouton « Scanner toutes les discussions » relance.
- Remplacement de l'orchestration single-meeting (`autoDownload`,
  `frameClickMeeting`) par le scan par lot (`autoScanAll`, `frameChats`,
  `tryExtractCurrent`).
- `README.md` mis à jour (switch, scan multi-discussions, permission `storage`).

## 0.1.0 — 2026-06-16

- Nouvelle branche `feature/v2-auto-download` : gestion de **deux versions** du
  plugin côte à côte dans le dépôt.
- Restructuration : les fichiers du plugin V1 (contenu **inchangé**) sont
  déplacés dans `v1/`.
- **V2** (`v2/`) : extension distincte (manifest `2.0.0`) qui ajoute le
  téléchargement automatique des transcripts Teams. En un clic
  (« Télécharger automatiquement »), elle : (1) cherche et ouvre une discussion
  de type *meeting* dans la sidebar, (2) ouvre le récapitulatif de réunion,
  (3) clique sur l'onglet Transcript, (4) extrait (moteur V1) puis télécharge le
  `.txt` directement dans le dossier Téléchargements (`saveAs:false`).
  Le bouton « Extraire manuellement » conserve le comportement V1 en secours.
- Workflow `release.yml` : package désormais **deux** zips
  (`...-v1-<tag>.zip` et `...-v2-<tag>.zip`).
- `README.md` : section *Deux versions*, instructions d'installation/usage par
  version, structure mise à jour, section *Release* adaptée.

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
