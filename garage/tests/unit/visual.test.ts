import { describe, expect, it, vi } from "vitest";
import {
  runnerOptions,
  visualSchedule,
  visualOptions,
} from "../../src/tools/visual.js";

describe("visual demo", () => {
  it("keeps the fast demo and load defaults independent of visual settings", () => {
    const env = {
      VISUAL_SESSIONS: "invalid",
      LOAD_SESSIONS: "9",
      LOAD_CONCURRENCY: "3",
    };
    expect(runnerOptions("demo", env)).toEqual({ count: 1, concurrency: 1 });
    expect(runnerOptions("load", {})).toEqual({ count: 40, concurrency: 8 });
    expect(runnerOptions("load", env)).toEqual({ count: 9, concurrency: 3 });
  });
  it("defaults to eight cars and holds longer than the display poll", () => {
    expect(visualOptions({})).toEqual({ sessions: 8, holdSeconds: 12 });
    expect(
      visualOptions({ VISUAL_SESSIONS: "3", VISUAL_HOLD_SECONDS: "6" }),
    ).toEqual({ sessions: 3, holdSeconds: 6 });
  });
  it.each([
    { VISUAL_SESSIONS: "1" },
    { VISUAL_SESSIONS: "21" },
    { VISUAL_HOLD_SECONDS: "5" },
    { VISUAL_HOLD_SECONDS: "61" },
    { VISUAL_HOLD_SECONDS: "1.5" },
    { VISUAL_SESSIONS: "" },
  ])("rejects unsafe options %o", (env) => {
    expect(() => visualOptions(env)).toThrow();
  });
  it("interleaves FIFO departures, alternates gates, and holds every verified state", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const events: string[] = [];
    let next = 0;
    await visualSchedule(
      4,
      6,
      (gate) => {
        events.push(`in${gate}`);
        return Promise.resolve(next++);
      },
      (session, gate) => {
        events.push(`out${gate}:${session}`);
        return Promise.resolve();
      },
      (active) => {
        events.push(`verify:${active.join(",")}`);
        return Promise.resolve();
      },
      wait,
      log,
    );
    expect(events).toEqual([
      "in0",
      "verify:0",
      "in1",
      "verify:0,1",
      "out0:0",
      "verify:1",
      "in0",
      "verify:1,2",
      "out1:1",
      "verify:2",
      "in1",
      "verify:2,3",
      "out0:2",
      "verify:3",
      "out1:3",
      "verify:",
    ]);
    expect(wait).toHaveBeenCalledTimes(8);
    expect(wait.mock.calls.every(([ms]) => ms === 6000)).toBe(true);
    expect(log).toHaveBeenCalledTimes(8);
  });
});
