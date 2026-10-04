// TelopTemplates.jsx  (generated from src/TelopTemplates.src.jsx by tools/build.py)
// Run in After Effects: File > Scripts > Run Script File...
/*
 * TelopTemplates.src.jsx
 *
 * After Effects \u4e0a\u3067\u5b9f\u884c\u3059\u308b\u3068\u3001\u30c6\u30ed\u30c3\u30d7\u306e\u30b3\u30f3\u30dd\u30b8\u30b7\u30e7\u30f3\u3092\u7d44\u307f\u7acb\u3066\u3066
 * Premiere Pro \u7528\u306e\u30e2\u30fc\u30b7\u30e7\u30f3\u30b0\u30e9\u30d5\u30a3\u30c3\u30af\u30b9\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8 (.mogrt) \u3092\u66f8\u304d\u51fa\u3059\u3002
 *
 *   - \u30eb\u30fc\u30eb\u30c6\u30ed\u30c3\u30d7 : \u91d1\u67a0 + \u30df\u30f3\u30c8\u5730 + \u96c6\u4e2d\u7dda\u306e\u5e2f\u3001\u5de6\u4e0a\u306b1\u6587\u5b571\u30de\u30b9\u306e\u30e9\u30d9\u30eb\u3001
 *                      \u672c\u6587\u306f\u767d + \u9ed2\u306e\u62bc\u3057\u51fa\u3057\u5f71\u3001\uff0a\u3067\u631f\u3093\u3060\u90e8\u5206\u3060\u3051\u8d64
 *   - \u30bb\u30ea\u30d5\u30c6\u30ed\u30c3\u30d7 : \u767d\u6587\u5b57 + \u9ed2\u30d5\u30c1 + \u307c\u304b\u3057\u5f71
 *
 * \u3053\u308c\u306f\u8aad\u307f\u3084\u3059\u3055\u7528\u306e\u30bd\u30fc\u30b9\u3002\u914d\u5e03\u7528\u306e ../TelopTemplates.jsx \u306f
 * tools/build.py \u304c\u5168\u89d2\u6587\u5b57\u3092 \uXXXX \u306b\u7f6e\u304d\u63db\u3048\u3066\u751f\u6210\u3059\u308b
 * (\u65e5\u672c\u8a9e\u7248 Windows \u306e After Effects \u3067\u6587\u5b57\u5316\u3051\u3057\u306a\u3044\u3088\u3046\u306b\u3059\u308b\u305f\u3081)\u3002
 *
 * ExtendScript (ES3) \u3067\u52d5\u304f\u3088\u3046\u306b\u66f8\u304f\u3053\u3068:
 *   let/const\u30fb\u30a2\u30ed\u30fc\u95a2\u6570\u30fbArray#indexOf/forEach\u30fbJSON\u30fb\u672b\u5c3e\u30ab\u30f3\u30de\u306f\u4f7f\u308f\u306a\u3044\u3002
 * \u30d7\u30ed\u30d1\u30c6\u30a3\u306f\u3059\u3079\u3066 matchName \u3067\u53c2\u7167\u3059\u308b (\u65e5\u672c\u8a9e\u7248 AE \u3067\u3082\u52d5\u304f\u3088\u3046\u306b)\u3002
 */
