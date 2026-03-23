"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, Html } from "@react-three/drei";
import * as THREE from "three";

function Drone({ position, rotationY }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh>
        <boxGeometry args={[1, 0.3, 1]} />
        <meshStandardMaterial color="orange" />
      </mesh>

      <mesh position={[0, 0.15, -0.45]}>
        <boxGeometry args={[0.2, 0.1, 0.2]} />
        <meshStandardMaterial color="black" />
      </mesh>
    </group>
  );
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[30, 30]} />
      <meshStandardMaterial color="lightgray" />
    </mesh>
  );
}

function Goal({ position }) {
  return (
    <mesh position={position}>
      <boxGeometry args={[1.2, 1.2, 1.2]} />
      <meshStandardMaterial color="limegreen" />
    </mesh>
  );
}

function Obstacle({ position }) {
  return (
    <mesh position={position}>
      <boxGeometry args={[1.5, 1.5, 1.5]} />
      <meshStandardMaterial color="red" />
    </mesh>
  );
}

function FollowCamera({ targetPosition, rotationY }) {
  useFrame(({ camera }) => {
    const distance = 8;
    const height = 4;

    const forwardX = -Math.sin(rotationY);
    const forwardZ = -Math.cos(rotationY);

    const cameraX = targetPosition[0] - forwardX * distance;
    const cameraY = targetPosition[1] + height;
    const cameraZ = targetPosition[2] - forwardZ * distance;

    camera.position.set(cameraX, cameraY, cameraZ);
    camera.lookAt(targetPosition[0], targetPosition[1] + 0.5, targetPosition[2]);
  });

  return null;
}

function Scene({ dronePosition, rotationY, goalPosition, obstaclePosition }) {
  return (
    <Canvas camera={{ position: [0, 5, 8], fov: 60 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 10, 5]} intensity={1} />

      <Ground />
      <Grid args={[30, 30]} cellSize={1} cellThickness={1} sectionSize={5} />

      <Drone position={dronePosition} rotationY={rotationY} />
      <Goal position={goalPosition} />
      <Obstacle position={obstaclePosition} />

      <Html position={goalPosition}>
        <div className="bg-white px-2 py-1 rounded shadow text-sm">목표</div>
      </Html>

      <Html position={obstaclePosition}>
        <div className="bg-white px-2 py-1 rounded shadow text-sm">장애물</div>
      </Html>

      <FollowCamera targetPosition={dronePosition} rotationY={rotationY} />
    </Canvas>
  );
}

