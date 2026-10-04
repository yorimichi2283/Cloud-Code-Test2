/*
 * TelopTemplates.src.jsx
 *
 * After Effects 上で実行すると、テロップのコンポジションを組み立てて
 * Premiere Pro 用のモーショングラフィックステンプレート (.mogrt) を書き出す。
 *
 *   - ルールテロップ : 金枠 + ミント地 + 集中線の帯、左上に1文字1マスのラベル、
 *                      本文は白 + 黒の押し出し影、＊で挟んだ部分だけ赤
 *   - セリフテロップ : 白文字 + 黒フチ + ぼかし影
 *
 * これは読みやすさ用のソース。配布用の ../TelopTemplates.jsx は
 * tools/build.py が全角文字を \uXXXX に置き換えて生成する
 * (日本語版 Windows の After Effects で文字化けしないようにするため)。
 *
 * ExtendScript (ES3) で動くように書くこと:
 *   let/const・アロー関数・Array#indexOf/forEach・JSON・末尾カンマは使わない。
 * プロパティはすべて matchName で参照する (日本語版 AE でも動くように)。
 */
(function TelopTemplates() {

    var CFG = {
        width: 1920,
        height: 1080,
        fps: 29.97,
        duration: 5,
        folderName: "TELOP_TEMPLATES",
        // PostScript 名。手持ちの書体に替えるときはここを書き換える
        fonts: {
            rule: "NotoSansJP-Black",
            label: "RoundedMplus1c-Medium",
            speech: "KaiseiTokumin-ExtraBold"
        }
    };

    // ルールテロップの寸法 (スクリーンショットを 1920x1080 に換算して採寸)
    var RULE = {
        cx: 960,            // 帯の中心
        cy: 978,
        w: 1856,            // 帯の外寸
        h: 168,
        frame: 13,          // 金枠の太さ
        textFontSize: 88,
        textTracking: -70,
        textOffsetY: -8,    // 文字の中心は帯の中心より少し上
        textPadding: 60,    // 左右の余白 (これを超える長さは自動で縮小)
        shadowCopies: 5,    // 押し出し影の枚数
        labelBoxW: 81,      // ラベル1マスの外寸
        labelBoxH: 76,
        labelBorder: 3,
        labelFontSize: 64,
        labelMax: 8,        // ラベルの最大文字数
        rays: 48,           // 集中線の本数
        rayStretch: 300     // 集中線の横伸ばし (%)
    };

    var SPEECH = {
        x: 960,
        y: 843,             // 最終行の中心
        fontSize: 90,
        tracking: -170,
        stroke: 6
    };

    // 和文の字面の中心はベースラインから約 0.38em 上
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

    var EXPR = [];          // 全レイヤーを作り終えてからまとめて式を入れる
    var EGP = [];           // エッセンシャルグラフィックスに出すプロパティ
    var missingFonts = [];
    var exprErrors = [];

    // ------------------------------------------------------------------
    // 小物
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
            // 未インストールの書体を指定すると元の書体のまま残る版がある
            missingFonts.push(ps);
            return;
        }
        try {
            // app.fonts は AE 24.0 以降のみ
            if (app.fonts && app.fonts.getFontsByPostScriptName) {
                if (app.fonts.getFontsByPostScriptName(ps).length === 0) {
                    missingFonts.push(ps);
                }
            }
        } catch (e) {
            // 調べられない環境では何もしない
        }
    }

    // ------------------------------------------------------------------
    // レイヤー
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

    // テキストアニメーター。props は ["ADBE Text Fill Color", ...]
    // byIndex のときは文字番号で範囲を絞るセレクターになる。
    // addProperty するとそのグループへの既存の参照が無効になることがあるので、毎回レイヤーから辿り直す
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
        s.property("ADBE Vector Stroke Line Join").setValue(1); // マイター
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

    // エクスプレッション制御 (Premiere から触る値はすべてここに集める)
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
    // エクスプレッション部品
    // ------------------------------------------------------------------

    function q(s) {
        return "\"" + s + "\"";
    }

    // 別レイヤーのテキストを素の文字列で取る (JS / 旧エンジンどちらでも動く書き方)
    var EX_TXT =
        "function txt(n) { var v = thisComp.layer(n).text.sourceText.value; " +
        "return (v && typeof v.text == \"string\") ? v.text : \"\" + v; }\n";

    var EX_CTRL = "var c = thisComp.layer(\"CTRL\");\n";

    // 帯の幅 (Premiere 側では % で指定)
    var EX_W = EX_CTRL + "var W = " + RULE.w + " * c.effect(\"帯の幅\")(1) / 100;\n";

    // IN / OUT アニメーション。すべて「アニメ時間」(フレーム) を基準にした比率で動く
    var EX_ANIM = EX_CTRL +
        "var fd = thisComp.frameDuration;\n" +
        "var dur = Math.max(1, c.effect(\"アニメ時間\")(1)) * fd;\n" +
        "var inOn = c.effect(\"INアニメ\")(1) == 1;\n" +
        "var outOn = c.effect(\"OUTアニメ\")(1) == 1;\n" +
        "function clamp01(x) { return Math.min(1, Math.max(0, x)); }\n" +
        "function backOut(x) { var s = 1.70158; x = x - 1; return x * x * ((s + 1) * x + s) + 1; }\n" +
        "function easeOut(x) { return 1 - Math.pow(1 - x, 3); }\n" +
        "function pIn(delay) { return inOn ? clamp01((time - delay * dur) / dur) : 1; }\n" +
        "function pOut() { return outOn ? clamp01((thisComp.duration - fd - time) / (dur * 0.6)) : 1; }\n";

    // ＊ (全角) か * (半角) で挟んだ k 番目の区間の [開始, 終了] 文字番号
    function exEmphasis(k, which) {
        return EX_TXT +
            "var raw = txt(" + q("EDIT_本文") + ");\n" +
            "var segs = [], n = 0, open = -1;\n" +
            "for (var i = 0; i < raw.length; i++) {\n" +
            "  var ch = raw.charAt(i);\n" +
            "  if (ch == \"*\" || ch == \"＊\") {\n" +
            "    if (open < 0) { open = n; } else { segs.push([open, n]); open = -1; }\n" +
            "  } else { n++; }\n" +
            "}\n" +
            "if (open >= 0) { segs.push([open, n]); }\n" +
            "segs.length > " + k + " ? segs[" + k + "][" + which + "] : 0;";
    }

    var EX_RULE_TEXT = EX_TXT + "txt(" + q("EDIT_本文") + ").replace(/[*＊]/g, \"\");";

    function effectRef(name) {
        return "thisComp.layer(\"CTRL\").effect(" + q(name) + ")(1)";
    }

    // ------------------------------------------------------------------
    // ルールテロップ
    // ------------------------------------------------------------------

    function buildRuleTelop(folder) {
        var comp = app.project.items.addComp("ルールテロップ", CFG.width, CFG.height, 1, CFG.duration, CFG.fps);
        comp.parentFolder = folder;

        var W2 = RULE.w / 2;
        var H2 = RULE.h / 2;
        var inner = RULE.frame;

        // --- 骨組み (下から順に積む: addXxx は常に一番上に追加される) ---
        var rigBanner = addNull(comp, "RIG_帯", [RULE.cx, RULE.cy]);
        var rigLabel = addNull(comp, "RIG_ラベル", [RULE.cx - W2, RULE.cy - H2]);
        var rigText = addNull(comp, "RIG_文字", [RULE.cx, RULE.cy + RULE.textOffsetY]);

        // パネル (ミント地)
        var panel = addShapeLayer(comp, "BNR_パネル");
        addGroup(panel, "地");
        addRect(panel, "地", [RULE.w - 2 * inner, RULE.h - 2 * inner]);
        addFill(panel, "地", COLORS.mint);
        attach(panel, rigBanner, [0, 0]);
        expr(panel, groupPath("地", ["ADBE Vector Shape - Rect", "ADBE Vector Rect Size"]),
            EX_W + "[W - " + (2 * inner) + ", " + (RULE.h - 2 * inner) + "];");
        expr(panel, groupPath("地", ["ADBE Vector Graphic - Fill", "ADBE Vector Fill Color"]), effectRef("背景の色"));

        // 集中線: 細い扇形を 360° に並べて横に引き伸ばし、パネルの形で切り抜く
        var rays = addShapeLayer(comp, "BNR_集中線");
        addGroup(rays, "集中線");
        var R = 700;
        var half = (360 / RULE.rays) / 2 * Math.PI / 180;
        addPath(rays, "集中線", [[0, 0], [0, -R], [R * Math.sin(half), -R * Math.cos(half)]]);
        addFill(rays, "集中線", COLORS.mintRay);
        addRepeater(rays, "集中線", RULE.rays, [0, 0], 360 / RULE.rays);
        prop(rays, ["ADBE Root Vectors Group", "集中線", "ADBE Vector Transform Group", "ADBE Vector Scale"]).setValue([RULE.rayStretch, 100]);
        rays.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        attach(rays, rigBanner, [0, 0]);
        expr(rays, groupPath("集中線", ["ADBE Vector Graphic - Fill", "ADBE Vector Fill Color"]), effectRef("集中線の色"));
        expr(rays, ["ADBE Mask Parade", 1, "ADBE Mask Shape"],
            EX_W +
            "var w = W / 2 - " + inner + ", h = " + (H2 - inner) + ";\n" +
            "createPath([[-w, -h], [w, -h], [w, h], [-w, h]], [], [], true);");

        // 金枠: 外寸から内側へ 暗(0-2) 黄(2-6) 金(6-9) 明(9-11) 暗(11-13) の縞。
        // その下にパネルの縁の線と影 (集中線より上に来るようにこのレイヤーに入れる)
        var frame = addShapeLayer(comp, "BNR_フレーム");
        var bands = [
            // name, 外側からの中心位置, 太さ, 色, 色の式, 不透明度
            ["明", 10, 2, "#c2b062", "var a = " + effectRef("枠の色1") + ", b = " + effectRef("枠の色2") + ";\n[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 1];", 100],
            ["金", 7.5, 3, COLORS.frameGold, effectRef("枠の色2"), 100],
            ["黄", 4, 4, COLORS.frameYellow, effectRef("枠の色1"), 100],
            ["外枠", 6.5, 13, COLORS.frameDark, null, 100],
            ["内線", inner, 3, COLORS.panelLine, null, 100],
            ["内側の影", inner, 8, COLORS.panelShade, null, 40]
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

        // 四隅の鋲
        var rivets = addShapeLayer(comp, "BNR_リベット");
        var corners = [["左上", -1, -1], ["右上", 1, -1], ["左下", -1, 1], ["右下", 1, 1]];
        var k;
        for (k = 0; k < corners.length; k++) {
            addGroup(rivets, corners[k][0] + "_点");
            addRect(rivets, corners[k][0] + "_点", [5, 5]);
            addFill(rivets, corners[k][0] + "_点", "#222222");
        }
        for (k = 0; k < corners.length; k++) {
            addGroup(rivets, corners[k][0] + "_箱");
            addRect(rivets, corners[k][0] + "_箱", [13, 13]);
            addFill(rivets, corners[k][0] + "_箱", COLORS.rivet);
            addStroke(rivets, corners[k][0] + "_箱", COLORS.rivetLine, 2);
        }
        attach(rivets, rigBanner, [0, 0]);
        for (k = 0; k < corners.length; k++) {
            var cpos = EX_W + "[" + corners[k][1] + " * (W / 2 - 6.5), " + corners[k][2] + " * " + (H2 - 6.5) + "];";
            expr(rivets, ["ADBE Root Vectors Group", corners[k][0] + "_点", "ADBE Vector Transform Group", "ADBE Vector Position"], cpos);
            expr(rivets, ["ADBE Root Vectors Group", corners[k][0] + "_箱", "ADBE Vector Transform Group", "ADBE Vector Position"], cpos);
        }

        // --- ラベル (1文字1マス) ---
        var step = RULE.labelBoxW - RULE.labelBorder;
        var boxCx = RULE.labelBoxW / 2;
        var boxCy = -RULE.labelBoxH / 2;
        var labelVisible = effectRef("ラベル表示") + " * 100;";

        var boxes = addShapeLayer(comp, "LBL_箱");
        addGroup(boxes, "箱");
        addRect(boxes, "箱", [RULE.labelBoxW - RULE.labelBorder, RULE.labelBoxH - RULE.labelBorder], [boxCx, boxCy]);
        addFill(boxes, "箱", COLORS.white);
        addStroke(boxes, "箱", COLORS.labelLine, RULE.labelBorder);
        addRepeater(boxes, "箱", 3, [step, 0], 0);
        attach(boxes, rigLabel, [0, 0]);
        expr(boxes, groupPath("箱", ["ADBE Vector Filter - Repeater", "ADBE Vector Repeater Copies"]),
            EX_TXT + "Math.min(" + RULE.labelMax + ", txt(" + q("EDIT_ラベル") + ").length);");
        expr(boxes, ["ADBE Transform Group", "ADBE Opacity"], labelVisible);

        for (var i = RULE.labelMax - 1; i >= 0; i--) {
            var ch = addText(comp, "LBL_文字" + (i + 1), "ル", {
                font: CFG.fonts.label, size: RULE.labelFontSize, fill: COLORS.labelRed, tracking: 0
            });
            addAnimator(ch, "色", ["ADBE Text Fill Color"], false);
            attach(ch, rigLabel, [boxCx + step * i, boxCy]);
            transform(ch, "ADBE Anchor Point").setValue([0, -RULE.labelFontSize * CJK_CENTER]);
            expr(ch, ["ADBE Text Properties", "ADBE Text Document"],
                EX_TXT + "var s = txt(" + q("EDIT_ラベル") + ");\ns.length > " + i + " ? s.charAt(" + i + ") : \"\";");
            expr(ch, animatorPath("色", "ADBE Text Fill Color"), effectRef("ラベル文字の色"));
            expr(ch, ["ADBE Transform Group", "ADBE Opacity"], labelVisible);
        }

        // --- 本文 ---
        var textStyle = {
            font: CFG.fonts.rule, size: RULE.textFontSize, fill: COLORS.white, tracking: RULE.textTracking
        };
        var anchorY = -RULE.textFontSize * CJK_CENTER;

        // 押し出し影: 黒い複製を少しずつずらして重ねる
        for (var s = RULE.shadowCopies; s >= 1; s--) {
            var sh = addText(comp, "TXT_本文_影" + s, "レシートに書かれているモノは現物と交換可能", {
                font: CFG.fonts.rule, size: RULE.textFontSize, fill: COLORS.black, tracking: RULE.textTracking
            });
            addAnimator(sh, "色", ["ADBE Text Fill Color"], false);
            attach(sh, rigText, [0, 0]);
            expr(sh, ["ADBE Text Properties", "ADBE Text Document"], EX_RULE_TEXT);
            expr(sh, animatorPath("色", "ADBE Text Fill Color"), effectRef("影の色"));
            expr(sh, ["ADBE Transform Group", "ADBE Anchor Point"], "thisComp.layer(\"TXT_本文\").transform.anchorPoint;");
            expr(sh, ["ADBE Transform Group", "ADBE Scale"], "thisComp.layer(\"TXT_本文\").transform.scale;");
            expr(sh, ["ADBE Transform Group", "ADBE Position"],
                "var m = thisComp.layer(\"TXT_本文\");\n" +
                "var d = " + effectRef("影の距離") + " * " + s + " / " + RULE.shadowCopies + " * m.transform.scale[0] / 100;\n" +
                "var p = m.transform.position;\n" +
                "[p[0] + d, p[1] + d];");
        }

        var main = addText(comp, "TXT_本文", "レシートに書かれているモノは現物と交換可能", textStyle);
        addAnimator(main, "本文色", ["ADBE Text Fill Color"], false);
        for (k = 1; k <= 3; k++) {
            addAnimator(main, "強調" + k, ["ADBE Text Fill Color"], true);
        }
        attach(main, rigText, [0, 0]);
        expr(main, ["ADBE Text Properties", "ADBE Text Document"], EX_RULE_TEXT);
        expr(main, animatorPath("本文色", "ADBE Text Fill Color"), effectRef("本文の色"));
        for (k = 1; k <= 3; k++) {
            expr(main, animatorPath("強調" + k, "ADBE Text Fill Color"), effectRef("強調の色"));
            expr(main, selectorPath("強調" + k, "ADBE Text Index Start"), exEmphasis(k - 1, 0));
            expr(main, selectorPath("強調" + k, "ADBE Text Index End"), exEmphasis(k - 1, 1));
        }
        expr(main, ["ADBE Transform Group", "ADBE Anchor Point"],
            "var r = sourceRectAtTime(time, false);\n[r.left + r.width / 2, " + anchorY + "];");
        expr(main, ["ADBE Transform Group", "ADBE Scale"],
            EX_W +
            "var u = c.effect(\"文字サイズ\")(1) / 100;\n" +
            "var maxW = W - " + (2 * RULE.textPadding) + ";\n" +
            "var r = sourceRectAtTime(time, false);\n" +
            "var s = (r.width > 0 && r.width * u > maxW) ? maxW / r.width : u;\n" +
            "[s * 100, s * 100];");

        // --- 編集用 (非表示) ---
        var editLabel = addText(comp, "EDIT_ラベル", "ルール", {
            font: CFG.fonts.label, size: 40, fill: COLORS.white, tracking: 0
        });
        transform(editLabel, "ADBE Opacity").setValue(0);
        var editMain = addText(comp, "EDIT_本文", "レシートに書かれているモノは＊現物と交換可能＊", {
            font: CFG.fonts.rule, size: 40, fill: COLORS.white, tracking: 0
        });
        transform(editMain, "ADBE Opacity").setValue(0);

        // --- コントロール ---
        var ctrl = comp.layers.addNull();
        ctrl.name = "CTRL";
        addControl(ctrl, "color", "本文の色", COLORS.white);
        addControl(ctrl, "color", "強調の色", COLORS.red);
        addControl(ctrl, "color", "影の色", COLORS.black);
        addControl(ctrl, "slider", "影の距離", 11);
        addControl(ctrl, "slider", "文字サイズ", 100);
        addControl(ctrl, "color", "ラベル文字の色", COLORS.labelRed);
        addControl(ctrl, "checkbox", "ラベル表示", true);
        addControl(ctrl, "color", "背景の色", COLORS.mint);
        addControl(ctrl, "color", "集中線の色", COLORS.mintRay);
        addControl(ctrl, "color", "枠の色1", COLORS.frameYellow);
        addControl(ctrl, "color", "枠の色2", COLORS.frameGold);
        addControl(ctrl, "slider", "帯の幅", 100);
        addControl(ctrl, "checkbox", "INアニメ", true);
        addControl(ctrl, "checkbox", "OUTアニメ", false);
        addControl(ctrl, "slider", "アニメ時間", 9);

        // --- アニメーション (骨組みの拡大率を式で動かす) ---
        expr(rigBanner, ["ADBE Transform Group", "ADBE Scale"],
            EX_ANIM + "var p = pIn(0), o = pOut();\n[100 * backOut(p) * o, 100 * (0.7 + 0.3 * easeOut(p)) * o];");
        expr(rigLabel, ["ADBE Transform Group", "ADBE Position"],
            EX_W + "[" + RULE.cx + " - W / 2, " + (RULE.cy - H2) + "];");
        expr(rigLabel, ["ADBE Transform Group", "ADBE Scale"],
            EX_ANIM + "var s = 100 * backOut(pIn(0.33)) * pOut();\n[s, s];");
        expr(rigText, ["ADBE Transform Group", "ADBE Scale"],
            EX_ANIM + "var s = 100 * backOut(pIn(0.55)) * pOut();\n[s, s];");

        // --- Premiere に出す項目 (この順で並ぶ) ---
        exposeText(comp, editMain, "本文（＊で挟んだ部分が強調色）");
        exposeText(comp, editLabel, "ラベル");
        exposeEffect(comp, ctrl, "ラベル表示", "ラベルを表示");
        exposeEffect(comp, ctrl, "本文の色", "本文の色");
        exposeEffect(comp, ctrl, "強調の色", "強調の色");
        exposeEffect(comp, ctrl, "影の色", "影の色");
        exposeEffect(comp, ctrl, "影の距離", "影の距離 (px)");
        exposeEffect(comp, ctrl, "文字サイズ", "文字サイズ (%)");
        exposeEffect(comp, ctrl, "ラベル文字の色", "ラベル文字の色");
        exposeEffect(comp, ctrl, "背景の色", "帯の地の色");
        exposeEffect(comp, ctrl, "集中線の色", "集中線の色");
        exposeEffect(comp, ctrl, "枠の色1", "金枠の色（明）");
        exposeEffect(comp, ctrl, "枠の色2", "金枠の色（暗）");
        exposeEffect(comp, ctrl, "帯の幅", "帯の幅 (%)");
        exposeEffect(comp, ctrl, "INアニメ", "IN アニメーション");
        exposeEffect(comp, ctrl, "OUTアニメ", "OUT アニメーション");
        exposeEffect(comp, ctrl, "アニメ時間", "アニメーションの長さ (フレーム)");

        return { comp: comp, name: "ルールテロップ", inFrames: 20, outFrames: 10 };
    }

    // ------------------------------------------------------------------
    // セリフテロップ
    // ------------------------------------------------------------------

    function buildSpeechTelop(folder) {
        var comp = app.project.items.addComp("セリフテロップ", CFG.width, CFG.height, 1, CFG.duration, CFG.fps);
        comp.parentFolder = folder;

        var style = {
            font: CFG.fonts.speech, size: SPEECH.fontSize, tracking: SPEECH.tracking,
            fill: COLORS.white, stroke: COLORS.black, strokeWidth: SPEECH.stroke
        };
        var leading = SPEECH.fontSize * 1.2; // 自動行送り (120%)
        var anchorY = -SPEECH.fontSize * CJK_CENTER;

        var glow = addText(comp, "TXT_セリフ_影", "ちょっとだいぶ歩ったからなぁ", {
            font: CFG.fonts.speech, size: SPEECH.fontSize, tracking: SPEECH.tracking,
            fill: COLORS.black, stroke: COLORS.black, strokeWidth: SPEECH.stroke + 4
        });
        addAnimator(glow, "色", ["ADBE Text Fill Color", "ADBE Text Stroke Color", "ADBE Text Stroke Width"], false);
        var blur = glow.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
        blur.property(1).setValue(8);
        blur.property(3).setValue(0); // エッジピクセルを繰り返さない

        var line = addText(comp, "TXT_セリフ", "ちょっとだいぶ歩ったからなぁ", style);
        addAnimator(line, "色", ["ADBE Text Fill Color", "ADBE Text Stroke Color", "ADBE Text Stroke Width"], false);
        transform(line, "ADBE Position").setValue([SPEECH.x, SPEECH.y]);

        var ctrl = comp.layers.addNull();
        ctrl.name = "CTRL";
        addControl(ctrl, "color", "文字の色", COLORS.white);
        addControl(ctrl, "color", "フチの色", COLORS.black);
        addControl(ctrl, "slider", "フチの太さ", SPEECH.stroke);
        addControl(ctrl, "color", "影の色", COLORS.black);
        addControl(ctrl, "slider", "影のぼかし", 8);
        addControl(ctrl, "slider", "影の濃さ", 85);
        addControl(ctrl, "slider", "文字サイズ", 100);
        addControl(ctrl, "checkbox", "INアニメ", true);
        addControl(ctrl, "checkbox", "OUTアニメ", false);
        addControl(ctrl, "slider", "アニメ時間", 4);

        expr(line, animatorPath("色", "ADBE Text Fill Color"), effectRef("文字の色"));
        expr(line, animatorPath("色", "ADBE Text Stroke Color"), effectRef("フチの色"));
        expr(line, animatorPath("色", "ADBE Text Stroke Width"), effectRef("フチの太さ"));
        expr(line, ["ADBE Transform Group", "ADBE Anchor Point"],
            EX_TXT +
            "var lines = txt(\"TXT_セリフ\").split(/\\r\\n|\\r|\\n/).length;\n" +
            "var r = sourceRectAtTime(time, false);\n" +
            "[r.left + r.width / 2, (lines - 1) * " + leading + " + " + anchorY + "];");
        expr(line, ["ADBE Transform Group", "ADBE Scale"],
            EX_ANIM +
            "var u = c.effect(\"文字サイズ\")(1);\n" +
            "var s = u * (1 + 0.3 * (1 - easeOut(pIn(0)))) * (0.6 + 0.4 * pOut());\n" +
            "[s, s];");
        expr(line, ["ADBE Transform Group", "ADBE Opacity"],
            EX_ANIM + "100 * easeOut(pIn(0)) * pOut();");

        expr(glow, ["ADBE Text Properties", "ADBE Text Document"], EX_TXT + "txt(\"TXT_セリフ\");");
        expr(glow, animatorPath("色", "ADBE Text Fill Color"), effectRef("影の色"));
        expr(glow, animatorPath("色", "ADBE Text Stroke Color"), effectRef("影の色"));
        expr(glow, animatorPath("色", "ADBE Text Stroke Width"), effectRef("フチの太さ") + " + 4;");
        expr(glow, ["ADBE Effect Parade", 1, 1], effectRef("影のぼかし"));
        expr(glow, ["ADBE Transform Group", "ADBE Anchor Point"], "thisComp.layer(\"TXT_セリフ\").transform.anchorPoint;");
        expr(glow, ["ADBE Transform Group", "ADBE Scale"], "thisComp.layer(\"TXT_セリフ\").transform.scale;");
        expr(glow, ["ADBE Transform Group", "ADBE Position"],
            "var p = thisComp.layer(\"TXT_セリフ\").transform.position;\n[p[0], p[1] + 3];");
        expr(glow, ["ADBE Transform Group", "ADBE Opacity"],
            "thisComp.layer(\"TXT_セリフ\").transform.opacity * " + effectRef("影の濃さ") + " / 100;");

        exposeText(comp, line, "セリフ");
        exposeEffect(comp, ctrl, "文字の色", "文字の色");
        exposeEffect(comp, ctrl, "フチの色", "フチの色");
        exposeEffect(comp, ctrl, "フチの太さ", "フチの太さ");
        exposeEffect(comp, ctrl, "影の色", "影の色");
        exposeEffect(comp, ctrl, "影のぼかし", "影のぼかし");
        exposeEffect(comp, ctrl, "影の濃さ", "影の濃さ (%)");
        exposeEffect(comp, ctrl, "文字サイズ", "文字サイズ (%)");
        exposeEffect(comp, ctrl, "INアニメ", "IN アニメーション");
        exposeEffect(comp, ctrl, "OUTアニメ", "OUT アニメーション");
        exposeEffect(comp, ctrl, "アニメ時間", "アニメーションの長さ (フレーム)");

        return { comp: comp, name: "セリフテロップ", inFrames: 10, outFrames: 6 };
    }

    // ------------------------------------------------------------------
    // 仕上げ
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
                exprErrors.push(x.comp.name + ": " + x.label + " をエッセンシャルグラフィックスに追加できません");
                continue;
            }
            p.addToMotionGraphicsTemplateAs(x.comp, x.label);
        }
    }

    // Premiere で尺を伸ばしても IN / OUT の動きが崩れないよう保護領域を置く
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
            // 古い版では無い。書き出しには影響しない
        }
        if (!folder) {
            // 保存先を選ばなかったときは Premiere の「ローカルテンプレートフォルダー」へ
            return t.comp.exportAsMotionGraphicsTemplate(true) ? t.name + "（ローカルテンプレートフォルダー）" : null;
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
            alert("After Effects 2020 以降で実行してください。（今のバージョン: " + app.version + "）");
            return;
        }

        app.beginUndoGroup("テロップテンプレート作成");
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
            alert("作成中にエラーが出ました:\n" + err.toString() + (err.line ? "\n(行 " + err.line + ")" : ""));
            return;
        }
        app.endUndoGroup();

        var report = ["テロップのコンポジションを作りました。"];
        if (missingFonts.length) {
            report.push("", "見つからないフォント（インストールしてから実行し直してください）:", "  " + missingFonts.join("\n  "));
        }
        if (exprErrors.length) {
            report.push("", "エクスプレッションのエラー:", "  " + exprErrors.join("\n  "));
        }

        var outFolder = Folder.selectDialog(".mogrt の保存先フォルダーを選んでください\n（キャンセルすると Premiere のローカルテンプレートフォルダーに保存します）");
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
            report.push("", "書き出した .mogrt:", "  " + saved.join("\n  "));
        }
        if (failed.length) {
            report.push("", "書き出せなかったもの: " + failed.join("、"),
                "→ エッセンシャルグラフィックスパネルの「モーショングラフィックステンプレートを書き出し」から手動で書き出せます。");
        }
        alert(report.join("\n"));
    }

    main();
}());
