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

const MOGRT_DIR = path.join(require("os").tmpdir(), "kg_mogrt_out");
function runScript(opts) {
  fs.rmSync(MOGRT_DIR, { recursive: true, force: true }); fs.mkdirSync(MOGRT_DIR, { recursive: true });
  if (opts && opts.staleMogrt) fs.writeFileSync(path.join(MOGRT_DIR, "かながわの現場_01_オープニング.mogrt"), "old");
  const g = makeGlobals(Object.assign({ fonts: MAC_FONTS, confirm: true, folder: MOGRT_DIR }, opts || {}));
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

// on-screen size/centre of the "G"/"R" rectangle of a shape layer at time t
function rectOnScreen(ev, comp, layerName, t) {
  const L = comp.layer(layerName);
  if (!L) throw new Error("layer not found: " + layerName);
  const m = ev.layerMatrix(L, t);
  const grp = ev.findChild(ev.findChild(L._root, "ADBE Root Vectors Group"), "G");
  const R = ev.findChild(ev.findChild(grp, "ADBE Vectors Group"), "R");
  const size = ev.valueOf(ev.findChild(R, "ADBE Vector Rect Size"), t), pos = ev.valueOf(ev.findChild(R, "ADBE Vector Rect Position"), t);
  return { w: size[0] * Math.hypot(m[0], m[1]), h: size[1] * Math.hypot(m[2], m[3]), x: m[0] * pos[0] + m[2] * pos[1] + m[4], y: m[1] * pos[0] + m[3] * pos[1] + m[5] };
}
function geometryReport(g, ev) {
  const comps = g.app.project._items.filter((x) => x instanceof CompItem);
  const op = comps.find((c) => c.name.startsWith("01_")), cn = comps.find((c) => c.name.startsWith("02_"));
  const lines = [], problems = [];
  const a = rectOnScreen(ev, cn, "左上プレート", 1.0), b = rectOnScreen(ev, op, "左上プレート", 4.9);
  lines.push("badge 02: " + [a.w, a.h, a.x, a.y].map((v) => v.toFixed(1)).join(", ") + "   OP@4.9: " + [b.w, b.h, b.x, b.y].map((v) => v.toFixed(1)).join(", "));
  if (Math.abs(a.w - 210) > 2 || Math.abs(a.h - 210) > 2) problems.push("02 badge is not 210px on screen: " + a.w.toFixed(1));
  for (const k of ["w", "h", "x", "y"]) if (Math.abs(a[k] - b[k]) > 1) problems.push("OP end and 02 badge differ in " + k + ": " + a[k].toFixed(1) + " vs " + b[k].toFixed(1));
  const gl02 = cn.layer("ロゴ ka"), m02 = ev.layerMatrix(gl02, 1.0);
  const glOP = op.layer("ロゴ ひらがな（かながわの）"), mOP = ev.layerMatrix(glOP, 4.9);
  const s02 = Math.hypot(m02[0], m02[1]), sOP = Math.hypot(mOP[0], mOP[1]);
  lines.push("glyph scale 02: " + s02.toFixed(4) + "   OP@4.9: " + sOP.toFixed(4));
  if (Math.abs(s02 - sOP) > 0.002) problems.push("glyph scale differs between OP end and 02");
  return { lines, problems };
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

  // 4) geometry: the corner badge is 210px on screen, and the OP ends exactly where 02 starts
  const geo = geometryReport(g, ev);
  for (const line of geo.lines) console.log("  " + line);
  problems.push(...geo.problems);

  // 5) MOGRT export: 4 files named after the templates, in the chosen folder
  const mogrts = fs.readdirSync(MOGRT_DIR).filter((f) => f.endsWith(".mogrt"));
  console.log("mogrt files:", mogrts.join(", "));
  if (mogrts.length !== 4) problems.push("expected 4 .mogrt files, got " + mogrts.length);
  if (!g.log.some(([k, m]) => k === "alert" && /MOGRT を書き出しました/.test(m))) problems.push("no MOGRT success message");

  // 5b) structure checks
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

  // 6) also run once without the fonts API (older AE) and without MOGRT export
  try { runScript({ noFontsApi: true, confirm: false, version: "17.0" }); console.log("OK: runs on an AE without app.fonts"); }
  catch (e) { console.log("FAIL (no fonts api): " + e.message); process.exitCode = 1; }

  // 7) error paths must end with a clear alert, never an uncaught exception
  const cases = [
    { label: "file-write preference OFF, user stops", opts: { prefFileWrite: 0, confirm: false }, expect: /スクリプトによるファイルへの書き込み/, comps: 0 },
    { label: "file-write preference OFF, user continues", opts: { prefFileWrite: 0 }, expect: /テンプレートを作成しました[\s\S]*MOGRT を書き出しました/ },
    { label: "stale .mogrt files in the folder are not counted", opts: { staleMogrt: true }, expect: /MOGRT を書き出しました/ },
    { label: "writes denied (pref unknown)", opts: { denyWrite: true }, expect: /止まりました[\s\S]*スクリプトによるファイルへの書き込み/ },
    { label: "save dialog cancelled before MOGRT export", opts: { saveCancel: true }, expect: /先にプロジェクトの保存が必要/ },
  ];
  for (const c of cases) {
    try {
      const gg = runScript(c.opts);
      const alerts = gg.log.filter(([k]) => k === "alert" || k === "confirm").map(([, m]) => m).join("\n---\n");
      const nComps = gg.app.project._items.filter((x) => x instanceof CompItem).length;
      const ok = c.expect.test(alerts) && (c.comps === undefined || nComps === c.comps);
      console.log((ok ? "OK: " : "FAIL: ") + c.label + (ok ? "" : "\n" + alerts));
      if (!ok) process.exitCode = 1;
    } catch (e) { console.log("FAIL (uncaught) " + c.label + ": " + e.message); process.exitCode = 1; }
  }
  return g;
}

if (require.main === module) main();
module.exports = { runScript, allProps };
