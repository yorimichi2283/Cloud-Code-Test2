#!/usr/bin/env node
// TelopTemplates.jsx を After Effects の模型 (mock) の上で実行し、
//   1. 使っている matchName が既知のものだけか
//   2. 作られたレイヤー・エクスプレッション制御・Premiere 公開項目
//   3. すべてのエクスプレッションが評価でき、期待どおりの値を返すか
// を確かめる。After Effects 本体での動作確認の代わりではないが、
// 名前の打ち間違いや式のロジックの誤りはここで捕まえる。
//
//   node tools/test_jsx.js
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const JSX = path.join(__dirname, "..", "TelopTemplates.jsx");

// ---------------------------------------------------------------------------
// プロパティの木 (既知の matchName だけを通す)
// ---------------------------------------------------------------------------

const FIXED = {
  "ADBE Transform Group": ["ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Orientation", "ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z", "ADBE Opacity"],
  "ADBE Text Properties": ["ADBE Text Document", "ADBE Text Path Options", "ADBE Text More Options", "ADBE Text Animators"],
  "ADBE Text Animator": ["ADBE Text Selectors", "ADBE Text Animator Properties"],
  "ADBE Text Selector": ["ADBE Text Percent Start", "ADBE Text Percent End", "ADBE Text Percent Offset", "ADBE Text Index Start", "ADBE Text Index End", "ADBE Text Index Offset", "ADBE Text Range Advanced"],
  "ADBE Text Range Advanced": ["ADBE Text Range Units", "ADBE Text Range Type2", "ADBE Text Selector Mode", "ADBE Text Selector Max Amount", "ADBE Text Range Shape", "ADBE Text Selector Smoothness", "ADBE Text Levels Max Ease", "ADBE Text Levels Min Ease", "ADBE Text Randomize Order", "ADBE Text Random Seed"],
  "ADBE Vector Group": ["ADBE Vector Blend Mode", "ADBE Vectors Group", "ADBE Vector Transform Group"],
  "ADBE Vector Transform Group": ["ADBE Vector Anchor", "ADBE Vector Position", "ADBE Vector Scale", "ADBE Vector Skew", "ADBE Vector Skew Axis", "ADBE Vector Rotation", "ADBE Vector Group Opacity"],
  "ADBE Vector Shape - Rect": ["ADBE Vector Shape Direction", "ADBE Vector Rect Size", "ADBE Vector Rect Position", "ADBE Vector Rect Roundness"],
  "ADBE Vector Shape - Group": ["ADBE Vector Shape Direction", "ADBE Vector Shape"],
  "ADBE Vector Graphic - Fill": ["ADBE Vector Blend Mode", "ADBE Vector Composite Order", "ADBE Vector Fill Rule", "ADBE Vector Fill Color", "ADBE Vector Fill Opacity"],
  "ADBE Vector Graphic - Stroke": ["ADBE Vector Blend Mode", "ADBE Vector Composite Order", "ADBE Vector Stroke Color", "ADBE Vector Stroke Opacity", "ADBE Vector Stroke Width", "ADBE Vector Stroke Line Cap", "ADBE Vector Stroke Line Join", "ADBE Vector Stroke Miter Limit", "ADBE Vector Stroke Dashes"],
  "ADBE Vector Filter - Repeater": ["ADBE Vector Repeater Copies", "ADBE Vector Repeater Offset", "ADBE Vector Repeater Order", "ADBE Vector Repeater Transform"],
  "ADBE Vector Repeater Transform": ["ADBE Vector Repeater Anchor", "ADBE Vector Repeater Position", "ADBE Vector Repeater Scale", "ADBE Vector Repeater Rotation", "ADBE Vector Repeater Opacity 1", "ADBE Vector Repeater Opacity 2"],
  "ADBE Mask Atom": ["ADBE Mask Shape", "ADBE Mask Feather", "ADBE Mask Opacity", "ADBE Mask Offset", "ADBE Mask Expansion"],
  "ADBE Slider Control": ["ADBE Slider Control-0001"],
  "ADBE Color Control": ["ADBE Color Control-0001"],
  "ADBE Checkbox Control": ["ADBE Checkbox Control-0001"],
  "ADBE Gaussian Blur 2": ["ADBE Gaussian Blur 2-0001", "ADBE Gaussian Blur 2-0002", "ADBE Gaussian Blur 2-0003"],
};

