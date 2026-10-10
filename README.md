# Rep Log

A small workout journal that runs in the browser. Log strength and cardio sets, save workout templates, review your history and monthly progress, and export your data.

## Weekly workout target

Set your target in **Progress → Attendance** (1–14 workouts, default 4). This compact control is kept out of the workout form. The target is saved on this device and carried into each new week. Weeks run Monday to Sunday in your local time, using each workout's date. The workout summary shows a compact count against your target.

Only a newly saved workout opens the centered success message: “You logged your 1st workout this week!” It has no buttons, stays visible for four seconds, and then fades away. A small confetti burst appears when you reach the target. Each workout beyond the target adds another filled dot. The new dot appears as a small lightning bolt in place, then smoothly morphs into its final circle within 380 ms, without a bounce. The same element changes shape using local CSS animations, so the dot stays aligned throughout. Reduced-motion preferences disable these animations. Backdated workouts count toward their own week, and edits do not add another workout. The target is included in exported backups.

**Attendance** opens with a responsive bento grid of month cards showing average weekly workouts, total workouts, and unique days trained. The newest month in each group gets a wider card; the current month has a subtle green background and a “Month to date” label. Tap a month to see its weekly rows and daily attendance. Multiple workouts on one day all count as workouts but count as one day trained. Empty months between your first workout and today remain visible. Browse older history in twelve-month groups.

The weekly average is the month's workout count multiplied by 7 and divided by calendar days in the month. The current month uses only days elapsed through today, including today; future-dated workouts are excluded until their date arrives. Days without workouts are included. Weeks crossing a month boundary count only dates within the selected month, so the detail totals add up to the month total. Attendance is derived from saved history and updates after edits, deletions, restorations, and imports. Target changes do not rewrite historical totals or averages.

## Run locally

From this folder, run `python3 -m http.server 8000`, then open `http://localhost:8000`. The page also works when opened directly, though a local server gives the installable manifest a normal web origin.

Workout history, templates, exercise names, preferences and unfinished workouts are stored in this browser's local storage. Changing browsers, domains or devices does **not** move that history. Use **Export data** to download a JSON backup before moving or clearing browser data; then use **Import data** on the new device or site. Backup format v2 includes workout types, templates, cardio settings and hidden exercises; v1 backups remain importable.

## Optional Notion sync

The `api/log.js` endpoint is a Vercel serverless function. Deploy this folder to Vercel, set `NOTION_TOKEN` in the project's environment, share your database with that Notion integration, and enter the database ID in Rep Log's **Notion settings** dialog. The integration needs permission to read and write its shared database so retries can check for existing rows. The database needs columns `Name` (title), `Exercise` (select), `Date` (date), `Set #` (number), `Weight (kg)` (number), `Reps` (number), `Volume (kg)` (number), `Session` (rich text), `Workout Type` (select), `Duration (min)` (number), and `Distance (km)` (number).

A plain static host does not run `api/log.js`; workout logging, backup and progress still work there. Local data saves immediately. With a Notion database configured, pending workouts retry automatically after one minute, when the app opens, when it comes back online, and when it returns to the foreground. The history shows a quiet Pending status while waiting. The backend has no account system: keep a deployment containing your Notion token private or add authentication before sharing its URL.
