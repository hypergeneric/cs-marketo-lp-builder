# Marketo Landing Page Builder

## 1. Overview

This repository contains a lightweight static build system designed specifically for creating Marketo-compatible landing pages. It resolves several longstanding pain points with Marketo's native authoring environment and provides a clean, modern, modular developer workflow.

What this builder solves:

* **No more editing directly inside Marketo.** Marketo’s editor is brittle, hostile to HTML structure, and prone to unintended mutations. This builder keeps all authoring local, version-controlled, and predictable.
* **Local, modular development.** Templates, modules, and content pieces are composed using includes, loops, and YAML-driven variables. Changes are instant and isolated.
* **Fast feedback loop with hot reloading.** BrowserSync injects CSS on the fly and reloads HTML automatically.
* **Automated Marketo variable generation.** Any `${var}` used in templates automatically becomes a validated `<meta class="mktoString" ...>` (or number/boolean/color/img/html equivalent). This produces a CMS-like authoring experience without adding heavy tooling.
* **Final output always Marketo‑safe.** The build system handles escaping, modifier stripping, inline CSS, meta tag creation, and output normalization.

Key features:

* Template includes (`include path/to/file.html`)
* Loop expansion (`for i < 3 ... endfor`)
* YAML-driven content variables (`content/content.yaml`)
* Safe variable modifiers (`${tag|html}`, `${tag|attr}`, `${tag|number}`, etc.)
* Automatic Marketo meta tag generation
* Dual-output pipeline: development preview + Marketo-compliant final HTML
* Live reload via BrowserSync during development
* Automatic inclusion of SCSS modules and JS bundles
* Inlined, minified CSS for Marketo builds

This builder intentionally avoids heavy dependencies. The entire system is implemented in a single script (`builder.mjs`) and a simple folder structure.

---

## 2. Installation

Clone the repository and install local dependencies:

```bash
npm install
```

Directory structure:

```
/
  builder.mjs
  index.tmpl.html
  content/
    content.yaml
  templates/
  src/
    scss/
    js/
  dist/ (dev output)
  final/ (Marketo output)
```

Nothing else is required.

---

## 3. Running Commands

### Build once (dev + Marketo output)

```bash
npm run build
```

This generates:

* `dist/index.html` — development preview (external CSS)
* `dist/styles.css` — compiled stylesheet
* `final/index.marketo.html` — Marketo-ready template (inline CSS + meta tags)

### Watch mode (auto rebuild + BrowserSync)

```bash
npm run dev
```

This runs:

* The builder in watch mode
* BrowserSync serving `/dist`

Behavior:

* SCSS changes → only CSS rebuild (`styles.css`), injected live
* Template / JS / YAML changes → full rebuild

### Preview

Visit:

```
http://localhost:3000
```

---

## 4. Development Concepts

This builder uses a minimal templating syntax designed for clarity and predictability.

### 4.1 Includes

Inside any HTML template:

```html
include templates/sections/hero.html
```

The included content is spliced directly into the output.

### 4.2 Content YAML

`content/content.yaml` provides named values used in your templates.

```yaml
metaTitle: "Welcome to the Falcon Trial"
heroHeading: "Try Falcon Free"
heroBlurb: |
  <p>Protect your endpoints quickly...</p>
```

These are referenced in templates with `${var}` syntax:

```html
<h1>${heroHeading}</h1>
<p>${heroBlurb|html}</p>
```

### 4.3 Variable Modifiers

Variables may include modifiers to control escaping, Marketo typing, or behavior.

#### `${tag}`

Default string replacement.

#### `${tag|html}`

* Produces raw HTML in dev mode
* Marks the variable as `allowHTML="true"` in Marketo meta tags
* Still outputs `${tag}` inside the Marketo template (Marketo will substitute it later)

#### `${tag|attr}`

Escapes attribute values safely:

```html
<button data-tip="${tooltip|attr}">
```

#### `${tag|number}` / `${tag|boolean}` / `${tag|color}` / `${tag|image}`

Assigns Marketo type information:

* `mktoNumber`
* `mktoBoolean`
* `mktoColor`
* `mktoImg`

These affect only the generated meta tags, not dev rendering.

### 4.4 Looping

Loops allow simple repetition without needing JS.

```
for i < 3
  <li>${i}</li>
endfor
```

Produces:

```
<li>0</li>
<li>1</li>
<li>2</li>
```

Loop variables are numeric only and expand before variable substitution.

Loops work alongside `include`, so you can use the loop index to pull in more complex child templates:

```html
for index < 3
  include templates/modules/products/card-options-${index}.tmpl.html
endfor
```

This allows you to keep each card or section as its own template file while still generating repeated structures from a single parent template.

### 4.5 SCSS Modules

The builder automatically discovers SCSS modules under `templates/`.

Any file matching:

* `templates/**/index.scss`

will be compiled and merged into the main CSS bundle. This allows each template/module to carry its own styles without manual wiring.

Example structure:

```
templates/
  modules/
    hero/
      hero.html
      index.scss
    features/
      features.html
      index.scss
```

All `index.scss` files are included in both `dist/styles.css` (dev) and the inlined CSS in `final/index.marketo.html`.

---

This builder is intentionally minimalist but flexible. It is designed to be safe for Marketo ingestion while still providing a productive local development experience.
