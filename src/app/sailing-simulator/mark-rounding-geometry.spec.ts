import { describe, expect, it } from 'vitest';
import { RaceCourse } from './course';
import { MELGES_HULL_BEAM_PX } from './hull-geometry';
import {
  assertRoundingInvariants,
  buildMarkRoundingSpec,
  buildRoundingPolygon,
  distance,
  exitTangentToward,
  chordIsObstructed,
  furthestUnobstructedRoundingWaypointIndex,
  markHullChordClearancePx,
  monotoneTurnDelta,
  pathClearsDisk,
  pointSideOfEntryGate,
  roundingSenseForMark,
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

const poseBeforeEntry = (
  course: RaceCourse,
  markIndex: 1 | 2 | 3,
  headingDegrees = 0,
) => {
  const spec = buildMarkRoundingSpec(course, markIndex);
  return {
    x: spec.entryGate.aim.x + spec.entryGate.normal.x * spec.clearancePx,
    y: spec.entryGate.aim.y + spec.entryGate.normal.y * spec.clearancePx,
    headingDegrees,
  };
};

describe('mark rounding geometry', () => {
  it('derives rounding sense from course rules', () => {
    expect(roundingSenseForMark(fixtureCourse('left'), 1)).toBe('ccw');
    expect(roundingSenseForMark(fixtureCourse('left'), 2)).toBe('ccw');
    expect(roundingSenseForMark(fixtureCourse('left'), 3)).toBe('ccw');
    expect(roundingSenseForMark(fixtureCourse('right'), 1)).toBe('ccw');
    expect(roundingSenseForMark(fixtureCourse('right'), 2)).toBe('cw');
    expect(roundingSenseForMark(fixtureCourse('right'), 3)).toBe('cw');
  });

  it('computes entry gates with outside/inside sides and a through point', () => {
    const spec = buildMarkRoundingSpec(fixtureCourse('right'), 1);
    // Aim is outside on leave-to; through is past the gate into the cone.
    expect(pointSideOfEntryGate(spec.entryGate.aim, spec.entryGate)).toBeGreaterThan(0);
    expect(pointSideOfEntryGate(spec.entryGate.through, spec.entryGate)).toBeLessThan(0);
    // Windward entry opens upwind of mark 1 (smaller y with wind-from 0).
    expect(spec.entryGate.aim.y).toBeLessThan(spec.mark.y);
  });

  it('chooses an exit tangent that clears the mark disk', () => {
    for (const side of ['left', 'right'] as const) {
      const course = fixtureCourse(side);
      for (const markIndex of [1, 2, 3] as const) {
        const spec = buildMarkRoundingSpec(course, markIndex);
        const entry = {
          x: spec.mark.x + spec.entryGate.ray.x * spec.pathRadiusPx,
          y: spec.mark.y + spec.entryGate.ray.y * spec.pathRadiusPx,
        };
        const tangent = exitTangentToward(spec, entry);
        expect(distance(tangent, spec.mark)).toBeCloseTo(spec.pathRadiusPx, 5);
        expect(pathClearsDisk(tangent, spec.next, spec.mark, spec.clearancePx)).toBe(true);
      }
    }
  });

  it('expands heading changes only in the rounding direction', () => {
    expect(monotoneTurnDelta(350, 10, 'cw')).toBe(20);
    expect(monotoneTurnDelta(350, 10, 'ccw')).toBe(-340);
    expect(monotoneTurnDelta(10, 350, 'ccw')).toBe(-20);
    expect(monotoneTurnDelta(10, 350, 'cw')).toBe(340);
  });

  it('builds a polygon that ends at the exit tangent and clears the disk', () => {
    for (const side of ['left', 'right'] as const) {
      const course = fixtureCourse(side);
      for (const markIndex of [1, 2, 3] as const) {
        const spec = buildMarkRoundingSpec(course, markIndex);
        const pose = poseBeforeEntry(course, markIndex, markIndex === 1 ? 0 : 120);
        const polygon = buildRoundingPolygon(spec, pose);
        expect(polygon.waypoints.length).toBeGreaterThanOrEqual(2);
        expect(polygon.waypoints.length).toBeLessThanOrEqual(10);
        expect(polygon.sweepDeg).toBeGreaterThanOrEqual(75);
        expect(
          distance(
            polygon.waypoints[polygon.waypoints.length - 1],
            polygon.exitPoint,
          ),
        ).toBeLessThan(3);
        const path = [polygon.start, ...polygon.waypoints];
        for (let i = 0; i < path.length - 1; i += 1) {
          expect(
            segmentClearanceToPoint(spec.mark, path[i], path[i + 1]),
          ).toBeGreaterThanOrEqual(spec.clearancePx - 0.75);
        }
      }
    }
  });

  it('puts the CCW mark-1 arc on the leave-to / port side (not the cut corner)', () => {
    const course = fixtureCourse('left');
    const spec = buildMarkRoundingSpec(course, 1);
    const pose = poseBeforeEntry(course, 1, 0);
    const polygon = buildRoundingPolygon(spec, pose);
    expect(polygon.sweepDeg).toBeGreaterThan(90);
    expect(polygon.waypoints.length).toBeGreaterThanOrEqual(2);

    const entryLeave = {
      x: polygon.entryPoint.x - spec.mark.x,
      y: polygon.entryPoint.y - spec.mark.y,
    };
    const exitLeave = {
      x: polygon.exitPoint.x - spec.mark.x,
      y: polygon.exitPoint.y - spec.mark.y,
    };
    const crossZ = entryLeave.x * exitLeave.y - entryLeave.y * exitLeave.x;
    // Visual CCW on y-down: entry→exit central angle should decrease atan2
    // (negative cross of entry×exit radius vectors).
    expect(crossZ).toBeLessThan(0);
  });

  it('passes invariant checks for frozen left/right course fixtures', () => {
    for (const side of ['left', 'right'] as const) {
      const course = fixtureCourse(side);
      for (const markIndex of [1, 2, 3] as const) {
        const spec = buildMarkRoundingSpec(course, markIndex);
        const pose = poseBeforeEntry(course, markIndex, 0);
        const polygon = buildRoundingPolygon(spec, pose);
        const result = assertRoundingInvariants(polygon, spec, pose.headingDegrees);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
      }
    }
  });

  it('picks the farthest unobstructed among the next look-ahead waypoints', () => {
    const course = fixtureCourse('right');
    const spec = buildMarkRoundingSpec(course, 1);
    const pose = {
      x: spec.entryGate.through.x,
      y: spec.entryGate.through.y,
      headingDegrees: 90,
    };
    const polygon = buildRoundingPolygon(spec, pose);
    const vertices = shortestPathForRounding(polygon);
    expect(vertices.length).toBeGreaterThanOrEqual(3);

    const markObstacle = {
      x: spec.mark.x,
      y: spec.mark.y,
      radiusPx: spec.chordClearancePx,
    };

    // Path through the mark center is obstructed.
    expect(
      chordIsObstructed(
        { x: spec.mark.x - 80, y: spec.mark.y },
        { x: spec.mark.x + 80, y: spec.mark.y },
        [markObstacle],
      ),
    ).toBe(true);

    // Chord clearance is hull-scale, not the fat leave-to planning disk.
    expect(spec.chordClearancePx).toBeCloseTo(
      markHullChordClearancePx(course),
      5,
    );
    expect(spec.chordClearancePx).toBeLessThan(spec.clearancePx);
    expect(spec.chordClearancePx).toBeCloseTo(
      course.markRadiusPx * 0.55 + MELGES_HULL_BEAM_PX * 0.5 + 1,
      5,
    );

    // Look ahead up to 5 vertices (clamped when the polygon is shorter).
    const midIdx = Math.min(1, vertices.length - 1);
    const mid = vertices[midIdx]!;
    const lookAhead = 5;
    const chosen = furthestUnobstructedRoundingWaypointIndex(
      mid,
      vertices,
      midIdx,
      [markObstacle],
      lookAhead,
    );
    const windowEnd = Math.min(midIdx + lookAhead - 1, vertices.length - 1);
    expect(chosen).toBeGreaterThanOrEqual(midIdx);
    expect(chosen).toBeLessThanOrEqual(windowEnd);
    expect(chordIsObstructed(mid, vertices[chosen]!, [markObstacle])).toBe(false);

    // Every clearer index in the window should be ≤ chosen (farthest clear).
    for (let i = midIdx; i <= windowEnd; i += 1) {
      if (!chordIsObstructed(mid, vertices[i]!, [markObstacle])) {
        expect(i).toBeLessThanOrEqual(chosen);
      }
    }

    // Fewer than look-ahead waypoints must not throw / overrun.
    const short = vertices.slice(0, 2);
    expect(
      furthestUnobstructedRoundingWaypointIndex(
        short[0]!,
        short,
        0,
        [markObstacle],
        lookAhead,
      ),
    ).toBeLessThan(short.length);
  });

  it('look-ahead uses hull-chord clearance, not the leave-to planning disk', () => {
    // Logged stall used clearancePx≈41 while the boat was ~32 from the mark
    // (inside the planning disk, outside hull-chord clearance ≈20).
    const course = fixtureCourse('right');
    const chordR = markHullChordClearancePx(course);
    const leaveR = buildMarkRoundingSpec(course, 1).clearancePx;
    const mark = { x: 500, y: 490 };
    const boat = { x: 505.2, y: 462.6 };
    expect(distance(mark, boat)).toBeGreaterThan(chordR);
    expect(distance(mark, boat)).toBeLessThan(leaveR);

    const apex = { x: 541.1, y: 487.2 };
    const far = { x: 570.2, y: 453.7 };
    const exit = { x: 497.9, y: 368.6 };
    const vertices = [apex, far, exit];
    const markObstacle = { ...mark, radiusPx: chordR };

    expect(chordIsObstructed(boat, exit, [markObstacle])).toBe(false);
    expect(
      furthestUnobstructedRoundingWaypointIndex(
        boat,
        vertices,
        0,
        [markObstacle],
        5,
        (point) => point === exit,
      ),
    ).toBe(2);
  });

  it('pathClearsDisk allows leaving when already inside the obstacle radius', () => {
    const mark = { x: 0, y: 0 };
    const from = { x: 10, y: 0 };
    expect(pathClearsDisk(from, { x: 40, y: 0 }, mark, 20)).toBe(true);
    expect(pathClearsDisk(from, { x: 0, y: 0 }, mark, 20)).toBe(false);
  });

  it('prefers a farther clear fetchable waypoint over a nearer apex', () => {
    const boat = { x: 0, y: 0 };
    const vertices = [
      { x: 40, y: 0 },
      { x: 80, y: 0 },
      { x: 120, y: 0 },
    ];
    const obstacles: { x: number; y: number; radiusPx: number }[] = [];
    // All clear; prefer only the exit (index 2) — skip apex chase.
    expect(
      furthestUnobstructedRoundingWaypointIndex(
        boat,
        vertices,
        0,
        obstacles,
        5,
        (_point, index) => index === 2,
      ),
    ).toBe(2);

    // Prefer only apex: stay there even though exit chord is clear.
    expect(
      furthestUnobstructedRoundingWaypointIndex(
        boat,
        vertices,
        0,
        obstacles,
        5,
        (_point, index) => index === 0,
      ),
    ).toBe(0);

    // No preferred clear → farthest clear.
    expect(
      furthestUnobstructedRoundingWaypointIndex(
        boat,
        vertices,
        0,
        obstacles,
        5,
        () => false,
      ),
    ).toBe(2);
  });
});
