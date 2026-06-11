import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { PointCloudModel } from "./point-cloud-model";
import "./styles.css";

export type ViewerSettings = {
  density: number;
  particleSize: number;
  glow: number;
  rotationSpeed: number;
  colorIntensity: number;
  spread: number;
};

export type DetailInteractionPoint = {
  active: boolean;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  velocityX: number;
  velocityY: number;
  speed: number;
};

const MAX_DENSITY = 500_000;
const ENTRY_LOADING_DURATION_MS = 5800;
const MODEL_DISPLAY_POSITION: [number, number, number] = [0, -0.18, 0];

type PlanetKey = "baby" | "plant" | "party" | "dress" | "bath" | "cats" | "20s";

const DETAIL_INITIAL_ROTATIONS: Record<PlanetKey, [number, number, number]> = {
  baby: [0, -0.28, 0],
  bath: [0, 0.08, 0],
  cats: [0, -0.36, 0],
  plant: [0, -0.16, 0],
  dress: [0, 0.34, 0],
  "20s": [0, -0.42, 0],
  party: [0, 0.18, 0]
};

type ProductContent = {
  name: string;
  image: string;
};

type PlanetContent = {
  id: PlanetKey;
  pointDataUrl?: string;
  floatingPointDataUrl?: string;
  floatingPointDataUrls?: string[];
  entryLabel: string;
  title: string;
  description: string[];
  products: ProductContent[];
};

const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;

const PLANETS: Record<PlanetKey, PlanetContent> = {
  baby: {
    id: "baby",
    pointDataUrl: "models/lg-model-baby2-base-points",
    floatingPointDataUrls: [
      "models/lg-model-baby2-vacuum-points",
      "models/lg-model-baby2-tv-points",
      "models/lg-model-baby2-air-points"
    ],
    entryLabel: "육아 부부",
    title: "육아 부부의 행성",
    description: [
      "아기의 생활 리듬과 부모의 휴식에 맞춰 공기, 청결, 조명이 부드럽게 반응하는 공간.",
      "하루 종일 바닥에서 머무는 아이를 위해, 집은 더 낮고 섬세하게 케어합니다."
    ],
    products: [
      { name: "ThinQ ON AI", image: "images/products/baby/1.png" },
      { name: "코드제로 AI 오브제컬렉션 A9", image: "images/products/baby/2.png" },
      { name: "퓨리케어 AI 오브제컬렉션 360˚ 공기청정기 M5", image: "images/products/baby/3.png" }
    ]
  },
  plant: {
    id: "plant",
    pointDataUrl: "models/lg-model-plant2-base-points",
    floatingPointDataUrl: "models/lg-model-plant2-appliances-points",
    entryLabel: "액티브 시니어 부부",
    title: "액티브 시니어 부부의 행성",
    description: [
      "부부의 하루 리듬과 식물의 성장 주기에 맞춰 건강, 청결, 휴식이 자연스럽게 유지되는 공간.",
      "가사는 덜어내고, 햇살과 식물, 회복의 시간이 더 오래 머무르게 합니다."
    ],
    products: [
      { name: "휘센 AI 오브제컬렉션 타워 I 에어컨 1", image: "images/products/plant/1.png" },
      { name: "코드제로 AI 오브제컬렉션 로보킹 올인원", image: "images/products/plant/2.png" },
      { name: "틔운 미니", image: "images/products/plant/3.png" },
      { name: "힐링미 안마의자 (MX9)", image: "images/products/plant/4.png" }
    ]
  },
  party: {
    id: "party",
    pointDataUrl: "models/lg-model-party-base-points",
    floatingPointDataUrl: "models/lg-model-party-appliances-points",
    entryLabel: "홈파티 부부",
    title: "홈파티 부부의 행성",
    description: [
      "요리하는 리듬과 손님을 맞이하는 분위기에 맞춰 색, 온도, 보관, 조리가 하나의 경험으로 연결되는 공간.",
      "주방은 단순한 조리 공간을 넘어, 취향과 환대가 드러나는 무대가 됩니다."
    ],
    products: [
      { name: "디오스 AI 오브제컬렉션 김치톡톡 Fit & Max", image: "images/products/party/1.png" },
      { name: "디오스 오브제컬렉션 광파오븐", image: "images/products/party/2.png" },
      { name: "디오스 오브제컬렉션 와인셀러", image: "images/products/party/3.png" }
    ]
  },
  dress: {
    id: "dress",
    pointDataUrl: "models/lg-model-dressroom2-base-points",
    floatingPointDataUrl: "models/lg-model-dressroom2-appliances-points",
    entryLabel: "트렌드세터",
    title: "트렌드세터의 행성",
    description: [
      "오늘의 스타일과 기록하고 싶은 순간에 맞춰 의류 관리와 무드가 나를 중심으로 완성되는 공간.",
      "옷을 입고 관리하는 과정까지, 매일의 스타일이 하나의 콘텐츠가 됩니다."
    ],
    products: [
      { name: "ThinQ ON AI", image: "images/products/dress/1.png" },
      { name: "스타일러 오브제컬렉션 슈케어", image: "images/products/dress/2.png" },
      { name: "스타일러 오브제컬렉션", image: "images/products/dress/3.png" }
    ]
  },
  bath: {
    id: "bath",
    pointDataUrl: "models/lg-model-bathroom2-base-points",
    floatingPointDataUrls: [
      "models/lg-model-bathroom2-appliance-1-points",
      "models/lg-model-bathroom2-appliance-2-points",
      "models/lg-model-bathroom2-appliance-3-points"
    ],
    entryLabel: "홈 스파 매니아",
    title: "홈 스파 매니아의 행성",
    description: [
      "나의 회복 루틴과 체온 변화에 맞춰 온도, 습도, 조명이 섬세하게 조율되는 공간.",
      "입욕 전후의 작은 변화까지 감지해, 욕실을 가장 사적인 휴식의 장면으로 만듭니다."
    ],
    products: [
      { name: "ThinQ ON AI", image: "images/products/bath/1.png" },
      { name: "퓨리케어 바스에어시스템", image: "images/products/bath/2.png" },
      { name: "휘센 오브제컬렉션 제습기", image: "images/products/bath/3.png" }
    ]
  },
  cats: {
    id: "cats",
    pointDataUrl: "models/lg-model-cat2-base-points",
    floatingPointDataUrl: "models/lg-model-cat2-appliances-points",
    entryLabel: "반려묘 집사",
    title: "반려묘 집사의 행성",
    description: [
      "고양이의 움직임과 집사의 생활 패턴을 따라 공기와 청결이 유연하게 관리되는 공간.",
      "보이지 않는 털과 먼지까지 따라가며, 사람과 반려동물의 일상을 함께 돌봅니다."
    ],
    products: [
      { name: "AI 오브제컬렉션 에어로캣타워", image: "images/products/cats/1.png" },
      { name: "ThinQ ON AI", image: "images/products/cats/2.png" },
      { name: "코드제로 AI 오브제컬렉션 로보킹 올인원", image: "images/products/cats/3.png" }
    ]
  },
  "20s": {
    id: "20s",
    pointDataUrl: "models/lg-model-20s2-base-points",
    floatingPointDataUrl: "models/lg-model-20s2-appliances-points",
    entryLabel: "영화·게임 러버",
    title: "영화·게임 러버의 행성",
    description: [
      "퇴근 후의 피로와 콘텐츠 몰입도에 맞춰 조도, 사운드, 화면이 하나의 감각으로 정렬되는 공간.",
      "콘텐츠가 시작되는 순간, 거실은 나만의 몰입 세계로 전환됩니다."
    ],
    products: [
      { name: "ThinQ ON AI", image: "images/products/20s/1.png" },
      { name: "스마트 조명 스위치 3구", image: "images/products/20s/2.png" },
      { name: "엑스붐 360", image: "images/products/20s/3.png" },
      { name: "올레드 evo AI", image: "images/products/20s/4.png" }
    ]
  }
};

