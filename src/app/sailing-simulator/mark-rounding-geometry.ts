import { Buoy, RaceCourse, buoyByIndex, nextBuoyIndex } from './course';
import { MELGES_HULL_BEAM_PX, MELGES_HULL_LENGTH_PX } from './hull-geometry';
import { normalizeHeadingDegrees, shortestHeadingDelta } from './polars/melges-24-polar';

export type Point = {
  x: number;
  y: number;
};

export type RoundingSense = 'cw' | 'ccw';

export type EntryGate = {
  mark: Point;
  /** Unit direction of the entry ray from the mark (leave-to / In). */
  ray: Point;
  /** Unit normal: +side = approach/outside (must cross to ≤0 to arm). */
  normal: Point;
  /** Sail-to on the ray, outside the path circle (approach target). */
  aim: Point;
  /** Point just past the gate line so the boat must cross In. */
  through: Point;
  tip: Point;
};

export type MarkRoundingSpec = {
  markIndex: 1 | 2 | 3;
  mark: Buoy;
  next: Buoy;
  sense: RoundingSense;
  /**
   * Leave-to planning envelope (point boat + fat mark). Used to place the
   * entry gate / path circle — not for centerline chord obstruction.
   */
  clearancePx: number;
  /**
   * Centerline chord vs mark body: mark hit radius + half hull beam + 1px.
   * Matches contact scale; look-ahead uses this, not clearancePx.
   */
  chordClearancePx: number;
  pathRadiusPx: number;
  entryGate: EntryGate;
};

export type BoatPose = Point & {
  headingDegrees: number;
};

export type RoundingPolygon = {
  markIndex: 1 | 2 | 3;
  sense: RoundingSense;
  clearancePx: number;
  pathRadiusPx: number;
  start: Point;
  entryPoint: Point;
  exitPoint: Point;
  nextAim: Point;
  entryAngleDeg: number;
  exitAngleDeg: number;
  sweepDeg: number;
  exitBearingDegrees: number;
  turnDeltaDegrees: number;
  /** Arc vertices from entry→exit (includes exit). Empty only if already clear. */
  waypoints: readonly Point[];
};

export type RoundingGeometryLog = {
  markIndex: 1 | 2 | 3;
  sense: RoundingSense;
  clearancePx: number;
  pathRadiusPx: number;
  boat: [number, number];
  heading: number;
  entryGate: {
    aim: [number, number];
    through: [number, number];
    tip: [number, number];
    side: number;
  };
  entryPoint: [number, number];
  exitPoint: [number, number];
  nextAim: [number, number];
  entryAngleDeg: number;
  exitAngleDeg: number;
  sweepDeg: number;
  exitBearingDeg: number;
  turnDeltaDeg: number;
  waypoints: readonly [number, number][];
  directClear: boolean;
  invariants: readonly string[];
};

const EPS = 1e-6;
const PATH_RADIUS_FACTOR = 1.55;
const MAX_ARC_STEP_DEG = 48;
/** Reject stub arcs that sit next to the mark instead of going around it. */
const MIN_SWEEP_DEG = 75;

export const roundingSenseForMark = (
  course: Pick<RaceCourse, 'side'>,
  markIndex: 1 | 2 | 3,
): RoundingSense => {
  if (markIndex === 1 || course.side === 'left') {
    return 'ccw';
  }
  return 'cw';
};

export const previousMarkIndex = (current: 1 | 2 | 3): 1 | 2 | 3 => {
  if (current === 1) {
    return 3;
  }
  if (current === 2) {
    return 1;
  }
  return 2;
};

export const markClearanceRadiusPx = (
  course: Pick<RaceCourse, 'markRadiusPx'>,
): number =>
  course.markRadiusPx +
  MELGES_HULL_LENGTH_PX * 0.55 +
  course.markRadiusPx * 0.25;

export const hullLeaveClearancePx = (
  course: Pick<RaceCourse, 'markRadiusPx'>,
): number =>
  Math.max(
    markClearanceRadiusPx(course),
    course.markRadiusPx + MELGES_HULL_BEAM_PX * 0.55 + 4,
  );

