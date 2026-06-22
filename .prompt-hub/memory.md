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

## 2026-06-18 (6) — agent (Claude)

- Action : V3 — le panneau ne s'affichait JAMAIS. Cause : en SW MV3,
  chrome.sidePanel.open() échoue dès qu'un await le précède (geste expiré), et sans
  default_path il n'a pas de contenu. Fix : (1) side_panel.default_path rétabli ;
  (2) action.onClicked rendu NON-async, open() appelé en premier de façon SYNCHRONE,
  ciblant dedicatedWindowId si connu (gardé en mémoire du SW via setDedicated +
  réhydraté au démarrage), sinon tab.windowId courant ; le reste (ensureTeamsTab,
  voile, focus) en async après. Compromis assumé : default_path rend le panneau
  disponible globalement et le 1er clic l'affiche sur la fenêtre courante ; la
  restriction stricte "uniquement Teams" est incompatible avec un open() synchrone
  fiable.
- Fichiers : v3/background.js (vars module dedicatedTabId/WindowId + setDedicated/
  clearDedicated + réhydratation), v3/manifest.json (3.0.2→3.0.3, +default_path),
  README.md, .prompt-hub/version.md (0.2.2→0.2.3), releases.md.
- Validation : node --check OK, manifest JSON OK. À TESTER en navigateur par l'user.
- Leçon : sidePanel.open() doit être appelé sync (sans await) dans le gesture ;
  garder les id en mémoire du SW pour cibler une fenêtre sans storage.get préalable.
- Outcome : success (en attente validation navigateur).
- Next : commit `fix(v3): open side panel synchronously so it actually shows` + push.

## 2026-06-18 (7) — agent (Claude)

- Action : V3 — le panneau s'ouvrait sur la fenêtre courante (fenêtre 1) au 1er
  clic. Correctif : action.onClicked ne cible JAMAIS tab.windowId ; uniquement
  dedicatedWindowId (sync si connu, sinon ensureTeamsTab crée la fenêtre puis
  tentative d'open() dessus). Si le geste expire après windows.create, un clic
  depuis la fenêtre Teams affiche le panneau (id alors connu). Comportement validé
  par l'utilisateur pour les clics dans la fenêtre 2.
- Fichiers : v3/background.js, v3/manifest.json (3.0.3→3.0.4),
  .prompt-hub/version.md (0.2.3→0.2.4), releases.md.
- Validation : node --check OK. À retester en navigateur.
- Outcome : success (attente validation).
- Next : commit `fix(v3): only attach side panel to the dedicated Teams window` + push.

## 2026-06-18 (8) — agent (Claude)

- Action : V3 — tentative d'ouverture auto du panneau sur la fenêtre dédiée au 1er
  clic. open() appelé immédiatement après windows.create (1 seul await → meilleure
  chance de garder le geste) + retry différé 500ms (demande user). Caveat noté :
  sidePanel.open() exige un geste utilisateur ; l'appel différé (setTimeout) sera
  probablement refusé par Chrome → fallback = clic depuis la fenêtre Teams.
- Fichiers : v3/background.js, v3/manifest.json (3.0.4→3.0.5),
  .prompt-hub/version.md (0.2.4→0.2.5), releases.md.
- Validation : node --check OK. À tester en navigateur.
- Leçon clé : un setTimeout avant sidePanel.open() casse le geste utilisateur ;
  ce n'est pas un problème de timing mais de gesture. Ne pas promettre que l'appel
  différé fonctionnera.
- Outcome : success (attente validation).
- Next : commit `feat(v3): attempt panel open on dedicated window (immediate + 0.5s)` + push.

## 2026-06-18 (9) — agent (Claude)

- Action : V3 — refonte du panneau en modèle "comme Claude" (side panel par site).
  Plus de fenêtre dédiée. setPanelBehavior openPanelOnActionClick:true (Chrome gère
  le geste → ouverture fiable au clic). syncSidePanel + tabs.onActivated/onUpdated +
  syncAllTabs : panneau activé sur onglets Teams, désactivé ailleurs → disparaît au
  changement d'onglet. Suppression de action.onClicked, windows.create,
  dedicatedWindowId. ensureTeamsTab revient à un onglet (réutilise/crée). Voile
  conservé sur l'onglet piloté.
- Fichiers : v3/background.js, v3/manifest.json (3.0.5→3.0.6), README.md,
  .prompt-hub/version.md (0.2.5→0.2.6), releases.md.
- Validation : node --check OK, manifest JSON OK. À tester en navigateur.
- Leçon : pour un side panel fiable, utiliser openPanelOnActionClick:true (Chrome
  gère le geste) + setOptions par onglet ; ne PAS appeler sidePanel.open() après
  des await. Limite : clic sur un onglet non-Teams n'ouvre rien (panneau désactivé).
- Outcome : success (attente validation).
- Next : commit `feat(v3): Claude-like per-tab side panel (no dedicated window)` + push.

## 2026-06-18 (10) — agent (Claude)

- Action : V3 — le panneau ne disparaissait pas au changement d'onglet. Cause :
  side_panel.default_path gardait le panneau activé globalement → setOptions
  enabled:false par onglet ne le fermait pas. Fix : retrait de default_path du
  manifest. Sans défaut global, seuls les onglets Teams activés par syncSidePanel
  ont le panneau → disparaît sur les autres onglets. openPanelOnActionClick + chemin
  par onglet suffisent pour l'ouverture au clic.
- Fichiers : v3/manifest.json (3.0.6→3.0.7, retrait side_panel),
  .prompt-hub/version.md (0.2.6→0.2.7), releases.md.
- Validation : manifest JSON OK. À tester en navigateur.
- Leçon : pour "disparaît au changement d'onglet", NE PAS mettre de
  side_panel.default_path (sinon panneau global persistant) ; tout piloter par
  setOptions par onglet.
- Outcome : success (attente validation).
- Next : commit `fix(v3): remove default_path so panel hides on tab switch` + push.

## 2026-06-18 (11) — agent (Claude)

- Action : V3 — le clic doit ouvrir un nouvel onglet Teams + attacher la sidebar.
  Retour à action.onClicked (openPanelOnActionClick:false). Clic : open() synchrone
  sur l'onglet piloté si dedicatedTabId connu (geste préservé) ; sinon ensureTeamsTab
  crée un NOUVEL onglet Teams (ne détourne plus un onglet Teams existant), l'active,
  tente open(). ensureTeamsTab active le panneau de l'onglet (setOptions enabled+path,
  requis sans default_path). syncSidePanel conservé pour disparition au changement
  d'onglet.
