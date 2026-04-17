# Teams Transcript Downloader

Extension Chrome (Manifest V3) pour télécharger les transcripts de réunions Microsoft Teams (y compris via l'interface **Recap**) au format JSON ou TXT.

## Description

La version web de Microsoft Teams affiche les transcripts de réunions mais n'offre pas de bouton de téléchargement natif. Cette extension scanne automatiquement la page et ses iframes (notamment celles de la vue *Recap*), extrait chaque ligne du transcript (heure, orateur, message) puis propose un export en JSON structuré ou en TXT lisible.

## Installation

### Mode développeur

1. Téléchargez ou clonez ce dépôt.
2. Ouvrez Chrome à l'adresse `chrome://extensions/`.
3. Activez le **Mode développeur** (toggle en haut à droite).
4. Cliquez sur **« Charger l'extension non empaquetée »**.
5. Sélectionnez le dossier racine du projet.

### Chrome Web Store

*(À venir)*

## Utilisation

1. Ouvrez Microsoft Teams (`teams.microsoft.com` ou `teams.cloud.microsoft`) dans Chrome.
2. Accédez à la réunion et affichez le transcript (vue *Recap* ou panneau Transcript).
3. Cliquez sur l'icône de l'extension dans la barre d'outils.
4. Cliquez sur **« Extraire le transcript »** — l'extension scanne automatiquement les iframes et choisit celle qui contient le transcript.
5. Vérifiez l'aperçu, puis téléchargez au format **JSON** ou **TXT**.

## Architecture technique

### Vue d'ensemble

L'extension suit une architecture à trois composants découplés :

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│  popup.html/.js/.css│────►│ chrome.scripting /       │────►│ Frames Teams    │
│  (UI + orchestr.)   │     │ webNavigation APIs       │     │ (main + Recap)  │
└─────────────────────┘     └──────────────────────────┘     └─────────────────┘
                                                                      │
                                                                      ▼
                                                              ┌─────────────────┐
                                                              │  content.js     │
                                                              │  (ping only)    │
                                                              └─────────────────┘
```

- **`popup.html` / `popup.css`** : interface utilisateur minimale (bouton *Extraire*, aperçu, choix du format, bouton *Debug DOM*).
- **`popup.js`** : orchestrateur. Contient toute la logique d'extraction, injectée à la demande dans les frames via `chrome.scripting.executeScript`.
- **`content.js`** : script de contenu minimaliste, chargé automatiquement sur les domaines Teams, qui ne sert qu'à répondre à un *ping* éventuel. Le travail réel est effectué via `chrome.scripting` pour pouvoir cibler un frame précis.
- **`manifest.json`** : Manifest V3, permissions et matchers.

### Flux d'exécution de l'extraction

```
1. popup.js: chrome.webNavigation.getAllFrames(tabId)
        │
        ▼
2. Pour chaque frame: executeScript(frameScanForTranscript)
        │   → renvoie { timeCount, listCells, listItems, bodyLength }
        ▼
3. Scoring: score = timeCount + 5×listCells + 5×listItems
        │   → sélection du "bestFrame" (score > 3)
        ▼
4. executeScript(frameFullExtract) sur bestFrame
        │   → findContainer() → scroll progressif → collectEntries()
        ▼
5. executeScript(frameGetTitle) sur le frame principal (frameId: 0)
        │
        ▼
6. Construction de { title, date, entries[], url } et rendu dans le popup
```

### Extraction multi-frame (Teams Recap)

La vue *Recap* de Teams intègre le transcript dans une iframe distincte (domaine et arborescence propres). Pour la trouver sans dépendre d'URLs précises :

1. `chrome.webNavigation.getAllFrames` liste tous les frames de l'onglet.
2. La fonction `frameScanForTranscript` est injectée dans chaque frame et renvoie une *heuristique* :
   - nombre de motifs horaires (`\d{1,2}:\d{2}`) dans `document.body.textContent`,
   - nombre d'éléments `[data-automationid="ListCell"]`,
   - nombre d'éléments `[role="listitem"]`,
   - taille du body.
3. Un score pondéré (`timeCount + 5×listCells + 5×listItems`) désigne le frame le plus « transcript-like ». Un seuil minimal de 3 évite les faux positifs.

C'est pour cela que le manifest déclare `host_permissions: ["<all_urls>"]` : les iframes *Recap* peuvent être servies depuis des sous-domaines Microsoft variables, et `chrome.scripting.executeScript` ne peut cibler que des frames dont l'origine est couverte par les permissions.

### Algorithme d'extraction (`frameFullExtract`)

1. **Détection du conteneur** (`findContainer`) — par ordre de priorité :
   - sélecteurs connus : `#scrollToTargetTargetedFocusZone`, `[data-tid="transcriptContainerRef"]`, `[data-tid="transcript-pane"]`, `[data-tid="transcript-content"]`, `.ms-List` ;
   - remontée DOM depuis la première `[data-automationid="ListCell"]` jusqu'au premier parent scrollable ;
   - `[role="list"]` ayant plus de 2 enfants ;
   - `[role="log"]` ;
   - heuristique finale : n'importe quel `div` comportant au moins 3 motifs horaires.
2. **Scroll progressif** si le conteneur est scrollable (`scrollHeight > clientHeight + 50`) :
   - avance de 500 px toutes les ~400 ms, jusqu'à 500 itérations max ;
   - détection de fin : 5 passages consécutifs sans progression du `scrollTop` ;
   - retour en haut (`scrollTop = 0`) pour une passe finale puis restauration de la position initiale.
3. **Collecte** (`collectEntries`) via `[data-automationid="ListCell"], [role="listitem"]`, fallback sur `container.children`.
4. **Extraction par ligne** (`extractEntryFromCell`) :
   - `time` via regex `\d{1,2}:\d{2}(?::\d{2})?` ;
   - `speaker` via sélecteurs partiels (`[class*="itemDisplayName"]`, `[class*="displayName"]`, `[class*="speaker"]`, `[class*="author"]`, `[data-tid*="speaker"]`, `[data-tid*="name"]`) ;
   - `message` via (`[class*="eventText"]`, `[class*="message"]`, `[class*="caption"]`, `[class*="text-"]`, `[data-tid*="text"]`, `[data-tid*="caption"]`), fallback sur `textContent` brut ;
   - fallback « Nom : message » via regex sur la majuscule initiale ;
   - nettoyage : retrait des préfixes redondants (time, speaker) et des bruits type « X minutes Y secondes ».
5. **Déduplication** : clé `speaker|message.substring(0,50)` dans un `Set`.

### Récupération du titre

Injection de `frameGetTitle` dans le frame principal (`frameIds: [0]`). Sélecteurs testés dans l'ordre :
`[data-tid="chat-title"]`, `[data-tid="meeting-title"]`, `h1`, `h2`, `[role="heading"]`. Valeur par défaut : `"Meeting Transcript"`.

### Formats de sortie

**JSON** — structure complète :
```json
{
  "title": "Nom de la réunion",
  "date": "2026-04-17T09:32:11.123Z",
  "url": "https://teams.microsoft.com/...",
  "entries": [
    { "time": "00:01", "speaker": "Alice Martin", "message": "Bonjour à tous." },
    { "time": "00:05", "speaker": "Bob Dupont", "message": "Salut Alice." }
  ]
}
```

**TXT** — lisible, avec fusion automatique des messages consécutifs du même orateur sans horodatage :
```
Transcript: Nom de la réunion
Date: 17/04/2026 09:32:11
URL: https://teams.microsoft.com/...

========================================

[00:01] Alice Martin: Bonjour à tous.
[00:05] Bob Dupont: Salut Alice.

========================================
Total: 2 entrées
```

Les noms de fichiers sont de la forme `transcript-<slug>-YYYYMMDD.{json,txt}`.

### Outil de Debug DOM

Le bouton **Debug DOM** du popup déclenche `debugDOM()` : pour chaque frame, il enregistre URL, type, parent et résultat du scan (`frameScanForTranscript`), puis télécharge un JSON `teams-dom-debug.json`. Très utile pour diagnostiquer une évolution du DOM Teams côté utilisateur.

## Structure du projet

```
├── manifest.json      # Manifest V3 : permissions, matchers, action, content_scripts
├── content.js         # Content script minimaliste (ping)
├── popup.html         # UI du popup
├── popup.css          # Styles (thème Teams)
├── popup.js           # Orchestration + fonctions injectées (scan, extract, title, debug)
├── icons/             # Icônes de l'extension (16/48/128 + SVG)
├── README.md
└── .prompt-hub/       # Mémoire, lessons, version, releases (workflow prompt-hub)
```

## Permissions

Déclarées dans [`manifest.json`](manifest.json) :

| Permission | Raison |
|---|---|
| `activeTab` | Accéder à l'onglet courant au moment du clic sur l'icône. |
| `scripting` | Injecter `frameScanForTranscript` / `frameFullExtract` / `frameGetTitle` via `chrome.scripting.executeScript`. |
| `downloads` | Déclencher le téléchargement des fichiers JSON/TXT/debug. |
| `webNavigation` | Appeler `chrome.webNavigation.getAllFrames` pour énumérer les iframes (nécessaire pour *Recap*). |
| `host_permissions: <all_urls>` | Pouvoir cibler les iframes *Recap* servies depuis des origines Microsoft variables. |

Matchers des content scripts : `https://teams.microsoft.com/*` et `https://teams.cloud.microsoft/*` (`run_at: document_idle`).

## Développement

### Technologies

- **Manifest V3** (Chrome Extensions).
- **JavaScript vanilla** côté popup et côté frame (aucune dépendance runtime, pas de build).
- **HTML / CSS** pour l'UI.

### Tester une modification

1. Modifiez les fichiers sources.
2. Dans `chrome://extensions/`, cliquez sur l'icône *Recharger* de l'extension.
3. Ouvrez Teams, testez, et utilisez le bouton **Debug DOM** pour inspecter la structure si l'extraction renvoie 0 entrée.

### Points d'extension / maintenance

- **Nouveau sélecteur de conteneur** : ajouter l'entrée en tête de la liste dans `findContainer()` de [`popup.js`](popup.js).
- **Nouveau pattern d'entrée** : ajuster `extractEntryFromCell()` (regex time, sélecteurs speaker/message, fallback).
- **Nouveau domaine Teams** : ajouter le matcher dans `manifest.json` → `content_scripts.matches` et (si nécessaire) dans `checkTeamsTab()` de `popup.js`.

## Limitations connues

- L'extension fonctionne uniquement lorsque le transcript est **visible / ouvert** dans Teams.
- Les classes et `data-tid` de Teams évoluent : une régression d'extraction peut nécessiter la mise à jour des sélecteurs (utiliser *Debug DOM* pour capturer l'état courant).
- L'horodatage repose sur la détection d'un motif texte : une refonte majeure du DOM de Teams peut le casser.

## Licence

MIT
