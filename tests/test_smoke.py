"""End-to-end smoke test: add a receipt with a photo, run a claim, check the letter.

Run locally: pytest tests/test_smoke.py
"""
import base64
import http.server
import pathlib
import socketserver
import threading
import time

import pytest
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8766
URL = f'http://localhost:{PORT}/index.html'
# 1x1 PNG
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')


@pytest.fixture(scope='module')
def server():
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=str(ROOT), **kw)
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    yield URL
    httpd.shutdown()


@pytest.fixture(scope='module')
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={'width': 420, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page()
    pg.errors = []
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    pg.on('console', lambda m: pg.errors.append(m.text) if m.type == 'error' else None)
    yield pg
    ctx.close()


def add_kettle(page, server):
    page.goto(server)
    page.get_by_role('link', name="Something's broken now").click()
    page.fill('#name', 'Breville kettle')
    page.fill('#store', 'Harvey Norman Geelong')
    page.fill('#price', '129')
    page.fill('#purchaseDate', '2025-08-01')
    page.select_option('#category', 'small_appliance')
    page.fill('#warrantyMonths', '12')
    page.set_input_files('#files', files=[{'name': 'receipt.png', 'mimeType': 'image/png', 'buffer': PNG}])
    expect(page.locator('#photos img')).to_have_count(1)
    page.get_by_role('button', name='Next: the problem').click()
    page.wait_for_selector('text=What\'s wrong with your Breville kettle?')


def test_full_claim_flow_produces_major_failure_letter(page, server):
    add_kettle(page, server)
    page.get_by_label('It broke, stopped working').check()
    page.fill('#faultDescription', 'It stopped heating after 14 months.')
    page.get_by_label("It can't do its normal job any more").check()
    page.get_by_label('No — not easily').check()
    page.get_by_role('button', name='Check my rights').click()

    expect(page.locator('.verdict h3').first).to_have_text('You have a strong claim')
    expect(page.locator('.verdict')).to_contain_text("The manufacturer's warranty ended on 1 August 2026")
    letter = page.locator('#letter').inner_text()
    for needle in ['To: Harvey Norman Geelong', '1 August 2025', 'acceptable quality (s 54)',
                   's 260(1)(c)', 'full refund of $129.00', 's 64', '[Your name]']:
        assert needle in letter, f'{needle!r} missing from letter:\n{letter}'

    page.get_by_role('button', name='Copy letter').click()
    expect(page.locator('.toast')).to_have_text('Letter copied')
    assert 's 260(1)(c)' in page.evaluate('navigator.clipboard.readText()')
    assert not page.errors, page.errors


def test_profile_signs_letter_and_names_agency(page, server):
    add_kettle(page, server)
    page.get_by_label("It's unsafe").check()
    page.get_by_role('button', name='Check my rights').click()
    page.get_by_role('link', name='Add details').click()
    page.fill('#pname', 'Pat Example')
    page.select_option('#pstate', 'VIC')
    page.get_by_role('button', name='Save').click()
    expect(page.locator('#letter')).to_contain_text('Pat Example')
    expect(page.locator('#letter')).to_contain_text('Consumer Affairs Victoria')
    expect(page.locator('#letter')).to_contain_text('s 260(1)(e)')
    assert not page.errors, page.errors


def test_private_sale_is_not_covered_and_has_no_letter(page, server):
    add_kettle(page, server)
    page.get_by_label('It broke, stopped working').check()
    page.get_by_label('A private person').check()
    page.get_by_role('button', name='Check my rights').click()
    expect(page.locator('.verdict h3').first).to_have_text("This probably isn't covered")
    expect(page.locator('#letter')).to_have_count(0)


def test_claim_requires_a_fault_kind(page, server):
    add_kettle(page, server)
    page.get_by_role('button', name='Check my rights').click()
    expect(page.locator('#err')).to_have_text('Tick at least one kind of problem at the top.')


def test_receipts_persist_and_backup_round_trips(page, server, tmp_path):
    add_kettle(page, server)
    page.goto(server)
    expect(page.locator('.item .name')).to_have_text(['Breville kettle'])
    page.reload()
    expect(page.locator('.item .name')).to_have_text(['Breville kettle'])

    page.goto(server + '#/settings')
    with page.expect_download() as dl:
        page.get_by_role('button', name='Download backup').click()
    backup = tmp_path / 'backup.json'
    dl.value.save_as(backup)

    page.once('dialog', lambda d: d.accept())
    page.get_by_role('button', name='Delete all receipts and details').click()
    expect(page.get_by_role('link', name='Add a receipt')).to_be_visible()

    page.goto(server + '#/settings')
    page.set_input_files('#import', str(backup))
    expect(page.locator('.item .name')).to_have_text(['Breville kettle'])
    src = page.locator('.item img.thumb').get_attribute('src')
    assert src.startswith('data:image/jpeg;base64,'), 'receipt photo lost in backup round-trip'
    assert not page.errors, page.errors


def test_html_is_escaped(page, server):
    page.goto(server + '#/item/new')
    page.fill('#name', '<img src=x onerror=alert(1)>')
    page.fill('#price', '10')
    page.get_by_role('button', name='Save').click()
    expect(page.locator('h2')).to_have_text('<img src=x onerror=alert(1)>')
    assert page.locator('main img[src="x"]').count() == 0


def test_calendar_reminders_download(page, server):
    import datetime
    page.goto(server + '#/item/new')
    page.fill('#name', 'Dyson vacuum')
    page.fill('#price', '899')
    page.fill('#purchaseDate', datetime.date.today().isoformat())
    page.select_option('#category', 'small_appliance')
    page.fill('#warrantyMonths', '24')
    page.get_by_role('button', name='Save').click()
    expect(page.locator('#offer')).to_contain_text('before the warranty ends')
    page.get_by_role('button', name='No thanks').click()
    expect(page.locator('#offer')).to_have_count(0)
    assert page.url.endswith('#/item/' + page.url.split('#/item/')[1].split('?')[0])
    page.reload()
    expect(page.locator('#offer')).to_have_count(0)
    with page.expect_download() as dl:
        page.get_by_role('button', name='Add reminders to calendar').click()
    assert dl.value.suggested_filename == 'dyson-vacuum-reminders.ics'
    ics = open(dl.value.path(), encoding='utf-8', newline='').read()
    assert ics.count('BEGIN:VEVENT') == 2
    assert 'SUMMARY:Warranty on Dyson vacuum ends' in ics
    assert '#/item/' in ics.replace('\r\n ', '')

    page.goto(server + '#/settings')
    with page.expect_download() as dl:
        page.get_by_role('button', name='Download reminders for all receipts').click()
    assert dl.value.suggested_filename == 'receipt-rights-reminders.ics'
    assert page.errors == []


RELAY = 'https://receipt-rights-relay.donkalot.workers.dev'


def stub_relay(ctx, store):
    """In-memory stand-in for worker/index.js, so the browser-side crypto and flow run for real."""
    cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type'}

    def handle(route):
        req = route.request
        path = req.url[len(RELAY):]
        if req.method == 'OPTIONS':
            return route.fulfill(status=204, headers=cors)
        if req.method == 'POST' and path == '/t':
            blob_id = f'{len(store):022d}'
            store[blob_id] = req.post_data_buffer
            return route.fulfill(status=201, headers=cors, json={'id': blob_id, 'expiresAt': '2030-01-01T00:00:00Z'})
        blob_id = path.removeprefix('/t/')
        if req.method == 'DELETE':
            store.pop(blob_id, None)
            return route.fulfill(status=204, headers=cors)
        if blob_id in store:
            return route.fulfill(status=200, headers=cors, body=store[blob_id], content_type='application/octet-stream')
        return route.fulfill(status=404, headers=cors, json={'error': 'not found'})

    ctx.route(RELAY + '/**', handle)


def test_move_to_another_device(browser, server):
    store = {}
    devices = []
    for _ in range(2):
        ctx = browser.new_context(viewport={'width': 420, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
        stub_relay(ctx, store)
        pg = ctx.new_page()
        pg.errors = []
        pg.on('pageerror', lambda e, pg=pg: pg.errors.append(str(e)))
        devices.append((ctx, pg))
    (_, laptop), (_, phone) = devices
    try:
        add_kettle(laptop, server)
        laptop.goto(server + '#/settings')
        laptop.get_by_role('button', name='Make a transfer link').click()
        expect(laptop.locator('#qr svg')).to_be_visible()
        link = laptop.locator('#link').input_value()
        assert '#/receive/' in link
        assert len(store) == 1
        blob = next(iter(store.values()))
        assert b'Breville' not in blob and b'Harvey' not in blob, 'relay saw plaintext'
        assert link.split('#')[1].split('.')[1] not in laptop.evaluate('JSON.stringify(performance.getEntries().map(e => e.name))'), \
            'key reached a request URL'

        phone.goto(server)
        expect(phone.get_by_role('link', name='Move your receipts here')).to_be_visible()
        phone.goto(link)
        expect(phone.locator('h2')).to_have_text('1 receipt ready to add')
        assert '#/receive' in phone.url and '.' not in phone.url.split('#/receive')[1], 'key left in address bar'
        phone.get_by_role('button', name='Add them').click()
        expect(phone.locator('.item .name')).to_have_text(['Breville kettle'])
        assert phone.locator('.item img.thumb').get_attribute('src').startswith('data:image/jpeg;base64,')
        expect(phone.locator('.toast')).to_have_text('Added 1 receipt')
        assert not store, 'blob not deleted after use'

        phone.goto(server + '#/settings')
        phone.fill('#paste', link)
        phone.get_by_role('button', name='Receive').click()
        expect(phone.locator('main')).to_contain_text('expired or has already been used')

        phone.goto(server + '#/settings')
        phone.fill('#paste', 'https://example.com/nope')
        phone.get_by_role('button', name='Receive').click()
        expect(phone.locator('.toast').last).to_have_text("That doesn't look like a transfer link")

        laptop.reload()
        laptop.get_by_role('button', name='Make a transfer link').click()
        expect(laptop.locator('#link')).to_be_visible()
        assert len(store) == 1
        laptop.get_by_role('button', name='Delete it now').click()
        expect(laptop.locator('#send-out')).to_contain_text('Deleted')
        assert not store
        assert not laptop.errors and not phone.errors, laptop.errors + phone.errors
    finally:
        for ctx, _ in devices:
            ctx.close()
