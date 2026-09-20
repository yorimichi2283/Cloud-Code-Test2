const ppro = require("premierepro");

const POSITION_NAME_RE = /position|位置/i;
const SCALE_NAME_RE = /scale|スケール/i;
// "Anchor Point" / "アンカーポイント" — never written to, only read, because
// Position places the anchor: Position == AnchorPoint means "no shift", so
// the anchor is what tells us where the frame's centre actually is for this
// clip. (Neither name matches the two regexes above.)
const ANCHOR_NAME_RE = /anchor|アンカー/i;

const els = {
  trackSelect: document.getElementById("trackSelect"),
  telopOnly: document.getElementById("telopOnly"),
  loadSelectionBtn: document.getElementById("loadSelectionBtn"),
  centerHBtn: document.getElementById("centerHBtn"),
  resetBtn: document.getElementById("resetBtn"),
  inspectBtn: document.getElementById("inspectBtn"),
  statusLine: document.getElementById("statusLine"),
  clipCount: document.getElementById("clipCount"),
  clipList: document.getElementById("clipList"),
  xMinus: document.getElementById("xMinus"),
  xPlus: document.getElementById("xPlus"),
  yMinus: document.getElementById("yMinus"),
  yPlus: document.getElementById("yPlus"),
  scaleMinus: document.getElementById("scaleMinus"),
  scalePlus: document.getElementById("scalePlus"),
  xInput: document.getElementById("xInput"),
  yInput: document.getElementById("yInput"),
  scaleInput: document.getElementById("scaleInput"),
  logBox: document.getElementById("logBox"),
};

const DEFAULT_FRAME_WIDTH = 1920;
const DEFAULT_FRAME_HEIGHT = 1080;
const SCALE_MIN = -95;
const SCALE_MAX = 300;

// One entry per loaded clip: { name, editableParams: [{ param, kind, baseline }] }
let loadedClips = [];
let currentProject = null;

// Current offset from each param's baseline, applied to every loaded clip.
const state = {
  x: 0,
  y: 0,
  scale: 0,
  frameWidth: DEFAULT_FRAME_WIDTH,
  frameHeight: DEFAULT_FRAME_HEIGHT,
};

// Keeps a value within a sane range for its axis, so a stray drag, a held
// button, or a typo in the number field can't send the offset to an
// unrecoverable-looking extreme (e.g. thousands of pixels on a 1080px frame).
function clampAxisValue(axis, value) {
  if (axis === "x") {
    return Math.max(-state.frameWidth, Math.min(state.frameWidth, value));
  }
  if (axis === "y") {
    return Math.max(-state.frameHeight, Math.min(state.frameHeight, value));
  }
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, value));
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  els.logBox.textContent = `[${time}] ${message}\n${els.logBox.textContent}`.slice(0, 4000);
}

function isVideoClipTrackItem(trackItem) {
  return trackItem instanceof ppro.VideoClipTrackItem;
}

async function getActiveProjectAndSequence() {
  const project = await ppro.Project.getActiveProject();
  if (!project) {
    throw new Error("開いているプロジェクトがありません。");
  }
  const sequence = await project.getActiveSequence();
  if (!sequence) {
    throw new Error("アクティブなシーケンスがありません。");
  }
  return { project, sequence };
}

// Builds the track dropdown from each track's OWN name — the same "V1",
// "V2", ... labels Premiere shows in the timeline — and stores the API index
// as the option value. Earlier versions guessed at how getVideoTrack()'s
// index maps onto those labels and got it wrong in both directions; reading
// the real name removes the guesswork entirely.
async function populateTrackOptions(sequence) {
  const trackCount = await sequence.getVideoTrackCount();
  const previous = els.trackSelect.value;

  const tracks = [];
  for (let apiIndex = 0; apiIndex < trackCount; apiIndex += 1) {
    const track = await sequence.getVideoTrack(apiIndex);
    const clipCount = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false).length;
    tracks.push({ apiIndex, name: track.name || `(index ${apiIndex})`, clipCount });
  }
  // Show them in timeline order (V1 first) regardless of the API's ordering.
  tracks.sort((a, b) => {
    const an = Number((a.name.match(/\d+/) || [Number.MAX_SAFE_INTEGER])[0]);
    const bn = Number((b.name.match(/\d+/) || [Number.MAX_SAFE_INTEGER])[0]);
    return an - bn;
  });

  els.trackSelect.innerHTML = "";
  const selectionOption = document.createElement("option");
  selectionOption.value = "selection";
  selectionOption.textContent = "タイムラインで選択中のクリップ";
  els.trackSelect.appendChild(selectionOption);

  // The clip count makes it obvious which track actually holds the telops,
  // so an empty or wrong track is visible before loading.
  for (const { apiIndex, name, clipCount } of tracks) {
    const option = document.createElement("option");
    option.value = String(apiIndex);
    option.textContent = `${name}（${clipCount}件）`;
    els.trackSelect.appendChild(option);
  }

  const stillValid = Array.from(els.trackSelect.options).some((o) => o.value === previous);
  els.trackSelect.value = stillValid ? previous : "selection";
}

