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

const CODING_CAMERA_ORBIT_YAW_SENSITIVITY = 0.0025;
const CODING_CAMERA_ORBIT_PITCH_SENSITIVITY = 0.0018;
const CONTROL_CAMERA_ORBIT_YAW_SENSITIVITY = 0.0014;
const CONTROL_CAMERA_ORBIT_PITCH_SENSITIVITY = 0.001;
const CONTROL_CAMERA_PINCH_PAN_SENSITIVITY = 0.006;
const CAMERA_ORBIT_PITCH_MIN = -0.85;
const CAMERA_ORBIT_PITCH_MAX = 0.35;

function applyOrbitDragToSetters(
  deltaX,
  deltaY,
  pointerType,
  setYaw,
  setPitch,
  yawSensitivity = CODING_CAMERA_ORBIT_YAW_SENSITIVITY,
  pitchSensitivity = CODING_CAMERA_ORBIT_PITCH_SENSITIVITY
) {
  const dragX = pointerType === "touch" ? -deltaX : deltaX;
  const dragY = pointerType === "touch" ? -deltaY : deltaY;
  setYaw((prev) => prev - dragX * yawSensitivity);
  setPitch((prev) =>
    clamp(
      prev - dragY * pitchSensitivity,
      CAMERA_ORBIT_PITCH_MIN,
      CAMERA_ORBIT_PITCH_MAX
    )
  );
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

function getDroneCollisionSamplePoints(position, rotation) {
  const cx = position[0];
  const cz = position[2];
  const forwardX = -Math.sin(rotation);
  const forwardZ = -Math.cos(rotation);
  const rightX = Math.cos(rotation);
  const rightZ = -Math.sin(rotation);
  const halfLength = 0.5;
  const halfWidth = 0.5;

  const project = (f, r) => [cx + forwardX * f + rightX * r, position[1], cz + forwardZ * f + rightZ * r];

  return [
    [cx, position[1], cz], // center
    project(halfLength, 0), // front
    project(-halfLength, 0), // back
    project(0, halfWidth), // right
    project(0, -halfWidth), // left
    project(halfLength, halfWidth), // front-right
    project(halfLength, -halfWidth), // front-left
    project(-halfLength, halfWidth), // back-right
    project(-halfLength, -halfWidth), // back-left
  ];
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

// =========================
// Grid pathfinding (4-dir) with turn constraint
// =========================
class MinHeap {
  constructor() {
    this.arr = [];
  }

  push(item) {
    this.arr.push(item);
    this.bubbleUp(this.arr.length - 1);
  }

  bubbleUp(i) {
    const arr = this.arr;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (arr[p].f <= arr[i].f) break;
      const tmp = arr[p];
      arr[p] = arr[i];
      arr[i] = tmp;
      i = p;
    }
  }

  pop() {
    const arr = this.arr;
    if (arr.length === 0) return null;
    const top = arr[0];
    const last = arr.pop();
    if (arr.length > 0) {
      arr[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  sinkDown(i) {
    const arr = this.arr;
    const n = arr.length;
    while (true) {
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      let smallest = i;
      if (l < n && arr[l].f < arr[smallest].f) smallest = l;
      if (r < n && arr[r].f < arr[smallest].f) smallest = r;
      if (smallest === i) break;
      const tmp = arr[i];
      arr[i] = arr[smallest];
      arr[smallest] = tmp;
      i = smallest;
    }
  }

  get size() {
    return this.arr.length;
  }
}

function worldToCellIndex(worldCoord, minWorld, cellSize) {
  // cell center = minWorld + (i + 0.5) * cellSize
  // i = (world - minWorld) / cellSize - 0.5
  // For stamping we care which cell contains the world point, so use floor.
  // This avoids off-by-one errors that make the start cap appear uncolored.
  return Math.floor((worldCoord - minWorld) / cellSize);
}

function computeGridPathCells4DirTurnAStar({
  gridMinX,
  gridMinZ,
  cellSize,
  cols,
  rows,
  startWorld,
  goalWorld,
  desiredBends, // 0~2 for our map; exact target if possible
  allowFewerBends = true,
  blockedMask = null, // Uint8Array size cols*rows, 1 means blocked
}) {
  const unknownDir = 4;
  const dirCount = 5; // 0..3 normal, 4 = unknown
  const maxBends = desiredBends;

  const startX = clamp(worldToCellIndex(startWorld[0], gridMinX, cellSize), 0, cols - 1);
  const startZ = clamp(worldToCellIndex(startWorld[2], gridMinZ, cellSize), 0, rows - 1);
  const goalX = clamp(worldToCellIndex(goalWorld[0], gridMinX, cellSize), 0, cols - 1);
  const goalZ = clamp(worldToCellIndex(goalWorld[2], gridMinZ, cellSize), 0, rows - 1);

  const goalCellId = goalZ * cols + goalX;
  const startCellId = startZ * cols + startX;

  const turnsCount = maxBends + 1; // includes 0..maxBends
  const stateCount = cols * rows * dirCount * turnsCount;

  const dist = new Float64Array(stateCount);
  dist.fill(Infinity);

  const parent = new Int32Array(stateCount);
  parent.fill(-1);

  const stateId = (cellId, dir, turns) => ((cellId * dirCount + dir) * turnsCount + turns);

  const startState = stateId(startCellId, unknownDir, 0);
  dist[startState] = 0;

  const heap = new MinHeap();

  const manhattan = (x, z) => Math.abs(x - goalX) + Math.abs(z - goalZ);
  heap.push({ f: manhattan(startX, startZ), g: 0, cellId: startCellId, dir: unknownDir, turns: 0 });

  const dirs = [
    [1, 0], // +X
    [-1, 0], // -X
    [0, 1], // +Z
    [0, -1], // -Z
  ];

  let bestGoalState = -1;
  let bestGoalG = Infinity;

  while (heap.size > 0) {
    const cur = heap.pop();
    const { cellId, dir, turns, g } = cur;

    const cid = stateId(cellId, dir, turns);
    if (g !== dist[cid]) continue;

    const x = cellId % cols;
    const z = (cellId / cols) | 0;

    if (cellId === goalCellId && turns === desiredBends) {
      // Because A* with admissible heuristic: first time we pop goal with exact turns is optimal.
      bestGoalState = cid;
      bestGoalG = g;
      break;
    }

    for (let ndir = 0; ndir < 4; ndir += 1) {
      const [dx, dz] = dirs[ndir];
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue;
      const nCellId = nz * cols + nx;
      if (blockedMask && blockedMask[nCellId] === 1) continue;

      const addTurn = dir !== unknownDir && ndir !== dir ? 1 : 0;
      const nTurns = turns + addTurn;
      if (nTurns > maxBends) continue;

      const ng = g + 1;
      const nid = stateId(nCellId, ndir, nTurns);
      if (ng >= dist[nid]) continue;

      dist[nid] = ng;
      parent[nid] = cid;
      const nf = ng + manhattan(nx, nz);
      heap.push({ f: nf, g: ng, cellId: nCellId, dir: ndir, turns: nTurns });
    }
  }

  // Fallback: if exact turns not found, optionally take the closest goal among <= desiredBends
  if (bestGoalState < 0 && allowFewerBends) {
    for (let t = 0; t <= desiredBends; t += 1) {
      let best = -1;
      let bestG = Infinity;
      for (let d = 0; d < 4; d += 1) {
        const sid = stateId(goalCellId, d, t);
        if (dist[sid] < bestG) {
          bestG = dist[sid];
          best = sid;
        }
      }
      if (best >= 0 && bestG < Infinity) {
        bestGoalState = best;
        bestGoalG = bestG;
        break;
      }
    }
  }

  if (bestGoalState < 0) return [];

  // Reconstruct path of cellIds
  const pathCellIds = [];
  let cur = bestGoalState;
  while (cur >= 0) {
    pathCellIds.push(cur);
    const p = parent[cur];
    if (p < 0) break;
    cur = p;
  }

  pathCellIds.reverse();

  // Convert stateId => cellId (cellId is stored in the highest portion)
  // stateId = ((cellId * dirCount + dir) * turnsCount + turns)
  // => cellId = Math.floor(stateId / (dirCount * turnsCount))
  const cellIdDiv = dirCount * turnsCount;
  const cells = pathCellIds.map((sid) => {
    const cellId = Math.floor(sid / cellIdDiv);
    return { x: cellId % cols, z: (cellId / cols) | 0 };
  });

  return cells;
}

function isInsideGuideFloorXZ(point, guidePath, goalPosition, stage) {
  const points = guidePath?.points ?? [];
  const width = guidePath?.width ?? 0;
  if (points.length < 2 || width <= 0) return false;

  const px = point[0];
  const pz = point[2];

  // If a precomputed grid safe mask exists, always use it.
  // (gameplay stage 7+ uses grid safe mask; UI 15~25 maps to gameplay 7~17.)
  const meta = guidePath?.__gridMeta;
  const mask = guidePath?.__gridSafeMask;
  if (meta && mask) {
    const { minX, minZ, cell, cols, rows } = meta;
    const cx = Math.floor((px - minX) / cell);
    const cz = Math.floor((pz - minZ) / cell);
    if (cx < 0 || cx >= cols || cz < 0 || cz >= rows) return false;
    return mask[cz * cols + cx] === 1;
  }

  // For stages 12~15 use tighter collision width to avoid delayed wall hit.
  const halfVisualWidth =
    stage >= 7
      ? Math.max(0.05, width * 0.5 - (stage <= 8 ? 0.04 : 0.1))
      : (width + 0.02) * 0.5;
  const edgeTolerance = stage >= 7 ? 0 : 0.02;

  const inRect = (cx, cz, w, d) =>
    Math.abs(px - cx) <= w * 0.5 + edgeTolerance &&
    Math.abs(pz - cz) <= d * 0.5 + edgeTolerance;
  const inDisk = (cx, cz, radius) => {
    const dx = px - cx;
    const dz = pz - cz;
    return dx * dx + dz * dz <= (radius + edgeTolerance) * (radius + edgeTolerance);
  };

  // Segment floor strips
  for (let i = 0; i < points.length - 1; i += 1) {
    if (pointToSegmentDistanceXZ(point, points[i], points[i + 1]) <= halfVisualWidth + edgeTolerance) {
      return true;
    }
  }

  // Corner fill squares
  for (let i = 1; i < points.length - 1; i += 1) {
    if (inRect(points[i][0], points[i][2], width + 0.02, width + 0.02)) return true;
  }

  // World center safe patch (same as GroundGuidePath fill rules)
  if (stage >= 7 && (inRect(0, 0, 3.2, 3.2) || inDisk(0, 0, 1.75))) return true;

  // Start/end widened patches are used for floor visuals, but on 12~15 they make
  // wall collision too late. Keep them for lower stages only.
  if (stage >= 7) {
    return false;
  }

  // Start patch
  const start = points[0];
  if (start) {
    if (inDisk(start[0], start[2], Math.max(width * 0.72, 0.95))) return true;
    if (inRect(start[0], start[2], Math.max(3.0, width * 1.8), Math.max(3.0, width * 1.8))) return true;
  }

  // End patch
  const end = goalPosition ?? points[points.length - 1];
  if (end) {
    if (inDisk(end[0], end[2], Math.max(width * 0.62, 1.05))) return true;
    if (inRect(end[0], end[2], Math.max(width * 0.95, 2.2), Math.max(width * 0.95, 2.2))) return true;
  }

  return false;
}

function buildBentGuidePath(startPosition, goal, stage) {
  // 7~10 단계 경로는 코너 수를 제한해 가독성을 높임(과도한 반복 꺾임 방지)
  const sx = startPosition[0];
  const sz = startPosition[2];
  const gx = goal[0];
  const gz = goal[2];
  const absDx = Math.abs(gx - sx);
  const absDz = Math.abs(gz - sz);
  const xBetween = (a, b, t) => a + (b - a) * t;
  const zBetween = (a, b, t) => a + (b - a) * t;

  let knots;
  if (stage <= 8) {
    // 12~13(UI): 90도 1회 회전, 맨해튼 최단 경로(L자)
    // 더 긴 축을 먼저 이동해 시작 안정성과 가독성을 높임.
    if (absDx >= absDz) {
      knots = [
        [sx, 0.03, sz],
        [gx, 0.03, sz],
        [gx, 0.03, gz],
      ];
    } else {
      knots = [
        [sx, 0.03, sz],
        [sx, 0.03, gz],
        [gx, 0.03, gz],
      ];
    }
  } else {
    // 14~15(UI): 90도 2회 회전, 맨해튼 최단 경로(역방향 없이 축 분할)
    // X 우선(X-Z-X) 또는 Z 우선(Z-X-Z)로 한 축을 두 구간으로 나눔.
    // 단계별로 분할 비율을 다르게 둬 난이도를 조정:
    // - stage 9(UI 14): 초반 구간을 짧게, 중간 직선 구간을 길게(비교적 쉬움)
    // - stage 10(UI 15): 초반 구간을 길게, 후반 정렬 구간을 짧게(조금 더 까다로움)
    const splitRatio = stage >= 10 ? 0.62 : 0.38;
    if (absDx >= absDz) {
      const splitX = xBetween(sx, gx, splitRatio);
      knots = [
        [sx, 0.03, sz],
        [splitX, 0.03, sz],
        [splitX, 0.03, gz],
        [gx, 0.03, gz],
      ];
    } else {
      const splitZ = zBetween(sz, gz, splitRatio);
      knots = [
        [sx, 0.03, sz],
        [sx, 0.03, splitZ],
        [gx, 0.03, splitZ],
        [gx, 0.03, gz],
      ];
    }
  }

  // 단계가 올라갈수록 조금씩 좁아지되, 이전보다 넓게 시작
  const widthByStage = {
    7: 3.2,
    8: 2.8,
    9: 2.4,
    10: 2.1,
    11: 2.0,
    12: 1.9,
    13: 1.8,
    14: 1.7,
    15: 1.65,
    16: 1.6,
    17: 1.55,
  };

  return {
    width: widthByStage[stage] ?? 1.7,
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

function buildGridSafeMask(guidePath, gridPathCells, meta) {
  if (!meta || !Array.isArray(gridPathCells) || gridPathCells.length < 2) return null;
  const { minX: gridMinX, minZ: gridMinZ, cell: gridCell, cols, rows } = meta;
  const mask = new Uint8Array(cols * rows);
  const rCells = Math.max(
    1,
    Math.ceil(((guidePath?.width ?? 2.1) * 0.5 + 0.22 * gridCell) / gridCell)
  );
  const idx = (x, z) => z * cols + x;
  const stampRect = (x0, x1, z0, z1) => {
    const xx0 = Math.max(0, Math.min(x0, x1));
    const xx1 = Math.min(cols - 1, Math.max(x0, x1));
    const zz0 = Math.max(0, Math.min(z0, z1));
    const zz1 = Math.min(rows - 1, Math.max(z0, z1));
    for (let zz = zz0; zz <= zz1; zz += 1) {
      for (let xx = xx0; xx <= xx1; xx += 1) mask[idx(xx, zz)] = 1;
    }
  };
  const stampSquare = (cx, cz) => stampRect(cx - rCells, cx + rCells, cz - rCells, cz + rCells);
  const dirBetween = (a, b) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx === 1 && dz === 0) return 0;
    if (dx === -1 && dz === 0) return 1;
    if (dx === 0 && dz === 1) return 2;
    if (dx === 0 && dz === -1) return 3;
    return -1;
  };
  const stampSegment = (a, b, dir) => {
    if (dir === 0 || dir === 1) {
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const z = a.z;
      stampRect(x0 - rCells, x1 + rCells, z - rCells, z + rCells);
    } else if (dir === 2 || dir === 3) {
      const z0 = Math.min(a.z, b.z);
      const z1 = Math.max(a.z, b.z);
      const x = a.x;
      stampRect(x - rCells, x + rCells, z0 - rCells, z1 + rCells);
    }
  };

  stampSquare(gridPathCells[0].x, gridPathCells[0].z);
  stampSquare(gridPathCells[gridPathCells.length - 1].x, gridPathCells[gridPathCells.length - 1].z);
  for (let k = 1; k < gridPathCells.length - 1; k += 1) {
    const d1 = dirBetween(gridPathCells[k - 1], gridPathCells[k]);
    const d2 = dirBetween(gridPathCells[k], gridPathCells[k + 1]);
    if (d1 >= 0 && d2 >= 0 && d1 !== d2) stampSquare(gridPathCells[k].x, gridPathCells[k].z);
  }
  let k = 0;
  while (k < gridPathCells.length - 1) {
    const d = dirBetween(gridPathCells[k], gridPathCells[k + 1]);
    let j = k + 1;
    while (j < gridPathCells.length - 1) {
      const dn = dirBetween(gridPathCells[j], gridPathCells[j + 1]);
      if (dn !== d) break;
      j += 1;
    }
    if (d >= 0) stampSegment(gridPathCells[k], gridPathCells[j], d);
    else stampSquare(gridPathCells[k].x, gridPathCells[k].z);
    k = j;
  }

  return mask;
}

function generateStageLayout(stage, startPosition) {
  const obstacleCount = getObstacleCountByStage(stage);
  const obstacleSize = getObstacleSizeByStage(stage);
  const obstacleAreaExtraByStage = {
    4: 0.45, // UI 9단계
    6: 0.65, // UI 11단계
  };
  const obstacleAreaExtra = obstacleAreaExtraByStage[stage] ?? 0;
  const effectiveObstacleSize = obstacleSize + obstacleAreaExtra;
  const goalRadius = getStageGoalRadius(stage);
  const goalObstacleClearance = goalRadius + effectiveObstacleSize * 0.9 + 0.8;
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
    // 15~25단계(게임플레이 7~17):
    // - 시작 후 곧바로 벽에 붙지 않도록 첫 직선 구간을 충분히 확보
    // - 코너 직후 즉시 착륙하지 않도록 마지막 직선 구간 길이도 확보
    const snap = 0.2;
    const minFirstLegLengthByStage = {
      11: 3.7,
      12: 4.0,
      13: 4.4,
      14: 4.8,
      15: 4.6,
      16: 4.7,
      17: 4.9,
    };
    const minFinalLegLengthByStage = {
      11: 3.2,
      12: 3.5,
      13: 3.9,
      14: 4.2,
      15: 4.0,
      16: 4.1,
      17: 4.3,
    };
    const minFirstLegLength =
      minFirstLegLengthByStage[stage] ?? (stage >= 9 ? 3.2 : 2.6);
    const minFinalLegLength =
      minFinalLegLengthByStage[stage] ?? (stage >= 9 ? 2.7 : 2.2);
    let guidePath = null;
    let goalTry = 0;

    const analyzeGridPath = (path) => {
      if (!path || path.length < 2) return { bends: 0, segLens: [] };
      const dirBetween = (a, b) => {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        if (dx === 1 && dz === 0) return 0;
        if (dx === -1 && dz === 0) return 1;
        if (dx === 0 && dz === 1) return 2;
        if (dx === 0 && dz === -1) return 3;
        return -1;
      };
      let bends = 0;
      const segLens = [];
      let curLen = 1;
      let curDir = dirBetween(path[0], path[1]);
      for (let i = 1; i < path.length; i += 1) {
        if (i === path.length - 1) {
          curLen += 0;
          break;
        }
        const nd = dirBetween(path[i], path[i + 1]);
        if (nd === curDir) {
          curLen += 1;
        } else {
          segLens.push(curLen);
          bends += curDir >= 0 && nd >= 0 ? 1 : 0;
          curDir = nd;
          curLen = 1;
        }
      }
      segLens.push(curLen);
      return { bends, segLens };
    };

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

      // Compute final landing point (goal) first (inset along last segment).
      let landingGoal = snappedGoal;
      const endPoint = points[points.length - 1];
      const beforeEndPoint = points[points.length - 2];
      if (endPoint) {
        if (stage >= 12 && beforeEndPoint) {
          const dx = endPoint[0] - beforeEndPoint[0];
          const dz = endPoint[2] - beforeEndPoint[2];
          const len = Math.hypot(dx, dz);
          if (len > 1e-6) {
            const landingRadius = getStageGoalRadius(stage) * 0.72;
            const minInset = landingRadius + 0.42;
            const maxInset = Math.max(0.18, len - 0.22);
            const inset = Math.min(maxInset, Math.max(minInset, len * 0.2));
            landingGoal = [endPoint[0] - (dx / len) * inset, goalY, endPoint[2] - (dz / len) * inset];
          } else {
            landingGoal = [endPoint[0], goalY, endPoint[2]];
          }
        } else {
          landingGoal = [endPoint[0], goalY, endPoint[2]];
        }
      }

      // Pathfinding grid must include both start and goal.
      const gridCell = 0.1;
      const gridMargin = 0.8;
      const gridMinX =
        Math.floor((Math.min(stageGoalConfig.xMin, startPosition[0], landingGoal[0]) - gridMargin) / gridCell) *
        gridCell;
      const gridMaxX =
        Math.ceil((Math.max(stageGoalConfig.xMax, startPosition[0], landingGoal[0]) + gridMargin) / gridCell) *
        gridCell;
      const gridMinZ =
        Math.floor((Math.min(stageGoalConfig.zMin, startPosition[2], landingGoal[2]) - gridMargin) / gridCell) *
        gridCell;
      const gridMaxZ =
        Math.ceil((Math.max(stageGoalConfig.zMax, startPosition[2], landingGoal[2]) + gridMargin) / gridCell) *
        gridCell;
      const cols = Math.max(1, Math.ceil((gridMaxX - gridMinX) / gridCell));
      const rows = Math.max(1, Math.ceil((gridMaxZ - gridMinZ) / gridCell));

      // internal stage: 7~8 => UI 15~16 (1 bend), 9+ => UI 17+ (2 bends)
      const desiredBends = stage >= 9 ? 2 : 1;
      const gridPathCells = computeGridPathCells4DirTurnAStar({
        gridMinX,
        gridMinZ,
        cellSize: gridCell,
        cols,
        rows,
        startWorld: startPosition,
        goalWorld: landingGoal,
        desiredBends,
        allowFewerBends: stage < 9, // 17단계(UI)부터는 반드시 2번 꺾임 유지
        blockedMask: null,
      });

      if (!gridPathCells || gridPathCells.length < 2) continue;
      const analysis = analyzeGridPath(gridPathCells);
      if (analysis.bends !== desiredBends) continue;

      // 단계가 올라갈수록 코너 전/후 직선 구간을 길게 강제해 난이도 상승.
      if (desiredBends === 2) {
        const minSegCellsByStage = {
          10: 10,
          11: 12,
          12: 13,
          13: 14,
          14: 15,
          15: 14,
          16: 14,
          17: 15,
        };
        const minSegCells = minSegCellsByStage[stage] ?? (stage >= 10 ? 10 : 8);
        if (analysis.segLens.some((len) => len < minSegCells)) continue;
      }

      goal = landingGoal;
      guidePath = candidatePath;
      // attach grid info for rendering/stamping
      guidePath.__gridMeta = { minX: gridMinX, minZ: gridMinZ, cell: gridCell, cols, rows };
      guidePath.__gridPathCells = gridPathCells;

      guidePath.__gridSafeMask = buildGridSafeMask(
        guidePath,
        gridPathCells,
        guidePath.__gridMeta
      );
      break;
    }

    if (!guidePath) {
      goal = [
        Math.round(goal[0] / snap) * snap,
        goalY,
        Math.round(goal[2] / snap) * snap,
      ];
      guidePath = buildBentGuidePath(startPosition, goal, stage);
      // If we fell back, we still need a grid path/meta for rendering; keep it permissive.
      const gridCell = 0.1;
      const gridMargin = 0.8;
      const gridMinX =
        Math.floor((Math.min(stageGoalConfig.xMin, startPosition[0], goal[0]) - gridMargin) / gridCell) *
        gridCell;
      const gridMaxX =
        Math.ceil((Math.max(stageGoalConfig.xMax, startPosition[0], goal[0]) + gridMargin) / gridCell) *
        gridCell;
      const gridMinZ =
        Math.floor((Math.min(stageGoalConfig.zMin, startPosition[2], goal[2]) - gridMargin) / gridCell) *
        gridCell;
      const gridMaxZ =
        Math.ceil((Math.max(stageGoalConfig.zMax, startPosition[2], goal[2]) + gridMargin) / gridCell) *
        gridCell;
      const cols = Math.max(1, Math.ceil((gridMaxX - gridMinX) / gridCell));
      const rows = Math.max(1, Math.ceil((gridMaxZ - gridMinZ) / gridCell));
      const desiredBends = stage >= 9 ? 2 : 1;
      const gridPathCells = computeGridPathCells4DirTurnAStar({
        gridMinX,
        gridMinZ,
        cellSize: gridCell,
        cols,
        rows,
        startWorld: startPosition,
        goalWorld: goal,
        desiredBends,
        allowFewerBends: true,
        blockedMask: null,
      });
      guidePath.__gridMeta = { minX: gridMinX, minZ: gridMinZ, cell: gridCell, cols, rows };
      guidePath.__gridPathCells = gridPathCells;
      guidePath.__gridSafeMask = buildGridSafeMask(
        guidePath,
        gridPathCells,
        guidePath.__gridMeta
      );
    }
    return {
      goalPosition: goal,
      obstaclePositions: [],
      obstacleSize,
      guidePath,
      gridMeta: guidePath?.__gridMeta ?? null,
      gridPathCells: guidePath?.__gridPathCells ?? null,
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

  // Stage 9~11 (UI) == gameplay stage 4~6: keep obstacles apart by drone width.
  // Min center distance = obstacleSize + (droneWidth * multiplier).
  const droneWidth = 1.0;
  const minGapMultiplierByStage = stage === 4 ? 2.5 : stage === 5 ? 2.0 : stage === 6 ? 1.5 : 0;
  const areaSpacingBoost = obstacleAreaExtra > 0 ? obstacleAreaExtra * 1.4 : 0;
  const minObstacleCenterDist =
    minGapMultiplierByStage > 0
      ? effectiveObstacleSize + droneWidth * minGapMultiplierByStage + areaSpacingBoost
      : effectiveObstacleSize * 1.85;

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
      if (distanceXZ(candidate, obstacles[i]) < minObstacleCenterDist) {
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
        (p) => distanceXZ(candidate, p) < minObstacleCenterDist
      );
      const tooCloseFallback = fallback.some(
        (p) => distanceXZ(candidate, p) < minObstacleCenterDist
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
        (p) => distanceXZ(candidate, p) < minObstacleCenterDist
      );
      if (!tooClose) obstacles.push(candidate);
    }
  }

  // UI 6~11단계(gameplay stage 1~6): restrict movement to a rectangle that contains
  // start position + goal + all obstacles, to encourage passing between obstacles.
  let movementRect = null;
  if (stage >= 1 && stage <= 6 && obstacles.length > 0) {
    let minX = Math.min(startPosition[0], goal[0], ...obstacles.map((o) => o[0]));
    let maxX = Math.max(startPosition[0], goal[0], ...obstacles.map((o) => o[0]));
    let minZ = Math.min(startPosition[2], goal[2], ...obstacles.map((o) => o[2]));
    let maxZ = Math.max(startPosition[2], goal[2], ...obstacles.map((o) => o[2]));
    // 6~8단계는 더 타이트하게, 9~11단계는 기존 대비 약간 타이트하게.
    const marginBase = stage <= 3 ? 0.45 : 0.75;
    const margin = effectiveObstacleSize * 0.55 + marginBase;
    minX -= margin;
    maxX += margin;
    minZ -= margin;
    maxZ += margin;
    movementRect = { minX, maxX, minZ, maxZ };
  }

  return {
    goalPosition: goal,
    obstaclePositions: obstacles,
    obstacleSize: effectiveObstacleSize,
    guidePath: null,
    movementRect,
  };
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

function ControlYellowFloor({ uiStage }) {
  // 1~11 단계: 전체 바닥을 노랑 계열로 반투명 표시
  if (uiStage > 11) return null;
  // UI 6~11단계는 이동 가능 영역을 직사각형으로 제한하므로, 전체 바닥 표시를 끈다.
  if (uiStage >= 6 && uiStage <= 11) return null;
  const size = uiStage <= 6 ? 26 : 34;
  return (
    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color="#f59e0b" transparent opacity={0.24} depthWrite={false} />
    </mesh>
  );
}

function MovementRectFloor({ movementRect }) {
  if (!movementRect) return null;
  const width = Math.max(0.1, movementRect.maxX - movementRect.minX);
  const depth = Math.max(0.1, movementRect.maxZ - movementRect.minZ);
  const cx = (movementRect.minX + movementRect.maxX) / 2;
  const cz = (movementRect.minZ + movementRect.maxZ) / 2;
  return (
    <mesh position={[cx, 0.02, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial color="#fbbf24" transparent opacity={0.38} depthWrite={false} />
    </mesh>
  );
}

function Goal({ position, stage, uiStage }) {
  const goalLabel = uiStage >= 15 ? "착륙 지점" : "목표물";
  const showGoalLabel = uiStage >= 6 && uiStage <= 25;
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
  const landingRadius = uiStage >= 15 ? radius * 0.72 : radius * 0.82;
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
  const showObstacleLabel = uiStage >= 6 && uiStage <= 14;

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

function DroneVisual({
  spinActive = true,
  spinSpeed = 34,
  spinStateRef = null,
  sizeScale = 0.82,
  lockLateralTilt = false,
}) {
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
      // Reflect both joystick and keyboard movement in wing tilt.
      const keyX =
        (spinStateRef.current.keys?.left ? -1 : 0) +
        (spinStateRef.current.keys?.right ? 1 : 0);
      const keyY =
        (spinStateRef.current.keys?.forward ? -1 : 0) +
        (spinStateRef.current.keys?.backward ? 1 : 0);
      const sx = lockLateralTilt
        ? 0
        : clamp((spinStateRef.current.rightStick?.x ?? 0) + keyX, -1, 1);
      const sy = clamp((spinStateRef.current.rightStick?.y ?? 0) + keyY, -1, 1);
      const targetPitch = sy * 0.29;
      const targetRoll = -sx * 0.25;
      wingTiltRef.current.rotation.x += (targetPitch - wingTiltRef.current.rotation.x) * 0.22;
      wingTiltRef.current.rotation.z += (targetRoll - wingTiltRef.current.rotation.z) * 0.22;
    }
  });

  return (
    <group scale={[sizeScale, sizeScale, sizeScale]}>
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

const GroundGuidePath = memo(function GroundGuidePath({
  guidePath,
  goalPosition = null,
  stage,
  gridMeta = null,
  gridPathCells = null,
}) {
  const points = useMemo(() => guidePath?.points ?? [], [guidePath]);
  const width = guidePath?.width ?? 0;
  if (points.length < 2 || width <= 0) return null;

  const floorThickness = 0.03;
  const wallThickness = 0.08;
  const wallHeight = 18;
  // gameplay stage 7+ : grid mask 기반 바닥/벽 (UI 15~25 포함)
  const useGridMask =
    stage >= 7 &&
    gridMeta &&
    gridPathCells &&
    Array.isArray(gridPathCells) &&
    gridMeta.cols &&
    gridMeta.rows;
  const cell = useGridMask ? (gridMeta?.cell ?? 0.1) : stage >= 7 ? 0.14 : 0.1;
  const rasterPadding = stage >= 7 ? cell * 0.22 : cell * 0.12;
  const wallOuterOffset = wallThickness * 0.5 + 0.08;
  const centerSafeRadius = 1.75;
  const centerSafeSize = 3.2;

  // 벽은 "바닥으로 실제 칠해진 영역"의 외곽선에서 생성
  // stage>=12에서는 gridMeta로부터 그리드를 고정(경로 마스크와 정렬)
  let minX;
  let minZ;
  let cols;
  let rows;
  if (useGridMask) {
    minX = gridMeta.minX;
    minZ = gridMeta.minZ;
    cols = gridMeta.cols;
    rows = gridMeta.rows;
  } else {
    let maxX = -Infinity;
    let maxZ = -Infinity;
    minX = Infinity;
    minZ = Infinity;
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
    // Snap bounds to cell grid to reduce directional raster bias near endpoints.
    minX = Math.floor(minX / cell) * cell;
    maxX = Math.ceil(maxX / cell) * cell;
    minZ = Math.floor(minZ / cell) * cell;
    maxZ = Math.ceil(maxZ / cell) * cell;
    cols = Math.max(1, Math.ceil((maxX - minX) / cell));
    rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  }

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
        if (Math.abs(lx) <= hw + rasterPadding && Math.abs(lz) <= hd + rasterPadding) {
          fillGrid[idx(cxi, rz)] = 1;
        }
      }
    }
  };
  const markDisk = (cx, cz, radius) => {
    const padded = radius + rasterPadding;
    const c0 = Math.max(0, Math.floor((cx - radius - minX) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((cx + radius - minX) / cell));
    const r0 = Math.max(0, Math.floor((cz - radius - minZ) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((cz + radius - minZ) / cell));
    const r2 = padded * padded;
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

  if (stage >= 7) {
    if (useGridMask) {
      let mask = guidePath?.__gridSafeMask;
      if ((!mask || mask.length !== fillGrid.length) && gridMeta) {
        mask = buildGridSafeMask(guidePath, gridPathCells, gridMeta);
        if (guidePath && mask) guidePath.__gridSafeMask = mask;
      }
      if (mask && mask.length === fillGrid.length) {
        fillGrid.set(mask);
      }
    } else {
      // fallback: no gridPathCells => keep previous guidePath-based stamping
      const halfVisualWidth =
        stage >= 7 ? Math.max(0.05, width * 0.5 - (stage <= 8 ? 0.04 : 0.1)) : (width + 0.02) * 0.5;
      const edgePad = rasterPadding * 0.6;
      const tHalf = halfVisualWidth + edgePad;
      const brushHalf = tHalf * 1.02;
      const landingPoint =
        goalPosition && Array.isArray(goalPosition) ? goalPosition : points[points.length - 1];
      const startPoint = points[0];

      const rangeForCenters = (wMin, wMax, origin, count) => {
        const i0 = Math.ceil((wMin - origin) / cell - 0.5);
        const i1 = Math.floor((wMax - origin) / cell - 0.5);
        return [Math.max(0, i0), Math.min(count - 1, i1)];
      };

      const fillRect = (x0, x1, z0, z1) => {
        const [c0, c1] = rangeForCenters(Math.min(x0, x1), Math.max(x0, x1), minX, cols);
        const [r0, r1] = rangeForCenters(Math.min(z0, z1), Math.max(z0, z1), minZ, rows);
        if (c1 < c0 || r1 < r0) return;
        for (let rz = r0; rz <= r1; rz += 1) {
          for (let cxi = c0; cxi <= c1; cxi += 1) {
            fillGrid[idx(cxi, rz)] = 1;
          }
        }
      };

      const fillSquareBrush = (px, pz) => {
        fillRect(px - brushHalf, px + brushHalf, pz - brushHalf, pz + brushHalf);
      };

      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const isLastSeg = i === points.length - 2;
        const b = isLastSeg ? landingPoint : points[i + 1];
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];

        const alongX = Math.abs(dz) <= 1e-6;
        const alongZ = Math.abs(dx) <= 1e-6;

        if (alongX) {
          const xMin = Math.min(a[0], b[0]) - edgePad;
          const xMax = Math.max(a[0], b[0]) + edgePad;
          const z0 = a[2];
          fillRect(xMin, xMax, z0 - tHalf, z0 + tHalf);
        } else if (alongZ) {
          const zMin = Math.min(a[2], b[2]) - edgePad;
          const zMax = Math.max(a[2], b[2]) + edgePad;
          const x0 = a[0];
          fillRect(x0 - tHalf, x0 + tHalf, zMin, zMax);
        } else {
          const xMin = Math.min(a[0], b[0]) - tHalf;
          const xMax = Math.max(a[0], b[0]) + tHalf;
          const zMin = Math.min(a[2], b[2]) - tHalf;
          const zMax = Math.max(a[2], b[2]) + tHalf;
          fillRect(xMin, xMax, zMin, zMax);
        }
      }

      if (startPoint) fillSquareBrush(startPoint[0], startPoint[2]);
      for (let i = 1; i < points.length - 1; i += 1) {
        const p = points[i];
        fillSquareBrush(p[0], p[2]);
      }
      if (landingPoint) fillSquareBrush(landingPoint[0], landingPoint[2]);
    }
  } else {
    // 기존 로직(하위 단계): markRect/markDisk 기반으로 세그먼트를 사각형/원으로 채움
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
    // 착륙 지점 중심 보강: 과한 확장은 끝구간 중심 오차를 키우므로 12~15에서는 축소.
    const end = goalPosition ?? points[points.length - 1];
    if (end) {
      markDisk(end[0], end[2], Math.max(width * 0.62, 1.05));
      markRect(end[0], end[2], 0, Math.max(width * 0.95, 2.2), Math.max(width * 0.95, 2.2));
    }
  }

  const has = (x, z) => x >= 0 && x < cols && z >= 0 && z < rows && fillGrid[idx(x, z)] === 1;
  const floorMeshes = [];
  if (stage >= 7) {
    // stage>=12에서는 셀 단위 렌더링 대신, 연속된 filled 셀을 사각형으로 merge해서
    // mesh 개수를 줄인다.
    const visited = new Uint8Array(cols * rows);
    for (let z = 0; z < rows; z += 1) {
      for (let x = 0; x < cols; x += 1) {
        const baseIdx = idx(x, z);
        if (fillGrid[baseIdx] !== 1 || visited[baseIdx] === 1) continue;

        // width 확장
        let x2 = x;
        while (x2 + 1 < cols) {
          const nextIdx = idx(x2 + 1, z);
          if (fillGrid[nextIdx] !== 1 || visited[nextIdx] === 1) break;
          x2 += 1;
        }
        const w = x2 - x + 1;

        // height 확장
        let h = 1;
        outer: for (let zz = z + 1; zz < rows; zz += 1) {
          for (let xx = x; xx <= x2; xx += 1) {
            const testIdx = idx(xx, zz);
            if (fillGrid[testIdx] !== 1 || visited[testIdx] === 1) break outer;
          }
          h += 1;
        }

        // 방문 마킹
        for (let zz = z; zz < z + h; zz += 1) {
          for (let xx = x; xx < x + w; xx += 1) {
            visited[idx(xx, zz)] = 1;
          }
        }

        const wx = minX + (x + w / 2) * cell;
        const wz = minZ + (z + h / 2) * cell;
        const margin = 0.02;
        floorMeshes.push(
          <mesh key={`f-m-${x}-${z}-${w}-${h}`} position={[wx, 0.03, wz]}>
            <boxGeometry args={[w * cell + margin, floorThickness, h * cell + margin]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.32} depthWrite={false} />
          </mesh>
        );
      }
    }
  } else {
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
  }

  // Debug markers (red spheres) removed: floor generation is now stable and grid-based.
  let wallMeshes = [];
  // 벽은 "바닥으로 실제 칠해진 영역"의 외곽선에서 생성 (stage>=12 포함)
  {
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
            <meshStandardMaterial color="#cbd5e1" transparent opacity={0.55} />
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
            <meshStandardMaterial color="#cbd5e1" transparent opacity={0.55} />
          </mesh>
        );
      }
    }
  }
  }

  return <group>{floorMeshes}{wallMeshes}</group>;
});

