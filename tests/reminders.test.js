const test = require('node:test');
const assert = require('node:assert');
const R = require('../reminders.js');

const TODAY = '2026-10-15';
const item = { id: 'abc', name: 'Breville kettle', store: 'JB Hi-Fi', price: 129, purchaseDate: '2026-03-10', warrantyMonths: 12, category: 'small_appliance' };

test('warranty reminder 14 days before it ends, lifespan reminder 30 days before', () => {
  const ev = R.remindersFor(item, { today: TODAY, categoryYears: 3 });
  assert.deepEqual(ev.map(e => [e.uid, e.date]), [['abc-warranty', '2027-02-24'], ['abc-lifespan', '2029-02-08']]);
  assert.match(ev[0].summary, /ends 10 March 2027/);
});

test('past dates are dropped', () => {
  const old = { ...item, purchaseDate: '2023-01-01' };
  const ev = R.remindersFor(old, { today: TODAY, categoryYears: 3 });
  assert.deepEqual(ev, []);
});

test("the user's own lifespan estimate from a claim beats the category default", () => {
  const withClaim = { ...item, warrantyMonths: 0, claim: { answers: { expectedYears: '5' } } };
  const ev = R.remindersFor(withClaim, { today: TODAY, categoryYears: 3 });
  assert.deepEqual(ev.map(e => e.date), ['2031-02-08']);
  assert.match(ev[0].description, /about 5 years/);
});

test('no warranty and no lifespan gives no reminders', () => {
  assert.deepEqual(R.remindersFor({ ...item, warrantyMonths: '' }, { today: TODAY, categoryYears: '' }), []);
});

test('ics is valid: CRLF, all-day events, escaped text, folded lines', () => {
  const tricky = { ...item, name: 'Kettle, 1.7L; "steel"\\x' };
  const ics = R.buildIcs(R.remindersFor(tricky, { today: TODAY, categoryYears: 3, url: 'https://x.test/#/item/abc' }), new Date('2026-10-15T01:02:03.456Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'bare LF found');
  assert.match(ics, /DTSTAMP:20261015T010203Z\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270224\r\nDTEND;VALUE=DATE:20270225\r\n/);
  assert.match(ics, /SUMMARY:Warranty on Kettle\\, 1\.7L\\; "steel"\\\\x ends/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /\\n\\nhttps:\/\/x\.test\/#\/item\/abc/);
});

test('folding never splits a multi-byte character', () => {
  const emoji = { ...item, name: 'Café ☕ machine '.repeat(8) };
  const ics = R.buildIcs(R.remindersFor(emoji, { today: TODAY, categoryYears: 3 }), new Date());
  assert.ok(!ics.includes('�'));
  assert.ok(ics.replace(/\r\n /g, '').includes('Café ☕ machine Café'));
});