async function resolveVideoClips(sequence) {
  const chosen = els.trackSelect.value;
  if (chosen === "selection") {
    const selection = await sequence.getSelection();
    const items = await selection.getTrackItems();
    return items.filter(isVideoClipTrackItem);
  }
  const track = await sequence.getVideoTrack(Number(chosen));
  const items = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  log(`対象トラック: 「${track.name}」(index ${chosen}) / クリップ${items.length}件`);
  return items;
}

async function fetchFrameSize(sequence) {
  try {
    const settings = await sequence.getSettings();
    const rect = await settings.getVideoFrameRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
  } catch (err) {
    log(`フレームサイズの取得に失敗しました（既定値を使用）: ${err.message || err}`);
  }
  return { width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT };
}

const BASE_MOTION_MATCH_NAME = "AE.ADBE Motion";
const VECTOR_MOTION_NAME_RE = /vector\s*motion|ベクトルモーション/i;

// IMPORTANT: Premiere's Position params are stored as a FRACTION OF THE
// FRAME, not in pixels. A clip sitting dead centre of a 1080x1920 sequence
// reads back as {x: 0.5, y: 0.5} even though Effect Controls displays it as
// "540.0, 960.0". Adding a pixel offset straight onto that fraction moved
// clips by hundreds of frame-widths at a time — which is what produced every
// flavour of "it vanishes", "it jumps somewhere random", and the 32767 /
// -32768 values (Premiere's own 16-bit clamp on an absurd result).
// So: offsets entered in this panel are pixels, and get divided by the frame
// size before being added to the stored fraction.
function pixelsToFraction(pixels, frameSize) {
  return frameSize > 0 ? pixels / frameSize : 0;
}

// Converts a value in frame-fraction units back to pixels, for display.
function fractionToPixels(fraction, frameSize) {
  return Math.round(fraction * frameSize);
}

// Normalizes a Position-like value to a plain {x, y}, regardless of whether
// the underlying param returned a PointF-shaped object or a plain [x, y]
// array (this varies by effect implementation — Vector Motion's own
// Position didn't behave like the base Motion effect's).
function toXY(value) {
  if (value && typeof value.x === "number" && typeof value.y === "number") {
    return { x: value.x, y: value.y };
  }
  if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") {
    return { x: value[0], y: value[1] };
  }
  return null;
}

