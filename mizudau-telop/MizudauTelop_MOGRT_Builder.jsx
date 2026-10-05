/*
 * 水ダウ風テロップ MOGRT ジェネレーター
 * =====================================================================
 * After Effects でこのスクリプトを実行すると、水曜日のダウンタウン風の
 * テロップ 4 種類を組み立て、Premiere Pro 用の
 * モーショングラフィックステンプレート（.mogrt）として書き出します。
 *
 *   1. 水ダウ風_地名＋日数        … 「三重県木曽岬町」＋「7日目」
 *   2. 水ダウ風_黄色デカ文字ズーム … 「目標の100枚達成」
 *   3. 水ダウ風_青グロー2段        … 「ベーゴマ職人の数は‥」＋「7人のみ」
 *   4. 水ダウ風_ランキングボード    … 「絶滅危惧アイテム⑤ そろばん」＋「7社」
 *
 * 使い方
 *   After Effects >［ファイル］>［スクリプト］>［スクリプトファイルを実行...］
 *   → このファイルを選ぶ → 保存先フォルダを選ぶ
 *   → .mogrt 8 つ（効果音なし 4 つ ＋「（効果音あり）」4 つ）と、編集用の .aep が保存されます。
 *   ※ 効果音は、このスクリプトと同じフォルダの se/単体/ にある WAV を使います。
 *
 * 動作環境: After Effects 2020 (17.0) 以降（2022 以降推奨）
 *
 * 文字・色・位置・大きさ・書体・アニメーションのタイミングは、
 * Premiere Pro のエッセンシャルグラフィックスパネルからすべて変更できます。
 */

