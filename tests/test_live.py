"""Checks the deployed site, transfer relay and analytics for real.

Needs a network that doesn't block workers.dev or goatcounter.com, so the "Live check" workflow
runs it on GitHub: pytest tests/test_live.py
"""
import os
import time

import pytest
from playwright.sync_api import sync_playwright, expect

from test_smoke import add_kettle

SITE = os.environ.get('LIVE_URL', 'https://donkalot.github.io/receipt-rights/')
APP_ORIGIN = 'https://donkalot.github.io'
RELAY = 'https://receipt-rights-relay.donkalot.workers.dev'


@pytest.fixture(scope='module')
def pw():
    with sync_playwright() as p:
        yield p


def watch_errors(pg):
    pg.errors = []
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    return pg


def test_transfer_from_laptop_chrome_to_iphone_safari(pw):
    chromium, webkit = pw.chromium.launch(), pw.webkit.launch()
    try:
        laptop = watch_errors(chromium.new_context(viewport={'width': 1200, 'height': 900}).new_page())
        phone = watch_errors(webkit.new_context(**pw.devices['iPhone 13']).new_page())
        laptop_urls = []
        laptop.on('request', lambda r: laptop_urls.append(r.url))

        add_kettle(laptop, SITE)
        laptop.goto(SITE + '#/settings')
        with laptop.expect_response(lambda r: r.url == RELAY + '/t' and r.request.method == 'POST') as posted:
            laptop.get_by_role('button', name='Make a transfer link').click()
        assert posted.value.status == 201, posted.value.text()
        expect(laptop.locator('#qr svg')).to_be_visible()
        link = laptop.locator('#link').input_value()
        assert link.startswith(SITE + '#/receive/'), link
        blob_id, key = link.split('/receive/')[1].split('.')
        assert not any(key in u for u in laptop_urls), 'key was sent in a request'

        phone.goto(link)
        expect(phone.locator('h2')).to_have_text('1 receipt ready to add')
        assert key not in phone.url, 'key left in the address bar'
        expect(phone.get_by_role('button', name='Add them to Safari')).to_be_visible()
        with phone.expect_response(lambda r: r.url == f'{RELAY}/t/{blob_id}' and r.request.method == 'DELETE') as deleted:
            phone.get_by_role('button', name='Add them').click()
        assert deleted.value.status == 204
        expect(phone.locator('.item .name')).to_have_text(['Breville kettle'])
        assert phone.locator('.item img.thumb').get_attribute('src').startswith('data:image/jpeg;base64,'), 'photo lost'

        # KV deletes are eventually consistent, so allow for edge caching.
        api = pw.request.new_context(extra_http_headers={'Origin': APP_ORIGIN})
        for _ in range(24):
            if api.get(f'{RELAY}/t/{blob_id}').status == 404:
                break
            time.sleep(5)
        else:
            pytest.fail('used transfer still downloadable after 2 minutes')
        assert not laptop.errors and not phone.errors, laptop.errors + phone.errors
    finally:
        chromium.close()
        webkit.close()


def test_relay_only_serves_the_app(pw):
    api = pw.request.new_context()
    assert api.post(RELAY + '/t', data=b'x', headers={'Origin': 'https://evil.example'}).status == 403
    assert api.post(RELAY + '/t', data=b'x').status == 403
    pre = api.fetch(RELAY + '/t', method='OPTIONS', headers={'Origin': APP_ORIGIN, 'Access-Control-Request-Method': 'POST'})
    assert pre.status == 204
    assert pre.headers['access-control-allow-origin'] == APP_ORIGIN


def test_iphone_gets_take_photo(pw):
    webkit = pw.webkit.launch()
    try:
        pg = webkit.new_context(**pw.devices['iPhone 13']).new_page()
        pg.goto(SITE + '#/item/new')
        expect(pg.locator('label:has(#camera)')).to_have_text('Take photo')
        assert pg.locator('#camera').get_attribute('capture') == 'environment'
    finally:
        webkit.close()


def test_goatcounter_receives_visits(pw):
    b = pw.chromium.launch()
    try:
        pg = b.new_page()
        with pg.expect_response(lambda r: r.url.startswith('https://receipt-rights.goatcounter.com/count'), timeout=20000) as hit:
            pg.goto(SITE)
        assert hit.value.ok, hit.value.status
    finally:
        b.close()
