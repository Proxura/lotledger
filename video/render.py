"""Render captions onto the raw recording and append an end card.
Usage: python3 render.py <wide|tall>"""
import json, subprocess, sys, os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

MODE = sys.argv[1]
OUT = Path(f'/home/claude/lotledger/video/out/{MODE}')
W, H = (1920, 1080) if MODE == 'wide' else (1080, 1920)
FONT = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
FONT_B = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'
marks = dict((l, t) for t, l in json.loads((OUT / 'marks.json').read_text()))

CAPTIONS = [
    ('signin', 'lots', 'You make small batches.\\nCan you say which batch went to which customer?'),
    ('lots', 'newlot', 'LotLedger. Every batch you make, in one place.'),
    ('newlot', 'logged', 'Log a batch in about 20 seconds.'),
    ('logged', 'unitsout', 'It numbers the lot and sets the best-by date for you.'),
    ('unitsout', 'recorded', 'Sold some? Record what went out.'),
    ('recorded', 'details', 'The on-hand count stays right. Nothing to add up.'),
    ('details', 'ship', 'Every unit traced. One tap when a customer asks.'),
    ('ship', 'exported', 'Orders from Shopify or Etsy, one import.'),
    ('exported', 'account', 'One click: a file Pirate Ship imports straight in.'),
    ('account', 'end', '$19 a month or $149 once. Free for 30 days, no card.'),
]

def esc(s):
    return s.replace('\\', '\\\\').replace("'", "’").replace(':', '\\:').replace('%', '\\%')

size = 54 if MODE == 'wide' else 58
lineh = int(size * 1.3)
filters = []
for a, b, text in CAPTIONS:
    t0, t1 = marks[a], marks[b]
    import textwrap
    lines = [l for part in text.split('\\n') for l in textwrap.wrap(part, 30 if MODE == 'tall' else 60)]
    n = len(lines)
    # bottom-anchored block with safe margin (tall: keep clear of TikTok UI)
    bottom_margin = 110 if MODE == 'wide' else 190
    for i, line in enumerate(lines):
        y = H - bottom_margin - (n - i) * lineh
        filters.append(
            f"drawtext=fontfile={FONT}:text='{esc(line)}':fontsize={size}:fontcolor=white:"
            f"box=1:boxcolor=black@0.62:boxborderw=18:x=(w-text_w)/2:y={y}:"
            f"enable='between(t,{t0:.2f},{t1:.2f})'"
        )
vf = ','.join(filters + ['format=yuv420p'])

enc = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60']
main_tmp = OUT / 'tmp-main.mp4'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(OUT / 'raw.webm'), '-t', f"{marks['end']:.2f}", '-vf', vf, *enc, str(main_tmp)], check=True)
os.replace(main_tmp, OUT / 'scene-main.mp4')

# End card
img = Image.new('RGB', (W, H), (15, 26, 23))
d = ImageDraw.Draw(img)
f1 = ImageFont.truetype(FONT_B, 150 if MODE == 'wide' else 120)
f2 = ImageFont.truetype(FONT, 60 if MODE == 'wide' else 54)
title = 'LotLedger'
tw = d.textlength(title, font=f1)
cx = (W - tw) / 2; cy = H * 0.36
d.text((cx, cy), 'Lot', font=f1, fill=(248, 240, 220))
d.text((cx + d.textlength('Lot', font=f1), cy), 'Ledger', font=f1, fill=(110, 230, 200))
sub = ['Batch and lot records for small makers.', 'Free for 30 days. Link in bio.']
y = cy + 200
for s_ in sub:
    d.text(((W - d.textlength(s_, font=f2)) / 2, y), s_, font=f2, fill=(200, 210, 205)); y += 90
img.save(OUT / 'endcard.png')
end_tmp = OUT / 'tmp-end.mp4'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', str(OUT / 'endcard.png'), '-vf', 'format=yuv420p,loop=-1:1,trim=duration=3.5,fade=t=in:st=0:d=0.4', *enc, str(end_tmp)], check=True)
os.replace(end_tmp, OUT / 'scene-end.mp4')

(OUT / 'concat.txt').write_text(f"file 'scene-main.mp4'\nfile 'scene-end.mp4'\n")
final_tmp = OUT / 'tmp-final.mp4'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(OUT / 'concat.txt'), '-c', 'copy', '-movflags', '+faststart', str(final_tmp)], check=True)
os.replace(final_tmp, OUT / f'lotledger-demo-{MODE}.mp4')
print('done', OUT / f'lotledger-demo-{MODE}.mp4')
