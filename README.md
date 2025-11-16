# Marketo Landing Page Builder (Simplified)

A lightweight local development workflow for building modular Marketo landing page templates.

* Modular HTML templates using `include`
* Auto-discovered SCSS per module
* YAML-driven content variables (`${varName}`)
* Dev output with hot-loaded CSS
* Final Marketo export with inlined CSS/JS and Marketo variables
* Works on macOS or Windows

## Install

Run in the project root:

```
npm install
```

## Development

### Terminal 1 – Builder

```
npm run dev
```

This:

* Watches templates, SCSS, JS, and content
* Rebuilds on change
* Outputs to `dist/index.dev.html` and `dist/styles.css`

### Terminal 2 – BrowserSync

```
npm run serve
```

This:

* Serves the `dist/` folder at [http://localhost:3000](http://localhost:3000)
* Injects CSS on change
* Reloads the browser when HTML changes

Open:

```
http://localhost:3000/index.dev.html
```

## Build (Final Marketo Output)

```
npm run build
```

Produces:

* `dist/index.marketo.html` (inlined CSS & JS + Marketo variables)

This file is ready to paste into Marketo as a Guided Landing Page template.

## Project Structure

```
templates/
  partials/
    header.tmpl.html
    footer.tmpl.html
  modules/
    side-by-side/
      index.tmpl.html
      index.scss
src/
  scss/
    index.scss
content/
  content.yaml
index.tmpl.html
builder.mjs
dist/
```

## Templates

### Includes

```
include templates/partials/header.tmpl.html
include templates/modules/side-by-side/index.tmpl.html
```

If an included file is missing, the builder injects:

```
<!-- INCLUDE ERROR: path not found -->
```

### Variables

Defined in `content.yaml`:

```
pageTitle: "Landing Page"
sideBySideHeading: "Heading"
```

Used in templates:

```
<h1>${sideBySideHeading}</h1>
```

## Loops

```
<ul>
for i < 3
  <li>${featureHeading${i}}</li>
endfor
</ul>
```

YAML:

```
featureHeading0: "One"
featureHeading1: "Two"
featureHeading2: "Three"
```

## SCSS

* Global SCSS entry: `src/scss/index.scss`
* Any `index.scss` under `templates/**/` is auto-included

Output file (dev):

```
dist/styles.css
```

CSS is hot-loaded during development.
