import { describe, expect, test } from "bun:test";
import { Track } from "../src/game/track.ts";
import { CarPhysics, autopilotInput } from "../src/game/physics.ts";

// Track textures need a canvas, but these geometry/physics tests do not render.
const context = new Proxy({}, { get: (_target, key) => key === "measureText" ? () => ({ width: 100 }) : () => {}, set: () => true });
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
});

describe("Neon Harbor", () => {
  test("the original canyon circuit remains available", () => {
    const canyon = new Track("canyon");
    expect(canyon.length).toBe(2298);
    expect(canyon.gates.at(-1)?.isFinish).toBe(true);
    expect(canyon.samples.some((sample) => sample.gap)).toBe(true);
    canyon.dispose();
  });
  test("has a continuous drivable circuit and bounded streamed scenery", () => {
    const track = new Track("city");
    expect(track.length).toBe(2524);
    expect(track.gates.length).toBe(8);
    expect(track.gates.at(-1)?.isFinish).toBe(true);
    expect(track.gates.slice(0, -1).every((gate, i, all) => i === 0 || gate.idx > all[i - 1].idx)).toBe(true);
    for (let i = 0; i < track.N; i++) {
      expect(Number.isFinite(track.heightAt(i, 0))).toBe(true);
      expect(Math.abs(track.heightAt(i + 1, 0) - track.heightAt(i, 0))).toBeLessThan(2);
      expect(track.sample(i).gap).toBe(false);
    }
    for (let i = 0; i < track.N; i += 37) {
      track.updateScenery(i);
      const clusters = track.group.children.filter((child) => child.type === "Group");
      // Eight gate groups plus a maximum of five active scenery districts.
      expect(clusters.length).toBeLessThanOrEqual(13);
    }
    const initial = new Set(track.cityClusters.values());
    track.updateScenery(Math.floor(track.N * 0.61));
    expect(new Set(track.cityClusters.values())).toEqual(initial);
    expect(track.obstacles.filter((obstacle) => obstacle.enabled !== false)).toHaveLength(8);
    expect(track.cityHazards.filter((hazard) => hazard.kind === "bike" && !hazard.hardOnly)).toHaveLength(4);
    expect(track.cityHazards.filter((hazard) => hazard.kind === "barricade")).toHaveLength(4);
    track.dispose();
  });

  test("Hard mode enables extra bikes, warning signs and collisions; normal mode hides them", () => {
    const track = new Track("city");
    const extras = track.cityBikes.filter((bike) => bike.hardOnly);
    expect(extras).toHaveLength(4);
    expect(extras.every((bike) => bike.obstacle.enabled === false && bike.obstacle.active === false)).toBe(true);
    const part = track.cityBikeParts[0];
    const matrix = part.original[4].clone();
    part.mesh.getMatrixAt(4, matrix);
    expect(matrix.determinant()).toBe(0);
    track.setCityHardMode(true);
    expect(extras.every((bike) => bike.obstacle.enabled && bike.obstacle.active)).toBe(true);
    part.mesh.getMatrixAt(4, matrix);
    expect(matrix.determinant()).not.toBe(0);
    const extra = extras[0];
    expect(track.hitCityBike(extra.obstacle, 12, 0, 12)).toBe(true);
    track.updateCityBikes(0.1);
    expect(extra.obstacle.active).toBe(false);
    track.setCityHardMode(false);
    track.resetCityBikes();
    expect(extra.obstacle.enabled).toBe(false);
    expect(extra.obstacle.active).toBe(false);
    expect(track.hitCityBike(extra.obstacle, 12, 0, 12)).toBe(false);
    part.mesh.getMatrixAt(4, matrix);
    expect(matrix.determinant()).toBe(0);
    track.setCityHardMode(true);
    expect(extra.obstacle.active).toBe(true);
    track.dispose();
  });

  test("police equipment has physical collisions", () => {
    const track = new Track("city");
    const noop = () => {};
    for (const kind of ["barricade", "bike"]) {
      const hazard = track.cityHazards.find((item) => item.kind === kind);
      let impacts = 0;
      const car = new CarPhysics(track, {
        onJump: noop, onLanding: noop, onCleanLand: noop, onBigAir: noop,
        onDriftBank: noop, onNearMiss: noop, onWallRideStart: noop,
        onCrash: () => { impacts++; }, onBoostStart: noop, onBoxHit: noop, requestRecovery: noop,
      });
      car.place(hazard.idx - 5, hazard.lat, 20);
      for (let i = 0; i < 60 && impacts === 0; i++) {
        car.update({ steer: 0, throttle: 1, brake: 0, handbrake: false, boost: false, rearView: false }, 1 / 60);
      }
      expect(impacts).toBeGreaterThan(0);
    }
    track.dispose();
  });

  test("motorcycle impact slows the car without reversing it and resets cleanly", () => {
    const track = new Track("city");
    const hazard = track.cityHazards.find((item) => item.kind === "bike");
    const obstacle = track.obstacles.find((item) => item.bikeIndex === 0);
    const noop = () => {};
    const car = new CarPhysics(track, {
      onJump: noop, onLanding: noop, onCleanLand: noop, onBigAir: noop,
      onDriftBank: noop, onNearMiss: noop, onWallRideStart: noop,
      onCrash: noop, onBoostStart: noop, onBoxHit: noop, requestRecovery: noop,
    });
    car.place(hazard.idx - 5, hazard.lat, 25);
    let before = car.speed;
    for (let i = 0; i < 60 && obstacle.active; i++) {
      before = car.speed;
      car.update({ steer: 0, throttle: 1, brake: 0, handbrake: false, boost: false, rearView: false }, 1 / 60);
    }
    expect(obstacle.active).toBe(false);
    expect(car.speed).toBeGreaterThan(before * 0.65);
    expect(car.speed).toBeLessThan(before);
    const direction = track.sample(hazard.idx);
    expect(car.vel.x * direction.dx + car.vel.z * direction.dz).toBeGreaterThan(0);
    const bike = track.cityBikes[0];
    track.updateCityBikes(0.1);
    expect(bike.offset.length()).toBeGreaterThan(0);
    track.updateCityBikes(15);
    expect(obstacle.active).toBe(true);
    expect(bike.offset.length()).toBe(0);
    track.hitCityBike(obstacle, 10, 0, 10);
    track.resetCityBikes();
    expect(obstacle.active).toBe(true);
    track.dispose();
  });

  test.each([false, true])("the existing car physics can drive the city loop (hard: %s)", (hard) => {
    const track = new Track("city");
    track.setCityHardMode(hard);
    const noop = () => {};
    const car = new CarPhysics(track, {
      onJump: noop, onLanding: noop, onCleanLand: noop, onBigAir: noop,
      onDriftBank: noop, onNearMiss: noop, onWallRideStart: noop,
      onCrash: noop, onBoostStart: noop, onBoxHit: noop, requestRecovery: noop,
    });
    car.place(track.N - 15, 0, 0);
    const start = car.progressS;
    let gate = 0;
    for (let i = 0; i < 60 * 180 && gate < track.gates.length; i++) {
      const previous = car.progressS;
      car.update(autopilotInput(car, track), 1 / 60);
      const target = track.length + (track.gates[gate].isFinish ? track.length : track.gates[gate].idx * track.step);
      if (previous <= target + 1 && car.progressS >= target && Math.abs(car.lateral) < track.sample(track.gates[gate].idx).hw + 10) gate++;
    }
    expect(car.progressS - start).toBeGreaterThanOrEqual(track.length);
    expect(gate).toBe(track.gates.length);
    track.dispose();
  });
});