/* =========================
   카메라
========================= */

function FixedCamera({
  fixedStartPosition,
  fixedLookAt,
  yawOffset = 0,
  pitchOffset = 0,
  lookOffset = [0, 0, 0],
  zoomScale = 1,
}) {
  useFrame(({ camera }) => {
    // Orbit the camera around fixedLookAt using yaw/pitch offsets.
    const baseOffset = [
      fixedStartPosition[0] - fixedLookAt[0],
      fixedStartPosition[1] - fixedLookAt[1],
      fixedStartPosition[2] - fixedLookAt[2],
    ];
    const scaled = [baseOffset[0] * zoomScale, baseOffset[1] * zoomScale, baseOffset[2] * zoomScale];

    // Yaw rotation around world Y
    const cosYaw = Math.cos(yawOffset);
    const sinYaw = Math.sin(yawOffset);
    let ox = scaled[0] * cosYaw - scaled[2] * sinYaw;
    let oz = scaled[0] * sinYaw + scaled[2] * cosYaw;
    let oy = scaled[1];

    // Pitch rotation around camera-local X axis (apply in XZ plane)
    const cosPitch = Math.cos(pitchOffset);
    const sinPitch = Math.sin(pitchOffset);
    const py = oy * cosPitch - oz * sinPitch;
    const pz = oy * sinPitch + oz * cosPitch;
    oy = py;
    oz = pz;

    const lx = fixedLookAt[0] + (lookOffset?.[0] ?? 0);
    const ly = fixedLookAt[1] + (lookOffset?.[1] ?? 0);
    const lz = fixedLookAt[2] + (lookOffset?.[2] ?? 0);
    camera.position.set(lx + ox, ly + oy, lz + oz);
    camera.lookAt(lx, ly, lz);
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

function TopDownCamera({ targetPosition }) {
  useFrame(({ camera }) => {
    const camHeight = 15;
    const lookHeight = 0;
    camera.position.set(targetPosition[0], targetPosition[1] + camHeight, targetPosition[2]);
    camera.lookAt(targetPosition[0], lookHeight, targetPosition[2]);
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
  size = 165,
  knobSize = 63,
  maxDistance = 48,
  overlay = null,
}) {
  const displayKnobSize = Math.max(18, Math.round(knobSize * 0.78));

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
    // 이미 한 손가락이 스틱을 점유 중이면 두 번째 손가락(핀치)은 무시
    if (activeRef.current || activeTouchIdRef.current !== null) return;

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
      // 터치 발 pointer 이벤트는 touch 경로가 전담 → pointer 세션이 아닐 땐 관여하지 않음
      if (activePointerIdRef.current === null) return;
      if (!activeRef.current || disabled) return;
      if (e.pointerId !== activePointerIdRef.current) return;

      e.preventDefault();
      updateFromDrag(e.clientX, e.clientY);
    }

    function handleWindowPointerUpOrCancel(e) {
      // 핵심 방어: 멀티터치/핀치가 유발하는 pointerup이 touch 세션을 끊지 못하게 함
      if (activePointerIdRef.current === null) return;
      if (e.pointerId !== activePointerIdRef.current) return;

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
      {label ? <div className="text-[10px] font-bold text-center mb-1">{label}</div> : null}

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
        <div className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
          <div className="w-[2px] h-full bg-gray-300" />
          <div className="absolute w-full h-[2px] bg-gray-300" />
        </div>
        {overlay ? <div className="absolute inset-0 z-10 pointer-events-none">{overlay}</div> : null}

        <div
          className={`absolute rounded-full ${accentClass} shadow z-20`}
          style={{
            width: displayKnobSize,
            height: displayKnobSize,
            left: size / 2 - displayKnobSize / 2 + knob.x,
            top: size / 2 - displayKnobSize / 2 + knob.y,
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
  movementRect,
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
  onTutorialStage4ComboInput,
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
      // 프레임 독립성: 매 프레임 물리 계산을 60fps 기준으로 정규화한다.
      // (120/144Hz 등 고주사율 모니터에서도 60Hz와 동일한 이동 속도가 되도록)
      const frameScale = Math.min(3, Math.max(0.0001, delta * 60));

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
          // Preserve horizontal inertia during landing; only freeze vertical during hover.
          c.velocity[1] = 0;
        } else {
          // gentle descend with inertia feel
          c.velocity[1] = Math.max(c.velocity[1] - 0.0022 * frameScale, -0.026);
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
        // UI 12~14, 24~25단계: 오른쪽 조이스틱 좌우(스트레이프) 금지
        if (
          !isTutorialStage &&
          ((uiStage >= 12 && uiStage <= 14) || (uiStage >= 24 && uiStage <= 25))
        ) {
          inputStrafe = 0;
        }

        yawInput = clamp(yawInput, -1, 1);
        inputVertical = clamp(inputVertical, -1, 1);
        inputForward = clamp(inputForward, -1, 1);
        inputStrafe = clamp(inputStrafe, -1, 1);
        if (isTutorialStage && uiStage === 4 && onTutorialStage4ComboInput) {
          onTutorialStage4ComboInput(yawInput, inputStrafe);
        } else {
          if (onTutorialLeftStickInput) onTutorialLeftStickInput(inputVertical, yawInput);
          if (onTutorialMoveInput) onTutorialMoveInput(inputForward, inputStrafe);
        }

        c.rotation += yawInput * c.yawSpeed * delta;

        if (controlMode === "headless") {
          c.velocity[0] += inputStrafe * c.strafeAccel * frameScale;
          c.velocity[2] += -inputForward * c.moveAccel * frameScale;
        } else {
          const forwardX = -Math.sin(c.rotation);
          const forwardZ = -Math.cos(c.rotation);
          const rightVecX = Math.cos(c.rotation);
          const rightVecZ = -Math.sin(c.rotation);

          c.velocity[0] +=
            (forwardX * inputForward * c.moveAccel +
              rightVecX * inputStrafe * c.strafeAccel) *
            frameScale;

          c.velocity[2] +=
            (forwardZ * inputForward * c.moveAccel +
              rightVecZ * inputStrafe * c.strafeAccel) *
            frameScale;
        }

        c.velocity[1] += inputVertical * c.verticalAccel * frameScale;
      }

      c.velocity[0] = clamp(c.velocity[0], -c.maxSpeedXZ, c.maxSpeedXZ);
      c.velocity[2] = clamp(c.velocity[2], -c.maxSpeedXZ, c.maxSpeedXZ);
      c.velocity[1] = clamp(c.velocity[1], -c.maxSpeedY, c.maxSpeedY);

      const dampXZ = Math.pow(c.dampingXZ, frameScale);
      const dampY = Math.pow(c.dampingY, frameScale);
      c.velocity[0] *= dampXZ;
      c.velocity[2] *= dampXZ;
      c.velocity[1] *= dampY;

      const nextPosition = [
        c.position[0] + c.velocity[0] * frameScale,
        Math.max(c.minHeight, c.position[1] + c.velocity[1] * frameScale),
        c.position[2] + c.velocity[2] * frameScale,
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

      const collisionSamples = getDroneCollisionSamplePoints(nextPosition, c.rotation);

      // 6~11단계: 장애물 충돌 판정을 약간 더 타이트하게(덜 후하게) 조정
      const obstacleHitRadius =
        uiStage >= 6 && uiStage <= 14
          ? Math.max(0.85, obstacleSize * 0.55)
          : Math.max(1.0, obstacleSize * 0.7);
      const hasCrash =
        !isTutorialStage &&
        obstaclePositions.some((obstacle) =>
          collisionSamples.some((sample) =>
            checkObstacleHit(sample, obstacle, obstacleHitRadius)
          )
        );

      // UI 6~14단계(gameplay stage 1~6): restrict movement to a rectangle region.
      const isOffMovementRect =
        !isTutorialStage &&
        stage >= 1 &&
        stage <= 6 &&
        movementRect &&
        collisionSamples.some(
          (sample) =>
            sample[0] < movementRect.minX ||
            sample[0] > movementRect.maxX ||
            sample[2] < movementRect.minZ ||
            sample[2] > movementRect.maxZ
        );

      if (isOffMovementRect) {
        if (onWallCrash) onWallCrash();
        else onCrashReset();
        return;
      }

      // 7단계부터는 "실제 바닥 생성 규칙과 동일한 영역" 기준으로 충돌 판정.
      const isOffGuidePath =
        !isTutorialStage &&
        stage >= 7 &&
        guidePath &&
        collisionSamples.some(
          (sample) => !isInsideGuideFloorXZ(sample, guidePath, goalPosition, stage)
        );

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
    const keyboardPitch = (c.keys.forward ? -1 : 0) + (c.keys.backward ? 1 : 0);
    const shouldLockLateralTilt =
      !isTutorialStage && ((uiStage >= 12 && uiStage <= 14) || (uiStage >= 24 && uiStage <= 25));
    const keyboardRoll = shouldLockLateralTilt
      ? 0
      : (c.keys.left ? -1 : 0) + (c.keys.right ? 1 : 0);
    const targetPitch = clamp(c.rightStick.y + keyboardPitch, -1, 1) * 0.275;
    const targetRoll = shouldLockLateralTilt
      ? 0
      : clamp(c.rightStick.x + keyboardRoll, -1, 1) * -0.225;
    const currentPitch = droneRef.current.rotation.x;
    const currentRoll = droneRef.current.rotation.z;
    const nextPitch = currentPitch + (targetPitch - currentPitch) * 0.2;
    const nextRoll = currentRoll + (targetRoll - currentRoll) * 0.2;
    droneRef.current.rotation.set(nextPitch, c.rotation, nextRoll);

    const bodyScale = getShadowScale(c.position[1], 1.0, 0.55);
    const noseScale = getShadowScale(c.position[1], 0.95, 0.5);

    // 그림자는 항상 보이게 해서 "바닥에 붙음/떠있음"을 쉽게 구분
    shadowGroupRef.current.visible = true;
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
          <meshBasicMaterial color="black" transparent opacity={0.26} depthWrite={false} />
        </mesh>

        <mesh ref={shadowNoseRef}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color="black" transparent opacity={0.26} depthWrite={false} />
        </mesh>
      </group>

      <group ref={droneRef}>
        <DroneVisual
          spinStateRef={controlRef}
          lockLateralTilt={
            !isTutorialStage && ((uiStage >= 12 && uiStage <= 14) || (uiStage >= 24 && uiStage <= 25))
          }
        />
      </group>
    </group>
  );
}

function ControlScene({
  goalPosition,
  obstaclePositions,
  obstacleSize,
  guidePath,
  gridMeta,
  gridPathCells,
  movementRect,
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
  onTutorialStage4ComboInput,
  onTutorialLandingComplete,
  cameraMode,
  status,
  fixedStartPosition,
  fixedLookAt,
  fixedYawOffset,
  fixedPitchOffset,
  fixedZoomScale,
  fixedLookOffset,
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
        <ControlYellowFloor uiStage={uiStage} />
        {!isTutorialStage && uiStage >= 6 && uiStage <= 14 && (
          <MovementRectFloor movementRect={movementRect} />
        )}
        {!isTutorialStage && (
          <GroundGuidePath
            guidePath={guidePath}
            goalPosition={goalPosition}
            stage={stage}
            gridMeta={gridMeta}
            gridPathCells={gridPathCells}
          />
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
          movementRect={movementRect}
          stage={stage}
          uiStage={uiStage}
          isTutorialStage={isTutorialStage}
          controlMode={controlMode}
          controlRef={controlRef}
          onCrashReset={onCrashReset}
          onWallCrash={onWallCrash}
          onSuccess={onSuccess}
          onTutorialLeftStickInput={onTutorialLeftStickInput}
          onTutorialMoveInput={onTutorialMoveInput}
          onTutorialStage4ComboInput={onTutorialStage4ComboInput}
          onTutorialLandingComplete={onTutorialLandingComplete}
        />
        {cameraMode === "fixed" ? (
          <FixedCamera
            fixedStartPosition={fixedStartPosition}
            fixedLookAt={fixedLookAt}
            yawOffset={fixedYawOffset}
            pitchOffset={fixedPitchOffset}
            zoomScale={fixedZoomScale}
            lookOffset={fixedLookOffset}
          />
        ) : cameraMode === "top" ? (
          <TopDownCamera targetPosition={status.position} />
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

function CodingDrone({ position, rotationY, spinActive }) {
  return (
    <group>
      <DroneShadow position={position} rotationY={rotationY} />
      <group position={position} rotation={[0, rotationY, 0]}>
        <DroneVisual spinActive={spinActive} spinSpeed={28} />
      </group>
    </group>
  );
}

function CodingCamera({
  targetPosition,
  rotationY,
  zoomScale,
  lookOffset,
  yawOffset = 0,
  pitchOffset = 0,
}) {
  useFrame(({ camera }) => {
    const baseHeight = 7.1;
    const baseBackOffset = 4.2;
    const safeZoom = Math.max(0.6, Math.min(1.9, zoomScale ?? 1));
    const height = baseHeight * safeZoom;
    const backOffset = baseBackOffset * safeZoom;
    const targetX = targetPosition[0] + (lookOffset?.[0] ?? 0);
    const targetZ = targetPosition[2] + (lookOffset?.[2] ?? 0);
    const lookY = targetPosition[1] + 0.9;
    const forwardX = -Math.sin(rotationY);
    const forwardZ = -Math.cos(rotationY);

    let ox = -forwardX * backOffset;
    let oy = height - 0.9;
    let oz = -forwardZ * backOffset;

    const cosYaw = Math.cos(yawOffset);
    const sinYaw = Math.sin(yawOffset);
    let rx = ox * cosYaw - oz * sinYaw;
    let rz = ox * sinYaw + oz * cosYaw;
    ox = rx;
    oz = rz;

    const cosPitch = Math.cos(pitchOffset);
    const sinPitch = Math.sin(pitchOffset);
    const py = oy * cosPitch - oz * sinPitch;
    const pz = oy * sinPitch + oz * cosPitch;
    oy = py;
    oz = pz;

    camera.position.set(targetX + ox, lookY + oy, targetZ + oz);
    camera.lookAt(targetX, lookY, targetZ);
  });

  return null;
}

function CodingScene({
  dronePosition,
  rotationY,
  goalPosition,
  obstaclePosition,
  placedItems,
  placementType,
  obstacleColor,
  obstacleEdgeColor,
  hoverCell,
  onHoverCell,
  onPlaceAtCell,
  isRunning,
  cameraResetToken,
  isCrash,
}) {
  const gridCellSize = 1;
  const gridHalfSize = 7;
  const visualPlaneSize = 40;
  const sceneContainerRef = useRef(null);
  const [cameraZoomScale, setCameraZoomScale] = useState(1);
  const [cameraLookOffset, setCameraLookOffset] = useState([0, 0, 0]);
  const [cameraYawOffset, setCameraYawOffset] = useState(0);
  const [cameraPitchOffset, setCameraPitchOffset] = useState(0);
  const isCameraDraggingRef = useRef(false);
  const cameraDragPointerIdRef = useRef(null);
  const lastCameraDragRef = useRef({ x: 0, y: 0 });
  const pinchActiveRef = useRef(false);
  const pinchLastDistRef = useRef(0);
  const pinchLastMidRef = useRef({ x: 0, y: 0 });

  const applyCameraOrbitDelta = useCallback((deltaX, deltaY, pointerType = "mouse") => {
    applyOrbitDragToSetters(
      deltaX,
      deltaY,
      pointerType,
      setCameraYawOffset,
      setCameraPitchOffset
    );
  }, []);

  const getTouchDistance = (t1, t2) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
  };
  const getTouchMidpoint = (t1, t2) => ({
    x: (t1.clientX + t2.clientX) * 0.5,
    y: (t1.clientY + t2.clientY) * 0.5,
  });
  const snapToCell = (point) => {
    // Snap to cell index (not line intersection) so objects sit inside each square.
    const cx = Math.max(
      -gridHalfSize,
      Math.min(gridHalfSize - 1, Math.floor(point.x / gridCellSize))
    );
    const cz = Math.max(
      -gridHalfSize,
      Math.min(gridHalfSize - 1, Math.floor(point.z / gridCellSize))
    );
    return { x: cx, z: cz };
  };

  useEffect(() => {
    setCameraZoomScale(1);
    setCameraLookOffset([0, 0, 0]);
    setCameraYawOffset(0);
    setCameraPitchOffset(0);
  }, [cameraResetToken]);

  useEffect(() => {
    const el = sceneContainerRef.current;
    if (!el) return;

    const canDragCamera = (button) =>
      button === 2 || (!placementType && button === 0);

    const handlePointerDown = (e) => {
      if (!canDragCamera(e.button)) return;
      if (pinchActiveRef.current) return;
      isCameraDraggingRef.current = true;
      cameraDragPointerIdRef.current = e.pointerId;
      lastCameraDragRef.current = { x: e.clientX, y: e.clientY };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
    };

    const handlePointerMove = (e) => {
      if (!isCameraDraggingRef.current) return;
      if (cameraDragPointerIdRef.current !== e.pointerId) return;
      const dx = e.clientX - lastCameraDragRef.current.x;
      const dy = e.clientY - lastCameraDragRef.current.y;
      lastCameraDragRef.current = { x: e.clientX, y: e.clientY };
      applyCameraOrbitDelta(dx, dy, e.pointerType);
    };

    const stopCameraDrag = (e) => {
      if (cameraDragPointerIdRef.current !== e.pointerId) return;
      isCameraDraggingRef.current = false;
      cameraDragPointerIdRef.current = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    };

    const handleWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.08 : 0.92;
      setCameraZoomScale((prev) => clamp(prev * factor, 0.65, 1.9));
    };

    const handleContextMenu = (e) => {
      if (isCameraDraggingRef.current) e.preventDefault();
    };

    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", stopCameraDrag);
    el.addEventListener("pointercancel", stopCameraDrag);
    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("contextmenu", handleContextMenu);

    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", stopCameraDrag);
      el.removeEventListener("pointercancel", stopCameraDrag);
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [placementType, applyCameraOrbitDelta]);

  return (
    <div
      ref={sceneContainerRef}
      className="relative w-full h-full min-h-[320px] overflow-hidden cursor-grab active:cursor-grabbing"
      style={{ touchAction: "none", overscrollBehavior: "none" }}
      onTouchStart={(e) => {
        if (e.touches.length >= 2) {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          isCameraDraggingRef.current = false;
          cameraDragPointerIdRef.current = null;
          pinchActiveRef.current = true;
          pinchLastDistRef.current = getTouchDistance(t1, t2);
          pinchLastMidRef.current = getTouchMidpoint(t1, t2);
        }
      }}
      onTouchMove={(e) => {
        if (pinchActiveRef.current && e.touches.length >= 2) {
          e.preventDefault();
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const dist = getTouchDistance(t1, t2);
          const mid = getTouchMidpoint(t1, t2);
          const lastDist = pinchLastDistRef.current || dist;
          const lastMid = pinchLastMidRef.current || mid;

          const zoomFactor = lastDist / Math.max(1, dist);
          setCameraZoomScale((prev) => Math.max(0.65, Math.min(1.9, prev * zoomFactor)));

          const dx = mid.x - lastMid.x;
          const dy = mid.y - lastMid.y;
          const panSpeed = 0.018;
          setCameraLookOffset((prev) => [
            Math.max(-12, Math.min(12, prev[0] - dx * panSpeed)),
            0,
            Math.max(-12, Math.min(12, prev[2] + dy * panSpeed)),
          ]);

          pinchLastDistRef.current = dist;
          pinchLastMidRef.current = mid;
          return;
        }

      }}
      onTouchEnd={(e) => {
        if (e.touches.length < 2) pinchActiveRef.current = false;
      }}
      onTouchCancel={() => {
        pinchActiveRef.current = false;
      }}
    >
      <Canvas
        className="w-full h-full"
        camera={{ position: [0, 6.9, 4.8], fov: 50 }}
        dpr={[1, 1.5]}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[5, 10, 5]} intensity={1} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[visualPlaneSize, visualPlaneSize]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
        <gridHelper
          args={[visualPlaneSize, visualPlaneSize, "#334155", "#94a3b8"]}
          position={[0, 0.03, 0]}
        />

        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          onPointerMove={(e) => {
            if (!placementType) return;
            const cell = snapToCell(e.point);
            onHoverCell?.(cell);
          }}
          onPointerLeave={() => {
            if (!placementType) return;
            onHoverCell?.(null);
          }}
          onPointerDown={(e) => {
            if (!placementType) return;
            const cell = snapToCell(e.point);
            onPlaceAtCell?.(cell);
          }}
        >
          <planeGeometry args={[gridHalfSize * 2 + 2, gridHalfSize * 2 + 2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {(placedItems?.goal || goalPosition) && (
          <mesh
            position={[
              ((placedItems?.goal?.x ?? goalPosition?.[0] ?? 0) + 0.5) * gridCellSize,
              0.03,
              ((placedItems?.goal?.z ?? goalPosition?.[2] ?? 0) + 0.5) * gridCellSize,
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[1, 1]} />
            <meshStandardMaterial color="#15803d" transparent opacity={0.98} />
          </mesh>
        )}

        {(placedItems?.obstacles ?? []).map((o) => (
          <group
            key={o.id}
            position={[
              (o.x + 0.5) * gridCellSize,
              0.5 + (o.level ?? 0) * gridCellSize,
              (o.z + 0.5) * gridCellSize,
            ]}
          >
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial
                color={o.color ?? "#a78bfa"}
                transparent
                opacity={0.55}
                depthWrite={false}
              />
            </mesh>
            <mesh>
              <boxGeometry args={[1.005, 1.005, 1.005]} />
              <meshBasicMaterial color={o.edgeColor ?? obstacleEdgeColor ?? "#7c3aed"} wireframe />
            </mesh>
          </group>
        ))}

        {placementType && hoverCell && (
          placementType === "goal" ? (
            <mesh
              position={[(hoverCell.x + 0.5) * gridCellSize, 0.035, (hoverCell.z + 0.5) * gridCellSize]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[1, 1]} />
              <meshStandardMaterial color="#22c55e" transparent opacity={0.45} />
            </mesh>
          ) : placementType === "delete" ? (
            <mesh
              position={[(hoverCell.x + 0.5) * gridCellSize, 0.04, (hoverCell.z + 0.5) * gridCellSize]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[1, 1]} />
              <meshStandardMaterial color="#ef4444" transparent opacity={0.35} />
            </mesh>
          ) : (
            <group position={[(hoverCell.x + 0.5) * gridCellSize, 0.5, (hoverCell.z + 0.5) * gridCellSize]}>
              <mesh>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial
                  color={obstacleColor ?? "#a78bfa"}
                  transparent
                  opacity={0.35}
                  depthWrite={false}
                />
              </mesh>
              <mesh>
                <boxGeometry args={[1.005, 1.005, 1.005]} />
                <meshBasicMaterial color={obstacleEdgeColor ?? "#7c3aed"} wireframe />
              </mesh>
            </group>
          )
        )}

        <CodingDrone position={dronePosition} rotationY={rotationY} spinActive={isRunning} />
        {isCrash && (
          <Html position={[dronePosition[0], dronePosition[1] + 1.8, dronePosition[2]]} center>
            <div className="px-3 py-1.5 rounded-lg bg-red-600/95 text-white text-sm font-bold shadow-lg whitespace-nowrap">
              충돌했습니다
            </div>
          </Html>
        )}
        <CodingCamera
          targetPosition={dronePosition}
          rotationY={rotationY}
          zoomScale={cameraZoomScale}
          lookOffset={cameraLookOffset}
          yawOffset={cameraYawOffset}
          pitchOffset={cameraPitchOffset}
        />
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
  const CORE_STAGE_COUNT = 20;
  const MAX_STAGE = TUTORIAL_STAGE_COUNT + CORE_STAGE_COUNT;
  const TUTORIAL_CLEAR_OVERLAY_MS = 2200;
  const TUTORIAL_CLEAR_ADVANCE_MS = 1600;
  /** ControlDrone 이륙 스풀(1.5s) 직후 — 미션은 숨기지 않고 이 시점에 (성공) 연출 */
  const TUTORIAL_TAKEOFF_SUCCESS_START_MS = 1700;
  /** 단계 내 지시 완료 후 (성공) 표시 시간 — 이후 다음 미션 문구 */
  const TUTORIAL_INSTRUCTION_SUCCESS_DISPLAY_MS = 1500;

  const [stage, setStage] = useState(1);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialMissionSuccessActive, setTutorialMissionSuccessActive] =
    useState(false);
  const [stage5LandingHintMessage, setStage5LandingHintMessage] = useState("");
  const getGameplayStage = useCallback(
    (stageNumber) => {
      if (stageNumber <= 11) return Math.max(1, stageNumber - TUTORIAL_STAGE_COUNT);
      // UI 12~14는 9~11의 게임플레이(4~6)를 재사용, 기존 12~15는 15~18로 이동
      if (stageNumber >= 24) return stageNumber - 11; // UI 24~25 => gameplay 13~14
      return Math.max(1, stageNumber - 8);
    },
    [TUTORIAL_STAGE_COUNT]
  );
  const createTutorialLayout = useCallback(
    () => ({
      goalPosition: [999, 0.5, 999],
      obstaclePositions: [],
      obstacleSize: 1.5,
      guidePath: null,
      gridMeta: null,
      gridPathCells: null,
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
  const lastCameraDragYRef = useRef(0);
  const pinchActiveRef = useRef(false);
  const pinchLastDistRef = useRef(0);
  const pinchLastMidRef = useRef({ x: 0, y: 0 });

  const fixedStartPosition = useMemo(() => [0, 3.2, 6], []);
  const fixedLookAt = useMemo(() => [0, 1.0, -1.2], []);

  const [controlMode, setControlMode] = useState("normal");
  const [cameraMode, setCameraMode] = useState("fixed");
  const cameraModeRef = useRef("fixed");
  const [showGuide, setShowGuide] = useState(false);
  const [fixedYawOffset, setFixedYawOffset] = useState(0);
  const [fixedPitchOffset, setFixedPitchOffset] = useState(-0.12);
  const [fixedZoomScale, setFixedZoomScale] = useState(1);
  const [fixedLookOffset, setFixedLookOffset] = useState([0, 0, 0]);
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [showStageJump, setShowStageJump] = useState(true);
  const [showLeftMenu, setShowLeftMenu] = useState(true);
  const [showMission, setShowMission] = useState(true);
  const [showActionButtons, setShowActionButtons] = useState(true);
  const missionTimerRef = useRef(null);
  const tutorialAdvanceTimerRef = useRef(null);
  const tutorialStepSuccessTimerRef = useRef(null);
  const stage5LandingHintTimerRef = useRef(null);
  const tutorialSuccessTimerRef = useRef(null);
  const tutorialCelebrationActiveRef = useRef(false);
  const tutorialInputLockedRef = useRef(false);
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
        "왼쪽 조이스틱은 왼쪽으로, 오른쪽 조이스틱은 왼쪽으로 동시에 밀어 보세요.",
        "왼쪽 조이스틱은 오른쪽으로, 오른쪽 조이스틱은 오른쪽으로 동시에 밀어 보세요.",
        "왼쪽 조이스틱은 왼쪽으로, 오른쪽 조이스틱은 오른쪽으로 동시에 밀어 보세요.",
        "왼쪽 조이스틱은 오른쪽으로, 오른쪽 조이스틱은 왼쪽으로 동시에 밀어 보세요.",
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
    stage5LandingHintMessage ||
    (isTutorialStage && tutorialStep < tutorialMessages.length
      ? tutorialMessages[tutorialStep]
      : "");
  const isNoStrafeMissionStage =
    !isTutorialStage && ((stage >= 12 && stage <= 14) || (stage >= 24 && stage <= 25));
  const controlMissionMessage =
    isNoStrafeMissionStage
      ? "미션: '좌우' 이동 사용하지 않고 목표물에 도달하기"
      : "";
  const isHeadlessDisabled = isNoStrafeMissionStage;

  const triggerMissionDelay = useCallback((ms = 1400) => {
    // Keep the stage title visible; only delay mission instructions + action buttons.
    setShowMission(false);
    setShowActionButtons(false);
    if (missionTimerRef.current) clearTimeout(missionTimerRef.current);
    missionTimerRef.current = setTimeout(() => {
      setShowMission(true);
      setShowActionButtons(true);
      missionTimerRef.current = null;
    }, ms);
  }, []);

  const cancelTutorialStageAdvance = useCallback(() => {
    if (tutorialSuccessTimerRef.current) {
      clearTimeout(tutorialSuccessTimerRef.current);
      tutorialSuccessTimerRef.current = null;
    }
    if (tutorialAdvanceTimerRef.current) {
      clearTimeout(tutorialAdvanceTimerRef.current);
      tutorialAdvanceTimerRef.current = null;
    }
    if (tutorialStepSuccessTimerRef.current) {
      clearTimeout(tutorialStepSuccessTimerRef.current);
      tutorialStepSuccessTimerRef.current = null;
    }
    if (stage5LandingHintTimerRef.current) {
      clearTimeout(stage5LandingHintTimerRef.current);
      stage5LandingHintTimerRef.current = null;
    }
    setStage5LandingHintMessage("");
    tutorialCelebrationActiveRef.current = false;
    tutorialInputLockedRef.current = false;
    setTutorialMissionSuccessActive(false);
  }, []);

  const resetToFixedCameraView = useCallback(() => {
    setCameraMode("fixed");
    setFixedYawOffset(0);
    setFixedPitchOffset(-0.12);
    setFixedZoomScale(1);
    setFixedLookOffset([0, 0, 0]);
  }, []);
  const stageTitle = useMemo(() => {
    if (stage === 1) return "1단계 : 이륙 / 착륙";
    if (stage === 2) return "2단계 : 왼쪽 조이스틱 (상승/하강, 회전)";
    if (stage === 3) return "3단계 : 오른쪽 조이스틱( 앞뒤/좌우)";
    if (stage === 4) return "4단계 : 회전 조작";
    if (stage === 5) return "5단계 : 자유 비행";
    if (stage >= 6 && stage <= 11) return `${stage}단계 : 장애물 피해 목표 도달하기`;
    if (stage >= 12 && stage <= 14) return `${stage}단계 : 좌우 이동 금지 목표 도달`;
    if (stage >= 24 && stage <= 25) return `${stage}단계 : 좌우 이동 금지 목표 도달`;
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

  /** 튜토리얼 단계 내 지시 완료 — 통과음과 달리 짧은 이중 ‘플럭’ 느낌 알림 */
  const playTutorialInstructionSuccessSound = useCallback(() => {
    const store = ensureAudioGraph();
    if (!store || !store.ctx || !store.master) return;
    if (store.ctx.state === "suspended") {
      store.ctx.resume();
    }
    const ctx = store.ctx;
    const now = ctx.currentTime;
    const pluck = (start, f0, f1) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f0, start);
      osc.frequency.exponentialRampToValueAtTime(f1, start + 0.11);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.1, start + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(g);
      g.connect(store.master);
      osc.start(start);
      osc.stop(start + 0.18);
    };
    pluck(now, 1320, 440);
    pluck(now + 0.09, 1650, 550);
  }, [ensureAudioGraph]);

  useEffect(() => {
    if (stage5LandingHintTimerRef.current) {
      clearTimeout(stage5LandingHintTimerRef.current);
      stage5LandingHintTimerRef.current = null;
    }
    setStage5LandingHintMessage("");
    if (stage !== 5 || tutorialStep !== 1) return undefined;
    stage5LandingHintTimerRef.current = setTimeout(() => {
      stage5LandingHintTimerRef.current = null;
      setStage5LandingHintMessage("자유비행을 완료했으면 착륙 버튼을 누르세요");
    }, 10000);
    return () => {
      if (stage5LandingHintTimerRef.current) {
        clearTimeout(stage5LandingHintTimerRef.current);
        stage5LandingHintTimerRef.current = null;
      }
    };
  }, [stage, tutorialStep]);

  const scheduleTutorialStepSuccess = useCallback(
    (nextStep) => {
      if (tutorialInputLockedRef.current) return;
      tutorialInputLockedRef.current = true;
      playTutorialInstructionSuccessSound();
      setTutorialMissionSuccessActive(true);
      if (tutorialStepSuccessTimerRef.current) {
        clearTimeout(tutorialStepSuccessTimerRef.current);
      }
      tutorialStepSuccessTimerRef.current = setTimeout(() => {
        tutorialStepSuccessTimerRef.current = null;
        setTutorialStep(nextStep);
        setTutorialMissionSuccessActive(false);
        tutorialInputLockedRef.current = false;
      }, TUTORIAL_INSTRUCTION_SUCCESS_DISPLAY_MS);
    },
    [playTutorialInstructionSuccessSound, TUTORIAL_INSTRUCTION_SUCCESS_DISPLAY_MS]
  );

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
    (clearedStageNumber, elapsed = null, messageDurationMs = 1300) => {
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
      }, messageDurationMs);
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
    // 1~5단계: 미션 패널은 계속 보이게 두고, 스풀 종료 시점에 맞춰 (성공) → 다음 지시
    if (stage >= 1 && stage <= 5 && tutorialStep === 0) {
      if (tutorialAdvanceTimerRef.current) clearTimeout(tutorialAdvanceTimerRef.current);
      if (tutorialStepSuccessTimerRef.current) {
        clearTimeout(tutorialStepSuccessTimerRef.current);
        tutorialStepSuccessTimerRef.current = null;
      }
      tutorialAdvanceTimerRef.current = setTimeout(() => {
        tutorialAdvanceTimerRef.current = null;
        playTutorialInstructionSuccessSound();
        setTutorialMissionSuccessActive(true);
        tutorialStepSuccessTimerRef.current = setTimeout(() => {
          tutorialStepSuccessTimerRef.current = null;
          setTutorialStep(1);
          setTutorialMissionSuccessActive(false);
        }, TUTORIAL_INSTRUCTION_SUCCESS_DISPLAY_MS);
      }, TUTORIAL_TAKEOFF_SUCCESS_START_MS);
    }
    syncStatus();
  }, [
    GROUNDED_HEIGHT,
    playTakeoffBeepThenRotor,
    playTutorialInstructionSuccessSound,
    stage,
    syncStatus,
    tutorialStep,
    TUTORIAL_INSTRUCTION_SUCCESS_DISPLAY_MS,
    TUTORIAL_TAKEOFF_SUCCESS_START_MS,
  ]);

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
    // Keep horizontal inertia; only stop vertical climb immediately.
    c.velocity[1] = Math.min(0, c.velocity[1] ?? 0);
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
    cancelTutorialStageAdvance();
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
    cancelTutorialStageAdvance();
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
  }, [
    cancelTutorialStageAdvance,
    getSpawnPosition,
    stage,
    stageLayout,
    stopRotorSound,
    syncStatus,
  ]);

  const resetStageAndView = useCallback(() => {
    resetToFixedCameraView();
    resetStageOnly();
  }, [resetStageOnly, resetToFixedCameraView]);

  const handleTutorialLeftStickInput = useCallback(
    (inputVertical, yawInput) => {
      if (tutorialInputLockedRef.current) return;
      if (stage === 2) {
        if (tutorialStep === 1 && inputVertical > 0.35) scheduleTutorialStepSuccess(2);
        if (tutorialStep === 2 && inputVertical < -0.35) scheduleTutorialStepSuccess(3);
        // leftStick.x uses inverted sign in control mapping
        // so "right push" => yawInput < 0, "left push" => yawInput > 0
        if (tutorialStep === 3 && yawInput < -0.35) scheduleTutorialStepSuccess(4);
        if (tutorialStep === 4 && yawInput > 0.35) scheduleTutorialStepSuccess(5);
      }
    },
    [scheduleTutorialStepSuccess, stage, tutorialStep]
  );

  const handleTutorialStage4ComboInput = useCallback(
    (yawInput, inputStrafe) => {
      if (tutorialInputLockedRef.current) return;
      if (stage !== 4) return;
      // leftStick: 물리적 왼쪽 밀기 → yawInput > 0, 오른쪽 → yawInput < 0 (코멘트와 동일)
      // rightStick: 왼쪽 밀기 → inputStrafe < 0, 오른쪽 → inputStrafe > 0 (3단계와 동일)
      const leftStickLeft = yawInput > 0.35;
      const rightStickLeft = inputStrafe < -0.35;
      const leftStickRight = yawInput < -0.35;
      const rightStickRight = inputStrafe > 0.35;
      if (tutorialStep === 1 && leftStickLeft && rightStickLeft) {
        scheduleTutorialStepSuccess(2);
      } else if (tutorialStep === 2 && leftStickRight && rightStickRight) {
        scheduleTutorialStepSuccess(3);
      } else if (tutorialStep === 3 && leftStickLeft && rightStickRight) {
        scheduleTutorialStepSuccess(4);
      } else if (tutorialStep === 4 && leftStickRight && rightStickLeft) {
        scheduleTutorialStepSuccess(5);
      }
    },
    [scheduleTutorialStepSuccess, stage, tutorialStep]
  );

  const handleTutorialMoveInput = useCallback(
    (inputForward, inputStrafe) => {
      if (tutorialInputLockedRef.current) return;
      if (stage === 3) {
        if (tutorialStep === 1 && inputForward > 0.35) scheduleTutorialStepSuccess(2);
        else if (tutorialStep === 2 && inputForward < -0.35) scheduleTutorialStepSuccess(3);
        else if (tutorialStep === 3 && inputStrafe < -0.35) scheduleTutorialStepSuccess(4);
        else if (tutorialStep === 4 && inputStrafe > 0.35) scheduleTutorialStepSuccess(5);
      }
    },
    [scheduleTutorialStepSuccess, stage, tutorialStep]
  );

  const handleTutorialLandingComplete = useCallback(() => {
    if (tutorialCelebrationActiveRef.current) return;

    const scheduleTutorialStageAdvance = (clearedStageNumber, nextStage) => {
      tutorialCelebrationActiveRef.current = true;
      if (tutorialSuccessTimerRef.current) {
        clearTimeout(tutorialSuccessTimerRef.current);
        tutorialSuccessTimerRef.current = null;
      }
      showStageClearOverlay(clearedStageNumber, null, TUTORIAL_CLEAR_OVERLAY_MS);
      markStageCompleted(clearedStageNumber);
      setTutorialMissionSuccessActive(true);
      const nextLayout = getLayoutForStage(nextStage);
      tutorialSuccessTimerRef.current = setTimeout(() => {
        tutorialSuccessTimerRef.current = null;
        tutorialCelebrationActiveRef.current = false;
        setTutorialMissionSuccessActive(false);
        resetToFixedCameraView();
        triggerMissionDelay(1400);
        setStage(nextStage);
        setTutorialStep(0);
        setStageLayout(nextLayout);
        resetStageOnly(nextLayout, nextStage);
      }, TUTORIAL_CLEAR_ADVANCE_MS);
    };

    if (stage === 1 && tutorialStep === 1) {
      scheduleTutorialStageAdvance(1, 2);
      return;
    }
    if (stage === 2 && tutorialStep === 5) {
      scheduleTutorialStageAdvance(2, 3);
      return;
    }
    if (stage === 3 && tutorialStep === 5) {
      scheduleTutorialStageAdvance(3, 4);
      return;
    }
    if (stage === 4 && tutorialStep === 5) {
      scheduleTutorialStageAdvance(4, 5);
      return;
    }
    if (stage === 5 && tutorialStep >= 1) {
      scheduleTutorialStageAdvance(5, 6);
    }
  }, [
    getLayoutForStage,
    markStageCompleted,
    resetStageOnly,
    resetToFixedCameraView,
    showStageClearOverlay,
    stage,
    triggerMissionDelay,
    tutorialStep,
  ]);

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
        triggerMissionDelay(1400);
        resetToFixedCameraView();
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
    triggerMissionDelay,
    resetToFixedCameraView,
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
    const shouldKeepRotorOn =
      status.isFlying || status.isSpooling || status.isLanding || status.isGroundRotorSpin;
    if (shouldKeepRotorOn) {
      startRotorSound();
    } else {
      stopRotorSound();
    }
  }, [
    startRotorSound,
    status.isFlying,
    status.isGroundRotorSpin,
    status.isLanding,
    status.isSpooling,
    stopRotorSound,
  ]);

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
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);

  useEffect(() => {
    function isUiTarget(target) {
      return (
        target instanceof Element &&
        Boolean(target.closest("[data-ui-block='true']"))
      );
    }

    const isTouchUiTarget = (touch) => {
      try {
        if (!touch) return false;
        if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") return false;
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        return isUiTarget(el);
      } catch {
        return false;
      }
    };

    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a, b) => ({ x: (a.clientX + b.clientX) * 0.5, y: (a.clientY + b.clientY) * 0.5 });

    function handleWindowPointerDown(e) {
      if (isUiTarget(e.target)) return;
      if (pinchActiveRef.current) return;
      if (cameraModeRef.current !== "fixed") return;
      isCameraDraggingRef.current = true;
      cameraDragPointerIdRef.current = e.pointerId;
      lastCameraDragXRef.current = e.clientX;
      lastCameraDragYRef.current = e.clientY;
    }

    function handleWindowPointerMove(e) {
      if (!isCameraDraggingRef.current) return;
      if (pinchActiveRef.current) return;
      if (cameraModeRef.current !== "fixed") return;
      if (
        cameraDragPointerIdRef.current !== null &&
        e.pointerId !== cameraDragPointerIdRef.current
      ) {
        return;
      }
      const deltaX = e.clientX - lastCameraDragXRef.current;
      lastCameraDragXRef.current = e.clientX;
      const deltaY = e.clientY - lastCameraDragYRef.current;
      lastCameraDragYRef.current = e.clientY;
      applyOrbitDragToSetters(
        deltaX,
        deltaY,
        e.pointerType,
        setFixedYawOffset,
        setFixedPitchOffset,
        CONTROL_CAMERA_ORBIT_YAW_SENSITIVITY,
        CONTROL_CAMERA_ORBIT_PITCH_SENSITIVITY
      );
    }

    function handleWindowWheel(e) {
      if (isUiTarget(e.target)) return;
      if (cameraModeRef.current !== "fixed") return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.05 : 0.95;
      setFixedZoomScale((prev) => clamp(prev * factor, 0.6, 2.0));
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

    function handleWindowTouchStart(e) {
      if (!e.touches || e.touches.length < 2) return;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      if (!t0 || !t1) return;
      if (isTouchUiTarget(t0) || isTouchUiTarget(t1)) return;
      pinchActiveRef.current = true;
      pinchLastDistRef.current = dist(t0, t1);
      pinchLastMidRef.current = mid(t0, t1);
      // Stop single-finger camera drag while pinching
      isCameraDraggingRef.current = false;
      cameraDragPointerIdRef.current = null;
      e.preventDefault();
    }

    function handleWindowTouchMove(e) {
      if (!pinchActiveRef.current) return;
      if (cameraModeRef.current !== "fixed") return;
      if (!e.touches || e.touches.length < 2) {
        pinchActiveRef.current = false;
        return;
      }
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      if (!t0 || !t1) return;
      if (isTouchUiTarget(t0) || isTouchUiTarget(t1)) return;

      const dNow = dist(t0, t1);
      const mNow = mid(t0, t1);
      const dPrev = pinchLastDistRef.current || dNow;
      const mPrev = pinchLastMidRef.current || mNow;

      const factor = dPrev > 1e-3 ? dNow / dPrev : 1;
      // Pinch-out (factor>1) => zoom in (closer) => smaller zoomScale
      setFixedZoomScale((prev) => clamp(prev / factor, 0.6, 2.0));

      const dx = mNow.x - mPrev.x;
      const dy = mNow.y - mPrev.y;
      // Two-finger pan: move look-at point in world X/Z.
      setFixedLookOffset((prev) => {
        const px = prev?.[0] ?? 0;
        const py = prev?.[1] ?? 0;
        const pz = prev?.[2] ?? 0;
        const panScale = CONTROL_CAMERA_PINCH_PAN_SENSITIVITY;
        return [px - dx * panScale, py, pz + dy * panScale];
      });

      pinchLastDistRef.current = dNow;
      pinchLastMidRef.current = mNow;
      e.preventDefault();
    }

    function handleWindowTouchEndOrCancel(e) {
      if (!pinchActiveRef.current) return;
      if (e.touches && e.touches.length >= 2) return;
      pinchActiveRef.current = false;
      pinchLastDistRef.current = 0;
      pinchLastMidRef.current = { x: 0, y: 0 };
    }

    window.addEventListener("pointerdown", handleWindowPointerDown, {
      passive: true,
    });
    window.addEventListener("pointermove", handleWindowPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerup", stopCameraDrag, { passive: true });
    window.addEventListener("pointercancel", stopCameraDrag, { passive: true });
    window.addEventListener("wheel", handleWindowWheel, { passive: false });
    window.addEventListener("touchstart", handleWindowTouchStart, { passive: false });
    window.addEventListener("touchmove", handleWindowTouchMove, { passive: false });
    window.addEventListener("touchend", handleWindowTouchEndOrCancel, { passive: false });
    window.addEventListener("touchcancel", handleWindowTouchEndOrCancel, { passive: false });

    return () => {
      window.removeEventListener("pointerdown", handleWindowPointerDown);
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", stopCameraDrag);
      window.removeEventListener("pointercancel", stopCameraDrag);
      window.removeEventListener("wheel", handleWindowWheel);
      window.removeEventListener("touchstart", handleWindowTouchStart);
      window.removeEventListener("touchmove", handleWindowTouchMove);
      window.removeEventListener("touchend", handleWindowTouchEndOrCancel);
      window.removeEventListener("touchcancel", handleWindowTouchEndOrCancel);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Use the smaller viewport dimension so mobile landscape still counts as "small".
    const apply = () => setIsSmallScreen(Math.min(window.innerWidth, window.innerHeight) <= 640);
    apply();
    window.addEventListener("resize", apply, { passive: true });
    return () => window.removeEventListener("resize", apply);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(orientation: portrait)");
    const apply = () => setIsPortrait(Boolean(mq.matches));
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    // 모바일 세로에서는 기본 접힘(겹침 방지)
    if (isSmallScreen && isPortrait) setShowStageJump(false);
    else setShowStageJump(true);
  }, [isPortrait, isSmallScreen]);

  useEffect(() => {
    // 모바일 세로에서는 좌상단 메뉴도 기본 접힘(겹침 방지)
    if (isSmallScreen && isPortrait) setShowLeftMenu(false);
    else setShowLeftMenu(true);
  }, [isPortrait, isSmallScreen]);

  useEffect(() => {
    // 12~14단계에서는 헤드리스 조종을 비활성화
    if (isHeadlessDisabled && controlMode === "headless") {
      setControlMode("normal");
    }
  }, [controlMode, isHeadlessDisabled]);

  useEffect(() => {
    return () => {
      if (crashTimerRef.current) clearTimeout(crashTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      if (missionTimerRef.current) clearTimeout(missionTimerRef.current);
      if (tutorialAdvanceTimerRef.current) clearTimeout(tutorialAdvanceTimerRef.current);
      if (tutorialStepSuccessTimerRef.current) {
        clearTimeout(tutorialStepSuccessTimerRef.current);
      }
      if (tutorialSuccessTimerRef.current) clearTimeout(tutorialSuccessTimerRef.current);
      if (stage5LandingHintTimerRef.current) {
        clearTimeout(stage5LandingHintTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      className="w-full h-full min-h-0 relative flex flex-col"
      style={{ touchAction: "none", overscrollBehavior: "none" }}
    >
      <div data-ui-block="true" className="absolute left-2 sm:left-3 top-2 sm:top-3 z-[120]">
        {(isSmallScreen && isPortrait) && (
          <button
            onClick={() => setShowLeftMenu((v) => !v)}
            className="px-3 py-2 rounded-xl bg-white/90 backdrop-blur border shadow-sm text-sm font-semibold text-gray-800"
          >
            메뉴
          </button>
        )}

        {(!(isSmallScreen && isPortrait) || showLeftMenu) && (
          <div className="mt-1 w-[190px] sm:w-[230px] bg-white/90 backdrop-blur border rounded-xl p-2 sm:p-3 shadow-sm space-y-2">
            <div className="text-[11px] sm:text-xs font-semibold text-gray-700 text-center">
              단계 {stage} / {MAX_STAGE}
            </div>
            {stage >= 6 && (
              <div className="text-[10px] sm:text-[11px] text-center font-semibold text-emerald-700 bg-emerald-50 rounded-md py-1">
                초시계: {elapsedSeconds.toFixed(2)}초 {isStopwatchRunning ? "(측정중)" : ""}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setControlMode("normal")}
                className={`flex-1 px-2 py-1 rounded-lg font-semibold text-[11px] sm:text-xs ${
                  controlMode === "normal" ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-800"
                }`}
              >
                기본조종
              </button>
              <button
                onClick={() => {
                  if (!isHeadlessDisabled) setControlMode("headless");
                }}
                disabled={isHeadlessDisabled}
                className={`relative flex-1 px-2 py-1 rounded-lg font-semibold text-[11px] sm:text-xs ${
                  isHeadlessDisabled
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : controlMode === "headless"
                      ? "bg-blue-500 text-white"
                      : "bg-gray-200 text-gray-800"
                }`}
              >
                헤드리스조종
                {isHeadlessDisabled && (
                  <span
                    className="pointer-events-none absolute left-1.5 right-1.5 top-1/2 -translate-y-1/2 border-t-2 border-gray-400/80"
                    aria-hidden="true"
                  />
                )}
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={resetToFixedCameraView}
                className={`flex-1 px-2 py-1 rounded-lg font-semibold text-[11px] sm:text-xs ${
                  cameraMode === "fixed" ? "bg-teal-600 text-white" : "bg-gray-200 text-gray-800"
                }`}
              >
                고정시점
              </button>
              <button
                onClick={() => setCameraMode("drone")}
                className={`flex-1 px-2 py-1 rounded-lg font-semibold text-[11px] sm:text-xs ${
                  cameraMode === "drone" ? "bg-teal-600 text-white" : "bg-gray-200 text-gray-800"
                }`}
              >
                드론시점
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowGuide((prev) => !prev)}
                className="w-full px-2 py-1 bg-gray-500 text-white rounded-lg text-[11px] sm:text-xs"
              >
                키보드 조종법
              </button>
            </div>

            {showGuide && (
              <div className="text-[10px] leading-4 text-gray-500 bg-white/70 rounded-lg p-2">
                왼쪽 스틱: 상승/하강 + 좌우 회전
                <br />
                오른쪽 스틱: 전진/후진{" "}
                {((stage >= 12 && stage <= 14) || (stage >= 24 && stage <= 25))
                  ? "(좌우 이동 잠금)"
                  : "+ 좌우 이동"}
                <br />
                키보드 조종법: WASD / IJKL, Space 이륙/착륙
              </div>
            )}
          </div>
        )}
      </div>

      {/* TEMP DEBUG: 단계 점프 버튼 (배포 전 제거 예정) */}
      <div data-ui-block="true" className="absolute right-2 sm:right-3 top-2 sm:top-3 z-[80]">
        {(isSmallScreen && isPortrait) && (
          <button
            onClick={() => setShowStageJump((v) => !v)}
            className="px-3 py-2 rounded-xl bg-white/90 backdrop-blur border shadow-sm text-sm font-semibold text-gray-800"
          >
            단계
          </button>
        )}

        {(!(isSmallScreen && isPortrait) || showStageJump) && (
          <div className="mt-1 bg-white/90 backdrop-blur border rounded-xl p-2 shadow-sm max-w-[92vw]">
            <div className="text-[10px] text-gray-600 text-center mb-1">
              테스트 단계 이동
            </div>
            <div className="flex gap-1 flex-wrap justify-center">
              {Array.from({ length: MAX_STAGE }).map((_, idx) => {
                const stageNumber = idx + 1;
                const isActive = stage === stageNumber;
                return (
                  <button
                    key={stageNumber}
                    onClick={() => {
                      cancelTutorialStageAdvance();
                      const nextLayout = getLayoutForStage(stageNumber);
                      triggerMissionDelay(1000);
                      resetToFixedCameraView();
                      setStage(stageNumber);
                      setTutorialStep(0);
                      setStageLayout(nextLayout);
                      resetStageOnly(nextLayout, stageNumber);
                      if (isSmallScreen && isPortrait) setShowStageJump(false);
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
        )}
      </div>

      {centerOverlayMessage && (
        <div
          className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-20 ${
            centerOverlayType === "crash" ? "top-[22.5%]" : "top-[23.5%]"
          }`}
        >
          <div
            className={`px-5 py-2 rounded-xl text-white text-sm font-bold shadow-lg ${
              centerOverlayType === "crash" ? "bg-rose-600/92" : "bg-emerald-600/90 stage-clear-pop"
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
        gridMeta={stageLayout.gridMeta}
        gridPathCells={stageLayout.gridPathCells}
        movementRect={stageLayout.movementRect}
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
        onTutorialStage4ComboInput={handleTutorialStage4ComboInput}
        onTutorialLandingComplete={handleTutorialLandingComplete}
        cameraMode={cameraMode}
        status={status}
        fixedStartPosition={fixedStartPosition}
        fixedLookAt={fixedLookAt}
        fixedYawOffset={fixedYawOffset}
        fixedPitchOffset={fixedPitchOffset}
        fixedZoomScale={fixedZoomScale}
        fixedLookOffset={fixedLookOffset}
      />

      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[17%] z-20">
        <div className="px-4 py-2 rounded-xl bg-slate-900/85 text-white text-sm font-bold shadow-lg text-center">
          {stageTitle}
        </div>
      </div>

      {showMission && (isTutorialStage ? currentTutorialMessage : controlMissionMessage) && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[31%] z-20">
          <div
            className={`px-4 py-2 rounded-xl text-white text-sm font-semibold shadow-lg transition-colors duration-300 ${
              isTutorialStage && tutorialMissionSuccessActive
                ? "tutorial-mission-success-banner"
                : "bg-indigo-600/90"
            }`}
          >
            <span>{isTutorialStage ? currentTutorialMessage : controlMissionMessage}</span>
            {isTutorialStage && tutorialMissionSuccessActive && (
              <span className="ml-1.5 font-bold text-white/95">(성공)</span>
            )}
          </div>
        </div>
      )}

      {showActionButtons && (
        <div
          data-ui-block="true"
          className="fixed left-2 sm:left-3 z-50 flex gap-2"
          style={{
            // Mobile landscape: keep buttons low, but above the left joystick.
            bottom: isSmallScreen
              ? isPortrait
                ? 180
                : "calc(152px + env(safe-area-inset-bottom, 0px))"
              : 236,
          }}
        >
          <button
            onClick={toggleTakeoffLand}
            className="px-4 sm:px-6 py-1.5 sm:py-3 rounded-lg font-semibold text-sm sm:text-base shadow bg-indigo-600 text-white"
          >
            {status.isFlying ? "착륙" : "이륙"}
          </button>
          <button
            onClick={resetStageAndView}
            className="px-4 sm:px-6 py-1.5 sm:py-3 rounded-lg font-semibold text-sm sm:text-base shadow bg-gray-700 text-white"
          >
            리셋
          </button>
        </div>
      )}

      <div
        data-ui-block="true"
        className="fixed left-3 bottom-3 z-50 touch-none"
      >
        <VirtualJoystick
          label=""
          accentClass="bg-purple-500"
          disabled={!status.isFlying}
          size={isSmallScreen ? 120 : 165}
          knobSize={isSmallScreen ? 46 : 63}
          maxDistance={isSmallScreen ? 34 : 48}
          overlay={
            <div className="pointer-events-none absolute inset-0 text-[11px] font-bold text-gray-600">
              <div className="absolute left-1/2 top-1 -translate-x-1/2">상승</div>
              <div className="absolute left-1/2 bottom-1 -translate-x-1/2">하강</div>
              <div className="absolute left-1 top-1/2 -translate-y-1/2">↺</div>
              <div className="absolute right-1 top-1/2 -translate-y-1/2">↻</div>
            </div>
          }
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
          label=""
          accentClass="bg-blue-500"
          disabled={!status.isFlying}
          size={isSmallScreen ? 120 : 165}
          knobSize={isSmallScreen ? 46 : 63}
          maxDistance={isSmallScreen ? 34 : 48}
          overlay={
            <div className="pointer-events-none absolute inset-0 text-[11px] font-bold text-gray-600">
              <div className="absolute left-1/2 top-1 -translate-x-1/2">앞</div>
              <div className="absolute left-1/2 bottom-1 -translate-x-1/2">뒤</div>
              <div className="absolute left-1 top-1/2 -translate-y-1/2">좌</div>
              <div className="absolute right-1 top-1/2 -translate-y-1/2">우</div>
            </div>
          }
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

      <div className="pointer-events-none absolute right-4 top-3 z-20 text-base md:text-lg font-bold text-slate-700">
        초등학교 실과 5학년
      </div>

      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[15%] z-20">
        <div className="text-5xl md:text-6xl font-black tracking-tight text-slate-900 drop-shadow-sm text-center leading-tight">
          시뮬레이션으로 배우는 비행
          <br />
          드론 조종 코딩
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
        도구 cursor
      </div>
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState("home");

  return (
    <div className="w-screen h-[100dvh] overflow-hidden relative flex flex-col bg-gray-100">
      {mode !== "home" && (
        <div
          className="fixed z-[170] flex gap-2 bg-white/90 backdrop-blur border rounded-xl p-2 shadow-sm"
          style={{
            right: "calc(8px + env(safe-area-inset-right, 0px))",
            top: "calc(8px + env(safe-area-inset-top, 0px))",
          }}
        >
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