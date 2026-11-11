"""Assemble the demo with a voiceover. Usage: python3 assemble.py <wide|tall> <vo.mp3>

Takes the raw recordings already on disk (raw.webm + marks.json from film.py,
scan.webm + scan-marks.json from film-scan.py), splits the voiceover on the
pauses between its lines, and cuts one scene per line. A scene is held on its
last frame until its line finishes, so the picture never runs ahead of the voice.
Captions are drawn from the same lines. Writes lotledger-demo-<mode>.mp4."""
import sys, json, re, subprocess, os, textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

MODE, VO = sys.argv[1], Path(sys.argv[2])
OUT = Path(f'/home/claude/lotledger/video/out/{MODE}')
W, H = (1920, 1080) if MODE == 'wide' else (1080, 1920)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

# (source, start mark, end mark, caption). Order is the order of the voiceover lines.
SCENES = [
    ('raw',  'signin',   'lots',     'You make small batches.\nIf a customer asked which batch they got, could you tell them?'),
    ('raw',  'lots',     'newlot',   'LotLedger. Every batch you make, in one place.'),
    ('raw',  'newlot',   'logged',   'Logging a batch takes about 20 seconds.'),
    ('raw',  'logged',   'unitsout', 'It numbers the lot and sets the best-by date for you.'),
    ('raw',  'unitsout', 'recorded', 'Sold some? Record what went out.'),
    ('raw',  'recorded', 'details',  'The on-hand count stays right. Nothing to add up by hand.'),
    ('raw',  'details',  'ship',     'Every unit traced back to its lot. One tap when a customer asks.'),
    ('scan', 'scan',     'end',      'Print a QR label. Scan it and the lot opens.'),
    ('raw',  'ship',     'exported', 'Orders from Shopify or Etsy, one import.'),
    ('raw',  'exported', 'account',  'One click: a file Pirate Ship imports straight in.'),
    ('raw',  'account',  'end',      '$19 a month or $149 once. Free for 30 days, no card.'),
]

VO_LINES = [
    'You make small batches. If a customer asked which batch they got, could you tell them?',
    'LotLedger puts every batch you make in one place.',
    'Logging a batch takes about twenty seconds.',
    'It numbers the lot and sets the best-by date for you.',
    'Sold some? Record what went out.',
    'The on-hand count stays right. Nothing to add up by hand.',
    'Every unit is traced back to its lot. One tap when a customer asks.',
    'Print a QR label. Scan it with your phone, and the lot opens.',
    'Orders from Shopify or Etsy come in with one import.',
    'One click gives you a file Pirate Ship imports straight in.',
    'Nineteen dollars a month, or one forty-nine once. Free for thirty days, no card.',
]
assert len(VO_LINES) == len(SCENES)

def marks(name):
    return dict((l, t) for t, l in json.loads((OUT / name).read_text()))
M = {'raw': marks('marks.json'), 'scan': marks('scan-marks.json')}
SRC = {'raw': OUT / 'raw.webm', 'scan': OUT / 'scan.webm'}

# 1. Split the voiceover on silence.
log = subprocess.run(['ffmpeg', '-i', str(VO), '-af', 'silencedetect=noise=-32dB:d=0.28', '-f', 'null', '-'],
                     capture_output=True, text=True).stderr
total = float(re.search(r'Duration: (\d+):(\d+):([\d.]+)', log).group(3)) + 60 * float(re.search(r'Duration: (\d+):(\d+):', log).group(2))
starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
# speech segments are the gaps between silences
cuts = [0.0]
for s, e in zip(starts, ends):
    cuts.append((s + e) / 2)
cuts.append(total)
# drop leading/trailing silence halves that produce empty speech
segs = []
for a, b in zip(cuts, cuts[1:]):
    if b - a > 0.4: segs.append((a, b))
if len(segs) != len(SCENES):
    # The voice pauses between sentences about as long as between paragraphs, so the split finds more
    # pieces than lines. Group consecutive pieces into lines by matching each line's share of the
    # spoken words, which is what the read time tracks. Dynamic programming over contiguous groups.
    words = [len(v.split()) for v in VO_LINES]
    speech = sum(b - a for a, b in segs)
    want = [speech * w / sum(words) for w in words]
    n, m = len(segs), len(SCENES)
    if n < m: sys.exit(f'voiceover split into {n} pieces, fewer than {m} lines')
    INF = float('inf')
    best = [[INF] * (n + 1) for _ in range(m + 1)]; back = [[0] * (n + 1) for _ in range(m + 1)]
    best[0][0] = 0.0
    for i in range(1, m + 1):
        for j in range(i, n + 1):
            for k in range(i - 1, j):
                if best[i - 1][k] == INF: continue
                d = sum(b - a for a, b in segs[k:j])
                c = best[i - 1][k] + (d - want[i - 1]) ** 2
                if c < best[i][j]: best[i][j] = c; back[i][j] = k
    groups, j = [], n
    for i in range(m, 0, -1):
        k = back[i][j]; groups.append(segs[k:j]); j = k
    groups.reverse()
    segs = [(g[0][0], g[-1][1]) for g in groups]
    print(f'grouped {n} pieces into {m} lines by word share')
