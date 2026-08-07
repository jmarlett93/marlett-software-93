import { debugLog, isLocalDevHost } from '../debug-log';
import { Buoy, RaceCourse, buoyByIndex, nextBuoyIndex } from './course';
import {
  MarkRoundingSpec,
  Point as RoundingPoint,
  RoundingPolygon,
  RoundingSense,
  buildMarkRoundingSpec,
  buildRoundingPolygon,
  crossedEntryGate,
  describeRoundingGeometry,
  furthestUnobstructedRoundingWaypointIndex,
  inEntryPortal,
  monotoneTurnDelta,
  pointSideOfEntryGate,
  shortestPathForRounding,
  pathClearsDisk as roundingPathClearsDisk,
  hullLeaveClearancePx as geometryHullLeaveClearancePx,
  markClearanceRadiusPx as geometryMarkClearanceRadiusPx,
  roundingSenseForMark,
} from './mark-rounding-geometry';
import {
  MELGES_24_TWA_POINTS,
  boatSpeedFromPolar,
  normalizeHeadingDegrees,
  shortestHeadingDelta,
  trueWindAngleDegrees,
} from './polars/melges-24-polar';
import { SailboatState } from './sailboat-state';

export type Tack = 'port' | 'starboard';

export type TackStrategyId = 1;

export const TACK_STRATEGY_OPTIONS: readonly {
  id: TackStrategyId;
  label: string;
  shortLabel: string;
}[] = [{ id: 1, label: 'Replan round + beat', shortLabel: 'Replan' }];

export type StrategyScore = {
  strategy: TackStrategyId;
  value: number;
  detail: string;
};

/** Re-export — CCW = leave to port, CW = leave to starboard. */
export type { RoundingSense } from './mark-rounding-geometry';

/** @deprecated Prefer RoundingSense — port=ccw, starboard=cw. */
export type RoundingSide = 'port' | 'starboard';

export type DriverRoundingPhase = 'approach' | 'rounding' | 'exit';

/**
 * Sailable rounding cone on the far side of a mark.
 * In/Out are gate *lines* to cross — helm aims into the cone, then beyond
 * the exit line (not at the ray-tip vertices).
 */
export type MarkClearTarget = {
  markIndex: 1 | 2 | 3;
  /** Active sail-to (inside cone, or beyond exit / next enter). */
  x: number;
  y: number;
  /** Leave-to ray tip (viz of In gate line). */
  approachX: number;
  approachY: number;
  /** Exit ray tip (viz of Out gate line). */
  exitGateX: number;
  exitGateY: number;
  /** Phase-1 sail-to: on the In gate line (must hit In first). */
  enterAimX: number;
  enterAimY: number;
  /** Aim outside past the Out line (cross Out going here). */
  exitAimX: number;
  exitAimY: number;
  /**
   * Phase-3 sail-to (windward marks): directly downwind of the buoy
   * so the track must pass underneath before aiming the next mark.
   */
  releaseAimX: number;
  releaseAimY: number;
  /** Unit dir along the In ray (from mark). */
  entryDirX: number;
  entryDirY: number;
  /** Unit dir along the Out ray (from mark). */
  exitDirX: number;
  exitDirY: number;
  clearancePx: number;
  sense: RoundingSense;
  side: RoundingSide;
  /** Half-angle from bisector; edges stay near close-hauled / sailable. */
  halfAngleDeg: number;
  bisectorX: number;
  bisectorY: number;
  leaveX: number;
  leaveY: number;
  pastX: number;
  pastY: number;
};

/** T = beat layline; aim = transit target (into cone or beyond Out). */
export type StrategyPointKind = 'tack' | 'aim';

/**
 * outside → entered (cross In) → past-out (cross Out) → rounded
 * (windward: past-out must also reach the downwind release gate).
 */
export type ConeStage = 'outside' | 'entered' | 'past-out';

/** Planned point on a beat / tack route. */
export type StrategyPoint = {
  kind: StrategyPointKind;
  x: number;
  y: number;
  markIndex?: 1 | 2 | 3;
  /** Board sailed on the way to this point. */
  hold?: Tack;
  /** Overlay label (T1, T2, Dest). */
  label?: string;
};

/** Locked single-tack plan: hold CH to T, tack once, fetch target. */
export type OneTackLock = {
  targetX: number;
  targetY: number;
  hold: Tack;
  tackX: number;
  tackY: number;
};

/**
 * Committed beat plan to a no-go destination. Built once, followed until the
 * destination changes or the final aim is reached.
 */
export type TackRoute = {
  targetX: number;
  targetY: number;
  legs: readonly StrategyPoint[];
  legIndex: number;
};

/** Monotonic entry approach: aim first, then through — never flickers back. */
export type EntryApproachStage = 'aim' | 'through';

export type BoatDriverMemory = {
  goalBuoyIndex: 1 | 2 | 3;
  currentTack: Tack | null;
  lastTackAtMs: number;
  lapsCompleted: number;
  strategy: TackStrategyId;
  /** Mark just rounded — first beat leg must not cut back through it. */
  lastRoundedMarkIndex: 1 | 2 | 3 | null;
  /**
   * Sticky planned layline tack point. Helm sails to this on `currentTack`,
   * then tacks once on arrival — no opportunistic tacks.
   */
  laylineTack: { x: number; y: number } | null;
  /** Committed multi-leg tack route (layline geometry) to the destination. */
  tackRoute: TackRoute | null;
  /** @deprecated Prefer tackRoute. */
  oneTackLock: OneTackLock | null;
  /** @deprecated Prefer tackRoute. */
  oneTackDoneTarget: { x: number; y: number } | null;
  /** Entry gate approach stage (aim → through only). */
  entryApproachStage: EntryApproachStage | null;
  /** Sticky cone geometry for the current goal mark. */
  roundingClear: MarkClearTarget | null;
  /** Cone transit: must enter leave-to edge before exit counts. */
  coneStage: ConeStage;
  /** Previous-frame inside-cone flag for edge crossing. */
  coneWasInside: boolean;
  /** Previous frame was outside the cone on the leave/In side of the In gate. */
  coneWasOutsideIn: boolean;
  /** Formal state machine: approach entry gate, then locked polygon round. */
  roundingPhase: DriverRoundingPhase;
  /** Previous signed side of the entry gate; positive means outside/armed. */
  entryGateSide: number | null;
  /** Locked post-entry path around the current rounding mark. */
  roundingPath: RoundingPolygon | null;
  /** Active index into roundingPath.waypoints. */
  roundingWaypointIndex: number;
};

export type DriverPlan = {
  /** Rounding cone for the current goal mark. */
  clearTarget: MarkClearTarget;
  /** Helm aim: T, or transit aim (into cone / beyond Out). */
  activeTarget: { x: number; y: number };
  /** Debug: optional T then current transit aim (not In/Out tips). */
  waypoints: readonly StrategyPoint[];
  sense: RoundingSense;
  side: RoundingSide;
  clearancePx: number;
  goalIsUpwind: boolean;
  /** Fetch transit aim when sailable; otherwise beat via T. */
  legMode: 'fetch' | 'beat';
  /** True when activeTarget is the planned layline tack point. */
  sailingToLayline: boolean;
  coneStage: ConeStage;
  roundingPhase: DriverRoundingPhase;
  roundingPath: RoundingPolygon | null;
};

export type DriverDecision = {
  desiredHeadingDegrees: number;
  memory: BoatDriverMemory;
  reason: string;
  score: StrategyScore;
  plan: DriverPlan;
};

const CLOSE_HAULED_TWA = MELGES_24_TWA_POINTS[0];
const TACK_VMG_HYSTERESIS = 0.12;
const LAYLINE_TOLERANCE_DEG = 10;
const LAYLINE_RAY_CAPTURE_FACTOR = 1.15;
/** Must be near R itself — 0.9×clearance was a huge circle around a far R. */
const CLEAR_CAPTURE_FACTOR = 0.55;
/** Minimum time between intentional tacks — stops wall/leave-to/no-go thrash. */
const MIN_TACK_INTERVAL_MS = 2800;
/** Soft wall: suggest a tack only if we have not tacked recently. */
const WALL_SOFT_TACK_COOLDOWN_MS = 2200;

const TACK_PLAN_MAX = 300;
/** `tack-blocked` fires every helm tick — throttle so it cannot fill the budget. */
const TACK_PLAN_NOISY_INTERVAL_MS = 1200;
let tackPlanLogCount = 0;
let tackPlanNoisyKey = '';
let tackPlanNoisyAtMs = 0;

/** Reset `[tack-plan]` counter (call on race restart). Filter DevTools by that tag. */
export const resetTackPlanLog = (): void => {
  tackPlanLogCount = 0;
  tackPlanNoisyKey = '';
  tackPlanNoisyAtMs = 0;
};

/** Structured tack / one-tack planner log — why we planned, tacked, or dropped a lock. */
export const logTackPlan = (
  boatId: string | null | undefined,
  payload: Record<string, unknown>,
): void => {
  if (!isLocalDevHost()) {
    return;
  }
  const event = String(payload['event'] ?? '');
  // Noisy wait-states: at most ~1/sec per why, and they do not consume the cap.
  if (event === 'tack-blocked') {
    const key = `${boatId ?? ''}|${payload['why']}|${payload['hold'] ?? ''}|${payload['label'] ?? ''}`;
    const now = Date.now();
    if (key === tackPlanNoisyKey && now - tackPlanNoisyAtMs < TACK_PLAN_NOISY_INTERVAL_MS) {
      return;
    }
    tackPlanNoisyKey = key;
    tackPlanNoisyAtMs = now;
    debugLog(
      `[tack-plan ~]`,
      JSON.stringify({
        id: boatId ?? null,
        n: tackPlanLogCount,
        ...payload,
      }),
    );
    return;
  }

  if (tackPlanLogCount >= TACK_PLAN_MAX) {
    return;
  }
  tackPlanLogCount += 1;
  debugLog(
    `[tack-plan ${tackPlanLogCount}/${TACK_PLAN_MAX}]`,
    JSON.stringify({
      id: boatId ?? null,
      n: tackPlanLogCount,
      ...payload,
    }),
  );
};

const xy1 = (x: number, y: number): [number, number] => [
  Math.round(x * 10) / 10,
  Math.round(y * 10) / 10,
];

/**
 * How the boat must leave each mark.
 * - Buoy 1: always port / CCW.
 * - Buoys 2–3: CCW on a left-side course, CW on a right-side course.
 */
export const roundingSenseForGoal = (
  course: Pick<RaceCourse, 'side'>,
  goalIndex: 1 | 2 | 3,
): RoundingSense => roundingSenseForMark(course, goalIndex);

export const roundingSideForGoal = (
  course: Pick<RaceCourse, 'side'>,
  goalIndex: 1 | 2 | 3,
): RoundingSide => (roundingSenseForGoal(course, goalIndex) === 'ccw' ? 'port' : 'starboard');

export const randomTackStrategy = (): TackStrategyId => 1;

export const createBoatDriverMemory = (
  strategy: TackStrategyId = 1,
): BoatDriverMemory => ({
  goalBuoyIndex: 1,
  currentTack: null,
  lastTackAtMs: 0,
  lapsCompleted: 0,
  strategy,
  lastRoundedMarkIndex: null,
  laylineTack: null,
  tackRoute: null,
  oneTackLock: null,
  oneTackDoneTarget: null,
  entryApproachStage: null,
  roundingClear: null,
  coneStage: 'outside',
  coneWasInside: false,
  coneWasOutsideIn: false,
  roundingPhase: 'approach',
  entryGateSide: null,
  roundingPath: null,
  roundingWaypointIndex: 0,
});

/** Previous mark in the 1 → 2 → 3 → 1 loop. */
export const previousBuoyIndex = (current: 1 | 2 | 3): 1 | 2 | 3 => {
  if (current === 1) {
    return 3;
  }
  if (current === 2) {
    return 1;
  }
  return 2;
};

export const bearingDegreesTo = (
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number => {
  const dx = toX - fromX;
  const dy = fromY - toY;
  return normalizeHeadingDegrees((Math.atan2(dx, dy) * 180) / Math.PI);
};

export const distancePx = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(bx - ax, by - ay);

export const markClearanceRadiusPx = (course: Pick<RaceCourse, 'markRadiusPx'>): number =>
  geometryMarkClearanceRadiusPx(course);

/** Hull-safe leave-to offset from mark center. */
export const hullLeaveClearancePx = (course: Pick<RaceCourse, 'markRadiusPx'>): number =>
  geometryHullLeaveClearancePx(course);

const unitVector = (
  from: Pick<Buoy, 'x' | 'y'>,
  to: Pick<Buoy, 'x' | 'y'>,
): { x: number; y: number } => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
};

const headingUnit = (headingDegrees: number): { x: number; y: number } => {
  const radians = (headingDegrees * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
};

const rightOf = (v: { x: number; y: number }): { x: number; y: number } => ({
  x: -v.y,
  y: v.x,
});

const leftOf = (v: { x: number; y: number }): { x: number; y: number } => ({
  x: v.y,
  y: -v.x,
});

/**
 * Leave-to unit from wind + rounding side.
 * Looking upwind: port/CCW = right of the mark; starboard/CW = left.
 * With a wind-aligned course this puts mark‑1 leave-port on the correct side.
 */
export const leaveToDirForMark = (
  mark: Buoy,
  course: RaceCourse,
  windFromDegrees: number = course.windFromDegrees ?? 0,
): { x: number; y: number } => {
  const upwind = headingUnit(windFromDegrees);
  const sense = roundingSenseForGoal(course, mark.index);
  // Reach/leeward marks: wind-frame leave-to can sit inside the triangle.
  // Prefer inbound race geometry there; keep wind-frame for the windward mark.
  if (mark.index !== 1) {
    const prev = buoyByIndex(course, previousBuoyIndex(mark.index));
    const inbound = unitVector(prev, mark);
    return sense === 'ccw' ? rightOf(inbound) : leftOf(inbound);
  }
  return sense === 'ccw' ? rightOf(upwind) : leftOf(upwind);
};

/** Stable “past the mark” axis — not boat-relative (that walked R off-board). */
const pastDirForMark = (
  mark: Buoy,
  course: RaceCourse,
  windFromDegrees: number,
): { x: number; y: number } => {
  const upwind = headingUnit(windFromDegrees);
  if (mark.index === 1) {
    return upwind;
  }
  if (mark.index === 3) {
    return { x: -upwind.x, y: -upwind.y };
  }
  const prev = buoyByIndex(course, previousBuoyIndex(mark.index));
  return unitVector(prev, mark);
};

export const leaveToLateralPx = (
  boat: Pick<Buoy, 'x' | 'y'>,
  mark: Buoy,
  course: RaceCourse,
  windFromDegrees: number = course.windFromDegrees ?? 0,
): number => {
  const leaveDir = leaveToDirForMark(mark, course, windFromDegrees);
  return (boat.x - mark.x) * leaveDir.x + (boat.y - mark.y) * leaveDir.y;
};

const clampToBoardEarly = (
  point: { x: number; y: number },
  course: RaceCourse,
  margin: number,
): { x: number; y: number } => ({
  x: Math.min(course.width - margin, Math.max(margin, point.x)),
  y: Math.min(course.height - margin, Math.max(margin, point.y)),
});

const distPointToSegmentEarly = (
  cx: number,
  cy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) {
    return Math.hypot(cx - ax, cy - ay);
  }
  const t = Math.max(0, Math.min(1, ((cx - ax) * abx + (cy - ay) * aby) / lenSq));
  return Math.hypot(cx - (ax + abx * t), cy - (ay + aby * t));
};

