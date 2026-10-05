// Approximate renderer: mock AE project -> SVG -> PNG (via Playwright/Chromium).
// Only for previewing/validating layout & timing; not a faithful AE renderer.
//   node render.js "<comp name prefix>" <t0> <t1> <fps> <outDir> [bg.png]
"use strict";
const fs = require("fs");
const path = require("path");
const { runScript } = require("./mock_run.js");
const { makeEvaluator } = require("./expr_eval.js");
const { CompItem } = require("./mock_ae.js");

let UID = 0;
const uid = (p) => p + (++UID);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rgb = (c) => "rgb(" + c.slice(0, 3).map((x) => Math.round(Math.min(Math.max(x, 0), 1) * 255)).join(",") + ")";

function mat(a) { return "matrix(" + a.map((x) => +x.toFixed(5)).join(" ") + ")"; }
function mul(m, n) { // 2D affine [a b c d e f]
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function pathD(sh) {
  const v = sh.vertices, it = sh.inTangents, ot = sh.outTangents, n = v.length;
  let d = "M" + v[0][0] + "," + v[0][1];
  for (let i = 1; i <= (sh.closed ? n : n - 1); i++) {
    const a = v[(i - 1) % n], b = v[i % n], o = ot[(i - 1) % n] || [0, 0], ii = it[i % n] || [0, 0];
    d += "C" + (a[0] + o[0]) + "," + (a[1] + o[1]) + " " + (b[0] + ii[0]) + "," + (b[1] + ii[1]) + " " + b[0] + "," + b[1];
  }
  return d + (sh.closed ? "Z" : "");
}

function makeRenderer(g) {
  const ev = makeEvaluator(g);
  const F = ev.findChild;
  const val = (n, t) => ev.valueOf(n, t);

  function layerMatrix(L, t) {
    const tr = F(L._root, "ADBE Transform Group");
    const a = val(F(tr, "ADBE Anchor Point"), t), p = val(F(tr, "ADBE Position"), t), s = val(F(tr, "ADBE Scale"), t);
    const r = val(F(tr, "ADBE Rotate Z"), t) * Math.PI / 180;
    const sx = s[0] / 100, sy = s[1] / 100, cs = Math.cos(r), sn = Math.sin(r);
    let m = [cs * sx, sn * sx, -sn * sy, cs * sy, 0, 0];
    m[4] = p[0] - (m[0] * a[0] + m[2] * a[1]);
    m[5] = p[1] - (m[1] * a[0] + m[3] * a[1]);
    if (L.parent) m = mul(layerMatrix(L.parent, t), m);
    return m;
  }
  function fillFxColor(L, t) {
    const fx = F(L._root, "ADBE Effect Parade");
    const e = fx.children.find((c) => c.matchName === "ADBE Fill");
    return e ? val(F(e, "ADBE Fill-0002"), t) : null;
  }

  function shapeGroup(grp, t, defs) {
    // grp = node "ADBE Vectors Group" (contents)
    let out = "", paths = [], merge = null;
    for (const it of grp.children) {
      if (it.matchName === "ADBE Vector Group") {
        const xt = F(it, "ADBE Vector Transform Group");
        const a = val(F(xt, "ADBE Vector Anchor"), t), p = val(F(xt, "ADBE Vector Position"), t), s = val(F(xt, "ADBE Vector Scale"), t);
        const op = val(F(xt, "ADBE Vector Group Opacity"), t) / 100;
        out += '<g opacity="' + op + '" transform="translate(' + p[0] + "," + p[1] + ") scale(" + s[0] / 100 + "," + s[1] / 100 + ") translate(" + -a[0] + "," + -a[1] + ')">' + shapeGroup(F(it, "ADBE Vectors Group"), t, defs) + "</g>";
      } else if (it.matchName === "ADBE Vector Shape - Ellipse") {
        const s = val(F(it, "ADBE Vector Ellipse Size"), t), p = val(F(it, "ADBE Vector Ellipse Position"), t);
        paths.push({ el: '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="' + Math.abs(s[0]) / 2 + '" ry="' + Math.abs(s[1]) / 2 + '"' });
      } else if (it.matchName === "ADBE Vector Shape - Rect") {
        const s = val(F(it, "ADBE Vector Rect Size"), t), p = val(F(it, "ADBE Vector Rect Position"), t);
        const r = Math.min(val(F(it, "ADBE Vector Rect Roundness"), t), Math.abs(s[0]) / 2, Math.abs(s[1]) / 2);
        paths.push({ el: '<rect x="' + (p[0] - Math.abs(s[0]) / 2) + '" y="' + (p[1] - Math.abs(s[1]) / 2) + '" width="' + Math.abs(s[0]) + '" height="' + Math.abs(s[1]) + '" rx="' + r + '"' });
      } else if (it.matchName === "ADBE Vector Filter - Merge") {
        merge = val(F(it, "ADBE Vector Merge Type"), t);
      } else if (it.matchName === "ADBE Vector Graphic - Fill") {
        const c = val(F(it, "ADBE Vector Fill Color"), t), op = val(F(it, "ADBE Vector Fill Opacity"), t) / 100;
        out += drawPaths(paths, merge, 'fill="' + rgb(c) + '" fill-opacity="' + op + '"', defs);
      } else if (it.matchName === "ADBE Vector Graphic - G-Fill") {
        const sp = val(F(it, "ADBE Vector Grad Start Pt"), t), epp = val(F(it, "ADBE Vector Grad End Pt"), t);
        const id = uid("rg"), r = Math.hypot(epp[0] - sp[0], epp[1] - sp[1]);
        defs.push('<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + sp[0] + '" cy="' + sp[1] + '" r="' + r + '"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>');
        out += drawPaths(paths, merge, 'fill="url(#' + id + ')"', defs);
      }
    }
    return out;
  }
  function drawPaths(paths, merge, attr, defs) {
    if (merge === 4 && paths.length >= 2) {
      const id = uid("mp");
      defs.push('<clipPath id="' + id + '" clipPathUnits="userSpaceOnUse">' + paths.slice(1).map((p) => p.el + "/>").join("") + "</clipPath>");
      return '<g clip-path="url(#' + id + ')">' + paths[0].el + " " + attr + "/></g>";
    }
    return paths.map((p) => p.el + " " + attr + "/>").join("");
  }

  function textEl(L, t) {
    const tp = F(L._root, "ADBE Text Properties"), node = tp.children[0], td = node.value.data;
    const text = String(val(node, t));
    const fc = fillFxColor(L, t) || td.fillColor;
    const anchor = td.justification === 7415 ? "middle" : td.justification === 7414 ? "end" : "start";
    const bold = /W[6-9]|Bold|Heavy|Black|Demi/i.test(td.font);
    const lead = td.autoLeading ? td.fontSize * 1.2 : td.leading;
    const lines = text.split("\r");
    const ls = (td.tracking || 0) / 1000 * td.fontSize;
    let s = '<text font-family="IPAPGothic, IPAGothic, sans-serif" font-size="' + td.fontSize + '" font-weight="' + (bold ? "bold" : "normal") + '" fill="' + rgb(fc) + '" text-anchor="' + anchor + '" letter-spacing="' + ls + '">';
    lines.forEach((ln, i) => { s += '<tspan x="0" y="' + i * lead + '">' + esc(ln) + "</tspan>"; });
    return s + "</text>";
  }

  function layerSVG(L, t, defs) {
    if (L.guideLayer || L.kind === "null" || !L.enabled) return "";
    const tr = F(L._root, "ADBE Transform Group");
    const op = val(F(tr, "ADBE Opacity"), t) / 100;
    if (op <= 0.001) return "";
    let body = "";
    if (L.kind === "solid") body = '<rect x="0" y="0" width="' + L.width + '" height="' + L.height + '" fill="' + rgb(fillFxColor(L, t) || L.solidColor) + '"/>';
    else if (L.kind === "shape") body = shapeGroup(F(L._root, "ADBE Root Vectors Group"), t, defs);
    else if (L.kind === "text") body = textEl(L, t);
    else if (L.kind === "precomp") {
      const src = L.source;
      body = compBody(src, t - L.startTime, defs);
      if (!L.collapseTransformation) {
        const id = uid("pc");
        defs.push('<clipPath id="' + id + '" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="' + src.width + '" height="' + src.height + '"/></clipPath>');
        body = '<g clip-path="url(#' + id + ')">' + body + "</g>";
      }
    }
    // linear wipe effects (layer space, bounds = comp-sized for shape layers)
    const fx = F(L._root, "ADBE Effect Parade");
    for (const e of fx.children) {
      if (e.matchName !== "ADBE Linear Wipe") continue;
      const c = val(F(e, "ADBE Linear Wipe-0001"), t) / 100, ang = val(F(e, "ADBE Linear Wipe-0002"), t) * Math.PI / 180, fe = Math.max(val(F(e, "ADBE Linear Wipe-0003"), t), 0.5);
      const W = L.containingComp.width, H = L.containingComp.height;
      const dx = Math.sin(ang), dy = -Math.cos(ang);
      const proj = [[0, 0], [W, 0], [0, H], [W, H]].map((p) => p[0] * dx + p[1] * dy);
      const pmin = Math.min(...proj), pmax = Math.max(...proj);
      const pl = pmin - fe / 2 + c * (pmax - pmin + fe);
      const cx = W / 2, cy = H / 2, pc = cx * dx + cy * dy;
      const a = [cx + dx * (pl - fe / 2 - pc), cy + dy * (pl - fe / 2 - pc)], b = [cx + dx * (pl + fe / 2 - pc), cy + dy * (pl + fe / 2 - pc)];
      const gid = uid("lg"), mid = uid("lw");
      defs.push('<linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>');
      defs.push('<mask id="' + mid + '" maskUnits="userSpaceOnUse" x="-5000" y="-5000" width="10000" height="10000"><rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#' + gid + ')"/></mask>');
      body = '<g mask="url(#' + mid + ')">' + body + "</g>";
    }
    // masks (layer space)
    const masks = F(L._root, "ADBE Mask Parade").children;
    for (let i = masks.length - 1; i >= 0; i--) {
      const sh = val(F(masks[i], "ADBE Mask Shape"), t);
      const id = uid("mk");
      defs.push('<clipPath id="' + id + '" clipPathUnits="userSpaceOnUse"><path d="' + pathD(sh) + '"/></clipPath>');
      body = '<g clip-path="url(#' + id + ')">' + body + "</g>";
    }
    const blend = L.blendingMode === 5220 ? ' style="mix-blend-mode:screen"' : "";
    return '<g opacity="' + op + '"' + blend + '><g transform="' + mat(layerMatrix(L, t)) + '">' + body + "</g></g>";
  }

  function compBody(c, t, defs) {
    let s = "";
    for (let i = c._layers.length - 1; i >= 0; i--) s += layerSVG(c._layers[i], t, defs);
    return s;
  }
  function compSVG(c, t, bgHref) {
    UID = 0;
    const defs = [];
    const body = compBody(c, t, defs);
    const bg = bgHref ? '<image href="' + bgHref + '" x="0" y="0" width="' + c.width + '" height="' + c.height + '" preserveAspectRatio="none"/>' : '<rect width="100%" height="100%" fill="#3a3a3a"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + c.width + '" height="' + c.height + '" viewBox="0 0 ' + c.width + " " + c.height + '"><defs>' + defs.join("") + "</defs>" + bg + '<g style="isolation:isolate">' + body + "</g></svg>";
  }
  return { compSVG, ev };
}

async function main() {
  const [prefix, t0s, t1s, fpss, outDir, bg] = process.argv.slice(2);
  const g = runScript({ confirm: false });
  const comp = g.app.project._items.find((x) => x instanceof CompItem && x.name.startsWith(prefix));
  if (!comp) throw new Error("comp not found: " + prefix);
  const R = makeRenderer(g);
  fs.mkdirSync(outDir, { recursive: true });
  const bgHref = bg ? "data:image/png;base64," + fs.readFileSync(bg).toString("base64") : null;
  const { chromium } = require("/opt/node22/lib/node_modules/playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: comp.width, height: comp.height } });
  await page.setContent('<html><body style="margin:0;background:#000"><div id="s"></div></body></html>');
  const t0 = +t0s, t1 = +t1s, fps = +fpss;
  let i = 0;
  for (let t = t0; t <= t1 + 1e-6; t += 1 / fps, i++) {
    const svg = R.compSVG(comp, t, bgHref);
    await page.evaluate((s) => { document.getElementById("s").innerHTML = s; }, svg);
    await page.screenshot({ path: path.join(outDir, "r_" + String(i).padStart(4, "0") + ".png") });
  }
  await browser.close();
  console.log("rendered", i, "frames of", comp.name, "to", outDir);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { makeRenderer };
