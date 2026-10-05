// Minimal After Effects expression evaluator for the mock project.
// Supports exactly what the builder's expressions use.
"use strict";
const { CompItem, Layer, AEError } = require("./mock_ae.js");

function easeFrac(s, o, i) {
  // AE-like temporal ease with zero speeds: bezier x(u)=(0,o,1-i,1) y(u)=(0,0,1,1)
  if (o == null && i == null) return s;
  const x1 = (o == null ? 0 : o / 100) , x2 = 1 - (i == null ? 0 : i / 100);
  const bx = (u) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const by = (u) => 3 * (1 - u) * u * u + u * u * u;
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (bx(m) < s) lo = m; else hi = m; }
  return by((lo + hi) / 2);
}
function lerp(a, b, f) {
  if (Array.isArray(a)) return a.map((x, i) => x + (b[i] - x) * f);
  return a + (b - a) * f;
}
function keyedValue(node, t) {
  const ks = node.keys;
  if (!ks || !ks.length) return node.value;
  if (t <= ks[0].t) return ks[0].v;
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t >= a.t && t <= b.t) {
      const s = (t - a.t) / (b.t - a.t);
      const f = (a.outInf != null || b.inInf != null) ? easeFrac(s, a.outInf, b.inInf) : s;
      return lerp(a.v, b.v, f);
    }
  }
  return ks[ks.length - 1].v;
}

const API = {
  clamp(v, a, b) { if (Array.isArray(v)) return v.map((x) => Math.min(Math.max(x, a), b)); return Math.min(Math.max(v, a), b); },
  linear(t, a, b, c, d) {
    if (arguments.length === 3) { c = a; d = b; a = 0; b = 1; }
    if (arguments.length !== 5 && arguments.length !== 3) throw new Error("linear() arity");
    let f = b === a ? 1 : (t - a) / (b - a);
    f = Math.min(Math.max(f, 0), 1);
    if (Array.isArray(c) !== Array.isArray(d)) throw new Error("linear() mixed array/scalar");
    if (Array.isArray(c) && c.length !== d.length) throw new Error("linear() length mismatch");
    return lerp(c, d, f);
  },
  createPath(points, inT, outT, closed) {
    if (!Array.isArray(points) || !points.length) throw new Error("createPath points");
    const z = points.map(() => [0, 0]);
    return { __path: true, vertices: points, inTangents: (inT && inT.length) ? inT : z, outTangents: (outT && outT.length) ? outT : z, closed: closed !== false };
  },
  degreesToRadians(d) { return d * Math.PI / 180; },
  add(a, b) { if (!Array.isArray(a) || !Array.isArray(b)) return a + b; return a.map((x, i) => x + (b[i] || 0)); },
  sub(a, b) { if (!Array.isArray(a) || !Array.isArray(b)) return a - b; return a.map((x, i) => x - (b[i] || 0)); },
  mul(a, k) { return Array.isArray(a) ? a.map((x) => x * k) : a * k; },
};

// rough text metrics (only used for sourceRectAtTime in previews/validation)
function charW(ch) {
  const c = ch.charCodeAt(0);
  if (c > 0x2e80) return 1.0;
  if (ch === " ") return 0.28;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[a-z]/.test(ch)) return 0.55;
  if (/[0-9]/.test(ch)) return 0.6;
  return 0.35;
}
function measure(text, td) {
  const size = td.fontSize, lines = String(text).split("\r");
  const lead = td.autoLeading ? size * 1.2 : td.leading;
  const track = (td.tracking || 0) / 1000 * size;
  let w = 0;
  for (const ln of lines) { let lw = 0; for (const ch of ln) lw += charW(ch) * size + track; w = Math.max(w, lw - (ln.length ? track : 0)); }
  const cjk = /[⺀-￿]/.test(text);
  const asc = (cjk ? 0.88 : 0.72) * size, desc = (cjk ? 0.12 : 0.02) * size;
  let left = 0;
  if (td.justification === 7415) left = -w / 2; else if (td.justification === 7414) left = -w;
  return { left, top: -asc, width: w, height: asc + desc + (lines.length - 1) * lead };
}

