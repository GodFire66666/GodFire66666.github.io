import {
  Group,
  LinearFilter,
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
    focusX: number;
    focusY: number;
    href: string;
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
const SPRING_MASS = 2.5;
const SPRING_TENSION = 80;
const SPRING_FRICTION = 24;

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
    float photoScale = 1.05 + 0.11 * distanceFromCenter;
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
  const home = document.querySelector<HTMLElement>("[data-portfolio-home]");
  const canvas = document.querySelector<HTMLCanvasElement>(
    "[data-portfolio-canvas]",
  );
  const sceneElements = Array.from(
    document.querySelectorAll<HTMLElement>("[data-scene-index]"),
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (!home || !canvas || sceneElements.length === 0 || reducedMotion.matches)
    return;

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
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = SRGBColorSpace;

  const webglScene = new Scene();
  const reelStage = new Group();
  webglScene.add(reelStage);

  const camera = new PerspectiveCamera(startsOnMobile ? 38 : 15, 1, 0.1, 30);
  camera.position.z = startsOnMobile ? 5 : 5.8;

  const loader = new TextureLoader();
  const textures = await Promise.all(
    sceneElements.map((scene) =>
      loader.loadAsync(scene.dataset.sceneImage ?? ""),
    ),
  );
  textures.forEach((texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
  });

  const groups = textures.map((texture, index) => {
    const scene = sceneElements[index];
    const material = new ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uResolution: { value: new Vector2(1, 1) },
        uPointer: { value: new Vector2() },
        uUvOffset: { value: new Vector2() },
        uUvScale: { value: new Vector2(1, 1) },
        uDistance: { value: 0 },
        uBrightness: { value: Number(scene?.dataset.sceneBrightness ?? "1") },
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
      focusX: Number(scene?.dataset.sceneFocusX ?? "0.5"),
      focusY: Number(scene?.dataset.sceneFocusY ?? "0.5"),
      href: scene?.dataset.sceneHref ?? "",
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
  let wheelIdleTimer = 0;
  let visibleHeight = 1;
  let visibleWidth = 1;
  let desktopStep = 1;
  let animationFrame = 0;
  let previousFrameTime = performance.now();
  let mobileTransitionFrom = initialIndex;
  let mobileTransitionStartedAt = 0;

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

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const mobile = isMobile();

    renderer.setPixelRatio(mobile ? Math.min(window.devicePixelRatio, 1.2) : 1);
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

    if (mobile) {
      reelStage.position.set(0, 0, 0);
      reelStage.rotation.set(0, 0, 0);
    } else {
      desktopStep = groups[0].userData.baseHeight * 1.02;
      reelStage.position.set(
        visibleWidth * 0.17,
        -visibleHeight * 0.01,
        0.3,
      );
      reelStage.rotation.set(-0.18, -0.25, -0.06);
    }

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

  function settleWheelGesture() {
    const direction = Math.sign(wheelAccumulator);
    if (direction === 0 || Math.abs(wheelAccumulator) < 0.025) {
      wheelAccumulator = 0;
      targetProgress = committedVirtualIndex;
      return;
    }

    const steps = Math.min(
      groups.length - 1,
      Math.max(1, Math.round(Math.abs(wheelAccumulator))),
    );
    committedVirtualIndex += direction * steps;
    wheelAccumulator = 0;
    targetProgress = committedVirtualIndex;
    dispatchSceneChange(committedVirtualIndex, direction);
  }

  function handleWheel(event: WheelEvent) {
    if (
      isMobile() ||
      event.ctrlKey ||
      Math.abs(event.deltaY) <= Math.abs(event.deltaX)
    )
      return;
    event.preventDefault();

    const delta = normalizeWheelDelta(event);
    if (Math.abs(delta) < 0.2) return;
    const maximumTravel = groups.length - 1 + 0.35;
    wheelAccumulator = Math.max(
      -maximumTravel,
      Math.min(maximumTravel, wheelAccumulator + delta * WHEEL_FRICTION),
    );
    targetProgress = committedVirtualIndex + wheelAccumulator / desktopStep;

    window.clearTimeout(wheelIdleTimer);
    wheelIdleTimer = window.setTimeout(settleWheelGesture, WHEEL_IDLE_MS);
  }

  function isActiveCardHit(clientX: number, clientY: number) {
    if (
      isMobile() ||
      Math.abs(renderedProgress - committedVirtualIndex) > 0.08
    )
      return false;

    pointerNdc.set(
      (clientX / window.innerWidth) * 2 - 1,
      1 - (clientY / window.innerHeight) * 2,
    );
    webglScene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointerNdc, camera);
    return (
      raycaster.intersectObject(groups[modulo(committedVirtualIndex)], true)
        .length > 0
    );
  }

  function isInteractiveTarget(target: EventTarget | null) {
    return (
      target instanceof Element &&
      Boolean(target.closest("a, button, input, select, textarea"))
    );
  }

  function openActiveCard() {
    const activeGroup = groups[modulo(committedVirtualIndex)];
    const { href, opensExternally } = activeGroup.userData;
    if (!href) return;
    if (opensExternally) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    window.location.assign(href);
  }

  window.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener(
    "pointermove",
    (event) => {
      if (isMobile()) return;
      pointer.set(event.clientX, event.clientY);
      home.classList.toggle(
        "reel-card-hovered",
        !isInteractiveTarget(event.target) &&
          isActiveCardHit(event.clientX, event.clientY),
      );
    },
    { passive: true },
  );
  window.addEventListener("pointerleave", () => {
    home.classList.remove("reel-card-hovered");
  });
  window.addEventListener("click", (event) => {
    if (
      isInteractiveTarget(event.target) ||
      !isActiveCardHit(event.clientX, event.clientY)
    )
      return;
    openActiveCard();
  });
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("portfolio-reel-go-to", (event) => {
    const detail = (event as CustomEvent<ReelGoToDetail>).detail;
    goToIndex(detail.index, detail.immediate);
  });
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
  });

  const timer = new Timer();
  timer.connect(document);

  function render(timestamp: number) {
    animationFrame = 0;
    if (document.hidden) return;

    timer.update(timestamp);
    const elapsed = timer.getElapsed();
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
    applyGroups(renderedProgress);
    groups.forEach((group) => {
      group.userData.material.uniforms.uTime.value = elapsed;
      const materialPointer = group.userData.material.uniforms.uPointer
        .value as Vector2;
      materialPointer.copy(smoothedPointer);
    });
    renderer.render(webglScene, camera);
    animationFrame = window.requestAnimationFrame(render);
  }

  function resumeRendering() {
    if (!document.hidden && animationFrame === 0) {
      previousFrameTime = performance.now();
      animationFrame = window.requestAnimationFrame(render);
    }
  }

  document.addEventListener("visibilitychange", resumeRendering);
  resize();
  home.classList.add("webgl-ready");
  resumeRendering();
}
