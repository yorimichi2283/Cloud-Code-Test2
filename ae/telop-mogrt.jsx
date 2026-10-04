/*
 * 説テロップ工房 — Premiere Pro で文字を打ち替えられるテンプレート（.mogrt）を作る After Effects スクリプト
 *
 * 使い方
 *   1. After Effects の「設定 → スクリプトとエクスプレッション」で
 *      「スクリプトによるファイルへの書き込みとネットワークへのアクセスを許可」をオンにする
 *   2. 「ファイル → スクリプト → スクリプトファイルを実行…」でこのファイルを選ぶ
 *   3. デスクトップの「説テロップ_mogrt」フォルダに .mogrt と .aep ができる。
 *      同じものが Premiere の「エッセンシャルグラフィックス → 参照」にも入る
 *
 * 再現している動き
 *   - ちらつき：番組でよく使われるストロボ（元の画像とブレンド 90% / 長さ 0.05 秒 / 間隔 0.1 秒）
 *   - 書体：極太明朝。ロマン雪などを持っていれば下の CONFIG に PostScript 名を書くとそれを使う
 *   - 縁取り＋ぼかした影。縁は文字と別のレイヤーにして、隣の文字にかぶらないようにしている
 *
 * Premiere 側で変えられるもの（エッセンシャルグラフィックス）
 *   テキスト / 出し方 / 向き / ちらつき / 最後に消える / ゆっくり寄る / 大きさ / 色
 *
 * 作りのメモ
 *   After Effects ではプロパティを足すと、同じグループの既存の参照が無効になる。
 *   そのためプロパティは毎回レイヤーからの道筋（path）でたどり直し、
 *   エクスプレッションは全レイヤーを作り終えてからまとめて設定する。
 */
