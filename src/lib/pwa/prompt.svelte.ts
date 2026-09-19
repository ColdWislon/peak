/**
 * Invite d'installation du navigateur (`beforeinstallprompt`, Chrome/Edge/
 * Samsung Internet). L'événement n'est émis QU'UNE FOIS, très tôt — bien avant
 * que le tiroir de réglages n'existe : on l'écoute donc dès le démarrage de
 * l'app et on garde l'objet, seul capable de déclencher l'invite plus tard.
 * iOS n'émet rien : là, seule la marche à suivre Safari peut être affichée.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Objet conservé hors du $state : ce n'est pas une donnée d'affichage. */
let deferred: BeforeInstallPromptEvent | null = null;

/** État réactif de l'installation, lu par le tiroir de réglages. */
export const installState: { promptReady: boolean; installed: boolean } = $state({
  promptReady: false,
  installed: false,
});

/** Écoute à brancher au démarrage (main.ts), avant que l'invite ne soit émise. */
export function watchInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Sans preventDefault, Chrome affiche sa propre bannière : on préfère
    // l'offrir dans les réglages, au moment choisi par l'utilisateur.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    installState.promptReady = true;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installState.promptReady = false;
    installState.installed = true;
  });
}

/**
 * Déclenche l'invite du navigateur. L'objet n'est utilisable qu'une fois :
 * accepté comme refusé, il est jeté (Chrome en réémettra un plus tard si
 * l'app n'est toujours pas installée).
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'indisponible'> {
  const event = deferred;
  if (!event) return 'indisponible';
  deferred = null;
  installState.promptReady = false;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') installState.installed = true;
    return outcome;
  } catch {
    return 'indisponible';
  }
}
