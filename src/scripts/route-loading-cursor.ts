let releaseTimer = 0;
let fallbackTimer = 0;

function clearLoadingCursor() {
  window.clearTimeout(releaseTimer);
  window.clearTimeout(fallbackTimer);
  releaseTimer = 0;
  fallbackTimer = 0;
  document.documentElement.classList.remove("route-cursor-loading");
}

function startLoadingCursor() {
  window.clearTimeout(releaseTimer);
  window.clearTimeout(fallbackTimer);
  document.documentElement.classList.add("route-cursor-loading");
  // A failed or superseded navigation must not leave a permanent busy cursor.
  fallbackTimer = window.setTimeout(clearLoadingCursor, 10000);
}

function finishLoadingCursor() {
  window.clearTimeout(releaseTimer);
  releaseTimer = window.setTimeout(clearLoadingCursor, 500);
}

window.addEventListener("site-scroll-cue-start", startLoadingCursor);
document.addEventListener("astro:before-preparation", startLoadingCursor);
document.addEventListener("astro:after-swap", () => {
  // Astro replaces the HTML attributes while the visual transition continues.
  if (fallbackTimer) document.documentElement.classList.add("route-cursor-loading");
});
document.addEventListener("astro:page-load", () => {
  if (!document.querySelector(".route-transition-overlay--prepared")) finishLoadingCursor();
});
window.addEventListener("site-detail-revealed", finishLoadingCursor);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) clearLoadingCursor();
});
