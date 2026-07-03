/**
 * Tour engine. Reads window.__currentPage and window.__toursSeen,
 * then starts the matching Shepherd.js tour if this page hasn't been seen.
 */

import Shepherd from '/js/shepherd.mjs';
import { TOURS } from '/js/tours.js?v=2';

const PAGE       = window.__currentPage;
const TOURS_SEEN = window.__toursSeen || {};

// Show the tour UNLESS this page has been explicitly marked seen (=== true).
// A missing/undefined flag means "not seen yet" -> show it, so any code path
// that forgets to initialize toursSeen can't silently suppress the tour.
if (TOURS[PAGE] && TOURS_SEEN[PAGE] !== true) {
  // Delay so page-specific scripts finish rendering dynamic content.
  setTimeout(startTour, 800);
}

async function markSeen(page) {
  try {
    await fetch('/api/tour-seen', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ page }),
    });
  } catch (_) { /* best effort */ }
}

const BUTTON_DEFS = {
  skip: (tour) => ({
    text:    'Skip tour',
    classes: 'shepherd-btn-skip',
    action() { tour.cancel(); },
  }),
  back: (tour) => ({
    text:    'Back',
    classes: 'shepherd-btn-back',
    action() { tour.back(); },
  }),
  next: (tour) => ({
    text:    'Next',
    classes: 'shepherd-btn-next',
    action() { tour.next(); },
  }),
  finish: (tour) => ({
    text:    'Got it',
    classes: 'shepherd-btn-finish',
    action() { tour.complete(); },
  }),
};

function startTour() {
  const steps = TOURS[PAGE];
  if (!steps || steps.length === 0) return;

  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions: {
      scrollTo:   { behavior: 'smooth', block: 'center' },
      cancelIcon: { enabled: true, label: 'Skip tour' },
      classes:    'iron-ink-tour-step',
    },
  });

  steps.forEach((def) => {
    const stepOpts = {
      id:      def.id,
      title:   def.title,
      text:    def.text,
      buttons: def.buttons.map((type) => {
        const builder = BUTTON_DEFS[type];
        return builder ? builder(tour) : BUTTON_DEFS.next(tour);
      }),
    };
    if (def.attachTo) stepOpts.attachTo = def.attachTo;
    tour.addStep(stepOpts);
  });

  tour.on('complete', () => markSeen(PAGE));
  tour.on('cancel',   () => markSeen(PAGE));

  tour.start();
}