- Fichiers : v3/background.js, v3/manifest.json (3.0.7→3.0.8), README.md,
  .prompt-hub/version.md (0.2.7→0.2.8), releases.md.
- Validation : node --check OK. À tester.
- Limite : 1er clic peut nécessiter un 2e clic (geste expiré après tabs.create) ;
  ensuite ouverture synchrone fiable.
- Outcome : success (attente validation).
- Next : commit `feat(v3): click opens a dedicated Teams tab and attaches the panel` + push.

## 2026-06-18 (12) — agent (Claude)

- Action : V3 — choix utilisateur : garder 2 clics (limite geste Chrome) + ajouter
  un guide visuel sur le voile. Le voile affiche une carte près du coin haut-droit
  (« 👉 Cliquez à nouveau sur l'icône… pour ouvrir le panneau et configurer/lancer »)
  + flèche « ⬆ Icône de l'extension ». Guide masqué à l'ouverture du panneau :
  panel.js envoie 'panelReady' → SW exécute pageHideOverlayGuide sur l'onglet piloté
  (le voile reste). guide id=__ttd_overlay_guide__.
- Fichiers : v3/background.js (pageApplyOverlay + pageHideOverlayGuide +
  hideOverlayGuide + case panelReady), v3/panel.js (send panelReady),
  v3/manifest.json (3.0.8→3.0.9), .prompt-hub/version.md (0.2.8→0.2.9), releases.md.
- Validation : node --check background + panel OK. À tester en navigateur.
- Outcome : success (attente validation).
- Next : commit `feat(v3): on-overlay guide to click the icon again` + push.

## 2026-06-18 (13) — agent (Claude)

- Action : V3 — voile gris piloté par l'automatisation. Voile BLOQUANT seulement si
  autoEnabled ON ; OFF → retiré (navigation Teams manuelle). refreshOverlay(tabId)
  (lit autoEnabled → show/hideOverlay) appelé sur autoEnabledChanged, stop, création/
  reuse/reload d'onglet, init SW. Guide « cliquez à nouveau » SÉPARÉ du voile :
  pageApplyGuide/pageRemoveGuide (pointer-events:none, non bloquant), affiché à la
  création quand auto OFF, masqué à l'ouverture du panneau (panelReady → hideGuide).
  ensureTeamsTab create : si auto ON → showOverlay sinon showGuide (exclusif).
- Fichiers : v3/background.js, v3/manifest.json (3.0.9→3.0.10), README.md,
  .prompt-hub/version.md (0.2.9→0.2.10), releases.md.
- Validation : node --check OK. À tester.
- Outcome : success (attente validation).
- Next : commit `feat(v3): overlay follows automation state; separate non-blocking guide` + push.

## 2026-06-18 (14) — agent (Claude)

- Action : V3 — le guide ne s'affichait pas au chargement de l'onglet. Cause :
  showGuide/showOverlay appelés juste après chrome.tabs.create (onglet en cours de
  navigation about:blank→Teams) → injection effacée. Fix : appliquer l'habillage
  dans chrome.tabs.onUpdated (status complete) pour l'onglet piloté — auto ON →
  showOverlay+hideGuide ; OFF → hideOverlay+showGuide. Retrait des appels prématurés
  dans la branche création de ensureTeamsTab.
- Fichiers : v3/background.js, v3/manifest.json (3.0.10→3.0.11),
  .prompt-hub/version.md (0.2.10→0.2.11), releases.md.
- Validation : node --check OK. À tester.
- Leçon : ne pas injecter le voile/guide sur un onglet juste créé (encore en
  navigation) ; attendre onUpdated 'complete'.
- Outcome : success (attente validation).
- Next : commit `fix(v3): apply overlay/guide on tab load (onUpdated complete)` + push.

## 2026-06-18 (15) — agent (Claude)

- Action : CI release.yml — le build ne couvrait que v1/v2 et copiait popup.* en dur
  (absents de v3). Réécrit : boucle sur v1 v2 v3, cp -R du dossier complet (agnostique
  aux noms popup.*/panel.* + background.js optionnel), un zip par version, tous publiés
  en assets via action-gh-release (sortie multiligne `zips`). README mis à jour.
  Merge de feature/v3-side-panel dans main.
- Fichiers : .github/workflows/release.yml, README.md, .prompt-hub/version.md
  (0.2.11→0.2.12), releases.md.
- Validation : structure YAML OK (pas de linter local). À confirmer au prochain tag.
- Outcome : success.
- Next : commit + merge main + push.

## 2026-06-18 (16) — agent (Claude)

- Action : V2 & V3 — déduplication re-téléchargeait le même transcript. Cause : clé
  titre|nbEntrées|hash(corps entier) fragile (fin tronquée variable selon défilement,
  titre basculant vers "Meeting Transcript"). Nouvelle transcriptKey = empreinte des
  20 PREMIÈRES entrées (locuteur + normMsg(message) tronqué 80c), titre + total
  ignorés (le début est extrait de façon fiable car on part du haut). Ajout normMsg.
  Appliqué à v2 ET v3.
- Fichiers : v2/background.js, v3/background.js, v2/manifest.json (2.5.0→2.5.1),
  v3/manifest.json (3.0.11→3.0.12), .prompt-hub/version.md (0.2.12→0.2.13), releases.md.
- Validation : node --check v2 + v3 OK.
- Note : changement de format de clé → 1 re-téléchargement final des anciens
  transcrits au 1er scan post-MAJ, puis stable.
- Outcome : success.
- Next : commit sur branche fix + merge main + push.

## 2026-06-18 (17) — agent (Claude)

- Action : V2 & V3 — 2 scans consécutifs re-téléchargeaient 2/5 réunions (empreinte
  de contenu encore variable). Nouvelle dédup : clé basée sur l'ID de thread Teams
  (regex 19:…@thread.[a-z0-9]+ extrait de items[i].id, stable inter-session) +
  date d'instance (réunions récurrentes), repli sur transcriptKey (contenu) si pas
  d'ID. Helpers meetingThreadId + dedupKey ; boucle utilise dedupKey(items[i].id, t).
  Appliqué v2 + v3.
- Fichiers : v2/background.js, v3/background.js, v2/manifest.json (2.5.1→2.5.2),
  v3/manifest.json (3.0.12→3.0.13), .prompt-hub/version.md (0.2.13→0.2.14), releases.md.
- Validation : node --check v2 + v3 OK.
- Note : lastDiag.instance fournit la date d'instance ; dedupKey lit lastDiag au
  runtime (déclaré plus bas mais initialisé avant le scan).
- Outcome : success.
- Next : commit branche + merge main + push.

## 2026-06-18 (18) — agent (Claude)

- Action : V3 — 2 fonctionnalités. (1) Sécurité taille : transcript <10Ko =
  extraction incomplète → re-clic + re-extraction, jusqu'à 3 tentatives ; échec →
  noTranscript (pas de téléchargement). MIN_TRANSCRIPT_BYTES=10*1024, txtByteLength
  (TextEncoder). (2) Journal des scans en bas du panneau : appendRun stocke runLog
  (30 derniers, plus récent en tête) {startedAt,finishedAt,downloaded,skipped,
  noTranscript,total,meetings:[{name,when,status}]}. frameChats list renvoie 'when'
  (time/timestamp/aria-label). panel.{html,css,js} : section "Journal des scans",
  <details> par run (1er ouvert), statut coloré. esc() anti-injection. Écouteur
  storage.onChanged sur runLog.
- Fichiers : v3/background.js, v3/panel.html, v3/panel.css, v3/panel.js,
  v3/manifest.json (3.0.13→3.0.14), .prompt-hub/version.md (0.2.14→0.2.15), releases.md.
- Validation : node --check bg + panel OK.
- Caveat : réunion réellement <10Ko jamais téléchargée (règle utilisateur). when
  best-effort (souvent vide hors récurrent). Journal v3 seulement (pas v2).
- Outcome : success.
- Next : commit branche + merge main + push.

## 2026-06-18 (19) — agent (Claude)

- Action : V3 — suppression de l'option « Réunions uniquement » (inutile : pas de
  transcript dans les chats individuels/groupe). Switch retiré de panel.html +
  références retirées de panel.js (const, loadSettings, listener). getSettings()
  force meetingsOnly:true en dur.
