import { RaceCourse } from './course';
import { MELGES_HULL_LENGTH_PX } from './hull-geometry';
import {
  helmConflictPos,
  noteHelmConflict,
} from './helm-conflict-log';
import {
  ChordObstacle,
  chordIsObstructed,
  hullLeaveClearancePx,
} from './mark-rounding-geometry';
import {
  normalizeHeadingDegrees,
  shortestHeadingDelta,
} from './polars/melges-24-polar';
import { FoulClearPlanId, FoulPhase, RaceBoat } from './race-fleet';

export type FoulPenaltyDecision = {
  mode: FoulPhase | 'none';
  /** Seek this heading while steering clear (legacy / unused for V1 spin). */
  headingDegrees: number | null;
  /** Continuous turn direction while spinning the 360. */
  spinSign: 1 | -1 | null;
  reason: string | null;
};

const FOUL_COOLDOWN_MS = 1_800;
const SPIN_COMPLETE_DEG = 360;
const CLEAR_ARC_SAMPLE_DEG = 30;
const CLEAR_ARC_RADIUS_PX = MELGES_HULL_LENGTH_PX * 1.35;
const BOAT_OBSTACLE_RADIUS_PX = MELGES_HULL_LENGTH_PX * 0.85;

const preferredSide = (boat: RaceBoat): 1 | -1 => {
  if (boat.memory.currentTack === 'starboard') {
    return 1;
  }
  if (boat.memory.currentTack === 'port') {
    return -1;
  }
  return shortestHeadingDelta(boat.state.windFromDegrees, boat.state.headingDegrees) >=
    0
    ? 1
    : -1;
};

/** True while a foul is on the books (pending or spinning). */
export const isServingFoulPenalty = (boat: RaceBoat): boolean =>
  boat.foulPhase !== 'none';

/** True only while the 360 owns the helm (not while deferred for rounding). */
export const isFoulOwningHelm = (boat: RaceBoat): boolean =>
  boat.foulPhase === 'spin360';

const clearFoulPenalty = (boat: RaceBoat, nowMs: number): void => {
  boat.foulPhase = 'none';
  boat.foulSpinAccumulatedDeg = 0;
  boat.foulSpinSign = 1;
  boat.foulClearPlan = null;
  boat.foulSteerClearUntilMs = 0;
  boat.foulUntilMs = nowMs;
  boat.recoveryReason = null;
  boat.trafficRule = boat.lastFoulReason
    ? `Cleared · ${boat.lastFoulReason}`
    : null;
};

/**
 * Obstacles for foul-clear path checks (mark + other boats today).
 *
 * TODO(future-boat-state): project each other boat along its current heading
 * (and likely speed) over the foul-clear horizon so we don't pick a 360 that
 * is clear now but collides with traffic arriving mid-turn. Until then, use
 * static positions only.
 */
export const buildFoulClearObstacles = (
  boat: RaceBoat,
  fleet: readonly RaceBoat[],
  course: RaceCourse,
): ChordObstacle[] => {
  const obstacles: ChordObstacle[] = [];
  const markClearance = hullLeaveClearancePx(course);
  for (const buoy of course.buoys) {
    obstacles.push({
      x: buoy.x,
      y: buoy.y,
      radiusPx: markClearance,
    });
  }
  for (const other of fleet) {
    if (other.spec.id === boat.spec.id) {
      continue;
    }
    obstacles.push({
      x: other.state.x,
      y: other.state.y,
      radiusPx: BOAT_OBSTACLE_RADIUS_PX,
    });
  }
  return obstacles;
};

const headingTip = (
  boat: RaceBoat,
  headingDegrees: number,
  radiusPx: number,
): { x: number; y: number } => {
  const radians = (headingDegrees * Math.PI) / 180;
  return {
    x: boat.state.x + Math.sin(radians) * radiusPx,
    y: boat.state.y - Math.cos(radians) * radiusPx,
  };
};

/**
 * Score a continuous 360 in `spinSign` direction: count obstructed sample
 * chords around the turn. Lower is better.
 */
export const scoreFoulClearSpin = (
  boat: RaceBoat,
  spinSign: 1 | -1,
  obstacles: readonly ChordObstacle[],
): number => {
  const from = { x: boat.state.x, y: boat.state.y };
  let hits = 0;
  for (
    let deg = CLEAR_ARC_SAMPLE_DEG;
    deg <= SPIN_COMPLETE_DEG;
    deg += CLEAR_ARC_SAMPLE_DEG
  ) {
    const heading = normalizeHeadingDegrees(
      boat.state.headingDegrees + spinSign * deg,
    );
    const tip = headingTip(boat, heading, CLEAR_ARC_RADIUS_PX);
    if (chordIsObstructed(from, tip, obstacles)) {
      hits += 1;
    }
  }
  return hits;
};

export type FoulClearChoice = {
  plan: FoulClearPlanId;
  spinSign: 1 | -1;
  score: number;
};

/**
 * Bear-off-then-tack: turn away from the wind first.
 * Tack-then-bear-off: turn into the wind / through the tack first.
 * Pick the less obstructed option.
 */