(function MizudauTelopBuilder() {
    var TITLE = "水ダウ風テロップ MOGRT ジェネレーター";
    var FPS = 29.97;
    var COMP_W = 1920;
    var COMP_H = 1080;

    if (parseFloat(app.version) < 17.0) {
        alert(TITLE + "\n\nこのスクリプトには After Effects 2020 (17.0) 以降が必要です。");
        return;
    }

    var LOG = [];
    function log(msg) { LOG.push(msg); }

    // =================================================================
    // 汎用ヘルパー
    // =================================================================

    function hex(h) {
        h = h.replace("#", "");
        return [
            parseInt(h.substr(0, 2), 16) / 255,
            parseInt(h.substr(2, 2), 16) / 255,
            parseInt(h.substr(4, 2), 16) / 255
        ];
    }

    function jsStr(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    function jsArr(arr) {
        var out = [];
        for (var i = 0; i < arr.length; i++) out.push(jsStr(arr[i]));
        return "[" + out.join(", ") + "]";
    }

    // =================================================================
    // フォント
    //   Premiere 側でドロップダウンから書体を切り替えられるようにする。
    //   インストールされている書体だけをメニューに並べる。
    // =================================================================

    var FONT_CANDIDATES = [
        { label: "見出ミンMA31",     ps: "MidashiMinPr6N-MA31", role: "minchoHeavy" },
        { label: "小塚明朝 H",       ps: "KozMinPr6N-Heavy",    role: "minchoHeavy" },
        { label: "ヒラギノ明朝 W6",  ps: "HiraMinProN-W6",      role: "minchoHeavy", mac: true },
        { label: "游明朝体 Demibold", ps: "YuMin-Demibold",     role: "minchoHeavy" },
        { label: "游明朝 Demibold",  ps: "YuMincho-Demibold",   role: "minchoHeavy", win: true },
        { label: "ヒラギノ明朝 W3",  ps: "HiraMinProN-W3",      role: "minchoLight", mac: true },
        { label: "小塚明朝 R",       ps: "KozMinPr6N-Regular",  role: "minchoLight" },
        { label: "游明朝 Regular",   ps: "YuMincho-Regular",    role: "minchoLight", win: true },
        { label: "見出ゴMB31",       ps: "MidashiGoPr6N-MB31",  role: "gothicHeavy" },
        { label: "ヒラギノ角ゴ W9",  ps: "HiraginoSans-W9",     role: "gothicHeavy", mac: true },
        { label: "小塚ゴシック H",   ps: "KozGoPr6N-Heavy",     role: "gothicHeavy" },
        { label: "ヒラギノ角ゴ W6",  ps: "HiraginoSans-W6",     role: "gothicHeavy", mac: true },
        { label: "游ゴシック体 Bold", ps: "YuGo-Bold",          role: "gothicHeavy" },
        { label: "游ゴシック Bold",  ps: "YuGothic-Bold",       role: "gothicHeavy", win: true },
        { label: "メイリオ Bold",    ps: "Meiryo-Bold",         role: "gothicHeavy", win: true },
        { label: "ヒラギノ丸ゴ W4",  ps: "HiraMaruProN-W4",     role: "other",       mac: true }
    ];

    var IS_MAC = ($.os.toLowerCase().indexOf("mac") >= 0);

    function fontApiAvailable() {
        try {
            return !!(app.fonts && app.fonts.getFontsByPostScriptName);
        } catch (e) {
            return false;
        }
    }

    function fontInstalled(ps) {
        try {
            var found = app.fonts.getFontsByPostScriptName(ps);
            return !!(found && found.length > 0);
        } catch (e) {
            return false;
        }
    }

    function buildFontList() {
        var list = [];
        var useApi = fontApiAvailable();
        for (var i = 0; i < FONT_CANDIDATES.length; i++) {
            var f = FONT_CANDIDATES[i];
            // AE 2024 以降はインストール済みかを直接確認。それより古い AE では OS 標準の書体だけ使う。
            var ok = useApi ? fontInstalled(f.ps) : (IS_MAC ? f.mac === true : f.win === true);
            if (ok) list.push(f);
        }
        if (list.length === 0) {
            list.push(IS_MAC
                ? { label: "ヒラギノ角ゴ W6", ps: "HiraginoSans-W6", role: "gothicHeavy" }
                : { label: "メイリオ Bold", ps: "Meiryo-Bold", role: "gothicHeavy" });
            log("対応する書体が見つからなかったため、OS 標準の書体だけを使います。");
        }
        return list;
    }

    var FONTS = buildFontList();
    var FONT_LABELS = [];
    var FONT_PS = [];
    for (var fi = 0; fi < FONTS.length; fi++) {
        FONT_LABELS.push(FONTS[fi].label);
        FONT_PS.push(FONTS[fi].ps);
    }

    // 役割の優先順で最初に見つかった書体（1 始まりのメニュー番号）
    function pickFont(roles) {
        for (var r = 0; r < roles.length; r++) {
            for (var i = 0; i < FONTS.length; i++) {
                if (FONTS[i].role === roles[r]) return i + 1;
            }
        }
        return 1;
    }

    function fontPsAt(menuIndex) {
        return FONT_PS[menuIndex - 1];
    }

    // =================================================================
    // レイヤー・エフェクト作成
    // =================================================================

    function newComp(name, duration, folder) {
        var comp = app.project.items.addComp(name, COMP_W, COMP_H, 1.0, duration, FPS);
        comp.parentFolder = folder;
        comp.bgColor = [0.18, 0.18, 0.18];
        return comp;
    }

    function tr(layer, matchName) {
        return layer.property("ADBE Transform Group").property(matchName);
    }

    function addNullLayer(comp, name) {
        var n = comp.layers.addNull();
        n.name = name;
        tr(n, "ADBE Anchor Point").setValue([0, 0]);
        tr(n, "ADBE Position").setValue([0, 0]);
        return n;
    }

    function addFx(layer, matchName, name) {
        var fx = layer.property("ADBE Effect Parade").addProperty(matchName);
        if (name) fx.name = name;
        return fx;
    }

    function fxProp(layer, fxName, index) {
        return layer.property("ADBE Effect Parade").property(fxName).property(index);
    }

    // --- エクスプレッション制御（CTRL ヌルに付ける） ---

    function ctlSlider(ctrl, name, v) {
        addFx(ctrl, "ADBE Slider Control", name).property(1).setValue(v);
    }

    function ctlColor(ctrl, name, rgb) {
        addFx(ctrl, "ADBE Color Control", name).property(1).setValue([rgb[0], rgb[1], rgb[2], 1]);
    }

    function ctlCheck(ctrl, name, on) {
        addFx(ctrl, "ADBE Checkbox Control", name).property(1).setValue(on ? 1 : 0);
    }

    function ctlPoint(ctrl, name, xy) {
        addFx(ctrl, "ADBE Point Control", name).property(1).setValue(xy);
    }

    function ctlDropdown(ctrl, name, items, v) {
        var parade = ctrl.property("ADBE Effect Parade");
        var fx = parade.addProperty("ADBE Dropdown Control");
        var menu = fx.property(1).setPropertyParameters(items);
        menu.setValue(v);
        // setPropertyParameters 後は元のエフェクト参照が無効になることがあるため取り直して命名
        parade.property(parade.numProperties).name = name;
    }

    // --- テキストレイヤー ---

    var JUSTIFY = {
        left: ParagraphJustification.LEFT_JUSTIFY,
        center: ParagraphJustification.CENTER_JUSTIFY,
        right: ParagraphJustification.RIGHT_JUSTIFY
    };

    function addTextLayer(comp, name, str, o) {
        var layer = comp.layers.addText(str);
        layer.name = name;
        var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var td = prop.value;
        try { td.resetCharStyle(); } catch (e1) {}
        try { td.resetParagraphStyle(); } catch (e2) {}
        try { td.font = o.font; } catch (e3) { log(name + ": 書体 " + o.font + " を設定できませんでした"); }
        td.fontSize = o.size;
        td.applyFill = true;
        td.fillColor = o.fill;
        if (o.strokeWidth > 0) {
            td.applyStroke = true;
            td.strokeColor = o.stroke;
            td.strokeWidth = o.strokeWidth;
            td.strokeOverFill = false;   // フチは文字の後ろ
        } else {
            td.applyStroke = false;
        }
        td.tracking = o.tracking || 0;
        td.justification = JUSTIFY[o.justify || "left"];
        td.text = str;
        prop.setValue(td);
        return layer;
    }

    function sourceText(layer) {
        return layer.property("ADBE Text Properties").property("ADBE Text Document");
    }

    // --- シェイプレイヤー（位置 0,0 / アンカー 0,0 → 中身の座標 = 親の座標） ---

    function addShapeLayer(comp, name) {
        var s = comp.layers.addShape();
        s.name = name;
        tr(s, "ADBE Anchor Point").setValue([0, 0]);
        tr(s, "ADBE Position").setValue([0, 0]);
        return s;
    }

    // rects: [[w, h, x, y], ...]  複数の長方形に 1 つの塗りを共有させる
    function addRectGroup(shapeLayer, groupName, rects, rgb) {
        var contents = shapeLayer.property("ADBE Root Vectors Group");
        var grp = contents.addProperty("ADBE Vector Group");
        grp.name = groupName;
        var vecs = grp.property("ADBE Vectors Group");
        for (var i = 0; i < rects.length; i++) {
            var rect = vecs.addProperty("ADBE Vector Shape - Rect");
            rect.property("ADBE Vector Rect Size").setValue([rects[i][0], rects[i][1]]);
            rect.property("ADBE Vector Rect Position").setValue([rects[i][2], rects[i][3]]);
        }
        var fill = vecs.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue([rgb[0], rgb[1], rgb[2], 1]);
    }

    function shapeGroup(shapeLayer, groupName) {
        return shapeLayer.property("ADBE Root Vectors Group").property(groupName);
    }

    function rectSize(shapeLayer, groupName) {
        return shapeGroup(shapeLayer, groupName).property("ADBE Vectors Group")
            .property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size");
    }

    function rectPos(shapeLayer, groupName) {
        return shapeGroup(shapeLayer, groupName).property("ADBE Vectors Group")
            .property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Position");
    }

    function fillColor(shapeLayer, groupName) {
        return shapeGroup(shapeLayer, groupName).property("ADBE Vectors Group")
            .property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color");
    }

    function groupOpacity(shapeLayer, groupName) {
        return shapeGroup(shapeLayer, groupName).property("ADBE Vector Transform Group")
            .property("ADBE Vector Group Opacity");
    }

    // --- エフェクト ---

    // ドロップシャドウ。不透明度の内部値が 0〜255 の場合に備え、倍率を返す。
    function addDropShadow(layer, name, rgb, opacityPct, distance, softness) {
        var fx = addFx(layer, "ADBE Drop Shadow", name);
        var opacity = fx.property(2);
        var scale = 1;
        try {
            if (opacity.hasMax && opacity.maxValue > 100) scale = opacity.maxValue / 100;
        } catch (e) {}
        fx.property(1).setValue([rgb[0], rgb[1], rgb[2], 1]);
        opacity.setValue(opacityPct * scale);
        fx.property(3).setValue(135);
        fx.property(4).setValue(distance);
        fx.property(5).setValue(softness);
        return scale;
    }

    function addDirectionalBlur(layer, name) {
        var fx = addFx(layer, "ADBE Motion Blur", name);
        fx.property(1).setValue(90);   // 90° = 横方向
        fx.property(2).setValue(0);
    }

    function addGaussianBlur(layer, name, amount, dimension) {
        var fx = addFx(layer, "ADBE Gaussian Blur 2", name);
        fx.property(1).setValue(amount);
        fx.property(2).setValue(dimension);   // 1: 水平・垂直 / 2: 水平 / 3: 垂直
    }

    function setExpr(prop, expr) {
        prop.expression = expr;
    }

    // --- エッセンシャルグラフィックス ---

    function egp(comp, prop, label) {
        try {
            if (prop.canAddToMotionGraphicsTemplate(comp)) {
                prop.addToMotionGraphicsTemplateAs(comp, label);
            } else {
                log(comp.name + ": 「" + label + "」をエッセンシャルグラフィックスに追加できませんでした");
            }
        } catch (e) {
            log(comp.name + ": 「" + label + "」の追加でエラー: " + e.toString());
        }
    }

    function egpCtl(comp, ctrl, fxName, label) {
        egp(comp, fxProp(ctrl, fxName, 1), label);
    }

    function egpText(comp, layer, label) {
        egp(comp, sourceText(layer), label);
    }

    // Premiere でクリップの長さを変えても登場アニメの速さが変わらないよう、冒頭を保護する
    function protectIntro(comp, seconds) {
        try {
            var mv = new MarkerValue("登場アニメ（保護）");
            mv.duration = seconds;
            mv.protectedRegion = true;
            comp.markerProperty.setValueAtTime(0, mv);
        } catch (e) {
            log(comp.name + ": 保護領域を設定できませんでした（" + e.toString() + "）");
        }
    }

    // =================================================================
    // エクスプレッション部品
    // =================================================================

    var HEAD = 'var C = thisComp.layer("CTRL");\nvar fd = thisComp.frameDuration;\n';

    function E(name) {
        return 'C.effect("' + name + '")(1)';
    }

    // 大きさスライダー（50 = 100%）。0 にしても計算が壊れないよう下限を付ける
    function sizeVar(ctl) {
        return "var s = Math.max(0.02, " + E(ctl) + " / 50);\n";
    }

    // ソーステキスト用: 大きさ・色・フチ・書体を CTRL から反映
    //   o.size        基準の文字サイズ(px)
    //   o.sizeCtl     大きさスライダー名（50 = 基準）。省略時は固定サイズ
    //   o.pre         追加の変数定義
    //   o.fill        塗り色の式（[r,g,b,...]）
    //   o.stroke      フチ色の式（省略可）
    //   o.strokeWidth フチ幅の式
    //   o.fontCtl     書体ドロップダウン名
    function styleExpr(o) {
        var x = HEAD + (o.sizeCtl ? sizeVar(o.sizeCtl) : "var s = 1;\n");
        if (o.pre) x += o.pre;
        x += "var st = text.sourceText.style;\n";
        x += "st = st.setFontSize(Math.max(1, " + o.size + " * s));\n";
        x += "var fc = " + o.fill + ";\n";
        x += "st = st.setFillColor([fc[0], fc[1], fc[2]]);\n";
        if (o.stroke) {
            x += "var sc = " + o.stroke + ";\n";
            x += "st = st.setStrokeColor([sc[0], sc[1], sc[2]]);\n";
            x += "st = st.setStrokeWidth(Math.max(0.1, " + o.strokeWidth + "));\n";
        }
        x += "var FONTS = " + jsArr(FONT_PS) + ";\n";
        x += "var fi = Math.round(" + E(o.fontCtl) + ") - 1;\n";
        x += "if (fi >= 0 && fi < FONTS.length) { st = st.setFont(FONTS[fi]); }\n";
        x += "st;";
        return x;
    }

    // 文字の実寸（インク）基準のアンカー
    function anchorExpr(fx, fy) {
        return "var r = sourceRectAtTime(time, false);\n" +
            "[r.left + r.width * " + fx + ", r.top + r.height * " + fy + "];";
    }

    // --- 共通の「登場アニメ」（テンプレート 1・2） ---
    //   IN_Type: 1 カット / 2 横ブラーイン / 3 フェードイン
    var IN_ITEMS = ["カット（アニメなし）", "横ブラーイン", "フェードイン"];

    function inVars() {
        return "var typ = Math.round(" + E("IN_Type") + ");\n" +
            "var nIn = Math.max(1, " + E("IN_Frames") + ");\n" +
            "var pIn = clamp(time / fd / nIn, 0, 1);\n";
    }

    function inOpacityExpr(showExpr) {
        return HEAD + inVars() +
            "var op = 100;\n" +
            "if (typ == 2) { op = linear(pIn, 0, 0.4, 0, 100); }\n" +
            "if (typ == 3) { op = 100 * pIn; }\n" +
            "op * (" + showExpr + ");";
    }

    function inBlurExpr() {
        return HEAD + inVars() +
            "(typ == 2) ? " + E("IN_Blur") + " * 6 * Math.pow(1 - pIn, 2) : 0;";
    }

    function addInControls(C) {
        ctlDropdown(C, "IN_Type", IN_ITEMS, 1);
        ctlSlider(C, "IN_Frames", 8);
        ctlSlider(C, "IN_Blur", 50);
    }

    function applyInAnim(layer, showExpr) {
        setExpr(tr(layer, "ADBE Opacity"), inOpacityExpr(showExpr));
        setExpr(fxProp(layer, "InBlur", 2), inBlurExpr());
    }

    // =================================================================
    // 1. 地名＋日数（三重県木曽岬町 / 7日目）
    // =================================================================

    function buildLocation(folder) {
        var comp = newComp("水ダウ風_地名＋日数", 5, folder);
        var C = addNullLayer(comp, "CTRL");

        addInControls(C);
        ctlCheck(C, "Loc_Show", true);
        ctlPoint(C, "Loc_Pos", [48, 1036]);
        ctlSlider(C, "Loc_Size", 50);
        ctlDropdown(C, "Loc_Font", FONT_LABELS, pickFont(["minchoHeavy", "minchoLight", "gothicHeavy"]));
        ctlColor(C, "Loc_Fill", hex("FFFFFF"));
        ctlColor(C, "Loc_Stroke", hex("000000"));
        ctlSlider(C, "Loc_StrokeW", 8);
        ctlColor(C, "Loc_Shadow", hex("000000"));
        ctlCheck(C, "Line_Show", true);
        ctlColor(C, "Line_Color", hex("D7000F"));
        ctlSlider(C, "Line_Extend", 40);
        ctlCheck(C, "Day_Show", true);
        ctlPoint(C, "Day_Pos", [1868, 1052]);
        ctlSlider(C, "Day_Size", 50);
        ctlSlider(C, "Day_HScale", 90);
        ctlDropdown(C, "Day_Font", FONT_LABELS, pickFont(["gothicHeavy"]));
        ctlColor(C, "Day_Fill", hex("FAD40C"));
        ctlColor(C, "Day_Box", hex("111011"));
        ctlSlider(C, "Day_BoxOpacity", 100);

        // --- レイヤー（下から順に作成） ---
        var line = addShapeLayer(comp, "LOC_LINE");
        addRectGroup(line, "Line", [[760, 8, 300, 1050]], hex("D7000F"));
        addGaussianBlur(line, "Fade", 18, 2);
        addDirectionalBlur(line, "InBlur");

        var loc = addTextLayer(comp, "LOC_TEXT", "三重県木曽岬町", {
            font: fontPsAt(pickFont(["minchoHeavy", "minchoLight", "gothicHeavy"])),
            size: 92, fill: [1, 1, 1], stroke: [0, 0, 0], strokeWidth: 8, justify: "left"
        });
        tr(loc, "ADBE Position").setValue([48, 1036]);
        addDropShadow(loc, "Shadow", [0, 0, 0], 85, 6, 4);
        addDirectionalBlur(loc, "InBlur");

        var dayBox = addShapeLayer(comp, "DAY_BOX");
        addRectGroup(dayBox, "Box", [[395, 155, 1670, 975]], hex("111011"));
        addDirectionalBlur(dayBox, "InBlur");

        var day = addTextLayer(comp, "DAY_TEXT", "7日目", {
            font: fontPsAt(pickFont(["gothicHeavy"])),
            size: 135, fill: hex("FAD40C"), strokeWidth: 0, justify: "right"
        });
        tr(day, "ADBE Position").setValue([1841, 1039]);
        addDirectionalBlur(day, "InBlur");

        // --- エクスプレッション ---
        // 地名
        setExpr(sourceText(loc), styleExpr({
            size: 92, sizeCtl: "Loc_Size", fontCtl: "Loc_Font",
            fill: E("Loc_Fill"), stroke: E("Loc_Stroke"), strokeWidth: E("Loc_StrokeW") + " * s"
        }));
        setExpr(tr(loc, "ADBE Position"), HEAD + E("Loc_Pos") + ";");
        setExpr(fxProp(loc, "Shadow", 1), HEAD + E("Loc_Shadow") + ";");
        setExpr(fxProp(loc, "Shadow", 4), HEAD + sizeVar("Loc_Size") + "6 * s;");
        setExpr(fxProp(loc, "Shadow", 5), HEAD + sizeVar("Loc_Size") + "4 * s;");
        applyInAnim(loc, E("Loc_Show"));

        // 赤ライン（地名の右端 + 延長分まで。右端は横ブラーでフェード）
        var lineGeo = HEAD + sizeVar("Loc_Size") +
            'var L = thisComp.layer("LOC_TEXT");\n' +
            "var r = L.sourceRectAtTime(time, false);\n" +
            "var b = L.toComp([r.left + r.width, r.top + r.height]);\n" +
            "var x0 = -80;\n" +
            "var x1 = b[0] + " + E("Line_Extend") + " * s;\n";
        setExpr(rectSize(line, "Line"), lineGeo + "[Math.max(1, x1 - x0), 8 * s];");
        setExpr(rectPos(line, "Line"), lineGeo + "[(x0 + x1) / 2, b[1] + 6 * s];");
        setExpr(fillColor(line, "Line"), HEAD + E("Line_Color") + ";");
        setExpr(fxProp(line, "Fade", 1), HEAD + sizeVar("Loc_Size") + "18 * s;");
        applyInAnim(line, E("Loc_Show") + " * " + E("Line_Show"));

        // 日数（右下の点 = 黒箱の右下の角）
        setExpr(sourceText(day), styleExpr({
            size: 135, sizeCtl: "Day_Size", fontCtl: "Day_Font", fill: E("Day_Fill")
        }));
        setExpr(tr(day, "ADBE Anchor Point"), anchorExpr(1, 1));
        setExpr(tr(day, "ADBE Position"), HEAD + sizeVar("Day_Size") +
            "var p = " + E("Day_Pos") + ";\n[p[0] - 27 * s, p[1] - 13 * s];");
        setExpr(tr(day, "ADBE Scale"), HEAD + "[" + E("Day_HScale") + ", 100];");
        applyInAnim(day, E("Day_Show"));

        var boxGeo = HEAD + sizeVar("Day_Size") +
            'var L = thisComp.layer("DAY_TEXT");\n' +
            "var r = L.sourceRectAtTime(time, false);\n" +
            "var a = L.toComp([r.left, r.top]);\n" +
            "var b = L.toComp([r.left + r.width, r.top + r.height]);\n" +
            "var pl = 32 * s, pr = 27 * s, pt = 16 * s, pb = 13 * s;\n";
        setExpr(rectSize(dayBox, "Box"), boxGeo + "[(b[0] - a[0]) + pl + pr, (b[1] - a[1]) + pt + pb];");
        setExpr(rectPos(dayBox, "Box"), boxGeo + "[(a[0] - pl + b[0] + pr) / 2, (a[1] - pt + b[1] + pb) / 2];");
        setExpr(fillColor(dayBox, "Box"), HEAD + E("Day_Box") + ";");
        setExpr(groupOpacity(dayBox, "Box"), HEAD + E("Day_BoxOpacity") + ";");
        applyInAnim(dayBox, E("Day_Show"));

        C.moveToBeginning();
        protectIntro(comp, 1.0);

        // --- エッセンシャルグラフィックス（Premiere に出る項目と順番） ---
        egpText(comp, loc, "地名テキスト");
        egpText(comp, day, "日数テキスト");
        egpCtl(comp, C, "IN_Type", "登場アニメ");
        egpCtl(comp, C, "IN_Frames", "登場アニメの長さ（フレーム）");
        egpCtl(comp, C, "IN_Blur", "横ブラーの強さ");
        egpCtl(comp, C, "Loc_Show", "地名を表示");
        egpCtl(comp, C, "Loc_Pos", "地名の位置（左下の基準点）");
        egpCtl(comp, C, "Loc_Size", "地名の大きさ（50=標準）");
        egpCtl(comp, C, "Loc_Font", "地名の書体");
        egpCtl(comp, C, "Loc_Fill", "地名の文字色");
        egpCtl(comp, C, "Loc_Stroke", "地名のフチ色");
        egpCtl(comp, C, "Loc_StrokeW", "地名のフチの太さ");
        egpCtl(comp, C, "Loc_Shadow", "地名の影の色");
        egpCtl(comp, C, "Line_Show", "下線を表示");
        egpCtl(comp, C, "Line_Color", "下線の色");
        egpCtl(comp, C, "Line_Extend", "下線のはみ出し（px）");
        egpCtl(comp, C, "Day_Show", "日数を表示");
        egpCtl(comp, C, "Day_Pos", "日数の位置（箱の右下）");
        egpCtl(comp, C, "Day_Size", "日数の大きさ（50=標準）");
        egpCtl(comp, C, "Day_HScale", "日数の横幅（%）");
        egpCtl(comp, C, "Day_Font", "日数の書体");
        egpCtl(comp, C, "Day_Fill", "日数の文字色");
        egpCtl(comp, C, "Day_Box", "日数の箱の色");
        egpCtl(comp, C, "Day_BoxOpacity", "日数の箱の不透明度");

        comp.motionGraphicsTemplateName = "水ダウ風_地名＋日数";
        comp.time = 2;
        return comp;
    }

    // =================================================================
    // 2. 黄色デカ文字ズーム（目標の100枚達成）
    // =================================================================

    function buildGoldZoom(folder) {
        var comp = newComp("水ダウ風_黄色デカ文字ズーム", 5, folder);
        var C = addNullLayer(comp, "CTRL");

        addInControls(C);
        ctlSlider(C, "Zoom", 3);
        ctlPoint(C, "Main_Pos", [960, 942]);
        ctlSlider(C, "Main_Size", 50);
        ctlDropdown(C, "Main_Font", FONT_LABELS, pickFont(["minchoHeavy", "gothicHeavy"]));
        ctlColor(C, "Main_Fill", hex("F1CA0D"));
        ctlColor(C, "Main_Stroke", hex("2B1D00"));
        ctlSlider(C, "Main_StrokeW", 3);
        ctlColor(C, "Main_Shadow", hex("000000"));
        ctlSlider(C, "Main_ShadowAmt", 65);

        var main = addTextLayer(comp, "MAIN_TEXT", "目標の100枚達成", {
            font: fontPsAt(pickFont(["minchoHeavy", "gothicHeavy"])),
            size: 235, fill: hex("F1CA0D"), stroke: hex("2B1D00"), strokeWidth: 3,
            tracking: -20, justify: "center"
        });
        tr(main, "ADBE Position").setValue([960, 942]);
        var shadeScale = addDropShadow(main, "Shade", [0, 0, 0], 65, 0, 40);
        addDirectionalBlur(main, "InBlur");

        setExpr(sourceText(main), styleExpr({
            size: 235, sizeCtl: "Main_Size", fontCtl: "Main_Font",
            fill: E("Main_Fill"), stroke: E("Main_Stroke"), strokeWidth: E("Main_StrokeW") + " * s"
        }));
        setExpr(tr(main, "ADBE Anchor Point"), anchorExpr(0.5, 0.5));
        setExpr(tr(main, "ADBE Position"), HEAD + E("Main_Pos") + ";");
        // ゆっくり拡大: クリップの最後で「100 + ズーム量」% になる
        setExpr(tr(main, "ADBE Scale"), HEAD +
            "var z = 100 + " + E("Zoom") + " * clamp(time / thisComp.duration, 0, 1);\n[z, z];");
        setExpr(fxProp(main, "Shade", 1), HEAD + E("Main_Shadow") + ";");
        setExpr(fxProp(main, "Shade", 2), HEAD + "clamp(" + E("Main_ShadowAmt") + ", 0, 100) * " + shadeScale + ";");
        setExpr(fxProp(main, "Shade", 5), HEAD + sizeVar("Main_Size") + "40 * s;");
        applyInAnim(main, "1");

        C.moveToBeginning();
        protectIntro(comp, 1.0);

        egpText(comp, main, "テキスト");
        egpCtl(comp, C, "IN_Type", "登場アニメ");
        egpCtl(comp, C, "IN_Frames", "登場アニメの長さ（フレーム）");
        egpCtl(comp, C, "IN_Blur", "横ブラーの強さ");
        egpCtl(comp, C, "Zoom", "ゆっくりズーム量（%・クリップ全体で）");
        egpCtl(comp, C, "Main_Pos", "位置（文字の中心）");
        egpCtl(comp, C, "Main_Size", "大きさ（50=標準）");
        egpCtl(comp, C, "Main_Font", "書体");
        egpCtl(comp, C, "Main_Fill", "文字色");
        egpCtl(comp, C, "Main_Stroke", "フチ色");
        egpCtl(comp, C, "Main_StrokeW", "フチの太さ");
        egpCtl(comp, C, "Main_Shadow", "影の色");
        egpCtl(comp, C, "Main_ShadowAmt", "影の濃さ");

        comp.motionGraphicsTemplateName = "水ダウ風_黄色デカ文字ズーム";
        comp.time = 2;
        return comp;
    }

    // =================================================================
    // 3. 青グロー 2 段（ベーゴマ職人の数は‥ / 7人のみ）
    //    2 段目: 横ブラーで登場 → 少し遅れて白く光り、青いグローが広がる
    // =================================================================

    function buildBlueGlow(folder) {
        var comp = newComp("水ダウ風_青グロー2段", 6, folder);
        var C = addNullLayer(comp, "CTRL");

        ctlCheck(C, "L1_Show", true);
        ctlPoint(C, "L1_Pos", [110, 757]);
        ctlSlider(C, "L1_Size", 50);
        ctlDropdown(C, "L1_Font", FONT_LABELS, pickFont(["minchoLight", "minchoHeavy"]));
        ctlColor(C, "L1_Fill", hex("FFF6EA"));
        ctlColor(C, "L1_Glow", hex("E07A22"));
        ctlSlider(C, "L1_GlowSize", 50);
        ctlCheck(C, "L1_IN", false);
        ctlCheck(C, "L2_Show", true);
        ctlPoint(C, "L2_Pos", [173, 1005]);
        ctlSlider(C, "L2_Size", 50);
        ctlDropdown(C, "L2_Font", FONT_LABELS, pickFont(["minchoHeavy", "gothicHeavy"]));
        ctlColor(C, "L2_Fill", hex("FFFFFF"));
        ctlColor(C, "L2_Glow", hex("2337B8"));
        ctlSlider(C, "L2_GlowSize", 50);
        ctlCheck(C, "L2_Anim", true);
        ctlSlider(C, "L2_Delay", 30);
        ctlSlider(C, "L2_BlurFrames", 7);
        ctlSlider(C, "L2_BlurAmt", 50);
        ctlSlider(C, "L2_Slide", 40);
        ctlSlider(C, "L2_GlowStart", 11);
        ctlSlider(C, "L2_GlowFrames", 12);
        ctlSlider(C, "L2_StartBright", 55);

        var l2 = addTextLayer(comp, "L2_TEXT", "7人のみ", {
            font: fontPsAt(pickFont(["minchoHeavy", "gothicHeavy"])),
            size: 240, fill: [1, 1, 1], stroke: hex("2337B8"), strokeWidth: 14, justify: "left"
        });
        tr(l2, "ADBE Position").setValue([173, 1005]);
        var l2Near = addDropShadow(l2, "GlowNear", hex("2337B8"), 100, 0, 22);
        var l2Far = addDropShadow(l2, "GlowFar", hex("2337B8"), 90, 0, 70);
        addDirectionalBlur(l2, "InBlur");

        var l1 = addTextLayer(comp, "L1_TEXT", "ベーゴマ職人の数は‥", {
            font: fontPsAt(pickFont(["minchoLight", "minchoHeavy"])),
            size: 76, fill: hex("FFF6EA"), stroke: hex("E07A22"), strokeWidth: 3, justify: "left"
        });
        tr(l1, "ADBE Position").setValue([110, 757]);
        addDropShadow(l1, "GlowNear", hex("E07A22"), 100, 0, 12);
        addDropShadow(l1, "GlowFar", hex("E07A22"), 80, 0, 32);
        addDirectionalBlur(l1, "InBlur");

        // --- 1 段目 ---
        var l1Vars = "var on = " + E("L1_IN") + ";\n" +
            "var n1 = Math.max(1, " + E("L2_BlurFrames") + ");\n" +
            "var p1 = on ? clamp(time / fd / n1, 0, 1) : 1;\n";
        setExpr(sourceText(l1), styleExpr({
            size: 76, sizeCtl: "L1_Size", fontCtl: "L1_Font",
            fill: E("L1_Fill"), stroke: E("L1_Glow"), strokeWidth: "3 * s * " + E("L1_GlowSize") + " / 50"
        }));
        setExpr(tr(l1, "ADBE Position"), HEAD + E("L1_Pos") + ";");
        setExpr(tr(l1, "ADBE Opacity"), HEAD + l1Vars + "linear(p1, 0, 0.4, 0, 100) * " + E("L1_Show") + ";");
        setExpr(fxProp(l1, "InBlur", 2), HEAD + l1Vars + E("L2_BlurAmt") + " * 8 * Math.pow(1 - p1, 2);");
        var l1Glow = HEAD + sizeVar("L1_Size") + "var gs = " + E("L1_GlowSize") + " / 50;\n";
        setExpr(fxProp(l1, "GlowNear", 1), HEAD + E("L1_Glow") + ";");
        setExpr(fxProp(l1, "GlowFar", 1), HEAD + E("L1_Glow") + ";");
        setExpr(fxProp(l1, "GlowNear", 5), l1Glow + "12 * s * gs;");
        setExpr(fxProp(l1, "GlowFar", 5), l1Glow + "32 * s * gs;");

        // --- 2 段目 ---
        //   t2: 2 段目が始まってからのフレーム数
        //   pB: 横ブラー登場の進み具合 / g: 光る（白くなる＋グロー）進み具合
        var l2Vars = "var anim = " + E("L2_Anim") + ";\n" +
            "var t2 = time / fd - " + E("L2_Delay") + ";\n" +
            "var pB = anim ? clamp(t2 / Math.max(1, " + E("L2_BlurFrames") + "), 0, 1) : 1;\n" +
            "var g = anim ? clamp((t2 - " + E("L2_GlowStart") + ") / Math.max(1, " + E("L2_GlowFrames") + "), 0, 1) : 1;\n" +
            "var started = (!anim) || t2 >= 0;\n";
        setExpr(sourceText(l2), styleExpr({
            size: 240, sizeCtl: "L2_Size", fontCtl: "L2_Font",
            pre: l2Vars +
                "var b0 = clamp(" + E("L2_StartBright") + ", 0, 100) / 100;\n" +
                "var k = b0 + (1 - b0) * g;\n" +
                "var f0 = " + E("L2_Fill") + ";\n",
            fill: "[f0[0] * k, f0[1] * k, f0[2] * k]",
            stroke: E("L2_Glow"),
            strokeWidth: "14 * s * g * " + E("L2_GlowSize") + " / 50"
        }));
        setExpr(tr(l2, "ADBE Position"), HEAD + sizeVar("L2_Size") + l2Vars +
            "var p = " + E("L2_Pos") + ";\n" +
            "var q = 1 - Math.pow(1 - pB, 2);\n" +
            "[p[0] - " + E("L2_Slide") + " * s * (1 - q), p[1]];");
        setExpr(tr(l2, "ADBE Opacity"), HEAD + l2Vars +
            "(started ? linear(pB, 0, 0.4, 0, 100) : 0) * " + E("L2_Show") + ";");
        setExpr(fxProp(l2, "InBlur", 2), HEAD + l2Vars +
            "started ? " + E("L2_BlurAmt") + " * 8 * Math.pow(1 - pB, 2) : 0;");
        var l2Glow = HEAD + sizeVar("L2_Size") + l2Vars + "var gs = " + E("L2_GlowSize") + " / 50;\n";
        setExpr(fxProp(l2, "GlowNear", 1), HEAD + E("L2_Glow") + ";");
        setExpr(fxProp(l2, "GlowFar", 1), HEAD + E("L2_Glow") + ";");
        setExpr(fxProp(l2, "GlowNear", 5), l2Glow + "22 * s * gs;");
        setExpr(fxProp(l2, "GlowFar", 5), l2Glow + "70 * s * gs;");
        setExpr(fxProp(l2, "GlowNear", 2), l2Glow + "100 * g * " + l2Near + ";");
        setExpr(fxProp(l2, "GlowFar", 2), l2Glow + "90 * g * " + l2Far + ";");

        C.moveToBeginning();
        protectIntro(comp, 2.5);

        egpText(comp, l1, "1段目テキスト");
        egpText(comp, l2, "2段目テキスト");
        egpCtl(comp, C, "L1_Show", "1段目を表示");
        egpCtl(comp, C, "L1_Pos", "1段目の位置（左下の基準点）");
        egpCtl(comp, C, "L1_Size", "1段目の大きさ（50=標準）");
        egpCtl(comp, C, "L1_Font", "1段目の書体");
        egpCtl(comp, C, "L1_Fill", "1段目の文字色");
        egpCtl(comp, C, "L1_Glow", "1段目のグロー色");
        egpCtl(comp, C, "L1_GlowSize", "1段目のグローの広さ（50=標準）");
        egpCtl(comp, C, "L1_IN", "1段目も横ブラーで登場");
        egpCtl(comp, C, "L2_Show", "2段目を表示");
        egpCtl(comp, C, "L2_Pos", "2段目の位置（左下の基準点）");
        egpCtl(comp, C, "L2_Size", "2段目の大きさ（50=標準）");
        egpCtl(comp, C, "L2_Font", "2段目の書体");
        egpCtl(comp, C, "L2_Fill", "2段目の文字色");
        egpCtl(comp, C, "L2_Glow", "2段目のグロー色");
        egpCtl(comp, C, "L2_GlowSize", "2段目のグローの広さ（50=標準）");
        egpCtl(comp, C, "L2_Anim", "2段目のアニメーション");
        egpCtl(comp, C, "L2_Delay", "2段目が出るタイミング（フレーム）");
        egpCtl(comp, C, "L2_BlurFrames", "横ブラー登場の長さ（フレーム）");
        egpCtl(comp, C, "L2_BlurAmt", "横ブラーの強さ");
        egpCtl(comp, C, "L2_Slide", "横スライド量（px）");
        egpCtl(comp, C, "L2_GlowStart", "光り始め（登場から何フレーム後）");
        egpCtl(comp, C, "L2_GlowFrames", "光る長さ（フレーム）");
        egpCtl(comp, C, "L2_StartBright", "光る前の明るさ（%）");

        comp.motionGraphicsTemplateName = "水ダウ風_青グロー2段";
        comp.time = 3;
        return comp;
    }

    // =================================================================
    // 4. ランキングボード（絶滅危惧アイテム⑤ そろばん / 7社）
    //    下の黒箱が上から伸びて出現 → 上の箱を押し上げ → 白いフラッシュが引いて黒に
    // =================================================================

    var BOARD_W = 820;       // ボードの幅
    var MAIN_H = 171;        // 白い箱（枠込み）の高さ
    var SUB_H = 267;         // 下の黒箱の高さ

    function buildBoard(folder) {
        var comp = newComp("水ダウ風_ランキングボード", 6, folder);
        var C = addNullLayer(comp, "CTRL");
        var hw = BOARD_W / 2;

        ctlSlider(C, "Panel_Size", 50);
        ctlCheck(C, "Label_Show", true);
        ctlDropdown(C, "Label_Font", FONT_LABELS, pickFont(["gothicHeavy"]));
        ctlColor(C, "Label_Box", hex("DA3A3D"));
        ctlColor(C, "Label_Text", hex("FFFFFF"));
        ctlDropdown(C, "Main_Font", FONT_LABELS, pickFont(["gothicHeavy"]));
        ctlColor(C, "Main_Text", hex("000000"));
        ctlColor(C, "Main_Box", hex("FDFDFD"));
        ctlColor(C, "Main_Frame", hex("CFCB1E"));
        ctlColor(C, "Main_Line", hex("141414"));
        ctlCheck(C, "Sub_Show", true);
        ctlDropdown(C, "Num_Font", FONT_LABELS, pickFont(["gothicHeavy"]));
        ctlSlider(C, "Num_Size", 50);
        ctlSlider(C, "Unit_Size", 50);
        ctlColor(C, "Num_Color", hex("FDD40A"));
        ctlColor(C, "Unit_Color", hex("FFFFFF"));
        ctlColor(C, "Sub_Box", hex("0F1C1A"));
        ctlSlider(C, "Sub_BoxOpacity", 88);
        ctlCheck(C, "Sub_Anim", true);
        ctlSlider(C, "Sub_Delay", 30);
        ctlSlider(C, "Sub_PushFrames", 5);
        ctlSlider(C, "Sub_Push", 39);
        ctlSlider(C, "Sub_FlashFrames", 28);
        ctlSlider(C, "Sub_Flash", 100);

        // 親ヌル: STACK = 白い箱の上辺中央 / SUB = 黒箱の上辺中央（STACK の子）
        var stack = addNullLayer(comp, "STACK");
        tr(stack, "ADBE Position").setValue([1437, 394]);
        var sub = addNullLayer(comp, "SUB");
        sub.parent = stack;
        tr(sub, "ADBE Position").setValue([0, MAIN_H]);

        // --- 下の黒箱 ---
        var subBox = addShapeLayer(comp, "SUB_BOX");
        subBox.parent = sub;
        tr(subBox, "ADBE Position").setValue([0, 0]);
        addRectGroup(subBox, "Box", [[BOARD_W, SUB_H, 0, SUB_H / 2]], hex("0F1C1A"));
        addRectGroup(subBox, "Shadow", [[BOARD_W, SUB_H, 9, SUB_H / 2 + 9]], [0, 0, 0]);

        var unit = addTextLayer(comp, "UNIT_TEXT", "社", {
            font: fontPsAt(pickFont(["gothicHeavy"])), size: 145, fill: [1, 1, 1], strokeWidth: 0, justify: "left"
        });
        unit.parent = sub;
        tr(unit, "ADBE Position").setValue([30, 220]);

        var num = addTextLayer(comp, "NUM_TEXT", "7", {
            font: fontPsAt(pickFont(["gothicHeavy"])), size: 255, fill: hex("FDD40A"), strokeWidth: 0, justify: "right"
        });
        num.parent = sub;
        tr(num, "ADBE Position").setValue([10, 220]);

        // --- 白い箱（枠つき） ---
        var mainBox = addShapeLayer(comp, "MAIN_BOX");
        mainBox.parent = stack;
        tr(mainBox, "ADBE Position").setValue([0, 0]);
        var rv = 6, rvy1 = 6, rvy2 = MAIN_H - 6, rvx = hw - 6;
        addRectGroup(mainBox, "RivetIn", [[4, 4, -rvx, rvy1], [4, 4, rvx, rvy1], [4, 4, -rvx, rvy2], [4, 4, rvx, rvy2]], [1, 1, 1]);
        addRectGroup(mainBox, "RivetOut", [[rv + 2, rv + 2, -rvx, rvy1], [rv + 2, rv + 2, rvx, rvy1],
            [rv + 2, rv + 2, -rvx, rvy2], [rv + 2, rv + 2, rvx, rvy2]], hex("141414"));
        // 白い面の上辺・左辺にうっすら入る内側の影
        addRectGroup(mainBox, "InnerShade", [[BOARD_W - 26, 7, 0, 13 + 3.5], [4, MAIN_H - 26, -hw + 13 + 2, MAIN_H / 2]], hex("CDCBC8"));
        addRectGroup(mainBox, "Inner", [[BOARD_W - 26, MAIN_H - 26, 0, MAIN_H / 2]], hex("FDFDFD"));
        addRectGroup(mainBox, "InnerLine", [[BOARD_W - 22, MAIN_H - 22, 0, MAIN_H / 2]], hex("141414"));
        addRectGroup(mainBox, "Frame", [[BOARD_W - 4, MAIN_H - 4, 0, MAIN_H / 2]], hex("CFCB1E"));
        addRectGroup(mainBox, "OuterLine", [[BOARD_W, MAIN_H, 0, MAIN_H / 2]], hex("141414"));

        var mainText = addTextLayer(comp, "MAIN_TEXT", "そろばん", {
            font: fontPsAt(pickFont(["gothicHeavy"])), size: 120, fill: [0, 0, 0], strokeWidth: 0, justify: "center"
        });
        mainText.parent = stack;
        tr(mainText, "ADBE Position").setValue([0, MAIN_H / 2]);

        // --- 赤ラベル ---
        var labelBox = addShapeLayer(comp, "LABEL_BOX");
        labelBox.parent = stack;
        tr(labelBox, "ADBE Position").setValue([0, 0]);
        addRectGroup(labelBox, "Box", [[515, 63, -hw + 2 + 257, -34.5]], hex("DA3A3D"));

        var label = addTextLayer(comp, "LABEL_TEXT", "絶滅危惧アイテム⑤", {
            font: fontPsAt(pickFont(["gothicHeavy"])), size: 52, fill: [1, 1, 1], strokeWidth: 0, justify: "left"
        });
        label.parent = stack;
        tr(label, "ADBE Position").setValue([-hw + 14, -34.5]);

        // --- アニメーションの共通変数 ---
        //   p: 黒箱が伸びる＋押し上げの進み具合（0→1）
        //   f: フラッシュの残り具合（1→0）
        var subVars = HEAD +
            "var anim = " + E("Sub_Anim") + ";\n" +
            "var show = " + E("Sub_Show") + ";\n" +
            "var t = time / fd - " + E("Sub_Delay") + ";\n" +
            "var p = anim ? clamp(t / Math.max(1, " + E("Sub_PushFrames") + "), 0, 1) : 1;\n" +
            "p = 1 - Math.pow(1 - p, 2);\n" +
            "var f = anim ? (1 - clamp(t / Math.max(1, " + E("Sub_FlashFrames") + "), 0, 1)) : 0;\n" +
            "f = f * clamp(" + E("Sub_Flash") + ", 0, 100) / 100;\n" +
            "var started = (!anim) || t >= 0;\n";

        function mix(colorExpr, amountExpr) {
            return "(function () { var c = " + colorExpr + "; var a = " + amountExpr + ";\n" +
                "return [c[0] + (1 - c[0]) * a, c[1] + (1 - c[1]) * a, c[2] + (1 - c[2]) * a, 1]; })()";
        }

        // 全体の大きさと押し上げ
        setExpr(tr(stack, "ADBE Scale"), HEAD + sizeVar("Panel_Size") + "[100 * s, 100 * s];");
        setExpr(tr(stack, "ADBE Position"), subVars + sizeVar("Panel_Size") +
            "var push = " + SUB_H + " * " + E("Sub_Push") + " / 100 * s;\n" +
            "var k = show ? (1 - p) : 1;\n" +
            "[value[0], value[1] + push * k];");
        setExpr(tr(sub, "ADBE Scale"), subVars + "[100, (show && started) ? 100 * p : 0];");

        // 黒箱
        setExpr(fillColor(subBox, "Box"), subVars + mix(E("Sub_Box"), "f") + ";");
        setExpr(groupOpacity(subBox, "Box"), subVars +
            "var o = " + E("Sub_BoxOpacity") + ";\no - (o - 55) * f;");
        setExpr(groupOpacity(subBox, "Shadow"), subVars + E("Sub_BoxOpacity") + " * (1 - f);");
        setExpr(tr(subBox, "ADBE Opacity"), subVars + "(show && started) ? 100 : 0;");

        // 数字と単位（下端そろえ、2 つまとめて中央に配置）
        var pairVars = 'var N = thisComp.layer("NUM_TEXT");\n' +
            'var U = thisComp.layer("UNIT_TEXT");\n' +
            "var wn = N.sourceRectAtTime(time, false).width;\n" +
            "var wu = U.sourceRectAtTime(time, false).width;\n" +
            "var gap = (wu > 0 && wn > 0) ? 14 : 0;\n" +
            "var x0 = -(wn + gap + wu) / 2 + 10;\n";
        setExpr(sourceText(num), styleExpr({
            size: 255, sizeCtl: "Num_Size", fontCtl: "Num_Font",
            pre: subVars, fill: mix(E("Num_Color"), "0.8 * f")
        }));
        setExpr(tr(num, "ADBE Anchor Point"), anchorExpr(1, 1));
        setExpr(tr(num, "ADBE Position"), pairVars + "[x0 + wn, 220];");
        setExpr(tr(num, "ADBE Opacity"), subVars + "(show && started) ? 100 : 0;");

        setExpr(sourceText(unit), styleExpr({
            size: 145, sizeCtl: "Unit_Size", fontCtl: "Num_Font",
            pre: subVars, fill: mix(E("Unit_Color"), "0.8 * f")
        }));
        setExpr(tr(unit, "ADBE Anchor Point"), anchorExpr(0, 1));
        setExpr(tr(unit, "ADBE Position"), pairVars + "[x0 + wn + gap, 220];");
        setExpr(tr(unit, "ADBE Opacity"), subVars + "(show && started) ? 100 : 0;");

        // 白い箱
        setExpr(fillColor(mainBox, "Inner"), HEAD + E("Main_Box") + ";");
        setExpr(fillColor(mainBox, "Frame"), HEAD + E("Main_Frame") + ";");
        setExpr(fillColor(mainBox, "InnerLine"), HEAD + E("Main_Line") + ";");
        setExpr(fillColor(mainBox, "OuterLine"), HEAD + E("Main_Line") + ";");
        setExpr(fillColor(mainBox, "RivetOut"), HEAD + E("Main_Line") + ";");

        setExpr(sourceText(mainText), styleExpr({
            size: 120, fontCtl: "Main_Font", fill: E("Main_Text")
        }));
        setExpr(tr(mainText, "ADBE Anchor Point"), anchorExpr(0.5, 0.5));
        // 長い文字は箱に収まるよう横だけ縮める
        setExpr(tr(mainText, "ADBE Scale"),
            "var r = sourceRectAtTime(time, false);\n" +
            "var maxW = " + (BOARD_W - 80) + ";\n" +
            "var sx = (r.width > maxW) ? 100 * maxW / r.width : 100;\n[sx, 100];");

        // 赤ラベル
        setExpr(sourceText(label), styleExpr({
            size: 52, fontCtl: "Label_Font", fill: E("Label_Text")
        }));
        setExpr(tr(label, "ADBE Anchor Point"), anchorExpr(0, 0.5));
        setExpr(tr(label, "ADBE Opacity"), HEAD + "100 * " + E("Label_Show") + ";");
        var labelGeo = 'var L = thisComp.layer("LABEL_TEXT");\n' +
            "var r = L.sourceRectAtTime(time, false);\n" +
            "var b = fromComp(L.toComp([r.left + r.width, r.top + r.height]));\n" +
            "var x0 = " + (-hw + 2) + ";\n" +
            "var x1 = Math.max(x0 + 40, b[0] + 12);\n";
        setExpr(rectSize(labelBox, "Box"), labelGeo + "[x1 - x0, 63];");
        setExpr(rectPos(labelBox, "Box"), labelGeo + "[(x0 + x1) / 2, -34.5];");
        setExpr(fillColor(labelBox, "Box"), HEAD + E("Label_Box") + ";");
        setExpr(tr(labelBox, "ADBE Opacity"), HEAD + "100 * " + E("Label_Show") + ";");

        stack.moveToBeginning();
        sub.moveToBeginning();
        C.moveToBeginning();
        protectIntro(comp, 2.5);

        egpText(comp, label, "ラベルテキスト");
        egpText(comp, mainText, "メインテキスト");
        egpText(comp, num, "数字");
        egpText(comp, unit, "単位");
        egpCtl(comp, C, "Panel_Size", "ボードの大きさ（50=標準）");
        egpCtl(comp, C, "Label_Show", "ラベルを表示");
        egpCtl(comp, C, "Label_Font", "ラベルの書体");
        egpCtl(comp, C, "Label_Box", "ラベルの色");
        egpCtl(comp, C, "Label_Text", "ラベルの文字色");
        egpCtl(comp, C, "Main_Font", "メインの書体");
        egpCtl(comp, C, "Main_Text", "メインの文字色");
        egpCtl(comp, C, "Main_Box", "メインの箱の色");
        egpCtl(comp, C, "Main_Frame", "メインの枠の色");
        egpCtl(comp, C, "Main_Line", "メインの枠線の色");
        egpCtl(comp, C, "Sub_Show", "下の箱を表示");
        egpCtl(comp, C, "Num_Font", "数字・単位の書体");
        egpCtl(comp, C, "Num_Size", "数字の大きさ（50=標準）");
        egpCtl(comp, C, "Unit_Size", "単位の大きさ（50=標準）");
        egpCtl(comp, C, "Num_Color", "数字の色");
        egpCtl(comp, C, "Unit_Color", "単位の色");
        egpCtl(comp, C, "Sub_Box", "下の箱の色");
        egpCtl(comp, C, "Sub_BoxOpacity", "下の箱の不透明度");
        egpCtl(comp, C, "Sub_Anim", "下の箱のアニメーション");
        egpCtl(comp, C, "Sub_Delay", "下の箱が出るタイミング（フレーム）");
        egpCtl(comp, C, "Sub_PushFrames", "伸びる・押し上げの長さ（フレーム）");
        egpCtl(comp, C, "Sub_Push", "押し上げ量（下の箱の高さに対する%）");
        egpCtl(comp, C, "Sub_FlashFrames", "白フラッシュが消えるまで（フレーム）");
        egpCtl(comp, C, "Sub_Flash", "白フラッシュの強さ（%）");

        comp.motionGraphicsTemplateName = "水ダウ風_ランキングボード";
        comp.time = 3;
        return comp;
    }

    // =================================================================
    // 検証・書き出し
    // =================================================================

    // エクスプレッションエラーがあれば一覧にする
    function collectExpressionErrors(comp) {
        var errors = [];
        function walk(group, path) {
            for (var i = 1; i <= group.numProperties; i++) {
                try {
                    var p = group.property(i);
                    if (!p) continue;
                    if (p.propertyType === PropertyType.PROPERTY) {
                        if (p.canSetExpression && p.expression !== "") {
                            try { p.valueAtTime(2.5, false); } catch (e) {}
                            if (p.expressionError) errors.push(path + " > " + p.name + ": " + p.expressionError);
                        }
                    } else {
                        walk(p, path + " > " + p.name);
                    }
                } catch (eWalk) {}
            }
        }
        for (var l = 1; l <= comp.numLayers; l++) {
            walk(comp.layer(l), comp.name + " / " + comp.layer(l).name);
        }
        return errors;
    }

    function safeFileName(s) {
        return s.replace(/[\\\/:\*\?"<>\|]/g, "_");
    }

    // =================================================================
    // 効果音
    //   se/単体/ の WAV（ファイル名の先頭が SE01〜SE07）を読み込み、
    //   各テンプレートの初期設定のタイミングに配置する。
    // =================================================================

    // [効果音の番号, 開始フレーム]。フレームは各テンプレートのスライダー初期値に合わせてある
    var SE_PLAN = {
        "水ダウ風_地名＋日数": [["SE06", 0]],                        // ピコン（出た瞬間）
        "水ダウ風_黄色デカ文字ズーム": [["SE04", 0]],                  // ドーン（出た瞬間）
        "水ダウ風_青グロー2段": [["SE01", 30], ["SE02", 30 + 11]],     // シュッ（2段目）＋キラーン（光る瞬間）
        "水ダウ風_ランキングボード": [["SE03", 30]]                    // ドン（下の箱が出る瞬間）
    };

    function hasSeFiles(folder) {
        return folder && folder.exists && folder.getFiles("SE0*.wav").length > 0;
    }

    function findSeFolder() {
        var candidates = [];
        try {
            var here = new File($.fileName).parent;
            candidates.push(new Folder(here.fsName + "/se/単体"));
            candidates.push(new Folder(here.fsName + "/単体"));
            candidates.push(here);
        } catch (e) {}
        for (var i = 0; i < candidates.length; i++) {
            if (hasSeFiles(candidates[i])) return candidates[i];
        }
        var picked = Folder.selectDialog(
            "効果音のフォルダ（se/単体）を選んでください。\nキャンセルすると効果音なしで続けます。");
        if (hasSeFiles(picked)) return picked;
        if (picked) log("選ばれたフォルダに効果音（SE01〜SE07 の WAV）が見つかりませんでした");
        return null;
    }

    function addSoundEffects(comps, seFolder) {
        var projFolder = app.project.items.addFolder("効果音");
        var items = {};
        var added = 0;
        for (var c = 0; c < comps.length; c++) {
            var plan = SE_PLAN[comps[c].name];
            if (!plan) continue;
            for (var i = 0; i < plan.length; i++) {
                var key = plan[i][0];
                try {
                    if (!items[key]) {
                        var files = seFolder.getFiles(key + "_*.wav");
                        if (files.length === 0) {
                            log(key + " の効果音ファイルが見つかりませんでした");
                            continue;
                        }
                        items[key] = app.project.importFile(new ImportOptions(files[0]));
                        items[key].parentFolder = projFolder;
                    }
                    var layer = comps[c].layers.add(items[key]);
                    layer.startTime = plan[i][1] * comps[c].frameDuration;
                    layer.moveToEnd();
                    added++;
                } catch (e) {
                    log(comps[c].name + ": 効果音 " + key + " を追加できませんでした（" + e.toString() + "）");
                }
            }
        }
        return added;
    }

    function exportAll(comps, outFolder, suffix, exported) {
        for (var c = 0; c < comps.length; c++) {
            var fileName = safeFileName(comps[c].name + suffix) + ".mogrt";
            try {
                if (comps[c].exportAsMotionGraphicsTemplate(true, outFolder.fsName + "/" + fileName)) {
                    exported.push(fileName);
                } else {
                    log(fileName + " を書き出せませんでした");
                }
            } catch (e) {
                log(fileName + " の書き出しでエラー: " + e.toString());
            }
        }
    }

    // =================================================================
    // 実行
    // =================================================================

    var ok = confirm(TITLE + "\n\n" +
        "新しいプロジェクトを作り、水ダウ風テロップ 4 種類を .mogrt として書き出します。\n" +
        "（効果音なし版と、効果音入りの「（効果音あり）」版の両方を作ります）\n" +
        "（今開いているプロジェクトに未保存の変更がある場合は、保存するか確認が出ます）\n\n" +
        "続けますか？");
    if (!ok) return;

    var proj = app.newProject();
    if (!proj) return;   // 保存ダイアログでキャンセル

    try { app.project.expressionEngine = "javascript-1.0"; } catch (eEngine) {
        log("エクスプレッションエンジンを JavaScript に設定できませんでした");
    }

    app.beginUndoGroup(TITLE);
    var folder = app.project.items.addFolder("水ダウ風テロップ");
    var builders = [buildLocation, buildGoldZoom, buildBlueGlow, buildBoard];
    var comps = [];
    var exprErrors = [];
    for (var b = 0; b < builders.length; b++) {
        try {
            var comp = builders[b](folder);
            comps.push(comp);
            exprErrors = exprErrors.concat(collectExpressionErrors(comp));
        } catch (eBuild) {
            log("テンプレート " + (b + 1) + " の作成中にエラー: " + eBuild.toString() +
                (eBuild.line ? "（" + eBuild.line + " 行目）" : ""));
        }
    }
    app.endUndoGroup();

    var outFolder = Folder.selectDialog("保存先フォルダを選んでください（.mogrt と .aep を保存します）");
    var exported = [];

    // 1) 効果音なし版
    if (outFolder) exportAll(comps, outFolder, "", exported);
    else log("保存先が選ばれなかったため、書き出しはしていません（コンポジションはプロジェクト内にあります）。");

    // 2) 効果音を配置して、効果音あり版
    var seCount = 0;
    var seFolder = findSeFolder();
    if (seFolder) {
        app.beginUndoGroup(TITLE + "（効果音）");
        seCount = addSoundEffects(comps, seFolder);
        app.endUndoGroup();
        if (outFolder && seCount > 0) exportAll(comps, outFolder, "（効果音あり）", exported);
    } else {
        log("効果音のフォルダが見つからなかったため、効果音あり版は作っていません。");
    }

    // 書き出し時はサムネイル用に完成形の時刻を表示していたので、
    // 再生するとアニメーションが最初から見えるよう、再生ヘッドを 0 フレーム目に戻す
    for (var ct = 0; ct < comps.length; ct++) {
        comps[ct].time = 0;
    }
    if (comps.length > 0) comps[comps.length - 1].openInViewer();

    // 3) 効果音入りのプロジェクトを保存
    if (outFolder) {
        try {
            app.project.save(new File(outFolder.fsName + "/水ダウ風テロップ.aep"));
        } catch (eSave) {
            log("プロジェクトを保存できませんでした: " + eSave.toString());
        }
    }

    var msg = TITLE + "\n\n";
    if (exported.length > 0) {
        msg += "書き出し完了（" + outFolder.fsName + "）\n  ・" + exported.join("\n  ・") + "\n\n" +
            "Premiere Pro での使い方:\n" +
            "  .mogrt をタイムラインにドラッグ → エッセンシャルグラフィックスパネルの［編集］で\n" +
            "  文字・色・大きさ・書体・アニメーションを変更できます。\n";
        if (seCount > 0) {
            msg += "  「（効果音あり）」の .mogrt は、初期設定のタイミングで効果音が鳴ります。\n";
        }
    }
    if (seCount > 0) {
        msg += "\n効果音を " + seCount + " 個、各コンポジションに配置しました（After Effects のプレビューでも鳴ります）。\n";
    }
    if (exprErrors.length > 0) {
        msg += "\nエクスプレッションのエラー（" + exprErrors.length + " 件）:\n  " +
            exprErrors.slice(0, 8).join("\n  ") + "\n";
    }
    if (LOG.length > 0) {
        msg += "\nお知らせ:\n  " + LOG.join("\n  ") + "\n";
    }
    if (exported.length === 0 && LOG.length > 0) {
        msg += "\n書き出しに失敗した場合は［設定］>［スクリプトとエクスプレッション］の\n" +
            "「スクリプトによるファイルへの書き込みとネットワークへのアクセスを許可」をオンにしてください。\n";
    }
    alert(msg);
})();
