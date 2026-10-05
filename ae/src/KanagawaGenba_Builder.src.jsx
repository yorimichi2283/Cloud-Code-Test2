// =====================================================================
//  「かながわの現場」オープニング＆テロップ 自動生成スクリプト（After Effects 用）
//
//  使い方：
//    After Effects → ファイル → スクリプト → スクリプトファイルを実行…
//    → このファイル（KanagawaGenba_Builder.jsx）を選ぶ
//    ※ ロゴ画像はこのファイルの中に入っています（別ファイル不要）。
//      実行すると「書類（Documents）/KanagawaGenba_Assets」に書き出して読み込みます。
//
//  作られるコンポジション：
//    01_OP_オープニング       … 点→線→ロゴが跳ねて登場 → 円形に広がる穴から次のシーンへ（5秒）
//                                 最後にロゴは左上の丸いバッジに収まる
//    02_左上ロゴ＋上部タイトル … OP の最後と同じ位置の左上ロゴ＋上部タイトル
//    03_下部テロップ          … 画面下中央のテロップ
//    04_名前テロップ          … 左下の名前テロップ（丸＋ピン、名前、肩書きタグ、所属）
//
//  色・文字：各コンポの「CTRL」レイヤーのエフェクト、または
//            エッセンシャルグラフィックス（Premiere で編集できる項目）で変更。
//  動き　　：各レイヤーのキーフレーム、または CTRL のスライダーのキーフレームで調整。
// =====================================================================

