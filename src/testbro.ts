/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { join } from "path";
import { EvaluateFunc, Page, Frame, KeyInput } from "puppeteer";

export interface TestbroConfig {
    testsDir: string;
    testRegex: string | string[];
}

export type JSONArray = readonly Serializable[];
export interface JSONObject {
    [key: string]: Serializable;
}
export type Serializable =
    | number
    | string
    | boolean
    | null
    | bigint
    | JSONArray
    | JSONObject;

// Importing the production version so that React doesn't complain in the test output.
// declare function require(name: string): any;
// const renderToStaticMarkup: (element: React.ReactElement) => string =
//     require("react-dom/cjs/react-dom-server.node.production.min").renderToStaticMarkup;

import { renderToStaticMarkup } from "react-dom/server";

declare const page: Page;

let _lastRnd = 0;

async function goToPageWithRetry(htmlFilename: string, times: number) {
    if (times === 0) {
        throw new Error("Failed to connect to the page after multiple retries");
    }

    const url = `http://localhost:${
        process.env.TESTBRO_PORT
    }/${htmlFilename}?rnd=${++_lastRnd}`;

    try {
        const response = await page.goto(url);

        if (!response?.ok()) {
            throw new Error(
                `Failed to load ${join(
                    process.env.TESTBRO_TESTS_DIR || "",
                    htmlFilename
                )}: ${response?.statusText()}`
            );
        }
    } catch (err) {
        console.error("Failed to connect to test page", url);
        console.error(err);
        await new Promise((res) => setTimeout(res, 3000));
        await goToPageWithRetry(htmlFilename, times - 1);
    }
}

interface WindowWithConsoleErrors extends Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __consoleErrors?: any[][];
}

async function waitPageReadyAndDecorateConsoleError(
    frame: Page | Frame,
    readyFunc?: () => Promise<boolean>
): Promise<void> {
    await frame.$("body");
    await frame.evaluate(() => {
        const win = window as WindowWithConsoleErrors;

        if (!win.__consoleErrors) {
            win.__consoleErrors = [];

            const origConsoleError = console.error;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            console.error = function (...args: any[]) {
                origConsoleError.apply(console, args);
                win.__consoleErrors?.push(args.map((a) => `${a}`));
            };
        }
    });

    if (readyFunc) {
        await frame.waitForFunction(readyFunc);
    }
}

export async function bootstrapTestbroPage(
    htmlFilename: string,
    readyFunc?: () => Promise<boolean>
) {
    await goToPageWithRetry(htmlFilename, 4);
    await waitPageReadyAndDecorateConsoleError(page, readyFunc);
}

async function sleep(time: number) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true);
        }, time);
    });
}

export interface BrowserElement {
    tag: string;
    textContent: string | null;
    attributes: { [name: string]: string };
}

interface TestbroFrameStackItem {
    id: string;
    frame: Page | Frame;
}

abstract class TestbroItem {
    protected _frameStack: TestbroFrameStackItem[];

    constructor(frameStack: TestbroFrameStackItem[]) {
        this._frameStack = frameStack;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abstract run(): Promise<any>;
}

class TestbroItemEval extends TestbroItem {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _func: EvaluateFunc<any>;
    private _args: Serializable[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _setLastEval: (lastEval: any) => void;

    constructor(
        frameStack: TestbroFrameStackItem[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        func: EvaluateFunc<any>,
        args: Serializable[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLastEval: (lastEval: any) => void
    ) {
        super(frameStack);
        this._func = func;
        this._args = args;
        this._setLastEval = setLastEval;
    }

    async run() {
        const lastEval = await this._frameStack[0].frame.evaluate(
            this._func,
            ...this._args
        );
        this._setLastEval(lastEval);
    }
}

class TestbroItemWait extends TestbroItem {
    private _time: number;

    constructor(frameStack: TestbroFrameStackItem[], time: number) {
        super(frameStack);
        this._time = time;
    }

    async run() {
        await this._frameStack[0].frame.evaluate((wait) => {
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve(true);
                }, wait);
            });
        }, this._time);
    }
}

