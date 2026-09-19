import { describe, expect, it } from 'vitest';
import { installOffer, isAndroidDevice, isIosDevice, isStandalone } from './install';

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

describe('isAndroidDevice', () => {
  it('reconnaît Android, écarte iPhone et desktop', () => {
    expect(isAndroidDevice(UA_ANDROID)).toBe(true);
    expect(isAndroidDevice(UA_IPHONE)).toBe(false);
    expect(isAndroidDevice(UA_WINDOWS)).toBe(false);
  });
});

describe('installOffer', () => {
  const base = { installed: false, ios: false, android: false, promptReady: false };

  it('invite du navigateur captée : un vrai bouton, quel que soit l’appareil', () => {
    expect(installOffer({ ...base, android: true, promptReady: true })).toBe('prompt');
    expect(installOffer({ ...base, promptReady: true })).toBe('prompt');
  });

  it('Android sans invite (Firefox, ou invite pas encore émise) : le menu ⋮', () => {
    expect(installOffer({ ...base, android: true })).toBe('android');
  });

  it('iOS : la marche à suivre Safari, jamais de bouton (pas d’invite)', () => {
    expect(installOffer({ ...base, ios: true })).toBe('ios');
  });

  it('app déjà installée : plus rien à proposer', () => {
    expect(installOffer({ ...base, installed: true, ios: true })).toBeNull();
    expect(installOffer({ ...base, installed: true, android: true, promptReady: true })).toBeNull();
  });

  it('bureau sans invite : on ne dit rien plutôt qu’une marche à suivre fausse', () => {
    expect(installOffer(base)).toBeNull();
  });
});
