import { describe, expect, it } from 'vitest';
import { RaceCourse } from './course';
import {
  beginFoulPenalty,
  chooseFoulClearPlan,
  updateFoulPenalty,
} from './foul-penalty';
import { createRaceFleet } from './race-fleet';
import { createBoatDriverMemory } from './boat-driver';
import { buildRoundingPolygon, buildMarkRoundingSpec } from './mark-rounding-geometry';

const fixtureCourse = (): RaceCourse => ({
  side: 'right',
  width: 900,
  height: 700,
  windFromDegrees: 0,
  pixelsPerKnot: 10,
  markRadiusPx: 24,
  buoys: [
    { index: 1, role: 'top', x: 450, y: 150 },
    { index: 2, role: 'side', x: 700, y: 350 },
    { index: 3, role: 'bottom', x: 450, y: 550 },
  ],
});

describe('foul penalty clear', () => {
  it('defers the 360 while the boat is in rounding protocol', () => {
    const course = fixtureCourse();
    const fleet = createRaceFleet(course, { includeNpcs: true });
    const boat = fleet[0]!;
    const spec = buildMarkRoundingSpec(course, 1);
    const polygon = buildRoundingPolygon(spec, {
      x: spec.entryGate.through.x,
      y: spec.entryGate.through.y,
      headingDegrees: 90,
    });
    boat.memory = {
      ...createBoatDriverMemory(),
      roundingPhase: 'rounding',
      roundingPath: polygon,
      roundingWaypointIndex: 0,
      coneStage: 'entered',
    };

    beginFoulPenalty(boat, 'Test foul', 10_000);
    expect(boat.foulPhase).toBe('awaitingClear');

    const decision = updateFoulPenalty(boat, fleet, 10_100, course);
    expect(boat.foulPhase).toBe('awaitingClear');
    expect(decision.mode).toBe('none');
    expect(decision.reason).toMatch(/finish round/i);
  });

  it('commits to a 360 plan once rounding is done', () => {
    const course = fixtureCourse();
    const fleet = createRaceFleet(course, { includeNpcs: true });
    const boat = fleet[0]!;
    boat.memory = {
      ...createBoatDriverMemory(),
      roundingPhase: 'approach',
      currentTack: 'starboard',
    };

    beginFoulPenalty(boat, 'Test foul', 10_000);
    const decision = updateFoulPenalty(boat, fleet, 10_100, course);
    expect(decision.mode).toBe('spin360');
    expect(boat.foulPhase).toBe('spin360');
    expect(boat.foulClearPlan).toMatch(/bearOffThenTack|tackThenBearOff/);
    expect(decision.spinSign === 1 || decision.spinSign === -1).toBe(true);
  });

  it('chooses between bear-off-first and tack-first clear plans', () => {
    const course = fixtureCourse();
    const fleet = createRaceFleet(course, { includeNpcs: true });
    const boat = fleet[0]!;
    boat.memory = {
      ...createBoatDriverMemory(),
      currentTack: 'starboard',
    };
    const choice = chooseFoulClearPlan(boat, fleet, course);
    expect(choice.plan).toMatch(/bearOffThenTack|tackThenBearOff/);
    expect(choice.score).toBeGreaterThanOrEqual(0);
  });
});
