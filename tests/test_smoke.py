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
