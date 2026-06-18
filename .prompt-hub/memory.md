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

## 2026-05-19 14:20 — agent (Claude)

- Action : Tag `v1.0.0` créé et poussé, workflow GitHub Actions exécuté avec
  succès en ~11 s, release publiée avec
  `teams-transcript-downloader-v1.0.0.zip` en asset.
- Outcome : success.

## 2026-05-19 14:25 — agent (Claude)

- Action : Ajout d'une sous-section *Depuis une release GitHub (recommandé)*
  dans la section *Installation* du `README.md`, avec lien vers la page des
  releases du dépôt.
- Fichiers modifiés : `README.md`, `.prompt-hub/version.md` (0.0.2 → 0.0.3),
  `.prompt-hub/releases.md`.
- Outcome : success.
- Next : commit `docs: link to GitHub releases in install instructions` puis
  push.

## 2026-06-16 14:00 — agent (Claude)

- Action : Création de la branche `feature/v2-auto-download` pour gérer deux
  versions du plugin. Déplacement des fichiers V1 (inchangés) dans `v1/`.
  Création de la V2 (`v2/`, manifest 2.0.0) = logique V1 + orchestration de
  navigation automatique dans Teams (sidebar meeting → récapitulatif →
  transcript) + téléchargement direct du `.txt` (`saveAs:false`). Conservation
  d'un bouton d'extraction manuelle de secours. Mise à jour de `release.yml`
  (deux zips v1/v2) et du `README.md`.
- Décisions utilisateur : dossiers v1/v2 séparés ; mode auto + manuel ;
  téléchargement direct dans Téléchargements.
- Fichiers : `v1/*` (déplacés), `v2/manifest.json`, `v2/popup.html`,
  `v2/popup.js`, `v2/popup.css`, `v2/content.js`, `v2/icons/*` (créés),
  `.github/workflows/release.yml`, `README.md`, `.prompt-hub/version.md`
  (0.0.3 → 0.1.0), `.prompt-hub/releases.md`,
  `.prompt-hub/todo/todo-20260616-140000-v2-auto-download.md` (créé).
- Outcome : success (sélecteurs d'automatisation Teams à valider en conditions
  réelles — implémentation défensive avec repli manuel).
- Next : commit `feat: add V2 with automatic transcript download` puis push.

## 2026-06-16 14:30 — agent (Claude)

- Action : V2 — ajout d'un switch d'automatisation (persistant,
  `chrome.storage.local`, permission `storage`). Actif → scan de TOUTES les
  discussions de la sidebar Teams via `frameChats('list'|'click', i)` ;
  pour chacune, `tryExtractCurrent` ouvre recap + transcript, extrait et
  télécharge le `.txt` (`saveAs:false`). Déduplication titre+nb entrées,
  plafond 50. Remplacement de `autoDownload`/`frameClickMeeting` par
  `autoScanAll`. Activer le switch lance le scan immédiatement.
- Fichiers : `v2/popup.html`, `v2/popup.css`, `v2/popup.js`,
  `v2/manifest.json` (+ permission storage), `README.md`,
  `.prompt-hub/version.md` (0.1.0 → 0.1.1), `.prompt-hub/releases.md`.
- Validation : `node --check` OK, manifest JSON valide, pas de réf morte.
- Outcome : success (sélecteurs Teams toujours à valider en réel).
- Next : commit `feat(v2): add automation switch to scan all chats` puis push.

## 2026-06-16 14:45 — agent (Claude)

- Action : L'utilisateur a fourni un "code source" de page Teams = en fait le
  shell HTML d'amorçage (React + bundle lodash), pas la sidebar rendue. Noms de
  réunions cités : "Pierre-Ben", "FF #2 Soheir", "Bi-weekly AI F..." → les
  discussions meeting n'ont PAS de mot-clé dans leur nom, ce qui valide le choix
  du scan-all sans filtre. Ajout d'un diagnostic `frameDumpSidebar` injecté,
  intégré au rapport *Debug DOM* (clé `sidebar`), pour récupérer les vrais
  sélecteurs DOM et fiabiliser `frameChats`.
- Fichiers : `v2/popup.js`, `.prompt-hub/version.md` (0.1.1 → 0.1.2),
  `.prompt-hub/releases.md`.
