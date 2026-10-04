#!/usr/bin/env node
/*
 * テロップを背景透過の動画に書き出す（Premiere Pro などで重ねて使う用）
 *
 *   一つだけ:
 *     node render/render.js --text "大人になってから\n食べる駄菓子\nだいたい美味しい説" --preset setsu --anim strobe --drift
 *
 *   まとめて（JSON に並べたものを全部）:
 *     node render/render.js render/telops.example.json
 *
 *   .mov を書き出すと、out/telop.xml も作り直す。Premiere で「ファイル → 読み込み」から
 *   これを選ぶと、out/ のテロップを並べたシーケンスがプロジェクトに入る。
 *
 * 共通オプション:
 *   --fps 29.97         フレームレート（23.976 / 24 / 25 / 29.97 / 30 / 59.94 / 60）
 *   --width 1920        横幅（高さは 16:9 で決まる。4K なら 3840）
 *   --format prores     prores … ProRes 4444（透過付き .mov）
 *                       qtrle  … QuickTime アニメーション（透過付き .mov、容量大）
 *                       png    … 連番 PNG（透過付き）
 *   --outdir out        書き出し先フォルダ
 *
 * テロップごとのオプション（JSON の項目名も同じ）:
 *   --text --preset --anim --dir --font --drift
 *   --duration 4        長さ（秒）。消える動きを含む
 *   --no-out            消える動きを付けない（最後まで出しっぱなし。JSON では "out": false）
 *   --name              ファイル名（省略時はテキストから作る）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { updateProject } = require("./premiere-xml");

const ROOT = path.resolve(__dirname, "..");
const FRAME_HTML = pathToFileURL(path.join(__dirname, "frame.html")).href;

// 消える動きにかける時間（telop.css の is-out 系アニメーションより少し長め）
const OUT_SECONDS = 0.4;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      opts._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === "drift") opts.drift = true;
    else if (key === "no-drift") opts.drift = false;
    else if (key === "no-out") opts.out = false;
    else if (key === "help" || key === "h") opts.help = true;
    else opts[key] = argv[++i];
  }
  return opts;
}

// "29.97" → { num: 30000, den: 1001 }
function parseFps(value) {
  const ntsc = { "23.976": 24000, "23.98": 24000, "29.97": 30000, "59.94": 60000 };
  const v = String(value || "29.97");
  if (ntsc[v]) return { num: ntsc[v], den: 1001, label: v };
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`フレームレートが読めません: ${v}`);
  return { num: Math.round(n), den: 1, label: v };
}

function safeName(s) {
  return (
    String(s)
      .replace(/\*/g, "")
      .replace(/\s+/g, "_")
      .replace(/[\\/:*?"<>|]+/g, "")
      .slice(0, 40) || "telop"
  );
}

function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) return p;
  } catch (e) {
    // ffmpeg-static が無ければ PATH 上の ffmpeg を使う
  }
  return "ffmpeg";
}

function ffmpegArgs(format, fps, file) {
  const input = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", `${fps.num}/${fps.den}`, "-c:v", "png", "-i", "-"];
  if (format === "qtrle") return [...input, "-c:v", "qtrle", "-pix_fmt", "argb", file];
  return [
    ...input,
    "-c:v", "prores_ks",
    "-profile:v", "4444",
    "-pix_fmt", "yuva444p10le",
    "-alpha_bits", "8", // 元の PNG のアルファが 8bit なので 16bit にしても増えるのは容量だけ
    "-vendor", "apl0",
    file,
  ];
}

