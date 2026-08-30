import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureDebugSnapshot,
  deliverSnapshot,
  fitSnapshot,
  hasSnapshotSource,
  registerSnapshotSource,
  resetSnapshotForTests,
  snapshotCaption,
  snapshotFileName,
  type DebugSnapshot,
  type SnapshotAim,
} from './snapshot';

function fakeSnapshot(): DebugSnapshot {
  return {
    blob: { size: 1234, type: 'image/jpeg' } as Blob,
    name: 'cimes-vue-20260830-101233.jpg',
    width: 390,
    height: 844,
    meta: {},
  };
}

const AIM: SnapshotAim = {
  headingDeg: 95.4,
  pitchDeg: -3.42,
  headingOffsetDeg: 6,
  pitchOffsetDeg: -1.2,
  screenFovDeg: 42.35,
  shortFovDeg: 55,
  fovCalibrated: true,
  zoom: 2.4,
  sensors: true,
  horizon: true,
  labels: 7,
};

describe('capture de débogage', () => {
  beforeEach(() => resetSnapshotForTests());

  it('borne le côté long sans jamais agrandir ni déformer', () => {
    expect(fitSnapshot(390, 844, 1280)).toEqual({ width: 390, height: 844 });
    const big = fitSnapshot(1170, 2532, 1280);
    expect(big.height).toBe(1280);
    expect(big.width / big.height).toBeCloseTo(1170 / 2532, 3);
    // Vue dégénérée (conteneur non mesuré) : taille minimale, jamais de NaN.
    expect(fitSnapshot(0, 0)).toEqual({ width: 1, height: 1 });
    expect(fitSnapshot(Number.NaN, 100)).toEqual({ width: 1, height: 1 });
  });

  it('horodate le nom de fichier en heure locale', () => {
    const name = snapshotFileName(new Date(2026, 7, 30, 9, 2, 5));
    expect(name).toBe('cimes-vue-20260830-090205.jpg');
  });

  it('grave une légende lisible seule (cap, recalages, FOV, zoom, état)', () => {
    const lines = snapshotCaption(AIM);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('cap 95°');
    expect(lines[0]).toContain('assiette −3,4°');
    expect(lines[0]).toContain('recalage +6,0° / −1,2°');
    expect(lines[1]).toContain('FOV vue 42,4°');
    expect(lines[1]).toContain('(étalonné)');
    expect(lines[1]).toContain('zoom 2,4×');
    expect(lines[2]).toBe('capteurs actifs · horizon tracé · 7 étiquettes');
  });

  it('dit l’état dégradé : sans capteurs, sans horizon, FOV par défaut', () => {
    const lines = snapshotCaption({
      ...AIM,
      fovCalibrated: false,
      sensors: false,
      horizon: false,
      labels: 1,
    });
    expect(lines[1]).toContain('(défaut)');
    expect(lines[2]).toBe('sans capteurs · horizon non calculé · 1 étiquette');
  });

  it('n’expose une source qu’entre l’enregistrement et sa désinscription', async () => {
    expect(hasSnapshotSource()).toBe(false);
    await expect(captureDebugSnapshot()).rejects.toThrow(/aucune vue/);

    const snapshot = fakeSnapshot();
    const off = registerSnapshotSource(() => Promise.resolve(snapshot));
    expect(hasSnapshotSource()).toBe(true);
    expect(await captureDebugSnapshot()).toBe(snapshot);

    off();
    expect(hasSnapshotSource()).toBe(false);
  });

  it('une source remplacée ne peut plus être désinscrite par l’ancienne', () => {
    const off = registerSnapshotSource(() => Promise.resolve(fakeSnapshot()));
    registerSnapshotSource(() => Promise.resolve(fakeSnapshot()));
    off();
    expect(hasSnapshotSource()).toBe(true);
  });

  it('partage nativement quand c’est possible', async () => {
    const saveFile = vi.fn();
    const delivery = await deliverSnapshot(fakeSnapshot(), {
      shareFile: () => Promise.resolve(true),
      saveFile,
    });
    expect(delivery).toBe('partage');
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('retombe sur le téléchargement quand le partage manque ou casse', async () => {
    const saveFile = vi.fn();
    expect(
      await deliverSnapshot(fakeSnapshot(), {
        shareFile: () => Promise.resolve(false),
        saveFile,
      }),
    ).toBe('telechargement');
    expect(
      await deliverSnapshot(fakeSnapshot(), {
        shareFile: () => Promise.reject(new Error('contexte non sécurisé')),
        saveFile,
      }),
    ).toBe('telechargement');
    expect(saveFile).toHaveBeenCalledTimes(2);
  });

  it('un partage annulé ne déclenche pas de téléchargement surprise', async () => {
    const saveFile = vi.fn();
    const abort = Object.assign(new Error('annulé'), { name: 'AbortError' });
    const delivery = await deliverSnapshot(fakeSnapshot(), {
      shareFile: () => Promise.reject(abort),
      saveFile,
    });
    expect(delivery).toBe('annule');
    expect(saveFile).not.toHaveBeenCalled();
  });
});
