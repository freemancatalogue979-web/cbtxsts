import '@fontsource-variable/montserrat';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/cinzel';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {music} from './lib/music';
import {applyFont, applyMode, applySkin, currentFont, currentMode, currentSkin} from './lib/prefs';
import {sfx} from './lib/sfx';
import {bootExperience} from './lib/mode';
import {lockViewport} from './lib/zoomlock';
import {registerServiceWorker} from './lib/pwa';
import {SessionProvider} from './store/session.tsx';
import './index.css';
import './pro.css';
import './pro-mobile.css';
import './pro-premium.css';
import './pro-onboarding.css';
import './pro-intelligence.css';
import './admin-font.css';
import './admin-mobile.css';
import './flashcards.css';
import './form-controls.css';

// Modes (pro/game/fun) and the chosen font family apply before React renders.
applyMode(currentMode());
applyFont(currentFont());
// Day/night applies before paint too — the default is the night arena, with
// daylight one tap away in the personalisation panel.
applySkin(currentSkin());
// Standard / Pro experience + Pro appearance and reading prefs (after the font,
// so Pro's single typeface wins).
bootExperience();

// Offline app shell + "Install app" (production builds only; see public/sw.js).
registerServiceWorker();

// One fixed scale everywhere: no pinch zoom, no double-tap zoom, no ctrl+wheel.
lockViewport();

// Try to autoplay the soundtrack; when the browser refuses (no gesture yet),
// music reports 'blocked' and the shell shows a simple "Start music" button.
music.autoplay();

// Wake the soundtrack when the tab returns (phones suspend audio on lock).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) music.warm();
});

// Browsers only allow audio after a gesture — start the chosen track on the first tap.
for (const gesture of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(
    gesture,
    () => {
      sfx.unlock();
      music.unlock();
      music.warm();
    },
    {once: true, capture: true},
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="app">
      <SessionProvider>
        <App />
      </SessionProvider>
    </ErrorBoundary>
  </StrictMode>,
);