- Outcome : success. EN ATTENTE du JSON de debug (section `sidebar`) de
  l'utilisateur pour verrouiller les sélecteurs de la liste de discussions.
- Next : commit `chore(v2): dump sidebar structure in Debug DOM` puis push.

## 2026-06-16 15:10 — agent (Claude)

- Action : Debug DOM reçu (Teams v2, tenant Michelin). Faits clés : sidebar =
  1 seul `[role="tree"]` data-tid `simple-collab-dnd-rail`, 145
  `[role="treeitem"]` (classe `fui-TreeItem`) mêlant nav + discussions ; aucun
  `data-tid="chat-list"`/`chatListContainer`/`role=listitem`. Transcripts
  probablement dans les iframes outlook.office.com (semanticoverview) /
  michelingroup-my.sharepoint.com (embed) → couvertes par <all_urls>.
  → `frameChats` réécrit : `[role="treeitem"]` filtré (visibles, feuilles,
  hors NAV_LABELS fr/en). `scrollIntoView` avant clic. Diagnostic enrichi
  (`__chatCandidates`).
- Fichiers : `v2/popup.js`, `.prompt-hub/version.md` (0.1.2 → 0.1.3),
  `.prompt-hub/releases.md`.
- Outcome : success. Caveat virtualisation à valider. EN ATTENTE d'un nouveau
  Debug DOM (section `__chatCandidates`) pour confirmer le filtrage.
- Next : commit `fix(v2): target real Teams sidebar treeitems, filter nav`
  puis push.

## 2026-06-16 15:40 — agent (Claude)

