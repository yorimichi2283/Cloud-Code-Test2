// aemock.js で組み立てたコンポのエクスプレッションを、簡易エクスプレッションエンジンで評価する。
//   node dev/evalexpr.js [--dump=geometry.json] [aemock の引数...]
// ・全エクスプレッションを複数の時刻で実行し、例外・型違い・NaN を検出
// ・主要な値の推移を表示
// ・--dump 指定時はプレビュー描画用のジオメトリを書き出す
"use strict";
const vm = require("vm");
const fs = require("fs");
const { comps, PropNode } = require("./aemock");

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2]] : [a, ""];
}));

const problems = [];
const warnings = [];

// --set=Name=value,Name2=value2 で CTRL の値を上書き（ドロップダウン等の別設定を検証）
if (args.set) {
    for (const kv of args.set.split(",")) {
        const [name, val] = kv.split("=");
        for (const comp of comps) {
            const ctrl = comp.layer("CTRL");
            const fx = ctrl && ctrl.find("ADBE Effect Parade", name);
            if (fx) fx.children[0].value = Number(val);
        }
    }
}

// ---------------------------------------------------------------------
// テキストスタイル
// ---------------------------------------------------------------------
function isNum(x) { return typeof x === "number" && isFinite(x); }
function isColor3(v) { return Array.isArray(v) && v.length === 3 && v.every(isNum); }

class TextStyle {
    constructor(o) { Object.assign(this, o); }
    _with(k, v) { return new TextStyle(Object.assign({}, this, { [k]: v })); }
    setFontSize(v) { if (!isNum(v) || v <= 0) throw new Error("setFontSize bad " + v); return this._with("fontSize", v); }
    setFillColor(v) { if (!isColor3(v)) throw new Error("setFillColor bad " + JSON.stringify(v)); return this._with("fillColor", v); }
    setStrokeColor(v) { if (!isColor3(v)) throw new Error("setStrokeColor bad " + JSON.stringify(v)); return this._with("strokeColor", v); }
    setStrokeWidth(v) { if (!isNum(v) || v < 0) throw new Error("setStrokeWidth bad " + v); return this._with("strokeWidth", v); }
    setFont(v) { if (typeof v !== "string" || !v) throw new Error("setFont bad " + v); return this._with("font", v); }
    setText(v) { return this._with("text", String(v)); }
}

function styleFromDoc(doc) {
    return new TextStyle({
        text: doc.text, font: doc.font, fontSize: doc.fontSize,
        fillColor: doc._fillColor, applyStroke: doc._applyStroke, strokeColor: doc._strokeColor,
        strokeWidth: doc._applyStroke ? doc._strokeWidth : 0, justification: doc.justification, tracking: doc.tracking,
    });
}

// ---------------------------------------------------------------------
// 評価
// ---------------------------------------------------------------------
const cache = new Map();
const evaluating = new Set();

function linear(t, a, b, c, d) {
    if (arguments.length === 3) { d = c; c = b; b = 1; a = 0; }
    if (b === a) return t <= a ? c : d;
    let u = (t - a) / (b - a);
    u = Math.max(0, Math.min(1, u));
    if (Array.isArray(c)) return c.map((x, i) => x + (d[i] - x) * u);
    return c + (d - c) * u;
}
function ease(t, a, b, c, d) {
    if (arguments.length === 3) { d = c; c = b; b = 1; a = 0; }
    let u = Math.max(0, Math.min(1, (t - a) / (b - a)));
    u = u * u * (3 - 2 * u);
    return c + (d - c) * u;
}
function clamp(v, a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (Array.isArray(v)) return v.map(x => Math.max(lo, Math.min(hi, x)));
    return Math.max(lo, Math.min(hi, v));
}

function layerOf(node) { return node.layer; }

function preValue(node) {
    if (node.kind === "text") return styleFromDoc(node.value);
    return node.value;
}

function evalProp(node, t) {
    const key = node;
    let byT = cache.get(key);
    if (!byT) { byT = new Map(); cache.set(key, byT); }
    if (byT.has(t)) return byT.get(t);
    let v;
    if (!node.expression) {
        v = preValue(node);
    } else {
        if (evaluating.has(node)) throw new Error("circular reference at " + describe(node));
        evaluating.add(node);
        try {
            v = runExpression(node, t);
        } finally {
            evaluating.delete(node);
        }
    }
    byT.set(t, v);
    return v;
}

