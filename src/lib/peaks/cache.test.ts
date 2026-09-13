import { beforeEach, describe, expect, it, vi } from 'vitest';
import { destinationPoint } from '../geo';
import { peaksAround, resetPeaksMemoryCache } from './cache';
import type { Bounds, Peak } from './index';

const CHAMONIX = { lat: 45.9237, lon: 6.8694 };

function peak(id: number, lat: number, lon: number, name = `Sommet ${id}`): Peak {
  return { id, name, nameFr: null, lat, lon, elevation: 3000, prominence: null, wikidata: null };
}

/** Faux Overpass : un monde de sommets fixes, filtré par les rectangles demandés. */
function makeWorld(peaks: Peak[]) {
  const calls: Bounds[][] = [];
  const fetcher = vi.fn(async (areas: readonly Bounds[]): Promise<Peak[]> => {
    calls.push([...areas]);
    return peaks.filter((p) =>
      areas.some((b) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east),
    );
  });
  return { fetcher, calls };
}

const WORLD = [
  peak(1, 45.8326, 6.8652, 'Mont Blanc'),
  peak(2, 45.8785, 6.8872, 'Aiguille du Midi'),
  peak(3, 45.9763, 7.6586, 'Cervin'),
  peak(4, 46.5, 8.0, 'Loin à l’est'),
  peak(5, 44.0, 6.0, 'Trop loin au sud'),
];

beforeEach(() => {
  resetPeaksMemoryCache();
});

describe('peaksAround', () => {
  it('rend les sommets dans le rayon, et eux seuls', async () => {
    const { fetcher } = makeWorld(WORLD);
    const peaks = await peaksAround(CHAMONIX, 75_000, fetcher);
    expect(peaks.map((p) => p.id).sort()).toEqual([1, 2, 3]);
  });

  it('ne rappelle pas Overpass pour un point de vue voisin (pas du suivi GPS)', async () => {
    const { fetcher } = makeWorld(WORLD);
    await peaksAround(CHAMONIX, 75_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const step = destinationPoint(CHAMONIX, 45, 40);
    const again = await peaksAround(step, 75_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.map((p) => p.id).sort()).toEqual([1, 2, 3]);

    // Un autre rayon non plus : les cellules sont indépendantes du rayon.
    const closer = await peaksAround(CHAMONIX, 12_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(closer.map((p) => p.id).sort()).toEqual([1, 2]);
  });

  it('ne demande que les cellules manquantes quand le point de vue se déplace', async () => {
    const { fetcher, calls } = makeWorld(WORLD);
    await peaksAround(CHAMONIX, 75_000, fetcher);
    const firstArea = calls[0]!.reduce((s, b) => s + (b.north - b.south) * (b.east - b.west), 0);

    // 20 km vers le nord-est : une bande de nouvelles cellules seulement.
    const moved = destinationPoint(CHAMONIX, 45, 20_000);
    await peaksAround(moved, 75_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const secondArea = calls[1]!.reduce((s, b) => s + (b.north - b.south) * (b.east - b.west), 0);
    expect(secondArea).toBeLessThan(firstArea / 2);

    // Retour au départ : tout est déjà là.
    await peaksAround(CHAMONIX, 75_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('partage une seule requête entre des appels concurrents', async () => {
    const { fetcher } = makeWorld(WORLD);
    const [a, b] = await Promise.all([
      peaksAround(CHAMONIX, 75_000, fetcher),
      peaksAround(destinationPoint(CHAMONIX, 90, 500), 75_000, fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.map((p) => p.id).sort()).toEqual(b.map((p) => p.id).sort());
  });

  it('recharge les cellules périmées au-delà d’une semaine', async () => {
    const { fetcher } = makeWorld(WORLD);
    let clock = 1_000_000;
    const now = () => clock;
    await peaksAround(CHAMONIX, 75_000, fetcher, now);
    clock += 6 * 24 * 3600 * 1000;
    await peaksAround(CHAMONIX, 75_000, fetcher, now);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 2 * 24 * 3600 * 1000;
    await peaksAround(CHAMONIX, 75_000, fetcher, now);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sert les cellules périmées quand Overpass ne répond plus', async () => {
    const { fetcher } = makeWorld(WORLD);
    let clock = 1_000_000;
    const now = () => clock;
    await peaksAround(CHAMONIX, 75_000, fetcher, now);
    clock += 30 * 24 * 3600 * 1000;
    const failing = vi.fn(async () => {
      throw new Error('Load failed');
    });
    const peaks = await peaksAround(CHAMONIX, 75_000, failing, now);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(peaks.map((p) => p.id).sort()).toEqual([1, 2, 3]);
  });

  it('propage l’erreur quand une cellule manque et que le réseau échoue', async () => {
    const failing = vi.fn(async () => {
      throw new Error('Load failed');
    });
    await expect(peaksAround(CHAMONIX, 75_000, failing)).rejects.toThrow('Load failed');
    // Et n’empoisonne pas la suite : l’appel suivant réessaie.
    const { fetcher } = makeWorld(WORLD);
    const peaks = await peaksAround(CHAMONIX, 75_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(peaks).toHaveLength(3);
  });
});
