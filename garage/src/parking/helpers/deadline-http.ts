import type { RequestHandler, Response } from "express";
import { Deadline } from "./deadline.js";
import { failure, send, type Result } from "./http.js";

export function httpDeadline(budgetMs: number): RequestHandler {
  return (req, res, next) => {
    const deadline = new Deadline(budgetMs);
    res.locals.deadline = deadline;
    const timer = setTimeout(() => {
      deadline.cancel();
      send(res, failure(503, "SERVICE_UNAVAILABLE"));
      req.resume();
    }, deadline.remaining());
    res.once("finish", () => clearTimeout(timer));
    res.once("close", () => {
      clearTimeout(timer);
      if (!res.writableFinished) {
        deadline.cancel();
      }
    });
    next();
  };
}

export function sendWithinDeadline(res: Response, result: Result): void {
  const deadline = res.locals.deadline as Deadline;
  if (deadline.expired()) {
    deadline.cancel();
    send(res, failure(503, "SERVICE_UNAVAILABLE"));
  } else {
    send(res, result);
  }
}
