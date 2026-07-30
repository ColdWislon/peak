# Cimes — plan de conception

Clone open source de PeakVisor : identifier les sommets de montagne autour d'un point de vue,
dans un panorama 3D du relief, puis sur une carte 3D interactive, et à terme en réalité augmentée.

Ce document est le résultat de l'interview de cadrage du 2026-07-30. Chaque décision ci-dessous
a été validée explicitement.

## Décisions

| #   | Sujet         | Décision                                                                                                                                                   |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Produit       | App complète (panorama 3D, carte 3D, AR), construite en phases                                                                                             |
| 2   | Plateforme    | Web/PWA d'abord (panorama + carte) ; l'AR viendra dans une app native, hors de ce dépôt                                                                    |
| 3   | Rendu 3D      | Hybride : moteur panorama custom **Three.js** + carte **MapLibre GL**                                                                                      |
| 4   | Données       | 100 % libres, sans clé API : sommets **OSM/Overpass**, élévation **AWS Terrain Tiles** (terrarium), fond de carte **OpenFreeMap**, géocodage **Nominatim** |
| 5   | Architecture  | Zéro backend : SPA statique, cache IndexedDB, calculs en Web Workers                                                                                       |
| 6   | Stack front   | **Svelte + TypeScript + Vite**                                                                                                                             |
| 7   | Phasage       | Panorama d'abord (le risque technique en premier), puis carte, puis PWA/polish                                                                             |
| 8   | Scope phase 1 | « V1 solide » — voir détail ci-dessous                                                                                                                     |
| 9   | Langue UI     | Français d'abord, chaînes centralisées dans un module unique (i18n plus tard sans refactor)                                                                |
| 10  | Déploiement   | **GitHub Pages** via GitHub Actions (typecheck + tests + build + deploy à chaque merge sur `main`)                                                         |
| 11  | Qualité       | **Vitest** sur le cœur calculatoire (modules purs), typecheck strict ; pas d'E2E ni de tests visuels en v1                                                 |
| 12  | Nom           | **Cimes** (le dépôt reste `peak`)                                                                                                                          |
| 13  | Style         | Sombre alpin : UI quasi-noir bleuté, accent bleu glacier, terrain/ciel lumineux, étiquettes blanches                                                       |
| 14  | Licence       | **MIT** (le code) ; attributions ODbL/OSM et tuiles affichées dans l'app                                                                                   |

> **Amendement (2026-07-30, validé)** — décision n° 2 : la phase 4 AR est finalement livrée
> **en web, dans cette app** (mode « Viser » : caméra + capteurs d'orientation + pipeline
> visibilité/étiquettes existant, calibration boussole au doigt, repli glissé sans capteurs).
> L'app native reste une option future si la précision des capteurs web s'avère insuffisante.

Arbitrages par défaut (modifiables à tout moment) :

- Point de vue par défaut : Chamonix, face au massif du Mont-Blanc (45.9237, 6.8694).
- Cibles : navigateurs evergreen desktop + mobile (Safari iOS récent, Chrome Android), design mobile-first.
- Distance de vue du panorama : ~100 km, avec niveau de détail dégressif (LOD en anneaux).

## Scope de la phase 1 — panorama « v1 solide »

- Choix du point de vue : géolocalisation navigateur, recherche de lieu (Nominatim), point encodé dans l'URL (partageable).
- Rendu : maillage du terrain depuis les tuiles terrarium, ciel + brume de distance, LOD en anneaux autour du point de vue.
- Sommets : requête Overpass (`natural=peak`) autour du point, cache IndexedDB.
- Étiquettes : nom, altitude, distance ; **filtrées par ligne de vue réelle** (raymarching sur le champ d'altitude, dans un Web Worker) ; priorisées par importance quand elles se chevauchent.
- Interactions : rotation/zoom souris et tactile, cap affiché en degrés, clic sur une étiquette → mini-fiche du sommet.

## Phases suivantes

- **Phase 2 — carte 3D** : MapLibre GL avec terrain (mêmes tuiles terrarium), marqueurs de sommets cliquables, fiches détaillées, recherche, bouton « voir le panorama d'ici » (aller-retour carte ↔ panorama).
- **Phase 3 — PWA + finitions** : manifest, service worker (cache des assets et des tuiles récentes), réglages (qualité de rendu, unités), performances mobiles.
- **Phase 4 — AR native** (hors de ce dépôt) : app mobile dédiée réutilisant les mêmes sources de données.

## Architecture des modules

```
src/
  lib/
    geo/         géodésie pure : WGS84 ↔ repère local, distances, azimuts        [testé]
    terrain/     fetch + décodage des tuiles terrarium → champs d'altitude       [testé]
    peaks/       client Overpass, modèle Sommet, cache IndexedDB                 [testé]
    visibility/  ligne de vue par raymarching sur le champ d'altitude (worker)   [testé]
    labels/      projection 3D→2D, priorisation, anti-chevauchement              [testé]
    panorama/    moteur Three.js : scène, maillages LOD, ciel/brume, rendu
    map/         composant MapLibre GL (phase 2)
    i18n/        chaînes françaises centralisées
  components/    coque UI Svelte (recherche, fiches, réglages, attributions)
  workers/       points d'entrée des Web Workers
```

Principe : tout le calculatoire vit dans des modules TypeScript purs, sans DOM ni Three.js,
testés par Vitest ; les moteurs de rendu (Three.js, MapLibre) restent des couches minces.

## Risques identifiés et parades

- **Disponibilité d'Overpass** (API publique, parfois lente) → cache IndexedDB agressif, endpoints de repli, et possibilité d'ajouter plus tard un proxy serverless sans toucher à l'app.
- **Performances mobiles du maillage** → LOD en anneaux, géométrie construite en worker, budget de triangles plafonné.
- **Précision de la ligne de vue** vs bruit du DEM (~30 m) → marge de tolérance sur le test de visibilité.
- **Politiques d'usage** : Nominatim impose 1 req/s et un User-Agent identifiant → debounce côté client ; attributions OSM/ODbL, AWS Terrain Tiles (sources Mapzen) et OpenFreeMap affichées dans l'UI.

## Prochaine étape

Phase 0 — échafaudage : projet Vite + Svelte + TS strict, ESLint/Prettier, Vitest,
workflow GitHub Actions (typecheck + tests + build + déploiement Pages), LICENSE MIT, README.