print('voiceover lines:', [round(b - a, 2) for a, b in segs])

# 2. Cut each scene, pad with its last frame to the length of its line (+ a beat).
enc = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60']
clips, timeline, t = [], [], 0.0
for i, ((src, a, b, cap), (va, vb)) in enumerate(zip(SCENES, segs)):
    t0, t1 = M[src][a], M[src][b]
    vid_len = t1 - t0
    want = max(vid_len, (vb - va) + 0.35)
    pad = max(0.0, want - vid_len)
    clip = OUT / f'clip-{i:02d}.mp4'
    vf = f'tpad=stop_mode=clone:stop_duration={pad:.3f},scale={W}:{H},format=yuv420p'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t0:.3f}', '-t', f'{vid_len:.3f}', '-i', str(SRC[src]), '-vf', vf, '-an', *enc, str(clip)], check=True)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(clip)], capture_output=True, text=True).stdout)
    clips.append(clip); timeline.append((t, t + dur, cap, va, vb)); t += dur
(OUT / 'concat-vo.txt').write_text(''.join(f"file '{c.name}'\n" for c in clips))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(OUT / 'concat-vo.txt'), '-c', 'copy', str(OUT / 'main-silent.mp4')], check=True)

# 3. Voice track: each line placed at its scene's start.
parts, fc = [], []
for i, (s0, s1, cap, va, vb) in enumerate(timeline):
    fc.append(f'[0:a]atrim={va:.3f}:{vb:.3f},asetpts=PTS-STARTPTS,adelay={int(s0 * 1000)}|{int(s0 * 1000)}[a{i}]')
fc.append(''.join(f'[a{i}]' for i in range(len(timeline))) + f'amix=inputs={len(timeline)}:normalize=0,aresample=48000[vo]')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(VO), '-filter_complex', ';'.join(fc), '-map', '[vo]', '-t', f'{t:.3f}', '-c:a', 'aac', '-b:a', '160k', str(OUT / 'vo-aligned.m4a')], check=True)

# 4. Captions.
def esc(s): return s.replace('\\', '\\\\').replace("'", '’').replace(':', '\\:').replace('%', '\\%')
size = 54 if MODE == 'wide' else 58
lineh = int(size * 1.3)
filters = []
for s0, s1, cap, va, vb in timeline:
    lines = [l for part in cap.split('\n') for l in textwrap.wrap(part, 30 if MODE == 'tall' else 60)]
    n = len(lines); bottom = 110 if MODE == 'wide' else 190
    top = cap.startswith('Print a QR')   # the result card sits where the caption would
    for i, line in enumerate(lines):
        y = (bottom + i * lineh) if top else (H - bottom - (n - i) * lineh)
        filters.append(f"drawtext=fontfile={FONT}:text='{esc(line)}':fontsize={size}:fontcolor=white:box=1:boxcolor=black@0.62:boxborderw=18:x=(w-text_w)/2:y={y}:enable='between(t,{s0:.2f},{s1 - 0.05:.2f})'")
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(OUT / 'main-silent.mp4'), '-i', str(OUT / 'vo-aligned.m4a'), '-vf', ','.join(filters + ['format=yuv420p']), '-map', '0:v', '-map', '1:a', *enc, '-c:a', 'copy', str(OUT / 'scene-main-vo.mp4')], check=True)

# 5. End card with silence, then concat.
img = Image.new('RGB', (W, H), (15, 26, 23)); d = ImageDraw.Draw(img)
f1 = ImageFont.truetype(FONT_B, 150 if MODE == 'wide' else 120); f2 = ImageFont.truetype(FONT, 60 if MODE == 'wide' else 54)
cx = (W - d.textlength('LotLedger', font=f1)) / 2; cy = H * 0.36
d.text((cx, cy), 'Lot', font=f1, fill=(248, 240, 220)); d.text((cx + d.textlength('Lot', font=f1), cy), 'Ledger', font=f1, fill=(110, 230, 200))
y = cy + 200
for s_ in ['Batch and lot records for small makers.', 'Free for 30 days. Link in bio.']:
    d.text(((W - d.textlength(s_, font=f2)) / 2, y), s_, font=f2, fill=(200, 210, 205)); y += 90
img.save(OUT / 'endcard.png')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', str(OUT / 'endcard.png'), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf', 'format=yuv420p,loop=-1:1,trim=duration=3.5,fade=t=in:st=0:d=0.4', '-t', '3.5', *enc, '-c:a', 'aac', '-b:a', '160k', str(OUT / 'scene-end-vo.mp4')], check=True)
(OUT / 'concat-final.txt').write_text("file 'scene-main-vo.mp4'\nfile 'scene-end-vo.mp4'\n")
final = OUT / f'lotledger-demo-{MODE}.mp4'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(OUT / 'concat-final.txt'), '-c', 'copy', '-movflags', '+faststart', str(final)], check=True)
print('done', final, f'{t + 3.5:.1f}s')
