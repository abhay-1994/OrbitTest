// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  run,
  defineConfig
} from './index';
export type { OrbitMobileContext, TestInfo, TestOptions } from './index';

export declare const Key: Readonly<{
  HOME: 3;
  BACK: 4;
  ENTER: 66;
  DEL: 67;
  APP_SWITCH: 187;
  POWER: 26;
  VOLUME_UP: 24;
  VOLUME_DOWN: 25;
}>;

export declare function test(
  name: string,
  fn: (orbit: import('./index').OrbitMobileContext, testInfo: import('./index').TestInfo) => Promise<void>
): void;

export declare function test(
  name: string,
  options: import('./index').TestOptions,
  fn: (orbit: import('./index').OrbitMobileContext, testInfo: import('./index').TestInfo) => Promise<void>
): void;

export declare const it: typeof test;
