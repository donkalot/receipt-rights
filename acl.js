// Australian Consumer Law (Competition and Consumer Act 2010, Sch 2) — goods only.
// Pure functions, no DOM: loaded as a classic script in the browser, required by node tests.
(function (root) {
  'use strict';

  // s 3(1)(a): $40,000 in the Act, raised to $100,000 by regulation for acquisitions from 1 July 2021.
  const BUSINESS_USE_CAP = 100000;
  const OLD_BUSINESS_USE_CAP = 40000;
  const CAP_RAISED = '2021-07-01';
  const businessUseCap = purchaseDate => (purchaseDate < CAP_RAISED ? OLD_BUSINESS_USE_CAP : BUSINESS_USE_CAP);
  const ACL_START = '2011-01-01';
  const RESPONSE_DAYS = 14;

  const AGENCIES = {
    NSW: { name: 'NSW Fair Trading', url: 'https://www.fairtrading.nsw.gov.au' },
    VIC: { name: 'Consumer Affairs Victoria', url: 'https://www.consumer.vic.gov.au' },
    QLD: { name: 'the Queensland Office of Fair Trading', url: 'https://www.qld.gov.au/law/fair-trading' },
    WA:  { name: 'Consumer Protection WA', url: 'https://www.consumerprotection.wa.gov.au' },
    SA:  { name: 'Consumer and Business Services SA', url: 'https://www.cbs.sa.gov.au' },
    TAS: { name: 'Consumer, Building and Occupational Services Tasmania', url: 'https://www.cbos.tas.gov.au' },
    ACT: { name: 'Access Canberra', url: 'https://www.accesscanberra.act.gov.au' },
    NT:  { name: 'NT Consumer Affairs', url: 'https://consumeraffairs.nt.gov.au' },
  };

  const GUARANTEES = {
    defect:      { section: 's 54', title: 'acceptable quality', text: 'goods must be of acceptable quality: fit for their usual purposes, free from defects, safe and durable' },
    safety:      { section: 's 54', title: 'acceptable quality', text: 'goods must be of acceptable quality, which includes being safe' },
    purpose:     { section: 's 55', title: 'fitness for a disclosed purpose', text: 'goods must be reasonably fit for a purpose the consumer made known to the supplier' },
    description: { section: 's 56', title: 'correspondence with description', text: 'goods must match the description under which they were supplied' },
    sample:      { section: 's 57', title: 'supply by sample or demonstration model', text: 'goods must correspond with the sample or demonstration model' },
  };

  function parseDate(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function isoDate(dt) {
    return dt.toISOString().slice(0, 10);
  }

  function monthsBetween(fromIso, toIso) {
    const a = parseDate(fromIso), b = parseDate(toIso);
    let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    if (b.getUTCDate() < a.getUTCDate()) m -= 1;
    return Math.max(0, m);
  }

  function addDays(iso, n) {
    const d = parseDate(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return isoDate(d);
  }

  function addMonths(iso, n) {
    const d = parseDate(iso);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return isoDate(d);
  }

  function formatDate(iso) {
    return parseDate(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function formatAge(months) {
    if (months < 1) return 'less than a month';
    const y = Math.floor(months / 12), m = months % 12;
    const parts = [];
    if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
    if (m) parts.push(`${m} month${m === 1 ? '' : 's'}`);
    return parts.join(' and ');
  }

  function money(n) {
    return Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  }

  function warrantyStatus(item, today) {
    if (!item.warrantyMonths) return null;
    const ends = addMonths(item.purchaseDate, Number(item.warrantyMonths));
    return { ends, expired: ends < today };
  }

  // Who and what the ACL covers at all, before looking at the fault.
  function coverage(item, a) {
    const reasons = [];
    if (item.purchaseDate < ACL_START) reasons.push('Goods bought before 1 January 2011 are covered by older laws, not the ACL.');
    if (a.sellerType === 'private') reasons.push('Most consumer guarantees do not apply to a one-off private sale by someone not in business (only the guarantee of clear title does).');
    if (a.sellerType === 'auction') reasons.push('Most consumer guarantees do not apply to goods bought at a traditional auction run by an agent for the seller.');
    if (a.boughtForResale) reasons.push('Goods bought to resell, or to use up or transform in production or repair, are not bought "as a consumer".');
    const cap = businessUseCap(item.purchaseDate);
    if (a.use === 'business' && Number(item.price) > cap && !a.commonlyPersonal) {
      reasons.push(`Business purchases made then are only covered if they cost ${money(cap)} or less, or are a kind commonly bought for personal or household use (s 3(1)).`);
    }
    return { covered: reasons.length === 0, reasons };
  }

  function assess(item, a, today) {
    const result = {
      covered: true, reasons: [], guarantees: [], major: false, majorLimbs: [],
      canReject: true, rejectNotes: [], remedy: null, consequential: false,
      ageMonths: monthsBetween(item.purchaseDate, today), warranty: warrantyStatus(item, today),
      warnings: [], strength: 'moderate',
    };

    const cov = coverage(item, a);
    if (!cov.covered) return Object.assign(result, { covered: false, reasons: cov.reasons, strength: 'none' });

    const kinds = new Set(a.faultKinds || []);
    if (kinds.size === 0) {
      return Object.assign(result, { covered: false, strength: 'none', reasons: ['Pick at least one kind of problem so the relevant guarantee can be identified.'] });
    }

    if (a.causedByMe) {
      kinds.delete('defect');
      kinds.delete('safety');
      result.warnings.push('If the fault was caused by misuse, an accident or abnormal use, the acceptable-quality guarantee does not apply to it (s 54(6)).');
    }
    if (a.toldBeforeBuying) {
      kinds.delete('defect');
      result.warnings.push('A defect that was specifically pointed out to you before you bought the goods is not a breach of acceptable quality (s 54(4)).');
    }
    if (kinds.size === 0) {
      return Object.assign(result, { covered: false, strength: 'none', reasons: ['Based on your answers, the problem falls under an exception to the guarantees. Check the notes below.'] });
    }

    const seen = new Set();
    for (const k of ['defect', 'safety', 'purpose', 'description', 'sample']) {
      if (!kinds.has(k)) continue;
      const g = GUARANTEES[k];
      if (seen.has(g.section)) continue;
      seen.add(g.section);
      result.guarantees.push(g);
    }

    const limbs = result.majorLimbs;
    if (a.wouldNotHaveBought) limbs.push({ section: 's 260(1)(a)', text: 'a reasonable consumer fully acquainted with the problem would not have bought the goods' });
    if ((kinds.has('description') || kinds.has('sample')) && a.significantDifference) limbs.push({ section: 's 260(1)(b)', text: 'the goods depart in one or more significant respects from their description, sample or demonstration model' });
    if (kinds.has('defect') && a.stopsNormalUse && a.easilyFixed === 'no') limbs.push({ section: 's 260(1)(c)', text: 'the goods are substantially unfit for their normal purpose and cannot easily, and within a reasonable time, be remedied' });
    if (kinds.has('purpose') && a.easilyFixed === 'no') limbs.push({ section: 's 260(1)(d)', text: 'the goods are unfit for the disclosed purpose and cannot easily, and within a reasonable time, be remedied' });
    if (kinds.has('safety')) limbs.push({ section: 's 260(1)(e)', text: 'the goods are unsafe' });
    result.major = limbs.length > 0;
    if (!result.major && a.multipleProblems) {
      result.warnings.push('Several problems, or a fault that keeps coming back after repair, can together amount to a major failure if a reasonable consumer would not have bought the goods knowing about all of them (s 260(2)). Consider answering "yes" to that question if it fits.');
    }

    const expectedMonths = Number(a.expectedYears) > 0 ? Number(a.expectedYears) * 12 : null;
    if (expectedMonths && result.ageMonths >= expectedMonths) {
      result.canReject = false;
      result.rejectNotes.push('The goods are older than you would reasonably expect them to last, so the right to reject them has probably passed (s 262(1)(a)), and it is harder to argue they were not durable.');
      result.strength = 'weak';
    }
    if (a.stillHaveIt === false) {
      result.canReject = false;
      result.rejectNotes.push('You can no longer reject goods you have lost, thrown away or disposed of (s 262(1)(b)).');
    }

    const asked = a.alreadyAsked || 'no';
    if (result.major) {
      if (result.canReject && a.preferredRemedy !== 'compensation') {
        const choice = a.preferredRemedy === 'replacement' ? 'replacement' : 'refund';
        result.remedy = {
          kind: choice,
          ask: choice === 'refund'
            ? `a full refund of ${money(item.price)}`
            : 'a replacement of the same type and similar value',
          basis: 's 259(3)(a) and s 263',
          explain: 'Because this is a major failure, you choose the remedy — a refund or a replacement — and the seller cannot insist on a repair instead.',
        };
      } else {
        result.remedy = {
          kind: 'compensation',
          ask: 'compensation for the reduction in the value of the goods below the price I paid',
          basis: 's 259(3)(b)',
          explain: 'For a major failure you can keep the goods and claim compensation for the drop in their value.',
        };
      }
      if (result.strength !== 'weak') result.strength = 'strong';
    } else if (asked === 'refused' || asked === 'too_slow') {
      result.remedy = {
        kind: 'recover_costs',
        ask: result.canReject
          ? 'a full refund, as you have failed to remedy the failure within a reasonable time'
          : 'reimbursement of the reasonable cost of having the goods repaired elsewhere',
        basis: 's 259(2)(b)',
        explain: 'The seller has had its chance to fix a minor failure and did not, so you can now reject the goods, or get them fixed elsewhere and recover the reasonable cost.',
      };
      if (result.strength !== 'weak') result.strength = 'strong';
    } else {
      result.remedy = {
        kind: 'remedy',
        ask: 'that you remedy the failure by repairing or replacing the goods, or refunding the price, within a reasonable time',
        basis: 's 259(2)(a) and s 261',
        explain: 'For a minor failure the seller gets the first chance to fix it, and may choose whether to repair, replace or refund.',
      };
    }

    if (a.lossDescription && String(a.lossDescription).trim()) {
      result.consequential = true;
    }

    if (result.warranty && result.warranty.expired) {
      result.warnings.push(`The manufacturer's warranty ended on ${formatDate(result.warranty.ends)}. That does not end your consumer guarantee rights, which cannot be excluded (s 64).`);
    }
    if (!item.receiptRef && !(item.photoCount > 0)) {
      result.warnings.push('Keep proof of purchase handy. A bank or card statement, online order confirmation or warranty card also counts if you have no receipt.');
    }
    return result;
  }

  function buildLetter(item, a, r, profile, today) {
    const agency = AGENCIES[profile.state] || null;
    const deadline = addDays(today, RESPONSE_DAYS);
    const L = [];
    L.push(formatDate(today));
    L.push('');
    L.push(`To: ${item.store || 'the seller'}`);
    L.push('');
    L.push(`Subject: Claim under the Australian Consumer Law — ${item.name}`);
    L.push('');
    L.push('Dear Sir or Madam,');
    L.push('');
    const ref = item.receiptRef ? ` (receipt/order ${item.receiptRef})` : '';
    L.push(`On ${formatDate(item.purchaseDate)} I bought a ${item.name} from you for ${money(item.price)}${ref}.`);
    L.push('');
    L.push(`The problem: ${String(a.faultDescription || '').trim() || 'the goods have failed.'}`);
    L.push('');
    const gs = r.guarantees.map(g => `the guarantee of ${g.title} (${g.section})`);
    L.push(`In my view this is a failure to comply with ${joinList(gs)} under the Australian Consumer Law, Schedule 2 of the Competition and Consumer Act 2010 (Cth).`);
    if (r.major) {
      L.push('');
      L.push(`This is a major failure because ${joinList(r.majorLimbs.map(l => `${l.text} (${l.section})`))}.`);
    }
    if (a.alreadyAsked === 'refused') {
      L.push('');
      L.push('I have already asked you to remedy this and you refused.');
    } else if (a.alreadyAsked === 'too_slow') {
      L.push('');
      L.push('I have already asked you to remedy this and it has not been done within a reasonable time.');
    }
    L.push('');
    L.push(`Under ${r.remedy.basis}, I request ${r.remedy.ask}.`);
    if (r.consequential) {
      const amt = Number(a.lossAmount) > 0 ? ` of ${money(a.lossAmount)}` : '';
      L.push('');
      L.push(`I also claim compensation${amt} for reasonably foreseeable loss caused by the failure (s 259(4)): ${String(a.lossDescription).trim()}.`);
    }
    L.push('');
    let supplier = 'As the supplier, you are responsible for providing this remedy; I am not required to deal with the manufacturer instead (s 259).';
    if (r.warranty && r.warranty.expired) {
      supplier += ' The expiry of any manufacturer\'s warranty does not affect these rights, which cannot be excluded or limited (s 64).';
    }
    L.push(supplier);
    L.push('');
    L.push(`Please respond in writing by ${formatDate(deadline)}.`);
    if (agency) {
      L.push(`If this is not resolved by then, I intend to lodge a complaint with ${agency.name} and may apply to the relevant tribunal.`);
    } else {
      L.push('If this is not resolved by then, I intend to lodge a complaint with my state or territory consumer protection agency and may apply to the relevant tribunal.');
    }
    const attach = [];
    if (item.photoCount > 0 || item.receiptRef) attach.push('a copy of my proof of purchase');
    if (a.hasFaultPhotos) attach.push('photos of the problem');
    if (attach.length) {
      L.push('');
      L.push(`Attached: ${joinList(attach)}.`);
    }
    L.push('');
    L.push('Yours faithfully,');
    L.push('');
    L.push(profile.name || '[Your name]');
    if (profile.contact) L.push(profile.contact);
    return L.join('\n');
  }

  function joinList(xs) {
    if (xs.length <= 1) return xs.join('');
    return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  }

  const api = {
    AGENCIES, GUARANTEES, BUSINESS_USE_CAP, businessUseCap, RESPONSE_DAYS,
    coverage, assess, buildLetter, warrantyStatus,
    monthsBetween, addDays, addMonths, formatDate, formatAge, money,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACL = api;
})(this);
