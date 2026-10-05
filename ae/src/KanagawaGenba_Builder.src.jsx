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
//    01_OP_オープニング       … ロゴ登場 → 画面が上下に割れて次のシーンへ（5秒）
//    02_左上ロゴ＋上部タイトル … OP の最後と同じ位置の左上ロゴ＋上部タイトル
//    03_下部テロップ          … 画面下中央のテロップ
//    04_名前テロップ          … 左下の名前テロップ（肩書きタグ＋名前＋所属）
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
        white: "#FFFFFF"
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
    var OP_LOGO_SCALE = 70;          // OP でのロゴの大きさ（%）
    var OP_DUR = 5.0;

    // 左上ロゴ（OP の最後と 02 のコンポで同じ値を使います）
    var CORNER_POS = [187, 139];     // 左上ロゴの中心
    var CORNER_SIZE = 22.7;          // OP のロゴに対する大きさ（%）
    var PLATE = { w: 294, h: 210, r: 16 }; // 左上ロゴの白いプレート（画面上のピクセル）

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
        try { tries.push(Folder.temp.fsName + "/KanagawaGenba_Assets"); } catch (e1) {}
        for (var t = 0; t < tries.length && base === null; t++) {
            var fd = new Folder(tries[t]);
            if (!fd.exists) { fd.create(); }
            if (fd.exists) { base = fd; }
        }
        if (base === null) { throw new Error("素材フォルダを作成できませんでした。"); }
        for (var i = 0; i < ASSETS.length; i++) {
            var a = ASSETS[i];
            var f = new File(base.fsName + "/" + a.file);
            f.encoding = "BINARY";
            if (!f.open("w")) { throw new Error("書き込めません：" + f.fsName); }
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
    function addMask(L, name, shape) {
        var m = L.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.name = name;
        m.maskMode = MaskMode.ADD;
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
    //  テロップ共通：文字の長さに合わせて伸びる帯＋帯の中から現れる文字
    // =================================================================
    //  o = { name, text, font, size, textColor(CTRL名), boxColor(CTRL名),
    //        x(帯の左端 or 中心), y(帯の中心), h(帯の高さ), padL, padR,
    //        grow: "left" | "center", slider(帯の伸び %), textIn:[[t,値]...], textOut }
    function makeBar(comp, o) {
        var T = addText(comp, o.text, {
            name: o.name, font: o.font, size: o.size, color: [1, 1, 1],
            just: ParagraphJustification.LEFT_JUSTIFY
        });
        var tq = q(o.name);
        var wExp = 'var r=thisComp.layer(' + tq + ').sourceRectAtTime(time,false);' +
            'var p=clamp(thisComp.layer("CTRL").effect(' + q(o.slider) + ')(1)/100,0,1);' +
            'var w=(r.width+' + o.padL + '+' + o.padR + ')*p;';
        var xL = (o.grow === "center")
            ? 'var x0=' + o.x + '-(r.width+' + o.padL + '+' + o.padR + ')/2*p;'
            : 'var x0=' + o.x + ';';

        var B = comp.layers.addShape();
        B.name = o.name + "（帯）";
        setXY(B, [0, 0], [0, 0]);
        newGroup(B, "G");
        addRect(B, "G", "R", [100, o.h], [o.x, o.y], 0);
        addFill(B, "G", "F", hex4(COL.black));
        setExpr(rectSize(B, "G"), wExp + '[Math.max(w,0.01),' + o.h + ']', B.name + " サイズ");
        setExpr(rectPos(B, "G"), wExp + xL + '[x0+w/2,' + o.y + ']', B.name + " 位置");
        setExpr(fillColor(B, "G"), CR + 'C.effect(' + q(o.boxColor) + ')(1)', B.name + " 色");
        blur(B);

        // 文字（帯の範囲だけ見えるマスク付き）
        T.moveBefore(B);
        var textX = (o.grow === "center") ? 0 : o.x + o.padL;
        setXY(T, [0, 0], [textX, o.y]);
        if (o.grow === "center") {
            setExpr(xf(T, "ADBE Anchor Point"), EXP_ANCHOR_CENTER, o.name + " アンカー");
            setExpr(xf(T, "ADBE Position"), 'var r=sourceRectAtTime(time,false);[' + o.x + '+(' + o.padL + '-' + o.padR + ')/2,value[1]]', o.name + " 位置");
        } else {
            setExpr(xf(T, "ADBE Anchor Point"), EXP_ANCHOR_LEFTMID, o.name + " アンカー");
        }
        addFillFx(T, CR + 'C.effect(' + q(o.textColor) + ')(1)');
        addMask(T, "帯の中だけ表示", rectShape(0, 0, 10, 10));
        setExpr(maskPath(T, "帯の中だけ表示"),
            wExp + xL + 'var y0=' + (o.y - o.h / 2) + ',y1=' + (o.y + o.h / 2) + ';' +
            'createPath([fromComp([x0,y0]),fromComp([x0+w,y0]),fromComp([x0+w,y1]),fromComp([x0,y1])],[],[],true)',
            o.name + " マスク");
        return { text: T, box: B };
    }
    // 文字を少し下から上げつつフェードイン、最後にフェードアウト
    function textMotion(T, tIn, tOut, D) {
        var p = xf(T, "ADBE Position");
        var v = p.value;
        keys(p, [[tIn, [v[0], v[1] + 22]], [tIn + 0.33, [v[0], v[1]]]], 80, 15);
        keys(xf(T, "ADBE Opacity"), [[tIn, 0], [tIn + 0.2, 100], [D - tOut, 100], [D - tOut + 0.2, 0]]);
    }

    // =================================================================
    //  ロゴの文字プリコンポ（OP 用。文字ごとに動く）
    // =================================================================
    function buildGlyphComp(name, row) {
        var c = newComp(name, OP_DUR, FOLDER_PARTS, 2000, 2000);
        var list = glyphs(row);
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var L = c.layers.add(FOOTAGE[a.name], OP_DUR);
            L.name = a.name;
            blur(L);
            var bx = a.x + a.w / 2, by = a.y + a.h / 2;
            var p = xf(L, "ADBE Position");
            if (row === "hira") {
                // 線の下から1文字ずつ跳ねて出る
                var t0 = 0.30 + 0.07 * i;
                keys(p, [[t0, [bx, by + 300]], [t0 + 0.34, [bx, by - 14]], [t0 + 0.50, [bx, by]]], 55, 30);
                keys(xf(L, "ADBE Rotate Z"), [[t0, (i % 2 === 0) ? 7 : -7], [t0 + 0.50, 0]], 60, 30);
            } else {
                // 線の上から落ちてきて着地
                var t1 = 0.58 + 0.10 * i;
                keys(p, [[t1, [bx, by - 800]], [t1 + 0.38, [bx, by + 16]], [t1 + 0.54, [bx, by]]], 55, 30);
            }
        }
        return c;
    }

    // =================================================================
    //  01 オープニング
    // =================================================================
    function buildOP(N) {
        var comp = newComp(N.op, OP_DUR, FOLDER_MAIN);

        var C = comp.layers.addNull(OP_DUR);
        C.name = "CTRL";
        addColorCtl(C, "色:ひらがな", COL.cyan);
        addColorCtl(C, "色:漢字", COL.black);
        addColorCtl(C, "色:ライン", COL.cyan);
        addColorCtl(C, "色:背景", COL.white);
        addColorCtl(C, "色:左上プレート", COL.white);
        addCheckbox(C, "最後に左上ロゴを残す", true);
        addPoint(C, "左上ロゴの位置", CORNER_POS);
        addSlider(C, "左上ロゴのサイズ(%)", CORNER_SIZE);
        addSlider(C, "ライン(%)", 0);
        addSlider(C, "ゆっくりズーム(%)", 100);
        addSlider(C, "ロゴ移動(%)", 0);
        keys(fxp(C, "ライン(%)"), [[0, 0], [0.45, 100], [1.35, 100], [1.75, 0]], 75, 20);
        keys(fxp(C, "ゆっくりズーム(%)"), [[1.2, 100], [3.4, 103]]);
        keys(fxp(C, "ロゴ移動(%)"), [[3.35, 0], [4.25, 100]], 75, 70);

        var keep = 'var keep=(C.effect("最後に左上ロゴを残す")(1)==1);var p=C.effect("ロゴ移動(%)")(1)/100;';

        // ---- 背景（上下2枚のパネル。最後に上下へ割れて次のシーンが見える）----
        //  シェイプの中身は「上にあるグループほど手前」なので、LINE を先に作る
        var panels = [
            { name: "背景パネル（下）", bgY: 840, lineY: 542, move: 620 },
            { name: "背景パネル（上）", bgY: 240, lineY: 538, move: -620 }
        ];
        var PT = null, PB = null;
        for (var pi = 0; pi < panels.length; pi++) {
            var pn = panels[pi];
            var PN = comp.layers.addShape();
            PN.name = pn.name;
            setXY(PN, [0, 0], [0, 0]);
            newGroup(PN, "LINE");
            addRect(PN, "LINE", "R", [0, 4], [960, pn.lineY], 0);
            addFill(PN, "LINE", "F", hex4(COL.cyan));
            newGroup(PN, "BG");
            addRect(PN, "BG", "R", [2100, 600], [960, pn.bgY], 0);
            addFill(PN, "BG", "F", hex4(COL.white));
            keys(rectSize(PN, "LINE"), [[3.50, [0, 4]], [3.80, [2100, 4]]], 85, 10);
            setExpr(fillColor(PN, "BG"), CR + 'C.effect("色:背景")(1)', pn.name + " 色");
            setExpr(fillColor(PN, "LINE"), CR + 'C.effect("色:ライン")(1)', pn.name + " ライン色");
            keys(xf(PN, "ADBE Position"), [[3.80, [0, 0]], [4.55, [0, pn.move]]], 70, 60);
            blur(PN);
            if (pi === 0) { PB = PN; } else { PT = PN; }
        }

        // ---- ロゴの親ヌル（ゆっくりズーム → 左上へ移動）----
        var LN = addNull(comp, "LOGO（ロゴの位置・大きさ）", [960, 540], [960, 540]);
        setExpr(xf(LN, "ADBE Position"),
            CR + keep + 'keep?linear(p,0,1,[960,540],C.effect("左上ロゴの位置")(1)):[960,540]', "LOGO 位置");
        setExpr(xf(LN, "ADBE Scale"),
            CR + keep + 'var z=C.effect("ゆっくりズーム(%)")(1);var s=keep?linear(p,0,1,z,C.effect("左上ロゴのサイズ(%)")(1)):linear(p,0,1,z,80);[s,s]',
            "LOGO スケール");
        blur(LN);

        // 左上プレート（ロゴが左上に移るときに出てくる）
        var k = 100 / CORNER_SIZE;
        var PL = rectLayer(comp, "左上プレート", [PLATE.w * k, PLATE.h * k], [960, 540], PLATE.r * k, COL.white);
        PL.parent = LN;
        setXY(PL, [0, 0], [0, 0]);
        setExpr(fillColor(PL, "G"), CR + 'C.effect("色:左上プレート")(1)', "プレート 色");
        setExpr(xf(PL, "ADBE Opacity"), CR + keep + 'keep?linear(p,0.35,0.75,0,100):0', "プレート 不透明度");
        blur(PL);

        // ロゴの文字（ひらがな＝線より上だけ、漢字＝線より下だけ見える）
        var splitComp = OP_LOGO_SCALE / 100;
        var parts = [
            { row: "kanji", name: "ロゴ 漢字（現場）", color: "色:漢字", mask: rectShape(-200, LOGO_SPLIT_Y, 2200, 2200) },
            { row: "hira", name: "ロゴ ひらがな（かながわの）", color: "色:ひらがな", mask: rectShape(-200, -200, 2200, LOGO_SPLIT_Y) }
        ];
        for (var i = 0; i < parts.length; i++) {
            var gcomp = buildGlyphComp(uniqueName("_ロゴ_" + parts[i].row), parts[i].row);
            var GL = comp.layers.add(gcomp, OP_DUR);
            GL.name = parts[i].name;
            GL.parent = LN;
            setXY(GL, LOGO_CENTER, [960, 540]);
            xf(GL, "ADBE Scale").setValue([OP_LOGO_SCALE, OP_LOGO_SCALE]);
            try { GL.collapseTransformation = true; } catch (eC) {}
            addMask(GL, "線で切る", parts[i].mask);
            addFillFx(GL, CR + 'C.effect(' + q(parts[i].color) + ')(1)');
            setExpr(xf(GL, "ADBE Opacity"), CR + keep + 'keep?100:linear(p,0,0.7,100,0)', parts[i].name + " 不透明度");
            blur(GL);
        }

        // 最初に引かれる線
        var ly = 540 + (LOGO_SPLIT_Y - LOGO_CENTER[1]) * splitComp;
        var LI = rectLayer(comp, "オープニングの線", [0, 8], [960, ly], 0, COL.cyan);
        LI.parent = LN;
        setXY(LI, [0, 0], [0, 0]);
        setExpr(rectSize(LI, "G"), CR + 'var w=1240*C.effect("ライン(%)")(1)/100;[Math.max(w,0.01),8]', "線 サイズ");
        setExpr(fillColor(LI, "G"), CR + 'C.effect("色:ライン")(1)', "線 色");

        // ---- 並び順 ----
        C.moveToBeginning();
        LN.moveToEnd();

        egpFx(comp, C, "色:ひらがな");
        egpFx(comp, C, "色:漢字");
        egpFx(comp, C, "色:ライン");
        egpFx(comp, C, "色:背景");
        egpFx(comp, C, "色:左上プレート");
        egpFx(comp, C, "最後に左上ロゴを残す");
        setTemplateName(comp, "かながわの現場 オープニング");
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
        addColorCtl(C, "色:ひらがな", COL.cyan);
        addColorCtl(C, "色:漢字", COL.black);
        addColorCtl(C, "色:左上プレート", COL.white);
        addColorCtl(C, "色:タイトル帯", COL.black);
        addColorCtl(C, "色:タイトル文字", COL.white);
        addColorCtl(C, "色:アクセント", COL.cyan);
        addCheckbox(C, "上部タイトルを表示", true);
        addCheckbox(C, "ロゴもアニメーションで出す", false);
        addCheckbox(C, "最後にロゴも消す", false);
        addSlider(C, "ロゴのポップ(%)", 0);
        addSlider(C, "タイトル帯(%)", 0);
        keys(fxp(C, "ロゴのポップ(%)"), [[0, 0], [0.22, 108], [0.38, 100]], 50, 30);
        keys(fxp(C, "タイトル帯(%)"), [[0.08, 0], [0.42, 100], [D - 0.35, 100], [D - 0.08, 0]], 80, 15);

        var showT = '*thisComp.layer("CTRL").effect("上部タイトルを表示")(1)';
        var logoOp = CR + 'var o=(C.effect("最後にロゴも消す")(1)==1)?linear(time,thisComp.duration-0.3,thisComp.duration,100,0):100;o';

        // ---- 左上ロゴ（OP の最後と同じ位置・大きさ）----
        var s = OP_LOGO_SCALE * CORNER_SIZE / 100;   // 素材に対する縮小率（%）
        var LN = addNull(comp, "左上ロゴ（位置・大きさ）", LOGO_CENTER, CORNER_POS);
        xf(LN, "ADBE Scale").setValue([s, s]);
        setExpr(xf(LN, "ADBE Scale"),
            CR + 'var a=(C.effect("ロゴもアニメーションで出す")(1)==1)?C.effect("ロゴのポップ(%)")(1)/100:1;[value[0]*a,value[1]*a]',
            "左上ロゴ スケール");

        var k = 100 / s;
        var PL = rectLayer(comp, "左上プレート", [PLATE.w * k, PLATE.h * k], LOGO_CENTER, PLATE.r * k, COL.white);
        PL.parent = LN;
        setXY(PL, [0, 0], [0, 0]);
        setExpr(fillColor(PL, "G"), CR + 'C.effect("色:左上プレート")(1)', "プレート 色");
        setExpr(xf(PL, "ADBE Opacity"), logoOp, "プレート 不透明度");

        var list = glyphs(null);
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var L = comp.layers.add(FOOTAGE[a.name], D);
            L.name = "ロゴ " + a.name;
            L.parent = LN;
            setXY(L, [a.w / 2, a.h / 2], [a.x + a.w / 2, a.y + a.h / 2]);
            addFillFx(L, CR + 'C.effect(' + q(a.row === "hira" ? "色:ひらがな" : "色:漢字") + ')(1)');
            setExpr(xf(L, "ADBE Opacity"), logoOp, "ロゴ文字 不透明度");
        }

        // ---- 上部タイトル（プレートの右に帯が伸びる）----
        var x0 = CORNER_POS[0] + PLATE.w / 2 + 14, y0 = CORNER_POS[1], bh = 72;
        var AC = rectLayer(comp, "タイトル アクセント", [10, bh], [x0 + 5, y0], 0, COL.cyan);
        setXY(AC, [x0 + 5, y0], [x0 + 5, y0]);
        setExpr(fillColor(AC, "G"), CR + 'C.effect("色:アクセント")(1)', "アクセント 色");
        keys(xf(AC, "ADBE Scale"), [[0, [100, 0]], [0.2, [100, 100]], [D - 0.12, [100, 100]], [D, [100, 0]]], 80, 20);
        setExpr(xf(AC, "ADBE Opacity"), 'value' + showT, "アクセント 不透明度");

        var bar = makeBar(comp, {
            name: "上部タイトル", text: TXT.title, font: FONT.bold, size: 44,
            textColor: "色:タイトル文字", boxColor: "色:タイトル帯",
            x: x0 + 10, y: y0, h: bh, padL: 26, padR: 30, grow: "left", slider: "タイトル帯(%)"
        });
        textMotion(bar.text, 0.22, 0.4, D);
        setExpr(xf(bar.text, "ADBE Opacity"), 'value' + showT, "タイトル 不透明度");
        setExpr(xf(bar.box, "ADBE Opacity"), '100' + showT, "タイトル帯 不透明度");
        AC.moveToBeginning();
        bar.text.moveToBeginning();

        C.moveToBeginning();
        LN.moveToEnd();

        egp(comp, srcText(bar.text), "上部タイトル");
        egpFx(comp, C, "上部タイトルを表示");
        egpFx(comp, C, "ロゴもアニメーションで出す");
        egpFx(comp, C, "最後にロゴも消す");
        egpFx(comp, C, "色:タイトル帯");
        egpFx(comp, C, "色:タイトル文字");
        egpFx(comp, C, "色:アクセント");
        egpFx(comp, C, "色:ひらがな");
        egpFx(comp, C, "色:漢字");
        egpFx(comp, C, "色:左上プレート");
        setTemplateName(comp, "かながわの現場 左上ロゴ＋上部タイトル");
        protect(comp, 0, 0.7, "IN（伸ばしても変わらない）");
        protect(comp, D - 0.4, 0.4, "OUT（伸ばしても変わらない）");
        return comp;
    }

    // =================================================================
    //  03 下部テロップ（中央から左右に伸びる）
    // =================================================================
    function buildBottom(N) {
        var D = 8;
        var comp = newComp(N.bottom, D, FOLDER_MAIN);

        var C = comp.layers.addNull(D);
        C.name = "CTRL";
        addColorCtl(C, "色:帯", COL.black);
        addColorCtl(C, "色:文字", COL.white);
        addColorCtl(C, "色:アクセント", COL.cyan);
        addSlider(C, "帯(%)", 0);
        addSlider(C, "アクセント線(%)", 0);
        keys(fxp(C, "帯(%)"), [[0, 0], [0.35, 100], [D - 0.35, 100], [D - 0.05, 0]], 80, 15);
        keys(fxp(C, "アクセント線(%)"), [[0.25, 0], [0.6, 100], [D - 0.45, 100], [D - 0.25, 0]], 80, 15);

        var y = 958, h = 84;
        var bar = makeBar(comp, {
            name: "下部テロップ", text: TXT.bottom, font: FONT.bold, size: 48,
            textColor: "色:文字", boxColor: "色:帯",
            x: 960, y: y, h: h, padL: 44, padR: 44, grow: "center", slider: "帯(%)"
        });
        textMotion(bar.text, 0.15, 0.35, D);

        var AL = rectLayer(comp, "アクセント線", [10, 6], [960, y + h / 2 + 3], 0, COL.cyan);
        setExpr(rectSize(AL, "G"),
            'var r=thisComp.layer("下部テロップ").sourceRectAtTime(time,false);var p=thisComp.layer("CTRL").effect("アクセント線(%)")(1)/100;[Math.max((r.width+88)*p,0.01),6]',
            "アクセント線 サイズ");
        setExpr(fillColor(AL, "G"), CR + 'C.effect("色:アクセント")(1)', "アクセント線 色");

        C.moveToBeginning();
        egp(comp, srcText(bar.text), "下部テロップ");
        egpFx(comp, C, "色:帯");
        egpFx(comp, C, "色:文字");
        egpFx(comp, C, "色:アクセント");
        setTemplateName(comp, "かながわの現場 下部テロップ");
        protect(comp, 0, 0.7, "IN（伸ばしても変わらない）");
        protect(comp, D - 0.45, 0.45, "OUT（伸ばしても変わらない）");
        return comp;
    }

    // =================================================================
    //  04 名前テロップ（左下：肩書きタグ＋名前＋所属）
    // =================================================================
    function buildName(N) {
        var D = 8;
        var comp = newComp(N.name, D, FOLDER_MAIN);

        var C = comp.layers.addNull(D);
        C.name = "CTRL";
        addColorCtl(C, "色:名前の帯", COL.black);
        addColorCtl(C, "色:名前の文字", COL.white);
        addColorCtl(C, "色:肩書きタグ", COL.cyan);
        addColorCtl(C, "色:肩書きの文字", COL.white);
        addColorCtl(C, "色:所属の帯", COL.white);
        addColorCtl(C, "色:所属の文字", COL.black);
        addSlider(C, "名前の帯(%)", 0);
        addSlider(C, "肩書きタグ(%)", 0);
        addSlider(C, "所属の帯(%)", 0);
        keys(fxp(C, "名前の帯(%)"), [[0, 0], [0.35, 100], [D - 0.3, 100], [D - 0.02, 0]], 80, 15);
        keys(fxp(C, "肩書きタグ(%)"), [[0.22, 0], [0.5, 100], [D - 0.4, 100], [D - 0.16, 0]], 80, 15);
        keys(fxp(C, "所属の帯(%)"), [[0.32, 0], [0.62, 100], [D - 0.36, 100], [D - 0.1, 0]], 80, 15);

        var X = 110;
        var org = makeBar(comp, {
            name: "所属", text: TXT.org, font: FONT.medium, size: 34,
            textColor: "色:所属の文字", boxColor: "色:所属の帯",
            x: X, y: 955, h: 60, padL: 26, padR: 28, grow: "left", slider: "所属の帯(%)"
        });
        textMotion(org.text, 0.4, 0.36, D);

        var nm = makeBar(comp, {
            name: "名前", text: TXT.name, font: FONT.bold, size: 62,
            textColor: "色:名前の文字", boxColor: "色:名前の帯",
            x: X, y: 879, h: 92, padL: 30, padR: 36, grow: "left", slider: "名前の帯(%)"
        });
        textMotion(nm.text, 0.12, 0.3, D);

        var rl = makeBar(comp, {
            name: "肩書き", text: TXT.role, font: FONT.bold, size: 28,
            textColor: "色:肩書きの文字", boxColor: "色:肩書きタグ",
            x: X, y: 809, h: 48, padL: 18, padR: 20, grow: "left", slider: "肩書きタグ(%)"
        });
        textMotion(rl.text, 0.3, 0.4, D);

        C.moveToBeginning();
        egp(comp, srcText(nm.text), "名前");
        egp(comp, srcText(rl.text), "肩書き");
        egp(comp, srcText(org.text), "所属");
        egpFx(comp, C, "色:名前の帯");
        egpFx(comp, C, "色:名前の文字");
        egpFx(comp, C, "色:肩書きタグ");
        egpFx(comp, C, "色:肩書きの文字");
        egpFx(comp, C, "色:所属の帯");
        egpFx(comp, C, "色:所属の文字");
        setTemplateName(comp, "かながわの現場 名前テロップ");
        protect(comp, 0, 1.0, "IN（伸ばしても変わらない）");
        protect(comp, D - 0.45, 0.45, "OUT（伸ばしても変わらない）");
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
            var path = folder.fsName + "/" + list[i].file + ".mogrt";
            var ok = false;
            try { ok = list[i].comp.exportAsMotionGraphicsTemplate(true, path); } catch (e) { ok = false; }
            if (ok) { okNames.push(list[i].file + ".mogrt"); } else { ngNames.push(list[i].comp.name); }
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

        app.beginUndoGroup("かながわの現場テンプレートを作成");
        try { app.beginSuppressDialogs(); } catch (eS) {}
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
        var op = buildOP(N);
        var corner = buildCorner(N);
        var bottom = buildBottom(N);
        var nameT = buildName(N);

        try { app.endSuppressDialogs(false); } catch (eS2) {}
        app.endUndoGroup();
        try { op.openInViewer(); } catch (eV) {}

        var msg = "「かながわの現場」テンプレートを作成しました！\n\n" +
            "・" + op.name + "\n・" + corner.name + "\n・" + bottom.name + "\n・" + nameT.name + "\n\n" +
            "ロゴ画像の保存先：\n" + assetDir + "\n（このフォルダは消さないでください）\n";
        if (EXPR_ERRORS.length) {
            msg += "\n※ エクスプレッションの警告が " + EXPR_ERRORS.length + " 件ありました：\n" + EXPR_ERRORS.slice(0, 8).join("\n") + "\n";
        }
        alert(msg);

        if (confirm("続けて、Premiere Pro 用の MOGRT（モーショングラフィックステンプレート）を書き出しますか？\n（保存先フォルダを選びます）")) {
            var res = exportMogrts([
                { comp: op, file: "かながわの現場_01_オープニング" },
                { comp: corner, file: "かながわの現場_02_左上ロゴ上部タイトル" },
                { comp: bottom, file: "かながわの現場_03_下部テロップ" },
                { comp: nameT, file: "かながわの現場_04_名前テロップ" }
            ]);
            alert(res + "\n最後に、このプロジェクトを保存（ファイル → 保存）しておくと、あとから AE で編集できます。");
        }
    }

    main();

})();
