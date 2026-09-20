const ppro = require("premierepro");

const POSITION_NAME_RE = /position|位置/i;
const SCALE_NAME_RE = /scale|スケール/i;

const els = {
  trackSelect: document.getElementById("trackSelect"),
  loadSelectionBtn: document.getElementById("loadSelectionBtn"),
  resetBtn: document.getElementById("resetBtn"),
  statusLine: document.getElementById("statusLine"),
  clipCount: document.getElementById("clipCount"),
  clipList: document.getElementById("clipList"),
  xLabel: document.getElementById("xLabel"),
  yLabel: document.getElementById("yLabel"),
  scaleLabel: document.getElementById("scaleLabel"),
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
let rafScheduled = false;

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

// Keeps the "V1".."V8" options in sync with the sequence's current track
// count, while preserving whatever the user had selected if it's still valid.
async function populateTrackOptions(sequence) {
  const trackCount = await sequence.getVideoTrackCount();
  const previous = els.trackSelect.value;

  els.trackSelect.innerHTML = "";
  const selectionOption = document.createElement("option");
  selectionOption.value = "selection";
  selectionOption.textContent = "タイムラインで選択中のクリップ";
  els.trackSelect.appendChild(selectionOption);

  // Option values are the on-screen track number (V1 = bottom track, as
  // shown in the timeline). getVideoTrack()'s own index numbers tracks the
  // other way around (index 0 = the topmost track), so the conversion
  // happens in resolveVideoClips() below, not here.
  for (let displayNumber = 1; displayNumber <= trackCount; displayNumber += 1) {
    const option = document.createElement("option");
    option.value = String(displayNumber);
    option.textContent = `V${displayNumber}`;
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
  const trackCount = await sequence.getVideoTrackCount();
  const apiIndex = trackCount - Number(chosen);
  const track = await sequence.getVideoTrack(apiIndex);
  return track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
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
      for (let p = 0; p < paramCount; p += 1) {
        const param = component.getParam(p);
        const name = param.displayName || "";
        if (POSITION_NAME_RE.test(name)) {
          params.push({ param, kind: "position" });
        } else if (SCALE_NAME_RE.test(name)) {
          params.push({ param, kind: "scale" });
        }
      }
      if (params.length > 0) {
        rawGroups.push({ component, params });
      }
    }
  });

  if (rawGroups.length === 0) {
    return { editableParams: [], skippedKeyframed: 0, chosenEffectName: null };
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
    const baseline = candidate.kind === "position" ? toXY(rawValue) : rawValue;
    if (candidate.kind === "position" && !baseline) {
      log(`警告: 位置の値の形式を認識できません（スキップします）: ${JSON.stringify(rawValue)}`);
      continue;
    }
    editableParams.push({
      param: candidate.param,
      kind: candidate.kind,
      baseline,
    });
  }

  return { editableParams, skippedKeyframed, chosenEffectName };
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
  for (const el of [els.xInput, els.yInput, els.scaleInput, els.resetBtn]) {
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

    loadedClips = [];
    for (const trackItem of videoClips) {
      const name = await trackItem.getName();
      const { editableParams, skippedKeyframed, chosenEffectName } = await collectEditableParams(
        project,
        trackItem
      );
      loadedClips.push({ trackItem, name, editableParams, skippedKeyframed, chosenEffectName });
      if (chosenEffectName) {
        log(`${name}: 調整対象エフェクト = 「${chosenEffectName}」`);
      }
    }

    resetOffsets();
    renderClipList();
    const anyEditable = loadedClips.some((c) => c.editableParams.length > 0);
    setControlsEnabled(anyEditable);
    els.statusLine.textContent = anyEditable
      ? "ラベルのドラッグ、または数値入力で、選択した全クリップの位置・スケールがまとめてリアルタイムに変わります。"
      : "選択したクリップに調整可能な位置/スケールパラメータが見つかりませんでした。";
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
      actualText = actualXY ? `(${actualXY.x}, ${actualXY.y})` : `解析不能:${JSON.stringify(rawActual)}`;
      intendedText = `(${intended.x}, ${intended.y})`;
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
              newValue = new ppro.PointF(base.x + dx, base.y + dy);
            } else {
              if (typeof base !== "number") {
                log(`警告: ${clip.name} のスケールベースラインが不正です: ${JSON.stringify(base)}`);
                continue;
              }
              newValue = base * (1 + scalePercent / 100);
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

function scheduleApply() {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    applyDelta(state.x, state.y, state.scale);
  });
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

// Click-drag directly on a label (left/right) to scrub its value, the way
// Premiere's own numeric fields work. Sensitivity is always 1px = 1 unit.
function bindScrubLabel(labelEl, axis) {
  let dragging = false;
  let startClientX = 0;
  let startValue = 0;

  labelEl.addEventListener("pointerdown", (event) => {
    if (loadedClips.length === 0) return;
    dragging = true;
    startClientX = event.clientX;
    startValue = state[axis];
    labelEl.setPointerCapture(event.pointerId);
    labelEl.classList.add("scrubbing");
  });
  labelEl.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const deltaPx = Math.round(event.clientX - startClientX);
    state[axis] = clampAxisValue(axis, startValue + deltaPx);
    syncControls();
    scheduleApply();
  });
  function stopDrag() {
    dragging = false;
    labelEl.classList.remove("scrubbing");
  }
  labelEl.addEventListener("pointerup", stopDrag);
  labelEl.addEventListener("pointercancel", stopDrag);
  labelEl.addEventListener("lostpointercapture", stopDrag);
}

bindScrubLabel(els.xLabel, "x");
bindScrubLabel(els.yLabel, "y");
bindScrubLabel(els.scaleLabel, "scale");

els.resetBtn.addEventListener("click", () => {
  resetOffsets();
  applyDelta(0, 0, 0);
});

els.loadSelectionBtn.addEventListener("click", handleLoadSelection);

log("Telop Shifter パネルを起動しました。");
