#!/usr/bin/env python3
"""Render Strand PWA icons. No third-party libraries."""

import struct
import zlib
from pathlib import Path

BG = (16, 14, 12, 255)
COLORS = [
    (255, 107, 74, 255),
    (240, 162, 2, 255),
    (62, 207, 142, 255),
    (90, 169, 255, 255),
]
STOPS = (0.22, 0.46, 0.70, 1.0)


def write_png(path, width, height, rgba):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def inside_capsule(x, y, x0, y0, x1, y1):
    radius = (y1 - y0) / 2
    cx = min(max(x, x0 + radius), x1 - radius)
    cy = (y0 + y1) / 2
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def sample(x, y, size, capsule_w, capsule_h):
    x0 = (1 - capsule_w) / 2 * size
    x1 = x0 + capsule_w * size
    height = capsule_h * size
    y0 = (size - height) / 2
    y1 = y0 + height
    if not inside_capsule(x, y, x0, y0, x1, y1):
        return BG
    t = (x - x0) / (x1 - x0)
    for index, stop in enumerate(STOPS):
        if t <= stop:
            return COLORS[index]
    return COLORS[-1]


def render(size, capsule_w, capsule_h):
    scale = 3
    big = size * scale
    samples = bytearray(big * big * 4)
    for y in range(big):
        for x in range(big):
            color = sample(x + 0.5, y + 0.5, big, capsule_w, capsule_h)
            i = (y * big + x) * 4
            samples[i:i + 4] = bytes(color)
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(scale):
                for sx in range(scale):
                    i = ((y * scale + sy) * big + (x * scale + sx)) * 4
                    for channel in range(4):
                        acc[channel] += samples[i + channel]
            base = (y * size + x) * 4
            count = scale * scale
            out[base:base + 4] = bytes(channel // count for channel in acc)
    return out


def main():
    root = Path(__file__).resolve().parents[1] / "icons"
    root.mkdir(exist_ok=True)
    icons = {
        "icon-192.png": (192, 0.72, 0.18),
        "icon-512.png": (512, 0.72, 0.18),
        "apple-touch-icon.png": (180, 0.72, 0.18),
        "maskable-512.png": (512, 0.50, 0.13),
    }
    for name, (size, width, height) in icons.items():
        write_png(root / name, size, size, render(size, width, height))
        print(name)


if __name__ == "__main__":
    main()