/** Mark hit disk + half beam + 1px — boat treated as a centerline point. */
export const markHullChordClearancePx = (
  course: Pick<RaceCourse, 'markRadiusPx'>,
): number =>
  course.markRadiusPx * 0.55 + MELGES_HULL_BEAM_PX * 0.5 + 1;

export const bearingDegreesTo = (from: Point, to: Point): number => {
  const dx = to.x - from.x;
  const dy = from.y - to.y;
  return normalizeHeadingDegrees((Math.atan2(dx, dy) * 180) / Math.PI);
};

export const headingUnit = (headingDegrees: number): Point => {
  const radians = (headingDegrees * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
};

export const distance = (a: Point, b: Point): number =>
  Math.hypot(b.x - a.x, b.y - a.y);

export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;

export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;

export const rightOf = (v: Point): Point => ({ x: -v.y, y: v.x });

export const leftOf = (v: Point): Point => ({ x: v.y, y: -v.x });

export const unitVector = (from: Point, to: Point): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
};

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

export const scale = (v: Point, n: number): Point => ({ x: v.x * n, y: v.y * n });

export const normalize = (v: Point): Point => {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
};

export const pointFromAngle = (
  center: Point,
  radius: number,
  angleDegrees: number,
): Point => {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius,
  };
};

