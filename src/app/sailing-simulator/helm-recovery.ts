import { MELGES_24_TWA_POINTS, normalizeHeadingDegrees, shortestHeadingDelta } from './polars/melges-24-polar';
import { isFoulOwningHelm } from './foul-penalty';
import { RaceBoat } from './race-fleet';

export type RecoveryDecision = {
  headingDegrees: number | null;
  reason: string | null;
};

const CLOSE_HAULED_TWA = MELGES_24_TWA_POINTS[0];
const RECOVERY_TWA_DEG = 75;
/** Long enough to sail through head-to-wind on a real tack before recovery fights back. */
const NO_GO_GRACE_MS = 1_100;
const NO_GO_STALL_GRACE_MS = 700;
const NO_GO_RECOVERY_MS = 1_400;
const RECOVERY_CLEAR_SPEED_KN = 2.2;

const preferredSide = (boat: RaceBoat): 1 | -1 => {
  if (boat.memory.currentTack === 'starboard') {
    return 1;
  }
  if (boat.memory.currentTack === 'port') {
    return -1;
  }
  return shortestHeadingDelta(boat.state.windFromDegrees, boat.state.headingDegrees) >= 0
    ? 1
    : -1;
};

const recoveryHeading = (boat: RaceBoat): number =>
  normalizeHeadingDegrees(
    boat.state.windFromDegrees + preferredSide(boat) * RECOVERY_TWA_DEG,
  );

const isSafelyPowered = (boat: RaceBoat): boolean =>
  boat.state.trueWindAngleDegrees >= CLOSE_HAULED_TWA + 8 &&
  boat.state.speedKnots >= RECOVERY_CLEAR_SPEED_KN;

/** Inside the polar no-go (0 kn), including the close-hauled edge. */
const isInNoGo = (boat: RaceBoat): boolean =>
  boat.state.trueWindSpeedKnots > 0 &&
  boat.state.trueWindAngleDegrees < CLOSE_HAULED_TWA;

/** Parked on the wind with no drive — common after a fetch steering command. */
const isStalledNearNoGo = (boat: RaceBoat): boolean =>
  boat.state.trueWindSpeedKnots > 0 &&
  boat.state.speedKnots < 0.6 &&
  boat.state.trueWindAngleDegrees < CLOSE_HAULED_TWA + 8;

export type HelmRecoveryOptions = {
  /** Manual helm owns the tiller — never auto-bear-away (would block tacking). */
  allowRecovery?: boolean;
};

/** Keep boats from parking head-to-wind after tacks or bad traffic turns. */
export const updateHelmRecovery = (
  boat: RaceBoat,
  nowMs: number,
  options: HelmRecoveryOptions = {},
): RecoveryDecision => {
  // Only the active 360 owns the helm; deferred fouls (finish round) do not.
  if (isFoulOwningHelm(boat)) {
    return { headingDegrees: null, reason: null };
  }

  // Manual player (or explicit opt-out): clear any pending recovery and stand down.
  if (options.allowRecovery === false) {
    boat.noGoSinceMs = null;
    boat.recoveryUntilMs = 0;
    boat.recoveryHeadingDegrees = null;
    boat.recoveryReason = null;
    return { headingDegrees: null, reason: null };
  }

  const trapped = isInNoGo(boat) || isStalledNearNoGo(boat);
  if (trapped) {
    boat.noGoSinceMs ??= nowMs;
    const grace =
      boat.state.speedKnots < 0.6 ? NO_GO_STALL_GRACE_MS : NO_GO_GRACE_MS;
    if (nowMs - boat.noGoSinceMs >= grace && boat.recoveryUntilMs <= nowMs) {
      boat.recoveryHeadingDegrees = recoveryHeading(boat);
      boat.recoveryUntilMs = nowMs + NO_GO_RECOVERY_MS;
      boat.recoveryReason = 'No-go recovery · bear away';
    }
  } else {
    boat.noGoSinceMs = null;
  }

  if (boat.recoveryUntilMs > nowMs && boat.recoveryHeadingDegrees !== null) {
    if (isSafelyPowered(boat)) {
      boat.recoveryUntilMs = 0;
      boat.recoveryHeadingDegrees = null;
      boat.recoveryReason = null;
      boat.noGoSinceMs = null;
      return { headingDegrees: null, reason: null };
    }

    return {
      headingDegrees: boat.recoveryHeadingDegrees,
      reason: boat.recoveryReason,
    };
  }

  return { headingDegrees: null, reason: null };
};
