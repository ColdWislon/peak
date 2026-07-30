# Suivi d'avancement — Cimes

Fichier d'état pour reprendre le travail dans une nouvelle session (contexte perdu).

**Protocole de reprise :**

1. Lire `PLAN.md` (décisions, architecture, risques), puis ce fichier.
2. Se placer sur la branche `claude/grilling-peak-viser-clone-867km0` et `git pull`.
3. Reprendre à la première case non cochée ci-dessous.
4. Après chaque étape : cocher ici, committer, pousser. Jamais plus d'une étape sans sauvegarde.

## Phase 0 — échafaudage

- [x] Vite + Svelte 5 + TypeScript strict + Vitest + Prettier, coque App sombre alpin, i18n fr
- [x] CI GitHub Actions (format + check + tests + build) + déploiement GitHub Pages
- [ ] ⚠ Action manuelle (propriétaire du repo) : activer Pages — Settings → Pages → Source « GitHub Actions »

## Phase 1 — panorama

- [ ] 1.1 Module `geo` : géodésie pure (distances, caps, projection locale, courbure/réfraction) + tests
- [ ] 1.2 Module `terrain` : maths des tuiles slippy + décodage terrarium + HeightField bilinéaire + tests
- [ ] 1.3 Chargeur de tuiles navigateur (fetch + ImageBitmap) et assemblage multi-tuiles en heightfield
- [ ] 1.4 Moteur panorama Three.js : maillage LOD en anneaux, caméra au sol, contrôles azimut/élévation
- [ ] 1.5 Ciel + brume de distance + courbure terrestre appliquée au maillage
- [ ] 1.6 Module `peaks` : client Overpass + parsing + cache IndexedDB + tests
- [ ] 1.7 Module `visibility` : ligne de vue par raymarching sur heightfield (Web Worker) + tests
- [ ] 1.8 Module `labels` : projection 3D→2D, priorisation, anti-chevauchement + tests ; étiquettes en overlay DOM
- [ ] 1.9 Géolocalisation + recherche Nominatim + état du point de vue dans l'URL + mini-fiche sommet
- [ ] 1.10 Performances mobiles (budget triangles, travail en workers) + polish visuel

## Phase 2 — carte 3D (détail à affiner en fin de phase 1)

- [ ] MapLibre GL + terrain terrarium + marqueurs de sommets + fiches + lien panorama ↔ carte

## Phase 3 — PWA

- [ ] Manifest + service worker + réglages + attributions complètes
