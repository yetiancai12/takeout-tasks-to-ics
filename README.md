# Takeout Tasks to ICS

Browser tool that turns a Google Takeout `Tasks.json` export (or a Takeout ZIP that contains it) into an importable ICS file. Nothing is uploaded. There is no Google sign-in. Checking a license key is the only network request, and it sends only the key.

This is a review build. It is not a claim that demand or sales have been validated. Import into Outlook or Apple Reminders has not been tested yet.

## What it does

- Preview tasks by list (title, notes, due date, subtasks, completed or not).
- Download one ICS of `VTODO` items (all lists, or one list), or one file per list as a ZIP.
- Optionally download a second ICS of due dates as `VEVENT` entries, for Outlook / Google Calendar.
- Convert a built-in sample without paying. Your own file needs a license key.
- Mark tasks whose repeat rules could not be kept.
- Optional time zone for preview and `X-WR-TIMEZONE`. Timed due dates are still written in UTC.

Free command-line converters already exist (`takeout_prepper`, `gtask-exporthelper`, `google-tasks-to-ical`). The paid difference, once listed, is: open the page, drop the official export, preview, and download, with no install.

Until a Gumroad product is listed, the temporary review key `REVIEW-LOCAL-ONLY` can unlock a local file. That key will be removed before sale.

## Run

Open `index.html` over a local static server (modules will not load from `file://`):

```bash
python3 -m http.server 4173 --directory /workspace/tasks-to-ics
```

Then open http://127.0.0.1:4173/

## Test

```bash
npm test
```

Requires Node 18+ (for `node:test` and `DecompressionStream`). Proof ICS files are written to `proof/` when the proof script runs.
