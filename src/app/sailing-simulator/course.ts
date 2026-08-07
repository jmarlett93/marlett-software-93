/** A race mark on the board. Indices follow the race order. */
export type Buoy = {
  /** Race order: 1 = windward, 2 = side, 3 = leeward. */
  index: 1 | 2 | 3;
  role: 'top' | 'side' | 'bottom';
  x: number;
  y: number;
};

export type CourseSide = 'left' | 'right';

/**
 * Geometric + scaling context for one race course.
 * `pixelsPerKnot` converts boatspeed (kn) into board motion (px/s).
 */
export type RaceCourse = {
  buoys: readonly [Buoy, Buoy, Buoy];
  side: CourseSide;
  /** Board pixels travelled per second when boatspeed is 1 knot. */
  pixelsPerKnot: number;
  /** Distance at which a mark is considered rounded. */
  markRadiusPx: number;
  width: number;
  height: number;
  /** Wind-from used to orient the course (mark 1 upwind). */
  windFromDegrees: number;
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
 * Build a wind-aligned triangular course:
 *   1 — always upwind
 *   2 — offset to the left or right of the wind axis
 *   3 — straight downwind of buoy 1
 *
 * Race order is always 1 → 2 → 3 → 1.
 */
export const setupCourse = (
  width: number,
  height: number,
  windFromDegrees: number = 0,
): RaceCourse => {
  const pad = Math.min(width, height) * 0.18;
  // Room further downwind of mark 3 for the start-line fleet.
  const startClearance = Math.max(56, Math.min(width, height) * 0.14);
  const usableW = Math.max(width - pad * 2, 120);
  const usableH = Math.max(height - pad * 2 - startClearance, 120);

  const side: CourseSide = Math.random() < 0.5 ? 'left' : 'right';
  const upwind = headingUnit(windFromDegrees);
  const downwind = { x: -upwind.x, y: -upwind.y };
  const across = side === 'right' ? rightOf(upwind) : leftOf(upwind);

  // Equilateral in the wind frame: 1↔3 along wind, 2 abeam at mid-leg.
  const leg =
    Math.min(usableW / (Math.sqrt(3) / 2), usableH) * 0.9;
  const half = leg / 2;
  const beam = (Math.sqrt(3) / 2) * leg;

  const local = {
    top: { x: upwind.x * half, y: upwind.y * half },
    bottom: { x: downwind.x * half, y: downwind.y * half },
    side: {
      x: across.x * beam,
      y: across.y * beam,
    },
  };

  const minX = Math.min(local.top.x, local.bottom.x, local.side.x);
  const maxX = Math.max(local.top.x, local.bottom.x, local.side.x);
  const minY = Math.min(local.top.y, local.bottom.y, local.side.y);
  const maxY = Math.max(local.top.y, local.bottom.y, local.side.y);

  // Center in the usable band; bias slightly downwind so start clearance fits
  // past mark 3.
  const ox = width / 2 - (minX + maxX) / 2;
  const oy = pad + usableH / 2 - (minY + maxY) / 2;
  const biasX = downwind.x * (startClearance * 0.2);
  const biasY = downwind.y * (startClearance * 0.2);

  const top: Buoy = {
    index: 1,
    role: 'top',
    x: local.top.x + ox + biasX,
    y: local.top.y + oy + biasY,
  };
  const bottom: Buoy = {
    index: 3,
    role: 'bottom',
    x: local.bottom.x + ox + biasX,
    y: local.bottom.y + oy + biasY,
  };
  const sideBuoy: Buoy = {
    index: 2,
    role: 'side',
    x: local.side.x + ox + biasX,
    y: local.side.y + oy + biasY,
  };

  const pixelsPerKnot = Math.max(7, Math.min(14, leg / 55));

  return {
    buoys: [top, sideBuoy, bottom],
    side,
    pixelsPerKnot,
    markRadiusPx: Math.max(16, leg * 0.042),
    width,
    height,
    windFromDegrees,
  };
};

/** Next mark in the 1 → 2 → 3 → 1 loop. */
export const nextBuoyIndex = (current: 1 | 2 | 3): 1 | 2 | 3 => {
  if (current === 1) {
    return 2;
  }
  if (current === 2) {
    return 3;
  }
  return 1;
};

export const buoyByIndex = (course: RaceCourse, index: 1 | 2 | 3): Buoy =>
  course.buoys.find((b) => b.index === index) ?? course.buoys[0];