function ControlMode() {
  const START_POSITION = [0, 1, 0];
  const START_ROTATION = 0;
  const STEP = 1;
  const ROTATE_STEP = Math.PI / 2;
  const TURN_DURATION = 200;

  const goalPosition = useMemo(() => [6, 2, -6], []);
  const obstaclePosition = useMemo(() => [2, 1, -2], []);

  const [dronePosition, setDronePosition] = useState(START_POSITION);
  const [rotationY, setRotationY] = useState(START_ROTATION);
  const [targetRotationY, setTargetRotationY] = useState(START_ROTATION);
  const [isTurning, setIsTurning] = useState(false);

  const [isSuccess, setIsSuccess] = useState(false);
  const [isCrash, setIsCrash] = useState(false);

  const animationRef = useRef(null);

  function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function checkCollision(nextPosition) {
    const [dx, dy, dz] = nextPosition;
    const [ox, oy, oz] = obstaclePosition;

    return (
      Math.abs(dx - ox) < 1.1 &&
      Math.abs(dy - oy) < 1.1 &&
      Math.abs(dz - oz) < 1.1
    );
  }

  function checkSuccess(nextPosition) {
    const [dx, dy, dz] = nextPosition;
    const [gx, gy, gz] = goalPosition;

    return (
      Math.abs(dx - gx) < 1 &&
      Math.abs(dy - gy) < 1 &&
      Math.abs(dz - gz) < 1
    );
  }

  function updatePosition(nextPosition) {
    if (isCrash || isSuccess || isTurning) return;

    if (checkCollision(nextPosition)) {
      setIsCrash(true);
      return;
    }

    setDronePosition(nextPosition);

    if (checkSuccess(nextPosition)) {
      setIsSuccess(true);
    }
  }

  function moveForward() {
    const [x, y, z] = dronePosition;
    const nextX = x - Math.sin(targetRotationY) * STEP;
    const nextZ = z - Math.cos(targetRotationY) * STEP;
    updatePosition([Math.round(nextX), y, Math.round(nextZ)]);
  }

  function moveBackward() {
    const [x, y, z] = dronePosition;
    const nextX = x + Math.sin(targetRotationY) * STEP;
    const nextZ = z + Math.cos(targetRotationY) * STEP;
    updatePosition([Math.round(nextX), y, Math.round(nextZ)]);
  }

  function moveUp() {
    const [x, y, z] = dronePosition;
    updatePosition([x, y + STEP, z]);
  }

  function moveDown() {
    const [x, y, z] = dronePosition;
    updatePosition([x, Math.max(0.5, y - STEP), z]);
  }

  function animateTurn(nextRotation) {
    if (isCrash || isSuccess || isTurning) return;

    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    setIsTurning(true);

    const start = performance.now();
    const from = rotationY;
    const to = nextRotation;
    const delta = normalizeAngle(to - from);

    function step(now) {
      const t = Math.min((now - start) / TURN_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + delta * eased;

      setRotationY(current);

      if (t < 1) {
        animationRef.current = requestAnimationFrame(step);
      } else {
        setRotationY(to);
        setTargetRotationY(to);
        setIsTurning(false);
      }
    }

    animationRef.current = requestAnimationFrame(step);
  }

  function rotateLeft() {
    animateTurn(targetRotationY + ROTATE_STEP);
  }

  function rotateRight() {
    animateTurn(targetRotationY - ROTATE_STEP);
  }

  function resetAll() {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setDronePosition(START_POSITION);
    setRotationY(START_ROTATION);
    setTargetRotationY(START_ROTATION);
    setIsTurning(false);
    setIsSuccess(false);
    setIsCrash(false);
  }

  useEffect(() => {
    function handleKeyDown(e) {
      const key = e.key.toLowerCase();

      if (key === "w") moveForward();
      if (key === "s") moveBackward();
      if (key === "a") rotateLeft();
      if (key === "d") rotateRight();
      if (key === "r") moveUp();
      if (key === "f") moveDown();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dronePosition, targetRotationY, isCrash, isSuccess, isTurning]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const directionLabel = (() => {
    const normalized =
      ((targetRotationY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    if (normalized < Math.PI / 4 || normalized >= (Math.PI * 7) / 4) return "북쪽";
    if (normalized < (Math.PI * 3) / 4) return "서쪽";
    if (normalized < (Math.PI * 5) / 4) return "남쪽";
    return "동쪽";
  })();

  return (
    <>
      <div className="p-4 bg-white shadow flex flex-wrap gap-3 items-center justify-center">
        <button onClick={moveForward} className="px-4 py-2 bg-blue-500 text-white rounded" disabled={isTurning}>
          전진(W)
        </button>
        <button onClick={moveBackward} className="px-4 py-2 bg-blue-500 text-white rounded" disabled={isTurning}>
          후진(S)
        </button>
        <button onClick={rotateLeft} className="px-4 py-2 bg-purple-500 text-white rounded" disabled={isTurning}>
          좌회전(A)
        </button>
        <button onClick={rotateRight} className="px-4 py-2 bg-purple-500 text-white rounded" disabled={isTurning}>
          우회전(D)
        </button>
        <button onClick={moveUp} className="px-4 py-2 bg-green-500 text-white rounded" disabled={isTurning}>
          상승(R)
        </button>
        <button onClick={moveDown} className="px-4 py-2 bg-green-500 text-white rounded" disabled={isTurning}>
          하강(F)
        </button>
        <button onClick={resetAll} className="px-4 py-2 bg-gray-600 text-white rounded">
          초기화
        </button>
      </div>

      <div className="bg-white text-center py-2 text-sm">
        조작: W 전진 / S 후진 / A 좌회전 / D 우회전 / R 상승 / F 하강
      </div>

      <div className="bg-white text-center py-2 text-sm font-semibold">
        위치: x={dronePosition[0]} / y={dronePosition[1]} / z={dronePosition[2]} | 방향: {directionLabel}
      </div>

      {isTurning && (
        <div className="bg-yellow-100 text-yellow-800 text-center font-bold py-2">
          회전 중
        </div>
      )}

      {isSuccess && (
        <div className="bg-green-100 text-green-800 text-center font-bold py-2">
          성공!
        </div>
      )}

      {isCrash && (
        <div className="bg-red-100 text-red-800 text-center font-bold py-2">
          충돌!
        </div>
      )}

      <div className="flex-1">
        <Scene
          dronePosition={dronePosition}
          rotationY={rotationY}
          goalPosition={goalPosition}
          obstaclePosition={obstaclePosition}
        />
      </div>
    </>
  );
}

function CodingMode() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-2xl shadow text-center max-w-xl">
        <h2 className="text-2xl font-bold mb-4">코딩 모드</h2>
        <p className="text-gray-700 mb-2">
          다음 단계에서 이 화면에 명령 블록 방식의 3D 드론 코딩 기능을 넣습니다.
        </p>
        <p className="text-gray-500">
          예: 전진, 상승, 하강, 좌회전, 우회전 명령을 쌓고 실행
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState("control");

  return (
    <div className="w-screen h-screen flex flex-col bg-gray-100">
      <div className="bg-white border-b flex justify-center gap-4 p-4">
        <button
          onClick={() => setMode("control")}
          className={`px-5 py-2 rounded-lg font-semibold ${
            mode === "control"
              ? "bg-blue-500 text-white"
              : "bg-gray-200 text-gray-800"
          }`}
        >
          조종 모드
        </button>

        <button
          onClick={() => setMode("coding")}
          className={`px-5 py-2 rounded-lg font-semibold ${
            mode === "coding"
              ? "bg-blue-500 text-white"
              : "bg-gray-200 text-gray-800"
          }`}
        >
          코딩 모드
        </button>
      </div>

      {mode === "control" ? <ControlMode /> : <CodingMode />}
    </div>
  );
}