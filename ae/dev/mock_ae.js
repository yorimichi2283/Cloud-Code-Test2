// A strict mock of the subset of the After Effects scripting DOM used by the builder.
// It is intentionally harsher than AE in a few places (e.g. every addProperty()
// invalidates all previously fetched property handles of that layer) so code
// that passes here is safe against AE's "Object is invalid" quirks.
"use strict";

const PVT = {
  NO_VALUE: 6412, ThreeD_SPATIAL: 6413, ThreeD: 6414, TwoD_SPATIAL: 6415, TwoD: 6416,
  OneD: 6417, COLOR: 6418, CUSTOM_VALUE: 6419, MARKER: 6420, LAYER_INDEX: 6421,
  MASK_INDEX: 6422, SHAPE: 6423, TEXT_DOCUMENT: 6424,
};

class AEError extends Error {}
const fail = (m) => { throw new AEError(m); };

// ------------------------------------------------------------------ values
class Shape {
  constructor() { this.vertices = []; this.inTangents = []; this.outTangents = []; this.closed = true; }
}
class KeyframeEase {
  constructor(speed, influence) {
    if (typeof speed !== "number" || typeof influence !== "number") fail("KeyframeEase args");
    if (influence < 0.1 || influence > 100) fail("KeyframeEase influence out of range: " + influence);
    this.speed = speed; this.influence = influence;
  }
}
class MarkerValue {
  constructor(comment) { this.comment = comment; this.duration = 0; this.protectedRegion = false; }
}
const TD_KEYS = new Set(["text", "font", "fontSize", "fillColor", "strokeColor", "strokeWidth", "applyFill",
  "applyStroke", "justification", "tracking", "leading", "autoLeading", "strokeOverFill", "fauxBold",
  "fauxItalic", "allCaps", "smallCaps", "baselineShift", "horizontalScale", "verticalScale", "boxText", "pointText"]);
function makeTextDocument(text) {
  const data = {
    text, font: "ArialMT", fontSize: 72, fillColor: [1, 1, 1], strokeColor: [0, 0, 0], strokeWidth: 0,
    applyFill: true, applyStroke: false, justification: 7413, tracking: 0, leading: 86.4, autoLeading: true,
    strokeOverFill: false, fauxBold: false, fauxItalic: false, allCaps: false, smallCaps: false, baselineShift: 0,
    horizontalScale: 1, verticalScale: 1, boxText: false, pointText: true,
  };
  const td = {
    __td: true, data,
    resetCharStyle() {}, resetParagraphStyle() {},
  };
  return new Proxy(td, {
    get(t, k) { if (k in t) return t[k]; if (TD_KEYS.has(k)) return data[k]; if (typeof k === "symbol") return undefined; fail("TextDocument has no attribute " + String(k)); },
    set(t, k, v) {
      if (!TD_KEYS.has(k)) fail("TextDocument cannot set " + String(k));
      if (k === "fillColor" || k === "strokeColor") { if (!Array.isArray(v) || v.length !== 3) fail("TextDocument." + k + " needs 3 values"); }
      if (k === "fontSize" && !(v > 0)) fail("bad fontSize");
      if (k === "text" && typeof v !== "string") fail("text must be string");
      if (k === "font" && typeof v !== "string") fail("font must be string");
      data[k] = v; if (k === "leading") data.autoLeading = false; return true;
    },
  });
}
function cloneTD(td) { const n = makeTextDocument(td.data.text); Object.assign(n.data, JSON.parse(JSON.stringify(td.data))); return n; }

// ------------------------------------------------------------------ schema
const P = (matchName, name, type, def) => ({ kind: "prop", matchName, name, type, def });
const G = (matchName, name, children, indexed, allowed) => ({ kind: "group", matchName, name, children: children || [], indexed: !!indexed, allowed: allowed || [] });

const VECTOR_ITEMS = ["ADBE Vector Group", "ADBE Vector Shape - Rect", "ADBE Vector Shape - Ellipse",
  "ADBE Vector Shape - Star", "ADBE Vector Shape - Group", "ADBE Vector Graphic - Fill",
  "ADBE Vector Graphic - Stroke", "ADBE Vector Graphic - G-Fill", "ADBE Vector Graphic - G-Stroke",
  "ADBE Vector Filter - Merge", "ADBE Vector Filter - Trim"];

