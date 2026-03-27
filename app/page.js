"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, Html } from "@react-three/drei";
import CodingMode from "./components/CodingMode";

/* =========================
   공통 유틸
========================= */

function checkBoxHit(a, b, threshold = 1) {
  return (
    Math.abs(a[0] - b[0]) < threshold &&
    Math.abs(a[1] - b[1]) < threshold &&
    Math.abs(a[2] - b[2]) < threshold
  );
}

function getDirectionLabel(rotationY) {
  const normalized =
    ((rotationY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  if (normalized < Math.PI / 4 || normalized >= (Math.PI * 7) / 4) return "북쪽";
  if (normalized < (Math.PI * 3) / 4) return "서쪽";
  if (normalized < (Math.PI * 5) / 4) return "남쪽";
  return "동쪽";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function getShadowScale(height, nearScale, farScale) {
  const t = clamp01((Math.max(0.5, height) - 0.5) / 8);
  return nearScale - (nearScale - farScale) * t;
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function distanceXZ(a, b) {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dz);
}

function getStageGoalRadius(stage) {
  if (stage === 1) return 2.0;
  if (stage === 2) return 1.6;
  if (stage >= 3 && stage <= 6) return 1.2;
  return 0.9;
}

function getObstacleCountByStage(stage) {
  if (stage <= 3) return 1;
  if (stage <= 6) return 2;
  if (stage <= 9) return 3;
  return 4;
}

function getObstacleSizeByStage(stage) {
  return 1.5;
}

function getNarrowPathWidth(stage, droneRadius = 0.5) {
  if (stage === 7) return droneRadius * 4;
  if (stage === 8) return droneRadius * 3.5;
  if (stage === 9) return droneRadius * 3;
  return droneRadius * 2; // 10단계
}

function checkObstacleHit(position, obstaclePosition, radius = 1.1) {
  return (
    Math.abs(position[0] - obstaclePosition[0]) < radius &&
    Math.abs(position[2] - obstaclePosition[2]) < radius
  );
}

function pointToSegmentDistanceXZ(point, a, b) {
  const px = point[0];
  const pz = point[2];
  const ax = a[0];
  const az = a[2];
  const bx = b[0];
  const bz = b[2];

  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq < 1e-8) return Math.hypot(px - ax, pz - az);

  const t = clamp((apx * abx + apz * abz) / abLenSq, 0, 1);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

function distanceToPolylineXZ(point, polylinePoints) {
  if (!polylinePoints || polylinePoints.length < 2) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < polylinePoints.length - 1; i += 1) {
    const dist = pointToSegmentDistanceXZ(point, polylinePoints[i], polylinePoints[i + 1]);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function buildBentGuidePath(startPosition, goal, stage) {
  // 7~10 단계 경로는 코너 수를 제한해 가독성을 높임(과도한 반복 꺾임 방지)
  const sx = startPosition[0];
  const sz = startPosition[2];
  const gx = goal[0];
  const gz = goal[2];
  const xDir = Math.sign(gx - sx) || 1;
  const zDir = Math.sign(gz - sz) || -1;
  const zMin = Math.min(sz, gz);
  const zMax = Math.max(sz, gz);
  const xMin = Math.min(sx, gx);
  const xMax = Math.max(sx, gx);

  let knots;
  if (stage <= 8) {
    // 코너 1개(L자): 가장 직관적인 경로
    const variant = Math.floor(randomInRange(0, 2));
    knots =
      variant === 0
        ? [
            [sx, 0.03, sz],
            [gx, 0.03, sz],
            [gx, 0.03, gz],
          ]
        : [
            [sx, 0.03, sz],
            [sx, 0.03, gz],
            [gx, 0.03, gz],
          ];
  } else {
    // 코너 2개: 중간 포인트 1개만 사용 (반복 코너 금지)
    const midX = clamp(randomInRange(xMin + 1.2, xMax - 1.2), xMin + 0.8, xMax - 0.8);
    const midZ = clamp(randomInRange(zMin + 1.2, zMax - 1.2), zMin + 0.8, zMax - 0.8);
    const variant = Math.floor(randomInRange(0, 2));
    knots =
      variant === 0
        ? [
            [sx, 0.03, sz],
            [midX, 0.03, sz],
            [midX, 0.03, gz],
            [gx, 0.03, gz],
          ]
        : [
            [sx, 0.03, sz],
            [sx, 0.03, midZ],
            [gx, 0.03, midZ],
            [gx, 0.03, gz],
          ];

    // 목표 반대 방향으로 크게 꺾이는 경우 보정
    if (Math.sign((knots[1]?.[0] ?? sx) - sx) !== xDir && Math.abs(gx - sx) > 2.5) {
      knots[1][0] = sx + xDir * Math.max(0.8, Math.abs(gx - sx) * 0.35);
    }
    if (Math.sign((knots[1]?.[2] ?? sz) - sz) !== zDir && Math.abs(gz - sz) > 2.5) {
      knots[1][2] = sz + zDir * Math.max(0.8, Math.abs(gz - sz) * 0.35);
    }
  }

  // 단계가 올라갈수록 조금씩 좁아지되, 이전보다 넓게 시작
  const widthByStage = {
    7: 3.2,
    8: 2.8,
    9: 2.4,
    10: 2.1,
  };

  return {
    width: widthByStage[stage] ?? 2.1,
    points: knots,
  };
}

function checkGoalHit(position, goalPosition, stage, isFlying, groundedHeight = 0.17) {
  const radius = getStageGoalRadius(stage);

  if (stage <= 6) {
    return (
      Math.abs(position[0] - goalPosition[0]) < radius &&
      Math.abs(position[2] - goalPosition[2]) < radius
    );
  }

  // 7~10단계: 정확히 바닥(착륙) 상태여야 성공
  const isOnGround = !isFlying && Math.abs(position[1] - groundedHeight) < 0.06;
  return (
    isOnGround &&
    Math.abs(position[0] - goalPosition[0]) < radius &&
    Math.abs(position[2] - goalPosition[2]) < radius
  );
}

function generateStageLayout(stage, startPosition) {
  const obstacleCount = getObstacleCountByStage(stage);
  const obstacleSize = getObstacleSizeByStage(stage);
  const goalRadius = getStageGoalRadius(stage);
  const goalObstacleClearance = goalRadius + obstacleSize * 0.9 + 0.8;
  const goalY = stage >= 7 ? 0 : 0.5;
  let goal = [6, goalY, -6];

  const stageGoalConfig =
    stage <= 3
      ? {
          xMin: -6,
          xMax: 6,
          zMin: -8.5,
          zMax: 0.8,
          minDistance: 4.5,
        }
      : stage <= 6
        ? {
            xMin: -7.5,
            xMax: 7.5,
            zMin: -10.5,
            zMax: -1.8,
            minDistance: 6.5,
          }
        : {
            xMin: -8.8,
            xMax: 8.8,
            zMin: -12.5,
            zMax: -3.8,
            minDistance: 8.5,
          };

  if (stage >= 7) {
    // 12~15단계(게임플레이 7~10):
    // - 시작 후 곧바로 벽에 붙지 않도록 첫 직선 구간을 충분히 확보
    // - 코너 직후 즉시 착륙하지 않도록 마지막 직선 구간 길이도 확보
    const snap = 0.2;
    const minFirstLegLength = stage >= 9 ? 3.2 : 2.6;
    const minFinalLegLength = stage >= 9 ? 2.7 : 2.2;
    let guidePath = null;
    let goalTry = 0;

    while (goalTry < 700) {
      goalTry += 1;
      const candidate = [
        randomInRange(stageGoalConfig.xMin, stageGoalConfig.xMax),
        goalY,
        randomInRange(stageGoalConfig.zMin, stageGoalConfig.zMax),
      ];
      if (distanceXZ(candidate, startPosition) < stageGoalConfig.minDistance) continue;

      const snappedGoal = [
        Math.round(candidate[0] / snap) * snap,
        goalY,
        Math.round(candidate[2] / snap) * snap,
      ];

      const candidatePath = buildBentGuidePath(startPosition, snappedGoal, stage);
      const points = candidatePath?.points ?? [];
      if (points.length < 2) continue;

      const first = points[0];
      const second = points[1];
      const beforeLast = points[points.length - 2];
      const last = points[points.length - 1];
      const firstLen = Math.hypot(second[0] - first[0], second[2] - first[2]);
      const finalLen = Math.hypot(last[0] - beforeLast[0], last[2] - beforeLast[2]);
      if (firstLen < minFirstLegLength) continue;
      if (finalLen < minFinalLegLength) continue;

      goal = snappedGoal;
      guidePath = candidatePath;
      break;
    }

    if (!guidePath) {
      goal = [
        Math.round(goal[0] / snap) * snap,
        goalY,
        Math.round(goal[2] / snap) * snap,
      ];
      guidePath = buildBentGuidePath(startPosition, goal, stage);
    }
    const points = guidePath.points ?? [];
    const endPoint = points[points.length - 1];
    const beforeEndPoint = points[points.length - 2];
    if (endPoint && beforeEndPoint) {
      // 착륙 지점은 마지막 통로 중심선 위에서 아주 소량만 안쪽으로 이동.
      // 그리고 0.1 그리드에 정렬해 바닥 셀 중심과 시각적으로 일치시킨다.
      const dx = endPoint[0] - beforeEndPoint[0];
      const dz = endPoint[2] - beforeEndPoint[2];
      const segLen = Math.hypot(dx, dz);
      if (segLen > 1e-6) {
        const dirX = dx / segLen;
        const dirZ = dz / segLen;
        const inset = Math.min(0.14, Math.max(0.06, segLen * 0.05));
        const gx = endPoint[0] - dirX * inset;
        const gz = endPoint[2] - dirZ * inset;
        goal = [Math.round(gx * 10) / 10, goalY, Math.round(gz * 10) / 10];
      } else {
        goal = [Math.round(endPoint[0] * 10) / 10, goalY, Math.round(endPoint[2] * 10) / 10];
      }
    } else if (endPoint) {
      goal = [Math.round(endPoint[0] * 10) / 10, goalY, Math.round(endPoint[2] * 10) / 10];
    }

    return {
      goalPosition: goal,
      obstaclePositions: [],
      obstacleSize,
      guidePath,
    };
  }

  let goalTry = 0;
  while (goalTry < 300) {
    goalTry += 1;
    // 시작 고정 카메라 시야(앞쪽) 안에서 랜덤 배치
    const candidate = [
      randomInRange(stageGoalConfig.xMin, stageGoalConfig.xMax),
      goalY,
      randomInRange(stageGoalConfig.zMin, stageGoalConfig.zMax),
    ];
    if (distanceXZ(candidate, startPosition) < stageGoalConfig.minDistance) continue;
    goal = candidate;
    break;
  }
  const obstacles = [];

  const pathX = goal[0] - startPosition[0];
  const pathZ = goal[2] - startPosition[2];
  const pathLen = Math.hypot(pathX, pathZ) || 1;
  const normPathX = pathX / pathLen;
  const normPathZ = pathZ / pathLen;
  const perpX = -normPathZ;
  const perpZ = normPathX;

  let safety = 0;
  while (obstacles.length < obstacleCount && safety < 8000) {
    safety += 1;
    // 시작점~목표점 사이 구간에서 배치 (드론 뒤쪽 배치 방지)
    const t = randomInRange(0.25, 0.88);
    // 4~6단계는 통로 중심에 가깝게 배치해 우회만 반복되지 않도록 조정
    const lateral = stage >= 4 ? randomInRange(-1.1, 1.1) : randomInRange(-2.2, 2.2);
    const baseX = startPosition[0] + pathX * t;
    const baseZ = startPosition[2] + pathZ * t;

    const candidate = [
      baseX + perpX * lateral,
      0.75,
      baseZ + perpZ * lateral,
    ];

    if (distanceXZ(candidate, startPosition) < 3.1) continue;
    if (distanceXZ(candidate, goal) < goalObstacleClearance) continue;

    let tooClose = false;
    for (let i = 0; i < obstacles.length; i += 1) {
      if (distanceXZ(candidate, obstacles[i]) < obstacleSize * 1.85) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) obstacles.push(candidate);
  }

  // 혹시 랜덤 배치가 부족하면 경로를 따라 보정 배치 (겹침 방지 포함)
  if (obstacles.length < obstacleCount) {
    const missing = obstacleCount - obstacles.length;
    const fallback = [];
    for (let i = 0; i < missing; i += 1) {
      const t = 0.28 + (i / Math.max(1, missing)) * 0.55;
      const lateral = i % 2 === 0 ? 1.2 : -1.2;
      const candidate = [
        startPosition[0] + pathX * t + perpX * lateral,
        0.75,
        startPosition[2] + pathZ * t + perpZ * lateral,
      ];

      const tooCloseExisting = obstacles.some(
        (p) => distanceXZ(candidate, p) < obstacleSize * 1.85
      );
      const tooCloseFallback = fallback.some(
        (p) => distanceXZ(candidate, p) < obstacleSize * 1.85
      );

      if (!tooCloseExisting && !tooCloseFallback) fallback.push(candidate);
    }

    obstacles.push(...fallback);
  }

  // 여전히 부족하면 마지막 안전 보정
  if (obstacles.length < obstacleCount) {
    let guard = 0;
    while (obstacles.length < obstacleCount && guard < 2000) {
      guard += 1;
      const t = randomInRange(0.22, 0.9);
      const lateral = randomInRange(-2.8, 2.8);
      const candidate = [
        startPosition[0] + pathX * t + perpX * lateral,
        0.75,
        startPosition[2] + pathZ * t + perpZ * lateral,
      ];
      if (distanceXZ(candidate, startPosition) < 3.1) continue;
      if (distanceXZ(candidate, goal) < goalObstacleClearance) continue;
      const tooClose = obstacles.some(
        (p) => distanceXZ(candidate, p) < obstacleSize * 1.85
      );
      if (!tooClose) obstacles.push(candidate);
    }
  }

  return { goalPosition: goal, obstaclePositions: obstacles, obstacleSize, guidePath: null };
}

/* =========================
   그림자
========================= */

function BoxShadow({
  position,
  width = 1,
  depth = 1,
  nearScale = 1.15,
  farScale = 0.55,
  opacity = 0.18,
}) {
  const scale = getShadowScale(position[1], nearScale, farScale);

  return (
    <mesh
      position={[position[0], 0.05, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[width * scale, depth * scale, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        color="black"
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

function DroneShadow({ position, rotationY }) {
  const bodyScale = getShadowScale(position[1], 1.0, 0.55);
  const noseScale = getShadowScale(position[1], 0.95, 0.5);

  return (
    <group
      position={[position[0], 0.05, position[2]]}
      rotation={[-Math.PI / 2, 0, rotationY]}
    >
      <mesh scale={[1 * bodyScale, 1 * bodyScale, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="black"
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>

      <mesh
        position={[0, 0.45 * bodyScale, 0]}
        scale={[0.22 * noseScale, 0.22 * noseScale, 1]}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="black"
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* =========================
   공통 오브젝트
========================= */

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[30, 30]} />
      <meshStandardMaterial color="lightgray" />
    </mesh>
  );
}

function Goal({ position, stage, uiStage }) {
  const goalLabel = uiStage >= 12 ? "착륙 지점" : "목표물";
  const showGoalLabel = uiStage >= 6 && uiStage <= 15;
  const goalLabelClassName =
    "px-2 py-1 rounded bg-green-600/90 text-white text-2xl font-semibold whitespace-nowrap";
  if (stage <= 6) {
    const pillarHeight = 7;
    const radius = getStageGoalRadius(stage);
    return (
      <group>
        <BoxShadow
          position={[position[0], 0.5, position[2]]}
          width={radius * 2}
          depth={radius * 2}
          nearScale={1.02}
          farScale={0.92}
          opacity={0.1}
        />
        {/* 1~6단계: 고도 무시 목표(기둥형) */}
        <mesh position={[position[0], pillarHeight / 2, position[2]]}>
          <cylinderGeometry args={[radius * 0.58, radius * 0.58, pillarHeight, 28]} />
          <meshStandardMaterial color="limegreen" transparent opacity={0.5} />
        </mesh>
        {showGoalLabel && (
          <Html position={[position[0], 2.5, position[2]]} center distanceFactor={12}>
            <div className={goalLabelClassName}>
              {goalLabel}
            </div>
          </Html>
        )}
      </group>
    );
  }

  // 7~10단계: 바닥 착륙 목표(패드)
  const radius = getStageGoalRadius(stage);
  const landingRadius = radius * 0.82;
  return (
    <group>
      <BoxShadow
        position={[position[0], 0.5, position[2]]}
        width={landingRadius * 2.2}
        depth={landingRadius * 2.2}
        nearScale={1.05}
        farScale={0.65}
        opacity={0.12}
      />
      <mesh position={[position[0], 0.03, position[2]]}>
        <cylinderGeometry args={[landingRadius, landingRadius, 0.06, 28]} />
        <meshStandardMaterial color="#22c55e" />
      </mesh>
      <mesh position={[position[0], 0.035, position[2]]}>
        <ringGeometry args={[landingRadius * 0.72, landingRadius * 0.92, 32]} />
        <meshBasicMaterial color="#86efac" side={2} />
      </mesh>
      {showGoalLabel && (
        <Html position={[position[0], 0.9, position[2]]} center distanceFactor={12}>
          <div className={goalLabelClassName}>
            {goalLabel}
          </div>
        </Html>
      )}
    </group>
  );
}

function Obstacle({ position, size = 1.5, uiStage }) {
  const pillarHeight = 20;
  const showObstacleLabel = uiStage >= 6 && uiStage <= 11;

  return (
    <group>
      <BoxShadow
        position={position}
        width={size}
        depth={size}
        nearScale={1.05}
        farScale={0.68}
        opacity={0.16}
      />
      {/* 세로는 사실상 무한대처럼 보이도록 매우 높은 기둥으로 표시 */}
      <mesh position={[position[0], pillarHeight / 2, position[2]]}>
        <boxGeometry args={[size, pillarHeight, size]} />
        <meshStandardMaterial
          color="red"
          transparent
          opacity={0.38}
          depthWrite={false}
        />
      </mesh>
      {showObstacleLabel && (
        <Html position={[position[0], 2.4, position[2]]} center distanceFactor={12}>
          <div className="px-2 py-1 rounded bg-rose-600/90 text-white text-xs font-semibold whitespace-nowrap">
            장애물
          </div>
        </Html>
      )}
    </group>
  );
}

function DroneVisual({ spinActive = true, spinSpeed = 34, spinStateRef = null }) {
  const armY = 0.08;
  const armOffset = 0.28;
  const motorOffset = 0.43;
  const wingYOffset = 0.08;
  const rotorRefs = useRef([]);
  const wingTiltRef = useRef(null);

  useFrame((_, delta) => {
    const active = spinStateRef
      ? !!(
          spinStateRef.current?.isFlying ||
          spinStateRef.current?.isSpooling ||
          spinStateRef.current?.isLanding ||
          spinStateRef.current?.isGroundRotorSpin
        )
      : spinActive;
    if (!active) return;
    for (const rotor of rotorRefs.current) {
      if (!rotor) continue;
      rotor.rotation.y += spinSpeed * delta;
    }
    if (wingTiltRef.current && spinStateRef?.current) {
      // Make wing assembly visibly bank/pitch with right stick movement.
      const sx = clamp(spinStateRef.current.rightStick?.x ?? 0, -1, 1);
      const sy = clamp(spinStateRef.current.rightStick?.y ?? 0, -1, 1);
      const targetPitch = sy * 0.58;
      const targetRoll = -sx * 0.5;
      wingTiltRef.current.rotation.x += (targetPitch - wingTiltRef.current.rotation.x) * 0.22;
      wingTiltRef.current.rotation.z += (targetRoll - wingTiltRef.current.rotation.z) * 0.22;
    }
  });

  return (
    <group>
      {/* main body */}
      <mesh>
        <boxGeometry args={[0.72, 0.16, 0.5]} />
        <meshStandardMaterial color="#2563eb" metalness={0.2} roughness={0.45} />
      </mesh>
      {/* top canopy */}
      <mesh position={[0, 0.12, -0.02]} scale={[0.34, 0.13, 0.26]}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial color="#0f172a" metalness={0.35} roughness={0.25} />
      </mesh>
      <group ref={wingTiltRef} position={[0, wingYOffset, 0]}>
        {/* arms */}
        <mesh position={[0, armY, armOffset]}>
          <boxGeometry args={[0.94, 0.055, 0.07]} />
          <meshStandardMaterial color="#1f2937" metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh position={[0, armY, -armOffset]}>
          <boxGeometry args={[0.94, 0.055, 0.07]} />
          <meshStandardMaterial color="#b91c1c" metalness={0.25} roughness={0.45} />
        </mesh>
        {/* motors + props */}
        {[
          [motorOffset, armY, armOffset],
          [-motorOffset, armY, armOffset],
          [motorOffset, armY, -armOffset],
          [-motorOffset, armY, -armOffset],
        ].map((p, i) => (
          <group key={i} position={p}>
            <mesh>
              <cylinderGeometry args={[0.07, 0.07, 0.07, 16]} />
              <meshStandardMaterial color="#111827" metalness={0.35} roughness={0.35} />
            </mesh>
            {/* blade group rotates during flight */}
            <group
              ref={(el) => {
                rotorRefs.current[i] = el;
              }}
              position={[0, 0.052, 0]}
            >
              <mesh>
                <boxGeometry args={[0.26, 0.008, 0.04]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.2} roughness={0.35} />
              </mesh>
              <mesh rotation={[0, Math.PI / 2, 0]}>
                <boxGeometry args={[0.26, 0.008, 0.04]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.2} roughness={0.35} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
      {/* landing gear */}
      <mesh position={[0.22, -0.08, 0]}>
        <boxGeometry args={[0.04, 0.14, 0.04]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[-0.22, -0.08, 0]}>
        <boxGeometry args={[0.04, 0.14, 0.04]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, -0.15, 0]}>
        <boxGeometry args={[0.54, 0.03, 0.16]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
      {/* front camera block (nose) */}
      <mesh position={[0, 0.02, -0.31]}>
        <boxGeometry args={[0.14, 0.08, 0.12]} />
        <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={1.2} />
      </mesh>
      {/* front direction marker */}
      <mesh position={[0, 0.055, -0.23]}>
        <boxGeometry args={[0.62, 0.034, 0.08]} />
        <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={1.6} />
      </mesh>
      {/* front nose tip marker */}
      <mesh position={[0, 0.075, -0.305]}>
        <sphereGeometry args={[0.045, 14, 10]} />
        <meshStandardMaterial color="#facc15" emissive="#f59e0b" emissiveIntensity={1.35} />
      </mesh>
    </group>
  );
}

const GroundGuidePath = memo(function GroundGuidePath({ guidePath, goalPosition = null, stage }) {
  const points = useMemo(() => guidePath?.points ?? [], [guidePath]);
  const width = guidePath?.width ?? 0;
  if (points.length < 2 || width <= 0) return null;

  const floorThickness = 0.03;
  const wallThickness = 0.08;
  const wallHeight = 18;
  // 12~15단계(게임플레이 7~10)는 셀 해상도를 완만히 낮춰 렌더 비용을 줄인다.
  const cell = stage >= 7 ? 0.14 : 0.1;
  const wallOuterOffset = wallThickness * 0.5 + 0.08;
  const centerSafeRadius = 1.75;
  const centerSafeSize = 3.2;

  // 벽은 "바닥으로 실제 칠해진 영역"의 외곽선에서 생성
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[2]);
    maxZ = Math.max(maxZ, p[2]);
  }
  const pad = cell * 2;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;
  // 중심([0,0]) 강제 안전구역이 항상 그리드에 포함되도록 경계 확장.
  const centerPad = Math.max(centerSafeRadius + cell * 2, centerSafeSize * 0.5 + cell * 2);
  minX = Math.min(minX, -centerPad);
  maxX = Math.max(maxX, centerPad);
  minZ = Math.min(minZ, -centerPad);
  maxZ = Math.max(maxZ, centerPad);
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const fillGrid = new Uint8Array(cols * rows);
  const idx = (x, z) => z * cols + x;
  const markRect = (cx, cz, yaw, w, d) => {
    const hw = w * 0.5;
    const hd = d * 0.5;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const radius = Math.hypot(hw, hd);
    const c0 = Math.max(0, Math.floor((cx - radius - minX) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((cx + radius - minX) / cell));
    const r0 = Math.max(0, Math.floor((cz - radius - minZ) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((cz + radius - minZ) / cell));
    for (let rz = r0; rz <= r1; rz += 1) {
      const wz = minZ + (rz + 0.5) * cell;
      for (let cxi = c0; cxi <= c1; cxi += 1) {
        const wx = minX + (cxi + 0.5) * cell;
        const lx = (wx - cx) * cos + (wz - cz) * sin;
        const lz = -(wx - cx) * sin + (wz - cz) * cos;
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) {
          fillGrid[idx(cxi, rz)] = 1;
        }
      }
    }
  };
  const markDisk = (cx, cz, radius) => {
    const c0 = Math.max(0, Math.floor((cx - radius - minX) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((cx + radius - minX) / cell));
    const r0 = Math.max(0, Math.floor((cz - radius - minZ) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((cz + radius - minZ) / cell));
    const r2 = radius * radius;
    for (let rz = r0; rz <= r1; rz += 1) {
      const wz = minZ + (rz + 0.5) * cell;
      for (let cxi = c0; cxi <= c1; cxi += 1) {
        const wx = minX + (cxi + 0.5) * cell;
        const dx = wx - cx;
        const dz = wz - cz;
        if (dx * dx + dz * dz <= r2) {
          fillGrid[idx(cxi, rz)] = 1;
        }
      }
    }
  };

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const yaw = Math.atan2(dx, dz);
    const midX = (a[0] + b[0]) * 0.5;
    const midZ = (a[2] + b[2]) * 0.5;
    markRect(midX, midZ, yaw, width + 0.02, len + 0.02);
  }
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    markRect(p[0], p[2], 0, width + 0.02, width + 0.02);
  }
  // 월드 중심([0, 0, 0]) 시작 안전 구역:
  // 벽 생성 전에 바닥을 먼저 확보해 시작 시 벽에 붙어 보이지 않게 함.
  markRect(0, 0, 0, centerSafeSize, centerSafeSize);
  markDisk(0, 0, centerSafeRadius);
  // 시작 지점은 추가 반경으로 채워 드론이 벽 밖으로 걸치지 않게 함
  const start = points[0];
  if (start) {
    markDisk(start[0], start[2], Math.max(width * 0.72, 0.95));
    // 드론 본체(약 1x1)가 시작 시 확실히 내부에 오도록 안전 박스 추가
    markRect(start[0], start[2], 0, Math.max(3.0, width * 1.8), Math.max(3.0, width * 1.8));
  }
  // 착륙 지점 중심을 기준으로 바닥 캡을 만들어 시각적 중심 불일치 방지.
  const end = goalPosition ?? points[points.length - 1];
  if (end) {
    markDisk(end[0], end[2], Math.max(width * 0.62, 1.05));
    markRect(end[0], end[2], 0, Math.max(width * 0.95, 2.2), Math.max(width * 0.95, 2.2));
  }

  const has = (x, z) => x >= 0 && x < cols && z >= 0 && z < rows && fillGrid[idx(x, z)] === 1;
  const floorMeshes = [];
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!has(x, z)) continue;
      const wx = minX + (x + 0.5) * cell;
      const wz = minZ + (z + 0.5) * cell;
      floorMeshes.push(
        <mesh key={`f-${x}-${z}`} position={[wx, 0.03, wz]}>
          <boxGeometry args={[cell + 0.02, floorThickness, cell + 0.02]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.32} depthWrite={false} />
        </mesh>
      );
    }
  }
  const eE = Array.from({ length: rows }, () => new Uint8Array(cols));
  const eW = Array.from({ length: rows }, () => new Uint8Array(cols));
  const eN = Array.from({ length: rows }, () => new Uint8Array(cols));
  const eS = Array.from({ length: rows }, () => new Uint8Array(cols));
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!has(x, z)) continue;
      eE[z][x] = !has(x + 1, z) ? 1 : 0;
      eW[z][x] = !has(x - 1, z) ? 1 : 0;
      eN[z][x] = !has(x, z - 1) ? 1 : 0;
      eS[z][x] = !has(x, z + 1) ? 1 : 0;
    }
  }

  const wallMeshes = [];
  // E/W: Z축 방향으로 연속 구간 병합
  for (let x = 0; x < cols; x += 1) {
    for (const side of ["E", "W"]) {
      const edge = side === "E" ? eE : eW;
      let z = 0;
      while (z < rows) {
        while (z < rows && edge[z][x] === 0) z += 1;
        if (z >= rows) break;
        const z0 = z;
        while (z < rows && edge[z][x] === 1) z += 1;
        const z1 = z - 1;
        const wx =
          minX +
          (x + 0.5) * cell +
          (side === "E" ? cell * 0.5 + wallOuterOffset : -cell * 0.5 - wallOuterOffset);
        const wz = minZ + ((z0 + z1 + 1) * 0.5) * cell;
        const len = (z1 - z0 + 1) * cell + 0.02;
        wallMeshes.push(
          <mesh key={`mw-${side}-${x}-${z0}`} position={[wx, 0.03 + wallHeight * 0.5, wz]}>
            <boxGeometry args={[wallThickness, wallHeight, len]} />
            <meshStandardMaterial color="#64748b" transparent opacity={0.45} />
          </mesh>
        );
      }
    }
  }
  // N/S: X축 방향으로 연속 구간 병합
  for (let z = 0; z < rows; z += 1) {
    for (const side of ["N", "S"]) {
      const edge = side === "N" ? eN : eS;
      let x = 0;
      while (x < cols) {
        while (x < cols && edge[z][x] === 0) x += 1;
        if (x >= cols) break;
        const x0 = x;
        while (x < cols && edge[z][x] === 1) x += 1;
        const x1 = x - 1;
        const wx = minX + ((x0 + x1 + 1) * 0.5) * cell;
        const wz =
          minZ +
          (z + 0.5) * cell +
          (side === "S" ? cell * 0.5 + wallOuterOffset : -cell * 0.5 - wallOuterOffset);
        const len = (x1 - x0 + 1) * cell + 0.02;
        wallMeshes.push(
          <mesh key={`mw-${side}-${z}-${x0}`} position={[wx, 0.03 + wallHeight * 0.5, wz]}>
            <boxGeometry args={[len, wallHeight, wallThickness]} />
            <meshStandardMaterial color="#64748b" transparent opacity={0.45} />
          </mesh>
        );
      }
    }
  }

  return <group>{floorMeshes}{wallMeshes}</group>;
});

/* =========================
   카메라
========================= */

function FixedCamera({ fixedStartPosition, fixedLookAt, yawOffset = 0 }) {
  useFrame(({ camera }) => {
    camera.position.set(
      fixedStartPosition[0],
      fixedStartPosition[1],
      fixedStartPosition[2]
    );
    const camX = fixedStartPosition[0];
    const camZ = fixedStartPosition[2];
    const lookDx = fixedLookAt[0] - camX;
    const lookDz = fixedLookAt[2] - camZ;
    const cosYaw = Math.cos(yawOffset);
    const sinYaw = Math.sin(yawOffset);
    const rotatedDx = lookDx * cosYaw - lookDz * sinYaw;
    const rotatedDz = lookDx * sinYaw + lookDz * cosYaw;
    camera.lookAt(camX + rotatedDx, fixedLookAt[1], camZ + rotatedDz);
  });

  return null;
}

function FollowCamera({ targetPosition, rotationY }) {
  const smoothPosRef = useRef(null);
  const smoothLookRef = useRef(null);

  useFrame(({ camera }) => {
    const forwardX = -Math.sin(rotationY);
    const forwardZ = -Math.cos(rotationY);
    const backX = -forwardX;
    const backZ = -forwardZ;

    // Pilot-like near-first-person: camera rides slightly above/behind the drone.
    const cameraHeight = 1.1;
    const cameraBackOffset = 2.0;
    const lookAhead = 10.5;
    const lookHeight = 0.18;

    const targetCamX = targetPosition[0] + backX * cameraBackOffset;
    const targetCamY = targetPosition[1] + cameraHeight;
    const targetCamZ = targetPosition[2] + backZ * cameraBackOffset;

    const targetLookX = targetPosition[0] + forwardX * lookAhead;
    const targetLookY = targetPosition[1] + lookHeight;
    const targetLookZ = targetPosition[2] + forwardZ * lookAhead;

    if (!smoothPosRef.current) {
      smoothPosRef.current = { x: targetCamX, y: targetCamY, z: targetCamZ };
    }
    if (!smoothLookRef.current) {
      smoothLookRef.current = { x: targetLookX, y: targetLookY, z: targetLookZ };
    }

    const posFollow = 0.1;
    const posFollowY = 0.06;
    const lookFollow = 0.12;
    const lookFollowY = 0.08;

    smoothPosRef.current.x += (targetCamX - smoothPosRef.current.x) * posFollow;
    smoothPosRef.current.y += (targetCamY - smoothPosRef.current.y) * posFollowY;
    smoothPosRef.current.z += (targetCamZ - smoothPosRef.current.z) * posFollow;

    smoothLookRef.current.x += (targetLookX - smoothLookRef.current.x) * lookFollow;
    smoothLookRef.current.y += (targetLookY - smoothLookRef.current.y) * lookFollowY;
    smoothLookRef.current.z += (targetLookZ - smoothLookRef.current.z) * lookFollow;

    camera.position.set(
      smoothPosRef.current.x,
      smoothPosRef.current.y,
      smoothPosRef.current.z
    );
    camera.lookAt(
      smoothLookRef.current.x,
      smoothLookRef.current.y,
      smoothLookRef.current.z
    );
  });

  return null;
}

/* =========================
   가상 조이스틱
========================= */

function VirtualJoystick({
  label,
  accentClass = "bg-blue-500",
  onChange,
  disabled = false,
}) {
  const size = 165;
  const knobSize = 63;
  const maxDistance = 48;

  const areaRef = useRef(null);
  const activeRef = useRef(false);
  const activePointerIdRef = useRef(null);
  const activeTouchIdRef = useRef(null);
  const startClientRef = useRef({ x: 0, y: 0 });

  const [knob, setKnob] = useState({ x: 0, y: 0 });

  function isPointerOnKnob(clientX, clientY) {
    if (!areaRef.current) return false;
    const rect = areaRef.current.getBoundingClientRect();
    const knobCenterX = rect.left + rect.width / 2 + knob.x;
    const knobCenterY = rect.top + rect.height / 2 + knob.y;

    const dx = clientX - knobCenterX;
    const dy = clientY - knobCenterY;
    const hitRadius = knobSize * 0.5 + 10;
    return Math.hypot(dx, dy) <= hitRadius;
  }

  const updateFromDrag = useCallback((clientX, clientY) => {
    let dx = clientX - startClientRef.current.x;
    let dy = clientY - startClientRef.current.y;

    const distance = Math.hypot(dx, dy);
    if (distance > maxDistance) {
      const ratio = maxDistance / distance;
      dx *= ratio;
      dy *= ratio;
    }

    setKnob({ x: dx, y: dy });
    onChange({
      x: dx / maxDistance,
      y: dy / maxDistance,
    });
  }, [maxDistance, onChange]);

  const resetStick = useCallback(() => {
    activeRef.current = false;
    setKnob({ x: 0, y: 0 });
    onChange({ x: 0, y: 0 });
  }, [onChange]);

  function handlePointerDown(e) {
    if (disabled) return;
    // 모바일은 touch 이벤트 경로로 처리 (pointer 경로와 중복 방지)
    if (e.pointerType === "touch") return;
    if (activeRef.current) return;
    // 가운데 노브를 잡았을 때만 조작 시작(모바일 게임 조이스틱 느낌)
    if (!isPointerOnKnob(e.clientX, e.clientY)) return;
    e.preventDefault();

    const area = areaRef.current;
    if (!area) return;

    activeRef.current = true;
    activePointerIdRef.current = e.pointerId;

    try {
      area.setPointerCapture(e.pointerId);
    } catch {
      // 일부 브라우저 환경에서는 포인터 캡처가 실패할 수 있음
    }
    // 조이스틱은 "터치한 위치로 점프"하지 않고, 누른 지점을 기준으로 드래그량만 반영
    startClientRef.current = { x: e.clientX, y: e.clientY };
    setKnob({ x: 0, y: 0 });
    onChange({ x: 0, y: 0 });
  }

  function handleTouchStart(e) {
    if (disabled) return;
    if (activeRef.current) return;

    const touch = e.changedTouches[0];
    if (!touch) return;
    // 가운데 노브를 잡았을 때만 시작
    if (!isPointerOnKnob(touch.clientX, touch.clientY)) return;

    e.preventDefault();
    activeRef.current = true;
    activeTouchIdRef.current = touch.identifier;
    startClientRef.current = { x: touch.clientX, y: touch.clientY };
    setKnob({ x: 0, y: 0 });
    onChange({ x: 0, y: 0 });
  }

  useEffect(() => {
    function handleWindowPointerMove(e) {
      if (!activeRef.current || disabled) return;
      if (
        activePointerIdRef.current !== null &&
        e.pointerId !== activePointerIdRef.current
      ) {
        return;
      }

      e.preventDefault();
      updateFromDrag(e.clientX, e.clientY);
    }

    function handleWindowPointerUpOrCancel(e) {
      if (!activeRef.current) return;
      if (
        activePointerIdRef.current !== null &&
        e.pointerId !== activePointerIdRef.current
      ) {
        return;
      }

      e.preventDefault();
      activePointerIdRef.current = null;
      resetStick();
    }

    window.addEventListener("pointermove", handleWindowPointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handleWindowPointerUpOrCancel, {
      passive: false,
    });
    window.addEventListener("pointercancel", handleWindowPointerUpOrCancel, {
      passive: false,
    });

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUpOrCancel);
      window.removeEventListener(
        "pointercancel",
        handleWindowPointerUpOrCancel
      );
    };
  }, [disabled, resetStick, updateFromDrag]);

  useEffect(() => {
    function getTouchById(touchList, id) {
      for (let i = 0; i < touchList.length; i += 1) {
        if (touchList[i].identifier === id) return touchList[i];
      }
      return null;
    }

    function handleWindowTouchMove(e) {
      if (!activeRef.current || disabled) return;
      if (activeTouchIdRef.current === null) return;

      const touch = getTouchById(e.touches, activeTouchIdRef.current);
      if (!touch) return;

      e.preventDefault();
      updateFromDrag(touch.clientX, touch.clientY);
    }

    function handleWindowTouchEndOrCancel(e) {
      if (!activeRef.current) return;
      if (activeTouchIdRef.current === null) return;

      const ended = getTouchById(e.changedTouches, activeTouchIdRef.current);
      if (!ended) return;

      e.preventDefault();
      activeTouchIdRef.current = null;
      resetStick();
    }

    window.addEventListener("touchmove", handleWindowTouchMove, {
      passive: false,
    });
    window.addEventListener("touchend", handleWindowTouchEndOrCancel, {
      passive: false,
    });
    window.addEventListener("touchcancel", handleWindowTouchEndOrCancel, {
      passive: false,
    });

    return () => {
      window.removeEventListener("touchmove", handleWindowTouchMove);
      window.removeEventListener("touchend", handleWindowTouchEndOrCancel);
      window.removeEventListener("touchcancel", handleWindowTouchEndOrCancel);
    };
  }, [disabled, resetStick, updateFromDrag]);

  return (
    <div
      className="bg-white/90 backdrop-blur border rounded-2xl p-2 shadow-md select-none touch-none"
      style={{ touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
    >
      <div className="text-[10px] font-bold text-center mb-1">{label}</div>

      <div
        ref={areaRef}
        className={`relative rounded-full border-2 border-gray-300 bg-gray-100 ${
          disabled ? "opacity-50" : ""
        }`}
        style={{
          width: size,
          height: size,
          touchAction: "none",
          overscrollBehavior: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
        }}
        onTouchStart={handleTouchStart}
        onPointerDown={handlePointerDown}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-[2px] h-full bg-gray-300" />
          <div className="absolute w-full h-[2px] bg-gray-300" />
        </div>

        <div
          className={`absolute rounded-full ${accentClass} shadow`}
          style={{
            width: knobSize,
            height: knobSize,
            left: size / 2 - knobSize / 2 + knob.x,
            top: size / 2 - knobSize / 2 + knob.y,
          }}
        />
      </div>
    </div>
  );
}

/* =========================
   조종 모드용 3D 드론
========================= */

function ControlDrone({
  goalPosition,
  obstaclePositions,
  obstacleSize,
  guidePath,
  stage,
  isTutorialStage,
  controlMode,
  controlRef,
  onCrashReset,
  onWallCrash,
  onSuccess,
  onTutorialLeftStickInput,
  onTutorialMoveInput,
  onTutorialLandingComplete,
}) {
  const droneRef = useRef(null);
  const shadowGroupRef = useRef(null);
  const shadowBodyRef = useRef(null);
  const shadowNoseRef = useRef(null);

  useFrame((_, delta) => {
    const c = controlRef.current;
    if (
      !c ||
      !droneRef.current ||
      !shadowGroupRef.current ||
      !shadowBodyRef.current ||
      !shadowNoseRef.current
    ) {
      return;
    }

    if (!c.isCrash && !c.isSuccess) {
      if (c.isGroundRotorSpin) {
        c.position[1] = c.minHeight;
        c.velocity = [0, 0, 0];
        c.groundRotorElapsed = (c.groundRotorElapsed || 0) + delta;
        if (c.groundRotorElapsed >= 1.5) {
          c.isGroundRotorSpin = false;
          c.groundRotorElapsed = 0;
        }
      }

      if (c.isSpooling) {
        const spoolDuration = 1.5;
        c.spoolElapsed = (c.spoolElapsed || 0) + delta;
        c.position[1] = c.minHeight;
        c.velocity = [0, 0, 0];
        if (c.spoolElapsed >= spoolDuration) {
          c.isSpooling = false;
          c.spoolElapsed = 0;
          c.isFlying = true;
          // raise to about 2x higher initial takeoff climb feel
          c.velocity[1] = 0.076;
        }
      }

      const leftX = c.leftStick.x;
      const leftY = c.leftStick.y;
      const rightX = c.rightStick.x;
      const rightY = c.rightStick.y;

      if (c.isLanding) {
        const landingHoverDuration = 0.5;
        c.landingHoldElapsed = (c.landingHoldElapsed || 0) + delta;
        if (c.landingHoldElapsed < landingHoverDuration) {
          c.velocity = [0, 0, 0];
        } else {
          // gentle descend with inertia feel
          c.velocity[1] = Math.max(c.velocity[1] - 0.0022, -0.026);
        }
      } else if (c.isFlying) {
        let yawInput =
          leftX * 0.5 +
          (c.keys.turnLeft ? 1 : 0) +
          (c.keys.turnRight ? -1 : 0);

        let inputVertical =
          -leftY +
          (c.keys.up ? 1 : 0) +
          (c.keys.down ? -1 : 0);

        let inputForward =
          -rightY +
          (c.keys.forward ? 1 : 0) +
          (c.keys.backward ? -1 : 0);

        let inputStrafe =
          rightX +
          (c.keys.left ? -1 : 0) +
          (c.keys.right ? 1 : 0);

        yawInput = clamp(yawInput, -1, 1);
        inputVertical = clamp(inputVertical, -1, 1);
        inputForward = clamp(inputForward, -1, 1);
        inputStrafe = clamp(inputStrafe, -1, 1);
        if (onTutorialLeftStickInput) onTutorialLeftStickInput(inputVertical, yawInput);
        if (onTutorialMoveInput) onTutorialMoveInput(inputForward, inputStrafe);

        c.rotation += yawInput * c.yawSpeed * delta;

        if (controlMode === "headless") {
          c.velocity[0] += inputStrafe * c.strafeAccel;
          c.velocity[2] += -inputForward * c.moveAccel;
        } else {
          const forwardX = -Math.sin(c.rotation);
          const forwardZ = -Math.cos(c.rotation);
          const rightVecX = Math.cos(c.rotation);
          const rightVecZ = -Math.sin(c.rotation);

          c.velocity[0] +=
            forwardX * inputForward * c.moveAccel +
            rightVecX * inputStrafe * c.strafeAccel;

          c.velocity[2] +=
            forwardZ * inputForward * c.moveAccel +
            rightVecZ * inputStrafe * c.strafeAccel;
        }

        c.velocity[1] += inputVertical * c.verticalAccel;
      }

      c.velocity[0] = clamp(c.velocity[0], -c.maxSpeedXZ, c.maxSpeedXZ);
      c.velocity[2] = clamp(c.velocity[2], -c.maxSpeedXZ, c.maxSpeedXZ);
      c.velocity[1] = clamp(c.velocity[1], -c.maxSpeedY, c.maxSpeedY);

      c.velocity[0] *= c.dampingXZ;
      c.velocity[2] *= c.dampingXZ;
      c.velocity[1] *= c.dampingY;

      const nextPosition = [
        c.position[0] + c.velocity[0],
        Math.max(c.minHeight, c.position[1] + c.velocity[1]),
        c.position[2] + c.velocity[2],
      ];

      // When a flying drone touches ground by manual descend, treat it as landing complete.
      if (c.isFlying && nextPosition[1] <= c.minHeight + 0.0001 && c.velocity[1] <= 0) {
        c.position = [nextPosition[0], c.minHeight, nextPosition[2]];
        c.velocity = [0, 0, 0];
        c.isFlying = false;
        c.isLanding = false;
        c.landingHoldElapsed = 0;
        c.isGroundRotorSpin = true;
        c.groundRotorElapsed = 0;
        if (onTutorialLandingComplete) onTutorialLandingComplete();
        return;
      }
      if (c.isLanding && nextPosition[1] <= c.minHeight + 0.0001 && c.velocity[1] <= 0) {
        c.position = [nextPosition[0], c.minHeight, nextPosition[2]];
        c.velocity = [0, 0, 0];
        c.isFlying = false;
        c.isLanding = false;
        c.landingHoldElapsed = 0;
        c.isGroundRotorSpin = true;
        c.groundRotorElapsed = 0;
        if (onTutorialLandingComplete) onTutorialLandingComplete();
        return;
      }

      const hasCrash = !isTutorialStage && obstaclePositions.some((obstacle) =>
        checkObstacleHit(nextPosition, obstacle, Math.max(1.1, obstacleSize * 0.72))
      );

      // 7단계부터는 바닥 경로 가이드를 벗어나면 즉시 충돌
      const droneRadius = 0.5;
      const centerSafeRadius = 1.75;
      const isInCenterSafeZone =
        stage >= 7 && Math.hypot(nextPosition[0], nextPosition[2]) <= centerSafeRadius;
      const isOffGuidePath =
        !isTutorialStage &&
        stage >= 7 &&
        guidePath &&
        !isInCenterSafeZone &&
        distanceToPolylineXZ(nextPosition, guidePath.points) >
          Math.max(0.05, guidePath.width * 0.5 - droneRadius);

      if (isOffGuidePath) {
        if (onWallCrash) onWallCrash();
        else onCrashReset();
        return;
      }

      if (hasCrash) {
        onCrashReset();
        return;
      } else {
        if (!c.isFlying && !c.isSpooling && !c.isLanding) {
          c.position = [nextPosition[0], c.minHeight, nextPosition[2]];
        } else {
          c.position = nextPosition;
        }

        if (
          !isTutorialStage &&
          checkGoalHit(nextPosition, goalPosition, stage, c.isFlying, c.minHeight)
        ) {
          onSuccess();
          return;
        }
      }
    }

    droneRef.current.position.set(c.position[0], c.position[1], c.position[2]);
    // Apply visible body tilt while moving with right pad.
    const targetPitch = clamp(c.rightStick.y, -1, 1) * 0.55;
    const targetRoll = clamp(c.rightStick.x, -1, 1) * -0.45;
    const currentPitch = droneRef.current.rotation.x;
    const currentRoll = droneRef.current.rotation.z;
    const nextPitch = currentPitch + (targetPitch - currentPitch) * 0.2;
    const nextRoll = currentRoll + (targetRoll - currentRoll) * 0.2;
    droneRef.current.rotation.set(nextPitch, c.rotation, nextRoll);

    const bodyScale = getShadowScale(c.position[1], 1.0, 0.55);
    const noseScale = getShadowScale(c.position[1], 0.95, 0.5);

    // 이륙 전/착륙 상태에서는 그림자를 숨겨 떠 있는 느낌을 줄인다.
    shadowGroupRef.current.visible = c.isFlying;
    shadowGroupRef.current.position.set(c.position[0], 0.05, c.position[2]);
    shadowGroupRef.current.rotation.set(-Math.PI / 2, 0, c.rotation);

    shadowBodyRef.current.scale.set(1 * bodyScale, 1 * bodyScale, 1);
    shadowNoseRef.current.position.set(0, 0.45 * bodyScale, 0);
    shadowNoseRef.current.scale.set(0.22 * noseScale, 0.22 * noseScale, 1);
  });

  return (
    <group>
      <group ref={shadowGroupRef}>
        <mesh ref={shadowBodyRef}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color="black" transparent opacity={0.18} />
        </mesh>

        <mesh ref={shadowNoseRef}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color="black" transparent opacity={0.18} />
        </mesh>
      </group>

      <group ref={droneRef}>
        <DroneVisual spinStateRef={controlRef} />
      </group>
    </group>
  );
}

function ControlScene({
  goalPosition,
  obstaclePositions,
  obstacleSize,
  guidePath,
  stage,
  uiStage,
  isTutorialStage,
  controlMode,
  controlRef,
  onCrashReset,
  onWallCrash,
  onSuccess,
  onTutorialLeftStickInput,
  onTutorialMoveInput,
  onTutorialLandingComplete,
  cameraMode,
  status,
  fixedStartPosition,
  fixedLookAt,
  fixedYawOffset,
}) {
  return (
    <div className="relative flex-1 min-h-[320px] bg-gray-200 overflow-hidden">
      <Canvas
        className="w-full h-full"
        camera={{ position: fixedStartPosition, fov: 60 }}
        dpr={[1, 1.5]}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[5, 10, 5]} intensity={1} />
        {!isTutorialStage && (
          <GroundGuidePath guidePath={guidePath} goalPosition={goalPosition} stage={stage} />
        )}
        {!isTutorialStage && <Goal position={goalPosition} stage={stage} uiStage={uiStage} />}
        {!isTutorialStage &&
          obstaclePositions.map((position, index) => (
            <Obstacle key={index} position={position} size={obstacleSize} uiStage={uiStage} />
          ))}
        <ControlDrone
          goalPosition={goalPosition}
          obstaclePositions={obstaclePositions}
          obstacleSize={obstacleSize}
          guidePath={guidePath}
          stage={stage}
          isTutorialStage={isTutorialStage}
          controlMode={controlMode}
          controlRef={controlRef}
          onCrashReset={onCrashReset}
          onWallCrash={onWallCrash}
          onSuccess={onSuccess}
          onTutorialLeftStickInput={onTutorialLeftStickInput}
          onTutorialMoveInput={onTutorialMoveInput}
          onTutorialLandingComplete={onTutorialLandingComplete}
        />
        {cameraMode === "fixed" ? (
          <FixedCamera
            fixedStartPosition={fixedStartPosition}
            fixedLookAt={fixedLookAt}
            yawOffset={fixedYawOffset}
          />
        ) : (
          <FollowCamera
            targetPosition={status.position}
            rotationY={status.rotation}
          />
        )}
      </Canvas>
    </div>
  );
}

/* =========================
   코딩 모드용 Scene
========================= */

function CodingDrone({ position, rotationY }) {
  return (
    <group>
      <DroneShadow position={position} rotationY={rotationY} />
      <group position={position} rotation={[0, rotationY, 0]}>
        <DroneVisual spinActive spinSpeed={28} />
      </group>
    </group>
  );
}

function CodingCamera({ targetPosition, rotationY }) {
  useFrame(({ camera }) => {
    const distance = 8;
    const height = 4;

    const forwardX = -Math.sin(rotationY);
    const forwardZ = -Math.cos(rotationY);

    camera.position.set(
      targetPosition[0] - forwardX * distance,
      targetPosition[1] + height,
      targetPosition[2] - forwardZ * distance
    );
    camera.lookAt(targetPosition[0], targetPosition[1] + 0.5, targetPosition[2]);
  });

  return null;
}

function CodingScene({
  dronePosition,
  rotationY,
  goalPosition,
  obstaclePosition,
}) {
  return (
    <div className="relative flex-1 min-h-[320px] overflow-hidden">
      <Canvas
        className="w-full h-full"
        camera={{ position: [0, 5, 8], fov: 60 }}
        dpr={[1, 1.5]}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[5, 10, 5]} intensity={1} />
        <Goal position={goalPosition} />
        <Obstacle position={obstaclePosition} />
        <CodingDrone position={dronePosition} rotationY={rotationY} />
        <CodingCamera targetPosition={dronePosition} rotationY={rotationY} />
      </Canvas>
    </div>
  );
}

/* =========================
   조종 모드
========================= */

function ControlMode() {
  const GROUNDED_HEIGHT = 0.17;
  const START_POSITION = useMemo(() => [0, GROUNDED_HEIGHT, 0], [GROUNDED_HEIGHT]);
  const START_ROTATION = 0;
  const TUTORIAL_STAGE_COUNT = 5;
  const CORE_STAGE_COUNT = 10;
  const MAX_STAGE = TUTORIAL_STAGE_COUNT + CORE_STAGE_COUNT;

  const [stage, setStage] = useState(1);
  const [tutorialStep, setTutorialStep] = useState(0);
  const getGameplayStage = useCallback(
    (stageNumber) => Math.max(1, stageNumber - TUTORIAL_STAGE_COUNT),
    [TUTORIAL_STAGE_COUNT]
  );
  const createTutorialLayout = useCallback(
    () => ({
      goalPosition: [999, 0.5, 999],
      obstaclePositions: [],
      obstacleSize: 1.5,
      guidePath: null,
    }),
    []
  );
  const getLayoutForStage = useCallback(
    (stageNumber) =>
      stageNumber <= TUTORIAL_STAGE_COUNT
        ? createTutorialLayout()
        : generateStageLayout(getGameplayStage(stageNumber), START_POSITION),
    [START_POSITION, TUTORIAL_STAGE_COUNT, createTutorialLayout, getGameplayStage]
  );
  const [stageLayout, setStageLayout] = useState(() => getLayoutForStage(1));
  const [centerOverlayMessage, setCenterOverlayMessage] = useState("");
  const [centerOverlayType, setCenterOverlayType] = useState("clear");
  const [completedStages, setCompletedStages] = useState(() => new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isStopwatchRunning, setIsStopwatchRunning] = useState(false);
  const crashTimerRef = useRef(null);
  const successTimerRef = useRef(null);
  const overlayTimerRef = useRef(null);
  const stopwatchStartRef = useRef(null);
  const grandCelebrationShownRef = useRef(false);
  const rotorStartTimerRef = useRef(null);
  const audioRef = useRef({
    ctx: null,
    master: null,
    rotorGain: null,
    rotorOsc1: null,
    rotorOsc2: null,
  });
  const isCameraDraggingRef = useRef(false);
  const cameraDragPointerIdRef = useRef(null);
  const lastCameraDragXRef = useRef(0);

  const fixedStartPosition = useMemo(() => [0, 3.2, 6], []);
  const fixedLookAt = useMemo(() => [0, 1.0, -1.2], []);

  const [controlMode, setControlMode] = useState("normal");
  const [cameraMode, setCameraMode] = useState("fixed");
  const [showGuide, setShowGuide] = useState(false);
  const [fixedYawOffset, setFixedYawOffset] = useState(0);
  const [status, setStatus] = useState({
    position: START_POSITION,
    rotation: START_ROTATION,
    isCrash: false,
    isSuccess: false,
    isFlying: false,
    isSpooling: false,
    isLanding: false,
    isGroundRotorSpin: false,
  });
  const isTutorialStage = stage <= TUTORIAL_STAGE_COUNT;
  const gameplayStage = getGameplayStage(stage);
  const tutorialMessageByStage = useMemo(
    () => ({
      1: ["이륙 버튼을 누르세요.", "착륙 버튼을 누르세요."],
      2: [
        "이륙 버튼을 누르세요.",
        "왼쪽 조이스틱을 위로 올리세요.",
        "왼쪽 조이스틱을 아래로 내리세요.",
        "왼쪽 조이스틱을 오른쪽으로 밀어보세요.",
        "왼쪽 조이스틱을 왼쪽으로 밀어보세요.",
        "착륙 버튼을 누르세요.",
      ],
      3: [
        "이륙 버튼을 누르세요.",
        "오른쪽 조이스틱을 위로 올려 앞으로 가세요.",
        "오른쪽 조이스틱을 아래로 내려 뒤로 가세요.",
        "오른쪽 조이스틱을 왼쪽으로 밀어 왼쪽으로 가세요.",
        "오른쪽 조이스틱을 오른쪽으로 밀어 오른쪽으로 가세요.",
        "착륙 버튼을 누르세요.",
      ],
      4: [
        "이륙 버튼을 누르세요.",
        "왼쪽 조이스틱을 오른쪽으로 밀어 오른쪽으로 도세요.",
        "오른쪽 조이스틱을 오른쪽으로 밀어 이동하세요.",
        "왼쪽 조이스틱을 왼쪽으로 밀어 왼쪽으로 도세요.",
        "오른쪽 조이스틱을 왼쪽으로 밀어 이동하세요.",
        "착륙 버튼을 누르세요.",
      ],
      5: [
        "이륙 버튼을 누르세요.",
        "원하는 대로 움직여 보세요.",
        "착륙 버튼을 누르세요.",
      ],
    }),
    []
  );
  const tutorialMessages = tutorialMessageByStage[stage] ?? [];
  const currentTutorialMessage =
    isTutorialStage && tutorialStep < tutorialMessages.length
      ? tutorialMessages[tutorialStep]
      : "";
  const stageTitle = useMemo(() => {
    if (stage === 1) return "1단계 : 이륙 / 착륙";
    if (stage === 2) return "2단계 : 왼쪽 조이스틱";
    if (stage === 3) return "3단계 : 오른쪽 조이스틱";
    if (stage === 4) return "4단계 : 회전 조작";
    if (stage === 5) return "5단계 : 자유 비행";
    if (stage >= 6 && stage <= 11) return `${stage}단계 : 장애물 피해 목표 도달하기`;
    return `${stage}단계 : 벽을 피해 목표지점 착륙하기`;
  }, [stage]);
  const getSpawnPosition = useCallback((layout, stageNumber = stage) => {
    if (stageNumber === 4) return [0, START_POSITION[1], -2.5];
    if (stageNumber >= 12) {
      // 12~15단계는 항상 월드 정중앙에서 시작.
      return [...START_POSITION];
    }
    const path = layout?.guidePath;
    if (!path || !path.points || path.points.length < 2) return [...START_POSITION];
    const points = path.points;
    const width = path.width ?? 1;
    // Spawn deeper along the center line to avoid starting near corner/wall.
    const targetDist =
      stageNumber >= 11 ? Math.max(2.6, width * 1.2) : Math.max(1.5, width * 0.65);
    let remain = targetDist;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const segLen = Math.hypot(dx, dz);
      if (segLen <= 1e-6) continue;
      if (remain <= segLen) {
        const t = remain / segLen;
        return [a[0] + dx * t, START_POSITION[1], a[2] + dz * t];
      }
      remain -= segLen;
    }
    const last = points[points.length - 1];
    return [last[0], START_POSITION[1], last[2]];
  }, [START_POSITION, stage]);

  const initialSpawn = useMemo(() => getSpawnPosition(stageLayout), [getSpawnPosition, stageLayout]);

  const controlRef = useRef({
    position: [...initialSpawn],
    rotation: START_ROTATION,
    velocity: [0, 0, 0],
    isCrash: false,
    isSuccess: false,
    isFlying: false,
    isSpooling: false,
    spoolElapsed: 0,
    isLanding: false,
    landingHoldElapsed: 0,
    isGroundRotorSpin: false,
    groundRotorElapsed: 0,
    leftStick: { x: 0, y: 0 },
    rightStick: { x: 0, y: 0 },
    keys: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      turnLeft: false,
      turnRight: false,
    },
    moveAccel: 0.0052,
    strafeAccel: 0.0052,
    verticalAccel: 0.0046,
    yawSpeed: 1,
    dampingXZ: 0.965,
    dampingY: 0.93,
    maxSpeedXZ: 0.19,
    maxSpeedY: 0.085,
    minHeight: GROUNDED_HEIGHT,
  });

  const syncStatus = useCallback(() => {
    const c = controlRef.current;
    setStatus({
      position: [
        Number(c.position[0].toFixed(2)),
        Number(c.position[1].toFixed(2)),
        Number(c.position[2].toFixed(2)),
      ],
      rotation: c.rotation,
      isCrash: c.isCrash,
      isSuccess: c.isSuccess,
      isFlying: c.isFlying,
      isSpooling: c.isSpooling,
      isLanding: c.isLanding,
      isGroundRotorSpin: c.isGroundRotorSpin,
    });
  }, []);

  const ensureAudioGraph = useCallback(() => {
    if (typeof window === "undefined") return null;
    const store = audioRef.current;
    if (!store.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 0.12;
      master.connect(ctx.destination);
      store.ctx = ctx;
      store.master = master;
    }
    return store;
  }, []);

  const stopRotorSound = useCallback(() => {
    const store = audioRef.current;
    if (rotorStartTimerRef.current) {
      clearTimeout(rotorStartTimerRef.current);
      rotorStartTimerRef.current = null;
    }
    if (!store.ctx) return;
    const now = store.ctx.currentTime;
    if (store.rotorGain) {
      store.rotorGain.gain.cancelScheduledValues(now);
      store.rotorGain.gain.setTargetAtTime(0, now, 0.05);
    }
  }, []);

  const startRotorSound = useCallback(() => {
    const store = ensureAudioGraph();
    if (!store || !store.ctx || !store.master) return;
    if (store.ctx.state === "suspended") {
      store.ctx.resume();
    }
    if (!store.rotorGain) {
      const rotorGain = store.ctx.createGain();
      rotorGain.gain.value = 0;
      rotorGain.connect(store.master);

      const osc1 = store.ctx.createOscillator();
      osc1.type = "sawtooth";
      osc1.frequency.value = 92;

      const osc2 = store.ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.value = 138;

      const lp = store.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 980;
      lp.Q.value = 0.7;

      osc1.connect(lp);
      osc2.connect(lp);
      lp.connect(rotorGain);
      osc1.start();
      osc2.start();

      store.rotorGain = rotorGain;
      store.rotorOsc1 = osc1;
      store.rotorOsc2 = osc2;
    }
    const now = store.ctx.currentTime;
    store.rotorGain.gain.cancelScheduledValues(now);
    store.rotorGain.gain.setTargetAtTime(0.08, now, 0.08);
  }, [ensureAudioGraph]);

  const playStageClearSound = useCallback(() => {
    const store = ensureAudioGraph();
    if (!store || !store.ctx || !store.master) return;
    if (store.ctx.state === "suspended") {
      store.ctx.resume();
    }
    const ctx = store.ctx;
    const now = ctx.currentTime;
    const n1 = ctx.createOscillator();
    const n2 = ctx.createOscillator();
    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    n1.type = "triangle";
    n2.type = "triangle";
    n1.frequency.setValueAtTime(880, now);
    n2.frequency.setValueAtTime(1320, now + 0.14);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.exponentialRampToValueAtTime(0.17, now + 0.02);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    g2.gain.setValueAtTime(0.0001, now + 0.14);
    g2.gain.exponentialRampToValueAtTime(0.2, now + 0.16);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.33);
    n1.connect(g1);
    g1.connect(store.master);
    n2.connect(g2);
    g2.connect(store.master);
    n1.start(now);
    n1.stop(now + 0.16);
    n2.start(now + 0.14);
    n2.stop(now + 0.35);
  }, [ensureAudioGraph]);

  const playFinalCelebrationSound = useCallback(() => {
    const store = ensureAudioGraph();
    if (!store || !store.ctx || !store.master) return;
    if (store.ctx.state === "suspended") {
      store.ctx.resume();
    }
    const ctx = store.ctx;
    const now = ctx.currentTime;
    const notes = [784, 988, 1175, 1568];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      const t = now + idx * 0.12;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.24, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain);
      gain.connect(store.master);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }, [ensureAudioGraph]);

  const markStageCompleted = useCallback((stageNumber) => {
    setCompletedStages((prev) => {
      if (prev.has(stageNumber)) return prev;
      const next = new Set(prev);
      next.add(stageNumber);
      if (next.size === MAX_STAGE && !grandCelebrationShownRef.current) {
        grandCelebrationShownRef.current = true;
        setCenterOverlayType("clear");
        setCenterOverlayMessage("축하합니다! 이제 진짜 드론을 조종해 봅시다!");
        playFinalCelebrationSound();
        if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = setTimeout(() => {
          setCenterOverlayMessage("");
        }, 2200);
      }
      return next;
    });
  }, [MAX_STAGE, playFinalCelebrationSound]);

  const playCrashSound = useCallback(() => {
    const store = ensureAudioGraph();
    if (!store || !store.ctx || !store.master) return;
    if (store.ctx.state === "suspended") {
      store.ctx.resume();
    }
    const ctx = store.ctx;
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.type = "sawtooth";
    osc2.type = "square";
    osc1.frequency.setValueAtTime(520, now);
    osc1.frequency.exponentialRampToValueAtTime(130, now + 0.34);
    osc2.frequency.setValueAtTime(260, now);
    osc2.frequency.exponentialRampToValueAtTime(90, now + 0.34);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.34, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(store.master);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.38);
    osc2.stop(now + 0.38);
  }, [ensureAudioGraph]);

  const showStageClearOverlay = useCallback(
    (clearedStageNumber, elapsed = null) => {
      setCenterOverlayType("clear");
      const timing =
        typeof elapsed === "number" && Number.isFinite(elapsed)
          ? ` (${elapsed.toFixed(2)}초)`
          : "";
      setCenterOverlayMessage(`${clearedStageNumber} 단계 통과했습니다. 축하합니다.${timing}`);
      playStageClearSound();
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = setTimeout(() => {
        setCenterOverlayMessage("");
      }, 1300);
    },
    [playStageClearSound]
  );

  const playTakeoffBeepThenRotor = useCallback(() => {
    const store = ensureAudioGraph();
    if (!store || !store.ctx || !store.master) return;
    if (store.ctx.state === "suspended") {
      store.ctx.resume();
    }
    stopRotorSound();
    const ctx = store.ctx;
    const now = ctx.currentTime;
    const beepOsc = ctx.createOscillator();
    const beepGain = ctx.createGain();
    beepOsc.type = "square";
    beepOsc.frequency.setValueAtTime(1280, now);
    beepOsc.frequency.exponentialRampToValueAtTime(920, now + 0.11);
    beepGain.gain.setValueAtTime(0.0001, now);
    beepGain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    beepGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    beepOsc.connect(beepGain);
    beepGain.connect(store.master);
    beepOsc.start(now);
    beepOsc.stop(now + 0.13);

    rotorStartTimerRef.current = setTimeout(() => {
      startRotorSound();
      rotorStartTimerRef.current = null;
    }, 140);
  }, [ensureAudioGraph, startRotorSound, stopRotorSound]);

  const takeOff = useCallback(() => {
    const c = controlRef.current;
    if (c.isCrash || c.isSuccess || c.isFlying || c.isSpooling) return;
    c.isLanding = false;
    c.landingHoldElapsed = 0;
    c.isGroundRotorSpin = false;
    c.groundRotorElapsed = 0;
    c.isSpooling = true;
    c.spoolElapsed = 0;
    c.velocity = [0, 0, 0];
    c.position[1] = GROUNDED_HEIGHT;
    playTakeoffBeepThenRotor();
    if (stage >= 6 && !stopwatchStartRef.current) {
      stopwatchStartRef.current = performance.now();
      setElapsedSeconds(0);
      setIsStopwatchRunning(true);
    }
    if (stage === 1 && tutorialStep === 0) setTutorialStep(1);
    if (stage === 2 && tutorialStep === 0) setTutorialStep(1);
    if (stage === 3 && tutorialStep === 0) setTutorialStep(1);
    if (stage === 4 && tutorialStep === 0) setTutorialStep(1);
    if (stage === 5 && tutorialStep === 0) setTutorialStep(1);
    syncStatus();
  }, [GROUNDED_HEIGHT, playTakeoffBeepThenRotor, stage, syncStatus, tutorialStep]);

  const land = useCallback(() => {
    const c = controlRef.current;
    if (c.isCrash || c.isSuccess || (!c.isFlying && !c.isSpooling)) return;
    // If still in takeoff spool, cancel immediately.
    if (c.isSpooling) {
      c.isSpooling = false;
      c.spoolElapsed = 0;
      c.isFlying = false;
      c.velocity = [0, 0, 0];
      c.position[1] = GROUNDED_HEIGHT;
      c.isLanding = false;
      c.isGroundRotorSpin = false;
      c.groundRotorElapsed = 0;
      stopRotorSound();
      syncStatus();
      return;
    }
    // Landing sequence: 0.5s hover -> slow descend -> ground touch -> 1.5s rotor spin.
    c.isLanding = true;
    c.landingHoldElapsed = 0;
    c.isGroundRotorSpin = false;
    c.groundRotorElapsed = 0;
    c.velocity = [0, 0, 0];
    syncStatus();
  }, [
    GROUNDED_HEIGHT,
    stopRotorSound,
    syncStatus,
  ]);

  const toggleTakeoffLand = useCallback(() => {
    if (status.isFlying) {
      land();
    } else {
      takeOff();
    }
  }, [land, status.isFlying, takeOff]);

  function resetAll() {
    const c = controlRef.current;
    const nextLayout = getLayoutForStage(1);
    const spawn = getSpawnPosition(nextLayout, 1);
    c.position = [...spawn];
    c.rotation = START_ROTATION;
    c.velocity = [0, 0, 0];
    c.isCrash = false;
    c.isSuccess = false;
    c.isFlying = false;
    c.isSpooling = false;
    c.spoolElapsed = 0;
    c.isLanding = false;
    c.landingHoldElapsed = 0;
    c.isGroundRotorSpin = false;
    c.groundRotorElapsed = 0;
    stopRotorSound();
    setIsStopwatchRunning(false);
    setElapsedSeconds(0);
    stopwatchStartRef.current = null;
    c.leftStick = { x: 0, y: 0 };
    c.rightStick = { x: 0, y: 0 };
    c.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      turnLeft: false,
      turnRight: false,
    };
    setStage(1);
    setTutorialStep(0);
    setStageLayout(nextLayout);
    setStatus((prev) => ({ ...prev, position: spawn }));
    syncStatus();
  }

  const resetStageOnly = useCallback((layoutOverride, stageOverride) => {
    const c = controlRef.current;
    const layout = layoutOverride || stageLayout;
    const targetStage = typeof stageOverride === "number" ? stageOverride : stage;
    const spawn = getSpawnPosition(layout, targetStage);
    c.position = [...spawn];
    c.rotation = START_ROTATION;
    c.velocity = [0, 0, 0];
    c.isCrash = false;
    c.isSuccess = false;
    c.isFlying = false;
    c.isSpooling = false;
    c.spoolElapsed = 0;
    c.isLanding = false;
    c.landingHoldElapsed = 0;
    c.isGroundRotorSpin = false;
    c.groundRotorElapsed = 0;
    stopRotorSound();
    setIsStopwatchRunning(false);
    setElapsedSeconds(0);
    stopwatchStartRef.current = null;
    c.leftStick = { x: 0, y: 0 };
    c.rightStick = { x: 0, y: 0 };
    c.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      turnLeft: false,
      turnRight: false,
    };
    setStatus((prev) => ({ ...prev, position: spawn }));
    syncStatus();
  }, [getSpawnPosition, stage, stageLayout, stopRotorSound, syncStatus]);

  const handleTutorialLeftStickInput = useCallback(
    (inputVertical, yawInput) => {
      if (stage === 2) {
        if (tutorialStep === 1 && inputVertical > 0.35) setTutorialStep(2);
        if (tutorialStep === 2 && inputVertical < -0.35) setTutorialStep(3);
        // leftStick.x uses inverted sign in control mapping
        // so "right push" => yawInput < 0, "left push" => yawInput > 0
        if (tutorialStep === 3 && yawInput < -0.35) setTutorialStep(4);
        if (tutorialStep === 4 && yawInput > 0.35) setTutorialStep(5);
      }
      if (stage === 4) {
        if (tutorialStep === 1 && yawInput < -0.35) setTutorialStep(2);
        else if (tutorialStep === 3 && yawInput > 0.35) setTutorialStep(4);
      }
    },
    [stage, tutorialStep]
  );

  const handleTutorialMoveInput = useCallback(
    (inputForward, inputStrafe) => {
      if (stage === 3) {
        if (tutorialStep === 1 && inputForward > 0.35) setTutorialStep(2);
        else if (tutorialStep === 2 && inputForward < -0.35) setTutorialStep(3);
        else if (tutorialStep === 3 && inputStrafe < -0.35) setTutorialStep(4);
        else if (tutorialStep === 4 && inputStrafe > 0.35) setTutorialStep(5);
      }
      if (stage === 4) {
        if (tutorialStep === 2 && inputStrafe > 0.35) setTutorialStep(3);
        else if (tutorialStep === 4 && inputStrafe < -0.35) setTutorialStep(5);
      }
    },
    [stage, tutorialStep]
  );

  const handleTutorialLandingComplete = useCallback(() => {
    if (stage === 1 && tutorialStep === 1) {
      showStageClearOverlay(1);
      markStageCompleted(1);
      const nextStage = 2;
      const nextLayout = getLayoutForStage(nextStage);
      setStage(nextStage);
      setTutorialStep(0);
      setStageLayout(nextLayout);
      resetStageOnly(nextLayout, nextStage);
      return;
    }
    if (stage === 2 && tutorialStep === 5) {
      showStageClearOverlay(2);
      markStageCompleted(2);
      const nextStage = 3;
      const nextLayout = getLayoutForStage(nextStage);
      setStage(nextStage);
      setTutorialStep(0);
      setStageLayout(nextLayout);
      resetStageOnly(nextLayout, nextStage);
      return;
    }
    if (stage === 3 && tutorialStep === 5) {
      showStageClearOverlay(3);
      markStageCompleted(3);
      const nextStage = 4;
      const nextLayout = getLayoutForStage(nextStage);
      setStage(nextStage);
      setTutorialStep(0);
      setStageLayout(nextLayout);
      resetStageOnly(nextLayout, nextStage);
      return;
    }
    if (stage === 4 && tutorialStep === 5) {
      showStageClearOverlay(4);
      markStageCompleted(4);
      const nextStage = 5;
      const nextLayout = getLayoutForStage(nextStage);
      setStage(nextStage);
      setTutorialStep(0);
      setStageLayout(nextLayout);
      resetStageOnly(nextLayout, nextStage);
      return;
    }
    if (stage === 5 && tutorialStep >= 1) {
      showStageClearOverlay(5);
      markStageCompleted(5);
      const nextStage = 6;
      const nextLayout = getLayoutForStage(nextStage);
      setStage(nextStage);
      setTutorialStep(0);
      setStageLayout(nextLayout);
      resetStageOnly(nextLayout, nextStage);
    }
  }, [getLayoutForStage, markStageCompleted, resetStageOnly, showStageClearOverlay, stage, tutorialStep]);

  const handleCrashWithEffect = useCallback(() => {
    const c = controlRef.current;
    if (c.isCrash) return;
    c.isCrash = true;
    c.velocity = [0, 0, 0];
    stopRotorSound();
    setIsStopwatchRunning(false);
    if (stage >= 4) {
      setCenterOverlayType("crash");
      setCenterOverlayMessage("충돌했습니다.");
      playCrashSound();
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = setTimeout(() => {
        setCenterOverlayMessage("");
      }, 1000);
    }
    syncStatus();

    if (crashTimerRef.current) clearTimeout(crashTimerRef.current);
    crashTimerRef.current = setTimeout(() => {
      resetStageOnly();
    }, stage >= 4 ? 1000 : 600);
  }, [playCrashSound, resetStageOnly, stage, stopRotorSound, syncStatus]);

  const handleWallCrashImmediate = useCallback(() => {
    handleCrashWithEffect();
  }, [handleCrashWithEffect]);

  const handleStageSuccess = useCallback(() => {
    if (isTutorialStage) return;
    const c = controlRef.current;
    if (c.isSuccess) return;
    c.isSuccess = true;
    c.velocity = [0, 0, 0];
    stopRotorSound();
    syncStatus();
    let successElapsed = null;
    if (stage >= 6 && stopwatchStartRef.current) {
      successElapsed = (performance.now() - stopwatchStartRef.current) / 1000;
      setElapsedSeconds(successElapsed);
      setIsStopwatchRunning(false);
      stopwatchStartRef.current = null;
    }
    showStageClearOverlay(stage, successElapsed);
    markStageCompleted(stage);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => {
      if (stage < MAX_STAGE) {
        const nextStage = stage + 1;
        const nextLayout = getLayoutForStage(nextStage);
        setStage(nextStage);
        setStageLayout(nextLayout);
        resetStageOnly(nextLayout, nextStage);
      } else {
        resetStageOnly();
      }
    }, 1100);
  }, [
    MAX_STAGE,
    getLayoutForStage,
    isTutorialStage,
    markStageCompleted,
    resetStageOnly,
    showStageClearOverlay,
    stage,
    stopRotorSound,
    syncStatus,
  ]);

  useEffect(() => {
    const store = audioRef.current;
    return () => {
      stopRotorSound();
      if (store.rotorOsc1) {
        store.rotorOsc1.stop();
        store.rotorOsc1 = null;
      }
      if (store.rotorOsc2) {
        store.rotorOsc2.stop();
        store.rotorOsc2 = null;
      }
      if (store.ctx) {
        store.ctx.close();
        store.ctx = null;
      }
      store.master = null;
      store.rotorGain = null;
    };
  }, [stopRotorSound]);

  useEffect(() => {
    const interval = setInterval(() => {
      syncStatus();
      if (isStopwatchRunning && stopwatchStartRef.current) {
        setElapsedSeconds((performance.now() - stopwatchStartRef.current) / 1000);
      }
    }, 120);

    return () => clearInterval(interval);
  }, [isStopwatchRunning, syncStatus]);

  useEffect(() => {
    if (!status.isFlying && !status.isSpooling && !status.isGroundRotorSpin) {
      stopRotorSound();
    }
  }, [status.isFlying, status.isSpooling, status.isGroundRotorSpin, stopRotorSound]);

  useEffect(() => {
    function handleKeyDown(e) {
      const code = e.code;
      const c = controlRef.current;

      const handledCodes = [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "KeyI",
        "KeyJ",
        "KeyK",
        "KeyL",
        "Space",
      ];

      if (handledCodes.includes(code)) {
        e.preventDefault();
      }

      if (code === "KeyW") c.keys.up = true;
      if (code === "KeyS") c.keys.down = true;
      if (code === "KeyA") c.keys.turnLeft = true;
      if (code === "KeyD") c.keys.turnRight = true;

      if (code === "KeyI") c.keys.forward = true;
      if (code === "KeyK") c.keys.backward = true;
      if (code === "KeyJ") c.keys.left = true;
      if (code === "KeyL") c.keys.right = true;

      if (e.repeat) return;

      if (code === "Space") toggleTakeoffLand();
    }

    function handleKeyUp(e) {
      const code = e.code;
      const c = controlRef.current;

      if (code === "KeyW") c.keys.up = false;
      if (code === "KeyS") c.keys.down = false;
      if (code === "KeyA") c.keys.turnLeft = false;
      if (code === "KeyD") c.keys.turnRight = false;

      if (code === "KeyI") c.keys.forward = false;
      if (code === "KeyK") c.keys.backward = false;
      if (code === "KeyJ") c.keys.left = false;
      if (code === "KeyL") c.keys.right = false;
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [toggleTakeoffLand]);

  useEffect(() => {
    function isUiTarget(target) {
      return (
        target instanceof Element &&
        Boolean(target.closest("[data-ui-block='true']"))
      );
    }

    function handleWindowPointerDown(e) {
      if (isUiTarget(e.target)) return;
      isCameraDraggingRef.current = true;
      cameraDragPointerIdRef.current = e.pointerId;
      lastCameraDragXRef.current = e.clientX;
    }

    function handleWindowPointerMove(e) {
      if (!isCameraDraggingRef.current) return;
      if (
        cameraDragPointerIdRef.current !== null &&
        e.pointerId !== cameraDragPointerIdRef.current
      ) {
        return;
      }
      const deltaX = e.clientX - lastCameraDragXRef.current;
      lastCameraDragXRef.current = e.clientX;
      setFixedYawOffset((prev) => prev - deltaX * 0.006);
    }

    function stopCameraDrag(e) {
      if (
        cameraDragPointerIdRef.current !== null &&
        e.pointerId !== cameraDragPointerIdRef.current
      ) {
        return;
      }
      isCameraDraggingRef.current = false;
      cameraDragPointerIdRef.current = null;
    }

    window.addEventListener("pointerdown", handleWindowPointerDown, {
      passive: true,
    });
    window.addEventListener("pointermove", handleWindowPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerup", stopCameraDrag, { passive: true });
    window.addEventListener("pointercancel", stopCameraDrag, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", handleWindowPointerDown);
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", stopCameraDrag);
      window.removeEventListener("pointercancel", stopCameraDrag);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (crashTimerRef.current) clearTimeout(crashTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, []);

  return (
    <div
      className="w-full h-full min-h-0 relative flex flex-col"
      style={{ touchAction: "none", overscrollBehavior: "none" }}
    >
      <div
        data-ui-block="true"
        className="absolute left-3 top-3 z-30 w-[230px] bg-white/90 backdrop-blur border rounded-xl p-3 shadow-sm space-y-2"
      >
        <div className="text-xs font-semibold text-gray-700 text-center">
          단계 {stage} / {MAX_STAGE}
        </div>
        {stage >= 6 && (
          <div className="text-[11px] text-center font-semibold text-emerald-700 bg-emerald-50 rounded-md py-1">
            초시계: {elapsedSeconds.toFixed(2)}초 {isStopwatchRunning ? "(측정중)" : ""}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => setControlMode("normal")}
            className={`flex-1 px-2 py-1 rounded-lg font-semibold text-xs ${
              controlMode === "normal"
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-gray-800"
            }`}
          >
            기본조종
          </button>
          <button
            onClick={() => setControlMode("headless")}
            className={`flex-1 px-2 py-1 rounded-lg font-semibold text-xs ${
              controlMode === "headless"
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-gray-800"
            }`}
          >
            헤드리스조종
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setCameraMode("fixed")}
            className={`flex-1 px-2 py-1 rounded-lg font-semibold text-xs ${
              cameraMode === "fixed"
                ? "bg-teal-600 text-white"
                : "bg-gray-200 text-gray-800"
            }`}
          >
            고정시점
          </button>
          <button
            onClick={() => setCameraMode("drone")}
            className={`flex-1 px-2 py-1 rounded-lg font-semibold text-xs ${
              cameraMode === "drone"
                ? "bg-teal-600 text-white"
                : "bg-gray-200 text-gray-800"
            }`}
          >
            드론시점
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowGuide((prev) => !prev)}
            className="w-full px-2 py-1 bg-gray-500 text-white rounded-lg text-xs"
          >
            키보드 조종법
          </button>
        </div>

        {showGuide && (
          <div className="text-[10px] leading-4 text-gray-500 bg-white/70 rounded-lg p-2">
            왼쪽 스틱: 상승/하강 + 좌우 회전
            <br />
            오른쪽 스틱: 전진/후진 + 좌우 이동
            <br />
            키보드 조종법: WASD / IJKL, Space 이륙/착륙
          </div>
        )}
      </div>

      {/* TEMP DEBUG: 단계 점프 버튼 (배포 전 제거 예정) */}
      <div
        data-ui-block="true"
        className="absolute right-3 top-3 z-30 bg-white/90 backdrop-blur border rounded-xl p-2 shadow-sm"
      >
        <div className="text-[10px] text-gray-600 text-center mb-1">
          테스트 단계 이동
        </div>
        <div className="flex gap-1">
          {Array.from({ length: MAX_STAGE }).map((_, idx) => {
            const stageNumber = idx + 1;
            const isActive = stage === stageNumber;
            return (
              <button
                key={stageNumber}
                onClick={() => {
                  const nextLayout = getLayoutForStage(stageNumber);
                  setStage(stageNumber);
                  setTutorialStep(0);
                  setStageLayout(nextLayout);
                  resetStageOnly(nextLayout, stageNumber);
                }}
                className={`w-7 h-7 rounded-md text-xs font-semibold ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : completedStages.has(stageNumber)
                      ? "bg-green-600 text-white"
                      : "bg-gray-200 text-gray-800 hover:bg-gray-300"
                }`}
              >
                {stageNumber}
              </button>
            );
          })}
        </div>
      </div>

      {centerOverlayMessage && (
        <div
          className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-20 ${
            centerOverlayType === "crash" ? "top-[22.5%]" : "top-[23.5%]"
          }`}
        >
          <div
            className={`px-5 py-2 rounded-xl text-white text-sm font-bold shadow-lg ${
              centerOverlayType === "crash" ? "bg-rose-600/92" : "bg-emerald-600/90"
            }`}
          >
            {centerOverlayMessage}
          </div>
        </div>
      )}

      <ControlScene
        goalPosition={stageLayout.goalPosition}
        obstaclePositions={stageLayout.obstaclePositions}
        obstacleSize={stageLayout.obstacleSize}
        guidePath={stageLayout.guidePath}
        stage={gameplayStage}
        uiStage={stage}
        isTutorialStage={isTutorialStage}
        controlMode={controlMode}
        controlRef={controlRef}
        onCrashReset={handleCrashWithEffect}
        onWallCrash={handleWallCrashImmediate}
        onSuccess={handleStageSuccess}
        onTutorialLeftStickInput={handleTutorialLeftStickInput}
        onTutorialMoveInput={handleTutorialMoveInput}
        onTutorialLandingComplete={handleTutorialLandingComplete}
        cameraMode={cameraMode}
        status={status}
        fixedStartPosition={fixedStartPosition}
        fixedLookAt={fixedLookAt}
        fixedYawOffset={fixedYawOffset}
      />

      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[17%] z-20">
        <div className="px-4 py-2 rounded-xl bg-slate-900/85 text-white text-sm font-bold shadow-lg text-center">
          {stageTitle}
        </div>
      </div>

      {isTutorialStage && currentTutorialMessage && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[31%] z-20">
          <div className="px-4 py-2 rounded-xl bg-indigo-600/90 text-white text-sm font-semibold shadow-lg">
            {currentTutorialMessage}
          </div>
        </div>
      )}

      <div data-ui-block="true" className="fixed left-3 bottom-[236px] z-50 flex gap-2">
        <button
          onClick={toggleTakeoffLand}
          className={`px-6 py-3 rounded-lg font-semibold text-base shadow ${
            status.isFlying
              ? "bg-indigo-400 text-white"
              : "bg-indigo-600 text-white"
          }`}
        >
          {status.isFlying ? "착륙" : "이륙"}
        </button>
        <button
          onClick={resetStageOnly}
          className="px-6 py-3 rounded-lg font-semibold text-base shadow bg-gray-700 text-white"
        >
          리셋
        </button>
      </div>

      <div
        data-ui-block="true"
        className="fixed left-3 bottom-3 z-50 touch-none"
      >
        <VirtualJoystick
          label="회전 / 고도"
          accentClass="bg-purple-500"
          disabled={!status.isFlying}
          onChange={(value) => {
            controlRef.current.leftStick = {
              x: -value.x,
              y: value.y,
            };
          }}
        />
      </div>

      <div
        data-ui-block="true"
        className="fixed right-3 bottom-3 z-50 touch-none"
      >
        <VirtualJoystick
          label="이동"
          accentClass="bg-blue-500"
          disabled={!status.isFlying}
          onChange={(value) => {
            controlRef.current.rightStick = {
              x: value.x,
              y: value.y,
            };
          }}
        />
      </div>
    </div>
  );
}

/* =========================
   메인
========================= */

function MainMenuDrone() {
  const groupRef = useRef(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.position.y = 1.35 + Math.sin(t * 1.9) * 0.16;
    groupRef.current.rotation.y = t * 0.35;
  });

  return (
    <group ref={groupRef}>
      <DroneVisual spinActive spinSpeed={30} />
    </group>
  );
}

function MainMenu({ onSelectMode }) {
  return (
    <div className="w-full h-full relative bg-slate-100 overflow-hidden">
      <Canvas className="w-full h-full" camera={{ position: [0, 3.1, 8.2], fov: 56 }} dpr={[1, 1.5]}>
        <ambientLight intensity={0.78} />
        <directionalLight position={[5, 11, 5]} intensity={1.05} />
        <Grid
          infiniteGrid
          cellSize={0.6}
          cellThickness={0.8}
          sectionSize={3}
          sectionThickness={1.2}
          fadeDistance={35}
          fadeStrength={1.2}
          cellColor="#94a3b8"
          sectionColor="#64748b"
          position={[0, -0.16, 0]}
        />
        <MainMenuDrone />
      </Canvas>

      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[15%] z-20">
        <div className="text-5xl md:text-6xl font-black tracking-tight text-slate-900 drop-shadow-sm">
          드론을 배워 봅시다
        </div>
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 top-[66%] z-20 flex gap-4">
        <button
          onClick={() => onSelectMode("control")}
          className="px-8 py-3 rounded-xl bg-blue-600 text-white text-lg font-bold shadow-lg hover:bg-blue-500 active:translate-y-[1px]"
        >
          조종모드
        </button>
        <button
          onClick={() => onSelectMode("coding")}
          className="px-8 py-3 rounded-xl bg-indigo-600 text-white text-lg font-bold shadow-lg hover:bg-indigo-500 active:translate-y-[1px]"
        >
          코딩모드
        </button>
      </div>

      <div className="absolute right-4 bottom-3 z-20 text-sm text-slate-700 font-semibold">
        제작자 나규현, 도구 cursor
      </div>
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState("home");

  return (
    <div className="w-screen h-[100dvh] overflow-hidden relative flex flex-col bg-gray-100">
      {mode !== "home" && (
        <div className="absolute right-3 top-20 z-40 flex gap-2 bg-white/90 backdrop-blur border rounded-xl p-2 shadow-sm">
          <button
            onClick={() => setMode("home")}
            className="px-3 py-1 rounded-lg font-semibold text-sm bg-gray-200 text-gray-800"
          >
            메인
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {mode === "home" ? (
          <MainMenu onSelectMode={setMode} />
        ) : mode === "control" ? (
          <ControlMode />
        ) : (
          <CodingMode
            CodingScene={CodingScene}
            checkBoxHit={checkBoxHit}
            getDirectionLabel={getDirectionLabel}
          />
        )}
      </div>
    </div>
  );
}