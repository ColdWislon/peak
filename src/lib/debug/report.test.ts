import { beforeEach, describe, expect, it } from 'vitest';
import { buildDebugReport, logDebug, registerDebugProvider, resetDebugForTests } from './report';

describe('rapport de débogage', () => {
  beforeEach(() => resetDebugForTests());

  it('journalise avec un tampon circulaire de 100 entrées', () => {
    for (let i = 0; i < 120; i++) logDebug('test', { i });
    const report = JSON.parse(buildDebugReport()) as { journal: Array<{ data: { i: number } }> };
    expect(report.journal).toHaveLength(100);
    expect(report.journal[0]!.data.i).toBe(20); // les plus anciens évincés
    expect(report.journal[99]!.data.i).toBe(119);
  });

  it('instantanés des fournisseurs, avec tolérance aux erreurs', () => {
    registerDebugProvider('sain', () => ({ ok: true }));
    registerDebugProvider('casse', () => {
      throw new Error('boum');
    });
    const report = JSON.parse(buildDebugReport()) as {
      etats: Record<string, Record<string, unknown>>;
    };
    expect(report.etats['sain']).toEqual({ ok: true });
    expect(String(report.etats['casse']!['erreurFournisseur'])).toContain('boum');
  });

  it('désinscrit proprement un fournisseur', () => {
    const off = registerDebugProvider('phemere', () => ({ x: 1 }));
    off();
    const report = JSON.parse(buildDebugReport()) as { etats: Record<string, unknown> };
    expect(report.etats['phemere']).toBeUndefined();
  });

  it('intègre les sections supplémentaires et reste du JSON valide', () => {
    logDebug('viser:calibrage', { mae: 0.4 });
    const report = JSON.parse(buildDebugReport({ reglages: { units: 'metric' } })) as Record<
      string,
      unknown
    >;
    expect(report['rapport']).toBe('cimes-debug');
    expect(report['reglages']).toEqual({ units: 'metric' });
  });
});