(function () {
  var CONFIG = {
    width: 1920,
    height: 1080,
    fps: 29.97,
    duration: 5,
    outputFolder: Folder.desktop.fsName + "/説テロップ_mogrt",
    // 使いたい書体の PostScript 名（例：ロマン雪）。空ならインストール済みのものから選ぶ
    fontMincho: "",
    fontNazori: ""
  };

  // 上から順に、インストールされているものを使う（最後のヒラギノ明朝は Mac に最初から入っている）
  var FONT_CANDIDATES = {
    mincho: [
      "DFRomanYukiStd-W9", "DFRomanYukiA-W9", "DFPRomanYukiStd-W9",
      "ZenOldMincho-Black", "ShipporiMinchoB1-ExtraBold",
      "HiraMinProN-W6", "HiraMinPro-W6", "YuMin-Demibold"
    ],
    nazori: [
      "FOT-MatissePro-EB", "FOT-MatisseProN-EB", "MatissePro-EB",
      "ShipporiMinchoB1-ExtraBold", "ZenOldMincho-Bold", "ZenOldMincho-Black",
      "HiraMinProN-W6", "HiraMinPro-W6", "YuMin-Demibold"
    ]
  };
  var FALLBACK_FONT = "HiraMinProN-W6";

  var ANIMS = ["カット", "ストロボで出る", "ドーン", "ポップ", "タイプ", "スライド", "一文字スライド"];
  var DIRS = ["右から", "左から", "下から", "上から"];
  var A = { cut: 1, strobe: 2, slam: 3, pop: 4, type: 5, slide: 6, slideChars: 7 };
  var D = { right: 1, left: 2, bottom: 3, top: 4 };

  // 色は 0〜1。縁の太さ・影は文字の大きさに対する割合
  var PRESETS = [
    {
      name: "説テロップ_説の提示",
      text: "大人になってから\r食べる駄菓子\rだいたい美味しい説",
      font: "mincho", size: 120, leading: 1.36, tracking: 20, justify: "center",
      at: [0.5, 0.5], anchor: [0.5, 0.5], tilt: 0,
      fill: [1, 1, 1], edge1: [0.04, 0.04, 0.04], edge1Width: 0.09, edge2: null, edge2Width: 0,
      shadow: { opacity: 0.85, distance: 0.04, softness: 0.28 },
      bigSetsu: true, anim: A.cut, dir: D.right, flicker: true, drift: true
    },
    {
      name: "説テロップ_検証結果",
      text: "説 立証",
      font: "mincho", size: 230, leading: 1.1, tracking: 60, justify: "center",
      at: [0.5, 0.5], anchor: [0.5, 0.5], tilt: 0,
      fill: [1, 0.86, 0.29], edge1: [0.77, 0, 0.11], edge1Width: 0.075, edge2: [1, 1, 1], edge2Width: 0.045,
      shadow: { opacity: 0.8, distance: 0.03, softness: 0.24 },
      bigSetsu: false, anim: A.slam, dir: D.right, flicker: false, drift: false
    },
    {
      name: "説テロップ_なぞり",
      text: "いや、それは\r反則やろ",
      font: "nazori", size: 96, leading: 1.22, tracking: 20, justify: "center",
      at: [0.5, 0.91], anchor: [0.5, 1], tilt: 0,
      fill: [1, 1, 1], edge1: [0, 0, 0], edge1Width: 0.12, edge2: null, edge2Width: 0,
      shadow: { opacity: 0.9, distance: 0.03, softness: 0.18 },
      bigSetsu: false, anim: A.cut, dir: D.bottom, flicker: false, drift: false
    },
    {
      // 番組でよく使われる配色（文字 #EF9A0D / 座布団 #85ECFF）にストロボを掛けたもの
      name: "説テロップ_座布団",
      text: "このあと、まさかの展開に",
      font: "mincho", size: 104, leading: 1.2, tracking: 20, justify: "left",
      at: [0.07, 0.09], anchor: [0, 0], tilt: 0,
      fill: [0.937, 0.604, 0.051], edge1: [1, 1, 1], edge1Width: 0.08, edge2: [0.114, 0.165, 0.267], edge2Width: 0.04,
      shadow: null, band: [0.522, 0.925, 1],
      bigSetsu: false, anim: A.slide, dir: D.left, flicker: true, drift: false
    },
    {
      name: "説テロップ_ツッコミ",
      text: "いや知らんがな",
      font: "mincho", size: 88, leading: 1.2, tracking: 20, justify: "right",
      at: [0.93, 0.09], anchor: [1, 0], tilt: -4,
      fill: [1, 0.882, 0.302], edge1: [0.067, 0.067, 0.067], edge1Width: 0.12, edge2: null, edge2Width: 0,
      shadow: { opacity: 0.75, distance: 0.05, softness: 0.2 },
      bigSetsu: false, anim: A.pop, dir: D.right, flicker: false, drift: false
    }
  ];

  var warnings = [];
  var pending = [];
  var fontsUsed = {};

  // ───────── 小さな道具 ─────────

  function q(s) {
    return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  // 設定レイヤーのコントロールを読む式
  function ctrl(name) {
    return "thisComp.layer(" + q("設定") + ").effect(" + q(name) + ")(1).value";
  }

  function lines() {
    return Array.prototype.join.call(arguments, "\n");
  }

  // レイヤーから道筋をたどってプロパティを取り直す
  function prop(layer, path) {
    var p = layer;
    for (var i = 0; i < path.length; i++) {
      p = p.property(path[i]);
      if (!p) throw new Error("見つかりません：" + path.slice(0, i + 1).join(" > "));
    }
    return p;
  }

  function setVec(property, xy) {
    var v = property.value;
    var out = [];
    for (var i = 0; i < v.length; i++) out.push(i < xy.length ? xy[i] : v[i]);
    property.setValue(out);
  }

  // エクスプレッションは全レイヤーを作ってからまとめて設定する
  function later(layer, path, expression) {
    pending.push({ layer: layer, path: path, expression: expression });
  }

  function applyExpressions(compName) {
    for (var i = 0; i < pending.length; i++) {
      var job = pending[i];
      try {
        var p = prop(job.layer, job.path);
        p.expression = job.expression;
        if (p.expressionError) warnings.push(compName + " / " + job.layer.name + "：" + p.expressionError);
      } catch (e) {
        warnings.push(compName + " / " + job.layer.name + "：" + e.toString());
      }
    }
    pending = [];
  }

  // 効果の中から、指定した種類の n 番目のパラメーターの番号を探す（言語に左右されないように）
  function paramIndexOfType(fx, type, nth) {
    var seen = 0;
    for (var i = 1; i <= fx.numProperties; i++) {
      if (fx.property(i).propertyValueType === type) {
        seen++;
        if (seen === (nth || 1)) return i;
      }
    }
    throw new Error(fx.name + " に目的のパラメーターがありません");
  }

  function oneDParams(fx) {
    var list = [];
    for (var i = 1; i <= fx.numProperties; i++) {
      if (fx.property(i).propertyValueType === PropertyValueType.OneD) list.push(i);
    }
    return list;
  }

  function setMaxFraction(property, fraction) {
    if (property.hasMax) property.setValue(property.maxValue * fraction);
    else property.setValue(100 * fraction);
  }

  // 効果を足して名前を付ける。戻り値は使わず、名前でたどり直すこと
  function addEffect(layer, matchName, name) {
    var fx = layer.property("ADBE Effect Parade").addProperty(matchName);
    fx.name = name;
  }

  function effect(layer, name) {
    return prop(layer, ["ADBE Effect Parade", name]);
  }

  function expose(property, comp, label) {
    try {
      if (!property.canAddToMotionGraphicsTemplate(comp)) {
        warnings.push("エッセンシャルグラフィックスに追加できませんでした：" + label);
        return;
      }
      if (property.addToMotionGraphicsTemplateAs) property.addToMotionGraphicsTemplateAs(comp, label);
      else property.addToMotionGraphicsTemplate(comp);
    } catch (e) {
      warnings.push(label + "：" + e.toString());
    }
  }

  function pickFont(kind) {
    var override = kind === "nazori" ? CONFIG.fontNazori : CONFIG.fontMincho;
    if (override) return override;
    var list = FONT_CANDIDATES[kind];
    try {
      if (app.fonts && app.fonts.getFontsByPostScriptName) {
        for (var i = 0; i < list.length; i++) {
          var found = app.fonts.getFontsByPostScriptName(list[i]);
          if (found && found.length && !found[0].isSubstitute) return list[i];
        }
      }
    } catch (e) {
      // 古い After Effects では書体を調べられないので、Mac に必ずある書体にする
    }
    return FALLBACK_FONT;
  }

  function protect(comp, start, length, label) {
    try {
      var mv = new MarkerValue(label);
      mv.duration = length;
      mv.protectedRegion = true;
      comp.markerProperty.setValueAtTime(start, mv);
    } catch (e) {
      warnings.push("長さを変えても動きが崩れない設定（保護領域）を作れませんでした");
    }
  }

  // ───────── エクスプレッション ─────────

  // 文字の不透明度：ストロボで出る / ドーン / 最後に消える
  function opacityExpression() {
    return lines(
      "var mode = " + ctrl("出し方") + ";",
      "var useOut = " + ctrl("消える動き") + ";",
      "function stepAt(t, k) { var v = k[0][1]; for (var i = 0; i < k.length; i++) { if (t >= k[i][0]) v = k[i][1]; } return v; }",
      "var o = 100;",
      "if (mode == 2) o = stepAt(time, [[0, 0], [0.04, 100], [0.09, 12], [0.15, 100], [0.21, 12], [0.28, 100], [0.34, 30], [0.40, 100]]);",
      "if (mode == 3) o = linear(time, 0, 0.19, 0, 100);",
      "if (useOut == 1) {",
      "  var te = time - (thisComp.duration - 0.3);",
      "  if (te >= 0) {",
      "    if (mode == 2) o = Math.min(o, stepAt(te, [[0, 100], [0.07, 10], [0.13, 100], [0.2, 10], [0.24, 0]]));",
      "    else if (mode != 1 && mode != 6 && mode != 7) o = Math.min(o, linear(te, 0.05, 0.25, 100, 0));",
      "  }",
      "}",
      "o;"
    );
  }

  // まとめ役（動き）の位置：スライドで出入り / ドーンの揺れ
  function movePositionExpression() {
    return lines(
      "var mode = " + ctrl("出し方") + ";",
      "var dir = " + ctrl("向き") + ";",
      "var useOut = " + ctrl("消える動き") + ";",
      "var vx = [1, -1, 0, 0][dir - 1], vy = [0, 0, 1, -1][dir - 1];",
      "var dist = (vx != 0) ? thisComp.width : thisComp.height * 1.1;",
      "var x = 0, y = 0;",
      "if (mode == 6) {",
      "  var a = (time < 0.39) ? easeOut(time, 0, 0.39, 1, -0.02) : ease(time, 0.39, 0.5, -0.02, 0);",
      "  x = vx * a * dist; y = vy * a * dist;",
      "}",
      "if (mode == 3) {",
      "  var k = [[-14, 9], [12, -12], [-9, -5], [7, 7], [-4, 0], [0, 0]];",
      "  var i = Math.floor((time - 0.26) / 0.38 * 6);",
      "  if (i >= 0 && i < 6) { x += k[i][0]; y += k[i][1]; }",
      "}",
      // 横は来た向きのまま反対側へ抜け、縦は来た方へ戻る
      "if (useOut == 1 && (mode == 6 || mode == 7)) {",
      "  var te = time - (thisComp.duration - 0.3);",
      "  if (te > 0) {",
      "    var b = easeIn(te, 0, 0.25, 0, 1);",
      "    x += (vx != 0 ? -vx : 0) * b * dist; y += vy * b * dist;",
      "  }",
      "}",
      "add(value, value.length > 2 ? [x, y, 0] : [x, y]);"
    );
  }

  // まとめ役（動き）の大きさ：大きさ / はみ出し防止 / ドーン / ゆっくり寄る / 最後に消える
  function moveScaleExpression() {
    return lines(
      "var mode = " + ctrl("出し方") + ";",
      "var useOut = " + ctrl("消える動き") + ";",
      "var drift = " + ctrl("ゆっくり寄る") + ";",
      "var size = " + ctrl("大きさ") + " / 100;",
      "var r = thisComp.layer(" + q("文字") + ").sourceRectAtTime(thisComp.duration / 2, false);",
      "var fit = Math.min(1, thisComp.width * 0.9 / Math.max(1, r.width * size), thisComp.height * 0.9 / Math.max(1, r.height * size));",
      "var s = 100 * size * fit;",
      "if (mode == 3) {",
      "  var m;",
      "  if (time < 0.25) m = easeOut(time, 0, 0.25, 2.6, 0.94);",
      "  else if (time < 0.33) m = ease(time, 0.25, 0.33, 0.94, 1.03);",
      "  else m = ease(time, 0.33, 0.42, 1.03, 1);",
      "  s *= m;",
      "}",
      "if (drift == 1) s *= linear(time, 0.4, 7.4, 1, 1.07);",
      "if (useOut == 1 && (mode == 3 || mode == 4 || mode == 5)) s *= linear(time, thisComp.duration - 0.22, thisComp.duration, 1, 0.96);",
      "value.length > 2 ? [s, s, value[2]] : [s, s];"
    );
  }

  // 文字レイヤーの基準点：文字のかたまりの決めた位置（中央・下・左上…）
  function anchorExpression(P) {
    return lines(
      "var r = thisComp.layer(" + q("文字") + ").sourceRectAtTime(thisComp.duration / 2, false);",
      "var p = [r.left + r.width * " + P.anchor[0] + ", r.top + r.height * " + P.anchor[1] + "];",
      "value.length > 2 ? [p[0], p[1], 0] : p;"
    );
  }

  // ───────── 文字レイヤー ─────────

  function justification(P) {
    if (P.justify === "left") return ParagraphJustification.LEFT_JUSTIFY;
    if (P.justify === "right") return ParagraphJustification.RIGHT_JUSTIFY;
    return ParagraphJustification.CENTER_JUSTIFY;
  }

  var ROLE_NAMES = { fill: "文字", edge1: "縁", edge2: "外縁" };
  var ROLE_COLORS = { fill: "文字の色", edge1: "縁の色", edge2: "外縁の色" };

  // role: "fill"（文字）/ "edge1"（縁）/ "edge2"（外縁）
  function addTextLayer(comp, P, role, fontName, parent) {
    var layer = comp.layers.addText(P.text);
    layer.name = ROLE_NAMES[role];

    var sourceText = prop(layer, ["ADBE Text Properties", "ADBE Text Document"]);
    var td = sourceText.value;
    try { td.resetCharStyle(); } catch (e1) {}
    try { td.resetParagraphStyle(); } catch (e2) {}
    td.font = fontName;
    td.fontSize = P.size;
    try { td.autoLeading = false; } catch (e3) {}
    td.leading = Math.round(P.size * P.leading);
    td.tracking = P.tracking;
    td.applyFill = true;
    td.fillColor = [1, 1, 1];
    if (role === "fill") {
      td.applyStroke = false;
    } else {
      var width = role === "edge1" ? P.edge1Width : P.edge1Width + P.edge2Width;
      td.applyStroke = true;
      td.strokeColor = [0, 0, 0];
      td.strokeWidth = Math.max(1, Math.round(P.size * width * 2));
      td.strokeOverFill = false;
      try { td.lineJoinType = LineJoinType.LINE_JOIN_ROUND; } catch (e4) {}
    }
    td.justification = justification(P);
    sourceText.setValue(td);

    // 縁のレイヤーは「文字」の内容をそのまま使う（Premiere で打ち替えた文字に追従する）
    if (role !== "fill") {
      later(layer, ["ADBE Text Properties", "ADBE Text Document"], '"" + thisComp.layer(' + q("文字") + ").text.sourceText;");
    }

    // 色は設定レイヤーの色コントロールから
    addEffect(layer, "ADBE Fill", "色");
    var colorIndex = paramIndexOfType(effect(layer, "色"), PropertyValueType.COLOR, 1);
    later(layer, ["ADBE Effect Parade", "色", colorIndex], "thisComp.layer(" + q("設定") + ").effect(" + q(ROLE_COLORS[role]) + ")(1);");

    addTextAnimators(layer, P);

    layer.parent = parent;
    setVec(prop(layer, ["ADBE Transform Group", "ADBE Position"]), [0, 0]);
    later(layer, ["ADBE Transform Group", "ADBE Anchor Point"], anchorExpression(P));
    later(layer, ["ADBE Transform Group", "ADBE Opacity"], opacityExpression());
    return layer;
  }

  var ANIMATORS = ["ADBE Text Properties", "ADBE Text Animators"];

  function addAnimator(layer, name) {
    var animator = prop(layer, ANIMATORS).addProperty("ADBE Text Animator");
    animator.name = name;
  }

  // 一文字ずつの動きの値を決める（足すたびにたどり直す）
  function setAnimatorValue(layer, animator, matchName, value) {
    prop(layer, ANIMATORS.concat([animator, "ADBE Text Animator Properties"])).addProperty(matchName);
    var p = prop(layer, ANIMATORS.concat([animator, "ADBE Text Animator Properties", matchName]));
    if (typeof value === "number") p.setValue(value);
    else setVec(p, value);
  }

  // 式セレクターだけにする（範囲セレクターが残っていると、全文字に動きが掛かったままになる）
  function addExpressionSelector(layer, animator, amountExpression) {
    var path = ANIMATORS.concat([animator, "ADBE Text Selectors"]);
    for (var i = prop(layer, path).numProperties; i >= 1; i--) {
      var selector = prop(layer, path).property(i);
      if (selector.matchName === "ADBE Text Selector") selector.remove();
    }
    prop(layer, path).addProperty("ADBE Text Expressible Selector");
    later(layer, path.concat(["ADBE Text Expressible Selector", "ADBE Text Expressible Amount"]), amountExpression);
  }

  // 一文字ずつの動き。縁のレイヤーにも同じものを付けて、文字と縁がずれないようにする
  function addTextAnimators(layer, P) {
    var s = P.size;

    // 最後の「説」を一回り大きく（左の文字にかぶらないよう右へ少しずらす）
    addAnimator(layer, "最後の説");
    setAnimatorValue(layer, "最後の説", "ADBE Text Scale 3D", [132, 132]);
    setAnimatorValue(layer, "最後の説", "ADBE Text Position 3D", [Math.round(s * 0.16), 0]);
    addExpressionSelector(layer, "最後の説", lines(
      "var on = " + ctrl("説を大きく") + ";",
      'var str = "" + thisComp.layer(' + q("文字") + ").text.sourceText;",
      "var a = (on == 1 && textIndex == textTotal && str.charAt(str.length - 1) == " + q("説") + ") ? 100 : 0;",
      "[a, a, a];"
    ));

    // ポップ：小さい状態から弾んで出る
    addAnimator(layer, "ポップ");
    setAnimatorValue(layer, "ポップ", "ADBE Text Scale 3D", [0, 0]);
    setAnimatorValue(layer, "ポップ", "ADBE Text Opacity", 0);
    setAnimatorValue(layer, "ポップ", "ADBE Text Position 3D", [0, Math.round(s * 0.3)]);
    addExpressionSelector(layer, "ポップ", lines(
      "var mode = " + ctrl("出し方") + ";",
      "var a = 0;",
      "if (mode == 4) {",
      "  var t = time - (textIndex - 1) * 0.045;",
      "  if (t <= 0) a = 100;",
      "  else if (t < 0.24) a = easeOut(t, 0, 0.24, 100, -18);",
      "  else a = ease(t, 0.24, 0.42, -18, 0);",
      "}",
      "[a, a, a];"
    ));

    // タイプ：一文字ずつパッと出る
    addAnimator(layer, "タイプ");
    setAnimatorValue(layer, "タイプ", "ADBE Text Opacity", 0);
    addExpressionSelector(layer, "タイプ", lines(
      "var mode = " + ctrl("出し方") + ";",
      "var a = (mode == 5 && time < (textIndex - 1) * 0.072) ? 100 : 0;",
      "[a, a, a];"
    ));

    // 一文字スライド：一文字ずつ、選んだ向きから滑り込む
    addAnimator(layer, "一文字スライド");
    setAnimatorValue(layer, "一文字スライド", "ADBE Text Position 3D", [Math.round(s * 1.1), 0]);
    setAnimatorValue(layer, "一文字スライド", "ADBE Text Opacity", 0);
    later(layer, ANIMATORS.concat(["一文字スライド", "ADBE Text Animator Properties", "ADBE Text Position 3D"]), lines(
      "var dir = " + ctrl("向き") + ";",
      "var d = [[" + Math.round(s * 1.1) + ", 0], [" + Math.round(-s * 1.1) + ", 0], [0, " + Math.round(s * 0.9) + "], [0, " + Math.round(-s * 0.9) + "]][dir - 1];",
      "value.length > 2 ? [d[0], d[1], 0] : d;"
    ));
    addExpressionSelector(layer, "一文字スライド", lines(
      "var mode = " + ctrl("出し方") + ";",
      "var a = 0;",
      "if (mode == 7) {",
      "  var t = time - (textIndex - 1) * 0.045;",
      "  a = (t <= 0) ? 100 : easeOut(t, 0, 0.34, 100, 0);",
      "}",
      "[a, a, a];"
    ));
  }

  // ───────── 影 ─────────

  // Drop Shadow の数値パラメーターの並び：不透明度 / 方向 / 距離 / 柔らかさ
  function addShadow(layer, name, color, opacity, direction, distance, softness) {
    addEffect(layer, "ADBE Drop Shadow", name);
    var fx = effect(layer, name);
    fx.property(paramIndexOfType(fx, PropertyValueType.COLOR, 1)).setValue(color);
    var nums = oneDParams(fx);
    if (nums.length < 4) {
      warnings.push("影の設定を見つけられませんでした：" + layer.name);
      return;
    }
    setMaxFraction(effect(layer, name).property(nums[0]), opacity);
    effect(layer, name).property(nums[1]).setValue(direction);
    effect(layer, name).property(nums[2]).setValue(distance);
    effect(layer, name).property(nums[3]).setValue(softness);
  }

  // ───────── 座布団 ─────────

  var BAND_GROUP = ["ADBE Root Vectors Group", 1];

  function addBand(comp, P, parent) {
    var layer = comp.layers.addShape();
    layer.name = "座布団";
    prop(layer, ["ADBE Root Vectors Group"]).addProperty("ADBE Vector Group");
    prop(layer, BAND_GROUP.concat(["ADBE Vectors Group"])).addProperty("ADBE Vector Shape - Rect");
    prop(layer, BAND_GROUP.concat(["ADBE Vectors Group"])).addProperty("ADBE Vector Graphic - Fill");
    try { prop(layer, BAND_GROUP.concat(["ADBE Vector Transform Group", "ADBE Vector Skew"])).setValue(-10); } catch (e) {}

    var s = P.size;
    var box = lines(
      "var mode = " + ctrl("出し方") + ";",
      "var r = thisComp.layer(" + q("文字") + ").sourceRectAtTime(thisComp.duration / 2, false);",
      "var padL = " + Math.round(s * 0.45) + ", padR = " + Math.round(s * 0.55) + ", padY = " + Math.round(s * 0.16) + ";",
      "var w = r.width + padL + padR, h = r.height + padY * 2;",
      // 帯は左から伸びる（カットのときは最初から全部）
      "var p = (mode == 1) ? 1 : easeOut(time, 0, 0.32, 0, 1);"
    );
    var rect = BAND_GROUP.concat(["ADBE Vectors Group", 1]);
    later(layer, rect.concat(["ADBE Vector Rect Size"]), box + "\n[w * p, h];");
    later(layer, rect.concat(["ADBE Vector Rect Position"]), box + "\n[r.left - padL + w * p / 2, r.top - padY + h / 2];");
    later(layer, BAND_GROUP.concat(["ADBE Vectors Group", 2, "ADBE Vector Fill Color"]), "thisComp.layer(" + q("設定") + ").effect(" + q("座布団の色") + ")(1);");

    // 右下にずらした紺色の影
    addShadow(layer, "影", P.edge2 || [0.114, 0.165, 0.267], 1, 135, Math.round(s * 0.08), 0);

    layer.parent = parent;
    setVec(prop(layer, ["ADBE Transform Group", "ADBE Position"]), [0, 0]);
    later(layer, ["ADBE Transform Group", "ADBE Anchor Point"], anchorExpression(P));
    later(layer, ["ADBE Transform Group", "ADBE Opacity"], opacityExpression());
    return layer;
  }

  // ───────── 設定レイヤー（Premiere で触るつまみ） ─────────

  function addControls(comp, P) {
    var layer = comp.layers.addNull(CONFIG.duration);
    layer.name = "設定";

    addEffect(layer, "ADBE Dropdown Control", "出し方");
    effect(layer, "出し方").property(1).setPropertyParameters(ANIMS);
    effect(layer, "出し方").property(1).setValue(P.anim);

    addEffect(layer, "ADBE Dropdown Control", "向き");
    effect(layer, "向き").property(1).setPropertyParameters(DIRS);
    effect(layer, "向き").property(1).setValue(P.dir);

    var values = [
      ["ADBE Checkbox Control", "ちらつき", P.flicker ? 1 : 0],
      ["ADBE Checkbox Control", "消える動き", 1],
      ["ADBE Checkbox Control", "ゆっくり寄る", P.drift ? 1 : 0],
      ["ADBE Checkbox Control", "説を大きく", P.bigSetsu ? 1 : 0],
      ["ADBE Slider Control", "大きさ", 100],
      ["ADBE Color Control", "文字の色", P.fill],
      ["ADBE Color Control", "縁の色", P.edge1],
      ["ADBE Color Control", "外縁の色", P.edge2 || P.edge1],
      ["ADBE Color Control", "座布団の色", P.band || [1, 1, 1]]
    ];
    for (var i = 0; i < values.length; i++) {
      addEffect(layer, values[i][0], values[i][1]);
      effect(layer, values[i][1]).property(1).setValue(values[i][2]);
    }
    return layer;
  }

  function exposeControls(comp, P, controls, textLayer) {
    expose(prop(textLayer, ["ADBE Text Properties", "ADBE Text Document"]), comp, "テキスト");
    var list = [
      ["出し方", "出し方"],
      ["向き", "向き（スライドのとき）"],
      ["ちらつき", "ちらつき（ストロボ）"],
      ["消える動き", "最後に消える"],
      ["ゆっくり寄る", "ゆっくり寄る"],
      ["大きさ", "大きさ（%）"]
    ];
    if (P.bigSetsu) list.push(["説を大きく", "最後の「説」を大きく"]);
    list.push(["文字の色", "文字の色"]);
    list.push(["縁の色", P.edge2 ? "内側の縁の色" : "縁の色"]);
    if (P.edge2) list.push(["外縁の色", "外側の縁の色"]);
    if (P.band) list.push(["座布団の色", "座布団の色"]);
    for (var i = 0; i < list.length; i++) {
      expose(effect(controls, list[i][0]).property(1), comp, list[i][1]);
    }
  }

  // ちらつき：番組でよく使われるストロボ（元の画像とブレンド 90% / 長さ 0.05 秒 / 間隔 0.1 秒）
  function addFlicker(comp) {
    var layer = comp.layers.addSolid([1, 1, 1], "ちらつき", CONFIG.width, CONFIG.height, 1, CONFIG.duration);
    layer.adjustmentLayer = true;
    addEffect(layer, "ADBE Strobe", "ストロボ");
    // ストロボのパラメーター：1 色 / 2 元の画像とブレンド / 3 長さ（秒）/ 4 間隔（秒）
    effect(layer, "ストロボ").property(3).setValue(0.05);
    effect(layer, "ストロボ").property(4).setValue(0.1);
    later(layer, ["ADBE Effect Parade", "ストロボ", 2], ctrl("ちらつき") + " == 1 ? 90 : 100;");
    return layer;
  }

  // ───────── 組み立て ─────────

  function buildComp(P, folder) {
    var comp = app.project.items.addComp(P.name, CONFIG.width, CONFIG.height, 1, CONFIG.duration, CONFIG.fps);
    comp.parentFolder = folder;
    comp.bgColor = [0.2, 0.2, 0.2];

    var fontName = pickFont(P.font);
    fontsUsed[P.font] = fontName;

    // レイヤーは下から順に作る（新しいレイヤーは一番上に入る）
    var move = comp.layers.addNull(CONFIG.duration);
    move.name = "動き";
    setVec(prop(move, ["ADBE Transform Group", "ADBE Anchor Point"]), [0, 0]);
    setVec(prop(move, ["ADBE Transform Group", "ADBE Position"]), [CONFIG.width * P.at[0], CONFIG.height * P.at[1]]);
    prop(move, ["ADBE Transform Group", "ADBE Rotate Z"]).setValue(P.tilt);
    later(move, ["ADBE Transform Group", "ADBE Position"], movePositionExpression());
    later(move, ["ADBE Transform Group", "ADBE Scale"], moveScaleExpression());

    if (P.band) addBand(comp, P, move);
    var bottomEdge = null;
    if (P.edge2) bottomEdge = addTextLayer(comp, P, "edge2", fontName, move);
    var edge1 = addTextLayer(comp, P, "edge1", fontName, move);
    if (!bottomEdge) bottomEdge = edge1;
    var text = addTextLayer(comp, P, "fill", fontName, move);
    if (P.shadow) {
      addShadow(bottomEdge, "ぼかした影", [0, 0, 0], P.shadow.opacity, 180,
        Math.round(P.size * P.shadow.distance), Math.round(P.size * P.shadow.softness));
    }

    var controls = addControls(comp, P);
    addFlicker(comp);
    applyExpressions(P.name);

    // Premiere で長さを変えても、出る動き・消える動きの速さは変わらないようにする
    protect(comp, 0, 2, "出る");
    protect(comp, CONFIG.duration - 0.5, 0.5, "消える");

    comp.motionGraphicsTemplateName = P.name;
    exposeControls(comp, P, controls, text);
    return { comp: comp, font: fontName };
  }

  function main() {
    if (parseFloat(app.version) < 17) {
      alert("After Effects 2020（17.0）以降で実行してください。");
      return;
    }
    var project = app.newProject();
    if (!project) return; // 保存の確認でキャンセルされた

    var canWrite = true;
    try {
      canWrite = app.preferences.getPrefAsLong("Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY") === 1;
    } catch (e) {}

    app.beginUndoGroup("説テロップを作る");
    var folder = app.project.items.addFolder("説テロップ");
    var built = [];
    for (var i = 0; i < PRESETS.length; i++) {
      try {
        built.push(buildComp(PRESETS[i], folder));
      } catch (e) {
        pending = [];
        warnings.push(PRESETS[i].name + " を作れませんでした：" + e.toString() + "（" + (e.line || "?") + " 行目）");
      }
    }
    app.endUndoGroup();

    var report = [];
    if (!canWrite) {
      report.push("テンプレートのコンポジションはできました。.mogrt に書き出すには、");
      report.push("「設定 → スクリプトとエクスプレッション」で「スクリプトによるファイルへの書き込みとネットワークへのアクセスを許可」をオンにして、もう一度実行してください。");
    } else {
      var outFolder = new Folder(CONFIG.outputFolder);
      if (!outFolder.exists) outFolder.create();
      app.project.save(new File(outFolder.fsName + "/説テロップ.aep"));
      var ok = 0;
      for (var j = 0; j < built.length; j++) {
        try {
          // デスクトップのフォルダと、Premiere が読むテンプレートフォルダの両方に書き出す
          var a = built[j].comp.exportAsMotionGraphicsTemplate(true, outFolder.fsName);
          var b = built[j].comp.exportAsMotionGraphicsTemplate(true);
          if (a || b) ok++;
          else warnings.push(built[j].comp.name + " を書き出せませんでした");
        } catch (e) {
          warnings.push(built[j].comp.name + " を書き出せませんでした：" + e.toString());
        }
      }
      report.push(ok + " 個のテンプレート（.mogrt）を書き出しました。");
      report.push("場所：" + outFolder.fsName);
      report.push("Premiere の「エッセンシャルグラフィックス → 参照」にも入っています。");
    }
    report.push("書体：" + (fontsUsed.mincho || "-") + "（なぞり：" + (fontsUsed.nazori || "-") + "）");
    if (warnings.length) report.push("\n気になった点：\n- " + warnings.join("\n- "));
    alert(report.join("\n"), "説テロップ工房");
  }

  main();
})();
