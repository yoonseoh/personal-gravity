import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useProgress } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Sparkles } from "lucide-react";
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

const MAX_DENSITY = 500_000;
const ENTRY_LOADING_DURATION_MS = 3300;
const MODEL_DISPLAY_POSITION: [number, number, number] = [0, -0.18, 0];

type PlanetKey = "baby" | "plant" | "party" | "dress" | "bath" | "cats" | "20s";

type ProductContent = {
  name: string;
  image: string;
};

type PlanetContent = {
  id: PlanetKey;
  modelUrl: string;
  pointDataUrl?: string;
  entryLabel: string;
  title: string;
  description: string[];
  products: ProductContent[];
};

const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;

const PLANETS: Record<PlanetKey, PlanetContent> = {
  baby: {
    id: "baby",
    modelUrl: "models/lg-model-baby2.glb",
    pointDataUrl: "models/lg-model-baby2-points",
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
    modelUrl: "models/lg-model-plant2.glb",
    pointDataUrl: "models/lg-model-plant2-final-points",
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
    modelUrl: "models/lg-model-party.glb",
    pointDataUrl: "models/lg-model-party-final-points",
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
    modelUrl: "models/lg-model-dressroom2.glb",
    pointDataUrl: "models/lg-model-dressroom2-points",
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
    modelUrl: "models/lg-model-bathroom2.glb",
    pointDataUrl: "models/lg-model-bathroom2-points",
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
    modelUrl: "models/lg-model-cat2.glb",
    pointDataUrl: "models/lg-model-cat2-points",
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
    modelUrl: "models/lg-model-20s2.glb",
    pointDataUrl: "models/lg-model-20s2-points",
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
  { className: "pg-planet--a", planet: "baby", orbit: "4", phase: "2.78", speed: "0.1", label: "육아하는 부부의 행성 선택" },
  { className: "pg-planet--b", planet: "bath", orbit: "2", phase: "3.46", speed: "0.16", label: "배스 케어의 행성 선택" },
  { className: "pg-planet--c", planet: "plant", orbit: "3", phase: "5.02", speed: "0.12", label: "식물과 함께 사는 행성 선택" },
  { className: "pg-planet--d", planet: "party", orbit: "4", phase: "6.06", speed: "0.09", label: "파티를 즐기는 행성 선택" },
  { className: "pg-planet--e", planet: "dress", orbit: "2", phase: "0.78", speed: "0.15", label: "드레스룸의 행성 선택" },
  { className: "pg-planet--f", planet: "20s", orbit: "1", phase: "4.82", speed: "0.22", label: "20대 싱글의 행성 선택" },
  { className: "pg-planet--g", planet: "cats", orbit: "2", phase: "2.28", speed: "0.13", label: "반려묘 가족의 행성 선택" }
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

function preloadPointData() {
  const urls = new Set<string>();

  PLANET_ORDER.forEach((key) => {
    const pointDataUrl = PLANETS[key].pointDataUrl;
    if (!pointDataUrl) return;
    urls.add(assetUrl(`${pointDataUrl}.json`));
    urls.add(assetUrl(`${pointDataUrl}.bin`));
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

const ENTRY_PARTICLES = Array.from({ length: 280 }, (_, index) => {
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

function Loader() {
  const { active, progress } = useProgress();

  if (!active && progress >= 100) return null;

  return (
    <div className="loader" aria-live="polite">
      <Sparkles size={26} strokeWidth={1.6} />
      <span>Preparing point field</span>
      <strong>{Math.round(progress)}%</strong>
    </div>
  );
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
  modelUrl,
  pointDataUrl,
  introPaused = false
}: {
  settings: ViewerSettings;
  modelUrl: string;
  pointDataUrl?: string;
  introPaused?: boolean;
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
          modelUrl={modelUrl}
          pointDataUrl={pointDataUrl}
          settings={settings}
          maxDensity={MAX_DENSITY}
          displayPosition={MODEL_DISPLAY_POSITION}
          introPaused={introPaused}
        />
      </Suspense>

      <OrbitControls
        makeDefault
        target={MODEL_DISPLAY_POSITION}
        enableDamping
        dampingFactor={0.06}
        minDistance={1.2}
        maxDistance={9}
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
  onEnterStart,
  onEnterComplete
}: {
  onEnterStart: (planet: PlanetKey) => void;
  onEnterComplete: (planet: PlanetKey) => void;
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
    window.setTimeout(() => onEnterComplete(planet), ENTRY_LOADING_DURATION_MS);
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
    let drag: null | { id: number; x: number; y: number; moved: boolean; rotationX: number; rotationY: number; rotationZ: number } = null;
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
        moved: false,
        rotationX: rotation.x,
        rotationY: rotation.y,
        rotationZ: rotation.z
      };
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      rotation.y = drag.rotationY + dx * 0.34;
      rotation.x = Math.max(-138, Math.min(138, drag.rotationX - dy * 0.34));
      rotation.z = drag.rotationZ + dx * 0.045 + dy * 0.025;
    };
    const stopDrag = () => {
      if (drag?.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 120);
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
        <p className="pg-guide">손끝으로 궤도를 움직이며 행성을 발견해보세요.</p>
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
            style={{ "--planet-texture": `url("${assetUrl(`images/planets/${button.planet === "20s" ? "20s" : button.planet}-sphere.png`)}")` } as React.CSSProperties}
          />
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

type DetailControlProps = {
  settings: ViewerSettings;
  onChange: <Key extends keyof ViewerSettings>(key: Key, value: ViewerSettings[Key]) => void;
};

function DetailSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  const progress = Math.max(0, Math.min(1, (value - min) / (max - min)));

  return (
    <label className="particle-control" style={{ "--slider-progress": progress } as React.CSSProperties}>
      <span className="particle-control__label">
        <span>{label}</span>
        <output>{display}</output>
      </span>
      <span className="particle-control__visual" aria-hidden="true">
        <i />
      </span>
      <input
        min={min}
        max={max}
        step={step}
        type="range"
        value={value}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ParticleControls({ settings, onChange }: DetailControlProps) {
  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<null | { pointerId: number; startX: number; startY: number; panelX: number; panelY: number }>(null);

  useEffect(() => {
    const placePanel = () => {
      const scale = getStageScale();
      const stageX = (window.innerWidth - 1920 * scale) / 2;
      const stageY = (window.innerHeight - 1080 * scale) / 2;

      setPanelPosition({
        x: stageX + 1588 * scale,
        y: stageY + 496.36 * scale,
        scale
      });
    };

    placePanel();
    window.addEventListener("resize", placePanel);
    return () => window.removeEventListener("resize", placePanel);
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panelX: panelPosition.x,
      panelY: panelPosition.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const width = Math.min(237 * panelPosition.scale, window.innerWidth - 36);
    const nextX = Math.max(8, Math.min(window.innerWidth - width - 8, drag.panelX + event.clientX - drag.startX));
    const nextY = Math.max(8, Math.min(window.innerHeight - 120, drag.panelY + event.clientY - drag.startY));
    setPanelPosition((current) => ({ ...current, x: nextX, y: nextY }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <aside
      className="particle-panel"
      aria-label="Particle controls"
      style={{ left: panelPosition.x, top: panelPosition.y, "--control-scale": panelPosition.scale } as React.CSSProperties}
    >
      <div
        className="particle-panel__header"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <strong>Parameters</strong>
        <span>drag</span>
      </div>
      <DetailSlider
        label="Size"
        value={settings.particleSize}
        min={0.001}
        max={0.008}
        step={0.0005}
        display=""
        onChange={(value) => onChange("particleSize", value)}
      />
      <DetailSlider
        label="Density"
        value={settings.density}
        min={80_000}
        max={MAX_DENSITY}
        step={5_000}
        display=""
        onChange={(value) => onChange("density", value)}
      />
      <DetailSlider
        label="Glow"
        value={settings.glow}
        min={0}
        max={2.4}
        step={0.05}
        display=""
        onChange={(value) => onChange("glow", value)}
      />
    </aside>
  );
}

function EntryLoadingOverlay({ planet }: { planet: PlanetContent }) {
  return (
    <div className="entry-loading" aria-live="polite" aria-label={`${planet.entryLabel}의 Personal Gravity로 진입하는 중`}>
      <p className="entry-loading__eyebrow">PERSONAL GRAVITY</p>
      <strong>{planet.entryLabel}의 Personal Gravity로 진입하는 중...</strong>
      <p>입자의 흐름이 행성의 리듬에 맞춰 정렬되고 있습니다.</p>
    </div>
  );
}

function DetailPage({
  settings,
  planet,
  onBack,
  onPreviousPlanet,
  onNextPlanet,
  onSettingsChange,
  isTransitioning = false
}: {
  settings: ViewerSettings;
  planet: PlanetContent;
  onBack: () => void;
  onPreviousPlanet: () => void;
  onNextPlanet: () => void;
  onSettingsChange: DetailControlProps["onChange"];
  isTransitioning?: boolean;
}) {
  const settingsSnapshot = useMemo(() => settings, [settings]);
  const [stageScale, setStageScale] = useState(1);

  useEffect(() => {
    const syncScale = () => setStageScale(getStageScale());

    syncScale();
    window.addEventListener("resize", syncScale);
    return () => window.removeEventListener("resize", syncScale);
  }, []);

  return (
    <div
      className={`detail-stage${isTransitioning ? " is-transitioning" : " is-active"}`}
      style={{ "--stage-scale": stageScale } as React.CSSProperties}
    >
      <Scene
        settings={settingsSnapshot}
        modelUrl={assetUrl(planet.modelUrl)}
        pointDataUrl={planet.pointDataUrl ? assetUrl(planet.pointDataUrl) : undefined}
        introPaused={isTransitioning}
      />
      {!isTransitioning && (
        <>
          <GravityInterface
            planet={planet}
            onBack={onBack}
            onPreviousPlanet={onPreviousPlanet}
            onNextPlanet={onNextPlanet}
          />
          <ParticleControls settings={settings} onChange={onSettingsChange} />
        </>
      )}
      {!planet.pointDataUrl && <Loader />}
    </div>
  );
}

function GravityInterface({
  planet,
  onBack,
  onPreviousPlanet,
  onNextPlanet
}: {
  planet: PlanetContent;
  onBack: () => void;
  onPreviousPlanet: () => void;
  onNextPlanet: () => void;
}) {
  return (
    <section className="gravity-frame" aria-label="Personal Gravity">
      <div className="title-copy">
        <PersonalGravityBrand />
        <p>행성을 움직이며 구경해보세요.</p>
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

      <p className="parameter-note">슬라이더를 움직여<br />입자와 흐름을 조절해보세요.</p>

      <div className="bottom-guide">
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
  const [settings, setSettings] = useState<ViewerSettings>(DEFAULT_SETTINGS);
  const planetParam = new URLSearchParams(window.location.search).get("planet");
  const initialPlanet = isPlanetKey(planetParam) ? planetParam : "baby";
  const shouldStartDetail =
    new URLSearchParams(window.location.search).get("view") === "detail" ||
    (window as Window & { __PERSONAL_GRAVITY_START_DETAIL__?: boolean }).__PERSONAL_GRAVITY_START_DETAIL__ === true;
  const [view, setView] = useState<"home" | "detail">(shouldStartDetail ? "detail" : "home");
  const [selectedPlanet, setSelectedPlanet] = useState<PlanetKey>(initialPlanet);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const currentPlanet = PLANETS[selectedPlanet];
  const movePlanet = (direction: -1 | 1) => {
    const currentIndex = PLANET_ORDER.indexOf(selectedPlanet);
    const nextPlanet = PLANET_ORDER[(currentIndex + direction + PLANET_ORDER.length) % PLANET_ORDER.length];

    setSelectedPlanet(nextPlanet);
    setView("detail");
    setIsTransitioning(false);
    updateBrowserUrl("detail", nextPlanet);
  };

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
          onBack={() => {
            setIsTransitioning(false);
            setView("home");
            updateBrowserUrl("home", selectedPlanet);
          }}
          onPreviousPlanet={() => movePlanet(-1)}
          onNextPlanet={() => movePlanet(1)}
          onSettingsChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
        />
      )}
      {isTransitioning && <EntryLoadingOverlay planet={currentPlanet} />}
      {view === "home" && (
        <HomePage
          onEnterStart={(planet) => {
            setSelectedPlanet(planet);
            setIsTransitioning(true);
          }}
          onEnterComplete={(planet) => {
            setSelectedPlanet(planet);
            setView("detail");
            setIsTransitioning(false);
            updateBrowserUrl("detail", planet);
          }}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <App />
);
