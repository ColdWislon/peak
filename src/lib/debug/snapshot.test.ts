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
  time: new Date(2026, 7, 30, 11, 18, 5),
  viewpoint: { lat: 45.58931, lon: 5.90127 },
  viewpointSource: 'gps',
  eyeElevationM: 412.4,
  headingDeg: 95.4,
  pitchDeg: -3.42,
  headingOffsetDeg: 6,
  pitchOffsetDeg: -1.2,
  screenFovDeg: 42.35,
  shortFovDeg: 55,
  fovCalibrated: true,
  zoom: 2.4,
  stream: { w: 1280, h: 720 },
  calibration: {
    applied: true,
    maeDeg: 0.42,
    inlierRatio: 0.78,
    fovDeg: 42.35,
    fovAdopted: true,
    fovEstimateDeg: 42.35,
    fovAtBound: false,
  },
  sensors: true,
  horizon: true,
  peaksStatus: 'ok',
  peaksLoaded: 128,
  peaksVisible: 12,
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

  it('grave une légende lisible seule (lieu, cap, FOV, recalage, sommets)', () => {
    const lines = snapshotCaption(AIM);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('30/08 11:18');
    expect(lines[0]).toContain('point de vue 45.5893, 5.9013 (GPS)');
    expect(lines[0]).toContain('œil 412 m');
    expect(lines[1]).toContain('cap 95°');
    expect(lines[1]).toContain('assiette −3,4°');
    expect(lines[1]).toContain('recalage +6,0° / −1,2°');
    expect(lines[2]).toContain('FOV vue 42,4°');
    expect(lines[2]).toContain('(étalonné)');
    expect(lines[2]).toContain('zoom 2,4×');
    expect(lines[2]).toContain('flux 1280×720');
    expect(lines[3]).toBe(
      'dernier recalage : appliqué · MAE 0,42° · 78 % concordantes · FOV vue 42,4° ' +
        '(optique adoptée)',
    );
    expect(lines[4]).toBe(
      'capteurs actifs · horizon tracé · sommets : 128 chargés, 12 en vue, 7 dans le champ',
    );
  });

  it('dit d’où vient le point de vue (un horizon faux part souvent de là)', () => {
    expect(snapshotCaption({ ...AIM, viewpointSource: 'defaut' })[0]).toContain('(défaut)');
    expect(snapshotCaption({ ...AIM, viewpointSource: 'url' })[0]).toContain('(lien)');
  });

  it('dit le verdict du dernier recalage, y compris son absence', () => {
    expect(snapshotCaption({ ...AIM, calibration: null })[3]).toBe(
      'dernier recalage : aucun depuis le démarrage',
    );
    const nonDetecte = snapshotCaption({
      ...AIM,
      calibration: {
        applied: false,
        maeDeg: null,
        inlierRatio: null,
        fovDeg: null,
        fovAdopted: false,
        fovEstimateDeg: null,
        fovAtBound: false,
      },
    });
    expect(nonDetecte[3]).toContain('refusé, horizon non détecté');
  });

  it('distingue le FOV appliqué de l’optique mesurée écartée', () => {
    // Cas du rapport terrain n° 4 : la mesure butait à 17,5°, le recalage a
    // donc été refait — et appliqué — au FOV réellement à l'écran.
    const ecartee = snapshotCaption({
      ...AIM,
      calibration: {
        ...AIM.calibration!,
        fovDeg: 22.3,
        fovAdopted: false,
        fovEstimateDeg: 17.5,
        fovAtBound: true,
      },
    });
    expect(ecartee[3]).toContain('FOV vue 22,3° (mesure 17,5° écartée, en butée)');
    const sansMesure = snapshotCaption({
      ...AIM,
      calibration: { ...AIM.calibration!, fovAdopted: false, fovEstimateDeg: null },
    });
    expect(sansMesure[3]).toContain('(optique inchangée)');
  });

  it('dit l’état dégradé : sans capteurs, sans horizon, FOV par défaut', () => {
    const lines = snapshotCaption({
      ...AIM,
      fovCalibrated: false,
      sensors: false,
      horizon: false,
      labels: 0,
    });
    expect(lines[2]).toContain('(défaut)');
    expect(lines[4]).toContain('sans capteurs · horizon non calculé');
    expect(lines[4]).toContain('0 dans le champ');
  });

  it('distingue « pas de sommets » de « aucun dans le champ »', () => {
    // Le cas du rapport terrain n° 2 : horizon tracé mais zéro étiquette —
    // la légende doit dire LAQUELLE des trois étapes a produit le zéro.
    const masques = snapshotCaption({
      ...AIM,
      peaksStatus: 'noneVisible',
      peaksVisible: 0,
      labels: 0,
    });
    expect(masques[4]).toContain('128 chargés, 0 en vue, 0 dans le champ (tous masqués');
    const overpass = snapshotCaption({
      ...AIM,
      peaksStatus: 'error',
      peaksLoaded: 0,
      peaksVisible: 0,
      labels: 0,
    });
    expect(overpass[4]).toContain('0 chargés, 0 en vue, 0 dans le champ (Overpass indisponible)');
    // Statut nominal : aucun motif ajouté, les trois nombres suffisent.
    const horsChamp = snapshotCaption({ ...AIM, labels: 0 });
    expect(horsChamp[4]).toMatch(/12 en vue, 0 dans le champ$/);
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
