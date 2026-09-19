# Cimes

Clone open source de [PeakVisor](https://peakvisor.com) : panorama 3D du relief avec
identification des sommets (nom, altitude, distance), carte 3D interactive, et à terme
réalité augmentée.

Web app Svelte + TypeScript, moteur panorama Three.js, carte MapLibre GL, données 100 %
libres (OpenStreetMap, AWS Terrain Tiles, OpenFreeMap) — sans clé API ni backend.

## Installer sur le téléphone

Cimes est une PWA : elle s'installe depuis le navigateur, sans store.

- **Android** (Chrome, Edge, Samsung Internet) : menu **⋮** → **« Installer l'application »**.
  Le tiroir ≡ de l'app propose aussi un bouton **Installer Cimes** dès que le navigateur
  offre son invite ; sur les navigateurs qui n'en offrent pas (Firefox), il rappelle le
  chemin du menu.
- **iPhone** (Safari) : bouton **Partager** → **« Sur l'écran d'accueil »** (iOS n'a pas
  d'invite d'installation, la marche à suivre est rappelée dans le tiroir ≡).

Dans les deux cas l'app se lance en plein écran avec son icône, comme une app native.
Le hors-ligne fonctionne pour les massifs déjà visités — ouvrez l'app installée en ligne
une première fois pour remplir son cache (il est distinct de celui du navigateur).

La conception complète et le phasage sont documentés dans [PLAN.md](PLAN.md).
