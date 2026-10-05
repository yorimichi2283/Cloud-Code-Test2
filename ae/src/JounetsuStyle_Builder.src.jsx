// =====================================================================
//  情熱大陸風 オープニング＆テロップ 自動生成スクリプト（After Effects 用）
//
//  使い方：
//    After Effects → ファイル → スクリプト → スクリプトファイルを実行…
//    → このファイル（JounetsuStyle_Builder.jsx）を選ぶ
//
//  作られるコンポジション：
//    01_OP_オープニング      … 円が昇る→ロゴ出現→退場（約6秒）
//    02_ロゴ＋上部タイトル   … 左上ロゴのコイン回転＋上部の青帯タイトル
//    03_下部テロップ         … 画面下の青帯テロップ
//    04_名前テロップ         … 右下の名前テロップ（青帯＋白箱）
//
//  色・文字は各コンポの「CTRL」レイヤーのエフェクト、または
//  エッセンシャルグラフィックス（Premiere で編集できる項目）から変更できます。
//  アニメーションのタイミングはキーフレーム、または CTRL のスライダーで調整します。
//
//  ※ このファイルの先頭の「設定」部分を書き換えて再実行すれば、
//    初期の色・文字・フォントを変えたテンプレートを作り直せます。
// =====================================================================

(function JounetsuStyleBuilder() {

    // =================================================================
    //  設定（ここを書き換えると初期値が変わります）
    // =================================================================

    var W = 1920, H = 1080, FPS = 29.97;

    // 色（#RRGGBB）
    var COL = {
        blue:    "#002F9D",  // メインの青（ロゴ・帯）
        orange:  "#F64B1A",  // オレンジ
        red:     "#E04A3E",  // 赤
        magenta: "#C23A6A",  // マゼンタ
        purple:  "#5F3793",  // 紫
        pink:    "#F7A9A6",  // ピンク
        circleW: "#FBF8F8",  // 円の白
        bgWhite: "#FCFCFC",  // 背景の白
        white:   "#FFFFFF",
        ink:     "#141414"   // 名前テロップの文字色
    };

    // 初期テキスト（あとから自由に変更できます）
    var TXT = {
        logo:   "情熱大陸",          // ロゴの4文字（右上→右下→左上→左下の順に並びます）
        romaji: "JOUNETSU-TAIRIKU",  // ロゴ下の英字（円の中の文字にも使われます）
        doc:    "The Documentary",
        title:  "ここに上部タイトル…どんな物語が始まるのか？",
        bottom: "“ここに下部テロップ” 自由に書き換えて使えます！",
        name:   "山田　太郎",
        sub:    "株式会社〇〇　代表",
        band:   "肩書き　2026.10.5"
    };

    // フォント（PostScript名。上から順に、入っているものが使われます）
    var FONT = {
        logo:   pickFont(["HiraginoSans-W8", "HiraKakuStdN-W8", "HiraKakuProN-W6", "KozGoPr6N-Heavy", "NotoSansJP-Black", "YuGothic-Bold"], "HiraginoSans-W8"),
        latin:  pickFont(["AvenirNext-Bold", "Avenir-Heavy", "Montserrat-Bold", "HelveticaNeue-Bold", "Arial-BoldMT"], "AvenirNext-Bold"),
        gothic: pickFont(["HiraginoSans-W7", "HiraKakuStdN-W8", "HiraKakuProN-W6", "KozGoPr6N-Bold", "NotoSansJP-Bold", "YuGothic-Bold"], "HiraginoSans-W7"),
        mincho: pickFont(["HiraMinProN-W6", "HiraMinStdN-W6", "KozMinPr6N-Bold", "YuMincho-Demibold", "NotoSerifJP-Bold"], "HiraMinProN-W6"),
        brush:  pickFont(["AoyagiKouzanFontT", "KouzanBrushFontOTF", "Klee-Demibold", "Klee-Medium", "YuKyo-Bold", "YuKyo-Medium", "HiraMinProN-W6"], "HiraMinProN-W6")
    };

    // オープニングのタイミング（秒）
    var T = {
        p1: 0.00,   // P1：白地に円のドームが昇る
        p2: 1.55,   // P2：青地に大きな円（カット）
        p3: 2.33,   // P3：円が上に抜けて消えていく
        p4: 2.85,   // ロゴ登場（カット）
        px: 5.22    // ロゴ退場開始
    };
    var OP_DUR = 6.0;

    // ロゴの形（オープニングの 100% 時の寸法）
    var LOGO = {
        cx: 960, cy: 521, r: 368,   // 円の中心と半径
        floor: 798,                 // 円の下の平らな線
        ceil: 67,                   // 円の上の帯の線
        glyph: [[1075, 374], [1080, 621], [825, 374], [830, 621]], // 文字の位置（1〜4文字目）
        glyphSize: 248, glyphScaleX: 92,
        romajiY: 890, romajiSize: 58,
        docY: 958, docSize: 44,
        pivot: [960, 545],
        scale0: 91.7, zoomPerSec: 5.9
    };

    // =================================================================
    //  ここから下はプログラム本体です
    // =================================================================

    var EXPR_ERRORS = [];
    var FOLDER_MAIN = null, FOLDER_PARTS = null;

    // ---------------- 汎用 ----------------

    function pickFont(list, safe) {
        try {
            if (app.fonts && app.fonts.getFontsByPostScriptName) {
                for (var i = 0; i < list.length; i++) {
                    var found = app.fonts.getFontsByPostScriptName(list[i]);
                    if (found && found.length > 0) { return list[i]; }
                }
                return list[0];
            }
        } catch (e) {}
        return safe;
    }

    function hex3(h) {
        h = h.replace("#", "");
        return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
    }
    function hex4(h) { var c = hex3(h); return [c[0], c[1], c[2], 1]; }

    function makeRng(seed) {
        var s = seed >>> 0;
        return function () {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
    }

    function f2(n) { return String(Math.round(n * 100) / 100); }
    function f3(n) { return String(Math.round(n * 1000) / 1000); }
    function q(s) { return '"' + String(s).split("\\").join("\\\\").split('"').join('\\"') + '"'; }

    function findItemByName(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === name) { return app.project.item(i); }
        }
        return null;
    }
    function uniqueName(base) {
        var name = base, n = 2;
        while (findItemByName(name) !== null) { name = base + " " + n; n++; }
        return name;
    }

    function newComp(name, dur, folder, w, h) {
        var c = app.project.items.addComp(name, w || W, h || H, 1, dur, FPS);
        c.bgColor = [1, 1, 1];
        if (folder) { c.parentFolder = folder; }
        return c;
    }

    // ---------------- レイヤー ----------------

    function xf(L, m) { return L.property("ADBE Transform Group").property(m); }
    function setXY(L, anchor, pos) {
        xf(L, "ADBE Anchor Point").setValue(anchor);
        xf(L, "ADBE Position").setValue(pos);
    }
    function addNull(comp, name, pivot) {
        var n = comp.layers.addNull(comp.duration);
        n.name = name;
        setXY(n, pivot, pivot);
        return n;
    }
    function srcText(L) { return L.property("ADBE Text Properties").property("ADBE Text Document"); }

    function addText(comp, str, o) {
        var L = comp.layers.addText(str);
        L.name = o.name;
        var tp = srcText(L);
        var td = tp.value;
        try { td.resetCharStyle(); } catch (e0) {}
        try { td.resetParagraphStyle(); } catch (e1) {}
        td.fontSize = o.size;
        td.applyFill = true;
        td.fillColor = o.color;
        td.applyStroke = false;
        td.justification = o.just;
        td.tracking = o.tracking || 0;
        if (o.leading) {
            try { td.autoLeading = false; } catch (e2) {}
            try { td.leading = o.leading; } catch (e3) {}
        }
        td.text = str;
        try {
            td.font = o.font;
            tp.setValue(td);
        } catch (e4) {
            // フォントが見つからない場合はフォント指定なしで設定
            td = tp.value;
            td.text = str;
            tp.setValue(td);
        }
        return L;
    }

    var EXP_ANCHOR_CENTER = "var r=sourceRectAtTime(time,false);[r.left+r.width/2,r.top+r.height/2]";
    var EXP_ANCHOR_LEFTMID = "var r=sourceRectAtTime(time,false);[r.left,r.top+r.height/2]";
    var EXP_ANCHOR_RIGHTMID = "var r=sourceRectAtTime(time,false);[r.left+r.width,r.top+r.height/2]";

    // ---------------- シェイプ ----------------

    function root(L) { return L.property("ADBE Root Vectors Group"); }
    function newGroup(L, g) { var p = root(L).addProperty("ADBE Vector Group"); p.name = g; }
    function gc(L, g) { return root(L).property(g).property("ADBE Vectors Group"); }
    function gxf(L, g, m) { return root(L).property(g).property("ADBE Vector Transform Group").property(m); }
    function gp(L, g, name) { return gc(L, g).property(name); }

    function addEllipse(L, g, name, size, pos) {
        var p = gc(L, g).addProperty("ADBE Vector Shape - Ellipse");
        p.name = name;
        p.property("ADBE Vector Ellipse Size").setValue(size);
        p.property("ADBE Vector Ellipse Position").setValue(pos);
    }
    function addRect(L, g, name, size, pos, round) {
        var p = gc(L, g).addProperty("ADBE Vector Shape - Rect");
        p.name = name;
        p.property("ADBE Vector Rect Size").setValue(size);
        p.property("ADBE Vector Rect Position").setValue(pos);
        p.property("ADBE Vector Rect Roundness").setValue(round || 0);
    }
    function addMerge(L, g, mode) {
        var p = gc(L, g).addProperty("ADBE Vector Filter - Merge");
        p.name = "Merge";
        p.property("ADBE Vector Merge Type").setValue(mode);
    }
    function addFill(L, g, name, color) {
        var p = gc(L, g).addProperty("ADBE Vector Graphic - Fill");
        p.name = name;
        p.property("ADBE Vector Fill Color").setValue(color);
    }
    function fillColor(L, g, name) { return gp(L, g, name).property("ADBE Vector Fill Color"); }

    function newShape(comp, name) {
        var L = comp.layers.addShape();
        L.name = name;
        return L;
    }

    // ---------------- マスク ----------------

    function rectShape(x1, y1, x2, y2) {
        var s = new Shape();
        s.vertices = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
        s.closed = true;
        return s;
    }
    function circleShape(cx, cy, r) {
        var k = r * 0.5523;
        var s = new Shape();
        s.vertices = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
        s.inTangents = [[-k, 0], [0, -k], [k, 0], [0, k]];
        s.outTangents = [[k, 0], [0, k], [-k, 0], [0, -k]];
        s.closed = true;
        return s;
    }
    function addMask(L, name, shape, mode) {
        var m = L.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.name = name;
        m.maskMode = mode;
        m.property("ADBE Mask Shape").setValue(shape);
    }
    function maskPath(L, name) { return L.property("ADBE Mask Parade").property(name).property("ADBE Mask Shape"); }

    // ---------------- エフェクト ----------------

    function fxGroup(L) { return L.property("ADBE Effect Parade"); }
    function addSlider(L, name, v) {
        var e = fxGroup(L).addProperty("ADBE Slider Control");
        e.name = name;
        fxGroup(L).property(name).property(1).setValue(v);
    }
    function addColorCtl(L, name, h) {
        var e = fxGroup(L).addProperty("ADBE Color Control");
        e.name = name;
        fxGroup(L).property(name).property(1).setValue(hex4(h));
    }
    function addCheckbox(L, name, on) {
        var e = fxGroup(L).addProperty("ADBE Checkbox Control");
        e.name = name;
        fxGroup(L).property(name).property(1).setValue(on ? 1 : 0);
    }
    function fxp(L, name) { return fxGroup(L).property(name).property(1); }

    function colorParamOf(eff) {
        for (var i = 1; i <= eff.numProperties; i++) {
            var p = eff.property(i);
            try { if (p.propertyValueType === PropertyValueType.COLOR) { return p; } } catch (e) {}
        }
        return null;
    }
    // 「塗り」エフェクトを追加し、その色をエクスプレッションでつなぐ
    function addFillFx(L, exprStr) {
        var e = fxGroup(L).addProperty("ADBE Fill");
        e.name = "塗り（色）";
        var p = colorParamOf(fxGroup(L).property("塗り（色）"));
        if (p !== null) { setExpr(p, exprStr, L.name + " / 塗り"); }
    }
    function addLinearWipe(L, name, angle, feather, exprStr) {
        var e = fxGroup(L).addProperty("ADBE Linear Wipe");
        e.name = name;
        var eff = fxGroup(L).property(name);
        eff.property(2).setValue(angle);
        eff.property(3).setValue(feather);
        setExpr(fxGroup(L).property(name).property(1), exprStr, L.name + " / " + name);
    }

    // ---------------- エクスプレッション・キーフレーム ----------------

    function setExpr(prop, src, where) {
        try {
            prop.expression = src;
        } catch (e) {
            EXPR_ERRORS.push(where + " : " + e.toString());
            return;
        }
        try {
            if (prop.expressionError && prop.expressionError !== "") {
                EXPR_ERRORS.push(where + " : " + prop.expressionError);
            }
        } catch (e2) {}
    }

    function setEaseAt(prop, k, inInf, outInf) {
        try {
            prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        } catch (e0) {}
        for (var n = 1; n <= 3; n++) {
            var a = [], b = [];
            for (var j = 0; j < n; j++) {
                a.push(new KeyframeEase(0, inInf));
                b.push(new KeyframeEase(0, outInf));
            }
            try { prop.setTemporalEaseAtKey(k, a, b); return; } catch (e1) {}
        }
    }
    // list = [[時間, 値], ...]。inInf/outInf を渡すとイージング（無ければリニア）
    function keys(prop, list, inInf, outInf) {
        for (var i = 0; i < list.length; i++) { prop.setValueAtTime(list[i][0], list[i][1]); }
        if (inInf) {
            for (var k = 1; k <= prop.numKeys; k++) { setEaseAt(prop, k, inInf, outInf); }
        }
    }

    // ---------------- エッセンシャルグラフィックス・マーカー ----------------

    function egp(comp, prop, label) {
        try {
            if (prop.canAddToMotionGraphicsTemplate && prop.canAddToMotionGraphicsTemplate(comp)) {
                if (prop.addToMotionGraphicsTemplateAs) {
                    prop.addToMotionGraphicsTemplateAs(comp, label);
                } else {
                    prop.addToMotionGraphicsTemplate(comp);
                }
                return true;
            }
        } catch (e) {}
        return false;
    }
    function egpColor(comp, C, name) { egp(comp, fxp(C, name), name.replace("色:", "色：")); }
    function setTemplateName(comp, name) { try { comp.motionGraphicsTemplateName = name; } catch (e) {} }

    function protect(comp, t, dur, label) {
        try {
            var mv = new MarkerValue(label);
            mv.duration = dur;
            try { mv.protectedRegion = true; } catch (e) {}
            comp.markerProperty.setValueAtTime(t, mv);
        } catch (e2) {}
    }

    // CTRL レイヤー参照の文字列
    function ctrlOf(compName) { return compName ? 'comp(' + q(compName) + ').layer("CTRL")' : 'thisComp.layer("CTRL")'; }

    // =================================================================
    //  ロゴ（円＋4文字）のプリコンポ
    // =================================================================
    function buildLogoComp(pcName, owner, inputLayerName, withGradient) {
        var lc = newComp(pcName, owner.duration, FOLDER_PARTS);
        var CREF = ctrlOf(owner.name);
        var d = LOGO.r * 2;

        // 円（ベースの青）
        var B = newShape(lc, "円（ベース）");
        setXY(B, [0, 0], [0, 0]);
        newGroup(B, "G");
        addEllipse(B, "G", "E", [d, d], [LOGO.cx, LOGO.cy]);
        addFill(B, "G", "F", hex4(COL.blue));
        setExpr(fillColor(B, "G", "F"), CREF + '.effect("色:ブルー")(1)', "ロゴ円");

        if (withGradient) {
            // 登場時のグラデーション（紫 → オレンジ）。上から青に塗り替わっていく
            var tExp = 'var C=' + CREF + ';var T4=C.effect("ロゴ 開始(秒)")(1);var v=clamp((time-T4)/0.8,0,1);v=1-Math.pow(1-v,2);';
            var P = newShape(lc, "円（グラデ 紫）");
            setXY(P, [0, 0], [0, 0]);
            newGroup(P, "G");
            addEllipse(P, "G", "E", [d, d], [LOGO.cx, LOGO.cy]);
            addFill(P, "G", "F", hex4(COL.purple));
            setExpr(fillColor(P, "G", "F"), CREF + '.effect("色:パープル")(1)', "ロゴ紫");
            addLinearWipe(P, "グラデ", 180, 380, tExp + 'linear(v,0,1,29,86)');

            var O = newShape(lc, "円（グラデ オレンジ）");
            setXY(O, [0, 0], [0, 0]);
            newGroup(O, "G");
            addEllipse(O, "G", "E", [d, d], [LOGO.cx, LOGO.cy]);
            addFill(O, "G", "F", hex4(COL.orange));
            setExpr(fillColor(O, "G", "F"), CREF + '.effect("色:オレンジ")(1)', "ロゴ橙");
            addLinearWipe(O, "グラデ", 180, 380, tExp + 'linear(v,0,1,45,100)');
        }

        // 4文字（1文字ずつのレイヤー）
        for (var i = 0; i < 4; i++) {
            var G = addText(lc, TXT.logo.charAt(i) || " ", {
                name: "ロゴ文字" + (i + 1), font: FONT.logo, size: LOGO.glyphSize,
                color: [1, 1, 1], just: ParagraphJustification.CENTER_JUSTIFY
            });
            setXY(G, [0, 0], LOGO.glyph[i]);
            xf(G, "ADBE Scale").setValue([LOGO.glyphScaleX, 100]);
            setExpr(xf(G, "ADBE Anchor Point"), EXP_ANCHOR_CENTER, "ロゴ文字 アンカー");
            setExpr(srcText(G),
                'var s=comp(' + q(owner.name) + ').layer(' + q(inputLayerName) + ').text.sourceText+"";var c=s.charAt(' + i + ');c==""?" ":c',
                "ロゴ文字 テキスト");
            addFillFx(G, CREF + '.effect("色:ロゴ文字")(1)');
        }
        return lc;
    }

    // =================================================================
    //  01 オープニング
    // =================================================================
    function buildOP(N) {
        var comp = newComp(N.op, OP_DUR, FOLDER_MAIN);
        var CR = 'var C=thisComp.layer("CTRL");';

        // ---- CTRL ----
        var C = comp.layers.addNull(OP_DUR);
        C.name = "CTRL";
        addColorCtl(C, "色:ブルー", COL.blue);
        addColorCtl(C, "色:オレンジ", COL.orange);
        addColorCtl(C, "色:レッド", COL.red);
        addColorCtl(C, "色:マゼンタ", COL.magenta);
        addColorCtl(C, "色:パープル", COL.purple);
        addColorCtl(C, "色:ピンク", COL.pink);
        addColorCtl(C, "色:円の白", COL.circleW);
        addColorCtl(C, "色:背景の白", COL.bgWhite);
        addColorCtl(C, "色:ロゴ文字", COL.white);
        addSlider(C, "P1 開始(秒)", T.p1);
        addSlider(C, "P1 広がる速さ(px/秒)", 650);
        addSlider(C, "P2 開始(秒)", T.p2);
        addSlider(C, "P3 開始(秒)", T.p3);
        addSlider(C, "ロゴ 開始(秒)", T.p4);
        addSlider(C, "ロゴ 退場開始(秒)", T.px);
        addSlider(C, "ロゴ 初期サイズ(%)", LOGO.scale0);
        addSlider(C, "ロゴ ズーム(%/秒)", LOGO.zoomPerSec);

        // ---- 入力用（ガイドレイヤー：書き出されません）----
        var IN = addText(comp, TXT.logo, {
            name: "▼ロゴの文字（4文字）", font: FONT.logo, size: 40, color: [0.5, 0.5, 0.5],
            just: ParagraphJustification.LEFT_JUSTIFY
        });
        setXY(IN, [0, 0], [40, 60]);
        IN.guideLayer = true;

        // ---- ヌル ----
        var LN = addNull(comp, "LOGO_NULL（ロゴのズーム）", LOGO.pivot);
        setExpr(xf(LN, "ADBE Scale"),
            CR + 'var T4=C.effect("ロゴ 開始(秒)")(1);var s=C.effect("ロゴ 初期サイズ(%)")(1)+C.effect("ロゴ ズーム(%/秒)")(1)*Math.max(time-T4,0);[s,s]',
            "LOGO_NULL スケール");
        var GN = addNull(comp, "P2_GRID（円のズーム）", [960, 540]);
        setExpr(xf(GN, "ADBE Scale"),
            CR + 'var T2=C.effect("P2 開始(秒)")(1);var p=clamp((time-T2)/0.8,0,1);p=1-Math.pow(1-p,3);var s=linear(p,0,1,100,' + f3(100 / 1.17) + ');[s,s]',
            "P2_GRID スケール");

        // ---- ロゴ下の英字 ----
        var visP4 = CR + 'var T4=C.effect("ロゴ 開始(秒)")(1);var TX=C.effect("ロゴ 退場開始(秒)")(1);time<T4?0:linear(time,TX,TX+0.5,100,0)';
        var subColor = CR + 'var T4=C.effect("ロゴ 開始(秒)")(1);var c0=C.effect("色:オレンジ")(1),c1=C.effect("色:パープル")(1),c2=C.effect("色:ブルー")(1);' +
            'var v=clamp((time-T4)/0.8,0,1);v<0.4?linear(v,0,0.4,c0,c1):linear(v,0.4,1,c1,c2)';

        var RJ = addText(comp, TXT.romaji, {
            name: "ローマ字", font: FONT.latin, size: LOGO.romajiSize, color: hex3(COL.blue),
            just: ParagraphJustification.CENTER_JUSTIFY, tracking: 10
        });
        RJ.parent = LN;
        setXY(RJ, [0, 0], [960, LOGO.romajiY]);
        setExpr(xf(RJ, "ADBE Opacity"), visP4, "ローマ字 不透明度");
        addFillFx(RJ, subColor);

        var DC = addText(comp, TXT.doc, {
            name: "サブタイトル", font: FONT.latin, size: LOGO.docSize, color: hex3(COL.blue),
            just: ParagraphJustification.CENTER_JUSTIFY
        });
        DC.parent = LN;
        setXY(DC, [0, 0], [960, LOGO.docY]);
        setExpr(xf(DC, "ADBE Opacity"), visP4, "サブタイトル 不透明度");
        addFillFx(DC, subColor);

        // ============ P1：白地の円ドーム ============
        var bg1 = comp.layers.addSolid([1, 1, 1], "背景 P1（白）", W, H, 1, OP_DUR);
        addFillFx(bg1, CR + 'C.effect("色:背景の白")(1)');
        setExpr(xf(bg1, "ADBE Opacity"), CR + 'time<C.effect("P2 開始(秒)")(1)?100:0', "背景P1");

        var P1 = { pitch: 131, d: 124, band: 114, base: 1120, rows: 9, ox: 960, oy: 1130, dcx: 960, dcy: 606, dr: 462 };
        var rng1 = makeRng(20261005);
        var r1 = P1.d / 2;
        for (var k = 0; k < P1.rows; k++) {
            var yb = P1.base - P1.band * k, yt = yb - P1.band;
            var RL = newShape(comp, "P1 円の列" + (k + 1));
            setXY(RL, [0, 0], [0, 0]);
            addMask(RL, "帯", rectShape(-60, yt, W + 60, yb), MaskMode.ADD);
            addMask(RL, "ドーム", circleShape(P1.dcx, P1.dcy, P1.dr), MaskMode.INTERSECT);
            setExpr(xf(RL, "ADBE Opacity"), CR + 'time<C.effect("P2 開始(秒)")(1)?100:0', "P1列 不透明度");
            var off = (k % 2) ? 0.5 : 0;
            var yRest = yb - (0.86 * P1.d - r1), yHid = yb + r1 + 2;
            for (var j = -6; j <= 6; j++) {
                var x = P1.ox + (j + off) * P1.pitch;
                var dd = Math.sqrt((x - P1.dcx) * (x - P1.dcx) + (yRest - P1.dcy) * (yRest - P1.dcy));
                if (dd > P1.dr + r1) { continue; }
                var dist = Math.sqrt((x - P1.ox) * (x - P1.ox) + (yRest - P1.oy) * (yRest - P1.oy)) + (rng1() - 0.5) * 70;
                if (dist < 0) { dist = 0; }
                var g = "C" + (j + 7);
                newGroup(RL, g);
                addEllipse(RL, g, "E", [P1.d, P1.d], [0, 0]);
                addFill(RL, g, "F", hex4(COL.orange));
                setExpr(gxf(RL, g, "ADBE Vector Position"),
                    CR + 'var T=C.effect("P1 開始(秒)")(1);var s=Math.max(C.effect("P1 広がる速さ(px/秒)")(1),1);' +
                    'var t0=T+' + f2(dist) + '/s;var p=clamp((time-t0)/0.25,0,1);p=1-Math.pow(1-p,3);' +
                    '[' + f2(x) + ',' + f2(yHid) + '+(' + f2(yRest - yHid) + ')*p]',
                    "P1円 位置");
                setExpr(fillColor(RL, g, "F"),
                    CR + 'var T=C.effect("P1 開始(秒)")(1);var s=Math.max(C.effect("P1 広がる速さ(px/秒)")(1),1);' +
                    'var cb=C.effect("色:ブルー")(1);var cs=[C.effect("色:オレンジ")(1),C.effect("色:レッド")(1),C.effect("色:マゼンタ")(1),C.effect("色:パープル")(1)];' +
                    'cs.push(linear(0.5,0,1,cs[3],cb));cs.push(cb);' +
                    'var R=(time-T-0.33)*s;var v=clamp((R-' + f2(dist) + ')/240,0,1)*(cs.length-1);' +
                    'var i=Math.min(Math.floor(v),cs.length-2);linear(v-i,0,1,cs[i],cs[i+1])',
                    "P1円 色");
            }
        }

        // ============ P2/P3：青地の大きな円 ============
        var bg2 = comp.layers.addSolid(hex3(COL.blue), "背景 P2（青）", W, H, 1, OP_DUR);
        addFillFx(bg2, CR + 'C.effect("色:ブルー")(1)');
        setExpr(xf(bg2, "ADBE Opacity"),
            CR + 'var T2=C.effect("P2 開始(秒)")(1),T4=C.effect("ロゴ 開始(秒)")(1);(time>=T2&&time<T4)?100:0', "背景P2");

        var rows = buildP2Rows(N, RJ.name);
        for (var ri = 0; ri < rows.length; ri++) {
            var RP = comp.layers.add(rows[ri].comp, OP_DUR);
            RP.name = rows[ri].comp.name;
            RP.parent = GN;
            setXY(RP, [rows[ri].w / 2, rows[ri].h / 2], [960, rows[ri].cy]);
            setExpr(xf(RP, "ADBE Opacity"),
                CR + 'var T2=C.effect("P2 開始(秒)")(1),T4=C.effect("ロゴ 開始(秒)")(1);(time>=T2&&time<T4)?100:0', "P2列 不透明度");
        }

        // ============ P4：ロゴ ============
        var bg4 = comp.layers.addSolid([1, 1, 1], "背景 ロゴ（白）", W, H, 1, OP_DUR);
        addFillFx(bg4, CR + 'C.effect("色:背景の白")(1)');
        setExpr(xf(bg4, "ADBE Opacity"), visP4, "背景ロゴ");

        // ロゴの周りの青い円（上に抜けて消える）
        var NB = [
            // x, 帯の上, 帯の下, 開始y, 終了y, 遅れ
            [224, 67, 798, 15, -306, 0.00],
            [1696, 67, 798, -124, -306, 0.02],
            [224, 798, 1529, 630, 425, 0.03],
            [960, 798, 1529, 547, 425, 0.00],
            [1696, 798, 1529, 630, 425, 0.05],
            [960, -664, 67, -210, 440, 0.02]
        ];
        for (var ni = 0; ni < NB.length; ni++) {
            var nb = NB[ni];
            var NL = newShape(comp, "ロゴ周りの円" + (ni + 1));
            NL.parent = LN;
            setXY(NL, [0, 0], [0, 0]);
            addMask(NL, "帯", rectShape(nb[0] - 380, nb[1], nb[0] + 380, nb[2]), MaskMode.ADD);
            newGroup(NL, "G");
            addEllipse(NL, "G", "E", [LOGO.r * 2, LOGO.r * 2], [0, 0]);
            addFill(NL, "G", "F", hex4(COL.blue));
            setExpr(fillColor(NL, "G", "F"), CR + 'C.effect("色:ブルー")(1)', "周りの円 色");
            setExpr(gxf(NL, "G", "ADBE Vector Position"),
                CR + 'var T4=C.effect("ロゴ 開始(秒)")(1);var p=clamp((time-T4-' + f3(nb[5]) + ')/0.45,0,1);p=p*p*(3-2*p);' +
                '[' + nb[0] + ',linear(p,0,1,' + nb[3] + ',' + nb[4] + ')]',
                "周りの円 位置");
            setExpr(xf(NL, "ADBE Opacity"), CR + 'time>=C.effect("ロゴ 開始(秒)")(1)?100:0', "周りの円 不透明度");
        }

        // ロゴ本体（プリコンポ）
        var logoComp = buildLogoComp(uniqueName("_LOGO_OP"), comp, IN.name, true);
        var LP = comp.layers.add(logoComp, OP_DUR);
        LP.name = "ロゴ";
        LP.parent = LN;
        setXY(LP, [960, 540], [960, 540]);
        try { LP.collapseTransformation = true; } catch (eC) {}
        addMask(LP, "ロゴの帯", rectShape(-200, LOGO.ceil, 2120, LOGO.floor), MaskMode.ADD);
        var exitExp = CR + 'var TX=C.effect("ロゴ 退場開始(秒)")(1);var p=clamp((time-TX)/0.45,0,1);var rise=p*p*900;';
        setExpr(maskPath(LP, "ロゴの帯"),
            exitExp + 'var f=clamp((time-TX-0.04)/0.36,0,1);var fl=f*f*740;' +
            'var top=' + LOGO.ceil + '+rise;var bot=Math.max(' + LOGO.floor + '-fl+rise,top);' +
            'createPath([[-200,top],[2120,top],[2120,bot],[-200,bot]],[],[],true)',
            "ロゴ マスク");
        setExpr(xf(LP, "ADBE Position"), exitExp + '[960,540-rise]', "ロゴ 位置");
        setExpr(xf(LP, "ADBE Opacity"), CR + 'time>=C.effect("ロゴ 開始(秒)")(1)?100:0', "ロゴ 不透明度");

        // ---- 並び順の整理 ----
        DC.moveToBeginning();
        RJ.moveToBeginning();
        IN.moveToBeginning();
        C.moveToBeginning();
        GN.moveToEnd();
        LN.moveToEnd();

        // ---- エッセンシャルグラフィックス ----
        egp(comp, srcText(IN), "ロゴの文字（4文字）");
        egp(comp, srcText(RJ), "ローマ字");
        egp(comp, srcText(DC), "サブタイトル");
        var opColors = ["色:ブルー", "色:オレンジ", "色:レッド", "色:マゼンタ", "色:パープル", "色:ピンク", "色:円の白", "色:背景の白", "色:ロゴ文字"];
        for (var ci = 0; ci < opColors.length; ci++) { egpColor(comp, C, opColors[ci]); }
        setTemplateName(comp, "情熱大陸風 オープニング");
        return comp;
    }

    // P2 の円の列（1列＝1プリコンポ。コンポの枠で円が切れる＝帯の表現）
    function buildP2Rows(N, romajiLayerName) {
        var P2 = { pitch: 292, d: 286, band: 253, Z: 1.17, baseB: 667, ks: [-2, -1, 0, 1, 2] };
        var Z = P2.Z;
        var Wp = 3300, Hp = Math.round(P2.band * Z);
        var dp = P2.d * Z, rp = dp / 2;
        var yH = Hp + rp + 3, yR = Hp - (0.84 * dp - rp), yG = -rp - 3;
        var CREF = ctrlOf(N.op);
        var rng = makeRng(7771);
        var out = [];
        for (var ri = 0; ri < P2.ks.length; ri++) {
            var k = P2.ks[ri];
            var B = P2.baseB + P2.band * k;
            var Pb = 540 + (B - 540) * Z;
            var rc = newComp(uniqueName("_P2_ROW_" + (ri + 1)), OP_DUR, FOLDER_PARTS, Wp, Hp);
            rc.bgColor = hex3(COL.blue);
            var off = (((k % 2) + 2) % 2) ? 0.5 : 0;
            var v = ri / (P2.ks.length - 1);
            var n = 0;
            for (var j = -5; j <= 5; j++) {
                var x = 960 + (j + off) * P2.pitch;
                if (x < -145 || x > 2065) { continue; }
                n++;
                var u = Math.min(Math.abs(x - 960) / 1100, 1);
                var aIn = -0.25 + (1 - u) * 0.45 + rng() * 0.08;
                var aCol = aIn + 0.1 + rng() * 0.1;
                var aOut = (1 - u) * 0.3 + v * 0.25 + rng() * 0.04;
                var cx = Wp / 2 + (x - 960) * Z;

                var CL = newShape(rc, "円" + n);
                newGroup(CL, "G");
                addEllipse(CL, "G", "E", [dp, dp], [0, 0]);
                addFill(CL, "G", "F", hex4(COL.orange));
                setXY(CL, [0, 0], [cx, yR]);
                setExpr(xf(CL, "ADBE Position"),
                    'var C=' + CREF + ';var T2=C.effect("P2 開始(秒)")(1);var T3=C.effect("P3 開始(秒)")(1);' +
                    'var tI=T2+(' + f3(aIn) + '),tO=T3+(' + f3(aOut) + ');var y;' +
                    'if(time<tO){var p=clamp((time-tI)/0.3,0,1);p=1-Math.pow(1-p,3);y=linear(p,0,1,' + f2(yH) + ',' + f2(yR) + ');}' +
                    'else{var e=clamp((time-tO)/0.28,0,1);e=e*e*e;y=linear(e,0,1,' + f2(yR) + ',' + f2(yG) + ');}' +
                    '[' + f2(cx) + ',y]',
                    "P2円 位置");
                setExpr(fillColor(CL, "G", "F"),
                    'var C=' + CREF + ';var T2=C.effect("P2 開始(秒)")(1);' +
                    'var c0=C.effect("色:オレンジ")(1),c1=C.effect("色:ピンク")(1),c2=C.effect("色:円の白")(1);' +
                    'var v=clamp((time-(T2+(' + f3(aCol) + ')))/0.3,0,1);' +
                    'v<0.5?linear(v,0,0.5,c0,c1):linear(v,0.5,1,c1,c2)',
                    "P2円 色");

                var TL = addText(rc, TXT.romaji.replace(/[\s\-]+/g, "\r"), {
                    name: "円の文字" + n, font: FONT.latin, size: 38 * Z, color: hex3(COL.blue),
                    just: ParagraphJustification.CENTER_JUSTIFY, leading: 55 * Z, tracking: 10
                });
                TL.parent = CL;
                setXY(TL, [0, 0], [0, -4 * Z]);
                setExpr(xf(TL, "ADBE Anchor Point"), EXP_ANCHOR_CENTER, "円の文字 アンカー");
                setExpr(srcText(TL),
                    'var s=comp(' + q(N.op) + ').layer(' + q(romajiLayerName) + ').text.sourceText+"";s.replace(/[\\s\\-]+/g,"\\r")',
                    "円の文字 テキスト");
                addFillFx(TL, CREF + '.effect("色:ブルー")(1)');
            }
            out.push({ comp: rc, w: Wp, h: Hp, cy: Pb - Hp / 2 });
        }
        return out;
    }

    // =================================================================
    //  02 左上ロゴ（コイン回転）＋ 上部タイトル
    // =================================================================
    function buildCorner(N) {
        var D = 10;
        var comp = newComp(N.corner, D, FOLDER_MAIN);
        var CR = 'var C=thisComp.layer("CTRL");';
        var LX = 153, LY = 111, LR = 56;          // 左上ロゴの中心と半径
        var size0 = LR / LOGO.r * 100;             // プリコンポに対する縮小率（約15.2%）
        var BAR_Y = 105, BAR_H = 80;

        var C = comp.layers.addNull(D);
        C.name = "CTRL";
        addColorCtl(C, "色:ブルー", COL.blue);
        addColorCtl(C, "色:白バー", COL.white);
        addColorCtl(C, "色:タイトル文字", COL.white);
        addColorCtl(C, "色:ロゴ文字", COL.white);
        addCheckbox(C, "上部タイトルを表示", true);
        addCheckbox(C, "最後にロゴも消す", false);
        addSlider(C, "ロゴ サイズ(%)", Math.round(size0 * 100) / 100);
        addSlider(C, "コイン回転(度)", -180);
        addSlider(C, "白バー伸び(%)", 0);
        keys(fxp(C, "コイン回転(度)"), [[0, -180], [0.5, 0]], 45, 15);
        keys(fxp(C, "白バー伸び(%)"), [[0.03, 0], [0.33, 100]], 85, 10);

        var IN = addText(comp, TXT.logo, {
            name: "▼ロゴの文字（4文字）", font: FONT.logo, size: 40, color: [0.5, 0.5, 0.5],
            just: ParagraphJustification.LEFT_JUSTIFY
        });
        setXY(IN, [0, 0], [40, 1040]);
        IN.guideLayer = true;

        var showBar = '*thisComp.layer("CTRL").effect("上部タイトルを表示")(1)';
        var cosExp = CR + 'var a=C.effect("コイン回転(度)")(1);var s=C.effect("ロゴ サイズ(%)")(1);var k=Math.abs(Math.cos(degreesToRadians(a)));';
        var logoOut = 'var o=(C.effect("最後にロゴも消す")(1)==1)?linear(time,thisComp.duration-0.3,thisComp.duration,100,0):100;';

        // --- 裏面（ツヤのある青い円）---
        var BK = newShape(comp, "ロゴ裏面");
        setXY(BK, [LX, LY], [LX, LY]);
        newGroup(BK, "G");
        addEllipse(BK, "G", "E", [LR * 2, LR * 2], [LX, LY]);
        var fl = LY + LR * (LOGO.floor - LOGO.cy) / LOGO.r;
        addRect(BK, "G", "R", [LR * 2 + 20, fl - (LY - LR - 10)], [LX, (fl + (LY - LR - 10)) / 2], 0);
        addMerge(BK, "G", 4);
        addFill(BK, "G", "F", hex4(COL.blue));
        setExpr(fillColor(BK, "G", "F"), CR + 'C.effect("色:ブルー")(1)', "裏面 色");
        setExpr(xf(BK, "ADBE Scale"), cosExp + 'var f=s/' + f3(size0) + '*100;[f*k,f]', "裏面 スケール");
        setExpr(xf(BK, "ADBE Opacity"), cosExp + logoOut + 'Math.cos(degreesToRadians(a))<0?o:0', "裏面 不透明度");

        var HL = newShape(comp, "ロゴ裏面ハイライト");
        HL.parent = BK;
        setXY(HL, [0, 0], [0, 0]);
        newGroup(HL, "G");
        addEllipse(HL, "G", "E", [64, 50], [LX - 16, LY - 12]);
        var gf = gc(HL, "G").addProperty("ADBE Vector Graphic - G-Fill");
        gf.name = "GF";
        gp(HL, "G", "GF").property("ADBE Vector Grad Type").setValue(2);
        gp(HL, "G", "GF").property("ADBE Vector Grad Start Pt").setValue([LX - 16, LY - 12]);
        gp(HL, "G", "GF").property("ADBE Vector Grad End Pt").setValue([LX + 18, LY - 12]);
        HL.blendingMode = BlendingMode.SCREEN;
        xf(HL, "ADBE Opacity").setValue(85);

        // --- 白いバー（左から伸びる）---
        var BW = newShape(comp, "上部バー（白・伸びる）");
        setXY(BW, [0, 0], [0, 0]);
        newGroup(BW, "G");
        addRect(BW, "G", "R", [10, BAR_H], [LX, BAR_Y], BAR_H / 2);
        addFill(BW, "G", "F", hex4(COL.white));
        setExpr(fillColor(BW, "G", "F"), CR + 'C.effect("色:白バー")(1)', "白バー 色");
        setExpr(gp(BW, "G", "R").property("ADBE Vector Rect Size"),
            CR + 'var w=Math.max(C.effect("白バー伸び(%)")(1)/100*1900,0.1);[w,' + BAR_H + ']', "白バー サイズ");
        setExpr(gp(BW, "G", "R").property("ADBE Vector Rect Position"),
            CR + 'var w=Math.max(C.effect("白バー伸び(%)")(1)/100*1900,0.1);[' + LX + '+w/2,' + BAR_Y + ']', "白バー 位置");
        keys(xf(BW, "ADBE Opacity"), [[0.30, 100], [0.50, 0]]);
        setExpr(xf(BW, "ADBE Opacity"), 'value' + showBar, "白バー 不透明度");

        // --- 青いバー ---
        var BB = newShape(comp, "上部バー（青）");
        setXY(BB, [0, 0], [0, 0]);
        newGroup(BB, "G");
        addRect(BB, "G", "R", [1820, BAR_H], [LX + 910, BAR_Y], 0);
        addFill(BB, "G", "F", hex4(COL.blue));
        setExpr(fillColor(BB, "G", "F"), CR + 'C.effect("色:ブルー")(1)', "青バー 色");
        keys(xf(BB, "ADBE Opacity"), [[0.30, 0], [0.70, 100], [D - 0.3, 100], [D, 0]]);
        setExpr(xf(BB, "ADBE Opacity"), 'value' + showBar, "青バー 不透明度");

        // --- タイトル文字 ---
        var TT = addText(comp, TXT.title, {
            name: "上部タイトル", font: FONT.gothic, size: 52, color: [1, 1, 1],
            just: ParagraphJustification.LEFT_JUSTIFY
        });
        setXY(TT, [0, 0], [232, BAR_Y]);
        setExpr(xf(TT, "ADBE Anchor Point"), EXP_ANCHOR_LEFTMID, "タイトル アンカー");
        addFillFx(TT, CR + 'C.effect("色:タイトル文字")(1)');
        keys(xf(TT, "ADBE Opacity"), [[0.33, 0], [0.70, 100], [D - 0.3, 100], [D, 0]]);
        setExpr(xf(TT, "ADBE Opacity"), 'value' + showBar, "タイトル 不透明度");

        // --- 表面（ロゴのプリコンポ）---
        var logoComp = buildLogoComp(uniqueName("_LOGO_CORNER"), comp, IN.name, false);
        var FR = comp.layers.add(logoComp, D);
        FR.name = "ロゴ表面";
        setXY(FR, [LOGO.cx, LOGO.cy], [LX, LY]);
        try { FR.collapseTransformation = true; } catch (eC) {}
        addMask(FR, "平らな下", rectShape(-200, -200, 2120, LOGO.floor), MaskMode.ADD);
        setExpr(xf(FR, "ADBE Scale"), cosExp + '[s*k,s]', "表面 スケール");
        setExpr(xf(FR, "ADBE Opacity"), cosExp + logoOut + 'Math.cos(degreesToRadians(a))>=0?o:0', "表面 不透明度");

        // 並び順
        IN.moveToBeginning();
        C.moveToBeginning();

        egp(comp, srcText(TT), "上部タイトル");
        egp(comp, srcText(IN), "ロゴの文字（4文字）");
        egp(comp, fxp(C, "上部タイトルを表示"), "上部タイトルを表示");
        egp(comp, fxp(C, "最後にロゴも消す"), "最後にロゴも消す");
        egpColor(comp, C, "色:ブルー");
        egpColor(comp, C, "色:白バー");
        egpColor(comp, C, "色:タイトル文字");
        egpColor(comp, C, "色:ロゴ文字");
        egp(comp, fxp(C, "ロゴ サイズ(%)"), "ロゴ サイズ(%)");
        setTemplateName(comp, "情熱大陸風 ロゴ＋上部タイトル");
        protect(comp, 0, 0.75, "IN（伸ばしても変わらない）");
        protect(comp, D - 0.35, 0.35, "OUT（伸ばしても変わらない）");
        return comp;
    }

    // =================================================================
    //  03 下部テロップ
    // =================================================================
    function buildBottom(N) {
        var D = 8;
        var comp = newComp(N.bottom, D, FOLDER_MAIN);
        var CR = 'var C=thisComp.layer("CTRL");';
        var BY = 977, BH = 80;

        var C = comp.layers.addNull(D);
        C.name = "CTRL";
        addColorCtl(C, "色:ブルー", COL.blue);
        addColorCtl(C, "色:白バー", COL.white);
        addColorCtl(C, "色:文字", COL.white);
        addSlider(C, "白バー伸び(%)", 0);
        keys(fxp(C, "白バー伸び(%)"), [[0.07, 0], [0.55, 100]], 85, 10);

        var BB = newShape(comp, "下部バー（青）");
        setXY(BB, [0, 0], [0, 0]);
        newGroup(BB, "G");
        addRect(BB, "G", "R", [2200, BH], [960, BY], 0);
        addFill(BB, "G", "F", hex4(COL.blue));
        setExpr(fillColor(BB, "G", "F"), CR + 'C.effect("色:ブルー")(1)', "下部青 色");
        keys(xf(BB, "ADBE Opacity"), [[0.55, 0], [0.85, 100], [D - 0.3, 100], [D, 0]]);

        var BW = newShape(comp, "下部バー（白・伸びる）");
        setXY(BW, [0, 0], [0, 0]);
        newGroup(BW, "G");
        addRect(BW, "G", "R", [10, BH], [2000, BY], BH / 2);
        addFill(BW, "G", "F", hex4(COL.white));
        setExpr(fillColor(BW, "G", "F"), CR + 'C.effect("色:白バー")(1)', "下部白 色");
        setExpr(gp(BW, "G", "R").property("ADBE Vector Rect Size"),
            CR + 'var w=Math.max(C.effect("白バー伸び(%)")(1)/100*2200,0.1);[w,' + BH + ']', "下部白 サイズ");
        setExpr(gp(BW, "G", "R").property("ADBE Vector Rect Position"),
            CR + 'var w=Math.max(C.effect("白バー伸び(%)")(1)/100*2200,0.1);[2000-w/2,' + BY + ']', "下部白 位置");
        keys(xf(BW, "ADBE Opacity"), [[0.55, 100], [0.72, 0]]);

        var TX = addText(comp, TXT.bottom, {
            name: "下部テロップ", font: FONT.gothic, size: 56, color: [1, 1, 1],
            just: ParagraphJustification.RIGHT_JUSTIFY
        });
        setXY(TX, [0, 0], [1830, BY]);
        setExpr(xf(TX, "ADBE Anchor Point"), EXP_ANCHOR_RIGHTMID, "下部テロップ アンカー");
        addFillFx(TX, CR + 'C.effect("色:文字")(1)');
        keys(xf(TX, "ADBE Opacity"), [[0.58, 0], [0.85, 100], [D - 0.3, 100], [D, 0]]);

        C.moveToBeginning();

        egp(comp, srcText(TX), "下部テロップ");
        egpColor(comp, C, "色:ブルー");
        egpColor(comp, C, "色:白バー");
        egpColor(comp, C, "色:文字");
        setTemplateName(comp, "情熱大陸風 下部テロップ");
        protect(comp, 0, 0.9, "IN（伸ばしても変わらない）");
        protect(comp, D - 0.35, 0.35, "OUT（伸ばしても変わらない）");
        return comp;
    }

    // =================================================================
    //  04 名前テロップ
    // =================================================================
    function buildName(N) {
        var D = 8;
        var comp = newComp(N.name, D, FOLDER_MAIN);
        var CR = 'var C=thisComp.layer("CTRL");';
        var out = [[D - 0.3, 100], [D, 0]];

        var C = comp.layers.addNull(D);
        C.name = "CTRL";
        addColorCtl(C, "色:帯", COL.blue);
        addColorCtl(C, "色:箱", COL.white);
        addColorCtl(C, "色:名前の文字", COL.ink);
        addColorCtl(C, "色:帯の文字", COL.white);
        addSlider(C, "帯の高さ(%)", 0);
        addSlider(C, "帯の色(%)", 0);
        keys(fxp(C, "帯の高さ(%)"), [[0.53, 0], [0.73, 100]], 80, 10);
        keys(fxp(C, "帯の色(%)"), [[0.73, 0], [1.03, 100]], 60, 40);

        // 帯（白い箱の後ろから上に伸びる → 白から青に変わる）
        var BD = newShape(comp, "帯");
        setXY(BD, [0, 0], [0, 0]);
        newGroup(BD, "G");
        addRect(BD, "G", "R", [916, 124], [1642, 838], 40);
        addFill(BD, "G", "F", hex4(COL.blue));
        setExpr(gp(BD, "G", "R").property("ADBE Vector Rect Size"),
            CR + 'var p=C.effect("帯の高さ(%)")(1)/100;[916,58+66*p]', "帯 サイズ");
        setExpr(gp(BD, "G", "R").property("ADBE Vector Rect Position"),
            CR + 'var p=C.effect("帯の高さ(%)")(1)/100;[1642,(842-66*p+900)/2]', "帯 位置");
        setExpr(fillColor(BD, "G", "F"),
            CR + 'var p=C.effect("帯の色(%)")(1)/100;linear(p,0,1,C.effect("色:箱")(1),C.effect("色:帯")(1))', "帯 色");
        keys(xf(BD, "ADBE Opacity"), out);

        // 白い箱
        var BX = newShape(comp, "白い箱");
        setXY(BX, [0, 0], [0, 0]);
        newGroup(BX, "G");
        addRect(BX, "G", "R", [868, 178], [1586, 931], 0);
        addFill(BX, "G", "F", hex4(COL.white));
        setExpr(fillColor(BX, "G", "F"), CR + 'C.effect("色:箱")(1)', "箱 色");
        keys(xf(BX, "ADBE Opacity"), [[0, 0], [0.17, 100], [D - 0.3, 100], [D, 0]]);

        var NM = addText(comp, TXT.name, {
            name: "名前", font: FONT.brush, size: 72, color: hex3(COL.ink),
            just: ParagraphJustification.LEFT_JUSTIFY, tracking: 60
        });
        setXY(NM, [0, 0], [1284, 911]);
        addFillFx(NM, CR + 'C.effect("色:名前の文字")(1)');
        keys(xf(NM, "ADBE Opacity"), [[0.20, 0], [0.53, 100], [D - 0.3, 100], [D, 0]]);

        var SB = addText(comp, TXT.sub, {
            name: "所属・2行目", font: FONT.brush, size: 78, color: hex3(COL.ink),
            just: ParagraphJustification.LEFT_JUSTIFY, tracking: 40
        });
        setXY(SB, [0, 0], [1237, 1001]);
        addFillFx(SB, CR + 'C.effect("色:名前の文字")(1)');
        keys(xf(SB, "ADBE Opacity"), [[0.20, 0], [0.53, 100], [D - 0.3, 100], [D, 0]]);

        var BT = addText(comp, TXT.band, {
            name: "帯の文字", font: FONT.mincho, size: 36, color: [1, 1, 1],
            just: ParagraphJustification.LEFT_JUSTIFY, tracking: 20
        });
        setXY(BT, [0, 0], [1246, 823]);
        addFillFx(BT, CR + 'C.effect("色:帯の文字")(1)');
        keys(xf(BT, "ADBE Opacity"), [[0.73, 0], [1.03, 100], [D - 0.3, 100], [D, 0]]);

        C.moveToBeginning();

        egp(comp, srcText(NM), "名前");
        egp(comp, srcText(SB), "所属・2行目");
        egp(comp, srcText(BT), "帯の文字");
        egpColor(comp, C, "色:帯");
        egpColor(comp, C, "色:箱");
        egpColor(comp, C, "色:名前の文字");
        egpColor(comp, C, "色:帯の文字");
        setTemplateName(comp, "情熱大陸風 名前テロップ");
        protect(comp, 0, 1.1, "IN（伸ばしても変わらない）");
        protect(comp, D - 0.35, 0.35, "OUT（伸ばしても変わらない）");
        return comp;
    }

    // =================================================================
    //  MOGRT 書き出し
    // =================================================================
    function exportMogrts(list) {
        var folder = Folder.selectDialog("MOGRT（Premiere 用テンプレート）の保存先フォルダを選んでください");
        if (folder === null) { return "MOGRT の書き出しはキャンセルされました。"; }
        var okNames = [], ngNames = [];
        for (var i = 0; i < list.length; i++) {
            var c = list[i].comp;
            var path = folder.fsName + "/" + list[i].file + ".mogrt";
            var ok = false;
            try { ok = c.exportAsMotionGraphicsTemplate(true, path); } catch (e) { ok = false; }
            if (ok) { okNames.push(list[i].file + ".mogrt"); } else { ngNames.push(c.name); }
        }
        var msg = "";
        if (okNames.length) { msg += "MOGRT を書き出しました：\n  " + okNames.join("\n  ") + "\n保存先：" + folder.fsName + "\n"; }
        if (ngNames.length) {
            msg += "\n自動で書き出せなかったコンポ：\n  " + ngNames.join("\n  ") +
                "\n→ コンポを開き、エッセンシャルグラフィックスパネルの「モーショングラフィックステンプレートを書き出し」から書き出してください。\n";
        }
        return msg;
    }

    // =================================================================
    //  メイン
    // =================================================================
    function main() {
        if (parseFloat(app.version) < 15.0) {
            alert("After Effects CC 2018（15.0）以降で実行してください。");
            return;
        }
        if (!app.project) { app.newProject(); }
        var fresh = (app.project.numItems === 0);

        app.beginUndoGroup("情熱大陸風テンプレートを作成");
        try { app.beginSuppressDialogs(); } catch (eS) {}
        if (fresh) { try { app.project.expressionEngine = "javascript-1.0"; } catch (eE) {} }

        FOLDER_MAIN = app.project.items.addFolder(uniqueName("情熱大陸風テンプレート"));
        FOLDER_PARTS = app.project.items.addFolder("_パーツ（触らなくてOK）");
        FOLDER_PARTS.parentFolder = FOLDER_MAIN;

        var N = {
            op: uniqueName("01_OP_オープニング"),
            corner: uniqueName("02_ロゴ＋上部タイトル"),
            bottom: uniqueName("03_下部テロップ"),
            name: uniqueName("04_名前テロップ")
        };

        var op = buildOP(N);
        var corner = buildCorner(N);
        var bottom = buildBottom(N);
        var nameT = buildName(N);

        try { app.endSuppressDialogs(false); } catch (eS2) {}
        app.endUndoGroup();

        try { op.openInViewer(); } catch (eV) {}

        var msg = "情熱大陸風テンプレートを作成しました！\n\n" +
            "・" + op.name + "\n・" + corner.name + "\n・" + bottom.name + "\n・" + nameT.name + "\n\n" +
            "色や文字は各コンポの「CTRL」レイヤー／エッセンシャルグラフィックスで変更できます。\n";
        if (EXPR_ERRORS.length) {
            msg += "\n※ エクスプレッションの警告が " + EXPR_ERRORS.length + " 件ありました：\n" + EXPR_ERRORS.slice(0, 8).join("\n") + "\n";
        }
        alert(msg);

        if (confirm("続けて、Premiere Pro 用の MOGRT（モーショングラフィックステンプレート）を書き出しますか？\n（保存先フォルダを選びます）")) {
            var res = exportMogrts([
                { comp: op, file: "情熱大陸風_01_オープニング" },
                { comp: corner, file: "情熱大陸風_02_ロゴ上部タイトル" },
                { comp: bottom, file: "情熱大陸風_03_下部テロップ" },
                { comp: nameT, file: "情熱大陸風_04_名前テロップ" }
            ]);
            alert(res + "\n最後に、このプロジェクトを保存（ファイル → 保存）しておくと、あとから AE で編集できます。");
        }
    }

    main();

})();
