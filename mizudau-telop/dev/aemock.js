// After Effects の最小モック。MizudauTelop_MOGRT_Builder.jsx を Node 上で実行し、
// 生成されたレイヤー・エクスプレッションを検証するための開発用ツール。
//   node dev/aemock.js [--installed=PS1,PS2] [--dump=out.json]
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SCRIPT = path.join(__dirname, "..", "MizudauTelop_MOGRT_Builder.jsx");
const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2]] : [a, ""];
}));

// ---------------------------------------------------------------------
// プロパティ／グループとハンドル（addProperty 後の参照無効化を再現）
// ---------------------------------------------------------------------
let handleSerial = 0;

class Node {
    constructor(name, matchName) {
        this.name = name;
        this.matchName = matchName;
        this.parent = null;
        this.layer = null;
    }
    ancestors() {
        const out = [];
        let n = this;
        while (n) { out.push(n); n = n.parent; }
        return out;
    }
}

class PropNode extends Node {
    constructor(name, matchName, kind, value, opts = {}) {
        super(name, matchName);
        this.kind = kind;
        this.value = value;
        this.expression = "";
        this.max = opts.max;
        this.items = null;
    }
}

class GroupNode extends Node {
    constructor(name, matchName, children = [], factory = null) {
        super(name, matchName);
        this.children = [];
        this.factory = factory;
        children.forEach(c => this.attach(c));
    }
    attach(c) {
        c.parent = this;
        this.children.push(c);
        setLayer(c, this.layer);
    }
}

function setLayer(node, layer) {
    node.layer = layer;
    if (node.children) node.children.forEach(c => setLayer(c, layer));
}

function handle(node) {
    if (!node) return null;
    const layer = node.layer;
    const h = node instanceof PropNode ? new PropHandle(node) : new GroupHandle(node);
    h._id = ++handleSerial;
    h._stale = false;
    if (layer) layer._handles.push(h);
    return h;
}

function check(h) {
    if (h._stale) throw new Error("Object is invalid (" + h._node.matchName + ")");
}

class GroupHandle {
    constructor(node) { this._node = node; }
    get name() { check(this); return this._node.name; }
    set name(v) { check(this); this._node.name = v; }
    get matchName() { check(this); return this._node.matchName; }
    get numProperties() { check(this); return this._node.children.length; }
    get propertyType() { return this._node.isIndexed ? "INDEXED_GROUP" : "NAMED_GROUP"; }
    property(k) {
        check(this);
        const ch = this._node.children;
        let n = null;
        if (typeof k === "number") n = ch[k - 1] || null;
        else n = ch.find(c => c.name === k) || ch.find(c => c.matchName === k) || null;
        return handle(n);
    }
    addProperty(mn) {
        check(this);
        if (!this._node.factory) throw new Error("addProperty not allowed on " + this._node.matchName);
        const c = this._node.factory(mn);
        if (!c) throw new Error("Cannot add " + mn + " to " + this._node.matchName);
        this._node.attach(c);
        // 追加先とその祖先以外の、同じレイヤー内の既存参照を無効化
        const layer = this._node.layer;
        if (layer) {
            const keep = new Set(this._node.ancestors());
            layer._handles.forEach(h => { if (!keep.has(h._node)) h._stale = true; });
        }
        return handle(c);
    }
}