const PLANET_ORDER: PlanetKey[] = ["baby", "bath", "cats", "plant", "dress", "20s", "party"];

const PLANET_BUTTONS = [
  { className: "pg-planet--a", planet: "baby", texture: "baby-sphere.png", orbit: "4", phase: "2.78", speed: "0.1", label: "육아하는 부부의 행성 선택" },
  { className: "pg-planet--b", planet: "bath", texture: "bath-sphere.png", orbit: "2", phase: "3.46", speed: "0.16", label: "배스 케어의 행성 선택" },
  { className: "pg-planet--c", planet: "plant", texture: "plant-sphere.png", orbit: "3", phase: "5.02", speed: "0.12", label: "식물과 함께 사는 행성 선택" },
  { className: "pg-planet--d", planet: "party", texture: "party-sphere.png", orbit: "4", phase: "6.06", speed: "0.09", label: "파티를 즐기는 행성 선택" },
  { className: "pg-planet--e", planet: "dress", texture: "dress-sphere.png", orbit: "2", phase: "0.78", speed: "0.15", label: "드레스룸의 행성 선택" },
  { className: "pg-planet--f", planet: "20s", texture: "20s-sphere.png", orbit: "1", phase: "4.82", speed: "0.22", label: "20대 싱글의 행성 선택" },
  { className: "pg-planet--g", planet: "cats", texture: "cats-sphere.png", orbit: "2", phase: "2.28", speed: "0.13", label: "반려묘 가족의 행성 선택" }
] satisfies Array<{
  className: string;
  planet: PlanetKey;
  texture: string;
  orbit: string;
  phase: string;
  speed: string;
  label: string;
}>;

const isPlanetKey = (value: string | null | undefined): value is PlanetKey => {
  return value === "baby" || value === "plant" || value === "party" || value === "dress" || value === "bath" || value === "cats" || value === "20s";
};

function preloadPointData() {
  const urls = new Set<string>();

  PLANET_ORDER.forEach((key) => {
    const pointDataUrls = [
      PLANETS[key].pointDataUrl,
      PLANETS[key].floatingPointDataUrl,
      ...(PLANETS[key].floatingPointDataUrls ?? [])
    ].filter((url): url is string => Boolean(url));
    pointDataUrls.forEach((pointDataUrl) => {
      urls.add(assetUrl(`${pointDataUrl}.json`));
      urls.add(assetUrl(`${pointDataUrl}.bin`));
    });
  });

  urls.forEach((url) => {
    void fetch(url, { cache: "force-cache" }).catch(() => undefined);
  });
}

