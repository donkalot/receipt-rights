const test = require('node:test');
const assert = require('node:assert');
const T = require('../transfer.js');

const backup = { app: 'receipt-rights', version: 1, items: [{ id: 'a', name: 'Kettle — “Breville” ☕', photos: ['data:image/jpeg;base64,' + 'A'.repeat(5000)] }] };

for (const compress of [true, false]) {
  test(`seal/open round-trips (compress=${compress})`, async () => {
    const { key, blob } = await T.seal(backup, { compress });
    assert.equal(key.length, 43);
    assert.deepEqual(await T.open(blob, key), backup);
  });
}

test('the blob does not contain the plaintext', async () => {
  const { blob } = await T.seal(backup, { compress: false });
  assert.ok(!Buffer.from(blob).toString('latin1').includes('receipt-rights'));
});

test('a wrong key or a tampered blob fails to open', async () => {
  const { blob } = await T.seal(backup);
  const other = (await T.seal(backup)).key;
  await assert.rejects(T.open(blob, other));
  const { key, blob: b2 } = await T.seal(backup);
  b2[b2.length - 1] ^= 1;
  await assert.rejects(T.open(b2, key));
});

test('links round-trip and junk is rejected', async () => {
  const id = 'AbCdEfGhIjKlMnOpQrSt_-';
  const { key } = await T.seal({});
  const link = T.makeLink('https://donkalot.github.io/receipt-rights/', id, key);
  assert.deepEqual(T.parseLink(link), { id, key });
  assert.deepEqual(T.parseLink(`  here you go ${link} `), { id, key });
  assert.equal(T.parseLink(link.slice(0, -1)), null);
  assert.equal(T.parseLink(link + 'x'), null);
  assert.equal(T.parseLink('https://donkalot.github.io/receipt-rights/#/settings'), null);
  assert.equal(T.parseLink(''), null);
});
