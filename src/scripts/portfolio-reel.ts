import {
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
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
    brightness: number;
    cropUvOffset: Vector2;
    cropUvScale: Vector2;
    focusX: number;
    focusY: number;
    href: string;
    imageAspect: number;
    imageWidth?: number;
    material: ShaderMaterial;
    mobileX: number;
    opensExternally: boolean;
    texture: Texture;
  };
};

type ReelGoToDetail = {
  immediate?: boolean;
  index: number;
};

type SceneChangeDetail = {
  direction?: number;
  immediate?: boolean;
  index: number;
  source?: "page" | "reel";
};

const MOBILE_BREAKPOINT = 760;
const FRAME_ASPECT = 1366 / 844;
const DESKTOP_FRAME_ASPECT = FRAME_ASPECT / 1.06;
const WHEEL_FRICTION = 0.0023;
const WHEEL_IDLE_MS = 150;
const WHEEL_RELEASE_MS = 360;
const SPRING_MASS = 2.5;
const SPRING_TENSION = 80;
const SPRING_FRICTION = 24;
const ROUTE_TRANSITION_MS = 900;

let stopActiveReel: (() => void) | undefined;

export function stopPortfolioReel() {
  stopActiveReel?.();
}

const vertexShader = `
  uniform float uTime;
  uniform float uBend;
  uniform float uFloating;
  varying vec2 vUv;

  const float PI = 3.141592653589793;

  void main() {
    vec3 pos = position;
    vUv = uv;

    pos.y -= uBend * (1.0 - sin(uv.x * PI));
    pos.x += uBend * (uv.y * 2.0 - 1.0) * (uv.x * 2.0 - 1.0) * 0.5;

    float floatingWave = sin(uTime * 0.35 * PI) * uFloating;
    pos.y += floatingWave * 0.028;
    pos.x -= floatingWave * 0.007;
    vUv.y += floatingWave * 0.028;
    vUv.x -= floatingWave * 0.007;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  uniform vec2 uUvOffset;
  uniform vec2 uUvScale;
  uniform float uDistance;
  uniform float uBrightness;
  uniform float uFrameZoom;
  uniform float uOpacity;
  varying vec2 vUv;

  const float HALF_PI = 1.5707963267948966;

  mat2 scale2d(vec2 value) {
    return mat2(value.x, 0.0, 0.0, value.y);
  }

  vec2 scaleUv(vec2 uv, float scaleFactor) {
    float parsedScale = 1.0 - (scaleFactor - 1.0);
    uv -= 0.5;
    uv *= scale2d(vec2(parsedScale));
    uv += 0.5;
    return uv;
  }

  vec4 saturateColor(vec4 color, float saturation) {
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    return mix(vec4(vec3(gray), color.a), color, saturation);
  }

  void main() {
    float distanceFromCenter = min(abs(uDistance), 1.0);
    float photoScale = 1.0 + (0.05 + 0.11 * distanceFromCenter) * uFrameZoom;
    vec2 uv = scaleUv(vUv, photoScale);
    uv = uv * uUvScale + uUvOffset;

    vec4 color = texture2D(uTexture, uv);
    color = saturateColor(color, 1.0 - distanceFromCenter);
    color.rgb *= uBrightness;

    vec2 screenUv = gl_FragCoord.xy / uResolution;
    vec2 pointer = vec2(uPointer.x / uResolution.x, 1.0 - uPointer.y / uResolution.y);
    vec2 lightDistance = pointer - screenUv;
    lightDistance.x *= uResolution.x / uResolution.y;
    float lightValue = sin(min(length(lightDistance) / 0.7, 1.0) * HALF_PI);
    float pointerLight = (1.0 - lightValue) * 0.08;
    color.rgb *= 1.0 + pointerLight;
    color.a *= uOpacity;

    gl_FragColor = color;
    #include <colorspace_fragment>
  }
`;

