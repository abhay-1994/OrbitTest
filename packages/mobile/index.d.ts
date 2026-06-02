export type OrbitMobileConfig = {
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
  projectRoot?: string;
};

export type UiNode = {
  text: string;
  resourceId: string;
  className: string;
  packageName: string;
  contentDescription: string;
  clickable: boolean;
  enabled: boolean;
  bounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  center: {
    x: number;
    y: number;
  };
};

export declare const Key: {
  readonly HOME: 3;
  readonly BACK: 4;
  readonly ENTER: 66;
  readonly DEL: 67;
  readonly APP_SWITCH: 187;
  readonly POWER: 26;
  readonly VOLUME_UP: 24;
  readonly VOLUME_DOWN: 25;
};

export declare class OrbitDevice {
  readonly __orbittestMobile: true;
  constructor(config?: OrbitMobileConfig);
  installApp(apkPath?: string): Promise<void>;
  uninstallApp(packageName?: string): Promise<void>;
  launchApp(packageName?: string, activity?: string): Promise<void>;
  resolveLaunchActivity(packageName?: string): Promise<string | null>;
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
  pressKey(code: number): Promise<void>;
  tapText(text: string, options?: { exact?: boolean; timeoutMs?: number }): Promise<void>;
  tapById(resourceId: string, options?: { timeoutMs?: number }): Promise<void>;
  tapByDescription(description: string, options?: { exact?: boolean; timeoutMs?: number }): Promise<void>;
  getScreenSize(): Promise<{ width: number; height: number }>;
  dumpUi(): Promise<UiNode[]>;
  dumpUiXml(): Promise<string>;
  parseUiXml(xml: string): UiNode[];
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

export declare function createMobileContext(options?: {
  config?: OrbitMobileConfig;
}): Promise<{
  orbit: OrbitDevice;
  close(): Promise<void>;
  captureFailureArtifacts(args: unknown): Promise<unknown>;
  captureReportArtifacts(args: unknown): Promise<unknown>;
}>;

export declare function captureFailureArtifacts(args: unknown): Promise<unknown>;

export declare function captureReportArtifacts(args: unknown): Promise<unknown>;

export declare function listDevices(config?: OrbitMobileConfig): Promise<Array<{
  serial: string;
  state: string;
  model: string;
  androidVersion?: string;
}>>;

export declare function doctor(config?: OrbitMobileConfig): Promise<Array<{
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}>>;
