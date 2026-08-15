autowatch = 1;
inlets = 1;
outlets = 0;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var bufferName = (jsarguments.length > 1) ? String(jsarguments[1]) : "source_display";
var points = 240; // medium-low-res display style

var isPlaying = false;
var playStartMs = 0;
var progress01 = 0.0;
var refreshTask = null;

function _nowMs() { return new Date().getTime(); }

function _bufferDurationMs() {
  var b;
  try { b = new Buffer(bufferName); } catch (e) { return 0; }

  try {
    var d = b.length();
    if (d && d > 0) return d;
  } catch (e1) {}

  try {
    var fc = b.framecount();
    var sr = b.samplerate ? b.samplerate() : 44100;
    if (fc > 0 && sr > 0) return 1000.0 * fc / sr;
  } catch (e2) {}

  return 0;
}

function _ensureTask() {
  if (refreshTask) return;
  refreshTask = new Task(_tick, this);
  refreshTask.interval = 33;
}

function _tick() {
  if (!isPlaying) return;
  var durMs = _bufferDurationMs();
  if (durMs <= 0) {
    progress01 = 0.0;
    mgraphics.redraw();
    return;
  }
  var elapsed = _nowMs() - playStartMs;
  // modulo for looped playback
  progress01 = ((elapsed % durMs) / durMs);
  mgraphics.redraw();
  refreshTask.schedule(refreshTask.interval);
}

function setbuffer(name) {
  bufferName = String(name);
  reset();
  mgraphics.redraw();
}

function setpoints(n) {
  points = Math.max(32, Math.floor(n));
  mgraphics.redraw();
}

function reset() {
  isPlaying = false;
  progress01 = 0.0;
  mgraphics.redraw();
}

function play(v) {
  var on = (Number(v) !== 0);
  if (!on) {
    isPlaying = false;
    mgraphics.redraw();
    return;
  }
  playStartMs = _nowMs();
  progress01 = 0.0;
  isPlaying = true;
  _ensureTask();
  refreshTask.cancel();
  refreshTask.schedule(1);
}

function bang() { mgraphics.redraw(); }
function msg_int(v) { play(v); }
function msg_float(v) { play(v); }

function anything() {
  var a = messagename;
  if (a === "play") {
    if (arguments.length > 0) play(arguments[0]); else play(1);
    return;
  }
  if (a === "reset" || a === "stop") {
    play(0);
    progress01 = 0.0;
    mgraphics.redraw();
    return;
  }
  mgraphics.redraw();
}

function _drawEmpty(w, h) {
  mgraphics.set_source_rgba(0.11, 0.11, 0.11, 1.0);
  mgraphics.rectangle(0, 0, w, h);
  mgraphics.fill();
  mgraphics.set_source_rgba(0.55, 0.55, 0.55, 0.9);
  mgraphics.select_font_face("Arial");
  mgraphics.set_font_size(12);
  mgraphics.move_to(12, h * 0.55);
  mgraphics.show_text("Drop source file");
}

function _lerp(a, b, t) { return a + (b - a) * t; }

function paint() {
  var w = box.rect[2] - box.rect[0];
  var h = box.rect[3] - box.rect[1];

  mgraphics.set_source_rgba(0.11, 0.11, 0.11, 1.0);
  mgraphics.rectangle(0, 0, w, h);
  mgraphics.fill();

  var b;
  try { b = new Buffer(bufferName); } catch (e) { _drawEmpty(w, h); return; }

  var frames = b.framecount();
  if (!frames || frames <= 1) { _drawEmpty(w, h); return; }

  var centerY = h * 0.5;
  var halfH = h * 0.42;
  var bins = Math.max(32, points);
  var framesPerBin = Math.max(1, Math.floor(frames / bins));
  var lw = Math.max(1.0, w / 520.0);

  // Colors
  var baseR = 0.72, baseG = 0.72, baseB = 0.72, baseA = 0.75;
  var warmR = 1.00, warmG = 0.82, warmB = 0.28, warmA = 0.95;

  for (var i = 0; i < bins; i++) {
    var start = i * framesPerBin;
    if (start >= frames) break;
    var end = Math.min(frames - 1, start + framesPerBin - 1);

    var minv = 1.0;
    var maxv = -1.0;
    var step = Math.max(1, Math.floor((end - start + 1) / 6));
    for (var f = start; f <= end; f += step) {
      var v = b.peek(1, f, 1);
      if (v < minv) minv = v;
      if (v > maxv) maxv = v;
    }

    var x = (i / Math.max(1, bins - 1)) * w;
    var y1 = centerY - (maxv * halfH);
    var y2 = centerY - (minv * halfH);

    // time-based coloration (replaces vertical progress bar)
    var t = i / Math.max(1, bins - 1);
    var played = (t <= progress01) ? 1.0 : 0.0;

    var r = _lerp(baseR, warmR, played);
    var g = _lerp(baseG, warmG, played);
    var bl = _lerp(baseB, warmB, played);
    var a = _lerp(baseA, warmA, played);

    mgraphics.set_source_rgba(r, g, bl, a);
    mgraphics.set_line_width(lw);
    mgraphics.move_to(x, y1);
    mgraphics.line_to(x, y2);
    mgraphics.stroke();
  }

  mgraphics.set_source_rgba(1.0, 0.82, 0.28, 0.12);
  mgraphics.set_line_width(1.0);
  mgraphics.move_to(0, centerY);
  mgraphics.line_to(w, centerY);
  mgraphics.stroke();
}
