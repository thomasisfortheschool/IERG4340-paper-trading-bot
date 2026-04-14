# Auto Pitch Presentation (Slidev + Playwright)

This folder provides a fast pipeline for tomorrow's professor pitch:

1. Capture fresh screenshots from your paper trading web app
2. Auto-generate a polished animated slide deck
3. Preview and export to PDF

## Quick Start

```bash
cd presentation
npm install
npx playwright install chromium
copy .env.example .env
```

Update `.env` values if needed.

## One-command pitch workflow

```bash
npm run prep
npm run dev
```

- `npm run prep`:
  - runs screenshot capture
  - regenerates `slides.md`
- `npm run dev`:
  - opens Slidev live preview

## Export

```bash
npm run build
npm run export:pdf
```

## Scripts

- `npm run capture` -> capture app screenshots into `public/screenshots`
- `npm run generate` -> generate animated pitch deck markdown
- `npm run prep` -> capture + generate
- `npm run pitch` -> prep + dev

## Expected screenshots generated

- `public/screenshots/home.png`
- `public/screenshots/trade-desk.png`
- `public/screenshots/operations.png`
- `public/screenshots/strategies.png`

If a tab cannot be found, capture continues and logs a warning.
