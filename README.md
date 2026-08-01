# Cimes

Clone open source de [PeakVisor](https://peakvisor.com) : panorama 3D du relief avec
identification des sommets (nom, altitude, distance), carte 3D interactive, et à terme
réalité augmentée.

Web app Svelte + TypeScript, moteur panorama Three.js, carte MapLibre GL, données 100 %
libres (OpenStreetMap, AWS Terrain Tiles, OpenFreeMap) — sans clé API ni backend.

## Installer sur iPhone

Cimes est une PWA : dans Safari, touchez **Partager** puis **« Sur l'écran d'accueil »**.
L'app se lance alors en plein écran avec son icône, comme une app native. Le hors-ligne
fonctionne pour les massifs déjà visités — ouvrez l'app installée en ligne une première
fois pour remplir son cache (il est distinct de celui de Safari).

La conception complète et le phasage sont documentés dans [PLAN.md](PLAN.md).