export const pathClearsMark = (
  from: Pick<Buoy, 'x' | 'y'>,
  to: Pick<Buoy, 'x' | 'y'>,
  mark: Pick<Buoy, 'x' | 'y'>,
  exclusionRadiusPx: number,
): boolean =>
  distPointToSegmentEarly(mark.x, mark.y, from.x, from.y, to.x, to.y) >=
  exclusionRadiusPx;

/**
 * Far-side sailable cone for a mark (windward tip / past reach / leeward tip).
 * Half-angle ≈ close-hauled so a boat can sail through on leave-to then out.
 */
export const leaveClearPointForMark = (
  mark: Buoy,
  course: RaceCourse,
  windFromDegrees: number = course.windFromDegrees ?? 0,
  _from?: Pick<Buoy, 'x' | 'y'>,
): MarkClearTarget => {
  const sense = roundingSenseForGoal(course, mark.index);
  const side = sense === 'ccw' ? 'port' : 'starboard';
  const leavePerp = leaveToDirForMark(mark, course, windFromDegrees);
  const pastDir = pastDirForMark(mark, course, windFromDegrees);
  const clearancePx = hullLeaveClearancePx(course);
  const margin = Math.max(28, clearancePx * 0.75);
  // Wide enough to sail through near CH; not so wide that cutting inside counts.
  const halfAngleDeg =
    mark.index === 1
      ? Math.max(CLOSE_HAULED_TWA + 10, 52)
      : Math.max(CLOSE_HAULED_TWA + 14, 55);
  const halfRad = (halfAngleDeg * Math.PI) / 180;
  const c = Math.cos(halfRad);
  const s = Math.sin(halfRad);
  const entryDir = {
    x: pastDir.x * c + leavePerp.x * s,
    y: pastDir.y * c + leavePerp.y * s,
  };
  const exitDir = {
    x: pastDir.x * c - leavePerp.x * s,
    y: pastDir.y * c - leavePerp.y * s,
  };
  const el = Math.hypot(entryDir.x, entryDir.y) || 1;
  const xl = Math.hypot(exitDir.x, exitDir.y) || 1;
  entryDir.x /= el;
  entryDir.y /= el;
  exitDir.x /= xl;
  exitDir.y /= xl;

  // Ray tips = viz of gate lines (not sail-to destinations).
  const rayLen = clearancePx * 3.4;
  const entryTip = clampToBoardEarly(
    {
      x: mark.x + entryDir.x * rayLen,
      y: mark.y + entryDir.y * rayLen,
    },
    course,
    margin,
  );
  const exitTip = clampToBoardEarly(
    {
      x: mark.x + exitDir.x * rayLen,
      y: mark.y + exitDir.y * rayLen,
    },
    course,
    margin,
  );
  // Phase-1 aim sits ON the In ray (clear of buoy) so the plan hits In first.
  const gateDist = clearancePx * 2.35;
  const enterAim = clampToBoardEarly(
    {
      x: mark.x + entryDir.x * gateDist,
      y: mark.y + entryDir.y * gateDist,
    },
    course,
    margin,
  );
  // Phase-2 aim: just past the Out ray (outside the wedge) so the track
  // must cross the Out band — not the Out tip, not the next mark yet.
  const onOutRay = {
    x: mark.x + exitDir.x * gateDist,
    y: mark.y + exitDir.y * gateDist,
  };
  const exitAim = clampToBoardEarly(
    {
      x: onOutRay.x - leavePerp.x * clearancePx * 0.95,
      y: onOutRay.y - leavePerp.y * clearancePx * 0.95,
    },
    course,
    margin,
  );
  // Phase-3 (windward): directly downwind of the mark — boat must pass
  // underneath before the next-leg aim can cut above the buoy.
  const releaseAim = clampToBoardEarly(
    {
      x: mark.x - pastDir.x * clearancePx * 2.2,
      y: mark.y - pastDir.y * clearancePx * 2.2,
    },
    course,
    margin,
  );

  return {
    markIndex: mark.index,
    x: enterAim.x,
    y: enterAim.y,
    approachX: entryTip.x,
    approachY: entryTip.y,
    exitGateX: exitTip.x,
    exitGateY: exitTip.y,
    enterAimX: enterAim.x,
    enterAimY: enterAim.y,
    exitAimX: exitAim.x,
    exitAimY: exitAim.y,
    releaseAimX: releaseAim.x,
    releaseAimY: releaseAim.y,
    entryDirX: entryDir.x,
    entryDirY: entryDir.y,
    exitDirX: exitDir.x,
    exitDirY: exitDir.y,
    clearancePx,
    sense,
    side,
    halfAngleDeg,
    bisectorX: pastDir.x,
    bisectorY: pastDir.y,
    leaveX: leavePerp.x,
    leaveY: leavePerp.y,
    pastX: pastDir.x,
    pastY: pastDir.y,
  };
};

/** Sticky cone for the current goal; refresh if mark changes. */
export const resolveRoundingClear = (
  memory: BoatDriverMemory,
  mark: Buoy,
  course: RaceCourse,
  windFromDegrees: number,
): MarkClearTarget => {
  if (
    memory.roundingClear &&
    memory.roundingClear.markIndex === mark.index &&
    Number.isFinite(memory.roundingClear.halfAngleDeg) &&
    Number.isFinite(memory.roundingClear.enterAimX) &&
    Number.isFinite(memory.roundingClear.releaseAimX) &&
    Number.isFinite(memory.roundingClear.entryDirX) &&
    Number.isFinite(memory.roundingClear.exitDirX)
  ) {
    return memory.roundingClear;
  }
  return leaveClearPointForMark(mark, course, windFromDegrees);
};

/** Leave/past coords of a point in the mark's cone frame. */
export const coneFrameCoords = (
  point: Pick<Buoy, 'x' | 'y'>,
  cone: MarkClearTarget,
  mark: Pick<Buoy, 'x' | 'y'>,
): { leave: number; past: number; dist: number } => {
  const vx = point.x - mark.x;
  const vy = point.y - mark.y;
  return {
    leave: vx * cone.leaveX + vy * cone.leaveY,
    past: vx * cone.pastX + vy * cone.pastY,
    dist: Math.hypot(vx, vy),
  };
};

/**
 * Inside the far-side wedge: past the mark into the cone and within ±halfAngle.
 * Also require clearing the buoy radius so a cut through the mark never counts.
 */
export const boatInsideRoundingCone = (
  boat: Pick<Buoy, 'x' | 'y'>,
  mark: Pick<Buoy, 'x' | 'y'>,
  cone: MarkClearTarget,
): boolean => {
  const { leave, past, dist } = coneFrameCoords(boat, cone, mark);
  if (dist < cone.clearancePx * 0.9) {
    return false;
  }
  if (past < cone.clearancePx * 0.55) {
    return false;
  }
  const halfTan = Math.tan((cone.halfAngleDeg * Math.PI) / 180);
  return Math.abs(leave) <= past * halfTan + 2;
};

/** Outside the cone on the leave/In side of the In gate (ready to cross In). */
export const outsideLeaveOfInGate = (
  point: Pick<Buoy, 'x' | 'y'>,
  mark: Pick<Buoy, 'x' | 'y'>,
  cone: MarkClearTarget,
): boolean => {
  const { leave, past } = coneFrameCoords(point, cone, mark);
  const halfTan = Math.tan((cone.halfAngleDeg * Math.PI) / 180);
  if (past < cone.clearancePx * 0.5) {
    return leave >= cone.clearancePx * 0.35;
  }
  return leave > past * halfTan + 2;
};

/**
 * True if the segment boat→aim first meets the far-side cone on the leave/In
 * half (not by sneaking in via Out or through the buoy).
 */
export const pathApproachesInGateFirst = (
  from: Pick<Buoy, 'x' | 'y'>,
  to: Pick<Buoy, 'x' | 'y'>,
  mark: Pick<Buoy, 'x' | 'y'>,
  cone: MarkClearTarget,
): boolean => {
  const halfTan = Math.tan((cone.halfAngleDeg * Math.PI) / 180);
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const p = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
    const { leave, past, dist } = coneFrameCoords(p, cone, mark);
    if (dist < cone.clearancePx * 0.85) {
      return false;
    }
    if (past < cone.clearancePx * 0.5) {
      continue;
    }
    const inWedge = Math.abs(leave) <= past * halfTan + 2;
    if (inWedge) {
      // First contact with the cone must be on the leave/In half.
      return leave >= -cone.clearancePx * 0.1;
    }
  }
  // Aim is on the In ray — never entered the open wedge along the samples.
  const toFr = coneFrameCoords(to, cone, mark);
  return toFr.leave >= cone.clearancePx * 0.2;
};

/**
 * True if segment from→to leaves the cone across the Out (anti-leave) half.
 * Used after enter so phase-2 aims must cross Out, not skip to the next mark.
 */
export const pathCrossesOutGate = (
  from: Pick<Buoy, 'x' | 'y'>,
  to: Pick<Buoy, 'x' | 'y'>,
  mark: Pick<Buoy, 'x' | 'y'>,
  cone: MarkClearTarget,
): boolean => {
  const halfTan = Math.tan((cone.halfAngleDeg * Math.PI) / 180);
  const steps = 14;
  let sawInside = false;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const p = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
    const { leave, past, dist } = coneFrameCoords(p, cone, mark);
    if (dist < cone.clearancePx * 0.85) {
      return false;
    }
    const inWedge =
      past >= cone.clearancePx * 0.5 && Math.abs(leave) <= past * halfTan + 2;
    if (inWedge) {
      sawInside = true;
      continue;
    }
    if (sawInside && past >= cone.clearancePx * 0.4 && leave < 0) {
      return true;
    }
  }
  // Destination itself is outside on the Out side.
  const toFr = coneFrameCoords(to, cone, mark);
  return (
    sawInside &&
    toFr.leave < -cone.clearancePx * 0.25 &&
    toFr.past >= cone.clearancePx * 0.4
  );
};

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Geometry dump for `[round-poly]` — entry/exit/sweep/waypoints. */
export const buildRoundGeoSnapshot = (
  boat: Pick<SailboatState, 'x' | 'y' | 'headingDegrees' | 'windFromDegrees' | 'id'>,
  memory: BoatDriverMemory,
  course: RaceCourse,
): Record<string, unknown> => {
  const spec = buildMarkRoundingSpec(course, memory.goalBuoyIndex);
  const pose = {
    x: boat.x,
    y: boat.y,
    headingDegrees: boat.headingDegrees,
  };
  const polygon = memory.roundingPath ?? buildRoundingPolygon(spec, pose);
  return {
    id: boat.id ?? null,
    phase: memory.roundingPhase,
    wpIndex: memory.roundingWaypointIndex,
    ...describeRoundingGeometry(spec, pose, polygon),
  };
};

/**
 * Advance by formal entry-gate → locked polygon. No mark-role release gates:
 * a round completes when the locked path has carried the boat around the
 * clearance disk and the exit-to-next leg is clear.
 */
