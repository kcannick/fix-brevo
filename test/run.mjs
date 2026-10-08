// Loads extension/content.js into test/fixture.html with a fake chrome.storage
// and checks sorting behaviour. Run: node test/run.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = 'file://' + path.join(root, 'test/fixture.html');
const script = path.join(root, 'extension/content.js');
const css = path.join(root, 'extension/content.css');

const storageShim = () => {
  const data = JSON.parse(sessionStorage.getItem('shim') || '{}');
  window.chrome = { storage: { local: {
    get: (k, cb) => setTimeout(() => cb({ [k]: data[k] })),
    set: (o) => { Object.assign(data, o); sessionStorage.setItem('shim', JSON.stringify(data)); },
  } } };
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e));

async function load() {
  await page.goto(fixture);
  await page.evaluate(storageShim);
  await page.addStyleTag({ path: css });
  await page.addScriptTag({ path: script });
  await page.waitForSelector('.bs-sort-btn');
}
const col = (sel, i) => page.$$eval(sel, (rows, i) => rows.map((r) => r.children[i].textContent.trim()), i);
const clickSort = async (scope, label) => {
  await page.locator(`${scope} :is(th,[role=columnheader]):has-text("${label}") .bs-sort-btn`).click();
  await page.waitForTimeout(250);
};

await load();
assert.equal(await page.locator('#t thead th:first-child .bs-sort-btn').count(), 0, 'no button on checkbox column');

await clickSort('#t', 'Title');
assert.deepEqual(await col('#t tbody tr', 1), ['alpha list', 'Beta', 'Newsletter 2', 'Newsletter 10']);
await clickSort('#t', 'Title');
assert.deepEqual(await col('#t tbody tr', 1), ['Newsletter 10', 'Newsletter 2', 'Beta', 'alpha list']);
await clickSort('#t', 'Title');
assert.deepEqual(await col('#t tbody tr', 1), ['Newsletter 10', 'alpha list', 'Newsletter 2', 'Beta'], 'third click restores');

await clickSort('#t', 'Folder');
assert.deepEqual(await col('#t tbody tr', 2), ['Archive', 'Marketing', 'Sales', ''], 'empty folder last');
await clickSort('#t', 'Folder');
assert.deepEqual(await col('#t tbody tr', 2), ['Sales', 'Marketing', 'Archive', ''], 'empty folder last (desc)');
assert.equal(await page.getAttribute('#t th:nth-child(3)', 'aria-sort'), 'descending');

await clickSort('#t', 'Contacts');
assert.deepEqual(await col('#t tbody tr', 3), ['7', '15', '300', '1,200'], 'numeric');
await clickSort('#t', 'Created');
assert.deepEqual(await col('#t tbody tr', 4), ['Feb 20, 2023', 'Jan 9, 2024', 'Mar 3, 2025', 'Dec 1, 2025'], 'dates');

// Simulate the app re-rendering the table body: saved sort is re-applied.
await clickSort('#t', 'Folder');
await page.evaluate(() => {
  const tb = document.querySelector('#t tbody');
  tb.insertAdjacentHTML('beforeend', '<tr><td><input type="checkbox"></td><td>New</td><td>Clients</td><td>1</td><td>Jan 1, 2026</td></tr>');
});
await page.waitForTimeout(300);
assert.deepEqual(await col('#t tbody tr', 2), ['Archive', 'Clients', 'Marketing', 'Sales', ''], 're-applied after re-render');

// ARIA grid.
await clickSort('#g', 'Name');
assert.deepEqual(await col('#gbody > [role=row]', 0), ['Alpha', 'eta', 'Zeta']);
await clickSort('#g', 'Folder');
assert.deepEqual(await col('#gbody > [role=row]', 1), ['A', 'B', 'C']);

// Sort is remembered across reloads.
await load();
await page.waitForTimeout(300);
assert.deepEqual(await col('#t tbody tr', 2), ['Archive', 'Marketing', 'Sales', ''], 'remembered after reload');

assert.deepEqual(errors, []);
await browser.close();
console.log('All tests passed');