class TestbroItemCallback extends TestbroItem {
    private _callback: () => Promise<void>;

    constructor(
        frameStack: TestbroFrameStackItem[],
        callback: () => Promise<void>
    ) {
        super(frameStack);
        this._callback = callback;
    }

    async run() {
        await this._callback();
    }
}

class TestbroItemHTML extends TestbroItem {
    private _html: JSX.Element;

    constructor(frameStack: TestbroFrameStackItem[], html: JSX.Element) {
        super(frameStack);
        this._html = html;
    }

    async run() {
        const frame = this._frameStack[0].frame;

        await frame.evaluate(
            (el, html) => (el ? (el.innerHTML = html) : null),
            await frame.$("body"),
            renderToStaticMarkup(this._html)
        );
        await sleep(100);
    }
}

class TestbroItemFrame extends TestbroItem {
    private _id: string;

    constructor(frameStack: TestbroFrameStackItem[], id: string) {
        super(frameStack);
        this._id = id;
    }

    async run() {
        const frameHandle = await this._frameStack[0].frame.$(
            `iframe[id='${this._id}']`
        );

        if (frameHandle) {
            const frame = await frameHandle.contentFrame();

            if (frame) {
                this._frameStack.unshift({ id: this._id, frame });
                await waitPageReadyAndDecorateConsoleError(frame);
                return;
            }
        }

        throw new Error(
            `<iframe id="${this._id}"> is not available${
                this._frameStack.length > 1
                    ? ` in <iframe id="${this._frameStack[0].id}">`
                    : ""
            }`
        );
    }
}

class TestbroItemUnframe extends TestbroItem {
    private _levels: number;

    constructor(frameStack: TestbroFrameStackItem[], levels = 1) {
        super(frameStack);
        this._levels = levels;
    }

    async run() {
        while (this._levels-- > 0) {
            if (this._frameStack.length > 1) {
                this._frameStack.shift();
            } else {
                throw new Error("Not enough levels to unframe");
            }
        }
    }
}

class TestbroItemReportConsoleErrors extends TestbroItem {
    private _throwError?: boolean;

    constructor(frameStack: TestbroFrameStackItem[], throwError?: boolean) {
        super(frameStack);
        this._throwError = throwError;
    }

    async run() {
        const consoleErrors = await this._frameStack[0].frame.evaluate(() => {
            const win = window as WindowWithConsoleErrors;
            const ret = win.__consoleErrors || [];
            win.__consoleErrors = [];
            return ret;
        });

        if (consoleErrors && consoleErrors.length) {
            const errorMessage = `Had ${
                consoleErrors.length
            } console.error() calls in the browser:\n${consoleErrors
                .map(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (err: any[], index: number) =>
                        `${index + 1}. ${err.join(" ")}`
                )
                .join("\n")}`;

            console.error(errorMessage);

            if (this._throwError) {
                throw new Error(errorMessage);
            }
        }
    }
}

class TestbroItemRepeat extends TestbroItem {
    private _callback: () => void;

    constructor(frameStack: TestbroFrameStackItem[], callback: () => void) {
        super(frameStack);
        this._callback = callback;
    }

    async run() {
        this._callback();
    }
}

export class Testbro implements PromiseLike<undefined> {
    private _chain: TestbroItem[] = [];
    private _repeatChainsBuilding: TestbroItem[][] = [];
    private _repeatChainsRunning: TestbroItem[][] = [];
    private _repeatStartTimes: number[] = [];
    private _prevChains: TestbroItem[][] = [];
    private _repeats: number[] = [];
    private _nextTimer: number | undefined;
    private _promise: Promise<undefined>;
    private _resolve:
        | ((value?: undefined | PromiseLike<undefined>) => void)
        | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _reject: ((reason?: any) => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _lastEval: any;
    private _frameStack: TestbroFrameStackItem[];

    constructor(html?: JSX.Element) {
        this._promise = new Promise<undefined>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });

        this._frameStack = [{ id: "_top", frame: page }];

