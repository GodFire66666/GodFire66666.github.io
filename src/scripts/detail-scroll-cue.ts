const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let pending: HTMLButtonElement | null = null;
const completions = new WeakMap<HTMLButtonElement, Promise<unknown>>();
const finishing = new WeakSet<HTMLButtonElement>();

function start(cue: HTMLButtonElement) {
  if (completions.has(cue)) return;
  cue.classList.add("detail-scroll-cue--loading");
  cue.setAttribute("aria-busy", "true");
  const ring = cue.querySelector(".detail-scroll-progress")!;
  // Reference timing: 400ms pause, then one clockwise 1250ms sweep.
  const sweepFrames = Array.from({ length: 61 }, (_, index) => {
    const t = index / 60;
    const progress = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    return { strokeDashoffset: String(170 * (1 - progress)) };
  });
  const sweep = ring.animate(
    sweepFrames,
    { delay: reducedMotion.matches ? 0 : 400, duration: reducedMotion.matches ? 0 : 1250,
      easing: "linear", fill: "both" },
  );
  completions.set(cue, sweep.finished.catch(() => {}));
}

async function finish(cue: HTMLButtonElement) {
  if (finishing.has(cue)) return;
  finishing.add(cue);
  const image = document.querySelector<HTMLImageElement>(".detail-hero-media img");
  await Promise.all([completions.get(cue), image?.decode().catch(() => {})]);
  if (!cue.isConnected) return;
  cue.classList.remove("detail-scroll-cue--loading");
  cue.removeAttribute("aria-busy");
  if (reducedMotion.matches) return;
  // Damped spring matching the reference's mass=1, tension=120, friction=14.
  const keyframes = Array.from({ length: 67 }, (_, index) => {
    const t = index / 60;
    const displacement = Math.exp(-7 * t) * (Math.cos(Math.sqrt(71) * t)
      + 7 / Math.sqrt(71) * Math.sin(Math.sqrt(71) * t));
    return { transform: `translateY(${-50 * displacement}px)`,
      opacity: Math.min(1, Math.max(0, 1 - displacement)) };
  });
  keyframes[keyframes.length - 1] = { transform: "translateY(0px)", opacity: 1 };
  cue.querySelector(".detail-scroll-arrow")!.animate(keyframes, { duration: 1100 });
}

window.addEventListener("site-scroll-cue-start", ((event: CustomEvent) => {
  if (pending?.isConnected) return;
  const template = document.querySelector<HTMLTemplateElement>("#detail-scroll-cue-template");
  const cue = template?.content.firstElementChild?.cloneNode(true) as HTMLButtonElement | undefined;
  if (!cue) return;
  pending = cue;
  cue.classList.add("detail-scroll-cue--transition");
  cue.style.setProperty("--detail-hero-bg", event.detail.background);
  cue.style.setProperty("--detail-hero-fg", event.detail.foreground);
  document.getElementById("route-transition-layer")?.append(cue);
  start(cue);
}) as EventListener);

function adoptPending() {
  // The detail shell is a stacking context below the route cover. Keep the
  // live indicator in the persistent layer until that cover is fully gone.
  if (document.querySelector(".route-transition-overlay, .portfolio-canvas--transition")) return;
  const destination = document.querySelector<HTMLButtonElement>("[data-part-detail] .detail-scroll-cue");
  if (!pending || !destination) return;
  const cue = pending;
  destination.replaceWith(cue);
  cue.classList.remove("detail-scroll-cue--transition");
  cue.style.removeProperty("--detail-hero-bg");
  cue.style.removeProperty("--detail-hero-fg");
  pending = null;
}

function initialize() {
  const destination = document.querySelector<HTMLButtonElement>("[data-part-detail] .detail-scroll-cue");
  if (!destination) {
    pending?.remove();
    pending = null;
    return;
  }
  const cue = pending ?? destination;
  if (pending) {
    const colors = getComputedStyle(destination);
    cue.style.setProperty("--detail-hero-bg", colors.getPropertyValue("--detail-hero-bg"));
    cue.style.setProperty("--detail-hero-fg", colors.getPropertyValue("--detail-hero-fg"));
  }
  start(cue);
  void finish(cue);
  adoptPending();
}

window.addEventListener("site-detail-revealed", adoptPending);
document.addEventListener("astro:page-load", initialize);
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const cue = event.target.closest("[data-part-detail] .detail-scroll-cue");
  if (!cue || cue.getAttribute("aria-busy") === "true") return;
  document.querySelector(".detail-overview, .detail-content")?.scrollIntoView({
    behavior: reducedMotion.matches ? "instant" : "smooth", block: "start",
  });
});
