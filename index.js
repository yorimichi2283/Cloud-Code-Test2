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
  xMinus: document.getElementById("xMinus"),
  xPlus: document.getElementById("xPlus"),
  yMinus: document.getElementById("yMinus"),
  yPlus: document.getElementById("yPlus"),
  scaleMinus: document.getElementById("scaleMinus"),
  scalePlus: document.getElementById("scalePlus"),
  stepSizeGroup: document.getElementById("stepSizeGroup"),
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

function getStepSize() {
  const checked = els.stepSizeGroup.querySelector('input[name="stepSize"]:checked');
  return checked ? Number(checked.value) : 1;
}

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

  for (let i = 0; i < trackCount; i += 1) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `V${i + 1}`;
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
    editableParams.push({
      param: candidate.param,
      kind: candidate.kind,
      baseline: startKeyframe.value.value,
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
    els.resetBtn,
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
      ? "＋/−ボタン、ラベルのドラッグ、数値入力のいずれでも、選択した全クリップの位置・スケールがまとめてリアルタイムに変わります。"
      : "選択したクリップに調整可能な位置/スケールパラメータが見つかりませんでした。";
    log(`${loadedClips.length}件のクリップを読み込みました。`);
  } catch (err) {
    els.statusLine.textContent = `エラー: ${err.message || err}`;
    log(`Error: ${err.message || err}`);
  } finally {
    els.loadSelectionBtn.disabled = false;
  }
}

function applyDelta(dx, dy, scalePercent) {
  if (loadedClips.length === 0 || !currentProject) return;

  try {
    currentProject.lockedAccess(() => {
      currentProject.executeTransaction((compoundAction) => {
        for (const clip of loadedClips) {
          for (const editable of clip.editableParams) {
            let newValue;
            if (editable.kind === "position") {
              const base = editable.baseline;
              newValue = new ppro.PointF(base.x + dx, base.y + dy);
            } else {
              const base = editable.baseline;
              newValue = base * (1 + scalePercent / 100);
            }
            const keyframe = editable.param.createKeyframe(newValue);
            const action = editable.param.createSetValueAction(keyframe, true);
            compoundAction.addAction(action);
          }
        }
      }, "Telop Shifter: adjust position/scale");
    });
  } catch (err) {
    log(`Error applying change: ${err.message || err}`);
  }
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

// +/- buttons: one immediate step per click, and repeated stepping while held down.
const HOLD_INITIAL_DELAY_MS = 400;
const HOLD_REPEAT_INTERVAL_MS = 80;

function bindStepButton(buttonEl, axis, direction) {
  let repeatTimer = null;
  let initialTimer = null;

  function step() {
    const delta = direction * getStepSize();
    state[axis] = clampAxisValue(axis, state[axis] + delta);
    syncControls();
    scheduleApply();
  }

  function stopHold() {
    clearTimeout(initialTimer);
    clearInterval(repeatTimer);
    initialTimer = null;
    repeatTimer = null;
  }

  // Uses Pointer Events + setPointerCapture so that releasing the mouse
  // anywhere (not just while still over the button) reliably stops the
  // repeat. Without capture, a fast click/drag can leave mouseup/mouseleave
  // un-fired and the interval running forever, which is what made the
  // value race up to an extreme number.
  buttonEl.addEventListener("pointerdown", (event) => {
    if (buttonEl.disabled) return;
    buttonEl.setPointerCapture(event.pointerId);
    step();
    initialTimer = setTimeout(() => {
      repeatTimer = setInterval(step, HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_INITIAL_DELAY_MS);
  });
  buttonEl.addEventListener("pointerup", stopHold);
  buttonEl.addEventListener("pointercancel", stopHold);
  buttonEl.addEventListener("lostpointercapture", stopHold);
}

bindStepButton(els.xMinus, "x", -1);
bindStepButton(els.xPlus, "x", 1);
bindStepButton(els.yMinus, "y", -1);
bindStepButton(els.yPlus, "y", 1);
bindStepButton(els.scaleMinus, "scale", -1);
bindStepButton(els.scalePlus, "scale", 1);

// Click-drag directly on a label (left/right) to scrub its value, the way
// Premiere's own numeric fields work. Sensitivity is always 1px = 1 unit,
// independent of the +/- buttons' "movement step" — using that step size as
// a per-pixel multiplier made dragging wildly oversensitive (a normal drag
// with the step set to 50 could add thousands of units in an instant).
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