export const angleFromCenter = (center: Point, point: Point): number =>
  normalizeHeadingDegrees(
    (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI,
  );

export const clockwiseDelta = (fromDegrees: number, toDegrees: number): number =>
  normalizeHeadingDegrees(toDegrees - fromDegrees);

/**
 * Step along atan2 math angles for a *visual* CW/CCW arc on a y-down board
 * (Pixi): increasing atan2 is clockwise on screen, so visual CCW decreases
 * the math angle.
 */
export const mathArcDir = (sense: RoundingSense): 1 | -1 =>
  sense === 'ccw' ? -1 : 1;

/** Boat-heading turn sign: +1 = clockwise, -1 = counter-clockwise. */
export const headingTurnDir = (sense: RoundingSense): 1 | -1 =>
  sense === 'cw' ? 1 : -1;

/** @deprecated Use mathArcDir for circles, headingTurnDir for helm headings. */
export const senseDirection = mathArcDir;

export const monotoneTurnDelta = (
  fromHeadingDegrees: number,
  toHeadingDegrees: number,
  sense: RoundingSense,
): number => {
  const dir = headingTurnDir(sense);
  const clockwise = clockwiseDelta(fromHeadingDegrees, toHeadingDegrees);
  const delta = dir === 1 ? clockwise : normalizeHeadingDegrees(-clockwise);
  return dir * delta;
};

export const segmentClearanceToPoint = (
  point: Point,
  from: Point,
  to: Point,
): number => {
  const ab = { x: to.x - from.x, y: to.y - from.y };
  const lenSq = dot(ab, ab);
  if (lenSq < EPS) {
    return distance(point, from);
  }
  const ap = { x: point.x - from.x, y: point.y - from.y };
  const t = Math.max(0, Math.min(1, dot(ap, ab) / lenSq));
  const closest = { x: from.x + ab.x * t, y: from.y + ab.y * t };
  return distance(point, closest);
};

export const pathClearsDisk = (
  from: Point,
  to: Point,
  center: Point,
  radius: number,
  epsilon = 0,
): boolean => {
  const minClear = segmentClearanceToPoint(center, from, to);
  const startDist = distance(center, from);
  // Already inside the disk: the start point alone would fail a hard radius
  // check and block every look-ahead chord. Allow the leg iff it does not go
  // deeper than we already are (closest approach stays at/near `from`).
  if (startDist < radius - epsilon) {
    return minClear >= startDist - epsilon;
  }
  return minClear >= radius - epsilon;
};

const pastDirForSpec = (
  course: RaceCourse,
  mark: Buoy,
): Point => {
  const windFrom = course.windFromDegrees ?? 0;
  const upwind = headingUnit(windFrom);
  if (mark.index === 1) {
    return upwind;
  }
  if (mark.index === 3) {
    return scale(upwind, -1);
  }
  const prev = buoyByIndex(course, previousMarkIndex(mark.index));
  return unitVector(prev, mark);
};

const leaveToDirForSpec = (course: RaceCourse, mark: Buoy): Point => {
  const sense = roundingSenseForMark(course, mark.index);
  // Windward: leave-to in the wind frame (port = right looking upwind).
  if (mark.index === 1) {
    const upwind = headingUnit(course.windFromDegrees ?? 0);
    return sense === 'ccw' ? rightOf(upwind) : leftOf(upwind);
  }
  const prev = buoyByIndex(course, previousMarkIndex(mark.index));
  const inbound = unitVector(prev, mark);
  return sense === 'ccw' ? rightOf(inbound) : leftOf(inbound);
};

export const pointSideOfEntryGate = (point: Point, gate: EntryGate): number =>
  dot({ x: point.x - gate.mark.x, y: point.y - gate.mark.y }, gate.normal);

export const crossedEntryGate = (
  previousSide: number | null,
  currentSide: number,
): boolean => previousSide !== null && previousSide > 2 && currentSide <= 0;

/**
 * Near the aim→through portal (not merely on the infinite gate half-plane).
 * Distant CH legs can cross side +→− far from Entry; those must not arm.
 */
export const inEntryPortal = (
  boat: Point,
  spec: MarkRoundingSpec,
): boolean => {
  const r = spec.clearancePx * 2.6;
  const { aim, through, ray } = spec.entryGate;
  const entry = add(spec.mark, scale(ray, spec.pathRadiusPx));
  return (
    distance(boat, aim) <= r ||
    distance(boat, through) <= r ||
    distance(boat, entry) <= r
  );
};

export const buildMarkRoundingSpec = (
  course: RaceCourse,
  markIndex: 1 | 2 | 3,
): MarkRoundingSpec => {
  const mark = buoyByIndex(course, markIndex);
  const next = buoyByIndex(course, nextBuoyIndex(markIndex));
  const sense = roundingSenseForMark(course, markIndex);
  const clearancePx = hullLeaveClearancePx(course);
  const chordClearancePx = markHullChordClearancePx(course);
  const pathRadiusPx = clearancePx * PATH_RADIUS_FACTOR;
  const past = pastDirForSpec(course, mark);
  const leave = leaveToDirForSpec(course, mark);
  // Far-side leave-to ray: upwind of mark 1, past the mark for 2/3.
  const ray = normalize(add(scale(past, 1), scale(leave, 0.9)));
  // +normal = outside/approach (leave-to); boat must cross to ≤0 to arm.
  const normalA = rightOf(ray);
  const normalB = leftOf(ray);
  const normal = dot(normalA, leave) >= dot(normalB, leave) ? normalA : normalB;
  const contact = add(mark, scale(ray, pathRadiusPx));
  // Approach from outside on leave-to, then through the gate into the cone.
  const aim = add(contact, scale(normal, clearancePx * 1.1));
  const through = add(contact, scale(normal, -clearancePx * 0.45));
  const tip = add(mark, scale(ray, pathRadiusPx * 2.4));
  return {
    markIndex,
    mark,
    next,
    sense,
    clearancePx,
    chordClearancePx,
    pathRadiusPx,
    entryGate: {
      mark,
      ray,
      normal,
      aim,
      through,
      tip,
    },
  };
};

const tangentPointsFromExternalPoint = (
  center: Point,
  radius: number,
  external: Point,
): [Point, Point] => {
  const fromCenter = { x: external.x - center.x, y: external.y - center.y };
  const d = Math.hypot(fromCenter.x, fromCenter.y);
  if (d <= radius + EPS) {
    const away = normalize(fromCenter);
    const base = add(center, scale(away, radius));
    return [base, base];
  }
  const baseAngle = angleFromCenter(center, external);
  const offset = (Math.acos(Math.min(1, radius / d)) * 180) / Math.PI;
  return [
    pointFromAngle(center, radius, baseAngle + offset),
    pointFromAngle(center, radius, baseAngle - offset),
  ];
};

/**
 * Positive sweep from→to in the *visual* rounding sense on a y-down board.
 * Visual CCW = decreasing atan2; visual CW = increasing atan2.
 */
const sweepDegrees = (
  fromAngle: number,
  toAngle: number,
  sense: RoundingSense,
): number =>
  sense === 'ccw'
    ? normalizeHeadingDegrees(fromAngle - toAngle)
    : normalizeHeadingDegrees(toAngle - fromAngle);

export const exitTangentToward = (
  spec: MarkRoundingSpec,
  entryPoint: Point,
): Point => {
  const candidates = tangentPointsFromExternalPoint(
    spec.mark,
    spec.pathRadiusPx,
    spec.next,
  );
  const entryAngle = angleFromCenter(spec.mark, entryPoint);
  const ranked = candidates
    .map((point) => {
      const exitAngle = angleFromCenter(spec.mark, point);
      const sweep = sweepDegrees(entryAngle, exitAngle, spec.sense);
      return {
        point,
        sweep,
        clears: pathClearsDisk(point, spec.next, spec.mark, spec.clearancePx, 0.5),
      };
    })
    .filter((candidate) => candidate.clears)
    .sort((a, b) => a.sweep - b.sweep);

  // Prefer the shortest path that still goes AROUND the mark.
  const around = ranked.find((candidate) => candidate.sweep >= MIN_SWEEP_DEG);
  if (around) {
    return around.point;
  }

  // Otherwise take the longer sense-consistent tangent (never the stub).
  return [...ranked].sort((a, b) => b.sweep - a.sweep)[0]?.point
    ?? candidates[0];
};

const markIsOnRoundingSide = (
  from: Point,
  to: Point,
  mark: Point,
  sense: RoundingSense,
): boolean => {
  const path = { x: to.x - from.x, y: to.y - from.y };
  const toMark = { x: mark.x - from.x, y: mark.y - from.y };
  // Pixi y-down: negative cross = mark to screen-left of the path.
  // Port/CCW keeps the mark on the left; starboard/CW on the right.
  const side = cross(path, toMark);
  return sense === 'ccw' ? side < -EPS : side > EPS;
};

const r1 = (n: number): number => Math.round(n * 10) / 10;
const xy = (p: Point): [number, number] => [r1(p.x), r1(p.y)];

export const buildRoundingPolygon = (
  spec: MarkRoundingSpec,
  pose: BoatPose,
): RoundingPolygon => {
  // Entry contact is the gate ray ∩ path circle — not the boat radial projection.
  const entryPoint = add(spec.mark, scale(spec.entryGate.ray, spec.pathRadiusPx));
  const exitPoint = exitTangentToward(spec, entryPoint);
  const entryAngleDeg = angleFromCenter(spec.mark, entryPoint);
  const exitAngleDeg = angleFromCenter(spec.mark, exitPoint);
  let sweepDeg = sweepDegrees(entryAngleDeg, exitAngleDeg, spec.sense);
  if (sweepDeg < MIN_SWEEP_DEG) {
    sweepDeg = MIN_SWEEP_DEG;
  }
  const exitBearingDegrees = bearingDegreesTo(exitPoint, spec.next);
  const turnDeltaDegrees = monotoneTurnDelta(
    pose.headingDegrees,
    exitBearingDegrees,
    spec.sense,
  );

  // Always build the around-mark arc — never "direct clear" to Exit while
  // still on the approach side (that plotted Exit on the wrong side).
  const segments = Math.max(2, Math.ceil(sweepDeg / MAX_ARC_STEP_DEG));
  const dir = mathArcDir(spec.sense);
  // Do NOT send the boat back to entry contact after it already crossed
  // through the gate — start the path ahead toward the exit.
  const boatAngle = angleFromCenter(spec.mark, pose);
  const boatAlong = sweepDegrees(entryAngleDeg, boatAngle, spec.sense);
  const startFraction =
    distance(pose, spec.mark) >= spec.pathRadiusPx * 0.75 &&
    boatAlong > 2 &&
    boatAlong < sweepDeg
      ? Math.min(0.85, boatAlong / sweepDeg)
      : 0.08;
  const waypoints: Point[] = [];

  for (let i = 1; i <= segments; i += 1) {
    const fraction = i / segments;
    if (fraction + EPS < startFraction) {
      continue;
    }
    const angle = entryAngleDeg + dir * sweepDeg * fraction;
    const point = pointFromAngle(spec.mark, spec.pathRadiusPx, angle);
    const prev = waypoints[waypoints.length - 1];
    if (!prev || distance(prev, point) > 2) {
      waypoints.push(point);
    }
  }

  // Ensure last vertex is the true exit tangent.
  if (waypoints.length === 0) {
    waypoints.push(exitPoint);
  } else if (distance(waypoints[waypoints.length - 1], exitPoint) > 2) {
    waypoints.push(exitPoint);
  } else {
    waypoints[waypoints.length - 1] = exitPoint;
  }

  return {
    markIndex: spec.markIndex,
    sense: spec.sense,
    clearancePx: spec.clearancePx,
    pathRadiusPx: spec.pathRadiusPx,
    start: { x: pose.x, y: pose.y },
    entryPoint,
    exitPoint,
    nextAim: spec.next,
    entryAngleDeg,
    exitAngleDeg,
    sweepDeg,
    exitBearingDegrees,
    turnDeltaDegrees,
    waypoints,
  };
};

/** Sail path while rounding: polygon vertices only (next mark after exit). */
export const shortestPathForRounding = (
  polygon: RoundingPolygon,
): readonly Point[] => polygon.waypoints;

/** Disk obstacle for a straight-line chord (mark today; boats later). */
export type ChordObstacle = {
  x: number;
  y: number;
  radiusPx: number;
};

/** Look-ahead: next polygon waypoints after current index (clamped if fewer). */
export const ROUNDING_WAYPOINT_LOOKAHEAD = 5;

/**
 * True when the segment from→to clips any obstacle disk.
 * Keep this dumb — callers compose the obstacle list (mark, boats, …).
 *
 * Future: when obstacles include other boats, prefer predicted positions
 * along each boat's heading/speed over the decision horizon (see foul-clear
 * TODO in foul-penalty.ts) so we don't turn into traffic that is still clear
 * at t=0 but occupies the chord mid-maneuver.
 */
export const chordIsObstructed = (
  from: Point,
  to: Point,
  obstacles: readonly ChordObstacle[],
): boolean => {
  for (const obstacle of obstacles) {
    if (!pathClearsDisk(from, to, obstacle, obstacle.radiusPx, 1)) {
      return true;
    }
  }
  return false;
};

/** Optional bias while scanning clear chords (e.g. fetchable / no tack). */
export type RoundingWaypointPrefer = (point: Point, index: number) => boolean;

/**
 * Rounding-only: among the next `lookAhead` waypoints (default 5, clamped to
 * remaining vertices), aim at the farthest whose boat→waypoint chord is
 * unobstructed. When `prefer` is set, take the farthest clear waypoint that
 * also satisfies it (e.g. not in the no-go); otherwise fall back to farthest
 * clear. `maxIndexInclusive` caps the scan (e.g. exclude Exit until on-arc).
 * Does not use next-mark geometry or approach tack planning.
 */
export const furthestUnobstructedRoundingWaypointIndex = (
  boat: Point,
  vertices: readonly Point[],
  fromIndex: number,
  obstacles: readonly ChordObstacle[],
  lookAhead: number = ROUNDING_WAYPOINT_LOOKAHEAD,
  prefer?: RoundingWaypointPrefer,
  maxIndexInclusive?: number,
): number => {
  if (fromIndex >= vertices.length || lookAhead <= 0) {
    return fromIndex;
  }
  const hardLast =
    maxIndexInclusive === undefined
      ? vertices.length - 1
      : Math.min(maxIndexInclusive, vertices.length - 1);
  if (fromIndex > hardLast) {
    return fromIndex;
  }
  const last = Math.min(fromIndex + lookAhead - 1, hardLast);
  let bestClear = fromIndex;
  let bestPreferred = -1;
  for (let i = fromIndex; i <= last; i += 1) {
    if (chordIsObstructed(boat, vertices[i]!, obstacles)) {
      continue;
    }
    bestClear = i;
    if (prefer?.(vertices[i]!, i)) {
      bestPreferred = i;
    }
  }
  return bestPreferred >= 0 ? bestPreferred : bestClear;
};

/** @deprecated Prefer furthestUnobstructedRoundingWaypointIndex + chordIsObstructed. */
export const furthestClearRoundingWaypointIndex = (
  boat: Point,
  vertices: readonly Point[],
  fromIndex: number,
  mark: Point,
  clearancePx: number,
  _sense: RoundingSense,
): number =>
  furthestUnobstructedRoundingWaypointIndex(
    boat,
    vertices,
    fromIndex,
    [{ x: mark.x, y: mark.y, radiusPx: clearancePx }],
  );

export type RoundingInvariantResult = {
  ok: boolean;
  errors: readonly string[];
};

export const assertRoundingInvariants = (
  polygon: RoundingPolygon,
  spec: MarkRoundingSpec,
  startHeadingDegrees: number,
): RoundingInvariantResult => {
  const errors: string[] = [];
  const path = [polygon.start, ...polygon.waypoints];

  let heading = startHeadingDegrees;
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i];
    const to = path[i + 1];
    const clearance = segmentClearanceToPoint(spec.mark, from, to);
    if (clearance < spec.clearancePx - 0.75) {
      errors.push(`segment ${i} clips disk: ${clearance.toFixed(2)}`);
    }
    // Skip boat→first-arc chord: after gate-through the boat may be slightly
    // inside before it latches onto the path circle.
    if (
      i > 0 &&
      distance(from, to) > 4 &&
      !markIsOnRoundingSide(from, to, spec.mark, spec.sense) &&
      clearance < spec.pathRadiusPx
    ) {
      errors.push(`segment ${i} puts mark on wrong side`);
    }
    const nextHeading = bearingDegreesTo(from, to);
    const delta = monotoneTurnDelta(heading, nextHeading, spec.sense);
    if (spec.sense === 'ccw' && delta > 8) {
      errors.push(`segment ${i} turns clockwise during ccw round`);
    }
    if (spec.sense === 'cw' && delta < -8) {
      errors.push(`segment ${i} turns counter-clockwise during cw round`);
    }
    heading = nextHeading;
  }

  if (polygon.waypoints.length > 0) {
    const last = polygon.waypoints[polygon.waypoints.length - 1];
    if (distance(last, polygon.exitPoint) > 3) {
      errors.push('path does not end at exit tangent');
    }
  }

  const finalBearing = bearingDegreesTo(polygon.exitPoint, polygon.nextAim);
  if (Math.abs(shortestHeadingDelta(finalBearing, polygon.exitBearingDegrees)) > 2) {
    errors.push('exit bearing mismatch');
  }

  return { ok: errors.length === 0, errors };
};

