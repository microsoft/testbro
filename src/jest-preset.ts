/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { default as tsJestPresets } from "ts-jest/presets";
import { default as puppeteerPreset } from "jest-puppeteer";

export default Object.assign(tsJestPresets.jsWithBabel, puppeteerPreset);
