// iOS Safari (especially as an installed app) sometimes leaves pinned bars where they were while
// the keyboard was open, or doesn't repaint them after the app returns from the background: the
// tab bar ends up stuck mid-screen until you scroll. A one-pixel scroll and back makes WebKit
// lay them out again. Only runs on iOS, at those moments, so it's invisible.

const isIOS = typeof navigator !== 'undefined'
  && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const typing = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
};

let pending = 0;
function nudge() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    if (typing()) return;
    const { scrollX: x, scrollY: y } = window;
    window.scrollTo(x, y + 1);
    window.scrollTo(x, y);
  });
}

/**
 * After the keyboard closes, iOS can leave the visible screen shifted down from where the page
 * thinks it is (visualViewport.offsetTop stays above zero). Everything pinned to the top or bottom
 * then sits too high: the toolbar is off the top and the tab bar floats mid-screen. Publish the
 * shift as --vv-top so the pinned bars (styles.css) move by the same amount and stay in place.
 */
function followVisibleScreen() {
  const vv = window.visualViewport;
  if (!vv) return;
  let frame = 0;
  let last = -1;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const top = Math.max(0, Math.round(vv.offsetTop));
      if (top === last) return;
      last = top;
      document.documentElement.style.setProperty('--vv-top', `${top}px`);
    });
  };
  vv.addEventListener('scroll', update);
  vv.addEventListener('resize', update);
  window.addEventListener('scroll', update, { passive: true });
  document.addEventListener('visibilitychange', update);
  update();
}

export function fixStuckBars() {
  if (!isIOS) return;
  followVisibleScreen();
  // Keyboard closed: focus left a text field and didn't move to another one.
  document.addEventListener('focusout', () => setTimeout(nudge, 120));
  // The visible area grew back (keyboard gone) or the app came back to the foreground.
  let lastHeight = window.visualViewport?.height ?? window.innerHeight;
  window.visualViewport?.addEventListener('resize', () => {
    const h = window.visualViewport!.height;
    if (h > lastHeight + 40) nudge();
    lastHeight = h;
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(nudge, 50); });
  window.addEventListener('pageshow', () => setTimeout(nudge, 50));
}