- Fichiers : v3/background.js, v3/panel.html, v3/panel.js, v3/manifest.json
  (3.0.14→3.0.15), .prompt-hub/version.md (0.2.15→0.2.16), releases.md.
- Validation : node --check panel + bg OK. v2 non touché.
- Outcome : success.
- Next : commit branche + merge main + push.

## 2026-06-18 (20) — agent (Claude)

- Action : V3 — (1) statut 'error' distinct pour transcript <10Ko après 3 tentatives
  (compteur errored), séparé de noTranscript (aucun transcript). Erreur de download
  → error aussi. Bilan + doneMsg + summary incluent errored. (2) Logs de debug par
  run : runMeetings stocke pour chaque réunion {attempts,bytes,entries,chatId,title,
  diag:snapshot(lastDiag)} ; panel affiche un lien « ⬇ Logs de debug » si errored>0
  ou noTranscript>0 → télécharge un JSON (Blob+anchor) du run. RUN_STATUS.error,
  styles .rm-status.error + .run-dl. currentRuns gardé pour le download (délégation
  de clic).
- Fichiers : v3/background.js, v3/panel.js, v3/panel.css, v3/manifest.json
  (3.0.15→3.0.16), .prompt-hub/version.md (0.2.16→0.2.17), releases.md.
- Validation : node --check bg + panel OK.
- Outcome : success.
- Next : commit branche + merge main + push.

