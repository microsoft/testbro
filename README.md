# Testbro

_BEWARE: Work-in-progress._

## Unittest-like testing in the browser.

Typically, we might have unittests which allow to test atomic parts of the code in a mocked environment. And we might have more complex integration tests which allow to test complex real life scenarios in the real browser environment.

**Testbro** allows to write unittests and run them in the real browser environment.

## Example

A test looks like:

```TypeScript
import * as React from "react";
import { Testbro, bootstrapTestbroPage } from "testbro";

describe("Sample test", () => {
  beforeEach(async () => {
    await bootstrapTestbroPage("index.html");
  });

  it("puts a button on the page and checks it is tabbable", async () => {
    await new Testbro(
      (
        <div>
          <button>Button1</button>
        </div>
      )
    )
      .pressTab()
      .activeElement((el) => {
        expect(el?.textContent).toEqual("Button1");
      });
  });
});
```

Under the hood, `index.html` will be loaded in the browser, a simple DOM with `<button>` will be pushed as the contents of the page's <body>, `Tab` key will be pressed and the test will check if the button has focus.

## API

Here be dragons.

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
