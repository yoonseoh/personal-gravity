import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
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
  performanceMode: "normal" | "light";
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
const ENTRY_LOADING_DURATION_MS = 6500;
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
    title: "육아 부부의\nPersonal Gravity",
    description: [
      "아기가 머무는 공간까지 깨끗하게",
      "아기가 바닥에서 오래 놀아도 안심할 수 있도록 공기와 청결을 세심하게 관리하는 거실입니다. LG 퓨리케어 AI 오브제컬렉션 360˚ 공기청정기 M5는 아이가 생활하는 낮은 공간의 공기까지 관리하고, 코드제로 AI 오브제컬렉션 A9은 매일 쌓이는 먼지와 생활 오염을 빠르게 정리해줍니다",
      "아기가 잠든 뒤에는 LG 올레드 evo AI로 부부만의 짧은 영화 시간이나 휴식 시간을 즐기며, 육아의 하루를 조용히 마무리하는 공간입니다."
    ],
    products: [
      { name: "LG 퓨리케어 AI 오브제컬렉션 360˚ 공기청정기 M5", image: "images/products/baby/3.png" },
      { name: "LG 코드제로 AI 오브제컬렉션 A9", image: "images/products/baby/2.png" },
      { name: "LG 올레드 evo AI", image: "images/products/20s/4.png" }
    ]
  },
  plant: {
    id: "plant",
    pointDataUrl: "models/lg-model-plant2-base-points",
    floatingPointDataUrl: "models/lg-model-plant2-appliances-points",
    entryLabel: "식물을 가꾸는 시니어 부부",
    title: "식물을 가꾸는 시니어 부부의\nPersonal Gravity",
    description: [
      "가사는 덜고, 건강한 일상은 더 오래",
      "햇살이 잘 드는 거실에서 부부의 일상과 반려 식물이 함께 자라는 공간입니다. LG 휘센 타워 에어컨은 집 안 온도를 편안하게 맞추고, 틔운은 사계절 내내 식물을 키우는 즐거움을 더해줍니다. 청소는 로보킹 AI 올인원에 맡기고, 하루의 피로는 LG 힐링미 안마의자로 풀어줍니다.",
      "복잡한 집안일은 줄이고, 건강하고 여유로운 하루를 오래 이어가게 돕는 시니어 부부의 거실입니다."
    ],
    products: [
      { name: "LG 틔운 미니", image: "images/products/plant/3.png" },
      { name: "LG 힐링미 오브제컬렉션 안마의자", image: "images/products/plant/4.png" },
      { name: "LG 코드제로 로보킹 AI 올인원", image: "images/products/plant/2.png" }
    ]
  },
  party: {
    id: "party",
    pointDataUrl: "models/lg-model-party-base-points",
    floatingPointDataUrl: "models/lg-model-party-appliances-points",
    entryLabel: "홈파티를 즐기는 부부",
    title: "홈파티를 즐기는 부부의\nPersonal Gravity",
    description: [
      "보관부터 조리까지, 함께 즐기는 홈파티 키친",
      "주말마다 새로운 레시피를 시도하고, 좋아하는 사람들을 초대하는 미식가 부부의 주방입니다. LG 디오스 오브제컬렉션 냉장고는 파티 재료와 음료를 깔끔하게 보관하고, 주방 인테리어와 자연스럽게 어우러집니다.",
      "여기에 광파오븐과 와인셀러가 더해져 요리 준비부터 와인 페어링까지 더 즐겁고 스마트하게 완성되는 홈 파티 공간입니다."
    ],
    products: [
      { name: "LG 디오스 오브제컬렉션 냉장고", image: "images/products/party/1.png" },
      { name: "LG 디오스 오브제컬렉션 와인셀러", image: "images/products/party/3.png" },
      { name: "LG 디오스 오브제컬렉션 광파오븐", image: "images/products/party/2.png" }
    ]
  },
  dress: {
    id: "dress",
    pointDataUrl: "models/lg-model-dressroom2-base-points",
    floatingPointDataUrl: "models/lg-model-dressroom2-appliances-points",
    entryLabel: "패션 러버",
    title: "패션 러버의\nPersonal Gravity",
    description: [
      "옷과 신발을 아끼는 나만의 드레스룸",
      "좋아하는 옷과 스니커즈가 가득한 방에서 매일의 스타일이 완성됩니다. LG 스타일러 오브제컬렉션은 자주 입는 옷의 구김과 컨디션을 관리해주고, 슈케어는 아끼는 신발을 더 깔끔하게 오래 신을 수 있도록 도와줍니다.",
      "번거로운 옷과 신발 관리를 간편하게 해결해, 매일의 스타일링을 더 가볍게 만들어주는 패션러버의 드레스룸입니다."
    ],
    products: [
      { name: "LG 스타일러 오브제컬렉션 슈케어", image: "images/products/dress/2.png" },
      { name: "LG 스타일러 오브제컬렉션", image: "images/products/dress/3.png" }
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
    entryLabel: "홈스파 매니아",
    title: "홈스파 매니아의\nPersonal Gravity",
    description: [
      "습기와 세탁 걱정 없는 나만의 홈 스파",
      "바쁜 일상 끝, 나만의 회복 시간을 보내는 욕실입니다. LG 퓨리케어 바스에어시스템은 입욕 중 온도와 습도를 쾌적하게 유지하고, 사용 후 남은 습기와 냄새까지 관리해 곰팡이 걱정을 덜어줍니다. 세탁기와 건조기는 젖은 타월, 가운, 홈웨어를 바로 세탁하고 보송하게 말려줍니다.",
      "씻는 순간부터 마무리 관리까지 한 공간에서 해결되는, 집 안의 작은 호텔 스파입니다."
    ],
    products: [
      { name: "LG 퓨리케어 바스에어시스템", image: "images/products/bath/2.png" },
      { name: "LG 트롬 오브제컬렉션 세탁기", image: "images/products/bath/washer.png" },
      { name: "LG 트롬 오브제컬렉션 건조기", image: "images/products/bath/dryer.png" }
    ]
  },
  cats: {
    id: "cats",
    pointDataUrl: "models/lg-model-cat2-base-points",
    floatingPointDataUrl: "models/lg-model-cat2-appliances-points",
    entryLabel: "고양이 집사",
    title: "고양이 집사의\nPersonal Gravity",
    description: [
      "고양이는 자유롭게, 털 걱정은 가볍게",
      "캣워크와 캣타워가 있는 거실에서 고양이는 마음껏 뛰어놀고, 집사는 에어로캣타워와 코드제로 A9으로 털과 먼지를 관리합니다.",
      "외출 중에도 홈뷰로 고양이 상태를 확인할 수 있는, 1인 집사를 위한 스마트 펫 라이프 공간입니다."
    ],
    products: [
      { name: "LG 퓨리케어 AI 오브제컬렉션 에어로캣타워", image: "images/products/cats/1.png" },
      { name: "LG 코드제로 오브제컬렉션 A9", image: "images/products/cats/3.png" }
    ]
  },
  "20s": {
    id: "20s",
    pointDataUrl: "models/lg-model-20s2-base-points",
    floatingPointDataUrl: "models/lg-model-20s2-appliances-points",
    entryLabel: "자취 만렙 대학생",
    title: "자취 만렙 대학생의\nPersonal Gravity",
    description: [
      "책상에서 침대까지, 화면이 따라오는 원룸 라이프",
      "노트북은 강의, 과제, 게임까지 한 번에 해결하고, 스탠바이미는 침대 옆이나 책상 옆으로 옮겨가며 콘텐츠 감상 공간을 만들어줍니다.",
      "가구를 많이 둘 수 없는 대학생 원룸에서도 공부할 때는 집중 공간으로, 쉴 때는 작은 영화관으로 바뀌는 실용적인 콘텐츠 룸입니다."
    ],
    products: [
      { name: "LG 스탠바이미 2", image: "images/products/20s/2.png" },
      { name: "LG 그램 Pro AI", image: "images/products/20s/gram.png" }
    ]
  }
};

