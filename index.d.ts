// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

// ─────────────────────────────────────────────────────────────────────────────
// Locator types
// ─────────────────────────────────────────────────────────────────────────────

/** A CSS selector locator: `orbit.css('.my-class')` */
export interface CssLocator {
  css: string;
}

/** An XPath locator: `orbit.xpath('//button[@type="submit"]')` */
export interface XPathLocator {
  xpath: string;
}

/** An ARIA role locator: `orbit.getByRole('button', 'Submit')` */
export interface RoleLocator {
  role: string;
  name?: string;
}

/** An element attribute locator: `orbit.getByAttribute('data-testid', 'submit-btn')` */
export interface AttributeLocator {
  attribute: string;
  value?: string;
}

/** A positional locator: `orbit.nth(locator, 2)` */
export interface NthLocator {
  type: 'nth';
  locator: Locator;
  index: number;
}

/** A proximity locator: `orbit.near(target, anchor)` */
export interface NearLocator {
  type: 'near';
  target: Locator;
  anchor: Locator;
}

/**
 * A locator identifies one or more elements on the page.
 *
 * The simplest form is a plain string — OrbitTest treats it as
 * human-readable intent and finds the best matching element:
 *
 * ```ts
 * await orbit.click('Sign in');
 * await orbit.click(orbit.css('#submit-btn'));
 * await orbit.click(orbit.getByRole('button', 'Submit'));
 * ```
 */
export type Locator =
  | string
  | CssLocator
  | XPathLocator
  | RoleLocator
  | AttributeLocator
  | NthLocator
  | NearLocator;

// ─────────────────────────────────────────────────────────────────────────────
// Option interfaces
// ─────────────────────────────────────────────────────────────────────────────

/** Shared timeout options. Both `timeout` and `timeoutMs` are accepted. */
export interface TimeoutOptions {
  /** Timeout in milliseconds. */
  timeout?: number;
  /** Alias for `timeout`. */
  timeoutMs?: number;
}

/** Options shared by all element-locating actions. */
export interface ActionOptions extends TimeoutOptions {
  /** Whether to emit a log entry for this action (default: true). */
  log?: boolean;
  /** Separate timeout for the locator resolution step. */
  locatorTimeout?: number;
  /** Alias for `locatorTimeout`. */
  locatorTimeoutMs?: number;
}

/** Options for click / doubleClick / rightClick actions. */
export interface ClickOptions extends ActionOptions {
  /** Wait for a navigation to begin after the click (default: auto-detected). */
  waitForNavigation?: boolean;
  /** Timeout for navigation detection in milliseconds. */
  navigationTimeout?: number;
  /** Alias for `navigationTimeout`. */
  navigationTimeoutMs?: number;
  /** Timeout for the navigation itself in milliseconds. */
  navigationDetectionTimeout?: number;
  /** Alias for `navigationDetectionTimeout`. */
  navigationDetectionTimeoutMs?: number;
  /** Skip waiting for any post-click activity (default: false). */
  noWaitAfter?: boolean;
}

/** Options for the `type()` action. */
export interface TypeOptions extends ActionOptions {
  /** Delay between keystrokes in milliseconds (simulates human typing). */
  delay?: number;
  /** Alias for `delay`. */
  delayMs?: number;
}

/** Options for `all()` / `elements()`. */
export interface AllOptions extends ActionOptions {
  /** Return an empty array instead of throwing when no elements are found. */
  allowEmpty?: boolean;
}

