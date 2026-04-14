import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'public', 'screenshots');
const BASE_URL = process.env.PRESENTATION_APP_URL || 'http://localhost:3000';

async function ensureDir() {
  await fs.mkdir(OUT_DIR, { recursive: true });
}

async function saveShot(page, fileName) {
  await page.screenshot({
    path: path.join(OUT_DIR, fileName),
    fullPage: false,
  });
  console.log(`Saved ${fileName}`);
}

async function saveLocatorShot(locator, fileName) {
  await locator.screenshot({
    path: path.join(OUT_DIR, fileName),
  });
  console.log(`Saved ${fileName}`);
}

async function settle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    // Continue when network stays active due to polling.
  }
  await page.waitForTimeout(1200);
}

const BLOCKING_LOADING_PHRASES = [
  'Preparing your trading workspace',
  'Loading dashboard data...',
  'Connecting to dashboard APIs...',
  'Loading positions...',
  'Loading opportunities...',
  'Scanning markets for opportunities...',
  'Loading major indices...',
  'Loading overnight summary...',
  'Loading performance data...',
  'Loading records...',
  'Loading bot logs...',
  'Loading Forex Desk...',
  'Loading Crypto Desk...',
  'Loading watchlists and sandbox portfolios...',
  'Loading ticker data...',
  'Loading market context...',
];

async function waitForDashboard(page) {
  await page.getByText('Active data source:', { exact: false }).first().waitFor({ timeout: 25000 });

  for (let i = 0; i < 30; i += 1) {
    const preparingVisible = await page.getByText('Preparing your trading workspace', { exact: false }).first().isVisible().catch(() => false);
    if (preparingVisible) {
      await page.waitForTimeout(1000);
      continue;
    }

    const connectingVisible = await page.getByText('Connecting to dashboard APIs', { exact: false }).first().isVisible().catch(() => false);
    if (!connectingVisible) {
      return;
    }

    const delayedVisible = await page.getByText('Live broker data is delayed', { exact: false }).first().isVisible().catch(() => false);
    const fallbackVisible = await page.getByText('showing cached snapshot/fallback values', { exact: false }).first().isVisible().catch(() => false);
    if (delayedVisible || fallbackVisible) {
      return;
    }

    await page.waitForTimeout(1000);
  }
}

async function removeCaptureBoard(page) {
  await page.evaluate(() => {
    document.getElementById('card-capture-board')?.remove();
    const root = document.documentElement;
    if (root.dataset.capturePrevZoom !== undefined) {
      root.style.zoom = root.dataset.capturePrevZoom || '';
      delete root.dataset.capturePrevZoom;
    }
  });
}

