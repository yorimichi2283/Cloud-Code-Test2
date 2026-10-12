/*
 * 激ヤバドリンクを / 飲んでみる  バラエティ風テロップ生成スクリプト (After Effects)
 *
 * 使い方:
 *   AE で「ファイル > スクリプト > スクリプトファイルを実行...」からこのファイルを選ぶ。
 *   プロジェクトに以下が作られる:
 *     TELOP_激ヤバドリンク (メインコンポ 1920x1080 / 30fps / 4秒)
 *       ├ L2_飲んでみる       (プリコンポ)  ← 拡大ポップ＋着地シェイク＋退場
 *       └ L1_激ヤバドリンクを (プリコンポ)
 *     各プリコンポの中身:
 *       TEXT_文字を編集      … ここの文字を打ち替えると、フチも自動で追従
 *       FILL_グラデ          … 赤グラデ（グラデーションの色はエフェクト「グラデーション」で変更）
 *       STROKE_白フチ
 *       STROKE_外フチ
 *
 * 見た目やタイミングは下の CONFIG を変えて再実行すれば作り直せます。
 * ※ このファイルは UTF-8 (BOM 付き) で保存してください。
 */
(function () {
    var CONFIG = {
        compName: "TELOP_激ヤバドリンク",
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 4, // 秒

        // 上から順に試して、最初に見つかったフォントを使う（PostScript 名）
        fonts: [
            "NotoSerifJP-Black",      // Noto Serif JP Black (Google Fonts)
            "SourceHanSerif-Heavy",   // 源ノ明朝 Heavy
            "SourceHanSerifJP-Heavy",
            "HiraMinProN-W6",         // ヒラギノ明朝 W6 (Mac)
            "YuMincho-Demibold",      // 游明朝 Demibold (Win)
            "HiraginoSans-W9",        // ヒラギノ角ゴ W9 (Mac)
            "YuGothic-Bold"           // 游ゴシック Bold (Win)
        ],

        fillTop: [255, 70, 40],      // グラデ上
        fillBottom: [170, 0, 12],    // グラデ下
        whiteStroke: [255, 255, 255],
        outerStroke: [45, 8, 4],     // 外フチ（こげ茶）
        whiteStrokeRatio: 0.16,      // 白フチ線幅 = 文字サイズ × これ
        outerStrokeRatio: 0.34,      // 外フチ線幅 = 文字サイズ × これ
        tracking: -20,

        shadow: { opacity: 70, direction: 135, distance: 14, softness: 12 },

        // 行ごとの設定（frame はメインコンポのフレーム番号）
        lines: [
            { name: "L1", text: "激ヤバドリンクを", size: 120, pos: [960, 760], inFrame: 0, outFrame: 102 },
            { name: "L2", text: "飲んでみる",       size: 160, pos: [960, 915], inFrame: 9, outFrame: 104 }
        ],

        // アニメーション（行の開始からのフレーム数）
        popScale: [[0, 380], [5, 92], [8, 106], [11, 100]], // ドンッと拡大→着地→ちょい跳ね
        popRotation: [[0, -10], [5, 0]],
        holdScaleEnd: 103,        // 表示中にゆっくりズーム（退場直前の値）
        outFrames: 6,             // 退場（縮小して消える）にかけるフレーム数
        shake: { startFrame: 5, frames: 9, amount: 22 }
    };

    // ------------------------------------------------------------------

    function rgb(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }

    function fontExists(ps) {
        try {
            if (app.fonts && app.fonts.getFontsByPostScriptName) {
                return app.fonts.getFontsByPostScriptName(ps).length > 0;
            }
        } catch (e) {}
        return null; // 判定できない（古い AE）
    }

    function applyFont(doc, textProp) {
        for (var i = 0; i < CONFIG.fonts.length; i++) {
            var ps = CONFIG.fonts[i];
            var ok = fontExists(ps);
            if (ok === false) continue;
            doc.font = ps;
            textProp.setValue(doc);
            if (ok === true || textProp.value.font === ps) return ps;
        }
        return null;
    }

    function makeText(comp, line, layerName, fillColor, strokeColor, strokeWidth) {
        var layer = comp.layers.addText(line.text);
        layer.name = layerName;
        var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var doc = textProp.value;
        try { doc.resetCharStyle(); } catch (e) {}
        doc.fontSize = line.size;
        doc.tracking = CONFIG.tracking;
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        doc.applyFill = true;
        doc.fillColor = rgb(fillColor);
        if (strokeWidth > 0) {
            doc.applyStroke = true;
            doc.strokeColor = rgb(strokeColor);
            doc.strokeWidth = strokeWidth;
            doc.strokeOverFill = false;
            try { doc.lineJoinType = LineJoinType.LINE_JOIN_ROUND; } catch (e) {}
        } else {
            doc.applyStroke = false;
        }
        textProp.setValue(doc);
        line.usedFont = applyFont(textProp.value, textProp) || line.usedFont;
        return layer;
    }

    // 文字の中心を基準点にして、コンポ中央に置く（全レイヤー TEXT_ の矩形を共有）
    function centerOn(layer, masterName, comp) {
        var tr = layer.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").expression =
            'var r = thisComp.layer("' + masterName + '").sourceRectAtTime(time, false);\n' +
            '[r.left + r.width / 2, r.top + r.height / 2];';
        tr.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
    }

    function setKeys(prop, keys, startFrame, fps, mapValue) {
        for (var i = 0; i < keys.length; i++) {
            var t = (startFrame + keys[i][0]) / fps;
            prop.setValueAtTime(t, mapValue(keys[i][1]));
        }
    }

    function easeKeys(prop, fromKey, toKey, inInf, outInf) {
        var dims = 1;
        var vt = prop.propertyValueType;
        if (vt === PropertyValueType.TwoD) dims = 2;
        if (vt === PropertyValueType.ThreeD) dims = 3;
        for (var k = fromKey; k <= toKey; k++) {
            var eIn = [], eOut = [];
            for (var d = 0; d < dims; d++) {
                eIn.push(new KeyframeEase(0, inInf));
                eOut.push(new KeyframeEase(0, outInf));
            }
            try { prop.setTemporalEaseAtKey(k, eIn, eOut); } catch (e) {}
        }
    }

    function setMatte(layer, matteLayer) {
        if (layer.setTrackMatte) {
            layer.setTrackMatte(matteLayer, TrackMatteType.ALPHA); // AE 2023+
        } else {
            layer.trackMatteType = TrackMatteType.ALPHA;           // 旧方式（直上のレイヤーがマット）
        }
        matteLayer.enabled = false;
    }

    function buildLinePrecomp(line) {
        var c = app.project.items.addComp(line.name + "_" + line.text, CONFIG.width, CONFIG.height, 1,
            CONFIG.duration, CONFIG.fps);
        var masterName = "TEXT_文字を編集";
        // 文字列だけをリンク（書式は各レイヤーのものを維持）
        var linkExpr = '"" + thisComp.layer("' + masterName + '").text.sourceText;';

        // 下から順に作る（addText は最前面に追加される）
        var outer = makeText(c, line, "STROKE_外フチ", CONFIG.outerStroke, CONFIG.outerStroke,
            Math.round(line.size * CONFIG.outerStrokeRatio));
        var white = makeText(c, line, "STROKE_白フチ", CONFIG.whiteStroke, CONFIG.whiteStroke,
            Math.round(line.size * CONFIG.whiteStrokeRatio));

        var fill = c.layers.addSolid([1, 1, 1], "FILL_グラデ", c.width, c.height, 1);
        var ramp = fill.property("ADBE Effect Parade").addProperty("ADBE Ramp");
        ramp.property("ADBE Ramp-0002").setValue(rgb(CONFIG.fillTop));
        ramp.property("ADBE Ramp-0004").setValue(rgb(CONFIG.fillBottom));
        ramp.property("ADBE Ramp-0005").setValue(1); // 線形
        // グラデの開始/終了を文字の上端/下端に自動追従
        ramp.property("ADBE Ramp-0001").expression =
            'var L = thisComp.layer("' + masterName + '"); var r = L.sourceRectAtTime(time, false);\n' +
            'L.toComp([r.left + r.width / 2, r.top]);';
        ramp.property("ADBE Ramp-0003").expression =
            'var L = thisComp.layer("' + masterName + '"); var r = L.sourceRectAtTime(time, false);\n' +
            'L.toComp([r.left + r.width / 2, r.top + r.height]);';

        var master = makeText(c, line, masterName, [255, 255, 255], [0, 0, 0], 0);

        centerOn(master, masterName, c);
        centerOn(white, masterName, c);
        centerOn(outer, masterName, c);

        white.property("ADBE Text Properties").property("ADBE Text Document").expression = linkExpr;
        outer.property("ADBE Text Properties").property("ADBE Text Document").expression = linkExpr;

        setMatte(fill, master);
        return c;
    }

    function animateLineLayer(layer, line) {
        var fps = CONFIG.fps;
        var tr = layer.property("ADBE Transform Group");
        var s0 = line.inFrame;

        layer.startTime = s0 / fps;
        layer.inPoint = s0 / fps;
        layer.outPoint = (line.outFrame + CONFIG.outFrames) / fps;

        // 基準点を文字の中心に（プリコンポ内の中心＝コンポ中心）→ 画面上の配置は Position で
        tr.property("ADBE Anchor Point").setValue([CONFIG.width / 2, CONFIG.height / 2]);
        tr.property("ADBE Position").setValue(line.pos);

        // スケール: ポップ → ホールド中ゆっくりズーム → 退場
        var scale = tr.property("ADBE Scale");
        var sKeys = CONFIG.popScale.slice(0);
        var outRel = line.outFrame - s0;
        sKeys.push([outRel, CONFIG.holdScaleEnd]);
        sKeys.push([outRel + CONFIG.outFrames, 0]);
        setKeys(scale, sKeys, s0, fps, function (v) { return [v, v, 100]; });
        var n = scale.numKeys;
        // 1→2: 勢いよく入って着地でブレーキ
        easeKeys(scale, 1, 1, 33, 10);
        easeKeys(scale, 2, 4, 60, 60);
        scale.setInterpolationTypeAtKey(4, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.LINEAR);
        easeKeys(scale, n - 1, n - 1, 33, 70); // 退場は加速して消える
        scale.setInterpolationTypeAtKey(n - 1, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.BEZIER);
        scale.setInterpolationTypeAtKey(n, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);

        var rot = tr.property("ADBE Rotate Z");
        setKeys(rot, CONFIG.popRotation, s0, fps, function (v) { return v; });
        easeKeys(rot, 1, rot.numKeys, 60, 10);

        var opa = tr.property("ADBE Opacity");
        setKeys(opa, [[0, 0], [2, 100]], s0, fps, function (v) { return v; });

        // 着地シェイク（位置にエクスプレッション。数値はここで調整可）
        var sh = CONFIG.shake;
        tr.property("ADBE Position").expression =
            '// 着地シェイク\n' +
            'var startF = ' + sh.startFrame + ';  // レイヤー開始から何フレーム後に揺らすか\n' +
            'var lenF = ' + sh.frames + ';     // 揺れの長さ（フレーム）\n' +
            'var amp = ' + sh.amount + ';      // 揺れ幅(px)\n' +
            'var t = (time - inPoint) / thisComp.frameDuration - startF;\n' +
            'if (t >= 0 && t < lenF) {\n' +
            '  seedRandom(index * 1000 + Math.floor(t), true);\n' +
            '  var d = 1 - t / lenF;\n' +
            '  value + [random(-1, 1), random(-1, 1)] * amp * d;\n' +
            '} else value;';

        // ドロップシャドウ
        var ds = layer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
        ds.property("ADBE Drop Shadow-0001").setValue([0, 0, 0]);
        try { ds.property("ADBE Drop Shadow-0002").setValue(CONFIG.shadow.opacity / 100 * 255); }
        catch (e) { ds.property("ADBE Drop Shadow-0002").setValue(CONFIG.shadow.opacity); }
        ds.property("ADBE Drop Shadow-0003").setValue(CONFIG.shadow.direction);
        ds.property("ADBE Drop Shadow-0004").setValue(CONFIG.shadow.distance);
        ds.property("ADBE Drop Shadow-0005").setValue(CONFIG.shadow.softness);

        layer.motionBlur = true;
    }

    // ------------------------------------------------------------------

    if (!app.project) app.newProject();
    app.beginUndoGroup("テロップ生成: 激ヤバドリンク");
    try {
        var folder = app.project.items.addFolder(CONFIG.compName);
        var main = app.project.items.addComp(CONFIG.compName, CONFIG.width, CONFIG.height, 1,
            CONFIG.duration, CONFIG.fps);
        main.parentFolder = folder;
        main.motionBlur = true;
        main.shutterAngle = 180;

        var usedFonts = [];
        for (var i = 0; i < CONFIG.lines.length; i++) {
            var line = CONFIG.lines[i];
            var pre = buildLinePrecomp(line);
            pre.parentFolder = folder;
            var lyr = main.layers.add(pre);
            lyr.name = line.name + "_" + line.text;
            animateLineLayer(lyr, line);
            usedFonts.push(line.text + ": " + (line.usedFont || "（候補フォントが見つからず既定フォント）"));
        }

        main.openInViewer();
        alert("テロップを作成しました。\n\n" + usedFonts.join("\n") +
            "\n\n文字の変更: 各プリコンポ内の「TEXT_文字を編集」レイヤーを打ち替え\n" +
            "フォントの変更: TEXT_ / STROKE_ の3レイヤーを選んで文字パネルで変更");
    } catch (err) {
        alert("エラー: " + err.toString() + (err.line ? " (line " + err.line + ")" : ""));
    } finally {
        app.endUndoGroup();
    }
})();
