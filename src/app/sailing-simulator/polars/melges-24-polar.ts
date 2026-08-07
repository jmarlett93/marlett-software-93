/**
 * Melges 24 polar table derived from Melges-24-polars.csv.
 * Key format: `${trueWindAngleDegrees}@${trueWindSpeedKnots}` → boat speed (kn).
 * TWA is absolute (0–180); port/starboard are symmetric.
 */
export type PolarRecordKey = `${number}@${number}`;

export const MELGES_24_TWA_POINTS = [52, 60, 75, 90, 110, 120, 135, 150] as const;
export const MELGES_24_TWS_POINTS = [6, 8, 10, 12, 14, 16, 20] as const;

export const MELGES_24_POLAR_RECORDS: ReadonlyMap<PolarRecordKey, number> = new Map([
  ['52@6', 5.16],
  ['52@8', 6.05],
  ['52@10', 6.51],
  ['52@12', 6.77],
  ['52@14', 6.92],
  ['52@16', 7.01],
  ['52@20', 7.11],
  ['60@6', 5.46],
  ['60@8', 6.26],
  ['60@10', 6.74],
  ['60@12', 7.13],
  ['60@14', 7.3],
  ['60@16', 7.44],
  ['60@20', 7.65],
  ['75@6', 5.67],
  ['75@8', 6.4],
  ['75@10', 6.96],
  ['75@12', 7.58],
  ['75@14', 7.95],
  ['75@16', 8.22],
  ['75@20', 8.61],
  ['90@6', 5.7],
  ['90@8', 6.58],
  ['90@10', 7.06],
  ['90@12', 7.64],
  ['90@14', 8.42],
  ['90@16', 9],
  ['90@20', 9.74],
  ['110@6', 5.84],
  ['110@8', 6.78],
  ['110@10', 7.72],
  ['110@12', 8.37],
  ['110@14', 8.96],
  ['110@16', 9.51],
  ['110@20', 10.75],
  ['120@6', 5.71],
  ['120@8', 6.67],
  ['120@10', 7.65],
  ['120@12', 8.73],
  ['120@14', 9.53],
  ['120@16', 10.17],
  ['120@20', 11.7],
  ['135@6', 5.12],
  ['135@8', 6.23],
  ['135@10', 7.06],
  ['135@12', 8.02],
  ['135@14', 9.2],
  ['135@16', 10.6],
  ['135@20', 13.47],
  ['150@6', 4.31],
  ['150@8', 5.43],
  ['150@10', 6.27],
  ['150@12', 7.04],
  ['150@14', 7.87],
  ['150@16', 8.89],
  ['150@20', 12.37],
]);

const polarKey = (twa: number, tws: number): PolarRecordKey => `${twa}@${tws}`;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const bracket = (value: number, points: readonly number[]): [number, number] => {
  if (value <= points[0]) {
    return [points[0], points[0]];
  }
  const last = points[points.length - 1];
  if (value >= last) {
    return [last, last];
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    if (value >= points[i] && value <= points[i + 1]) {
      return [points[i], points[i + 1]];
    }
  }
  return [last, last];
};

const sample = (twa: number, tws: number): number =>
  MELGES_24_POLAR_RECORDS.get(polarKey(twa, tws)) ?? 0;

/**
 * Bilinear interpolation across the Melges 24 polar grid.
 * TWA below the first recorded angle is treated as the no-go zone (0 kn).
 * TWS below the table floor (6 kn) scales the 6 kn column linearly → 0 at calm.
 */
export const boatSpeedFromPolar = (trueWindSpeedKnots: number, trueWindAngleDegrees: number): number => {
  const twa = clamp(Math.abs(trueWindAngleDegrees), 0, 180);
  const tws = Math.max(0, trueWindSpeedKnots);

  if (twa < MELGES_24_TWA_POINTS[0] || tws <= 0) {
    return 0;
  }

  const floorTws = MELGES_24_TWS_POINTS[0];
  const lookupTws = Math.max(tws, floorTws);
  const [twa0, twa1] = bracket(twa, MELGES_24_TWA_POINTS);
  const [tws0, tws1] = bracket(lookupTws, MELGES_24_TWS_POINTS);

  const q11 = sample(twa0, tws0);
  const q21 = sample(twa1, tws0);
  const q12 = sample(twa0, tws1);
  const q22 = sample(twa1, tws1);

  const twaT = twa0 === twa1 ? 0 : (twa - twa0) / (twa1 - twa0);
  const twsT = tws0 === tws1 ? 0 : (lookupTws - tws0) / (tws1 - tws0);

  const tableSpeed =
    q11 * (1 - twaT) * (1 - twsT) +
    q21 * twaT * (1 - twsT) +
    q12 * (1 - twaT) * twsT +
    q22 * twaT * twsT;

  // Table starts at 6 kn — without this, 1.9 kn wind still yielded ~5 kn boatspeed.
  const speed =
    tws < floorTws ? tableSpeed * (tws / floorTws) : tableSpeed;

  return Number(speed.toFixed(2));
};

/** Smallest angle between boat heading and wind-from direction, 0–180°. */
export const trueWindAngleDegrees = (
  boatHeadingDegrees: number,
  windFromDegrees: number,
): number => {
  const delta = ((((boatHeadingDegrees - windFromDegrees) % 360) + 540) % 360) - 180;
  return Math.abs(delta);
};

export const normalizeHeadingDegrees = (degrees: number): number =>
  ((degrees % 360) + 360) % 360;

/** Signed shortest turn from → to, in (-180, 180]. */
export const shortestHeadingDelta = (fromDegrees: number, toDegrees: number): number =>
  ((((toDegrees - fromDegrees) % 360) + 540) % 360) - 180;

/** Scan the polar for the TWA that maximizes boatspeed at the given TWS. */
export const optimalTrueWindAngle = (
  trueWindSpeedKnots: number,
): { twa: number; boatSpeedKnots: number } => {
  let bestTwa = MELGES_24_TWA_POINTS[0];
  let bestSpeed = -1;

  for (let twa = MELGES_24_TWA_POINTS[0]; twa <= MELGES_24_TWA_POINTS.at(-1)!; twa += 1) {
    const boatSpeedKnots = boatSpeedFromPolar(trueWindSpeedKnots, twa);
    if (boatSpeedKnots > bestSpeed) {
      bestSpeed = boatSpeedKnots;
      bestTwa = twa;
    }
  }

  return { twa: bestTwa, boatSpeedKnots: bestSpeed };
};

/**
 * Choose port or starboard heading that realizes the optimal TWA,
 * preferring the tack closer to the current heading.
 */
export const optimalHeadingForWind = (
  windFromDegrees: number,
  trueWindSpeedKnots: number,
  currentHeadingDegrees: number,
): { headingDegrees: number; targetTwa: number; expectedSpeedKnots: number } => {
  const { twa, boatSpeedKnots } = optimalTrueWindAngle(trueWindSpeedKnots);
  const starboard = normalizeHeadingDegrees(windFromDegrees + twa);
  const port = normalizeHeadingDegrees(windFromDegrees - twa);
  const toStarboard = Math.abs(shortestHeadingDelta(currentHeadingDegrees, starboard));
  const toPort = Math.abs(shortestHeadingDelta(currentHeadingDegrees, port));

  return {
    headingDegrees: toPort < toStarboard ? port : starboard,
    targetTwa: twa,
    expectedSpeedKnots: boatSpeedKnots,
  };
};