const PLANET_ORDER: PlanetKey[] = ["baby", "bath", "cats", "plant", "dress", "20s", "party"];

const PLANET_BUTTONS = [
  { className: "pg-planet--a", planet: "baby", orbit: "4", phase: "2.78", speed: "0.05", label: "육아하는 부부의 행성 선택" },
  { className: "pg-planet--b", planet: "bath", orbit: "2", phase: "3.46", speed: "0.08", label: "배스 케어의 행성 선택" },
  { className: "pg-planet--c", planet: "plant", orbit: "3", phase: "5.02", speed: "0.06", label: "식물과 함께 사는 행성 선택" },
  { className: "pg-planet--d", planet: "party", orbit: "4", phase: "6.06", speed: "0.045", label: "파티를 즐기는 행성 선택" },
  { className: "pg-planet--e", planet: "dress", orbit: "2", phase: "0.78", speed: "0.075", label: "드레스룸의 행성 선택" },
  { className: "pg-planet--f", planet: "20s", orbit: "1", phase: "4.82", speed: "0.11", label: "20대 싱글의 행성 선택" },
  { className: "pg-planet--g", planet: "cats", orbit: "2", phase: "2.28", speed: "0.065", label: "반려묘 가족의 행성 선택" }
] satisfies Array<{
  className: string;
  planet: PlanetKey;
  orbit: string;
  phase: string;
  speed: string;
  label: string;
}>;

