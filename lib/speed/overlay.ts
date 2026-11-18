/**
 * The Speed Check overlay, drawn identically in the review player and in the exported MP4.
 * Only points the analysis actually produced are drawn: observed points as filled dots, bridged
 * (predicted) points as hollow rings, and nothing after the last observed point.
 */

export type OverlayPoint = { pts: number; x: number; y: number; observed: boolean };

export type OverlayData = {
  /** Points in normalised image coordinates (0-1). */
  points: OverlayPoint[];
  releasePts: number | null;
  bounce: OverlayPoint | null;
  endPts: number | null;
  /** Headline, e.g. "104 km/h" or "Unable to measure reliably". */
  title: string;
  /** Second line, e.g. "Average speed, release to bat · range 88-125 km/h". */
  subtitle: string;
  measured: boolean;
};

type Ctx = Pick<CanvasRenderingContext2D, "save" | "restore" | "beginPath" | "moveTo" | "lineTo" | "arc" | "stroke" | "fill" | "fillRect" | "fillText" | "measureText"> & {
  lineWidth: number; strokeStyle: string | CanvasGradient | CanvasPattern; fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number; font: string; textBaseline: CanvasTextBaseline; lineJoin: CanvasLineJoin; lineCap: CanvasLineCap;
};

const BALL = "#ffd23f";
const MARK = "#ffffff";

/** Draws the overlay for video time `t` (seconds) onto a `w` x `h` canvas. */
export function drawOverlay(ctx: Ctx, w: number, h: number, data: OverlayData, t: number) {
  const s = Math.max(w, h) / 1280;
  const shown = data.points.filter((p) => p.pts <= t + 1e-4);
  ctx.save();
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // Restrained trail: a thin line through observed points, older points fading.
  const obs = shown.filter((p) => p.observed);
  if (shown.length > 1) {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = BALL; ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    shown.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    ctx.stroke();
  }
  shown.forEach((p, i) => {
    ctx.globalAlpha = 0.35 + 0.65 * ((i + 1) / shown.length);
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, (p === shown[shown.length - 1] ? 4 : 2.5) * s, 0, Math.PI * 2);
    if (p.observed) { ctx.fillStyle = BALL; ctx.fill(); } else { ctx.strokeStyle = BALL; ctx.lineWidth = 1.2 * s; ctx.stroke(); }
  });
  ctx.globalAlpha = 1;
  const tag = (p: OverlayPoint, text: string, below = false) => {
    ctx.font = `600 ${Math.round(11 * s)}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    const x = p.x * w + 8 * s, y = p.y * h + (below ? 14 : -10) * s, tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(10,20,35,0.75)"; ctx.fillRect(x - 3 * s, y - 8 * s, tw + 6 * s, 16 * s);
    ctx.fillStyle = MARK; ctx.fillText(text, x, y);
  };
  if (data.releasePts != null && t >= data.releasePts && obs[0]) tag(obs[0], "Release");
  if (data.bounce && t >= data.bounce.pts) tag(data.bounce, "Bounce", true);
  if (data.endPts != null && t >= data.endPts && obs.length) tag(obs[obs.length - 1], data.measured ? "Bat" : "Last seen");
  // Label, top-left, only once the delivery has started.
  if (data.releasePts == null || t >= data.releasePts - 0.25) {
    const pad = 10 * s;
    ctx.font = `700 ${Math.round(26 * s)}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    const titleW = ctx.measureText(data.title).width;
    ctx.font = `500 ${Math.round(12 * s)}px system-ui, sans-serif`;
    const subW = ctx.measureText(data.subtitle).width;
    const boxW = Math.min(w - 2 * pad, Math.max(titleW, subW) + 2 * pad), boxH = 56 * s;
    ctx.fillStyle = "rgba(10,20,35,0.72)"; ctx.fillRect(pad, pad, boxW, boxH);
    ctx.fillStyle = data.measured ? "#ffffff" : "#ffd9a8";
    ctx.font = `700 ${Math.round(26 * s)}px system-ui, sans-serif`; ctx.fillText(data.title, 2 * pad, 1.6 * pad);
    ctx.fillStyle = "#d6dde8";
    ctx.font = `500 ${Math.round(12 * s)}px system-ui, sans-serif`; ctx.fillText(data.subtitle, 2 * pad, 1.6 * pad + 32 * s);
  }
  ctx.restore();
}
