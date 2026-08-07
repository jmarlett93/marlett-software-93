import { closeHauledHeadings, planMarkRounding, vmgTowardMark } from './boat-driver';
import { RaceCourse, buoyByIndex } from './course';
import { MELGES_HULL_LENGTH_PX } from './hull-geometry';
import {
  boatSpeedFromPolar,
  normalizeHeadingDegrees,
  shortestHeadingDelta,
  trueWindAngleDegrees,
} from './polars/melges-24-polar';
import { RaceBoat } from './race-fleet';
import { SailboatState } from './sailboat-state';

/**
 * Last-resort collision avoidance within 2 boat lengths.
 *
 * Decision tree (see `decideSteerClear`):
 *   1. Collision prediction — if no, stop
 *   2. Legitimate avoidance options only (each must clear the collision)
 *   3. Best strategic pick by projected VMG toward the current race goal
 */
export type SteerClearAction = 'none' | 'headUp' | 'bearOff' | 'tack' | 'depower';

export type SteerClearDecision = {
  action: SteerClearAction;
  /** Helm target for course changes; current heading when depowering. */
  headingDegrees: number | null;
  /** When true, movement this tick uses half speed; cleared after the update. */
  depower: boolean;
  reason: string | null;
};

const STEER_CLEAR_RANGE_PX = MELGES_HULL_LENGTH_PX * 2;
const CONTACT_RADIUS_PX = MELGES_HULL_LENGTH_PX * 0.95;
const PREDICT_TICKS = 2;
const BEAR_OFF_TWA_DEG = 110;
/**
 * Must match auto helm turn rate used while steer-clear is active
 * (`AUTO_TURN_RATE_DEG_PER_SEC * 1.45` in sailing-simulator.ts).
 * Predictions that ignore this fake “instant tacks” that cannot happen in 2 ticks.
 */
const STEER_CLEAR_TURN_RATE_DEG_PER_SEC = 110 * 1.45;
/** Blink window refreshed while steer-clear is acting. */
export const STEER_CLEAR_SIGNAL_MS = 280;

type Threat = {
  kind: 'boat' | 'buoy';
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
};

/** One candidate that has already been proven to avoid the collision. */
type AvoidanceOption = {
  action: Exclude<SteerClearAction, 'none'>;
  headingDegrees: number;
  depower: boolean;
  label: string;
};

const NO_ACTION: SteerClearDecision = {
  action: 'none',
  headingDegrees: null,
  depower: false,
  reason: null,
};

