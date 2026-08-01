import { describe, expect, it } from 'vitest';
import { isIosDevice, isStandalone } from './install';

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const UA_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

describe('isIosDevice', () => {
  it('reconnaît un iPhone', () => {
    expect(isIosDevice(UA_IPHONE, 5)).toBe(true);
  });

  it('reconnaît un iPad récent malgré son user agent macOS', () => {
    expect(isIosDevice(UA_MAC, 5)).toBe(true);
  });

  it('ne confond pas un vrai Mac (pas de multi-touch)', () => {
    expect(isIosDevice(UA_MAC, 0)).toBe(false);
  });

  it('écarte Android et desktop', () => {
    expect(isIosDevice(UA_ANDROID, 5)).toBe(false);
    expect(isIosDevice(UA_WINDOWS, 0)).toBe(false);
  });
});

describe('isStandalone', () => {
  it('vrai via display-mode: standalone (norme) ou navigator.standalone (Safari)', () => {
    expect(isStandalone(true, undefined)).toBe(true);
    expect(isStandalone(false, true)).toBe(true);
  });

  it('faux dans un onglet de navigateur classique', () => {
    expect(isStandalone(false, undefined)).toBe(false);
    expect(isStandalone(false, false)).toBe(false);
  });
});
