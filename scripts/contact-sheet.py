#!/usr/bin/env python3
# scripts/contact-sheet.py
# =================================================================
# Builds one labeled contact-sheet grid image per tag from media/*.mp4,
# for visual curation review (culling weak clips, writing captions).
# Not part of the shipped extension or the build pipeline — a one-off
# review tool.
#
# Run:  python3 scripts/contact-sheet.py [outdir]
# =================================================================
import json
import os
import subprocess
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "media")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".contact-sheets")
THUMB_W, THUMB_H = 220, 300
COLS = 4
FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"

from PIL import Image, ImageDraw, ImageFont

os.makedirs(OUT, exist_ok=True)

metadata = json.load(open(os.path.join(ROOT, "metadata.json")))

by_tag = defaultdict(list)
for fname in sorted(os.listdir(MEDIA)):
    if not fname.endswith(".mp4"):
        continue
    tag = fname.split("_")[0]
    by_tag[tag].append(fname)

font = ImageFont.truetype(FONT_PATH, 13)
font_small = ImageFont.truetype(FONT_PATH, 11)

for tag, files in sorted(by_tag.items()):
    rows = (len(files) + COLS - 1) // COLS
    row_h = THUMB_H + 34
    sheet = Image.new("RGB", (COLS * THUMB_W, rows * row_h), (20, 20, 24))
    draw = ImageDraw.Draw(sheet)

    for i, fname in enumerate(files):
        r, c = divmod(i, COLS)
        thumb_path = "/tmp/_cs_thumb.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", "1.2", "-i", os.path.join(MEDIA, fname),
             "-frames:v", "1", "-vf", f"scale={THUMB_W}:-1", thumb_path],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            thumb = Image.open(thumb_path)
            thumb = thumb.crop((0, 0, THUMB_W, min(THUMB_H, thumb.height)))
        except Exception:
            thumb = Image.new("RGB", (THUMB_W, THUMB_H), (60, 0, 0))

        x, y = c * THUMB_W, r * row_h
        sheet.paste(thumb, (x, y))

        entry = metadata.get(fname, {})
        audible = "🔊" if entry.get("audible") or entry.get("audio") else "🔈"
        draw.text((x + 4, y + THUMB_H + 2), f"{fname} {audible}", font=font, fill=(255, 255, 255))
        draw.text((x + 4, y + THUMB_H + 18), entry.get("title", "")[:34], font=font_small, fill=(160, 160, 170))

    out_path = os.path.join(OUT, f"{tag}.jpg")
    sheet.save(out_path, quality=85)
    print(f"✓ {out_path}  ({len(files)} clips)")

print("\nDone. Review each sheet, then edit metadata.json for kept/renamed clips.")