const isPlanetKey = (value: string | null | undefined): value is PlanetKey => {
  return value === "baby" || value === "plant" || value === "party" || value === "dress" || value === "bath" || value === "cats" || value === "20s";
};

function getPlanetPointDataUrls(key: PlanetKey) {
  return [
    PLANETS[key].pointDataUrl,
    PLANETS[key].floatingPointDataUrl,
    ...(PLANETS[key].floatingPointDataUrls ?? [])
  ].filter((url): url is string => Boolean(url));
}

function getPreloadPlanetKeys(centerPlanet: PlanetKey) {
  const currentIndex = PLANET_ORDER.indexOf(centerPlanet);
  const previousPlanet = PLANET_ORDER[(currentIndex - 1 + PLANET_ORDER.length) % PLANET_ORDER.length];
  const nextPlanet = PLANET_ORDER[(currentIndex + 1) % PLANET_ORDER.length];

  return Array.from(new Set([centerPlanet, previousPlanet, nextPlanet]));
}

function preloadPointData(centerPlanet: PlanetKey) {
  const urls = new Set<string>();

  getPreloadPlanetKeys(centerPlanet).forEach((key) => {
    getPlanetPointDataUrls(key).forEach((pointDataUrl) => {
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
  spread: 1.04,
  performanceMode: "normal"
};

function shouldUseLightPerformanceMode() {
  const params = new URLSearchParams(window.location.search);
  const performanceParam = params.get("performance");
  if (performanceParam === "normal") return false;
  if (performanceParam === "light" || performanceParam === "standbyme") return true;

  const userAgent = navigator.userAgent.toLowerCase();
  return [
    "webos",
    "web0s",
    "netcast",
    "smart-tv",
    "smarttv",
    "tv safari",
    "lge",
    "lg browser"
  ].some((token) => userAgent.includes(token));
}

function getViewerSettings(): ViewerSettings {
  const useLightMode = shouldUseLightPerformanceMode();

  return {
    ...DEFAULT_SETTINGS,
    density: useLightMode ? Math.floor(DEFAULT_SETTINGS.density * 0.5) : DEFAULT_SETTINGS.density,
    glow: useLightMode ? 0.28 : DEFAULT_SETTINGS.glow,
    performanceMode: useLightMode ? "light" : "normal"
  };
}

function getStageScale() {
  return Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
}

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
      dpr={[1, 1.5]}
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
  const [isEntering, setIsEntering] = useState(false);

  const startEnter = (event?: React.MouseEvent<HTMLElement>) => {
    if (isEntering) return;

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
      })
    ];
    const createMover = (item: HTMLElement) => ({
      el: item,
      orbit: Number(item.dataset.orbit || 2),
      phase: Number(item.dataset.phase || 0),
      speed: Number(item.dataset.speed || 0.12),
      isPlanet: item.classList.contains("pg-planet"),
      isOrbit: item.classList.contains("pg-orbit-mark"),
      minimumScale: item.classList.contains("pg-planet") ? 68 / Math.max(item.offsetWidth, 1) : 0
    });
    const orbitMovers = generated.map(createMover);
    const planetMovers = [...system.querySelectorAll<HTMLElement>(".pg-planet")].map(createMover);
    const rotation = { x: -58, y: 14, z: -10 };
    let systemWidth = Math.max(system.clientWidth, 1);
    let systemHeight = Math.max(system.clientHeight, 1);
    let frame = 0;

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

    const placeMover = (mover: ReturnType<typeof createMover>, time: number) => {
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
      const xOffset = ((x - 50) / 100) * systemWidth;
      const yOffset = ((y - 50) / 100) * systemHeight;
      const depthNormal = Math.max(0, Math.min(1, (rotated.z + orbit.rz) / (orbit.rz * 2)));
      const depthScale = mover.isOrbit
        ? 0.72 + depthNormal * 0.58
        : (mover.isPlanet ? 0.72 : 0.55) + depthNormal * (mover.isPlanet ? 0.5 : 0.36);
      const orbitScale = [0.8, 0.94, 1.08, 1.24][mover.orbit - 1] || 1;
      const scale = mover.isPlanet
        ? Math.max(mover.minimumScale, depthScale * orbitScale)
        : depthScale;

      mover.el.style.setProperty("--orbit-x", `${xOffset.toFixed(2)}px`);
      mover.el.style.setProperty("--orbit-y", `${yOffset.toFixed(2)}px`);
      mover.el.style.setProperty("--depth-z", `${(rotated.z * 7).toFixed(1)}px`);
      mover.el.style.setProperty("--depth-scale", scale.toFixed(3));
      mover.el.style.setProperty("--depth-opacity", (mover.isOrbit ? 0.22 + depthNormal * 0.52 : 0.45 + depthNormal * 0.55).toFixed(3));
      if (mover.isOrbit) {
        mover.el.style.setProperty("--depth-blur", `${((1 - depthNormal) * 0.6).toFixed(2)}px`);
        mover.el.style.setProperty("--depth-light", (0.72 + depthNormal * 0.38).toFixed(3));
        mover.el.style.setProperty("--mark-angle", `${((angle * 180) / Math.PI + rotation.z).toFixed(1)}deg`);
      }
      mover.el.style.zIndex = String(Math.round(rotated.z * 7 + (mover.isOrbit ? 120 : 300)));
    };

    const syncOrbitLayout = () => {
      systemWidth = Math.max(system.clientWidth, 1);
      systemHeight = Math.max(system.clientHeight, 1);
      orbitMovers.forEach((mover) => placeMover(mover, 0));
      planetMovers.forEach((mover) => placeMover(mover, performance.now() / 1000));
    };

    const lightX = 34 - Math.sin((rotation.y * Math.PI) / 180) * 18;
    const lightY = 28 + Math.sin((rotation.x * Math.PI) / 180) * 22;

    system.style.setProperty("--space-x", `${rotation.x.toFixed(2)}deg`);
    system.style.setProperty("--space-y", `${rotation.y.toFixed(2)}deg`);
    system.style.setProperty("--space-z", `${rotation.z.toFixed(2)}deg`);
    system.style.setProperty("--light-x", `${lightX.toFixed(1)}%`);
    system.style.setProperty("--light-y", `${lightY.toFixed(1)}%`);
    system.style.setProperty("--surface-roll", `${(rotation.z + rotation.y * 0.25).toFixed(1)}deg`);
    syncOrbitLayout();

    const resizeObserver = new ResizeObserver(syncOrbitLayout);
    resizeObserver.observe(system);

    const tick = (now: number) => {
      const time = now / 1000;

      planetMovers.forEach((mover) => placeMover(mover, time));

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      generated.forEach((item) => item.remove());
    };
  }, []);

  return (
    <section ref={sceneRef} className={`pg-scene${isEntering ? " is-entering" : ""}`} aria-label="행성 선택 화면">
      <header className="pg-intro">
        <PersonalGravityBrand />
        <p className="pg-subtitle">당신이 중심이 되는 세상</p>
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
          />
        ))}
      </div>

      <div className="home-touch-guide" aria-hidden="true">
        <img src={assetUrl("images/ui/icon_touch.svg")} alt="" />
        <p>행성을 터치해보세요</p>
      </div>
    </section>
  );
}