const SCHEMA = {
  "ADBE Vector Group": () => G("ADBE Vector Group", "Group 1", [
    P("ADBE Vector Blend Mode", "Blend Mode", "oned", 1),
    G("ADBE Vectors Group", "Contents", [], true, VECTOR_ITEMS),
    G("ADBE Vector Transform Group", "Transform", [
      P("ADBE Vector Anchor", "Anchor Point", "twods", [0, 0]),
      P("ADBE Vector Position", "Position", "twods", [0, 0]),
      P("ADBE Vector Scale", "Scale", "twod", [100, 100]),
      P("ADBE Vector Skew", "Skew", "oned", 0),
      P("ADBE Vector Skew Axis", "Skew Axis", "oned", 0),
      P("ADBE Vector Rotation", "Rotation", "oned", 0),
      P("ADBE Vector Group Opacity", "Opacity", "oned", 100),
    ]),
  ]),
  "ADBE Vector Shape - Ellipse": () => G("ADBE Vector Shape - Ellipse", "Ellipse Path 1", [
    P("ADBE Vector Shape Direction", "Shape Direction", "oned", 1),
    P("ADBE Vector Ellipse Size", "Size", "twod", [100, 100]),
    P("ADBE Vector Ellipse Position", "Position", "twods", [0, 0]),
  ]),
  "ADBE Vector Shape - Rect": () => G("ADBE Vector Shape - Rect", "Rectangle Path 1", [
    P("ADBE Vector Shape Direction", "Shape Direction", "oned", 1),
    P("ADBE Vector Rect Size", "Size", "twod", [100, 100]),
    P("ADBE Vector Rect Position", "Position", "twods", [0, 0]),
    P("ADBE Vector Rect Roundness", "Roundness", "oned", 0),
  ]),
  "ADBE Vector Graphic - Fill": () => G("ADBE Vector Graphic - Fill", "Fill 1", [
    P("ADBE Vector Blend Mode", "Blend Mode", "oned", 1),
    P("ADBE Vector Composite Order", "Composite", "oned", 1),
    P("ADBE Vector Fill Rule", "Fill Rule", "oned", 1),
    P("ADBE Vector Fill Color", "Color", "color", [1, 0, 0, 1]),
    P("ADBE Vector Fill Opacity", "Opacity", "oned", 100),
  ]),
  "ADBE Vector Graphic - Stroke": () => G("ADBE Vector Graphic - Stroke", "Stroke 1", [
    P("ADBE Vector Blend Mode", "Blend Mode", "oned", 1),
    P("ADBE Vector Composite Order", "Composite", "oned", 1),
    P("ADBE Vector Stroke Color", "Color", "color", [1, 1, 1, 1]),
    P("ADBE Vector Stroke Opacity", "Opacity", "oned", 100),
    P("ADBE Vector Stroke Width", "Stroke Width", "oned", 2),
    P("ADBE Vector Stroke Line Cap", "Line Cap", "oned", 1),
    P("ADBE Vector Stroke Line Join", "Line Join", "oned", 1),
    P("ADBE Vector Stroke Miter Limit", "Miter Limit", "oned", 4),
  ]),
  "ADBE Vector Shape - Group": () => G("ADBE Vector Shape - Group", "Path 1", [
    P("ADBE Vector Shape Direction", "Shape Direction", "oned", 1),
    P("ADBE Vector Shape", "Path", "shape", null),
  ]),
  "ADBE Vector Graphic - G-Fill": () => G("ADBE Vector Graphic - G-Fill", "Gradient Fill 1", [
    P("ADBE Vector Blend Mode", "Blend Mode", "oned", 1),
    P("ADBE Vector Composite Order", "Composite", "oned", 1),
    P("ADBE Vector Fill Rule", "Fill Rule", "oned", 1),
    P("ADBE Vector Grad Type", "Type", "oned", 1),
    P("ADBE Vector Grad Start Pt", "Start Point", "twods", [0, 0]),
    P("ADBE Vector Grad End Pt", "End Point", "twods", [100, 0]),
    P("ADBE Vector Grad HiLite Length", "Highlight Length", "oned", 0),
    P("ADBE Vector Grad HiLite Angle", "Highlight Angle", "oned", 0),
    P("ADBE Vector Grad Colors", "Colors", "custom", null),
    P("ADBE Vector Fill Opacity", "Opacity", "oned", 100),
  ]),
  "ADBE Vector Filter - Merge": () => G("ADBE Vector Filter - Merge", "Merge Paths 1", [
    P("ADBE Vector Merge Type", "Mode", "oned", 2),
  ]),
  "ADBE Mask Atom": () => G("ADBE Mask Atom", "Mask 1", [
    P("ADBE Mask Shape", "Mask Path", "shape", null),
    P("ADBE Mask Feather", "Mask Feather", "twod", [0, 0]),
    P("ADBE Mask Opacity", "Mask Opacity", "oned", 100),
    P("ADBE Mask Offset", "Mask Expansion", "oned", 0),
  ]),
  // effects
  "ADBE Slider Control": () => G("ADBE Slider Control", "Slider Control", [P("ADBE Slider Control-0001", "Slider", "oned", 0)]),
  "ADBE Color Control": () => G("ADBE Color Control", "Color Control", [P("ADBE Color Control-0001", "Color", "color", [1, 0, 0, 1])]),
  "ADBE Checkbox Control": () => G("ADBE Checkbox Control", "Checkbox Control", [P("ADBE Checkbox Control-0001", "Checkbox", "oned", 0)]),
  "ADBE Point Control": () => G("ADBE Point Control", "Point Control", [P("ADBE Point Control-0001", "Point", "twods", [0, 0])]),
  "ADBE Fill": () => G("ADBE Fill", "Fill", [
    P("ADBE Fill-0001", "Fill Mask", "maskindex", 0),
    P("ADBE Fill-0007", "All Masks", "oned", 0),
    P("ADBE Fill-0002", "Color", "color", [1, 0, 0, 1]),
    P("ADBE Fill-0006", "Invert", "oned", 0),
    P("ADBE Fill-0003", "Horizontal Feather", "oned", 0),
    P("ADBE Fill-0004", "Vertical Feather", "oned", 0),
    P("ADBE Fill-0005", "Opacity", "oned", 1),
  ]),
  "ADBE Linear Wipe": () => G("ADBE Linear Wipe", "Linear Wipe", [
    P("ADBE Linear Wipe-0001", "Transition Completion", "oned", 0),
    P("ADBE Linear Wipe-0002", "Wipe Angle", "oned", 90),
    P("ADBE Linear Wipe-0003", "Feather", "oned", 0),
  ]),
};
const EFFECTS = new Set(["ADBE Slider Control", "ADBE Color Control", "ADBE Checkbox Control", "ADBE Point Control", "ADBE Fill", "ADBE Linear Wipe"]);

