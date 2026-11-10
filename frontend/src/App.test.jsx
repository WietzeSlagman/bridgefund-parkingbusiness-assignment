import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { parseCounts } from "./App.jsx";

const ok = (counts) => ({ ok: true, json: async () => counts });
const flush = async () => {
  await act(async () => {});
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("availability display", () => {
  it("recovers from Strict Mode cleanup without aborting the replacement request", async () => {
    const signals = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, { signal }) => {
        signals.push(signal);
        if (signals.length === 1) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          });
        }
        return Promise.resolve(ok({ resident: 50, car: 80, motorcycle: 20 }));
      }),
    );
    render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    await flush();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(screen.getByText("80")).toBeTruthy();
    expect(screen.queryByText(/Could not update/)).toBeNull();
  });

  it("keeps loading and refresh label slots mounted through polling and manual refresh", async () => {
    const pending = [];
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    const status = screen.getByText("Loading availability…");
    const button = screen.getByRole("button", { name: "Refreshing…" });
    const labels = [...button.querySelectorAll(".refresh-label")];
    expect(status.getAttribute("aria-hidden")).toBe("false");

    const finish = async () => {
      await act(async () => {
        pending.shift()(ok({ resident: 1, car: 2, motorcycle: 3 }));
      });
    };
    const expectIdle = () => {
      expect(status.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByRole("button", { name: "Refresh now" })).toBe(button);
      expect([...button.querySelectorAll(".refresh-label")]).toEqual(labels);
    };
    const expectLoading = () => {
      expect(screen.getByText("Loading availability…")).toBe(status);
      expect(status.getAttribute("aria-hidden")).toBe("false");
      expect(screen.getByRole("button", { name: "Refreshing…" })).toBe(button);
      expect(button.disabled).toBe(true);
      expect(screen.getByText("2")).toBeTruthy();
    };

    await finish();
    expectIdle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expectLoading();
    await finish();
    expectIdle();
    fireEvent.click(button);
    expectLoading();
    await finish();
    expectIdle();
  });

  it("times out a stalled request and keeps the previous reading", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ resident: 1, car: 2, motorcycle: 3 }))
      .mockImplementation(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      );
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.getByText(/Stale:/)).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText(/Could not update/)).toBeTruthy();
  });
  it("loads, polls, shows categories and describes only inferred changes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ resident: 50, car: 0, motorcycle: 20 }))
      .mockResolvedValue(ok({ resident: 49, car: 1, motorcycle: 20 }));
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    expect(screen.getByText("Loading availability…")).toBeTruthy();
    await flush();
    expect(screen.getByText("Full")).toBeTruthy();
    expect(screen.getAllByText("Available")).toHaveLength(2);
    expect(fetch.mock.calls[0][0]).toBe("/occupancy/PB-AMS-2M8D/availability");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Resident: -1 free/)).toBeTruthy();
    expect(screen.getByText(/Visitor car: \+1 free/)).toBeTruthy();
    expect(
      screen.getByText(/not actual arrival or departure events/),
    ).toBeTruthy();
  });

  it("retains stale data on failure and recovers by manual refresh", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ resident: 1, car: 2, motorcycle: 3 }))
      .mockRejectedValueOnce(new Error())
      .mockResolvedValue(ok({ resident: 1, car: 2, motorcycle: 3 }));
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText(/Stale:/)).toBeTruthy();
    expect(screen.getByText(/Could not update/)).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await flush();
    expect(screen.queryByText(/Stale:/)).toBeNull();
    expect(screen.getByText("No count changes observed yet.")).toBeTruthy();
  });

  it("rejects invalid counts and HTTP errors without inventing availability", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok({ resident: -1, car: 0, motorcycle: 0 }))
        .mockResolvedValue({ ok: false }),
    );
    render(<App />);
    await flush();
    expect(screen.getByText(/Could not update/)).toBeTruthy();
    expect(screen.queryByLabelText("Free spaces")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText("Last successful update: None yet")).toBeTruthy();
    expect(() =>
      parseCounts({ resident: 1, car: 1.5, motorcycle: 1 }),
    ).toThrow();
  });
});