function EntryLoadingOverlay({ planet }: { planet: PlanetContent }) {
  return (
    <div className="entry-loading" aria-live="polite" aria-label={`${planet.entryLabel}의 Personal Gravity로 진입하는 중`}>
      <div className="entry-loading__centerpiece">
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
      <p>화면을 꾹 누른채로 천천히 움직여보세요.</p>
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
      className={`detail-stage detail-stage--${planet.id}${isTransitioning ? " is-transitioning" : " is-active"}${hasTouchGravityInteraction ? " is-plant-interactive" : ""}${interactionPoint.active ? " is-touching" : ""}`}
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
        introPaused={false}
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
  return (
    <section className={`gravity-frame gravity-frame--${planet.id}${isTouching ? " is-touching" : ""}`} aria-label="Personal Gravity">
      <div className="title-copy">
        <img className="title-copy__touch-icon" src={assetUrl("images/ui/icon_touch.svg")} alt="" aria-hidden="true" />
        <p>화면을 꾹 누르면, 내 손 끝을 중심으로 가전이 떠오릅니다.</p>
      </div>

      <aside className="detail-info-panel" aria-label={`${planet.entryLabel} information`}>
        <p className="detail-info-panel__eyebrow">Personal Gravity</p>
        <h2>{planet.title}</h2>
        <div className="detail-info-panel__copy">
          {planet.description.map((paragraph) => (
            <p key={paragraph}>{preventTrailingOrphan(paragraph)}</p>
          ))}
        </div>
        <div className="detail-info-panel__products" aria-label="Product list">
          {planet.products.map((product, index) => (
            <div className="product-orbit" key={`${product.name}-${index}`}>
              <span>{product.name}</span>
              <i aria-hidden="true">
                <img src={assetUrl(product.image)} alt="" />
              </i>
            </div>
          ))}
        </div>
      </aside>

      <button className="arrow arrow--left" type="button" aria-label="Previous planet" onClick={onPreviousPlanet}>
        ←
      </button>
      <button className="arrow arrow--right" type="button" aria-label="Next planet" onClick={onNextPlanet}>
        →
      </button>

      <button className="back-pill" type="button" onClick={onBack}>돌아가기</button>
    </section>
  );
}

function App() {
  const settings = useMemo(getViewerSettings, []);
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
    };
  }, []);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const preloadHandle = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(() => preloadPointData(selectedPlanet), { timeout: 1200 })
      : window.setTimeout(() => preloadPointData(selectedPlanet), 600);

    return () => {
      if (idleWindow.cancelIdleCallback && typeof preloadHandle === "number") {
        idleWindow.cancelIdleCallback(preloadHandle);
      } else {
        window.clearTimeout(preloadHandle);
      }
    };
  }, [selectedPlanet]);

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