## 2026-06-18 (21) — agent (Claude)

- Action : V3 — Récapitulatif non détecté quand le nom de réunion est long (onglets
  repliés dans le menu "+N"). Cause confirmée par capture + debug JSON (meeting "DXD
  ISPARK Spotlight..." → noTranscript). Ajout frameOpenRecap : clic direct si onglet
  recap visible, sinon ouverture du menu de débordement (texte +\d+ / aria plus
  d'onglets / data-tid overflow) puis clic Récapitulatif (data-tid ou mots-clés).
  Remplace frameClickTid(recap) dans tryExtractCurrent. lastDiag.recapVia ajouté.
- Fichiers : v3/background.js, v3/manifest.json (3.0.16→3.0.17),
  .prompt-hub/version.md (0.2.17→0.2.18), releases.md.
- Validation : node --check OK.
- Outcome : success.
- Next : commit branche + merge main + push.

## 2026-06-18 (22) — agent (Claude)

- Action : V3 — suppression de max-height:320px + overflow-y:auto sur .run-log
  (journal des scans) ; le contenu s'affiche en entier, le panneau défile.
- Fichiers : v3/panel.css, v3/manifest.json (3.0.17→3.0.18),
  .prompt-hub/version.md (0.2.18→0.2.19), releases.md.
- Outcome : success.
- Next : commit branche + merge main + push.

## 2026-06-19 (23) — agent (Claude)

- Action : V3 — Paramètres avancés pour planifier le scan automatique (jours +
  plage horaire). UI : section <details> "Paramètres avancés" dans panel.html
  (switch schedule, puces jours Lun→Dim data-day=getDay(), inputs time
  début/fin, hint). panel.css : styles .advanced/.day-chip/.schedule-*.
  panel.js : load/save (scheduleEnabled/scheduleDays/scheduleStart/scheduleEnd),
  hint dynamique, état désactivé (.disabled). background.js : getSchedule()
  + SCHEDULE_DEFAULTS, parseHM, isWithinSchedule (gère plage nocturne),
  nextWindowStart, maybeStartAuto() qui gate tous les triggers auto
  (onAlarm autoStart, onStartup, onInstalled, autoEnabledChanged, pendingAutoStart).
  scheduleNextRun() saute à l'ouverture suivante si le tick tombe hors plage
  (alarme en {when:target}). Scan manuel non affecté. Défaut OFF.
- Fichiers : v3/panel.html, v3/panel.css, v3/panel.js, v3/background.js,
  v3/manifest.json (3.0.18→3.0.19), .prompt-hub/version.md (0.2.19→0.3.0),
  releases.md.
- Validation : node --check bg + panel OK.
- Outcome : success.
- Next : commit branche feat/scan-schedule-window + merge main + push.

## 2026-06-19 (24) — agent (Claude)

- Action : CI — release automatique à chaque commit sur main. Réécriture de
  .github/workflows/release.yml : déclencheur on.push.branches:[main] (au lieu de
  on.push.tags:v*). Step "Determine version and tag" lit
  .prompt-hub/version.md (head -n1) -> VERSION, git rev-parse --short HEAD ->
  SHORT_SHA, TAG=v${VERSION}-${SHORT_SHA} (unique par commit). Boucle de
  packaging v1/v2/v3 conservée (un zip par version). softprops/action-gh-release@v2
  avec target_commitish=github.sha, generate_release_notes. Ajout
  concurrency release-main cancel-in-progress:false.
- Fichiers : .github/workflows/release.yml, README.md (section Release réécrite),
  .prompt-hub/version.md (0.3.0->0.3.1), releases.md,
  todo/todo-20260619-103055-ci-release-on-main.md.
- Validation : YAML OK (ruby YAML.load_file). actionlint non installé.
- Outcome : success.
- Next : commit + push sur main (déclenchera la 1re release auto).

## 2026-06-22 17:30 — agent (Claude Code)
- Action : Fix V3 — transcript trop court signalé `error`. Réunion « DXD ISPARK
  Spotlight 30 mn Focus RH » : 16 entrées / 3067 octets (< seuil 10 Ko), 3
  tentatives identiques. Cause racine : `tryExtractCurrent` retour anticipé sur
  chemin direct (aperçu récap partiel, score 132) → onglet Transcript jamais
  ouvert ; retry rejouait le même direct. Confirmé via tab HTML fourni
  (`data-tid="Transcript"`, observed `meeting-recap-transcript-tab`).
- Fichiers : v3/background.js (param `forceTabs` + escalade/keep-best dans la
  boucle de retry), v3/manifest.json (3.0.19→3.0.20), .prompt-hub/version.md
  (0.3.1→0.3.2), releases.md, todo-20260622-172448-v3-transcript-escalate-retry.md.
- Validation : `node --check v3/background.js` OK.
- Statut : success.
- Suite : observer un prochain run de debug ; si un transcript reste < 10 Ko
  APRÈS forced-tabs, c'est une réunion réellement courte (faux positif du
  garde-fou 10 Ko) — envisager un critère de complétude par stabilité du nombre
  d'entrées plutôt qu'un seuil d'octets.

## 2026-06-22 17:55 — agent (Claude Code)
- Action : Déduplication V3 basée sur la date/heure de la réunion (en-tête récap
  `data-tid="intelligent-recap-header"`) au lieu du hash de contenu. Demande
  utilisateur. Ajout `frameGetRecapDate` (1er span[dir=auto] avec HH:MM, repli
  regex), `getRecapDateAcrossFrames`. Capture `recapDate` dans lastDiag (chemins
  direct + tabs). `dedupKey` → `t:<threadId>|<recapDate||instanceDate>`, replis
  thread seul puis hash. `when` du journal et diag alimentés par recapDate.
- Fichiers : v3/background.js, v3/manifest.json (3.0.20→3.0.21),
  .prompt-hub/version.md (0.3.2→0.3.3), releases.md.
- Validation : node --check OK.
- Statut : success.
- Note : changement de forme de clé → 1 re-téléchargement unique des réunions
  déjà traitées (ré-indexation). Récurrents : date = occurrence dropdown.
