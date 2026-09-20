const ppro = require("premierepro");

const POSITION_NAME_RE = /position|位置/i;
const SCALE_NAME_RE = /scale|スケール/i;
// "Anchor Point" / "アンカーポイント" — never written to, only read, because
// Position places the anchor: Position == AnchorPoint means "no shift", so
// the anchor is what tells us where the frame's centre actually is for this
// clip. (Neither name matches the two regexes above.)
const ANCHOR_NAME_RE = /anchor|アンカー/i;

const els = {
  panel: document.getElementById("panel"),
  scrollBar: document.getElementById("scrollBar"),
  scrollThumb: document.getElementById("scrollThumb"),
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
  els.logBox.textContent = `[${time}] ${message}\n${els.logBox.textContent}`.slice(0, 20000);
}

// ---------------------------------------------------------------------------
// Always-visible scroll bar.
//
// A docked Premiere panel is usually short and narrow, and the host doesn't
// reliably draw a scrollbar for the scrolling area — so it looks like the UI
// is simply cut off rather than scrollable. This draws one next to the panel:
// the track is always there (so the layout never shifts), and the thumb shows
// how much is off-screen. It can be dragged, and clicking the track jumps.
// ---------------------------------------------------------------------------
const SCROLL_THUMB_MIN_PX = 24;

function updateScrollBar() {
  const { panel, scrollBar, scrollThumb } = els;
  if (!panel || !scrollBar || !scrollThumb) return;

  const viewHeight = panel.clientHeight;
  const contentHeight = panel.scrollHeight;
  const maxScroll = contentHeight - viewHeight;
  // 1px of slack: sub-pixel layout rounding shouldn't make the thumb flicker
  // in and out when the content only just fits.
  if (maxScroll <= 1) {
    scrollBar.classList.add("idle");
    return;
  }
  scrollBar.classList.remove("idle");

  const trackHeight = scrollBar.clientHeight;
  const thumbHeight = Math.max(
    SCROLL_THUMB_MIN_PX,
    Math.round((trackHeight * viewHeight) / contentHeight)
  );
  const travel = Math.max(0, trackHeight - thumbHeight);
  scrollThumb.style.height = `${thumbHeight}px`;
  scrollThumb.style.top = `${Math.round(travel * (panel.scrollTop / maxScroll))}px`;
}

// Moves the panel so the thumb's top lands under the pointer, keeping the
// grab point fixed relative to the thumb (so dragging doesn't jump).
function scrollToPointer(clientY, grabOffset) {
  const { panel, scrollBar, scrollThumb } = els;
  const maxScroll = panel.scrollHeight - panel.clientHeight;
  const travel = scrollBar.clientHeight - scrollThumb.offsetHeight;
  if (maxScroll <= 0 || travel <= 0) return;
  const barTop = scrollBar.getBoundingClientRect().top;
  const thumbTop = Math.max(0, Math.min(travel, clientY - barTop - grabOffset));
  panel.scrollTop = (thumbTop / travel) * maxScroll;
  updateScrollBar();
}

