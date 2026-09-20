const ppro = require("premierepro");

const POSITION_NAME_RE = /position|位置/i;
const SCALE_NAME_RE = /scale|スケール/i;

const els = {
  loadSelectionBtn: document.getElementById("loadSelectionBtn"),
  resetBtn: document.getElementById("resetBtn"),
  statusLine: document.getElementById("statusLine"),
  clipCount: document.getElementById("clipCount"),
  clipList: document.getElementById("clipList"),
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

// One entry per loaded clip: { name, editableParams: [{ param, kind, baseline }] }
let loadedClips = [];
let currentProject = null;
let rafScheduled = false;

// Current offset from each param's baseline, applied to every loaded clip.
const state = { x: 0, y: 0, scale: 0 };

function getStepSize() {
  const checked = els.stepSizeGroup.querySelector('input[name="stepSize"]:checked');
  return checked ? Number(checked.value) : 1;
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  els.logBox.textContent = `[${time}] ${message}\n${els.logBox.textContent}`.slice(0, 4000);
}

function isVideoClipTrackItem(trackItem) {
  return trackItem instanceof ppro.VideoClipTrackItem;
}

async function getSelectedVideoClips() {
  const project = await ppro.Project.getActiveProject();
  if (!project) {
    throw new Error("開いているプロジェクトがありません。");
  }
  const sequence = await project.getActiveSequence();
  if (!sequence) {
    throw new Error("アクティブなシーケンスがありません。");
  }
  const selection = await sequence.getSelection();
  const items = await selection.getTrackItems();
  const videoClips = items.filter(isVideoClipTrackItem);
  return { project, sequence, videoClips };
}

// Scans one clip's effect stack and returns the Position/Scale params
// that are safe to overwrite directly (i.e. not keyframed).
async function collectEditableParams(project, trackItem) {
  const componentChain = await trackItem.getComponentChain();

  const candidates = [];
  project.lockedAccess(() => {
    const componentCount = componentChain.getComponentCount();
    for (let c = 0; c < componentCount; c += 1) {
      const component = componentChain.getComponentAtIndex(c);
      const paramCount = component.getParamCount();
      for (let p = 0; p < paramCount; p += 1) {
        const param = component.getParam(p);
        const name = param.displayName || "";
        if (POSITION_NAME_RE.test(name)) {
          candidates.push({ param, kind: "position", name });
        } else if (SCALE_NAME_RE.test(name)) {
          candidates.push({ param, kind: "scale", name });
        }
      }
    }
  });

  const editableParams = [];
  let skippedKeyframed = 0;
  for (const candidate of candidates) {
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

  return { editableParams, skippedKeyframed };
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
      let note = `位置x${posCount} / スケールx${scaleCount}`;
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

function updateInputsFromState() {
  els.xInput.value = String(state.x);
  els.yInput.value = String(state.y);
  els.scaleInput.value = String(state.scale);
}

function resetOffsets() {
  state.x = 0;
  state.y = 0;
  state.scale = 0;
  updateInputsFromState();
}

async function handleLoadSelection() {
  els.loadSelectionBtn.disabled = true;
  try {
    const { project, videoClips } = await getSelectedVideoClips();
    if (videoClips.length === 0) {
      els.statusLine.textContent =
        "タイムライン上でテロップのクリップを選択してから、もう一度ボタンを押してください。";
      loadedClips = [];
      renderClipList();
      setControlsEnabled(false);
      return;
    }

    currentProject = project;
    loadedClips = [];
    for (const trackItem of videoClips) {
      const name = await trackItem.getName();
      const { editableParams, skippedKeyframed } = await collectEditableParams(project, trackItem);
      loadedClips.push({ trackItem, name, editableParams, skippedKeyframed });
    }

    resetOffsets();
    renderClipList();
    const anyEditable = loadedClips.some((c) => c.editableParams.length > 0);
    setControlsEnabled(anyEditable);
    els.statusLine.textContent = anyEditable
      ? "＋/−ボタンや数値入力で、選択した全クリップの位置・スケールがまとめてリアルタイムに変わります。"
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
    state[axis] = value;
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
    const next = state[axis] + delta;
    state[axis] = axis === "scale" ? Math.max(-95, next) : next;
    updateInputsFromState();
    scheduleApply();
  }

  function stopHold() {
    clearTimeout(initialTimer);
    clearInterval(repeatTimer);
    initialTimer = null;
    repeatTimer = null;
  }

  buttonEl.addEventListener("mousedown", () => {
    if (buttonEl.disabled) return;
    step();
    initialTimer = setTimeout(() => {
      repeatTimer = setInterval(step, HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_INITIAL_DELAY_MS);
  });
  buttonEl.addEventListener("mouseup", stopHold);
  buttonEl.addEventListener("mouseleave", stopHold);
}

bindStepButton(els.xMinus, "x", -1);
bindStepButton(els.xPlus, "x", 1);
bindStepButton(els.yMinus, "y", -1);
bindStepButton(els.yPlus, "y", 1);
bindStepButton(els.scaleMinus, "scale", -1);
bindStepButton(els.scalePlus, "scale", 1);

els.resetBtn.addEventListener("click", () => {
  resetOffsets();
  applyDelta(0, 0, 0);
});

els.loadSelectionBtn.addEventListener("click", handleLoadSelection);

log("Telop Shifter パネルを起動しました。");
