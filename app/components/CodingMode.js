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
  const [showTopCommandPalette, setShowTopCommandPalette] = useState(false);
  const [showLeftCommandList, setShowLeftCommandList] = useState(false);
  const [showObjectMenu, setShowObjectMenu] = useState(true);
  const [showObstacleColorPicker, setShowObstacleColorPicker] = useState(false);
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
    const defaultAmount = usesRotationAmount(type) ? 90 : isLoopType(type) ? 1 : amount;
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
    setCommands([{ id: 1, type: "이륙", amount: null }]);
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
    crashResetTimerRef.current = setTimeout(() => {
      resetDroneAndView();
    }, 2000);
  }

  function clearPlacedObjects() {
    setPlacedItems({ obstacles: [], goal: null });
  }

  function removeLastCommand() {
    if (isRunning || commands.length <= 1) return;
    setCommands((prev) => prev.slice(0, -1));
  }

  function clearCommands() {
    if (isRunning) return;
    // "이륙" 명령은 항상 기본 포함
    setCommands([{ id: 1, type: "이륙", amount: null }]);
  }

  function moveCommandUp(index) {
    if (isRunning || index === 0) return;
    setCommands((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveCommandDown(index) {
    if (isRunning || index === commands.length - 1) return;
    setCommands((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
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

  function startPalettePointerDrag(e, type) {
    if (isRunning) return;
    if (dragState) return;
    e.preventDefault();
    const pt = getClientPoint(e);
    setDragState({
      source: "palette",
      type,
      amount:
        usesMoveAmount(type) || usesVerticalAmount(type)
          ? 1
          : usesRotationAmount(type)
            ? 90
            : null,
    });
    setDragCursor({ x: pt.x, y: pt.y });
    setDropTarget(null);
  }

  function startListPointerDrag(e, commandId) {
    if (isRunning) return;
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

  function startPaletteTouchDrag(e, type) {
    if (typeof window !== "undefined" && "PointerEvent" in window) return;
    startPalettePointerDrag(e, type);
  }

  function waitWithToken(ms, token) {
    return new Promise((resolve) => {
      timerRef.current = setTimeout(() => {
        resolve(token === runTokenRef.current);
      }, ms);
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
    setCommands((prev) => update(prev));
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
    setCommands((prev) => update(prev));
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
    setCommands((prev) => update(prev));
  }

  function expandCommands(list) {
    const expanded = [];
    for (const cmd of list) {
      if (cmd.type === "반복") {
        const count = Math.max(1, Number.isFinite(cmd.amount) ? cmd.amount : 1);
        const inner = expandCommands(cmd.children ?? []);
        for (let i = 0; i < count; i += 1) expanded.push(...inner);
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

  function runCommands() {
    if (isRunning || commands.length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;

    setDronePosition(START_POSITION);
    setRotationY(START_ROTATION);
    setIsSuccess(false);
    setIsCrash(false);
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
            900,
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
            1400,
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
            1700,
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
            1840,
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
            1440,
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
          Math.abs(nextPosition[0] - activeGoal[0]) < 1 &&
          Math.abs(nextPosition[2] - activeGoal[2]) < 1;
        if (landedOnGoal) {
          stopRotorLoop();
          playSuccessChime();
          setIsSuccess(true);
          setIsRunning(false);
          setCurrentIndex(-1);
          setCurrentCommandId(null);
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
    }

    runNext();
  }

  useEffect(() => {
    return () => {
      runTokenRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (crashResetTimerRef.current) clearTimeout(crashResetTimerRef.current);
      stopRotorLoop();
    };
  }, []);

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
              className={`${inputSize} px-1 py-0.5 rounded border text-black font-semibold`}
              disabled={isRunning}
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
              className={`${inputSize} px-1 py-0.5 rounded border text-black font-semibold`}
              disabled={isRunning}
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
              className={`${inputSize} px-1 py-0.5 rounded border text-black font-semibold`}
              disabled={isRunning}
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
              className={`${selectSize} px-1 py-0.5 rounded border text-black font-semibold`}
              disabled={isRunning}
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
        <div className="text-[11px] text-violet-700 font-semibold mb-1">
          반복 내부 명령 (드래그해서 넣기)
        </div>
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
                    disabled={isRunning}
                    className="absolute right-1 top-1 w-4 h-4 text-[9px] bg-red-500 text-white rounded-full disabled:bg-gray-300"
                    aria-label="반복 내부 명령 삭제"
                    title="명령 삭제"
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
              onClick={() => setShowTopCommandPalette(false)}
              className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold shrink-0"
              title="위 명령어 메뉴 접기"
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
              onPointerDown={(e) => startPalettePointerDrag(e, item.type)}
              onTouchStart={(e) => startPaletteTouchDrag(e, item.type)}
              className={`px-1.5 sm:px-3 py-0.5 sm:py-1.5 md:px-4 md:py-2 text-[10px] sm:text-sm md:text-base ${item.colorClass} rounded-md sm:rounded-lg shrink-0 ${
                isRunning ? "opacity-60 cursor-not-allowed" : "cursor-grab active:cursor-grabbing"
              }`}
              disabled={isRunning}
              title="드래그해서 명령 목록에 추가"
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

      {isSuccess && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[24%] z-[120]">
          <div className="px-6 py-3 rounded-2xl bg-emerald-600/95 text-white text-2xl sm:text-3xl font-extrabold shadow-2xl whitespace-nowrap">
            성공입니다! 축하합니다!
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
                  onClick={() => setShowTopCommandPalette(true)}
                  className="w-7 h-7 bg-blue-600 text-white rounded-md text-sm font-bold leading-none flex items-center justify-center"
                  title="위 명령어 메뉴 펼치기"
                >
                  ▾
                </button>
              )}
              <button
                onClick={() => setShowLeftCommandList(false)}
                className="px-2 py-1 bg-blue-600 text-white rounded-md text-xs font-semibold"
                title="왼쪽 코딩메뉴 접기"
              >
                ◂
              </button>
              <button
                onClick={runCommands}
                className="px-2.5 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:bg-gray-300"
                disabled={isRunning || commands.length === 0}
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
                여기에 드래그해서 명령 추가
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
                      isRunning ? "cursor-default" : "cursor-grab active:cursor-grabbing"
                    } ${commandColorByType[command.type] ?? "bg-blue-100 text-blue-800"} ${
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
                      disabled={isRunning}
                      className="absolute right-1 top-1 w-5 h-5 text-[10px] bg-red-500 text-white rounded-full disabled:bg-gray-300"
                      aria-label="명령 삭제"
                      title={command.id === 1 ? "기본 이륙 명령은 삭제할 수 없습니다." : "명령 삭제"}
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
          <div className="absolute right-3 bottom-3">
            <button
              onClick={clearCommands}
              className="px-3 py-1.5 bg-violet-600 text-white rounded-md text-xs font-semibold disabled:bg-gray-300"
              disabled={isRunning || commands.length <= 1}
            >
              모두 삭제
            </button>
          </div>
        </div>
        ) : (
          <div className="w-[44px] shrink-0 bg-white border-r flex flex-col items-center gap-2 pt-3">
            {!showTopCommandPalette && (
              <button
                onClick={() => setShowTopCommandPalette(true)}
                className="w-7 h-7 bg-blue-600 text-white rounded-md text-sm font-bold leading-none flex items-center justify-center"
                title="위 명령어 메뉴 펼치기"
              >
                ▾
              </button>
            )}
            <button
              onClick={() => setShowLeftCommandList(true)}
              className="w-7 h-7 bg-blue-600 text-white rounded-md text-sm font-bold leading-none flex items-center justify-center"
              title="왼쪽 코딩메뉴 펼치기"
            >
              ▸
            </button>
          </div>
        )}

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
            <div className="relative mb-2">
              <button
                onClick={() => setShowObjectMenu((v) => !v)}
                className="mx-auto block w-6 h-6 rounded bg-blue-600 text-white text-[11px] font-bold leading-none"
                title="물체 메뉴 접기/펼치기"
              >
                {showObjectMenu ? "▴" : "▾"}
              </button>
            </div>
            {showObjectMenu && (
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