function bindScrollBar() {
  const { panel, scrollBar, scrollThumb } = els;
  if (!panel || !scrollBar || !scrollThumb) return;

  let grabOffset = null;

  function endDrag() {
    grabOffset = null;
  }

  scrollBar.addEventListener("pointerdown", (event) => {
    const thumbRect = scrollThumb.getBoundingClientRect();
    const onThumb = event.clientY >= thumbRect.top && event.clientY <= thumbRect.bottom;
    // Grabbing the thumb keeps the grab point; clicking the empty track
    // centres the thumb on the click, which is the usual scrollbar behaviour.
    grabOffset = onThumb ? event.clientY - thumbRect.top : thumbRect.height / 2;
    // As with the arrow buttons, setPointerCapture can throw inside a UXP
    // panel and must not take the rest of the handler down with it.
    try {
      scrollBar.setPointerCapture(event.pointerId);
    } catch (err) {
      // Ignored: the window-level pointerup below still ends the drag.
    }
    scrollToPointer(event.clientY, grabOffset);
  });

  scrollBar.addEventListener("pointermove", (event) => {
    if (grabOffset === null) return;
    scrollToPointer(event.clientY, grabOffset);
  });
  window.addEventListener("pointermove", (event) => {
    if (grabOffset === null) return;
    scrollToPointer(event.clientY, grabOffset);
  });
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("mouseup", endDrag);
  window.addEventListener("blur", endDrag);

  panel.addEventListener("scroll", updateScrollBar);
  window.addEventListener("resize", updateScrollBar);
  // The panel's height changes for reasons that fire no event here (a section
  // collapsed, clips loaded, the panel re-docked), so the size is re-checked
  // on a slow timer as well. It's a few cheap layout reads per second.
  setInterval(updateScrollBar, 300);
  updateScrollBar();
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
// The name of the track the dropdown was last set to, remembered separately
// from the option's value. The list is rebuilt on every load, and the API
// index that a name maps to differs from sequence to sequence — so restoring
// the raw index after switching sequences silently pointed at a different
// track (a list saying "13件" loading a track that had one clip).
let lastSelectedTrackName = null;

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
  let restoredValue = null;
  for (const { apiIndex, name, clipCount } of tracks) {
    const option = document.createElement("option");
    option.value = String(apiIndex);
    option.textContent = `${name}（${clipCount}件）`;
    els.trackSelect.appendChild(option);
    if (name === lastSelectedTrackName) {
      restoredValue = option.value;
    }
  }

  if (previous === "selection" || lastSelectedTrackName === null) {
    els.trackSelect.value = "selection";
  } else if (restoredValue !== null) {
    els.trackSelect.value = restoredValue;
  } else {
    // The remembered track no longer exists here; better to fall back than to
    // quietly load whatever now sits at that index.
    log(`前に選んでいたトラック「${lastSelectedTrackName}」が見つかりませんでした。`);
    els.trackSelect.value = "selection";
  }
}

