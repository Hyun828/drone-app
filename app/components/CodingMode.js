"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export default function CodingMode({ CodingScene, checkBoxHit, getDirectionLabel }) {
  const darkenHex = (hex, factor = 0.72) => {
    const raw = String(hex || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return "#7c3aed";
    const to = (idx) => parseInt(raw.slice(idx, idx + 2), 16);
    const r = Math.max(0, Math.min(255, Math.floor(to(0) * factor)));
    const g = Math.max(0, Math.min(255, Math.floor(to(2) * factor)));
    const b = Math.max(0, Math.min(255, Math.floor(to(4) * factor)));
    const h = (n) => n.toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  };
  const GROUNDED_Y = 0.5;
  const START_POSITION = [0.5, GROUNDED_Y, 0.5];
  const START_ROTATION = 0;
  const STEP = 1;
  const ROTATE_STEP = Math.PI / 2;

  const goalPosition = useMemo(() => [4, 2, -4], []);
  const obstaclePosition = useMemo(() => [2, 1, -2], []);

  const [dronePosition, setDronePosition] = useState(START_POSITION);
  const [rotationY, setRotationY] = useState(START_ROTATION);
  const [commands, setCommands] = useState([{ id: 1, type: "이륙", amount: null }]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [currentCommandId, setCurrentCommandId] = useState(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isCrash, setIsCrash] = useState(false);
  const [centerResult, setCenterResult] = useState(null); // { type: "success" | "error", message: string } | null
  const [dropIndex, setDropIndex] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [dragCursor, setDragCursor] = useState(null);

  // Activity-area editor (grid placement)
  const [selectedPlacementType, setSelectedPlacementType] = useState("obstacle"); // "obstacle" | "goal" | null
  const [hoverCell, setHoverCell] = useState(null); // { x, z } in grid coords
  const [placedItems, setPlacedItems] = useState(() => ({
    obstacles: [{ id: 1, x: 2, z: -2, level: 0, color: "#a78bfa", edgeColor: "#7c3aed" }],
    goal: { x: 4, z: -4 },
  }));
  const [showTopCommandPalette, setShowTopCommandPalette] = useState(true);
  const [showLeftCommandList, setShowLeftCommandList] = useState(true);
  const [showObjectMenu, setShowObjectMenu] = useState(true);
  const [codingMainMode, setCodingMainMode] = useState("mission"); // "edit" | "mission"
  const [missionStage, setMissionStage] = useState(1);
  const [completedMissionStages, setCompletedMissionStages] = useState(() => new Set());
  const [showMissionIntro, setShowMissionIntro] = useState(false);
  const [showAllMissionsCompletePopup, setShowAllMissionsCompletePopup] = useState(false);
  const [showObstacleColorPicker, setShowObstacleColorPicker] = useState(false);
  const [isFastExecution, setIsFastExecution] = useState(false);
  const [obstacleColor, setObstacleColor] = useState("#a78bfa");
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);

  const timerRef = useRef(null);
  const rafRef = useRef(null);
  const crashResetTimerRef = useRef(null);
  const audioRef = useRef({
    ctx: null,
    master: null,
    rotorOscA: null,
    rotorOscB: null,
    rotorGainA: null,
    rotorGainB: null,
  });
  const runTokenRef = useRef(0);
  const nextCommandIdRef = useRef(2);
  const allMissionsCelebrationShownRef = useRef(false);
  const allMissionsCelebrationTimerRef = useRef(null);
  const listContainerRef = useRef(null);

  const commandPalette = useMemo(
    () => [
      { type: "앞으로 이동", colorClass: "bg-red-500 text-white" },
      { type: "뒤로 이동", colorClass: "bg-red-500 text-white" },
      { type: "왼쪽 이동", colorClass: "bg-orange-500 text-white" },
      { type: "오른쪽 이동", colorClass: "bg-orange-500 text-white" },
      { type: "왼쪽 90도 회전", colorClass: "bg-yellow-500 text-white" },
      { type: "오른쪽 90도 회전", colorClass: "bg-yellow-500 text-white" },
      { type: "상승", colorClass: "bg-green-500 text-white" },
      { type: "하강", colorClass: "bg-green-500 text-white" },
      { type: "이륙", colorClass: "bg-blue-500 text-white" },
      { type: "착륙", colorClass: "bg-blue-500 text-white" },
      { type: "반복", colorClass: "bg-violet-600 text-white" },
    ],
    []
  );
  const commandColorByType = useMemo(
    () => Object.fromEntries(commandPalette.map((c) => [c.type, c.colorClass])),
    [commandPalette]
  );
  const missionStageConfigs = useMemo(
    () => ({
      1: {
        obstacles: [
          { x: 2, z: -1, level: 0, color: "#f472b6", edgeColor: darkenHex("#f472b6") },
          { x: 3, z: -2, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
        ],
        commands: [
          { type: "이륙" },
          { type: "앞으로 이동", amount: 4 },
          { type: "빈칸" },
          { type: "착륙" },
        ],
      },
      2: {
        obstacles: [
          { x: 0, z: -1, level: 0, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: 1, z: -2, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 3, z: -3, level: 0, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
        ],
        commands: [
          { type: "이륙" },
          { type: "오른쪽 이동", amount: 4 },
          { type: "빈칸" },
          { type: "착륙" },
        ],
      },
      3: {
        obstacles: [
          { x: 2, z: -1, level: 0, color: "#f87171", edgeColor: darkenHex("#f87171") },
          { x: 3, z: -2, level: 0, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: 1, z: -3, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 4, z: -2, level: 0, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
          { x: 0, z: -3, level: 0, color: "#94a3b8", edgeColor: darkenHex("#94a3b8") },
        ],
        commands: [
          { type: "이륙" },
          { type: "앞으로 이동", amount: 2 },
          { type: "오른쪽 이동", amount: 2 },
          { type: "앞으로 이동", amount: 2 },
          { type: "빈칸" },
          { type: "착륙" },
        ],
      },
      4: {
        obstacles: [
          { x: 2, z: -1, level: 0, color: "#f87171", edgeColor: darkenHex("#f87171") },
          { x: 3, z: -2, level: 0, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: 1, z: -3, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 4, z: -2, level: 0, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
          { x: 0, z: -3, level: 0, color: "#94a3b8", edgeColor: darkenHex("#94a3b8") },
        ],
        commands: [
          { type: "이륙" },
          {
            type: "반복",
            amount: 2,
            children: [
              { type: "앞으로 이동", amount: 2 },
              { type: "빈칸" },
            ],
          },
          { type: "착륙" },
        ],
      },
      5: {
        obstacles: [
          // 기존 6단계: 계단형 배치
          { x: 1, z: 0, level: 0, color: "#f87171", edgeColor: darkenHex("#f87171") },
          { x: 2, z: -1, level: 0, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: 3, z: -2, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 4, z: -3, level: 0, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
          { x: 0, z: -2, level: 0, color: "#f87171", edgeColor: darkenHex("#f87171") },
          { x: 1, z: -3, level: 0, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: 2, z: -4, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 3, z: -5, level: 0, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
        ],
        commands: [
          { type: "이륙" },
          { type: "반복", amount: 4, children: [{ type: "빈칸" }, { type: "빈칸" }] },
          { type: "착륙" },
        ],
      },
      6: {
        allowFreeCommandInsert: true,
        // 6단계는 기본 명령을 이륙/착륙만 두고,
        // 그 사이는 개수 제한 없이 자유롭게 채우는 단계.
        obstacles: [
          { x: 1, z: 0, level: 0, color: "#f87171", edgeColor: darkenHex("#f87171") },
          { x: 2, z: -1, level: 0, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: 3, z: -2, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 4, z: -3, level: 0, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
          { x: 0, z: -2, level: 0, color: "#f87171", edgeColor: darkenHex("#f87171") },
          { x: 1, z: -3, level: 0, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: 2, z: -4, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 3, z: -5, level: 0, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
        ],
        commands: [
          { type: "이륙" },
          { type: "착륙" },
        ],
      },
      7: {
        obstacles: [
          { x: 0, z: -2, level: 0, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: 4, z: -1, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 1, z: -4, level: 0, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
          { x: 3, z: -2, level: 0, color: "#f472b6", edgeColor: darkenHex("#f472b6") },
        ],
        commands: [
          { type: "이륙" },
          {
            type: "반복",
            amount: 2,
            children: [
              { type: "빈칸" },
              { type: "빈칸" },
            ],
          },
          { type: "앞으로 이동", amount: 2 },
          { type: "오른쪽 이동", amount: 2 },
          { type: "착륙" },
        ],
      },
      8: {
        // 시작 지점 주변을 3칸 높이(level 2)로 둘러, 상승 3회 후에만 이동 가능
        goal: { x: 2, z: -2 },
        obstacles: [
          { x: -1, z: -1, level: 0, color: "#f472b6", edgeColor: darkenHex("#f472b6") },
          { x: -1, z: -1, level: 1, color: "#f472b6", edgeColor: darkenHex("#f472b6") },
          { x: -1, z: -1, level: 2, color: "#f472b6", edgeColor: darkenHex("#f472b6") },
          { x: 0, z: -1, level: 0, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 0, z: -1, level: 1, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 0, z: -1, level: 2, color: "#a78bfa", edgeColor: darkenHex("#a78bfa") },
          { x: 1, z: -1, level: 0, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
          { x: 1, z: -1, level: 1, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
          { x: 1, z: -1, level: 2, color: "#60a5fa", edgeColor: darkenHex("#60a5fa") },
          { x: -1, z: 0, level: 0, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: -1, z: 0, level: 1, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: -1, z: 0, level: 2, color: "#f59e0b", edgeColor: darkenHex("#f59e0b") },
          { x: 1, z: 0, level: 0, color: "#34d399", edgeColor: darkenHex("#34d399") },
          { x: 1, z: 0, level: 1, color: "#34d399", edgeColor: darkenHex("#34d399") },
          { x: 1, z: 0, level: 2, color: "#34d399", edgeColor: darkenHex("#34d399") },
          { x: -1, z: 1, level: 0, color: "#f87171", edgeColor: darkenHex("#f87171") },
          { x: -1, z: 1, level: 1, color: "#f87171", edgeColor: darkenHex("#f87171") },
          { x: -1, z: 1, level: 2, color: "#f87171", edgeColor: darkenHex("#f87171") },
          { x: 0, z: 1, level: 0, color: "#22d3ee", edgeColor: darkenHex("#22d3ee") },
          { x: 0, z: 1, level: 1, color: "#22d3ee", edgeColor: darkenHex("#22d3ee") },
          { x: 0, z: 1, level: 2, color: "#22d3ee", edgeColor: darkenHex("#22d3ee") },
          { x: 1, z: 1, level: 0, color: "#c084fc", edgeColor: darkenHex("#c084fc") },
          { x: 1, z: 1, level: 1, color: "#c084fc", edgeColor: darkenHex("#c084fc") },
          { x: 1, z: 1, level: 2, color: "#c084fc", edgeColor: darkenHex("#c084fc") },
        ],
        commands: [
          { type: "이륙" },
          { type: "상승", amount: 3 },
          { type: "앞으로 이동", amount: 2 },
          { type: "빈칸" },
          { type: "착륙" },
        ],
      },
    }),
    []
  );
  const missionStageNumbers = useMemo(
    () =>
      Object.keys(missionStageConfigs)
        .map(Number)
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b),
    [missionStageConfigs]
  );
  const isMissionMode = codingMainMode === "mission";
  const isBlankCommand = (command) => command?.type === "빈칸";
  /** 미션 반복 안 빈칸까지 포함 — 얕은 some()만 쓰면 빈칸 없이 실행되는 버그가 난다. */
  function commandTreeContainsBlank(list) {
    if (!Array.isArray(list)) return false;
    return list.some((c) => {
      if (isBlankCommand(c)) return true;
      if (Array.isArray(c.children) && c.children.length) return commandTreeContainsBlank(c.children);
      return false;
    });
  }
  const usesMoveAmount = (type) =>
    type === "앞으로 이동" ||
    type === "뒤로 이동" ||
    type === "왼쪽 이동" ||
    type === "오른쪽 이동";
  const usesVerticalAmount = (type) => type === "상승" || type === "하강";
  const usesRotationAmount = (type) =>
    type === "왼쪽 90도 회전" || type === "오른쪽 90도 회전";
  const isLoopType = (type) => type === "반복";
  const formatCommandLabel = (command) => {
    if (!command) return "";
    if (isBlankCommand(command)) return "빈칸 (명령 1개 추가)";
    if (isLoopType(command.type)) {
      const count = Number.isFinite(command.amount) ? command.amount : 1;
      return `${count}번 반복`;
    }
    if (usesMoveAmount(command.type)) {
      const count = Number.isFinite(command.amount) ? command.amount : 1;
      return `${command.type.split(" ")[0]} ${count}칸 이동`;
    }
    if (usesVerticalAmount(command.type)) {
      const count = Number.isFinite(command.amount) ? command.amount : 1;
      return `${count}칸 ${command.type}`;
    }
    if (usesRotationAmount(command.type)) {
      const angle = Number.isFinite(command.amount) ? command.amount : 90;
      const dir = command.type.startsWith("왼쪽") ? "왼쪽" : "오른쪽";
      return `${dir} ${angle}도 회전`;
    }
    return command.type;
  };

  function createCommand(type, amount = null) {
    const defaultAmount = usesRotationAmount(type)
      ? Number.isFinite(amount) && amount > 0
        ? amount
        : 90
      : usesMoveAmount(type) || usesVerticalAmount(type)
        ? Number.isFinite(amount) && amount > 0
          ? amount
          : 1
        : isLoopType(type)
          ? Number.isFinite(amount) && amount > 0
            ? amount
            : 1
          : amount;
    const normalizedAmount =
      defaultAmount !== null && Number.isFinite(defaultAmount)
        ? Math.max(1, Math.floor(defaultAmount))
        : null;
    const base = {
      id: nextCommandIdRef.current++,
      type,
      amount: normalizedAmount,
    };
    if (isLoopType(type)) {
      return { ...base, children: [] };
    }
    return base;
  }

  function createBlankCommand() {
    return { id: nextCommandIdRef.current++, type: "빈칸", amount: null };
  }

  function createCommandFromDescriptor(desc) {
    if (!desc || typeof desc !== "object") return createBlankCommand();
    if (desc.type === "빈칸") return createBlankCommand();
    if (desc.type === "반복") {
      const loop = createCommand("반복", Number.isFinite(desc.amount) ? desc.amount : 1);
      return {
        ...loop,
        missionFixedAmount: true,
        children: Array.isArray(desc.children)
          ? desc.children.map((child) => createCommandFromDescriptor(child))
          : [],
      };
    }
    return {
      ...createCommand(desc.type, desc.amount ?? null),
      missionFixedAmount: true,
    };
  }

  function buildMissionCommandsWithBlank(stageNumber) {
    const config = missionStageConfigs[stageNumber];
    if (!config) return [{ id: 1, type: "이륙", amount: null }];
    if (!Array.isArray(config.commands) || config.commands.length === 0) {
      return [{ id: 1, type: "이륙", amount: null }];
    }
    return config.commands.map((entry) => createCommandFromDescriptor(entry));
  }

  function resetDroneOnly() {
    runTokenRef.current += 1;
    setDronePosition(START_POSITION);
    setRotationY(START_ROTATION);
    setIsSuccess(false);
    setIsCrash(false);
    setIsRunning(false);
    setCurrentIndex(-1);
    setCurrentCommandId(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (crashResetTimerRef.current) clearTimeout(crashResetTimerRef.current);
    stopRotorLoop();
    setCenterResult(null);
  }

  function ensureAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      const store = audioRef.current;
      if (!store.ctx) {
        store.ctx = new AudioCtx();
        store.master = store.ctx.createGain();
        store.master.gain.value = 0.2;
        store.master.connect(store.ctx.destination);
      }
      if (store.ctx.state === "suspended") store.ctx.resume();
      return store;
    } catch {
      return null;
    }
  }

  function startRotorLoop() {
    const store = ensureAudioContext();
    if (!store || store.rotorOscA || store.rotorOscB) return;
    const now = store.ctx.currentTime;
    const oscA = store.ctx.createOscillator();
    const oscB = store.ctx.createOscillator();
    const gainA = store.ctx.createGain();
    const gainB = store.ctx.createGain();
    oscA.type = "sawtooth";
    oscB.type = "triangle";
    oscA.frequency.setValueAtTime(125, now);
    oscB.frequency.setValueAtTime(182, now);
    gainA.gain.setValueAtTime(0.0001, now);
    gainB.gain.setValueAtTime(0.0001, now);
    gainA.gain.exponentialRampToValueAtTime(0.06, now + 0.18);
    gainB.gain.exponentialRampToValueAtTime(0.035, now + 0.18);
    oscA.connect(gainA);
    oscB.connect(gainB);
    gainA.connect(store.master);
    gainB.connect(store.master);
    oscA.start(now);
    oscB.start(now);
    store.rotorOscA = oscA;
    store.rotorOscB = oscB;
    store.rotorGainA = gainA;
    store.rotorGainB = gainB;
  }

  function stopRotorLoop() {
    const store = audioRef.current;
    if (!store?.ctx) return;
    const now = store.ctx.currentTime;
    if (store.rotorGainA) {
      store.rotorGainA.gain.cancelScheduledValues(now);
      store.rotorGainA.gain.setValueAtTime(Math.max(0.0001, store.rotorGainA.gain.value), now);
      store.rotorGainA.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    }
    if (store.rotorGainB) {
      store.rotorGainB.gain.cancelScheduledValues(now);
      store.rotorGainB.gain.setValueAtTime(Math.max(0.0001, store.rotorGainB.gain.value), now);
      store.rotorGainB.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    }
    if (store.rotorOscA) {
      try {
        store.rotorOscA.stop(now + 0.18);
      } catch {}
    }
    if (store.rotorOscB) {
      try {
        store.rotorOscB.stop(now + 0.18);
      } catch {}
    }
    store.rotorOscA = null;
    store.rotorOscB = null;
    store.rotorGainA = null;
    store.rotorGainB = null;
  }

  function playSuccessChime() {
    const store = ensureAudioContext();
    if (!store) return;
    const now = store.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const t = now + i * 0.14;
      const osc = store.ctx.createOscillator();
      const gain = store.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(gain);
      gain.connect(store.master);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }

  function stopExecution() {
    // 실행 중일 때 즉시 중단하고 코딩 모드의 초기 화면 상태로 복귀
    resetDroneOnly();
  }

  function resetAll() {
    resetDroneOnly();
    // "이륙" 명령은 항상 기본 포함
    if (isMissionMode) {
      setCommands(buildMissionCommandsWithBlank(missionStage));
    } else {
      setCommands([{ id: 1, type: "이륙", amount: null }]);
    }
  }

  function resetDroneAndView() {
    resetDroneOnly();
    setCameraResetToken((v) => v + 1);
  }

  function triggerCrashAndAutoReset(position, rotation) {
    if (position) setDronePosition(position);
    if (Number.isFinite(rotation)) setRotationY(rotation);
    setIsCrash(true);
    setIsRunning(false);
    setCurrentIndex(-1);
    setCurrentCommandId(null);
    runTokenRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (crashResetTimerRef.current) clearTimeout(crashResetTimerRef.current);
    stopRotorLoop();
    setCenterResult({ type: "error", message: "실패했습니다! 장애물과 충돌했습니다." });
    crashResetTimerRef.current = setTimeout(() => {
      resetDroneOnly();
    }, 1600);
  }

  function clearPlacedObjects() {
    if (isMissionMode) return;
    setPlacedItems({ obstacles: [], goal: null });
  }

  function removeLastCommand() {
    if (isRunning || commands.length <= 1) return;
    setCommands((prev) => prev.slice(0, -1));
  }

  function clearCommands() {
    if (isRunning) return;
    if (isMissionMode) return;
    // "이륙" 명령은 항상 기본 포함
    setCommands([{ id: 1, type: "이륙", amount: null }]);
  }

  function openCodingUI() {
    setShowTopCommandPalette(true);
    setShowLeftCommandList(true);
  }

  function closeCodingUI() {
    setShowTopCommandPalette(false);
    setShowLeftCommandList(false);
  }

  function addCommandFromPalette(type) {
    if (isRunning) return;
    if (isMissionMode) {
      const config = missionStageConfigs[missionStage];
      if (config?.allowFreeCommandInsert) {
        setCommands((prev) => {
          const insertAt = Math.max(
            1,
            prev.findIndex((c) => c.type === "착륙")
          );
          const next = [...prev];
          next.splice(insertAt, 0, { ...createCommand(type), replacedMissionBlank: true });
          return next;
        });
        setCenterResult(null);
        return;
      }
      const fillFirstBlank = (list) => {
        let replaced = false;
        const next = list.map((c) => {
          if (replaced) return c;
          if (isBlankCommand(c)) {
            replaced = true;
            return { ...createCommand(type), replacedMissionBlank: true };
          }
          if (Array.isArray(c.children) && c.children.length) {
            const nextChildren = fillFirstBlank(c.children);
            if (nextChildren !== c.children) {
              replaced = true;
              return { ...c, children: nextChildren };
            }
          }
          return c;
        });
        return replaced ? next : list;
      };
      setCommands((prev) => fillFirstBlank(prev));
      setCenterResult(null);
      return;
    }
    setCommands((prev) => [...prev, createCommand(type)]);
  }

  function moveCommandUp(index) {
    if (isRunning || index === 0 || isMissionMode) return;
    setCommands((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveCommandDown(index) {
    if (isRunning || index === commands.length - 1 || isMissionMode) return;
    setCommands((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function replaceCommandIdWithBlankRecursive(list, commandId) {
    return list.map((c) => {
      if (c.id === commandId) return createBlankCommand();
      if (c.children?.length) {
        return { ...c, children: replaceCommandIdWithBlankRecursive(c.children, commandId) };
      }
      return c;
    });
  }

  function removeCommand(commandId) {
    if (isRunning) return;
    // 첫 "이륙" 기본 명령은 삭제 불가
    if (commandId === 1) return;
    const removeRecursively = (list) =>
      list
        .filter((c) => c.id !== commandId)
        .map((c) =>
          c.children?.length ? { ...c, children: removeRecursively(c.children) } : c
        );
    if (isMissionMode) {
      setCommands((prev) => {
        const config = missionStageConfigs[missionStage];
        if (config?.allowFreeCommandInsert) {
          // 자유 추가 단계(예: 6단계)는 삭제 시 빈칸 복구 대신 완전 삭제.
          return removeRecursively(prev);
        }
        const target = findCommandById(prev, commandId);
        if (!target || isBlankCommand(target) || !target.replacedMissionBlank) return prev;
        return replaceCommandIdWithBlankRecursive(prev, commandId);
      });
      setCenterResult(null);
      return;
    }
    setCommands((prev) => removeRecursively(prev));
  }

  function extractCommandById(list, commandId) {
    for (let i = 0; i < list.length; i += 1) {
      const cmd = list[i];
      if (cmd.id === commandId) {
        const next = [...list];
        const [removed] = next.splice(i, 1);
        return { list: next, removed };
      }
      if (cmd.children?.length) {
        const result = extractCommandById(cmd.children, commandId);
        if (result.removed) {
          const next = [...list];
          next[i] = { ...cmd, children: result.list };
          return { list: next, removed: result.removed };
        }
      }
    }
    return { list, removed: null };
  }

  function insertIntoLoop(list, loopId, command) {
    return list.map((cmd) => {
      if (cmd.id === loopId && Array.isArray(cmd.children)) {
        return { ...cmd, children: [...cmd.children, command] };
      }
      if (cmd.children?.length) {
        return { ...cmd, children: insertIntoLoop(cmd.children, loopId, command) };
      }
      return cmd;
    });
  }

  function insertIntoLoopAt(list, loopId, insertIndex, command) {
    return list.map((cmd) => {
      if (cmd.id === loopId && Array.isArray(cmd.children)) {
        const nextChildren = [...cmd.children];
        const clamped = Math.max(0, Math.min(insertIndex, nextChildren.length));
        nextChildren.splice(clamped, 0, command);
        return { ...cmd, children: nextChildren };
      }
      if (cmd.children?.length) {
        return {
          ...cmd,
          children: insertIntoLoopAt(cmd.children, loopId, insertIndex, command),
        };
      }
      return cmd;
    });
  }

  function commandTreeContainsId(command, id) {
    if (!command) return false;
    if (command.id === id) return true;
    if (!command.children?.length) return false;
    return command.children.some((child) => commandTreeContainsId(child, id));
  }

  function findCommandById(list, commandId) {
    for (const cmd of list) {
      if (cmd.id === commandId) return cmd;
      if (cmd.children?.length) {
        const found = findCommandById(cmd.children, commandId);
        if (found) return found;
      }
    }
    return null;
  }

  function applyDropPayload(payload, target) {
    if (!payload || typeof payload !== "object" || !target) return;
    if (isMissionMode) return;
    setCommands((prev) => {
      let working = prev;
      let movingCommand = null;

      if (payload.source === "palette" && typeof payload.type === "string") {
        const amount =
          payload.amount !== null && Number.isFinite(payload.amount)
            ? Math.max(1, Math.floor(payload.amount))
            : null;
        movingCommand = createCommand(payload.type, amount);
      } else if (payload.source === "list" && Number.isFinite(payload.commandId)) {
        const extracted = extractCommandById(working, payload.commandId);
        working = extracted.list;
        movingCommand = extracted.removed;
      }

      if (!movingCommand) return prev;

      if (
        (target.type === "loop" || target.type === "loop-between") &&
        Number.isFinite(target.loopId) &&
        commandTreeContainsId(movingCommand, target.loopId)
      ) {
        return prev;
      }

      if (target.type === "top") {
        const clamped = Math.max(0, Math.min(target.index, working.length));
        const next = [...working];
        next.splice(clamped, 0, movingCommand);
        return next;
      }
      if (target.type === "loop" && Number.isFinite(target.loopId)) {
        return insertIntoLoop(working, target.loopId, movingCommand);
      }
      if (
        target.type === "loop-between" &&
        Number.isFinite(target.loopId) &&
        Number.isFinite(target.index)
      ) {
        return insertIntoLoopAt(working, target.loopId, target.index, movingCommand);
      }
      return working;
    });
  }

  function getDropIndexFromListEvent(container, clientY) {
    const items = Array.from(container.querySelectorAll("[data-command-item='true']"));
    if (items.length === 0) return 0;
    const pointerY = clientY;
    for (let i = 0; i < items.length; i += 1) {
      const rect = items[i].getBoundingClientRect();
      const midY = rect.top + rect.height * 0.5;
      if (pointerY < midY) return i;
    }
    return items.length;
  }

  function getLoopInsertIndexFromEvent(loopContainer, clientY) {
    const items = Array.from(loopContainer.querySelectorAll("[data-loop-item='true']"));
    if (items.length === 0) return 0;
    for (let i = 0; i < items.length; i += 1) {
      const rect = items[i].getBoundingClientRect();
      const midY = rect.top + rect.height * 0.5;
      if (clientY < midY) return i;
    }
    return items.length;
  }

  function getClientPoint(e) {
    if (e?.touches?.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e?.changedTouches?.length) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e?.clientX ?? 0, y: e?.clientY ?? 0 };
  }

  function startListPointerDrag(e, commandId) {
    if (isRunning || isMissionMode) return;
    if (dragState) return;
    e.preventDefault();
    const pt = getClientPoint(e);
    setDragState({ source: "list", commandId });
    setDragCursor({ x: pt.x, y: pt.y });
    setDropTarget(null);
  }

  useEffect(() => {
    if (!dragState) return;

    function handlePointerMove(e) {
      e.preventDefault();
      const container = listContainerRef.current;
      if (!container) return;
      setDragCursor({ x: e.clientX, y: e.clientY });
      const rect = container.getBoundingClientRect();
      const inX = e.clientX >= rect.left - 24 && e.clientX <= rect.right + 24;
      const inY = e.clientY >= rect.top - 24 && e.clientY <= rect.bottom + 24;
      if (!inX || !inY) {
        setDropIndex(null);
        setDropTarget(null);
        return;
      }
      const loopZones = Array.from(container.querySelectorAll("[data-loop-drop-id]"));
      let loopMatched = false;
      for (let i = 0; i < loopZones.length; i += 1) {
        const zone = loopZones[i];
        const zr = zone.getBoundingClientRect();
        if (e.clientX >= zr.left && e.clientX <= zr.right && e.clientY >= zr.top && e.clientY <= zr.bottom) {
          const loopId = Number(zone.getAttribute("data-loop-drop-id"));
          const index = getLoopInsertIndexFromEvent(zone, e.clientY);
          setDropTarget({ type: "loop-between", loopId, index });
          setDropIndex(null);
          loopMatched = true;
          break;
        }
      }
      if (loopMatched) return;
      const idx = getDropIndexFromListEvent(container, e.clientY);
      setDropIndex(idx);
      setDropTarget({ type: "top", index: idx });
    }

    function handlePointerUp() {
      if (dropTarget) {
        applyDropPayload(dragState, dropTarget);
      } else if (dropIndex !== null) {
        applyDropPayload(dragState, { type: "top", index: dropIndex });
      }
      setDropIndex(null);
      setDragState(null);
      setDragCursor(null);
      setDropTarget(null);
    }

    const hasPointerEvent = typeof window !== "undefined" && "PointerEvent" in window;

    function handleTouchMove(e) {
      if (!e.touches?.length) return;
      e.preventDefault();
      const t = e.touches[0];
      handlePointerMove({ preventDefault: () => {}, clientX: t.clientX, clientY: t.clientY });
    }

    function handleTouchEnd() {
      handlePointerUp();
    }

    if (hasPointerEvent) {
      window.addEventListener("pointermove", handlePointerMove, { passive: false });
      window.addEventListener("pointerup", handlePointerUp, { passive: true });
    } else {
      window.addEventListener("touchmove", handleTouchMove, { passive: false });
      window.addEventListener("touchend", handleTouchEnd, { passive: true });
      window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    }
    return () => {
      if (hasPointerEvent) {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      } else {
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleTouchEnd);
        window.removeEventListener("touchcancel", handleTouchEnd);
      }
    };
  }, [dragState, dropIndex, dropTarget]);

  function waitWithToken(ms, token) {
    const scaledMs = Math.max(60, Math.floor(ms / (isFastExecution ? 2 : 1)));
    return new Promise((resolve) => {
      timerRef.current = setTimeout(() => {
        resolve(token === runTokenRef.current);
      }, scaledMs);
    });
  }

  function animateCommandStep(fromPos, toPos, fromRot, toRot, durationMs, token, shouldAbortAt) {
    return new Promise((resolve) => {
      const start = performance.now();
      const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

      const tick = (now) => {
        if (token !== runTokenRef.current) {
          resolve(false);
          return;
        }
        const raw = Math.min(1, (now - start) / durationMs);
        const t = easeOut(raw);
        const nx = fromPos[0] + (toPos[0] - fromPos[0]) * t;
        const ny = fromPos[1] + (toPos[1] - fromPos[1]) * t;
        const nz = fromPos[2] + (toPos[2] - fromPos[2]) * t;
        const nr = fromRot + (toRot - fromRot) * t;
        const candidatePos = [nx, ny, nz];
        if (shouldAbortAt?.(candidatePos)) {
          setDronePosition(candidatePos);
          setRotationY(nr);
          resolve(false);
          return;
        }
        setDronePosition([nx, ny, nz]);
        setRotationY(nr);

        if (raw >= 1) {
          resolve(true);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    });
  }

  function updateCommandAmount(commandId, amount) {
    if (isRunning) return;
    const normalized =
      amount === null ? null : Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1;
    const update = (list) =>
      list.map((c) => {
        if (c.id === commandId) return { ...c, amount: normalized };
        if (c.children?.length) return { ...c, children: update(c.children) };
        return c;
      });
    setCommands((prev) => {
      if (isMissionMode) {
        const target = findCommandById(prev, commandId);
        if (target?.missionFixedAmount) return prev;
      }
      return update(prev);
    });
  }

  function updateCommandRotation(commandId, degrees) {
    if (isRunning) return;
    const allowed = [30, 60, 90, 120, 150, 180];
    const normalized = allowed.includes(degrees) ? degrees : 90;
    const update = (list) =>
      list.map((c) => {
        if (c.id === commandId) return { ...c, amount: normalized };
        if (c.children?.length) return { ...c, children: update(c.children) };
        return c;
      });
    setCommands((prev) => {
      if (isMissionMode) {
        const target = findCommandById(prev, commandId);
        if (target?.missionFixedAmount) return prev;
      }
      return update(prev);
    });
  }

  function updateLoopRepeat(commandId, amount) {
    if (isRunning) return;
    const normalized =
      amount === null ? null : Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1;
    const update = (list) =>
      list.map((c) => {
        if (c.id === commandId) return { ...c, amount: normalized };
        if (c.children?.length) return { ...c, children: update(c.children) };
        return c;
      });
    setCommands((prev) => {
      if (isMissionMode) {
        const target = findCommandById(prev, commandId);
        if (target?.missionFixedAmount) return prev;
      }
      return update(prev);
    });
  }

  function expandCommands(list) {
    const expanded = [];
    for (const cmd of list) {
      if (cmd.type === "반복") {
        const count = Math.max(1, Number.isFinite(cmd.amount) ? cmd.amount : 1);
        const inner = expandCommands(cmd.children ?? []);
        for (let i = 0; i < count; i += 1) expanded.push(...inner);
      } else if (cmd.type === "빈칸") {
        // 채워지지 않은 빈칸은 실행 큐에 넣지 않음(이중 방어)
      } else {
        expanded.push(cmd);
      }
    }
    return expanded;
  }

  function simulateStep(position, rotation, command, isFlying) {
    let [x, y, z] = position;
    let nextRotation = rotation;
    let nextIsFlying = isFlying;
    const moveUnits = Math.max(1, Number.isFinite(command.amount) ? command.amount : 1);
    const snapToCellCenter = (value) => Math.round(value - 0.5) + 0.5;
    const forwardX = -Math.sin(rotation);
    const forwardZ = -Math.cos(rotation);
    const rightX = Math.cos(rotation);
    const rightZ = -Math.sin(rotation);

    if (command.type === "이륙") {
      nextIsFlying = true;
      y = Math.max(y, GROUNDED_Y + STEP);
    }

    if (command.type === "착륙") {
      nextIsFlying = false;
      y = GROUNDED_Y;
    }

    // 이륙 전에는 명령을 실행하지 않고 그대로 넘어간다.
    if (!isFlying && command.type !== "이륙") {
      return {
        nextPosition: [x, y, z],
        nextRotation,
        nextIsFlying,
      };
    }

    if (nextIsFlying && command.type === "앞으로 이동") {
      x = snapToCellCenter(x + forwardX * STEP * moveUnits);
      z = snapToCellCenter(z + forwardZ * STEP * moveUnits);
    }

    if (nextIsFlying && command.type === "뒤로 이동") {
      x = snapToCellCenter(x - forwardX * STEP * moveUnits);
      z = snapToCellCenter(z - forwardZ * STEP * moveUnits);
    }

    if (nextIsFlying && command.type === "왼쪽 이동") {
      x = snapToCellCenter(x - rightX * STEP * moveUnits);
      z = snapToCellCenter(z - rightZ * STEP * moveUnits);
    }

    if (nextIsFlying && command.type === "오른쪽 이동") {
      x = snapToCellCenter(x + rightX * STEP * moveUnits);
      z = snapToCellCenter(z + rightZ * STEP * moveUnits);
    }

    const turnStepRad = (Math.PI * Math.max(30, Math.min(180, command.amount ?? 90))) / 180;
    if (command.type === "왼쪽 90도 회전") nextRotation = rotation + turnStepRad;
    if (command.type === "오른쪽 90도 회전") nextRotation = rotation - turnStepRad;
    if (nextIsFlying && command.type === "상승") y = y + STEP * moveUnits;
    if (nextIsFlying && command.type === "하강") y = Math.max(GROUNDED_Y, y - STEP * moveUnits);

    return {
      nextPosition: [x, y, z],
      nextRotation,
      nextIsFlying,
    };
  }

  function markMissionStageCompleted(stageNumber) {
    setCompletedMissionStages((prev) => {
      if (prev.has(stageNumber)) return prev;
      const next = new Set(prev);
      next.add(stageNumber);
      if (
        next.size >= missionStageNumbers.length &&
        !allMissionsCelebrationShownRef.current
      ) {
        allMissionsCelebrationShownRef.current = true;
        if (allMissionsCelebrationTimerRef.current) {
          clearTimeout(allMissionsCelebrationTimerRef.current);
        }
        allMissionsCelebrationTimerRef.current = setTimeout(() => {
          allMissionsCelebrationTimerRef.current = null;
          setShowAllMissionsCompletePopup(true);
        }, 1600);
      }
      return next;
    });
  }

  function runCommands() {
    if (isRunning || commands.length === 0) return;
    if (commandTreeContainsBlank(commands)) return;
    setCenterResult(null);

    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;

    setDronePosition(START_POSITION);
    setRotationY(START_ROTATION);
    setIsSuccess(false);
    setIsCrash(false);
    setShowMissionIntro(false);
    setIsRunning(true);
    setCurrentIndex(0);

    const sequence = expandCommands(commands);
    const hitPlacedObstacleAt = (position) =>
      (placedItems.obstacles ?? []).some((o) =>
        // Drone visual size was reduced, so collision box should be tighter too.
        checkBoxHit(position, [o.x + 0.5, 1 + (o.level ?? 0), o.z + 0.5], 0.68)
      );
    let tempPosition = [...START_POSITION];
    let tempRotation = START_ROTATION;
    let tempIsFlying = false;
    let idx = 0;

    async function runNext() {
      while (idx < sequence.length) {
        if (token !== runTokenRef.current) return;
        const command = sequence[idx];
        setCurrentIndex(idx);
        setCurrentCommandId(command.id);

        if (!tempIsFlying && command.type !== "이륙") {
          const ok = await waitWithToken(1000, token);
          if (!ok) return;
          idx += 1;
          continue;
        }

        const { nextPosition, nextRotation, nextIsFlying } = simulateStep(
          tempPosition,
          tempRotation,
          command,
          tempIsFlying
        );

        if (command.type === "이륙") {
          startRotorLoop();
          const stage1 = [tempPosition[0], GROUNDED_Y + 0.35, tempPosition[2]];
          const ok1 = await animateCommandStep(
            tempPosition,
            stage1,
            tempRotation,
            nextRotation,
            Math.max(120, Math.floor(900 / (isFastExecution ? 2 : 1))),
            token,
            (candidatePos) => {
              if (!hitPlacedObstacleAt(candidatePos)) return false;
              triggerCrashAndAutoReset(candidatePos, nextRotation);
              return true;
            }
          );
          if (!ok1) return;
          const ok2 = await animateCommandStep(
            stage1,
            nextPosition,
            nextRotation,
            nextRotation,
            Math.max(120, Math.floor(1400 / (isFastExecution ? 2 : 1))),
            token,
            (candidatePos) => {
              if (!hitPlacedObstacleAt(candidatePos)) return false;
              triggerCrashAndAutoReset(candidatePos, nextRotation);
              return true;
            }
          );
          if (!ok2) return;
        } else if (command.type === "착륙") {
          const ok = await animateCommandStep(
            tempPosition,
            nextPosition,
            tempRotation,
            nextRotation,
            Math.max(120, Math.floor(1700 / (isFastExecution ? 2 : 1))),
            token,
            (candidatePos) => {
              if (!hitPlacedObstacleAt(candidatePos)) return false;
              triggerCrashAndAutoReset(candidatePos, nextRotation);
              return true;
            }
          );
          if (!ok) return;
        } else if (usesMoveAmount(command.type)) {
          const ok = await animateCommandStep(
            tempPosition,
            nextPosition,
            tempRotation,
            nextRotation,
            Math.max(120, Math.floor(1840 / (isFastExecution ? 2 : 1))),
            token,
            (candidatePos) => {
              if (!hitPlacedObstacleAt(candidatePos)) return false;
              triggerCrashAndAutoReset(candidatePos, nextRotation);
              return true;
            }
          );
          if (!ok) return;
        } else {
          const ok = await animateCommandStep(
            tempPosition,
            nextPosition,
            tempRotation,
            nextRotation,
            Math.max(120, Math.floor(1440 / (isFastExecution ? 2 : 1))),
            token,
            (candidatePos) => {
              if (!hitPlacedObstacleAt(candidatePos)) return false;
              triggerCrashAndAutoReset(candidatePos, nextRotation);
              return true;
            }
          );
          if (!ok) return;
        }

        const hitPlacedObstacle = hitPlacedObstacleAt(nextPosition);
        if (hitPlacedObstacle) {
          triggerCrashAndAutoReset(nextPosition, nextRotation);
          return;
        }

        const activeGoal = placedItems.goal
          ? [placedItems.goal.x + 0.5, goalPosition[1], placedItems.goal.z + 0.5]
          : goalPosition;
        const landedOnGoal =
          command.type === "착륙" &&
          !nextIsFlying &&
          Math.abs(nextPosition[0] - activeGoal[0]) < 0.45 &&
          Math.abs(nextPosition[2] - activeGoal[2]) < 0.45;
        if (landedOnGoal) {
          stopRotorLoop();
          playSuccessChime();
          setIsSuccess(true);
          setIsRunning(false);
          setCurrentIndex(-1);
          setCurrentCommandId(null);
          setCenterResult({ type: "success", message: "성공입니다! 축하합니다!" });
          markMissionStageCompleted(missionStage);
          if (crashResetTimerRef.current) clearTimeout(crashResetTimerRef.current);
          crashResetTimerRef.current = setTimeout(() => {
            if (isMissionMode) {
              const availableStages = Object.keys(missionStageConfigs)
                .map((s) => Number(s))
                .filter(Number.isFinite)
                .sort((a, b) => a - b);
              const next = availableStages.find((s) => s > missionStage) ?? missionStage;
              setMissionStage(next);
            } else {
              resetAll();
            }
          }, 1500);
          return;
        }

        tempPosition = nextPosition;
        tempRotation = nextRotation;
        tempIsFlying = nextIsFlying;
        idx += 1;
        const ok = await waitWithToken(560, token);
        if (!ok) return;
      }

      setIsRunning(false);
      setCurrentIndex(-1);
      setCurrentCommandId(null);
      stopRotorLoop();
      setCenterResult({ type: "error", message: "실패했습니다! 목표물에 도착하지 못했습니다." });
      if (crashResetTimerRef.current) clearTimeout(crashResetTimerRef.current);
      crashResetTimerRef.current = setTimeout(() => {
        resetDroneOnly();
      }, 1600);
    }

    runNext();
  }

  useEffect(() => {
    return () => {
      runTokenRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (crashResetTimerRef.current) clearTimeout(crashResetTimerRef.current);
      if (allMissionsCelebrationTimerRef.current) {
        clearTimeout(allMissionsCelebrationTimerRef.current);
      }
      stopRotorLoop();
    };
  }, []);

  useEffect(() => {
    if (!isMissionMode) {
      setShowMissionIntro(false);
      return;
    }
    const config = missionStageConfigs[missionStage];
    if (!config) return;
    resetDroneOnly();
    setPlacedItems({
      obstacles: config.obstacles.map((o, idx) => ({ ...o, id: idx + 1 })),
      goal: config.goal ?? { x: 4, z: -4 },
    });
    setCommands(buildMissionCommandsWithBlank(missionStage));
    setSelectedPlacementType(null);
    setCenterResult(null);
    setShowMissionIntro(true);
    setCameraResetToken((v) => v + 1);
  }, [isMissionMode, missionStage]);

  useEffect(() => {
    // 미션/편집 모드 진입 시 코딩 UI는 항상 펼침
    openCodingUI();
  }, [codingMainMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateSmall = () =>
      setIsSmallScreen(Math.min(window.innerWidth, window.innerHeight) <= 820);
    const mq = window.matchMedia("(orientation: portrait)");
    const updatePortrait = () => setIsPortrait(Boolean(mq.matches));
    updateSmall();
    updatePortrait();
    window.addEventListener("resize", updateSmall, { passive: true });
    mq.addEventListener?.("change", updatePortrait);
    return () => {
      window.removeEventListener("resize", updateSmall);
      mq.removeEventListener?.("change", updatePortrait);
    };
  }, []);

  function selectPlacementType(e, type) {
    if (isRunning) return;
    e.preventDefault();
    setSelectedPlacementType((prev) => (prev === type ? null : type));
  }

  function handlePlaceAtCell(cell) {
    if (!selectedPlacementType || !cell) return;
    setPlacedItems((prev) => {
      if (selectedPlacementType === "goal") {
        return { ...prev, goal: { x: cell.x, z: cell.z } };
      }
      if (selectedPlacementType === "delete") {
        const sameCell = prev.obstacles.filter((o) => o.x === cell.x && o.z === cell.z);
        if (sameCell.length > 0) {
          const top = sameCell.reduce((best, o) => (o.level > best.level ? o : best), sameCell[0]);
          return { ...prev, obstacles: prev.obstacles.filter((o) => o.id !== top.id) };
        }
        if (prev.goal && prev.goal.x === cell.x && prev.goal.z === cell.z) {
          return { ...prev, goal: null };
        }
        return prev;
      }
      // 목표 칸에는 장애물을 배치하지 않음(경고 없이 무시)
      if (prev.goal && prev.goal.x === cell.x && prev.goal.z === cell.z) {
        return prev;
      }
      // 드론 시작 칸(0,0)에는 장애물을 배치하지 않음
      if (cell.x === 0 && cell.z === 0) {
        return prev;
      }
      const nextId = (prev.obstacles.reduce((m, o) => Math.max(m, o.id), 0) || 0) + 1;
      const nextLevel = prev.obstacles.filter((o) => o.x === cell.x && o.z === cell.z).length;
      return {
        ...prev,
        obstacles: [
          ...prev.obstacles,
          {
            id: nextId,
            x: cell.x,
            z: cell.z,
            level: nextLevel,
            color: obstacleColor,
            edgeColor: darkenHex(obstacleColor),
          },
        ],
      };
    });
  }

  const renderCommandEditor = (command, compact = false) => {
    const textSize = compact ? "text-xs" : "text-sm";
    const inputSize = compact ? "w-8 text-[11px]" : "w-9 text-xs";
    const selectSize = compact ? "w-12 text-[11px]" : "w-14 text-xs";
    const lockAmountInput = isMissionMode && command.missionFixedAmount;
    const missionAddedBlock = isMissionMode && !command.missionFixedAmount && !isBlankCommand(command);
    const amountInputBaseClass = `${inputSize} px-1 py-0.5 rounded border font-semibold`;
    const amountInputClassName = lockAmountInput
      ? `${amountInputBaseClass} border-white/40 bg-transparent text-white cursor-not-allowed`
      : missionAddedBlock
        ? `${amountInputBaseClass} border-gray-300 bg-white text-black`
        : `${amountInputBaseClass} text-black`;
    const rotationSelectClassName = lockAmountInput
      ? `${selectSize} px-1 py-0.5 rounded border border-white/40 bg-transparent text-white font-semibold cursor-not-allowed`
      : missionAddedBlock
        ? `${selectSize} px-1 py-0.5 rounded border border-gray-300 bg-white text-black font-semibold`
        : `${selectSize} px-1 py-0.5 rounded border text-black font-semibold`;
    return (
      <span className={`pr-5 whitespace-nowrap ${textSize}`}>
        {isLoopType(command.type) ? (
          <>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={command.amount ?? ""}
              onChange={(e) => {
                const rawText = e.target.value;
                if (rawText === "") {
                  updateLoopRepeat(command.id, null);
                  return;
                }
                const raw = Number(rawText);
                updateLoopRepeat(command.id, raw);
              }}
              onBlur={() => {
                if (!Number.isFinite(command.amount) || command.amount < 1) {
                  updateLoopRepeat(command.id, 1);
                }
              }}
              onFocus={(e) => e.target.select()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={amountInputClassName}
              disabled={isRunning || lockAmountInput}
            />
            번 반복
          </>
        ) : usesMoveAmount(command.type) ? (
          <>
            {command.type.split(" ")[0]}{" "}
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={command.amount ?? ""}
              onChange={(e) => {
                const rawText = e.target.value;
                if (rawText === "") {
                  updateCommandAmount(command.id, null);
                  return;
                }
                const raw = Number(rawText);
                updateCommandAmount(command.id, raw);
              }}
              onBlur={() => {
                if (!Number.isFinite(command.amount) || command.amount < 1) {
                  updateCommandAmount(command.id, 1);
                }
              }}
              onFocus={(e) => e.target.select()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={amountInputClassName}
              disabled={isRunning || lockAmountInput}
            />
            칸 이동
          </>
        ) : usesVerticalAmount(command.type) ? (
          <>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={command.amount ?? ""}
              onChange={(e) => {
                const rawText = e.target.value;
                if (rawText === "") {
                  updateCommandAmount(command.id, null);
                  return;
                }
                const raw = Number(rawText);
                updateCommandAmount(command.id, raw);
              }}
              onBlur={() => {
                if (!Number.isFinite(command.amount) || command.amount < 1) {
                  updateCommandAmount(command.id, 1);
                }
              }}
              onFocus={(e) => e.target.select()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={amountInputClassName}
              disabled={isRunning || lockAmountInput}
            />
            칸 {command.type}
          </>
        ) : usesRotationAmount(command.type) ? (
          <>
            {command.type.includes("왼쪽") ? "왼쪽 " : "오른쪽 "}
            <select
              value={command.amount ?? 90}
              onChange={(e) => updateCommandRotation(command.id, Number(e.target.value))}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={rotationSelectClassName}
              disabled={isRunning || lockAmountInput}
            >
              <option value={30}>30도</option>
              <option value={60}>60도</option>
              <option value={90}>90도</option>
              <option value={120}>120도</option>
              <option value={150}>150도</option>
              <option value={180}>180도</option>
            </select>{" "}
            회전
          </>
        ) : (
          formatCommandLabel(command)
        )}
      </span>
    );
  };

  const renderLoopBox = (loopCommand, depth = 1) => {
    const children = loopCommand.children ?? [];
    return (
      <div
        className={`mt-1 mb-1 border-l-4 border-t-4 border-b-4 border-violet-500 rounded-l-lg bg-violet-50/60 p-2 ${
          depth > 1 ? "ml-2 mr-0.5" : "ml-2 mr-1"
        }`}
      >
        <div className="text-[11px] text-violet-700 font-semibold mb-1">반복 내부 명령</div>
        <div
          data-loop-drop-id={loopCommand.id}
          className={`min-h-8 rounded-md border-2 border-dashed px-2 py-1 text-xs ${
            dropTarget?.type === "loop" && dropTarget.loopId === loopCommand.id
              ? "border-violet-500 bg-violet-100 text-violet-700"
              : "border-violet-300 text-violet-500"
          }`}
        >
          <div
            data-loop-insert-loop-id={loopCommand.id}
            data-loop-insert-index={0}
            className={`h-1 rounded ${
              dropTarget?.type === "loop-between" &&
              dropTarget.loopId === loopCommand.id &&
              dropTarget.index === 0
                ? "bg-violet-500/95"
                : "bg-transparent"
            }`}
          />
          {children.length === 0 ? (
            "여기에 명령 블록을 놓으세요"
          ) : (
            children.map((child, childIdx) => (
              <div key={child.id} data-loop-item="true">
                <div
                  onPointerDown={(e) => startListPointerDrag(e, child.id)}
                  className={`relative mt-1 rounded px-2 py-1 ${
                    commandColorByType[child.type] ?? "bg-slate-500 text-white"
                  } ${isRunning ? "cursor-default" : "cursor-grab active:cursor-grabbing"} ${
                    currentCommandId === child.id
                      ? "ring-2 ring-white/95 ring-offset-1 ring-offset-violet-700/50 animate-pulse"
                      : ""
                  } touch-none`}
                >
                  {renderCommandEditor(child, true)}
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeCommand(child.id)}
                    disabled={isRunning || (isMissionMode && !child.replacedMissionBlank)}
                    className="absolute right-1 top-1 w-4 h-4 text-[9px] bg-red-500 text-white rounded-full disabled:bg-gray-300"
                    aria-label="반복 내부 명령 삭제"
                    title={
                      isMissionMode && child.replacedMissionBlank
                        ? "빈칸으로 되돌리기"
                        : "명령 삭제"
                    }
                  >
                    X
                  </button>
                </div>
                {isLoopType(child.type) && renderLoopBox(child, depth + 1)}
                <div
                  data-loop-insert-loop-id={loopCommand.id}
                  data-loop-insert-index={childIdx + 1}
                  className={`mt-1 h-1 rounded ${
                    dropTarget?.type === "loop-between" &&
                    dropTarget.loopId === loopCommand.id &&
                    dropTarget.index === childIdx + 1
                      ? "bg-violet-500/95"
                      : "bg-transparent"
                  }`}
                />
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full min-h-0 flex flex-col relative">
      {showTopCommandPalette && (
        <div className="p-1 sm:p-2 md:p-4 bg-white border-b shrink-0 select-none">
          <div className="flex items-center gap-2">
            <button
              onClick={closeCodingUI}
              className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold shrink-0"
              title="코딩 UI 닫기"
            >
              ▴
            </button>
          </div>
          <div
            className="mt-1 flex gap-1 sm:gap-2 md:gap-3 overflow-x-auto whitespace-nowrap justify-start md:justify-center pb-0.5"
            style={{ touchAction: "pan-x" }}
          >
          {commandPalette.map((item) => (
            <button
              key={item.type}
              onClick={() => addCommandFromPalette(item.type)}
              className={`px-1.5 sm:px-3 py-0.5 sm:py-1.5 md:px-4 md:py-2 text-[10px] sm:text-sm md:text-base ${item.colorClass} rounded-md sm:rounded-lg shrink-0 ${
                isRunning ? "opacity-60 cursor-not-allowed" : "cursor-pointer active:scale-[0.98]"
              }`}
              disabled={isRunning}
              title="터치하면 명령 목록에 바로 추가"
            >
              {usesMoveAmount(item.type)
                ? `${item.type.split(" ")[0]} 1칸 이동`
                : usesVerticalAmount(item.type)
                  ? `1칸 ${item.type}`
                  : isLoopType(item.type)
                    ? "1번 반복"
                  : item.type}
            </button>
          ))}
          </div>
        </div>
      )}

      {isMissionMode && showMissionIntro && (
        <div className="pointer-events-none absolute left-1/2 top-[31%] z-[120] -translate-x-1/2 px-3">
          <div className="max-w-[90vw] rounded-xl bg-indigo-600/90 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg sm:text-base">
            알맞은 명령블럭을 넣어 드론을 목표물에 착륙시키세요
          </div>
        </div>
      )}

      {centerResult && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[24%] z-[120]">
          <div
            className={`px-6 py-3 rounded-2xl text-white text-2xl sm:text-3xl font-extrabold shadow-2xl whitespace-nowrap ${
              centerResult.type === "success" ? "bg-emerald-600/95" : "bg-rose-600/95"
            }`}
          >
            {centerResult.message}
          </div>
        </div>
      )}

      {showAllMissionsCompletePopup && (
        <div className="absolute inset-0 z-[140] flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 sm:p-6 shadow-2xl text-center">
            <p className="text-base sm:text-lg font-bold text-slate-800 leading-relaxed">
              축하합니다! 이제 편집모드를 선택하여 미션을 직접 만들어 보세요
            </p>
            <button
              type="button"
              onClick={() => setShowAllMissionsCompletePopup(false)}
              className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {isMissionMode && (
        <div className="absolute left-1/2 bottom-3 z-[125] flex -translate-x-1/2 flex-col items-center gap-1.5 px-2 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-indigo-200 bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur">
            <span className="text-[10px] font-semibold text-indigo-800 shrink-0">단계</span>
            <div className="flex flex-wrap justify-center gap-1">
              {missionStageNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMissionStage(n)}
                  disabled={isRunning}
                  className={`min-w-[1.75rem] rounded-md px-1.5 py-0.5 text-xs font-bold transition ${
                    missionStage === n
                      ? "bg-blue-600 text-white"
                      : completedMissionStages.has(n)
                        ? "bg-green-600 text-white"
                        : "bg-gray-200 text-gray-800 hover:bg-gray-300"
                  } ${isRunning ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {showLeftCommandList ? (
        <div
          className="shrink-0 bg-white border-r p-2 md:p-3 overflow-y-auto relative pb-14"
          style={{
            width: isSmallScreen ? (isPortrait ? 145 : 220) : 290,
          }}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {!showTopCommandPalette && (
                <button
                  onClick={openCodingUI}
                  className="w-7 h-7 bg-blue-600 text-white rounded-md text-sm font-bold leading-none flex items-center justify-center"
                  title="코딩 UI 열기"
                >
                  ▾
                </button>
              )}
              <button
                onClick={closeCodingUI}
                className="px-2 py-1 bg-blue-600 text-white rounded-md text-xs font-semibold"
                title="코딩 UI 닫기"
              >
                ◂
              </button>
              <button
                onClick={runCommands}
                className="px-2.5 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:bg-gray-300"
                disabled={isRunning || commands.length === 0 || commandTreeContainsBlank(commands)}
              >
                실행
              </button>
              <button
                onClick={stopExecution}
                className="px-2.5 py-1.5 bg-rose-600 text-white rounded-md text-xs font-semibold disabled:bg-gray-300"
                disabled={!isRunning}
              >
                정지
              </button>
              <button
                onClick={resetDroneAndView}
                className="px-2.5 py-1.5 bg-blue-700 text-white rounded-md text-xs font-semibold"
              >
                초기화
              </button>
            </div>
          </div>
          <div ref={listContainerRef} className="touch-none select-none">
            {commands.length === 0 ? (
              <div
                className={`rounded-lg border-2 border-dashed p-6 text-center text-sm ${
                  dropIndex === 0
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-300 text-gray-500"
                }`}
              >
                위 명령 블럭을 터치해 추가
              </div>
            ) : (
              <div className="flex flex-col gap-1">
              <div
                className={`h-1 rounded ${
                  dropIndex === 0
                    ? "bg-blue-500/95"
                    : "bg-transparent"
                }`}
              />
              {commands.map((command, index) => (
                <div
                  key={command.id}
                  data-command-item="true"
                >
                  <div
                    onPointerDown={(e) => startListPointerDrag(e, command.id)}
                    className={`relative flex items-center justify-between gap-2 px-3 py-2 rounded-lg ${
                      isRunning || isMissionMode ? "cursor-default" : "cursor-grab active:cursor-grabbing"
                    } ${
                      isBlankCommand(command)
                        ? "bg-gray-100 text-gray-500 border-2 border-dashed border-gray-400"
                        : commandColorByType[command.type] ?? "bg-blue-100 text-blue-800"
                    } ${
                    dropIndex === index ? "ring-2 ring-blue-400" : ""
                  } ${
                    currentCommandId === command.id
                      ? "ring-4 ring-white/95 ring-offset-2 ring-offset-slate-700/70 animate-pulse font-bold"
                      : ""
                  } touch-none`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold">{index + 1}.</span>
                      {renderCommandEditor(command)}
                    </div>
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeCommand(command.id)}
                      disabled={
                        isRunning ||
                        command.id === 1 ||
                        (isMissionMode && !command.replacedMissionBlank)
                      }
                      className="absolute right-1 top-1 w-5 h-5 text-[10px] bg-red-500 text-white rounded-full disabled:bg-gray-300"
                      aria-label="명령 삭제"
                      title={
                        command.id === 1
                          ? "기본 이륙 명령은 삭제할 수 없습니다."
                          : isMissionMode && command.replacedMissionBlank
                            ? "빈칸으로 되돌리기"
                            : "명령 삭제"
                      }
                    >
                      X
                    </button>
                  </div>
                  {isLoopType(command.type) && renderLoopBox(command)}
                  <div
                    className={`h-1 rounded ${
                      dropIndex === index + 1
                        ? "bg-blue-500/95"
                        : "bg-transparent"
                    }`}
                  />
                </div>
              ))}
              </div>
            )}
          </div>
          <div className="absolute right-3 bottom-3 flex items-center gap-2">
            <button
              onClick={() => setIsFastExecution((v) => !v)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                isFastExecution ? "bg-amber-600 text-white" : "bg-gray-200 text-gray-700"
              }`}
              title="코딩 실행 속도 2배 토글"
            >
              {isFastExecution ? "2x ON" : "2x"}
            </button>
            <button
              onClick={clearCommands}
              className="px-3 py-1.5 bg-violet-600 text-white rounded-md text-xs font-semibold disabled:bg-gray-300"
              disabled={isRunning || commands.length <= 1 || isMissionMode}
            >
              모두 삭제
            </button>
          </div>
        </div>
        ) : null}

        <div className="relative flex-1 min-w-0">
          <CodingScene
            dronePosition={dronePosition}
            rotationY={rotationY}
            goalPosition={goalPosition}
            obstaclePosition={obstaclePosition}
            placedItems={placedItems}
            placementType={selectedPlacementType}
            obstacleColor={obstacleColor}
            obstacleEdgeColor={darkenHex(obstacleColor)}
            hoverCell={hoverCell}
            onHoverCell={setHoverCell}
            onPlaceAtCell={handlePlaceAtCell}
            isRunning={isRunning}
            cameraResetToken={cameraResetToken}
            isCrash={isCrash}
          />

          {!showLeftCommandList && (
            <div
              data-ui-block="true"
              className="absolute left-2 top-2 z-[170] flex flex-col gap-2"
            >
              <button
                onClick={openCodingUI}
                className="w-16 h-10 rounded-lg bg-blue-600 text-white text-[11px] font-semibold leading-tight shadow"
                title="코딩 UI 열기"
              >
                ▸ 코딩
              </button>
            </div>
          )}

          <div
            data-ui-block="true"
            className={`z-[160] bg-white/90 backdrop-blur border rounded-xl p-2 shadow-sm w-[84px] ${
              isSmallScreen
                ? "fixed right-2"
                : "absolute right-3 top-1/2 -translate-y-1/2"
            }`}
            style={{
              right: "calc(8px + env(safe-area-inset-right, 0px))",
              top: isSmallScreen
                ? showTopCommandPalette
                  ? isPortrait
                    ? "calc(74px + env(safe-area-inset-top, 0px))"
                    : "calc(132px + env(safe-area-inset-top, 0px))"
                  : isPortrait
                    ? "calc(18px + env(safe-area-inset-top, 0px))"
                    : "calc(78px + env(safe-area-inset-top, 0px))"
                : undefined,
            }}
          >
            <div className="mb-2 space-y-1">
              <button
                onClick={() => setCodingMainMode("mission")}
                className={`w-full rounded-md px-1.5 py-1 text-[10px] font-semibold ${
                  isMissionMode ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-700"
                }`}
              >
                미션
              </button>
              <button
                onClick={() => setCodingMainMode("edit")}
                className={`w-full rounded-md px-1.5 py-1 text-[10px] font-semibold ${
                  !isMissionMode ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-700"
                }`}
              >
                편집 모드
              </button>
            </div>
            <div className="relative mb-2">
              <button
                onClick={() => setShowObjectMenu((v) => !v)}
                className="mx-auto block w-6 h-6 rounded bg-blue-600 text-white text-[11px] font-bold leading-none disabled:bg-gray-300"
                title="물체 메뉴 접기/펼치기"
                disabled={isMissionMode}
              >
                {showObjectMenu ? "▴" : "▾"}
              </button>
            </div>
            {showObjectMenu && !isMissionMode && (
              <>
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={(e) => selectPlacementType(e, "goal")}
                className={`w-10 h-10 rounded-lg shadow border flex items-center justify-center ${
                  selectedPlacementType === "goal"
                    ? "border-cyan-300 ring-2 ring-cyan-300/70 bg-emerald-600"
                    : "border-emerald-700 bg-emerald-600"
                } ${
                  isRunning ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                }`}
                disabled={isRunning}
                title="선택 후 격자 칸을 눌러 배치"
                aria-label="목표지점 배치"
              >
                <span className="w-8 h-8 rounded-md bg-emerald-300 border border-emerald-100/80 text-emerald-900 text-[10px] font-bold flex items-center justify-center">
                  목표
                </span>
              </button>
              <button
                onClick={(e) => selectPlacementType(e, "obstacle")}
                className={`w-10 h-10 rounded-lg shadow border flex items-center justify-center ${
                  selectedPlacementType === "obstacle"
                    ? "ring-2 ring-cyan-300/70"
                    : ""
                } ${
                  isRunning ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                }`}
                style={{
                  backgroundColor: darkenHex(obstacleColor, 0.75),
                  borderColor: darkenHex(obstacleColor, 0.58),
                }}
                disabled={isRunning}
                title="선택 후 격자 칸을 눌러 배치"
                aria-label="장애물 배치"
              >
                <span
                  className="w-8 h-8 rounded-md text-[9px] font-bold flex items-center justify-center"
                  style={{
                    backgroundColor: obstacleColor,
                    border: `1px solid ${darkenHex(obstacleColor)}`,
                    color: darkenHex(obstacleColor, 0.6),
                  }}
                >
                  장애물
                </span>
              </button>
              <button
                onClick={() => setShowObstacleColorPicker((v) => !v)}
                className="w-10 h-5 rounded-md border border-gray-300 shadow-sm"
                style={{ backgroundColor: obstacleColor }}
                title="장애물 색상 선택"
                aria-label="장애물 현재 색상"
              />
              {showObstacleColorPicker && (
                <div className="grid grid-cols-3 gap-1">
                  {["#a78bfa", "#f472b6", "#60a5fa", "#34d399", "#f59e0b", "#f87171"].map((color) => (
                    <button
                      key={color}
                      onClick={() => {
                        setObstacleColor(color);
                        setShowObstacleColorPicker(false);
                      }}
                      className={`w-4 h-4 rounded-sm border ${
                        obstacleColor === color ? "border-black" : "border-gray-400"
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`장애물 색상 ${color}`}
                    />
                  ))}
                </div>
              )}
              <button
                onClick={(e) => selectPlacementType(e, "delete")}
                className={`w-10 h-10 rounded-lg shadow border flex items-center justify-center ${
                  selectedPlacementType === "delete"
                    ? "border-cyan-300 ring-2 ring-cyan-300/70 bg-rose-600"
                    : "border-rose-700 bg-rose-600"
                } ${
                  isRunning ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                }`}
                disabled={isRunning}
                title="선택 후 격자 칸을 눌러 삭제"
                aria-label="삭제 배치 모드"
              >
                <span className="w-8 h-8 rounded-md bg-rose-300 border border-rose-100/80 text-rose-900 text-[10px] font-bold flex items-center justify-center">
                  삭제
                </span>
              </button>
              <button
                onClick={clearPlacedObjects}
                className="w-10 h-10 rounded-lg shadow border border-gray-400 bg-gray-200 text-gray-800 text-[9px] font-bold"
                title="배치한 물체 전체 삭제"
              >
                모두 삭제
              </button>
            </div>
            <div className="mt-2 text-[10px] text-gray-600 text-center leading-tight">
              선택 후
              <br />
              격자 칸 터치
            </div>
              </>
            )}
          </div>
        </div>
      </div>

      {dragState && dragCursor && (
        <div
          className="fixed z-[100] pointer-events-none -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-slate-900/92 text-white text-sm font-semibold shadow-xl"
          style={{ left: dragCursor.x, top: dragCursor.y }}
        >
          {dragState.source === "palette"
            ? dragState.type
            : findCommandById(commands, dragState.commandId)?.type ?? "명령"}
        </div>
      )}
    </div>
  );
}
