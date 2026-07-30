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
  it('lit le mode carte et retombe sur panorama sinon', () => {
    expect(parseMode('?lat=1&lon=2&mode=carte')).toBe('carte');
    expect(parseMode('?lat=1&lon=2')).toBe('panorama');
    expect(parseMode('?mode=nimporte')).toBe('panorama');
  });

  it('boucle avec viewpointToSearch', () => {
    const vp = { lat: 45.9237, lon: 6.8694 };
    expect(parseMode(viewpointToSearch(vp, 'carte'))).toBe('carte');
    expect(parseMode(viewpointToSearch(vp))).toBe('panorama');
    expect(parseViewpoint(viewpointToSearch(vp, 'carte'))).toEqual(vp);
  });
});
