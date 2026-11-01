# Notebook Markdown dependencies

Pinned browser distributions copied from the official npm packages:

- Marked 18.1.2 — https://github.com/markedjs/marked — MIT (`marked-LICENSE`).
- DOMPurify 3.4.17 — https://github.com/cure53/DOMPurify — Apache-2.0 OR MPL-2.0 (`dompurify-LICENSE`).
- Turndown 7.2.4 — https://github.com/mixmark-io/turndown — MIT (`turndown-LICENSE`).
- Vditor 4.0.1 — https://github.com/Vanessa219/vditor — MIT (`vditor-4.0.1/LICENSE`), including its bundled Lute engine, Chinese UI and light/dark content themes. The app uses only its single-pane instant-rendering (`ir`) mode.

These files are served locally so Markdown notes remain usable without a CDN.
Markdown output must pass through DOMPurify before being assigned to the DOM.