// Scans one clip's effect stack and returns the Position/Scale params
// that are safe to overwrite directly (i.e. not keyframed).
async function collectEditableParams(project, trackItem) {
  const componentChain = await trackItem.getComponentChain();

  // Group candidate Position/Scale params by which component (effect) they
  // belong to, rather than flattening everything into one list.
  const rawGroups = [];
  project.lockedAccess(() => {
    const componentCount = componentChain.getComponentCount();
    for (let c = 0; c < componentCount; c += 1) {
      const component = componentChain.getComponentAtIndex(c);
      const paramCount = component.getParamCount();
      const params = [];
      let anchorParam = null;
      for (let p = 0; p < paramCount; p += 1) {
        const param = component.getParam(p);
        const name = param.displayName || "";
        if (POSITION_NAME_RE.test(name)) {
          params.push({ param, kind: "position" });
        } else if (SCALE_NAME_RE.test(name)) {
          params.push({ param, kind: "scale" });
        } else if (ANCHOR_NAME_RE.test(name)) {
          anchorParam = param;
        }
      }
      if (params.length > 0) {
        rawGroups.push({ component, params, anchorParam });
      }
    }
  });

  if (rawGroups.length === 0) {
    return { editableParams: [], skippedKeyframed: 0, chosenEffectName: null, isBaseMotion: true };
  }

  // A Graphic/Text clip has its own content transform ("Vector Motion") in
  // ADDITION to the generic per-clip "Motion" fixed effect every track item
  // has. Adjusting both at once compounds the movement (shifting the clip
  // AND its content inside the clip by the same amount), which is what sent
  // things flying off to unexpected places. So only ONE component's
  // Position/Scale is touched per clip, in priority order:
  //   1. A component explicitly named "Vector Motion" — the one that
  //      actually moves a Graphic clip's visible content.
  //   2. Otherwise, any component that isn't the generic base "Motion"
  //      effect (e.g. a real MOGRT's own per-layer parameters).
  //   3. Otherwise, the base "Motion" effect itself (plain video/image clips
  //      only ever have this one).
  let chosen = null;
  for (const group of rawGroups) {
    const displayName = await group.component.getDisplayName();
    if (VECTOR_MOTION_NAME_RE.test(displayName)) {
      chosen = group;
      break;
    }
  }
  if (!chosen) {
    for (const group of rawGroups) {
      const matchName = await group.component.getMatchName();
      if (matchName !== BASE_MOTION_MATCH_NAME) {
        chosen = group;
        break;
      }
    }
  }
  if (!chosen) {
    chosen = rawGroups[0];
  }

  const chosenEffectName = await chosen.component.getDisplayName();
  const isBaseMotion = (await chosen.component.getMatchName()) === BASE_MOTION_MATCH_NAME;

  // Position places the anchor point, so Position == AnchorPoint is the
  // "sitting where it was designed" value, and the anchor of a graphic sits
  // at the frame centre. That makes the anchor the correct target for
  // horizontal centring — and it is expressed in the same frame-fraction
  // units, so it works for vertical and horizontal sequences alike.
  // The base Motion effect is skipped here because its anchor is in the
  // source media's own pixel space (e.g. 1920x1080 for 4K footage in a
  // 1080x1920 sequence), not the frame's — for that, frame centre is 0.5.
  let centerXY = { x: 0.5, y: 0.5 };
  if (!isBaseMotion && chosen.anchorParam) {
    try {
      const anchorKeyframe = await chosen.anchorParam.getStartValue();
      const anchor = toXY(anchorKeyframe.value.value);
      if (anchor && Math.abs(anchor.x) <= 2 && Math.abs(anchor.y) <= 2) {
        centerXY = anchor;
      }
    } catch (err) {
      log(`アンカーポイントの取得に失敗しました（中央=0.5として扱います）: ${err.message || err}`);
    }
  }

  const editableParams = [];
  let skippedKeyframed = 0;
  for (const candidate of chosen.params) {
    const timeVarying = candidate.param.isTimeVarying();
    if (timeVarying) {
      // Already keyframed: overwriting the static value would be unsafe/ambiguous,
      // so this tool intentionally leaves keyframed params untouched.
      skippedKeyframed += 1;
      continue;
    }
    const startKeyframe = await candidate.param.getStartValue();
    const rawValue = startKeyframe.value.value;
    let baseline = candidate.kind === "position" ? toXY(rawValue) : rawValue;
    if (candidate.kind === "position" && !baseline) {
      log(`警告: 位置の値の形式を認識できません（スキップします）: ${JSON.stringify(rawValue)}`);
      continue;
    }
    // Where this clip sits when nothing is shifting it (the anchor point,
    // i.e. frame centre for a graphic). Doubles as the recovery value for a
    // clip left with an absurd Position by an earlier, buggier version of
    // this tool — e.g. exactly 32767/-32768, Premiere's own 16-bit clamp on
    // a runaway write. Position is in frame fractions, so anything more than
    // a few frames out is nonsense rather than a real placement.
    const neutral = centerXY;
    if (candidate.kind === "position") {
      if (Math.abs(baseline.x) > 5 || Math.abs(baseline.y) > 5) {
        log(
          `警告: 位置の元の値が異常でした (${baseline.x}, ${baseline.y})。` +
            `${neutral.x}, ${neutral.y} として扱います。`
        );
        baseline = { x: neutral.x, y: neutral.y };
      }
    } else if (baseline <= 0 || baseline > 2000) {
      log(`警告: スケールの元の値が異常でした (${baseline})。100として扱います。`);
      baseline = 100;
    }
    editableParams.push({
      param: candidate.param,
      kind: candidate.kind,
      baseline,
      // Kept separately so "リセット" can still return to the value this clip
      // had at load time even after centring rebased the baseline.
      original: candidate.kind === "position" ? { x: baseline.x, y: baseline.y } : baseline,
      neutral: candidate.kind === "position" ? neutral : null,
    });
  }

  return { editableParams, skippedKeyframed, chosenEffectName, isBaseMotion };
}