function transformSchema() {
  return G("ADBE Transform Group", "Transform", [
    P("ADBE Anchor Point", "Anchor Point", "threeds", [0, 0, 0]),
    P("ADBE Position", "Position", "threeds", [0, 0, 0]),
    P("ADBE Scale", "Scale", "threed", [100, 100, 100]),
    P("ADBE Orientation", "Orientation", "threed", [0, 0, 0]),
    P("ADBE Rotate X", "X Rotation", "oned", 0),
    P("ADBE Rotate Y", "Y Rotation", "oned", 0),
    P("ADBE Rotate Z", "Rotation", "oned", 0),
    P("ADBE Opacity", "Opacity", "oned", 100),
  ]);
}

// ------------------------------------------------------------------ nodes
let NODE_ID = 0;
function instantiate(s, parent) {
  const n = { id: ++NODE_ID, kind: s.kind, matchName: s.matchName, name: s.name, parent };
  if (s.kind === "group") {
    n.indexed = s.indexed; n.allowed = s.allowed; n.children = s.children.map((c) => instantiate(c, n));
  } else {
    n.type = s.type; n.value = s.def === null ? null : JSON.parse(JSON.stringify(s.def)); n.keys = []; n.expression = ""; n.expressionEnabled = true;
    n.egp = null;
  }
  return n;
}
function dimsOf(type) {
  return { oned: 1, maskindex: 1, twod: 2, twods: 2, threed: 3, threeds: 3, color: 4 }[type];
}
function checkValue(n, v) {
  const t = n.type;
  const isNum = (x) => typeof x === "number" && isFinite(x);
  if (t === "oned" || t === "maskindex") { if (!isNum(v)) fail(n.matchName + ": expected number, got " + JSON.stringify(v)); return v; }
  if (t === "twod" || t === "twods") { if (!Array.isArray(v) || v.length < 2 || v.length > 3 || !v.every(isNum)) fail(n.matchName + ": expected 2D array, got " + JSON.stringify(v)); return v.slice(0, 2); }
  if (t === "threed" || t === "threeds") { if (!Array.isArray(v) || v.length < 2 || v.length > 3 || !v.every(isNum)) fail(n.matchName + ": expected 2/3D array, got " + JSON.stringify(v)); return v.length === 2 ? [v[0], v[1], 0] : v.slice(); }
  if (t === "color") { if (!Array.isArray(v) || v.length < 3 || v.length > 4 || !v.every(isNum)) fail(n.matchName + ": expected color, got " + JSON.stringify(v)); if (v.some((x) => x < 0 || x > 1)) fail(n.matchName + ": color component out of 0..1"); return v.length === 3 ? [v[0], v[1], v[2], 1] : v.slice(); }
  if (t === "shape") { if (!(v instanceof Shape)) fail(n.matchName + ": expected Shape"); if (!v.vertices.length) fail("empty Shape"); return { vertices: v.vertices.map((p) => p.slice()), inTangents: v.inTangents.map((p) => p.slice()), outTangents: v.outTangents.map((p) => p.slice()), closed: v.closed }; }
  if (t === "textdoc") { if (!v || !v.__td) fail("expected TextDocument"); return cloneTD(v); }
  if (t === "marker") { if (!(v instanceof MarkerValue)) fail("expected MarkerValue"); return Object.assign({}, v); }
  fail(n.matchName + ": property cannot be set (type " + t + ")");
}

