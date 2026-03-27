"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export default function CodingMode({ CodingScene, checkBoxHit, getDirectionLabel }) {
  const GROUNDED_Y = 0.5;
  const START_POSITION = [0, GROUNDED_Y, 0];
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

  const timerRef = useRef(null);
  const rafRef = useRef(null);
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

  function startPalettePointerDrag(e, type) {
    if (isRunning) return;
    e.preventDefault();
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
    setDragCursor({ x: e.clientX, y: e.clientY });
    setDropTarget(null);
  }

  function startListPointerDrag(e, commandId) {
    if (isRunning) return;
    e.preventDefault();
    setDragState({ source: "list", commandId });
    setDragCursor({ x: e.clientX, y: e.clientY });
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
      const loopInsertZones = Array.from(
        container.querySelectorAll("[data-loop-insert-loop-id]")
      );
      for (let i = 0; i < loopInsertZones.length; i += 1) {
        const zone = loopInsertZones[i];
        const zr = zone.getBoundingClientRect();
        if (e.clientX >= zr.left && e.clientX <= zr.right && e.clientY >= zr.top && e.clientY <= zr.bottom) {
          const loopId = Number(zone.getAttribute("data-loop-insert-loop-id"));
          const index = Number(zone.getAttribute("data-loop-insert-index"));
          setDropTarget({ type: "loop-between", loopId, index });
          setDropIndex(null);
          return;
        }
      }
      const loopZones = Array.from(container.querySelectorAll("[data-loop-drop-id]"));
      let loopMatched = false;
      for (let i = 0; i < loopZones.length; i += 1) {
        const zone = loopZones[i];
        const zr = zone.getBoundingClientRect();
        if (e.clientX >= zr.left && e.clientX <= zr.right && e.clientY >= zr.top && e.clientY <= zr.bottom) {
          const loopId = Number(zone.getAttribute("data-loop-drop-id"));
          setDropTarget({ type: "loop", loopId });
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

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, dropIndex, dropTarget]);

  function waitWithToken(ms, token) {
    return new Promise((resolve) => {
      timerRef.current = setTimeout(() => {
        resolve(token === runTokenRef.current);
      }, ms);
    });
  }

  function animateCommandStep(fromPos, toPos, fromRot, toRot, durationMs, token) {
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
    const normalized = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1;
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
    const normalized = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1;
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
      x = Math.round(x + forwardX * STEP * moveUnits);
      z = Math.round(z + forwardZ * STEP * moveUnits);
    }

    if (nextIsFlying && command.type === "뒤로 이동") {
      x = Math.round(x - forwardX * STEP * moveUnits);
      z = Math.round(z - forwardZ * STEP * moveUnits);
    }

    if (nextIsFlying && command.type === "왼쪽 이동") {
      x = Math.round(x - rightX * STEP * moveUnits);
      z = Math.round(z - rightZ * STEP * moveUnits);
    }

    if (nextIsFlying && command.type === "오른쪽 이동") {
      x = Math.round(x + rightX * STEP * moveUnits);
      z = Math.round(z + rightZ * STEP * moveUnits);
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
          const stage1 = [tempPosition[0], GROUNDED_Y + 0.35, tempPosition[2]];
          const ok1 = await animateCommandStep(
            tempPosition,
            stage1,
            tempRotation,
            nextRotation,
            900,
            token
          );
          if (!ok1) return;
          const ok2 = await animateCommandStep(
            stage1,
            nextPosition,
            nextRotation,
            nextRotation,
            1400,
            token
          );
          if (!ok2) return;
        } else if (command.type === "착륙") {
          const ok = await animateCommandStep(
            tempPosition,
            nextPosition,
            tempRotation,
            nextRotation,
            1700,
            token
          );
          if (!ok) return;
        } else if (usesMoveAmount(command.type)) {
          const ok = await animateCommandStep(
            tempPosition,
            nextPosition,
            tempRotation,
            nextRotation,
            1840,
            token
          );
          if (!ok) return;
        } else {
          const ok = await animateCommandStep(
            tempPosition,
            nextPosition,
            tempRotation,
            nextRotation,
            1440,
            token
          );
          if (!ok) return;
        }

        if (checkBoxHit(nextPosition, obstaclePosition, 1.1)) {
          setDronePosition(nextPosition);
          setRotationY(nextRotation);
          setIsCrash(true);
          setIsRunning(false);
          setCurrentIndex(-1);
          setCurrentCommandId(null);
          return;
        }

        if (checkBoxHit(nextPosition, goalPosition, 1)) {
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
    }

    runNext();
  }

  useEffect(() => {
    return () => {
      runTokenRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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
              value={command.amount ?? 1}
              onChange={(e) => {
                const raw = Number(e.target.value);
                updateLoopRepeat(command.id, raw);
              }}
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
              value={command.amount ?? 1}
              onChange={(e) => {
                const raw = Number(e.target.value);
                updateCommandAmount(command.id, raw);
              }}
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
              value={command.amount ?? 1}
              onChange={(e) => {
                const raw = Number(e.target.value);
                updateCommandAmount(command.id, raw);
              }}
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
              <div key={child.id}>
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
    <div className="w-full h-full min-h-0 flex flex-col">
      <div className="p-2 md:p-4 bg-white border-b shrink-0 select-none">
        <div
          className="flex gap-2 md:gap-3 overflow-x-auto whitespace-nowrap justify-start md:justify-center pb-1"
          style={{ touchAction: "pan-x" }}
        >
        {commandPalette.map((item) => (
          <button
            key={item.type}
            onPointerDown={(e) => startPalettePointerDrag(e, item.type)}
            className={`px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base ${item.colorClass} rounded-lg shrink-0 ${
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

      {isSuccess && (
        <div className="bg-green-100 text-green-700 text-center py-2 font-bold shrink-0">
          성공
        </div>
      )}

      {isCrash && (
        <div className="bg-red-100 text-red-700 text-center py-2 font-bold shrink-0">
          충돌
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <div className="w-[290px] shrink-0 bg-white border-r p-3 overflow-y-auto relative pb-14">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">명령 목록</h2>
            <div className="flex items-center gap-1.5">
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
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            버튼을 끌어 목록에 놓고, 목록 항목도 드래그로 순서를 바꿀 수 있습니다.
          </p>

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

        <CodingScene
          dronePosition={dronePosition}
          rotationY={rotationY}
          goalPosition={goalPosition}
          obstaclePosition={obstaclePosition}
        />
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
