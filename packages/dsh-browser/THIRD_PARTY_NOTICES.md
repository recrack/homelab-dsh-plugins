# Third-party notices

`dsh-browser` uses [Playwright Core](https://github.com/microsoft/playwright),
copyright Microsoft Corporation, under the Apache License 2.0.

The optional Camoufox engine uses the TypeScript launcher from
[Camoufox](https://github.com/daijro/camoufox), copyright its contributors,
under the MIT License. Its bundled `THIRD_PARTY_NOTICES.md` carries notices for
its NumPy and PCG code. The browser downloaded by the optional secure image is
under the Mozilla Public License 2.0; the corresponding source is published in
the Camoufox repository.

The fingerprint model is provided by [fpgen-js](https://github.com/JWriter20/fpgen-js)
under the Apache License 2.0. Its package includes the complete license and
attribution notice. The optional image downloads model data from the fpgen
release; that data remains under its upstream terms.

The dependencies' complete license and notice files are distributed inside
their npm packages. The standard DSH Browser package does not bundle a browser;
the secure deployment's optional Camoufox image downloads the pinned browser
build during image construction.
