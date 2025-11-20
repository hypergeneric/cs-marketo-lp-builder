// builder.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import chokidar from "chokidar";
import * as sass from "sass";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT       = __dirname;
const SRC_DIR    = path.join(ROOT, "src");
const TPL_DIR    = path.join(ROOT, "templates");
const CONTENT_DIR= path.join(ROOT, "content");
const DIST_DIR   = path.join(ROOT, "dist");
const MARKETO_DIR = path.join(ROOT, "final");

function ensureDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function ensureDistDir() {
	ensureDir(DIST_DIR);
}

function ensureMarketoDir() {
	ensureDir(MARKETO_DIR);
}

function readFile(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

function resolveIncludes(filePath, seen = new Set()) {
	const absPath = path.resolve(ROOT, filePath);

	// If the root file itself is missing, just emit an error stub
	if (!fs.existsSync(absPath)) {
		const rel = path.relative(ROOT, absPath);
		return `\n<div style="border:1px red dotted">INCLUDE ERROR: ${rel} not found</div>\n`;
	}

	if (seen.has(absPath)) {
		return "";
	}

	seen.add(absPath);

	let content = readFile(absPath);
	content = expandLoops(content);

	const includeRegex = /^(\s*)include\s+(.+)$/gm;

	content = content.replace(includeRegex, (match, indent, includePathRaw) => {
		const includePath = includePathRaw.trim();
		const includeAbs  = path.resolve(ROOT, includePath);

		if (!fs.existsSync(includeAbs)) {
			const rel = path.relative(ROOT, includeAbs);
			console.error(`[builder] INCLUDE ERROR: ${rel} not found`);
			const stub = `<div style="border:1px red dotted">INCLUDE ERROR: ${rel} not found</div>`;
			return indent + stub; // or just `stub` if you don't care about stub indent either
		}

		const included = resolveIncludes(includeAbs, seen);

		// no re-indenting, just splice the file in unchanged
		return included;
	});

	return content;
}

function loadContentYaml() {
	const contentPath = path.join(CONTENT_DIR, "content.yaml");
	if (!fs.existsSync(contentPath)) {
		return {};
	}

	const raw = readFile(contentPath);
	const data = YAML.parse(raw) || {};
	return data;
}

function escapeHtml(str) {
	if (!str) {
		return "";
	}

	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function applyVariables(html, contentMap, mode) {
	const varMeta  = {};
	const varRegex = /\$\{([a-zA-Z0-9_-]+)(\|[a-zA-Z0-9_-]+)?\}/g;

	function registerVar(varName, modifierRaw) {
		const modifier = (modifierRaw || "").replace(/^\|/, "").toLowerCase();

		let type      = "string"; // string | number | boolean | color | img
		let allowHTML = false;

		switch (modifier) {
			case "html":
				allowHTML = true;          // mktoString + allowHTML="true"
				break;
			case "number":
				type = "number";           // mktoNumber
				break;
			case "boolean":
				type = "boolean";          // mktoBoolean
				break;
			case "color":
				type = "color";            // mktoColor
				break;
			case "image":
				type = "img";              // mktoImg
				break;
			case "attr":
				// attribute context, but still a string variable
				type = "string";
				break;
			case "":
				// default string
				break;
			default:
				console.warn(
					`[builder] Unknown modifier "${modifier}" for variable "${varName}", treating as string`
				);
		}

		const existing = varMeta[varName];

		if (!existing) {
			varMeta[varName] = { type, allowHTML };
		} else {
			// Merge type / flags; prefer the first non-string type
			if (existing.type !== type && type !== "string") {
				console.warn(
					`[builder] Conflicting Marketo types for variable "${varName}" (${existing.type} vs ${type}), keeping "${existing.type}"`
				);
			}

			if (allowHTML) {
				existing.allowHTML = true;
			}
		}

		return modifier;
	}

	const processed = html.replace(varRegex, (match, varName, modifierRaw) => {
		const modifier = registerVar(varName, modifierRaw);

		if (mode === "build") {
			// In Marketo output we want plain ${varName} (no modifier),
			// modifiers only inform the meta tag configuration.
			return "${" + varName + "}";
		}

		// Dev mode: substitute preview values from YAML
		if (Object.prototype.hasOwnProperty.call(contentMap, varName)) {
			const val = contentMap[varName];
			let rawVal;

			// Nested config object (booleans, etc.)
			if (val && typeof val === "object" && !Array.isArray(val)) {
				if (modifier === "boolean") {
					// Boolean config:
					// headerCtaClass:
					//   default: false
					//   false_value: "arrow"
					//   true_value: "box"
					const isTrue = !!val.default;
					if (isTrue) {
						rawVal = val.true_value != null ? String(val.true_value) : "true";
					} else {
						rawVal = val.false_value != null ? String(val.false_value) : "false";
					}
				} else if ("default" in val) {
					// Generic object with a default value
					rawVal = String(val.default);
				} else {
					rawVal = String(val);
				}
			} else {
				rawVal = String(val);
			}

			if (modifier === "attr") {
				// Attribute-safe escaping for things like data-* and href="..."
				return escapeHtml(rawVal);
			}

			// Default and |html etc. just get the raw YAML value
			return rawVal;
		}

		// Missing content: show a visual placeholder
		return `[${varName}]`;
	});

	return {
		html: processed,
		usedVars: varMeta       // { [varName]: { type, allowHTML } }
	};
}

function mktoNameFromId(id) {
	const spaced = id
		.replace(/[-_]+/g, " ")               // hero_heading -> "hero heading"
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2"); // heroHeading -> "hero Heading"

	return spaced
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\b\w/g, (c) => c.toUpperCase()); // "hero heading" -> "Hero Heading"
}

function generateMktoMetaTags(varsMeta, contentMap) {
	if (!varsMeta || !Object.keys(varsMeta).length) {
		return "";
	}

	const lines = [];

	for (const [varName, info] of Object.entries(varsMeta)) {
		const type      = info.type || "string";
		const allowHTML = !!info.allowHTML;

		let cls;
		switch (type) {
			case "number":
				cls = "mktoNumber";
				break;
			case "boolean":
				cls = "mktoBoolean";
				break;
			case "color":
				cls = "mktoColor";
				break;
			case "img":
				cls = "mktoImg";
				break;
			default:
				cls = "mktoString";
				break;
		}

		const rawCfg = contentMap[varName];
		let rawDefault = "";
		let cfgObject = null;

		if (rawCfg != null && typeof rawCfg === "object" && !Array.isArray(rawCfg)) {
			// Nested config object, e.g. for booleans
			cfgObject = rawCfg;

			if (Object.prototype.hasOwnProperty.call(rawCfg, "default")) {
				rawDefault = String(rawCfg.default);
			} else if (Object.prototype.hasOwnProperty.call(rawCfg, "value")) {
				rawDefault = String(rawCfg.value);
			} else {
				rawDefault = "";
			}
		} else if (rawCfg != null) {
			rawDefault = String(rawCfg);
		}

		// Escape for attribute context and normalize whitespace
		let defaultAttr = escapeHtml(rawDefault)
			.replace(/\r\n|\r|\n/g, " ")
			.replace(/\s\s+/g, " ")
			.trim();

		const mktoName = mktoNameFromId(varName);

		const attrs = [
			`class="${cls}"`,
			`id="${varName}"`,
			`mktoName="${escapeHtml(mktoName)}"`
		];

		// For string variables, enable HTML if any usage requested it
		if (allowHTML && cls === "mktoString") {
			attrs.push('allowHTML="true"');
		}

		// Boolean-specific config (false/true values and labels)
		if (cls === "mktoBoolean" && cfgObject) {
			const fv  = cfgObject.false_value;
			const tv  = cfgObject.true_value;
			const fvn = cfgObject.false_value_name;
			const tvn = cfgObject.true_value_name;

			if (fv != null) {
				attrs.push(`false_value="${escapeHtml(String(fv))}"`);
			}
			if (tv != null) {
				attrs.push(`true_value="${escapeHtml(String(tv))}"`);
			}
			if (fvn != null) {
				attrs.push(`false_value_name="${escapeHtml(String(fvn))}"`);
			}
			if (tvn != null) {
				attrs.push(`true_value_name="${escapeHtml(String(tvn))}"`);
			}
		}

		if (defaultAttr !== "") {
			attrs.push(`default="${defaultAttr}"`);
		}

		const line = `<meta ${attrs.join(" ")} />`;
		lines.push(line);
	}

	return lines.join("\n");
}

function injectMktoMeta(html, metaBlock) {
	if (!metaBlock) {
		return html;
	}

	// Preferred: insert immediately after <head ...>
	const headRegex = /<head[^>]*>/i;
	const headMatch = html.match(headRegex);

	if (headMatch) {
		const headTag = headMatch[0];
		const idx     = html.indexOf(headTag) + headTag.length;
		return html.slice(0, idx) + "\n" + metaBlock + "\n" + html.slice(idx);
	}

	// Fallback: after <!doctype ...>
	const doctypeRegex = /<!doctype html[^>]*>/i;
	const docMatch     = html.match(doctypeRegex);

	if (docMatch) {
		const doctype = docMatch[0];
		const idx     = html.indexOf(doctype) + doctype.length;
		return html.slice(0, idx) + "\n" + metaBlock + "\n" + html.slice(idx);
	}

	// Last resort: prepend to the document
	return metaBlock + "\n" + html;
}

function findTemplateScssEntries() {
	const entries = [];

	function walk(dir) {
		const items = fs.readdirSync(dir, { withFileTypes: true });

		items.forEach((item) => {
			const fullPath = path.join(dir, item.name);

			if (item.isDirectory()) {
				walk(fullPath);
				return;
			}

			// Only pick module-level entry files, e.g. templates/modules/side-by-side/index.scss
			if (item.isFile() && item.name === "index.scss") {
				entries.push(fullPath);
			}
		});
	}

	if (fs.existsSync(TPL_DIR)) {
		walk(TPL_DIR);
	}

	return entries;
}

function compileCss(style = "expanded") {
	const mainEntry = path.join(SRC_DIR, "scss", "index.scss");
	let cssChunks   = [];

	if (fs.existsSync(mainEntry)) {
		const result = sass.compile(mainEntry, { style });
		cssChunks.push(result.css);
	}

	// Collect and compile templates/**/index.scss
	const templateEntries = findTemplateScssEntries();

	templateEntries.forEach((entryPath) => {
		const result = sass.compile(entryPath, { style });
		cssChunks.push(result.css);
	});

	return cssChunks.join("\n\n");
}

function concatJsBundle(area) {
	const baseDir   = path.join(SRC_DIR, "js", area);
	const classesDir= path.join(baseDir, "classes");

	let parts = [];

	if (fs.existsSync(classesDir)) {
		const files = fs.readdirSync(classesDir)
			.filter((f) => f.endsWith(".js"))
			.sort();

		files.forEach((file) => {
			const full = path.join(classesDir, file);
			parts.push(readFile(full));
		});
	}

	const indexPath = path.join(baseDir, "index.js");

	if (fs.existsSync(indexPath)) {
		parts.push(readFile(indexPath));
	}

	return parts.join("\n\n");
}

function injectAssets(html, assets) {
	let out = html;

	if (assets.mode === "dev") {
		// Dev: use external CSS file for BrowserSync injection
		out = out.replace(
			/<style[^>]*data-build="css-index"[^>]*><\/style>/,
			'<link rel="stylesheet" href="styles.css">'
		);
	} else {
		// Build: inline the compiled CSS or remove placeholder if none
		if (assets.css) {
			out = out.replace(
				/<style[^>]*data-build="css-index"[^>]*><\/style>/,
				"<style>\n" + assets.css + "\n<\/style>"
			);
		} else {
			out = out.replace(
				/<style[^>]*data-build="css-index"[^>]*><\/style>/,
				""
			);
		}
	}

	if (assets.jsHeader) {
		out = out.replace(
			/<script[^>]*data-build="js-header"[^>]*><\/script>/,
			"<script>\n" + assets.jsHeader + "\n<\/script>"
		);
	} else {
		out = out.replace(
			/<script[^>]*data-build="js-header"[^>]*><\/script>/,
			""
		);
	}

	if (assets.jsFooter) {
		out = out.replace(
			/<script[^>]*data-build="js-footer"[^>]*><\/script>/,
			"<script>\n" + assets.jsFooter + "\n<\/script>"
		);
	} else {
		out = out.replace(
			/<script[^>]*data-build="js-footer"[^>]*><\/script>/,
			""
		);
	}

	return out;
}

function expandLoops(html) {
	const loopRegex = /^(\s*)for\s+([a-zA-Z_][\w]*)\s*<\s*(\d+)\s*$([\s\S]*?)^\1endfor\s*$/m;

	let output = html;
	let match;

	// Expand loops until none remain (handles multiple / nested loops)
	while ((match = output.match(loopRegex))) {
		const [full, indent, varName, limitStr, body] = match;
		const limit = parseInt(limitStr, 10) || 0;

		// Replace ${varName} with the index value
		const varPattern = new RegExp("\\$\\{" + varName + "\\}", "g");

		let repeated = "";
		for (let i = 0; i < limit; i++) {
			const idx    = String(i);
			const iter   = body.replace(varPattern, idx);
			repeated    += iter;
		}

		output = output.replace(full, repeated);
	}

	return output;
}

function buildStyleSheet() {
	ensureDistDir();

	const css     = compileCss("compressed");
	const cssPath = path.join(DIST_DIR, "styles.css");
	fs.writeFileSync(cssPath, css, "utf8");

	console.log("[builder] css   -> dist/styles.css");
}

function buildIndexFile() {
	ensureDistDir();

	const indexTplPath = path.join(ROOT, "index.tmpl.html");
	const baseHtml     = resolveIncludes(indexTplPath);

	const jsHeader = concatJsBundle("header");
	const jsFooter = concatJsBundle("footer");

	const devHtmlWithAssets = injectAssets(baseHtml, {
		mode: "dev",
		css: "",
		jsHeader,
		jsFooter
	});

	const contentMap = loadContentYaml();
	const { html: htmlDevVars } = applyVariables(devHtmlWithAssets, contentMap, "dev");

	const devFile = path.join(DIST_DIR, "index.html");
	fs.writeFileSync(devFile, htmlDevVars, "utf8");

	console.log("[builder] dev   -> dist/index.html");
}

function buildMarketoFile() {
	ensureMarketoDir();

	const indexTplPath = path.join(ROOT, "index.tmpl.html");
	const baseHtml     = resolveIncludes(indexTplPath);

	const css      = compileCss("compressed");
	const jsHeader = concatJsBundle("header");
	const jsFooter = concatJsBundle("footer");

	const mktoHtmlWithAssets = injectAssets(baseHtml, {
		mode: "build",
		css,
		jsHeader,
		jsFooter
	});

	const contentMap = loadContentYaml();
	const { html: htmlBuildVars, usedVars } = applyVariables(
		mktoHtmlWithAssets,
		contentMap,
		"build"
	);

	let marketoHtml = htmlBuildVars;

	const metaBlock = generateMktoMetaTags(usedVars, contentMap);
	marketoHtml     = injectMktoMeta(marketoHtml, metaBlock);

	const marketoFile = path.join(MARKETO_DIR, "index.marketo.html");
	fs.writeFileSync(marketoFile, marketoHtml, "utf8");

	console.log("[builder] mkto  -> " + path.relative(ROOT, marketoFile));
}

function run() {
	const arg   = process.argv[2] || "once";
	const watch = arg === "watch";

	if (watch) {
		// initial full build
		buildStyleSheet();
		buildIndexFile();
		buildMarketoFile();

		const watcher = chokidar.watch(
			[
				TPL_DIR,
				path.join(SRC_DIR, "scss"),
				path.join(SRC_DIR, "js"),
				CONTENT_DIR,
				path.join(ROOT, "index.tmpl.html")
			],
			{
				ignoreInitial: true,
				persistent: true
			}
		);

		console.log("[builder] watching for changes...");

		watcher.on("all", (event, filePath) => {
			const rel = path.relative(ROOT, filePath);
			console.log(`[builder] change detected: ${event} ${rel}`);

			const ext = path.extname(filePath).toLowerCase();

			if (ext === ".scss") {
				// Stylesheet + Marketo (inline CSS)
				buildStyleSheet();
				buildMarketoFile();
			} else {
				// Template / JS / content changes
				buildIndexFile();
				buildMarketoFile();
			}
		});
	} else {
		// one-off full build
		buildStyleSheet();
		buildIndexFile();
		buildMarketoFile();
	}
}

run();
