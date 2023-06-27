import fs from "fs";
import sourceMaps from "rollup-plugin-sourcemaps";
import typescript from "rollup-plugin-typescript2";
import dts from "rollup-plugin-dts";

import pkg from "./package.json" assert { type: "json" };

const extensions = [".ts"];
const externalDeps = [
    "cosmiconfig",
    "jest-puppeteer",
    "jest",
    "path",
    "react-dom/server",
    "ts-jest/presets",
    "url",
    "vite",
];

/**
 * @type {import('rollup').RollupOptions}
 */
const config = [
    {
        input: "./src/testbro.ts",
        output: [
            { file: pkg.main, format: "cjs", sourcemap: true },
            { file: pkg.module, format: "es", sourcemap: true },
        ],
        external: externalDeps,
        plugins: [
            typescript({
                useTsconfigDeclarationDir: true,
                tsconfig: "tsconfig.json",
            }),
            sourceMaps(),
        ],
    },
    {
        input: "./dist/dts/src/testbro.d.ts",
        output: [{ file: "dist/testbro.d.ts", format: "es" }],
        // rolls up all dts files into a single dts file
        // so that internal types don't leak
        plugins: [dts()],
    },
    {
        input: "./src/jest-preset.ts",
        output: [
            {
                file: "./dist/jest-preset/jest-preset.cjs",
                format: "cjs",
                sourcemap: true,
            },
        ],
        external: externalDeps,
        plugins: [
            typescript({
                useTsconfigDeclarationDir: true,
                tsconfig: "tsconfig.json",
            }),
            sourceMaps(),
        ],
    },
    {
        input: "./src/cli.ts",
        output: [
            {
                file: "./dist/cli.js",
                format: "es",
                sourcemap: true,
                banner: "#!/usr/bin/env node\n",
            },
        ],
        external: externalDeps,
        plugins: [
            typescript({
                useTsconfigDeclarationDir: true,
                tsconfig: "tsconfig.json",
            }),
            sourceMaps(),
            // Making the cli executable
            {
                name: "chmod",
                writeBundle() {
                    fs.promises.chmod("./dist/cli.js", "755");
                },
            },
        ],
    },
];

export default config;
