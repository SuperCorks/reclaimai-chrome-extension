# Reclaim Planner Duration Helper (Chrome Extension)

This MV3 content-script-only extension appends the duration to time ranges on the Reclaim planner page.

Example transform:

- `1:15 - 2:15pm` → `1:15 - 2:15pm (1h00m)`

It tracks DOM changes with a MutationObserver, so newly rendered items are updated automatically.

## Load the extension

1. Build is not required. Files are ready to load.
2. Open Chrome → go to `chrome://extensions`.
3. Enable "Developer mode" (top-right).
4. Click "Load unpacked" and select this folder: `c:\\Users\\simon\\reclaim-extension`.
5. Navigate to https://app.reclaim.ai/planner and refresh.

## Notes

- The script looks for patterns like `h[:mm] - h[:mm][am|pm]` and appends a duration, in the format `(<Hh><MMm>)` or `(MMm)` if under one hour.
- It avoids re-appending by marking updated elements with a data attribute.
- If an end time is earlier than the start time, it assumes the range crosses into the next half-day/day.
- Classes on the elements are ignored; it works off text content.

## Development

- `manifest.json` registers a single content script on `https://app.reclaim.ai/planner*` and runs at `document_idle`.
- Main logic is in `content-script.js`.