async function buildCaptureBoard(page, boardTitle) {
  return await page.evaluate((title) => {
    document.getElementById('card-capture-board')?.remove();

    const contentRoot = document.querySelector('div[class*="min-h-[60vh]"]') || document.querySelector('main') || document.body;
    if (!contentRoot) {
      return false;
    }

    const selector = '.card, div[class*="rounded-2xl"], div[class*="rounded-xl"]';
    const allCandidates = Array.from(contentRoot.querySelectorAll(selector));
    const candidateSet = new Set(allCandidates);

    const isElementVisible = (el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 280 || rect.height < 110) {
        return false;
      }
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        return false;
      }
      return true;
    };

    const hasCandidateAncestor = (el) => {
      let parent = el.parentElement;
      while (parent && parent !== contentRoot) {
        if (candidateSet.has(parent)) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    };

    const topLevelCards = allCandidates
      .filter((el) => !el.closest('#card-capture-board'))
      .filter((el) => !el.closest('.scroll-row'))
      .filter((el) => !hasCandidateAncestor(el))
      .filter((el) => isElementVisible(el))
      .filter((el) => {
        const text = (el.textContent || '').trim();
        if (!text) {
          return false;
        }
        return !text.includes('Active data source:');
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        if (Math.abs(ar.top - br.top) > 12) {
          return ar.top - br.top;
        }
        return ar.left - br.left;
      })
      .slice(0, 8);

    let cards = [...topLevelCards];

    if (cards.length <= 1 && cards[0]) {
      const nested = Array.from(cards[0].querySelectorAll(selector))
        .filter((el) => el !== cards[0])
        .filter((el) => isElementVisible(el))
        .filter((el) => {
          const text = (el.textContent || '').trim();
          return text.length >= 20;
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          if (Math.abs(ar.top - br.top) > 10) {
            return ar.top - br.top;
          }
          return ar.left - br.left;
        });

      if (nested.length >= 2) {
        cards = nested.slice(0, 8);
      }
    }

    if (!cards.length) {
      return false;
    }

    const root = document.documentElement;
    if (root.dataset.capturePrevZoom === undefined) {
      root.dataset.capturePrevZoom = root.style.zoom || '';
    }

    let zoom = 1;
    if (cards.length >= 6) {
      zoom = 0.9;
    } else if (cards.length >= 4) {
      zoom = 0.95;
    }
    root.style.zoom = String(zoom);

    const board = document.createElement('section');
    board.id = 'card-capture-board';
    board.style.position = 'absolute';
    board.style.top = '16px';
    board.style.left = '16px';
    board.style.zIndex = '2147483647';
    board.style.background = 'linear-gradient(165deg, #020617 0%, #0b1734 100%)';
    board.style.border = '1px solid rgba(56, 189, 248, 0.35)';
    board.style.borderRadius = '18px';
    board.style.padding = '16px';
    board.style.boxSizing = 'border-box';
    board.style.overflow = 'visible';
    board.style.width = cards.length <= 2 ? 'min(1100px, calc(100vw - 32px))' : 'min(1760px, calc(100vw - 32px))';
    board.style.maxWidth = 'calc(100vw - 32px)';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '12px';

    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    titleEl.style.margin = '0';
    titleEl.style.font = '700 22px/1.2 "Segoe UI", sans-serif';
    titleEl.style.color = '#e2e8f0';

    const subtitle = document.createElement('span');
    subtitle.textContent = `${cards.length} focus cards`;
    subtitle.style.font = '600 12px/1.2 "Segoe UI", sans-serif';
    subtitle.style.color = '#7dd3fc';
    subtitle.style.letterSpacing = '0.03em';
    subtitle.style.textTransform = 'uppercase';

    header.appendChild(titleEl);
    header.appendChild(subtitle);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = cards.length === 1 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))';
    grid.style.gap = '12px';
    grid.style.overflow = 'visible';

    cards.forEach((card) => {
      const wrapper = document.createElement('div');
      wrapper.style.border = '1px solid rgba(148, 163, 184, 0.28)';
      wrapper.style.borderRadius = '14px';
      wrapper.style.padding = '8px';
      wrapper.style.background = 'rgba(15, 23, 42, 0.35)';
      wrapper.style.overflow = 'visible';
      wrapper.style.minHeight = '120px';
      wrapper.style.maxWidth = '100%';

      const cloned = card.cloneNode(true);
      cloned.querySelectorAll?.('button, input, textarea, select').forEach((el) => {
        el.setAttribute('disabled', 'true');
      });
      cloned.style.margin = '0';
      cloned.style.transform = 'none';
      cloned.style.maxHeight = 'none';
      cloned.style.overflow = 'visible';
      cloned.style.width = '100%';

      const maxChildHeight = 780;
      cloned.querySelectorAll?.('*').forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const st = window.getComputedStyle(node);
        if (st.overflowY === 'auto' || st.overflowY === 'scroll') {
          node.style.overflowY = 'visible';
          node.style.maxHeight = `${maxChildHeight}px`;
        }
      });

      wrapper.appendChild(cloned);
      grid.appendChild(wrapper);
    });

    board.appendChild(header);
    board.appendChild(grid);
    document.body.appendChild(board);
    return true;
  }, boardTitle);
}

async function clickTab(page, tabLabel) {
  const candidates = [
    `button:has-text("${tabLabel}")`,
    `a:has-text("${tabLabel}")`,
    `[role="tab"]:has-text("${tabLabel}")`,
    `[role="button"]:has-text("${tabLabel}")`,
    `*:has-text("${tabLabel}")`,
  ];

  for (const selector of candidates) {
    const el = page.locator(selector).first();
    if (await el.count()) {
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: 3000, force: true });
      return true;
    }
  }

  const looseText = page.getByText(tabLabel, { exact: false }).first();
  if (await looseText.count()) {
    await looseText.scrollIntoViewIfNeeded();
    await looseText.click({ timeout: 3000, force: true });
    return true;
  }

  return false;
}

async function clickTabPill(page, tabLabel) {
  const pill = page.locator('.tab-pill').filter({ hasText: tabLabel }).first();
  if (await pill.count()) {
    await pill.scrollIntoViewIfNeeded();
    await pill.click({ timeout: 3000, force: true });
    return true;
  }
  return false;
}

