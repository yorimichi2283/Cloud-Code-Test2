/*
 * telop.js — バラエティ番組風テロップ
 *
 *   Telop.show(stage, { text, preset, anim, dir, font, drift, flicker }) → テロップ要素
 *   Telop.hide(telopEl)                                         → Promise（消え終わり）
 *
 *   dir はスライド系（slide / slide-chars）の向き。どこから入ってくるか
 *   flicker を true にすると、出ている間ずっとストロボでちらつく
 *
 * text の書き方:
 *   改行 … 行を分ける
 *   *文字* … 強調色にする（プリセットごとの --t-accent）
 *   preset が "setsu" のとき、行末の「説」は自動で大きくなる
 */
(function (global) {
  "use strict";

  var PRESETS = ["setsu", "result", "nazori", "band", "tsukkomi"];
  var ANIMS = ["strobe", "slam", "pop", "type", "slide", "slide-chars", "cut"];
  var DIRS = ["right", "left", "bottom", "top"];
  var FONTS = ["mincho-black", "mincho", "gothic"];

  // タイトルセーフ（画面の 90%）に収める
  var SAFE = 0.9;

  var segmenter =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter("ja", { granularity: "grapheme" })
      : null;

  function graphemes(str) {
    if (segmenter) {
      return Array.from(segmenter.segment(str), function (s) {
        return s.segment;
      });
    }
    return Array.from(str);
  }

  // "*強調*" を解釈して、1 行ぶんの文字リストにする
  function parseLine(line, preset) {
    var chars = [];
    var accent = false;
    graphemes(line).forEach(function (c) {
      if (c === "*") {
        accent = !accent;
        return;
      }
      chars.push({ c: c, accent: accent, big: false });
    });
    if (preset === "setsu") {
      for (var i = chars.length - 1; i >= 0; i--) {
        if (chars[i].c.trim() === "") continue;
        if (chars[i].c === "説") chars[i].big = true;
        break;
      }
    }
    return chars;
  }

  function parse(text, preset) {
    return String(text)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(function (line) {
        return parseLine(line, preset);
      });
  }

  function buildLayer(kind, lines) {
    var layer = document.createElement("div");
    layer.className = "telop__layer telop__layer--" + kind;
    if (kind !== "fill") layer.setAttribute("aria-hidden", "true");
    var index = 0;
    lines.forEach(function (chars) {
      var lineEl = document.createElement("span");
      lineEl.className = "telop__line";
      if (chars.length === 0) lineEl.textContent = " ";
      chars.forEach(function (ch) {
        var span = document.createElement("span");
        span.className = "telop__ch" + (ch.accent ? " is-accent" : "") + (ch.big ? " is-big" : "");
        span.style.setProperty("--i", String(index++));
        span.textContent = ch.c;
        lineEl.appendChild(span);
      });
      layer.appendChild(lineEl);
    });
    return layer;
  }

  // ちらつき用のフィルター（元の色 90%＋白 10%）を一度だけページに足す
  function ensureFlickerFilter() {
    if (document.getElementById("telop-flicker")) return;
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    var f = '<feFunc{c} type="linear" slope="0.9" intercept="0.1"/>';
    svg.innerHTML =
      '<filter id="telop-flicker" color-interpolation-filters="sRGB"><feComponentTransfer>' +
      f.replace("{c}", "R") + f.replace("{c}", "G") + f.replace("{c}", "B") +
      "</feComponentTransfer></filter>";
    document.body.appendChild(svg);
  }

  // 文字が多いときは、画面からはみ出さないよう縮める
  function fit(el) {
    var stage = el.parentElement;
    if (!stage || !el.isConnected) return;
    el.style.setProperty("--t-fit", "1");
    var w = el.offsetWidth;
    var h = el.offsetHeight;
    var maxW = stage.clientWidth * SAFE;
    var maxH = stage.clientHeight * SAFE;
    if (!w || !h || !maxW || !maxH) return;
    var scale = Math.min(1, maxW / w, maxH / h);
    el.style.setProperty("--t-fit", scale.toFixed(4));
  }

  function show(stage, opts) {
    opts = opts || {};
    var preset = PRESETS.indexOf(opts.preset) >= 0 ? opts.preset : "setsu";
    var anim = ANIMS.indexOf(opts.anim) >= 0 ? opts.anim : "strobe";
    var font = FONTS.indexOf(opts.font) >= 0 ? opts.font : "mincho-black";
    var dir = DIRS.indexOf(opts.dir) >= 0 ? opts.dir : "right";

    if (opts.replace !== false) {
      Array.prototype.forEach.call(stage.querySelectorAll(":scope > .telop"), function (old) {
        old.remove();
      });
    }

    var lines = parse(opts.text == null ? "" : opts.text, preset);
    var el = document.createElement("div");
    el.className = "telop telop--" + preset + " anim-" + anim + " dir-" + dir;
    if (font !== "mincho-black") el.classList.add("font-" + font);
    if (opts.drift) el.classList.add("is-drift");
    if (opts.flicker) {
      ensureFlickerFilter();
      el.classList.add("is-flicker");
    }
    el.setAttribute("role", "img");
    el.setAttribute(
      "aria-label",
      lines
        .map(function (chars) {
          return chars.map(function (ch) {
            return ch.c;
          }).join("");
        })
        .join(" ")
    );

    var body = document.createElement("div");
    body.className = "telop__body";
    body.appendChild(buildLayer("edge2", lines));
    body.appendChild(buildLayer("edge1", lines));
    body.appendChild(buildLayer("fill", lines));
    el.appendChild(body);
    stage.appendChild(el);

    fit(el);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        fit(el);
      });
    }
    return el;
  }

  function hide(el) {
    return new Promise(function (resolve) {
      if (!el || !el.isConnected) return resolve();
      var reduce =
        global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var finished = false;
      var done = function () {
        if (finished) return;
        finished = true;
        el.remove();
        resolve();
      };
      if (el.classList.contains("anim-cut") && !reduce) return done();
      el.classList.add("is-out");
      var body = el.querySelector(".telop__body");
      // animationend が来ない環境でも必ず消す
      setTimeout(done, 600);
      body.addEventListener("animationend", function (e) {
        if (e.target === body) done();
      });
    });
  }

  global.Telop = {
    show: show,
    hide: hide,
    fit: fit,
    parse: parse,
    PRESETS: PRESETS.slice(),
    ANIMS: ANIMS.slice(),
    DIRS: DIRS.slice(),
    FONTS: FONTS.slice(),
  };
})(window);
