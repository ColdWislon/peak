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

- [x] Rapport de débogage embarqué (zéro backend) : journal circulaire (100 événements) +
      fournisseurs d'état par composant (`lib/debug/report`, testé), instrumentation du mode
      Viser (capteurs bruts, démarrage caméra, données, visibilité, chaque calibrage avec
      statistiques de confiance et résultat du matcher) et du panorama ; bouton « Copier le
      rapport de débogage » dans ⚙ (repli textarea si presse-papiers refusé). L'utilisateur
      colle le JSON dans la conversation — rien ne quitte l'appareil sans ce geste.

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
- [x] Rapport terrain n° 1 (iPhone **paysage**, bord de mer — calibrage toujours refusé :
      assiette épinglée à +8°, FOV à 40°, mae ~4,4° malgré une confiance médiane de 1,0).
      Diagnostic reproduit par simulation sur le matcher réel ; trois corrections.
      (a) Le calibrage analysait le **plein cadre** caméra alors qu'`object-fit: cover`
      n'en affiche qu'une bande centrale en paysage (~58 % de la hauteur pour la vue du
      rapport) : le premier plan **invisible à l'écran** accrochait le détecteur pendant
      que l'utilisateur cadrait un horizon propre — il n'analyse plus que la découpe
      visible (`lib/viser/videoView`, module pur testé). (b) Un seul nombre servait de
      FOV vertical à la fois à l'écran (étiquettes, horizon, glissés) et au cadre caméra
      (calibrage) — quantités incompatibles en paysage (facteur ~0,58 en tangente) :
      étiquettes et horizon ne pouvaient pas coller à la vidéo. Le réglage persisté
      devient `cameraShortFovDeg` (FOV du petit côté du capteur, invariant en rotation
      d'écran ; l'ancien `cameraFovDeg` est ignoré), le FOV d'écran s'en déduit par la
      découpe. (c) Matcher robuste : erreur par colonne plafonnée (3°) pour qu'une
      minorité de colonnes parasites (reflets en contre-jour marin, premier plan) ne
      tire plus assiette et FOV vers les bornes ; application seulement si la MAE des
      colonnes concordantes ≤ 1° ET ≥ 60 % de colonnes concordantes (`isMatchReliable`,
      testé) — un accrochage majoritaire est refusé au lieu d'appliquer un recalage faux,
      un accrochage minoritaire n'empêche plus le verrouillage. Au passage, corrigé le
      double chargement visible dans le journal du rapport (`start()` ET l'$effect
      lançaient chacun `loadData` → deux « viser:donnees », deux workers) avec garde
      anti-course pendant les await. Limite connue : le **roulis** n'est pas modélisé —
      téléphone penché ⇒ refus propre du calibrage (mae > 1°) ; à modéliser depuis les
      capteurs si les rapports le redemandent.

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
- [x] Boussole du mode Viser : ruban de cap gradué en haut de la vue (graduations fines
      tous les 5°, hautes tous les 15°, lettres cardinales tous les 45°, N en accent),
      projeté avec la même caméra que les étiquettes — tangente du FOV horizontal, assiette
      ignorée (affichage tête haute) — pour que « N » tombe sous les sommets plein nord ;
      module pur `lib/viser/compass` testé (bornes du champ, symétrie, franchissement du
      nord, espacement en tangente). Repère central + cap chiffré sous le ruban :
      l'ancienne pastille « 245° · SO » y déménage (elle chevauchait l'en-tête sur mobile),
      et le ruban suit capteurs, glissés de recalage et mode sans capteurs.
