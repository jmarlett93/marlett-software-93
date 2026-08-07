import {
  BoatDriverMemory,
  closeHauledHeadings,
  createBoatDriverMemory,
  randomTackStrategy,
} from './boat-driver';
import { RaceCourse } from './course';
import { SailboatState, createSailboatState } from './sailboat-state';

export type BoatRole = 'player' | 'npc';

export type BoatColorId = 'gold' | 'red' | 'blue';

/** Foul penalty machine: hold foul → (defer if rounding) → choose 360 → spin. */
export type FoulPhase = 'none' | 'awaitingClear' | 'spin360';

/** How the penalty 360 is sailed: bear away first, or tack first. */
export type FoulClearPlanId = 'bearOffThenTack' | 'tackThenBearOff';

/** Visual + identity for a boat in the fleet. */
export type RaceBoatSpec = {
  id: string;
  role: BoatRole;
  colorId: BoatColorId;
  shortName: string;
  /** Pixi fill color. */
  fill: number;
  /** Pixi stroke color. */
  stroke: number;
};

/** Full per-boat race state — each racer owns position, helm memory, and strategy. */
export type RaceBoat = {
  spec: RaceBoatSpec;
  state: SailboatState;
  memory: BoatDriverMemory;
  /** Timestamp of last foul clear (or active sentinel); used for cooldown. */
  foulUntilMs: number;
  foulCount: number;
  lastFoulReason: string | null;
  foulPhase: FoulPhase;
  foulSpinAccumulatedDeg: number;
  foulSpinSign: 1 | -1;
  /** Chosen 360 sequence once clear starts; null while awaiting. */
  foulClearPlan: FoulClearPlanId | null;
  foulSteerClearUntilMs: number;
  trafficRule: string | null;
  noGoSinceMs: number | null;
  recoveryUntilMs: number;
  recoveryHeadingDegrees: number | null;
  recoveryReason: string | null;
  /**
   * One-tick steer-clear depower: movement uses 50% speed, then resets false
   * after every position update.
   */
  depowered: boolean;
  /** Until this timestamp, blink the blue steer-clear stern signal. */
  steerClearSignalUntilMs: number;
};

export const PLAYER_BOAT_SPEC: RaceBoatSpec = {
  id: 'player-gold',
  role: 'player',
  colorId: 'gold',
  shortName: 'You',
  fill: 0xf0c36a,
  stroke: 0xffe3a4,
};

export const NPC_RED_SPEC: RaceBoatSpec = {
  id: 'npc-red',
  role: 'npc',
  colorId: 'red',
  shortName: 'Red',
  fill: 0xe45d5d,
  stroke: 0xffa0a0,
};

export const NPC_BLUE_SPEC: RaceBoatSpec = {
  id: 'npc-blue',
  role: 'npc',
  colorId: 'blue',
  shortName: 'Blue',
  fill: 0x4d8dff,
  stroke: 0xa8c8ff,
};

export const FLEET_SPECS: readonly RaceBoatSpec[] = [
  PLAYER_BOAT_SPEC,
  NPC_RED_SPEC,
  NPC_BLUE_SPEC,
];

/** Lateral lane offset from the start line center, in mark-radius units. */
const START_LANE_OFFSETS: Record<string, number> = {
  'player-gold': 0,
  'npc-red': -4.8,
  'npc-blue': 4.8,
};

/**
 * Spawn the fleet on a start line to windward of buoy 3 (toward buoy 1),
 * spaced out, all on starboard tack.
 */
