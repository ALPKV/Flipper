/** A shot found from the sound: bat contact time and loudness against the session's big hits (dB). */
export type Delivery = { t: number; rel: number; kind?: "bat" | "motion"; actionTime?: number };

export const deliveryId = (d: Delivery) => `${d.kind === "motion" ? "v" : "a"}${d.t.toFixed(3)}`;

/**
 * The clip around each shot: `leadIn` before it and `length` long, but never reaching into the
 * neighbouring shots, so every ball keeps its own clip however close the next one is. Pass only the
 * shots being kept (not ones marked Not a shot), so a removed fake doesn't shorten its neighbours.
 */
export function clipWindows(
  deliveries: Delivery[],
  leadIn: number,
  length: number,
  duration = Infinity,
): { delivery: Delivery; start: number; end: number }[] {
  const list = [...deliveries].sort((a, b) => a.t - b.t);
  return list.map((d, k) => {
    let start = Math.max(0, d.t - leadIn);
    // Motion peaks are action candidates, not contact timestamps. Include follow-through without
    // shifting them to a made-up contact time.
    let end = Math.min(duration, start + (d.kind === "motion" ? Math.max(3.5, length) : length));
    const prev = list[k - 1];
    const next = list[k + 1];
    if (prev) start = Math.min(Math.max(start, (prev.t + d.t) / 2, prev.t + 0.3), d.t - 0.2);
    if (next) end = Math.max(Math.min(end, (d.t + next.t) / 2, next.t - 0.3), d.t + 0.2);
    return { delivery: d, start, end: Math.min(duration, end) };
  });
}
