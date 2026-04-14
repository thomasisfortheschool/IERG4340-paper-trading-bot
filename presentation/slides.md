---
theme: apple-basic
title: IERG4340 Paper Trading Bot - Pitch Deck
transition: slide-left
mdc: true
colorSchema: dark
fonts:
  sans: Sora
  mono: JetBrains Mono
---

<style>
.slidev-layout {
  background:
    radial-gradient(900px 600px at 85% -5%, rgba(34, 211, 238, 0.22), transparent 65%),
    radial-gradient(700px 460px at -10% 105%, rgba(16, 185, 129, 0.18), transparent 60%),
    linear-gradient(145deg, #06111f 0%, #0b1c33 45%, #0a1728 100%);
}
.hero-title {
  font-size: 62px;
  line-height: 1.02;
  letter-spacing: -0.04em;
  font-weight: 800;
  margin: 0;
}
.hero-sub {
  color: #cbd5e1;
  font-size: 20px;
  margin-top: 10px;
}
.chip {
  display: inline-block;
  border: 1px solid #67e8f980;
  color: #a5f3fc;
  background: #08334480;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.pitch-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.pitch-card {
  border: 1px solid #334155;
  border-radius: 16px;
  padding: 18px;
  background: linear-gradient(155deg, rgba(15, 23, 42, 0.86), rgba(15, 23, 42, 0.52));
}
.pitch-card h3 {
  margin: 0;
  font-size: 30px;
  color: #67e8f9;
}
.pitch-card p {
  margin: 8px 0 0;
  color: #dbe7f4;
  font-size: 15px;
}
.shot-wrap {
  border: 1px solid #67e8f955;
  border-radius: 18px;
  overflow: hidden;
  background: #020617;
  box-shadow: 0 18px 70px rgba(0, 0, 0, 0.45);
}
.shot {
  display: block;
  width: 100%;
}
.stat-band {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.stat {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid #334155;
  background: rgba(2, 6, 23, 0.55);
}
.stat b {
  display: block;
  color: #93c5fd;
  font-size: 21px;
}
.stat span {
  color: #cbd5e1;
  font-size: 12px;
}
</style>

<span class="chip">IERG4340 Final Presentation</span>

<h1 class="hero-title" v-motion :initial="{ y: 40, opacity: 0 }" :enter="{ y: 0, opacity: 1 }">GPT-Powered Paper Trading Bot</h1>

<p class="hero-sub" v-motion :initial="{ y: 24, opacity: 0 }" :enter="{ y: 0, opacity: 1, transition: { delay: 200 } }">A real-time, risk-aware assistant for disciplined paper trading decisions.</p>

<div class="stat-band" v-motion :initial="{ y: 24, opacity: 0 }" :enter="{ y: 0, opacity: 1, transition: { delay: 350 } }">
  <div class="stat"><b>Live + Cached</b><span>Resilient data mode switching</span></div>
  <div class="stat"><b>Multi-Market</b><span>Stocks, options, forex, crypto</span></div>
  <div class="stat"><b>Risk Panels</b><span>Drawdown-aware controls</span></div>
  <div class="stat"><b>Automation</b><span>Logs, screens, and backtests</span></div>
</div>

---
layout: center
---

# The Problem

<div class="pitch-grid mt-8">
  <div class="pitch-card" v-click>
    <h3>Signal Overload</h3>
    <p>Traders cannot reliably process multiple market streams fast enough.</p>
  </div>
  <div class="pitch-card" v-click>
    <h3>Risk Drift</h3>
    <p>Manual workflows delay defensive actions when volatility spikes.</p>
  </div>
  <div class="pitch-card" v-click>
    <h3>Execution Friction</h3>
    <p>Great ideas fail when tooling lacks integrated execution + feedback loops.</p>
  </div>
</div>

---
layout: two-cols
---

# Solution Overview

### Unified command center for the full trading loop

- Discover opportunities in Trade Desk
- Validate risk before every action
- Track performance, logs, and bot behavior in real time
- Keep transparency under data delays

::right::

<div v-motion :initial="{ x: 56, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
  <div class="shot-wrap"><img src="/screenshots/home.png" alt="Home dashboard" class="shot" /></div>
</div>

---
layout: two-cols
---

# Trade Desk

### Fast signal triage + configurable strategy logic

- Opportunity feed and context in one place
- Strategy tab for rule-level adjustments
- Built for rapid daily decision cycles

::right::

<div class="grid gap-4">
  <div v-motion :initial="{ x: 56, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
    <div class="shot-wrap"><img src="/screenshots/trade-desk-signals.png" alt="Trade desk signals" class="shot" /></div>
  </div>
  <div v-motion :initial="{ x: 56, opacity: 0 }" :enter="{ x: 0, opacity: 1, transition: { delay: 160 } }">
    <div class="shot-wrap"><img src="/screenshots/trade-desk-strategy.png" alt="Trade desk strategy" class="shot" /></div>
  </div>
</div>

---
layout: two-cols
---

# Risk-First Execution

### Controls that prevent win-small/lose-big behavior

- Dedicated risk panel linked to positions
- Guardrails for drawdown-sensitive operation
- Clear visibility before execution

::right::

<div v-motion :initial="{ x: 56, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
  <div class="shot-wrap"><img src="/screenshots/trade-desk-risk.png" alt="Trade desk risk" class="shot" /></div>
</div>

---
layout: two-cols
---

# Portfolio + Strategy Intelligence

### Measure what works, adjust what does not

- Portfolio PnL and exposure visibility
- Strategy performance tracking
- Strategy configuration for iterative tuning

::right::

<div class="grid gap-4">
  <div v-motion :initial="{ y: 30, opacity: 0 }" :enter="{ y: 0, opacity: 1 }">
    <div class="shot-wrap"><img src="/screenshots/portfolio.png" alt="Portfolio" class="shot" /></div>
  </div>
  <div v-motion :initial="{ y: 30, opacity: 0 }" :enter="{ y: 0, opacity: 1, transition: { delay: 140 } }">
    <div class="shot-wrap"><img src="/screenshots/strategies-performance.png" alt="Strategy performance" class="shot" /></div>
  </div>
</div>

---
layout: two-cols
---

# Operations + Reliability

### Professional workflow support

- Trade logs and bot activity for traceability
- Research and tools for deeper analysis
- Fallback visibility when live broker data is delayed

::right::

<div class="grid gap-4">
  <div v-motion :initial="{ x: 56, opacity: 0 }" :enter="{ x: 0, opacity: 1 }">
    <div class="shot-wrap"><img src="/screenshots/operations-trading-log.png" alt="Operations log" class="shot" /></div>
  </div>
  <div v-motion :initial="{ x: 56, opacity: 0 }" :enter="{ x: 0, opacity: 1, transition: { delay: 130 } }">
    <div class="shot-wrap"><img src="/screenshots/operations-bot-activity.png" alt="Operations bot" class="shot" /></div>
  </div>
</div>

---
layout: center
---

# Why This Deck Is Investor-Style

<div class="pitch-grid mt-8">
  <div class="pitch-card" v-click>
    <h3>Clear Arc</h3>
    <p>Problem, solution, product proof, and differentiation in a tight narrative.</p>
  </div>
  <div class="pitch-card" v-click>
    <h3>Visual Proof</h3>
    <p>Every claim is backed by fresh, real dashboard captures.</p>
  </div>
  <div class="pitch-card" v-click>
    <h3>Exec Presence</h3>
    <p>Cinematic theme, motion pacing, and professional hierarchy for delivery impact.</p>
  </div>
</div>

---
layout: center
class: text-center
---

# Thank You

## Live demo and Q&A

IERG4340 Paper Trading Bot