const INDEXED = {
  "ADBE Effect Parade": ["ADBE Slider Control", "ADBE Color Control", "ADBE Checkbox Control", "ADBE Gaussian Blur 2"],
  "ADBE Mask Parade": ["ADBE Mask Atom"],
  "ADBE Root Vectors Group": ["ADBE Vector Group"],
  "ADBE Vectors Group": ["ADBE Vector Group", "ADBE Vector Shape - Rect", "ADBE Vector Shape - Group", "ADBE Vector Graphic - Fill", "ADBE Vector Graphic - Stroke", "ADBE Vector Filter - Repeater"],
  "ADBE Text Animators": ["ADBE Text Animator"],
  "ADBE Text Selectors": ["ADBE Text Selector"],
  "ADBE Text Animator Properties": ["ADBE Text Fill Color", "ADBE Text Stroke Color", "ADBE Text Stroke Width"],
};

const DEFAULTS = {
  "ADBE Anchor Point": [0, 0, 0],
  "ADBE Position": [960, 540, 0],
  "ADBE Scale": [100, 100, 100],
  "ADBE Opacity": 100,
  "ADBE Vector Repeater Copies": 3,
  "ADBE Vector Repeater Position": [100, 0],
  "ADBE Vector Repeater Rotation": 0,
  "ADBE Vector Scale": [100, 100],
  "ADBE Vector Position": [0, 0],
  "ADBE Text Index Start": 0,
  "ADBE Text Index End": 0,
  "ADBE Text Range Units": 1,
};

// 名前 (表示名) を変えてよいもの
const RENAMABLE = new Set(["ADBE Vector Group", "ADBE Text Animator", "ADBE Slider Control", "ADBE Color Control", "ADBE Checkbox Control", "ADBE Gaussian Blur 2", "ADBE Mask Atom"]);

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

let AUTO_SELECTOR = false; // AE が animator 追加時に selector を自動で付ける場合も試す

