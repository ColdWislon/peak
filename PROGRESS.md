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

- [x] Recalage automatique sur l'horizon (mode Viser) : profil d'horizon théorique calculé
      par le worker de visibilité (marche de rayon 360°), détection ciel→terrain dans l'image
      caméra réduite (contraste par sommes préfixes, sans IA), mise en correspondance
      cap+assiette par recherche sur grille avec régularisation d'assiette (l'ambiguïté
      cap/assiette d'un horizon rectiligne est départagée en faveur de la gravité). Bouton
      « Recaler sur l'horizon », appliqué seulement si l'alignement est net (mae ≤ 1,5°),
      sinon message et recalage manuel. Testé : +7°/−1° retrouvés à ±0,5° sur horizon
      synthétique ; échec propre vérifié en prod sur image sans horizon. Restent le terrain
      réel (votre téléphone) et, si concluant, un suivi continu en option.
- [x] Horizon calculé affiché dans le mode Viser : polyligne SVG du profil théorique,
      projetée avec les mêmes conventions de caméra que les étiquettes (`skylineScreenPoints`,
      testé) — repère visuel pour le recalage manuel et lecture directe de ce que « pense »
      le recalage automatique.
- [x] FOV caméra mesuré par l'horizon (le web ne l'expose pas) : recherche à trois
      dimensions cap × assiette × FOV (40–80°, grossier→fin) dans matchSkyline, a priori
      très doux vers le FOV courant (surface de coût plate : le cap absorbe une partie de
      la compression), persisté par appareil (`cameraFovDeg`) uniquement sur alignement
      excellent (mae ≤ 0,8°) et utilisé partout (étiquettes, horizon, glissés). Testé :
      68° retrouvés à ±2° depuis une hypothèse à 55°.
- [x] Retour terrain « horizon trop haut à l'écran » (biais d'assiette des capteurs) :
      glissé vertical = recalage d'assiette en mode capteurs (borné ±20°, il ne corrigeait
      que le cap), fenêtre d'assiette du matcher élargie à ±8°, et départage du cap sur
      horizon plat (pénalité minuscule sur |hOff| — l'égalité prenait sinon le premier
      candidat de la grille, −25°). Testé : plaine avec biais de −5° → assiette corrigée,
      cap intact.

- [x] Réglages (qualité de rendu, unités) — panneau ⚙ dans l'en-tête, persistés en
      localStorage ; qualité Auto/Élevée/Économique (densité du maillage + pixelRatio,
      rechargement du terrain), unités métriques/impériales dans étiquettes, fiches et
      marqueurs (vérifié sur build de prod : bascule en direct + persistance)
- [x] Icônes PWA en PNG 192/512 + variante maskable (générées depuis le SVG via Chromium)
- [ ] Vérifier hillshade/terrain MapLibre sur l'app déployée (angle mort SwiftShader du bac à sable)
- [x] Étiquettes : nom `name:fr` vs local selon préférence (réglage « Noms des sommets »,
      appliqué au panorama et à la carte sans rechargement) ; proéminence OSM parsée et
      intégrée au score de priorité (altitude + 2 × proéminence, sélection et étiquetage)
- [x] Phase 4 : AR livrée en web (amendement de la décision n° 2, cf. PLAN.md) — mode
      « Viser » : caméra `getUserMedia` + orientation appareil (matrice W3C ZXY → cap/assiette,
      module pur testé ; `webkitCompassHeading` iOS géré), étiquettes des sommets visibles
      par-dessus, recalage boussole au doigt, repli « glisser pour viser » sans capteurs,
      permission iOS demandée au geste. Vérifié en prod : caméra factice + orientations
      synthétiques (sud → Mont Blanc, est → Aiguille Verte, recalage +7°). Piège corrigé :
      `setPointerCapture` sur un conteneur retarge les `click` — ignorer les appuis sur boutons.
      (App native : option future si la précision des capteurs web déçoit.)