function renderClipList() {
  els.clipList.innerHTML = "";
  els.clipCount.textContent = String(loadedClips.length);
  for (const clip of loadedClips) {
    const li = document.createElement("li");
    const posCount = clip.editableParams.filter((p) => p.kind === "position").length;
    const scaleCount = clip.editableParams.filter((p) => p.kind === "scale").length;
    if (posCount === 0 && scaleCount === 0) {
      li.className = "warn";
      li.textContent = `${clip.name} — 位置/スケールの調整対象パラメータが見つかりません`;
    } else {
      let note = `[${clip.chosenEffectName}] 位置x${posCount} / スケールx${scaleCount}`;
      if (clip.skippedKeyframed > 0) {
        li.className = "warn";
        note += `（キーフレーム済みのため対象外: ${clip.skippedKeyframed}件）`;
      }
      li.textContent = `${clip.name} — ${note}`;
    }
    els.clipList.appendChild(li);
  }
}

function setControlsEnabled(enabled) {
  for (const el of [
    els.xInput,
    els.yInput,
    els.scaleInput,
    els.xMinus,
    els.xPlus,
    els.yMinus,
    els.yPlus,
    els.scaleMinus,
    els.scalePlus,
    els.centerHBtn,
    els.resetBtn,
    els.inspectBtn,
  ]) {
    el.disabled = !enabled;
  }
}

function syncControls() {
  els.xInput.value = String(state.x);
  els.yInput.value = String(state.y);
  els.scaleInput.value = String(state.scale);
}

function resetOffsets() {
  state.x = 0;
  state.y = 0;
  state.scale = 0;
  syncControls();
}

async function handleLoadSelection() {
  els.loadSelectionBtn.disabled = true;
  try {
    const { project, sequence } = await getActiveProjectAndSequence();
    await populateTrackOptions(sequence);

    const videoClips = await resolveVideoClips(sequence);
    if (videoClips.length === 0) {
      els.statusLine.textContent =
        els.trackSelect.value === "selection"
          ? "タイムライン上でテロップのクリップを選択してから、もう一度ボタンを押してください。"
          : "このトラックにはクリップがありません。";
      loadedClips = [];
      renderClipList();
      setControlsEnabled(false);
      return;
    }

    currentProject = project;
    const frameSize = await fetchFrameSize(sequence);
    state.frameWidth = frameSize.width;
    state.frameHeight = frameSize.height;
    log(`シーケンスのフレームサイズ: ${state.frameWidth} x ${state.frameHeight}`);

    const telopOnly = els.telopOnly.checked;
    loadedClips = [];
    let skippedPlainClips = 0;
    for (const trackItem of videoClips) {
      const name = await trackItem.getName();
      const { editableParams, skippedKeyframed, chosenEffectName, isBaseMotion } =
        await collectEditableParams(project, trackItem);

      // A plain video/image clip only ever carries the generic "Motion"
      // effect; a telop (Graphic/Text or MOGRT) has its own content
      // transform on top. So "base Motion only" is the signal for "this is
      // footage, not a telop" — skip it rather than dragging the footage
      // around by mistake.
      if (telopOnly && isBaseMotion) {
        skippedPlainClips += 1;
        continue;
      }

      loadedClips.push({ trackItem, name, editableParams, skippedKeyframed, chosenEffectName });
      if (chosenEffectName) {
        log(`${name}: 調整対象エフェクト = 「${chosenEffectName}」`);
      }
    }

    if (skippedPlainClips > 0) {
      log(`テロップ以外のクリップ ${skippedPlainClips}件は対象外にしました。`);
    }

    resetOffsets();
    renderClipList();
    const anyEditable = loadedClips.some((c) => c.editableParams.length > 0);
    setControlsEnabled(anyEditable);
    if (loadedClips.length === 0 && skippedPlainClips > 0) {
      els.statusLine.textContent =
        "このトラックには動画などのクリップしかありませんでした。テロップのあるトラックを選ぶか、上のチェックを外してください。";
    } else {
      els.statusLine.textContent = anyEditable
        ? "◀▶ボタン、または数値入力で、選択した全クリップの位置・スケールがまとめてリアルタイムに変わります。"
        : "選択したクリップに調整可能な位置/スケールパラメータが見つかりませんでした。";
    }
    log(`${loadedClips.length}件のクリップを読み込みました。`);
  } catch (err) {
    els.statusLine.textContent = `エラー: ${err.message || err}`;
    log(`Error: ${err.message || err}`);
  } finally {
    els.loadSelectionBtn.disabled = false;
  }
}

