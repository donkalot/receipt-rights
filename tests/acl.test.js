const test = require('node:test');
const assert = require('node:assert');
const ACL = require('../acl.js');

const TODAY = '2026-10-15';
const kettle = { name: 'Breville kettle', store: 'Harvey Norman', price: 129, purchaseDate: '2025-08-01', warrantyMonths: 12, receiptRef: 'INV-1' };
const base = { sellerType: 'business', use: 'personal', faultKinds: ['defect'], stillHaveIt: true, expectedYears: 5, alreadyAsked: 'no', faultDescription: 'It stopped heating.' };
const profile = { name: 'Pat Example', state: 'VIC' };

test('expired warranty is flagged but does not block a claim', () => {
  const r = ACL.assess(kettle, { ...base, stopsNormalUse: true, easilyFixed: 'no' }, TODAY);
  assert.equal(r.covered, true);
  assert.equal(r.warranty.expired, true);
  assert.ok(r.warnings.some(w => w.includes('s 64')));
});

test('dead kettle that cannot easily be fixed is a major failure -> refund', () => {
  const r = ACL.assess(kettle, { ...base, stopsNormalUse: true, easilyFixed: 'no' }, TODAY);
  assert.equal(r.major, true);
  assert.deepEqual(r.majorLimbs.map(l => l.section), ['s 260(1)(c)']);
  assert.equal(r.remedy.kind, 'refund');
  assert.match(r.remedy.ask, /\$129\.00/);
});

test('easily fixable fault is minor: seller gets first go', () => {
  const r = ACL.assess(kettle, { ...base, stopsNormalUse: true, easilyFixed: 'yes' }, TODAY);
  assert.equal(r.major, false);
  assert.equal(r.remedy.kind, 'remedy');
});

test('minor fault the seller refused to fix escalates under s 259(2)(b)', () => {
  const r = ACL.assess(kettle, { ...base, easilyFixed: 'yes', alreadyAsked: 'refused' }, TODAY);
  assert.equal(r.remedy.kind, 'recover_costs');
  assert.equal(r.remedy.basis, 's 259(2)(b)');
});

test('unsafe goods are always major', () => {
  const r = ACL.assess(kettle, { ...base, faultKinds: ['safety'] }, TODAY);
  assert.equal(r.major, true);
  assert.ok(r.majorLimbs.some(l => l.section === 's 260(1)(e)'));
});

test('description limb needs a significant difference', () => {
  const minor = ACL.assess(kettle, { ...base, faultKinds: ['description'] }, TODAY);
  assert.equal(minor.major, false);
  const sig = ACL.assess(kettle, { ...base, faultKinds: ['description'], significantDifference: true }, TODAY);
  assert.ok(sig.majorLimbs.some(l => l.section === 's 260(1)(b)'));
});

test('private sale, auction, resale and pre-2011 purchases are not covered', () => {
  assert.equal(ACL.assess(kettle, { ...base, sellerType: 'private' }, TODAY).covered, false);
  assert.equal(ACL.assess(kettle, { ...base, sellerType: 'auction' }, TODAY).covered, false);
  assert.equal(ACL.assess(kettle, { ...base, boughtForResale: true }, TODAY).covered, false);
  assert.equal(ACL.assess({ ...kettle, purchaseDate: '2010-12-31' }, base, TODAY).covered, false);
});

test('business purchase: covered under $100k, or above it if commonly personal', () => {
  const tractor = { ...kettle, price: 150000 };
  assert.equal(ACL.assess(tractor, { ...base, use: 'business' }, TODAY).covered, false);
  assert.equal(ACL.assess(tractor, { ...base, use: 'business', commonlyPersonal: true }, TODAY).covered, true);
  assert.equal(ACL.assess(kettle, { ...base, use: 'business' }, TODAY).covered, true);
});

test('fault I caused removes acceptable quality but leaves other guarantees', () => {
  const only = ACL.assess(kettle, { ...base, causedByMe: true }, TODAY);
  assert.equal(only.covered, false);
  const mixed = ACL.assess(kettle, { ...base, causedByMe: true, faultKinds: ['defect', 'description'] }, TODAY);
  assert.equal(mixed.covered, true);
  assert.deepEqual(mixed.guarantees.map(g => g.section), ['s 56']);
});

test('defect pointed out before purchase is excluded (s 54(4))', () => {
  const r = ACL.assess(kettle, { ...base, toldBeforeBuying: true }, TODAY);
  assert.equal(r.covered, false);
});

test('past expected lifespan: no rejection, falls back to compensation, weak', () => {
  const r = ACL.assess(kettle, { ...base, expectedYears: 1, stopsNormalUse: true, easilyFixed: 'no' }, TODAY);
  assert.equal(r.canReject, false);
  assert.equal(r.remedy.kind, 'compensation');
  assert.equal(r.strength, 'weak');
});

test('disposed-of goods cannot be rejected', () => {
  const r = ACL.assess(kettle, { ...base, stillHaveIt: false, faultKinds: ['safety'] }, TODAY);
  assert.equal(r.canReject, false);
  assert.equal(r.remedy.kind, 'compensation');
});

test('defect and safety both map to s 54 once', () => {
  const r = ACL.assess(kettle, { ...base, faultKinds: ['defect', 'safety'] }, TODAY);
  assert.deepEqual(r.guarantees.map(g => g.section), ['s 54']);
});

test('no fault kinds selected is not a claim', () => {
  assert.equal(ACL.assess(kettle, { ...base, faultKinds: [] }, TODAY).covered, false);
});

test('letter cites the guarantee, the limb, the remedy, the agency and a 14-day deadline', () => {
  const a = { ...base, stopsNormalUse: true, easilyFixed: 'no', lossDescription: 'spoiled food', lossAmount: 40, hasFaultPhotos: true };
  const r = ACL.assess(kettle, a, TODAY);
  const letter = ACL.buildLetter(kettle, a, r, profile, TODAY);
  assert.match(letter, /To: Harvey Norman/);
  assert.match(letter, /1 August 2025/);
  assert.match(letter, /acceptable quality \(s 54\)/);
  assert.match(letter, /s 260\(1\)\(c\)/);
  assert.match(letter, /full refund of \$129\.00/);
  assert.match(letter, /\$40\.00 for reasonably foreseeable loss/);
  assert.match(letter, /s 64/);
  assert.match(letter, /by 29 October 2026/);
  assert.match(letter, /Consumer Affairs Victoria/);
  assert.match(letter, /Attached: a copy of my proof of purchase and photos of the problem/);
  assert.match(letter, /Pat Example$/);
});

test('letter without a profile still renders a signature placeholder and generic agency', () => {
  const r = ACL.assess(kettle, base, TODAY);
  const letter = ACL.buildLetter(kettle, base, r, {}, TODAY);
  assert.match(letter, /\[Your name\]/);
  assert.match(letter, /state or territory consumer protection agency/);
});

test('date helpers handle month ends and partial months', () => {
  assert.equal(ACL.addMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(ACL.monthsBetween('2025-08-01', '2026-10-15'), 14);
  assert.equal(ACL.monthsBetween('2025-08-20', '2026-10-15'), 13);
  assert.equal(ACL.formatAge(14), '1 year and 2 months');
  assert.equal(ACL.formatAge(0), 'less than a month');
});
