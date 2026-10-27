# Clockin

A team time-tracking web app with manager and employee accounts. Requires Node.js 24 or newer; no external packages or services.

## Development

```sh
npm ci
npm test
npm run dev
```

The server listens on port 3000 at 127.0.0.1. Open the app and create the first manager account. Managers add employee accounts under **Team & timesheets** and share their initial passwords securely. Employees sign in to clock in/out and view their history. Managers can track their own time and inspect team shifts.

`npm start` runs without file watching. Set `PORT` or `HOST` to change the listener. The SQLite database persists at `data/clockin.sqlite` (ignored by Git); set `DB_PATH` to override it. Back up the database before clearing data. Times are stored as UTC timestamps and displayed in the browser’s local timezone. Dashboard history shows the latest 100 personal / 500 team shifts.

## Deployment considerations

This is a development MVP. Set up the first manager locally before exposing the service; the first-account setup is public until completed. For deployment, use HTTPS and set `COOKIE_SECURE=true`, configure a trusted proxy and durable storage, and add password reset/change, account deactivation, audit logging, and deployment-grade rate limiting. Sessions expire after 24 hours; passwords use salted scrypt and session tokens are stored hashed. No default passwords are seeded. Payroll approval, shift edits, breaks, exports, multi-company isolation, and payroll calculations are not implemented.

## Validation

`npm test` starts an isolated server and temporary database, verifies setup, login, employee creation, role restrictions, shift transitions, team visibility, and logout. No compilation step is needed for the vanilla browser frontend and Node backend.