class PropHandle {
    constructor(node) { this._node = node; }
    get name() { check(this); return this._node.name; }
    set name(v) { check(this); this._node.name = v; }
    get matchName() { check(this); return this._node.matchName; }
    get propertyType() { return "PROPERTY"; }
    get canSetExpression() { return this._node.kind !== "menu-static"; }
    get value() { check(this); return this._node.value; }
    get hasMax() { return this._node.max !== undefined; }
    get maxValue() { if (this._node.max === undefined) throw new Error("no max"); return this._node.max; }
    get expression() { check(this); return this._node.expression; }
    set expression(v) {
        check(this);
        if (typeof v !== "string") throw new Error("expression must be string");
        this._node.expression = v;
    }
    get expressionError() { return this._node.expressionError || ""; }
    valueAtTime() { return this._node.value; }
    setValue(v) {
        check(this);
        validateValue(this._node, v);
        this._node.value = v;
    }
    setPropertyParameters(items) {
        check(this);
        if (this._node.kind !== "menu") throw new Error("setPropertyParameters only on dropdown menu");
        if (!Array.isArray(items) || items.length < 1) throw new Error("items must be array");
        const seen = new Set();
        items.forEach(s => {
            if (typeof s !== "string" || s === "") throw new Error("menu item must be non-empty string");
            if (seen.has(s)) throw new Error("duplicate menu item " + s);
            seen.add(s);
        });
        this._node.items = items.slice();
        // 元のプロパティ参照と、同じエフェクトへの既存参照は無効化される前提で扱う
        const fxNode = this._node.parent;
        this._node.layer._handles.forEach(h => { if (h._node === this._node || h._node === fxNode) h._stale = true; });
        return handle(this._node);
    }
    canAddToMotionGraphicsTemplate(comp) { return true; }
    addToMotionGraphicsTemplateAs(comp, label) {
        check(this);
        if (!(comp instanceof Comp)) throw new Error("comp expected");
        if (this._node.layer.comp !== comp) throw new Error("property not in comp");
        comp._egp.push({ node: this._node, label });
        return true;
    }
}

function isNum(x) { return typeof x === "number" && isFinite(x); }

function validateValue(node, v) {
    const k = node.kind;
    const bad = () => { throw new Error("Bad value for " + node.matchName + " (" + k + "): " + JSON.stringify(v)); };
    if (k === "scalar" || k === "checkbox") { if (!isNum(v)) bad(); }
    else if (k === "menu") { if (!isNum(v) || v < 1 || (node.items && v > node.items.length)) bad(); }
    else if (k === "2d") { if (!Array.isArray(v) || (v.length !== 2 && v.length !== 3) || !v.every(isNum)) bad(); }
    else if (k === "color") { if (!Array.isArray(v) || v.length !== 4 || !v.every(isNum)) bad(); }
    else if (k === "text") { if (!(v instanceof TextDocument)) bad(); }
    if (node.max !== undefined && isNum(v) && v > node.max + 1e-9) bad();
}

// ---------------------------------------------------------------------
// TextDocument
// ---------------------------------------------------------------------
class TextDocument {
    constructor(text) {
        this.text = text;
        this.font = "ArialMT";
        this.fontSize = 36;
        this.applyFill = true;
        this._fillColor = [1, 1, 1];
        this._applyStroke = false;
        this._strokeColor = [0, 0, 0];
        this._strokeWidth = 1;
        this.strokeOverFill = true;
        this.tracking = 0;
        this.justification = "LEFT_JUSTIFY";
    }
    resetCharStyle() { this.font = "ArialMT"; this.fontSize = 36; }
    resetParagraphStyle() { this.justification = "LEFT_JUSTIFY"; }
    get fillColor() { return this._fillColor; }
    set fillColor(v) { if (!this.applyFill) throw new Error("applyFill is false"); if (!Array.isArray(v) || v.length !== 3) throw new Error("fillColor needs 3"); this._fillColor = v; }
    get applyStroke() { return this._applyStroke; }
    set applyStroke(v) { this._applyStroke = !!v; }
    get strokeColor() { return this._strokeColor; }
    set strokeColor(v) { if (!this._applyStroke) throw new Error("applyStroke is false"); if (!Array.isArray(v) || v.length !== 3) throw new Error("strokeColor needs 3"); this._strokeColor = v; }
    get strokeWidth() { return this._strokeWidth; }
    set strokeWidth(v) { if (!this._applyStroke) throw new Error("applyStroke is false"); this._strokeWidth = v; }
    clone() { const t = new TextDocument(this.text); Object.assign(t, this); return t; }
}

