// Build ae/JounetsuStyle_Builder.jsx from ae/src/JounetsuStyle_Builder.src.jsx
//  - non-ASCII characters inside string literals become \uXXXX escapes
//    (so the script works regardless of how AE guesses the file encoding)
//  - comments stay readable (UTF-8 + BOM)
//  - verifies the result parses as ES3 and that every string literal is unchanged
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

const SRC = path.join(__dirname, "..", "src", "JounetsuStyle_Builder.src.jsx");
const OUT = path.join(__dirname, "..", "JounetsuStyle_Builder.jsx");

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
  const ast = acorn.parse(code, { ecmaVersion: 3, locations: false });
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

const src = fs.readFileSync(SRC, "utf8").replace(/^﻿/, "");
const built = escapeStrings(src);

// ES3 syntax check (ExtendScript is ES3) + literal equality check
const a = stringLiterals(src), b = stringLiterals(built);
if (a.length !== b.length) throw new Error("literal count mismatch");
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error("literal mismatch: " + a[i]);

fs.writeFileSync(OUT, "﻿" + built, "utf8");
console.log("built", path.relative(process.cwd(), OUT), "(" + built.length + " chars, " + a.length + " string literals, ES3 OK)");
