import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Élément #app introuvable dans index.html');
}

const app = mount(App, { target });

// PWA : service worker en production seulement (en dev il masquerait le HMR).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .catch(() => {
      // Hors-ligne indisponible : l'app fonctionne normalement en ligne.
    });
}

export default app;
