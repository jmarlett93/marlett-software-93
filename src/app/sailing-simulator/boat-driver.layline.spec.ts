import { describe, expect, it } from 'vitest';
import { RaceCourse } from './course';
import {
  advanceGoalIfClearReached,
  buildTackRouteToPoint,
  centerReachedTackPoint,
  closeHauledHeadings,
  createBoatDriverMemory,
  decideDriverHeading,
  inEntryCommitZone,
  overstandPastLaylinePx,
  pathClearsMark,
  planOneTackToPoint,
  resolveDriverPlan,
  retargetTackRouteDest,
  targetPointInNoGo,
} from './boat-driver';
import {
  buildMarkRoundingSpec,
  buildRoundingPolygon,
  headingUnit,
  pointSideOfEntryGate,
  shortestPathForRounding,
} from './mark-rounding-geometry';
import { MELGES_HULL_LENGTH_PX } from './hull-geometry';
import { createSailboatState } from './sailboat-state';

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

describe('committed tack route — keep T when Dest nudges', () => {
  it('retargets Dest without moving T1', () => {
    const route = {
      targetX: 291.4,
      targetY: 484.2,
      legIndex: 0,
      legs: [
        {
          kind: 'tack' as const,
          x: 394.3,
          y: 229.6,
          hold: 'port' as const,
          label: 'T1',
        },
        {
          kind: 'aim' as const,
          x: 291.4,
          y: 484.2,
          hold: 'starboard' as const,
          label: 'Dest',
        },
      ],
    };
    const next = retargetTackRouteDest(route, { x: 353.8, y: 497.5 });
    expect(next.legs[0]!.x).toBeCloseTo(394.3, 1);
    expect(next.legs[0]!.y).toBeCloseTo(229.6, 1);
    expect(next.legs[1]!.x).toBeCloseTo(353.8, 1);
    expect(next.targetX).toBeCloseTo(353.8, 1);
  });

  it('near original T1 does not rebuild a farther T when Dest flips to through', () => {
    // Logged: lock to aim T1[394,229], then at [377,227] Dest→through rebuilt
    // T1[458,238] past the entry side instead of tacking.
    const windFrom = 150;
    const course: RaceCourse = {
      ...fixtureCourse('left'),
      buoys: [
        { index: 1, role: 'top', x: 348.9, y: 431.2 },
        { index: 2, role: 'side', x: 510.5, y: 151.4 },
        { index: 3, role: 'bottom', x: 187.4, y: 151.4 },
      ],
      windFromDegrees: windFrom,
    };
    const formal = buildMarkRoundingSpec(course, 1);
    const t1 = { x: 394.3, y: 229.6 };
    const boat = createSailboatState({
      x: 377.5,
      y: 227.2,
      headingDegrees: 98,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    const memory = {
      ...createBoatDriverMemory(),
      goalBuoyIndex: 1 as const,
      currentTack: 'port' as const,
      lastTackAtMs: 0,
      entryApproachStage: 'aim' as const,
      tackRoute: {
        targetX: formal.entryGate.aim.x,
        targetY: formal.entryGate.aim.y,
        legIndex: 0,
        legs: [
          {
            kind: 'tack' as const,
            x: t1.x,
            y: t1.y,
            hold: 'port' as const,
            label: 'T1',
          },
          {
            kind: 'aim' as const,
            x: formal.entryGate.aim.x,
            y: formal.entryGate.aim.y,
            hold: 'starboard' as const,
            label: 'Dest',
          },
        ],
      },
    };
    const plan = resolveDriverPlan(boat, memory, course);
    expect(plan.activeTarget.x).toBeCloseTo(t1.x, 0);
    expect(plan.activeTarget.y).toBeCloseTo(t1.y, 0);
    // Strategy Dest stays on aim — not through — this far from Entry.
    expect(plan.clearTarget.x).toBeCloseTo(formal.entryGate.aim.x, 0);
    expect(plan.clearTarget.y).toBeCloseTo(formal.entryGate.aim.y, 0);

    const decision = decideDriverHeading(boat, course, memory, 20_000);
    expect(decision.memory.tackRoute).not.toBeNull();
    const routeT = decision.memory.tackRoute!.legs[0]!;
    expect(routeT.x).toBeCloseTo(t1.x, 0);
    expect(routeT.y).toBeCloseTo(t1.y, 0);
    expect(decision.reason).toMatch(/Route → T1|Route tack/);
  });
});

describe('tack point capture — boat center, not bow', () => {
  it('does not fire when only the bow has reached T', () => {
    const windFrom = 0;
    const headings = closeHauledHeadings(windFrom);
    const hold = 'port' as const;
    const dir = headingUnit(headings[hold]);
    const tackPt = { x: 200, y: 200 };
    // Center is still ~bow-length short of T (nose would be on the marker).
    const bowOffset = MELGES_HULL_LENGTH_PX * 0.52;
    const boat = {
      x: tackPt.x - dir.x * bowOffset,
      y: tackPt.y - dir.y * bowOffset,
    };
    expect(centerReachedTackPoint(boat, tackPt, headings[hold])).toBe(false);
  });

  it('fires when the center is on T', () => {
    const headings = closeHauledHeadings(0);
    const tackPt = { x: 200, y: 200 };
    expect(
      centerReachedTackPoint(tackPt, tackPt, headings.port),
    ).toBe(true);
  });
});

describe('upwind entry layline — never overstand', () => {
  it('forces a tack when the boat is past the entry layline on hold tack', () => {
    const course = fixtureCourse('right');
    const windFrom = 0;
    const entry = buildMarkRoundingSpec(course, 1).entryGate.aim;
    const headings = closeHauledHeadings(windFrom);
    // Port layline through entry: back along port close-hauled.
    const portDir = headingUnit(headings.port);
    const onLayline = {
      x: entry.x - portDir.x * 280,
      y: entry.y - portDir.y * 280,
    };
    // Step past that intersection on starboard (overstand / wrong-side reach).
    const stbdDir = headingUnit(headings.starboard);
    const past = {
      x: onLayline.x + stbdDir.x * 90,
      y: onLayline.y + stbdDir.y * 90,
    };

    const boat = createSailboatState({
      x: past.x,
      y: past.y,
      headingDegrees: headings.starboard,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    const memory = {
      ...createBoatDriverMemory(),
      currentTack: 'starboard' as const,
      lastTackAtMs: 0,
      laylineTack: null,
    };

    expect(overstandPastLaylinePx(past, entry, windFrom, 'starboard')).toBeGreaterThan(
      10,
    );

    const decision = decideDriverHeading(boat, course, memory, 10_000);
    expect(decision.reason).toMatch(/Layline tack/);
    expect(decision.memory.currentTack).toBe('port');
  });

  it('at the entry layline commits through the gate instead of thrashing tacks', () => {
    const course = fixtureCourse('right');
    const windFrom = 0;
    const formal = buildMarkRoundingSpec(course, 1);
    const aim = formal.entryGate.aim;
    const boat = createSailboatState({
      x: aim.x - formal.entryGate.normal.x * 8,
      y: aim.y - formal.entryGate.normal.y * 8,
      headingDegrees: closeHauledHeadings(windFrom).port,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    expect(inEntryCommitZone(boat, course, 1)).toBe(true);

    const memory = {
      ...createBoatDriverMemory(),
      currentTack: 'port' as const,
      lastTackAtMs: 0,
      entryGateSide: formal.clearancePx,
    };

    let decision = decideDriverHeading(boat, course, memory, 10_000);
    // Entry commit never locks a beat route (no Dest-only micro-tack circles).
    for (let i = 1; i <= 12; i += 1) {
      decision = decideDriverHeading(
        boat,
        course,
        decision.memory,
        10_000 + i * 16,
      );
      expect(decision.reason).toMatch(
        /Commit entry|Sail entry|Entry CH/,
      );
      expect(decision.reason).not.toMatch(/Layline tack|Route CH|Route tack/);
      expect(decision.memory.tackRoute).toBeNull();
    }
  });

  it('from through stage stays on through — no Dest-only tack and no Exit jump', () => {
    const windFrom = 150;
    const loggedCourse: RaceCourse = {
      ...fixtureCourse('left'),
      buoys: [
        { index: 1, role: 'top', x: 348.9, y: 431.2 },
        { index: 2, role: 'side', x: 510.5, y: 151.4 },
        { index: 3, role: 'bottom', x: 187.4, y: 151.4 },
      ],
    };
    const formal = buildMarkRoundingSpec(loggedCourse, 1);
    const atAim = createSailboatState({
      x: formal.entryGate.aim.x,
      y: formal.entryGate.aim.y,
      headingDegrees: 202,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    expect(inEntryCommitZone(atAim, loggedCourse, 1)).toBe(true);

    const memory = {
      ...createBoatDriverMemory(),
      goalBuoyIndex: 1 as const,
      currentTack: 'starboard' as const,
      lastTackAtMs: 0,
      entryApproachStage: 'through' as const,
      entryGateSide: formal.clearancePx,
    };

    const decision = decideDriverHeading(atAim, loggedCourse, memory, 10_000);
    expect(decision.memory.tackRoute).toBeNull();
    expect(decision.memory.laylineTack).toBeNull();
    expect(decision.reason).toMatch(/Commit entry → through|Entry CH/);
    expect(decision.reason).not.toMatch(/Route CH|Route tack|→ exit/);
    expect(decision.plan.activeTarget.x).toBeCloseTo(
      formal.entryGate.through.x,
      0,
    );
    expect(decision.plan.activeTarget.y).toBeCloseTo(
      formal.entryGate.through.y,
      0,
    );
  });

  it('arms rounding on a slow creep across the gate (not only a single big step)', () => {
    // Logged failure: side went 3.3 → 1.1 → −1.3 while only the last frame
    // was stored, so previousSide>2 ∧ current≤0 never fired and Entry CH thrashed.
    const windFrom = 150;
    const course: RaceCourse = {
      ...fixtureCourse('left'),
      buoys: [
        { index: 1, role: 'top', x: 348.9, y: 431.2 },
        { index: 2, role: 'side', x: 510.5, y: 151.4 },
        { index: 3, role: 'bottom', x: 187.4, y: 151.4 },
      ],
      windFromDegrees: windFrom,
    };
    const formal = buildMarkRoundingSpec(course, 1);
    const { normal, mark } = formal.entryGate;
    const outside = {
      x: mark.x + normal.x * 40,
      y: mark.y + normal.y * 40,
    };
    expect(pointSideOfEntryGate(outside, formal.entryGate)).toBeGreaterThan(2);

    let memory = {
      ...createBoatDriverMemory(),
      goalBuoyIndex: 1 as const,
      entryApproachStage: 'through' as const,
    };
    // Creep across in small steps so intermediate sides land in (0, 2].
    for (const sidePx of [40, 12, 3, 1.1, -1.3]) {
      const boat = createSailboatState({
        x: mark.x + normal.x * sidePx,
        y: mark.y + normal.y * sidePx,
        headingDegrees: 98,
        trueWindSpeedKnots: 8,
        windFromDegrees: windFrom,
      });
      memory = advanceGoalIfClearReached(memory, boat, course);
    }
    expect(memory.roundingPhase).toBe('rounding');
    expect(memory.roundingPath).not.toBeNull();
  });

  it('does not arm on a distant gate-plane cross (logged T1 pose)', () => {
    // Boat crossed side +→− near T1 (~y=229) while Entry sits at ~y=490.
    const windFrom = 150;
    const course: RaceCourse = {
      ...fixtureCourse('left'),
      buoys: [
        { index: 1, role: 'top', x: 348.9, y: 431.2 },
        { index: 2, role: 'side', x: 510.5, y: 151.4 },
        { index: 3, role: 'bottom', x: 187.4, y: 151.4 },
      ],
      windFromDegrees: windFrom,
    };
    const formal = buildMarkRoundingSpec(course, 1);
    let memory = {
      ...createBoatDriverMemory(),
      goalBuoyIndex: 1 as const,
      entryGateSide: 55,
    };
    const remote = createSailboatState({
      x: 391.9,
      y: 229.3,
      headingDegrees: 98,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    expect(pointSideOfEntryGate(remote, formal.entryGate)).toBeLessThan(0);
    expect(inEntryCommitZone(remote, course, 1)).toBe(false);
    memory = advanceGoalIfClearReached(memory, remote, course);
    expect(memory.roundingPhase).toBe('approach');
    expect(memory.roundingPath).toBeNull();
    // Outside latch preserved for a later soft-arm at the portal.
    expect(memory.entryGateSide).toBeGreaterThan(2);
  });

  it('soft-arms when a prior outside latch reaches the portal inside', () => {
    const windFrom = 150;
    const course: RaceCourse = {
      ...fixtureCourse('left'),
      buoys: [
        { index: 1, role: 'top', x: 348.9, y: 431.2 },
        { index: 2, role: 'side', x: 510.5, y: 151.4 },
        { index: 3, role: 'bottom', x: 187.4, y: 151.4 },
      ],
      windFromDegrees: windFrom,
    };
    const formal = buildMarkRoundingSpec(course, 1);
    const through = formal.entryGate.through;
    const memory = advanceGoalIfClearReached(
      {
        ...createBoatDriverMemory(),
        goalBuoyIndex: 1 as const,
        entryGateSide: 80,
      },
      createSailboatState({
        x: through.x,
        y: through.y,
        headingDegrees: 98,
        trueWindSpeedKnots: 8,
        windFromDegrees: windFrom,
      }),
      course,
    );
    expect(memory.roundingPhase).toBe('rounding');
    expect(memory.roundingPath).not.toBeNull();
    // Arm must not Exit-skip — look-ahead is mid-round only.
    expect(memory.roundingWaypointIndex).toBe(0);
  });

  it('does not scallop to Exit on the first mid-round tick after arm', () => {
    // Logged: armWp=0 then next advance jumped wp→1 Exit and cut the corner.
    const windFrom = 150;
    const course: RaceCourse = {
      ...fixtureCourse('left'),
      buoys: [
        { index: 1, role: 'top', x: 348.9, y: 431.2 },
        { index: 2, role: 'side', x: 510.5, y: 151.4 },
        { index: 3, role: 'bottom', x: 187.4, y: 151.4 },
      ],
      windFromDegrees: windFrom,
    };
    const formal = buildMarkRoundingSpec(course, 1);
    const pose = {
      x: 342.6,
      y: 462.4,
      headingDegrees: 98,
    };
    const path = buildRoundingPolygon(formal, pose);
    expect(path.waypoints.length).toBeGreaterThanOrEqual(2);

    let memory = {
      ...createBoatDriverMemory(),
      goalBuoyIndex: 1 as const,
      roundingPhase: 'rounding' as const,
      roundingPath: path,
      roundingWaypointIndex: 0,
      entryGateSide: null,
    };
    const boat = createSailboatState({
      ...pose,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    memory = advanceGoalIfClearReached(memory, boat, course);
    expect(memory.roundingPhase).toBe('rounding');
    expect(memory.roundingWaypointIndex).toBe(0);
    const active =
      shortestPathForRounding(memory.roundingPath!)[
        memory.roundingWaypointIndex
      ]!;
    expect(active.x).not.toBeCloseTo(path.exitPoint.x, 0);
    expect(active.y).not.toBeCloseTo(path.exitPoint.y, 0);
  });

  it('plans a tack route to a point in the no-go and sticks to it', () => {
    const course = fixtureCourse('right');
    const windFrom = 0;
    const target = { x: 450, y: 120 };
    const boat = createSailboatState({
      x: 450,
      y: 500,
      headingDegrees: 0,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    expect(targetPointInNoGo(boat, target, windFrom)).toBe(true);

    const route = buildTackRouteToPoint(
      boat,
      target,
      windFrom,
      null,
      course,
      28,
    );
    expect(route).not.toBeNull();
    expect(route!.legs.some((l) => l.kind === 'tack' || l.label === 'Dest')).toBe(
      true,
    );

    const one = planOneTackToPoint(boat, target, windFrom, null, 28, course);
    expect(one).not.toBeNull();
    const holdHeading = closeHauledHeadings(windFrom)[one!.hold];
    const onBoard = createSailboatState({
      ...boat,
      headingDegrees: holdHeading,
    });

    const memory = {
      ...createBoatDriverMemory(),
      currentTack: one!.hold,
      lastTackAtMs: 0,
      laylineTack: null,
    };
    let decision = decideDriverHeading(onBoard, course, memory, 10_000);
    expect(decision.reason).not.toMatch(/^Fetch /);
    expect(decision.memory.tackRoute).not.toBeNull();
    const locked = decision.memory.tackRoute!;
    for (let i = 1; i <= 8; i += 1) {
      decision = decideDriverHeading(
        onBoard,
        course,
        decision.memory,
        10_000 + i * 16,
      );
      expect(decision.memory.tackRoute).not.toBeNull();
      expect(decision.memory.tackRoute!.targetX).toBeCloseTo(locked.targetX, 0);
      expect(decision.memory.tackRoute!.targetY).toBeCloseTo(locked.targetY, 0);
      expect(decision.memory.tackRoute!.legs[0]?.x).toBeCloseTo(
        locked.legs[0]!.x,
        0,
      );
    }
  });

  it('extends post-exit beat route until the just-rounded mark clears', () => {
    const course = fixtureCourse('right');
    const windFrom = 0;
    const boat = createSailboatState({
      x: 450,
      y: 500,
      headingDegrees: 0,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    const target = { x: 450, y: 120 };
    const previousMark = { x: 450, y: 430, radiusPx: 44 };
    expect(targetPointInNoGo(boat, target, windFrom)).toBe(true);
    expect(pathClearsMark(boat, target, previousMark, previousMark.radiusPx)).toBe(
      false,
    );

    const route = buildTackRouteToPoint(
      boat,
      target,
      windFrom,
      null,
      course,
      44,
      [previousMark],
    );

    expect(route).not.toBeNull();
    expect(route!.legs).not.toHaveLength(1);

    let from = boat;
    for (const leg of route!.legs) {
      expect(
        pathClearsMark(from, leg, previousMark, previousMark.radiusPx),
      ).toBe(true);
      from = leg;
    }
  });

  it('does not plot a beat T past the formal entry layline', () => {
    const course = fixtureCourse('right');
    const windFrom = 0;
    const entry = buildMarkRoundingSpec(course, 1).entryGate.aim;
    const headings = closeHauledHeadings(windFrom);
    const boat = createSailboatState({
      x: 320,
      y: 520,
      headingDegrees: headings.starboard,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    const memory = {
      ...createBoatDriverMemory(),
      currentTack: 'starboard' as const,
      lastTackAtMs: 0,
    };
    const plan = resolveDriverPlan(boat, memory, course);
    const tack = plan.waypoints.find((p) => p.kind === 'tack');
    if (!tack) {
      return;
    }
    // Hold CH distance to layline intersection must stay non-negative at T
    // (T is not past entry layline).
    const stbd = headingUnit(headings.starboard);
    const port = headingUnit(headings.port);
    const db = { x: -port.x, y: -port.y };
    const det = stbd.x * db.y - stbd.y * db.x;
    const dx = entry.x - tack.x;
    const dy = entry.y - tack.y;
    const t = (dx * db.y - dy * db.x) / det;
    expect(t).toBeGreaterThanOrEqual(-8);
  });
});

describe('rounding helm — no beat route', () => {
  it('holds CH toward a no-go vertex instead of locking a tack route', () => {
    const course = fixtureCourse('right');
    const windFrom = 130;
    const spec = buildMarkRoundingSpec(course, 1);
    const pose = {
      x: spec.entryGate.through.x,
      y: spec.entryGate.through.y,
      headingDegrees: 78,
    };
    const path = buildRoundingPolygon(spec, pose);
    // Vertices dead upwind — fetch impossible; helm must not invent a tack route.
    const upwind = headingUnit(windFrom);
    const noGoVertex = {
      x: pose.x + upwind.x * 120,
      y: pose.y + upwind.y * 120,
    };
    const noGoExit = {
      x: noGoVertex.x + upwind.x * 40,
      y: noGoVertex.y + upwind.y * 40,
    };
    const forcedPath = {
      ...path,
      waypoints: [noGoVertex, noGoExit],
      exitPoint: noGoExit,
    };
    const boat = createSailboatState({
      x: pose.x,
      y: pose.y,
      headingDegrees: pose.headingDegrees,
      trueWindSpeedKnots: 8,
      windFromDegrees: windFrom,
    });
    expect(targetPointInNoGo(boat, noGoVertex, windFrom)).toBe(true);

    const memory = {
      ...createBoatDriverMemory(),
      goalBuoyIndex: 1 as const,
      roundingPhase: 'rounding' as const,
      roundingPath: forcedPath,
      roundingWaypointIndex: 0,
      currentTack: 'port' as const,
      lastTackAtMs: 0,
      tackRoute: null,
    };

    const decision = decideDriverHeading(boat, course, memory, 10_000);
    expect(decision.memory.tackRoute).toBeNull();
    expect(decision.reason).toMatch(/^Round CH/);
    expect(decision.plan.roundingPhase).toBe('rounding');
  });
});
