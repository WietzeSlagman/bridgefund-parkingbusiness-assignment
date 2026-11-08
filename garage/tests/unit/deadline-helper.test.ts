import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";
import { afterEach, expect, it, vi } from "vitest";
import type { Deadline } from "../../src/parking/helpers/deadline.js";
import {
  httpDeadline,
  sendWithinDeadline,
} from "../../src/parking/helpers/deadline-http.js";

function setup(budget: number) {
  const resume = vi.fn();
  const req = { resume } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    locals: {},
    writableFinished: false,
    headersSent: false,
    destroyed: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
  });
  const next = vi.fn();
  httpDeadline(budget)(req, res as unknown as Response, next as NextFunction);
  return {
    resume,
    res,
    next,
    deadline: (res.locals as { deadline: Deadline }).deadline,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("uses each route's budget and cancels and drains on timeout", () => {
  vi.useFakeTimers();
  const short = setup(100);
  const long = setup(300);
  const cancel = vi.fn();
  short.deadline.onCancel(cancel);
  vi.advanceTimersByTime(100);
  expect(short.next).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
  expect(short.res.status).toHaveBeenCalledWith(503);
  expect(short.resume).toHaveBeenCalledOnce();
  expect(long.deadline.expired()).toBe(false);
  long.res.emit("finish");
  expect(vi.getTimerCount()).toBe(0);
});

it("cleans up on finish and cancels on disconnect, without a late response", () => {
  vi.useFakeTimers();
  const finished = setup(100);
  const disconnected = setup(100);
  const cancelled = vi.fn();
  disconnected.deadline.onCancel(cancelled);
  finished.res.writableFinished = true;
  finished.res.emit("finish");
  finished.res.emit("close");
  disconnected.res.destroyed = true;
  disconnected.res.emit("close");
  expect(cancelled).toHaveBeenCalledOnce();
  expect(finished.deadline.expired()).toBe(false);
  sendWithinDeadline(disconnected.res as unknown as Response, { status: 201 });
  vi.advanceTimersByTime(100);
  expect(disconnected.res.status).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("sends a timely result but replaces an expired result with a generic 503", () => {
  vi.useFakeTimers();
  const timely = setup(100);
  sendWithinDeadline(timely.res as unknown as Response, {
    status: 201,
    body: { ok: true },
  });
  expect(timely.res.status).toHaveBeenCalledWith(201);
  expect(timely.res.json).toHaveBeenCalledWith({ ok: true });
  timely.res.emit("finish");

  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const late = setup(100);
  const cancel = vi.fn();
  late.deadline.onCancel(cancel);
  now = 101;
  sendWithinDeadline(late.res as unknown as Response, { status: 201 });
  expect(cancel).toHaveBeenCalledOnce();
  expect(late.res.status).toHaveBeenCalledWith(503);
  expect(late.res.json).toHaveBeenCalledWith({
    error: { code: "SERVICE_UNAVAILABLE", message: "SERVICE UNAVAILABLE" },
  });
  late.res.emit("finish");
});
