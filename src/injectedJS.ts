/**
 * This string is injected into the WebView after each page load.
 * It captures touch events using passive listeners so that the page's own
 * scroll / tap behaviour is never blocked.
 *
 * Coordinates are CSS clientX / clientY (viewport-relative, does NOT include
 * scroll offset). On iPhone SE 2nd gen the viewport is 375 × 667 pt.
 *
 * Only a single primary touch is tracked per gesture. Multi-touch support
 * can be added by iterating changedTouches and mapping by touch.identifier.
 */
export const INJECTED_JS = `
(function () {
  if (window.__touchTrackerInstalled) { true; return; }
  window.__touchTrackerInstalled = true;

  var currentStrokeId = null;

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  }

  function send(payload) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (e) {}
  }

  // Send viewport size once on install
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'viewport',
      width: window.innerWidth,
      height: window.innerHeight,
    }));
  } catch (e) {}

  document.addEventListener('touchstart', function (e) {
    var touch = e.changedTouches[0];
    currentStrokeId = genId();
    send({
      type: 'touch',
      phase: 'start',
      x: touch.clientX,
      y: touch.clientY,
      timestamp: Date.now(),
      strokeId: currentStrokeId,
    });
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', function (e) {
    if (!currentStrokeId) return;
    var touch = e.changedTouches[0];
    send({
      type: 'touch',
      phase: 'move',
      x: touch.clientX,
      y: touch.clientY,
      timestamp: Date.now(),
      strokeId: currentStrokeId,
    });
  }, { passive: true, capture: true });

  document.addEventListener('touchend', function (e) {
    if (!currentStrokeId) return;
    var touch = e.changedTouches[0];
    send({
      type: 'touch',
      phase: 'end',
      x: touch.clientX,
      y: touch.clientY,
      timestamp: Date.now(),
      strokeId: currentStrokeId,
    });
    currentStrokeId = null;
  }, { passive: true, capture: true });

  document.addEventListener('touchcancel', function (e) {
    if (!currentStrokeId) return;
    var touch = e.changedTouches[0];
    send({
      type: 'touch',
      phase: 'end',
      x: touch.clientX,
      y: touch.clientY,
      timestamp: Date.now(),
      strokeId: currentStrokeId,
    });
    currentStrokeId = null;
  }, { passive: true, capture: true });

  true;
})();
`;