function describe(node) {
    const parts = [];
    let n = node;
    while (n && n.matchName !== "ADBE Root") { parts.unshift(n.name); n = n.parent; }
    return layerOf(node).comp.name + " / " + layerOf(node).name + " > " + parts.join(" > ");
}

function findChild(group, key) {
    if (typeof key === "number") return group.children[key - 1];
    return group.children.find(c => c.name === key) || group.children.find(c => c.matchName === key);
}

function transformOf(layer, t) {
    const tg = layer.find("ADBE Transform Group");
    return {
        anchor: evalProp(findChild(tg, "ADBE Anchor Point"), t),
        position: evalProp(findChild(tg, "ADBE Position"), t),
        scale: evalProp(findChild(tg, "ADBE Scale"), t),
        opacity: evalProp(findChild(tg, "ADBE Opacity"), t),
    };
}

// レイヤー空間 → コンポ空間
function toComp(layer, p, t) {
    let q = p.slice(0, 2);
    let l = layer;
    while (l) {
        const tf = transformOf(l, t);
        q = [tf.position[0] + tf.scale[0] / 100 * (q[0] - tf.anchor[0]),
            tf.position[1] + tf.scale[1] / 100 * (q[1] - tf.anchor[1])];
        l = l.parent;
    }
    return q;
}

function fromComp(layer, p, t) {
    const chain = [];
    let l = layer;
    while (l) { chain.unshift(l); l = l.parent; }
    let q = p.slice(0, 2);
    for (const c of chain) {
        const tf = transformOf(c, t);
        q = [tf.anchor[0] + (q[0] - tf.position[0]) / (tf.scale[0] / 100 || 1e-9),
            tf.anchor[1] + (q[1] - tf.position[1]) / (tf.scale[1] / 100 || 1e-9)];
    }
    return q;
}

// 文字の実寸の近似（全角 1em / 半角 0.6em、インク高さ 0.86em）
function charWidth(ch) {
    if (/[ -~]/.test(ch)) return /[0-9]/.test(ch) ? 0.62 : 0.55;
    return 0.98;
}
function textRect(style) {
    const fs = style.fontSize;
    let w = 0;
    for (const ch of style.text) w += charWidth(ch) * fs;
    const h = 0.86 * fs;
    let left = 0.03 * fs;
    if (style.justification === "CENTER_JUSTIFY") left = -w / 2;
    if (style.justification === "RIGHT_JUSTIFY") left = -w;
    return { left, top: -0.80 * fs, width: w, height: h };
}

function sourceTextValue(layer, t, selfNode) {
    const node = layer.find("ADBE Text Properties", "ADBE Text Document");
    const st = (node === selfNode) ? preValue(node) : postText(node, t);
    const obj = {
        style: st,
        value: st.text,
        text: st.text,
        toString() { return st.text; },
        getStyleAt() { return st; },
    };
    return obj;
}

function postText(node, t) {
    const v = evalProp(node, t);
    const pre = preValue(node);
    if (v instanceof TextStyle) return new TextStyle(Object.assign({}, v, { text: v.text !== undefined ? v.text : pre.text, justification: pre.justification }));
    if (typeof v === "string") return new TextStyle(Object.assign({}, pre, { text: v }));
    throw new Error("Source Text expression returned " + typeof v);
}

function layerExpr(layer, t, selfNode) {
    const L = {
        name: layer.name,
        effect(name) {
            const fx = layer.find("ADBE Effect Parade", name);
            if (!fx) throw new Error('effect("' + name + '") not found on ' + layer.name);
            return function (idx) {
                const p = findChild(fx, idx);
                if (!p) throw new Error("effect param " + idx + " not found on " + name);
                return evalProp(p, t);
            };
        },
        sourceRectAtTime(tt, ext) {
            if (layer.type !== "text") throw new Error("sourceRectAtTime on non-text layer not supported in mock");
            return textRect(postText(layer.find("ADBE Text Properties", "ADBE Text Document"), t));
        },
        toComp(p) { return toComp(layer, p, t); },
        fromComp(p) { return fromComp(layer, p, t); },
        get transform() {
            const tf = transformOf(layer, t);
            return { anchorPoint: tf.anchor, position: tf.position, scale: tf.scale, opacity: tf.opacity };
        },
        get inPoint() { return 0; },
    };
    if (layer.type === "text") {
        Object.defineProperty(L, "text", { get() { return { sourceText: sourceTextValue(layer, t, selfNode) }; } });
    }
    return L;
}

