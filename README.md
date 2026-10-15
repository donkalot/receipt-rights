# Receipt Rights

Keep your receipts, and when something breaks, find out what the **Australian Consumer Law** gives
you and get a claim letter that cites it.

Most people stop at "the warranty's expired". Under the ACL, goods must be of acceptable quality —
including durable for as long as a reasonable consumer would expect — and that right can't be
excluded by a warranty period (s 64). The seller is responsible, and can't send you off to the
manufacturer.

## What it does

- **Receipt vault** — item, store, price, date, warranty length, photos or PDFs of the receipt.
  Search, and a warranty status on each one.
- **Claim check** — a short set of questions mapped to the law:
  - which guarantee was breached (s 54 acceptable quality, s 55 fitness for a disclosed purpose,
    s 56 description, s 57 sample)
  - whether it's a **major failure** (each limb of s 260(1), plus s 260(2) for multiple problems)
  - whether you can still reject the goods (s 262 — lifespan, disposal)
  - who's covered at all: private sales, auctions, resale, business purchases over $100k, pre-2011
  - exceptions for damage you caused (s 54(6)) and defects pointed out before sale (s 54(4))
- **Claim letter** — cites the guarantee, the major-failure limb and the remedy section, asks for
  the right thing (refund/replacement for major, repair-first for minor, s 259(2)(b) escalation if
  the seller already refused), claims consequential loss (s 259(4)), sets a 14-day deadline and names
  your state's consumer agency. Editable, then copy, email or print to PDF.
- **Private by design** — everything is stored in the browser (IndexedDB). No account, no server,
  nothing uploaded. Backup and restore to a JSON file.

## Scope and limits

Goods only — not services (s 60–62), which have different guarantees and remedies. It's general
information, not legal advice; "would a reasonable consumer have bought it?" and "how long should it
last?" are judgement calls, and the app takes your answers at face value.

## Stack

- Vanilla JS, no framework, no build step. `acl.js` is the pure legal logic (no DOM); `app.js` is
  the UI.
- PWA: installable, works offline, network-first service worker so logic fixes reach installed users.
- Static hosting (GitHub Pages).

## Tests

```
node --test tests/acl.test.js     # legal logic: coverage, major/minor, remedies, letter
pytest tests/test_smoke.py        # Playwright: add receipt → claim → letter, backup round-trip, XSS
```