export const chooseFoulClearPlan = (
  boat: RaceBoat,
  fleet: readonly RaceBoat[],
  course: RaceCourse,
): FoulClearChoice => {
  const obstacles = buildFoulClearObstacles(boat, fleet, course);
  const bearOffSign = preferredSide(boat);
  const tackFirstSign = (bearOffSign === 1 ? -1 : 1) as 1 | -1;

  const bearOff: FoulClearChoice = {
    plan: 'bearOffThenTack',
    spinSign: bearOffSign,
    score: scoreFoulClearSpin(boat, bearOffSign, obstacles),
  };
  const tackFirst: FoulClearChoice = {
    plan: 'tackThenBearOff',
    spinSign: tackFirstSign,
    score: scoreFoulClearSpin(boat, tackFirstSign, obstacles),
  };

  if (tackFirst.score < bearOff.score) {
    return tackFirst;
  }
  return bearOff;
};

const isInRoundingProtocol = (boat: RaceBoat): boolean =>
  boat.memory.roundingPhase === 'rounding';

/** Start (or ignore duplicate) foul: hold until clear; defer spin if rounding. */
export const beginFoulPenalty = (boat: RaceBoat, reason: string, nowMs: number): void => {
  if (isServingFoulPenalty(boat)) {
    return;
  }
  if (
    boat.lastFoulReason === reason &&
    boat.foulUntilMs > 0 &&
    boat.foulUntilMs + FOUL_COOLDOWN_MS > nowMs
  ) {
    return;
  }

  boat.foulCount += 1;
  boat.lastFoulReason = reason;
  boat.trafficRule = reason;
  boat.foulPhase = 'awaitingClear';
  boat.foulClearPlan = null;
  boat.foulSteerClearUntilMs = 0;
  boat.foulSpinAccumulatedDeg = 0;
  boat.foulSpinSign = preferredSide(boat);
  boat.foulUntilMs = nowMs + 120_000;
  boat.recoveryUntilMs = 0;
  boat.recoveryHeadingDegrees = null;
  boat.recoveryReason = isInRoundingProtocol(boat)
    ? 'Foul · finish round first'
    : 'Foul · plan 360°';
  boat.noGoSinceMs = null;

  noteHelmConflict({
    id: boat.spec.id,
    event: 'contact',
    helm: 'driver',
    foul: boat.foulPhase,
    clearPlan: null,
    round: boat.memory.roundingPhase ?? 'approach',
    wp: boat.memory.roundingWaypointIndex ?? 0,
    goal: boat.memory.goalBuoyIndex,
    reason: boat.recoveryReason,
    why: reason,
    pos: helmConflictPos(boat.state),
    active: null,
    chordClr: null,
  });
};

const commitFoulClearSpin = (
  boat: RaceBoat,
  fleet: readonly RaceBoat[],
  course: RaceCourse,
): FoulPenaltyDecision => {
  const choice = chooseFoulClearPlan(boat, fleet, course);
  boat.foulPhase = 'spin360';
  boat.foulClearPlan = choice.plan;
  boat.foulSpinSign = choice.spinSign;
  boat.foulSpinAccumulatedDeg = 0;
  boat.recoveryReason =
    choice.plan === 'bearOffThenTack'
      ? 'Foul · 360° bear-off then tack'
      : 'Foul · 360° tack then bear-off';
  boat.trafficRule = boat.lastFoulReason;
  return {
    mode: 'spin360',
    headingDegrees: null,
    spinSign: boat.foulSpinSign,
    reason: boat.recoveryReason,
  };
};

export const updateFoulPenalty = (
  boat: RaceBoat,
  fleet: readonly RaceBoat[],
  nowMs: number,
  course: RaceCourse | null = null,
): FoulPenaltyDecision => {
  if (boat.foulPhase === 'none') {
    return { mode: 'none', headingDegrees: null, spinSign: null, reason: null };
  }

  // Legacy phase name from older saves / mid-session — treat as awaiting.
  if ((boat.foulPhase as string) === 'steerClear') {
    boat.foulPhase = 'awaitingClear';
  }

  if (boat.foulPhase === 'awaitingClear') {
    boat.trafficRule = boat.lastFoulReason;
    if (isInRoundingProtocol(boat)) {
      boat.recoveryReason = 'Foul · finish round first';
      // Do not own the helm — complete mark-rounding protocol first.
      return {
        mode: 'none',
        headingDegrees: null,
        spinSign: null,
        reason: boat.recoveryReason,
      };
    }
    if (!course) {
      boat.recoveryReason = 'Foul · plan 360°';
      return {
        mode: 'none',
        headingDegrees: null,
        spinSign: null,
        reason: boat.recoveryReason,
      };
    }
    return commitFoulClearSpin(boat, fleet, course);
  }

  // spin360
  if (boat.foulSpinAccumulatedDeg >= SPIN_COMPLETE_DEG) {
    clearFoulPenalty(boat, nowMs);
    return { mode: 'none', headingDegrees: null, spinSign: null, reason: null };
  }

  const planLabel =
    boat.foulClearPlan === 'tackThenBearOff'
      ? 'tack then bear-off'
      : boat.foulClearPlan === 'bearOffThenTack'
        ? 'bear-off then tack'
        : '360°';
  boat.recoveryReason = `Foul · ${planLabel} (${Math.min(360, Math.round(boat.foulSpinAccumulatedDeg))}°)`;
  boat.trafficRule = boat.lastFoulReason;
  return {
    mode: 'spin360',
    headingDegrees: null,
    spinSign: boat.foulSpinSign,
    reason: boat.recoveryReason,
  };
};

/** Pixi tint while a boat is still serving its foul. */
export const FOUL_BROADCAST_TINT = 0xff8a2b;
