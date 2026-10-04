/*
 * 書き出したテロップを Premiere Pro に読み込める XML（Final Cut Pro XML / xmeml）にまとめる
 *
 * render.js が書き出すたびに out/manifest.json へ記録し、out/telop.xml を作り直す。
 * Premiere で「ファイル → 読み込み」からこの XML を選ぶと、
 * 「テロップ」シーケンス（V2 にテロップを順番に並べたもの）と素材がプロジェクトに入る。
 *
 * 単体で実行すると manifest.json から XML だけ作り直す:
 *   node render/premiere-xml.js [out フォルダ]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

// ファイル名に日本語を使うと読み込めない環境があるので英数字にする
const XML_NAME = "telop.xml";
const SEQUENCE_NAME = "テロップ";
const MANIFEST_NAME = "manifest.json";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 29.97 は timebase 30 + ntsc TRUE と書く決まり
function rate(fps) {
  const ntsc = fps.den === 1001;
  const timebase = ntsc ? Math.round(fps.num / 1000) : fps.num;
  return `<rate><timebase>${timebase}</timebase><ntsc>${ntsc ? "TRUE" : "FALSE"}</ntsc></rate>`;
}

function timecode(fps) {
  const df = fps.den === 1001 && fps.num !== 24000;
  return (
    `<timecode>${rate(fps)}<string>00:00:00${df ? ";" : ":"}00</string>` +
    `<frame>0</frame><displayformat>${df ? "DF" : "NDF"}</displayformat></timecode>`
  );
}

function sampleCharacteristics(fps, width, height, depth) {
  return (
    `<samplecharacteristics>${rate(fps)}<width>${width}</width><height>${height}</height>` +
    `<anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio>` +
    `<fielddominance>none</fielddominance><colordepth>${depth}</colordepth></samplecharacteristics>`
  );
}

// Premiere 自身が書き出す XML に入っている時間（1 秒 = 254016000000 ticks）
const TICKS_PER_SECOND = 254016000000;
function ticks(frames, fps) {
  return Math.round((frames * TICKS_PER_SECOND * fps.den) / fps.num);
}

// 決まった入力からは毎回同じ ID になるようにする（書き出し直しても差分が出ない）
function uuid(seed) {
  const h = require("crypto").createHash("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Premiere が書き出す XML と同じ file://localhost/ 形式（日本語はパーセントエンコード）
function pathUrl(file) {
  return pathToFileURL(path.resolve(file)).href.replace(/^file:\/\/\//, "file://localhost/");
}

/*
 * entries: [{ name, file, frames, fps: { num, den }, width, height }]
 * fps / width / height はシーケンスの設定
 */
function buildXmeml(entries, seq) {
  const gap = Math.round((seq.fps.num / seq.fps.den) * 0.5); // テロップの間を 0.5 秒あける
  let cursor = 0;
  const clips = entries.map((e, i) => {
    const start = cursor;
    const end = start + e.frames;
    cursor = end + gap;
    const n = i + 1;
    return [
      `          <clipitem id="clipitem-${n}">`,
      `            <masterclipid>masterclip-${n}</masterclipid>`,
      `            <name>${esc(e.name)}</name>`,
      `            <enabled>TRUE</enabled>`,
      `            <duration>${e.frames}</duration>`,
      `            ${rate(e.fps)}`,
      `            <start>${start}</start>`,
      `            <end>${end}</end>`,
      `            <in>0</in>`,
      `            <out>${e.frames}</out>`,
      `            <pproTicksIn>0</pproTicksIn>`,
      `            <pproTicksOut>${ticks(e.frames, e.fps)}</pproTicksOut>`,
      `            <alphatype>straight</alphatype>`,
      `            <pixelaspectratio>square</pixelaspectratio>`,
      `            <anamorphic>FALSE</anamorphic>`,
      `            <file id="file-${n}">`,
      `              <name>${esc(path.basename(e.file))}</name>`,
      `              <pathurl>${esc(e.pathurl || pathUrl(e.file))}</pathurl>`,
      `              ${rate(e.fps)}`,
      `              <duration>${e.frames}</duration>`,
      `              ${timecode(e.fps)}`,
      `              <media><video>${sampleCharacteristics(e.fps, e.width, e.height, 32)}</video></media>`,
      `            </file>`,
      `          </clipitem>`,
    ].join("\n");
  });
  const duration = Math.max(0, cursor - gap);
  const name = seq.name || SEQUENCE_NAME;

  // 要素の並びは Premiere が書き出す XML に合わせている
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="4">`,
    `  <sequence id="sequence-1">`,
    `    <uuid>${uuid(name + entries.map((e) => e.name + ":" + e.frames).join("|"))}</uuid>`,
    `    <duration>${duration}</duration>`,
    `    ${rate(seq.fps)}`,
    `    <name>${esc(name)}</name>`,
    `    <media>`,
    `      <video>`,
    `        <format>${sampleCharacteristics(seq.fps, seq.width, seq.height, 24)}</format>`,
    `        <track>`,
    `          <enabled>TRUE</enabled>`,
    `          <locked>FALSE</locked>`,
    `        </track>`,
    `        <track>`,
    ...clips,
    `          <enabled>TRUE</enabled>`,
    `          <locked>FALSE</locked>`,
    `        </track>`,
    `      </video>`,
    `      <audio>`,
    `        <numOutputChannels>2</numOutputChannels>`,
    `        <format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>`,
    `        <outputs>`,
    `          <group><index>1</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>1</index></channel></group>`,
    `          <group><index>2</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>2</index></channel></group>`,
    `        </outputs>`,
    `        <track>`,
    `          <enabled>TRUE</enabled>`,
    `          <locked>FALSE</locked>`,
    `          <outputchannelindex>1</outputchannelindex>`,
    `        </track>`,
    `      </audio>`,
    `    </media>`,
    `    ${timecode(seq.fps)}`,
    `  </sequence>`,
    `</xmeml>`,
    ``,
  ].join("\n");
}

function readManifest(outDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(outDir, MANIFEST_NAME), "utf8"));
    return Array.isArray(m.telops) ? m.telops : [];
  } catch (e) {
    return [];
  }
}

// 今回書き出した分を記録に足し（同じ名前は上書き）、消えたファイルは外して XML を作り直す
function updateProject(outDir, added, seq) {
  const byName = new Map(readManifest(outDir).map((e) => [e.name, e]));
  added.forEach((e) => byName.set(e.name, { ...e, file: path.basename(e.file) }));
  const telops = [...byName.values()].filter((e) => fs.existsSync(path.join(outDir, e.file)));
  fs.writeFileSync(path.join(outDir, MANIFEST_NAME), JSON.stringify({ telops }, null, 2) + "\n");

  const entries = telops.map((e) => ({ ...e, file: path.join(outDir, e.file) }));
  const xmlPath = path.join(outDir, XML_NAME);
  fs.writeFileSync(xmlPath, buildXmeml(entries, seq));
  return { xmlPath, count: entries.length };
}

module.exports = { buildXmeml, updateProject, readManifest, XML_NAME };

if (require.main === module) {
  const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "out"));
  const telops = readManifest(outDir);
  if (!telops.length) {
    console.error(`${path.join(outDir, MANIFEST_NAME)} に記録がありません。先に render.js で書き出してください。`);
    process.exit(1);
  }
  const last = telops[telops.length - 1];
  const { xmlPath, count } = updateProject(outDir, [], { fps: last.fps, width: last.width, height: last.height });
  console.log(`${count} 本のテロップを ${xmlPath} にまとめました`);
}
