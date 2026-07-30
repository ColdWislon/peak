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

- [x] 1.1 Module `geo` : géodésie pure (distances, caps, projection locale, courbure/réfraction) + tests
- [x] 1.2 Module `terrain` : maths des tuiles slippy + décodage terrarium + HeightField bilinéaire + tests
- [x] 1.3 Chargeur de tuiles navigateur (fetch + ImageBitmap) et assemblage multi-tuiles en heightfield
      (cache mémoire 512 tuiles ; cache IndexedDB remis à la phase 3)
- [x] 1.4 Moteur panorama Three.js : maillage LOD en anneaux, caméra au sol, contrôles azimut/élévation
- [x] 1.5 Ciel + brume de distance + courbure terrestre appliquée au maillage
      (reste pour 1.10 : ciel en dégradé, fondu entre DEM proche z12 et lointain z10 — fine
      couture visible vers 24 km ; vérifié par captures Playwright, cf. « Notes environnement »)
- [x] 1.6 Module `peaks` : client Overpass + parsing + cache IndexedDB + tests
- [x] 1.7 Module `visibility` : ligne de vue par raymarching sur heightfield (Web Worker) + tests
- [x] 1.8 Module `labels` : projection 3D→2D, priorisation, anti-chevauchement + tests ; étiquettes en overlay DOM
      (+ mini-fiche sommet au clic, vérifié visuellement avec fixture Overpass — Mont Blanc,
      Aiguille du Midi, etc. correctement ancrés)
- [x] 1.9 Géolocalisation + recherche Nominatim + état du point de vue dans l'URL + mini-fiche sommet
      (vérifié : téléportation Chamonix → Zermatt avec fixtures, Cervin étiqueté à 8,6 km ;
      piège corrigé : ne jamais passer un proxy $state à postMessage/au moteur — copier)
- [x] 1.10 Performances mobiles (budget triangles, travail en workers) + polish visuel
      (fondu DEM proche/lointain, dôme céleste en dégradé, maillage construit dans un worker
      dédié avec aller-retour des tampons par transfert, rendu à la demande, grille allégée
      sur écrans tactiles ; échantillonneur partagé entre workers terrain et visibilité)

**Phase 1 terminée** — le mode panorama « v1 solide » du PLAN.md est complet.

## Notes environnement (sessions Claude Code distantes)

- La politique réseau du bac à sable n'autorise que certains hôtes : `s3.amazonaws.com`
  (tuiles terrarium) passe **via curl uniquement** — Chromium se fait réinitialiser dessus,
  et `overpass-api.de` / `nominatim.openstreetmap.org` / `openfreemap.org` sont refusés (403
  proxy). L'app déployée n'est pas concernée.
- Vérification visuelle : lancer `npm run dev`, puis un script Playwright
  (`executablePath: '/opt/pw-browsers/chromium'`) qui **intercepte `https://s3.amazonaws.com/**`
  et sert les tuiles via `curl`** (voir scratchpad `shot.mjs` de la session, à recréer au besoin).
- Les modules `peaks` (Overpass) et la recherche Nominatim se testent donc par fixtures ;
  ne pas perdre de temps à déboguer le réseau du bac à sable.

## Phase 2 — carte 3D (détail à affiner en fin de phase 1)

- [x] MapLibre GL + terrain terrarium + marqueurs de sommets + fiches + lien panorama ↔ carte
      (bascule Panorama/Carte dans l'en-tête, mode dans l'URL `&mode=carte`, marqueurs DOM
      rafraîchis au déplacement avec anti-course, fiche → « Voir le panorama d'ici », FAB
      « Panorama ici » ; à re-vérifier sur l'app déployée : rendu hillshade/terrain 3D,
      invisible sous SwiftShader headless bien que les tuiles se chargent sans erreur)

## Phase 3 — PWA

- [x] Manifest + service worker + attributions complètes
      (installable, coque en cache-first, navigation avec repli hors-ligne, tuiles S3 en
      cache plafonné à 600 entrées ; vérifié sur build de prod : enregistrement, activation,
      portée /peak/, cache coque créé)

## Backlog (après les 3 phases du plan)

- [x] Réglages (qualité de rendu, unités) — panneau ⚙ dans l'en-tête, persistés en
      localStorage ; qualité Auto/Élevée/Économique (densité du maillage + pixelRatio,
      rechargement du terrain), unités métriques/impériales dans étiquettes, fiches et
      marqueurs (vérifié sur build de prod : bascule en direct + persistance)
- [x] Icônes PWA en PNG 192/512 + variante maskable (générées depuis le SVG via Chromium)
- [ ] Vérifier hillshade/terrain MapLibre sur l'app déployée (angle mort SwiftShader du bac à sable)
- [ ] Étiquettes : nom `name:fr` vs local selon préférence ; proéminence quand disponible
- [ ] Phase 4 : app native AR (hors de ce dépôt)
