# Changelog

All notable changes to FM Plus (`fms-embed`) are documented in this file.

## [0.2.5] — 2026-10-16

### Added
- Auto-plan **Improve plan** pass when KPIs suggest it (unassigned, late stops, or fill spread ≥ 25 pp): second multi-metric balance with more relocate budget.

## [0.2.4] — 2026-10-16

### Added
- Auto-plan day quality KPIs on preview/apply: assigned/unassigned, late stops, total km, fill avg/spread, solve time (also logged server-side).

## [0.2.3] — 2026-10-16

### Changed
- Archived LookFeelDesign mocks under `docs/design/` (reference only; not the shipping UI).
- Extended Modern theme polish to Goods/Customers master desks.
- Extracted Auto-plan balance-goal checkboxes into `DispatchPlanBalanceGoals`.

## [0.2.2] — 2026-10-16

### Added
- Broader desk RBAC privileges: Auto-plan Apply, Jobs, Orders, Live/replan, and dispatch settings (depots, capacities, rates, zone map).
- Soft gate: unsigned embed keeps prior tenant-key write access; signed-in desk users need Admin-granted privileges.

### Changed
- Admin Field-user privilege checklist covers the full desk privilege set.

## [0.2.1] — 2026-10-16

### Changed
- Extracted `POST /api/dispatch/plan-day` into `server/dispatch-plan-day.mjs` (thinner `dispatch-api` router).
- Extracted Auto-plan preview UI and balance-goal helpers from `DispatchBoard`.

## [0.2.0] — 2026-10-16

### Added
- GitHub Actions CI on `main` (unit tests + production build).
- Auto-plan day multi-select load balance goals: capacity fill %, stop count, distance, and schedule time (pack-only when none selected; default remains fill-only).

### Changed
- Package version bumped from `0.1.0` to `0.2.0`.

## [0.1.0] — prior

Initial tracked baseline: Armada embed analytics, Dispatch Jobs / Live, Field & Manager PWAs, maintenance desk, Goods/Customers masters, desk Field-user login with Goods/Customers write privileges, and Modern theme tokens across surfaces.