(function TelopTemplates() {

    var CFG = {
        width: 1920,
        height: 1080,
        fps: 29.97,
        duration: 5,
        folderName: "TELOP_TEMPLATES",
        // PostScript \u540d\u3002\u624b\u6301\u3061\u306e\u66f8\u4f53\u306b\u66ff\u3048\u308b\u3068\u304d\u306f\u3053\u3053\u3092\u66f8\u304d\u63db\u3048\u308b
        fonts: {
            rule: "NotoSansJP-Black",
            label: "RoundedMplus1c-Medium",
            speech: "KaiseiTokumin-ExtraBold"
        }
    };

    // \u30eb\u30fc\u30eb\u30c6\u30ed\u30c3\u30d7\u306e\u5bf8\u6cd5 (\u30b9\u30af\u30ea\u30fc\u30f3\u30b7\u30e7\u30c3\u30c8\u3092 1920x1080 \u306b\u63db\u7b97\u3057\u3066\u63a1\u5bf8)
    var RULE = {
        cx: 960,            // \u5e2f\u306e\u4e2d\u5fc3
        cy: 978,
        w: 1856,            // \u5e2f\u306e\u5916\u5bf8
        h: 168,
        frame: 13,          // \u91d1\u67a0\u306e\u592a\u3055
        textFontSize: 88,
        textTracking: -70,
        textOffsetY: -8,    // \u6587\u5b57\u306e\u4e2d\u5fc3\u306f\u5e2f\u306e\u4e2d\u5fc3\u3088\u308a\u5c11\u3057\u4e0a
        textPadding: 60,    // \u5de6\u53f3\u306e\u4f59\u767d (\u3053\u308c\u3092\u8d85\u3048\u308b\u9577\u3055\u306f\u81ea\u52d5\u3067\u7e2e\u5c0f)
        shadowCopies: 5,    // \u62bc\u3057\u51fa\u3057\u5f71\u306e\u679a\u6570
        labelBoxW: 81,      // \u30e9\u30d9\u30eb1\u30de\u30b9\u306e\u5916\u5bf8
        labelBoxH: 76,
        labelBorder: 3,
        labelFontSize: 64,
        labelMax: 8,        // \u30e9\u30d9\u30eb\u306e\u6700\u5927\u6587\u5b57\u6570
        rays: 48,           // \u96c6\u4e2d\u7dda\u306e\u672c\u6570
        rayStretch: 300     // \u96c6\u4e2d\u7dda\u306e\u6a2a\u4f38\u3070\u3057 (%)
    };

    var SPEECH = {
        x: 960,
        y: 843,             // \u6700\u7d42\u884c\u306e\u4e2d\u5fc3
        fontSize: 90,
        tracking: -170,
        stroke: 6
    };

    // \u548c\u6587\u306e\u5b57\u9762\u306e\u4e2d\u5fc3\u306f\u30d9\u30fc\u30b9\u30e9\u30a4\u30f3\u304b\u3089\u7d04 0.38em \u4e0a
    var CJK_CENTER = 0.38;

    var COLORS = {
        white: "#ffffff",
        black: "#000000",
        red: "#d85a44",
        labelRed: "#cf4b3b",
        mint: "#a8ece0",
        mintRay: "#b9f5e7",
        frameDark: "#3a3410",
        frameYellow: "#f2ee68",
        frameGold: "#a8953c",
        panelLine: "#2c3f30",
        panelShade: "#2f6f64",
        rivet: "#dcdcd6",
        rivetLine: "#232323",
        labelLine: "#111111"
    };

    var MIN_AE_VERSION = 16.1;

    var EXPR = [];          // \u5168\u30ec\u30a4\u30e4\u30fc\u3092\u4f5c\u308a\u7d42\u3048\u3066\u304b\u3089\u307e\u3068\u3081\u3066\u5f0f\u3092\u5165\u308c\u308b
    var EGP = [];           // \u30a8\u30c3\u30bb\u30f3\u30b7\u30e3\u30eb\u30b0\u30e9\u30d5\u30a3\u30c3\u30af\u30b9\u306b\u51fa\u3059\u30d7\u30ed\u30d1\u30c6\u30a3
    var missingFonts = [];
    var exprErrors = [];

    // ------------------------------------------------------------------
    // \u5c0f\u7269
    // ------------------------------------------------------------------

    function hexToRgb(hex) {
        var n = parseInt(hex.replace("#", ""), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    function hexToRgba(hex) {
        var c = hexToRgb(hex);
        return [c[0], c[1], c[2], 1];
    }

    function prop(root, path) {
        var p = root;
        for (var i = 0; i < path.length; i++) {
            p = p.property(path[i]);
            if (!p) {
                throw new Error("property not found: " + path.slice(0, i + 1).join(" > ") + " (" + root.name + ")");
            }
        }
        return p;
    }

    function transform(layer, matchName) {
        return layer.property("ADBE Transform Group").property(matchName);
    }

    function expr(layer, path, code) {
        EXPR.push({ layer: layer, path: path, code: code });
    }

    function exposeEffect(comp, ctrl, effectName, label) {
        EGP.push({ comp: comp, layer: ctrl, path: ["ADBE Effect Parade", effectName, 1], label: label });
    }

    function exposeText(comp, layer, label) {
        EGP.push({ comp: comp, layer: layer, path: ["ADBE Text Properties", "ADBE Text Document"], label: label });
    }

    function contains(list, item) {
        for (var i = 0; i < list.length; i++) {
            if (list[i] === item) {
                return true;
            }
        }
        return false;
    }

    function noteFont(ps, applied) {
        if (contains(missingFonts, ps)) {
            return;
        }
        if (applied !== ps) {
            // \u672a\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u306e\u66f8\u4f53\u3092\u6307\u5b9a\u3059\u308b\u3068\u5143\u306e\u66f8\u4f53\u306e\u307e\u307e\u6b8b\u308b\u7248\u304c\u3042\u308b
            missingFonts.push(ps);
            return;
        }
        try {
            // app.fonts \u306f AE 24.0 \u4ee5\u964d\u306e\u307f
            if (app.fonts && app.fonts.getFontsByPostScriptName) {
                if (app.fonts.getFontsByPostScriptName(ps).length === 0) {
                    missingFonts.push(ps);
                }
            }
        } catch (e) {
            // \u8abf\u3079\u3089\u308c\u306a\u3044\u74b0\u5883\u3067\u306f\u4f55\u3082\u3057\u306a\u3044
        }
    }

    // ------------------------------------------------------------------
    // \u30ec\u30a4\u30e4\u30fc
    // ------------------------------------------------------------------

    function addNull(comp, name, pos) {
        var l = comp.layers.addNull();
        l.name = name;
        transform(l, "ADBE Anchor Point").setValue([0, 0]);
        transform(l, "ADBE Position").setValue(pos);
        return l;
    }

    function attach(child, parent, pos) {
        if (typeof child.setParentWithJump === "function") {
            child.setParentWithJump(parent);
        } else {
            child.parent = parent;
        }
        transform(child, "ADBE Position").setValue(pos);
        transform(child, "ADBE Scale").setValue([100, 100]);
    }

    function addText(comp, name, text, style) {
        var l = comp.layers.addText(text);
        l.name = name;
        var sp = prop(l, ["ADBE Text Properties", "ADBE Text Document"]);
        var td = sp.value;
        td.font = style.font;
        td.fontSize = style.size;
        td.applyFill = true;
        td.fillColor = hexToRgb(style.fill);
        if (style.stroke) {
            td.applyStroke = true;
            td.strokeColor = hexToRgb(style.stroke);
            td.strokeWidth = style.strokeWidth;
            td.strokeOverFill = false;
        } else {
            td.applyStroke = false;
        }
        td.tracking = style.tracking || 0;
        td.justification = ParagraphJustification.CENTER_JUSTIFY;
        sp.setValue(td);
        noteFont(style.font, sp.value.font);
        transform(l, "ADBE Anchor Point").setValue([0, 0]);
        return l;
    }

    // \u30c6\u30ad\u30b9\u30c8\u30a2\u30cb\u30e1\u30fc\u30bf\u30fc\u3002props \u306f ["ADBE Text Fill Color", ...]
    // byIndex \u306e\u3068\u304d\u306f\u6587\u5b57\u756a\u53f7\u3067\u7bc4\u56f2\u3092\u7d5e\u308b\u30bb\u30ec\u30af\u30bf\u30fc\u306b\u306a\u308b\u3002
    // addProperty \u3059\u308b\u3068\u305d\u306e\u30b0\u30eb\u30fc\u30d7\u3078\u306e\u65e2\u5b58\u306e\u53c2\u7167\u304c\u7121\u52b9\u306b\u306a\u308b\u3053\u3068\u304c\u3042\u308b\u306e\u3067\u3001\u6bce\u56de\u30ec\u30a4\u30e4\u30fc\u304b\u3089\u8fbf\u308a\u76f4\u3059
    function addAnimator(layer, name, props, byIndex) {
        var base = ["ADBE Text Properties", "ADBE Text Animators"];
        var a = prop(layer, base).addProperty("ADBE Text Animator");
        a.name = name;
        for (var i = 0; i < props.length; i++) {
            prop(layer, base.concat([name, "ADBE Text Animator Properties"])).addProperty(props[i]);
        }
        if (prop(layer, base.concat([name, "ADBE Text Selectors"])).numProperties === 0) {
            prop(layer, base.concat([name, "ADBE Text Selectors"])).addProperty("ADBE Text Selector");
        }
        if (byIndex) {
            prop(layer, base.concat([name, "ADBE Text Selectors", 1, "ADBE Text Range Advanced", "ADBE Text Range Units"])).setValue(2);
        }
    }

    function animatorPath(name, matchName) {
        return ["ADBE Text Properties", "ADBE Text Animators", name, "ADBE Text Animator Properties", matchName];
    }

    function selectorPath(name, matchName) {
        return ["ADBE Text Properties", "ADBE Text Animators", name, "ADBE Text Selectors", 1, matchName];
    }

    function addShapeLayer(comp, name) {
        var l = comp.layers.addShape();
        l.name = name;
        transform(l, "ADBE Anchor Point").setValue([0, 0]);
        return l;
    }

    function addGroup(layer, name) {
        var g = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        g.name = name;
    }

    function contents(layer, group) {
        return prop(layer, ["ADBE Root Vectors Group", group, "ADBE Vectors Group"]);
    }

    function groupPath(group, rest) {
        return ["ADBE Root Vectors Group", group, "ADBE Vectors Group"].concat(rest);
    }

    function addRect(layer, group, size, pos) {
        var r = contents(layer, group).addProperty("ADBE Vector Shape - Rect");
        r.property("ADBE Vector Rect Size").setValue(size);
        r.property("ADBE Vector Rect Position").setValue(pos || [0, 0]);
    }

    function addPath(layer, group, vertices) {
        var p = contents(layer, group).addProperty("ADBE Vector Shape - Group");
        var s = new Shape();
        s.vertices = vertices;
        s.closed = true;
        p.property("ADBE Vector Shape").setValue(s);
    }

    function addFill(layer, group, hex) {
        var f = contents(layer, group).addProperty("ADBE Vector Graphic - Fill");
        f.property("ADBE Vector Fill Color").setValue(hexToRgba(hex));
    }

    function addStroke(layer, group, hex, width, opacity) {
        var s = contents(layer, group).addProperty("ADBE Vector Graphic - Stroke");
        s.property("ADBE Vector Stroke Color").setValue(hexToRgba(hex));
        s.property("ADBE Vector Stroke Width").setValue(width);
        s.property("ADBE Vector Stroke Line Join").setValue(1); // \u30de\u30a4\u30bf\u30fc
        if (opacity !== undefined) {
            s.property("ADBE Vector Stroke Opacity").setValue(opacity);
        }
    }

    function addRepeater(layer, group, copies, offset, rotation) {
        var r = contents(layer, group).addProperty("ADBE Vector Filter - Repeater");
        r.property("ADBE Vector Repeater Copies").setValue(copies);
        var t = r.property("ADBE Vector Repeater Transform");
        t.property("ADBE Vector Repeater Position").setValue(offset);
        t.property("ADBE Vector Repeater Rotation").setValue(rotation);
    }

    // \u30a8\u30af\u30b9\u30d7\u30ec\u30c3\u30b7\u30e7\u30f3\u5236\u5fa1 (Premiere \u304b\u3089\u89e6\u308b\u5024\u306f\u3059\u3079\u3066\u3053\u3053\u306b\u96c6\u3081\u308b)
    function addControl(layer, type, name, value) {
        var mn = {
            slider: "ADBE Slider Control",
            color: "ADBE Color Control",
            checkbox: "ADBE Checkbox Control"
        }[type];
        var fx = layer.property("ADBE Effect Parade").addProperty(mn);
        fx.name = name;
        var v = value;
        if (type === "color") {
            v = hexToRgba(value);
        } else if (type === "checkbox") {
            v = value ? 1 : 0;
        }
        fx.property(1).setValue(v);
    }

    // ------------------------------------------------------------------
    // \u30a8\u30af\u30b9\u30d7\u30ec\u30c3\u30b7\u30e7\u30f3\u90e8\u54c1
    // ------------------------------------------------------------------

    function q(s) {
        return "\"" + s + "\"";
    }

    // \u5225\u30ec\u30a4\u30e4\u30fc\u306e\u30c6\u30ad\u30b9\u30c8\u3092\u7d20\u306e\u6587\u5b57\u5217\u3067\u53d6\u308b (JS / \u65e7\u30a8\u30f3\u30b8\u30f3\u3069\u3061\u3089\u3067\u3082\u52d5\u304f\u66f8\u304d\u65b9)
    var EX_TXT =
        "function txt(n) { var v = thisComp.layer(n).text.sourceText.value; " +
        "return (v && typeof v.text == \"string\") ? v.text : \"\" + v; }\n";

    var EX_CTRL = "var c = thisComp.layer(\"CTRL\");\n";

    // \u5e2f\u306e\u5e45 (Premiere \u5074\u3067\u306f % \u3067\u6307\u5b9a)
    var EX_W = EX_CTRL + "var W = " + RULE.w + " * c.effect(\"\u5e2f\u306e\u5e45\")(1) / 100;\n";

    // IN / OUT \u30a2\u30cb\u30e1\u30fc\u30b7\u30e7\u30f3\u3002\u3059\u3079\u3066\u300c\u30a2\u30cb\u30e1\u6642\u9593\u300d(\u30d5\u30ec\u30fc\u30e0) \u3092\u57fa\u6e96\u306b\u3057\u305f\u6bd4\u7387\u3067\u52d5\u304f
    var EX_ANIM = EX_CTRL +
        "var fd = thisComp.frameDuration;\n" +
        "var dur = Math.max(1, c.effect(\"\u30a2\u30cb\u30e1\u6642\u9593\")(1)) * fd;\n" +
        "var inOn = c.effect(\"IN\u30a2\u30cb\u30e1\")(1) == 1;\n" +
        "var outOn = c.effect(\"OUT\u30a2\u30cb\u30e1\")(1) == 1;\n" +
        "function clamp01(x) { return Math.min(1, Math.max(0, x)); }\n" +
        "function backOut(x) { var s = 1.70158; x = x - 1; return x * x * ((s + 1) * x + s) + 1; }\n" +
        "function easeOut(x) { return 1 - Math.pow(1 - x, 3); }\n" +
        "function pIn(delay) { return inOn ? clamp01((time - delay * dur) / dur) : 1; }\n" +
        "function pOut() { return outOn ? clamp01((thisComp.duration - fd - time) / (dur * 0.6)) : 1; }\n";

    // \uff0a (\u5168\u89d2) \u304b * (\u534a\u89d2) \u3067\u631f\u3093\u3060 k \u756a\u76ee\u306e\u533a\u9593\u306e [\u958b\u59cb, \u7d42\u4e86] \u6587\u5b57\u756a\u53f7
    function exEmphasis(k, which) {
        return EX_TXT +
            "var raw = txt(" + q("EDIT_\u672c\u6587") + ");\n" +
            "var segs = [], n = 0, open = -1;\n" +
            "for (var i = 0; i < raw.length; i++) {\n" +
            "  var ch = raw.charAt(i);\n" +
            "  if (ch == \"*\" || ch == \"\uff0a\") {\n" +
            "    if (open < 0) { open = n; } else { segs.push([open, n]); open = -1; }\n" +
            "  } else { n++; }\n" +
            "}\n" +
            "if (open >= 0) { segs.push([open, n]); }\n" +
            "segs.length > " + k + " ? segs[" + k + "][" + which + "] : 0;";
    }

    var EX_RULE_TEXT = EX_TXT + "txt(" + q("EDIT_\u672c\u6587") + ").replace(/[*\uff0a]/g, \"\");";

    function effectRef(name) {
        return "thisComp.layer(\"CTRL\").effect(" + q(name) + ")(1)";
    }

    // ------------------------------------------------------------------
    // \u30eb\u30fc\u30eb\u30c6\u30ed\u30c3\u30d7
    // ------------------------------------------------------------------

    function buildRuleTelop(folder) {
        var comp = app.project.items.addComp("\u30eb\u30fc\u30eb\u30c6\u30ed\u30c3\u30d7", CFG.width, CFG.height, 1, CFG.duration, CFG.fps);
        comp.parentFolder = folder;

        var W2 = RULE.w / 2;
        var H2 = RULE.h / 2;
        var inner = RULE.frame;

        // --- \u9aa8\u7d44\u307f (\u4e0b\u304b\u3089\u9806\u306b\u7a4d\u3080: addXxx \u306f\u5e38\u306b\u4e00\u756a\u4e0a\u306b\u8ffd\u52a0\u3055\u308c\u308b) ---
        var rigBanner = addNull(comp, "RIG_\u5e2f", [RULE.cx, RULE.cy]);
        var rigLabel = addNull(comp, "RIG_\u30e9\u30d9\u30eb", [RULE.cx - W2, RULE.cy - H2]);
        var rigText = addNull(comp, "RIG_\u6587\u5b57", [RULE.cx, RULE.cy + RULE.textOffsetY]);

        // \u30d1\u30cd\u30eb (\u30df\u30f3\u30c8\u5730)
        var panel = addShapeLayer(comp, "BNR_\u30d1\u30cd\u30eb");
        addGroup(panel, "\u5730");
        addRect(panel, "\u5730", [RULE.w - 2 * inner, RULE.h - 2 * inner]);
        addFill(panel, "\u5730", COLORS.mint);
        attach(panel, rigBanner, [0, 0]);
        expr(panel, groupPath("\u5730", ["ADBE Vector Shape - Rect", "ADBE Vector Rect Size"]),
            EX_W + "[W - " + (2 * inner) + ", " + (RULE.h - 2 * inner) + "];");
        expr(panel, groupPath("\u5730", ["ADBE Vector Graphic - Fill", "ADBE Vector Fill Color"]), effectRef("\u80cc\u666f\u306e\u8272"));

        // \u96c6\u4e2d\u7dda: \u7d30\u3044\u6247\u5f62\u3092 360\u00b0 \u306b\u4e26\u3079\u3066\u6a2a\u306b\u5f15\u304d\u4f38\u3070\u3057\u3001\u30d1\u30cd\u30eb\u306e\u5f62\u3067\u5207\u308a\u629c\u304f
        var rays = addShapeLayer(comp, "BNR_\u96c6\u4e2d\u7dda");
        addGroup(rays, "\u96c6\u4e2d\u7dda");
        var R = 700;
        var half = (360 / RULE.rays) / 2 * Math.PI / 180;
        addPath(rays, "\u96c6\u4e2d\u7dda", [[0, 0], [0, -R], [R * Math.sin(half), -R * Math.cos(half)]]);
        addFill(rays, "\u96c6\u4e2d\u7dda", COLORS.mintRay);
        addRepeater(rays, "\u96c6\u4e2d\u7dda", RULE.rays, [0, 0], 360 / RULE.rays);
        prop(rays, ["ADBE Root Vectors Group", "\u96c6\u4e2d\u7dda", "ADBE Vector Transform Group", "ADBE Vector Scale"]).setValue([RULE.rayStretch, 100]);
        rays.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        attach(rays, rigBanner, [0, 0]);
        expr(rays, groupPath("\u96c6\u4e2d\u7dda", ["ADBE Vector Graphic - Fill", "ADBE Vector Fill Color"]), effectRef("\u96c6\u4e2d\u7dda\u306e\u8272"));
        expr(rays, ["ADBE Mask Parade", 1, "ADBE Mask Shape"],
            EX_W +
            "var w = W / 2 - " + inner + ", h = " + (H2 - inner) + ";\n" +
            "createPath([[-w, -h], [w, -h], [w, h], [-w, h]], [], [], true);");

        // \u91d1\u67a0: \u5916\u5bf8\u304b\u3089\u5185\u5074\u3078 \u6697(0-2) \u9ec4(2-6) \u91d1(6-9) \u660e(9-11) \u6697(11-13) \u306e\u7e1e\u3002
        // \u305d\u306e\u4e0b\u306b\u30d1\u30cd\u30eb\u306e\u7e01\u306e\u7dda\u3068\u5f71 (\u96c6\u4e2d\u7dda\u3088\u308a\u4e0a\u306b\u6765\u308b\u3088\u3046\u306b\u3053\u306e\u30ec\u30a4\u30e4\u30fc\u306b\u5165\u308c\u308b)
        var frame = addShapeLayer(comp, "BNR_\u30d5\u30ec\u30fc\u30e0");
        var bands = [
            // name, \u5916\u5074\u304b\u3089\u306e\u4e2d\u5fc3\u4f4d\u7f6e, \u592a\u3055, \u8272, \u8272\u306e\u5f0f, \u4e0d\u900f\u660e\u5ea6
            ["\u660e", 10, 2, "#c2b062", "var a = " + effectRef("\u67a0\u306e\u82721") + ", b = " + effectRef("\u67a0\u306e\u82722") + ";\n[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 1];", 100],
            ["\u91d1", 7.5, 3, COLORS.frameGold, effectRef("\u67a0\u306e\u82722"), 100],
            ["\u9ec4", 4, 4, COLORS.frameYellow, effectRef("\u67a0\u306e\u82721"), 100],
            ["\u5916\u67a0", 6.5, 13, COLORS.frameDark, null, 100],
            ["\u5185\u7dda", inner, 3, COLORS.panelLine, null, 100],
            ["\u5185\u5074\u306e\u5f71", inner, 8, COLORS.panelShade, null, 40]
        ];
        for (var b = 0; b < bands.length; b++) {
            var bd = bands[b];
            addGroup(frame, bd[0]);
            addRect(frame, bd[0], [RULE.w - 2 * bd[1], RULE.h - 2 * bd[1]]);
            addStroke(frame, bd[0], bd[3], bd[2], bd[5]);
        }
        attach(frame, rigBanner, [0, 0]);
        for (b = 0; b < bands.length; b++) {
            bd = bands[b];
            expr(frame, groupPath(bd[0], ["ADBE Vector Shape - Rect", "ADBE Vector Rect Size"]),
                EX_W + "[W - " + (2 * bd[1]) + ", " + (RULE.h - 2 * bd[1]) + "];");
            if (bd[4]) {
                expr(frame, groupPath(bd[0], ["ADBE Vector Graphic - Stroke", "ADBE Vector Stroke Color"]), bd[4]);
            }
        }

        // \u56db\u9685\u306e\u92f2
        var rivets = addShapeLayer(comp, "BNR_\u30ea\u30d9\u30c3\u30c8");
        var corners = [["\u5de6\u4e0a", -1, -1], ["\u53f3\u4e0a", 1, -1], ["\u5de6\u4e0b", -1, 1], ["\u53f3\u4e0b", 1, 1]];
        var k;
        for (k = 0; k < corners.length; k++) {
            addGroup(rivets, corners[k][0] + "_\u70b9");
            addRect(rivets, corners[k][0] + "_\u70b9", [5, 5]);
            addFill(rivets, corners[k][0] + "_\u70b9", "#222222");
        }
        for (k = 0; k < corners.length; k++) {
            addGroup(rivets, corners[k][0] + "_\u7bb1");
            addRect(rivets, corners[k][0] + "_\u7bb1", [13, 13]);
            addFill(rivets, corners[k][0] + "_\u7bb1", COLORS.rivet);
            addStroke(rivets, corners[k][0] + "_\u7bb1", COLORS.rivetLine, 2);
        }
        attach(rivets, rigBanner, [0, 0]);
        for (k = 0; k < corners.length; k++) {
            var cpos = EX_W + "[" + corners[k][1] + " * (W / 2 - 6.5), " + corners[k][2] + " * " + (H2 - 6.5) + "];";
            expr(rivets, ["ADBE Root Vectors Group", corners[k][0] + "_\u70b9", "ADBE Vector Transform Group", "ADBE Vector Position"], cpos);
            expr(rivets, ["ADBE Root Vectors Group", corners[k][0] + "_\u7bb1", "ADBE Vector Transform Group", "ADBE Vector Position"], cpos);
        }

        // --- \u30e9\u30d9\u30eb (1\u6587\u5b571\u30de\u30b9) ---
        var step = RULE.labelBoxW - RULE.labelBorder;
        var boxCx = RULE.labelBoxW / 2;
        var boxCy = -RULE.labelBoxH / 2;
        var labelVisible = effectRef("\u30e9\u30d9\u30eb\u8868\u793a") + " * 100;";

        var boxes = addShapeLayer(comp, "LBL_\u7bb1");
        addGroup(boxes, "\u7bb1");
        addRect(boxes, "\u7bb1", [RULE.labelBoxW - RULE.labelBorder, RULE.labelBoxH - RULE.labelBorder], [boxCx, boxCy]);
        addFill(boxes, "\u7bb1", COLORS.white);
        addStroke(boxes, "\u7bb1", COLORS.labelLine, RULE.labelBorder);
        addRepeater(boxes, "\u7bb1", 3, [step, 0], 0);
        attach(boxes, rigLabel, [0, 0]);
        expr(boxes, groupPath("\u7bb1", ["ADBE Vector Filter - Repeater", "ADBE Vector Repeater Copies"]),
            EX_TXT + "Math.min(" + RULE.labelMax + ", txt(" + q("EDIT_\u30e9\u30d9\u30eb") + ").length);");
        expr(boxes, ["ADBE Transform Group", "ADBE Opacity"], labelVisible);

        for (var i = RULE.labelMax - 1; i >= 0; i--) {
            var ch = addText(comp, "LBL_\u6587\u5b57" + (i + 1), "\u30eb", {
                font: CFG.fonts.label, size: RULE.labelFontSize, fill: COLORS.labelRed, tracking: 0
            });
            addAnimator(ch, "\u8272", ["ADBE Text Fill Color"], false);
            attach(ch, rigLabel, [boxCx + step * i, boxCy]);
            transform(ch, "ADBE Anchor Point").setValue([0, -RULE.labelFontSize * CJK_CENTER]);
            expr(ch, ["ADBE Text Properties", "ADBE Text Document"],
                EX_TXT + "var s = txt(" + q("EDIT_\u30e9\u30d9\u30eb") + ");\ns.length > " + i + " ? s.charAt(" + i + ") : \"\";");
            expr(ch, animatorPath("\u8272", "ADBE Text Fill Color"), effectRef("\u30e9\u30d9\u30eb\u6587\u5b57\u306e\u8272"));
            expr(ch, ["ADBE Transform Group", "ADBE Opacity"], labelVisible);
        }

        // --- \u672c\u6587 ---
        var textStyle = {
            font: CFG.fonts.rule, size: RULE.textFontSize, fill: COLORS.white, tracking: RULE.textTracking
        };
        var anchorY = -RULE.textFontSize * CJK_CENTER;

        // \u62bc\u3057\u51fa\u3057\u5f71: \u9ed2\u3044\u8907\u88fd\u3092\u5c11\u3057\u305a\u3064\u305a\u3089\u3057\u3066\u91cd\u306d\u308b
        for (var s = RULE.shadowCopies; s >= 1; s--) {
            var sh = addText(comp, "TXT_\u672c\u6587_\u5f71" + s, "\u30ec\u30b7\u30fc\u30c8\u306b\u66f8\u304b\u308c\u3066\u3044\u308b\u30e2\u30ce\u306f\u73fe\u7269\u3068\u4ea4\u63db\u53ef\u80fd", {
                font: CFG.fonts.rule, size: RULE.textFontSize, fill: COLORS.black, tracking: RULE.textTracking
            });
            addAnimator(sh, "\u8272", ["ADBE Text Fill Color"], false);
            attach(sh, rigText, [0, 0]);
            expr(sh, ["ADBE Text Properties", "ADBE Text Document"], EX_RULE_TEXT);
            expr(sh, animatorPath("\u8272", "ADBE Text Fill Color"), effectRef("\u5f71\u306e\u8272"));
            expr(sh, ["ADBE Transform Group", "ADBE Anchor Point"], "thisComp.layer(\"TXT_\u672c\u6587\").transform.anchorPoint;");
            expr(sh, ["ADBE Transform Group", "ADBE Scale"], "thisComp.layer(\"TXT_\u672c\u6587\").transform.scale;");
            expr(sh, ["ADBE Transform Group", "ADBE Position"],
                "var m = thisComp.layer(\"TXT_\u672c\u6587\");\n" +
                "var d = " + effectRef("\u5f71\u306e\u8ddd\u96e2") + " * " + s + " / " + RULE.shadowCopies + " * m.transform.scale[0] / 100;\n" +
                "var p = m.transform.position;\n" +
                "[p[0] + d, p[1] + d];");
        }

        var main = addText(comp, "TXT_\u672c\u6587", "\u30ec\u30b7\u30fc\u30c8\u306b\u66f8\u304b\u308c\u3066\u3044\u308b\u30e2\u30ce\u306f\u73fe\u7269\u3068\u4ea4\u63db\u53ef\u80fd", textStyle);
        addAnimator(main, "\u672c\u6587\u8272", ["ADBE Text Fill Color"], false);
        for (k = 1; k <= 3; k++) {
            addAnimator(main, "\u5f37\u8abf" + k, ["ADBE Text Fill Color"], true);
        }
        attach(main, rigText, [0, 0]);
        expr(main, ["ADBE Text Properties", "ADBE Text Document"], EX_RULE_TEXT);
        expr(main, animatorPath("\u672c\u6587\u8272", "ADBE Text Fill Color"), effectRef("\u672c\u6587\u306e\u8272"));
        for (k = 1; k <= 3; k++) {
            expr(main, animatorPath("\u5f37\u8abf" + k, "ADBE Text Fill Color"), effectRef("\u5f37\u8abf\u306e\u8272"));
            expr(main, selectorPath("\u5f37\u8abf" + k, "ADBE Text Index Start"), exEmphasis(k - 1, 0));
            expr(main, selectorPath("\u5f37\u8abf" + k, "ADBE Text Index End"), exEmphasis(k - 1, 1));
        }
        expr(main, ["ADBE Transform Group", "ADBE Anchor Point"],
            "var r = sourceRectAtTime(time, false);\n[r.left + r.width / 2, " + anchorY + "];");
        expr(main, ["ADBE Transform Group", "ADBE Scale"],
            EX_W +
            "var u = c.effect(\"\u6587\u5b57\u30b5\u30a4\u30ba\")(1) / 100;\n" +
            "var maxW = W - " + (2 * RULE.textPadding) + ";\n" +
            "var r = sourceRectAtTime(time, false);\n" +
            "var s = (r.width > 0 && r.width * u > maxW) ? maxW / r.width : u;\n" +
            "[s * 100, s * 100];");

        // --- \u7de8\u96c6\u7528 (\u975e\u8868\u793a) ---
        var editLabel = addText(comp, "EDIT_\u30e9\u30d9\u30eb", "\u30eb\u30fc\u30eb", {
            font: CFG.fonts.label, size: 40, fill: COLORS.white, tracking: 0
        });
        transform(editLabel, "ADBE Opacity").setValue(0);
        var editMain = addText(comp, "EDIT_\u672c\u6587", "\u30ec\u30b7\u30fc\u30c8\u306b\u66f8\u304b\u308c\u3066\u3044\u308b\u30e2\u30ce\u306f\uff0a\u73fe\u7269\u3068\u4ea4\u63db\u53ef\u80fd\uff0a", {
            font: CFG.fonts.rule, size: 40, fill: COLORS.white, tracking: 0
        });
        transform(editMain, "ADBE Opacity").setValue(0);

        // --- \u30b3\u30f3\u30c8\u30ed\u30fc\u30eb ---
        var ctrl = comp.layers.addNull();
        ctrl.name = "CTRL";
        addControl(ctrl, "color", "\u672c\u6587\u306e\u8272", COLORS.white);
        addControl(ctrl, "color", "\u5f37\u8abf\u306e\u8272", COLORS.red);
        addControl(ctrl, "color", "\u5f71\u306e\u8272", COLORS.black);
        addControl(ctrl, "slider", "\u5f71\u306e\u8ddd\u96e2", 11);
        addControl(ctrl, "slider", "\u6587\u5b57\u30b5\u30a4\u30ba", 100);
        addControl(ctrl, "color", "\u30e9\u30d9\u30eb\u6587\u5b57\u306e\u8272", COLORS.labelRed);
        addControl(ctrl, "checkbox", "\u30e9\u30d9\u30eb\u8868\u793a", true);
        addControl(ctrl, "color", "\u80cc\u666f\u306e\u8272", COLORS.mint);
        addControl(ctrl, "color", "\u96c6\u4e2d\u7dda\u306e\u8272", COLORS.mintRay);
        addControl(ctrl, "color", "\u67a0\u306e\u82721", COLORS.frameYellow);
        addControl(ctrl, "color", "\u67a0\u306e\u82722", COLORS.frameGold);
        addControl(ctrl, "slider", "\u5e2f\u306e\u5e45", 100);
        addControl(ctrl, "checkbox", "IN\u30a2\u30cb\u30e1", true);
        addControl(ctrl, "checkbox", "OUT\u30a2\u30cb\u30e1", false);
        addControl(ctrl, "slider", "\u30a2\u30cb\u30e1\u6642\u9593", 9);

        // --- \u30a2\u30cb\u30e1\u30fc\u30b7\u30e7\u30f3 (\u9aa8\u7d44\u307f\u306e\u62e1\u5927\u7387\u3092\u5f0f\u3067\u52d5\u304b\u3059) ---
        expr(rigBanner, ["ADBE Transform Group", "ADBE Scale"],
            EX_ANIM + "var p = pIn(0), o = pOut();\n[100 * backOut(p) * o, 100 * (0.7 + 0.3 * easeOut(p)) * o];");
        expr(rigLabel, ["ADBE Transform Group", "ADBE Position"],
            EX_W + "[" + RULE.cx + " - W / 2, " + (RULE.cy - H2) + "];");
        expr(rigLabel, ["ADBE Transform Group", "ADBE Scale"],
            EX_ANIM + "var s = 100 * backOut(pIn(0.33)) * pOut();\n[s, s];");
        expr(rigText, ["ADBE Transform Group", "ADBE Scale"],
            EX_ANIM + "var s = 100 * backOut(pIn(0.55)) * pOut();\n[s, s];");

        // --- Premiere \u306b\u51fa\u3059\u9805\u76ee (\u3053\u306e\u9806\u3067\u4e26\u3076) ---
        exposeText(comp, editMain, "\u672c\u6587\uff08\uff0a\u3067\u631f\u3093\u3060\u90e8\u5206\u304c\u5f37\u8abf\u8272\uff09");
        exposeText(comp, editLabel, "\u30e9\u30d9\u30eb");
        exposeEffect(comp, ctrl, "\u30e9\u30d9\u30eb\u8868\u793a", "\u30e9\u30d9\u30eb\u3092\u8868\u793a");
        exposeEffect(comp, ctrl, "\u672c\u6587\u306e\u8272", "\u672c\u6587\u306e\u8272");
        exposeEffect(comp, ctrl, "\u5f37\u8abf\u306e\u8272", "\u5f37\u8abf\u306e\u8272");
        exposeEffect(comp, ctrl, "\u5f71\u306e\u8272", "\u5f71\u306e\u8272");
        exposeEffect(comp, ctrl, "\u5f71\u306e\u8ddd\u96e2", "\u5f71\u306e\u8ddd\u96e2 (px)");
        exposeEffect(comp, ctrl, "\u6587\u5b57\u30b5\u30a4\u30ba", "\u6587\u5b57\u30b5\u30a4\u30ba (%)");
        exposeEffect(comp, ctrl, "\u30e9\u30d9\u30eb\u6587\u5b57\u306e\u8272", "\u30e9\u30d9\u30eb\u6587\u5b57\u306e\u8272");
        exposeEffect(comp, ctrl, "\u80cc\u666f\u306e\u8272", "\u5e2f\u306e\u5730\u306e\u8272");
        exposeEffect(comp, ctrl, "\u96c6\u4e2d\u7dda\u306e\u8272", "\u96c6\u4e2d\u7dda\u306e\u8272");
        exposeEffect(comp, ctrl, "\u67a0\u306e\u82721", "\u91d1\u67a0\u306e\u8272\uff08\u660e\uff09");
        exposeEffect(comp, ctrl, "\u67a0\u306e\u82722", "\u91d1\u67a0\u306e\u8272\uff08\u6697\uff09");
        exposeEffect(comp, ctrl, "\u5e2f\u306e\u5e45", "\u5e2f\u306e\u5e45 (%)");
        exposeEffect(comp, ctrl, "IN\u30a2\u30cb\u30e1", "IN \u30a2\u30cb\u30e1\u30fc\u30b7\u30e7\u30f3");
        exposeEffect(comp, ctrl, "OUT\u30a2\u30cb\u30e1", "OUT \u30a2\u30cb\u30e1\u30fc\u30b7\u30e7\u30f3");
        exposeEffect(comp, ctrl, "\u30a2\u30cb\u30e1\u6642\u9593", "\u30a2\u30cb\u30e1\u30fc\u30b7\u30e7\u30f3\u306e\u9577\u3055 (\u30d5\u30ec\u30fc\u30e0)");

        return { comp: comp, name: "\u30eb\u30fc\u30eb\u30c6\u30ed\u30c3\u30d7", inFrames: 20, outFrames: 10 };
    }

    // ------------------------------------------------------------------
    // \u30bb\u30ea\u30d5\u30c6\u30ed\u30c3\u30d7
    // ------------------------------------------------------------------

    function buildSpeechTelop(folder) {
        var comp = app.project.items.addComp("\u30bb\u30ea\u30d5\u30c6\u30ed\u30c3\u30d7", CFG.width, CFG.height, 1, CFG.duration, CFG.fps);
        comp.parentFolder = folder;

        var style = {
            font: CFG.fonts.speech, size: SPEECH.fontSize, tracking: SPEECH.tracking,
            fill: COLORS.white, stroke: COLORS.black, strokeWidth: SPEECH.stroke
        };
        var leading = SPEECH.fontSize * 1.2; // \u81ea\u52d5\u884c\u9001\u308a (120%)
        var anchorY = -SPEECH.fontSize * CJK_CENTER;

        var glow = addText(comp, "TXT_\u30bb\u30ea\u30d5_\u5f71", "\u3061\u3087\u3063\u3068\u3060\u3044\u3076\u6b69\u3063\u305f\u304b\u3089\u306a\u3041", {
            font: CFG.fonts.speech, size: SPEECH.fontSize, tracking: SPEECH.tracking,
            fill: COLORS.black, stroke: COLORS.black, strokeWidth: SPEECH.stroke + 4
        });
        addAnimator(glow, "\u8272", ["ADBE Text Fill Color", "ADBE Text Stroke Color", "ADBE Text Stroke Width"], false);
        var blur = glow.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
        blur.property(1).setValue(8);
        blur.property(3).setValue(0); // \u30a8\u30c3\u30b8\u30d4\u30af\u30bb\u30eb\u3092\u7e70\u308a\u8fd4\u3055\u306a\u3044

        var line = addText(comp, "TXT_\u30bb\u30ea\u30d5", "\u3061\u3087\u3063\u3068\u3060\u3044\u3076\u6b69\u3063\u305f\u304b\u3089\u306a\u3041", style);
        addAnimator(line, "\u8272", ["ADBE Text Fill Color", "ADBE Text Stroke Color", "ADBE Text Stroke Width"], false);
        transform(line, "ADBE Position").setValue([SPEECH.x, SPEECH.y]);

        var ctrl = comp.layers.addNull();
        ctrl.name = "CTRL";
        addControl(ctrl, "color", "\u6587\u5b57\u306e\u8272", COLORS.white);
        addControl(ctrl, "color", "\u30d5\u30c1\u306e\u8272", COLORS.black);
        addControl(ctrl, "slider", "\u30d5\u30c1\u306e\u592a\u3055", SPEECH.stroke);
        addControl(ctrl, "color", "\u5f71\u306e\u8272", COLORS.black);
        addControl(ctrl, "slider", "\u5f71\u306e\u307c\u304b\u3057", 8);
        addControl(ctrl, "slider", "\u5f71\u306e\u6fc3\u3055", 85);
        addControl(ctrl, "slider", "\u6587\u5b57\u30b5\u30a4\u30ba", 100);
        addControl(ctrl, "checkbox", "IN\u30a2\u30cb\u30e1", true);
        addControl(ctrl, "checkbox", "OUT\u30a2\u30cb\u30e1", false);
        addControl(ctrl, "slider", "\u30a2\u30cb\u30e1\u6642\u9593", 4);

        expr(line, animatorPath("\u8272", "ADBE Text Fill Color"), effectRef("\u6587\u5b57\u306e\u8272"));
        expr(line, animatorPath("\u8272", "ADBE Text Stroke Color"), effectRef("\u30d5\u30c1\u306e\u8272"));
        expr(line, animatorPath("\u8272", "ADBE Text Stroke Width"), effectRef("\u30d5\u30c1\u306e\u592a\u3055"));
        expr(line, ["ADBE Transform Group", "ADBE Anchor Point"],
            EX_TXT +
            "var lines = txt(\"TXT_\u30bb\u30ea\u30d5\").split(/\\r\\n|\\r|\\n/).length;\n" +
            "var r = sourceRectAtTime(time, false);\n" +
            "[r.left + r.width / 2, (lines - 1) * " + leading + " + " + anchorY + "];");
        expr(line, ["ADBE Transform Group", "ADBE Scale"],
            EX_ANIM +
            "var u = c.effect(\"\u6587\u5b57\u30b5\u30a4\u30ba\")(1);\n" +
            "var s = u * (1 + 0.3 * (1 - easeOut(pIn(0)))) * (0.6 + 0.4 * pOut());\n" +
            "[s, s];");
        expr(line, ["ADBE Transform Group", "ADBE Opacity"],
            EX_ANIM + "100 * easeOut(pIn(0)) * pOut();");

        expr(glow, ["ADBE Text Properties", "ADBE Text Document"], EX_TXT + "txt(\"TXT_\u30bb\u30ea\u30d5\");");
        expr(glow, animatorPath("\u8272", "ADBE Text Fill Color"), effectRef("\u5f71\u306e\u8272"));
        expr(glow, animatorPath("\u8272", "ADBE Text Stroke Color"), effectRef("\u5f71\u306e\u8272"));
        expr(glow, animatorPath("\u8272", "ADBE Text Stroke Width"), effectRef("\u30d5\u30c1\u306e\u592a\u3055") + " + 4;");
        expr(glow, ["ADBE Effect Parade", 1, 1], effectRef("\u5f71\u306e\u307c\u304b\u3057"));
        expr(glow, ["ADBE Transform Group", "ADBE Anchor Point"], "thisComp.layer(\"TXT_\u30bb\u30ea\u30d5\").transform.anchorPoint;");
        expr(glow, ["ADBE Transform Group", "ADBE Scale"], "thisComp.layer(\"TXT_\u30bb\u30ea\u30d5\").transform.scale;");
        expr(glow, ["ADBE Transform Group", "ADBE Position"],
            "var p = thisComp.layer(\"TXT_\u30bb\u30ea\u30d5\").transform.position;\n[p[0], p[1] + 3];");
        expr(glow, ["ADBE Transform Group", "ADBE Opacity"],
            "thisComp.layer(\"TXT_\u30bb\u30ea\u30d5\").transform.opacity * " + effectRef("\u5f71\u306e\u6fc3\u3055") + " / 100;");

        exposeText(comp, line, "\u30bb\u30ea\u30d5");
        exposeEffect(comp, ctrl, "\u6587\u5b57\u306e\u8272", "\u6587\u5b57\u306e\u8272");
        exposeEffect(comp, ctrl, "\u30d5\u30c1\u306e\u8272", "\u30d5\u30c1\u306e\u8272");
        exposeEffect(comp, ctrl, "\u30d5\u30c1\u306e\u592a\u3055", "\u30d5\u30c1\u306e\u592a\u3055");
        exposeEffect(comp, ctrl, "\u5f71\u306e\u8272", "\u5f71\u306e\u8272");
        exposeEffect(comp, ctrl, "\u5f71\u306e\u307c\u304b\u3057", "\u5f71\u306e\u307c\u304b\u3057");
        exposeEffect(comp, ctrl, "\u5f71\u306e\u6fc3\u3055", "\u5f71\u306e\u6fc3\u3055 (%)");
        exposeEffect(comp, ctrl, "\u6587\u5b57\u30b5\u30a4\u30ba", "\u6587\u5b57\u30b5\u30a4\u30ba (%)");
        exposeEffect(comp, ctrl, "IN\u30a2\u30cb\u30e1", "IN \u30a2\u30cb\u30e1\u30fc\u30b7\u30e7\u30f3");
        exposeEffect(comp, ctrl, "OUT\u30a2\u30cb\u30e1", "OUT \u30a2\u30cb\u30e1\u30fc\u30b7\u30e7\u30f3");
        exposeEffect(comp, ctrl, "\u30a2\u30cb\u30e1\u6642\u9593", "\u30a2\u30cb\u30e1\u30fc\u30b7\u30e7\u30f3\u306e\u9577\u3055 (\u30d5\u30ec\u30fc\u30e0)");

        return { comp: comp, name: "\u30bb\u30ea\u30d5\u30c6\u30ed\u30c3\u30d7", inFrames: 10, outFrames: 6 };
    }

    // ------------------------------------------------------------------
    // \u4ed5\u4e0a\u3052
    // ------------------------------------------------------------------

    function applyExpressions() {
        for (var i = 0; i < EXPR.length; i++) {
            var e = EXPR[i];
            var p = prop(e.layer, e.path);
            p.expression = e.code;
            p.expressionEnabled = true;
        }
        for (i = 0; i < EXPR.length; i++) {
            e = EXPR[i];
            p = prop(e.layer, e.path);
            if (p.expressionError) {
                exprErrors.push(e.layer.containingComp.name + " / " + e.layer.name + ": " + p.expressionError);
            }
        }
    }

    function exposeAll() {
        for (var i = 0; i < EGP.length; i++) {
            var x = EGP[i];
            var p = prop(x.layer, x.path);
            if (!p.canAddToMotionGraphicsTemplate(x.comp)) {
                exprErrors.push(x.comp.name + ": " + x.label + " \u3092\u30a8\u30c3\u30bb\u30f3\u30b7\u30e3\u30eb\u30b0\u30e9\u30d5\u30a3\u30c3\u30af\u30b9\u306b\u8ffd\u52a0\u3067\u304d\u307e\u305b\u3093");
                continue;
            }
            p.addToMotionGraphicsTemplateAs(x.comp, x.label);
        }
    }

    // Premiere \u3067\u5c3a\u3092\u4f38\u3070\u3057\u3066\u3082 IN / OUT \u306e\u52d5\u304d\u304c\u5d29\u308c\u306a\u3044\u3088\u3046\u4fdd\u8b77\u9818\u57df\u3092\u7f6e\u304f
    function protectRegions(t) {
        var fd = t.comp.frameDuration;
        var mIn = new MarkerValue("IN");
        mIn.duration = t.inFrames * fd;
        mIn.protectedRegion = true;
        t.comp.markerProperty.setValueAtTime(0, mIn);
        var mOut = new MarkerValue("OUT");
        mOut.duration = t.outFrames * fd;
        mOut.protectedRegion = true;
        t.comp.markerProperty.setValueAtTime(t.comp.duration - t.outFrames * fd, mOut);
    }

    function exportTemplate(t, folder) {
        t.comp.motionGraphicsTemplateName = t.name;
        try {
            t.comp.openInEssentialGraphics();
        } catch (e) {
            // \u53e4\u3044\u7248\u3067\u306f\u7121\u3044\u3002\u66f8\u304d\u51fa\u3057\u306b\u306f\u5f71\u97ff\u3057\u306a\u3044
        }
        if (!folder) {
            // \u4fdd\u5b58\u5148\u3092\u9078\u3070\u306a\u304b\u3063\u305f\u3068\u304d\u306f Premiere \u306e\u300c\u30ed\u30fc\u30ab\u30eb\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8\u30d5\u30a9\u30eb\u30c0\u30fc\u300d\u3078
            return t.comp.exportAsMotionGraphicsTemplate(true) ? t.name + "\uff08\u30ed\u30fc\u30ab\u30eb\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8\u30d5\u30a9\u30eb\u30c0\u30fc\uff09" : null;
        }
        var file = new File(folder.fsName + "/" + t.name + ".mogrt");
        var ok = t.comp.exportAsMotionGraphicsTemplate(true, folder.fsName);
        if (!file.exists) {
            ok = t.comp.exportAsMotionGraphicsTemplate(true, file.fsName);
        }
        return (ok || file.exists) ? file.fsName : null;
    }

    function main() {
        if (parseFloat(app.version) < MIN_AE_VERSION) {
            alert("After Effects 2020 \u4ee5\u964d\u3067\u5b9f\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002\uff08\u4eca\u306e\u30d0\u30fc\u30b8\u30e7\u30f3: " + app.version + "\uff09");
            return;
        }

        app.beginUndoGroup("\u30c6\u30ed\u30c3\u30d7\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8\u4f5c\u6210");
        var built = [];
        try {
            var folder = app.project.items.addFolder(CFG.folderName);
            built.push(buildRuleTelop(folder));
            built.push(buildSpeechTelop(folder));
            applyExpressions();
            exposeAll();
            for (var i = 0; i < built.length; i++) {
                protectRegions(built[i]);
            }
        } catch (err) {
            app.endUndoGroup();
            alert("\u4f5c\u6210\u4e2d\u306b\u30a8\u30e9\u30fc\u304c\u51fa\u307e\u3057\u305f:\n" + err.toString() + (err.line ? "\n(\u884c " + err.line + ")" : ""));
            return;
        }
        app.endUndoGroup();

        var report = ["\u30c6\u30ed\u30c3\u30d7\u306e\u30b3\u30f3\u30dd\u30b8\u30b7\u30e7\u30f3\u3092\u4f5c\u308a\u307e\u3057\u305f\u3002"];
        if (missingFonts.length) {
            report.push("", "\u898b\u3064\u304b\u3089\u306a\u3044\u30d5\u30a9\u30f3\u30c8\uff08\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3066\u304b\u3089\u5b9f\u884c\u3057\u76f4\u3057\u3066\u304f\u3060\u3055\u3044\uff09:", "  " + missingFonts.join("\n  "));
        }
        if (exprErrors.length) {
            report.push("", "\u30a8\u30af\u30b9\u30d7\u30ec\u30c3\u30b7\u30e7\u30f3\u306e\u30a8\u30e9\u30fc:", "  " + exprErrors.join("\n  "));
        }

        var outFolder = Folder.selectDialog(".mogrt \u306e\u4fdd\u5b58\u5148\u30d5\u30a9\u30eb\u30c0\u30fc\u3092\u9078\u3093\u3067\u304f\u3060\u3055\u3044\n\uff08\u30ad\u30e3\u30f3\u30bb\u30eb\u3059\u308b\u3068 Premiere \u306e\u30ed\u30fc\u30ab\u30eb\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8\u30d5\u30a9\u30eb\u30c0\u30fc\u306b\u4fdd\u5b58\u3057\u307e\u3059\uff09");
        var saved = [], failed = [];
        for (i = 0; i < built.length; i++) {
            var path = exportTemplate(built[i], outFolder);
            if (path) {
                saved.push(path);
            } else {
                failed.push(built[i].name);
            }
        }
        if (saved.length) {
            report.push("", "\u66f8\u304d\u51fa\u3057\u305f .mogrt:", "  " + saved.join("\n  "));
        }
        if (failed.length) {
            report.push("", "\u66f8\u304d\u51fa\u305b\u306a\u304b\u3063\u305f\u3082\u306e: " + failed.join("\u3001"),
                "\u2192 \u30a8\u30c3\u30bb\u30f3\u30b7\u30e3\u30eb\u30b0\u30e9\u30d5\u30a3\u30c3\u30af\u30b9\u30d1\u30cd\u30eb\u306e\u300c\u30e2\u30fc\u30b7\u30e7\u30f3\u30b0\u30e9\u30d5\u30a3\u30c3\u30af\u30b9\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8\u3092\u66f8\u304d\u51fa\u3057\u300d\u304b\u3089\u624b\u52d5\u3067\u66f8\u304d\u51fa\u305b\u307e\u3059\u3002");
        }
        alert(report.join("\n"));
    }

    main();
}());
