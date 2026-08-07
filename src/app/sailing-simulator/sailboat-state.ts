import {
  boatSpeedFromPolar,
  normalizeHeadingDegrees,
  trueWindAngleDegrees,
} from './polars/melges-24-polar';

/** Sustainable boat state — safe to clone/instance for AI & movement later. */
export type SailboatState = {
  id: string;
  /** Board position in pixels. */
  x: number;
  y: number;
  /** Bow direction: 0° = up/north, clockwise. */
  headingDegrees: number;
  /** Resulting boatspeed from polar (kn). */
  speedKnots: number;
  /** Absolute TWA used for the polar lookup (0–180). */
  trueWindAngleDegrees: number;
  /** TWS from the driving puff (kn). */
  trueWindSpeedKnots: number;
  /** Wind-from direction of the driving puff (meteorological). */
  windFromDegrees: number;
  nearestPuffId: string | null;
};

export type WindInfluence = {
  id: string;
  x: number;
  y: number;
  knots: number;
  /** Meteorological wind-from degrees. */
  degrees: number;
};

let sailboatSeq = 0;

export const createSailboatState = (
  partial: Partial<SailboatState> = {},
): SailboatState => ({
  id: partial.id ?? `sailboat-${++sailboatSeq}`,
  x: partial.x ?? 0,
  y: partial.y ?? 0,
  headingDegrees: partial.headingDegrees ?? 0,
  speedKnots: partial.speedKnots ?? 0,
  trueWindAngleDegrees: partial.trueWindAngleDegrees ?? 0,
  trueWindSpeedKnots: partial.trueWindSpeedKnots ?? 0,
  windFromDegrees: partial.windFromDegrees ?? 0,
  nearestPuffId: partial.nearestPuffId ?? null,
});

export const cloneSailboatState = (boat: SailboatState): SailboatState => ({
  ...boat,
  id: `sailboat-${++sailboatSeq}`,
});

const distanceSq = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

export const findNearestWindInfluence = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  puffs: readonly WindInfluence[],
): WindInfluence | null => {
  if (puffs.length === 0) {
    return null;
  }

  let nearest = puffs[0];
  let best = distanceSq(boat.x, boat.y, nearest.x, nearest.y);
  for (let i = 1; i < puffs.length; i += 1) {
    const candidate = puffs[i];
    const d = distanceSq(boat.x, boat.y, candidate.x, candidate.y);
    if (d < best) {
      best = d;
      nearest = candidate;
    }
  }
  return nearest;
};

/**
 * Drive boats from the live station TWS when available. Nearest puff still
 * supplies direction (and a fallback speed if the station sample is missing).
 */
export const resolveDrivingWind = (
  boat: Pick<SailboatState, 'x' | 'y'>,
  puffs: readonly WindInfluence[],
  station: Pick<WindInfluence, 'knots' | 'degrees'> | null,
): WindInfluence | null => {
  const nearest = findNearestWindInfluence(boat, puffs);
  if (!station && !nearest) {
    return null;
  }
  if (!station) {
    return nearest;
  }
  if (!nearest) {
    return {
      id: 'station',
      x: boat.x,
      y: boat.y,
      knots: station.knots,
      degrees: station.degrees,
    };
  }
  return {
    ...nearest,
    knots: station.knots,
    degrees: station.degrees,
  };
};

/** Pure update: recompute polar speed from a wind influence. */
export const applyWindToSailboat = (
  boat: SailboatState,
  wind: WindInfluence | null,
): SailboatState => {
  if (!wind) {
    return {
      ...boat,
      speedKnots: 0,
      trueWindAngleDegrees: 0,
      trueWindSpeedKnots: 0,
      windFromDegrees: 0,
      nearestPuffId: null,
    };
  }

  const twa = trueWindAngleDegrees(boat.headingDegrees, wind.degrees);
  const speedKnots = boatSpeedFromPolar(wind.knots, twa);

  return {
    ...boat,
    speedKnots,
    trueWindAngleDegrees: Number(twa.toFixed(1)),
    trueWindSpeedKnots: wind.knots,
    windFromDegrees: wind.degrees,
    nearestPuffId: wind.id,
  };
};

export const placeRandomSailboat = (
  bounds: { width: number; height: number },
  margin = 48,
): SailboatState => {
  const width = Math.max(bounds.width - margin * 2, 1);
  const height = Math.max(bounds.height - margin * 2, 1);

  return createSailboatState({
    x: margin + Math.random() * width,
    y: margin + Math.random() * height,
    headingDegrees: Math.floor(Math.random() * 360),
  });
};

export const rotateSailboat = (
  boat: SailboatState,
  deltaDegrees: number,
): SailboatState => ({
  ...boat,
  headingDegrees: Number(normalizeHeadingDegrees(boat.headingDegrees + deltaDegrees).toFixed(1)),
});