function runExpression(node, t) {
    const layer = layerOf(node);
    const comp = layer.comp;
    const thisLayer = layerExpr(layer, t, node);
    const env = {
        thisComp: {
            name: comp.name,
            frameDuration: comp.frameDuration,
            duration: comp.duration,
            width: comp.width, height: comp.height,
            layer(k) {
                const l = comp.layer(k);
                if (!l) throw new Error('thisComp.layer("' + k + '") not found');
                return layerExpr(l, t, node);
            },
        },
        thisLayer,
        time: t,
        value: node.kind === "text" ? preValue(node).text : node.value,
        linear, ease, clamp,
        effect: thisLayer.effect,
        sourceRectAtTime: thisLayer.sourceRectAtTime,
        toComp: thisLayer.toComp,
        fromComp: thisLayer.fromComp,
    };
    if (layer.type === "text") env.text = thisLayer.text;
    Object.defineProperty(env, "transform", { get() { return thisLayer.transform; } });
    let v;
    try {
        v = vm.runInNewContext(node.expression, env, { timeout: 1000 });
    } catch (e) {
        throw new Error("expression error at " + describe(node) + " t=" + t + ": " + e.message);
    }
    validateResult(node, v, t);
    return v;
}

function validateResult(node, v, t) {
    const where = describe(node) + " t=" + t.toFixed(3);
    const k = node.kind;
    if (k === "scalar") {
        if (!isNum(v)) throw new Error("non-number result " + JSON.stringify(v) + " at " + where);
        if (/Opacity$/.test(node.matchName) && (v < -1e-6 || v > 100 + 1e-6)) warnings.push("opacity out of range " + v + " at " + where);
    } else if (k === "2d") {
        if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) throw new Error("bad 2D result " + JSON.stringify(v) + " at " + where);
    } else if (k === "color") {
        if (!Array.isArray(v) || v.length !== 4 || !v.every(isNum)) throw new Error("bad color result " + JSON.stringify(v) + " at " + where);
        if (v.some(x => x < -1e-6 || x > 1 + 1e-6)) warnings.push("color out of 0..1 " + JSON.stringify(v) + " at " + where);
    } else if (k === "text") {
        if (!(v instanceof TextStyle) && typeof v !== "string") throw new Error("bad text result at " + where);
    }
    if (node.max !== undefined && isNum(v) && v > node.max + 1e-6) warnings.push("value " + v + " above max " + node.max + " at " + where);
}

// ---------------------------------------------------------------------
// 全エクスプレッションの評価
// ---------------------------------------------------------------------
function allExprNodes(comp) {
    const out = [];
    function walk(n) {
        if (n instanceof PropNode) { if (n.expression) out.push(n); return; }
        (n.children || []).forEach(walk);
    }
    comp._layers.forEach(l => walk(l.root));
    return out;
}

const TIMES = [];
for (let f = 0; f <= 90; f += 1) TIMES.push(f / 29.97);
TIMES.push(4.5);

let exprCount = 0, evalCount = 0;
for (const comp of comps) {
    const nodes = allExprNodes(comp);
    exprCount += nodes.length;
    for (const t of TIMES) {
        cache.clear();
        for (const n of nodes) {
            try { evalProp(n, t); evalCount++; } catch (e) { problems.push(e.message); }
        }
    }
}

// ---------------------------------------------------------------------
// フォント・EGP の確認
// ---------------------------------------------------------------------
for (const comp of comps) {
    const labels = comp._egp.map(e => e.label);
    const dup = labels.filter((l, i) => labels.indexOf(l) !== i);
    if (dup.length) problems.push(comp.name + ": duplicate EGP labels " + dup.join(","));
    comp._egp.forEach(e => {
        if (e.node.kind === "menu" && !e.node.items) problems.push(comp.name + ": dropdown without items " + e.label);
    });
    const prot = comp._markers.filter(m => m.mv.protectedRegion);
    if (!prot.length) warnings.push(comp.name + ": no protected region");
}

console.log("expressions:", exprCount, "evaluations:", evalCount);
console.log("problems:", problems.length);
[...new Set(problems)].slice(0, 30).forEach(p => console.log("  ✗ " + p));
console.log("warnings:", warnings.length);
[...new Set(warnings)].slice(0, 30).forEach(p => console.log("  ! " + p));
for (const comp of comps) {
    console.log("\n[" + comp.name + "] layers:", comp._layers.map(l => l.name).join(", "));
    console.log("  EGP (" + comp._egp.length + "): " + comp._egp.map(e => e.label).join(" / "));
    console.log("  protected:", comp._markers.map(m => m.mv.comment + " " + m.mv.duration + "s").join(", "));
}

