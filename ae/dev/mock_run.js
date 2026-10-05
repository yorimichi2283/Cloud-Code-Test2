// Run the built AE script against the mock DOM and validate the result.
//   node mock_run.js            -> run + checks (exit code 1 on failure)
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const acorn = require("acorn");
const { makeGlobals, CompItem, MOCK_ROOT } = require("./mock_ae.js");
const { makeEvaluator } = require("./expr_eval.js");

const JSX = path.join(__dirname, "..", "KanagawaGenba_Builder.jsx");
const MAC_FONTS = ["HiraginoSans-W7", "HiraginoSans-W5"];

function runScript(opts) {
  const g = makeGlobals(Object.assign({ fonts: MAC_FONTS, confirm: true, folder: "/tmp/mogrt" }, opts || {}));
  const code = fs.readFileSync(JSX, "utf8").replace(/^﻿/, "");
  vm.createContext(g);
  vm.runInContext(code, g, { filename: "KanagawaGenba_Builder.jsx", timeout: 60000 });
  return g;
}

function allProps(comp) {
  const out = [];
  for (const L of comp._layers) (function walk(n, p) {
    if (n.kind === "prop") out.push({ layer: L, node: n, path: p + "/" + n.name });
    (n.children || []).forEach((c) => walk(c, p + "/" + n.name));
  })(L._root, comp.name);
  return out;
}

function main() {
  const problems = [];
  const g = runScript();
  const comps = g.app.project._items.filter((x) => x instanceof CompItem);
  console.log("comps:", comps.length);
  for (const c of comps) console.log("  " + c.name.padEnd(28) + " layers=" + String(c._layers.length).padStart(3) + "  egp=" + c._egp.length + (c._exported ? "  mogrt=" + path.basename(c._exported) : ""));
  console.log("dialogs:");
  for (const [k, m] of g.log) console.log("  [" + k + "] " + m.split("\n").slice(0, 3).join(" | "));
  if (g.log.some(([k, m]) => k === "alert" && /警告/.test(m))) problems.push("script reported expression warnings");

  // 1) every expression parses as ES3 (legacy engine) and ES2018 (JS engine)
  const ev = makeEvaluator(g);
  let nExpr = 0;
  for (const c of comps) for (const p of allProps(c)) {
    if (!p.node.expression) continue;
    nExpr++;
    for (const ver of [3, 2018]) {
      try { acorn.parse(p.node.expression, { ecmaVersion: ver }); }
      catch (e) { problems.push("parse(es" + ver + ") " + p.path + ": " + e.message + "\n    " + p.node.expression); }
    }
  }
  console.log("expressions:", nExpr);

  // 2) evaluate every expression at many times
  const times = [];
  for (let t = 0; t <= 10.0001; t += 0.1) times.push(Math.round(t * 1000) / 1000);
  for (const c of comps) for (const p of allProps(c)) {
    if (!p.node.expression) continue;
    for (const t of times) {
      if (t > c.duration) break;
      try { ev.evalExpr(p.node, t); }
      catch (e) { problems.push("eval@" + t + " " + p.path + ": " + e.message); break; }
    }
  }
  console.log("evaluations:", ev.stats.evals);

  // 3) embedded logo PNGs were written byte-for-byte
  const outDir = path.join(MOCK_ROOT, "Documents", "KanagawaGenba_Assets");
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "logo_layout.json"), "utf8"));
  for (const gl of layout.glyphs) {
    const want = fs.readFileSync(path.join(__dirname, "..", "assets", gl.file));
    const got = path.join(outDir, "KanagawaGenba_" + gl.file);
    if (!fs.existsSync(got) || !fs.readFileSync(got).equals(want)) problems.push("asset not written correctly: " + gl.file);
  }
  console.log("assets checked:", layout.glyphs.length);

  // 4) structure checks
  for (const c of comps) {
    const names = new Map();
    for (const L of c._layers) {
      if (L.name === "CTRL" && names.has("CTRL")) problems.push("duplicate CTRL in " + c.name);
      names.set(L.name, (names.get(L.name) || 0) + 1);
      if (L.parent && !c._layers.includes(L.parent)) problems.push("parent outside comp: " + L.name);
    }
    if (!c.name.startsWith("_") && c._layers[0].name !== "CTRL") problems.push("CTRL is not the top layer in " + c.name);
  }

  if (problems.length) {
    console.log("\nPROBLEMS (" + problems.length + "):");
    for (const p of problems.slice(0, 60)) console.log(" - " + p);
    process.exitCode = 1;
  } else {
    console.log("\nOK: no problems found");
  }

  // 5) also run once without the fonts API (older AE) and without MOGRT export
  try { runScript({ noFontsApi: true, confirm: false, version: "17.0" }); console.log("OK: runs on an AE without app.fonts"); }
  catch (e) { console.log("FAIL (no fonts api): " + e.message); process.exitCode = 1; }
  return g;
}

if (require.main === module) main();
module.exports = { runScript, allProps };