- [x] PWA installable sur iPhone (« une app plutôt qu'un site ») : icône tactile 180×180
      opaque et 11 écrans de démarrage portrait générés depuis le SVG par
      `scripts/generate-ios-assets.mjs` (Playwright ; dans le bac à sable :
      `CHROMIUM_PATH=/opt/pw-browsers/chromium`), balises Apple dans index.html (titre,
      barre de statut translucide, startup-image à correspondance exacte points × densité,
      sinon iOS les ignore), zones sûres `env(safe-area-inset-*)` sur l'en-tête, le pied de
      page et l'UI ancrée aux bords des trois vues, ruban de boussole compris
      (encoche/Dynamic Island/barre home, portrait et paysage), `"id"` ajouté au manifest,
      coque SW passée en v2 — règle établie : les fichiers publics non hachés sont épinglés
      cache-first, bump obligatoire à chaque édition —, aide « Installer l'app » dans ⚙
      visible seulement sur iOS hors standalone (`lib/pwa/install`, module pur testé).
      Vérifié sur build de prod : balises rebasées /peak/, assets servis, coque v2. Restent
      les vérifications sur iPhone réel : installation, icône, lancement sans flash blanc,
      plein écran sans chevauchement de la barre de statut, hors-ligne après une première
      session en ligne dans l'app installée (stockage partitionné, distinct de Safari),
      caméra + capteurs du mode Viser en standalone.
- [x] Retours d'usage mobile : (a) plus de pied de page de crédits — les attributions
      ODbL/OSM/tuiles (décision n° 14 : elles restent affichées dans l'app) déménagent
      dans le panneau ⚙, section « Données » ; le panneau plafonne sa hauteur et défile.
      (b) Portrait pris en charge : sous 640 px l'en-tête quitte le flottant une-ligne
      (qui débordait) et repasse dans le flux sur deux rangées — titre + modes + ⚙,
      recherche en pleine largeur dessous — la vue commence sous l'en-tête, plus aucun
      chevauchement avec HUD/boussole, zones sûres conservées. (c) Zoom du mode Viser :
      pincement à deux doigts (molette au bureau), numérique ×1 à ×4 (`scale()` CSS
      centré sur la vidéo) ; le FOV de vue suit en espace tangente — `coverCrop`,
      `screenFovDeg` et `shortSideFovDeg` prennent un facteur de zoom (testés) — donc
      étiquettes, ruban de boussole, horizon et glissés restent alignés sous zoom, et le
      calibrage automatique analyse la découpe zoomée réellement visible puis re-mesure
      le FOV capteur en dézoomant sa conversion. Badge « 2,4× » (virgule française),
      accroche à ×1 en fin de pincement ; `setPointerCapture` toléré en échec (pointeur
      déjà relâché — vu en pointeurs synthétiques). Vérifié au navigateur (Playwright,
      caméra simulée par canvas) : molette jusqu'à la butée ×4, pincements ×2,6 → ×1,3 →
      retour ×1 badge masqué, transform vidéo cohérente, en-tête portrait et réglages OK.
- [x] Rapport terrain : boussole instable téléphone à la verticale (la pose du viseur).
      Cause : `webkitCompassHeading` iOS est l'azimut du HAUT de l'appareil — à la
      verticale, le haut pointe le zénith, sa projection horizontale n'est que du bruit,
      et cette valeur remplaçait α à chaque événement. Correction : filtre complémentaire
      (`lib/viser/aimFilter`, module pur testé) — le gyroscope (α relatif, β, γ, doux dans
      cette pose) porte la dynamique image par image ; la boussole n'apprend que le
      DÉCALAGE vers le nord vrai, pondéré cos β (1 à plat, 0 à la verticale, nul au-delà
      où l'azimut du haut se retourne de 180°), convergence ~3 s à plat ; lissage de
      sortie par l'arc court (τ = 0,1 s) avec saut direct au-delà de 45° ; boussole
      d'`accuracy` négative (non étalonnée) ignorée. Au passage : les deux flux Android
      (absolu + relatif, origines de cap différentes) ne sont plus mélangés — le relatif
      est écarté tant que le flux absolu vit. Décalage appris et poids courant exposés au
      rapport de débogage (`filtreBoussole`). Vérifié au navigateur (événements iOS
      synthétiques) : pose inclinée → « 90° · E » appris immédiatement ; à la verticale,
      boussole battant de ±40° → cap affiché strictement stable sur 150 événements, et la
      rotation au gyroscope continue de suivre (tests unitaires du module).