export const advanceGoalIfClearReached = (
  memory: BoatDriverMemory,
  boat: Pick<SailboatState, 'x' | 'y' | 'windFromDegrees' | 'headingDegrees' | 'id'>,
  course: RaceCourse,
): BoatDriverMemory => {
  const goal = buoyByIndex(course, memory.goalBuoyIndex);
  const windFrom = boat.windFromDegrees ?? course.windFromDegrees ?? 0;
  const cone = resolveRoundingClear(memory, goal, course, windFrom);
  const spec = buildMarkRoundingSpec(course, goal.index);
  const phase = memory.roundingPhase ?? 'approach';
  const capturePx = Math.max(cone.clearancePx * 0.55, 24);
  const boatPoint = { x: boat.x, y: boat.y };

  const completeRound = (path: RoundingPolygon | null): BoatDriverMemory => {
    const roundedMark = memory.goalBuoyIndex;
    const next = nextBuoyIndex(roundedMark);
    const lapsCompleted =
      roundedMark === 3 ? memory.lapsCompleted + 1 : memory.lapsCompleted;
    const role =
      roundedMark === 1 ? 'windward' : roundedMark === 3 ? 'leeward' : 'reach';
    const exitPoint = path?.exitPoint ?? boatPoint;

    debugLog(
      `[rounded] ${boat.id ?? '?'} mark ${roundedMark} (${role}) → ${next}`,
      JSON.stringify({
        id: boat.id ?? null,
        mark: roundedMark,
        role,
        nextGoal: next,
        lapsCompleted,
        via: 'entry-polygon',
        pos: [r1(boat.x), r1(boat.y)],
        markXY: [r1(goal.x), r1(goal.y)],
        exitXY: [r1(exitPoint.x), r1(exitPoint.y)],
        clearancePx: r1(spec.clearancePx),
        sense: spec.sense,
        courseSide: course.side,
        windFrom: r1(windFrom),
      }),
    );

    return {
      ...memory,
      goalBuoyIndex: next,
      lastRoundedMarkIndex: roundedMark,
      currentTack: null,
      laylineTack: null,
      tackRoute: null,
      oneTackLock: null,
      oneTackDoneTarget: null,
      entryApproachStage: null,
      roundingClear: null,
      coneStage: 'outside',
      coneWasInside: false,
      coneWasOutsideIn: false,
      roundingPhase: 'approach',
      entryGateSide: null,
      roundingPath: null,
      roundingWaypointIndex: 0,
      lapsCompleted,
    };
  };

  if (phase === 'rounding' && memory.roundingPath) {
    const path = memory.roundingPath;
    let waypointIndex = memory.roundingWaypointIndex ?? 0;
    const vertices = shortestPathForRounding(path);

    while (
      waypointIndex < vertices.length &&
      distancePx(boat.x, boat.y, vertices[waypointIndex].x, vertices[waypointIndex].y) <=
        capturePx
    ) {
      waypointIndex += 1;
    }

    // Among the next N rounding waypoints (clamped if fewer), aim at the
    // farthest clear chord; prefer one that is fetchable (no tack).
    // Exit is excluded until the boat is on the arc (see pick).
    waypointIndex = pickRoundingWaypointIndex(
      boatPoint,
      vertices,
      waypointIndex,
      spec,
      windFrom,
      capturePx,
    );

    const pastExit =
      waypointIndex >= vertices.length ||
      distancePx(boat.x, boat.y, path.exitPoint.x, path.exitPoint.y) <= capturePx;
    if (pastExit) {
      const nextClear = roundingPathClearsDisk(
        boatPoint,
        path.nextAim,
        spec.mark,
        spec.clearancePx,
        1,
      );
      if (nextClear) {
        return completeRound(path);
      }
      return {
        ...memory,
        roundingClear: cone,
        roundingPhase: 'rounding',
        roundingPath: path,
        roundingWaypointIndex: Math.max(waypointIndex, vertices.length - 1),
        coneStage: 'entered',
        coneWasInside: false,
        coneWasOutsideIn: false,
      };
    }

    return {
      ...memory,
      roundingClear: cone,
      roundingPhase: 'rounding',
      roundingPath: path,
      roundingWaypointIndex: waypointIndex,
      coneStage: 'entered',
      coneWasInside: false,
      coneWasOutsideIn: false,
    };
  }

  const side = pointSideOfEntryGate(boatPoint, spec.entryGate);
  // Latch the strongest outside reading. crossedEntryGate needs previousSide > 2,
  // but storing only the last frame misses a slow creep (3 → 1 → −1).
  const outsideLatch =
    side > 0
      ? Math.max(memory.entryGateSide ?? side, side)
      : memory.entryGateSide;
  const portal = inEntryPortal(boatPoint, spec);
  const crossed = crossedEntryGate(outsideLatch, side);
  // Hard arm: In-cross at the portal. Soft arm: already proven outside, now
  // inside at the portal (covers remote half-plane crosses that later reach
  // Entry). Never arm on a distant gate-plane cross — that skipped Entry and
  // Exit-fetched from the wrong pose.
  const softArm =
    portal && side <= 0 && outsideLatch !== null && outsideLatch > 2;
  const arm = (crossed && portal) || softArm;
  if (!arm) {
    return {
      ...memory,
      roundingClear: {
        ...cone,
        enterAimX: spec.entryGate.aim.x,
        enterAimY: spec.entryGate.aim.y,
        approachX: spec.entryGate.tip.x,
        approachY: spec.entryGate.tip.y,
        exitAimX: spec.entryGate.through.x,
        exitAimY: spec.entryGate.through.y,
        x: side > spec.clearancePx * 0.35
          ? spec.entryGate.aim.x
          : spec.entryGate.through.x,
        y: side > spec.clearancePx * 0.35
          ? spec.entryGate.aim.y
          : spec.entryGate.through.y,
      },
      roundingPhase: 'approach',
      // Keep outside peak even while briefly/wrongly on the inside half-plane
      // so a later soft-arm at the portal still works.
      entryGateSide: outsideLatch ?? side,
      roundingPath: null,
      roundingWaypointIndex: 0,
      coneStage: 'outside',
      coneWasInside: false,
      coneWasOutsideIn: side > 0 || (outsideLatch ?? 0) > 2,
    };
  }

  const pose = {
    x: boat.x,
    y: boat.y,
    headingDegrees: boat.headingDegrees,
  };
  const roundingPath = buildRoundingPolygon(spec, pose);
  const vertices = shortestPathForRounding(roundingPath);
  // On arm always start at the first vertex. Exit look-ahead runs only in
  // mid-round advance — skipping to Exit at the gate-cross pose (often still
  // north of through) commanded a fetch that stalled the boat.
  const waypointIndex = 0;
  const active =
    vertices[waypointIndex] ??
    roundingPath.exitPoint;
  debugLog(
    `[round-poly] ${boat.id ?? '?'} armed mark ${goal.index}`,
    JSON.stringify({
      ...describeRoundingGeometry(spec, pose, roundingPath),
      armWp: waypointIndex,
      armActive: [r1(active.x), r1(active.y)],
    }),
  );

  return {
    ...memory,
    currentTack: null,
    laylineTack: null,
    tackRoute: null,
    oneTackLock: null,
    oneTackDoneTarget: null,
    entryApproachStage: null,
    roundingClear: {
      ...cone,
      enterAimX: spec.entryGate.aim.x,
      enterAimY: spec.entryGate.aim.y,
      approachX: spec.entryGate.tip.x,
      approachY: spec.entryGate.tip.y,
      exitAimX: roundingPath.exitPoint.x,
      exitAimY: roundingPath.exitPoint.y,
      x: active.x,
      y: active.y,
    },
    roundingPhase: 'rounding',
    roundingPath,
    roundingWaypointIndex: waypointIndex,
    entryGateSide: null,
    coneStage: 'entered',
    coneWasInside: false,
    coneWasOutsideIn: false,
  };
};

/** @deprecated Use advanceGoalIfClearReached. */
export const updateGoalIfRounded = advanceGoalIfClearReached;

/** Approach tip of the leave-to cone edge (debug / legacy). */
export const leaveApproachPointForMark = (
  mark: Buoy,
  course: RaceCourse,
  windFromDegrees: number = 0,
  from?: Pick<Buoy, 'x' | 'y'>,
): { x: number; y: number } => {
  const clear = leaveClearPointForMark(mark, course, windFromDegrees, from);
  return { x: clear.enterAimX, y: clear.enterAimY };
};

export const boatOnLeaveToSide = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  mark: Buoy,
  course: RaceCourse,
): boolean => leaveToLateralPx(boat, mark, course) >= hullLeaveClearancePx(course) * 0.4;

const reachedPoint = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  point: Pick<Buoy, 'x' | 'y'>,
  capturePx: number,
): boolean => distancePx(boat.x, boat.y, point.x, point.y) <= capturePx;

/**
 * Tack when the boat *center* is at T — not when the bow brushes the marker.
 * Old capture (~0.9 × clearance ≈ 28px) exceeded bow offset (~20px), so the
 * tack fired early and the post-tack bearing was pinched.
 */
const TACK_POINT_CENTER_CAPTURE_PX = 8;

export const centerReachedTackPoint = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  tackPt: Pick<Buoy, 'x' | 'y'>,
  holdHeadingDegrees: number,
  capturePx: number = TACK_POINT_CENTER_CAPTURE_PX,
): boolean => {
  if (reachedPoint(boat, tackPt, capturePx)) {
    return true;
  }
  // Physics step may skip the tight bubble — treat T beside/aft on the hold
  // board as reached.
  const dir = headingUnit(holdHeadingDegrees);
  const toX = tackPt.x - boat.x;
  const toY = tackPt.y - boat.y;
  const ahead = toX * dir.x + toY * dir.y;
  const perp = Math.abs(toX * dir.y - toY * dir.x);
  return ahead <= capturePx && perp <= capturePx * 1.5;
};

/**
 * Close-hauled ray: misses the exclusion zone and passes with the mark on
 * the leave-to side (used to decide whether a tack is valid).
 */
export const closeHauledClearsMarkOnLeaveToSide = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  mark: Buoy,
  course: RaceCourse,
  windFromDegrees: number,
  tack: Tack,
): boolean => {
  const clearance = hullLeaveClearancePx(course);
  const heading = closeHauledHeadings(windFromDegrees)[tack];
  const dir = headingUnit(heading);
  const toMarkX = mark.x - boat.x;
  const toMarkY = mark.y - boat.y;
  const ahead = toMarkX * dir.x + toMarkY * dir.y;
  if (ahead < 1) {
    return leaveToLateralPx(boat, mark, course, windFromDegrees) >= clearance * 0.4;
  }
  const closest = {
    x: boat.x + dir.x * ahead,
    y: boat.y + dir.y * ahead,
  };
  const miss = distancePx(closest.x, closest.y, mark.x, mark.y);
  if (miss < clearance) {
    return false;
  }
  return leaveToLateralPx(closest, mark, course, windFromDegrees) >= clearance * 0.4;
};

/**
 * Intersect boat sailing headingA with the layline through target approached
 * on headingApproach (close-hauled opposite tack). Returns null if no useful
 * tack point lies ahead of the boat and short of the target.
 */
const intersectLaylineTack = (
  boat: Pick<Buoy, 'x' | 'y'>,
  sailHeading: number,
  target: Pick<Buoy, 'x' | 'y'>,
  approachHeading: number,
  minLegPx: number,
): { x: number; y: number } | null => {
  const da = headingUnit(sailHeading);
  // Layline = points from which sailing `approachHeading` reaches target:
  // target - u * approachDir  (u > 0 back along the approach).
  const approach = headingUnit(approachHeading);
  const db = { x: -approach.x, y: -approach.y };
  const det = da.x * db.y - da.y * db.x;
  if (Math.abs(det) < 1e-8) {
    return null;
  }
  const dx = target.x - boat.x;
  const dy = target.y - boat.y;
  const t = (dx * db.y - dy * db.x) / det;
  const u = (dx * da.y - dy * da.x) / det;
  if (t < minLegPx || u < minLegPx) {
    return null;
  }
  return { x: boat.x + da.x * t, y: boat.y + da.y * t };
};

const clampToBoard = (
  point: { x: number; y: number },
  course: RaceCourse,
  margin: number,
): { x: number; y: number } => ({
  x: Math.min(course.width - margin, Math.max(margin, point.x)),
  y: Math.min(course.height - margin, Math.max(margin, point.y)),
});

const edgeClearancePx = (
  point: Pick<Buoy, 'x' | 'y'>,
  course: RaceCourse,
): number =>
  Math.min(
    point.x,
    course.width - point.x,
    point.y,
    course.height - point.y,
  );

/** T must sit well inside the board — never on the wall clamp. */
const laylineWallMarginPx = (
  course: RaceCourse,
  clearancePx: number,
): number => Math.max(clearancePx * 2.4, wallMarginPx(course) * 0.65);

/**
 * Comfortable upwind ladder band: centered on the wind axis through mark 1,
 * short of the mark, keeping clear of mark 2 / walls.
 */
const upwindCorridorHalfWidthPx = (
  course: RaceCourse,
  mark1: Buoy,
  clearancePx: number,
): number => {
  const mark2 = buoyByIndex(course, 2);
  const toSide = distancePx(mark1.x, mark1.y, mark2.x, mark2.y);
  const board = Math.min(course.width, course.height);
  return Math.max(
    clearancePx * 2.5,
    Math.min(toSide * 0.3, board * 0.2, clearancePx * 5.5),
  );
};

const windAxes = (
  windFromDegrees: number,
): { upwind: { x: number; y: number }; across: { x: number; y: number } } => {
  const upwind = headingUnit(windFromDegrees);
  return { upwind, across: rightOf(upwind) };
};

const acrossFromMark = (
  point: Pick<Buoy, 'x' | 'y'>,
  mark: Pick<Buoy, 'x' | 'y'>,
  across: { x: number; y: number },
): number => (point.x - mark.x) * across.x + (point.y - mark.y) * across.y;

const upwindFromMark = (
  point: Pick<Buoy, 'x' | 'y'>,
  mark: Pick<Buoy, 'x' | 'y'>,
  upwind: { x: number; y: number },
): number => (point.x - mark.x) * upwind.x + (point.y - mark.y) * upwind.y;

/** True when point is inside the mid-course beat lane downwind of mark 1. */
const inUpwindCorridor = (
  point: Pick<Buoy, 'x' | 'y'>,
  mark1: Buoy,
  course: RaceCourse,
  windFromDegrees: number,
  clearancePx: number,
): boolean => {
  const { upwind, across } = windAxes(windFromDegrees);
  const half = upwindCorridorHalfWidthPx(course, mark1, clearancePx);
  const lat = Math.abs(acrossFromMark(point, mark1, across));
  const along = upwindFromMark(point, mark1, upwind);
  // Must stay downwind of the mark (negative along) with room to round.
  if (along > -clearancePx * 1.2) {
    return false;
  }
  if (lat > half) {
    return false;
  }
  return edgeClearancePx(point, course) >= laylineWallMarginPx(course, clearancePx);
};

const pointClearsOtherBuoys = (
  point: Pick<Buoy, 'x' | 'y'>,
  course: RaceCourse,
  goalIndex: 1 | 2 | 3,
  clearancePx: number,
): boolean => {
  for (const buoy of course.buoys) {
    if (buoy.index === goalIndex) {
      continue;
    }
    if (distancePx(point.x, point.y, buoy.x, buoy.y) < clearancePx * 1.6) {
      return false;
    }
  }
  return true;
};

const pathClearsOtherBuoys = (
  from: Pick<Buoy, 'x' | 'y'>,
  to: Pick<Buoy, 'x' | 'y'>,
  course: RaceCourse,
  goalIndex: 1 | 2 | 3,
  clearancePx: number,
): boolean => {
  for (const buoy of course.buoys) {
    if (buoy.index === goalIndex) {
      continue;
    }
    if (!pathClearsMark(from, to, buoy, clearancePx * 1.35)) {
      return false;
    }
  }
  return true;
};

/**
 * If sailing `heading` from the boat, does the ray clip another buoy?
 * Returns range-to-hit along the ray when a collision is predicted.
 */
const predictedBuoyCollisionAlongHeading = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  headingDegrees: number,
  course: RaceCourse,
  goalIndex: 1 | 2 | 3,
  clearancePx: number,
  maxLookPx: number,
): { buoy: Buoy; rangePx: number } | null => {
  const dir = headingUnit(headingDegrees);
  let best: { buoy: Buoy; rangePx: number } | null = null;
  for (const buoy of course.buoys) {
    if (buoy.index === goalIndex) {
      continue;
    }
    const toX = buoy.x - boat.x;
    const toY = buoy.y - boat.y;
    const ahead = toX * dir.x + toY * dir.y;
    if (ahead < clearancePx * 0.4 || ahead > maxLookPx) {
      continue;
    }
    const closest = {
      x: boat.x + dir.x * ahead,
      y: boat.y + dir.y * ahead,
    };
    const miss = distancePx(closest.x, closest.y, buoy.x, buoy.y);
    if (miss >= clearancePx) {
      continue;
    }
    // Tack before contact — trigger with a little runway.
    const rangePx = Math.max(0, ahead - clearancePx * 1.1);
    if (!best || rangePx < best.rangePx) {
      best = { buoy, rangePx };
    }
  }
  return best;
};

/** Tack if the current close-hauled vector is about to hit another buoy. */
const buoyAvoidanceTack = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  course: RaceCourse,
  hold: Tack,
  goalIndex: 1 | 2 | 3,
  clearancePx: number,
  windFromDegrees: number,
  nowMs: number,
  lastTackAtMs: number,
  aim?: Pick<Buoy, 'x' | 'y'> | null,
): Tack | null => {
  if (nowMs - (lastTackAtMs || 0) < 700) {
    return null;
  }
  const headings = closeHauledHeadings(windFromDegrees);
  const look = Math.max(
    clearancePx * 10,
    Math.min(course.width, course.height) * 0.45,
  );
  const hit = predictedBuoyCollisionAlongHeading(
    boat,
    headings[hold],
    course,
    goalIndex,
    clearancePx,
    look,
  );
  if (!hit) {
    // Also: plotted aim vector boat→T/R may clip a buoy even if CH ray is clean.
    if (aim) {
      for (const buoy of course.buoys) {
        if (buoy.index === goalIndex) {
          continue;
        }
        if (!pathClearsMark(boat, aim, buoy, clearancePx)) {
          return hold === 'port' ? 'starboard' : 'port';
        }
      }
    }
    return null;
  }
  // Only tack once we're closing in on the predicted hit.
  if (hit.rangePx > clearancePx * 4.5) {
    return null;
  }
  return hold === 'port' ? 'starboard' : 'port';
};