// Remember the NAME, not the index, so the choice survives the list being
// rebuilt for a different sequence.
els.trackSelect.addEventListener("change", () => {
  const selected = els.trackSelect.options[els.trackSelect.selectedIndex];
  if (!selected || selected.value === "selection") {
    lastSelectedTrackName = null;
    return;
  }
  lastSelectedTrackName = (selected.textContent || "").replace(/（.*$/, "");
});

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
// A Graphic clip's text layers show up in the component chain as their own
// components, each with its own Position and Anchor Point. That pair is what
// finally makes real centring possible: see textVisibleCenter() below.
const TEXT_MATCH_NAME = "AE.ADBE Text";

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
  const allGroups = [];
  project.lockedAccess(() => {
    const componentCount = componentChain.getComponentCount();
    for (let c = 0; c < componentCount; c += 1) {
      const component = componentChain.getComponentAtIndex(c);
      const paramCount = component.getParamCount();
      const params = [];
      const scaleParams = [];
      let anchorParam = null;
      let positionParam = null;
      for (let p = 0; p < paramCount; p += 1) {
        const param = component.getParam(p);
        const name = param.displayName || "";
        if (POSITION_NAME_RE.test(name)) {
          params.push({ param, kind: "position" });
          if (!positionParam) positionParam = param;
        } else if (SCALE_NAME_RE.test(name)) {
          params.push({ param, kind: "scale" });
          scaleParams.push(param);
        } else if (ANCHOR_NAME_RE.test(name)) {
          anchorParam = param;
        }
      }
      allGroups.push({ component, params, scaleParams, anchorParam, positionParam });
    }
  });

  const rawGroups = allGroups.filter((group) => group.params.length > 0);
  if (rawGroups.length === 0) {
    return {
      editableParams: [],
      skippedKeyframed: 0,
      chosenEffectName: null,
      isBaseMotion: true,
      textCenter: null,
      transformAnchor: null,
    };
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

  // How much the clip's own transform magnifies its contents. Scale is no
  // longer written here (see below), so this stays put and can be used to
  // work out where the text ends up on screen.
  let transformScale = 1;
  if (chosen.scaleParams.length > 0) {
    try {
      const value = (await chosen.scaleParams[0].getStartValue()).value.value;
      if (typeof value === "number" && value > 0 && value <= 2000) {
        transformScale = value / 100;
      }
    } catch (err) {
      // Leave it at 1; the clip is almost certainly unscaled.
    }
  }

  // Where this clip's text actually sits, in the same frame-fraction units as
  // everything else. A text layer places its Anchor Point at its Position, so
  // (Position - AnchorPoint) is the frame coordinate the glyphs sit on — the
  // measurement the API doesn't offer any other way. Verified against a real
  // project: Position (0.125, 0.350) with Anchor (-0.382, -0.161) gives
  // 0.507, and that telop's text did sit at 0.506 of the frame width.
  const textLayers = [];
  for (const group of allGroups) {
    if (group === chosen || !group.positionParam || !group.anchorParam) continue;
    let matchName = "";
    try {
      matchName = await group.component.getMatchName();
    } catch (err) {
      continue;
    }
    if (matchName !== TEXT_MATCH_NAME) continue;
    try {
      const pos = toXY((await group.positionParam.getStartValue()).value.value);
      const anchor = toXY((await group.anchorParam.getStartValue()).value.value);
      if (pos && anchor) {
        textLayers.push({
          group,
          x: pos.x - anchor.x,
          y: pos.y - anchor.y,
        });
      }
    } catch (err) {
      // A layer we can't read just doesn't contribute.
    }
  }

  // A telop template often carries spare text layers that aren't used in this
  // clip, and those sit anywhere — one real project had layers at 0.37, 0.50,
  // 0.55 and 1.00 of the frame width for a single visible line. Layers parked
  // outside the frame are dropped, and the MEDIAN of what's left is used
  // rather than the average, so one stray layer can't drag the estimate.
  const onScreen = textLayers.filter((layer) => layer.x >= 0 && layer.x <= 1);
  const usable = onScreen.length > 0 ? onScreen : textLayers;
  let textCenter = null;
  if (usable.length > 0) {
    const xs = usable.map((l) => l.x).sort((a, b) => a - b);
    const ys = usable.map((l) => l.y).sort((a, b) => a - b);
    textCenter = {
      x: xs[Math.floor((xs.length - 1) / 2)],
      y: ys[Math.floor((ys.length - 1) / 2)],
      layerCount: usable.length,
      allX: textLayers.map((l) => l.x),
    };
  }

  // Position moves the whole graphic, so it stays on the clip's transform.
  //
  // Scale does NOT. The transform scales the graphic around ITS anchor point
  // (the frame centre), so a telop sitting anywhere else gets flung outward
  // as it grows — scaling to 158% threw one right off the edge of the frame.
  // Each text layer, on the other hand, scales around its own anchor, which
  // sits on the text itself, so scaling the layers makes the telop grow where
  // it stands. Clips with no readable text layer (a MOGRT that doesn't expose
  // one) keep the old behaviour.
  const textScaleParams = [];
  for (const layer of textLayers) {
    for (const param of layer.group.scaleParams) {
      textScaleParams.push({ param, kind: "scale" });
    }
  }
  const scalesOnText = textScaleParams.length > 0;
  const candidates = chosen.params
    .filter((candidate) => candidate.kind === "position")
    .concat(scalesOnText ? textScaleParams : chosen.params.filter((c) => c.kind === "scale"));

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

  return {
    editableParams,
    skippedKeyframed,
    chosenEffectName,
    isBaseMotion,
    textCenter,
    transformAnchor: centerXY,
    transformScale,
    scalesOnText,
  };
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
      // The measured text centre is shown per clip so a wrong measurement is
      // visible before the centring button is pressed, not after.
      const centreNote = clip.textCenter
        ? `文字の中心 ${Math.round(clip.textCenter.x * 100)}%`
        : "文字の位置は測定できず";
      let note = `${centreNote} / 位置x${posCount} / スケールx${scaleCount}${
        clip.scalesOnText ? "(文字)" : ""
      }`;
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
      const {
        editableParams,
        skippedKeyframed,
        chosenEffectName,
        isBaseMotion,
        textCenter,
        transformAnchor,
        transformScale,
        scalesOnText,
      } = await collectEditableParams(project, trackItem);

      // A plain video/image clip only ever carries the generic "Motion"
      // effect; a telop (Graphic/Text or MOGRT) has its own content
      // transform on top. So "base Motion only" is the signal for "this is
      // footage, not a telop" — skip it rather than dragging the footage
      // around by mistake.
      if (telopOnly && isBaseMotion) {
        skippedPlainClips += 1;
        continue;
      }

      loadedClips.push({
        trackItem,
        name,
        editableParams,
        skippedKeyframed,
        chosenEffectName,
        textCenter,
        transformAnchor,
        transformScale,
        scalesOnText,
      });
      if (textCenter) {
        // Printed in full so a mis-measured clip can be spotted against what's
        // actually on screen, rather than inferred from the result.
        const all = textCenter.allX
          .map((x) => `${Math.round(x * 100)}%`)
          .join(", ");
        log(
          `${name}: 文字の中心X=${Math.round(textCenter.x * 100)}% ` +
            `(テキスト${textCenter.allX.length}枚: ${all})`
        );
      } else {
        log(`${name}: 調整対象エフェクト = 「${chosenEffectName}」（文字の位置は測定できず）`);
      }
    }

    const measurable = loadedClips.filter((c) => c.textCenter).length;
    if (measurable > 0) {
      log(`文字の位置を測定できたクリップ: ${measurable}/${loadedClips.length}件`);
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

// Works out the horizontal position this clip's transform needs so that its
// text lands on the middle of the frame — per clip, so telops whose text was
// typed at different places inside their own graphic all end up visually
// centred rather than merely sharing a stored number.
//
// The maths, all in frame-fraction units:
//   visibleX = anchorX + scale * ((textCentreX) - anchorX) + (posX - anchorX)
// where textCentreX is the text layer's own (Position - AnchorPoint). Setting
// visibleX to 0.5 and solving for posX gives:
//   posX = 0.5 - scale * (textCentreX - anchorX)
// The scale term is there because the clip's own scale magnifies how far the
// text sits from the transform's anchor.
function centeredPositionX(clip) {
  if (!clip.textCenter) return null;
  const anchorX = clip.transformAnchor ? clip.transformAnchor.x : 0.5;
  // The clip's own transform scale, which this tool no longer writes to — the
  // panel's scale slider drives the text layers instead, and those scale
  // around the text itself, so they don't move its centre.
  const scale = typeof clip.transformScale === "number" ? clip.transformScale : 1;
  return 0.5 - scale * (clip.textCenter.x - anchorX);
}

// Centres every loaded telop horizontally.
//
// Each clip's text is measured from its own text layers (Position minus
// Anchor Point), so this is a real centring rather than "write the same
// number everywhere" — which is what previously threw telops off the left
// edge in one project and off the right in another, since the stored
// Position means something different in every template.
//
// Clips whose text can't be measured (a MOGRT that exposes no text layer,
// say) fall back to the old behaviour: they're put on the median of the
// others' positions, so they at least line up with the majority.
//
// Whatever is dialled into the X field is added on top, so "centred, but 20px
// left" is still available.
function applyHorizontalCenter() {
  if (loadedClips.length === 0 || !currentProject) return;

  const nudgeX = pixelsToFraction(state.x, state.frameWidth);
  const plan = [];
  const unmeasured = [];

  for (const clip of loadedClips) {
    const positions = clip.editableParams.filter(
      (e) =>
        e.kind === "position" &&
        e.baseline &&
        typeof e.baseline.x === "number" &&
        typeof e.baseline.y === "number"
    );
    if (positions.length === 0) continue;

    const centered = centeredPositionX(clip);
    if (centered === null) {
      unmeasured.push({ clip, positions });
      continue;
    }
    plan.push({ clip, positions, targetX: Math.max(-2, Math.min(3, centered + nudgeX)) });
  }

  if (plan.length === 0 && unmeasured.length === 0) {
    log("そろえられる位置パラメータがありませんでした。");
    return;
  }

  // Clips we couldn't measure ride along on the median of the measured ones
  // (or of their own positions, if nothing could be measured at all).
  if (unmeasured.length > 0) {
    const pool =
      plan.length > 0
        ? plan.map((entry) => entry.targetX)
        : unmeasured.map((entry) => entry.positions[0].baseline.x + nudgeX);
    const sorted = pool.slice().sort((a, b) => a - b);
    const medianX = Math.max(-2, Math.min(3, sorted[Math.floor(sorted.length / 2)]));
    for (const entry of unmeasured) {
      plan.push({ clip: entry.clip, positions: entry.positions, targetX: medianX });
    }
  }

  try {
    currentProject.lockedAccess(() => {
      currentProject.executeTransaction((compoundAction) => {
        for (const entry of plan) {
          for (const editable of entry.positions) {
            const rawY = editable.baseline.y + pixelsToFraction(state.y, state.frameHeight);
            const finalY = Math.max(-2, Math.min(3, rawY));
            const keyframe = editable.param.createKeyframe(
              new ppro.PointF(entry.targetX, finalY)
            );
            compoundAction.addAction(editable.param.createSetValueAction(keyframe, true));
          }
        }
      }, "Telop Shifter: centre horizontally");
    });
  } catch (err) {
    log(`Error centring: ${err.message || err}`);
    return;
  }

  for (const entry of plan) {
    for (const editable of entry.positions) {
      editable.baseline = { x: entry.targetX, y: editable.baseline.y };
    }
  }
  state.x = 0;
  syncControls();

  const measuredCount = plan.length - unmeasured.length;
  log(
    `${plan.length}件を中央にそろえました（文字の位置を実測できたもの: ${measuredCount}件 / ` +
      `多数派に合わせたもの: ${unmeasured.length}件）`
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

// Params worth printing the actual value of, rather than just the name: the
// transform-ish ones, plus anything that looks like it belongs to a text
// layer (which is what a true "centre this telop" would need).
const DIAG_VALUE_NAME_RE =
  /position|位置|scale|スケール|anchor|アンカー|transform|変形|align|揃え|text|テキスト|source|ソース|rect|bounds|width|幅/i;

function describeParamValue(rawValue) {
  const xy = toXY(rawValue);
  if (xy) return `(${xy.x}, ${xy.y})`;
  if (rawValue === null || rawValue === undefined) return String(rawValue);
  if (typeof rawValue === "object") {
    try {
      return JSON.stringify(rawValue).slice(0, 120);
    } catch (err) {
      return "(object)";
    }
  }
  return String(rawValue).slice(0, 120);
}

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
      const params = [];
      for (let p = 0; p < paramCount; p += 1) {
        const param = component.getParam(p);
        params.push({ param, name: param.displayName || "(名前なし)" });
      }
      components.push({ index: c, component, params });
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
    log(
      `[${entry.index}] ${displayName} <${matchName}> : ` +
        entry.params.map((p) => p.name).join(" / ")
    );

    // The value matters as much as the name here: the same stored Position
    // leaves one telop cut off at the left and another right of centre, so
    // the numbers are what tell us which param actually places the text.
    for (const { param, name } of entry.params) {
      if (!DIAG_VALUE_NAME_RE.test(name)) continue;
      try {
        const keyframe = await param.getStartValue();
        const keyed = param.isTimeVarying() ? " [キーフレームあり]" : "";
        log(`    ${entry.index}.${name} = ${describeParamValue(keyframe.value.value)}${keyed}`);
      } catch (err) {
        log(`    ${entry.index}.${name} = 読み取り不可 (${err.message || err})`);
      }
    }
  }
  log("--- 構造の出力ここまで ---");
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

bindScrollBar();
syncControls();
log("Telop Shifter パネルを起動しました。");
