# Freda's API

All protected routes require:

`Authorization: Bearer <JWT>`

## Auth

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/change-password`

## Branches / staff

- `GET /api/branches`
- `POST /api/branches` — owner
- `GET /api/branches/:branchId/staff` — owner
- `POST /api/branches/:branchId/staff` — owner

## Attendance

- `GET /api/attendance/today`
- `POST /api/attendance/clock-in`
- `POST /api/attendance/break-start`
- `POST /api/attendance/break-end`
- `POST /api/attendance/clock-out`
- `GET /api/branches/:branchId/attendance` — owner

Sunday is blocked server-side.

## Menu / reports

- `GET /api/menu`
- `POST /api/branches/:branchId/reports` — worker assigned to branch
- `GET /api/branches/:branchId/reports` — owner
- `GET /api/branches/:branchId/reports/weekly` — owner

## Needs / alerts

- `GET /api/branches/:branchId/needs` — owner
- `PATCH /api/needs/:needId/resolve` — owner
- `GET /api/branches/:branchId/alerts` — owner
- `PATCH /api/alerts/:alertId` — owner

## Expenses

- `GET /api/branches/:branchId/expenses` — owner
- `POST /api/branches/:branchId/expenses` — owner

## Dashboard / activity

- `GET /api/branches/:branchId/overview` — owner
- `GET /api/branches/:branchId/activity` — owner