/**
 * Ladder T: where the hold close-hauled ray hits the beat-corridor edge
 * (or would clip another buoy) — keeps short mid-course tacks.
 */
const corridorEdgeTackPoint = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  mark1: Buoy,
  course: RaceCourse,
  windFromDegrees: number,
  holdTack: Tack,
  clearancePx: number,
  entryAim?: Pick<Buoy, 'x' | 'y'>,
): StrategyPoint | null => {
  const headings = closeHauledHeadings(windFromDegrees);
  const holdDir = headingUnit(headings[holdTack]);
  const { across } = windAxes(windFromDegrees);
  const half = upwindCorridorHalfWidthPx(course, mark1, clearancePx);
  const wallMargin = laylineWallMarginPx(course, clearancePx);
  const acrossRate = holdDir.x * across.x + holdDir.y * across.y;
  if (Math.abs(acrossRate) < 0.08) {
    return null;
  }
  const boatAcross = acrossFromMark(boat, mark1, across);
  // Sail toward the corridor edge this tack is taking us to.
  const edge = acrossRate > 0 ? half : -half;
  const tLat = (edge - boatAcross) / acrossRate;
  if (tLat < clearancePx * 0.8) {
    return null;
  }

  // Walk along the ray; stop at corridor edge, wall, other buoy, or entry layline.
  const step = Math.max(12, clearancePx * 0.35);
  let dist = Math.min(tLat, clearancePx * 8);
  let best: { x: number; y: number } | null = null;
  for (let d = clearancePx * 0.9; d <= dist + 0.1; d += step) {
    const p = { x: boat.x + holdDir.x * d, y: boat.y + holdDir.y * d };
    if (edgeClearancePx(p, course) < wallMargin) {
      break;
    }
    if (!pointClearsOtherBuoys(p, course, 1, clearancePx)) {
      break;
    }
    if (!inUpwindCorridor(p, mark1, course, windFromDegrees, clearancePx)) {
      // Last in-corridor point is the tack.
      break;
    }
    // Never plot a T past the formal entry layline.
    if (
      entryAim &&
      overstandPastLaylinePx(p, entryAim, windFromDegrees, holdTack) >
        clearancePx * 0.1
    ) {
      break;
    }
    best = p;
  }
  if (!best) {
    return null;
  }
  return { kind: 'tack', x: best.x, y: best.y };
};

/**
 * Planned layline T: hold-tack ray ∩ opposite layline through R.
 * Walks out until T→R clears the mark, and refuses wall-hugging points.
 */
const optionalLaylineTackPoint = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  rounding: MarkClearTarget,
  course: RaceCourse,
  windFromDegrees: number,
  holdTack: Tack,
): StrategyPoint | null => {
  const headings = closeHauledHeadings(windFromDegrees);
  const other: Tack = holdTack === 'port' ? 'starboard' : 'port';
  const mark = buoyByIndex(course, rounding.markIndex);
  const minLeg = Math.max(rounding.clearancePx * 1.2, 32);
  const hit = intersectLaylineTack(
    boat,
    headings[holdTack],
    rounding,
    headings[other],
    minLeg,
  );
  if (!hit) {
    return null;
  }

  const wallMargin = laylineWallMarginPx(course, rounding.clearancePx);
  const holdDir = headingUnit(headings[holdTack]);
  const step = rounding.clearancePx * 0.9;
  let tackPt = { ...hit };
  if (edgeClearancePx(tackPt, course) < wallMargin) {
    return null;
  }

  for (let i = 0; i < 14; i += 1) {
    if (edgeClearancePx(tackPt, course) < wallMargin) {
      return null;
    }
    if (!pointClearsOtherBuoys(tackPt, course, mark.index, rounding.clearancePx)) {
      return null;
    }
    const legClears =
      pathClearsMark(tackPt, rounding, mark, rounding.clearancePx) &&
      pathClearsOtherBuoys(
        tackPt,
        rounding,
        course,
        mark.index,
        rounding.clearancePx,
      );
    const rayClears = closeHauledClearsMarkOnLeaveToSide(
      tackPt,
      mark,
      course,
      windFromDegrees,
      other,
    );
    if (legClears && rayClears) {
      return { kind: 'tack', x: tackPt.x, y: tackPt.y };
    }
    const next = {
      x: tackPt.x + holdDir.x * step,
      y: tackPt.y + holdDir.y * step,
    };
    if (edgeClearancePx(next, course) < wallMargin) {
      return null;
    }
    tackPt = next;
  }
  return null;
};

/**
 * Upwind to mark 1: ladder inside the mid-course corridor until a safe
 * final layline to R fits in that band; otherwise short corridor-edge T.
 */
const acceptPlottedT = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  tackPt: StrategyPoint | null,
  course: RaceCourse,
  goalIndex: 1 | 2 | 3,
  clearancePx: number,
): StrategyPoint | null => {
  if (!tackPt) {
    return null;
  }
  // Reject any T whose sailing vector from here clips another buoy.
  if (
    !pathClearsOtherBuoys(boat, tackPt, course, goalIndex, clearancePx)
  ) {
    return null;
  }
  return tackPt;
};

const planBeatTackPoint = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  rounding: MarkClearTarget,
  course: RaceCourse,
  windFromDegrees: number,
  holdTack: Tack,
): StrategyPoint | null => {
  if (rounding.markIndex === 1) {
    const mark1 = buoyByIndex(course, 1);
    const entry = formalEntryAim(course, 1);
    const { upwind } = windAxes(windFromDegrees);
    const half = upwindCorridorHalfWidthPx(
      course,
      mark1,
      rounding.clearancePx,
    );
    const boatAlong = upwindFromMark(boat, mark1, upwind);
    // Close enough to the mark: allow the real layline onto R.
    const finalApproach = boatAlong > -half * 1.85;
    const layline = optionalLaylineTackPoint(
      boat,
      rounding,
      course,
      windFromDegrees,
      holdTack,
    );
    if (
      layline &&
      tackPointRespectsEntryLayline(
        layline,
        boat,
        entry,
        mark1,
        course,
        windFromDegrees,
        holdTack,
        rounding.clearancePx,
      ) &&
      pointClearsOtherBuoys(layline, course, 1, rounding.clearancePx) &&
      edgeClearancePx(layline, course) >=
        laylineWallMarginPx(course, rounding.clearancePx) &&
      (finalApproach ||
        inUpwindCorridor(
          layline,
          mark1,
          course,
          windFromDegrees,
          rounding.clearancePx,
        ))
    ) {
      return acceptPlottedT(
        boat,
        layline,
        course,
        1,
        rounding.clearancePx,
      );
    }
    const edge = corridorEdgeTackPoint(
      boat,
      mark1,
      course,
      windFromDegrees,
      holdTack,
      rounding.clearancePx,
      entry,
    );
    if (
      edge &&
      !tackPointRespectsEntryLayline(
        edge,
        boat,
        entry,
        mark1,
        course,
        windFromDegrees,
        holdTack,
        rounding.clearancePx,
      )
    ) {
      return null;
    }
    return acceptPlottedT(boat, edge, course, 1, rounding.clearancePx);
  }
  return acceptPlottedT(
    boat,
    optionalLaylineTackPoint(
      boat,
      rounding,
      course,
      windFromDegrees,
      holdTack,
    ),
    course,
    rounding.markIndex,
    rounding.clearancePx,
  );
};

/** Pick an approach tack that stays in the beat corridor / off walls. */
const chooseLaylineApproach = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  rounding: MarkClearTarget,
  course: RaceCourse,
  windFromDegrees: number,
  tws: number,
): { tack: Tack; tackPoint: StrategyPoint | null } => {
  const headings = closeHauledHeadings(windFromDegrees);
  const mark = buoyByIndex(course, rounding.markIndex);
  const { across } = windAxes(windFromDegrees);
  const boatAcross = acrossFromMark(boat, mark, across);
  // Prefer the tack that sails back toward the wind-axis middle.
  let preferred: Tack = boatAcross >= 0 ? 'port' : 'starboard';
  if (rounding.markIndex === 1) {
    const entry = formalEntryAim(course, 1);
    preferred = preferredEntryApproachTack(
      boat,
      entry,
      mark,
      course,
      windFromDegrees,
    );
  }
  const other: Tack = preferred === 'port' ? 'starboard' : 'port';
  const tPreferred = planBeatTackPoint(
    boat,
    rounding,
    course,
    windFromDegrees,
    preferred,
  );
  const tOther = planBeatTackPoint(
    boat,
    rounding,
    course,
    windFromDegrees,
    other,
  );
  if (tPreferred) {
    return { tack: preferred, tackPoint: tPreferred };
  }
  if (tOther) {
    return { tack: other, tackPoint: tOther };
  }
  void tws;
  const look = wallMarginPx(course) * 1.6;
  const portClear = wallClearanceForHeading(boat, course, headings.port, look);
  const stbdClear = wallClearanceForHeading(
    boat,
    course,
    headings.starboard,
    look,
  );
  const safer: Tack = portClear >= stbdClear ? 'port' : 'starboard';
  return {
    tack: safer === preferred || stbdClear === portClear ? preferred : safer,
    tackPoint: null,
  };
};

/**
 * Strategy:
 *  1) Approach the course-derived entry gate.
 *  2) After entry, follow the locked monotone rounding polygon.
 */
export const buildRaceStrategy = (
  boat: Pick<SailboatState, 'x' | 'y' | 'windFromDegrees' | 'trueWindSpeedKnots'>,
  memory: BoatDriverMemory,
  course: RaceCourse,
): DriverPlan => {
  const windFrom = boat.windFromDegrees;
  const goal = buoyByIndex(course, memory.goalBuoyIndex);
  const rounding = resolveRoundingClear(memory, goal, course, windFrom);
  const roundingPhase = memory.roundingPhase ?? 'approach';
  const coneStage: ConeStage = roundingPhase === 'rounding' ? 'entered' : 'outside';

  if (roundingPhase === 'rounding' && memory.roundingPath) {
    const path = memory.roundingPath;
    const targets = shortestPathForRounding(path);
    const idx = memory.roundingWaypointIndex ?? 0;
    const active = idx < targets.length ? targets[idx] : path.nextAim;
    const remaining = targets.slice(idx).map((point) => ({
      kind: 'aim' as const,
      x: point.x,
      y: point.y,
      markIndex: rounding.markIndex,
    }));
    if (idx >= targets.length) {
      remaining.push({
        kind: 'aim',
        x: path.nextAim.x,
        y: path.nextAim.y,
        markIndex: rounding.markIndex,
      });
    }
    const clearTarget: MarkClearTarget = {
      ...rounding,
      x: active.x,
      y: active.y,
      exitAimX: path.exitPoint.x,
      exitAimY: path.exitPoint.y,
      releaseAimX: path.nextAim.x,
      releaseAimY: path.nextAim.y,
      approachX: path.entryPoint.x,
      approachY: path.entryPoint.y,
    };
    return {
      clearTarget,
      activeTarget: { x: active.x, y: active.y },
      waypoints: remaining,
      sense: rounding.sense,
      side: rounding.side,
      clearancePx: rounding.clearancePx,
      goalIsUpwind: false,
      legMode: 'fetch',
      sailingToLayline: false,
      coneStage,
      roundingPhase,
      roundingPath: path,
    };
  }

  // Approach: outside leave-to aim, then through the gate (forces In cross).
  const formal = buildMarkRoundingSpec(course, goal.index);
  // Sail to Entry (aim) until stage advances or the boat is actually at aim.
  // Do not flip Dest to through from gateSide alone — that fired far up the
  // board, dropped a committed T1, and replotted a T past the entry side.
  const stage = memory.entryApproachStage ?? 'aim';
  const dAim = distancePx(
    boat.x,
    boat.y,
    formal.entryGate.aim.x,
    formal.entryGate.aim.y,
  );
  const atEntryAim =
    stage === 'through' || dAim <= formal.clearancePx * 1.05;
  const gate = atEntryAim
    ? {
        x: formal.entryGate.through.x,
        y: formal.entryGate.through.y,
      }
    : {
        x: formal.entryGate.aim.x,
        y: formal.entryGate.aim.y,
      };

  const laylineTarget: MarkClearTarget = {
    ...rounding,
    x: gate.x,
    y: gate.y,
    enterAimX: formal.entryGate.aim.x,
    enterAimY: formal.entryGate.aim.y,
    approachX: formal.entryGate.tip.x,
    approachY: formal.entryGate.tip.y,
    exitAimX: formal.entryGate.through.x,
    exitAimY: formal.entryGate.through.y,
  };

  const bearing = bearingDegreesTo(boat.x, boat.y, gate.x, gate.y);
  const pathOk = pathClearsMark(boat, gate, goal, rounding.clearancePx * 1.1);
  const prevOk =
    memory.lastRoundedMarkIndex == null ||
    pathClearsMark(
      boat,
      gate,
      buoyByIndex(course, memory.lastRoundedMarkIndex),
      rounding.clearancePx * 0.9,
    );
  // Formal entry gate owns In-crossing; don't block fetch with old cone In-first.
  const canFetch =
    canFetchMarkDirectly(bearing, windFrom) && pathOk && prevOk;
  const goalIsUpwind = !canFetch;

  const aimPt: StrategyPoint = {
    kind: 'aim',
    x: gate.x,
    y: gate.y,
    markIndex: rounding.markIndex,
  };

  if (!goalIsUpwind) {
    return {
      clearTarget: laylineTarget,
      activeTarget: { x: gate.x, y: gate.y },
      waypoints: [aimPt],
      sense: rounding.sense,
      side: rounding.side,
      clearancePx: rounding.clearancePx,
      goalIsUpwind,
      legMode: 'fetch',
      sailingToLayline: false,
      coneStage,
      roundingPhase,
      roundingPath: null,
    };
  }

  // Committed tack route owns the overlay while following T legs (even if Dest
  // has nudged aim→through).
  if (
    memory.tackRoute &&
    (tackRouteMatchesTarget(memory.tackRoute, gate) ||
      tackRouteOnTackLeg(memory.tackRoute))
  ) {
    const remaining = memory.tackRoute.legs.slice(memory.tackRoute.legIndex);
    const head = remaining[0] ?? aimPt;
    return {
      clearTarget: laylineTarget,
      activeTarget: { x: head.x, y: head.y },
      waypoints: remaining.length > 0 ? remaining : [aimPt],
      sense: rounding.sense,
      side: rounding.side,
      clearancePx: rounding.clearancePx,
      goalIsUpwind,
      legMode: 'beat',
      sailingToLayline: head.kind === 'tack',
      coneStage,
      roundingPhase,
      roundingPath: null,
    };
  }

  const hold =
    memory.currentTack ??
    chooseBetterTack(windFrom, boat.trueWindSpeedKnots, bearing, null);

  let tackPt: StrategyPoint | null = memory.laylineTack
    ? { kind: 'tack', x: memory.laylineTack.x, y: memory.laylineTack.y }
    : planBeatTackPoint(boat, laylineTarget, course, windFrom, hold);

  if (tackPt && memory.laylineTack) {
    const dir = headingUnit(closeHauledHeadings(windFrom)[hold]);
    const ahead =
      (tackPt.x - boat.x) * dir.x + (tackPt.y - boat.y) * dir.y;
    const mark1 = buoyByIndex(course, 1);
    const outsideCorridor =
      rounding.markIndex === 1 &&
      !inUpwindCorridor(
        tackPt,
        mark1,
        course,
        windFrom,
        rounding.clearancePx,
      );
    const pastEntryLayline =
      rounding.markIndex === 1 &&
      !tackPointRespectsEntryLayline(
        tackPt,
        boat,
        gate,
        mark1,
        course,
        windFrom,
        hold,
        rounding.clearancePx,
      );
    if (ahead < -rounding.clearancePx * 0.5 || outsideCorridor || pastEntryLayline) {
      tackPt = planBeatTackPoint(boat, laylineTarget, course, windFrom, hold);
    }
  }

  if (
    tackPt &&
    !pathClearsMark(boat, tackPt, goal, rounding.clearancePx * 1.05)
  ) {
    const retry = planBeatTackPoint(
      boat,
      laylineTarget,
      course,
      windFrom,
      hold,
    );
    tackPt =
      retry && pathClearsMark(boat, retry, goal, rounding.clearancePx * 1.05)
        ? retry
        : null;
  }

  const sailingToLayline = tackPt !== null;
  const activeTarget = tackPt
    ? { x: tackPt.x, y: tackPt.y }
    : { x: gate.x, y: gate.y };
  const waypoints: StrategyPoint[] = tackPt ? [tackPt, aimPt] : [aimPt];

  return {
    clearTarget: laylineTarget,
    activeTarget,
    waypoints,
    sense: rounding.sense,
    side: rounding.side,
    clearancePx: rounding.clearancePx,
    goalIsUpwind,
    legMode: 'beat',
    sailingToLayline,
    coneStage,
    roundingPhase,
    roundingPath: null,
  };
};