let diagnosticInFlight = false;
let lastDiagnosticAt = 0;
const DIAGNOSTIC_MIN_INTERVAL_MS = 500;

// Reads the first position/scale param back right after we write to it, so
// we can tell from the log whether Premiere actually kept our value or
// silently reset it — instead of guessing from screenshots. Throttled so a
// continuous label-drag (many applyDelta calls per second) doesn't spam the
// log or add a getStartValue() round trip on every single tick.
async function logWriteConfirmation(intendedByParam) {
  const now = Date.now();
  if (diagnosticInFlight || intendedByParam.length === 0) return;
  if (now - lastDiagnosticAt < DIAGNOSTIC_MIN_INTERVAL_MS) return;
  lastDiagnosticAt = now;
  diagnosticInFlight = true;
  try {
    const [{ editable, intended }] = intendedByParam;
    const confirmed = await editable.param.getStartValue();
    const rawActual = confirmed.value.value;
    let actualText;
    let intendedText;
    if (editable.kind === "position") {
      const actualXY = toXY(rawActual);
      actualText = actualXY
        ? `${fractionToPixels(actualXY.x, state.frameWidth)}, ${fractionToPixels(
            actualXY.y,
            state.frameHeight
          )} px`
        : `解析不能:${JSON.stringify(rawActual)}`;
      intendedText = `${fractionToPixels(intended.x, state.frameWidth)}, ${fractionToPixels(
        intended.y,
        state.frameHeight
      )} px`;
    } else {
      actualText = String(rawActual);
      intendedText = String(intended);
    }
    log(`確認[${editable.kind}]: 書き込み後の実際値=${actualText} / 狙った値=${intendedText}`);
  } catch (err) {
    log(`確認読み取りエラー: ${err.message || err}`);
  } finally {
    diagnosticInFlight = false;
  }
}

function applyDelta(dx, dy, scalePercent) {
  if (loadedClips.length === 0 || !currentProject) return;

  const intendedByParam = [];
  try {
    currentProject.lockedAccess(() => {
      currentProject.executeTransaction((compoundAction) => {
        for (const clip of loadedClips) {
          for (const editable of clip.editableParams) {
            const base = editable.baseline;
            let newValue;
            if (editable.kind === "position") {
              if (!base || typeof base.x !== "number" || typeof base.y !== "number") {
                log(`警告: ${clip.name} の位置ベースラインが不正です: ${JSON.stringify(base)}`);
                continue;
              }
              // dx/dy are in pixels; the stored value is a fraction of the
              // frame, so convert before adding. Then clamp to a few frames'
              // worth so no single write can land somewhere absurd.
              const rawX = base.x + pixelsToFraction(dx, state.frameWidth);
              const rawY = base.y + pixelsToFraction(dy, state.frameHeight);
              const finalX = Math.max(-2, Math.min(3, rawX));
              const finalY = Math.max(-2, Math.min(3, rawY));
              newValue = new ppro.PointF(finalX, finalY);
            } else {
              if (typeof base !== "number") {
                log(`警告: ${clip.name} のスケールベースラインが不正です: ${JSON.stringify(base)}`);
                continue;
              }
              const rawScale = base * (1 + scalePercent / 100);
              newValue = Math.max(1, Math.min(2000, rawScale));
            }
            const keyframe = editable.param.createKeyframe(newValue);
            const action = editable.param.createSetValueAction(keyframe, true);
            compoundAction.addAction(action);
            intendedByParam.push({ editable, intended: newValue });
          }
        }
      }, "Telop Shifter: adjust position/scale");
    });
  } catch (err) {
    log(`Error applying change: ${err.message || err}`);
    return;
  }
  logWriteConfirmation(intendedByParam);
}

