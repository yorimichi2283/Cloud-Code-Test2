// Build ae/KanagawaGenba_Builder.jsx from ae/src/KanagawaGenba_Builder.src.jsx
//  - non-ASCII characters inside string literals become \uXXXX escapes
//    (works regardless of how AE guesses the file encoding); comments stay readable
//  - the logo PNGs (ae/assets) are embedded as binary strings, so the .jsx is self-contained
//  - verifies the result parses as ES3 (ExtendScript) and string literals are unchanged
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src", "KanagawaGenba_Builder.src.jsx");
const OUT = path.join(ROOT, "KanagawaGenba_Builder.jsx");
const ASSETS = path.join(ROOT, "assets");

function escapeStrings(src) {
  let out = "";
  let state = "code"; // code | line | block | sq | dq
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") { state = "line"; out += c; continue; }
      if (c === "/" && n === "*") { state = "block"; out += c; continue; }
      if (c === "'") { state = "sq"; out += c; continue; }
      if (c === '"') { state = "dq"; out += c; continue; }
      if (c.charCodeAt(0) > 127) throw new Error("non-ASCII outside string/comment at offset " + i);
      out += c;
    } else if (state === "line") {
      if (c === "\n") state = "code";
      out += c;
    } else if (state === "block") {
      if (c === "*" && n === "/") { out += "*/"; i++; state = "code"; continue; }
      out += c;
    } else {
      if (c === "\\") { out += c + n; i++; continue; }
      if ((state === "sq" && c === "'") || (state === "dq" && c === '"')) { state = "code"; out += c; continue; }
      if (c === "\n") throw new Error("newline inside string at offset " + i);
      const code = c.charCodeAt(0);
      out += code > 127 ? "\\u" + code.toString(16).toUpperCase().padStart(4, "0") : c;
    }
  }
  return out;
}

function stringLiterals(code) {
  const lits = [];
  const ast = acorn.parse(code, { ecmaVersion: 3 });
  (function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "Literal" && typeof node.value === "string") lits.push(node.value);
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object" && typeof v.type === "string") walk(v);
    }
  })(ast);
  return lits;
}

// bytes -> ES3 string literal chunks ("\xNN" for anything not plain printable ASCII)
function binaryLiteral(buf) {
  const chunks = [];
  let cur = "";
  for (const b of buf) {
    if (b >= 0x20 && b <= 0x7e && b !== 0x22 && b !== 0x5c) cur += String.fromCharCode(b);
    else cur += "\\x" + b.toString(16).padStart(2, "0");
    if (cur.length > 3000) { chunks.push('"' + cur + '"'); cur = ""; }
  }
  if (cur) chunks.push('"' + cur + '"');
  return "[\n" + chunks.join(",\n") + "\n].join(\"\")";
}

function assetsLiteral() {
  const layout = JSON.parse(fs.readFileSync(path.join(ASSETS, "logo_layout.json"), "utf8"));
  const parts = layout.glyphs.map((g) => {
    const buf = fs.readFileSync(path.join(ASSETS, g.file));
    return "{ name: " + JSON.stringify(g.name) + ", row: " + JSON.stringify(g.row) + ", file: " + JSON.stringify("KanagawaGenba_" + g.file) +
      ", x: " + g.x + ", y: " + g.y + ", w: " + g.w + ", h: " + g.h + ", size: " + buf.length + ",\n  data: " + binaryLiteral(buf) + " }";
  });
  return "[\n" + parts.join(",\n") + "\n]";
}

const src = fs.readFileSync(SRC, "utf8").replace(/^﻿/, "");
let built = escapeStrings(src);
const a = stringLiterals(src), b = stringLiterals(built);
if (a.length !== b.length) throw new Error("literal count mismatch");
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error("literal mismatch: " + a[i]);

const MARK = "/*@@ASSETS@@*/null";
if (built.indexOf(MARK) < 0) throw new Error("asset marker not found");
built = built.replace(MARK, () => assetsLiteral());
acorn.parse(built, { ecmaVersion: 3 }); // still ES3 after embedding

fs.writeFileSync(OUT, "﻿" + built, "utf8");
console.log("built", path.relative(process.cwd(), OUT), "(" + Math.round(built.length / 1024) + " KB, " + a.length + " string literals, ES3 OK)");