export const resolveDriverPlan = (
  boat: Pick<SailboatState, 'x' | 'y' | 'windFromDegrees' | 'trueWindSpeedKnots'>,
  memory: BoatDriverMemory,
  course: RaceCourse,
): DriverPlan => buildRaceStrategy(boat, memory, course);

export const planMarkRounding = (
  boat: SailboatState,
  _goal: Buoy,
  course: RaceCourse,
  memory: BoatDriverMemory,
): DriverPlan => buildRaceStrategy(boat, memory, course);

export const buildRoundingWaypoints = (
  goal: Buoy,
  course: RaceCourse,
  _options: {
    windFromDegrees?: number;
    from?: Pick<Buoy, 'x' | 'y'>;
  } = {},
): {
  approach: { x: number; y: number };
  beyond: { x: number; y: number };
  exit: { x: number; y: number };
  clearTarget: MarkClearTarget;
} => {
  const wind = _options.windFromDegrees ?? course.windFromDegrees ?? 0;
  const clear = leaveClearPointForMark(goal, course, wind, _options.from);
  return {
    approach: { x: clear.enterAimX, y: clear.enterAimY },
    beyond: { x: clear.exitAimX, y: clear.exitAimY },
    exit: { x: clear.exitAimX, y: clear.exitAimY },
    clearTarget: clear,
  };
};

export const vmgTowardMark = (
  boatSpeedKnots: number,
  headingDegrees: number,
  bearingToMarkDegrees: number,
): number => {
  const angleOff = shortestHeadingDelta(headingDegrees, bearingToMarkDegrees);
  return boatSpeedKnots * Math.cos((angleOff * Math.PI) / 180);
};

export const closeHauledHeadings = (
  windFromDegrees: number,
  closeHauledTwa = CLOSE_HAULED_TWA,
): Record<Tack, number> => ({
  starboard: normalizeHeadingDegrees(windFromDegrees + closeHauledTwa),
  port: normalizeHeadingDegrees(windFromDegrees - closeHauledTwa),
});

export const markIsUpwindInNoGo = (
  boatHeadingWouldBe: number,
  windFromDegrees: number,
): boolean => trueWindAngleDegrees(boatHeadingWouldBe, windFromDegrees) < CLOSE_HAULED_TWA;

export const projectedVmg = (
  headingDegrees: number,
  windFromDegrees: number,
  windSpeedKnots: number,
  bearingToMarkDegrees: number,
): number => {
  const twa = trueWindAngleDegrees(headingDegrees, windFromDegrees);
  const speed = boatSpeedFromPolar(windSpeedKnots, twa);
  return vmgTowardMark(speed, headingDegrees, bearingToMarkDegrees);
};

export const chooseBetterTack = (
  windFromDegrees: number,
  windSpeedKnots: number,
  bearingToMarkDegrees: number,
  preferred: Tack | null,
): Tack => {
  const headings = closeHauledHeadings(windFromDegrees);
  const portVmg = projectedVmg(
    headings.port,
    windFromDegrees,
    windSpeedKnots,
    bearingToMarkDegrees,
  );
  const starboardVmg = projectedVmg(
    headings.starboard,
    windFromDegrees,
    windSpeedKnots,
    bearingToMarkDegrees,
  );

  if (preferred === 'port' && portVmg + TACK_VMG_HYSTERESIS >= starboardVmg) {
    return 'port';
  }
  if (preferred === 'starboard' && starboardVmg + TACK_VMG_HYSTERESIS >= portVmg) {
    return 'starboard';
  }
  return portVmg > starboardVmg ? 'port' : 'starboard';
};

/**
 * Leeward Out: prefer the board that climbs into the wind toward the exit,
 * not the fetch that bails away downwind after In.
 */
const chooseLeewardExitTack = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  exitAim: Pick<Buoy, 'x' | 'y'>,
  mark: Pick<Buoy, 'x' | 'y'>,
  windFromDegrees: number,
  tws: number,
): Tack => {
  const upwind = headingUnit(windFromDegrees);
  const biasAim = {
    x: mark.x + upwind.x * 90 + (exitAim.x - mark.x) * 0.4,
    y: mark.y + upwind.y * 90 + (exitAim.y - mark.y) * 0.4,
  };
  const bearing = bearingDegreesTo(boat.x, boat.y, biasAim.x, biasAim.y);
  return chooseBetterTack(windFromDegrees, tws, bearing, null);
};

export const canFetchMarkDirectly = (
  bearingToMarkDegrees: number,
  windFromDegrees: number,
): boolean => !markIsUpwindInNoGo(bearingToMarkDegrees, windFromDegrees);

export const targetPointInNoGo = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  target: Pick<Buoy, 'x' | 'y'>,
  windFromDegrees: number,
): boolean =>
  !canFetchMarkDirectly(
    bearingDegreesTo(boat.x, boat.y, target.x, target.y),
    windFromDegrees,
  );

/**
 * Rounding look-ahead: farthest unobstructed centerline chord vs the mark
 * body (hit radius + half beam + 1px), preferring a fetchable target so we
 * skip apex verts that force a tack when Exit is clear.
 *
 * Do not look ahead to Exit until the boat has reached the arc (captured a
 * prior vertex, or within capture of the current one). Otherwise a clear
 * boat→Exit chord from the gate-cross pose scallops past the apex.
 */
const pickRoundingWaypointIndex = (
  boat: RoundingPoint,
  vertices: readonly RoundingPoint[],
  fromIndex: number,
  spec: MarkRoundingSpec,
  windFromDegrees: number,
  capturePx: number = spec.clearancePx * 0.55,
): number => {
  const exitIndex = vertices.length - 1;
  const current = vertices[fromIndex];
  const onArc =
    fromIndex > 0 ||
    (current !== undefined &&
      distancePx(boat.x, boat.y, current.x, current.y) <= capturePx * 1.35);
  const maxIndex = onArc ? exitIndex : Math.max(fromIndex, exitIndex - 1);
  return furthestUnobstructedRoundingWaypointIndex(
    boat,
    vertices,
    fromIndex,
    [
      {
        x: spec.mark.x,
        y: spec.mark.y,
        radiusPx: spec.chordClearancePx,
      },
    ],
    undefined,
    (point) => !targetPointInNoGo(boat, point, windFromDegrees),
    maxIndex,
  );
};

/**
 * Close-hauled board toward a no-go rounding waypoint — never the opposite
 * tack. Head-to-wind: pick the CH that turns with the rounding sense.
 */
const roundingHoldTack = (
  boatHeadingDegrees: number,
  bearingDegrees: number,
  windFromDegrees: number,
  sense: RoundingSense,
  headings: Record<Tack, number>,
): Tack => {
  const fromWind = shortestHeadingDelta(windFromDegrees, bearingDegrees);
  if (Math.abs(fromWind) > 8) {
    return fromWind >= 0 ? 'starboard' : 'port';
  }
  const portTurn = monotoneTurnDelta(
    boatHeadingDegrees,
    headings.port,
    sense,
  );
  const stbdTurn = monotoneTurnDelta(
    boatHeadingDegrees,
    headings.starboard,
    sense,
  );
  // Prefer the smaller turn that still progresses in-sense (positive magnitude).
  const portCost = portTurn < -5 ? 1e3 + Math.abs(portTurn) : Math.abs(portTurn);
  const stbdCost = stbdTurn < -5 ? 1e3 + Math.abs(stbdTurn) : Math.abs(stbdTurn);
  return portCost <= stbdCost ? 'port' : 'starboard';
};

export const closeHauledRayLaysPoint = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  headingDegrees: number,
  point: Pick<Buoy, 'x' | 'y'>,
  capturePx: number,
): boolean => {
  const dir = headingUnit(headingDegrees);
  const toX = point.x - boat.x;
  const toY = point.y - boat.y;
  const ahead = toX * dir.x + toY * dir.y;
  if (ahead < capturePx * 0.25) {
    return false;
  }
  const perp = Math.abs(toX * dir.y - toY * dir.x);
  return perp <= capturePx;
};

/**
 * Single-tack plan to a point in the no-go: sail hold CH to T (hold ∩ opposite
 * layline through target), tack once, then fetch. Returns null if the point
 * is already fetchable or no useful T exists.
 */
export const planOneTackToPoint = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  target: Pick<Buoy, 'x' | 'y'>,
  windFromDegrees: number,
  preferredHold: Tack | null,
  minLegPx: number,
  course?: RaceCourse,
): { hold: Tack; tackPoint: { x: number; y: number } } | null => {
  if (!targetPointInNoGo(boat, target, windFromDegrees)) {
    return null;
  }
  const headings = closeHauledHeadings(windFromDegrees);
  const order: Tack[] =
    preferredHold === 'port'
      ? ['port', 'starboard']
      : preferredHold === 'starboard'
        ? ['starboard', 'port']
        : ['port', 'starboard'];
  const wallMargin = course
    ? Math.max(24, Math.min(course.width, course.height) * 0.04)
    : 24;
  // Prefer the shorter total path; try a shorter min-leg if the first pass misses.
  let best: { hold: Tack; tackPoint: { x: number; y: number }; score: number } | null =
    null;
  for (const minLeg of [minLegPx, minLegPx * 0.45, 12]) {
    for (const hold of order) {
      const other: Tack = hold === 'port' ? 'starboard' : 'port';
      const hit = intersectLaylineTack(
        boat,
        headings[hold],
        target,
        headings[other],
        minLeg,
      );
      if (!hit) {
        continue;
      }
      const tackPoint = course
        ? clampToBoard(hit, course, wallMargin)
        : hit;
      if (course && edgeClearancePx(tackPoint, course) < wallMargin * 0.5) {
        continue;
      }
      const score =
        distancePx(boat.x, boat.y, tackPoint.x, tackPoint.y) +
        distancePx(tackPoint.x, tackPoint.y, target.x, target.y);
      if (!best || score < best.score) {
        best = { hold, tackPoint, score };
      }
    }
    if (best) {
      break;
    }
  }
  if (!best) {
    return null;
  }
  return { hold: best.hold, tackPoint: best.tackPoint };
};

const oppositeTack = (tack: Tack): Tack =>
  tack === 'port' ? 'starboard' : 'port';

export type TackRouteClearMark = Pick<Buoy, 'x' | 'y'> & {
  radiusPx: number;
};

const routeLegsClearMarks = (
  start: Pick<Buoy, 'x' | 'y'>,
  legs: readonly Pick<StrategyPoint, 'x' | 'y'>[],
  clearMarks: readonly TackRouteClearMark[],
): boolean => {
  if (clearMarks.length === 0) {
    return true;
  }
  let from = start;
  for (const leg of legs) {
    for (const mark of clearMarks) {
      if (!pathClearsMark(from, leg, mark, mark.radiusPx)) {
        return false;
      }
    }
    from = leg;
  }
  return true;
};

const closeHauledLegClearsMarks = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  headingDegrees: number,
  distancePxToCheck: number,
  clearMarks: readonly TackRouteClearMark[],
): boolean => {
  const dir = headingUnit(headingDegrees);
  const sample = {
    x: boat.x + dir.x * distancePxToCheck,
    y: boat.y + dir.y * distancePxToCheck,
  };
  return routeLegsClearMarks(boat, [sample], clearMarks);
};

/**
 * Build a committed tack sequence to a no-go destination.
 * Returns null when the destination is already fetchable and clear.
 * Prefers a single layline tack; falls back to a two-tack ladder.
 */
