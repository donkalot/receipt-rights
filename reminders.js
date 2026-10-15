// Calendar reminders as an .ics file — no server, no push, the user's own calendar does the nagging.
(function (root) {
  'use strict';

  const ACL = root.ACL || require('./acl.js');
  const WARRANTY_LEAD_DAYS = 14;
  const LIFESPAN_LEAD_DAYS = 30;

  function lifespanYears(item, categoryYears) {
    const own = item.claim && Number(item.claim.answers && item.claim.answers.expectedYears);
    return own || Number(categoryYears) || 0;
  }

  // Only future dates: a reminder for something already past is noise.
  function remindersFor(item, { today, categoryYears, url }) {
    const out = [];
    const link = url ? `\n\n${url}` : '';
    const w = ACL.warrantyStatus(item, today);
    if (w) {
      const on = ACL.addDays(w.ends, -WARRANTY_LEAD_DAYS);
      if (on >= today) out.push({
        uid: `${item.id}-warranty`, date: on,
        summary: `Warranty on ${item.name} ends ${ACL.formatDate(w.ends)}`,
        description: `The manufacturer's warranty on ${item.name} (${item.store || 'unknown store'}) ends on ${ACL.formatDate(w.ends)}. ` +
          'Check it still works properly. After that date your Australian Consumer Law rights continue, so keep the receipt.' + link,
      });
    }
    const years = lifespanYears(item, categoryYears);
    if (years) {
      const ends = ACL.addMonths(item.purchaseDate, Math.round(years * 12));
      const on = ACL.addDays(ends, -LIFESPAN_LEAD_DAYS);
      if (on >= today) out.push({
        uid: `${item.id}-lifespan`, date: on,
        summary: `${item.name} nears its expected lifespan`,
        description: `You expected ${item.name} to last about ${years} year${years === 1 ? '' : 's'}, until around ${ACL.formatDate(ends)}. ` +
          'If it has a fault, raise it with the seller before then: goods must be durable for as long as a reasonable consumer would expect.' + link,
      });
    }
    return out;
  }

  function escText(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  // RFC 5545: lines over 75 octets are folded with CRLF + space; don't split a UTF-8 sequence.
  function fold(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const parts = [];
    let start = 0, limit = 75;
    while (start < bytes.length) {
      let end = Math.min(start + limit, bytes.length);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      parts.push(new TextDecoder().decode(bytes.slice(start, end)));
      start = end;
      limit = 74;
    }
    return parts.join('\r\n ');
  }

  const compact = iso => iso.replace(/-/g, '');

  function buildIcs(events, now) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Receipt Rights//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const e of events) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.uid}@receipt-rights`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compact(e.date)}`,
        `DTEND;VALUE=DATE:${compact(ACL.addDays(e.date, 1))}`,
        `SUMMARY:${escText(e.summary)}`,
        `DESCRIPTION:${escText(e.description)}`,
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(e.summary)}`, 'TRIGGER;RELATED=START:PT9H', 'END:VALARM',
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  const api = { remindersFor, buildIcs, WARRANTY_LEAD_DAYS, LIFESPAN_LEAD_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Reminders = api;
})(typeof window !== 'undefined' ? window : globalThis);