async function waitForPanelReady(page) {
  for (let i = 0; i < 40; i += 1) {
    let busy = false;
    for (const phrase of BLOCKING_LOADING_PHRASES) {
      const visible = await page.getByText(phrase, { exact: false }).first().isVisible().catch(() => false);
      if (visible) {
        busy = true;
        break;
      }
    }

    if (!busy) {
      const spinnerVisible = await page.locator('.animate-spin:visible, [aria-busy="true"]:visible').first().isVisible().catch(() => false);
      if (spinnerVisible) {
        busy = true;
      }
    }

    if (!busy) {
      return;
    }
    await page.waitForTimeout(600);
  }
}

async function hasBlockingLoader(page) {
  for (const phrase of BLOCKING_LOADING_PHRASES) {
    const visible = await page.getByText(phrase, { exact: false }).first().isVisible().catch(() => false);
    if (visible) {
      return true;
    }
  }

  const spinnerVisible = await page.locator('.animate-spin:visible, [aria-busy="true"]:visible').first().isVisible().catch(() => false);
  return spinnerVisible;
}

async function saveStableShot(page, fileName) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await settle(page);
    await waitForPanelReady(page);

    if (!(await hasBlockingLoader(page))) {
      await saveShot(page, fileName);
      return;
    }

    await page.waitForTimeout(1000);
  }

  // Take a final shot even when some components keep polling/loading forever.
  await saveShot(page, fileName);
}

async function saveFocusedShot(page, fileName, boardTitle) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await settle(page);
    await waitForPanelReady(page);

    if (!(await hasBlockingLoader(page))) {
      const built = await buildCaptureBoard(page, boardTitle);
      if (built) {
        const board = page.locator('#card-capture-board');
        await board.waitFor({ state: 'visible', timeout: 3000 });
        await saveLocatorShot(board, fileName);
        await removeCaptureBoard(page);
        return;
      }
    }

    await page.waitForTimeout(1000);
  }

  await removeCaptureBoard(page);
  await saveStableShot(page, fileName);
}

async function openAndCapture(page, tabLabel, fileName) {
  const opened = await clickTab(page, tabLabel);
  if (!opened) {
    console.warn(`Tab not found: ${tabLabel}`);
    return false;
  }
  await settle(page);
  await waitForPanelReady(page);

  if (fileName === 'trade-desk-risk.png') {
    for (let i = 0; i < 20; i += 1) {
      const stillLoading = await page.getByText('Loading positions...', { exact: false }).first().isVisible().catch(() => false);
      if (!stillLoading) {
        break;
      }
      await page.waitForTimeout(800);
    }
  }

  await saveFocusedShot(page, fileName, tabLabel);
  return true;
}

async function capture() {
  await ensureDir();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1728, height: 972 } });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await settle(page);
    await waitForDashboard(page);
    await settle(page);
    await waitForPanelReady(page);

    await saveFocusedShot(page, 'home.png', 'Home');

    await openAndCapture(page, 'Trade Desk', 'trade-desk-signals.png');

    const strategyOpened = await clickTabPill(page, 'Strategy');
    if (strategyOpened) {
      await saveFocusedShot(page, 'trade-desk-strategy.png', 'Trade Desk - Strategy');
    } else {
      console.warn('Tab not found: Strategy');
    }

    const riskOpened = await clickTabPill(page, 'Risk');
    if (riskOpened) {
      await saveFocusedShot(page, 'trade-desk-risk.png', 'Trade Desk - Risk');
    } else {
      console.warn('Tab not found: Risk');
    }

    await openAndCapture(page, 'Portfolio', 'portfolio.png');
    await openAndCapture(page, 'Watchlists', 'watchlists.png');
    await openAndCapture(page, 'Sim Portfolios', 'sim-portfolios.png');

    await openAndCapture(page, 'Strategies', 'strategies-performance.png');
    const strategyConfigOpened = await clickTabPill(page, 'Configuration');
    if (strategyConfigOpened) {
      await saveFocusedShot(page, 'strategies-configuration.png', 'Strategies - Configuration');
    } else {
      console.warn('Tab not found: Configuration');
    }

    await openAndCapture(page, 'Tools', 'tools-summary.png');
    await openAndCapture(page, 'Backtest', 'tools-backtest.png');

    await openAndCapture(page, 'Forex Desk', 'forex-desk.png');
    await openAndCapture(page, 'Crypto Desk', 'crypto-desk.png');
    await openAndCapture(page, 'Research', 'research.png');

    await openAndCapture(page, 'Operations', 'operations-trading-log.png');
    await openAndCapture(page, 'Bot Activity', 'operations-bot-activity.png');

    await openAndCapture(page, 'Bot Configuration', 'bot-configuration.png');

    console.log('Capture complete.');
  } finally {
    await browser.close();
  }
}

capture().catch((error) => {
  console.error('Capture failed:', error);
  process.exit(1);
});
