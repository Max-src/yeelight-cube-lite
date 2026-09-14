"""Measure paired clock LEDs in the September 14 Rainbow recordings."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def pair_leds(samples):
    rows = []
    for sample in samples:
        if not rows or sample[1] - np.median([point[1] for point in rows[-1]]) > 0.035:
            rows.append([])
        rows[-1].append(sample)
    rows = [sorted(row, key=lambda point: point[0]) for row in rows if len(row) >= 4]
    if len(rows) != 10:
        return []
    pairs = []
    for upper, lower in zip(rows[:5], rows[5:]):
        upper_left, upper_right = rows[0][0][0], rows[0][-1][0]
        lower_left, lower_right = rows[5][0][0], rows[5][-1][0]
        for point in upper:
            position = (point[0] - upper_left) / (upper_right - upper_left)
            match = min(lower, key=lambda other: abs((other[0] - lower_left) / (lower_right - lower_left) - position))
            distance = abs((match[0] - lower_left) / (lower_right - lower_left) - position)
            if distance < 0.025:
                pairs.append([*match[2:5], *point[2:5], round(position * 14), *point[5:8]])
    return pairs


def phase_curve(paired_frames):
    tracks = {}
    for frame_index, pairs in enumerate(paired_frames):
        for pair in pairs:
            tracks.setdefault(pair[6], {}).setdefault(frame_index, []).append(pair[:3])
    crossings = []
    periods = []
    for column, track in tracks.items():
        previous = None
        column_crossings = []
        for frame_index, colors in sorted(track.items()):
            color = np.asarray(np.median(colors, axis=0), dtype=np.float32) / 255
            hue = cv2.cvtColor(color.reshape(1, 1, 3), cv2.COLOR_RGB2HSV)[0, 0, 0]
            if previous is not None:
                previous_frame, previous_hue = previous
                if frame_index - previous_frame <= 3 and (previous_hue < 30 or previous_hue > 330) and 260 < hue < 320:
                    column_crossings.append((previous_frame + frame_index) / 2)
            previous = frame_index, hue
        periods.extend(np.diff(column_crossings).tolist())
        crossings.extend((column, time) for time in column_crossings)
    period = float(np.median(periods))
    first = next(time for column, time in crossings if column == 0)
    unwrapped = [(column, time - round((time - first - column * period / 20) / period) * period) for column, time in crossings]
    design = np.asarray([[column, 1] for column, time in unwrapped])
    slope, offset = np.linalg.lstsq(design, np.asarray([time for column, time in unwrapped]), rcond=None)[0]
    residual = float(np.sqrt(np.mean((design @ [slope, offset] - np.asarray([time for column, time in unwrapped])) ** 2)))
    samples = []
    for frame_index, pairs in enumerate(paired_frames):
        for pair in pairs:
            phase = ((pair[6] * slope - frame_index + offset) / period) % 1
            samples.append([phase, *pair[:6], *pair[7:10]])
    samples = np.asarray(samples)
    stops = []
    for phase in np.linspace(0.025, 0.975, 20):
        selected = samples[abs(samples[:, 0] - phase) < 0.025]
        stops.append([round(float(phase), 3), *np.median(selected[:, 4:7], axis=0).tolist(),
                  *np.median(selected[:, 7:10], axis=0).tolist()])
    print("phase fit", "period", period, "column step", slope / period, "wrap residual frames", residual)
    print("stops", stops)
    return {"period_frames": period, "column_step": slope / period, "offset_frames": offset,
            "wrap_rms_frames": residual, "stops": stops}


def summarize(results, output):
    summary = {}
    strips = []
    for name, clip in results.items():
        paired_frames = [pair_leds(samples) for samples in clip["frames"]]
        pairs = np.asarray([pair for frame in paired_frames for pair in frame], dtype=np.float32)
        reference_hsv = cv2.cvtColor((pairs[:, :3] / 255).reshape(-1, 1, 3), cv2.COLOR_RGB2HSV)[:, 0]
        bins = []
        for hue in range(0, 360, 15):
            selected = pairs[(reference_hsv[:, 0] >= hue) & (reference_hsv[:, 0] < hue + 15)]
            if len(selected) < 10:
                continue
            bins.append({"hue": hue + 7.5, "count": len(selected),
                         "reference": np.median(selected[:, :3], axis=0).tolist(),
                         "upper": np.median(selected[:, 3:6], axis=0).tolist()})
        summary[name] = {"paired_frames": sum(bool(frame) for frame in paired_frames), "pairs": len(pairs), "bins": bins}
        summary[name]["phase"] = phase_curve(paired_frames)
        print(name, "paired_frames=", summary[name]["paired_frames"], "pairs=", len(pairs))
        strip = np.zeros((160, len(clip["frames"]), 3), dtype=np.uint8)
        for frame_index, samples in enumerate(clip["frames"]):
            paired = pair_leds(samples)
            if paired:
                strip[:80, frame_index] = paired[0][3:6]
                strip[80:, frame_index] = paired[0][:3]
        strips.append(cv2.resize(strip[:, :, ::-1], (1080, 160)))
    (output / "curves.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    cv2.imwrite(str(output / "time-strips.jpg"), np.vstack(strips))


def sample_leds(frame, recover_dark=False):
    height, width = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = np.uint8(hsv[:, :, 2] > 110) * 255
    mask[:int(height * 0.095)] = 0
    mask[int(height * 0.95):] = 0
    mask[:, :int(width * 0.14)] = 0
    mask[:, int(width * 0.88):] = 0
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    samples = []
    for contour in contours:
        left, top, box_width, box_height = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        if not (width * height * 0.00012 < area < width * height * 0.003):
            continue
        if not (0.18 < box_width / box_height < 1.7):
            continue
        center_x = left + box_width / 2
        center_y = top + box_height / 2
        radius_x = max(1, int(box_width * 0.2))
        radius_y = max(1, int(box_height * 0.2))
        patch = frame[int(center_y)-radius_y:int(center_y)+radius_y+1,
                      int(center_x)-radius_x:int(center_x)+radius_x+1]
        rgb = np.median(patch.reshape(-1, 3), axis=0)[::-1]
        outer = frame[max(0, top-3):top+box_height+3, max(0, left-3):left+box_width+3].reshape(-1, 3).astype(float)
        levels = np.max(outer, axis=1)
        usable = outer[(levels >= 70) & (levels <= 200)]
        edge = np.median(usable / np.max(usable, axis=1)[:, None] * 255, axis=0)[::-1] if len(usable) >= 5 else rgb
        samples.append([center_x / width, center_y / height, *rgb.tolist(), *edge.tolist()])
    samples.sort(key=lambda sample: (sample[1], sample[0]))
    if recover_dark:
        rows = []
        for sample in samples:
            if not rows or sample[1] - np.median([point[1] for point in rows[-1]]) > 0.035:
                rows.append([])
            rows[-1].append(sample)
        rows = [sorted(row, key=lambda point: point[0]) for row in rows if len(row) >= 4]
        if len(rows) == 10:
            upper, lower = rows[0], rows[5]
            stable_upper = [point for point in upper if point[0] > 0.5]
            stable_lower = [point for point in lower if point[0] > 0.5]
            if len(stable_upper) >= 3 and len(stable_lower) == len(stable_upper):
                horizontal = np.polyfit([point[0] for point in stable_lower], [point[0] for point in stable_upper], 1)
                vertical = np.polyfit([point[0] for point in upper], [point[1] for point in upper], 1)
                for point in lower:
                    position_x = float(np.polyval(horizontal, point[0]))
                    if min(abs(other[0] - position_x) for other in upper) < 0.012:
                        continue
                    position_y = float(np.polyval(vertical, position_x))
                    center_x, center_y = int(position_x * width), int(position_y * height)
                    radius = max(1, int(width * 0.002))
                    patch = frame[center_y-radius:center_y+radius+1, center_x-radius:center_x+radius+1]
                    color = np.median(patch.reshape(-1, 3), axis=0)[::-1]
                    samples.append([position_x, position_y, *color.tolist(), *color.tolist()])
    return sorted(samples, key=lambda sample: (sample[1], sample[0]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--summarize", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.summarize:
        summarize(json.loads((args.output / "samples.json").read_text(encoding="utf-8")), args.output)
        return
    results = {}
    for path in sorted(args.source.glob("VID_20260914_103*.mp4")):
        capture = cv2.VideoCapture(str(path))
        fps = capture.get(cv2.CAP_PROP_FPS)
        expected = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        frames = []
        while True:
            success, frame = capture.read()
            if not success:
                break
            samples = sample_leds(frame, recover_dark="b&w" in path.name)
            frames.append(samples)
            if len(frames) == expected // 2:
                height, width = frame.shape[:2]
                for center_x, center_y, *_ in samples:
                    cv2.circle(frame, (int(center_x * width), int(center_y * height)), 12, (0, 0, 255), 2)
                cv2.imwrite(str(args.output / f"{path.stem}.jpg"), cv2.resize(frame, (int(width * 720 / height), 720)))
        capture.release()
        assert len(frames) == expected, (path.name, len(frames), expected)
        results[path.stem] = {"fps": fps, "frames": frames}
        print(path.name, "frames=", len(frames), "LED count min/median/max=",
              np.min(list(map(len, frames))), np.median(list(map(len, frames))), np.max(list(map(len, frames))))
    (args.output / "samples.json").write_text(json.dumps(results), encoding="utf-8")
    summarize(results, args.output)


if __name__ == "__main__":
    main()