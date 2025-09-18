# Reclaim Planner Extension (Chrome Extension)

Adds durations to time ranges on the Reclaim planner page, ready to copy into timesheets.

Example:
- `1:15 - 2:15pm` → `1:15 - 2:15pm (1h00m)`

## Features

- 🔍 Detects time ranges like `h[:mm] - h[:mm][am|pm]` on the planner.
- ⏱️ Appends a duration to detected time ranges.
    ![Screenshot of Reclaim Planner Duration Helper in action](./readme-content/screenshot.png)
- 📋 Click the appended duration to copy the decimal value (e.g., `1.25`) to your clipboard for time entries.
- ♻️ Updates automatically as the page content changes.