const headingUnit = (headingDegrees: number): { x: number; y: number } => {
  const radians = (headingDegrees * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
};

const velocityPxPerSec = (
  boat: Pick<SailboatState, 'headingDegrees' | 'speedKnots'>,
  course: Pick<RaceCourse, 'pixelsPerKnot'>,
  speedScale = 1,
): { vx: number; vy: number } => {
  const dir = headingUnit(boat.headingDegrees);
  const speedPx = boat.speedKnots * speedScale * course.pixelsPerKnot;
  return { vx: dir.x * speedPx, vy: dir.y * speedPx };
};

const bearingDegreesTo = (
  from: Pick<SailboatState, 'x' | 'y'>,
  to: Pick<{ x: number; y: number }, 'x' | 'y'>,
): number => {
  const dx = to.x - from.x;
  const dy = from.y - to.y;
  return normalizeHeadingDegrees((Math.atan2(dx, dy) * 180) / Math.PI);
};

const currentTackSide = (boat: RaceBoat): 1 | -1 => {
  if (boat.memory.currentTack === 'starboard') {
    return 1;
  }
  if (boat.memory.currentTack === 'port') {
    return -1;
  }
  return shortestHeadingDelta(boat.state.windFromDegrees, boat.state.headingDegrees) >= 0 ? 1 : -1;
};

/** Close-hauled on the current tack — head up without tacking. */
export const headUpHeading = (boat: RaceBoat): number => {
  const headings = closeHauledHeadings(boat.state.windFromDegrees);
  return currentTackSide(boat) >= 0 ? headings.starboard : headings.port;
};

/** Point further from the wind on the current tack (bear away). */
export const bearOffHeading = (boat: RaceBoat): number =>
  normalizeHeadingDegrees(boat.state.windFromDegrees + currentTackSide(boat) * BEAR_OFF_TWA_DEG);

/** Opposite close-hauled course. */
export const tackClearHeading = (boat: RaceBoat): number => {
  const headings = closeHauledHeadings(boat.state.windFromDegrees);
  return currentTackSide(boat) >= 0 ? headings.port : headings.starboard;
};

const gatherThreats = (
  self: RaceBoat,
  fleet: readonly RaceBoat[],
  course: RaceCourse,
): Threat[] => {
  const threats: Threat[] = [];

  for (const other of fleet) {
    if (other.spec.id === self.spec.id) {
      continue;
    }
    const range = Math.hypot(other.state.x - self.state.x, other.state.y - self.state.y);
    if (range > STEER_CLEAR_RANGE_PX) {
      continue;
    }
    const vel = velocityPxPerSec(other.state, course);
    threats.push({
      kind: 'boat',
      label: other.spec.shortName,
      x: other.state.x,
      y: other.state.y,
      vx: vel.vx,
      vy: vel.vy,
      radius: CONTACT_RADIUS_PX,
    });
  }

  for (const buoy of course.buoys) {
    const range = Math.hypot(buoy.x - self.state.x, buoy.y - self.state.y);
    const radius = course.markRadiusPx * 0.55 + CONTACT_RADIUS_PX * 0.35;
    if (range > STEER_CLEAR_RANGE_PX + radius) {
      continue;
    }
    threats.push({
      kind: 'buoy',
      label: `buoy ${buoy.index}`,
      x: buoy.x,
      y: buoy.y,
      vx: 0,
      vy: 0,
      radius,
    });
  }

  return threats;
};

/** True when relative motion is closing and closest approach is inside contact. */
const isCollisionCourse = (self: SailboatState, course: RaceCourse, threat: Threat): boolean => {
  const dx = threat.x - self.x;
  const dy = threat.y - self.y;
  const range = Math.hypot(dx, dy);
  const hitAt = threat.radius + CONTACT_RADIUS_PX * 0.25;
  if (range <= hitAt) {
    return true;
  }

  const selfVel = velocityPxPerSec(self, course);
  const relVx = threat.vx - selfVel.vx;
  const relVy = threat.vy - selfVel.vy;
  const rangeRate = dx * relVx + dy * relVy;
  if (rangeRate >= 0) {
    return false;
  }

  const approachSpeedSq = relVx * relVx + relVy * relVy;
  if (approachSpeedSq < 1e-6) {
    return false;
  }
  const timeToClosest = -rangeRate / approachSpeedSq;
  if (timeToClosest < 0 || timeToClosest > 2.5) {
    return false;
  }

  const closestDx = dx + relVx * timeToClosest;
  const closestDy = dy + relVy * timeToClosest;
  return Math.hypot(closestDx, closestDy) < hitAt * 1.15;
};

const speedAtHeading = (boat: SailboatState, headingDegrees: number): number => {
  const twa = trueWindAngleDegrees(headingDegrees, boat.windFromDegrees);
  return boatSpeedFromPolar(boat.trueWindSpeedKnots, twa);
};

const predictThreatPose = (
  threat: Threat,
  deltaMs: number,
  ticks: number,
): { x: number; y: number } => ({
  x: threat.x + threat.vx * (deltaMs / 1000) * ticks,
  y: threat.y + threat.vy * (deltaMs / 1000) * ticks,
});

/** Minimum predicted clearance to any threat over the next 2 ticks (turn-rate aware). */
const predictedClearance = (
  boat: SailboatState,
  targetHeading: number,
  threats: readonly Threat[],
  course: RaceCourse,
  deltaMs: number,
  speedScale = 1,
): number => {
  let minClear = Number.POSITIVE_INFINITY;
  let heading = boat.headingDegrees;
  let x = boat.x;
  let y = boat.y;
  const maxStep = STEER_CLEAR_TURN_RATE_DEG_PER_SEC * (deltaMs / 1000);
  const dt = deltaMs / 1000;

  for (let tick = 1; tick <= PREDICT_TICKS; tick += 1) {
    const delta = shortestHeadingDelta(heading, targetHeading);
    const step = Math.max(-maxStep, Math.min(maxStep, delta));
    heading = normalizeHeadingDegrees(heading + step);
    const speed = speedAtHeading({ ...boat, headingDegrees: heading }, heading) * speedScale;
    const dist = speed * course.pixelsPerKnot * dt;
    const dir = headingUnit(heading);
    x += dir.x * dist;
    y += dir.y * dist;

    for (const threat of threats) {
      const threatPose = predictThreatPose(threat, deltaMs, tick);
      const range = Math.hypot(x - threatPose.x, y - threatPose.y);
      const clear = range - (threat.radius + CONTACT_RADIUS_PX * 0.35);
      minClear = Math.min(minClear, clear);
    }
  }
  return minClear;
};

/**
 * Sign of the turn that opens the threat: opposite the bearing to the object.
 * +1 = turn starboard (clockwise), -1 = turn port.
 */
const turnAwaySign = (boat: SailboatState, threat: Threat): 1 | -1 => {
  const toThreat = shortestHeadingDelta(boat.headingDegrees, bearingDegreesTo(boat, threat));
  return toThreat >= 0 ? -1 : 1;
};

/** True when changing to `heading` turns toward the away-from-threat side. */
const turnsAwayFromThreat = (
  boat: SailboatState,
  headingDegrees: number,
  awaySign: 1 | -1,
): boolean => {
  const delta = shortestHeadingDelta(boat.headingDegrees, headingDegrees);
  if (Math.abs(delta) < 2) {
    return false;
  }
  return Math.sign(delta) === awaySign;
};

/** Active rounding / race aim point for VMG scoring. */
const goalPointFor = (boat: RaceBoat, course: RaceCourse): { x: number; y: number } => {
  const goal = buoyByIndex(course, boat.memory.goalBuoyIndex);
  return planMarkRounding(boat.state, goal, course, boat.memory).activeTarget;
};

/**
 * Projected VMG toward the race goal if we sail `heading`
 * (optionally depowered at half boatspeed).
 */
const goalVmgForOption = (
  boat: SailboatState,
  option: AvoidanceOption,
  goal: { x: number; y: number },
): number => {
  const bearing = bearingDegreesTo(boat, goal);
  const speed = speedAtHeading(boat, option.headingDegrees) * (option.depower ? 0.5 : 1);
  return vmgTowardMark(speed, option.headingDegrees, bearing);
};

/**
 * Step 2 — keep only options that actually avoid the predicted collision.
 * - head up / bear off: must turn open the threat and clear in 2 ticks
 * - tack: must clear in 2 ticks (may cross the wind)
 * - depower: never vs a buoy (stationary — slowing changes nothing useful);
 *   vs a boat only if half-speed improves clearance
 */
const collectLegitimateOptions = (
  boat: SailboatState,
  primary: Threat,
  threats: readonly Threat[],
  course: RaceCourse,
  deltaMs: number,
  away: 1 | -1,
  candidates: readonly AvoidanceOption[],
): AvoidanceOption[] => {
  const holdClear = predictedClearance(boat, boat.headingDegrees, threats, course, deltaMs);

  const clearsAt = (headingDegrees: number, speedScale: number): boolean =>
    predictedClearance(boat, headingDegrees, threats, course, deltaMs, speedScale) > holdClear + 1;

  return candidates.filter((option) => {
    if (option.action === 'depower') {
      // Depowering into a buoy does not change the collision geometry usefully.
      if (primary.kind === 'buoy') {
        return false;
      }
      return clearsAt(option.headingDegrees, 0.5);
    }

    // Turn-rate aware: a full tack cannot complete in 2 ticks, so it will not
    // falsely "clear" a buoy the way an instant heading teleport used to.
    if (!clearsAt(option.headingDegrees, 1)) {
      return false;
    }

    // Same-tack helm changes must open the threat, not turn into it.
    if (option.action === 'headUp' || option.action === 'bearOff') {
      return turnsAwayFromThreat(boat, option.headingDegrees, away);
    }

    return true;
  });
};

/**
 * Step 3 — among legitimate avoidance options, pick the best projected VMG
 * toward the current race goal (no fixed tack-over-bear-off priority).
 */
const pickBestByGoalVmg = (
  boat: SailboatState,
  options: readonly AvoidanceOption[],
  goal: { x: number; y: number },
): AvoidanceOption | null => {
  if (options.length === 0) {
    return null;
  }

  let best = options[0];
  let bestVmg = goalVmgForOption(boat, best, goal);
  for (let i = 1; i < options.length; i += 1) {
    const option = options[i];
    const vmg = goalVmgForOption(boat, option, goal);
    if (vmg > bestVmg) {
      best = option;
      bestVmg = vmg;
    }
  }
  return best;
};

/**
 * Last-resort steer-clear skill — reducing decision tree:
 *
 *   1. Collision detection prediction → if no, return none
 *   2. Build legitimate avoidance options only
 *   3. Choose the best by VMG toward the current goal
 */
export const decideSteerClear = (
  boat: RaceBoat,
  fleet: readonly RaceBoat[],
  course: RaceCourse,
  deltaMs: number,
): SteerClearDecision => {
  if (boat.state.trueWindSpeedKnots <= 0 && boat.state.speedKnots <= 0) {
    return NO_ACTION;
  }

  // -------------------------------------------------------------------------
  // 1) Collision detection prediction
  // -------------------------------------------------------------------------
  const threats = gatherThreats(boat, fleet, course);
  if (threats.length === 0) {
    return NO_ACTION;
  }

  const colliding = threats.filter((threat) => isCollisionCourse(boat.state, course, threat));
  if (colliding.length === 0) {
    return NO_ACTION;
  }

  const tickMs = Math.max(8, Math.min(48, deltaMs));
  const primary = colliding[0];
  const away = turnAwaySign(boat.state, primary);
  const goal = goalPointFor(boat, course);

  // -------------------------------------------------------------------------
  // 2) Possible options to avoid collision (illegitimate ones are dropped)
  // -------------------------------------------------------------------------
  const rawCandidates: AvoidanceOption[] = [
    {
      action: 'headUp',
      headingDegrees: headUpHeading(boat),
      depower: false,
      label: 'head up',
    },
    {
      action: 'bearOff',
      headingDegrees: bearOffHeading(boat),
      depower: false,
      label: 'bear off',
    },
    {
      action: 'tack',
      headingDegrees: tackClearHeading(boat),
      depower: false,
      label: 'tack',
    },
    {
      action: 'depower',
      headingDegrees: boat.state.headingDegrees,
      depower: true,
      label: 'depower',
    },
  ];

  let options = collectLegitimateOptions(
    boat.state,
    primary,
    threats,
    course,
    tickMs,
    away,
    rawCandidates,
  );

  // Rounding a buoy: if a same-tack clear exists, never choose tack over it.
  if (primary.kind === 'buoy') {
    const sameTack = options.filter(
      (option) => option.action === 'headUp' || option.action === 'bearOff',
    );
    if (sameTack.length > 0) {
      options = sameTack;
    }
  }

  if (options.length === 0) {
    return NO_ACTION;
  }

  // -------------------------------------------------------------------------
  // 3) Best strategic decision for VMG and current goal
  // -------------------------------------------------------------------------
  const best = pickBestByGoalVmg(boat.state, options, goal);
  if (!best) {
    return NO_ACTION;
  }

  return {
    action: best.action,
    headingDegrees: best.headingDegrees,
    depower: best.depower,
    reason: `Steer clear · ${best.label} (${primary.label})`,
  };
};
