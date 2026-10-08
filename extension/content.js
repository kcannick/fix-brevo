// Brevo Sorter — adds click-to-sort buttons to table column headers in the
// Brevo app (e.g. sort contact lists by Folder or by Name/Title).
//
// Brevo's markup isn't documented and changes over time, so this script does
// not depend on specific class names. It recognises two kinds of tables:
//   1. Real <table> elements with a header row (<thead> or a row of <th>).
//   2. ARIA grids: [role=table|grid|treegrid] with [role=columnheader] cells
//      and [role=row] rows containing [role=cell|gridcell].
// The page is watched for changes, so tables rendered later (or re-rendered
// after navigation / pagination) get buttons too, and a remembered sort is
// re-applied automatically.
(() => {
  'use strict';

  const STORAGE_KEY = 'brevoSorter.sorts';
  const BTN_CLASS = 'bs-sort-btn';
  const DIRS = ['asc', 'desc', null]; // click cycle; null = original order

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const originalOrder = new WeakMap(); // row container -> rows as first seen
  let saved = {};

  // ---------------------------------------------------------------- storage

  const storage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  function loadSaved() {
    if (!storage) return Promise.resolve();
    return new Promise((resolve) => {
      storage.get(STORAGE_KEY, (res) => {
        saved = (res && res[STORAGE_KEY]) || {};
        resolve();
      });
    });
  }

  function persist() {
    if (storage) storage.set({ [STORAGE_KEY]: saved });
  }

  // Normalise numeric ids out of the URL so e.g. every folder view shares one
  // remembered sort.
  function pageKey() {
    const route = location.pathname + location.hash.replace(/\?.*$/, '');
    return route.replace(/\/\d+(?=\/|$)/g, '/:id');
  }

  // ------------------------------------------------------------ table model

  function textOf(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  // Returns the cell in a <tr> that sits at logical column `col`, honouring colspan.
  function cellAtColumn(row, col) {
    let pos = 0;
    for (const cell of row.cells) {
      const span = cell.colSpan || 1;
      if (col >= pos && col < pos + span) return span === 1 ? cell : null;
      pos += span;
    }
    return null;
  }

  function htmlTable(table) {
    const headRow =
      (table.tHead && table.tHead.rows[table.tHead.rows.length - 1]) ||
      (table.rows[0] && table.rows[0].cells.length &&
        [...table.rows[0].cells].every((c) => c.tagName === 'TH') ? table.rows[0] : null);
    const body = [...table.tBodies].find((b) => b.rows.length && b.rows[0] !== headRow) || table.tBodies[0];
    if (!headRow || !body) return null;

    let pos = 0;
    const headers = [...headRow.cells].map((cell) => {
      const h = { cell, col: pos };
      pos += cell.colSpan || 1;
      return h;
    });
    return {
      el: table,
      headers,
      body,
      rows: () => [...body.rows].filter((r) => r !== headRow),
      cell: (row, col) => cellAtColumn(row, col),
    };
  }

  function ariaTable(grid) {
    const headerCells = [...grid.querySelectorAll('[role="columnheader"]')]
      .filter((h) => h.closest('[role="table"],[role="grid"],[role="treegrid"]') === grid);
    if (!headerCells.length) return null;

    const dataRows = [...grid.querySelectorAll('[role="row"]')].filter(
      (r) => r.closest('[role="table"],[role="grid"],[role="treegrid"]') === grid &&
        !r.querySelector('[role="columnheader"]'),
    );
    if (!dataRows.length) return null;
    const body = dataRows[0].parentElement;

    const cellsOf = (row) => [...row.children].filter((c) => /^(cell|gridcell|rowheader)$/.test(c.getAttribute('role')));
    return {
      el: grid,
      headers: headerCells.map((cell, col) => ({ cell, col })),
      body,
      rows: () => [...body.children].filter((r) => r.getAttribute('role') === 'row'),
      cell: (row, col) => cellsOf(row)[col] || null,
    };
  }

  function findTables() {
    const tables = [];
    document.querySelectorAll('table').forEach((t) => {
      const model = htmlTable(t);
      if (model) tables.push(model);
    });
    document.querySelectorAll('[role="table"],[role="grid"],[role="treegrid"]').forEach((g) => {
      if (g.tagName === 'TABLE') return;
      const model = ariaTable(g);
      if (model) tables.push(model);
    });
    return tables;
  }

  // --------------------------------------------------------------- sorting

  const NUMBER_RE = /^[-+]?[\d\s,.]*\d[\d\s,.]*%?$/;
  const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  const DATE_RE = new RegExp(
    '^(?:\\d{1,4}[/.-]\\d{1,2}[/.-]\\d{1,4}|' + MONTH + '\\s+\\d{1,2}|\\d{1,2}\\s+' + MONTH + ')', 'i');

  function asNumber(text) {
    return NUMBER_RE.test(text) ? parseFloat(text.replace(/[\s,%]/g, '')) : NaN;
  }

  function asDate(text) {
    return DATE_RE.test(text) ? Date.parse(text) : NaN;
  }

  // Picks one comparison mode for the whole column, so a column is only
  // treated as numeric/dates when every non-empty value qualifies.
  function columnComparer(texts) {
    const values = texts.filter(Boolean);
    for (const parse of [asNumber, asDate]) {
      if (values.length && values.every((t) => !Number.isNaN(parse(t)))) {
        return (a, b) => parse(a) - parse(b);
      }
    }
    return (a, b) => collator.compare(a, b);
  }

  function labelOf(header) {
    return textOf(header.cell); // our button has no text, so this is just the label
  }

  function signature(table) {
    return table.headers.map(labelOf).join('|');
  }

  function storageKey(table) {
    return pageKey() + '::' + signature(table);
  }

  // Computes the desired row order. Rows that have no cell in this column
  // (e.g. "loading" or expanded detail rows spanning the table) keep their
  // place at the end.
  function desiredOrder(table, col, dir) {
    const rows = table.rows();
    if (!dir) {
      const orig = originalOrder.get(table.body) || [];
      const present = new Set(rows);
      const kept = orig.filter((r) => present.has(r));
      const keptSet = new Set(kept);
      return kept.concat(rows.filter((r) => !keptSet.has(r)));
    }
    const sign = dir === 'asc' ? 1 : -1;
    const data = [];
    const other = [];
    rows.forEach((row, i) => {
      const cell = table.cell(row, col);
      if (cell) data.push({ row, i, text: textOf(cell) });
      else other.push(row);
    });
    const compare = columnComparer(data.map((d) => d.text));
    data.sort((a, b) => {
      // Empty values always sink to the bottom, whichever the direction.
      if (!a.text !== !b.text) return a.text ? -1 : 1;
      return sign * compare(a.text, b.text) || a.i - b.i;
    });
    return data.map((d) => d.row).concat(other);
  }

  function applyOrder(table, order) {
    const current = table.rows();
    if (current.length === order.length && current.every((r, i) => r === order[i])) return;
    // Re-insert in order, anchored after whatever precedes the first row so
    // non-row siblings (e.g. a header row living in the same container) stay put.
    const anchor = current[0] ? current[0].previousSibling : null;
    const frag = document.createDocumentFragment();
    order.forEach((r) => frag.appendChild(r));
    table.body.insertBefore(frag, anchor ? anchor.nextSibling : table.body.firstChild);
  }

  function sortTable(table, col, dir) {
    if (!originalOrder.has(table.body)) originalOrder.set(table.body, table.rows());
    applyOrder(table, desiredOrder(table, col, dir));
  }

  // ------------------------------------------------------------------- UI

  function updateButtons(table, activeCol, dir) {
    table.headers.forEach((h) => {
      const btn = h.cell.querySelector(':scope .' + BTN_CLASS);
      if (!btn) return;
      const active = h.col === activeCol && dir;
      if (active) btn.dataset.dir = dir;
      else delete btn.dataset.dir;
      h.cell.setAttribute('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
  }

  function onButtonClick(event) {
    const btn = event.target.closest('.' + BTN_CLASS);
    if (!btn) return;
    // Keep Brevo's own header handlers from firing.
    event.preventDefault();
    event.stopPropagation();

    const table = findTables().find((t) => t.headers.some((h) => h.cell.contains(btn)));
    if (!table) return;
    const header = table.headers.find((h) => h.cell.contains(btn));
    const key = storageKey(table);
    const state = saved[key];
    const current = state && state.label === labelOf(header) ? state.dir : null;
    const next = DIRS[(DIRS.indexOf(current) + 1) % DIRS.length];

    if (next) saved[key] = { label: labelOf(header), dir: next };
    else delete saved[key];
    persist();

    sortTable(table, header.col, next);
    updateButtons(table, header.col, next);
  }

  function isSortableHeader(header) {
    const label = labelOf(header);
    if (!label) return false; // checkbox / action columns
    if (header.cell.querySelector('input[type="checkbox"]')) return false;
    return true;
  }

  function enhance(table) {
    table.headers.forEach((h) => {
      if (!isSortableHeader(h) || h.cell.querySelector(':scope .' + BTN_CLASS)) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = BTN_CLASS;
      const label = labelOf(h);
      btn.title = `Sort by ${label} (rows loaded on this page)`;
      btn.setAttribute('aria-label', `Sort by ${label}`);
      // Put the button next to the label text if there's an inner wrapper.
      const target = h.cell.querySelector(':scope > div, :scope > span') || h.cell;
      target.appendChild(btn);
    });

    const state = saved[storageKey(table)];
    const header = state && table.headers.find((h) => labelOf(h) === state.label);
    if (header) {
      sortTable(table, header.col, state.dir);
      updateButtons(table, header.col, state.dir);
    } else {
      updateButtons(table, -1, null);
    }
  }

  // ----------------------------------------------------------------- boot

  let scheduled = false;
  function scan() {
    scheduled = false;
    observer.disconnect();
    try {
      findTables().forEach(enhance);
    } finally {
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
  }

  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 150);
  });

  document.addEventListener('click', onButtonClick, true);
  loadSaved().then(scan);
})();