// Puts every loaded clip on ONE shared horizontal position, instead of each
// keeping its own.
//
// A computed "centre" isn't possible: the UXP API exposes no bounds for a
// graphic, so there's no way to measure where the text actually sits inside
// its layer, and the stored Position means different things for different
// templates — writing a fixed number (0, or the anchor's X) threw telops off
// the left edge in one project and off the right edge in another.
//
// What IS reliable is a value taken from the clips themselves: the median of
// their current horizontal positions, plus whatever horizontal nudge is
// currently dialled in. So the workflow is "nudge with the arrows until it
// looks right, then press this to put everything on that exact axis" — the
// position is verified by eye rather than guessed at by arithmetic, and a
// stray clip snaps onto the same line as the majority.
function applyHorizontalCenter() {
  if (loadedClips.length === 0 || !currentProject) return;

  const positionParams = [];
  for (const clip of loadedClips) {
    for (const editable of clip.editableParams) {
      if (editable.kind !== "position") continue;
      const base = editable.baseline;
      if (!base || typeof base.x !== "number" || typeof base.y !== "number") continue;
      positionParams.push(editable);
    }
  }
  if (positionParams.length === 0) {
    log("そろえられる位置パラメータがありませんでした。");
    return;
  }

  const sortedX = positionParams.map((e) => e.baseline.x).sort((a, b) => a - b);
  const medianX = sortedX[Math.floor(sortedX.length / 2)];
  const targetX = Math.max(
    -2,
    Math.min(3, medianX + pixelsToFraction(state.x, state.frameWidth))
  );

  try {
    currentProject.lockedAccess(() => {
      currentProject.executeTransaction((compoundAction) => {
        for (const editable of positionParams) {
          const rawY = editable.baseline.y + pixelsToFraction(state.y, state.frameHeight);
          const finalY = Math.max(-2, Math.min(3, rawY));
          const keyframe = editable.param.createKeyframe(new ppro.PointF(targetX, finalY));
          compoundAction.addAction(editable.param.createSetValueAction(keyframe, true));
        }
      }, "Telop Shifter: align horizontally");
    });
  } catch (err) {
    log(`Error aligning: ${err.message || err}`);
    return;
  }

  for (const editable of positionParams) {
    editable.baseline = { x: targetX, y: editable.baseline.y };
  }
  state.x = 0;
  syncControls();
  log(
    `${positionParams.length}件の横位置を X=${fractionToPixels(targetX, state.frameWidth)}px にそろえました。`
  );
}

// Every write to Premiere becomes its own undo step, so writing on each
// animation frame buried the undo stack under dozens of 1px entries and made
// Cmd+Z look like it did nothing. Writes are throttled instead, with a
// guaranteed trailing write so the final value always lands.
let applyTimer = null;
let lastApplyAt = 0;
const APPLY_MIN_INTERVAL_MS = 150;

// Dumps the first loaded clip's whole effect structure — every component
// with its display name, match name and parameter names. Which layers and
// parameters a Graphic clip actually exposes can't be inferred from the
// Effect Controls screenshots alone (the same stored Position value puts one
// telop off the left edge and another right of centre), so this prints the
// ground truth instead of guessing at it.
async function logClipStructure() {
  if (loadedClips.length === 0 || !currentProject) {
    log("先に「読み込む」を押してください。");
    return;
  }

  const clip = loadedClips[0];
  const componentChain = await clip.trackItem.getComponentChain();

  const components = [];
  currentProject.lockedAccess(() => {
    const componentCount = componentChain.getComponentCount();
    for (let c = 0; c < componentCount; c += 1) {
      const component = componentChain.getComponentAtIndex(c);
      const paramCount = component.getParamCount();
      const paramNames = [];
      for (let p = 0; p < paramCount; p += 1) {
        paramNames.push(component.getParam(p).displayName || "(名前なし)");
      }
      components.push({ index: c, component, paramNames });
    }
  });

  log(`--- 「${clip.name}」の構造: ${components.length}個のエフェクト ---`);
  for (const entry of components) {
    let displayName = "?";
    let matchName = "?";
    try {
      displayName = await entry.component.getDisplayName();
      matchName = await entry.component.getMatchName();
    } catch (err) {
      // Keep going; a name we can't read still leaves the params useful.
    }
    log(`[${entry.index}] ${displayName} <${matchName}> : ${entry.paramNames.join(" / ")}`);
  }
}