function makeEvaluator(globals) {
  const project = globals.app.project;
  const compsByName = new Map();
  for (const it of project._items) if (it instanceof CompItem) compsByName.set(it.name, it);
  const layerOfNode = new Map();
  for (const c of compsByName.values()) for (const L of c._layers) (function walk(n) { layerOfNode.set(n, L); (n.children || []).forEach(walk); })(L._root);

  const fnCache = new Map();
  const stats = { evals: 0 };
  const stack = new Set();

  function findChild(group, key) {
    if (typeof key === "number") return group.children[key - 1];
    return group.children.find((c) => c.matchName === key) || group.children.find((c) => c.name === key);
  }
  function layerNode(L, m) { return findChild(L._root, m); }

  function valueOf(node, t) {
    if (node.expression && node.expressionEnabled) return evalExpr(node, t);
    if (node.type === "textdoc") return node.value.data.text;
    return keyedValue(node, t);
  }

  function compProxy(c) {
    return {
      name: c.name, width: c.width, height: c.height, duration: c.duration,
      layer(k) {
        const L = c.layer(k);
        if (!L) throw new AEError("expression: layer not found: " + k + " in comp " + c.name);
        return layerProxy(L);
      },
    };
  }
  function layerProxy(L) {
    return {
      name: L.name,
      effect(name) {
        const fx = layerNode(L, "ADBE Effect Parade");
        const e = findChild(fx, name);
        if (!e) throw new AEError("expression: effect not found: " + name + " on layer " + L.name);
        const f = function (idx) {
          const p = findChild(e, idx);
          if (!p) throw new AEError("expression: effect param not found: " + idx);
          return valueOf(p, cur.t);
        };
        return f;
      },
      get text() {
        const tp = layerNode(L, "ADBE Text Properties");
        if (!tp) throw new AEError("expression: layer has no text: " + L.name);
        return { sourceText: valueOf(tp.children[0], cur.t) };
      },
      sourceRectAtTime(t) { return rectOf(L, t === undefined ? cur.t : t); },
      toComp(pt, t) { return toCompPt(L, pt, t === undefined ? cur.t : t); },
      fromComp(pt, t) { return fromCompPt(L, pt, t === undefined ? cur.t : t); },
    };
  }
  function rectOf(L, t) {
    const tp = layerNode(L, "ADBE Text Properties");
    if (!tp) return { left: 0, top: 0, width: L.width || 100, height: L.height || 100 };
    const node = tp.children[0];
    const txt = valueOf(node, t);
    return measure(txt, node.value.data);
  }

  // layer space -> comp space affine matrix [a b c d e f] (2D, with parenting)
  function layerMatrix(L, t) {
    const tr = layerNode(L, "ADBE Transform Group");
    const a = valueOf(findChild(tr, "ADBE Anchor Point"), t), p = valueOf(findChild(tr, "ADBE Position"), t), s = valueOf(findChild(tr, "ADBE Scale"), t);
    const r = valueOf(findChild(tr, "ADBE Rotate Z"), t) * Math.PI / 180;
    const sx = s[0] / 100, sy = s[1] / 100, cs = Math.cos(r), sn = Math.sin(r);
    let m = [cs * sx, sn * sx, -sn * sy, cs * sy, 0, 0];
    m[4] = p[0] - (m[0] * a[0] + m[2] * a[1]);
    m[5] = p[1] - (m[1] * a[0] + m[3] * a[1]);
    if (L.parent) {
      const q = layerMatrix(L.parent, t);
      m = [q[0] * m[0] + q[2] * m[1], q[1] * m[0] + q[3] * m[1], q[0] * m[2] + q[2] * m[3], q[1] * m[2] + q[3] * m[3], q[0] * m[4] + q[2] * m[5] + q[4], q[1] * m[4] + q[3] * m[5] + q[5]];
    }
    return m;
  }
  function toCompPt(L, pt, t) { const m = layerMatrix(L, t); return [m[0] * pt[0] + m[2] * pt[1] + m[4], m[1] * pt[0] + m[3] * pt[1] + m[5]]; }
  function fromCompPt(L, pt, t) {
    const m = layerMatrix(L, t), det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) throw new AEError("fromComp: singular transform on " + L.name);
    const x = pt[0] - m[4], y = pt[1] - m[5];
    return [(m[3] * x - m[2] * y) / det, (-m[1] * x + m[0] * y) / det];
  }

  const cur = { t: 0 };
  function evalExpr(node, t) {
    if (stack.has(node)) throw new AEError("expression: cycle");
    stack.add(node);
    const saved = cur.t; cur.t = t;
    try {
      const L = layerOfNode.get(node) || null;
      const C = L ? L.containingComp : null;
      let fn = fnCache.get(node.expression);
      if (!fn) {
        fn = new Function("time", "value", "thisComp", "comp", "thisLayer", "sourceRectAtTime",
          "clamp", "linear", "createPath", "degreesToRadians", "fromComp", "toComp", "add", "sub", "mul", "__code", "return eval(__code);");
        fnCache.set(node.expression, fn);
      }
      const pre = node.type === "textdoc" ? node.value.data.text : keyedValue(node, t);
      const lp = L ? layerProxy(L) : null;
      stats.evals++;
      const r = fn(t, pre, C ? compProxy(C) : null,
        (name) => { const c = compsByName.get(name); if (!c) throw new AEError("expression: comp not found: " + name); return compProxy(c); },
        lp, (tt) => rectOf(L, tt === undefined ? t : tt),
        API.clamp, API.linear, API.createPath, API.degreesToRadians,
        (pt, tt) => fromCompPt(L, pt, tt === undefined ? t : tt), (pt, tt) => toCompPt(L, pt, tt === undefined ? t : tt),
        API.add, API.sub, API.mul, node.expression);
      return checkResult(node, r);
    } finally { cur.t = saved; stack.delete(node); }
  }
  function checkResult(node, r) {
    const bad = (m) => { throw new AEError("expression result: " + m + " for " + node.matchName + " = " + JSON.stringify(r)); };
    const num = (x) => typeof x === "number" && isFinite(x);
    switch (node.type) {
      case "oned": if (!num(r)) bad("expected number"); break;
      case "twod": case "twods": if (!Array.isArray(r) || r.length < 2 || !r.every(num)) bad("expected 2D"); break;
      case "threed": case "threeds": if (!Array.isArray(r) || r.length < 2 || !r.every(num)) bad("expected 2/3D"); break;
      case "color": if (!Array.isArray(r) || r.length < 3 || !r.every(num)) bad("expected color"); break;
      case "shape": if (!r || !r.__path || !r.vertices.every((p) => p.every(num))) bad("expected path"); break;
      case "textdoc": if (typeof r !== "string") bad("expected string"); break;
    }
    return r;
  }

  return { valueOf, evalExpr, keyedValue, layerOfNode, compsByName, stats, measure, findChild, layerMatrix };
}

module.exports = { makeEvaluator, keyedValue, measure };