// Handles: every handle remembers the generation of its owning layer.
class Handle {
  constructor(node, layer) { this._n = node; this._layer = layer; this._gen = layer ? layer._gen : 0; }
  _chk() { if (this._layer && this._gen !== this._layer._gen) fail("Object is invalid (stale handle to " + this._n.matchName + ")"); return this._n; }
  get matchName() { return this._chk().matchName; }
  get name() { return this._chk().name; }
  set name(v) { const n = this._chk(); if (typeof v !== "string" || !v) fail("bad name"); n.name = v; }
  get propertyType() { return this._chk().kind === "group" ? 6214 : 6212; }
  get numProperties() { const n = this._chk(); return n.kind === "group" ? n.children.length : 0; }
  get propertyValueType() {
    const n = this._chk(); if (n.kind === "group") return PVT.NO_VALUE;
    return { oned: PVT.OneD, maskindex: PVT.MASK_INDEX, twod: PVT.TwoD, twods: PVT.TwoD_SPATIAL, threed: PVT.ThreeD, threeds: PVT.ThreeD_SPATIAL, color: PVT.COLOR, shape: PVT.SHAPE, textdoc: PVT.TEXT_DOCUMENT, custom: PVT.CUSTOM_VALUE, marker: PVT.MARKER }[n.type];
  }
  property(key) {
    const n = this._chk();
    if (n.kind !== "group") fail("property() on a non-group " + n.matchName);
    let c = null;
    if (typeof key === "number") c = n.children[key - 1] || null;
    else c = n.children.find((x) => x.matchName === key) || n.children.find((x) => x.name === key) || null;
    if (!c) return null;
    return wrap(c, this._layer);
  }
  addProperty(matchName) {
    const n = this._chk();
    if (n.kind !== "group" || !n.indexed) fail("addProperty on non-indexed group " + n.matchName);
    if (!n.allowed.includes(matchName)) fail("cannot add " + matchName + " to " + n.matchName);
    const f = SCHEMA[matchName]; if (!f) fail("unknown matchName " + matchName);
    const c = instantiate(f(), n);
    if (n.matchName === "ADBE Mask Atom" || matchName === "ADBE Mask Atom") c.maskMode = 6812;
    n.children.push(c);
    if (this._layer) this._layer._gen++;
    return wrap(c, this._layer);
  }
  // masks
  get maskMode() { const n = this._chk(); if (n.matchName !== "ADBE Mask Atom") fail("maskMode on non-mask"); return n.maskMode; }
  set maskMode(v) { const n = this._chk(); if (n.matchName !== "ADBE Mask Atom") fail("maskMode on non-mask"); if (!Object.values(MaskMode).includes(v)) fail("bad mask mode"); n.maskMode = v; }
  // property value API
  get value() { const n = this._chk(); if (n.kind !== "prop") fail("value on group"); if (n.type === "textdoc") return cloneTD(n.value); return JSON.parse(JSON.stringify(n.value)); }
  setValue(v) { const n = this._chk(); if (n.kind !== "prop") fail("setValue on group"); if (n.keys.length) fail("setValue on keyframed property " + n.matchName); n.value = checkValue(n, v); }
  setValueAtTime(t, v) {
    const n = this._chk(); if (typeof t !== "number") fail("time must be number");
    const val = checkValue(n, v);
    const i = n.keys.findIndex((k) => Math.abs(k.t - t) < 1e-6);
    const key = { t, v: val, inInf: null, outInf: null, interp: "linear" };
    if (i >= 0) n.keys[i] = key; else { n.keys.push(key); n.keys.sort((a, b) => a.t - b.t); }
  }
  get numKeys() { return this._chk().keys.length; }
  nearestKeyIndex(t) { const n = this._chk(); let best = 1, bd = 1e9; n.keys.forEach((k, i) => { const d = Math.abs(k.t - t); if (d < bd) { bd = d; best = i + 1; } }); return best; }
  setInterpolationTypeAtKey(k, a, b) { const n = this._chk(); if (k < 1 || k > n.keys.length) fail("key index out of range"); n.keys[k - 1].interp = "bezier"; }
  setTemporalEaseAtKey(k, inE, outE) {
    const n = this._chk(); if (k < 1 || k > n.keys.length) fail("key index out of range");
    const need = (n.type === "twods" || n.type === "threeds" || n.type === "oned") ? 1 : dimsOf(n.type);
    if (!Array.isArray(inE) || inE.length !== need || outE.length !== need) fail("setTemporalEaseAtKey: needs " + need + " eases for " + n.matchName);
    n.keys[k - 1].inInf = inE[0].influence; n.keys[k - 1].outInf = outE[0].influence;
  }
  get expression() { return this._chk().expression; }
  set expression(s) { const n = this._chk(); if (n.kind !== "prop") fail("expression on group"); if (typeof s !== "string") fail("expression must be string"); n.expression = s; }
  get expressionError() { return ""; }
  canAddToMotionGraphicsTemplate(comp) { const n = this._chk(); return n.kind === "prop" && ["oned", "twod", "twods", "threed", "threeds", "color", "textdoc"].includes(n.type); }
  addToMotionGraphicsTemplateAs(comp, name) { const n = this._chk(); if (!this.canAddToMotionGraphicsTemplate(comp)) fail("cannot add to EGP"); comp._egp.push({ node: n, name }); n.egp = name; return true; }
  addToMotionGraphicsTemplate(comp) { return this.addToMotionGraphicsTemplateAs(comp, this._n.name); }
}
function wrap(node, layer) { return new Handle(node, layer); }

