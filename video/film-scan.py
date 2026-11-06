"""Film the scan scene on its own. Usage: python3 film-scan.py <email> <wide|tall>
Chromium gets a fake camera that plays a QR for one of the demo lots, so the
scene shows the camera view, the QR landing, and the lot opening. Writes
video/out/<mode>/scan.webm and scan-marks.json."""
import sys, time, json, shutil, subprocess
from pathlib import Path
import qrcode
from PIL import Image
from playwright.sync_api import sync_playwright

EMAIL, MODE = sys.argv[1], sys.argv[2]
PW = 'demo-password-123'
BASE = 'http://localhost:8788'
CODE = 'FW-102'
OUT = Path(f'/home/claude/lotledger/video/out/{MODE}'); OUT.mkdir(parents=True, exist_ok=True)
VIEW = dict(width=1920, height=1080) if MODE == 'wide' else dict(width=1080, height=1920)

# Fake camera feed: a QR label held in front of a dark table, 640x480 mjpeg, 2 seconds.
cam = OUT / 'cam.mjpeg'
qr = qrcode.make(f'{BASE}/app/#lot={CODE}').convert('RGB').resize((300, 300))
frame = Image.new('RGB', (640, 480), (62, 54, 48))
frame.paste(qr, (170, 90))
frames_dir = OUT / 'camframes'; frames_dir.mkdir(exist_ok=True)
for i in range(60):
    frame.save(frames_dir / f'f{i:03d}.jpg', quality=85)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', str(frames_dir / 'f%03d.jpg'), '-c:v', 'mjpeg', '-q:v', '3', str(cam)], check=True)

marks = []; T0 = None
def mark(l): marks.append((round(time.time() - T0, 2), l)); print(f'{marks[-1][0]:6.2f}  {l}')
def hold(page, s): page.wait_for_timeout(int(s * 1000))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={cam}', '--use-fake-ui-for-media-stream'])
    ctx = b.new_context(viewport=VIEW, color_scheme='dark', permissions=['camera'],
                        record_video_dir=str(OUT / 'rawscan'), record_video_size=VIEW)
    T0 = time.time()
    page = ctx.new_page()
    page.goto(f'{BASE}/app/')
    if MODE == 'wide': page.add_style_tag(content='dialog#dlg{margin-top:14px}')
    else: page.add_style_tag(content='html{zoom:1.75} dialog#dlg{margin-top:16px} .item{grid-template-columns:1fr} .item .actions{justify-content:flex-start} .acct{display:none}')
    page.evaluate("""([e,p]) => { const f=document.querySelector('#auth-form'); f.email.value=e; f.password.value=p; }""", [EMAIL, PW])
    page.click('#auth-form button.primary')
    page.wait_for_selector('#view-lots:not([hidden])')
    page.click('nav button[data-view=scan]'); page.wait_for_selector('#view-scan:not([hidden])')
    mark('scan'); hold(page, 1.0)
    page.click('#btn-scan-toggle')
    page.wait_for_selector('#view-scan video', state='visible')
    mark('camera')
    # wait for the lot to be found and the details to open
    page.wait_for_selector('#scan-result .item', timeout=15000)
    mark('found'); hold(page, 1.8)
    page.click('#scan-open'); page.wait_for_selector('#dlg[open]')
    mark('details'); hold(page, 2.2)
    mark('end'); hold(page, 0.2)
    ctx.close(); b.close()

raw = list((OUT / 'rawscan').glob('*.webm'))[0]
shutil.move(str(raw), str(OUT / 'scan.webm'))
shutil.rmtree(OUT / 'rawscan', ignore_errors=True)
(OUT / 'scan-marks.json').write_text(json.dumps(marks))
print('done', OUT / 'scan.webm')