function updateBrowserUrl(view: "home" | "detail", planet: PlanetKey, replace = false) {
  const url = new URL(window.location.href);

  if (view === "detail") {
    url.searchParams.set("view", "detail");
    url.searchParams.set("planet", planet);
  } else {
    url.searchParams.delete("view");
    url.searchParams.delete("planet");
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (nextUrl === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;

  if (replace) {
    window.history.replaceState({ view, planet }, "", nextUrl);
  } else {
    window.history.pushState({ view, planet }, "", nextUrl);
  }
}

const DEFAULT_SETTINGS: ViewerSettings = {
  density: 360_000,
  particleSize: 0.004,
  glow: 0.38,
  rotationSpeed: 0.1,
  colorIntensity: 1,
  spread: 1.04
};

function getStageScale() {
  return Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
}

const ENTRY_PARTICLES = Array.from({ length: 64 }, (_, index) => {
  const angle = index * 137.508;
  const radius = 42 + (index % 32) * 9.5;
  const depth = 0.36 + ((index * 17) % 100) / 100;

  return {
    id: index,
    x: Math.cos((angle * Math.PI) / 180) * radius * depth,
    y: Math.sin((angle * Math.PI) / 180) * radius * depth,
    delay: (index % 24) * 8,
    size: 1.25 + (index % 6) * 0.42,
    opacity: 0.22 + (index % 9) * 0.07
  };
});

function PersonalGravityBrand() {
  return (
    <>
      <svg className="pg-symbol" viewBox="0 0 144 155" aria-hidden="true">
        <path d="M62 0V72H144M0 84H81V155M4 18L58 72M85 84L140 136" />
      </svg>
      <h1>PERSONAL GRAVITY</h1>
    </>
  );
}

function preventTrailingOrphan(text: string) {
  return text.replace(/\s+(\S+)$/, "\u00a0$1");
}

function Scene({
  settings,
  pointDataUrl,
  floatingPointDataUrl,
  floatingPointDataUrls,
  initialRotation,
  viewRotationX = 0,
  viewRotationY = 0,
  viewZoom = 1,
  interactionPoint,
  fixedCamera = false,
  introPaused = false,
  onReady
}: {
  settings: ViewerSettings;
  pointDataUrl?: string;
  floatingPointDataUrl?: string;
  floatingPointDataUrls?: string[];
  initialRotation: [number, number, number];
  viewRotationX?: number;
  viewRotationY?: number;
  viewZoom?: number;
  interactionPoint?: DetailInteractionPoint;
  fixedCamera?: boolean;
  introPaused?: boolean;
  onReady?: () => void;
}) {
  return (
    <Canvas
      className="scene"
      dpr={[1, 2]}
      camera={{ position: [1.25, 1.1, 4.4], fov: 42, near: 0.01, far: 120 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#000000"]} />
      <fog attach="fog" args={["#000000", 4, 11]} />
      <ambientLight intensity={0.8} />

      <Suspense fallback={null}>
        <PointCloudModel
          pointDataUrl={pointDataUrl}
          floatingPointDataUrl={floatingPointDataUrl}
          floatingPointDataUrls={floatingPointDataUrls}
          settings={settings}
          displayPosition={MODEL_DISPLAY_POSITION}
          initialRotation={initialRotation}
          viewRotationX={viewRotationX}
          viewRotationY={viewRotationY}
          viewZoom={viewZoom}
          interactionPoint={interactionPoint}
          introPaused={introPaused}
          onReady={onReady}
        />
      </Suspense>

      <OrbitControls
        makeDefault
        target={MODEL_DISPLAY_POSITION}
        enableDamping
        dampingFactor={0.06}
        minDistance={1.2}
        maxDistance={9}
        enabled={!fixedCamera}
        enablePan={false}
        autoRotate={false}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />

      <EffectComposer multisampling={0}>
        <Bloom intensity={settings.glow} luminanceThreshold={0.05} luminanceSmoothing={0.2} mipmapBlur />
        <Noise opacity={0.055} />
        <Vignette eskil={false} offset={0.18} darkness={0.72} />
      </EffectComposer>
    </Canvas>
  );
}

function HomePage({
  onEnterStart
}: {
  onEnterStart: (planet: PlanetKey) => void;
}) {
  const systemRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLElement>(null);
  const suppressClickRef = useRef(false);
  const [isEntering, setIsEntering] = useState(false);

  const startEnter = (event?: React.MouseEvent<HTMLElement>) => {
    if (isEntering) return;
    if (suppressClickRef.current) {
      event?.preventDefault();
      event?.stopPropagation();
      return;
    }

    const scene = sceneRef.current;
    const target = event?.target instanceof Element ? event.target.closest<HTMLElement>(".pg-planet") : null;
    if (!target) return;
    const source = target;
    const planetCandidate = source?.dataset.planet;
    if (target && !isPlanetKey(planetCandidate)) return;
    const planet = isPlanetKey(planetCandidate) ? planetCandidate : "baby";

    if (scene && source) {
      const rect = source.getBoundingClientRect();
      const planetCenterX = rect.left + rect.width / 2;
      const planetCenterY = rect.top + rect.height / 2;
      scene.style.setProperty("--portal-x", `${planetCenterX}px`);
      scene.style.setProperty("--portal-y", `${planetCenterY}px`);
      scene.style.setProperty("--enter-shift-x", `${window.innerWidth / 2 - planetCenterX}px`);
      scene.style.setProperty("--enter-shift-y", `${window.innerHeight / 2 - planetCenterY}px`);
    }

    onEnterStart(planet);
    setIsEntering(true);
  };

  useEffect(() => {
    const system = systemRef.current;
    if (!system) return undefined;

    const frameInterval = 1000 / 30;
    const orbitProfiles = [
      { rx: 11.5, rz: 8.8 },
      { rx: 23.5, rz: 16.4 },
      { rx: 42.5, rz: 29.2 },
      { rx: 60, rz: 41.2 }
    ];
    const generated = [
      ...orbitProfiles.flatMap((_, orbitIndex) => {
        const count = 34 + orbitIndex * 12;
        return Array.from({ length: count }, (_, index) => {
          const mark = document.createElement("span");
          mark.className = "pg-orbit-mark";
          mark.dataset.orbit = String(orbitIndex + 1);
          mark.dataset.phase = String((index / count) * Math.PI * 2);
          mark.dataset.speed = "0";
          mark.style.setProperty("--size", `${orbitIndex === 0 ? 2.2 : 2.8}px`);
          system.append(mark);
          return mark;
        });
      }),
      ...Array.from({ length: 8 }, (_, index) => {
        const dot = document.createElement("span");
        dot.className = "pg-orbital-dot";
        dot.dataset.orbit = String(1 + (index % 4));
        dot.dataset.phase = String((index * 1.4) % (Math.PI * 2));
        dot.dataset.speed = String(0.06 + (index % 4) * 0.012);
        dot.style.setProperty("--size", `${4 + (index % 3) * 2}px`);
        dot.style.setProperty("--alpha", "0.34");
        system.append(dot);
        return dot;
      })
    ];
    const movers = [...generated, ...system.querySelectorAll<HTMLElement>(".pg-planet")].map((item) => ({
      el: item,
      orbit: Number(item.dataset.orbit || 2),
      phase: Number(item.dataset.phase || 0),
      speed: Number(item.dataset.speed || 0.12),
      isPlanet: item.classList.contains("pg-planet"),
      isOrbit: item.classList.contains("pg-orbit-mark")
    }));
    const rotation = { x: -58, y: 14, z: -10 };
    let zoom = 1;
    let drag: null | {
      id: number;
      x: number;
      y: number;
      lastX: number;
      lastY: number;
      lastTime: number;
      moved: boolean;
      rotationX: number;
      rotationY: number;
      rotationZ: number;
    } = null;
    let inertia = { x: 0, y: 0, z: 0 };
    let frame = 0;
    let lastFrame = 0;

    const rotatePoint = (point: { x: number; y: number; z: number }) => {
      const toRad = Math.PI / 180;
      const cx = Math.cos(rotation.x * toRad);
      const sx = Math.sin(rotation.x * toRad);
      const cy = Math.cos(rotation.y * toRad);
      const sy = Math.sin(rotation.y * toRad);
      const cz = Math.cos(rotation.z * toRad);
      const sz = Math.sin(rotation.z * toRad);
      let { x, y, z } = point;

      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      [x, z] = [x * cy + z * sy, -x * sy + z * cy];
      [x, y] = [x * cz - y * sz, x * sz + y * cz];

      return { x, y, z };
    };

    const placeMover = (mover: (typeof movers)[number], time: number) => {
      const orbit = orbitProfiles[mover.orbit - 1] || orbitProfiles[1];
      const angle = mover.phase + time * mover.speed;
      const rotated = rotatePoint({
        x: Math.cos(angle) * orbit.rx,
        y: 0,
        z: Math.sin(angle) * orbit.rz
      });
      const perspective = 1 / (1 - rotated.z / 190);
      const x = 50 + rotated.x * perspective;
      const y = 50 + rotated.y * perspective;
      const depthNormal = Math.max(0, Math.min(1, (rotated.z + orbit.rz) / (orbit.rz * 2)));
      const depthScale = mover.isOrbit
        ? 0.72 + depthNormal * 0.58
        : (mover.isPlanet ? 0.72 : 0.55) + depthNormal * (mover.isPlanet ? 0.5 : 0.36);
      const orbitScale = [0.8, 0.94, 1.08, 1.24][mover.orbit - 1] || 1;
      const minimumTouchScale = mover.isPlanet ? 68 / mover.el.offsetWidth : 0;
      const scale = mover.isPlanet
        ? Math.max(minimumTouchScale, depthScale * orbitScale)
        : depthScale;
      const lightX = 34 - Math.sin((rotation.y * Math.PI) / 180) * 18;
      const lightY = 28 + Math.sin((rotation.x * Math.PI) / 180) * 22;

      mover.el.style.setProperty("--x", `${x}%`);
      mover.el.style.setProperty("--y", `${y}%`);
      mover.el.style.setProperty("--depth-z", `${(rotated.z * 7).toFixed(1)}px`);
      mover.el.style.setProperty("--depth-scale", scale.toFixed(3));
      mover.el.style.setProperty("--depth-opacity", (mover.isOrbit ? 0.22 + depthNormal * 0.52 : 0.45 + depthNormal * 0.55).toFixed(3));
      mover.el.style.setProperty("--depth-blur", `${((1 - depthNormal) * 0.6).toFixed(2)}px`);
      mover.el.style.setProperty("--depth-light", (0.72 + depthNormal * 0.38).toFixed(3));
      mover.el.style.setProperty("--light-x", `${lightX.toFixed(1)}%`);
      mover.el.style.setProperty("--light-y", `${lightY.toFixed(1)}%`);
      mover.el.style.setProperty("--surface-roll", `${(rotation.z + rotation.y * 0.25).toFixed(1)}deg`);
      mover.el.style.setProperty("--mark-angle", `${((angle * 180) / Math.PI + rotation.z).toFixed(1)}deg`);
      mover.el.style.zIndex = String(Math.round(rotated.z * 7 + (mover.isOrbit ? 120 : 300)));
    };

    const tick = (now: number) => {
      if (now - lastFrame >= frameInterval) {
        lastFrame = now;
        const time = now / 1000;
        if (!drag) {
          const inertiaSpeed = Math.hypot(inertia.x, inertia.y, inertia.z);
          if (inertiaSpeed > 0.003) {
            rotation.x = Math.max(-138, Math.min(138, rotation.x + inertia.x));
            rotation.y += inertia.y;
            rotation.z += inertia.z;
            inertia.x *= 0.88;
            inertia.y *= 0.88;
            inertia.z *= 0.88;
          } else {
            inertia = { x: 0, y: 0, z: 0 };
          }

          rotation.x += Math.sin(time * 0.42 + rotation.z) * 0.012;
          rotation.y += Math.cos(time * 0.37) * 0.018;
          rotation.z += Math.sin(time * 0.31) * 0.012;
        }

        system.style.setProperty("--space-x", `${rotation.x.toFixed(2)}deg`);
        system.style.setProperty("--space-y", `${rotation.y.toFixed(2)}deg`);
        system.style.setProperty("--space-z", `${rotation.z.toFixed(2)}deg`);
        movers.forEach((mover) => placeMover(mover, time));
      }

      frame = requestAnimationFrame(tick);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if ((event.target as Element).closest("button")) return;
      system.setPointerCapture(event.pointerId);
      system.classList.add("is-dragging");
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: performance.now(),
        moved: false,
        rotationX: rotation.x,
        rotationY: rotation.y,
        rotationZ: rotation.z
      };
      inertia = { x: 0, y: 0, z: 0 };
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const now = performance.now();
      const recentDx = event.clientX - drag.lastX;
      const recentDy = event.clientY - drag.lastY;
      const frameScale = 16.67 / Math.max(16.67, now - drag.lastTime);

      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      rotation.y = drag.rotationY + dx * 0.34;
      rotation.x = Math.max(-138, Math.min(138, drag.rotationX - dy * 0.34));
      rotation.z = drag.rotationZ + dx * 0.045 + dy * 0.025;
      const nextInertia = {
        x: -recentDy * 0.34 * frameScale,
        y: recentDx * 0.34 * frameScale,
        z: (recentDx * 0.045 + recentDy * 0.025) * frameScale
      };
      const inertiaMagnitude = Math.hypot(nextInertia.x, nextInertia.y, nextInertia.z);
      const inertiaLimit = 1.3;
      inertia = inertiaMagnitude > inertiaLimit
        ? {
            x: (nextInertia.x / inertiaMagnitude) * inertiaLimit,
            y: (nextInertia.y / inertiaMagnitude) * inertiaLimit,
            z: (nextInertia.z / inertiaMagnitude) * inertiaLimit
          }
        : nextInertia;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.lastTime = now;
    };
    const stopDrag = () => {
      if (drag?.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 120);
      }
      if (drag && performance.now() - drag.lastTime > 140) {
        inertia = { x: 0, y: 0, z: 0 };
      }
      drag = null;
      system.classList.remove("is-dragging");
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom = Math.min(1.45, Math.max(0.82, zoom + (event.deltaY > 0 ? -0.08 : 0.08)));
      system.style.setProperty("--zoom", zoom.toFixed(2));
    };

    system.addEventListener("pointerdown", handlePointerDown);
    system.addEventListener("pointermove", handlePointerMove);
    system.addEventListener("pointerup", stopDrag);
    system.addEventListener("pointercancel", stopDrag);
    system.addEventListener("wheel", handleWheel, { passive: false });
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      generated.forEach((item) => item.remove());
      system.removeEventListener("pointerdown", handlePointerDown);
      system.removeEventListener("pointermove", handlePointerMove);
      system.removeEventListener("pointerup", stopDrag);
      system.removeEventListener("pointercancel", stopDrag);
      system.removeEventListener("wheel", handleWheel);
    };
  }, []);

  return (
    <section ref={sceneRef} className={`pg-scene${isEntering ? " is-entering" : ""}`} aria-label="행성 선택 화면">
      <header className="pg-intro">
        <PersonalGravityBrand />
        <p className="pg-subtitle">당신이 중심이 되는 세상</p>
        <p className="pg-guide">당신의 하루가 머무는 행성을 찾아보세요.</p>
      </header>

      <div className="pg-system" ref={systemRef} onClick={startEnter}>
        <div className="pg-orbit pg-orbit--far" aria-hidden="true" />
        <div className="pg-orbit pg-orbit--outer" aria-hidden="true" />
        <div className="pg-orbit pg-orbit--middle" aria-hidden="true" />
        <div className="pg-orbit pg-orbit--inner" aria-hidden="true" />
        <div className="pg-sun" aria-hidden="true" />
        {PLANET_BUTTONS.map((button) => (
          <button
            key={button.planet}
            className={`pg-planet ${button.className}`}
            data-planet={button.planet}
            data-orbit={button.orbit}
            data-phase={button.phase}
            data-speed={button.speed}
            type="button"
            aria-label={button.label}
          >
            <img className="pg-planet-image" src={assetUrl(`images/planets/${button.texture}`)} alt="" draggable={false} />
          </button>
        ))}
      </div>

      <span className="pg-entry-portal" aria-hidden="true">
        {ENTRY_PARTICLES.map((particle) => (
          <span
            key={particle.id}
            className="pg-entry-particle"
            style={
              {
                "--particle-x": `${particle.x.toFixed(1)}px`,
                "--particle-y": `${particle.y.toFixed(1)}px`,
                "--particle-delay": `${particle.delay}ms`,
                "--particle-size": `${particle.size.toFixed(1)}px`,
                "--particle-opacity": particle.opacity.toFixed(2)
              } as React.CSSProperties
            }
          />
        ))}
      </span>
    </section>
  );
}

function EntryParticleLoader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;

    const orbitPlanes = [
      { x: -0.92, y: 0.18, z: 0.12 },
      { x: -0.66, y: 0.92, z: -0.18 },
      { x: -1.12, y: -0.44, z: 0.5 },
      { x: -0.28, y: 1.24, z: 0.84 },
      { x: -1.42, y: 0.54, z: -0.68 },
      { x: -0.78, y: -1.08, z: -0.36 },
      { x: -0.38, y: 0.22, z: 1.34 }
    ];
    const particles = Array.from({ length: 112 }, (_, index) => {
      const seed = Math.sin(index * 12.9898) * 43758.5453;
      const noise = seed - Math.floor(seed);
      const planeIndex = index % orbitPlanes.length;

      return {
        angle: (index / 112) * Math.PI * 2,
        alpha: 0.86 + (index % 6) * 0.035,
        orbitCosX: Math.cos(orbitPlanes[planeIndex].x),
        orbitCosY: Math.cos(orbitPlanes[planeIndex].y),
        orbitCosZ: Math.cos(orbitPlanes[planeIndex].z),
        orbitSinX: Math.sin(orbitPlanes[planeIndex].x),
        orbitSinY: Math.sin(orbitPlanes[planeIndex].y),
        orbitSinZ: Math.sin(orbitPlanes[planeIndex].z),
        planeIndex,
        phase: noise * Math.PI * 2,
        radius: 32 + noise * 7.5,
        size: 0.42 + (index % 4) * 0.085,
        speed: 0.22 + (index % 13) * 0.008,
        wobble: 1.8 + noise * 4.6
      };
    });
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let lastRender = 0;
    let pixelRatio = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const render = (now: number) => {
      if (now - lastRender < 1000 / 30) {
        animationFrame = requestAnimationFrame(render);
        return;
      }

      lastRender = now;
      const time = now * 0.001;
      const centerX = width / 2;
      const centerY = height / 2;

      context.clearRect(0, 0, width, height);

      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";

      const rotateAxis = (x: number, y: number, z: number, cosX: number, sinX: number, cosY: number, sinY: number, cosZ: number, sinZ: number) => {
        const nextY = y * cosX - z * sinX;
        const nextZ = y * sinX + z * cosX;
        const nextX = x * cosY + nextZ * sinY;
        const finalZ = -x * sinY + nextZ * cosY;
        const finalX = nextX * cosZ - nextY * sinZ;
        const finalY = nextX * sinZ + nextY * cosZ;

        return { x: finalX, y: finalY, z: finalZ };
      };

      const projectPoint = (x: number, y: number, z: number) => {
        const depth = 1 / (1 - z / 150);

        return {
          depth,
          x: centerX + x * depth * 1.48,
          y: centerY + y * depth * 1.48,
          z
        };
      };

      const globalRotationX = -0.18;
      const globalRotationY = time * 0.28;
      const globalRotationZ = 0.12;
      const globalCosX = Math.cos(globalRotationX);
      const globalSinX = Math.sin(globalRotationX);
      const globalCosY = Math.cos(globalRotationY);
      const globalSinY = Math.sin(globalRotationY);
      const globalCosZ = Math.cos(globalRotationZ);
      const globalSinZ = Math.sin(globalRotationZ);

      particles.forEach((particle, index) => {
        const wave = (Math.sin(time * 0.52 + particle.phase) + 1) / 2;
        const angle = particle.angle + time * particle.speed * (particle.planeIndex % 2 === 0 ? 1 : -1);
        const previousAngle = angle - 0.035;
        const radius = particle.radius * (0.96 + wave * 0.07);
        const local = rotateAxis(
          Math.cos(angle) * radius,
          Math.sin(angle * 2 + particle.phase) * particle.wobble,
          Math.sin(angle) * radius,
          particle.orbitCosX,
          particle.orbitSinX,
          particle.orbitCosY,
          particle.orbitSinY,
          particle.orbitCosZ,
          particle.orbitSinZ
        );
        const previousLocal = rotateAxis(
          Math.cos(previousAngle) * radius,
          Math.sin(previousAngle * 2 + particle.phase) * particle.wobble,
          Math.sin(previousAngle) * radius,
          particle.orbitCosX,
          particle.orbitSinX,
          particle.orbitCosY,
          particle.orbitSinY,
          particle.orbitCosZ,
          particle.orbitSinZ
        );
        const global = rotateAxis(local.x, local.y, local.z, globalCosX, globalSinX, globalCosY, globalSinY, globalCosZ, globalSinZ);
        const previousGlobal = rotateAxis(previousLocal.x, previousLocal.y, previousLocal.z, globalCosX, globalSinX, globalCosY, globalSinY, globalCosZ, globalSinZ);
        const projected = projectPoint(global.x, global.y, global.z);
        const previous = projectPoint(previousGlobal.x, previousGlobal.y, previousGlobal.z);
        const depthNormal = Math.max(0, Math.min(1, (projected.z + 46) / 92));
        const size = Math.max(0.5, particle.size * projected.depth * (0.82 + depthNormal * 1.02));
        const alpha = Math.min(1, particle.alpha * (0.98 + wave * 0.22) * (0.78 + depthNormal * 0.62));

        if (index % 4 === 0) {
          context.beginPath();
          context.moveTo(previous.x, previous.y);
          context.lineTo(projected.x, projected.y);
          context.strokeStyle = `rgba(220, 238, 255, ${alpha * 0.38})`;
          context.lineWidth = Math.max(0.2, size * 0.42);
          context.stroke();
        }

        if (index % 3 === 0) {
          const hazeSize = size * 2.1;
          context.fillStyle = `rgba(184, 220, 255, ${alpha * 0.16})`;
          context.fillRect(projected.x - hazeSize / 2, projected.y - hazeSize / 2, hazeSize, hazeSize);
        }

        context.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 1.08)})`;
        context.fillRect(projected.x - size / 2, projected.y - size / 2, size, size);
      });

      context.globalCompositeOperation = "source-over";
      animationFrame = requestAnimationFrame(render);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="entry-loading__particle-canvas" aria-hidden="true" />;
}

function EntryLoadingOverlay({ planet }: { planet: PlanetContent }) {
  return (
    <div className="entry-loading" aria-live="polite" aria-label={`${planet.entryLabel}의 Personal Gravity로 진입하는 중`}>
      <div className="entry-loading__centerpiece">
        <EntryParticleLoader />
        <div className="entry-loading__copy">
          <p className="entry-loading__eyebrow">PERSONAL GRAVITY</p>
          <strong>
            {planet.entryLabel}의 Personal Gravity로 진입하는 중
            <span className="entry-loading__dots" aria-hidden="true" />
          </strong>
        </div>
      </div>
    </div>
  );
}

function TouchInstructionOverlay() {
  return (
    <div className="touch-instruction" aria-live="polite">
      <img src={assetUrl("images/ui/icon_touch.svg")} alt="" aria-hidden="true" />
      <p>화면을 꾹 누르거나, 드래그해보세요</p>
    </div>
  );
}

function DetailPage({
  settings,
  planet,
  onBack,
  onPreviousPlanet,
  onNextPlanet,
  isTransitioning = false,
  onSceneReady
}: {
  settings: ViewerSettings;
  planet: PlanetContent;
  onBack: () => void;
  onPreviousPlanet: () => void;
  onNextPlanet: () => void;
  isTransitioning?: boolean;
  onSceneReady?: () => void;
}) {
  const settingsSnapshot = useMemo(() => settings, [settings]);
  const [stageScale, setStageScale] = useState(1);
  const hasTouchGravityInteraction = Boolean(planet.floatingPointDataUrl || planet.floatingPointDataUrls?.length) && !isTransitioning;
  const [showTouchInstruction, setShowTouchInstruction] = useState(hasTouchGravityInteraction);
  const [interactionPoint, setInteractionPoint] = useState<DetailInteractionPoint>({ active: false, x: 0, y: 0, clientX: 0, clientY: 0, velocityX: 0, velocityY: 0, speed: 0 });
  const [detailView, setDetailView] = useState({ rotationX: 0, rotationY: 0, zoom: 1 });
  const interactionPointerIdRef = useRef<number | null>(null);
  const lastInteractionRef = useRef({ clientX: 0, clientY: 0 });
  const activePointersRef = useRef(new Map<number, { clientX: number; clientY: number }>());
  const lastGestureRef = useRef({ centerX: 0, centerY: 0, distance: 0 });
  const pointDataUrl = useMemo(() => planet.pointDataUrl ? assetUrl(planet.pointDataUrl) : undefined, [planet.pointDataUrl]);
  const floatingPointDataUrl = useMemo(() => planet.floatingPointDataUrl ? assetUrl(planet.floatingPointDataUrl) : undefined, [planet.floatingPointDataUrl]);
  const floatingPointDataUrls = useMemo(() => planet.floatingPointDataUrls?.map((url) => assetUrl(url)), [planet.floatingPointDataUrls]);

  useEffect(() => {
    const syncScale = () => setStageScale(getStageScale());

    syncScale();
    window.addEventListener("resize", syncScale);
    return () => window.removeEventListener("resize", syncScale);
  }, []);

  useEffect(() => {
    if (!hasTouchGravityInteraction) {
      setShowTouchInstruction(false);
      return undefined;
    }

    setShowTouchInstruction(true);
    const timeout = window.setTimeout(() => {
      setShowTouchInstruction(false);
    }, 5200);

    return () => window.clearTimeout(timeout);
  }, [hasTouchGravityInteraction, planet.id]);

  const getInteractionPointFromClient = (clientX: number, clientY: number, includeVelocity = true): DetailInteractionPoint => {
    const deltaX = includeVelocity ? clientX - lastInteractionRef.current.clientX : 0;
    const deltaY = includeVelocity ? clientY - lastInteractionRef.current.clientY : 0;
    const speed = Math.min(1, Math.hypot(deltaX, deltaY) / 58);
    const sceneRect = document.querySelector(".scene")?.getBoundingClientRect();
    const ndcX = sceneRect
      ? ((clientX - sceneRect.left) / Math.max(sceneRect.width, 1) - 0.5) * 2
      : (clientX / window.innerWidth - 0.5) * 2;
    const ndcY = sceneRect
      ? (0.5 - (clientY - sceneRect.top) / Math.max(sceneRect.height, 1)) * 2
      : (0.5 - clientY / window.innerHeight) * 2;

    lastInteractionRef.current = {
      clientX,
      clientY
    };

    return {
      active: true,
      x: ndcX,
      y: ndcY,
      clientX,
      clientY,
      velocityX: deltaX / Math.max(window.innerWidth, 1),
      velocityY: deltaY / Math.max(window.innerHeight, 1),
      speed
    };
  };

  const getInteractionPoint = (event: React.PointerEvent<HTMLElement>, includeVelocity = true): DetailInteractionPoint => {
    return getInteractionPointFromClient(event.clientX, event.clientY, includeVelocity);
  };

  const getPointerGesture = () => {
    const pointers = Array.from(activePointersRef.current.values());
    if (pointers.length === 0) return null;

    const centerX = pointers.reduce((sum, pointer) => sum + pointer.clientX, 0) / pointers.length;
    const centerY = pointers.reduce((sum, pointer) => sum + pointer.clientY, 0) / pointers.length;
    const distance = pointers.length >= 2
      ? Math.hypot(pointers[0].clientX - pointers[1].clientX, pointers[0].clientY - pointers[1].clientY)
      : 0;

    return { centerX, centerY, distance, count: pointers.length };
  };

  const handleInteractionStart = (event: React.PointerEvent<HTMLElement>) => {
    if (!hasTouchGravityInteraction || (event.target as Element).closest("button, input, label")) return;
    activePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const gesture = getPointerGesture();
    if (gesture) {
      lastGestureRef.current = { centerX: gesture.centerX, centerY: gesture.centerY, distance: gesture.distance };
      interactionPointerIdRef.current = event.pointerId;
      setInteractionPoint(getInteractionPointFromClient(gesture.centerX, gesture.centerY, false));
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleInteractionMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!hasTouchGravityInteraction || !activePointersRef.current.has(event.pointerId)) return;
    activePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const gesture = getPointerGesture();
    if (!gesture) return;

    const deltaX = gesture.centerX - lastGestureRef.current.centerX;
    const deltaY = gesture.centerY - lastGestureRef.current.centerY;
    const nextInteractionPoint = getInteractionPointFromClient(gesture.centerX, gesture.centerY);

    setDetailView((current) => {
      const nextZoom = gesture.count >= 2 && lastGestureRef.current.distance > 0
        ? THREE.MathUtils.clamp(current.zoom * Math.pow(gesture.distance / lastGestureRef.current.distance, 1.18), 0.62, 1.86)
        : current.zoom;

      return {
        rotationX: THREE.MathUtils.clamp(current.rotationX + deltaY * 0.00145, -0.38, 0.38),
        rotationY: current.rotationY + deltaX * 0.00215,
        zoom: nextZoom
      };
    });
    lastGestureRef.current = { centerX: gesture.centerX, centerY: gesture.centerY, distance: gesture.distance };
    setInteractionPoint(nextInteractionPoint);
  };

  const handleInteractionEnd = (event: React.PointerEvent<HTMLElement>) => {
    if (!hasTouchGravityInteraction || !activePointersRef.current.has(event.pointerId)) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointersRef.current.delete(event.pointerId);
    const gesture = getPointerGesture();
    if (gesture) {
      lastGestureRef.current = { centerX: gesture.centerX, centerY: gesture.centerY, distance: gesture.distance };
      interactionPointerIdRef.current = activePointersRef.current.keys().next().value ?? null;
      setInteractionPoint(getInteractionPointFromClient(gesture.centerX, gesture.centerY, false));
    } else {
      interactionPointerIdRef.current = null;
      setInteractionPoint((current) => ({ ...current, active: false }));
    }
  };

  const handleInteractionWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (!hasTouchGravityInteraction) return;
    event.preventDefault();
    const zoomDelta = Math.exp(-event.deltaY * 0.0016);
    setDetailView((current) => ({
      ...current,
      zoom: THREE.MathUtils.clamp(current.zoom * zoomDelta, 0.62, 1.86)
    }));
  };

  return (
    <div
      className={`detail-stage${isTransitioning ? " is-transitioning" : " is-active"}${hasTouchGravityInteraction ? " is-plant-interactive" : ""}${interactionPoint.active ? " is-touching" : ""}`}
      style={{
        "--stage-scale": stageScale,
        "--touch-x": `${interactionPoint.clientX || window.innerWidth / 2}px`,
        "--touch-y": `${interactionPoint.clientY || window.innerHeight / 2}px`
      } as React.CSSProperties}
      onPointerDown={handleInteractionStart}
      onPointerMove={handleInteractionMove}
      onPointerUp={handleInteractionEnd}
      onPointerCancel={handleInteractionEnd}
      onPointerLeave={handleInteractionEnd}
      onWheel={handleInteractionWheel}
    >
      <Scene
        settings={settingsSnapshot}
        pointDataUrl={pointDataUrl}
        floatingPointDataUrl={floatingPointDataUrl}
        floatingPointDataUrls={floatingPointDataUrls}
        initialRotation={DETAIL_INITIAL_ROTATIONS[planet.id]}
        viewRotationX={hasTouchGravityInteraction ? detailView.rotationX : 0}
        viewRotationY={hasTouchGravityInteraction ? detailView.rotationY : 0}
        viewZoom={hasTouchGravityInteraction ? detailView.zoom : 1}
        interactionPoint={hasTouchGravityInteraction ? interactionPoint : undefined}
        fixedCamera={hasTouchGravityInteraction}
        introPaused={isTransitioning}
        onReady={onSceneReady}
      />
      {!isTransitioning && (
        <>
          {showTouchInstruction && <TouchInstructionOverlay key={planet.id} />}
          {!showTouchInstruction && (
            <GravityInterface
              key={planet.id}
              planet={planet}
              isTouching={interactionPoint.active}
              onBack={onBack}
              onPreviousPlanet={onPreviousPlanet}
              onNextPlanet={onNextPlanet}
            />
          )}
        </>
      )}
    </div>
  );
}

function GravityInterface({
  planet,
  isTouching,
  onBack,
  onPreviousPlanet,
  onNextPlanet
}: {
  planet: PlanetContent;
  isTouching: boolean;
  onBack: () => void;
  onPreviousPlanet: () => void;
  onNextPlanet: () => void;
}) {
  const productGridWidth = planet.products.length * 132 + Math.max(0, planet.products.length - 1) * 18;

  return (
    <section className={`gravity-frame${isTouching ? " is-touching" : ""}`} aria-label="Personal Gravity">
      <div className="title-copy">
        <PersonalGravityBrand />
        <p>화면을 꾹 눌러, 가전이 반응하는 순간을 느껴보세요.</p>
      </div>

      <article className="description">
        <h2>{planet.title}</h2>
        {planet.description.map((paragraph) => (
          <p key={paragraph}>{preventTrailingOrphan(paragraph)}</p>
        ))}
      </article>

      <button className="arrow arrow--left" type="button" aria-label="Previous planet" onClick={onPreviousPlanet}>
        ←
      </button>
      <button className="arrow arrow--right" type="button" aria-label="Next planet" onClick={onNextPlanet}>
        →
      </button>

      <div className="bottom-guide" style={{ "--product-grid-width": `${productGridWidth}px` } as React.CSSProperties}>
        <p>Smart Home Orbit</p>
        <div className="product-links" aria-label="Product list">
          {planet.products.map((product, index) => (
            <div className="product-orbit" key={`${product.name}-${index}`}>
              <span>{product.name}</span>
              <i aria-hidden="true">
                <img src={assetUrl(product.image)} alt="" />
              </i>
            </div>
          ))}
        </div>
      </div>

      <button className="back-pill" type="button" onClick={onBack}>Back</button>
    </section>
  );
}

function App() {
  const settings = DEFAULT_SETTINGS;
  const planetParam = new URLSearchParams(window.location.search).get("planet");
  const initialPlanet = isPlanetKey(planetParam) ? planetParam : "baby";
  const shouldStartDetail =
    new URLSearchParams(window.location.search).get("view") === "detail" ||
    (window as Window & { __PERSONAL_GRAVITY_START_DETAIL__?: boolean }).__PERSONAL_GRAVITY_START_DETAIL__ === true;
  const [view, setView] = useState<"home" | "detail">(shouldStartDetail ? "detail" : "home");
  const [selectedPlanet, setSelectedPlanet] = useState<PlanetKey>(initialPlanet);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isTransitionMinimumElapsed, setIsTransitionMinimumElapsed] = useState(false);
  const [isDetailSceneReady, setIsDetailSceneReady] = useState(!shouldStartDetail);
  const currentPlanet = PLANETS[selectedPlanet];
  const handleDetailSceneReady = useCallback(() => {
    setIsDetailSceneReady(true);
  }, []);
  const completeTransition = useCallback((planet: PlanetKey) => {
    setSelectedPlanet(planet);
    setView("detail");
    setIsTransitioning(false);
    updateBrowserUrl("detail", planet);
  }, []);
  const movePlanet = (direction: -1 | 1) => {
    const currentIndex = PLANET_ORDER.indexOf(selectedPlanet);
    const nextPlanet = PLANET_ORDER[(currentIndex + direction + PLANET_ORDER.length) % PLANET_ORDER.length];

    setSelectedPlanet(nextPlanet);
    setView("detail");
    setIsTransitioning(false);
    updateBrowserUrl("detail", nextPlanet);
  };

  useEffect(() => {
    if (!isTransitioning) return undefined;

    setIsTransitionMinimumElapsed(false);
    const timeout = window.setTimeout(() => {
      setIsTransitionMinimumElapsed(true);
    }, ENTRY_LOADING_DURATION_MS);

    return () => window.clearTimeout(timeout);
  }, [isTransitioning, selectedPlanet]);

  useEffect(() => {
    if (!isTransitioning || !isTransitionMinimumElapsed || !isDetailSceneReady) return;
    completeTransition(selectedPlanet);
  }, [completeTransition, isDetailSceneReady, isTransitionMinimumElapsed, isTransitioning, selectedPlanet]);

  useEffect(() => {
    window.history.replaceState({ view, planet: selectedPlanet }, "");
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const preloadHandle = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(preloadPointData, { timeout: 1200 })
      : window.setTimeout(preloadPointData, 600);

    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const planetFromUrl = params.get("planet");
      const nextPlanet = isPlanetKey(planetFromUrl) ? planetFromUrl : "baby";
      const nextView = params.get("view") === "detail" ? "detail" : "home";

      setSelectedPlanet(nextPlanet);
      setView(nextView);
      setIsTransitioning(false);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (idleWindow.cancelIdleCallback && typeof preloadHandle === "number") {
        idleWindow.cancelIdleCallback(preloadHandle);
      } else {
        window.clearTimeout(preloadHandle);
      }
    };
  }, []);

  return (
    <main>
      {(isTransitioning || view === "detail") && (
        <DetailPage
          settings={settings}
          planet={currentPlanet}
          isTransitioning={isTransitioning}
          onSceneReady={handleDetailSceneReady}
          onBack={() => {
            setIsTransitioning(false);
            setView("home");
            updateBrowserUrl("home", selectedPlanet);
          }}
          onPreviousPlanet={() => movePlanet(-1)}
          onNextPlanet={() => movePlanet(1)}
        />
      )}
      {isTransitioning && <EntryLoadingOverlay planet={currentPlanet} />}
      {view === "home" && (
        <HomePage
          onEnterStart={(planet) => {
            setSelectedPlanet(planet);
            setIsDetailSceneReady(false);
            setIsTransitionMinimumElapsed(false);
            setIsTransitioning(true);
          }}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <App />
);