// ------------------------------------------------------------------ layers
let LAYER_ID = 0;
class Layer extends Handle {
  constructor(comp, kind, extra) {
    const root = { id: ++NODE_ID, kind: "group", matchName: "ADBE Layer", name: "", indexed: false, allowed: [], children: [] };
    super(root, null);
    this._gen = 0; this._layer = this; this._root = root;
    this.id = ++LAYER_ID; this.containingComp = comp; this.kind = kind;
    this._parent = null; this.guideLayer = false; this.enabled = true; this.shy = false; this.locked = false;
    this.blendingMode = BlendingMode.NORMAL; this.collapseTransformation = false; this.startTime = 0; this.threeDLayer = false;
    this._trackMatteType = 5012; // NO_TRACK_MATTE
    this.inPoint = 0; this.outPoint = comp.duration; this.source = extra.source || null; this.solidColor = extra.color || null;
    root.children.push(instantiate(G("ADBE Marker", "Marker", []), root));
    root.children.push(instantiate(transformSchema(), root));
    root.children.push(instantiate(G("ADBE Mask Parade", "Masks", [], true, ["ADBE Mask Atom"]), root));
    root.children.push(instantiate(G("ADBE Effect Parade", "Effects", [], true, Array.from(EFFECTS)), root));
    if (kind === "shape") root.children.push(instantiate(G("ADBE Root Vectors Group", "Contents", [], true, VECTOR_ITEMS), root));
    if (kind === "text") {
      const tp = instantiate(G("ADBE Text Properties", "Text", [P("ADBE Text Document", "Source Text", "textdoc", null)]), root);
      tp.children[0].value = makeTextDocument(extra.text);
      root.children.push(tp);
    }
    root.name = extra.name;
    // AE defaults
    const tr = root.children[1];
    const set = (m, v) => { tr.children.find((c) => c.matchName === m).value = v; };
    set("ADBE Position", [comp.width / 2, comp.height / 2, 0]);
    if (kind === "null") set("ADBE Anchor Point", [50, 50, 0]);
    if (kind === "solid" || kind === "precomp" || kind === "footage") { const w = extra.w, h = extra.h; set("ADBE Anchor Point", [w / 2, h / 2, 0]); this.width = w; this.height = h; }
  }
  _chk() { return this._root; }
  get name() { return this._root.name; }
  set name(v) { if (typeof v !== "string" || !v) fail("bad layer name"); this._root.name = v; }
  get parent() { return this._parent; }
  _checkParent(p) {
    if (p !== null && !(p instanceof Layer)) fail("parent must be a Layer");
    if (p && p.containingComp !== this.containingComp) fail("parent in another comp");
    if (p === this) fail("parent to self");
  }
  // Like AE: assigning .parent keeps the layer where it is on screen by rewriting
  // its position / scale / rotation (anchor unchanged). Uses static (pre-expression) values.
  set parent(p) {
    this._checkParent(p);
    const before = staticMatrix(this);
    this._parent = p;
    const pm = p ? staticMatrix(p) : [1, 0, 0, 1, 0, 0];
    const det = pm[0] * pm[3] - pm[1] * pm[2];
    if (Math.abs(det) < 1e-12) fail("parent has zero scale");
    const inv = [pm[3] / det, -pm[1] / det, -pm[2] / det, pm[0] / det, 0, 0];
    inv[4] = -(inv[0] * pm[4] + inv[2] * pm[5]); inv[5] = -(inv[1] * pm[4] + inv[3] * pm[5]);
    const m = mulM(inv, before);
    const tr = this._root.children.find((c) => c.matchName === "ADBE Transform Group");
    const get = (mn) => tr.children.find((c) => c.matchName === mn);
    const a = staticVal(get("ADBE Anchor Point"));
    const sx = Math.hypot(m[0], m[1]), rot = Math.atan2(m[1], m[0]), sy = (m[0] * m[3] - m[1] * m[2]) / sx;
    const pos = [m[4] + m[0] * a[0] + m[2] * a[1], m[5] + m[1] * a[0] + m[3] * a[1], 0];
    for (const [mn, v] of [["ADBE Position", pos], ["ADBE Scale", [sx * 100, sy * 100, 100]], ["ADBE Rotate Z", rot * 180 / Math.PI]]) {
      const n = get(mn); if (n.keys.length) fail("mock: parenting a layer with keyframed " + mn + " is not modelled"); n.value = v;
    }
  }
  setParentWithJump(p) { this._checkParent(p); this._parent = p; }
  setTrackMatte(L, type) {
    if (!(L instanceof Layer) || L.containingComp !== this.containingComp || L === this) fail("setTrackMatte: bad matte layer");
    if (!Object.values(TrackMatteType).includes(type)) fail("setTrackMatte: bad type");
    this._matteLayer = L; this._trackMatteType = type;
  }
  get index() { return this.containingComp._layers.indexOf(this) + 1; }
  get trackMatteType() { return this._trackMatteType; }
  set trackMatteType(v) {
    if (!Object.values(TrackMatteType).includes(v)) fail("bad TrackMatteType");
    if (v !== TrackMatteType.NO_TRACK_MATTE && this.index === 1) fail("track matte needs a layer above");
    this._trackMatteType = v;
  }
  get transform() { return this.property("ADBE Transform Group"); }
  moveToBeginning() { const a = this.containingComp._layers; a.splice(a.indexOf(this), 1); a.unshift(this); }
  moveToEnd() { const a = this.containingComp._layers; a.splice(a.indexOf(this), 1); a.push(this); }
  moveBefore(L) { if (!(L instanceof Layer) || L.containingComp !== this.containingComp || L === this) fail("moveBefore arg"); const a = this.containingComp._layers; a.splice(a.indexOf(this), 1); a.splice(a.indexOf(L), 0, this); }
  moveAfter(L) { if (!(L instanceof Layer) || L.containingComp !== this.containingComp || L === this) fail("moveAfter arg"); const a = this.containingComp._layers; a.splice(a.indexOf(this), 1); a.splice(a.indexOf(L) + 1, 0, this); }
}

