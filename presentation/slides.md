---
theme: apple-basic
title: IERG4340 Paper Trading Bot Pitch
transition: fade-out
mdc: true
colorSchema: dark
fonts:
  sans: Space Grotesk
  mono: JetBrains Mono
---

<style>
.slidev-layout {
  background: radial-gradient(1200px 800px at 80% -10%, #113a6a55, transparent),
              radial-gradient(900px 500px at -10% 110%, #1a8b8a44, transparent),
              linear-gradient(140deg, #071020 0%, #081a33 45%, #0a1830 100%);
}
.h1 {
  letter-spacing: -0.04em;
}
.pitch-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid #2dd4bf66;
  background: #0d2f3c80;
  color: #99f6e4;
  font-size: 14px;
}
.shot-wrap {
  border-radius: 20px;
  border: 1px solid #a5f3fc55;
  background: #061320;
  box-shadow: 0 20px 80px #00000066;
  overflow: hidden;
}
.shot {
  width: 100%;
  display: block;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.metric-card {
  border: 1px solid #334155;
  border-radius: 18px;
  padding: 20px;
  background: linear-gradient(145deg, #0f172a99, #0b122899);
}
.metric-card h3 {
  margin: 0;
  font-size: 30px;
  color: #67e8f9;
}
.metric-card p {
  margin: 8px 0 0;
  color: #cbd5e1;
  font-size: 15px;
}
</style>

# GPT-Powered Paper Trading Bot

<span class="pitch-chip">IERG4340 Final Pitch</span>

## AI-powered paper trading assistant for smarter decisions

Your Name · 2026-04-14 · For Professor Name

---
layout: center
---

# Why This Matters

<div class="metric-grid mt-10">
  <div v-click class="metric-card">
    <h3>Signal Noise</h3>
    <p>Human traders struggle to process live multi-market signals in time.</p>
  </div>
  <div v-click class="metric-card">
    <h3>Risk Drift</h3>
    <p>Without automation, drawdown control is often delayed or inconsistent.</p>
  </div>
  <div v-click class="metric-card">
    <h3>Execution Gap</h3>
    <p>Ideas look good, but real-time execution quality is usually the bottleneck.</p>
  </div>
</div>

---
layout: two-cols
---

# Product Walkthrough: Home + Core Signals

### Home Dashboard

- Real-time account and PnL visibility
- Connected broker and bot status
- Strategy and operations health in one view

::right::

<div v-motion :initial="{ x: 60, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
<div class="shot-wrap"><img src="/screenshots/home.png" alt="Dashboard Home" class="shot" /></div>
</div>

---
layout: two-cols
---

# Trade Desk: Signals

### Opportunity Discovery

- Market scanning and candidate generation
- Fast triage for stocks/options/forex
- Built for daily workflow cadence

::right::

<div v-motion :initial="{ x: 60, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
<div class="shot-wrap"><img src="/screenshots/trade-desk-signals.png" alt="Trade Desk Signals" class="shot" /></div>
</div>

---
layout: two-cols
---

# Trade Desk: Strategy + Risk

### Configuration & Guardrails

- Strategy controls for execution style
- Dedicated risk panel for drawdown control
- Supports disciplined, repeatable decisions

::right::

<div class="grid gap-4">
  <div v-motion :initial="{ x: 60, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
    <div class="shot-wrap"><img src="/screenshots/trade-desk-strategy.png" alt="Trade Desk Strategy" class="shot" /></div>
  </div>
  <div v-motion :initial="{ x: 60, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
    <div class="shot-wrap"><img src="/screenshots/trade-desk-risk.png" alt="Trade Desk Risk" class="shot" /></div>
  </div>
</div>

---
layout: two-cols
---

# Operations: Execution + Traceability

### Execution + Traceability

- Unified execution ledger
- Fill-level diagnostics
- Exportable logs for audit and review

::right::

<div v-motion :initial="{ x: 60, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
<div class="shot-wrap"><img src="/screenshots/operations-trading-log.png" alt="Operations Trading Log" class="shot" /></div>
</div>

---
layout: two-cols
---

# Strategy Layer

### Multi-strategy Brain

- Modular strategy blocks
- Risk-aware decision flow
- Ready for regime-aware extensions

::right::

<div class="grid gap-4">
  <div v-motion :initial="{ x: 60, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
    <div class="shot-wrap"><img src="/screenshots/strategies-performance.png" alt="Strategies Performance" class="shot" /></div>
  </div>
  <div v-motion :initial="{ x: 60, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
    <div class="shot-wrap"><img src="/screenshots/strategies-configuration.png" alt="Strategies Configuration" class="shot" /></div>
  </div>
</div>

---
layout: two-cols
---

# Platform Coverage

### End-to-end product surface

- Portfolio and watchlist workflows
- Forex desk and crypto desk integration
- Tools module for summary + backtesting

::right::

<div class="grid gap-4">
  <div v-motion :initial="{ y: 30, opacity: 0 }" :enter="{ y: 0, opacity: 1 }">
    <div class="shot-wrap"><img src="/screenshots/portfolio.png" alt="Portfolio" class="shot" /></div>
  </div>
  <div v-motion :initial="{ y: 30, opacity: 0 }" :enter="{ y: 0, opacity: 1 }">
    <div class="shot-wrap"><img src="/screenshots/forex-desk.png" alt="Forex Desk" class="shot" /></div>
  </div>
</div>

---
layout: center
---

# Reliability Under Data Delays

<div class="grid grid-cols-2 gap-6 mt-8">
  <div class="metric-card">
    <h3>Live-first + fallback</h3>
    <p>If broker responses are slow, dashboard falls back to cached/snapshot data instead of hard failure.</p>
  </div>
  <div class="metric-card">
    <h3>Transparent state</h3>
    <p>UI explicitly labels when data is fallback/degraded, so users can trust what they are seeing.</p>
  </div>
</div>

---
layout: center
---

# Why This Is Pitch-Ready

<div class="grid grid-cols-2 gap-6 mt-10">
  <div v-click class="metric-card">
    <h3>Automation-first</h3>
    <p>Screens and deck are generated in one flow, reducing prep time.</p>
  </div>
  <div v-click class="metric-card">
    <h3>Design-forward</h3>
    <p>Cinematic styling with clean hierarchy and motion for storytelling.</p>
  </div>
  <div v-click class="metric-card">
    <h3>Professor-friendly</h3>
    <p>Clear product narrative: problem, solution, evidence, differentiation.</p>
  </div>
  <div v-click class="metric-card">
    <h3>Demo-backed</h3>
    <p>Every key claim is supported by live app screenshots and workflow proof.</p>
  </div>
</div>

---
layout: center
class: text-center
---

# Thank You

## Live demo + Q&A

Your Name
