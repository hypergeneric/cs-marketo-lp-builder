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

function ensureDistDir() {
	if (!fs.existsSync(DIST_DIR)) {
		fs.mkdirSync(DIST_DIR, { recursive: true });
	}
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

	const includeRegex = /^(\s*)include\s+(.+)$/gm;

	content = content.replace(includeRegex, (match, indent, includePathRaw) => {
		const includePath = includePathRaw.trim();
		const includeAbs  = path.resolve(ROOT, includePath);

		if (!fs.existsSync(includeAbs)) {
			const rel = path.relative(ROOT, includeAbs);
			console.error(`[builder] INCLUDE ERROR: ${rel} not found`);
			const stub = `<div style="border:1px red dotted">INCLUDE ERROR: ${rel} not found</div>`;
			return indent + stub;
		}

		const included = resolveIncludes(includeAbs, seen);

		const indented = included
			.split("\n")
			.map((line) => (line.length ? indent + line : line))
			.join("\n");

		return indented;
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
	const usedVars  = new Set();
	const varRegex  = /\$\{([a-zA-Z0-9_-]+)\}/g;

	const processed = html.replace(varRegex, (match, varName) => {
		usedVars.add(varName);

		if (mode === "dev") {
			if (Object.prototype.hasOwnProperty.call(contentMap, varName)) {
				return String(contentMap[varName]);
			}

			return `[${varName}]`;
		}

		return "${" + varName + "}";
	});

	return {
		html: processed,
		usedVars: Array.from(usedVars)
	};
}

function mktoNameFromId(id) {
	return id
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

function generateMktoMetaTags(vars, contentMap) {
	if (!vars.length) {
		return "";
	}

	const lines = [];

	vars.forEach((varName) => {
		const defaultVal = contentMap[varName] || "";
		const mktoName   = mktoNameFromId(varName);

		const line = `<meta class="mktoString" default="${escapeHtml(defaultVal)}" id="${varName}" mktomodulescope="false" mktoname="${escapeHtml(mktoName)}" />`;

		lines.push(line);
	});

	return lines.join("\n");
}

function injectMktoMeta(html, metaBlock) {
	if (!metaBlock) {
		return html;
	}

	const doctypeRegex = /<!doctype html[^>]*>/i;
	const match        = html.match(doctypeRegex);

	if (!match) {
		return metaBlock + "\n" + html;
	}

	const doctype = match[0];
	const idx     = html.indexOf(doctype) + doctype.length;

	return html.slice(0, idx) + "\n" + metaBlock + "\n" + html.slice(idx);
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

function compileCss() {
	const mainEntry = path.join(SRC_DIR, "scss", "index.scss");
	let cssChunks   = [];

	if (fs.existsSync(mainEntry)) {
		const result = sass.compile(mainEntry, { style: "expanded" });
		cssChunks.push(result.css);
	}

	// Collect and compile templates/**/index.scss
	const templateEntries = findTemplateScssEntries();

	templateEntries.forEach((entryPath) => {
		const result = sass.compile(entryPath, { style: "expanded" });
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
		// Build: inline the compiled CSS
		if (assets.css) {
			out = out.replace(
				/<style[^>]*data-build="css-index"[^>]*><\/style>/,
				`<style>\n${assets.css}\n</style>`
			);
		}
	}

	if (assets.jsHeader) {
		out = out.replace(
			/<script[^>]*data-build="js-header"[^>]*><\/script>/,
			`<script>\n${assets.jsHeader}\n</script>`
		);
	}

	if (assets.jsFooter) {
		out = out.replace(
			/<script[^>]*data-build="js-footer"[^>]*><\/script>/,
			`<script>\n${assets.jsFooter}\n</script>`
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

function buildOnce(mode) {
	ensureDistDir();

	const indexTplPath = path.join(ROOT, "index.tmpl.html");
	const baseHtml     = resolveIncludes(indexTplPath);
	const loopHtml     = expandLoops(baseHtml);

	const css      = compileCss();
	const jsHeader = concatJsBundle("header");
	const jsFooter = concatJsBundle("footer");

	if (mode === "dev") {
		const cssPath = path.join(DIST_DIR, "styles.css");
		fs.writeFileSync(cssPath, css, "utf8");
	}

	let htmlWithAssets = injectAssets(loopHtml, {
		mode,
		css,
		jsHeader,
		jsFooter
	});


	const contentMap   = loadContentYaml();
	const { html: htmlVars, usedVars } = applyVariables(htmlWithAssets, contentMap, mode);

	let finalHtml = htmlVars;

	if (mode === "build") {
		const metaBlock = generateMktoMetaTags(usedVars, contentMap);
		finalHtml       = injectMktoMeta(finalHtml, metaBlock);
	}

	const outFile = mode === "build"
		? path.join(DIST_DIR, "index.marketo.html")
		: path.join(DIST_DIR, "index.html");

	fs.writeFileSync(outFile, finalHtml, "utf8");

	console.log(`[builder] ${mode} -> ${path.relative(ROOT, outFile)}`);
}

function buildCssOnly() {
	ensureDistDir();
	const css     = compileCss();
	const cssPath = path.join(DIST_DIR, "styles.css");
	fs.writeFileSync(cssPath, css, "utf8");
	console.log("[builder] css  -> dist/styles.css");
}

function run() {
	const mode = process.argv[2] || "dev";

	if (mode === "dev") {
		// initial full build
		buildOnce("dev");

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
				buildCssOnly();      // only CSS
			} else {
				buildOnce("dev");    // full HTML + assets
			}
		});
	} else if (mode === "build") {
		buildOnce("build");
	} else {
		console.error("Unknown mode. Use: dev | build");
		process.exit(1);
	}
}

run();