function staticVal(n) { return n.keys && n.keys.length ? n.keys[0].v : n.value; }
function mulM(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function staticMatrix(L) {
  const tr = L._root.children.find((c) => c.matchName === "ADBE Transform Group");
  const g = (mn) => staticVal(tr.children.find((c) => c.matchName === mn));
  const a = g("ADBE Anchor Point"), p = g("ADBE Position"), s = g("ADBE Scale"), r = g("ADBE Rotate Z") * Math.PI / 180;
  const sx = s[0] / 100, sy = s[1] / 100, cs = Math.cos(r), sn = Math.sin(r);
  let m = [cs * sx, sn * sx, -sn * sy, cs * sy, 0, 0];
  m[4] = p[0] - (m[0] * a[0] + m[2] * a[1]); m[5] = p[1] - (m[1] * a[0] + m[3] * a[1]);
  return L._parent ? mulM(staticMatrix(L._parent), m) : m;
}

class LayerCollection {
  constructor(comp) { this.comp = comp; }
  _add(L) { this.comp._layers.unshift(L); return L; }
  addNull(d) { return this._add(new Layer(this.comp, "null", { name: "Null " + (this.comp._layers.length + 1) })); }
  addShape() { return this._add(new Layer(this.comp, "shape", { name: "Shape Layer " + (this.comp._layers.length + 1) })); }
  addText(s) { if (typeof s !== "string") fail("addText needs string"); return this._add(new Layer(this.comp, "text", { name: s.split("\r")[0] || "Text", text: s })); }
  addSolid(color, name, w, h, par, dur) {
    if (!Array.isArray(color) || color.length !== 3) fail("addSolid color needs 3 values");
    if (typeof name !== "string" || !(w > 0) || !(h > 0) || !(par > 0)) fail("addSolid args");
    return this._add(new Layer(this.comp, "solid", { name, color, w, h }));
  }
  add(item, dur) {
    if (item instanceof FootageItem) return this._add(new Layer(this.comp, "footage", { name: item.name, source: item, w: item.width, h: item.height }));
    if (!(item instanceof CompItem)) fail("layers.add needs an item");
    if (item === this.comp) fail("cannot add comp to itself");
    return this._add(new Layer(this.comp, "precomp", { name: item.name, source: item, w: item.width, h: item.height }));
  }
}

// ------------------------------------------------------------------ project
class Item { constructor(name) { this.name = name; this._parentFolder = null; } get parentFolder() { return this._parentFolder; } set parentFolder(f) { if (!(f instanceof FolderItem)) fail("parentFolder must be FolderItem"); this._parentFolder = f; } }
class FolderItem extends Item {}
class FootageItem extends Item {
  constructor(file) {
    super(require("path").basename(file));
    const buf = require("fs").readFileSync(file);
    if (buf.readUInt32BE(0) !== 0x89504e47) fail("importFile: not a PNG: " + file);
    this.width = buf.readUInt32BE(16); this.height = buf.readUInt32BE(20); this.file = file;
  }
}
const FS = require("fs"), PATH = require("path"), OS = require("os");
const MOCK_ROOT = PATH.join(OS.tmpdir(), "kg_mock_fs");
class MFile {
  constructor(p) { this.fsName = String(p); this.encoding = "UTF-8"; this._mode = null; this._chunks = null; }
  get exists() { return FS.existsSync(this.fsName); }
  get name() { return PATH.basename(this.fsName); }
  get parent() { return new MFolder(PATH.dirname(this.fsName)); }
  open(mode) { if (MFile.deny && mode === "w") throw new AEError("Unable to execute script. Permission denied (scripts may not write files)"); if (!FS.existsSync(PATH.dirname(this.fsName))) return false; this._mode = mode; this._chunks = []; return true; }
  write(s) {
    if (this._mode !== "w") fail("File.write without open('w')");
    if (this.encoding !== "BINARY") fail("binary data must be written with encoding BINARY");
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) fail("File.write: char > 255 in binary string");
    this._chunks.push(Buffer.from(s, "latin1")); return true;
  }
  close() { if (this._mode === "w") FS.writeFileSync(this.fsName, Buffer.concat(this._chunks)); this._mode = null; return true; }
}
class MFolder {
  constructor(p) { this.fsName = String(p); }
  get exists() { return FS.existsSync(this.fsName) && FS.statSync(this.fsName).isDirectory(); }
  create() { if (MFile.deny) throw new AEError("Unable to execute script. Permission denied (scripts may not write files)"); FS.mkdirSync(this.fsName, { recursive: true }); return true; }
}
class ImportOptions { constructor(f) { if (!(f instanceof MFile)) fail("ImportOptions needs a File"); this.file = f; } }
let ITEM_ID = 0;
class CompItem extends Item {
  constructor(name, w, h, par, dur, fps) {
    super(name);
    this.id = ++ITEM_ID;
    if (typeof name !== "string" || !(w >= 4) || !(h >= 4) || !(par > 0) || !(dur > 0) || !(fps > 0)) fail("addComp args");
    this.width = w; this.height = h; this.pixelAspect = par; this.duration = dur; this.frameRate = fps;
    this._layers = []; this.layers = new LayerCollection(this); this._egp = []; this.bgColor = [0, 0, 0];
    this.motionGraphicsTemplateName = ""; this._markerNode = instantiate(P("ADBE Marker", "Marker", "marker", null), null); this._markerNode.keys = [];
    this.markerProperty = wrap(this._markerNode, null);
  }
  get numLayers() { return this._layers.length; }
  layer(k) { if (typeof k === "number") return this._layers[k - 1] || null; return this._layers.find((l) => l.name === k) || null; }
  openInViewer() {}
  // Real AE: the 2nd argument is a FOLDER; the file is named after motionGraphicsTemplateName.
  // An unsaved/modified project makes AE prompt to save; modelled as a failure.
  exportAsMotionGraphicsTemplate(over, folderPath) {
    if (!this._egp.length) return false;
    if (!this._project || !this._project._saved) { this._project && this._project._log.push(["prompt", "save project before MOGRT export"]); return false; }
    if (typeof folderPath !== "string" || /\.mogrt$/i.test(folderPath)) return false;
    if (!FS.existsSync(folderPath) || !FS.statSync(folderPath).isDirectory()) return false;
    const f = PATH.join(folderPath, (this.motionGraphicsTemplateName || this.name) + ".mogrt");
    FS.writeFileSync(f, "mock mogrt"); this._exported = f; return true;
  }
}

