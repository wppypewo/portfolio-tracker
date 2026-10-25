# StackWorth

[![CI](https://github.com/zhuang060329-bit/portfolio-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/zhuang060329-bit/portfolio-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-informational.svg)](CHANGELOG.md)

English | [繁體中文](README.zh-TW.md)

A personal portfolio tracker for a long-term investor holding US ETFs, Taiwan stocks, crypto, and manual assets across multiple accounts — everything in one TWD-denominated dashboard.

**Live app:** https://portfolio-tracker-two-rho.vercel.app · **Public demo (no login):** https://portfolio-tracker-two-rho.vercel.app/demo · **Full reference:** [docs/REFERENCE.md](docs/REFERENCE.md)

Personal finance tool. Not investment advice, not affiliated with any institution, not a commercial product. The interface is in Traditional Chinese.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.png">
  <img alt="StackWorth demo dashboard: net worth, cost basis, unrealized and realized P&amp;L, XIRR, holdings ledger and allocation map" src="docs/screenshots/overview-light.png">
</picture>

<sub>Public demo, generated data. Light and dark themes follow your GitHub setting.</sub>

---

## The problem

Holding assets across markets and currencies means brokerage apps only ever show fragments. Spreadsheets can't pull live prices or keep a clean contribution history. What I wanted did not exist in one place: XIRR and TWR side by side, computed with correct sign conventions, scoped to the portfolio I actually hold today, in my own base currency.

## Constraints

- **The data is my real money.** When a metric can't be computed reliably, the UI shows "—" instead of a best guess.
- **Free-tier quote APIs** (Twelve Data, FinMind, CoinGecko) with hard rate and history limits — refresh paths use cooldowns, and missing data renders as a visible gap rather than an interpolated value.
- **Daily driver on a phone.** Touch scrubbing on charts, PWA install, one-tap amount masking for public places.
- **Solo project.** Every write path, metric, and edge case has to be cheap to verify — hence the five-gate discipline below.

## Design decisions

**One computation pipeline, two callers.** All dashboard math lives in `buildDashboardData`, a pure function with no I/O. The production page feeds it Supabase rows; the public `/demo` route feeds it deterministically generated data. The demo is therefore not a mockup — XIRR, TWR, Sharpe, and drawdown on the demo page are computed by the exact code that runs on my real portfolio.

**XIRR and TWR use opposite cashflow conventions, on purpose.** XIRR follows the investor's wallet (investment = negative, terminal portfolio value appended as positive); TWR follows the portfolio (contribution = positive, terminal value excluded because it is already embedded in the last snapshot — including it would zero out the final sub-period). The sign flip happens once, at one documented point, with regression tests pinning the terminal-value misuse case.

**The XIRR solver validates its residual before returning a rate.** Every exit path of the Newton-Raphson loop checks `|NPV(rate)|` against a scale-relative tolerance; oscillation, flat derivatives, and hitting the iteration cap all return null instead of a residual value.

**Dashboard scope is the active portfolio.** Summary values, the trend curve, performance metrics, income stats, and allocation share one active-account boundary. Showing archived accounts only expands the holdings ledger; it cannot change the dashboard totals or appear as a value drop in TWR.

**Risk metrics preserve cashflow and time boundaries.** Max drawdown is calculated from the cashflow-adjusted TWR index, so withdrawals do not look like market losses. Sharpe converts irregular snapshot intervals to equivalent daily returns and annualizes on calendar days because the portfolio includes assets that trade on weekends.

**Recurring execution is ledger-backed and idempotent.** Cron and manual execution fetch the latest quote, then call one Postgres RPC. The function locks the plan and account, derives the quantity increment from current database values, writes the transaction and snapshot, records the scheduled run, and advances the plan in one transaction. A unique `(plan_id, scheduled_date)` key makes retries and double clicks harmless.

**Failure states are explicit.** Benchmark fetchers return empty on failure and the chart bridges gaps with a dashed segment; enabled comparison lines share one start date before they are normalized to 100; CoinGecko's history cap renders BTC as a late-starting series; the service worker caches only an offline page, since showing stale financial numbers is worse than failing to load; a data-health card in settings turns red when the price cron misses a run.

**Decision context is write-once.** A decision stores the price, FX rate, position, allocation, cost, unrealized P&L, and portfolio value seen at creation. Database triggers reject later edits to that context while still allowing the thesis, review date, and other user-authored fields to be corrected.

**Historical pages never borrow today's quote.** Replay uses the latest snapshot available on or before the selected date, labels carried-forward values with their source date, and exposes missing data. The attribution equation keeps a visible scale-relative residual instead of hiding an incomplete split.

## Workflows

- **Decision journal:** create a pre-trade or post-trade record at `/decisions`, optionally link it to an activity transaction, preserve the original context, schedule a review, and record outcome and process separately.
- **Historical replay and attribution:** choose an as-of date at `/history` to inspect holdings, archived boundaries, price dates, allocation, currency exposure, and a reconciling change breakdown.
- **Stress test and anti-FOMO check:** use the Portfolio Stress tab at `/whatif` to combine price and FX shocks, then model an external proposed purchase without writing to the ledger.
- **Monthly report:** select a month at `/reports/monthly`, review returns, attribution, allocation, decisions, gaps, and data health, then use the browser's print-to-PDF flow.

## Verification

- Every server action input passes a Zod schema before touching the database; Supabase RLS and TOTP MFA (AAL2) sit under that.
- Five gates run before merge — lint, typecheck, unit Vitest, Postgres integration, and production build — mirrored in GitHub Actions.
- Tests target invariants: XIRR residual validation, TWR cashflow isolation, cashflow-adjusted drawdown, irregular snapshot intervals, archived-account scope, demo-data determinism, server-action auth and cooldown boundaries, recurring-plan concurrency and rollback, and the atomic-write RPCs against a real Postgres.
- Calendar-date conversions pin `Asia/Taipei` explicitly; Vercel runs in UTC, and a one-day shift in snapshot dates corrupts day-change and TWR.

## Demo

https://portfolio-tracker-two-rho.vercel.app/demo — no account needed.

Generated data: an 18-month DCA history with a seeded pseudo-random walk, a planted correction regime, one realized loss, dividends and interest. Deterministic per day, so reviewers see the same numbers on revisit. The production dashboard holds personal financial data, so every screenshot in this repository comes from the demo.

| Historical replay and attribution | Stress test and anti-FOMO check |
|---|---|
| ![Historical replay: opening and closing net worth with a reconciling breakdown into contributions, price effect, FX effect, income and withdrawals](docs/screenshots/history.png) | ![Stress test: price and FX shock rules applied to the demo portfolio, with the stressed value and a pre-purchase check](docs/screenshots/stress-test.png) |

<img alt="Demo dashboard on a phone" src="docs/screenshots/mobile.png" width="260">

The demo flows are `/demo/decisions`, `/demo/history`, `/demo/whatif`, and `/demo/report`. They use deterministic fixtures only and never query an authenticated user's portfolio.

Amount masking remains available in the authenticated app. Printed monthly reports state whether amounts were visible when the report was generated; check that state before saving a PDF on a shared device.

## Running locally

```bash
git clone https://github.com/zhuang060329-bit/portfolio-tracker
cd portfolio-tracker
npm install
cp .env.local.example .env.local   # fill in; see docs/REFERENCE.md for the variable table
npm run dev
```

Gates: `npm run lint` / `npm run typecheck` / `npm run test:unit` / `TEST_DATABASE_URL=... npm run test:integration` / `npm run build`.

## Status and next steps

Running in production (Vercel + Supabase, single user). CI runs lint / typecheck / unit tests / Postgres integration / build on every push to main. The current release is **v1.3.0** (2026-10-25): tiered DCA amounts, cost-basis correction, the public `/about` page, MFA enforced at the database layer, and a set of Asia/Taipei date fixes. Each release lists the SQL migrations it needs; the full order is in [supabase/README.md](supabase/README.md).

Known limits: replay and reports use bounded snapshot queries and surface truncation or missing prices; review performance depends on stored daily snapshots; browser printing is the PDF path; authenticated create/review flows require a configured Supabase project. See [docs/REFERENCE.md](docs/REFERENCE.md) and [CHANGELOG.md](CHANGELOG.md).

## Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module boundaries and write paths
- [docs/ADR-001-stackworth-v1-data-semantics.md](docs/ADR-001-stackworth-v1-data-semantics.md): data semantics for v1
- [docs/DESIGN_NOTES.md](docs/DESIGN_NOTES.md): design decisions and trade-offs, with measured numbers (Traditional Chinese)
- [SECURITY.md](SECURITY.md): how to report a vulnerability

## Author

Built by [@zhuang060329-bit](https://github.com/zhuang060329-bit) as a daily-use tool for a multi-asset, multi-currency portfolio.

## License

[MIT](LICENSE).
