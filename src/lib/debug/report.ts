/**
 * Rapport de débogage embarqué (zéro backend) : les composants enregistrent
 * des fournisseurs d'état et journalisent des événements ; l'utilisateur copie
 * le rapport JSON depuis les réglages et le colle dans la conversation.
 * Rien ne quitte l'appareil sans ce geste explicite.
 */

export interface DebugEvent {
  /** Millisecondes écoulées depuis le chargement de l'app. */
  t: number;
  category: string;
  data: Record<string, unknown>;
}

const MAX_EVENTS = 100;
const events: DebugEvent[] = [];
const providers = new Map<string, () => Record<string, unknown>>();
const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Journalise un événement (tampon circulaire de 100 entrées). */
export function logDebug(category: string, data: Record<string, unknown> = {}): void {
  events.push({ t: Math.round(now() - startedAt), category, data });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/**
 * Enregistre un fournisseur d'instantané d'état (appelé au moment du rapport).
 * Retourne la fonction de désinscription (à appeler au démontage).
 */
export function registerDebugProvider(
  name: string,
  provider: () => Record<string, unknown>,
): () => void {
  providers.set(name, provider);
  return () => {
    if (providers.get(name) === provider) providers.delete(name);
  };
}

/** Construit le rapport JSON complet ; `extra` s'ajoute tel quel. */
export function buildDebugReport(extra: Record<string, unknown> = {}): string {
  const snapshots: Record<string, unknown> = {};
  for (const [name, provider] of providers) {
    try {
      snapshots[name] = provider();
    } catch (error) {
      snapshots[name] = { erreurFournisseur: String(error) };
    }
  }

  const report = {
    rapport: 'cimes-debug',
    horodatage: typeof Date !== 'undefined' ? new Date().toISOString() : null,
    navigateur: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    ecran:
      typeof window !== 'undefined'
        ? {
            largeur: window.innerWidth,
            hauteur: window.innerHeight,
            dpr: window.devicePixelRatio,
          }
        : null,
    ...extra,
    etats: snapshots,
    journal: [...events],
  };
  return JSON.stringify(report, null, 1);
}

/** Réservé aux tests : vide journal et fournisseurs. */
export function resetDebugForTests(): void {
  events.length = 0;
  providers.clear();
}