function startEncoder(format, fps, file) {
  const bin = findFfmpeg();
  const proc = spawn(bin, ffmpegArgs(format, fps, file), { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) => {
    proc.on("error", (e) =>
      reject(new Error(`ffmpeg を起動できません（${bin}）。npm install するか、ffmpeg をインストールしてください。\n${e.message}`))
    );
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg が失敗しました（終了コード ${code}）`))));
  });
  return {
    write: (buf) =>
      new Promise((resolve, reject) => {
        proc.stdin.write(buf, (err) => (err ? reject(err) : resolve()));
      }),
    end: () => {
      proc.stdin.end();
      return done;
    },
  };
}

async function renderOne(page, item, common) {
  const fps = common.fps;
  const duration = Number(item.duration || 4);
  const withOut = item.out !== false;
  const total = Math.max(1, Math.round((duration * fps.num) / fps.den));
  const outFrame = withOut ? Math.max(0, total - Math.round((OUT_SECONDS * fps.num) / fps.den)) : Infinity;
  const name = safeName(item.name || item.text);

  const show = {
    text: String(item.text || "").replace(/\\n/g, "\n"),
    preset: item.preset,
    anim: item.anim,
    dir: item.dir,
    font: item.font,
    drift: !!item.drift,
  };

  let encoder = null;
  let target;
  if (common.format === "png") {
    target = path.join(common.outDir, name);
    fs.mkdirSync(target, { recursive: true });
  } else {
    target = path.join(common.outDir, `${name}.mov`);
    encoder = startEncoder(common.format, fps, target);
  }

  process.stdout.write(`書き出し中: ${name}（${total} フレーム / ${fps.label}fps）… `);
  await page.evaluate((o) => window.__render.start(o), show);

  for (let i = 0; i < total; i++) {
    const t = (i * fps.den) / fps.num;
    await page.evaluate(
      ([t, out]) => {
        if (out) window.__render.out();
        window.__render.seek(t);
      },
      [t, i === outFrame]
    );
    const png = await page.screenshot({ type: "png", omitBackground: true });
    if (encoder) await encoder.write(png);
    else fs.writeFileSync(path.join(target, `${name}_${String(i).padStart(5, "0")}.png`), png);
  }
  if (encoder) await encoder.end();
  console.log(`完了 → ${path.relative(process.cwd(), target)}`);
  return { name, file: target, frames: total, fps: { num: fps.num, den: fps.den }, width: common.width, height: common.height };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args._.length && !args.text)) {
    const head = fs.readFileSync(__filename, "utf8").split("*/")[0];
    console.log(head.replace(/^#!.*\n\/\*\n?/, "").replace(/^ \* ?/gm, ""));
    process.exit(args.help ? 0 : 1);
  }

  let items;
  if (args._.length) {
    const json = JSON.parse(fs.readFileSync(path.resolve(args._[0]), "utf8"));
    items = Array.isArray(json) ? json : json.telops;
  } else {
    items = [args];
  }

  const format = args.format || "prores";
  if (!["prores", "qtrle", "png"].includes(format)) throw new Error(`--format は prores / qtrle / png のどれかです: ${format}`);
  const width = Math.round(Number(args.width || 1920));
  const height = Math.round((width * 9) / 16);
  const common = {
    fps: parseFps(args.fps),
    width,
    height,
    format,
    outDir: path.resolve(args.outdir || path.join(ROOT, "out")),
  };
  fs.mkdirSync(common.outDir, { recursive: true });

  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (e) {
    throw new Error("playwright が見つかりません。先に npm install と npx playwright install chromium を実行してください。");
  }

  const launch = {};
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  if (process.env.HTTPS_PROXY) launch.proxy = { server: process.env.HTTPS_PROXY };
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    if (process.env.HTTPS_PROXY) {
      // プロキシ環境ではブラウザの証明書設定が効かないことがあるので、フォントは Node 側で取ってくる
      await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
        try {
          await route.fulfill({ response: await route.fetch() });
        } catch (e) {
          await route.abort();
        }
      });
    }
    await page.goto(FRAME_HTML);
    const rendered = [];
    for (const item of items) {
      rendered.push(await renderOne(page, item, common));
    }
    if (format !== "png") {
      const { xmlPath, count } = updateProject(common.outDir, rendered, common);
      console.log(`Premiere 用 → ${path.relative(process.cwd(), xmlPath)}（${count} 本を並べたシーケンス）`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