/** Options for wait-based queries. */
export interface WaitOptions extends TimeoutOptions {
  /** Polling interval in milliseconds. */
  interval?: number;
  /** Alias for `interval`. */
  intervalMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain object types
// ─────────────────────────────────────────────────────────────────────────────

/** A browser dialog (alert, confirm, or prompt). */
export interface Dialog {
  id: number;
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultPrompt?: string;
  url?: string;
  openedAt: string;
  closedAt?: string;
  handled: boolean;
  handledAt?: string;
  handledBy?: string;
}

/** Metadata for a browser window or tab. */
export interface WindowInfo {
  index: number;
  id: string;
  title: string;
  url: string;
  active: boolean;
}

/** A 2D coordinate on the page. */
export interface Point {
  x: number;
  y: number;
}

/** A pixel sampled from the page, including RGBA colour components. */
export interface Pixel extends Point {
  deviceX: number;
  deviceY: number;
  r: number;
  g: number;
  b: number;
  a: number;
  /** Hex colour string, e.g. `'#1a2b3c'`. */
  hex: string;
}

/** Current URL and title of the active page. */
export interface PageState {
  url: string;
  title: string;
}

/** A node snapshot returned by `OrbitShadow.all()`. */
export interface ShadowNode {
  type: 'shadowNode';
  backendNodeId: number;
  index: number;
  tag: string;
  text: string;
  visible: boolean;
  attributes: Record<string, string>;
}

/** Current browser notification permission state. */
export type NotificationPermission =
  | 'default'
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'unknown';

export interface OrbitMobileConfig {
  provider?: string;
  platform?: 'android';
  adbPath?: string;
  deviceSerial?: string | null;
  apk?: string | null;
  appPackage?: string | null;
  appActivity?: string | null;
  artifactsDir?: string;
  screenshotOnFailure?: boolean;
  logcatOnFailure?: boolean;
  uiDumpOnFailure?: boolean;
  defaultTimeoutMs?: number;
}

export interface OrbitMobileContext {
  readonly __orbittestMobile: true;
  installApp(apkPath?: string): Promise<void>;
  uninstallApp(packageName?: string): Promise<void>;
  launchApp(packageName?: string, activity?: string): Promise<void>;
  stopApp(packageName?: string): Promise<void>;
  clearAppData(packageName?: string): Promise<void>;
  isAppInstalled(packageName?: string): Promise<boolean>;
  tap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, durationMs?: number): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs?: number): Promise<void>;
  scrollDown(amount?: number): Promise<void>;
  scrollUp(amount?: number): Promise<void>;
  typeText(text: string): Promise<void>;
  clearText(): Promise<void>;
  sleep(ms: number): Promise<void>;
  pressKey(code: number): Promise<void>;
  tapText(text: string, options?: { exact?: boolean; timeoutMs?: number }): Promise<void>;
  tapById(resourceId: string, options?: { timeoutMs?: number }): Promise<void>;
  tapByDescription(description: string, options?: { exact?: boolean; timeoutMs?: number }): Promise<void>;
  getScreenSize(): Promise<{ width: number; height: number }>;
  dumpUi(): Promise<unknown[]>;
  getScreenText(): Promise<string>;
  hasText(text: string, options?: { exact?: boolean }): Promise<boolean>;
  waitForText(text: string, timeoutMs?: number): Promise<void>;
  waitForId(resourceId: string, timeoutMs?: number): Promise<void>;
  waitForGoneText(text: string, timeoutMs?: number): Promise<void>;
  getCurrentActivity(): Promise<string>;
  getCurrentPackage(): Promise<string>;
  screenshot(): Promise<Buffer>;
  saveScreenshot(path: string): Promise<void>;
  compareScreenshot(
    baselinePath: string,
    options?: { threshold?: number; diffPath?: string }
  ): Promise<{ pass: boolean; diffPixels: number; diffPath?: string }>;
  clearLogcat(): Promise<void>;
  getLogcat(filter?: string): Promise<string[]>;
  saveLogcat(path: string, filter?: string): Promise<void>;
  wakeUp(): Promise<void>;
  sleepScreen(): Promise<void>;
  isScreenOn(): Promise<boolean>;
  getAndroidVersion(): Promise<string>;
  getModel(): Promise<string>;
  adb(args: string[]): Promise<string>;
  shell(command: string | string[]): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Window selector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identifies a window or tab. Accepts:
 * - `number` — index in the window list
 * - `string` — exact URL or title
 * - `RegExp` — pattern matched against URL or title
 * - `(window) => boolean` — predicate function
 * - object — fine-grained match criteria
 */
