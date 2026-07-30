import { describe, expect, it } from 'vitest';
import {
  buildPeaksQuery,
  parseElevation,
  parsePeaks,
  peakDisplayName,
  peakImportance,
  topPeaks,
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
  it('vise les nœuds natural=peak nommés dans le rayon demandé', () => {
    const q = buildPeaksQuery({ lat: 45.9237, lon: 6.8694 }, 60_000);
    expect(q).toContain('[out:json]');
    expect(q).toContain('node["natural"="peak"]["name"]');
    expect(q).toContain('around:60000,45.923700,6.869400');
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
