# Changelog

All notable changes to IfeMate are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-20

### Added

- Handbook-backed honours projection for Computer Science, Computer Science with Economics, and Computer Engineering students.
- Guided Telegram workflow that asks users to choose a minimum honours safety floor before calculating a projection toward the highest attainable CGPA.
- Highest-attainable CGPA and honours classification based on completed GPA units and the remaining programme curriculum.
- Progressive term-by-term grade strategy with specific courses and grades to target.
- Support for standard and direct-entry curriculum paths, carryovers, programme electives, and adviser-confirmation warnings where the handbook is not definitive.
- Regression coverage for programme selection, target selection, attainable and unattainable targets, carryovers, term grouping, and projected grade plans.

## [0.1.0] - 2026-10-20

### Added

- Multi-user Telegram bot for checking OAU ePortal results through private chats.
- Isolated SQLite-backed Cloudflare Durable Object storage for each Telegram user.
- Encrypted portal credentials, automatic session restoration, and deletion of saved credentials, portal sessions, cached results, notification state, and pending prompts on logout.
- Results PIN configured through Telegram for protected academic views.
- Fifteen-minute automatic result checks with alerts for added, changed, and removed courses.
- Semester result browsing with SGPA, cumulative CGPA, and pagination.
- Academic summary, semester comparison, performance analytics, grade distribution, and trend charts.
- Calculated SGPA and CGPA movement in semester comparisons and result-change alerts.
- Downloadable PDF academic reports containing GPA trends, semester comparisons, and complete results.
- Separate elective progress tracking that excludes qualifying special electives from SGPA and CGPA.
- Recent-message cleanup through `/clear` while Telegram deletion remains available.
- Cloudflare deployment tooling for secrets, Worker deployment, Durable Object migration, and webhook registration.
- Authenticated Telegram webhooks with encrypted, durable, deduplicated update queues and retry-safe processing.
- Automated tests for deployment, authentication, portal sessions, result processing, analytics, reporting, alerts, electives, and multi-user isolation.
- Public-use and self-hosting documentation with explicit privacy and security limitations.
- Attribution to the upstream `Cypher012/OAU-PORTAL-CHECKER` project and its merged academic-reporting contribution.

### Fixed

- Bot prompts now direct users to the next valid action during login and PIN workflows.
- Grade-distribution output distinguishes course counts from credit-unit weighting.
- `/clear` sweeps recent direct-message IDs instead of relying only on locally tracked messages.

[Unreleased]: https://github.com/RobaireTH/oau-portal-checker/compare/4979ffd477e6e535b8d7bf57d087a3af488b897a...HEAD
[0.2.0]: https://github.com/RobaireTH/oau-portal-checker/compare/7a6a68147b18c0d8604e6874f7532e760bc6f487...4979ffd477e6e535b8d7bf57d087a3af488b897a
[0.1.0]: https://github.com/RobaireTH/oau-portal-checker/tree/7a6a68147b18c0d8604e6874f7532e760bc6f487