function makeApp(opts) {
  const items = [];
  const project = {
    expressionEngine: "extendscript",
    file: null, _saved: false, _log: opts.log,
    save() { if (!this.file) fail("project.save() on an untitled project"); this._saved = true; return true; },
    saveWithDialog() { if (opts.saveCancel) return false; this.file = new MFile(PATH.join(MOCK_ROOT, "project.aep")); this._saved = true; return true; },
    itemByID(id) { return items.find((x) => x.id === id) || null; },
    get numItems() { return items.length; },
    item(i) { if (i < 1 || i > items.length) fail("item index"); return items[i - 1]; },
    importFile(io) {
      if (!(io instanceof ImportOptions)) fail("importFile needs ImportOptions");
      if (!io.file.exists) fail("importFile: file missing " + io.file.fsName);
      const f = new FootageItem(io.file.fsName); items.push(f); return f;
    },
    items: {
      addComp(name, w, h, par, dur, fps) { const c = new CompItem(name, w, h, par, dur, fps); c._project = project; project._saved = false; items.push(c); return c; },
      addFolder(name) { const f = new FolderItem(name); items.push(f); return f; },
    },
    _items: items,
  };
  const installed = new Set(opts.fonts || []);
  return {
    version: opts.version || "26.0x50",
    project,
    fonts: opts.noFontsApi ? undefined : { getFontsByPostScriptName(n) { return installed.has(n) ? [{ postScriptName: n }] : []; } },
    newProject() { return project; },
    preferences: {
      havePref(section, key, type) { return opts.prefFileWrite !== undefined && key === "Pref_SCRIPTING_FILE_NETWORK_SECURITY" && section === "Main Pref Section v2"; },
      getPrefAsLong(section, key, type) { if (!this.havePref(section, key, type)) fail("no such pref"); return opts.prefFileWrite; },
    },
    beginUndoGroup() {}, endUndoGroup() {}, beginSuppressDialogs() {}, endSuppressDialogs() {},
  };
}

