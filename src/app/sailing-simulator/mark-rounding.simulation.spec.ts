import { describe, expect, it } from 'vitest';
import { RaceCourse, nextBuoyIndex } from './course';
import {
  Point,
  assertRoundingInvariants,
  bearingDegreesTo,
  buildMarkRoundingSpec,
  buildRoundingPolygon,
  crossedEntryGate,
  distance,
  headingUnit,
  pointSideOfEntryGate,
  segmentClearanceToPoint,
  shortestPathForRounding,
} from './mark-rounding-geometry';

const fixtureCourse = (side: 'left' | 'right'): RaceCourse => ({
  side,
  width: 900,
  height: 700,
  windFromDegrees: 0,
  pixelsPerKnot: 10,
  markRadiusPx: 24,
  buoys: [
    { index: 1, role: 'top', x: 450, y: 150 },
    {
      index: 2,
      role: 'side',
      x: side === 'right' ? 700 : 200,
      y: 350,
    },
    { index: 3, role: 'bottom', x: 450, y: 550 },
  ],
});

type SimBoat = Point & {
  headingDegrees: number;
};

const moveToward = (boat: SimBoat, target: Point, stepPx: number): SimBoat => {
  const d = distance(boat, target);
  if (d <= stepPx) {
    return {
      x: target.x,
      y: target.y,
      headingDegrees: bearingDegreesTo(boat, target),
    };
  }
  const dir = headingUnit(bearingDegreesTo(boat, target));
  return {
    x: boat.x + dir.x * stepPx,
    y: boat.y + dir.y * stepPx,
    headingDegrees: bearingDegreesTo(boat, target),
  };
};

const approachFromOutside = (
  course: RaceCourse,
  markIndex: 1 | 2 | 3,
): SimBoat => {
  const spec = buildMarkRoundingSpec(course, markIndex);
  return {
    x: spec.entryGate.aim.x + spec.entryGate.normal.x * spec.clearancePx * 1.4,
    y: spec.entryGate.aim.y + spec.entryGate.normal.y * spec.clearancePx * 1.4,
    headingDegrees: bearingDegreesTo(spec.entryGate.aim, spec.entryGate.through),
  };
};

const simulateEntryAndRound = (
  course: RaceCourse,
  markIndex: 1 | 2 | 3,
) => {
  const spec = buildMarkRoundingSpec(course, markIndex);
  let boat = approachFromOutside(course, markIndex);
  let previousSide: number | null = pointSideOfEntryGate(boat, spec.entryGate);
  let armed = false;

  for (let i = 0; i < 80 && !armed; i += 1) {
    boat = moveToward(boat, spec.entryGate.through, 12);
    const side = pointSideOfEntryGate(boat, spec.entryGate);
    armed = crossedEntryGate(previousSide, side);
    previousSide = side;
  }

  expect(armed).toBe(true);
  const polygon = buildRoundingPolygon(spec, boat);
  const invariant = assertRoundingInvariants(polygon, spec, boat.headingDegrees);
  expect(invariant.errors).toEqual([]);

  let position = boat;
  for (const target of shortestPathForRounding(polygon)) {
    const from = position;
    position = moveToward(position, target, distance(position, target));
    expect(
      segmentClearanceToPoint(spec.mark, from, position),
    ).toBeGreaterThanOrEqual(spec.clearancePx - 0.75);
  }

  expect(distance(position, polygon.exitPoint)).toBeLessThan(3);
  return { spec, polygon };
};

describe('mark rounding kinematic simulations', () => {
  it('does not arm from the wrong side of the entry gate', () => {
    const spec = buildMarkRoundingSpec(fixtureCourse('right'), 1);
    const wrongSide = {
      x: spec.mark.x - spec.entryGate.normal.x * spec.clearancePx * 1.4,
      y: spec.mark.y - spec.entryGate.normal.y * spec.clearancePx * 1.4,
    };
    const deeperWrongSide = {
      x: wrongSide.x - spec.entryGate.normal.x * spec.clearancePx,
      y: wrongSide.y - spec.entryGate.normal.y * spec.clearancePx,
    };
    expect(
      crossedEntryGate(
        pointSideOfEntryGate(wrongSide, spec.entryGate),
        pointSideOfEntryGate(deeperWrongSide, spec.entryGate),
      ),
    ).toBe(false);
  });

  it('rounds mark 1 without entering the hull clearance disk', () => {
    for (const side of ['left', 'right'] as const) {
      const { polygon } = simulateEntryAndRound(fixtureCourse(side), 1);
      expect(polygon.markIndex).toBe(1);
      expect(polygon.waypoints.length).toBeLessThanOrEqual(10);
      expect(polygon.sweepDeg).toBeGreaterThanOrEqual(75);
    }
  });

  it('rounds marks 2 and 3 on left and right courses with the same geometry', () => {
    for (const side of ['left', 'right'] as const) {
      for (const markIndex of [2, 3] as const) {
        const { polygon } = simulateEntryAndRound(fixtureCourse(side), markIndex);
        expect(polygon.markIndex).toBe(markIndex);
      }
    }
  });

  it('keeps a locked polygon stable if asked to rebuild mid-round', () => {
    const course = fixtureCourse('right');
    const spec = buildMarkRoundingSpec(course, 1);
    const boat = approachFromOutside(course, 1);
    const polygon = buildRoundingPolygon(spec, boat);
    const halfway = shortestPathForRounding(polygon)[0] ?? polygon.exitPoint;
    const rebuilt = buildRoundingPolygon(spec, {
      x: (boat.x + halfway.x) / 2,
      y: (boat.y + halfway.y) / 2,
      headingDegrees: bearingDegreesTo(boat, halfway),
    });

    expect(rebuilt.sense).toBe(polygon.sense);
    expect(rebuilt.clearancePx).toBe(polygon.clearancePx);
    for (const point of rebuilt.waypoints) {
      expect(distance(point, spec.mark)).toBeGreaterThanOrEqual(spec.clearancePx);
    }
  });

  it('completes a solo full-lap goal order', () => {
    let goal: 1 | 2 | 3 = 1;
    const seen: (1 | 2 | 3)[] = [];
    const course = fixtureCourse('left');
    for (let i = 0; i < 3; i += 1) {
      simulateEntryAndRound(course, goal);
      seen.push(goal);
      goal = nextBuoyIndex(goal);
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(goal).toBe(1);
  });
});