export async function startPortfolioReel() {
  stopPortfolioReel();
  const home = document.querySelector<HTMLElement>("[data-portfolio-home]");
  const canvas = home?.querySelector<HTMLCanvasElement>("[data-portfolio-canvas]");
  const sceneElements = home
    ? Array.from(home.querySelectorAll<HTMLElement>("[data-scene-index]"))
    : [];
  const progressNav = home?.querySelector<HTMLElement>(".portfolio-progress");
  const progressLinks = home
    ? Array.from(home.querySelectorAll<HTMLAnchorElement>(".portfolio-progress a"))
    : [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!home || !canvas || sceneElements.length === 0 || reducedMotion.matches)
    return;

  const controller = new AbortController();
  const { signal } = controller;

  function syncProgressBarWidths() {
    progressLinks.forEach((link) => {
      const label = link.querySelector<HTMLElement>(".portfolio-progress-label");
      if (!label) return;
      const labelWidth = label.getBoundingClientRect().width;
      link.style.setProperty(
        "--progress-label-width",
        `${labelWidth.toFixed(2)}px`,
      );
    });
  }

  syncProgressBarWidths();
  void document.fonts.ready.then(() => {
    if (!signal.aborted) syncProgressBarWidths();
  });
  window.addEventListener("site-language-change", syncProgressBarWidths, {
    signal,
  });
  window.addEventListener("resize", syncProgressBarWidths, { signal });

  const startsOnMobile = window.innerWidth <= MOBILE_BREAKPOINT;
  const geometry = new PlaneGeometry(
    1,
    1,
    startsOnMobile ? 10 : 50,
    startsOnMobile ? 8 : 2,
  );
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = SRGBColorSpace;

  let animationFrame = 0;
  let wheelIdleTimer = 0;
  let wheelReleaseTimer = 0;
  let timer: Timer | undefined;
  let textures: Texture[] = [];
  let groups: ReelGroup[] = [];
  let stopped = false;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    window.clearTimeout(wheelIdleTimer);
    window.clearTimeout(wheelReleaseTimer);
    window.cancelAnimationFrame(animationFrame);
    timer?.disconnect();
    home.classList.remove(
      "webgl-ready",
      "reel-card-hovered",
      "portfolio-navigation-preview",
    );
    if (stopActiveReel === cleanup) stopActiveReel = undefined;

    // Releasing several textures and the WebGL renderer can block the exact
    // frame in which Astro swaps the page. The canvas is already detached, so
    // dispose the GPU resources after the route transition has settled.
    const disposeResources = () => {
      groups.forEach((group) => group.userData.material.dispose());
      textures.forEach((texture) => texture.dispose());
      geometry.dispose();
      renderer.dispose();
    };
    const requestIdle = (
      window as Window & {
        requestIdleCallback?: (
          callback: IdleRequestCallback,
          options?: IdleRequestOptions,
        ) => number;
      }
    ).requestIdleCallback;
    setTimeout(() => {
      if (requestIdle) requestIdle(disposeResources, { timeout: 1200 });
      else disposeResources();
    }, 240);
  };
  stopActiveReel = cleanup;

  const webglScene = new Scene();
  const reelStage = new Group();
  webglScene.add(reelStage);

  const camera = new PerspectiveCamera(startsOnMobile ? 38 : 15, 1, 0.1, 30);
  camera.position.z = startsOnMobile ? 5 : 5.8;

  const loader = new TextureLoader();
  textures = await Promise.all(
    sceneElements.map((scene) =>
      loader.loadAsync(scene.dataset.sceneImage ?? ""),
    ),
  );
  if (signal.aborted || !home.isConnected || !canvas.isConnected) {
    cleanup();
    return;
  }
  textures.forEach((texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = Math.min(
      renderer.capabilities.getMaxAnisotropy(),
      8,
    );
  });

  groups = textures.map((texture, index) => {
    const scene = sceneElements[index];
    const textureImage = texture.image as { height: number; width: number };
    const material = new ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uResolution: { value: new Vector2(1, 1) },
        uPointer: { value: new Vector2() },
        uUvOffset: { value: new Vector2() },
        uUvScale: { value: new Vector2(1, 1) },
        uDistance: { value: 0 },
        uBrightness: { value: Number(scene?.dataset.sceneBrightness ?? "1") },
        uFrameZoom: { value: 1 },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uBend: { value: startsOnMobile ? 0.01 : 0.021 },
        uFloating: { value: startsOnMobile ? 0.25 : 1 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    const group = new Group() as ReelGroup;
    group.add(mesh);
    group.userData = {
      baseHeight: 1,
      baseWidth: 1,
      brightness: Number(scene?.dataset.sceneBrightness ?? "1"),
      cropUvOffset: new Vector2(),
      cropUvScale: new Vector2(1, 1),
      focusX: Number(scene?.dataset.sceneFocusX ?? "0.5"),
      focusY: Number(scene?.dataset.sceneFocusY ?? "0.5"),
      href: scene?.dataset.sceneHref ?? "",
      imageAspect: textureImage.width / textureImage.height,
      imageWidth: Number(scene?.dataset.sceneDetailWidth) || undefined,
      material,
      mobileX: Number(scene?.dataset.sceneMobileX ?? "0"),
      opensExternally: scene?.dataset.sceneExternal === "true",
      texture,
    };
    reelStage.add(group);
    return group;
  });

  const pointer = new Vector2(
    window.innerWidth * 0.5,
    window.innerHeight * 0.5,
  );
  const smoothedPointer = pointer.clone();
  const pointerNdc = new Vector2();
  const raycaster = new Raycaster();
  const initialIndex = Math.max(
    0,
    sceneElements.findIndex((scene) => scene.classList.contains("active")),
  );

  let committedVirtualIndex = initialIndex;
  let targetProgress = initialIndex;
  let renderedProgress = initialIndex;
  let springVelocity = 0;
  let wheelAccumulator = 0;
  let wheelInputLocked = false;
  let settledWheelDirection = 0;
  let visibleHeight = 1;
  let visibleWidth = 1;
  let desktopStep = 1;
  let previousFrameTime = performance.now();
  let mobileTransitionFrom = initialIndex;
  let mobileTransitionStartedAt = 0;
  let navigationPreview = false;
  let navigationPreviewMix = 0;
  let routeTransitionActive = false;
  let routeTransitionDispatched = false;
  let routeTransitionReadyForNavigation = false;
  let routeTransitionStartedAt = 0;
  let routeTransitionMix = 0;
  let firstFrameRendered = false;

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function isCompactMobile() {
    return isMobile() && window.innerHeight < 740;
  }

  function modulo(index: number) {
    return ((index % groups.length) + groups.length) % groups.length;
  }

  function virtualIndexFor(groupIndex: number, progress: number) {
    return (
      groupIndex +
      Math.round((progress - groupIndex) / groups.length) * groups.length
    );
  }

  function nearestVirtualIndex(index: number) {
    return (
      index +
      Math.round((committedVirtualIndex - index) / groups.length) *
        groups.length
    );
  }

  function sizeGroup(group: ReelGroup) {
    const mobile = isMobile();
    const compactMobile = isCompactMobile();
    const image = group.userData.texture.image as {
      height: number;
      width: number;
    };
    const imageAspect = image.width / image.height;

    let planeWidth: number;
    if (mobile) {
      const maxWidth = visibleWidth * (compactMobile ? 0.72 : 0.76);
      const maxHeight = visibleHeight * (compactMobile ? 0.32 : 0.39);
      planeWidth = Math.min(maxWidth, maxHeight * (4 / 3));
      group.userData.baseHeight = planeWidth / (4 / 3);
    } else {
      planeWidth = visibleWidth * 0.42;
      group.userData.baseHeight = planeWidth / DESKTOP_FRAME_ASPECT;
    }
    group.userData.baseWidth = planeWidth;

    const cropAspect = mobile ? 4 / 3 : DESKTOP_FRAME_ASPECT;
    const uvScale = group.userData.material.uniforms.uUvScale.value as Vector2;
    const uvOffset = group.userData.material.uniforms.uUvOffset
      .value as Vector2;
    if (imageAspect > cropAspect) uvScale.set(cropAspect / imageAspect, 1);
    else uvScale.set(1, imageAspect / cropAspect);
    uvOffset.set(
      Math.max(
        0,
        Math.min(1 - uvScale.x, group.userData.focusX - uvScale.x / 2),
      ),
      Math.max(
        0,
        Math.min(1 - uvScale.y, group.userData.focusY - uvScale.y / 2),
      ),
    );
    group.userData.cropUvScale.copy(uvScale);
    group.userData.cropUvOffset.copy(uvOffset);
  }

  function applyDesktopGroups(progress: number) {
    const candidates = groups.map((group, groupIndex) => {
      const virtualIndex = virtualIndexFor(groupIndex, progress);
      const offset = virtualIndex - progress;
      return { distance: Math.abs(offset), group, groupIndex, offset };
    });
    candidates.sort((a, b) => a.distance - b.distance || a.offset - b.offset);
    const visibleGroups = new Set(
      candidates.slice(0, 3).map(({ groupIndex }) => groupIndex),
    );

    groups.forEach((group, groupIndex) => {
      const virtualIndex = virtualIndexFor(groupIndex, progress);
      const offset = virtualIndex - progress;
      const distance = Math.abs(offset);
      const normalizedDistance = Math.min(distance, 1);
      const frameScale = 1 - normalizedDistance * 0.18;
      const frameWidth = group.userData.baseWidth * frameScale;
      const frameHeight = group.userData.baseHeight * frameScale;
      const centerCorrection = -0.06 * offset * group.userData.baseHeight;

      group.position.set(0, -offset * desktopStep + centerCorrection, 0);
      group.rotation.set(0, 0, -0.015);
      group.scale.set(frameWidth, frameHeight, 1);
      group.visible = visibleGroups.has(groupIndex);
      group.userData.material.uniforms.uDistance.value = distance;
      group.userData.material.uniforms.uOpacity.value =
        0.55 + 0.45 * (1 - normalizedDistance);
      group.userData.material.uniforms.uBrightness.value =
        group.userData.brightness;
      const mesh = group.children[0] as Mesh;
      mesh.renderOrder = Math.round((2 - distance) * 10);
    });
  }

  function applyMobileGroups(progress: number) {
    groups.forEach((group, groupIndex) => {
      const virtualIndex = virtualIndexFor(groupIndex, progress);
      const offset = virtualIndex - progress;
      const distance = Math.abs(offset);
      const baseY = -visibleHeight * (isCompactMobile() ? 0.34 : 0.3);
      const gap = visibleHeight * (isCompactMobile() ? 0.018 : 0.025);
      const trackCenter = visibleWidth * group.userData.mobileX;
      const opacity = distance < 0.5 ? 1 : distance < 1.5 ? 0.28 : 0.04;

      group.position.set(
        trackCenter - offset * visibleWidth * 0.028,
        baseY - offset * (group.userData.baseHeight + gap),
        -Math.min(distance, 2) * 0.055,
      );
      group.rotation.set(0, -0.025, -0.026);
      group.scale.set(group.userData.baseWidth, group.userData.baseHeight, 1);
      group.visible = distance < 2.5;
      group.userData.material.uniforms.uDistance.value = distance;
      group.userData.material.uniforms.uOpacity.value = opacity;
    });
  }

  function applyGroups(progress: number) {
    if (isMobile()) applyMobileGroups(progress);
    else applyDesktopGroups(progress);
  }

  function applyReelStageLayout(previewMix: number, routeMix = 0) {
    if (isMobile()) {
      reelStage.position.set(0, 0, 0);
      reelStage.rotation.set(0, 0, 0);
      reelStage.scale.setScalar(1);
      return;
    }

    const startX = visibleWidth * 0.17 * (1 - previewMix);
    const startY = -visibleHeight * 0.01 * (1 - previewMix);
    const startRotationX = -0.18 - 0.14 * previewMix;
    const startRotationY = -0.25 + 0.21 * previewMix;
    const startRotationZ = -0.06 + 0.04 * previewMix;
    const startScale = 1 + 0.08 * previewMix;
    const targetZ = 0.3;
    const targetStageWidthPx = Math.min(
      window.innerWidth,
      window.innerHeight * (16 / 9),
      1846.154,
    );
    const targetStageHeightPx = targetStageWidthPx * (9 / 16);
    const targetStageLeftPx = (window.innerWidth - targetStageWidthPx) / 2;
    const targetStageTopPx = (window.innerHeight - targetStageHeightPx) / 2;
    const activeGroup = groups[modulo(committedVirtualIndex)] ?? groups[0];
    const targetImageAspect = activeGroup?.userData.imageAspect
      ?? DESKTOP_FRAME_ASPECT;
    const targetFrameWidthPx = activeGroup?.userData.imageWidth
      ? targetStageWidthPx * activeGroup.userData.imageWidth / 100
      : Math.min(
        targetStageWidthPx * 0.52,
        targetStageHeightPx * 0.6 * targetImageAspect,
      );
    const targetFrameHeightPx = targetFrameWidthPx / targetImageAspect;
    const targetCenterXPx =
      targetStageLeftPx + (targetStageWidthPx - targetFrameWidthPx) / 2
      + targetFrameWidthPx / 2;
    const targetCenterYPx =
      targetStageTopPx + (targetStageHeightPx - targetFrameHeightPx) / 2
      + targetFrameHeightPx / 2;
    const depthRatio = (camera.position.z - targetZ) / camera.position.z;
    const targetVisibleWidth = visibleWidth * depthRatio;
    const targetVisibleHeight =
      visibleHeight * depthRatio;
    const targetX =
      (targetCenterXPx - window.innerWidth / 2) /
      window.innerWidth * targetVisibleWidth;
    const targetY =
      -(targetCenterYPx - window.innerHeight / 2) /
      window.innerHeight * targetVisibleHeight;
    const targetScaleX = activeGroup
      ? targetVisibleWidth * (targetFrameWidthPx / window.innerWidth)
        / activeGroup.userData.baseWidth
      : 1.17;
    const targetScaleY = activeGroup
      ? targetVisibleHeight * (targetFrameHeightPx / window.innerHeight)
        / activeGroup.userData.baseHeight
      : 1.17;

    reelStage.position.set(
      startX + (targetX - startX) * routeMix,
      startY + (targetY - startY) * routeMix,
      targetZ,
    );
    reelStage.rotation.set(
      startRotationX * (1 - routeMix),
      startRotationY * (1 - routeMix),
      startRotationZ * (1 - routeMix),
    );
    reelStage.scale.set(
      startScale + (targetScaleX - startScale) * routeMix,
      startScale + (targetScaleY - startScale) * routeMix,
      1,
    );
  }

  function applyRouteTransition() {
    if (!routeTransitionActive || isMobile()) return;
    const activeIndex = modulo(committedVirtualIndex);
    groups.forEach((group, groupIndex) => {
      const isActive = groupIndex === activeIndex;
      const material = group.userData.material;
      if (isActive) {
        const uvScale = material.uniforms.uUvScale.value as Vector2;
        const uvOffset = material.uniforms.uUvOffset.value as Vector2;
        uvScale.set(
          group.userData.cropUvScale.x
            + (1 - group.userData.cropUvScale.x) * routeTransitionMix,
          group.userData.cropUvScale.y
            + (1 - group.userData.cropUvScale.y) * routeTransitionMix,
        );
        uvOffset.set(
          group.userData.cropUvOffset.x * (1 - routeTransitionMix),
          group.userData.cropUvOffset.y * (1 - routeTransitionMix),
        );
        group.visible = true;
        group.rotation.z = -0.015 * (1 - routeTransitionMix);
        material.uniforms.uDistance.value = 0;
        material.uniforms.uFrameZoom.value = 1 - routeTransitionMix;
        material.uniforms.uOpacity.value = 1;
        material.uniforms.uBend.value = 0.021 * (1 - routeTransitionMix);
        material.uniforms.uFloating.value = 1 - routeTransitionMix;
      } else {
        material.uniforms.uOpacity.value *= 1 - routeTransitionMix;
        if (routeTransitionMix > 0.98) group.visible = false;
      }
    });
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const mobile = isMobile();

    renderer.setPixelRatio(
      mobile
        ? Math.min(window.devicePixelRatio, 1.2)
        : Math.min(window.devicePixelRatio, 1.5),
    );
    renderer.setSize(width, height, false);
    renderer.setScissorTest(mobile);
    if (mobile) {
      renderer.setScissor(
        0,
        0,
        width,
        Math.round(height * (isCompactMobile() ? 0.34 : 0.39)),
      );
    }

    camera.fov = mobile ? 38 : 15;
    camera.position.z = mobile ? 5 : 5.8;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    visibleHeight =
      2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    visibleWidth = visibleHeight * camera.aspect;
    groups.forEach(sizeGroup);

    if (!mobile) {
      desktopStep = groups[0].userData.baseHeight * 1.02;
    }
    applyReelStageLayout(navigationPreviewMix, routeTransitionMix);

    groups.forEach((group) => {
      const resolution = group.userData.material.uniforms.uResolution
        .value as Vector2;
      resolution.set(renderer.domElement.width, renderer.domElement.height);
    });
    applyGroups(renderedProgress);
  }

  function dispatchSceneChange(
    virtualIndex: number,
    direction: number,
    immediate = false,
  ) {
    window.dispatchEvent(
      new CustomEvent<SceneChangeDetail>("portfolio-scene-change", {
        detail: {
          index: modulo(virtualIndex),
          direction,
          immediate,
          source: "reel",
        },
      }),
    );
  }

  function goToIndex(index: number, immediate = false) {
    const virtualTarget = nearestVirtualIndex(modulo(index));
    const difference = virtualTarget - committedVirtualIndex;
    if (difference === 0 && !immediate) return;
    const direction = Math.sign(difference) || 1;

    committedVirtualIndex = virtualTarget;
    targetProgress = virtualTarget;
    wheelAccumulator = 0;
    wheelInputLocked = false;
    settledWheelDirection = 0;
    window.clearTimeout(wheelIdleTimer);
    window.clearTimeout(wheelReleaseTimer);
    if (immediate) {
      renderedProgress = virtualTarget;
      springVelocity = 0;
      applyGroups(renderedProgress);
    }
    dispatchSceneChange(virtualTarget, direction, immediate);
  }

  function normalizeWheelDelta(event: WheelEvent) {
    let delta = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 50;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
      delta *= window.innerHeight;
    return delta;
  }

  function releaseWheelInput() {
    wheelInputLocked = false;
    settledWheelDirection = 0;
    wheelReleaseTimer = 0;
  }

  function holdWheelInput(direction: number) {
    wheelInputLocked = true;
    settledWheelDirection = direction;
    window.clearTimeout(wheelReleaseTimer);
    wheelReleaseTimer = window.setTimeout(
      releaseWheelInput,
      WHEEL_RELEASE_MS,
    );
  }

  function settleWheelGesture() {
    const direction = Math.sign(wheelAccumulator);
    if (direction === 0 || Math.abs(wheelAccumulator) < 0.025) {
      wheelAccumulator = 0;
      targetProgress = committedVirtualIndex;
      return;
    }

    const steps = Math.min(
      3,
      Math.max(1, Math.round(Math.abs(wheelAccumulator))),
    );
    committedVirtualIndex += direction * steps;
    wheelAccumulator = 0;
    targetProgress = committedVirtualIndex;
    holdWheelInput(direction);
    dispatchSceneChange(committedVirtualIndex, direction);
  }

  function handleWheel(event: WheelEvent) {
    if (
      routeTransitionActive ||
      isMobile() ||
      event.ctrlKey ||
      Math.abs(event.deltaY) <= Math.abs(event.deltaX)
    )
      return;
    event.preventDefault();

    const delta = normalizeWheelDelta(event);
    if (Math.abs(delta) < 0.2) return;
    const direction = Math.sign(delta);
    if (wheelInputLocked) {
      if (direction === settledWheelDirection) {
        holdWheelInput(direction);
        return;
      }
      releaseWheelInput();
    }
    const maximumTravel = groups.length - 1 + 0.35;
    wheelAccumulator = Math.max(
      -maximumTravel,
      Math.min(maximumTravel, wheelAccumulator + delta * WHEEL_FRICTION),
    );
    targetProgress = committedVirtualIndex + wheelAccumulator / desktopStep;

    window.clearTimeout(wheelIdleTimer);
    wheelIdleTimer = window.setTimeout(settleWheelGesture, WHEEL_IDLE_MS);
  }

  function cardHitAt(clientX: number, clientY: number) {
    if (
      isMobile() ||
      Math.abs(renderedProgress - committedVirtualIndex) > 0.08
    )
      return null;

    pointerNdc.set(
      (clientX / window.innerWidth) * 2 - 1,
      1 - (clientY / window.innerHeight) * 2,
    );
    webglScene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = groups
      .map((group, groupIndex) => ({
        distance: Math.abs(
          virtualIndexFor(groupIndex, renderedProgress) - renderedProgress,
        ),
        group,
        groupIndex,
      }))
      .filter(
        ({ group }) =>
          group.visible && raycaster.intersectObject(group, true).length > 0,
      )
      .sort((a, b) => a.distance - b.distance);
    return hits[0] ?? null;
  }

  function isInteractiveTarget(target: EventTarget | null) {
    return (
      target instanceof Element &&
      Boolean(target.closest("a, button, input, select, textarea"))
    );
  }

  function beginRouteTransition(clientX?: number, clientY?: number) {
    if (routeTransitionActive || isMobile()) return false;
    const activeGroup = groups[modulo(committedVirtualIndex)];
    const { href, opensExternally } = activeGroup.userData;
    if (!href) return false;
    if (opensExternally) {
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }

    if (typeof clientX === "number" && typeof clientY === "number") {
      pointer.set(clientX, clientY);
    }
    renderedProgress = committedVirtualIndex;
    targetProgress = committedVirtualIndex;
    springVelocity = 0;
    wheelAccumulator = 0;
    navigationPreview = false;
    navigationPreviewMix = 0;

    // The return transition reuses this exact canvas frame. Render the reel at
    // its committed index before it is captured so a still-moving neighbour
    // can never become the cached Back preview.
    applyReelStageLayout(0, 0);
    applyGroups(renderedProgress);
    renderer.render(webglScene, camera);

    routeTransitionActive = true;
    routeTransitionStartedAt = performance.now();
    home?.classList.remove("portfolio-navigation-preview");
    home?.classList.add("portfolio-card-opening", "reel-card-hovered");
    home?.setAttribute("aria-busy", "true");

    const transitionLayer = document.getElementById("route-transition-layer");
    if (transitionLayer && canvas) {
      canvas.classList.add("portfolio-canvas--transition");
      transitionLayer.append(canvas);
    }

    const activeScene = sceneElements[modulo(committedVirtualIndex)];
    window.dispatchEvent(
      new CustomEvent("site-transition-prepare", {
        detail: {
          href,
          accent: activeScene?.dataset.sceneRail ?? activeScene?.dataset.sceneAccent,
          color: activeScene?.dataset.sceneBackground ?? "#111214",
          sceneId: activeScene?.id,
          image: activeScene?.dataset.sceneImage,
          imageAspect: activeGroup.userData.imageAspect,
          imageWidth: activeGroup.userData.imageWidth,
          imagePosition: activeScene?.dataset.sceneDetailPosition,
        },
      }),
    );
    return true;
  }

  function setNavigationPreview(active: boolean) {
    if (isMobile()) return;
    navigationPreview = active;
    home?.classList.toggle("portfolio-navigation-preview", active);
  }

  progressNav?.addEventListener("pointerenter", () => {
    setNavigationPreview(true);
  }, { signal });

  progressLinks.forEach((link, index) => {
    link.addEventListener("pointerenter", () => {
      setNavigationPreview(true);
      goToIndex(index);
    }, { signal });
    link.addEventListener("focus", () => {
      setNavigationPreview(true);
    }, { signal });
  });
  progressNav?.addEventListener("pointerleave", () => {
    setNavigationPreview(false);
  }, { signal });
  progressNav?.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (signal.aborted) return;
      setNavigationPreview(progressNav.contains(document.activeElement));
    });
  }, { signal });

  window.addEventListener("wheel", handleWheel, { passive: false, signal });
  window.addEventListener(
    "pointermove",
    (event) => {
      if (isMobile()) return;
      pointer.set(event.clientX, event.clientY);
      if (routeTransitionActive) return;
      home.classList.toggle(
        "reel-card-hovered",
        !isInteractiveTarget(event.target) &&
          Boolean(cardHitAt(event.clientX, event.clientY)),
      );
    },
    { passive: true, signal },
  );
  window.addEventListener("pointerleave", () => {
    if (routeTransitionActive) return;
    home.classList.remove("reel-card-hovered");
  }, { signal });
  window.addEventListener("click", (event) => {
    if (routeTransitionActive) return;
    if (isInteractiveTarget(event.target)) return;
    const hit = cardHitAt(event.clientX, event.clientY);
    if (!hit) return;
    if (hit.distance < 0.5) {
      beginRouteTransition(event.clientX, event.clientY);
    }
    else goToIndex(hit.groupIndex);
  }, { signal });
  window.addEventListener("portfolio-reel-open-request", (event) => {
    const request = event as CustomEvent<{ clientX?: number; clientY?: number }>;
    if (beginRouteTransition(request.detail?.clientX, request.detail?.clientY)) {
      event.preventDefault();
    }
  }, { signal });
  window.addEventListener("resize", resize, { passive: true, signal });
  window.addEventListener("portfolio-reel-go-to", (event) => {
    const detail = (event as CustomEvent<ReelGoToDetail>).detail;
    goToIndex(detail.index, detail.immediate);
  }, { signal });
  window.addEventListener("portfolio-scene-change", (event) => {
    if (!isMobile()) return;
    const detail = (event as CustomEvent<SceneChangeDetail>).detail;
    const nextVirtualIndex = nearestVirtualIndex(detail.index);
    committedVirtualIndex = nextVirtualIndex;
    targetProgress = nextVirtualIndex;
    if (detail.immediate) {
      renderedProgress = nextVirtualIndex;
      springVelocity = 0;
    } else {
      mobileTransitionFrom = renderedProgress;
      mobileTransitionStartedAt = performance.now();
    }
  }, { signal });

  timer = new Timer();
  timer.connect(document);

  function render(timestamp: number) {
    animationFrame = 0;
    if (document.hidden) return;

    timer?.update(timestamp);
    const elapsed = timer?.getElapsed() ?? 0;
    const deltaTime = Math.min(
      0.032,
      Math.max(0.001, (timestamp - previousFrameTime) / 1000),
    );
    previousFrameTime = timestamp;

    if (isMobile()) {
      if (renderedProgress !== targetProgress) {
        const rawProgress = Math.min(
          1,
          (timestamp - mobileTransitionStartedAt) / 820,
        );
        const easedProgress =
          rawProgress < 0.5
            ? 4 * rawProgress * rawProgress * rawProgress
            : 1 - Math.pow(-2 * rawProgress + 2, 3) / 2;
        renderedProgress =
          mobileTransitionFrom +
          (targetProgress - mobileTransitionFrom) * easedProgress;
        if (rawProgress >= 1) renderedProgress = targetProgress;
      }
    } else {
      const springForce = SPRING_TENSION * (targetProgress - renderedProgress);
      const dampingForce = SPRING_FRICTION * springVelocity;
      springVelocity +=
        ((springForce - dampingForce) / SPRING_MASS) * deltaTime;
      renderedProgress += springVelocity * deltaTime;
      if (
        Math.abs(targetProgress - renderedProgress) < 0.0001 &&
        Math.abs(springVelocity) < 0.0001
      ) {
        renderedProgress = targetProgress;
        springVelocity = 0;
      }
    }

    smoothedPointer.lerp(pointer, 0.055);
    if (routeTransitionActive) {
      const rawRouteProgress = Math.min(
        1,
        (timestamp - routeTransitionStartedAt) / ROUTE_TRANSITION_MS,
      );
      routeTransitionMix = rawRouteProgress < 0.5
        ? 8 * Math.pow(rawRouteProgress, 4)
        : 1 - Math.pow(-2 * rawRouteProgress + 2, 4) / 2;
      // The destination is already loading. Release its DOM swap only once
      // the persistent card and color wipe fully cover the home page.
      routeTransitionReadyForNavigation = rawRouteProgress >= 0.84;
      if (rawRouteProgress >= 1) routeTransitionMix = 1;
    }
    const previewTarget = navigationPreview ? 1 : 0;
    navigationPreviewMix +=
      (previewTarget - navigationPreviewMix) *
      (1 - Math.exp(-deltaTime * 6.5));
    if (Math.abs(previewTarget - navigationPreviewMix) < 0.0005)
      navigationPreviewMix = previewTarget;
    applyReelStageLayout(navigationPreviewMix, routeTransitionMix);
    applyGroups(renderedProgress);
    applyRouteTransition();
    groups.forEach((group) => {
      group.userData.material.uniforms.uTime.value = elapsed;
      const materialPointer = group.userData.material.uniforms.uPointer
        .value as Vector2;
      materialPointer.copy(smoothedPointer);
    });
    renderer.render(webglScene, camera);
    if (
      routeTransitionActive &&
      routeTransitionReadyForNavigation &&
      !routeTransitionDispatched
    ) {
      routeTransitionDispatched = true;
      const activeScene = sceneElements[modulo(committedVirtualIndex)];
      const activeGroup = groups[modulo(committedVirtualIndex)];
      window.dispatchEvent(
        new CustomEvent("site-transition-handoff", {
          detail: {
            href: activeGroup.userData.href,
            accent: activeScene?.dataset.sceneRail ?? activeScene?.dataset.sceneAccent,
            color: activeScene?.dataset.sceneBackground ?? "#111214",
            sceneId: activeScene?.id,
            image: activeScene?.dataset.sceneImage,
            imageAspect: activeGroup.userData.imageAspect,
            imageWidth: activeGroup.userData.imageWidth,
            imagePosition: activeScene?.dataset.sceneDetailPosition,
          },
        }),
      );
    }
    if (!firstFrameRendered) {
      firstFrameRendered = true;
      window.dispatchEvent(new CustomEvent("portfolio-home-ready", {
        detail: { sceneId: sceneElements[modulo(committedVirtualIndex)]?.id },
      }));
    }
    animationFrame = window.requestAnimationFrame(render);
  }

  function resumeRendering() {
    if (!document.hidden && animationFrame === 0) {
      previousFrameTime = performance.now();
      animationFrame = window.requestAnimationFrame(render);
    }
  }

  document.addEventListener("visibilitychange", resumeRendering, { signal });
  resize();
  home.classList.add("webgl-ready");
  resumeRendering();
  return cleanup;
}