export type WindowSelector =
  | number
  | string
  | RegExp
  | ((window: WindowInfo) => boolean)
  | {
      index?: number;
      id?: string;
      url?: string;
      title?: string;
      timeout?: number;
      switchTo?: boolean;
      excludeCurrent?: boolean;
      interval?: number;
      intervalMs?: number;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Test infrastructure types
// ─────────────────────────────────────────────────────────────────────────────

/** Per-test options passed to `test()`. */
export interface TestOptions {
  /** Number of times to retry a failing test. */
  retries?: number;
  /** Override the global test timeout (ms) for this test. */
  timeout?: number;
  /** Skip this test. */
  skip?: boolean;
}

/** A serialised JavaScript error captured in a test result. */
export interface SerializedError {
  message: string;
  stack?: string;
  name?: string;
}

/**
 * Information about the currently-running test, passed to
 * `beforeEach` and `afterEach` hooks.
 */
export interface TestInfo {
  name: string;
  file: string;
  /** 1-based position in the run. */
  index: number;
  /** Current attempt number (1 = first run, 2 = first retry, …). */
  attempt: number;
  /** Number of retries completed so far. */
  retry: number;
  /** Total retries allowed. */
  retries: number;
  timeout: number;
  status: 'running' | 'passed' | 'failed';
  phase: 'beforeEach' | 'test' | 'afterEach';
  startedAt: string;
  endedAt: string;
  durationMs: number;
  error: SerializedError | null;
  afterEachError: SerializedError | null;
  artifacts: Record<string, unknown>;
}

/** Compact test result included in `RunInfo`. */
export interface TestResult {
  name: string;
  file: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  durationMs: number;
  attempts: number;
  message: string | null;
}

/**
 * Run-level information passed to `beforeAll` and `afterAll` hooks,
 * and returned by `run()`.
 */
export interface RunInfo {
  runId: string;
  status: 'running' | 'passed' | 'failed';
  startedAt: string;
  endedAt: string;
  durationMs: number;
  reportsDir: string;
  workers: number;
  retries: number;
  testTimeout: number;
  browserDisplay: string;
  ci: Record<string, unknown>;
  shard: { current: number; total: number } | null;
  totalDiscoveredTests: number;
  selectedTests: number;
  testFiles: string[];
  tests: TestInfo[];
  results: TestResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Assertion type
// ─────────────────────────────────────────────────────────────────────────────

/** Assertion handle returned by `expect()`. */
export interface Expect<T = unknown> {
  /** Negate the next matcher. */
  not: Expect<T>;
  /** Strict equality (`===`). */
  toBe(expected: T): void;
  /** Deep equality (JSON comparison). */
  toEqual(expected: T): void;
  /** String inclusion check. */
  toContain(expected: string): void;
  /** Passes when value is truthy. */
  toBeTruthy(): void;
  /** Mobile matcher: waits for text on the current Android screen. */
  toHaveText(text: string, options?: number | { exact?: boolean; timeoutMs?: number }): Promise<void>;
  /** Mobile matcher: waits for a UIAutomator resource-id. */
  toHaveId(resourceId: string, options?: number | { timeoutMs?: number }): Promise<void>;
  /** Mobile matcher: compares the current device screenshot with a baseline image. */
  toMatchScreenshot(
    baselinePath: string,
    options?: { threshold?: number; diffPath?: string }
  ): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// OrbitTest config
// ─────────────────────────────────────────────────────────────────────────────

/** Full shape of `orbittest.config.js`. Use with `defineConfig()` for IDE support. */
export interface OrbitConfig {
  /** Directory to search for test files (default: `"tests"`). */
  testDir?: string;
  /** Glob patterns for test files (default: `["**​/*.test.js", "**​/*.spec.js"]`). */
  testMatch?: string[];
  /** Directory for test reports (default: `"reports"`). */
  reportsDir?: string;
  /** Setup files loaded once before any tests run. */
  globalSetup?: string | string[];
  /** Default number of parallel workers (default: `1`). */
  workers?: number;
  /** Maximum number of parallel workers (default: `4`). */
  maxWorkers?: number;
  /** Default retry count for failing tests (default: `0`). */
  retries?: number;
  /** Default test timeout in milliseconds (default: `30000`). */
  testTimeout?: number;
  /** Default action timeout in milliseconds; `0` = no limit (default: `0`). */
  actionTimeout?: number;
  browser?: {
    /** Browser window visibility (default: `"auto"` — hidden in CI, visible locally). */
    display?: 'auto' | 'show' | 'hide';
  };
  use?: {
    web?: false | {
      browser?: 'chrome' | string;
      headless?: boolean;
    };
    mobile?: OrbitMobileConfig | false | null;
  };
  /** Enable smart failure diagnostics (console errors, slow requests, JS exceptions). */
  smartReport?: boolean;
  /** Threshold in ms for flagging slow network requests in smart reports (default: `2000`). */
  smartReportSlowRequestMs?: number;
  reportRetention?: {
    keepLatest?: boolean;
    passedRuns?: number;
    failedRuns?: number;
    maxAgeDays?: number;
    autoCleanup?: boolean;
  };
  openReportOnFailure?: {
    enabled?: boolean;
    host?: string;
    port?: number;
    ttlMs?: number;
    openBrowser?: boolean;
  };
  ci?: {
    /** Enable CI mode (default: auto-detected from `process.env.CI`). */
    enabled?: boolean;
    retries?: number;
    trace?: 'on' | 'off' | 'on-failure';
    screenshot?: 'on' | 'off' | 'on-failure';
    failFast?: boolean;
    maxFailures?: number;
    /** Shard selector, e.g. `"1/4"`. */
    shard?: string | { current: number; total: number } | null;
    summary?: boolean;
    junit?: boolean;
    githubAnnotations?: boolean;
  };
  experimental?: {
    ui?: boolean;
    /** @deprecated Use `ui` instead. */
    studio?: boolean;
    visualAutomation?: boolean;
    apiTesting?: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orbit constructor options
// ─────────────────────────────────────────────────────────────────────────────

/** Options passed to `new Orbit(options)`. */
export interface OrbitConstructorOptions {
  /** Default timeout applied to every action (ms). */
  actionTimeout?: number;
  /** Browser window visibility. */
  browserDisplay?: 'show' | 'hide' | 'auto';
  trace?: {
    enabled: boolean;
    dir: string;
    testName?: string;
    testFile?: string;
    attempt?: number;
  };
  smartReport?: {
    enabled: boolean;
    slowRequestMs?: number;
  };
  debug?: {
    enabled: boolean;
    pauseBeforeActions?: boolean;
    pauseBeforeClose?: boolean;
  };
  verbose?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared context interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The common interaction surface shared by `Orbit`, `OrbitFrame`, and
 * `OrbitShadow`. Any action you can perform on the main page can also be
 * performed inside a frame or shadow root using the same method names.
 */
export interface OrbitContext {
  // ── Locator builders ──────────────────────────────────────────────────────

  /** Create a CSS selector locator. */
  css(selector: string): CssLocator;
  /** Create an XPath locator. */
  xpath(selector: string): XPathLocator;
  /** Find an element by its ARIA role and optional accessible name. */
  getByRole(role: string, name?: string): RoleLocator;
  /** Find an element by an HTML attribute and optional value. */
  getByAttribute(name: string, value?: string): AttributeLocator;
  /** Find `target` that is visually near `anchor`. */
  near(target: Locator, anchor: Locator): NearLocator;
  /** Alias for `near()` — find `target` within the region of `anchor`. */
  within(anchor: Locator, target: Locator): NearLocator;
  /** Select the element at `index` from all matches (0-based; -1 = last). */
  nth(locator: Locator, index: number): NthLocator;
  /** Select the first matching element. */
  first(locator: Locator): NthLocator;
  /** Select the last matching element. */
  last(locator: Locator): NthLocator;

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Click an element. */
  click(locator: Locator, options?: ClickOptions): Promise<void>;
  /** Double-click an element. */
  doubleClick(locator: Locator, options?: ActionOptions): Promise<void>;
  /** Right-click an element. */
  rightClick(locator: Locator, options?: ActionOptions): Promise<void>;
  /** Move the mouse over an element without clicking. */
  hover(locator: Locator, options?: ActionOptions): Promise<void>;
  /** Type `value` into a form field. */
  type(locator: Locator, value: string, options?: TypeOptions): Promise<void>;

  // ── Queries ───────────────────────────────────────────────────────────────

  /** Return `true` if a matching element exists and is visible. */
  exists(locator: Locator, options?: ActionOptions): Promise<boolean>;
  /** Return `true` if `text` appears anywhere in the current scope. */
  hasText(text: string, options?: ActionOptions): Promise<boolean>;
  /** Return the visible text content of a matched element. */
  text(locator: Locator, options?: ActionOptions): Promise<string>;
  /** Return only visible (non-hidden) text of a matched element. */
  visibleText(locator: Locator, options?: ActionOptions): Promise<string>;
  /** Return the full DOM text content of a matched element. */
  domText(locator: Locator, options?: ActionOptions): Promise<string>;
  /** Return all matching elements. */
  all(locator?: Locator, options?: AllOptions): Promise<unknown[]>;
  /** Alias for `all()`. */
  elements(locator?: Locator, options?: AllOptions): Promise<unknown[]>;

  // ── Waits ─────────────────────────────────────────────────────────────────

  /** Wait until a matching element exists and is visible. */
  waitFor(locator: Locator, options?: WaitOptions): Promise<boolean>;
  /** Wait until `text` appears anywhere in the current scope. */
  waitForText(text: string, options?: WaitOptions): Promise<void>;

  // ── Evaluation ────────────────────────────────────────────────────────────

  /**
   * Evaluate a JavaScript expression or function in the page context.
   *
   * ```ts
   * const count = await orbit.evaluate(() => document.querySelectorAll('li').length);
   * ```
   */
  evaluate<T = unknown>(
    expressionOrFunction: string | ((...args: unknown[]) => T),
    ...args: unknown[]
  ): Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// OrbitFrame — scoped iframe context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An `OrbitFrame` is returned by `orbit.frame()` and provides the same
 * action API as `Orbit`, scoped to the target iframe.
 *
 * ```ts
 * const panel = await orbit.frame(orbit.getByAttribute('title', 'Checkout'));
 * await panel.click('Pay now');
 *
 * // Or use the context-manager style:
 * await orbit.withFrame(orbit.getByAttribute('title', 'Checkout'), async frame => {
 *   await frame.click('Pay now');
 * });
 * ```
 */
export interface OrbitFrame extends OrbitContext {
  /**
   * Navigate into a nested iframe within this frame.
   * Pass an array of locators to traverse multiple levels at once.
   */
  frame(locatorOrPath: Locator | Locator[], options?: ActionOptions): Promise<OrbitFrame>;

  /**
   * Run `fn` scoped to a nested iframe, then automatically return to
   * the parent context.
   */
  withFrame<T>(
    locatorOrPath: Locator | Locator[],
    fn: (frame: OrbitFrame) => Promise<T>,
    options?: ActionOptions
  ): Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// OrbitShadow — scoped shadow DOM context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An `OrbitShadow` is returned by `orbit.shadow()` and provides the same
 * action API as `Orbit`, scoped to the target shadow root.
 *
 * ```ts
 * const card = await orbit.shadow(orbit.css('action-card'));
 * await card.click('Submit');
 *
 * // Or use the context-manager style:
 * await orbit.withShadow(orbit.css('action-card'), async shadow => {
 *   await shadow.click('Submit');
 * });
 * ```
 */
export interface OrbitShadow extends OrbitContext {
  /**
   * `all()` inside a shadow root returns rich `ShadowNode` snapshots
   * instead of raw DOM references.
   */
  all(locator?: Locator, options?: AllOptions): Promise<ShadowNode[]>;
  /** Alias for `all()`. */
  elements(locator?: Locator, options?: AllOptions): Promise<ShadowNode[]>;

  /**
   * Navigate into a nested shadow root.
   * Pass an array of locators to traverse multiple levels at once.
   */
  shadow(locatorOrPath: Locator | Locator[], options?: ActionOptions): Promise<OrbitShadow>;

  /**
   * Run `fn` scoped to a nested shadow root, then automatically return to
   * the parent context.
   */
  withShadow<T>(
    locatorOrPath: Locator | Locator[],
    fn: (shadow: OrbitShadow) => Promise<T>,
    options?: ActionOptions
  ): Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orbit — main class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The main OrbitTest automation class.
 *
 * ```ts
 * import Orbit, { test, expect } from 'orbittest';
 *
 * test('user can sign in', async orbit => {
 *   await orbit.open('https://example.com');
 *   await orbit.click('Sign in');
 *   await orbit.type('Email', 'user@example.com');
 *   await orbit.click('Continue');
 *   expect(await orbit.hasText('Welcome')).toBe(true);
 * });
 * ```
 */
export declare class Orbit implements OrbitContext {
  constructor(options?: OrbitConstructorOptions);

  // ── Locator builders (OrbitContext) ───────────────────────────────────────

  css(selector: string): CssLocator;
  xpath(selector: string): XPathLocator;
  getByRole(role: string, name?: string): RoleLocator;
  getByAttribute(name: string, value?: string): AttributeLocator;
  near(target: Locator, anchor: Locator): NearLocator;
  within(anchor: Locator, target: Locator): NearLocator;
  nth(locator: Locator, index: number): NthLocator;
  first(locator: Locator): NthLocator;
  last(locator: Locator): NthLocator;

  // ── Browser lifecycle ─────────────────────────────────────────────────────

  /** Launch the browser. Called automatically by the test runner. */
  launch(): Promise<void>;
  /** Close the browser and release resources. */
  close(): Promise<void>;

  // ── Navigation ────────────────────────────────────────────────────────────

  /** Navigate to a URL. */
  open(url: string, options?: ActionOptions): Promise<void>;
  /** Return the current page URL. */
  url(options?: ActionOptions): Promise<string>;
  /** Return the current page title. */
  title(options?: ActionOptions): Promise<string>;
  /** Return the current URL and title as a single object. */
  pageState(options?: ActionOptions): Promise<PageState>;

  // ── Actions (OrbitContext) ────────────────────────────────────────────────

  click(locator: Locator, options?: ClickOptions): Promise<void>;
  doubleClick(locator: Locator, options?: ActionOptions): Promise<void>;
  rightClick(locator: Locator, options?: ActionOptions): Promise<void>;
  hover(locator: Locator, options?: ActionOptions): Promise<void>;
  type(locator: Locator, value: string, options?: TypeOptions): Promise<void>;

  // ── Queries (OrbitContext) ────────────────────────────────────────────────

  exists(locator: Locator, options?: ActionOptions): Promise<boolean>;
  hasText(text: string, options?: ActionOptions): Promise<boolean>;
  text(locator: Locator, options?: ActionOptions): Promise<string>;
  visibleText(locator: Locator, options?: ActionOptions): Promise<string>;
  domText(locator: Locator, options?: ActionOptions): Promise<string>;
  all(locator?: Locator, options?: AllOptions): Promise<unknown[]>;
  elements(locator?: Locator, options?: AllOptions): Promise<unknown[]>;

  // ── Waits (OrbitContext) ──────────────────────────────────────────────────

  waitFor(locator: Locator, options?: WaitOptions): Promise<boolean>;
  waitForText(text: string, options?: WaitOptions): Promise<void>;
  /** Pause execution for `ms` milliseconds. */
  wait(ms: number): Promise<void>;

  // ── Evaluation (OrbitContext) ─────────────────────────────────────────────

  evaluate<T = unknown>(
    expressionOrFunction: string | ((...args: unknown[]) => T),
    ...args: unknown[]
  ): Promise<T>;

  /**
   * Evaluate with an explicit args array. Useful when passing complex
   * values or targeting a specific frame context.
   */
  evaluateOnPage<T = unknown>(
    expressionOrFunction: string | ((...args: unknown[]) => T),
    args?: unknown[],
    options?: ActionOptions & { contextId?: string }
  ): Promise<T>;

  // ── Frames ────────────────────────────────────────────────────────────────

  /**
   * Return an `OrbitFrame` scoped to the matched iframe.
   * Pass an array of locators to traverse nested frames in one call.
   */
  frame(locatorOrPath: Locator | Locator[], options?: ActionOptions): Promise<OrbitFrame>;

  /**
   * Run `fn` scoped to an iframe, then automatically return to the
   * main page context.
   */
  withFrame<T>(
    locatorOrPath: Locator | Locator[],
    fn: (frame: OrbitFrame) => Promise<T>,
    options?: ActionOptions
  ): Promise<T>;

  // ── Shadow DOM ────────────────────────────────────────────────────────────

  /**
   * Return an `OrbitShadow` scoped to the matched shadow root.
   * Pass an array of locators to traverse nested shadow roots in one call.
   */
  shadow(locatorOrPath: Locator | Locator[], options?: ActionOptions): Promise<OrbitShadow>;

  /**
   * Run `fn` scoped to a shadow root, then automatically return to the
   * main page context.
   */
  withShadow<T>(
    locatorOrPath: Locator | Locator[],
    fn: (shadow: OrbitShadow) => Promise<T>,
    options?: ActionOptions
  ): Promise<T>;

  // ── Screenshots & visual ──────────────────────────────────────────────────

  /** Capture the current page and save it to `filePath`. */
  screenshot(filePath: string, options?: { handleDialogs?: boolean }): Promise<void>;

  /**
   * Sample the RGBA colour of a single pixel at the given coordinates.
   *
   * ```ts
   * const pixel = await orbit.readVisualPixel({ x: 100, y: 200 });
   * console.log(pixel.hex); // '#3a7bd5'
   * ```
   */
  readVisualPixel(
    point: Point | [number, number],
    options?: { devicePixels?: boolean }
  ): Promise<Pixel>;

  /** Return the device pixel ratio (DPR) of the active browser context. */
  getDeviceScaleFactor(): Promise<number>;

  // ── Dialogs ───────────────────────────────────────────────────────────────

  /** Wait for a browser dialog (alert / confirm / prompt) to appear. */
  waitForAlert(options?: TimeoutOptions): Promise<Dialog>;
  /** Return the text of the most recent dialog. */
  alertText(options?: { includeHandled?: boolean }): Promise<string>;
  /** Accept the current dialog. */
  acceptAlert(options?: TimeoutOptions): Promise<Dialog>;
  /** Dismiss the current dialog. */
  dismissAlert(options?: TimeoutOptions): Promise<Dialog>;
  /** Accept or dismiss the current dialog. */
  handleAlert(
    options?: TimeoutOptions & { accept?: boolean; promptText?: string }
  ): Promise<Dialog>;

  // ── Notification permissions ──────────────────────────────────────────────

  /** Grant the `notifications` permission for the given origin. */
  grantNotifications(
    originOrOptions?: string | { origin?: string; timeout?: number }
  ): Promise<{ origin: string; permission: 'granted' }>;

  /** Deny the `notifications` permission for the given origin. */
  denyNotifications(
    originOrOptions?: string | { origin?: string; timeout?: number }
  ): Promise<{ origin: string; permission: 'denied' }>;

  /** Reset the `notifications` permission to the browser default. */
  resetNotificationPermission(
    originOrOptions?: string | { origin?: string; timeout?: number }
  ): Promise<{ origin: string; permission: 'default' }>;

  /** Return the current `notifications` permission state. */
  getNotificationPermission(): Promise<NotificationPermission>;

  // ── Window / tab management ───────────────────────────────────────────────

  /** List all open windows/tabs. */
  windows(): Promise<WindowInfo[]>;
  /** List all open windows/tabs (alias with optional options). */
  listWindows(options?: ActionOptions): Promise<WindowInfo[]>;
  /** Open a new window and optionally navigate to `url`. */
  newWindow(url?: string, options?: { switchTo?: boolean }): Promise<WindowInfo>;
  /** Wait for a new window to open and return its info. */
  waitForWindow(options?: WindowSelector | TimeoutOptions): Promise<WindowInfo>;
  /** Switch focus to a different window. */
  switchToWindow(selector?: WindowSelector): Promise<WindowInfo>;
  /** Close a window. Defaults to the current window when `selector` is omitted. */
  closeWindow(selector?: WindowSelector | null, options?: { switchTo?: boolean }): Promise<WindowInfo>;

  // ── Page content ──────────────────────────────────────────────────────────

  /** Return the full HTML source of the current page. */
  getHTML(options?: ActionOptions): Promise<string>;
}

export interface WebPageContext extends Orbit {
  goto(url: string, options?: ActionOptions): Promise<void>;
  clickText(text: string, options?: ClickOptions): Promise<void>;
  typeText(locator: Locator, value: string, options?: TypeOptions): Promise<void>;
}

export interface TestContext extends Orbit {
  /** Web page context. Alias-friendly wrapper around the existing Orbit web API. */
  page: WebPageContext;
  /** Alias for `page`. */
  web: WebPageContext;
  /** Mobile device context when `use.mobile` is configured. */
  orbit: OrbitMobileContext | null;
  /** Alias for `orbit`. */
  mobile: OrbitMobileContext | null;
  testInfo: TestInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test lifecycle functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a test.
 *
 * ```ts
 * test('user can log in', async orbit => {
 *   await orbit.open('https://example.com/login');
 *   await orbit.click('Sign in');
 * });
 * ```
 */
export declare function test(
  name: string,
  fn: (orbit: TestContext) => Promise<void>
): void;
export declare function test(
  name: string,
  options: TestOptions,
  fn: (orbit: TestContext) => Promise<void>
): void;

/** Group tests while preserving OrbitTest's lightweight registration model. */
export declare function describe(name: string, fn: () => void): void;

/**
 * Create an assertion.
 *
 * ```ts
 * expect(await orbit.text('h1')).toBe('Welcome back');
 * ```
 */
export declare function expect<T>(actual: T): Expect<T>;

/**
 * Register a hook that runs once before any test in the file.
 * Receives a `RunInfo` snapshot.
 */
export declare function beforeAll(
  fn: (runInfo: RunInfo) => Promise<void>
): void;

/**
 * Register a hook that runs once after all tests in the file complete.
 * Receives a `RunInfo` snapshot with final results.
 */
export declare function afterAll(
  fn: (runInfo: RunInfo) => Promise<void>
): void;

/**
 * Register a hook that runs before each individual test.
 * Receives the `Orbit` instance and `TestInfo` for that test.
 */
export declare function beforeEach(
  fn: (orbit: TestContext, testInfo: TestInfo) => Promise<void>
): void;

/**
 * Register a hook that runs after each individual test, whether it
 * passed or failed. Receives the `Orbit` instance and `TestInfo`.
 */
export declare function afterEach(
  fn: (orbit: TestContext, testInfo: TestInfo) => Promise<void>
): void;

/**
 * Run all registered tests programmatically (used by the CLI).
 * Returns a `RunInfo` object with the final results.
 */
export declare function run(options?: Partial<OrbitConfig>): Promise<RunInfo>;

// ─────────────────────────────────────────────────────────────────────────────
// Config helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type-safe wrapper for `orbittest.config.js`. Provides full IDE autocomplete
 * on every config option without changing runtime behaviour.
 *
 * ```js
 * // orbittest.config.js
 * const { defineConfig } = require('orbittest');
 *
 * module.exports = defineConfig({
 *   workers: 2,
 *   retries: 1,
 *   ci: { trace: 'on-failure' }
 * });
 * ```
 */
export declare function defineConfig(config: OrbitConfig): OrbitConfig;

// ─────────────────────────────────────────────────────────────────────────────
// Default export
// ─────────────────────────────────────────────────────────────────────────────

export default Orbit;