export const describeRoundingGeometry = (
  spec: MarkRoundingSpec,
  pose: BoatPose,
  polygon: RoundingPolygon,
): RoundingGeometryLog => {
  const invariants = assertRoundingInvariants(
    polygon,
    spec,
    pose.headingDegrees,
  ).errors;
  return {
    markIndex: spec.markIndex,
    sense: spec.sense,
    clearancePx: r1(spec.clearancePx),
    pathRadiusPx: r1(spec.pathRadiusPx),
    boat: xy(pose),
    heading: r1(pose.headingDegrees),
    entryGate: {
      aim: xy(spec.entryGate.aim),
      through: xy(spec.entryGate.through),
      tip: xy(spec.entryGate.tip),
      side: r1(pointSideOfEntryGate(pose, spec.entryGate)),
    },
    entryPoint: xy(polygon.entryPoint),
    exitPoint: xy(polygon.exitPoint),
    nextAim: xy(polygon.nextAim),
    entryAngleDeg: r1(polygon.entryAngleDeg),
    exitAngleDeg: r1(polygon.exitAngleDeg),
    sweepDeg: r1(polygon.sweepDeg),
    exitBearingDeg: r1(polygon.exitBearingDegrees),
    turnDeltaDeg: r1(polygon.turnDeltaDegrees),
    waypoints: polygon.waypoints.map(xy),
    directClear: polygon.sweepDeg === 0,
    invariants,
  };
};