// ---------------------------------------------------------------------
// ファクトリ
// ---------------------------------------------------------------------
const EFFECTS = {
    "ADBE Slider Control": [["Slider", "scalar", 0]],
    "ADBE Color Control": [["Color", "color", [1, 0, 0, 1]]],
    "ADBE Checkbox Control": [["Checkbox", "checkbox", 0]],
    "ADBE Point Control": [["Point", "2d", [0, 0]]],
    "ADBE Dropdown Control": [["Menu", "menu", 1]],
    "ADBE Drop Shadow": [["Shadow Color", "color", [0, 0, 0, 1]], ["Opacity", "scalar", 127.5, { max: 255 }],
        ["Direction", "scalar", 135], ["Distance", "scalar", 5], ["Softness", "scalar", 0], ["Shadow Only", "checkbox", 0]],
    "ADBE Motion Blur": [["Direction", "scalar", 0], ["Blur Length", "scalar", 0]],
    "ADBE Gaussian Blur 2": [["Blurriness", "scalar", 0], ["Blur Dimensions", "menu", 1], ["Repeat Edge Pixels", "checkbox", 0]],
};

function effectFactory(mn) {
    const spec = EFFECTS[mn];
    if (!spec) return null;
    const params = spec.map(([n, kind, v, o], i) => new PropNode(n, mn + "-" + String(i + 1).padStart(4, "0"), kind, v, o || {}));
    const g = new GroupNode(mn, mn, params);
    g.isEffect = true;
    if (mn === "ADBE Dropdown Control") params[0].items = ["Item 1", "Item 2", "Item 3"];
    return g;
}

function transformGroup() {
    return new GroupNode("Transform", "ADBE Transform Group", [
        new PropNode("Anchor Point", "ADBE Anchor Point", "2d", [0, 0]),
        new PropNode("Position", "ADBE Position", "2d", [960, 540]),
        new PropNode("Scale", "ADBE Scale", "2d", [100, 100]),
        new PropNode("Rotation", "ADBE Rotate Z", "scalar", 0),
        new PropNode("Opacity", "ADBE Opacity", "scalar", 100),
    ]);
}

function vectorsFactory(mn) {
    if (mn === "ADBE Vector Shape - Rect") {
        return new GroupNode("Rectangle Path", mn, [
            new PropNode("Shape Direction", "ADBE Vector Shape Direction", "scalar", 1),
            new PropNode("Size", "ADBE Vector Rect Size", "2d", [100, 100]),
            new PropNode("Position", "ADBE Vector Rect Position", "2d", [0, 0]),
            new PropNode("Roundness", "ADBE Vector Rect Roundness", "scalar", 0),
        ]);
    }
    if (mn === "ADBE Vector Graphic - Fill") {
        return new GroupNode("Fill", mn, [
            new PropNode("Composite", "ADBE Vector Composite Order", "scalar", 1),
            new PropNode("Fill Rule", "ADBE Vector Fill Rule", "scalar", 1),
            new PropNode("Color", "ADBE Vector Fill Color", "color", [1, 0, 0, 1]),
            new PropNode("Opacity", "ADBE Vector Fill Opacity", "scalar", 100),
        ]);
    }
    if (mn === "ADBE Vector Group") return vectorGroup();
    return null;
}

function vectorGroup() {
    return new GroupNode("Group", "ADBE Vector Group", [
        new GroupNode("Contents", "ADBE Vectors Group", [], vectorsFactory),
        new GroupNode("Transform", "ADBE Vector Transform Group", [
            new PropNode("Anchor Point", "ADBE Vector Anchor", "2d", [0, 0]),
            new PropNode("Position", "ADBE Vector Position", "2d", [0, 0]),
            new PropNode("Scale", "ADBE Vector Scale", "2d", [100, 100]),
            new PropNode("Rotation", "ADBE Vector Rotation", "scalar", 0),
            new PropNode("Opacity", "ADBE Vector Group Opacity", "scalar", 100),
        ]),
    ]);
}