// AE では indexed group に addProperty すると、そのグループと配下への既存の参照が無効になる
// ("Object is invalid")。ハンドルを Proxy にして、古い参照を使ったら例外にする。
function ancestors(node) {
  const out = [];
  for (let x = node; x; x = x.parentProperty) out.push(x);
  return out;
}
function handle(node) {
  if (!node) return node;
  const snap = ancestors(node).map((a) => [a, a.epoch]);
  const check = () => {
    for (const [a, e] of snap) {
      if (a.epoch !== e) throw new Error(`Object is invalid: stale reference to ${node.matchName} (${node._name}) used after addProperty on ${a.matchName}`);
    }
  };
  return new Proxy(node, {
    get(target, key) {
      if (key === "__raw") return target;
      check();
      const v = target[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
    set(target, key, value) {
      check();
      target[key] = value;
      return true;
    },
  });
}

class Prop {
  constructor(matchName, parent) {
    this.epoch = 0;
    this.matchName = matchName;
    this._name = matchName;
    this.parentProperty = parent;
    this.children = [];
    this._value = clone(DEFAULTS[matchName]);
    this.expression = "";
    this.expressionEnabled = true;
    this.expressionError = "";
    for (const m of FIXED[matchName] || []) this.children.push(new Prop(m, this));
    if (matchName === "ADBE Text Animator" && AUTO_SELECTOR) {
      this.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
    }
  }
  get name() { return this._name; }
  set name(v) {
    if (!RENAMABLE.has(this.matchName)) throw new Error(`cannot rename ${this.matchName}`);
    this._name = v;
  }
  get isGroup() { return !!(FIXED[this.matchName] || INDEXED[this.matchName]) && !/-\d{4}$/.test(this.matchName); }
  get numProperties() { return this.children.length; }
  get propertyIndex() { return this.parentProperty.children.indexOf(this) + 1; }
  property(x) {
    if (typeof x === "number") return handle(this.children[x - 1] || null);
    return handle(this.children.find((c) => c.matchName === x) || this.children.find((c) => c._name === x) || null);
  }
  addProperty(mn) {
    const allowed = INDEXED[this.matchName];
    if (!allowed) throw new Error(`addProperty on non-indexed group ${this.matchName}`);
    if (!allowed.includes(mn)) throw new Error(`unknown matchName "${mn}" under ${this.matchName}`);
    const p = new Prop(mn, this);
    this.children.push(p);
    this.epoch++;
    return handle(p);
  }
  get value() { return clone(this._value); }
  setValue(v) {
    if (this.isGroup || FIXED[this.matchName]) throw new Error(`setValue on group ${this.matchName}`);
    if (v === undefined || v === null) throw new Error(`setValue(${v}) on ${this.matchName}`);
    this._value = clone(v);
  }
  setValueAtTime(t, v) { (this.keys = this.keys || []).push([t, v]); }
  canAddToMotionGraphicsTemplate() { return !this.isGroup; }
  addToMotionGraphicsTemplateAs(comp, label) { comp._egp.push({ label, prop: this }); }
}

class Layer {
  constructor(comp, kind) {
    this.containingComp = comp;
    this.kind = kind;
    this.name = kind;
    this.parent = null;
    this.root = new Prop("__layer__", null);
    const add = (mn) => { const p = new Prop(mn, this.root); this.root.children.push(p); return p; };
    if (kind === "text") {
      const tp = add("ADBE Text Properties");
      tp.property("ADBE Text Document")._value = { text: "", font: "ArialMT", fontSize: 36, tracking: 0 };
    }
    if (kind === "shape") add("ADBE Root Vectors Group");
    add("ADBE Mask Parade");
    add("ADBE Effect Parade");
    const tr = add("ADBE Transform Group");
    if (kind === "null") tr.property("ADBE Anchor Point")._value = [50, 50, 0];
  }
  property(x) { return this.root.property(x); }
  setParentWithJump(p) { this.parent = p; }
}

class Comp {
  constructor(name, w, h, par, dur, fps) {
    Object.assign(this, { name, width: w, height: h, pixelAspect: par, duration: dur, frameRate: fps });
    this.frameDuration = 1 / fps;
    this._layers = []; // index 0 = 一番上
    this._egp = [];
    this.markerProperty = new Prop("ADBE Marker", null);
    const self = this;
    this.layers = {
      addText(t) { const l = new Layer(self, "text"); l.property("ADBE Text Properties").property("ADBE Text Document")._value.text = t; self._layers.unshift(l); return l; },
      addShape() { const l = new Layer(self, "shape"); self._layers.unshift(l); return l; },
      addNull() { const l = new Layer(self, "null"); self._layers.unshift(l); return l; },
    };
    this.exports = [];
  }
  layer(name) {
    const l = this._layers.find((x) => x.name === name);
    if (!l) throw new Error(`layer not found: ${name} (comp ${this.name})`);
    return l;
  }
  openInEssentialGraphics() {}
  exportAsMotionGraphicsTemplate(overwrite, p) { this.exports.push({ overwrite, path: p, name: this.motionGraphicsTemplateName }); writtenFiles.add(`${p}/${this.motionGraphicsTemplateName}.mogrt`); return true; }
}

const writtenFiles = new Set();

function runScript({ version = "24.6", folder = "/tmp/out" } = {}) {
  writtenFiles.clear();
  const comps = [];
  const alerts = [];
  const app = {
    version,
    beginUndoGroup() {},
    endUndoGroup() {},
    project: {
      items: {
        addComp(...a) { const c = new Comp(...a); comps.push(c); return c; },
        addFolder(name) { return { name }; },
      },
    },
  };
  class Shape { constructor() { this.vertices = []; this.closed = false; } }
  class MarkerValue { constructor(c) { this.comment = c; this.duration = 0; this.protectedRegion = false; } }
  class File { constructor(p) { this.fsName = p; } get exists() { return writtenFiles.has(this.fsName); } }
  const Folder = { selectDialog: () => (folder ? { fsName: folder } : null) };
  const ctx = vm.createContext({ app, alert: (m) => alerts.push(m), Shape, MarkerValue, File, Folder, ParagraphJustification: { CENTER_JUSTIFY: 7413 } });
  vm.runInContext(fs.readFileSync(JSX, "utf8"), ctx, { filename: "TelopTemplates.jsx" });
  return { comps, alerts };
}

// ---------------------------------------------------------------------------
// エクスプレッションの評価器 (AE の式環境のうち、使っている範囲だけ)
// ---------------------------------------------------------------------------

function findProp(layer, matchName) {
  return layer.property("ADBE Transform Group").property(matchName);
}

function makeEvaluator(comp, { textDocMode }) {
  const cache = new Map();

  function evalProp(layer, p, t) {
    if (!p.expression || !p.expressionEnabled) return p.value;
    const key = `${layer.name}|${pathOf(p)}|${t}`;
    if (cache.has(key)) return cache.get(key);
    let result;
    try {
      result = vm.runInNewContext(p.expression, exprContext(layer, p, t), { timeout: 1000 });
    } catch (e) {
      throw new Error(`expression failed on ${comp.name}/${layer.name} ${pathOf(p)}:\n${e.message}\n--- expression ---\n${p.expression}`);
    }
    cache.set(key, result);
    return result;
  }

  function pathOf(p) {
    const parts = [];
    for (let x = p; x && x.matchName !== "__layer__"; x = x.parentProperty) parts.unshift(x._name);
    return parts.join(" > ");
  }

  function sourceText(layer, t) {
    const p = layer.property("ADBE Text Properties").property("ADBE Text Document");
    const v = evalProp(layer, p, t);
    return typeof v === "string" ? v : v.text;
  }

  // 和文はほぼ全角送り。トラッキングを反映した概算の字面
  function sourceRect(layer, t) {
    const td = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
    const lines = sourceText(layer, t).split(/\r\n|\r|\n/);
    const adv = td.fontSize * (1 + td.tracking / 1000);
    const w = Math.max(...lines.map((l) => [...l].length)) * adv - td.fontSize * 0.08;
    const h = td.fontSize * (0.9 + 1.2 * (lines.length - 1));
    return { left: -w / 2 - (td.tracking / 1000) * td.fontSize / 2, top: -0.83 * td.fontSize, width: Math.max(0, w), height: h };
  }

  function layerProxy(layer, t) {
    return {
      text: {
        sourceText: {
          get value() {
            const s = sourceText(layer, t);
            return textDocMode ? { text: s, style: {} } : s;
          },
        },
      },
      transform: {
        get anchorPoint() { return evalProp(layer, findProp(layer, "ADBE Anchor Point"), t); },
        get position() { return evalProp(layer, findProp(layer, "ADBE Position"), t); },
        get scale() { return evalProp(layer, findProp(layer, "ADBE Scale"), t); },
        get opacity() { return evalProp(layer, findProp(layer, "ADBE Opacity"), t); },
      },
      effect(name) {
        const fx = layer.property("ADBE Effect Parade").property(name);
        if (!fx) throw new Error(`effect not found: "${name}" on layer ${layer.name}`);
        return (i) => evalProp(layer, fx.property(i), t);
      },
    };
  }

  function exprContext(layer, p, t) {
    const self = layerProxy(layer, t);
    return {
      time: t,
      value: p.value,
      thisComp: {
        layer: (n) => layerProxy(comp.layer(n), t),
        frameDuration: comp.frameDuration,
        duration: comp.duration,
      },
      text: self.text,
      transform: self.transform,
      sourceRectAtTime: () => sourceRect(layer, t),
      createPath: (points, inT, outT, closed) => ({ points, closed }),
    };
  }

  return {
    value: (layerName, propPath, t = 2) => {
      const layer = comp.layer(layerName);
      let p = layer.root;
      for (const k of propPath) {
        p = p.property(k);
        if (!p) throw new Error(`no property ${k} on ${layerName}`);
      }
      return clone(evalProp(layer, p, t));
    },
    text: (layerName, t = 2) => sourceText(comp.layer(layerName), t),
    all: (t) => {
      let n = 0;
      for (const layer of comp._layers) {
        (function walk(p) {
          if (p.expression) { evalProp(layer, p, t); n++; }
          p.children.forEach(walk);
        })(layer.root);
      }
      return n;
    },
    clear: () => cache.clear(),
  };
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

const results = [];
function test(name, fn) {
  try { fn(); results.push(["ok", name]); } catch (e) { results.push(["FAIL", name, e]); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const nearArr = (a, b, eps = 1e-6) => a.length >= b.length && b.every((v, i) => near(a[i], v, eps));
const setText = (comp, layerName, s) => {
  comp.layer(layerName).property("ADBE Text Properties").property("ADBE Text Document")._value.text = s;
};
const setCtrl = (comp, name, v) => {
  comp.layer("CTRL").property("ADBE Effect Parade").property(name).property(1).setValue(v);
};

for (const autoSelector of [false, true]) {
  for (const textDocMode of [false, true]) {
    AUTO_SELECTOR = autoSelector;
    const tag = `[autoSelector=${autoSelector} textDoc=${textDocMode}]`;
    const { comps, alerts } = runScript();
    const rule = comps.find((c) => c.name === "ルールテロップ");
    const speech = comps.find((c) => c.name === "セリフテロップ");

    test(`${tag} script finishes without errors`, () => {
      assert.strictEqual(alerts.length, 1, alerts.join("\n"));
      assert.ok(!/エラー|失敗|書き出せなかった/.test(alerts[0]), alerts[0]);
      assert.ok(rule && speech);
    });

    test(`${tag} every expression evaluates at start / mid / end`, () => {
      for (const c of [rule, speech]) {
        const ev = makeEvaluator(c, { textDocMode });
        for (const t of [0, c.frameDuration * 4, 2, c.duration - c.frameDuration]) {
          assert.ok(ev.all(t) > 0);
        }
      }
    });

    test(`${tag} emphasis markers become red ranges`, () => {
      const ev = makeEvaluator(rule, { textDocMode });
      assert.strictEqual(ev.text("TXT_本文"), "レシートに書かれているモノは現物と交換可能");
      const sel = (k, mn) => ev.value("TXT_本文", ["ADBE Text Properties", "ADBE Text Animators", "強調" + k, "ADBE Text Selectors", 1, mn]);
      assert.deepStrictEqual([sel(1, "ADBE Text Index Start"), sel(1, "ADBE Text Index End")], [14, 21]);
      assert.deepStrictEqual([sel(2, "ADBE Text Index Start"), sel(2, "ADBE Text Index End")], [0, 0]);

      setText(rule, "EDIT_本文", "*あ*いう＊えお＊か*きく");
      ev.clear();
      assert.strictEqual(ev.text("TXT_本文"), "あいうえおかきく");
      assert.strictEqual(ev.text("TXT_本文_影3"), "あいうえおかきく");
      assert.deepStrictEqual([sel(1, "ADBE Text Index Start"), sel(1, "ADBE Text Index End")], [0, 1]);
      assert.deepStrictEqual([sel(2, "ADBE Text Index Start"), sel(2, "ADBE Text Index End")], [3, 5]);
      // 閉じ忘れは最後まで
      assert.deepStrictEqual([sel(3, "ADBE Text Index Start"), sel(3, "ADBE Text Index End")], [6, 8]);
      setText(rule, "EDIT_本文", "レシートに書かれているモノは＊現物と交換可能＊");
    });

    test(`${tag} emphasis selectors use index units`, () => {
      const units = rule.layer("TXT_本文").property("ADBE Text Properties").property("ADBE Text Animators")
        .property("強調1").property("ADBE Text Selectors").property(1).property("ADBE Text Range Advanced").property("ADBE Text Range Units").value;
      assert.strictEqual(units, 2);
      const animators = rule.layer("TXT_本文").property("ADBE Text Properties").property("ADBE Text Animators");
      for (const a of animators.children) assert.strictEqual(a.property("ADBE Text Selectors").numProperties, 1, a.name);
    });

    test(`${tag} label: one box and one character per letter`, () => {
      const ev = makeEvaluator(rule, { textDocMode });
      const copies = () => ev.value("LBL_箱", ["ADBE Root Vectors Group", "箱", "ADBE Vectors Group", "ADBE Vector Filter - Repeater", "ADBE Vector Repeater Copies"]);
      assert.strictEqual(copies(), 3);
      assert.deepStrictEqual([1, 2, 3, 4, 8].map((i) => ev.text("LBL_文字" + i)), ["ル", "ー", "ル", "", ""]);
      setText(rule, "EDIT_ラベル", "とても長いラベルの文字列");
      ev.clear();
      assert.strictEqual(copies(), 8);
      assert.strictEqual(ev.text("LBL_文字8"), "ル"); // と て も 長 い ラ ベ [ル]
      setText(rule, "EDIT_ラベル", "ルール");
      // マスの中心と文字の位置が揃っている
      const box = rule.layer("LBL_箱").property("ADBE Root Vectors Group").property("箱").property("ADBE Vectors Group");
      const rectPos = box.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Position").value;
      const step = box.property("ADBE Vector Filter - Repeater").property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").value;
      for (let i = 1; i <= 8; i++) {
        const pos = ev.value("LBL_文字" + i, ["ADBE Transform Group", "ADBE Position"]);
        assert.ok(nearArr(pos, [rectPos[0] + step[0] * (i - 1), rectPos[1]]), `LBL_文字${i} ${pos}`);
        assert.strictEqual(rule.layer("LBL_文字" + i).parent, rule.layer("RIG_ラベル"));
      }
      // ラベル非表示
      setCtrl(rule, "ラベル表示", 0);
      ev.clear();
      assert.strictEqual(ev.value("LBL_箱", ["ADBE Transform Group", "ADBE Opacity"]), 0);
      assert.strictEqual(ev.value("LBL_文字1", ["ADBE Transform Group", "ADBE Opacity"]), 0);
      setCtrl(rule, "ラベル表示", 1);
    });

    test(`${tag} banner geometry follows the width control`, () => {
      const ev = makeEvaluator(rule, { textDocMode });
      const mask = ev.value("BNR_集中線", ["ADBE Mask Parade", 1, "ADBE Mask Shape"]);
      assert.deepStrictEqual(mask.points, [[-915, -71], [915, -71], [915, 71], [-915, 71]]);
      assert.deepStrictEqual(ev.value("BNR_パネル", ["ADBE Root Vectors Group", "地", "ADBE Vectors Group", "ADBE Vector Shape - Rect", "ADBE Vector Rect Size"]), [1830, 142]);
      assert.deepStrictEqual(ev.value("BNR_フレーム", ["ADBE Root Vectors Group", "外枠", "ADBE Vectors Group", "ADBE Vector Shape - Rect", "ADBE Vector Rect Size"]), [1843, 155]);
      assert.deepStrictEqual(ev.value("BNR_リベット", ["ADBE Root Vectors Group", "右下_箱", "ADBE Vector Transform Group", "ADBE Vector Position"]), [921.5, 77.5]);
      assert.deepStrictEqual(ev.value("RIG_ラベル", ["ADBE Transform Group", "ADBE Position"]), [32, 894]);
      setCtrl(rule, "帯の幅", 50);
      ev.clear();
      assert.deepStrictEqual(ev.value("RIG_ラベル", ["ADBE Transform Group", "ADBE Position"]), [496, 894]);
      assert.deepStrictEqual(ev.value("BNR_パネル", ["ADBE Root Vectors Group", "地", "ADBE Vectors Group", "ADBE Vector Shape - Rect", "ADBE Vector Rect Size"]), [902, 142]);
      setCtrl(rule, "帯の幅", 100);
      // 外枠の色は明・暗の中間
      const mid = ev.value("BNR_フレーム", ["ADBE Root Vectors Group", "明", "ADBE Vectors Group", "ADBE Vector Graphic - Stroke", "ADBE Vector Stroke Color"]);
      assert.strictEqual(mid.length, 4);
    });

    test(`${tag} banner shapes are parented to the banner rig at its origin`, () => {
      for (const n of ["BNR_パネル", "BNR_集中線", "BNR_フレーム", "BNR_リベット"]) {
        const l = rule.layer(n);
        assert.strictEqual(l.parent, rule.layer("RIG_帯"), n);
        assert.deepStrictEqual(findProp(l, "ADBE Position").value, [0, 0], n);
      }
      for (const n of ["RIG_帯", "RIG_ラベル", "RIG_文字"]) {
        assert.deepStrictEqual(findProp(rule.layer(n), "ADBE Anchor Point").value, [0, 0], n);
      }
    });

    test(`${tag} long text shrinks to fit, short text keeps size`, () => {
      const ev = makeEvaluator(rule, { textDocMode });
      assert.deepStrictEqual(ev.value("TXT_本文", ["ADBE Transform Group", "ADBE Scale"]), [100, 100]);
      setText(rule, "EDIT_本文", "あ".repeat(40));
      ev.clear();
      const s = ev.value("TXT_本文", ["ADBE Transform Group", "ADBE Scale"])[0];
      assert.ok(s < 60 && s > 40, String(s));
      assert.deepStrictEqual(ev.value("TXT_本文_影2", ["ADBE Transform Group", "ADBE Scale"]), [s, s]);
      setText(rule, "EDIT_本文", "レシートに書かれているモノは＊現物と交換可能＊");
    });

    test(`${tag} extrusion shadow copies step out to the shadow distance`, () => {
      const ev = makeEvaluator(rule, { textDocMode });
      for (let k = 1; k <= 5; k++) {
        const p = ev.value("TXT_本文_影" + k, ["ADBE Transform Group", "ADBE Position"]);
        assert.ok(nearArr(p, [11 * k / 5, 11 * k / 5]), `影${k}: ${p}`);
        assert.deepStrictEqual(ev.value("TXT_本文_影" + k, ["ADBE Transform Group", "ADBE Anchor Point"]),
          ev.value("TXT_本文", ["ADBE Transform Group", "ADBE Anchor Point"]));
      }
      // 影は本文より下の重なり順
      const idx = (n) => rule._layers.indexOf(rule.layer(n));
      for (let k = 1; k <= 5; k++) assert.ok(idx("TXT_本文_影" + k) > idx("TXT_本文"));
    });

    test(`${tag} IN animation: starts hidden, settles at 100%`, () => {
      const ev = makeEvaluator(rule, { textDocMode });
      const fd = rule.frameDuration;
      assert.ok(nearArr(ev.value("RIG_帯", ["ADBE Transform Group", "ADBE Scale"], 0), [0, 70], 1e-9));
      assert.ok(nearArr(ev.value("RIG_文字", ["ADBE Transform Group", "ADBE Scale"], 0), [0, 0], 1e-9));
      assert.ok(nearArr(ev.value("RIG_ラベル", ["ADBE Transform Group", "ADBE Scale"], 0), [0, 0], 1e-9));
      // 途中で行き過ぎてから戻る
      const peak = Math.max(...Array.from({ length: 15 }, (_, f) => ev.value("RIG_帯", ["ADBE Transform Group", "ADBE Scale"], f * fd)[0]));
      assert.ok(peak > 105 && peak < 115, `overshoot ${peak}`);
      for (const n of ["RIG_帯", "RIG_文字", "RIG_ラベル"]) {
        assert.ok(nearArr(ev.value(n, ["ADBE Transform Group", "ADBE Scale"], 20 * fd), [100, 100]), n);
        assert.ok(nearArr(ev.value(n, ["ADBE Transform Group", "ADBE Scale"], rule.duration - fd), [100, 100]), n);
      }
      // IN を切ると最初から表示
      setCtrl(rule, "INアニメ", 0);
      ev.clear();
      assert.ok(nearArr(ev.value("RIG_帯", ["ADBE Transform Group", "ADBE Scale"], 0), [100, 100]));
      setCtrl(rule, "INアニメ", 1);
      // OUT を入れると最後のフレームで消える
      setCtrl(rule, "OUTアニメ", 1);
      ev.clear();
      assert.ok(nearArr(ev.value("RIG_帯", ["ADBE Transform Group", "ADBE Scale"], rule.duration - fd), [0, 0], 1e-9));
      setCtrl(rule, "OUTアニメ", 0);
    });

    test(`${tag} speech: anchor tracks the last line, fades in`, () => {
      const ev = makeEvaluator(speech, { textDocMode });
      const a1 = ev.value("TXT_セリフ", ["ADBE Transform Group", "ADBE Anchor Point"]);
      assert.ok(near(a1[1], -90 * 0.38), String(a1));
      setText(speech, "TXT_セリフ", "一行目\r二行目");
      ev.clear();
      const a2 = ev.value("TXT_セリフ", ["ADBE Transform Group", "ADBE Anchor Point"]);
      assert.ok(near(a2[1], 108 - 90 * 0.38), String(a2));
      assert.strictEqual(ev.text("TXT_セリフ_影"), "一行目\r二行目");
      setText(speech, "TXT_セリフ", "ちょっとだいぶ歩ったからなぁ");
      ev.clear();
      assert.strictEqual(ev.value("TXT_セリフ", ["ADBE Transform Group", "ADBE Opacity"], 0), 0);
      assert.ok(near(ev.value("TXT_セリフ", ["ADBE Transform Group", "ADBE Opacity"], 1), 100));
      assert.ok(near(ev.value("TXT_セリフ_影", ["ADBE Transform Group", "ADBE Opacity"], 1), 85));
      assert.deepStrictEqual(ev.value("TXT_セリフ_影", ["ADBE Transform Group", "ADBE Position"], 1), [960, 846]);
      assert.ok(nearArr(ev.value("TXT_セリフ", ["ADBE Transform Group", "ADBE Scale"], 1), [100, 100]));
      assert.strictEqual(ev.value("TXT_セリフ_影", ["ADBE Effect Parade", 1, 1], 1), 8);
    });

    test(`${tag} Premiere controls, protected regions and export`, () => {
      const labels = (c) => c._egp.map((x) => x.label);
      assert.strictEqual(labels(rule).length, 17);
      assert.strictEqual(labels(rule)[0], "本文（＊で挟んだ部分が強調色）");
      assert.strictEqual(rule._egp[0].prop.parentProperty.parentProperty.matchName, "__layer__");
      assert.strictEqual(labels(speech).length, 11);
      for (const c of [rule, speech]) {
        assert.strictEqual(new Set(labels(c)).size, labels(c).length, "duplicate labels");
        const marks = c.markerProperty.keys;
        assert.strictEqual(marks.length, 2);
        assert.ok(marks.every(([, m]) => m.protectedRegion && m.duration > 0));
        assert.ok(near(marks[1][0] + marks[1][1].duration, c.duration));
        assert.strictEqual(c.exports.length, 1);
        assert.strictEqual(c.exports[0].path, "/tmp/out");
      }
    });
  }
}

test("mock: stale property references are rejected like After Effects does", () => {
  const l = new Layer(new Comp("t", 10, 10, 1, 1, 30), "text");
  const animators = l.property("ADBE Text Properties").property("ADBE Text Animators");
  const a = animators.addProperty("ADBE Text Animator");
  a.name = "x";
  assert.throws(() => animators.property("x"), /Object is invalid/);
  assert.doesNotThrow(() => l.property("ADBE Text Properties").property("ADBE Text Animators").property("x"));
});

test("old After Effects is refused before touching the project", () => {
  const { comps, alerts } = runScript({ version: "15.1x2" });
  assert.strictEqual(comps.length, 0);
  assert.ok(/2020/.test(alerts[0]));
});

test("cancelling the folder dialog exports to the local templates folder", () => {
  AUTO_SELECTOR = false;
  const { comps, alerts } = runScript({ folder: null });
  for (const c of comps) assert.deepStrictEqual(c.exports.map((e) => e.path), [undefined]);
  assert.ok(/ローカルテンプレートフォルダー/.test(alerts[0]));
});

let failed = 0;
for (const [status, name, err] of results) {
  console.log(`${status === "ok" ? "  ok " : "FAIL "} ${name}`);
  if (err) { failed++; console.log(String(err.stack || err).split("\n").map((l) => "      " + l).join("\n")); }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