(function KanagawaGenbaBuilder() {

    // =================================================================
    //  設定（ここを書き換えて再実行すると初期値が変わります）
    // =================================================================

    var W = 1920, H = 1080, FPS = 29.97;

    var COL = {
        cyan:  "#069DD4",   // ロゴの水色（ひらがな・アクセント）
        black: "#141414",   // ロゴの黒（漢字・帯）
        white: "#FFFFFF",
        soft:  "#E3F4FB"    // 背景にふわふわ浮かぶ丸
    };

    var TXT = {
        title:  "ここに上部タイトルが入ります",
        bottom: "ここに下部テロップが入ります",
        role:   "肩書き　2026.10.5",
        name:   "山田　太郎",
        org:    "株式会社〇〇"
    };

    // フォント（PostScript名。上から順に、入っているものが使われます）
    var FONT = {
        bold:   pickFont(["HiraginoSans-W7", "HiraKakuStdN-W8", "HiraKakuProN-W6", "NotoSansJP-Bold", "KozGoPr6N-Bold", "YuGothic-Bold"], "HiraginoSans-W7"),
        medium: pickFont(["HiraginoSans-W5", "HiraKakuProN-W3", "NotoSansJP-Medium", "KozGoPr6N-Medium", "YuGothic-Medium"], "HiraginoSans-W5")
    };

    // ロゴ（素材画像の座標系＝元画像のピクセル）
    var LOGO_CENTER = [999, 963.5];  // ロゴ全体の中心
    var LOGO_SPLIT_Y = 727;          // 「かながわの」と「現場」の間の線
    var LOGO_W = 1570;               // ロゴ全体の幅（素材のピクセル）
    var OP_LOGO_SCALE = 52;          // OP でのロゴの大きさ（%）。52% で画面幅の約4割
    var OP_DUR = 5.0;
    // Premiere での名前（＝書き出す .mogrt のファイル名）
    var MOGRT_NAMES = {
        op: "かながわの現場_01_オープニング",
        corner: "かながわの現場_02_左上ロゴ上部タイトル",
        bottom: "かながわの現場_03_下部テロップ",
        name: "かながわの現場_04_名前テロップ"
    };
    var HIRA_T0 = 0.40, HIRA_STEP = 0.07;    // 「かながわの」が跳ね出す開始時間と1文字ごとの間隔
    var KANJI_T0 = 0.70, KANJI_STEP = 0.10;  // 「現場」が落ちてくる開始時間と間隔

    // 左上ロゴ（OP の最後と 02 のコンポで同じ値を使います）
    var CORNER_POS = [141, 141];     // 左上ロゴ（丸いバッジ）の中心
    var CORNER_LOGO_W = 150;         // 左上ロゴの文字の幅（画面上のピクセル）
    var PLATE = { w: 210, h: 210, r: 105, stroke: 4 }; // 左上の丸いバッジ（直径 210px。r＝角の丸み＝半径で正円、stroke＝縁の太さ）
    var CORNER_SIZE = Math.round(CORNER_LOGO_W / (LOGO_W * OP_LOGO_SCALE / 100) * 10000) / 100; // OP のロゴに対する大きさ（%）
    var OP_LOGO_PX = LOGO_W * OP_LOGO_SCALE / 100;  // OP でのロゴの幅（画面上のピクセル）

    // =================================================================
    //  ロゴ画像（ビルド時に埋め込まれます）
    // =================================================================
    var ASSETS = /*@@ASSETS@@*/null;

    // =================================================================
    //  ここから下はプログラム本体です
    // =================================================================

    var EXPR_ERRORS = [];
    var FOLDER_MAIN = null, FOLDER_PARTS = null;
    var FOOTAGE = {};   // name -> FootageItem

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
    function f2(n) { return String(Math.round(n * 100) / 100); }
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
        c.bgColor = [0.5, 0.5, 0.5];
        try { c.motionBlur = true; } catch (e) {}
        if (folder) { c.parentFolder = folder; }
        return c;
    }

    // ---------------- 素材の書き出しと読み込み ----------------

    function writeAssets() {
        var base = null;
        var tries = [];
        try { tries.push(Folder.myDocuments.fsName + "/KanagawaGenba_Assets"); } catch (e0) {}
        try { tries.push(Folder.userData.fsName + "/KanagawaGenba_Assets"); } catch (e1) {}
        try { tries.push(Folder.temp.fsName + "/KanagawaGenba_Assets"); } catch (e2) {}
        for (var t = 0; t < tries.length && base === null; t++) {
            try {
                var fd = new Folder(tries[t]);
                if (!fd.exists) { fd.create(); }
                if (fd.exists) { base = fd; }
            } catch (e3) {}
        }
        if (base === null) { throw new Error("ロゴ画像の保存フォルダを作成できませんでした。\n" + PREF_MSG); }
        for (var i = 0; i < ASSETS.length; i++) {
            var a = ASSETS[i];
            var f = new File(base.fsName + "/" + a.file);
            f.encoding = "BINARY";
            var opened = false;
            try { opened = f.open("w"); } catch (e4) { opened = false; }
            if (!opened) { throw new Error("ロゴ画像を書き出せませんでした：" + f.fsName + "\n" + PREF_MSG); }
            f.write(a.data);
            f.close();
            var item = app.project.importFile(new ImportOptions(f));
            item.parentFolder = FOLDER_PARTS;
            FOOTAGE[a.name] = item;
        }
        return base.fsName;
    }
    function glyphs(row) {
        var out = [];
        for (var i = 0; i < ASSETS.length; i++) { if (!row || ASSETS[i].row === row) { out.push(ASSETS[i]); } }
        return out;
    }

    // ---------------- レイヤー ----------------

    function xf(L, m) { return L.property("ADBE Transform Group").property(m); }
    function setXY(L, anchor, pos) {
        xf(L, "ADBE Anchor Point").setValue(anchor);
        xf(L, "ADBE Position").setValue(pos);
    }
    function addNull(comp, name, anchor, pos) {
        var n = comp.layers.addNull(comp.duration);
        n.name = name;
        setXY(n, anchor, pos);
        return n;
    }
    // 親子付け。AE の「.parent =」は見た目を保つために子の大きさ・位置を自動補正してしまうので、
    // 補正なしの setParentWithJump を使う（使えない古い版では補正を元に戻す）
    function parentTo(child, par) {
        try { child.setParentWithJump(par); return; } catch (e) {}
        child.parent = par;
        try { xf(child, "ADBE Scale").setValue([100, 100]); } catch (e1) {}
        try { xf(child, "ADBE Rotate Z").setValue(0); } catch (e2) {}
    }
    function srcText(L) { return L.property("ADBE Text Properties").property("ADBE Text Document"); }
    function blur(L) { try { L.motionBlur = true; } catch (e) {} }

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
        td.text = str;
        try {
            td.font = o.font;
            tp.setValue(td);
        } catch (e4) {
            td = tp.value;
            td.text = str;
            tp.setValue(td);
        }
        return L;
    }
    var EXP_ANCHOR_LEFTMID = "var r=sourceRectAtTime(time,false);[r.left,r.top+r.height/2]";
    var EXP_ANCHOR_CENTER = "var r=sourceRectAtTime(time,false);[r.left+r.width/2,r.top+r.height/2]";

    // ---------------- シェイプ ----------------

    function root(L) { return L.property("ADBE Root Vectors Group"); }
    function newGroup(L, g) { var p = root(L).addProperty("ADBE Vector Group"); p.name = g; }
    function gc(L, g) { return root(L).property(g).property("ADBE Vectors Group"); }
    function gp(L, g, name) { return gc(L, g).property(name); }
    function addRect(L, g, name, size, pos, round) {
        var p = gc(L, g).addProperty("ADBE Vector Shape - Rect");
        p.name = name;
        p.property("ADBE Vector Rect Size").setValue(size);
        p.property("ADBE Vector Rect Position").setValue(pos);
        p.property("ADBE Vector Rect Roundness").setValue(round || 0);
    }
    function addFill(L, g, name, color) {
        var p = gc(L, g).addProperty("ADBE Vector Graphic - Fill");
        p.name = name;
        p.property("ADBE Vector Fill Color").setValue(color);
    }
    function rectSize(L, g) { return gp(L, g, "R").property("ADBE Vector Rect Size"); }
    function rectPos(L, g) { return gp(L, g, "R").property("ADBE Vector Rect Position"); }
    function fillColor(L, g) { return gp(L, g, "F").property("ADBE Vector Fill Color"); }
    function gxf(L, g, m) { return root(L).property(g).property("ADBE Vector Transform Group").property(m); }
    function addEllipse(L, g, name, size, pos) {
        var p = gc(L, g).addProperty("ADBE Vector Shape - Ellipse");
        p.name = name;
        p.property("ADBE Vector Ellipse Size").setValue(size);
        p.property("ADBE Vector Ellipse Position").setValue(pos);
    }
    function addPath(L, g, name, verts) {
        var p = gc(L, g).addProperty("ADBE Vector Shape - Group");
        p.name = name;
        var s = new Shape();
        s.vertices = verts;
        s.closed = true;
        p.property("ADBE Vector Shape").setValue(s);
    }
    function addStroke(L, g, name, color, width) {
        var p = gc(L, g).addProperty("ADBE Vector Graphic - Stroke");
        p.name = name;
        p.property("ADBE Vector Stroke Color").setValue(color);
        p.property("ADBE Vector Stroke Width").setValue(width);
    }
    // 長方形1つだけのシェイプレイヤー（座標＝コンポ座標）
    function rectLayer(comp, name, size, pos, round, hex) {
        var L = comp.layers.addShape();
        L.name = name;
        setXY(L, [0, 0], [0, 0]);
        newGroup(L, "G");
        addRect(L, "G", "R", size, pos, round);
        addFill(L, "G", "F", hex4(hex));
        return L;
    }

    // ---------------- マスク ----------------

    function rectShape(x1, y1, x2, y2) {
        var s = new Shape();
        s.vertices = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
        s.closed = true;
        return s;
    }
    function addMask(L, name, shape, mode) {
        var m = L.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.name = name;
        m.maskMode = mode || MaskMode.ADD;
        m.property("ADBE Mask Shape").setValue(shape);
    }
    function maskPath(L, name) { return L.property("ADBE Mask Parade").property(name).property("ADBE Mask Shape"); }

    // ---------------- エフェクト ----------------

    function fxGroup(L) { return L.property("ADBE Effect Parade"); }
    function addCtl(L, match, name, v) {
        var e = fxGroup(L).addProperty(match);
        e.name = name;
        fxGroup(L).property(name).property(1).setValue(v);
    }
    function addSlider(L, name, v) { addCtl(L, "ADBE Slider Control", name, v); }
    function addColorCtl(L, name, h) { addCtl(L, "ADBE Color Control", name, hex4(h)); }
    function addCheckbox(L, name, on) { addCtl(L, "ADBE Checkbox Control", name, on ? 1 : 0); }
    function addPoint(L, name, v) { addCtl(L, "ADBE Point Control", name, v); }
    function fxp(L, name) { return fxGroup(L).property(name).property(1); }

    function colorParamOf(eff) {
        for (var i = 1; i <= eff.numProperties; i++) {
            var p = eff.property(i);
            try { if (p.propertyValueType === PropertyValueType.COLOR) { return p; } } catch (e) {}
        }
        return null;
    }
    // 「塗り」エフェクトで色を付け、その色を CTRL の色とつなぐ
    function addFillFx(L, exprStr) {
        var e = fxGroup(L).addProperty("ADBE Fill");
        e.name = "塗り（色）";
        var p = colorParamOf(fxGroup(L).property("塗り（色）"));
        if (p !== null) { setExpr(p, exprStr, L.name + " / 塗り"); }
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
            if (prop.expressionError && prop.expressionError !== "") { EXPR_ERRORS.push(where + " : " + prop.expressionError); }
        } catch (e2) {}
    }
    function setEaseAt(prop, k, inInf, outInf) {
        try { prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER); } catch (e0) {}
        for (var n = 1; n <= 3; n++) {
            var a = [], b = [];
            for (var j = 0; j < n; j++) { a.push(new KeyframeEase(0, inInf)); b.push(new KeyframeEase(0, outInf)); }
            try { prop.setTemporalEaseAtKey(k, a, b); return; } catch (e1) {}
        }
    }
    // list = [[時間, 値], ...]。inInf/outInf を渡すとイージング（無ければリニア）
    function keys(prop, list, inInf, outInf) {
        for (var i = 0; i < list.length; i++) { prop.setValueAtTime(list[i][0], list[i][1]); }
        if (inInf) { for (var k = 1; k <= prop.numKeys; k++) { setEaseAt(prop, k, inInf, outInf); } }
    }

    // ---------------- エッセンシャルグラフィックス・マーカー ----------------

    function egp(comp, prop, label) {
        try {
            if (prop.canAddToMotionGraphicsTemplate && prop.canAddToMotionGraphicsTemplate(comp)) {
                if (prop.addToMotionGraphicsTemplateAs) { prop.addToMotionGraphicsTemplateAs(comp, label); }
                else { prop.addToMotionGraphicsTemplate(comp); }
                return true;
            }
        } catch (e) {}
        return false;
    }
    function egpFx(comp, C, name) { egp(comp, fxp(C, name), name.replace("色:", "色：")); }
    function setTemplateName(comp, name) { try { comp.motionGraphicsTemplateName = name; } catch (e) {} }
    function protect(comp, t, dur, label) {
        try {
            var mv = new MarkerValue(label);
            mv.duration = dur;
            try { mv.protectedRegion = true; } catch (e) {}
            comp.markerProperty.setValueAtTime(t, mv);
        } catch (e2) {}
    }

    var CR = 'var C=thisComp.layer("CTRL");';

    // =================================================================
    //  テロップ共通パーツ
    // =================================================================

    // 丸（＋位置ピンのマーク）。中心 (cx,cy)、直径 h。コンポ座標で描き、中心で拡大縮小できる
    function addDot(comp, name, cx, cy, h, dotColor, pinColor) {
        var L = comp.layers.addShape();
        L.name = name;
        setXY(L, [cx, cy], [cx, cy]);
        if (pinColor) {
            var hy = cy - 0.07 * h;
            newGroup(L, "HOLE");
            addEllipse(L, "HOLE", "E", [0.15 * h, 0.15 * h], [cx, hy]);
            addFill(L, "HOLE", "F", hex4(COL.cyan));
            setExpr(fillColor(L, "HOLE"), CR + 'C.effect(' + q(dotColor) + ')(1)', name + " 穴");
            newGroup(L, "PIN");
            addEllipse(L, "PIN", "E", [0.38 * h, 0.38 * h], [cx, hy]);
            addPath(L, "PIN", "P", [[cx - 0.165 * h, hy + 0.09 * h], [cx + 0.165 * h, hy + 0.09 * h], [cx, cy + 0.31 * h]]);
            addFill(L, "PIN", "F", hex4(COL.white));
            setExpr(fillColor(L, "PIN"), CR + 'C.effect(' + q(pinColor) + ')(1)', name + " ピン");
        }
        newGroup(L, "DOT");
        addEllipse(L, "DOT", "E", [h, h], [cx, cy]);
        addFill(L, "DOT", "F", hex4(COL.cyan));
        setExpr(fillColor(L, "DOT"), CR + 'C.effect(' + q(dotColor) + ')(1)', name + " 色");
        blur(L);
        return L;
    }
    // 丸がポンと出て、最後にポンと消える
    function popKeys(L, tIn, D) {
        var E = D - 1 / FPS;   // 最後に描画されるコマ
        keys(xf(L, "ADBE Scale"), [[tIn, [0, 0]], [tIn + 0.14, [118, 118]], [tIn + 0.26, [100, 100]],
            [E - 0.2, [100, 100]], [E - 0.1, [118, 118]], [E, [0, 0]]], 50, 40);
    }
    // 帯の伸び（少し行き過ぎて戻る）
    function barKeys(prop, tIn, tOut, D) {
        keys(prop, [[tIn, 0], [tIn + 0.32, 104], [tIn + 0.42, 100], [D - tOut, 100], [D - tOut + 0.28, 0]], 75, 25);
    }

    // カプセル型の帯（文字の長さに合わせて伸びる）＋帯の中から現れる文字
    //  o = { name, text, font, size, textColor, boxColor (CTRL の色の名前),
    //        x (帯の左端 / 中央), y (帯の中心), h, padL, padR,
    //        grow: "left" | "center", slider (帯の伸び %) }
    function makeBar(comp, o) {
        var T = addText(comp, o.text, {
            name: o.name, font: o.font, size: o.size, color: [1, 1, 1],
            just: ParagraphJustification.LEFT_JUSTIFY
        });
        var wExp = 'var r=thisComp.layer(' + q(o.name) + ').sourceRectAtTime(time,false);' +
            'var p=Math.max(thisComp.layer("CTRL").effect(' + q(o.slider) + ')(1)/100,0);' +
            'var w=(r.width+' + o.padL + '+' + o.padR + ')*p;';
        var xL = (o.grow === "center") ? 'var x0=' + o.x + '-w/2;' : 'var x0=' + o.x + ';';

        var B = comp.layers.addShape();
        B.name = o.name + "（帯）";
        setXY(B, [0, 0], [0, 0]);
        newGroup(B, "G");
        addRect(B, "G", "R", [100, o.h], [o.x, o.y], o.h / 2);
        addFill(B, "G", "F", hex4(COL.black));
        setExpr(rectSize(B, "G"), wExp + '[Math.max(w,0.01),' + o.h + ']', B.name + " サイズ");
        setExpr(rectPos(B, "G"), wExp + xL + '[x0+w/2,' + o.y + ']', B.name + " 位置");
        setExpr(fillColor(B, "G"), CR + 'C.effect(' + q(o.boxColor) + ')(1)', B.name + " 色");
        blur(B);

        T.moveBefore(B);
        if (o.grow === "center") {
            setXY(T, [0, 0], [o.x + (o.padL - o.padR) / 2, o.y]);
            setExpr(xf(T, "ADBE Anchor Point"), EXP_ANCHOR_CENTER, o.name + " アンカー");
        } else {
            setXY(T, [0, 0], [o.x + o.padL, o.y]);
            setExpr(xf(T, "ADBE Anchor Point"), EXP_ANCHOR_LEFTMID, o.name + " アンカー");
        }
        addFillFx(T, CR + 'C.effect(' + q(o.textColor) + ')(1)');
        addMask(T, "帯の中だけ表示", rectShape(0, 0, 10, 10), MaskMode.ADD);
        setExpr(maskPath(T, "帯の中だけ表示"),
            wExp + xL + 'var y0=' + (o.y - o.h / 2) + ',y1=' + (o.y + o.h / 2) + ';' +
            'createPath([fromComp([x0,y0]),fromComp([x0+w,y0]),fromComp([x0+w,y1]),fromComp([x0,y1])],[],[],true)',
            o.name + " マスク");
        return { text: T, box: B, wExp: wExp };
    }
    // 文字の出入り（dir: "left"＝左からスライド / "up"＝下から上がる）
    function textMotion(T, tIn, tOut, D, dir) {
        var p = xf(T, "ADBE Position");
        var v = p.value;
        var from = (dir === "left") ? [v[0] - 28, v[1]] : [v[0], v[1] + 20];
        keys(p, [[tIn, from], [tIn + 0.36, [v[0], v[1]]]], 80, 15);
        keys(xf(T, "ADBE Opacity"), [[tIn, 0], [tIn + 0.2, 100], [D - tOut, 100], [D - tOut + 0.18, 0]]);
    }

    // =================================================================
    //  ロゴの文字プリコンポ（OP 用。文字ごとに跳ねる・着地する）
    // =================================================================
    function buildGlyphComp(name, row) {
        var c = newComp(name, OP_DUR, FOLDER_PARTS, 2000, 2000);
        var list = glyphs(row);
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var L = c.layers.add(FOOTAGE[a.name], OP_DUR);
            L.name = a.name;
            blur(L);
            // 足元（下中央）を基準にして、伸び縮みしても足元がずれないようにする
            var bx = a.x + a.w / 2, by = a.y + a.h;
            setXY(L, [a.w / 2, a.h], [bx, by]);
            var p = xf(L, "ADBE Position"), s = xf(L, "ADBE Scale");
            if (row === "hira") {
                var t0 = HIRA_T0 + HIRA_STEP * i, sg = (i % 2 === 0) ? 1 : -1;
                keys(p, [[t0, [bx, by + 340]], [t0 + 0.30, [bx, by - 26]], [t0 + 0.46, [bx, by + 3]], [t0 + 0.56, [bx, by]]], 50, 30);
                keys(s, [[t0, [90, 115]], [t0 + 0.28, [100, 100]], [t0 + 0.44, [110, 90]], [t0 + 0.56, [100, 100]]], 50, 50);
                keys(xf(L, "ADBE Rotate Z"), [[t0, 10 * sg], [t0 + 0.30, -3 * sg], [t0 + 0.56, 0]], 50, 40);
            } else {
                var t1 = KANJI_T0 + KANJI_STEP * i;
                keys(p, [[t1, [bx, by - 800]], [t1 + 0.34, [bx, by + 10]], [t1 + 0.46, [bx, by - 5]], [t1 + 0.56, [bx, by]]], 50, 30);
                keys(s, [[t1, [94, 110]], [t1 + 0.34, [112, 88]], [t1 + 0.46, [97, 103]], [t1 + 0.56, [100, 100]]], 50, 50);
            }
        }
        return c;
    }
    // 素材座標 → OP のロゴ空間（LOGO ヌルの中の座標）
    function toLogoSpace(x, y) {
        return [960 + (x - LOGO_CENTER[0]) * OP_LOGO_SCALE / 100, 540 + (y - LOGO_CENTER[1]) * OP_LOGO_SCALE / 100];
    }

    // 円形の穴のマスク（中心と半径を CTRL から読む）
    var IRIS_PATH = CR + 'var c=C.effect("穴の中心")(1);var r=Math.max(C.effect("背景の穴(px)")(1),0.01);var k=r*0.5523;' +
        'createPath([[c[0],c[1]-r],[c[0]+r,c[1]],[c[0],c[1]+r],[c[0]-r,c[1]]],[[-k,0],[0,-k],[k,0],[0,k]],[[k,0],[0,k],[-k,0],[0,-k]],true)';

    // =================================================================
    //  01 オープニング
    // =================================================================
    function buildOP(N) {
        var comp = newComp(N.op, OP_DUR, FOLDER_MAIN);

        var C = comp.layers.addNull(OP_DUR);
        C.name = "CTRL";
        setXY(C, [0, 0], [0, 0]);
        addColorCtl(C, "色:ひらがな", COL.cyan);
        addColorCtl(C, "色:漢字", COL.black);
        addColorCtl(C, "色:ライン・丸", COL.cyan);
        addColorCtl(C, "色:背景", COL.white);
        addColorCtl(C, "色:背景の丸", COL.soft);
        addColorCtl(C, "色:左上プレート", COL.white);
        addColorCtl(C, "色:プレートの縁", COL.cyan);
        addColorCtl(C, "色:光の帯", COL.white);
        addCheckbox(C, "最後に左上ロゴを残す", true);
        addPoint(C, "左上ロゴの位置", CORNER_POS);
        addSlider(C, "左上ロゴのサイズ(%)", CORNER_SIZE);
        addPoint(C, "穴の中心", [960, 540]);
        addSlider(C, "ライン(%)", 0);
        addSlider(C, "ゆっくりズーム(%)", 100);
        addSlider(C, "ロゴ移動(%)", 0);
        addSlider(C, "背景の穴(px)", 0);
        keys(fxp(C, "ライン(%)"), [[0.12, 0], [0.55, 100], [1.35, 100], [1.68, 0]], 75, 20);
        keys(fxp(C, "ゆっくりズーム(%)"), [[1.2, 100], [3.3, 103]]);
        keys(fxp(C, "ロゴ移動(%)"), [[3.30, 0], [4.20, 100]], 75, 70);
        keys(fxp(C, "背景の穴(px)"), [[3.55, 0], [4.45, 1200]], 65, 55);

        var keep = 'var keep=(C.effect("最後に左上ロゴを残す")(1)==1);var p=C.effect("ロゴ移動(%)")(1)/100;';
        var cyanExp = CR + 'C.effect("色:ライン・丸")(1)';

        // ---------- 背景（白）と、ふわふわ漂う丸。最後に円形の穴が広がって次のシーンが見える ----------
        var BG = rectLayer(comp, "背景（白）", [2200, 1400], [960, 540], 0, COL.white);
        setExpr(fillColor(BG, "G"), CR + 'C.effect("色:背景")(1)', "背景 色");
        addMask(BG, "円形の穴", rectShape(0, 0, 1, 1), MaskMode.SUBTRACT);
        setExpr(maskPath(BG, "円形の穴"), IRIS_PATH, "背景 穴");

        var DECO = comp.layers.addShape();
        DECO.name = "背景の丸（ふわふわ）";
        setXY(DECO, [0, 0], [0, 0]);
        var deco = [[230, 860, 280, 75], [1720, 230, 330, 50], [1610, 915, 200, 75], [320, 190, 150, 50], [1170, 1010, 120, 75], [790, 105, 90, 50]];
        for (var di = 0; di < deco.length; di++) {
            var dg = "丸" + (di + 1), dd = deco[di];
            newGroup(DECO, dg);
            addEllipse(DECO, dg, "E", [dd[2] * 2, dd[2] * 2], [0, 0]);
            addFill(DECO, dg, "F", hex4(COL.soft));
            setExpr(fillColor(DECO, dg), CR + 'C.effect("色:背景の丸")(1)', "背景の丸 色");
            gxf(DECO, dg, "ADBE Vector Group Opacity").setValue(dd[3]);
            gxf(DECO, dg, "ADBE Vector Position").setValue([dd[0], dd[1]]);
            setExpr(gxf(DECO, dg, "ADBE Vector Position"),
                'add(value,[Math.sin(time*' + (0.5 + di * 0.13).toFixed(2) + '+' + di + ')*16,Math.cos(time*' + (0.4 + di * 0.11).toFixed(2) + '+' + di + ')*12])',
                "背景の丸 漂い");
            var dt = 0.05 + di * 0.07;
            keys(gxf(DECO, dg, "ADBE Vector Scale"), [[dt, [0, 0]], [dt + 0.32, [106, 106]], [dt + 0.46, [100, 100]]], 50, 30);
        }
        addMask(DECO, "円形の穴", rectShape(0, 0, 1, 1), MaskMode.SUBTRACT);
        setExpr(maskPath(DECO, "円形の穴"), IRIS_PATH, "背景の丸 穴");

        // 穴のふち（水色のリング2本）と、はじまりの点
        var rings = [
            { name: "穴のリング（外）", add: 40, width: 6, op: 45 },
            { name: "穴のリング", add: 0, width: 16, op: 100 }
        ];
        for (var ri = 0; ri < rings.length; ri++) {
            var rg = rings[ri];
            var RL = comp.layers.addShape();
            RL.name = rg.name;
            setXY(RL, [0, 0], [960, 540]);
            newGroup(RL, "G");
            addEllipse(RL, "G", "E", [10, 10], [0, 0]);
            addStroke(RL, "G", "S", hex4(COL.cyan), rg.width);
            setExpr(gp(RL, "G", "E").property("ADBE Vector Ellipse Size"),
                CR + 'var r=C.effect("背景の穴(px)")(1)+' + rg.add + ';[r*2,r*2]', rg.name + " 大きさ");
            setExpr(gp(RL, "G", "S").property("ADBE Vector Stroke Color"), cyanExp, rg.name + " 色");
            setExpr(xf(RL, "ADBE Position"), CR + 'C.effect("穴の中心")(1)', rg.name + " 位置");
            setExpr(xf(RL, "ADBE Opacity"), CR + '(C.effect("背景の穴(px)")(1)>1)?' + rg.op + ':0', rg.name + " 不透明度");
        }
        var ID = comp.layers.addShape();
        ID.name = "穴のはじまり（点）";
        setXY(ID, [0, 0], [960, 540]);
        newGroup(ID, "G");
        addEllipse(ID, "G", "E", [56, 56], [0, 0]);
        addFill(ID, "G", "F", hex4(COL.cyan));
        setExpr(fillColor(ID, "G"), cyanExp, "はじまりの点 色");
        setExpr(xf(ID, "ADBE Position"), CR + 'C.effect("穴の中心")(1)', "はじまりの点 位置");
        keys(xf(ID, "ADBE Scale"), [[3.38, [0, 0]], [3.50, [125, 125]], [3.58, [100, 100]]], 50, 40);
        keys(xf(ID, "ADBE Opacity"), [[3.56, 100], [3.70, 0]]);

        // ---------- ロゴの親ヌル（ゆっくりズーム → 左上へ）----------
        var LN = addNull(comp, "LOGO（ロゴの位置・大きさ）", [960, 540], [960, 540]);
        setExpr(xf(LN, "ADBE Position"),
            CR + keep + 'keep?linear(p,0,1,[960,540],C.effect("左上ロゴの位置")(1)):[960,540]', "LOGO 位置");
        setExpr(xf(LN, "ADBE Scale"),
            CR + keep + 'var z=C.effect("ゆっくりズーム(%)")(1);var s=keep?linear(p,0,1,z,C.effect("左上ロゴのサイズ(%)")(1)):linear(p,0,1,z,80);[s,s]',
            "LOGO スケール");
        blur(LN);
        var logoOp = CR + keep + 'keep?100:linear(p,0,0.7,100,0)';

        // 左上の丸いバッジ（白い円＋水色の縁。最後にポンと出る）
        var k = 100 / CORNER_SIZE;
        var PL = comp.layers.addShape();
        PL.name = "左上プレート";
        parentTo(PL, LN);
        setXY(PL, [960, 540], [960, 540]);
        newGroup(PL, "G");
        addRect(PL, "G", "R", [PLATE.w * k, PLATE.h * k], [960, 540], PLATE.r * k);
        addStroke(PL, "G", "S", hex4(COL.cyan), PLATE.stroke * k);
        addFill(PL, "G", "F", hex4(COL.white));
        setExpr(fillColor(PL, "G"), CR + 'C.effect("色:左上プレート")(1)', "プレート 色");
        setExpr(gp(PL, "G", "S").property("ADBE Vector Stroke Color"), CR + 'C.effect("色:プレートの縁")(1)', "プレート 縁の色");
        setExpr(xf(PL, "ADBE Opacity"), CR + keep + 'keep?linear(p,0.35,0.75,0,100):0', "プレート 不透明度");
        setExpr(xf(PL, "ADBE Scale"), CR + keep + 'var q=clamp((p-0.55)/0.45,0,1);var b=100*(1+0.08*Math.sin(Math.PI*q));[b,b]', "プレート ポン");
        blur(PL);

        // 「現場」着地の波紋（文字の後ろ）
        var kanji = glyphs("kanji");
        var RP = comp.layers.addShape();
        RP.name = "着地の波紋";
        parentTo(RP, LN);
        setXY(RP, [0, 0], [0, 0]);
        for (var ki = 0; ki < kanji.length; ki++) {
            var kg = "波紋" + (ki + 1);
            var kp = toLogoSpace(kanji[ki].x + kanji[ki].w / 2, kanji[ki].y + kanji[ki].h);
            var tI = KANJI_T0 + KANJI_STEP * ki + 0.34;
            newGroup(RP, kg);
            addEllipse(RP, kg, "E", [OP_LOGO_PX * 0.64, OP_LOGO_PX * 0.077], [0, 0]);
            addStroke(RP, kg, "S", hex4(COL.cyan), 10);
            setExpr(gp(RP, kg, "S").property("ADBE Vector Stroke Color"), cyanExp, "波紋 色");
            gxf(RP, kg, "ADBE Vector Position").setValue([kp[0], kp[1] + 2]);
            setExpr(gxf(RP, kg, "ADBE Vector Scale"), 'var p=clamp((time-' + f2(tI) + ')/0.5,0,1);var s=linear(p,0,1,25,125);[s,s]', "波紋 大きさ");
            setExpr(gxf(RP, kg, "ADBE Vector Group Opacity"), 'var p=clamp((time-' + f2(tI) + ')/0.5,0,1);(p<=0||p>=1)?0:linear(p,0,1,90,0)', "波紋 不透明度");
        }
        setExpr(xf(RP, "ADBE Opacity"), logoOp, "波紋 全体");

        // ロゴの文字（漢字＝線より下だけ、ひらがな＝線より上だけ見える）
        var parts = [
            { row: "kanji", name: "ロゴ 漢字（現場）", color: "色:漢字", mask: rectShape(-200, LOGO_SPLIT_Y, 2200, 2200) },
            { row: "hira", name: "ロゴ ひらがな（かながわの）", color: "色:ひらがな", mask: rectShape(-200, -200, 2200, LOGO_SPLIT_Y) }
        ];
        var kanjiComp = null, kanjiLayer = null;
        for (var i = 0; i < parts.length; i++) {
            var gcomp = buildGlyphComp(uniqueName("_ロゴ_" + parts[i].row), parts[i].row);
            var GL = comp.layers.add(gcomp, OP_DUR);
            GL.name = parts[i].name;
            parentTo(GL, LN);
            setXY(GL, LOGO_CENTER, [960, 540]);
            xf(GL, "ADBE Scale").setValue([OP_LOGO_SCALE, OP_LOGO_SCALE]);
            try { GL.collapseTransformation = true; } catch (eC) {}
            addMask(GL, "線で切る", parts[i].mask, MaskMode.ADD);
            addFillFx(GL, CR + 'C.effect(' + q(parts[i].color) + ')(1)');
            setExpr(xf(GL, "ADBE Opacity"), logoOp, parts[i].name + " 不透明度");
            blur(GL);
            if (parts[i].row === "kanji") { kanjiComp = gcomp; kanjiLayer = GL; }
        }

        // 「現場」の上を通る光の帯（漢字の形でくり抜き）
        var SH = comp.layers.addShape();
        SH.name = "光の帯";
        parentTo(SH, LN);
        var shY = toLogoSpace(0, 1120)[1], shX0 = 960 - OP_LOGO_PX / 2 - 160, shX1 = 960 + OP_LOGO_PX / 2 + 160;
        setXY(SH, [0, 0], [shX0, shY]);
        newGroup(SH, "G");
        addRect(SH, "G", "R", [OP_LOGO_PX * 0.1, OP_LOGO_PX * 1.2], [0, 0], 0);
        addFill(SH, "G", "F", hex4(COL.white));
        gxf(SH, "G", "ADBE Vector Rotation").setValue(18);
        setExpr(fillColor(SH, "G"), CR + 'C.effect("色:光の帯")(1)', "光の帯 色");
        keys(xf(SH, "ADBE Position"), [[2.05, [shX0, shY]], [2.75, [shX1, shY]]], 60, 60);
        xf(SH, "ADBE Opacity").setValue(55);
        var MT = comp.layers.add(kanjiComp, OP_DUR);
        MT.name = "光の帯の形（漢字）";
        parentTo(MT, LN);
        setXY(MT, LOGO_CENTER, [960, 540]);
        xf(MT, "ADBE Scale").setValue([OP_LOGO_SCALE, OP_LOGO_SCALE]);
        try { MT.collapseTransformation = true; } catch (eC2) {}
        addMask(MT, "線で切る", parts[0].mask, MaskMode.ADD);
        MT.enabled = false;
        try {
            if (SH.setTrackMatte) { SH.setTrackMatte(MT, TrackMatteType.ALPHA); }   // AE 2023 以降
            else { SH.trackMatteType = TrackMatteType.ALPHA; }                       // それより前（すぐ上のレイヤーがマット）
        } catch (eM) { SH.enabled = false; }

        // ひらがなが飛び出すときのキラキラ
        var hira = glyphs("hira");
        var ly = toLogoSpace(0, LOGO_SPLIT_Y)[1];
        var SP = comp.layers.addShape();
        SP.name = "キラキラ";
        parentTo(SP, LN);
        setXY(SP, [0, 0], [0, 0]);
        var sk = OP_LOGO_PX / 1100;
        var dirs = [[-110 * sk, -190 * sk, 26 * sk], [120 * sk, -165 * sk, 17 * sk]];
        for (var hi = 0; hi < hira.length; hi++) {
            var hx = toLogoSpace(hira[hi].x + hira[hi].w / 2, 0)[0];
            var ts = HIRA_T0 + HIRA_STEP * hi + 0.06;
            for (var dj = 0; dj < dirs.length; dj++) {
                var sg = "粒" + (hi + 1) + "_" + (dj + 1), dv = dirs[dj];
                var dx = dv[0] * ((hi % 2 === 0) ? 1 : 0.8), dy = dv[1] * ((dj + hi) % 2 === 0 ? 1 : 0.85);
                newGroup(SP, sg);
                addEllipse(SP, sg, "E", [dv[2], dv[2]], [0, 0]);
                addFill(SP, sg, "F", hex4(COL.cyan));
                setExpr(fillColor(SP, sg), cyanExp, "キラキラ 色");
                setExpr(gxf(SP, sg, "ADBE Vector Position"),
                    'var p=clamp((time-' + f2(ts) + ')/0.55,0,1);var e=1-Math.pow(1-p,3);[' + f2(hx) + '+(' + f2(dx) + ')*e,' + f2(ly) + '+(' + f2(dy) + ')*e]',
                    "キラキラ 位置");
                setExpr(gxf(SP, sg, "ADBE Vector Scale"),
                    'var p=clamp((time-' + f2(ts) + ')/0.55,0,1);var s=(p<=0||p>=1)?0:100*(1-p*p);[s,s]', "キラキラ 大きさ");
            }
        }

        // 最初の線（点がポンと出て、横に伸びて線になる）
        var LI = comp.layers.addShape();
        LI.name = "オープニングの線";
        parentTo(LI, LN);
        setXY(LI, [960, ly], [960, ly]);
        newGroup(LI, "G");
        addRect(LI, "G", "R", [10, 10], [960, ly], 5);
        addFill(LI, "G", "F", hex4(COL.cyan));
        var lineW = Math.round(OP_LOGO_PX + 140);
        setExpr(rectSize(LI, "G"), CR + 'var p=C.effect("ライン(%)")(1)/100;[10+' + (lineW - 10) + '*p,10]', "線 サイズ");
        setExpr(fillColor(LI, "G"), cyanExp, "線 色");
        keys(xf(LI, "ADBE Scale"), [[0, [0, 0]], [0.08, [150, 150]], [0.16, [100, 100]], [1.68, [100, 100]], [1.82, [0, 0]]], 50, 40);

        // ---- 並び順 ----
        C.moveToBeginning();
        LN.moveToEnd();

        var ops = ["色:ひらがな", "色:漢字", "色:ライン・丸", "色:背景", "色:背景の丸", "色:左上プレート", "色:プレートの縁", "色:光の帯", "最後に左上ロゴを残す"];
        for (var oi = 0; oi < ops.length; oi++) { egpFx(comp, C, ops[oi]); }
        setTemplateName(comp, MOGRT_NAMES.op);
        protect(comp, 0, 4.45, "OP（伸ばしても動きは変わらない）");
        return comp;
    }

    // =================================================================
    //  02 左上ロゴ ＋ 上部タイトル
    // =================================================================
    function buildCorner(N) {
        var D = 10;
        var comp = newComp(N.corner, D, FOLDER_MAIN);

        var C = comp.layers.addNull(D);
        C.name = "CTRL";
        setXY(C, [0, 0], [0, 0]);
        addColorCtl(C, "色:ひらがな", COL.cyan);
        addColorCtl(C, "色:漢字", COL.black);
        addColorCtl(C, "色:左上プレート", COL.white);
        addColorCtl(C, "色:プレートの縁", COL.cyan);
        addColorCtl(C, "色:タイトル帯", COL.black);
        addColorCtl(C, "色:タイトル文字", COL.white);
        addColorCtl(C, "色:丸", COL.cyan);
        addColorCtl(C, "色:ピン", COL.white);
        addCheckbox(C, "上部タイトルを表示", true);
        addCheckbox(C, "ロゴもアニメーションで出す", false);
        addCheckbox(C, "最後にロゴも消す", false);
        addSlider(C, "ロゴのポップ(%)", 0);
        addSlider(C, "タイトル帯(%)", 0);
        keys(fxp(C, "ロゴのポップ(%)"), [[0, 0], [0.22, 108], [0.38, 100]], 50, 30);
        barKeys(fxp(C, "タイトル帯(%)"), 0.10, 0.42, D);

        var showT = '*thisComp.layer("CTRL").effect("上部タイトルを表示")(1)';
        var logoOp = CR + 'var o=(C.effect("最後にロゴも消す")(1)==1)?linear(time,thisComp.duration-thisComp.frameDuration-0.3,thisComp.duration-thisComp.frameDuration,100,0):100;o';

        // ---- 左上ロゴ（OP の最後と同じ位置・大きさ）----
        var s = OP_LOGO_SCALE * CORNER_SIZE / 100;   // 素材に対する縮小率（%）
        var LN = addNull(comp, "左上ロゴ（位置・大きさ）", LOGO_CENTER, CORNER_POS);
        xf(LN, "ADBE Scale").setValue([s, s]);
        setExpr(xf(LN, "ADBE Scale"),
            CR + 'var a=(C.effect("ロゴもアニメーションで出す")(1)==1)?C.effect("ロゴのポップ(%)")(1)/100:1;[value[0]*a,value[1]*a]',
            "左上ロゴ スケール");

        var k = 100 / s;
        var PL = comp.layers.addShape();
        PL.name = "左上プレート";
        parentTo(PL, LN);
        setXY(PL, [0, 0], [0, 0]);
        newGroup(PL, "G");
        addRect(PL, "G", "R", [PLATE.w * k, PLATE.h * k], LOGO_CENTER, PLATE.r * k);
        addStroke(PL, "G", "S", hex4(COL.cyan), PLATE.stroke * k);
        addFill(PL, "G", "F", hex4(COL.white));
        setExpr(fillColor(PL, "G"), CR + 'C.effect("色:左上プレート")(1)', "プレート 色");
        setExpr(gp(PL, "G", "S").property("ADBE Vector Stroke Color"), CR + 'C.effect("色:プレートの縁")(1)', "プレート 縁の色");
        setExpr(xf(PL, "ADBE Opacity"), logoOp, "プレート 不透明度");

        var list = glyphs(null);
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var L = comp.layers.add(FOOTAGE[a.name], D);
            L.name = "ロゴ " + a.name;
            parentTo(L, LN);
            setXY(L, [a.w / 2, a.h / 2], [a.x + a.w / 2, a.y + a.h / 2]);
            addFillFx(L, CR + 'C.effect(' + q(a.row === "hira" ? "色:ひらがな" : "色:漢字") + ')(1)');
            setExpr(xf(L, "ADBE Opacity"), logoOp, "ロゴ文字 不透明度");
        }

        // ---- 上部タイトル（丸＋ピンから、カプセル型の帯が伸びる）----
        var bh = 72, x0 = CORNER_POS[0] + PLATE.w / 2 + 16, y0 = CORNER_POS[1];
        var bar = makeBar(comp, {
            name: "上部タイトル", text: TXT.title, font: FONT.bold, size: 42,
            textColor: "色:タイトル文字", boxColor: "色:タイトル帯",
            x: x0, y: y0, h: bh, padL: bh + 16, padR: 36, grow: "left", slider: "タイトル帯(%)"
        });
        textMotion(bar.text, 0.24, 0.42, D, "left");
        setExpr(xf(bar.text, "ADBE Opacity"), 'value' + showT, "タイトル 不透明度");
        setExpr(xf(bar.box, "ADBE Opacity"), '100' + showT, "タイトル帯 不透明度");
        var DT = addDot(comp, "タイトルの丸", x0 + bh / 2, y0, bh, "色:丸", "色:ピン");
        popKeys(DT, 0, D);
        setExpr(xf(DT, "ADBE Opacity"), '100' + showT, "タイトルの丸 不透明度");

        C.moveToBeginning();
        LN.moveToEnd();

        egp(comp, srcText(bar.text), "上部タイトル");
        var cs = ["上部タイトルを表示", "ロゴもアニメーションで出す", "最後にロゴも消す", "色:タイトル帯", "色:タイトル文字", "色:丸", "色:ピン",
            "色:ひらがな", "色:漢字", "色:左上プレート", "色:プレートの縁"];
        for (var ci = 0; ci < cs.length; ci++) { egpFx(comp, C, cs[ci]); }
        setTemplateName(comp, MOGRT_NAMES.corner);
        protect(comp, 0, 0.8, "IN（伸ばしても変わらない）");
        protect(comp, D - 0.45, 0.45, "OUT（伸ばしても変わらない）");
        return comp;
    }

    // =================================================================
    //  03 下部テロップ（中央から左右に開く。両端の丸が外へ移動）
    // =================================================================
    function buildBottom(N) {
        var D = 8;
        var comp = newComp(N.bottom, D, FOLDER_MAIN);

        var C = comp.layers.addNull(D);
        C.name = "CTRL";
        setXY(C, [0, 0], [0, 0]);
        addColorCtl(C, "色:帯", COL.black);
        addColorCtl(C, "色:文字", COL.white);
        addColorCtl(C, "色:丸", COL.cyan);
        addSlider(C, "帯(%)", 0);
        barKeys(fxp(C, "帯(%)"), 0.10, 0.42, D);

        var y = 958, h = 84, pad = h + 22;
        var bar = makeBar(comp, {
            name: "下部テロップ", text: TXT.bottom, font: FONT.bold, size: 46,
            textColor: "色:文字", boxColor: "色:帯",
            x: 960, y: y, h: h, padL: pad, padR: pad, grow: "center", slider: "帯(%)"
        });
        textMotion(bar.text, 0.26, 0.42, D, "up");

        for (var side = -1; side <= 1; side += 2) {
            var DT = addDot(comp, side < 0 ? "左の丸" : "右の丸", 960, y, h * 0.62, "色:丸", null);
            setExpr(xf(DT, "ADBE Position"),
                bar.wExp + 'var d=Math.max(w/2-' + (h / 2) + ',0);[960' + (side < 0 ? "-" : "+") + 'd,' + y + ']', "丸 位置");
            popKeys(DT, 0, D);
        }

        C.moveToBeginning();
        egp(comp, srcText(bar.text), "下部テロップ");
        egpFx(comp, C, "色:帯");
        egpFx(comp, C, "色:文字");
        egpFx(comp, C, "色:丸");
        setTemplateName(comp, MOGRT_NAMES.bottom);
        protect(comp, 0, 0.8, "IN（伸ばしても変わらない）");
        protect(comp, D - 0.45, 0.45, "OUT（伸ばしても変わらない）");
        return comp;
    }

    // =================================================================
    //  04 名前テロップ（左下：丸＋ピン → 名前の帯、上に肩書きタグ、下に所属）
    // =================================================================
    function buildName(N) {
        var D = 8;
        var comp = newComp(N.name, D, FOLDER_MAIN);

        var C = comp.layers.addNull(D);
        C.name = "CTRL";
        setXY(C, [0, 0], [0, 0]);
        addColorCtl(C, "色:名前の帯", COL.black);
        addColorCtl(C, "色:名前の文字", COL.white);
        addColorCtl(C, "色:肩書きタグ", COL.cyan);
        addColorCtl(C, "色:肩書きの文字", COL.white);
        addColorCtl(C, "色:所属の帯", COL.white);
        addColorCtl(C, "色:所属の文字", COL.black);
        addColorCtl(C, "色:丸", COL.cyan);
        addColorCtl(C, "色:ピン", COL.white);
        addSlider(C, "名前の帯(%)", 0);
        addSlider(C, "肩書きタグ(%)", 0);
        addSlider(C, "所属の帯(%)", 0);
        barKeys(fxp(C, "名前の帯(%)"), 0.10, 0.36, D);
        barKeys(fxp(C, "肩書きタグ(%)"), 0.30, 0.48, D);
        barKeys(fxp(C, "所属の帯(%)"), 0.38, 0.44, D);

        var X = 100, NH = 92, NY = 880;
        var TX = X + NH + 18;   // 名前の文字の始まり（タグと所属もここにそろえる）

        var org = makeBar(comp, {
            name: "所属", text: TXT.org, font: FONT.medium, size: 32,
            textColor: "色:所属の文字", boxColor: "色:所属の帯",
            x: TX, y: NY + NH / 2 + 8 + 28, h: 56, padL: 24, padR: 26, grow: "left", slider: "所属の帯(%)"
        });
        textMotion(org.text, 0.48, 0.44, D, "left");

        var nm = makeBar(comp, {
            name: "名前", text: TXT.name, font: FONT.bold, size: 60,
            textColor: "色:名前の文字", boxColor: "色:名前の帯",
            x: X, y: NY, h: NH, padL: NH + 18, padR: 42, grow: "left", slider: "名前の帯(%)"
        });
        textMotion(nm.text, 0.22, 0.36, D, "left");

        var rl = makeBar(comp, {
            name: "肩書き", text: TXT.role, font: FONT.bold, size: 26,
            textColor: "色:肩書きの文字", boxColor: "色:肩書きタグ",
            x: TX, y: NY - NH / 2 - 8 - 23, h: 46, padL: 20, padR: 22, grow: "left", slider: "肩書きタグ(%)"
        });
        textMotion(rl.text, 0.40, 0.48, D, "left");

        var DT = addDot(comp, "名前の丸", X + NH / 2, NY, NH, "色:丸", "色:ピン");
        popKeys(DT, 0, D);

        C.moveToBeginning();
        egp(comp, srcText(nm.text), "名前");
        egp(comp, srcText(rl.text), "肩書き");
        egp(comp, srcText(org.text), "所属");
        var cs = ["色:名前の帯", "色:名前の文字", "色:肩書きタグ", "色:肩書きの文字", "色:所属の帯", "色:所属の文字", "色:丸", "色:ピン"];
        for (var ci = 0; ci < cs.length; ci++) { egpFx(comp, C, cs[ci]); }
        setTemplateName(comp, MOGRT_NAMES.name);
        protect(comp, 0, 1.0, "IN（伸ばしても変わらない）");
        protect(comp, D - 0.5, 0.5, "OUT（伸ばしても変わらない）");
        return comp;
    }

    // =================================================================
    //  MOGRT 書き出し
    // =================================================================
    function exportMogrts(list) {
        // 未保存のまま書き出すと AE が毎回保存を求めるので、先に保存する（この後はプロジェクトを変更しない）
        try {
            if (app.project.file === null) {
                if (!app.project.saveWithDialog()) {
                    return "MOGRT の書き出しには、先にプロジェクトの保存が必要です。\n（保存がキャンセルされたので書き出しませんでした）";
                }
            } else {
                app.project.save();
            }
        } catch (eSave) {}
        var folder = Folder.selectDialog("MOGRT（Premiere 用テンプレート）の保存先フォルダを選んでください");
        if (folder === null) { return "MOGRT の書き出しはキャンセルされました。"; }
        var dir = folder.fsName, okNames = [], ngNames = [];
        for (var i = 0; i < list.length; i++) {
            var c = list[i].comp;
            try { var again = app.project.itemByID(list[i].id); if (again) { c = again; } } catch (eId) {}
            var tname = list[i].file;
            try { if (c.motionGraphicsTemplateName) { tname = c.motionGraphicsTemplateName; } } catch (eT) {}
            var expect = new File(dir + "/" + tname + ".mogrt");
            try { if (expect.exists) { expect.remove(); } } catch (eRm) {}   // 古いファイルを「成功」と見間違えないように
            var ret = null;
            try { ret = c.exportAsMotionGraphicsTemplate(true, dir); } catch (e) { ret = false; }   // 2つ目の引数は「フォルダ」
            if (ret !== true && ret !== false) {   // 15.0 は戻り値が無いので、ファイルができるのを少し待つ
                for (var w = 0; w < 30 && !expect.exists; w++) { try { $.sleep(100); } catch (eW) { break; } }
            }
            if (ret === true || (ret !== false && expect.exists)) { okNames.push(tname + ".mogrt"); } else { ngNames.push(list[i].name); }
        }
        var msg = "";
        if (okNames.length) { msg += "MOGRT を書き出しました：\n  " + okNames.join("\n  ") + "\n保存先：" + dir + "\n"; }
        if (ngNames.length) {
            msg += "\n自動で書き出せなかったコンポ：\n  " + ngNames.join("\n  ") +
                "\n→ コンポを開き、エッセンシャルグラフィックスパネルの「モーショングラフィックステンプレートを書き出し」から書き出してください。\n";
        }
        return msg;
    }

    var PREF_MSG = "After Effects の［環境設定］→［スクリプトとエクスプレッション］（古い版は［一般設定］）で\n" +
        "「スクリプトによるファイルへの書き込みとネットワークへのアクセスを許可」にチェックを入れてから、もう一度実行してください。";

    // 「スクリプトによるファイルへの書き込み…」の設定がオフと分かったときだけ false
    function scriptsCanWriteFiles() {
        var key = "Pref_SCRIPTING_FILE_NETWORK_SECURITY";
        var sections = ["Main Pref Section v2", "Main Pref Section"];
        var types = [];
        try { types = [PREFType.PREF_Type_MACHINE_INDEPENDENT, PREFType.PREF_Type_MACHINE_SPECIFIC]; } catch (e0) { types = [undefined]; }
        for (var i = 0; i < sections.length; i++) {
            for (var j = 0; j < types.length; j++) {
                try {
                    var has = (types[j] === undefined) ? app.preferences.havePref(sections[i], key) : app.preferences.havePref(sections[i], key, types[j]);
                    if (!has) { continue; }
                    var v = (types[j] === undefined) ? app.preferences.getPrefAsLong(sections[i], key) : app.preferences.getPrefAsLong(sections[i], key, types[j]);
                    return v !== 0;
                } catch (e1) {}
            }
        }
        return true;   // 確認できないときは試してみる（失敗したら下で案内を出す）
    }

    function buildAll(fresh) {
        if (fresh) { try { app.project.expressionEngine = "javascript-1.0"; } catch (eE) {} }
        FOLDER_MAIN = app.project.items.addFolder(uniqueName("かながわの現場テンプレート"));
        FOLDER_PARTS = app.project.items.addFolder("_パーツ（触らなくてOK）");
        FOLDER_PARTS.parentFolder = FOLDER_MAIN;

        var assetDir = writeAssets();
        var N = {
            op: uniqueName("01_OP_オープニング"),
            corner: uniqueName("02_左上ロゴ＋上部タイトル"),
            bottom: uniqueName("03_下部テロップ"),
            name: uniqueName("04_名前テロップ")
        };
        return {
            assetDir: assetDir,
            op: buildOP(N),
            corner: buildCorner(N),
            bottom: buildBottom(N),
            nameT: buildName(N)
        };
    }

    function main() {
        if (parseFloat(app.version) < 15.0) {
            alert("After Effects CC 2018（15.0）以降で実行してください。");
            return;
        }
        if (!app.project) { app.newProject(); }
        if (!scriptsCanWriteFiles()) {
            if (!confirm("ロゴ画像を書き出すために、設定の変更が必要なようです。\n\n" + PREF_MSG +
                "\n\nすでに設定を変更した場合は［OK］で続けます。")) { return; }
        }
        var fresh = (app.project.numItems === 0);

        var R = null, err = null;
        app.beginUndoGroup("かながわの現場テンプレートを作成");
        try { app.beginSuppressDialogs(); } catch (eS) {}
        try {
            R = buildAll(fresh);
        } catch (e) {
            err = e;
        }
        try { app.endSuppressDialogs(false); } catch (eS2) {}
        app.endUndoGroup();

        if (err !== null) {
            var where = "";
            try { if (err.line) { where = "（" + err.line + " 行目）"; } } catch (eL) {}
            alert("テンプレートの作成中に止まりました" + where + "：\n\n" + err.toString() +
                "\n\n［編集］→［取り消し］で途中までの作成を元に戻せます。");
            return;
        }
        try { R.op.openInViewer(); } catch (eV) {}

        var msg = "「かながわの現場」テンプレートを作成しました！\n\n" +
            "・" + R.op.name + "\n・" + R.corner.name + "\n・" + R.bottom.name + "\n・" + R.nameT.name + "\n\n" +
            "ロゴ画像の保存先：\n" + R.assetDir + "\n（このフォルダは消さないでください）\n";
        if (EXPR_ERRORS.length) {
            msg += "\n※ エクスプレッションの警告が " + EXPR_ERRORS.length + " 件ありました：\n" + EXPR_ERRORS.slice(0, 8).join("\n") + "\n";
        }
        alert(msg);

        if (confirm("続けて、Premiere Pro 用の MOGRT（モーショングラフィックステンプレート）を書き出しますか？\n（先にプロジェクトを保存してから、保存先フォルダを選びます）")) {
            var list = [
                { comp: R.op, file: MOGRT_NAMES.op },
                { comp: R.corner, file: MOGRT_NAMES.corner },
                { comp: R.bottom, file: MOGRT_NAMES.bottom },
                { comp: R.nameT, file: MOGRT_NAMES.name }
            ];
            for (var i = 0; i < list.length; i++) { list[i].id = list[i].comp.id; list[i].name = list[i].comp.name; }
            alert(exportMogrts(list));
        }
    }

    main();

})();