export const buildTackRouteToPoint = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  target: Pick<Buoy, 'x' | 'y'>,
  windFromDegrees: number,
  preferredHold: Tack | null,
  course: RaceCourse,
  clearancePx: number,
  clearMarks: readonly TackRouteClearMark[] = [],
): TackRoute | null => {
  if (
    !targetPointInNoGo(boat, target, windFromDegrees) &&
    routeLegsClearMarks(boat, [target], clearMarks)
  ) {
    return null;
  }
  const headings = closeHauledHeadings(windFromDegrees);
  const minUseful = Math.max(clearancePx * 2.4, 72);
  const wallMargin = Math.max(24, Math.min(course.width, course.height) * 0.04);
  const baseOrder: Tack[] =
    preferredHold === 'port'
      ? ['port', 'starboard']
      : preferredHold === 'starboard'
        ? ['starboard', 'port']
        : ['starboard', 'port'];
  const [firstHold, secondHold] = baseOrder;
  const firstClears = closeHauledLegClearsMarks(
    boat,
    headings[firstHold],
    minUseful,
    clearMarks,
  );
  const secondClears = closeHauledLegClearsMarks(
    boat,
    headings[secondHold],
    minUseful,
    clearMarks,
  );
  const order: Tack[] =
    !firstClears && secondClears ? [secondHold, firstHold] : baseOrder;

  const makeSingle = (hold: Tack, tackPoint: Pick<Buoy, 'x' | 'y'>): TackRoute => {
    const other = oppositeTack(hold);
    return {
      targetX: target.x,
      targetY: target.y,
      legIndex: 0,
      legs: [
        {
          kind: 'tack',
          x: tackPoint.x,
          y: tackPoint.y,
          hold,
          label: 'T1',
        },
        {
          kind: 'aim',
          x: target.x,
          y: target.y,
          hold: other,
          label: 'Dest',
        },
      ],
    };
  };

  const routeClears = (route: TackRoute): boolean =>
    routeLegsClearMarks(boat, route.legs, clearMarks);

  const extendSingleUntilClear = (
    hold: Tack,
    startPoint: Pick<Buoy, 'x' | 'y'>,
  ): TackRoute | null => {
    const holdDir = headingUnit(headings[hold]);
    const step = Math.max(12, clearancePx * 0.45);
    const maxSteps = 18;
    let tackPoint = { x: startPoint.x, y: startPoint.y };
    for (let i = 0; i <= maxSteps; i += 1) {
      if (edgeClearancePx(tackPoint, course) < wallMargin * 0.5) {
        return null;
      }
      const leg = distancePx(boat.x, boat.y, tackPoint.x, tackPoint.y);
      const route = makeSingle(hold, tackPoint);
      if (leg >= minUseful * 0.55 && routeClears(route)) {
        return route;
      }
      tackPoint = {
        x: tackPoint.x + holdDir.x * step,
        y: tackPoint.y + holdDir.y * step,
      };
    }
    return null;
  };

  const trySingle = (hold: Tack): TackRoute | null => {
    const other = oppositeTack(hold);
    const hit = intersectLaylineTack(
      boat,
      headings[hold],
      target,
      headings[other],
      minUseful * 0.45,
    );
    if (!hit) {
      return null;
    }
    const tackPoint = clampToBoard(hit, course, wallMargin);
    if (edgeClearancePx(tackPoint, course) < wallMargin * 0.5) {
      return null;
    }
    const leg = distancePx(boat.x, boat.y, tackPoint.x, tackPoint.y);
    // Already on / past a useful layline: skip micro-T; Dest alone (tack onto other).
    if (leg < minUseful * 0.55) {
      const microRoute: TackRoute = {
        targetX: target.x,
        targetY: target.y,
        legIndex: 0,
        legs: [
          {
            kind: 'aim',
            x: target.x,
            y: target.y,
            hold: other,
            label: 'Dest',
          },
        ],
      };
      if (routeClears(microRoute)) {
        return microRoute;
      }
      return extendSingleUntilClear(hold, tackPoint);
    }
    const route = makeSingle(hold, tackPoint);
    if (routeClears(route)) {
      return route;
    }
    if (clearMarks.length > 0) {
      return extendSingleUntilClear(hold, tackPoint);
    }
    return null;
  };

  const tryDouble = (hold1: Tack): TackRoute | null => {
    const hold2 = oppositeTack(hold1);
    const dir1 = headingUnit(headings[hold1]);
    const reach = Math.max(
      minUseful,
      distancePx(boat.x, boat.y, target.x, target.y) * 0.32,
    );
    const t1raw = {
      x: boat.x + dir1.x * reach,
      y: boat.y + dir1.y * reach,
    };
    const t1 = clampToBoard(t1raw, course, wallMargin);
    if (distancePx(boat.x, boat.y, t1.x, t1.y) < minUseful * 0.5) {
      return null;
    }
    if (edgeClearancePx(t1, course) < wallMargin * 0.5) {
      return null;
    }
    const hit2 = intersectLaylineTack(
      t1,
      headings[hold2],
      target,
      headings[hold1],
      minUseful * 0.4,
    );
    if (!hit2) {
      return null;
    }
    const t2 = clampToBoard(hit2, course, wallMargin);
    if (distancePx(t1.x, t1.y, t2.x, t2.y) < minUseful * 0.4) {
      return null;
    }
    if (edgeClearancePx(t2, course) < wallMargin * 0.5) {
      return null;
    }
    const route: TackRoute = {
      targetX: target.x,
      targetY: target.y,
      legIndex: 0,
      legs: [
        { kind: 'tack', x: t1.x, y: t1.y, hold: hold1, label: 'T1' },
        { kind: 'tack', x: t2.x, y: t2.y, hold: hold2, label: 'T2' },
        {
          kind: 'aim',
          x: target.x,
          y: target.y,
          hold: hold1,
          label: 'Dest',
        },
      ],
    };
    return routeClears(route) ? route : null;
  };

  for (const hold of order) {
    const single = trySingle(hold);
    if (single) {
      return single;
    }
  }
  for (const hold of order) {
    const dbl = tryDouble(hold);
    if (dbl) {
      return dbl;
    }
  }
  return null;
};

export const tackRouteMatchesTarget = (
  route: TackRoute | null,
  target: Pick<Buoy, 'x' | 'y'>,
): boolean =>
  !!route &&
  distancePx(route.targetX, route.targetY, target.x, target.y) <= 14;

/** Keep committed T legs; only move the final Dest when the aim retargets. */
export const retargetTackRouteDest = (
  route: TackRoute,
  target: Pick<Buoy, 'x' | 'y'>,
): TackRoute => {
  if (route.legs.length === 0) {
    return {
      ...route,
      targetX: target.x,
      targetY: target.y,
    };
  }
  const last = route.legs.length - 1;
  return {
    ...route,
    targetX: target.x,
    targetY: target.y,
    legs: route.legs.map((leg, i) =>
      i === last ? { ...leg, x: target.x, y: target.y } : leg,
    ),
  };
};

/** Still sailing to a T — do not rebuild the route for a Dest nudge. */
const tackRouteOnTackLeg = (route: TackRoute): boolean => {
  const leg = route.legs[route.legIndex];
  if (!leg) {
    return false;
  }
  if (leg.kind === 'tack') {
    return true;
  }
  return route.legIndex < route.legs.length - 1;
};

export const onLaylineToPoint = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  point: Pick<Buoy, 'x' | 'y'>,
  windFromDegrees: number,
  currentTack: Tack,
  capturePx: number,
): boolean => {
  const bearing = bearingDegreesTo(boat.x, boat.y, point.x, point.y);
  if (canFetchMarkDirectly(bearing, windFromDegrees)) {
    return true;
  }
  const headings = closeHauledHeadings(windFromDegrees);
  const other: Tack = currentTack === 'port' ? 'starboard' : 'port';
  const rayCapture = capturePx * LAYLINE_RAY_CAPTURE_FACTOR;
  if (closeHauledRayLaysPoint(boat, headings[other], point, rayCapture)) {
    return true;
  }
  const near = distancePx(boat.x, boat.y, point.x, point.y) <= capturePx * 4;
  if (!near) {
    return false;
  }
  const delta = Math.abs(shortestHeadingDelta(bearing, headings[other]));
  return delta <= LAYLINE_TOLERANCE_DEG;
};

/**
 * Signed overstand past the opposite-tack layline through `point`.
 * >0 means hold close-hauled has already crossed that layline (must tack).
 * Measured as -t where t is distance along hold CH to the layline intersection.
 */
export const overstandPastLaylinePx = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  point: Pick<Buoy, 'x' | 'y'>,
  windFromDegrees: number,
  holdTack: Tack,
): number => {
  const headings = closeHauledHeadings(windFromDegrees);
  const other: Tack = holdTack === 'port' ? 'starboard' : 'port';
  const da = headingUnit(headings[holdTack]);
  const approach = headingUnit(headings[other]);
  const db = { x: -approach.x, y: -approach.y };
  const det = da.x * db.y - da.y * db.x;
  if (Math.abs(det) < 1e-8) {
    return 0;
  }
  const dx = point.x - boat.x;
  const dy = point.y - boat.y;
  const t = (dx * db.y - dy * db.x) / det;
  return -t;
};

/**
 * True when the boat must tack onto the entry layline board.
 * Overstand always wins — even if the entry bearing is already sailable
 * (classic overstand reach from the wrong side).
 */
const mustTackAtEntryLayline = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  entry: Pick<Buoy, 'x' | 'y'>,
  windFromDegrees: number,
  holdTack: Tack,
  capturePx: number,
): boolean => {
  // Already sailed past the hold→entry layline intersection.
  if (overstandPastLaylinePx(boat, entry, windFromDegrees, holdTack) > capturePx * 0.15) {
    return true;
  }
  const headings = closeHauledHeadings(windFromDegrees);
  const other: Tack = holdTack === 'port' ? 'starboard' : 'port';
  const rayCapture = capturePx * LAYLINE_RAY_CAPTURE_FACTOR;
  // Opposite board lays the entry — tack now; never sail past.
  return closeHauledRayLaysPoint(boat, headings[other], entry, rayCapture);
};

/** Prefer the board that still approaches the entry from its leave-to side. */
const preferredEntryApproachTack = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  entry: Pick<Buoy, 'x' | 'y'>,
  mark: Buoy,
  course: RaceCourse,
  windFromDegrees: number,
): Tack => {
  const leave = leaveToDirForMark(mark, course, windFromDegrees);
  const boatLeave =
    (boat.x - mark.x) * leave.x + (boat.y - mark.y) * leave.y;
  const entryLeave =
    (entry.x - mark.x) * leave.x + (entry.y - mark.y) * leave.y;
  // If already on the anti-leave side, take the tack that climbs back toward entry.
  if (Math.sign(boatLeave) !== Math.sign(entryLeave) && Math.abs(boatLeave) > 8) {
    return chooseBetterTack(
      windFromDegrees,
      10,
      bearingDegreesTo(boat.x, boat.y, entry.x, entry.y),
      null,
    );
  }
  const { across } = windAxes(windFromDegrees);
  const boatAcross = acrossFromMark(boat, mark, across);
  const entryAcross = acrossFromMark(entry, mark, across);
  // Sail toward the entry's across-band (not past it to the far side).
  if (boatAcross < entryAcross) {
    return 'starboard';
  }
  if (boatAcross > entryAcross) {
    return 'port';
  }
  return chooseBetterTack(
    windFromDegrees,
    10,
    bearingDegreesTo(boat.x, boat.y, entry.x, entry.y),
    null,
  );
};

/** Reject a plotted T that sits past the entry layline / wrong leave-to side. */
const tackPointRespectsEntryLayline = (
  tackPt: Pick<Buoy, 'x' | 'y'>,
  boat: Pick<SailboatState, 'x' | 'y'>,
  entry: Pick<Buoy, 'x' | 'y'>,
  mark: Buoy,
  course: RaceCourse,
  windFromDegrees: number,
  holdTack: Tack,
  clearancePx: number,
): boolean => {
  if (overstandPastLaylinePx(tackPt, entry, windFromDegrees, holdTack) > clearancePx * 0.2) {
    return false;
  }
  const leave = leaveToDirForMark(mark, course, windFromDegrees);
  const entryLeave =
    (entry.x - mark.x) * leave.x + (entry.y - mark.y) * leave.y;
  const tackLeave =
    (tackPt.x - mark.x) * leave.x + (tackPt.y - mark.y) * leave.y;
  // Near the mark, T must not sit on the anti-leave side of entry.
  const { upwind } = windAxes(windFromDegrees);
  const along = upwindFromMark(tackPt, mark, upwind);
  if (along > -clearancePx * 4 && Math.sign(tackLeave) !== Math.sign(entryLeave)) {
    return false;
  }
  return true;
};

/** Formal entry aim used as the upwind layline target for mark 1. */
const formalEntryAim = (
  course: RaceCourse,
  markIndex: 1 | 2 | 3,
): { x: number; y: number } => {
  const formal = buildMarkRoundingSpec(course, markIndex);
  return {
    x: formal.entryGate.aim.x,
    y: formal.entryGate.aim.y,
  };
};

/**
 * Final approach: boat has arrived at the entry layline/aim.
 * Stop beating/layline-tacking and drive through the gate to arm rounding.
 * Side-of-plane alone is not enough — that fired Entry CH hundreds of px
 * from aim on a distant CH leg.
 */
export const inEntryCommitZone = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  course: RaceCourse,
  markIndex: 1 | 2 | 3,
): boolean => {
  const formal = buildMarkRoundingSpec(course, markIndex);
  return inEntryPortal(boat, formal);
};

const wallMarginPx = (course: RaceCourse): number =>
  Math.max(48, Math.min(course.width, course.height) * 0.09);

const wallClearanceForHeading = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  course: RaceCourse,
  headingDegrees: number,
  lookAheadPx: number,
): number => {
  const dir = headingUnit(headingDegrees);
  const px = boat.x + dir.x * lookAheadPx;
  const py = boat.y + dir.y * lookAheadPx;
  return Math.min(px, course.width - px, py, course.height - py);
};

export const wallAvoidanceTack = (
  boat: Pick<SailboatState, 'x' | 'y' | 'headingDegrees' | 'windFromDegrees'>,
  course: RaceCourse,
  preferred: Tack | null,
  nowMs: number = Date.now(),
  lastTackAtMs: number = 0,
): Tack | null => {
  const margin = wallMarginPx(course);
  const edgeDist = Math.min(
    boat.x,
    course.width - boat.x,
    boat.y,
    course.height - boat.y,
  );
  const headings = closeHauledHeadings(boat.windFromDegrees);
  const look = margin * 1.6;
  const portClear = wallClearanceForHeading(boat, course, headings.port, look);
  const stbdClear = wallClearanceForHeading(boat, course, headings.starboard, look);
  const holdClear =
    preferred === null
      ? currentClearFallback(boat, course, look)
      : wallClearanceForHeading(boat, course, headings[preferred], look);
  const clearerBy = portClear - stbdClear;
  const safer: Tack = clearerBy >= 0 ? 'port' : 'starboard';
  const msSinceTack = nowMs - (lastTackAtMs || 0);

  // Already on the roomier tack.
  if (preferred === safer) {
    return null;
  }

  // Heading into the wall on this tack — tack immediately (user request).
  const drivingIntoWall =
    holdClear < margin * 0.55 || edgeDist < margin * 0.7;
  if (drivingIntoWall && safer !== preferred && msSinceTack >= 500) {
    if (preferred === null || Math.abs(clearerBy) > margin * 0.08) {
      return safer;
    }
  }

  if (
    edgeDist < margin &&
    preferred !== null &&
    msSinceTack >= WALL_SOFT_TACK_COOLDOWN_MS &&
    Math.abs(clearerBy) > margin * 0.2
  ) {
    return safer;
  }

  return null;
};

const currentClearFallback = (
  boat: Pick<SailboatState, 'x' | 'y' | 'headingDegrees'>,
  course: RaceCourse,
  lookAheadPx: number,
): number => wallClearanceForHeading(boat, course, boat.headingDegrees, lookAheadPx);

const canChangeTack = (
  memory: BoatDriverMemory,
  nextTack: Tack,
  nowMs: number,
  urgent: boolean,
): boolean => {
  if (memory.currentTack === null || memory.currentTack === nextTack) {
    return true;
  }
  if (urgent) {
    return true;
  }
  if (!memory.lastTackAtMs) {
    return true;
  }
  return nowMs - memory.lastTackAtMs >= MIN_TACK_INTERVAL_MS;
};

