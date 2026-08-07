import { Graphics } from 'pixi.js';
import { SailboatState } from './sailboat-state';

export type Point = {
  x: number;
  y: number;
};

export type Aabb = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

/** Local Melges 24-ish planform: plumb bow, broad aft quarters, reverse transom. */
export const MELGES_HULL_LOCAL: readonly Point[] = [
  { x: 0, y: -20 },
  { x: 3.6, y: -18 },
  { x: 7.4, y: -11 },
  { x: 9.5, y: -2 },
  { x: 10.8, y: 7 },
  { x: 8.8, y: 16 },
  { x: 3.8, y: 18.5 },
  { x: -3.8, y: 18.5 },
  { x: -8.8, y: 16 },
  { x: -10.8, y: 7 },
  { x: -9.5, y: -2 },
  { x: -7.4, y: -11 },
  { x: -3.6, y: -18 },
];

export const MELGES_HULL_LENGTH_PX = 38.5;
export const MELGES_HULL_BEAM_PX = 21.6;

const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;

const rotatePoint = (point: Point, headingDegrees: number): Point => {
  const radians = (headingDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
};

export const hullWorldPolygon = (
  boat: Pick<SailboatState, 'x' | 'y' | 'headingDegrees'>,
): Point[] =>
  MELGES_HULL_LOCAL.map((point) => {
    const rotated = rotatePoint(point, boat.headingDegrees);
    return {
      x: boat.x + rotated.x,
      y: boat.y + rotated.y,
    };
  });

export const drawMelgesHull = (
  graphics: Graphics,
  fill: number,
  stroke: number,
): Graphics => {
  const flatPoints = MELGES_HULL_LOCAL.flatMap((point) => [point.x, point.y]);

  graphics
    .poly(flatPoints)
    .fill({ color: fill, alpha: 0.96 })
    .stroke({ width: 1.4, color: stroke, alpha: 0.9 });

  // A small cockpit / centerline hint makes the hull read as a sportboat at scale.
  graphics
    .moveTo(0, -15)
    .lineTo(0, 13)
    .stroke({ width: 0.8, color: 0x071018, alpha: 0.45 })
    .roundRect(-4.7, -2, 9.4, 13, 2)
    .stroke({ width: 0.8, color: 0x071018, alpha: 0.42 });

  return graphics;
};

export const polygonAabb = (polygon: readonly Point[]): Aabb => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
};

export const aabbsOverlap = (a: Aabb, b: Aabb): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

const projectPolygon = (
  polygon: readonly Point[],
  axis: Point,
): { min: number; max: number } => {
  let min = dot(polygon[0], axis);
  let max = min;

  for (let i = 1; i < polygon.length; i += 1) {
    const projected = dot(polygon[i], axis);
    min = Math.min(min, projected);
    max = Math.max(max, projected);
  }

  return { min, max };
};

const edgeNormal = (a: Point, b: Point): Point => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: -dy / length,
    y: dx / length,
  };
};

const hasSeparatingAxis = (
  a: readonly Point[],
  b: readonly Point[],
): boolean => {
  for (let i = 0; i < a.length; i += 1) {
    const next = (i + 1) % a.length;
    const axis = edgeNormal(a[i], a[next]);
    const projectedA = projectPolygon(a, axis);
    const projectedB = projectPolygon(b, axis);

    if (projectedA.max < projectedB.min || projectedB.max < projectedA.min) {
      return true;
    }
  }

  return false;
};

export const polygonsOverlap = (
  a: readonly Point[],
  b: readonly Point[],
): boolean => {
  if (!aabbsOverlap(polygonAabb(a), polygonAabb(b))) {
    return false;
  }

  return !hasSeparatingAxis(a, b) && !hasSeparatingAxis(b, a);
};

const closestPointOnSegment = (point: Point, a: Point, b: Point): Point => {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const lengthSq = ab.x * ab.x + ab.y * ab.y;
  if (lengthSq === 0) {
    return a;
  }

  const t = Math.max(
    0,
    Math.min(1, dot({ x: point.x - a.x, y: point.y - a.y }, ab) / lengthSq),
  );
  return {
    x: a.x + ab.x * t,
    y: a.y + ab.y * t,
  };
};

export const pointInPolygon = (point: Point, polygon: readonly Point[]): boolean => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const crosses =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;

    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
};

export const circleHitsPolygon = (
  center: Point,
  radius: number,
  polygon: readonly Point[],
): boolean => {
  if (pointInPolygon(center, polygon)) {
    return true;
  }

  const radiusSq = radius * radius;
  for (let i = 0; i < polygon.length; i += 1) {
    const next = (i + 1) % polygon.length;
    const closest = closestPointOnSegment(center, polygon[i], polygon[next]);
    const dx = closest.x - center.x;
    const dy = closest.y - center.y;
    if (dx * dx + dy * dy <= radiusSq) {
      return true;
    }
  }

  return false;
};
