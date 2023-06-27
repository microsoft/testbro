/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { fileURLToPath } from "url";
import { join } from "path";
import jest from "jest";
import { Config } from "@jest/types";
import { createServer } from "vite";
import { cosmiconfigSync } from "cosmiconfig";
import { TestbroConfig } from "./testbro";

const moduleName = "testbro";

// const projectRootDir = join(process.cwd());
const testbroRootDir = fileURLToPath(new URL("..", import.meta.url));
const jestPresetPath = join(testbroRootDir, "dist", "jest-preset");
const JEST_PUPPETEER_CONFIG = join(testbroRootDir, "jest-puppeteer.config.cjs");

let testbroConfig: TestbroConfig;

const configExplorerSync = cosmiconfigSync(moduleName, {
    searchPlaces: [
        `${moduleName}.config.json`,
        `${moduleName}.config.js`,
        `${moduleName}.config.cjs`,
    ],
});
const configSearchedFor = configExplorerSync.search();

if (configSearchedFor?.config && !configSearchedFor.isEmpty) {
    testbroConfig = configSearchedFor.config;
} else {
    console.error(`No ${moduleName} config found.`);
    process.exit(1);
}

process.env.TESTBRO_PORT = `${parseInt(process.env.PORT || "0", 10) || 8080}`;
process.env.TESTBRO_TESTS_DIR = testbroConfig.testsDir;

const devServer = await (async () => {
    const server = await createServer({
        configFile: false,
        root: testbroConfig.testsDir,
        server: {
            port: parseInt(process.env.TESTBRO_PORT || "8080", 10),
        },
        optimizeDeps: {
            include: [],
        },
    });

    await server.listen();

    // server.printUrls();

    return server;
})();

process.env.JEST_PUPPETEER_CONFIG = JEST_PUPPETEER_CONFIG;

const jestConfig: Config.Argv = {
    $0: "unused",
    _: [],
    testRegex: testbroConfig.testRegex,
    rootDir: testbroConfig.testsDir,
    preset: jestPresetPath,
};

await jest.runCLI(jestConfig, [process.cwd()]).then(
    (result) => process.exit(result.results.success ? 0 : 1),
    (reason) => {
        console.error(reason?.message ?? reason);
        process.exit(1);
    }
);

devServer?.close();