const commitTack = (
  memory: BoatDriverMemory,
  tack: Tack,
  nowMs: number,
): BoatDriverMemory => {
  if (memory.currentTack === tack) {
    return { ...memory, currentTack: tack };
  }
  return { ...memory, currentTack: tack, lastTackAtMs: nowMs };
};

/**
 * Helm:
 * 1) Beat/fetch into the cone (cross In), then beyond Out / toward next enter-aim
 * 2) Rounded when leave-to enter → opposite exit; never aim at ray-tip vertices
 */
export const decideDriverHeading = (
  boat: SailboatState,
  course: RaceCourse,
  memory: BoatDriverMemory,
  nowMs: number = Date.now(),
): DriverDecision => {
  const prevStage = memory.coneStage;
  let mem = advanceGoalIfClearReached(memory, boat, course);

  const windFrom = boat.windFromDegrees;
  const tws = boat.trueWindSpeedKnots;
  const headings = closeHauledHeadings(windFrom);

  // After crossing In, drop approach tack memory and follow the locked polygon.
  if (mem.roundingPhase === 'rounding' && prevStage !== 'entered') {
    mem = {
      ...mem,
      currentTack: null,
      laylineTack: null,
    };
  }

  // Drop a sticky T only when behind us or hard into a wall.
  // Never drop a committed tackRoute — helm advances legs instead.
  if (mem.laylineTack && !mem.tackRoute) {
    const clearance =
      mem.roundingClear?.clearancePx ?? hullLeaveClearancePx(course);
    const wallMargin = laylineWallMarginPx(course, clearance);
    const onWall = edgeClearancePx(mem.laylineTack, course) < wallMargin * 0.55;
    let pastTack = false;
    if (mem.currentTack) {
      const dir = headingUnit(headings[mem.currentTack]);
      const ahead =
        (mem.laylineTack.x - boat.x) * dir.x +
        (mem.laylineTack.y - boat.y) * dir.y;
      pastTack = ahead < -Math.max(24, clearance * 0.5);
    }
    const nearEntry =
      mem.goalBuoyIndex === 1 && inEntryCommitZone(boat, course, 1);
    let outsideCorridor = false;
    let pastEntryLayline = false;
    if (mem.goalBuoyIndex === 1 && mem.currentTack && !nearEntry) {
      const mark1 = buoyByIndex(course, 1);
      outsideCorridor = !inUpwindCorridor(
        mem.laylineTack,
        mark1,
        course,
        windFrom,
        clearance,
      );
      const entry = formalEntryAim(course, 1);
      pastEntryLayline = !tackPointRespectsEntryLayline(
        mem.laylineTack,
        boat,
        entry,
        mark1,
        course,
        windFrom,
        mem.currentTack,
        clearance,
      );
    }
    if (onWall || pastTack || outsideCorridor || pastEntryLayline) {
      mem = {
        ...mem,
        laylineTack: null,
        oneTackLock:
          onWall || pastTack ? null : mem.oneTackLock,
        currentTack: onWall ? null : mem.currentTack,
      };
    }
  }

  // Stick cone geometry for this goal once, then plan T against cone aim.
  {
    const goal = buoyByIndex(course, mem.goalBuoyIndex);
    if (!mem.roundingClear || mem.roundingClear.markIndex !== goal.index) {
      mem = {
        ...mem,
        roundingClear: leaveClearPointForMark(goal, course, windFrom),
        coneStage: 'outside',
        coneWasInside: false,
        coneWasOutsideIn: false,
      };
    }
  }

  // Choose the initial beat tack once — never during rounding or entry commit
  // (that plotted a stray T over the mark while still approaching / rounding).
  const inEntry =
    mem.roundingPhase !== 'rounding' &&
    inEntryCommitZone(boat, course, mem.goalBuoyIndex);
  if (
    mem.currentTack === null &&
    tws > 0 &&
    mem.roundingPhase !== 'rounding' &&
    !inEntry
  ) {
    const goal = buoyByIndex(course, mem.goalBuoyIndex);
    const rounding = resolveRoundingClear(mem, goal, course, windFrom);
    const pick = chooseLaylineApproach(boat, rounding, course, windFrom, tws);
    mem = {
      ...mem,
      currentTack: pick.tack,
      lastTackAtMs: nowMs,
      laylineTack: pick.tackPoint
        ? { x: pick.tackPoint.x, y: pick.tackPoint.y }
        : null,
      roundingClear: rounding,
    };
  }

  const plan = buildRaceStrategy(boat, mem, course);
  const markLabel = `${plan.side} ${mem.goalBuoyIndex}`;

  if (tws <= 0) {
    return {
      desiredHeadingDegrees: boat.headingDegrees,
      memory: mem,
      reason: `Waiting for wind · goal ${mem.goalBuoyIndex}`,
      score: { strategy: 1, value: 0, detail: 'no wind' },
      plan,
    };
  }

  /**
   * Sail to an arbitrary point: fetch if sailable; otherwise commit a tack
   * route once (layline T1…Tn → Dest) and follow it without replanning.
   */
  const helmSailToPoint = (
    target: { x: number; y: number },
    label: string,
    memExtra: Partial<BoatDriverMemory>,
    fetchReason: string,
  ): DriverDecision => {
    const bearing = bearingDegreesTo(boat.x, boat.y, target.x, target.y);
    const capture = Math.max(plan.clearancePx * 0.75, 26);
    const baseMem: BoatDriverMemory = { ...mem, ...memExtra };
    const clearMarks: readonly TackRouteClearMark[] =
      baseMem.lastRoundedMarkIndex == null
        ? []
        : [
            {
              ...buoyByIndex(course, baseMem.lastRoundedMarkIndex),
              radiusPx: plan.clearancePx * 0.95,
            },
          ];
    const msSinceTack = nowMs - baseMem.lastTackAtMs;
    const tackCool = msSinceTack >= MIN_TACK_INTERVAL_MS * 0.75;
    const onHoldHeading = (hold: Tack): boolean =>
      Math.abs(shortestHeadingDelta(boat.headingDegrees, headings[hold])) <= 28;
    const pickFallbackHold = (): Tack => {
      const preferred =
        baseMem.currentTack ?? chooseBetterTack(windFrom, tws, bearing, null);
      const other = oppositeTack(preferred);
      const look = Math.max(plan.clearancePx * 2.4, 72);
      const preferredClears = closeHauledLegClearsMarks(
        boat,
        headings[preferred],
        look,
        clearMarks,
      );
      const otherClears = closeHauledLegClearsMarks(
        boat,
        headings[other],
        look,
        clearMarks,
      );
      return !preferredClears && otherClears ? other : preferred;
    };
    const ctx = () => ({
      label,
      goal: baseMem.goalBuoyIndex,
      stage: baseMem.entryApproachStage,
      boat: xy1(boat.x, boat.y),
      heading: r1(boat.headingDegrees),
      windFrom: r1(windFrom),
      target: xy1(target.x, target.y),
      bearing: r1(bearing),
      inNoGo: targetPointInNoGo(boat, target, windFrom),
      hold: baseMem.currentTack,
      msSinceTack: Math.round(msSinceTack),
      tackCool,
      capture: r1(capture),
      legIndex: baseMem.tackRoute?.legIndex ?? null,
      legs: baseMem.tackRoute?.legs.map((l) => l.label ?? l.kind) ?? null,
    });

    const routePlan = (route: TackRoute, active: StrategyPoint): DriverPlan => ({
      ...plan,
      activeTarget: { x: active.x, y: active.y },
      waypoints: route.legs.slice(route.legIndex),
      legMode: 'beat',
      sailingToLayline: active.kind === 'tack',
      goalIsUpwind: true,
    });

    // Direct fetch when sailable — no tack planner.
    if (
      !targetPointInNoGo(boat, target, windFrom) &&
      routeLegsClearMarks(boat, [target], clearMarks)
    ) {
      if (baseMem.tackRoute) {
        logTackPlan(boat.id, {
          event: 'fetch',
          why: 'sailable',
          ...ctx(),
          clearedRoute: true,
        });
      }
      const fetchTack: Tack =
        shortestHeadingDelta(windFrom, bearing) >= 0 ? 'starboard' : 'port';
      return {
        desiredHeadingDegrees: bearing,
        memory: {
          ...baseMem,
          currentTack: fetchTack,
          laylineTack: null,
          tackRoute: null,
          oneTackLock: null,
          oneTackDoneTarget: null,
        },
        reason: fetchReason,
        score: {
          strategy: 1,
          value: 2.8,
          detail: 'direct fetch to point',
        },
        plan: {
          ...plan,
          activeTarget: target,
          waypoints: [
            {
              kind: 'aim',
              x: target.x,
              y: target.y,
              markIndex: baseMem.goalBuoyIndex,
              label: 'Dest',
            },
          ],
          legMode: 'fetch',
          sailingToLayline: false,
          goalIsUpwind: false,
        },
      };
    }

    // Commit or keep a route for this destination. If Dest only nudges
    // (aim→through) while we are still on a T leg, keep T1…Tn — rebuilding
    // here pushed a new T further along the board past the entry side.
    let routeDropWhy: string | null = null;
    let route = tackRouteMatchesTarget(baseMem.tackRoute, target)
      ? baseMem.tackRoute
      : null;
    if (baseMem.tackRoute && !route && tackRouteOnTackLeg(baseMem.tackRoute)) {
      route = retargetTackRouteDest(baseMem.tackRoute, target);
      logTackPlan(boat.id, {
        event: 'lock-retarget',
        why: 'dest-nudge-keep-T',
        ...ctx(),
        oldTarget: xy1(baseMem.tackRoute.targetX, baseMem.tackRoute.targetY),
        t: xy1(
          baseMem.tackRoute.legs[baseMem.tackRoute.legIndex]?.x ?? 0,
          baseMem.tackRoute.legs[baseMem.tackRoute.legIndex]?.y ?? 0,
        ),
      });
    } else if (baseMem.tackRoute && !route) {
      routeDropWhy = 'target-changed';
    }
    if (
      route &&
      !routeLegsClearMarks(
        boat,
        route.legs.slice(route.legIndex),
        clearMarks,
      )
    ) {
      routeDropWhy = 'route-clips-previous-mark';
      route = null;
    }
    if (baseMem.tackRoute && !route) {
      logTackPlan(boat.id, {
        event: 'lock-drop',
        why: routeDropWhy ?? 'route-invalid',
        ...ctx(),
        oldTarget: xy1(baseMem.tackRoute.targetX, baseMem.tackRoute.targetY),
      });
    }
    if (!route) {
      route = buildTackRouteToPoint(
        boat,
        target,
        windFrom,
        baseMem.currentTack,
        course,
        plan.clearancePx,
        clearMarks,
      );
      if (route) {
        logTackPlan(boat.id, {
          event: 'lock-new',
          why: 'buildTackRouteToPoint',
          ...ctx(),
          route: route.legs.map((l) => ({
            label: l.label ?? l.kind,
            hold: l.hold,
            at: xy1(l.x, l.y),
          })),
        });
      }
    }

    if (!route || route.legs.length === 0) {
      const hold = pickFallbackHold();
      return {
        desiredHeadingDegrees: headings[hold],
        memory: {
          ...baseMem,
          currentTack: hold,
          laylineTack: null,
          tackRoute: null,
        },
        reason: `Route CH · ${hold} · ${label}`,
        score: {
          strategy: 1,
          value: 2.2,
          detail: 'close-hauled; no route geometry yet',
        },
        plan: {
          ...plan,
          activeTarget: target,
          legMode: 'beat',
          sailingToLayline: false,
          goalIsUpwind: true,
        },
      };
    }

    const leg = route.legs[route.legIndex];
    if (!leg) {
      // Route exhausted — fetch/CH to dest without replanning.
      const hold =
        baseMem.currentTack ??
        chooseBetterTack(windFrom, tws, bearing, null);
      return {
        desiredHeadingDegrees: canFetchMarkDirectly(bearing, windFrom)
          ? bearing
          : headings[hold],
        memory: {
          ...baseMem,
          currentTack: hold,
          laylineTack: null,
          tackRoute: null,
        },
        reason: `Route done · ${label}`,
        score: {
          strategy: 1,
          value: 2.1,
          detail: 'tack route complete',
        },
        plan: {
          ...plan,
          activeTarget: target,
          legMode: 'beat',
          sailingToLayline: false,
          goalIsUpwind: true,
        },
      };
    }

    const hold = leg.hold ?? baseMem.currentTack ?? 'starboard';
    const nextLeg = route.legs[route.legIndex + 1] ?? null;
    const nextHold: Tack =
      nextLeg?.hold ?? (hold === 'port' ? 'starboard' : 'port');

    // Dest leg: tack onto planned board if needed, else CH until fetch opens.
    if (leg.kind === 'aim') {
      if (
        baseMem.currentTack !== null &&
        baseMem.currentTack !== hold &&
        tackCool
      ) {
        logTackPlan(boat.id, {
          event: 'tack',
          why: 'route-onto-dest-board',
          ...ctx(),
          from: baseMem.currentTack,
          to: hold,
        });
        const after = commitTack(
          {
            ...baseMem,
            laylineTack: null,
            tackRoute: route,
            oneTackLock: null,
          },
          hold,
          nowMs,
        );
        return {
          desiredHeadingDegrees: headings[hold],
          memory: after,
          reason: `Route tack → ${hold} · ${label}`,
          score: {
            strategy: 1,
            value: 2.4,
            detail: 'planned tack onto Dest board',
          },
          plan: routePlan(route, leg),
        };
      }
      return {
        desiredHeadingDegrees: headings[hold],
        memory: {
          ...baseMem,
          currentTack: hold,
          laylineTack: null,
          tackRoute: route,
          oneTackLock: null,
        },
        reason: `Route → Dest · ${label}`,
        score: {
          strategy: 1,
          value: 2.3,
          detail: 'committed route final leg',
        },
        plan: routePlan(route, leg),
      };
    }

    // Tack leg: sail CH to T, then advance and tack onto next leg's hold.
    const tackPt = { x: leg.x, y: leg.y };
    const nearT = centerReachedTackPoint(boat, tackPt, headings[hold]);
    const aligned = onHoldHeading(hold);
    const atT = nearT && aligned;

    if (atT && tackCool) {
      const advanced: TackRoute = {
        ...route,
        legIndex: route.legIndex + 1,
      };
      logTackPlan(boat.id, {
        event: 'tack',
        why: 'reached-route-T',
        ...ctx(),
        from: hold,
        to: nextHold,
        t: xy1(tackPt.x, tackPt.y),
        nextLabel: nextLeg?.label ?? 'Dest',
        distT: r1(distancePx(boat.x, boat.y, tackPt.x, tackPt.y)),
      });
      const after = commitTack(
        {
          ...baseMem,
          laylineTack: null,
          tackRoute: advanced,
          oneTackLock: null,
        },
        nextHold,
        nowMs,
      );
      const postBearing = bearingDegreesTo(boat.x, boat.y, target.x, target.y);
      const canFetchNow =
        advanced.legIndex >= advanced.legs.length - 1 &&
        canFetchMarkDirectly(postBearing, windFrom);
      const nextActive =
        advanced.legs[advanced.legIndex] ??
        ({
          kind: 'aim',
          x: target.x,
          y: target.y,
          hold: nextHold,
          label: 'Dest',
        } as StrategyPoint);
      return {
        desiredHeadingDegrees: canFetchNow ? postBearing : headings[nextHold],
        memory: canFetchNow
          ? { ...after, tackRoute: null, laylineTack: null }
          : after,
        reason: canFetchNow
          ? fetchReason
          : `Route tack → ${nextHold} · ${label}`,
        score: {
          strategy: 1,
          value: 2.4,
          detail: 'planned tack at route T',
        },
        plan: canFetchNow
          ? {
              ...plan,
              activeTarget: target,
              legMode: 'fetch',
              sailingToLayline: false,
              goalIsUpwind: false,
            }
          : routePlan(advanced, nextActive),
      };
    }

    if (nearT && (!tackCool || !aligned)) {
      logTackPlan(boat.id, {
        event: 'tack-blocked',
        why: !tackCool ? 'at-T-cooldown' : 'at-T-not-on-hold-heading',
        ...ctx(),
        hold,
        t: xy1(tackPt.x, tackPt.y),
        onHoldHeading: aligned,
      });
    }

    return {
      desiredHeadingDegrees: headings[hold],
      memory: {
        ...baseMem,
        currentTack: hold,
        laylineTack: tackPt,
        tackRoute: route,
        oneTackLock: null,
      },
      reason: `Route → ${leg.label ?? 'T'} · ${label}`,
      score: {
        strategy: 1,
        value: 2.3,
        detail: 'sail committed route leg',
      },
      plan: routePlan(route, leg),
    };
  };

  // Rounding: follow the locked polygon only. Fetch the active vertex when
  // sailable; otherwise hold near-side CH. Look-ahead (advanceGoal) owns skips
  // to Exit — do not re-aim Exit here (that flicked Dest and looped).
  if (plan.roundingPhase === 'rounding') {
    const target = plan.activeTarget;
    const bearing = bearingDegreesTo(boat.x, boat.y, target.x, target.y);
    const roundMem: BoatDriverMemory = {
      ...mem,
      roundingClear: plan.clearTarget,
      roundingPhase: 'rounding',
      roundingPath: plan.roundingPath,
      coneStage: 'entered',
      entryApproachStage: null,
      laylineTack: null,
      tackRoute: null,
      oneTackLock: null,
      oneTackDoneTarget: null,
    };

    if (!targetPointInNoGo(boat, target, windFrom)) {
      const fetchTack: Tack =
        shortestHeadingDelta(windFrom, bearing) >= 0 ? 'starboard' : 'port';
      return {
        desiredHeadingDegrees: bearing,
        memory: { ...roundMem, currentTack: fetchTack },
        reason: `Round polygon · ${markLabel}`,
        score: {
          strategy: 1,
          value: 2.8,
          detail: 'fetch rounding vertex',
        },
        plan: {
          ...plan,
          activeTarget: target,
          legMode: 'fetch',
          sailingToLayline: false,
          goalIsUpwind: false,
        },
      };
    }

    // Stick Round CH once chosen — flipping port↔starboard in the no-go
    // stalls the boat on the apex while look-ahead waits for motion.
    const hold =
      mem.currentTack === 'port' || mem.currentTack === 'starboard'
        ? mem.currentTack
        : roundingHoldTack(
            boat.headingDegrees,
            bearing,
            windFrom,
            plan.sense,
            headings,
          );
    return {
      desiredHeadingDegrees: headings[hold],
      memory: { ...roundMem, currentTack: hold },
      reason: `Round CH · ${hold} · ${markLabel}`,
      score: {
        strategy: 1,
        value: 2.4,
        detail: 'CH around mark; no tack route',
      },
      plan: {
        ...plan,
        activeTarget: target,
        legMode: 'fetch',
        sailingToLayline: false,
        goalIsUpwind: true,
      },
    };
  }

  const entryCommit =
    mem.roundingPhase !== 'rounding' &&
    inEntryCommitZone(boat, course, mem.goalBuoyIndex);

  // Near entry: monotonic aim → through only. Never jump to Exit from here
  // (that skipped the gate and armed/approached from the wrong side).
  // No beat/tack routes — Dest-only micro-tacks were circling the mark.
  if (entryCommit) {
    const formal = buildMarkRoundingSpec(course, mem.goalBuoyIndex);
    const dAim = distancePx(
      boat.x,
      boat.y,
      formal.entryGate.aim.x,
      formal.entryGate.aim.y,
    );
    const captureAim = formal.clearancePx * 1.05;
    let stage: EntryApproachStage = mem.entryApproachStage ?? 'aim';
    if (stage === 'aim' && dAim <= captureAim) {
      stage = 'through';
      logTackPlan(boat.id, {
        event: 'entry-stage',
        why: 'reached-entry-aim',
        from: 'aim',
        to: 'through',
        boat: xy1(boat.x, boat.y),
        dAim: r1(dAim),
        captureAim: r1(captureAim),
        clearedLock: !!mem.oneTackLock,
      });
      mem = {
        ...mem,
        entryApproachStage: 'through',
        laylineTack: null,
        tackRoute: null,
        oneTackLock: null,
        oneTackDoneTarget: null,
      };
    } else if (!mem.entryApproachStage) {
      mem = { ...mem, entryApproachStage: 'aim' };
      logTackPlan(boat.id, {
        event: 'entry-stage',
        why: 'enter-commit-zone',
        to: 'aim',
        boat: xy1(boat.x, boat.y),
        dAim: r1(dAim),
      });
    }

    const entryTarget =
      stage === 'through'
        ? {
            x: formal.entryGate.through.x,
            y: formal.entryGate.through.y,
          }
        : {
            x: formal.entryGate.aim.x,
            y: formal.entryGate.aim.y,
          };
    const entryMem: BoatDriverMemory = {
      ...mem,
      roundingClear: plan.clearTarget,
      coneStage: plan.coneStage,
      entryApproachStage: stage,
      laylineTack: null,
      tackRoute: null,
      oneTackLock: null,
      oneTackDoneTarget: null,
    };

    if (!targetPointInNoGo(boat, entryTarget, windFrom)) {
      const fetchTack: Tack =
        shortestHeadingDelta(
          windFrom,
          bearingDegreesTo(boat.x, boat.y, entryTarget.x, entryTarget.y),
        ) >= 0
          ? 'starboard'
          : 'port';
      return {
        desiredHeadingDegrees: bearingDegreesTo(
          boat.x,
          boat.y,
          entryTarget.x,
          entryTarget.y,
        ),
        memory: { ...entryMem, currentTack: fetchTack },
        reason:
          stage === 'through'
            ? `Commit entry → through · ${markLabel}`
            : `Sail entry · ${markLabel}`,
        score: {
          strategy: 1,
          value: 2.8,
          detail: 'fetch entry gate; no tack route',
        },
        plan: {
          ...plan,
          activeTarget: entryTarget,
          waypoints: [
            {
              kind: 'aim',
              x: entryTarget.x,
              y: entryTarget.y,
              markIndex: mem.goalBuoyIndex,
              label: 'Dest',
            },
          ],
          legMode: 'fetch',
          sailingToLayline: false,
          goalIsUpwind: false,
        },
      };
    }

    const bearing = bearingDegreesTo(
      boat.x,
      boat.y,
      entryTarget.x,
      entryTarget.y,
    );
    // Stick the entry hold once chosen — re-picking every tick near HTW
    // flips port↔starboard while crawling to through.
    const hold =
      mem.currentTack === 'port' || mem.currentTack === 'starboard'
        ? mem.currentTack
        : roundingHoldTack(
            boat.headingDegrees,
            bearing,
            windFrom,
            plan.sense,
            headings,
          );
    return {
      desiredHeadingDegrees: headings[hold],
      memory: { ...entryMem, currentTack: hold },
      reason: `Entry CH · ${hold} · ${markLabel}`,
      score: {
        strategy: 1,
        value: 2.4,
        detail: 'CH to entry; no tack route',
      },
      plan: {
        ...plan,
        activeTarget: entryTarget,
        waypoints: [
          {
            kind: 'aim',
            x: entryTarget.x,
            y: entryTarget.y,
            markIndex: mem.goalBuoyIndex,
            label: 'Dest',
          },
        ],
        legMode: 'fetch',
        sailingToLayline: false,
        goalIsUpwind: true,
      },
    };
  }

  // Finish a planned tack through the no-go — not a new tack decision.
  const boatTwa = trueWindAngleDegrees(boat.headingDegrees, windFrom);
  if (mem.currentTack !== null && boatTwa < CLOSE_HAULED_TWA) {
    return {
      desiredHeadingDegrees: headings[mem.currentTack],
      memory: mem,
      reason: `Escape no-go · ${mem.currentTack}`,
      score: { strategy: 1, value: 2.5, detail: 'close-hauled leave no-go' },
      plan,
    };
  }

  const followingRoute = mem.tackRoute !== null;

  const commitAvoidanceTack = (
    nextTack: Tack,
    reason: string,
    detail: string,
  ): DriverDecision => {
    logTackPlan(boat.id, {
      event: 'tack',
      why: detail,
      reason,
      from: mem.currentTack,
      to: nextTack,
      boat: xy1(boat.x, boat.y),
      heading: r1(boat.headingDegrees),
      goal: mem.goalBuoyIndex,
      msSinceTack: Math.round(nowMs - mem.lastTackAtMs),
      clearedRoute: !!mem.tackRoute,
    });
    let after = commitTack(
      { ...mem, laylineTack: null, oneTackLock: null, tackRoute: null },
      nextTack,
      nowMs,
    );
    const goal = buoyByIndex(course, after.goalBuoyIndex);
    const rounding = resolveRoundingClear(after, goal, course, windFrom);
    const newT = planBeatTackPoint(
      boat,
      rounding,
      course,
      windFrom,
      nextTack,
    );
    after = {
      ...after,
      roundingClear: rounding,
      laylineTack: newT ? { x: newT.x, y: newT.y } : null,
    };
    return {
      desiredHeadingDegrees: headings[nextTack],
      memory: after,
      reason,
      score: { strategy: 1, value: 3, detail },
      plan: buildRaceStrategy(boat, after, course),
    };
  };

  // Entry layline before wall/fetch: never overstand onto the wrong approach.
  // Disabled while following a committed route (route owns tacks).
  if (
    !entryCommit &&
    !followingRoute &&
    mem.currentTack !== null &&
    mem.goalBuoyIndex === 1
  ) {
    const holdTack = mem.currentTack;
    const entryAimEarly = formalEntryAim(course, 1);
    const captureEarly = Math.max(plan.clearancePx * 0.85, 28);
    const holdOver = overstandPastLaylinePx(
      boat,
      entryAimEarly,
      windFrom,
      holdTack,
    );
    const clearlyPast = holdOver > captureEarly * 0.15;
    const cooledDown =
      nowMs - mem.lastTackAtMs >= MIN_TACK_INTERVAL_MS * 0.55;
    if (
      (clearlyPast || cooledDown) &&
      mustTackAtEntryLayline(boat, entryAimEarly, windFrom, holdTack, captureEarly)
    ) {
      const next: Tack = holdTack === 'port' ? 'starboard' : 'port';
      const nextOver = overstandPastLaylinePx(
        boat,
        entryAimEarly,
        windFrom,
        next,
      );
      // Clear overstand always tacks; on-layline tacks only when hold is worse.
      const holdIsWorseBoard = holdOver >= nextOver - captureEarly * 0.05;
      if (clearlyPast || holdIsWorseBoard) {
        return commitAvoidanceTack(
          next,
          `Layline tack → ${next} · ${markLabel}`,
          'on / past entry layline — never overstand',
        );
      }
    }
  }

  // Wall: still allowed while on a route (safety); clears the route.
  const wallTack = wallAvoidanceTack(
    boat,
    course,
    mem.currentTack,
    nowMs,
    mem.lastTackAtMs,
  );
  if (wallTack !== null) {
    return commitAvoidanceTack(
      wallTack,
      `Wall tack → ${wallTack}`,
      'auto tack off the wall',
    );
  }

  // Course vector hits another buoy → tack before the collision.
  if (!followingRoute && mem.currentTack !== null) {
    const buoyTack = buoyAvoidanceTack(
      boat,
      course,
      mem.currentTack,
      mem.goalBuoyIndex,
      plan.clearancePx,
      windFrom,
      nowMs,
      mem.lastTackAtMs,
      mem.laylineTack ?? plan.activeTarget,
    );
    if (buoyTack !== null) {
      return commitAvoidanceTack(
        buoyTack,
        `Buoy tack → ${buoyTack}`,
        'vector toward another mark — tack before',
      );
    }
  }

  // Fetchable or no-go destination: one helm path. Route commits only in no-go.
  const gateAim = { x: plan.clearTarget.x, y: plan.clearTarget.y };
  if (
    plan.legMode === 'fetch' ||
    targetPointInNoGo(boat, gateAim, windFrom) ||
    followingRoute
  ) {
    return helmSailToPoint(
      gateAim,
      `${markLabel} entry`,
      {
        roundingClear: plan.clearTarget,
        coneStage: plan.coneStage,
      },
      plan.legMode === 'fetch'
        ? `Fetch ${markLabel} entry gate`
        : `Sail ${markLabel} entry gate`,
    );
  }

  // --- Beat fallback (destination fetchable but plan still beat): hold CH ---
  const hold = mem.currentTack ?? 'starboard';
  const bearingToR = bearingDegreesTo(
    boat.x,
    boat.y,
    gateAim.x,
    gateAim.y,
  );
  const holdVmg = projectedVmg(headings[hold], windFrom, tws, bearingToR);
  mem = {
    ...mem,
    roundingClear: plan.clearTarget,
    coneStage: plan.coneStage,
  };
  return {
    desiredHeadingDegrees: headings[hold],
    memory: mem,
    reason: `Beat ${hold} · ${markLabel}`,
    score: {
      strategy: 1,
      value: 1,
      detail: `hold · VMG ${holdVmg.toFixed(1)}`,
    },
    plan: {
      ...plan,
      activeTarget: gateAim,
      sailingToLayline: false,
    },
  };
};

export const advanceBoatPosition = (
  boat: SailboatState,
  course: RaceCourse,
  deltaMs: number,
  speedScale = 1,
): SailboatState => {
  const dt = deltaMs / 1000;
  const speedPx = boat.speedKnots * Math.max(0, speedScale) * course.pixelsPerKnot;
  const distance = speedPx * dt;
  const dir = headingUnit(boat.headingDegrees);

  let x = boat.x + dir.x * distance;
  let y = boat.y + dir.y * distance;

  const pad = Math.max(16, Math.min(course.width, course.height) * 0.02);
  x = Math.min(course.width - pad, Math.max(pad, x));
  y = Math.min(course.height - pad, Math.max(pad, y));

  return { ...boat, x, y };
};