// ---------------------------------------------------------------------
// レイヤー・コンポ
// ---------------------------------------------------------------------
class Layer {
    constructor(comp, type, name) {
        this.comp = comp;
        this.type = type;
        this._name = name;
        this._parent = null;
        this._handles = [];
        const kids = [transformGroup(), new GroupNode("Effects", "ADBE Effect Parade", [], effectFactory)];
        if (type === "text") kids.unshift(new GroupNode("Text", "ADBE Text Properties", [new PropNode("Source Text", "ADBE Text Document", "text", null)]));
        if (type === "shape") kids.unshift(new GroupNode("Contents", "ADBE Root Vectors Group", [], mn => mn === "ADBE Vector Group" ? vectorGroup() : null));
        this.root = new GroupNode(name, "ADBE Root", []);
        this.root.layer = this;
        kids.forEach(k => this.root.attach(k));
        if (type === "shape") {
            // AE の既定: シェイプレイヤーの位置はコンポ中央
            this.root.children.find(c => c.matchName === "ADBE Transform Group").children[1].value = [960, 540];
        }
        if (type === "null") {
            const t = this.root.children.find(c => c.matchName === "ADBE Transform Group");
            t.children[0].value = [50, 50];
        }
    }
    get name() { return this._name; }
    set name(v) {
        if (this.comp._layers.some(l => l !== this && l._name === v)) throw new Error("duplicate layer name " + v);
        this._name = v;
    }
    get parent() { return this._parent; }
    set parent(p) {
        if (p && p.comp !== this.comp) throw new Error("parent must be in same comp");
        let q = p; while (q) { if (q === this) throw new Error("parent cycle"); q = q._parent; }
        this._parent = p;
    }
    get index() { return this.comp._layers.indexOf(this) + 1; }
    get startTime() { return this._startTime || 0; }
    set startTime(v) { if (typeof v !== "number" || !isFinite(v)) throw new Error("bad startTime"); this._startTime = v; }
    moveToEnd() { const a = this.comp._layers; a.splice(a.indexOf(this), 1); a.push(this); }
    property(k) { return new GroupHandle(this.root).property(k); }
    get numProperties() { return this.root.children.length; }
    moveToBeginning() { const a = this.comp._layers; a.splice(a.indexOf(this), 1); a.unshift(this); }
    openInViewer() {}
    // ノード検索（検証用）
    find(...mns) {
        let n = this.root;
        for (const mn of mns) {
            n = n.children.find(c => c.name === mn) || n.children.find(c => c.matchName === mn);
            if (!n) return null;
        }
        return n;
    }
}

class Comp {
    constructor(name, w, h, par, dur, fps) {
        if (!(w > 0 && h > 0 && dur > 0 && fps > 0)) throw new Error("bad comp params");
        this.name = name; this.width = w; this.height = h; this.pixelAspect = par;
        this.duration = dur; this.frameRate = fps; this.frameDuration = 1 / fps;
        this._layers = [];
        this._egp = [];
        this._markers = [];
        this.time = 0;
        this.motionGraphicsTemplateName = "";
        const self = this;
        this.layers = {
            addText(str) { const l = new Layer(self, "text", "Text " + (self._layers.length + 1)); l.root.children[0].children[0].value = new TextDocument(str); self._layers.unshift(l); return l; },
            addShape() { const l = new Layer(self, "shape", "Shape Layer " + (self._layers.length + 1)); self._layers.unshift(l); return l; },
            addNull() { const l = new Layer(self, "null", "Null " + (self._layers.length + 1)); self._layers.unshift(l); return l; },
            add(item) {
                if (!item || !item._isFootage) throw new Error("layers.add needs a footage item");
                const l = new Layer(self, "av", item.name); l.source = item; self._layers.unshift(l); return l;
            },
        };
        this.markerProperty = {
            setValueAtTime(t, mv) { if (!(mv instanceof MarkerValue)) throw new Error("MarkerValue expected"); self._markers.push({ t, mv }); },
        };
    }
    get numLayers() { return this._layers.length; }
    layer(k) { return typeof k === "number" ? this._layers[k - 1] : this._layers.find(l => l.name === k); }
    set parentFolder(f) { this._folder = f; }
    set bgColor(c) { if (c.length !== 3) throw new Error("bgColor 3"); }
    exportAsMotionGraphicsTemplate(overwrite, p) {
        if (typeof overwrite !== "boolean" || typeof p !== "string") throw new Error("bad export args");
        exported.push({ comp: this.name, path: p });
        return true;
    }
    openInViewer() {}
}

class MarkerValue {
    constructor(comment) { this.comment = comment; this.duration = 0; this.protectedRegion = false; }
}