const MaskMode = { NONE: 6812 + 0, ADD: 6813, SUBTRACT: 6814, INTERSECT: 6815, LIGHTEN: 6816, DARKEN: 6817, DIFFERENCE: 6818 };
const BlendingMode = { NORMAL: 5212, SCREEN: 5220, ADD: 5213, MULTIPLY: 5216 };
const ParagraphJustification = { LEFT_JUSTIFY: 7413, RIGHT_JUSTIFY: 7414, CENTER_JUSTIFY: 7415 };
const TrackMatteType = { NO_TRACK_MATTE: 5012, ALPHA: 5013, ALPHA_INVERTED: 5014, LUMA: 5015, LUMA_INVERTED: 5016 };
const KeyframeInterpolationType = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };

function makeGlobals(opts) {
  const log = [];
  opts = Object.assign({}, opts, { log });
  MFile.deny = !!opts.denyWrite;
  const app = makeApp(opts);
  return {
    app, log,
    Shape, KeyframeEase, MarkerValue, MaskMode, BlendingMode, ParagraphJustification, KeyframeInterpolationType, TrackMatteType,
    PropertyValueType: PVT,
    PREFType: { PREF_Type_MACHINE_SPECIFIC: 0, PREF_Type_MACHINE_INDEPENDENT: 1, PREF_Type_MACHINE_INDEPENDENT_RENDER: 2, PREF_Type_MACHINE_INDEPENDENT_OUTPUT: 3, PREF_Type_MACHINE_INDEPENDENT_COMPOSITION: 4, PREF_Type_MACHINE_SPECIFIC_TEXT: 5, PREF_Type_MACHINE_SPECIFIC_PAINT: 6 },
    $: { sleep() {}, fileName: "KanagawaGenba_Builder.jsx" },
    alert: (m) => log.push(["alert", String(m)]),
    confirm: (m) => { log.push(["confirm", String(m)]); return !!opts.confirm; },
    File: MFile, ImportOptions,
    Folder: Object.assign(MFolder, {
      myDocuments: new MFolder(PATH.join(MOCK_ROOT, "Documents")),
      temp: new MFolder(PATH.join(MOCK_ROOT, "tmp")),
      userData: new MFolder(PATH.join(MOCK_ROOT, "Library", "Application Support")),
      selectDialog: (m) => (opts.folder ? new MFolder(opts.folder) : null),
    }),
  };
}

module.exports = { makeGlobals, Layer, CompItem, FolderItem, FootageItem, MOCK_ROOT, Shape, AEError, PVT, MaskMode, BlendingMode, ParagraphJustification, cloneTD };
