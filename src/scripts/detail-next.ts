import { navigate } from "astro:transitions/client";

let controller: AbortController | undefined;
let observer: IntersectionObserver | undefined;
let frame = 0;
let changing = false;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function initializeNextPart() {
  controller?.abort();
  observer?.disconnect();
  cancelAnimationFrame(frame);
  const section = document.querySelector<HTMLElement>("[data-detail-next]");
  const link = section?.querySelector<HTMLAnchorElement>("[data-next-part-link]");
  const media = section?.querySelector<HTMLElement>("[data-next-media]");
  const stage = section?.querySelector<HTMLElement>(".detail-next-stage");
  if (!section || !link || !media || !stage) return;

  controller = new AbortController();
  const { signal } = controller;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const header = document.querySelector<HTMLElement>(".page-shell > .site-header--detail");
  const channels = getComputedStyle(section).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [255, 255, 255];
  const luminance = channels.reduce((sum, channel, index) => {
    const s = channel / 255;
    return sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  const teaserForeground = luminance > 0.179 ? "#111719" : "#ffffff";
  let destination: Promise<Document | null> | undefined;
  let scrolledDown = false;
  let lastScroll = scrollY;

  function preload() {
    destination ??= fetch(link!.href, { signal })
      .then((response) => response.ok ? response.text() : Promise.reject())
      .then((html) => new DOMParser().parseFromString(html, "text/html"))
      .catch(() => null);
    return destination;
  }

  function update() {
    if (signal.aborted || !section || !stage || !media) return;
    const top = section.getBoundingClientRect().top;
    const progress = clamp((innerHeight - top) / innerHeight);
    if (top <= 90) header?.style.setProperty("--detail-fg", teaserForeground);
    else header?.style.removeProperty("--detail-fg");
    section.style.setProperty("--next-progress", String(progress));
    section.style.setProperty("--next-gray", `${(1 - progress) * 100}%`);
    if (progress > 0.12) section.classList.add("is-revealed");
    if (progress === 0) section.classList.remove("is-revealed");

    // Match the outline's clipping polygon to the rotated image, not its bounding box.
    const stageRect = stage.getBoundingClientRect();
    const rect = media.getBoundingClientRect();
    const cx = rect.left + rect.width / 2 - stageRect.left;
    const cy = rect.top + rect.height / 2 - stageRect.top;
    const halfWidth = media.offsetWidth * 0.88 / 2;
    const halfHeight = media.offsetHeight * 0.88 / 2;
    const angle = -6 * Math.PI / 180;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
      const px = cx + x * halfWidth * Math.cos(angle) - y * halfHeight * Math.sin(angle);
      const py = cy + x * halfWidth * Math.sin(angle) + y * halfHeight * Math.cos(angle);
      return `${px}px ${py}px`;
    });
    section.style.setProperty("--next-image-clip", `polygon(${corners.join(",")})`);

    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    if (atEnd && scrolledDown && finePointer.matches && !reduced.matches && !changing) {
      void enterNextPart();
    }
  }

  function fitTitles() {
    section!.querySelectorAll<HTMLElement>(".detail-next-title").forEach((title) => {
      title.style.fontSize = "";
      if (innerWidth <= 700) return;
      const size = parseFloat(getComputedStyle(title).fontSize);
      const text = title.querySelector<HTMLElement>(document.documentElement.classList.contains("lang-zh") ? ".zh-text" : ".en-text");
      if (!text) return;
      const available = stage!.clientWidth * 0.84;
      const width = text.getBoundingClientRect().width;
      if (width > available) title.style.fontSize = `${size * available / width}px`;
    });
    update();
  }

  async function enterNextPart() {
    if (changing || !section || !link || !media) return;
    changing = true;
    if (reduced.matches) {
      await navigate(link.href);
      changing = false;
      return;
    }

    document.documentElement.classList.add("route-cursor-loading");
    let timeout = 0;
    const page = await Promise.race([
      preload(),
      new Promise<null>((resolve) => { timeout = window.setTimeout(() => resolve(null), 5000); }),
    ]);
    clearTimeout(timeout);
    if (signal.aborted) { changing = false; return; }
    const article = page?.querySelector<HTMLElement>("[data-part-detail]");
    const hero = article?.querySelector<HTMLElement>(".detail-hero");
    if (!article || !hero) {
      await navigate(link.href);
      changing = false;
      return;
    }

    const sourceRect = media.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.className = "route-transition-overlay route-transition-overlay--prepared detail-next-handoff";
    overlay.style.cssText = article.style.cssText;
    const endColor = article.style.getPropertyValue("--detail-hero-bg");
    const endForeground = article.style.getPropertyValue("--detail-hero-fg");
    overlay.style.setProperty("--next-start-bg", link.dataset.transitionColor ?? "#fff");
    overlay.style.setProperty("--next-end-bg", endColor);
    overlay.style.setProperty("--detail-fg", endForeground);
    overlay.style.setProperty("--detail-bg", endColor);
    const wrapper = document.createElement("div");
    wrapper.className = "part-detail detail-entered";
    const nextHero = hero.cloneNode(true) as HTMLElement;
    nextHero.querySelector(".detail-scroll-cue")?.remove();
    nextHero.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    wrapper.append(nextHero);
    overlay.append(wrapper);
    const header = page?.querySelector(".site-header--detail")?.cloneNode(true) as HTMLElement | undefined;
    if (header) overlay.append(header);
    document.getElementById("route-transition-layer")?.append(overlay);

    const nextMedia = nextHero.querySelector<HTMLElement>(".detail-hero-media")!;
    const target = nextMedia.getBoundingClientRect();
    const baseTransform = getComputedStyle(nextMedia).transform;
    const dx = sourceRect.left + sourceRect.width / 2 - target.left - target.width / 2;
    const dy = sourceRect.top + sourceRect.height / 2 - target.top - target.height / 2;
    const sx = media.offsetWidth * 0.88 / target.width;
    const sy = media.offsetHeight * 0.88 / target.height;
    nextMedia.animate([
      { transform: `${baseTransform} translate(${dx}px, ${dy}px) rotate(-6deg) scale(${sx}, ${sy})` },
      { transform: baseTransform },
    ], { duration: 650, easing: "cubic-bezier(.65,0,.35,1)", fill: "both" });

    nextHero.querySelectorAll<HTMLElement>(".detail-title-display:not(.detail-title--visually-hidden)").forEach((title) => {
      title.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0)" }], {
        duration: 400, delay: 250, fill: "both", easing: "cubic-bezier(.65,0,.35,1)",
      });
    });
    const title = nextHero.querySelector<HTMLElement>(".detail-title-display:not(.detail-title--visually-hidden)");
    const words = title ? [...title.querySelectorAll<HTMLElement>(".detail-title-word, .zh-text")]
      .map((word) => word.getBoundingClientRect()).filter((rect) => rect.width > 0) : [];
    if (words.length) {
      const mask = document.createElement("div");
      mask.className = "detail-next-handoff-mask";
      const left = Math.min(...words.map((rect) => rect.left));
      const top = Math.min(...words.map((rect) => rect.top));
      mask.style.cssText = `left:${left}px;top:${top}px;width:${Math.max(...words.map((rect) => rect.right)) - left}px;height:${Math.max(...words.map((rect) => rect.bottom)) - top}px;`;
      overlay.append(mask);
    }

    document.documentElement.classList.add("route-transition-leaving");
    window.dispatchEvent(new CustomEvent("site-scroll-cue-start", { detail: {
      background: endColor, foreground: endForeground,
    } }));
    await nextFrame();
    overlay.classList.add("active");
    try { sessionStorage.setItem("yucong-route-transition", "1"); } catch { /* Storage may be disabled. */ }
    await new Promise((resolve) => setTimeout(resolve, 650));
    try {
      await navigate(link.href);
    } catch {
      overlay.remove();
      location.assign(link.href);
    }
  }

  link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void enterNextPart();
  }, { capture: true, signal });

  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) void preload();
  }, { rootMargin: "150% 0px" });
  observer.observe(section);
  window.addEventListener("scroll", () => {
    scrolledDown = scrollY > lastScroll;
    lastScroll = scrollY;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }, { passive: true, signal });
  window.addEventListener("resize", fitTitles, { signal });
  document.fonts.ready.then(() => { if (!signal.aborted) fitTitles(); });
  update();
}

// Discard wheel inertia during the shared-image handoff so it cannot scroll the new hero.
window.addEventListener("wheel", (event) => { if (changing) event.preventDefault(); }, { passive: false });
window.addEventListener("site-detail-revealed", () => { changing = false; });
document.addEventListener("astro:page-load", initializeNextPart);
document.addEventListener("astro:before-swap", () => {
  controller?.abort();
  observer?.disconnect();
  cancelAnimationFrame(frame);
});
initializeNextPart();