export const createRaceFleet = (
  course: RaceCourse,
  options: {
    playerStrategy?: BoatDriverMemory['strategy'];
    preserved?: readonly RaceBoat[];
    /** When false, only the player boat is spawned (solo testing). */
    includeNpcs?: boolean;
  } = {},
): RaceBoat[] => {
  const leeward = course.buoys.find((b) => b.index === 3) ?? course.buoys[2];
  const windFrom = course.windFromDegrees ?? 0;
  const radians = (windFrom * Math.PI) / 180;
  const upwind = { x: Math.sin(radians), y: -Math.cos(radians) };
  const across = { x: -upwind.y, y: upwind.x };
  // Windward of the leeward mark — easier first beat than starting behind it.
  const startOffset = Math.max(course.markRadiusPx * 4.5, 72);
  const startCenter = {
    x: leeward.x + upwind.x * startOffset,
    y: leeward.y + upwind.y * startOffset,
  };
  const laneSpacing = course.markRadiusPx * 1.35;
  const starboardHeading = closeHauledHeadings(windFrom).starboard;
  const preservedById = new Map(
    (options.preserved ?? []).map((boat) => [boat.spec.id, boat] as const),
  );
  const specs =
    options.includeNpcs === false
      ? FLEET_SPECS.filter((spec) => spec.role === 'player')
      : FLEET_SPECS;

  return specs.map((spec) => {
    const prior = preservedById.get(spec.id);
    const strategy = randomTackStrategy();

    const lane = START_LANE_OFFSETS[spec.id] ?? 0;
    const x = Math.min(
      course.width - 16,
      Math.max(16, startCenter.x + across.x * lane * laneSpacing),
    );
    const y = Math.min(
      course.height - 16,
      Math.max(16, startCenter.y + across.y * lane * laneSpacing),
    );

    const memory: BoatDriverMemory = {
      ...createBoatDriverMemory(strategy),
      goalBuoyIndex: prior?.memory.goalBuoyIndex ?? 1,
      lapsCompleted: prior?.memory.lapsCompleted ?? 0,
      lastRoundedMarkIndex: prior?.memory.lastRoundedMarkIndex ?? null,
      currentTack: 'starboard',
      laylineTack: null,
      roundingClear: null,
      coneStage: 'outside',
      coneWasInside: false,
      coneWasOutsideIn: false,
      roundingPhase: 'approach',
      entryGateSide: null,
      roundingPath: null,
      roundingWaypointIndex: 0,
    };

    const state = createSailboatState({
      id: spec.id,
      x,
      y,
      headingDegrees: starboardHeading,
    });

    return {
      spec,
      state,
      memory,
      foulUntilMs: prior?.foulUntilMs ?? 0,
      foulCount: prior?.foulCount ?? 0,
      lastFoulReason: prior?.lastFoulReason ?? null,
      foulPhase:
        (prior?.foulPhase as string | undefined) === 'steerClear'
          ? 'awaitingClear'
          : (prior?.foulPhase ?? 'none'),
      foulSpinAccumulatedDeg: prior?.foulSpinAccumulatedDeg ?? 0,
      foulSpinSign: prior?.foulSpinSign ?? 1,
      foulClearPlan: prior?.foulClearPlan ?? null,
      foulSteerClearUntilMs: prior?.foulSteerClearUntilMs ?? 0,
      trafficRule: prior?.trafficRule ?? null,
      noGoSinceMs: prior?.noGoSinceMs ?? null,
      recoveryUntilMs: prior?.recoveryUntilMs ?? 0,
      recoveryHeadingDegrees: prior?.recoveryHeadingDegrees ?? null,
      recoveryReason: prior?.recoveryReason ?? null,
      depowered: false,
      steerClearSignalUntilMs: 0,
    };
  });
};

/**
 * Race progress used for standings: more laps, then higher mark index,
 * then closer to the current goal.
 */
export const raceProgressScore = (
  boat: Pick<RaceBoat, 'state' | 'memory'>,
  course: RaceCourse,
): number => {
  const goal = course.buoys.find((b) => b.index === boat.memory.goalBuoyIndex) ?? course.buoys[0];
  const dist = Math.hypot(goal.x - boat.state.x, goal.y - boat.state.y);
  return boat.memory.lapsCompleted * 10_000 + boat.memory.goalBuoyIndex * 1_000 - dist;
};

export type RaceStanding = {
  id: string;
  shortName: string;
  colorId: BoatColorId;
  place: number;
  goalBuoy: 1 | 2 | 3;
  laps: number;
  strategy: BoatDriverMemory['strategy'];
  speedKnots: number;
  foulCount: number;
  servingFoul: boolean;
};

export const computeRaceStandings = (
  fleet: readonly RaceBoat[],
  course: RaceCourse,
): RaceStanding[] => {
  const ranked = [...fleet].sort(
    (a, b) => raceProgressScore(b, course) - raceProgressScore(a, course),
  );

  return ranked.map((boat, index) => ({
    id: boat.spec.id,
    shortName: boat.spec.shortName,
    colorId: boat.spec.colorId,
    place: index + 1,
    goalBuoy: boat.memory.goalBuoyIndex,
    laps: boat.memory.lapsCompleted,
    strategy: boat.memory.strategy,
    speedKnots: boat.state.speedKnots,
    foulCount: boat.foulCount,
    servingFoul: boat.foulPhase !== 'none',
  }));
};
