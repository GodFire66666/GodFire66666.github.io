import {
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Timer,
  Vector2,
  WebGLRenderer,
} from "three";

type ReelGroup = Group & {
  userData: {
    baseHeight: number;
    baseWidth: number;
    focusX: number;
    focusY: number;
    material: ShaderMaterial;
    mobileX: number;
    reelRotation: number;
    reelScale: number;
    shadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
    texture: Texture;
  };
};

const MOBILE_BREAKPOINT = 760;
const FRAME_ASPECT = 4 / 3;

export async function startPortfolioReel() {
  const home = document.querySelector<HTMLElement>("[data-portfolio-home]");
  const canvas = document.querySelector<HTMLCanvasElement>("[data-portfolio-canvas]");
  const sceneElements = Array.from(
    document.querySelectorAll<HTMLElement>("[data-scene-index]"),
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!home || !canvas || sceneElements.length === 0 || reducedMotion.matches) {
    return;
  }

  const startsOnMobile = window.innerWidth <= MOBILE_BREAKPOINT;
  const geometry = new PlaneGeometry(
    1,
    1,
    startsOnMobile ? 10 : 24,
    startsOnMobile ? 8 : 18,
  );
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = SRGBColorSpace;

  const webglScene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 20);
  camera.position.z = 5;

  const loader = new TextureLoader();
  const textures = await Promise.all(
    sceneElements.map((scene) => loader.loadAsync(scene.dataset.sceneImage ?? "")),
  );
  textures.forEach((texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
  });

  const vertexShader = `
    uniform float uTime;
    uniform vec2 uPointer;
    varying vec2 vUv;

    void main() {
      vUv = uv;
      vec3 transformed = position;
      float horizontalCurve = sin(uv.x * 3.14159265) * 0.095;
      float verticalCurve = sin(uv.y * 3.14159265) * 0.025;
      float drift = sin((uv.x * 2.2 + uTime * 0.12) * 3.14159265) * 0.012;
      transformed.z += horizontalCurve + verticalCurve + drift;
      transformed.x += (uv.y - 0.5) * 0.14;
      transformed.x += (uv.y - 0.5) * uPointer.x * 0.045;
      transformed.y += (uv.x - 0.5) * uPointer.y * 0.045;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }
  `;
  const fragmentShader = `
    uniform sampler2D uTexture;
    uniform float uOpacity;
    uniform float uBrightness;
    uniform float uFocus;
    uniform vec2 uUvOffset;
    uniform vec2 uUvScale;
    varying vec2 vUv;

    void main() {
      vec2 sampleUv = vUv * uUvScale + uUvOffset;
      vec4 color = texture2D(uTexture, sampleUv);
      float edge = smoothstep(0.0, 0.035, vUv.x)
        * smoothstep(1.0, 0.965, vUv.x)
        * smoothstep(0.0, 0.035, vUv.y)
        * smoothstep(1.0, 0.965, vUv.y);
      float vignette = 0.9 + 0.1 * (1.0 - distance(vUv, vec2(0.5)));
      float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      vec3 reelColor = mix(vec3(luminance), color.rgb, 0.22 + uFocus * 0.78);
      gl_FragColor = vec4(
        reelColor * vignette * uBrightness,
        color.a * uOpacity * edge
      );
      #include <colorspace_fragment>
    }
  `;

  const groups = textures.map((texture, index) => {
    const scene = sceneElements[index];
    const group = new Group() as ReelGroup;
    const shadow = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: 0x050505,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    shadow.position.set(0.08, -0.09, -0.12);
    shadow.scale.set(1.025, 1.025, 1);

    const material = new ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uOpacity: { value: 0 },
        uBrightness: { value: Number(scene?.dataset.sceneBrightness ?? "1") },
        uFocus: { value: 0 },
        uUvOffset: { value: new Vector2() },
        uUvScale: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uPointer: { value: new Vector2() },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    group.add(shadow, mesh);
    group.userData = {
      baseHeight: 1,
      baseWidth: 1,
      focusX: Number(scene?.dataset.sceneFocusX ?? "0.5"),
      focusY: Number(scene?.dataset.sceneFocusY ?? "0.5"),
      material,
      mobileX: Number(scene?.dataset.sceneMobileX ?? "0"),
      reelRotation: Number(scene?.dataset.sceneRotation ?? "0"),
      reelScale: Number(scene?.dataset.sceneScale ?? "1"),
      shadow,
      texture,
    };
    webglScene.add(group);
    return group;
  });

  const pointer = new Vector2();
  const smoothedPointer = new Vector2();
  const initialIndex = Math.max(
    0,
    sceneElements.findIndex((scene) => scene.classList.contains("active")),
  );
  let targetProgress = initialIndex;
  let smoothedProgress = initialIndex;
  let transitionFrom = initialIndex;
  let transitionStartedAt = 0;
  let visibleHeight = 1;
  let visibleWidth = 1;
  let animationFrame = 0;

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function isCompactMobile() {
    return isMobile() && window.innerHeight < 740;
  }

  function layoutFor(index: number, groupIndex: number) {
    const mobile = isMobile();
    const compactMobile = isCompactMobile();
    const cycle = groups.length;
    const virtualGroupIndex = groupIndex + Math.round((index - groupIndex) / cycle) * cycle;
    const offset = virtualGroupIndex - index;
    const distance = Math.abs(offset);
    const baseY = mobile
      ? -visibleHeight * (compactMobile ? 0.34 : 0.3)
      : 0;
    const gap = visibleHeight * (mobile ? compactMobile ? 0.018 : 0.025 : 0.032);
    const opacity = distance === 0
      ? 1
      : distance === 1
        ? mobile ? 0.28 : 0.58
        : distance === 2
          ? mobile ? 0.04 : 0.12
          : 0;
    const scaleFactor = 1;
    const trackCenter = mobile
      ? visibleWidth * groups[groupIndex].userData.mobileX
      : visibleWidth * 0.19;
    const diagonalShift = visibleWidth * (mobile ? 0.028 : 0.048);
    const x = trackCenter - offset * diagonalShift;
    const step = groups[groupIndex].userData.baseHeight + gap;
    const y = baseY - offset * step;

    return {
      distance,
      opacity,
      scaleFactor,
      shadowOpacity: distance === 0 ? 0.13 : distance === 1 ? 0.035 : 0,
      x,
      y,
    };
  }

  function sizeGroup(group: ReelGroup) {
    const mobile = isMobile();
    const compactMobile = isCompactMobile();
    const image = group.userData.texture.image as { width: number; height: number };
    const imageAspect = image.width / image.height;
    const maxWidth = visibleWidth * (mobile ? compactMobile ? 0.72 : 0.76 : 0.37);
    const maxHeight = visibleHeight * (mobile ? compactMobile ? 0.32 : 0.39 : 0.53);
    const planeWidth = Math.min(maxWidth, maxHeight * FRAME_ASPECT);
    const planeHeight = planeWidth / FRAME_ASPECT;
    group.userData.baseWidth = planeWidth * group.userData.reelScale;
    group.userData.baseHeight = planeHeight * group.userData.reelScale;

    const uvScale = group.userData.material.uniforms.uUvScale.value as Vector2;
    const uvOffset = group.userData.material.uniforms.uUvOffset.value as Vector2;
    if (imageAspect > FRAME_ASPECT) {
      uvScale.set(FRAME_ASPECT / imageAspect, 1);
    } else {
      uvScale.set(1, imageAspect / FRAME_ASPECT);
    }
    uvOffset.set(
      Math.max(0, Math.min(1 - uvScale.x, group.userData.focusX - uvScale.x / 2)),
      Math.max(0, Math.min(1 - uvScale.y, group.userData.focusY - uvScale.y / 2)),
    );
  }

  function applyGroups(progress: number) {
    const lowerIndex = Math.floor(progress);
    const upperIndex = Math.ceil(progress);
    const rawMix = Math.max(0, Math.min(1, progress - lowerIndex));
    const mix = rawMix * rawMix * (3 - 2 * rawMix);

    groups.forEach((group, groupIndex) => {
      const from = layoutFor(lowerIndex, groupIndex);
      const to = layoutFor(upperIndex, groupIndex);
      const interpolate = (start: number, end: number) => start + (end - start) * mix;
      const x = interpolate(from.x, to.x);
      const y = interpolate(from.y, to.y);
      const opacity = interpolate(from.opacity, to.opacity);
      const scaleFactor = interpolate(from.scaleFactor, to.scaleFactor);
      const virtualGroupIndex = groupIndex +
        Math.round((progress - groupIndex) / groups.length) * groups.length;
      const distance = Math.abs(virtualGroupIndex - progress);
      const width = Number(group.userData.baseWidth) * scaleFactor;
      const height = Number(group.userData.baseHeight) * scaleFactor;
      const offset = virtualGroupIndex - progress;
      const rotation =
        (group.userData.reelRotation * Math.PI) / 180 -
        0.026 + Math.max(-1.5, Math.min(1.5, offset)) * 0.009;

      group.position.set(x, y, -Math.min(distance, 2) * 0.055);
      group.scale.set(width, height, 1);
      group.rotation.y = !isMobile()
        ? -0.085 + Math.max(-1, Math.min(1, offset)) * 0.018
        : -0.025;
      group.rotation.z = rotation;
      group.userData.material.uniforms.uOpacity.value = opacity;
      group.userData.material.uniforms.uFocus.value = Math.max(0, 1 - distance);
      group.visible = opacity > 0.005;
      group.userData.shadow.material.opacity = interpolate(
        from.shadowOpacity,
        to.shadowOpacity,
      );
    });
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile() ? 1.2 : 1.4));
    renderer.setSize(width, height, false);
    renderer.setScissorTest(isMobile());
    if (isMobile()) {
      renderer.setScissor(
        0,
        0,
        width,
        Math.round(height * (isCompactMobile() ? 0.34 : 0.39)),
      );
    }

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    visibleHeight =
      2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    visibleWidth = visibleHeight * camera.aspect;
    groups.forEach(sizeGroup);
    applyGroups(smoothedProgress);
  }

  function transitionTo(index: number, immediate = false) {
    if (!Number.isFinite(index)) return;
    if (immediate) {
      targetProgress = index;
      smoothedProgress = index;
      transitionFrom = index;
      applyGroups(index);
      return;
    }

    transitionFrom = smoothedProgress;
    targetProgress = index;
    transitionStartedAt = performance.now();
  }

  window.addEventListener(
    "pointermove",
    (event) => {
      if (isMobile()) return;
      pointer.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1,
      );
    },
    { passive: true },
  );
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("portfolio-scene-change", (event) => {
    const detail = (event as CustomEvent<{
      index: number;
      reelIndex?: number;
      immediate?: boolean;
    }>).detail;
    transitionTo(detail.reelIndex ?? detail.index, detail.immediate);
  });

  const timer = new Timer();
  timer.connect(document);
  function render(timestamp: number) {
    animationFrame = 0;
    if (document.hidden) return;

    timer.update(timestamp);
    const elapsed = timer.getElapsed();
    if (smoothedProgress !== targetProgress) {
      const rawProgress = Math.min(1, (timestamp - transitionStartedAt) / 820);
      const easedProgress = rawProgress < 0.5
        ? 4 * rawProgress * rawProgress * rawProgress
        : 1 - Math.pow(-2 * rawProgress + 2, 3) / 2;
      smoothedProgress = transitionFrom +
        (targetProgress - transitionFrom) * easedProgress;
      if (rawProgress >= 1) smoothedProgress = targetProgress;
    }
    smoothedPointer.lerp(pointer, 0.055);
    applyGroups(smoothedProgress);
    groups.forEach((group) => {
      group.userData.material.uniforms.uTime.value = elapsed;
      group.userData.material.uniforms.uPointer.value.copy(smoothedPointer);
    });
    renderer.render(webglScene, camera);
    animationFrame = window.requestAnimationFrame(render);
  }

  function resumeRendering() {
    if (!document.hidden && animationFrame === 0) {
      animationFrame = window.requestAnimationFrame(render);
    }
  }

  document.addEventListener("visibilitychange", resumeRendering);
  resize();
  home.classList.add("webgl-ready");
  resumeRendering();
}
