# Brevo Sorter

A Chrome extension that makes tables in the [Brevo](https://app.brevo.com) web app sortable,
so you can sort lists by **Folder**, **Title/Name**, or any other column.

## What it does

- Adds a small **⇅** button next to each column header in Brevo tables.
- Click to cycle: **▲ ascending → ▼ descending → original order**.
- Sorting is smart about values: text sorts naturally (`List 2` comes before `List 10`, not case-sensitive),
  number columns sort numerically, and date columns sort by date. Empty cells (e.g. lists with no folder) always go last.
- Your choice is **remembered** per page, and re-applied when Brevo re-renders the table
  (after a refresh, filtering, or moving to another page of results).

> **Note:** Brevo loads lists one page at a time, so the extension sorts the rows currently shown.
> To sort everything at once, set Brevo's "rows per page" to its maximum first.

## Install (unpacked)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `extension/` folder.
5. Open or reload Brevo, go to **Contacts → Lists**, and click the ⇅ next to **Folder** or **Name**.

It works in other Chromium browsers too (Edge, Brave, Arc).

## How it works

`extension/content.js` runs only on `*.brevo.com` (and the old `*.sendinblue.com`) pages. It doesn't rely on
Brevo's internal class names; it finds any `<table>` with a header row, or any ARIA grid
(`role="grid"` / `role="table"` with `role="columnheader"`), and adds the sort buttons to it. It needs only
the `storage` permission (to remember your sort) — it sends no data anywhere.

## Development

```sh
npm install   # installs Playwright for the tests
npm test      # runs the sorter against test/fixture.html in headless Chromium
```
