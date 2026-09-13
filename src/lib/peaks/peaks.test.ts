import { describe, expect, it } from 'vitest';
import { haversineDistance } from '../geo';
import {
  apparentImportance,
  buildPeaksQuery,
  parseElevation,
  parsePeaks,
  peakDisplayName,
  peakImportance,
  topPeaks,
  topPeaksFrom,
  type Peak,
} from './index';

const FIXTURE = {
  version: 0.6,
  elements: [
    {
      type: 'node',
      id: 26862480,
      lat: 45.8326,
      lon: 6.8652,
      tags: {
        natural: 'peak',
        name: 'Mont Blanc',
        ele: '4808.72',
        prominence: '4696',
        wikidata: 'Q583',
      },
    },
    {
      type: 'node',
      id: 1,
      lat: 45.8785,
      lon: 6.8872,
      tags: { natural: 'peak', name: 'Aiguille du Midi', ele: '3842 m' },
    },
    {
      type: 'node',
      id: 2,
      lat: 45.9,
      lon: 6.9,
      tags: { natural: 'peak', name: 'Ele illisible', ele: 'environ haut' },
    },
    {
      type: 'node',
      id: 3,
      lat: 45.91,
      lon: 6.91,
      tags: { natural: 'peak', name: 'Matterhorn', 'name:fr': 'Cervin', ele: '4478' },
    },
    { type: 'node', id: 4, lat: 45.92, lon: 6.92, tags: { natural: 'peak' } },
    { type: 'way', id: 5, tags: { name: 'Pas un nœud' } },
    { type: 'node', id: 6, tags: { name: 'Sans coordonnées' } },
  ],
};

describe('buildPeaksQuery', () => {
  it('vise les nœuds natural=peak nommés dans chaque rectangle demandé', () => {
    const q = buildPeaksQuery([
      { south: 45.75, west: 6.75, north: 46, east: 7 },
      { south: 46, west: 6.5, north: 46.25, east: 7 },
    ]);
    expect(q).toContain('[out:json]');
    expect(q).toContain('node["natural"="peak"]["name"](45.750000,6.750000,46.000000,7.000000);');
    expect(q).toContain('node["natural"="peak"]["name"](46.000000,6.500000,46.250000,7.000000);');
    expect(q).toContain('out body;');
  });
});

describe('parseElevation', () => {
  it('lit les variantes de terrain', () => {
    expect(parseElevation('4808.72')).toBeCloseTo(4808.72, 6);
    expect(parseElevation('3842 m')).toBe(3842);
    expect(parseElevation('4,478')).toBeCloseTo(4.478, 6);
    expect(parseElevation(undefined)).toBeNull();
    expect(parseElevation('environ haut')).toBeNull();
  });

  it('rejette les valeurs absurdes', () => {
    expect(parseElevation('99999')).toBeNull();
    expect(parseElevation('-9000')).toBeNull();
  });
});

describe('parsePeaks', () => {
  const peaks = parsePeaks(FIXTURE);

  it('ne garde que les nœuds nommés et localisés (nom local en clef)', () => {
    expect(peaks.map((p) => p.name)).toEqual([
      'Mont Blanc',
      'Aiguille du Midi',
      'Ele illisible',
      'Matterhorn',
    ]);
  });

  it('conserve le nom français à part, avec wikidata et proéminence', () => {
    const cervin = peaks.find((p) => p.id === 3)!;
    expect(cervin.name).toBe('Matterhorn');
    expect(cervin.nameFr).toBe('Cervin');
    const montBlanc = peaks.find((p) => p.id === 26862480)!;
    expect(montBlanc.wikidata).toBe('Q583');
    expect(montBlanc.elevation).toBeCloseTo(4808.72, 2);
    expect(montBlanc.prominence).toBe(4696);
    expect(montBlanc.nameFr).toBeNull();
  });

  it("laisse l'altitude à null quand le tag est illisible", () => {
    expect(peaks.find((p) => p.id === 2)!.elevation).toBeNull();
  });

  it('tolère les réponses inattendues', () => {
    expect(parsePeaks(null)).toEqual([]);
    expect(parsePeaks({})).toEqual([]);
    expect(parsePeaks({ elements: 'rien' })).toEqual([]);
  });
});

function makePeak(partial: Partial<Peak>): Peak {
  return {
    id: 0,
    name: 'Sommet',
    nameFr: null,
    lat: 0,
    lon: 0,
    elevation: null,
    prominence: null,
    wikidata: null,
    ...partial,
  };
}

