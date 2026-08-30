import { describe, expect, it } from 'vitest';
import { parseMode, parseViewpoint, viewpointToSearch } from './url';

describe('parseViewpoint', () => {
  it('lit lat/lon valides', () => {
    expect(parseViewpoint('?lat=45.9237&lon=6.8694')).toEqual({ lat: 45.9237, lon: 6.8694 });
  });

  it('rejette absentes, illisibles ou hors bornes', () => {
    expect(parseViewpoint('')).toBeNull();
    expect(parseViewpoint('?lat=45.9')).toBeNull();
    expect(parseViewpoint('?lat=abc&lon=6.8')).toBeNull();
    expect(parseViewpoint('?lat=91&lon=6.8')).toBeNull();
    expect(parseViewpoint('?lat=45.9&lon=181')).toBeNull();
  });

  it('boucle avec viewpointToSearch', () => {
    const vp = { lat: 45.9237, lon: 6.8694 };
    expect(parseViewpoint(viewpointToSearch(vp))).toEqual(vp);
  });
});

describe('parseMode', () => {
  it('ouvre en Viser par défaut, lit les modes explicites', () => {
    expect(parseMode('?lat=1&lon=2&mode=carte')).toBe('carte');
    expect(parseMode('?lat=1&lon=2&mode=panorama')).toBe('panorama');
    expect(parseMode('?lat=1&lon=2&mode=viser')).toBe('viser');
    expect(parseMode('?lat=1&lon=2')).toBe('viser');
    expect(parseMode('?mode=nimporte')).toBe('viser');
    expect(parseMode('')).toBe('viser');
  });

  it('sérialise les modes non par défaut, tait le mode Viser', () => {
    expect(viewpointToSearch({ lat: 1, lon: 2 }, 'viser')).not.toContain('mode=');
    expect(viewpointToSearch({ lat: 1, lon: 2 }, 'panorama')).toContain('mode=panorama');
  });

  it('boucle avec viewpointToSearch', () => {
    const vp = { lat: 45.9237, lon: 6.8694 };
    expect(parseMode(viewpointToSearch(vp, 'carte'))).toBe('carte');
    expect(parseMode(viewpointToSearch(vp, 'panorama'))).toBe('panorama');
    expect(parseMode(viewpointToSearch(vp))).toBe('viser');
    expect(parseViewpoint(viewpointToSearch(vp, 'carte'))).toEqual(vp);
  });
});