function scheduleApply() {
  const elapsed = Date.now() - lastApplyAt;
  if (elapsed >= APPLY_MIN_INTERVAL_MS) {
    lastApplyAt = Date.now();
    applyDelta(state.x, state.y, state.scale);
    return;
  }
  if (applyTimer) return;
  applyTimer = setTimeout(() => {
    applyTimer = null;
    lastApplyAt = Date.now();
    applyDelta(state.x, state.y, state.scale);
  }, APPLY_MIN_INTERVAL_MS - elapsed);
}

// Manual typing in the number fields.
function bindNumberInput(inputEl, axis) {
  inputEl.addEventListener("input", () => {
    const value = Number(inputEl.value);
    if (Number.isNaN(value)) return;
    state[axis] = clampAxisValue(axis, value);
    scheduleApply();
  });
}
bindNumberInput(els.xInput, "x");
bindNumberInput(els.yInput, "y");
bindNumberInput(els.scaleInput, "scale");

// ◀/▶ arrow buttons: one step per click, repeating while held down.
// Now that Position is written in the right units, one step is a real
// pixel — far too small to see — so a normal click moves by ARROW_STEP and
// Shift+click moves by exactly 1 for fine work.
const HOLD_INITIAL_DELAY_MS = 400;
const HOLD_REPEAT_INTERVAL_MS = 80;
const ARROW_STEP = 5;

function bindArrowButton(buttonEl, axis, direction) {
  let repeatTimer = null;
  let initialTimer = null;
  let lastPointerStepAt = 0;

  function step(fine) {
    const amount = direction * (fine ? 1 : ARROW_STEP);
    state[axis] = clampAxisValue(axis, state[axis] + amount);
    syncControls();
    scheduleApply();
  }

  function stopHold() {
    clearTimeout(initialTimer);
    clearInterval(repeatTimer);
    initialTimer = null;
    repeatTimer = null;
  }

  buttonEl.addEventListener("pointerdown", (event) => {
    if (buttonEl.disabled) return;
    lastPointerStepAt = Date.now();
    // setPointerCapture isn't reliable inside a UXP panel — if it throws,
    // it must not take the actual step down with it.
    try {
      buttonEl.setPointerCapture(event.pointerId);
    } catch (err) {
      // Ignored: the window-level pointerup below still stops the repeat.
    }
    const fine = event.shiftKey;
    step(fine);
    initialTimer = setTimeout(() => {
      repeatTimer = setInterval(() => step(fine), HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_INITIAL_DELAY_MS);
  });

  // Fallback for the case where pointer events don't reach the button at
  // all: a plain click still steps once. The timestamp (rather than a flag)
  // avoids both double-stepping and getting stuck if pointerdown fires
  // without a matching click.
  buttonEl.addEventListener("click", (event) => {
    if (buttonEl.disabled) return;
    if (Date.now() - lastPointerStepAt < 500) return;
    step(event.shiftKey);
  });

  buttonEl.addEventListener("pointerup", stopHold);
  buttonEl.addEventListener("pointercancel", stopHold);
  buttonEl.addEventListener("lostpointercapture", stopHold);
  // Safety net: whatever happens to the button's own events, releasing the
  // mouse anywhere stops the repeat.
  window.addEventListener("pointerup", stopHold);
  window.addEventListener("mouseup", stopHold);
  window.addEventListener("blur", stopHold);
}

bindArrowButton(els.xMinus, "x", -1);
bindArrowButton(els.xPlus, "x", 1);
bindArrowButton(els.yMinus, "y", -1);
bindArrowButton(els.yPlus, "y", 1);
bindArrowButton(els.scaleMinus, "scale", -1);
bindArrowButton(els.scalePlus, "scale", 1);

els.centerHBtn.addEventListener("click", () => {
  if (els.centerHBtn.disabled) return;
  applyHorizontalCenter();
});

els.inspectBtn.addEventListener("click", () => {
  if (els.inspectBtn.disabled) return;
  logClipStructure();
});

els.resetBtn.addEventListener("click", () => {
  // Restore the load-time values, undoing any centring that rebased them.
  for (const clip of loadedClips) {
    for (const editable of clip.editableParams) {
      editable.baseline =
        editable.kind === "position"
          ? { x: editable.original.x, y: editable.original.y }
          : editable.original;
    }
  }
  resetOffsets();
  applyDelta(0, 0, 0);
});

els.loadSelectionBtn.addEventListener("click", handleLoadSelection);

syncControls();
log("Telop Shifter パネルを起動しました。");