- Action : 2e Debug DOM reçu (`__chatCandidates`). Filtrage confirmé. Faits :
  chats = feuilles avec `id` (menur…) + avatar (hasImg true) ; zone Équipes
  commence après "Voir plus66" (items sans avatar / `id` nul) ; contrôles
  "Voir plus", "Afficher tous les canaux", "Voir toutes vos équipes" = `id`
  null. → `frameChats` réécrit : collecte id+avatar, break aux marqueurs
  Équipes ; **clic par id** (getElementById). Ajout `frameClickVoirPlus` +
  `expandChatList` (déplie jusqu'à 20×) pour charger les ~66 discussions
  masquées. Plafond 250. `tryExtractCurrent` : skip rapide si ni récap ni
  transcript.
- Décisions utilisateur : toutes les discussions (hors canaux) ; ouvrir et
  tester chacune (pas de confirmation).
- Fichiers : `v2/popup.js`, `README.md`, `.prompt-hub/version.md`
  (0.1.3 → 0.1.4), `.prompt-hub/releases.md`.
- Outcome : success. À valider en réel (ouverture récap/transcript par chat,
  durée du scan complet).
- Next : commit `feat(v2): expand chat list, click by id, scan all chats`
  puis push.

## 2026-06-16 16:00 — utilisateur + agent (Claude)

- Action : Validation utilisateur — « ça fonctionne ». La V2 (scan automatique
  de toutes les discussions, dépliage "Voir plus", clic par id, ouverture
  récap→transcript, téléchargement .txt direct) fonctionne en conditions
  réelles sur le tenant Teams v2 (michelingroup). Les libellés d'onglets
  (« Récapitulatif »/« Transcription ») et le filtrage sidebar n'ont pas
  nécessité d'ajustement supplémentaire.
- Outcome : success — feature V2 livrée et validée.
- Next : aucune action en attente. Branche `feature/v2-auto-download` prête à
  être mergée (V1 inchangée dans v1/, V2 dans v2/).

## 2026-06-16 16:30 — agent (Claude)

- Action : V2 refonte arrière-plan. Service worker `background.js` (toute
  l'orchestration) ; popup = télécommande (messages + rendu de `scanState`).
  Onglet Teams ciblé sans focus (scripting par tabId) ; traitement popup
  fermée ; onglet Teams dédié auto (perms `tabs`,`alarms`) ; nb discussions
  paramétrable (défaut 50, 0=toutes) ; bouton Arrêter (`stopRequested`) ;
  download via data: URL (pas de Blob en SW). Manifest 2.0.0 → 2.1.0.
  Boucle d'automatisation : précision utilisateur → démarrage IMMÉDIAT à
  l'activation/au démarrage navigateur, pause 1 min ENTRE deux scans
  (re-scan en boucle). Stop annule la prochaine itération.
- Fichiers : `v2/background.js` (créé), `v2/popup.{html,js,css}`,
  `v2/manifest.json`, `.github/workflows/release.yml`, `README.md`,
  `.prompt-hub/version.md` (0.1.4 → 0.1.5), `.prompt-hub/releases.md`.
- Validation : `node --check` OK (background, popup), manifest JSON valide.
- Outcome : success. À valider en réel (SW longévité sur scan 50, boucle,
  onglet dédié, arrêt).
- Next : commit `feat(v2): background service worker, loop, stop, settings`
  puis push.

## 2026-06-16 16:50 — agent (Claude)

- Action : Demande utilisateur — scanner UNIQUEMENT les discussions de réunion
  (pas les chats individuels/groupe). Indice utilisateur clé : « les meetings
  ont tous la même icône ». → Diagnostic `frameDumpSidebar.__chatCandidates`
  enrichi (ariaLabel/title/dataTid/hasImg/hasSvg/hasDateTime + liste icons avec
  data-tid/classe) pour identifier l'icône commune aux réunions.
- Fichiers : `v2/background.js`, `.prompt-hub/version.md` (0.1.5 → 0.1.6),
  `.prompt-hub/releases.md`.
- Outcome : success. EN ATTENTE d'un nouveau Debug DOM (`__chatCandidates`)
  pour repérer le sélecteur d'icône réunion, puis implémenter le filtre +
  toggle « Réunions uniquement ».
- Next : commit `chore(v2): enrich chat diagnostic to find meeting icon` puis
  push.

## 2026-06-16 17:15 — agent (Claude)

- Action : Debug DOM reçu → signal réunion identifié. Classification sidebar
  Teams v2 : personne 1:1 = `[data-tid="PersonaAvatar"]` (+ `presence-badge`) ;
  groupe = photo `<img>` sans svg ; réunion = `span.fui-Avatar__icon` (svg)
  SANS PersonaAvatar ; équipe/canal = `fui-Icon-filled/regular`. → Filtre
  « Réunions uniquement » (`meetingsOnly`, défaut ON) dans
  `frameChats(action,arg,meetingsOnly)` via `isPerson`/`isMeeting`. NB : les
  réunions (sans `img`) étaient auparavant exclues du scan-all → corrigé.
  Toggle popup + réglage persistant. Extension 2.1.0 → 2.2.0.
- Fichiers : `v2/background.js`, `v2/popup.{html,js}`, `v2/manifest.json`,
  `.prompt-hub/version.md` (0.1.6 → 0.1.7), `.prompt-hub/releases.md`.
- Validation : `node --check` OK. À valider en réel (que `kept` réunions =
  FF #2 Soheir, Bi-weekly AI F, G5 Weekly… et exclut personnes/groupes).
- Next : commit `feat(v2): meetings-only filter via avatar icon signal` puis
  push.

## 2026-06-16 17:35 — agent (Claude)

- Action : Question utilisateur — gestion des réunions déjà traitées. Constat :
  dédup uniquement intra-scan → la boucle re-téléchargeait tout. Ajout d'un
  historique persistant `processedKeys` (chrome.storage.local), clé = signature
  de CONTENU `titre|nbEntrées|hash(texte)` (stable entre sessions, contrairement
  aux id sidebar). Vérifiée avant download, persistée au fil de l'eau. Bilan
  « X nouveau(x), Y déjà traité(s) ». Bouton popup « Réinitialiser l'historique »
  + message `resetHistory`. Extension 2.2.0 → 2.3.0.
- Fichiers : `v2/background.js`, `v2/popup.{html,js}`, `v2/manifest.json`,
  `.prompt-hub/version.md` (0.1.7 → 0.1.8), `.prompt-hub/releases.md`,
  `README.md`.
- Validation : `node --check` OK.
- Next : commit `feat(v2): persist processed transcripts to skip re-downloads`
  puis push.

## 2026-06-16 17:55 — agent (Claude)

- Action : Bug rapporté — scan réunions OK mais aucun téléchargement
  (tryExtractCurrent renvoie null → recap/transcription en arrière-plan non
  trouvés/non chargés). Instrumentation : `lastDiag` (recap/transcript
  cliqués ?, libellés, bestScore) affiché dans le bilan si 0 download ;
  mots-clés transcript élargis + délais 3,5 s ; bouton « Debug réunion »
  (`debugMeeting`) qui ouvre la 1re réunion, tente récap→transcription et dumpe
  frames + libellés cliquables (`frameListClickables`) → teams-meeting-debug.json.
  Extension 2.3.0 → 2.3.1.
- Fichiers : `v2/background.js`, `v2/popup.{html,js}`, `v2/manifest.json`,
  `.prompt-hub/version.md` (0.1.8 → 0.1.9), `.prompt-hub/releases.md`.
- Outcome : success (diagnostic). EN ATTENTE de teams-meeting-debug.json pour
  identifier les onglets récap/transcription et fiabiliser l'extraction.
  Hypothèse à vérifier : iframe recap non chargée en onglet inactif.
- Next : commit `chore(v2): diagnose meeting recap/transcript extraction` puis
  push.

## 2026-06-16 18:30 — agent (Claude)

- Action : `teams-meeting-debug.json` analysé. CAUSE du non-téléchargement : à
  l'ouverture d'une réunion, le transcript est déjà chargé dans l'iframe
  SharePoint `xplatplugins…hv=Recap` (ListCell, timeCount 244) ; nos clics texte
  « récapitulatif »/« transcript » DÉTRUISAIENT cette iframe (afterTranscript :
  frame recap disparue, retour sur la conversation). Onglet inactif PAS en
  cause. Tids stables découverts : `tab-item-com.microsoft.chattabs.recap` et
  sous-onglet `Transcript`.
  → `tryExtractCurrent` : extraction DIRECTE d'abord (seuil 30), repli clics par
  `data-tid` (`frameClickTid`) ; délai post-ouverture 4 s.
  Demandes utilisateur traitées : auto OFF par défaut (déjà), intervalle
  paramétrable `intervalMin` (défaut 5), compte à rebours popup (`nextRunAt`),
  bilan de fin « X téléchargés / Y ignorés / Z sans transcript ». Extension
  2.3.1 → 2.4.0.
- Fichiers : `v2/background.js`, `v2/popup.{html,js}`, `v2/manifest.json`,
  `README.md`, `.prompt-hub/version.md` (0.1.9 → 0.1.10), `.prompt-hub/releases.md`.
- Validation : `node --check` OK.
- Outcome : success. À valider en réel (téléchargement effectif des transcripts,
  compte à rebours, bilan).
- Next : commit `fix(v2): extract transcript from recap iframe; settings/UX`
  puis push.

## 2026-06-16 18:50 — agent (Claude)

- Action : Bug — fichier transcript incomplet (« trop rapide »). Cause : liste
  virtualisée + ancien scroll s'arrêtant trop tôt / early-return si conteneur
  non scrollable. → `frameFullExtract` réécrit : `scrollableAncestor` (vrai
  élément overflow), défilement par paliers (~0.8×clientHeight), attente 600 ms,
  arrêt seulement si entrées STABLES (8×) ET en bas (max 800 paliers).
  Extension 2.4.0 → 2.4.1.
- Fichiers : `v2/background.js`, `v2/manifest.json`,
  `.prompt-hub/version.md` (0.1.10 → 0.1.11), `.prompt-hub/releases.md`.
- Validation : `node --check` OK. À valider en réel (transcript complet).
- Next : commit `fix(v2): scroll virtualized transcript fully to avoid truncation`
  puis push.

## 2026-06-16 19:05 — agent (Claude)

- Action : Bug — bilan de fin invisible. Cause : `scheduleNextRun` (idle +
  compte à rebours) écrasait le message 'done' aussitôt. → bloc « Bilan du
  dernier scan » dédié et persistant dans la popup, alimenté par
  `scanState.summary` (init à null au début du scan, conservé pendant la pause ;
  ajouté aussi au phase 'stopped'). Champs : downloaded/skipped/noTranscript/
  total + finishedAt. Extension 2.4.1 → 2.4.2.
- Fichiers : `v2/background.js`, `v2/popup.{html,js,css}`, `v2/manifest.json`,
  `.prompt-hub/version.md` (0.1.11 → 0.1.12), `.prompt-hub/releases.md`.
- Validation : `node --check` OK.
- Next : commit `feat(v2): persistent end-of-scan summary panel` puis push.

## 2026-06-16 21:39 — agent (Claude)

- Action : Correction du switch « Automatisation » qui restait visuellement ON
  quand le service worker désactivait `autoEnabled` (clic sur « Arrêter »). Le
  listener `storage.onChanged` de `popup.js` met à jour désormais
  `autoSwitch.checked` en temps réel sur changement de la clé `autoEnabled`.
- Fichiers modifiés : `v2/popup.js`, `.prompt-hub/version.md` (0.1.18 → 0.1.19),
  `.prompt-hub/releases.md`, `.prompt-hub/todo/todo-20260616-213935-fix-auto-switch-visual-state.md`.
- Validation : `node --check v2/popup.js` + `v2/background.js` OK ; manifest JSON valide.
- Outcome : success.
- Next : commit `fix(v2): sync auto switch visual state from storage` puis push.

## 2026-06-16 21:26 — agent (Claude)

- Action : Le bouton « Arrêter » désactive désormais aussi l’automatisation
  (`autoEnabled: false` dans `chrome.storage.local`) pour éviter qu’un scan ne
  redémarre automatiquement après un arrêt manuel.
- Fichiers modifiés : `v2/background.js` (handler `stop`),
  `.prompt-hub/version.md` (0.1.17 → 0.1.18), `.prompt-hub/releases.md`,
  `.prompt-hub/todo/todo-20260616-212633-stop-disables-auto.md`.
- Validation : `node --check v2/background.js` + `v2/popup.js` OK ; manifest JSON valide.
- Outcome : success.
- Next : commit `feat(v2): stop button also disables automation` puis push.

## 2026-06-16 21:23 — agent (Claude)

- Action : Suppression du bouton « Scanner maintenant » dans la popup V2,
  redondant avec le switch d’automatisation.
- Fichiers modifiés : `v2/popup.html` (bouton retiré), `v2/popup.js`
  (référence et listener retirés), `.prompt-hub/version.md` (0.1.16 → 0.1.17),
  `.prompt-hub/releases.md`, `.prompt-hub/todo/todo-20260616-212320-remove-scan-now-button.md`.
- Validation : `node --check v2/popup.js` + `v2/background.js` OK ; manifest JSON valide.
- Outcome : success.
- Next : commit `feat(v2): remove redundant scan-now button` puis push.

## 2026-06-16 20:52 — agent (Claude)

- Action : Correction du retour à l’état de base quand l’utilisateur clique sur
  « Arrêter » pendant un scan. L’état idle est désormais forcé immédiatement
  dans le service worker (`resetToIdleState`) au lieu d’attendre la fin de
  l’opération en cours.
- Fichiers modifiés : `v2/background.js` (`resetToIdleState`, handler `stop`),
  `.prompt-hub/version.md` (0.1.15 → 0.1.16), `.prompt-hub/releases.md`,
  `.prompt-hub/todo/todo-20260616-205200-stop-back-to-idle.md`.
- Validation : `node --check v2/background.js` + `v2/popup.js` OK ; manifest JSON valide.
- Outcome : success.
- Next : commit `feat(v2): reset to idle state immediately on stop` puis push.

## 2026-06-16 20:47 — agent (Claude)

- Action : Masquage des boutons de debug « Debug DOM » et « Debug réunion » dans
  la popup V2 (conservés dans le DOM pour réactivation ultérieure).
- Fichiers modifiés : `v2/popup.html`, `.prompt-hub/version.md` (0.1.14 → 0.1.15),
  `.prompt-hub/releases.md`, `.prompt-hub/todo/todo-20260616-204741-hide-debug-buttons.md`.
- Validation : vérification visuelle du HTML ; aucun JS impacté.
- Outcome : success.
- Next : commit `feat(v2): hide debug buttons in popup` puis push.

## 2026-06-16 20:42 — agent (Claude)

- Action : Adaptation du libellé sous le switch « Automatisation » pour refléter
  la durée paramétrée `intervalMin` au lieu d’afficher statiquement « 1 min ».
- Fichiers modifiés : `v2/popup.html` (`id="auto-desc"`), `v2/popup.js`
  (`updateAutoDesc`), `.prompt-hub/version.md` (0.1.13 → 0.1.14),
  `.prompt-hub/releases.md`, `.prompt-hub/todo/todo-20260616-204230-dynamic-interval-label.md`.
- Validation : `node --check v2/popup.js` + `v2/background.js` OK ; manifest JSON valide.
- Outcome : success.
- Next : commit `feat(v2): dynamic automation label from intervalMin` puis push.

## 2026-06-16 19:25 — agent (Claude)

- Action : Retours visuels. (1) Loader spinner popup pendant `running`.
  (2) Pas de convertisseur SVG sur la machine (rsvg/convert/inkscape absents,
  sips raster only) → icône dessinée à la volée dans le SW via OffscreenCanvas
  + `chrome.action.setIcon` (doc à lignes, fond violet, 16/32/48/128).
  (3) Pastille `chrome.action.setBadgeText` : ● violet en cours, ● vert actif,
  ■ rouge arrêté, vide si auto OFF ; `updateActionUI` appelé dans `setState` +
  sur autoEnabledChanged + init SW. Extension 2.4.2 → 2.5.0.
- Fichiers : `v2/background.js`, `v2/popup.{html,js,css}`, `v2/manifest.json`,
  `README.md`, `.prompt-hub/version.md` (0.1.12 → 0.1.13), `.prompt-hub/releases.md`.
- Validation : `node --check` OK.
- Next : commit `feat(v2): loader, runtime icon, status badge` puis push.

## 2026-06-16 22:05 — agent (Claude)

- Action : Revue de cohérence des évènements V2 + correction des 3 problèmes
  signalés. (1) Compte à rebours invisible entre scans : `scheduleNextRun()`
  déplacé dans un point de sortie unique (`finally`) → replanifié quelle que soit
  l'issue tant que l'automatisation est active. (2) Ré-activation sans relance :
  drapeau `pendingAutoStart` qui relance dès la fin du scan moribond. (3) Scan qui
  continue côté Teams après Stop : flag `window.__ttdAbort` lu par la boucle de
  défilement de `frameFullExtract` + `sleepCancellable`. Remplacement du booléen
  `stopRequested` par un compteur de génération `scanGen` (un scan invalidé sort
  sans écrire d'état → n'écrase plus l'état idle).
- Fichiers modifiés : `v2/background.js`, `.prompt-hub/version.md` (0.1.19 →
  0.1.20), `.prompt-hub/releases.md`,
  `.prompt-hub/todo/todo-20260616-220000-v2-event-coherence.md`.
- Validation : `node --check v2/background.js` + `v2/popup.js` OK ; manifest JSON
  valide. Pas de test navigateur exécuté (environnement CLI).
- Outcome : success.
- Next : commit `fix(v2): coherent stop/auto-loop semantics` puis push.

## 2026-06-18 — agent (Claude)

- Action : Réunions récurrentes — sélection de l'occurrence la plus récente avant
  extraction. Le récap affiche un dropdown
  `data-testid="intelligent-recap-instance-select-dropdown"`. Ajout de
  `frameSelectLatestInstance` (ouvre le dropdown, parse les dates FR des options
  `[role="option"]`, choisit l'occurrence passée la plus récente : t<=now sinon
  date max sinon 1re option) + helper `selectLatestInstanceAcrossFrames` (balaie
  les frames). Appelé dans `tryExtractCurrent` avant la tentative directe, re-tenté
  après ouverture du récap. No-op si pas de sélecteur (réunion simple).
- Fichiers modifiés : `v2/background.js`, `.prompt-hub/version.md` (0.1.20 →
  0.1.21), `.prompt-hub/releases.md`.
- Validation : `node --check v2/background.js` OK. Pas de test navigateur.
- Limite connue : si la liste d'instances est virtualisée (longue série), seules
  les options rendues sont lues ; la plus récente est généralement en haut donc OK.
- Outcome : success.
- Next : commit `feat(v2): pick latest instance for recurring meetings` puis push.

## 2026-06-18 (2) — agent (Claude)

- Action : Correction du « décrochage » du scroll pendant l'extraction. La boucle
  de `frameFullExtract` pilotait `scrollTop += step` ; la liste virtualisée
  (.ms-List) remet scrollTop à 0 lors des recalculs de hauteur → on repartait du
  haut en boucle. Remplacé par un ancrage sur la dernière cellule rendue
  (`scrollIntoView({block:'end'})`), auto-correctif, avec repli relatif si aucune
  cellule. Arrêt sur stabilité du nombre d'entrées (stable>=8) ; max 800→400 iters.
- Fichiers modifiés : `v2/background.js`, `.prompt-hub/version.md` (0.1.21 →
  0.1.22), `.prompt-hub/releases.md`.
- Validation : `node --check v2/background.js` OK. Pas de test navigateur.
- Outcome : success.
- Next : commit `fix(v2): robust scroll for virtualized transcript list` puis push.

## 2026-06-18 (3) — agent (Claude)

- Action : Création de la V3 (branche feature/v3-side-panel, dossier v3/ copié de
  v2/). Deux ajouts par rapport à V2 : (1) UI en panneau latéral chrome.sidePanel
  (clic icône → panneau à droite, comme Claude) au lieu du popup ; popup.* →
  panel.* (largeur fluide), manifest avec side_panel.default_path + perm sidePanel
  + action sans default_popup ; setPanelBehavior({openPanelOnActionClick:true}).
  (2) Voile gris semi-transparent EN PERMANENCE sur l'onglet Teams dédié : injecté
  frame 0 via chrome.scripting (pageApplyOverlay, idempotent + MutationObserver),
  bloque clic/clavier/scroll utilisateur, réinjecté via tabs.onUpdated et au réveil
  du SW. Les actions automatisées (.click/scrollTop) ne sont pas bloquées.
  Décisions utilisateur : voile permanent sur onglet dédié ; panneau latéral seul.
- Fichiers : v3/* (nouveau module), README.md, .prompt-hub/version.md (0.1.22 →
  0.2.0, nouvelle branche), .prompt-hub/releases.md, todo dédié.
- Validation : node --check background/panel/content OK ; manifest JSON OK. Pas de
  test navigateur (CLI).
- Limite : hideOverlay défini mais jamais appelé (voile voulu permanent) ;
  sidePanel requiert Chrome >= 114.
- Outcome : success.
- Next : commit `feat(v3): side panel UI + permanent overlay on dedicated tab` + push.

## 2026-06-18 (4) — agent (Claude)

- Action : V3 — panneau ciblé sur une fenêtre Teams dédiée. Le clic sur l'icône
  (chrome.action.onClicked) ouvre une fenêtre dédiée (chrome.windows.create) ou la
  refocalise, puis attache le panneau via sidePanel.open({windowId}). Panneau activé
  par onglet uniquement (sidePanel.setOptions enabled:true) ; side_panel.default_path
  retiré du manifest → aucun autre onglet n'a de panneau. openPanelOnActionClick=false.
  ensureTeamsTab ne réutilise plus les onglets Teams de l'utilisateur (crée toujours
  une fenêtre dédiée). Nettoyage dedicatedTabId/dedicatedWindowId via tabs.onRemoved
  + windows.onRemoved.
- Fichiers : v3/background.js, v3/manifest.json (3.0.0→3.0.1, retrait side_panel),
  README.md, .prompt-hub/version.md (0.2.0→0.2.1), releases.md.
- Validation : node --check background OK, manifest JSON OK. Pas de test navigateur.
- Limite : sidePanel.open() après await windows.create peut perdre le geste
  utilisateur dans certains cas → fallback : panneau reste activé, ouverture manuelle.
- Outcome : success.
- Next : commit `feat(v3): dedicated Teams window with attached side panel` + push.

## 2026-06-18 (5) — agent (Claude)

- Action : Correctif V3 — le panneau latéral ne s'affichait pas. Cause :
  chrome.sidePanel.open() exige un geste utilisateur, appelé après trop d'await
  (ensureTeamsTab complet + storage + windows.update) → geste expiré. Handler
  action.onClicked resserré : fenêtre dédiée existante → windows.get (1 await) puis
  open() ; sinon windows.create puis open(). enablePanelForTab/focus/overlay en
  fire-and-forget après open().
- Fichiers : v3/background.js, v3/manifest.json (3.0.1→3.0.2),
  .prompt-hub/version.md (0.2.1→0.2.2), releases.md.
- Validation : node --check OK. Pas de test navigateur.
- Limite : 1er clic (windows.create) peut expirer le geste → 2e clic affiche le
  panneau (fenêtre alors déjà ouverte). À confirmer en réel par l'utilisateur.
- Outcome : success (en attente de validation navigateur).
- Next : commit `fix(v3): open side panel within user gesture` + push.