// ---------------------------------------------------------------------
// プレビュー用ジオメトリ
// ---------------------------------------------------------------------
function opacityChain(layer, t) {
    return transformOf(layer, t).opacity / 100;
}

function fxVal(layer, name, idx, t) {
    const fx = layer.find("ADBE Effect Parade", name);
    if (!fx) return null;
    return evalProp(findChild(fx, idx), t);
}

function geometry(comp, t) {
    cache.clear();
    const ops = [];
    // 下のレイヤーから描画
    const layers = comp._layers.slice().reverse();
    for (const l of layers) {
        if (l.type === "null") continue;
        const op = opacityChain(l, t);
        if (l.type === "shape") {
            const blurH = fxVal(l, "Fade", 1, t) || 0;
            const dirBlur = fxVal(l, "InBlur", 2, t) || 0;
            const groups = l.find("ADBE Root Vectors Group").children.slice().reverse();
            for (const g of groups) {
                const vecs = findChild(g, "ADBE Vectors Group");
                const fill = vecs.children.find(c => c.matchName === "ADBE Vector Graphic - Fill");
                const color = evalProp(findChild(fill, "ADBE Vector Fill Color"), t);
                const gop = evalProp(findChild(findChild(g, "ADBE Vector Transform Group"), "ADBE Vector Group Opacity"), t) / 100;
                for (const r of vecs.children.filter(c => c.matchName === "ADBE Vector Shape - Rect")) {
                    const size = evalProp(findChild(r, "ADBE Vector Rect Size"), t);
                    const pos = evalProp(findChild(r, "ADBE Vector Rect Position"), t);
                    const a = toComp(l, [pos[0] - size[0] / 2, pos[1] - size[1] / 2], t);
                    const b = toComp(l, [pos[0] + size[0] / 2, pos[1] + size[1] / 2], t);
                    ops.push({ type: "rect", layer: l.name, group: g.name, x0: a[0], y0: a[1], x1: b[0], y1: b[1], color, opacity: op * gop, blurH, dirBlur });
                }
            }
        } else if (l.type === "text") {
            const st = postText(l.find("ADBE Text Properties", "ADBE Text Document"), t);
            const origin = toComp(l, [0, 0], t);
            const unitX = toComp(l, [1, 0], t), unitY = toComp(l, [0, 1], t);
            const sx = unitX[0] - origin[0], sy = unitY[1] - origin[1];
            const shadows = [];
            for (const fxName of ["Shadow", "Shade", "GlowNear", "GlowFar"]) {
                const fx = l.find("ADBE Effect Parade", fxName);
                if (!fx) continue;
                const max = fx.children[1].max || 100;
                shadows.push({
                    name: fxName, color: fxVal(l, fxName, 1, t), opacity: fxVal(l, fxName, 2, t) / max,
                    distance: fxVal(l, fxName, 4, t), softness: fxVal(l, fxName, 5, t),
                });
            }
            ops.push({
                type: "text", layer: l.name, text: st.text, font: st.font, fontSize: st.fontSize,
                fill: st.fillColor, stroke: st.applyStroke ? st.strokeColor : null, strokeWidth: st.applyStroke ? st.strokeWidth : 0,
                justification: st.justification, origin, sx, sy, opacity: op, shadows,
                dirBlur: fxVal(l, "InBlur", 2, t) || 0,
            });
        }
    }
    return ops;
}

if (args.dump) {
    const times = (args.times || "0,0.5,1,1.1,1.2,1.4,1.6,2,3").split(",").map(Number);
    const out = {};
    for (const comp of comps) {
        out[comp.name] = {};
        for (const t of times) out[comp.name][t] = geometry(comp, t);
    }
    fs.writeFileSync(args.dump, JSON.stringify(out, null, 1));
    console.log("\nwrote", args.dump);
}

if (args.trace) {
    // 主要値の推移
    const [cname, lname, ...propPath] = args.trace.split("/");
    const comp = comps.find(c => c.name.indexOf(cname) >= 0);
    const layer = comp.layer(lname);
    let n = layer.root;
    for (const p of propPath) n = findChild(n, /^\d+$/.test(p) ? Number(p) : p);
    for (let f = 0; f <= 70; f += 2) {
        cache.clear();
        const t = f / 29.97;
        const v = evalProp(n, t);
        console.log(String(f).padStart(3), v instanceof TextStyle ? JSON.stringify({ size: v.fontSize, fill: v.fillColor, sw: v.strokeWidth }) : JSON.stringify(v));
    }
}

process.exitCode = problems.length ? 1 : 0;
