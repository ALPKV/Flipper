"""Decode delivery windows to raw grayscale frames for the offline Speed Check evaluation.

Local-only developer tool (OpenCV). Never part of the app or deployment. Usage:
  python scripts/speed-eval/decode.py <video> <name> <t0> <t1> <outdir> [long_side=1280]
Writes <outdir>/<name>.gray (frames concatenated, uint8) and <name>.json (size, PTS seconds).
All frames are kept, including exact duplicates: detecting those is part of what is evaluated.
"""
import cv2, json, sys, os
video, name, t0, t1, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
long_side = int(sys.argv[6]) if len(sys.argv) > 6 else 1280
os.makedirs(out, exist_ok=True)
cap = cv2.VideoCapture(video)
cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t0 - 0.5) * 1000)
times, size = [], None
with open(os.path.join(out, name + ".gray"), "wb") as fh:
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if t < t0 - 1e-4:
            continue
        if t > t1:
            break
        h, w = frame.shape[:2]
        s = long_side / max(w, h)
        g = cv2.cvtColor(cv2.resize(frame, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        size = (g.shape[1], g.shape[0])
        fh.write(g.tobytes())
        times.append(round(t, 6))
json.dump({"video": os.path.basename(video), "w": size[0], "h": size[1], "times": times, "scaleFromSource": s}, open(os.path.join(out, name + ".json"), "w"))
print(name, size, len(times), "frames", times[0], times[-1])