class FileObj {
    constructor(p) { this.fsName = String(p); this.name = path.basename(this.fsName); }
    get parent() { return new FolderObj(path.dirname(this.fsName)); }
    get exists() { return fs.existsSync(this.fsName); }
}
class FolderObj {
    constructor(p) { this.fsName = String(p); this.name = path.basename(this.fsName); }
    get exists() { return fs.existsSync(this.fsName) && fs.statSync(this.fsName).isDirectory(); }
    getFiles(mask) {
        if (!this.exists) return [];
        const re = new RegExp("^" + String(mask || "*").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
        return fs.readdirSync(this.fsName).filter(n => re.test(n)).sort().map(n => new FileObj(path.join(this.fsName, n)));
    }
    static selectDialog() { selectDialogs.push(1); return new FolderObj(args.out || "/tmp/out"); }
}
class ImportOptions {
    constructor(file) { if (!file || !file.fsName) throw new Error("ImportOptions needs File"); this.file = file; }
}
const imported = [];
const selectDialogs = [];
const comps = [];
const exported = [];
const alerts = [];
const installed = new Set((args.installed || "HiraMinProN-W6,HiraMinProN-W3,HiraginoSans-W9,HiraginoSans-W6,HiraMaruProN-W4").split(",").filter(Boolean));

const project = {
    expressionEngine: "extendscript",
    items: {
        addComp(name, w, h, par, dur, fps) { const c = new Comp(name, w, h, par, dur, fps); comps.push(c); return c; },
        addFolder(name) { return { name }; },
    },
    save(file) { if (!file || !file.fsName) throw new Error("save needs File"); },
    importFile(io) {
        if (!(io instanceof ImportOptions)) throw new Error("importFile needs ImportOptions");
        if (!fs.existsSync(io.file.fsName)) throw new Error("file not found " + io.file.fsName);
        const item = { _isFootage: true, name: path.basename(io.file.fsName), file: io.file, parentFolder: null };
        imported.push(item);
        return item;
    },
};

const sandbox = {
    app: {
        version: args.version || "25.2x11",
        project,
        newProject() { return project; },
        beginUndoGroup() {}, endUndoGroup() {},
        fonts: args.nofontapi === undefined ? { getFontsByPostScriptName(ps) { return installed.has(ps) ? [{ postScriptName: ps }] : []; } } : undefined,
    },
    $: { os: args.os || "Macintosh OS 15.1.0", fileName: args.scriptpath || SCRIPT },
    alert(m) { alerts.push(m); },
    confirm() { return true; },
    Folder: FolderObj,
    File: FileObj,
    ImportOptions,
    ParagraphJustification: { LEFT_JUSTIFY: "LEFT_JUSTIFY", CENTER_JUSTIFY: "CENTER_JUSTIFY", RIGHT_JUSTIFY: "RIGHT_JUSTIFY" },
    PropertyType: { PROPERTY: "PROPERTY", INDEXED_GROUP: "INDEXED_GROUP", NAMED_GROUP: "NAMED_GROUP" },
    MarkerValue,
};

// ---------------------------------------------------------------------
// スクリプト実行
// ---------------------------------------------------------------------
const src = fs.readFileSync(SCRIPT, "utf8").replace(/^﻿/, "");
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "MizudauTelop_MOGRT_Builder.jsx" });

module.exports = { comps, exported, alerts, project, imported, selectDialogs, TextDocument, PropNode, GroupNode };

if (require.main === module) {
    console.log("comps:", comps.map(c => c.name));
    console.log("expression engine:", project.expressionEngine);
    console.log("exported:", exported.map(e => path.basename(e.path)));
    console.log("imported:", imported.map(i => i.name));
    console.log("folder dialogs:", selectDialogs.length);
    comps.forEach(c => console.log("  " + c.name + ": " + c._layers.filter(l => l.type === "av")
        .map(l => l.name + " @" + Math.round(l.startTime / c.frameDuration) + "f (index " + l.index + "/" + c.numLayers + ")").join(", ")));
    console.log("alerts:\n" + alerts.join("\n---\n"));
}