describe('peakDisplayName', () => {
  const cervin = makePeak({ name: 'Matterhorn', nameFr: 'Cervin' });
  const sansFr = makePeak({ name: 'Weisshorn' });

  it('suit la préférence, avec repli sur le nom local', () => {
    expect(peakDisplayName(cervin, 'fr')).toBe('Cervin');
    expect(peakDisplayName(cervin, 'local')).toBe('Matterhorn');
    expect(peakDisplayName(sansFr, 'fr')).toBe('Weisshorn');
  });
});

describe('peakImportance et topPeaks', () => {
  it('trie par importance décroissante, sans altitude en dernier', () => {
    const peaks = parsePeaks(FIXTURE);
    const top = topPeaks(peaks, 3);
    expect(top.map((p) => p.name)).toEqual(['Mont Blanc', 'Matterhorn', 'Aiguille du Midi']);
  });

  it('fait passer un sommet proéminent devant une antécime plus haute', () => {
    const antecime = makePeak({ id: 1, name: 'Antécime', elevation: 4200 });
    const proeminent = makePeak({ id: 2, name: 'Proéminent', elevation: 4000, prominence: 2000 });
    expect(peakImportance(proeminent)).toBeGreaterThan(peakImportance(antecime));
    expect(topPeaks([antecime, proeminent], 2)[0]!.name).toBe('Proéminent');
  });

  it('ne mute pas le tableau source', () => {
    const peaks = parsePeaks(FIXTURE);
    const before = peaks.map((p) => p.id);
    topPeaks(peaks, 1);
    expect(peaks.map((p) => p.id)).toEqual(before);
  });
});

describe('importance apparente depuis un point de vue', () => {
  /** Cas du rapport terrain n° 6 : Cognin, œil à 300 m, face aux Bauges. */
  const VUE = { lat: 45.58806, lon: 5.87642 };
  const OEIL = 300;
  /** La crête sous les yeux : modeste, mais elle occupe le champ. */
  const nivolet = makePeak({
    id: 1,
    name: 'Croix du Nivolet',
    lat: 45.6045,
    lon: 5.9587,
    elevation: 1547,
    prominence: 250,
  });
  /** Un géant de Vanoise à ~60 km : plus haut, mais un triangle à l'horizon. */
  const vanoise = makePeak({
    id: 2,
    name: 'Grande Casse',
    lat: 45.4,
    lon: 6.65,
    elevation: 3855,
    prominence: 1500,
  });

  it('classe la crête proche devant le géant lointain', () => {
    const proche = apparentImportance(nivolet, haversineDistance(VUE, nivolet), OEIL);
    const lointain = apparentImportance(vanoise, haversineDistance(VUE, vanoise), OEIL);
    expect(proche).toBeGreaterThan(lointain);
    expect(topPeaksFrom([vanoise, nivolet], VUE, OEIL, 2)[0]!.name).toBe('Croix du Nivolet');
  });

  it('garde la crête du champ que le tri par altitude absolue évinçait', () => {
    // 400 sommets de 2500 à 3500 m entre 40 et 70 km : ce que renvoie vraiment
    // Overpass autour de Chambéry (Belledonne, Vanoise, Beaufortain…).
    const lointains = Array.from({ length: 400 }, (_, i) =>
      makePeak({
        id: 100 + i,
        name: `Lointain ${i}`,
        lat: 45.2 + (i % 20) * 0.02,
        lon: 6.4 + Math.floor(i / 20) * 0.02,
        elevation: 2500 + (i % 100) * 10,
        prominence: 100,
      }),
    );
    const tous = [...lointains, nivolet];

    // Ancien tri (altitude + proéminence) : la crête n'entre même pas dans les 300.
    expect(topPeaks(tous, 300).some((p) => p.id === nivolet.id)).toBe(false);
    // Tri apparent : elle arrive en tête.
    expect(topPeaksFrom(tous, VUE, OEIL, 300)[0]!.id).toBe(nivolet.id);
  });

  it('range les sommets sans altitude en dernier et ne mute pas la source', () => {
    const inconnu = makePeak({ id: 3, name: 'Sans altitude' });
    const ordre = topPeaksFrom([inconnu, vanoise, nivolet], VUE, OEIL, 3);
    expect(ordre[2]!.id).toBe(inconnu.id);
    const source = [nivolet, vanoise];
    topPeaksFrom(source, VUE, OEIL, 1);
    expect(source.map((p) => p.id)).toEqual([nivolet.id, vanoise.id]);
  });
});
