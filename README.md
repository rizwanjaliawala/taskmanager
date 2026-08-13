# TaskFlow — Task Management UI

A premium, animated task-management interface built with plain **HTML, CSS and JavaScript**.
No frameworks, no build step, no backend — every interaction is simulated in the frontend
against realistic mock data and persisted to `localStorage`.

## Run it

Just open `index.html` in a browser.

For a local server instead (useful while editing):

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .claude/serve.ps1 -Port 4173
```

Then visit <http://localhost:4173>.

## Structure

```
index.html                 app shell, SVG icon sprite, boot + login screens
assets/css/styles.css      design system: tokens, components, motion, responsive
assets/js/data.js          mock workspace — people, 30 tasks, notifications, series
assets/js/ui.js            DOM helpers, formatters, atoms, toasts, count-up, confetti
assets/js/charts.js        hand-built SVG charts (ring, donut, bars, line, sparkline)
assets/js/views.js         the nine screens
assets/js/app.js           state, routing, drawer, modal, search, mutations
```

## What works

| Area | Behaviour |
| --- | --- |
| Boot | Animated logo + staged progress, then the login screen |
| Login | `Continue to Dashboard` transitions into the app; session persists across reloads |
| Dashboard | Six count-up KPI cards, animated productivity ring, interactive status donut, weekly throughput bars, team table, my-tasks widget, live activity |
| Tasks | List and board layouts, search, status / priority / assignee filters, scope switching |
| Create Task | Animated modal with priority pills, avatar assignee picker, tags, simulated attachments → loading → success burst → toast + notification |
| Task drawer | Slides in from the right (full-screen sheet on mobile), progress slider + 25/50/75/100 checkpoints, comments, activity timeline |
| Completion | Progress → 100% flips status to Completed, fires confetti, a toast, a notification, and updates every KPI |
| Calendar | Month grid with priority-coloured deadlines, animated month transitions |
| Reports | Trend and cycle-time line charts, priority donut, department bars |
| Theme | Animated light/dark switch plus five accent colours, saved locally |
| Shortcuts | `Ctrl/⌘ + K` search · `N` new task · `Esc` closes overlays |

## Demo data

The board holds 30 live task objects. Headline figures (128 total, 42 in progress,
67 completed, 9 overdue, 14 due today, 82% completion rate) represent the full
workspace — the difference between the seeded slice and those totals is applied as a
fixed offset, so live edits still move the numbers truthfully.

Reset everything from **Settings → Reset workspace**.
