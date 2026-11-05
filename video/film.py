"""Film the LotLedger demo with Playwright. Usage: python3 film.py <email> <wide|tall> [--frames]
--frames writes still JPEGs of the key moments instead of a video (preview pass)."""
import sys, time, json, os, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

EMAIL, MODE = sys.argv[1], sys.argv[2]
FRAMES = '--frames' in sys.argv
PW = 'demo-password-123'
BASE = 'http://localhost:8788'
OUT = Path(f'/home/claude/lotledger/video/out/{MODE}'); OUT.mkdir(parents=True, exist_ok=True)
if MODE == 'wide':
    VIEW = dict(width=1920, height=1080); SCALE = 1
else:
    VIEW = dict(width=1080, height=1920); SCALE = 1   # phone layout via CSS zoom 2

marks = []  # (t, label) timeline of what is on screen, for captions
T0 = None
def mark(label):
    marks.append((round(time.time() - T0, 2), label)); print(f'{marks[-1][0]:6.2f}  {label}')

def shot(page, name):
    if FRAMES: page.screenshot(path=str(OUT / f'frame-{name}.jpg'), type='jpeg', quality=92)

def hold(page, s):
    page.wait_for_timeout(int(s * 1000))

def slow_type(el, text, delay=55):
    el.click(); el.type(text, delay=delay)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx_kwargs = dict(viewport=VIEW, device_scale_factor=SCALE, color_scheme='dark')
    if not FRAMES:
        ctx_kwargs.update(record_video_dir=str(OUT / 'raw'), record_video_size=dict(width=VIEW['width'] * SCALE, height=VIEW['height'] * SCALE))
    ctx = b.new_context(**ctx_kwargs)
    T0 = time.time()
    page = ctx.new_page()
    page.goto(f'{BASE}/app/')
    if MODE == 'wide': page.add_style_tag(content='dialog#dlg{margin-top:14px}')
    else: page.add_style_tag(content='html{zoom:1.75} dialog#dlg{margin-top:16px} .item{grid-template-columns:1fr} .item .actions{justify-content:flex-start} .acct{display:none}')
    mark('signin'); hold(page, 1.2); shot(page, '01-signin')
    slow_type(page.locator('input[name=email]'), EMAIL.split('@')[0][:4] + '@fourwaters.example', 25)
    slow_type(page.locator('input[name=password]'), 'password-not-shown', 25)
    # sign in for real behind the typed decoy
    page.evaluate("""([e,p]) => { const f=document.querySelector('#auth-form'); f.email.value=e; f.password.value=p; }""", [EMAIL, PW])
    page.click('#auth-form button.primary')
    page.wait_for_selector('#view-lots:not([hidden])')
    mark('lots'); hold(page, 2.6); shot(page, '02-lots')

    # Log a batch
    page.click('#btn-new-lot'); hold(page, 0.6); mark('newlot'); shot(page, '03-newlot')
    dlg = page.locator('#dlg')
    dlg.locator('select[name=product_id]').select_option(label='Fresh Milled Flour'); hold(page, 0.4)
    slow_type(dlg.locator('input[name=units_made]'), '24'); hold(page, 0.3)
    slow_type(dlg.locator('input[name=unit_size]'), '2 lb'); hold(page, 0.3)
    slow_type(dlg.locator('input[name=supplier]'), "Janie's Mill", 40); hold(page, 0.3)
    slow_type(dlg.locator('textarea[name=inputs]'), '50 lb organic hard red wheat, mill lot 2251', 28); hold(page, 0.5)
    shot(page, '04-newlot-filled')
    dlg.locator('button.primary').click()
    page.wait_for_selector('#toast:not([hidden])')
    NEWCODE = page.locator('#toast').inner_text().replace('Logged ','').strip()
    mark('logged'); hold(page, 2.6); shot(page, '05-logged')

    # Record units out on the new lot
    page.locator('.item', has_text=NEWCODE).locator('[data-move]').click(); hold(page, 0.6); mark('unitsout'); shot(page, '06-unitsout')
    dlg.locator('select[name=kind]').select_option('sale'); hold(page, 0.3)
    slow_type(dlg.locator('input[name=units]'), '3'); hold(page, 0.3)
    slow_type(dlg.locator('input[name=note]'), '#1044', 50); hold(page, 0.5)
    dlg.locator('button.primary').click(); page.wait_for_timeout(500)
    mark('recorded'); hold(page, 2.4); shot(page, '07-recorded')

    # Details: the lot's own history
    page.locator('.item', has_text=NEWCODE).locator('[data-open]').click(); hold(page, 0.6); mark('details'); shot(page, '08-details')
    hold(page, 2.6)
    page.keyboard.press('Escape'); hold(page, 0.4)

    # Ship view and Pirate Ship export
    page.click('nav button[data-view=orders]'); page.wait_for_selector('#view-orders:not([hidden])')
    mark('ship'); hold(page, 2.4); shot(page, '09-ship')
    with page.expect_download() as dl:
        page.click('#btn-pirate')
    d = dl.value; d.save_as(str(OUT / 'pirateship.csv'))
    mark('exported'); hold(page, 2.6); shot(page, '10-exported')

    # Account: plan and lot numbering
    page.click('nav button[data-view=account]'); page.wait_for_selector('#view-account:not([hidden])')
    mark('account'); hold(page, 2.6); shot(page, '11-account')
    mark('end'); hold(page, 0.3)
    ctx.close(); b.close()

if not FRAMES:
    raw = list((OUT / 'raw').glob('*.webm'))[0]
    shutil.move(str(raw), str(OUT / 'raw.webm'))
(OUT / 'marks.json').write_text(json.dumps(marks))