        if (html) {
            this.html(html);
        }

        this._next();
    }

    then<TResult1 = undefined, TResult2 = never>(
        onfulfilled?: // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((value: any) => TResult1 | PromiseLike<TResult1>) | undefined | null,
        onrejected?: // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): Promise<TResult1 | TResult2> {
        return this._promise.then(onfulfilled, onrejected);
    }

    catch<TResult = never>(
        onrejected?: // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
    ): Promise<undefined | TResult> {
        return this._promise.catch(onrejected);
    }

    finally(onfinally?: (() => void) | undefined | null): Promise<undefined> {
        return this._promise.finally(onfinally);
    }

    private _next() {
        if (this._nextTimer) {
            clearTimeout(this._nextTimer);
        }

        this._nextTimer = setTimeout(async () => {
            delete this._nextTimer;

            if (this._repeatChainsBuilding.length) {
                this._reject?.(
                    new Error(
                        "repeatBegin() is missing corresponding repeatEnd()"
                    )
                );
            }

            const item = this._chain.shift();

            if (item) {
                await item.run().catch((reason) => {
                    if (this._reject) {
                        this._reject(reason);
                    }
                });
                this._next();
            } else if (this._resolve) {
                this._resolve();
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }, 0) as any;
    }

    private _reportConsoleErrors(throwError?: boolean): void {
        this._chain.push(
            new TestbroItemReportConsoleErrors(this._frameStack, throwError)
        );
    }

    html(html: JSX.Element) {
        this._chain.push(new TestbroItemHTML(this._frameStack, html));
        return this;
    }

    frame(...id: string[]) {
        for (const i of id) {
            this._chain.push(new TestbroItemFrame(this._frameStack, i));
        }
        return this;
    }

    unframe(levels = 1) {
        this._chain.push(new TestbroItemUnframe(this._frameStack, levels));
        return this;
    }

    wait(time: number) {
        this._chain.push(new TestbroItemWait(this._frameStack, time));
        this._reportConsoleErrors(true);
        return this;
    }

    /**
     * @param time - in milliseconds
     */
    debug(time = 3600000) {
        jest.setTimeout(time);
        return this.wait(time);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eval(func: EvaluateFunc<any>, ...args: Serializable[]): Testbro {
        this._chain.push(
            new TestbroItemEval(
                this._frameStack,
                func,
                args,
                (lastEval) => (this._lastEval = lastEval)
            )
        );

        this._reportConsoleErrors(true);

        return this;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    check(callback: (lastEval: any) => void) {
        this._chain.push(
            new TestbroItemCallback(this._frameStack, async () => {
                callback(this._lastEval);
            })
        );

        return this;
    }

    press(
        key: KeyInput,
        options?:
            | {
                  text?: string | undefined;
                  delay?: number | undefined;
                  ctrl?: boolean;
                  shift?: boolean;
                  alt?: boolean;
                  meta?: boolean;
              }
            | undefined
    ) {
        this._chain.push(
            new TestbroItemCallback(this._frameStack, async () => {
                const { shift, ctrl, alt, meta } = options ?? {};

                if (shift) {
                    await page.keyboard.down("Shift");
                }

                if (ctrl) {
                    await page.keyboard.down("Control");
                }

                if (alt) {
                    await page.keyboard.down("Alt");
                }

                if (meta) {
                    await page.keyboard.down("Meta");
                }

                await page.keyboard.press(key, options);

                if (shift) {
                    await page.keyboard.up("Shift");
                }

                if (ctrl) {
                    await page.keyboard.up("Control");
                }

                if (alt) {
                    await page.keyboard.up("Alt");
                }

                if (meta) {
                    await page.keyboard.up("Meta");
                }
            })
        );

        this._reportConsoleErrors(true);

        return this;
    }

    private _pressKey(
        key: KeyInput,
        shift?: boolean,
        ctrl?: boolean,
        alt?: boolean,
        meta?: boolean
    ) {
        this._chain.push(
            new TestbroItemCallback(this._frameStack, async () => {
                if (shift) {
                    await page.keyboard.down("Shift");
                }

                if (ctrl) {
                    await page.keyboard.down("Control");
                }

                if (alt) {
                    await page.keyboard.down("Alt");
                }

                if (meta) {
                    await page.keyboard.down("Meta");
                }

                await page.keyboard.press(key);

                if (shift) {
                    await page.keyboard.up("Shift");
                }

                if (ctrl) {
                    await page.keyboard.up("Control");
                }

                if (alt) {
                    await page.keyboard.up("Alt");
                }

                if (meta) {
                    await page.keyboard.up("Meta");
                }
            })
        );

        this._reportConsoleErrors(true);

        return this;
    }

    /**
     * Simulates user click on an element
     * This cannot be `element.click()` because native clicks on focusable elements will focus them
     */
    click(selector: string) {
        this._chain.push(
            new TestbroItemCallback(this._frameStack, async () => {
                await this._frameStack[0].frame.click(selector);
            })
        );

        this._reportConsoleErrors();

        return this;
    }

    pressTab(
        shiftKey?: boolean,
        ctrlKey?: boolean,
        altKey?: boolean,
        metaKey?: boolean
    ) {
        return this._pressKey("Tab", shiftKey, ctrlKey, altKey, metaKey);
    }
    pressEsc(
        shiftKey?: boolean,
        ctrlKey?: boolean,
        altKey?: boolean,
        metaKey?: boolean
    ) {
        return this._pressKey("Escape", shiftKey, ctrlKey, altKey, metaKey);
    }
    pressEnter(
        shiftKey?: boolean,
        ctrlKey?: boolean,
        altKey?: boolean,
        metaKey?: boolean
    ) {
        return this._pressKey("Enter", shiftKey, ctrlKey, altKey, metaKey);
    }
    pressUp(
        shiftKey?: boolean,
        ctrlKey?: boolean,
        altKey?: boolean,
        metaKey?: boolean
    ) {
        return this._pressKey("ArrowUp", shiftKey, ctrlKey, altKey, metaKey);
    }
    pressDown(
        shiftKey?: boolean,
        ctrlKey?: boolean,
        altKey?: boolean,
        metaKey?: boolean
    ) {
        return this._pressKey("ArrowDown", shiftKey, ctrlKey, altKey, metaKey);
    }
    pressLeft(
        shiftKey?: boolean,
        ctrlKey?: boolean,
        altKey?: boolean,
        metaKey?: boolean
    ) {
        return this._pressKey("ArrowLeft", shiftKey, ctrlKey, altKey, metaKey);
    }
    pressRight(
        shiftKey?: boolean,
        ctrlKey?: boolean,
        altKey?: boolean,
        metaKey?: boolean
    ) {
        return this._pressKey("ArrowRight", shiftKey, ctrlKey, altKey, metaKey);
    }

    scrollTo(selector: string, x: number, y: number) {
        this._chain.push(
            new TestbroItemCallback(this._frameStack, async () => {
                await page.waitForSelector(selector);
                await page.evaluate(
                    (selector: string, x: number, y: number) => {
                        const scrollContainer: HTMLElement | null =
                            document.querySelector(selector);
                        scrollContainer?.scroll(x, y);
                    },
                    selector,
                    x,
                    y
                );
            })
        );

        return this;
    }

    activeElement(callback: (activeElement: BrowserElement | null) => void) {
        this._chain.push(
            new TestbroItemCallback(this._frameStack, async () => {
                const activeElement = await this._frameStack[0].frame.evaluate(
                    () => {
                        const ae = document.activeElement;

                        if (ae && ae !== document.body) {
                            const attributes: BrowserElement["attributes"] = {};

                            for (const name of ae.getAttributeNames()) {
                                const val = ae.getAttribute(name);

                                if (val !== null) {
                                    attributes[name] = val;
                                }
                            }

                            const ret: BrowserElement = {
                                tag: ae.tagName.toLowerCase(),
                                textContent: ae.textContent,
                                attributes,
                            };
                            return ret;
                        }

                        return null;
                    }
                );

                callback(activeElement);
            })
        );

        this._reportConsoleErrors(true);

        return this;
    }

    removeElement(selector?: string, async = false) {
        this._chain.push(
            new TestbroItemCallback(this._frameStack, async () => {
                await this._frameStack[0].frame.evaluate(
                    (selector: string, async?: boolean) => {
                        const el = selector
                            ? document.querySelector(selector)
                            : document.activeElement;

                        if (el && el.parentElement) {
                            if (async) {
                                setTimeout(
                                    () => el.parentElement?.removeChild(el),
                                    0
                                );
                            } else {
                                el.parentElement.removeChild(el);
                            }
                        }
                    },
                    selector || "",
                    async
                );
            })
        );

        this._reportConsoleErrors(true);

        return this;
    }

    focusElement(selector: string) {
        this._chain.push(
            new TestbroItemCallback(this._frameStack, async () => {
                await this._frameStack[0].frame.evaluate((selector: string) => {
                    const el = document.querySelector(selector);
                    if (!el) {
                        throw new Error(
                            `focusElement: could not find element with selector ${selector}`
                        );
                    }

                    // TODO remove this if ever switching to cypress
                    // tslint:disable-next-line
                    // https://github.com/cypress-io/cypress/blob/56234e52d6d1cbd292acdfd5f5d547f0c4706b51/packages/driver/src/cy/focused.js#L101
                    let hasFocused = false;
                    const onFocus = () => (hasFocused = true);

                    el.addEventListener("focus", onFocus);
                    (el as HTMLElement).focus();
                    el.removeEventListener("focus", onFocus);

                    // only simulate the focus events if the element was sucessfully focused
                    if (!hasFocused && document.activeElement === el) {
                        const focusinEvt = new FocusEvent("focusin", {
                            bubbles: true,
                            view: window,
                            relatedTarget: null,
                        });

                        const focusEvt = new FocusEvent("focus", {
                            view: window,
                            relatedTarget: null,
                        });

                        el.dispatchEvent(focusinEvt);
                        el.dispatchEvent(focusEvt);
                    }
                }, selector);
            })
        );

        this._reportConsoleErrors(true);

        return this;
    }

    repeatBegin(repeats: number) {
        if (repeats < 1) {
            this._reject?.(
                new Error("repeatBegin() must be called with repeats > 0")
            );

            return this;
        }

        const chain: TestbroItem[] = [];

        this._chain.push(
            new TestbroItemRepeat(this._frameStack, () => {
                this._prevChains.push(this._chain);
                this._repeatChainsRunning.unshift(chain);
                this._chain = chain.slice(0);
                this._repeats.unshift(repeats - 1);
                this._repeatStartTimes.unshift(performance.now());
            })
        );

        this._repeatChainsBuilding.push(this._chain);
        this._chain = chain;

        return this;
    }

    repeatEnd(stats?: (time: number) => void) {
        const chain = this._repeatChainsBuilding.pop();

        if (!chain) {
            this._reject?.(
                new Error("repeatEnd() is missing corresponding repeatBegin()")
            );

            return this;
        }

        this._chain.push(
            new TestbroItemRepeat(this._frameStack, () => {
                const fullChain = this._repeatChainsRunning[0];
                const repeats = this._repeats[0];

                if (!fullChain || repeats === undefined) {
                    throw new Error("Something went wrong, repeat chain error");
                }

                if (repeats > 0) {
                    this._chain = fullChain.slice(0);
                    this._repeats[0]--;
                } else {
                    this._repeatChainsRunning.shift();
                    this._repeats.shift();
                    const startTime = this._repeatStartTimes.shift();

                    const prevChain = this._prevChains.pop();

                    if (!prevChain || startTime === undefined) {
                        throw new Error(
                            "Something went wrong, repeat chain error"
                        );
                    }

                    stats?.(performance.now() - startTime);

                    this._chain = prevChain;
                }
            })
        );

        this._chain = chain;

        return this;
    }
}
