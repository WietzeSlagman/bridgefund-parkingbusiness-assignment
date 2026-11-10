import React, { useEffect, useRef, useState } from "react";

const categories = [
  ["resident", "Resident"],
  ["car", "Visitor car"],
  ["motorcycle", "Visitor motorcycle"],
];
const endpoint = "/occupancy/PB-AMS-2M8D/availability";

export function parseCounts(value) {
  if (
    !value ||
    typeof value !== "object" ||
    categories.some(
      ([key]) => !Number.isSafeInteger(value[key]) || value[key] < 0,
    )
  ) {
    throw new Error("Invalid availability response");
  }
  return Object.fromEntries(categories.map(([key]) => [key, value[key]]));
}

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [changes, setChanges] = useState([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const previous = useRef(null);
  const request = useRef(null);
  const refreshRef = useRef(() => {});

  useEffect(() => {
    let mounted = true;
    async function refresh() {
      if (request.current) return;
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(endpoint, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Availability unavailable");
        const counts = parseCounts(await response.json());
        if (!mounted) return;
        const time = Date.now();
        if (previous.current) {
          const differences = categories.flatMap(([key, label]) => {
            const delta = counts[key] - previous.current[key];
            return delta ? [{ label, delta, time }] : [];
          });
          setChanges((old) => [...differences, ...old].slice(0, 10));
        }
        previous.current = counts;
        setSnapshot({ counts, time });
        setNow(time);
        setError(false);
      } catch {
        if (mounted) setError(true);
      } finally {
        clearTimeout(timeout);
        if (request.current === controller) request.current = null;
        if (mounted) setLoading(false);
      }
    }
    refreshRef.current = refresh;
    refresh();
    const poll = setInterval(refresh, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted = false;
      clearInterval(poll);
      clearInterval(clock);
      request.current?.abort();
      request.current = null;
    };
  }, []);

  const stale = snapshot && (error || now - snapshot.time >= 15000);
  return (
    <main className="dashboard">
      <header className="masthead">
        <div className="wordmark">
          <span aria-hidden="true">P</span> ParkingBusiness
        </div>
        <span className="location">
          Amsterdam <span aria-hidden="true"> / </span> PB-AMS-2M8D
        </span>
      </header>
      <div className="intro">
        <p className="eyebrow">Your parking overview</p>
        <h1>
          Space to <em>get going.</em>
        </h1>
        <p className="intro-copy">
          PB-AMS-2M8D · Recorded allocations, not physical presence.
          Availability can change at any time.
        </p>
      </div>
      <div className="toolbar">
        <div>
          <p className="eyebrow">At a glance</p>
          <h2>Parking availability</h2>
        </div>
        <button
          type="button"
          onClick={() => refreshRef.current()}
          disabled={loading}
        >
          <span className="refresh-label" aria-hidden={!loading}>
            Refreshing…
          </span>
          <span className="refresh-label" aria-hidden={loading}>
            Refresh now
          </span>
        </button>
      </div>
      <div className="update-status" role="status" aria-live="polite">
        <p className="loading-status" aria-hidden={!loading}>
          Loading availability…
        </p>
        {error && <p>Could not update availability. Retrying automatically.</p>}
        {stale && <p>Stale: showing the last successful reading.</p>}
        <p>
          Last successful update:{" "}
          {snapshot ? new Date(snapshot.time).toLocaleString() : "None yet"}
        </p>
      </div>
      {snapshot && (
        <section className="spaces" aria-label="Free spaces">
          {categories.map(([key, label]) => (
            <article key={key}>
              <h2>{label}</h2>
              <p className="count">
                <strong>{snapshot.counts[key]}</strong> free
              </p>
              <p
                className={snapshot.counts[key] === 0 ? "badge full" : "badge"}
              >
                {snapshot.counts[key] === 0 ? "Full" : "Available"}
              </p>
            </article>
          ))}
        </section>
      )}
      <section className="activity">
        <p className="eyebrow">The latest</p>
        <h2>Recent inferred count changes</h2>
        <p>
          Differences between successful readings, not actual arrival or
          departure events. Intermediate changes may be missed.
        </p>
        {changes.length ? (
          <ul>
            {changes.map((change, i) => (
              <li key={`${change.time}-${change.label}-${i}`}>
                {new Date(change.time).toLocaleTimeString()} · {change.label}:{" "}
                {change.delta > 0 ? "+" : ""}
                {change.delta} free
              </li>
            ))}
          </ul>
        ) : (
          <p>No count changes observed yet.</p>
        )}
        <p>
          A zero count can also mean no spaces are configured for that category.
        </p>
      </section>
    </main>
  );
}
