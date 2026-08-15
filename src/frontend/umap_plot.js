// UMAP + heatmap viewer for Max jsui
// Messages:
//   umap <x1> <y1> <x2> <y2> ...
//   heatmap <v1> <v2> ... (optional, one per point)
//   groups <g1> <g2> ... (optional, one per point)
//   descmap <x1> <y1> <x2> <y2> ... descriptor-space map in [0,1]
// Backward-compatible:
//   pca <x1> <y1> <x2> <y2> ...

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var umap_data = [];
var heat_data = [];
var group_data = [];
var descmap_data = [];
var highlight_idx = -1;
var view_mode = "group"; // group | prob | combined
var prob_threshold = 0.1; // fade points under this probability
var draw_idx_cache = [];
var draw_idx_dirty = true;
var show_manifold = 1; // 1:on, 0:off
var manifold_res_x = 96;
var manifold_res_y = 96;
var manifold_grid = [];
var manifold_dirty = true;
var stability_k = 8;

function rebuildDrawOrder(n) {
  draw_idx_cache = [];
  if (n <= 0) return;

  // O(n) bucketed ordering (low -> high probability).
  var bins_count = 16;
  var bins = [];
  for (var b = 0; b < bins_count; b++) bins.push([]);

  for (var i = 0; i < n; i++) {
    var hv = (heat_data && heat_data.length > i) ? heat_data[i] : 0.0;
    if (hv < 0) hv = 0;
    if (hv > 1) hv = 1;
    var bi = Math.floor(hv * (bins_count - 1));
    bins[bi].push(i);
  }

  for (var k = 0; k < bins_count; k++) {
    var bk = bins[k];
    for (var j = 0; j < bk.length; j++) draw_idx_cache.push(bk[j]);
  }

  draw_idx_dirty = false;
}

function umap() {
  umap_data = arrayfromargs(arguments);
  draw_idx_dirty = true;
  mgraphics.redraw();
}

// Legacy alias
function pca() {
  umap_data = arrayfromargs(arguments);
  draw_idx_dirty = true;
  mgraphics.redraw();
}

function heatmap() {
  heat_data = arrayfromargs(arguments);
  draw_idx_dirty = true;
  mgraphics.redraw();
}

function groups() {
  group_data = arrayfromargs(arguments);
  mgraphics.redraw();
}

function descmap() {
  descmap_data = arrayfromargs(arguments);
  manifold_dirty = true;
  mgraphics.redraw();
}

function mode() {
  if (arguments.length < 1) return;
  var m = ("" + arguments[0]).toLowerCase();
  if (m === "group" || m === "prob" || m === "combined") {
    view_mode = m;
    mgraphics.redraw();
  }
}

function threshold() {
  if (arguments.length < 1) return;
  var v = parseFloat(arguments[0]);
  if (isNaN(v)) return;
  if (v < 0) v = 0;
  if (v > 1) v = 1;
  prob_threshold = v;
  mgraphics.redraw();
}

function highlight() {
  if (arguments.length < 1) return;
  highlight_idx = arguments[0];
  mgraphics.redraw();
}

function clear() {
  umap_data = [];
  heat_data = [];
  group_data = [];
  descmap_data = [];
  highlight_idx = -1;
  draw_idx_cache = [];
  draw_idx_dirty = true;
  manifold_grid = [];
  manifold_dirty = true;
  mgraphics.redraw();
}

function manifold() {
  if (arguments.length < 1) return;
  show_manifold = parseInt(arguments[0], 10) ? 1 : 0;
  mgraphics.redraw();
}

function manifold_res_set() {
  if (arguments.length < 1) return;
  var r = parseInt(arguments[0], 10);
  if (isNaN(r)) return;
  if (r < 16) r = 16;
  if (r > 192) r = 192;
  manifold_res_x = r;
  manifold_res_y = r;
  manifold_dirty = true;
  mgraphics.redraw();
}

function manifold_k_set() {
  if (arguments.length < 1) return;
  var k = parseInt(arguments[0], 10);
  if (isNaN(k)) return;
  if (k < 1) k = 1;
  if (k > 64) k = 64;
  stability_k = k;
  manifold_dirty = true;
  mgraphics.redraw();
}

function groupColor(idx) {
  // Simple neutral palette.
  var palette = [
    [150 / 255, 150 / 255, 150 / 255],
    [135 / 255, 135 / 255, 135 / 255],
    [120 / 255, 120 / 255, 120 / 255],
    [105 / 255, 105 / 255, 105 / 255],
    [90 / 255, 90 / 255, 90 / 255]
  ];
  var g = Math.max(0, Math.floor(idx || 0));
  return palette[g % palette.length];
}

function gaussianBlurInPlace(grid, rx, ry) {
  function blurPass(src, dst) {
    var x0, y0, xx, yy, sum, cnt;
    for (y0 = 0; y0 < ry; y0++) {
      for (x0 = 0; x0 < rx; x0++) {
        sum = 0.0;
        cnt = 0;
        for (yy = y0 - 1; yy <= y0 + 1; yy++) {
          if (yy < 0 || yy >= ry) continue;
          for (xx = x0 - 1; xx <= x0 + 1; xx++) {
            if (xx < 0 || xx >= rx) continue;
            sum += src[yy * rx + xx];
            cnt += 1;
          }
        }
        dst[y0 * rx + x0] = sum / Math.max(1, cnt);
      }
    }
  }

  var tmp = [];
  var tmp2 = [];
  var tmp3 = [];
  var tmp4 = [];
  var tmp5 = [];
  for (var i = 0; i < rx * ry; i++) {
    tmp.push(0.0);
    tmp2.push(0.0);
    tmp3.push(0.0);
    tmp4.push(0.0);
    tmp5.push(0.0);
  }
  blurPass(grid, tmp);
  // Six passes for very smooth manifold transitions.
  blurPass(tmp, tmp2);
  blurPass(tmp2, tmp3);
  blurPass(tmp3, tmp4);
  blurPass(tmp4, tmp5);
  blurPass(tmp5, grid);
}

function normalizeGridInPlace(grid) {
  var maxv = 0.0;
  for (var i = 0; i < grid.length; i++) if (grid[i] > maxv) maxv = grid[i];
  if (maxv > 0) {
    for (var j = 0; j < grid.length; j++) grid[j] /= maxv;
  }
}

function buildDescriptorGrids() {
  var rx = manifold_res_x;
  var ry = manifold_res_y;
  var cells = rx * ry;
  var manifold = [];
  for (var i = 0; i < cells; i++) manifold.push(0.0);

  var n = Math.floor(descmap_data.length / 2);
  if (n <= 0) {
    manifold_grid = manifold;
    manifold_dirty = false;
    return;
  }

  var kuse = stability_k;
  if (kuse > n) kuse = n;

  // For each cell center, compute K-nearest desc points.
  var knn_idx = [];
  for (var c = 0; c < cells * kuse; c++) knn_idx.push(-1);

  for (var gy = 0; gy < ry; gy++) {
    for (var gx = 0; gx < rx; gx++) {
      var cell = gy * rx + gx;
      var cx = (gx + 0.5) / rx;
      var cy = 1.0 - (gy + 0.5) / ry;

      var best_d = [];
      var best_i = [];
      for (var k = 0; k < kuse; k++) {
        best_d.push(1e30);
        best_i.push(-1);
      }

      for (var p = 0; p < n; p++) {
        var px = descmap_data[p * 2];
        var py = descmap_data[p * 2 + 1];
        var dx = px - cx;
        var dy = py - cy;
        var d2 = dx * dx + dy * dy;

        if (d2 >= best_d[kuse - 1]) continue;
        var pos = kuse - 1;
        while (pos > 0 && d2 < best_d[pos - 1]) {
          best_d[pos] = best_d[pos - 1];
          best_i[pos] = best_i[pos - 1];
          pos--;
        }
        best_d[pos] = d2;
        best_i[pos] = p;
      }

      for (var kk = 0; kk < kuse; kk++) {
        knn_idx[cell * kuse + kk] = best_i[kk];
      }
    }
  }

  function overlap(a_cell, b_cell) {
    var inter = 0;
    for (var ka = 0; ka < kuse; ka++) {
      var ai = knn_idx[a_cell * kuse + ka];
      if (ai < 0) continue;
      for (var kb = 0; kb < kuse; kb++) {
        if (ai === knn_idx[b_cell * kuse + kb]) {
          inter++;
          break;
        }
      }
    }
    return inter / Math.max(1, kuse);
  }

  // Local stability = average KNN overlap with right/down neighbors.
  for (var y = 0; y < ry; y++) {
    for (var x = 0; x < rx; x++) {
      var cidx = y * rx + x;
      var acc = 0.0;
      var cnt = 0;
      if (x + 1 < rx) {
        acc += overlap(cidx, y * rx + (x + 1));
        cnt++;
      }
      if (x - 1 >= 0) {
        acc += overlap(cidx, y * rx + (x - 1));
        cnt++;
      }
      if (y + 1 < ry) {
        acc += overlap(cidx, (y + 1) * rx + x);
        cnt++;
      }
      if (y - 1 >= 0) {
        acc += overlap(cidx, (y - 1) * rx + x);
        cnt++;
      }
      manifold[cidx] = cnt > 0 ? (acc / cnt) : 0.0;
    }
  }

  // Mild smoothing for readable regions.
  gaussianBlurInPlace(manifold, rx, ry);
  normalizeGridInPlace(manifold);

  manifold_grid = manifold;
  manifold_dirty = false;
}

function paint() {
  var w = box.rect[2] - box.rect[0];
  var h = box.rect[3] - box.rect[1];

  // background #1E1F24
  mgraphics.set_source_rgba(30 / 255, 31 / 255, 36 / 255, 1.0);
  mgraphics.rectangle(0, 0, w, h);
  mgraphics.fill();

  if (!umap_data || umap_data.length < 2) return;

  var n = Math.floor(umap_data.length / 2);
  if (n <= 0) return;

  var minx = umap_data[0],
    maxx = umap_data[0];
  var miny = umap_data[1],
    maxy = umap_data[1];
  for (var i = 0; i < n; i++) {
    var x = umap_data[i * 2];
    var y = umap_data[i * 2 + 1];
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  var rangex = maxx - minx;
  if (rangex === 0) rangex = 1.0;
  var rangey = maxy - miny;
  if (rangey === 0) rangey = 1.0;

  var pad = 0;
  var radius = 2.2;

  if (show_manifold) {
    var has_descmap = descmap_data && descmap_data.length >= 2;
    if (has_descmap) {
      if (
        manifold_dirty ||
        !manifold_grid ||
        manifold_grid.length !== manifold_res_x * manifold_res_y
      ) {
        buildDescriptorGrids();
      }
    } else {
      // No descriptor map => no manifold background.
      manifold_grid = [];
      manifold_dirty = false;
    }

    var rx = manifold_res_x;
    var ry = manifold_res_y;
    var cellw = w / rx;
    var cellh = h / ry;
    var gx, gy, gv, a;
    for (gy = 0; gy < ry; gy++) {
      for (gx = 0; gx < rx; gx++) {
        gv = manifold_grid[gy * rx + gx];
        if (gv > 0.0) {
          // Stability map: increase contrast between stable basins and boundaries.
          a = 0.04 + 0.62 * Math.pow(gv, 1.45);
          var c = 0.06 + 0.62 * Math.pow(gv, 1.55);
          var base_r = c;
          var base_g = c + 0.01;
          var base_b = c + 0.035;
          // Make warm/yellow much pickier: only very stable zones get tinted.
          var tw = (gv - 0.86) / 0.14;
          if (tw < 0.0) tw = 0.0;
          if (tw > 1.0) tw = 1.0;
          var t = Math.pow(tw, 2.80);
          var warm_r = 1.0, warm_g = 0.70, warm_b = 0.25;
          var rcol = base_r * (1.0 - t) + warm_r * t;
          var gcol = base_g * (1.0 - t) + warm_g * t;
          var bcol = base_b * (1.0 - t) + warm_b * t;
          if (gcol > 1.0) gcol = 1.0;
          if (bcol > 1.0) bcol = 1.0;
          // Keep map in the background.
          var a_soft = 0.003 + 0.28 * Math.pow(a, 1.30);
          mgraphics.set_source_rgba(rcol, gcol, bcol, a_soft);
          // Uniform square rendering (no cloud blobs).
          // Slight overlap removes visible grid seams.
          mgraphics.rectangle(gx * cellw, gy * cellh, cellw + 0.8, cellh + 0.8);
          mgraphics.fill();
        }
      }
    }

  }

  // 1) O(n) bucketed draw order
  // 2) Rebuild only when heatmap/umap changes
  if (draw_idx_dirty || !draw_idx_cache || draw_idx_cache.length !== n) {
    rebuildDrawOrder(n);
  }

  for (var jj = 0; jj < n; jj++) {
    var j = draw_idx_cache[jj];
    var px = umap_data[j * 2];
    var py = umap_data[j * 2 + 1];

    var nx = (px - minx) / rangex;
    var ny = (py - miny) / rangey;

    var sx = nx * w;
    var sy = (1.0 - ny) * h;

    var hv = 0.5;
    if (heat_data && heat_data.length > j) {
      hv = heat_data[j];
      if (hv < 0) hv = 0;
      if (hv > 1) hv = 1;
    }

    var alpha = 1.0;
    if (hv < prob_threshold) {
      alpha = 0.65 + 0.35 * (hv / Math.max(0.0001, prob_threshold));
    }

    var gid = 0;
    if (group_data && group_data.length > j) gid = group_data[j];
    var base = groupColor(gid);
    var r = base[0],
      g = base[1],
      b = base[2];

    if (view_mode === "prob") {
      r = 0.25 + 0.75 * hv;
      g = 0.20 + 0.55 * hv;
      b = 0.12 + 0.18 * hv;
    } else if (view_mode === "combined") {
      var t = 0.6 * hv;
      r = base[0] * (1.0 - t) + 1.0 * t;
      g = base[1] * (1.0 - t) + (220 / 255) * t;
      b = base[2] * (1.0 - t) + (110 / 255) * t;
    } else {
      var tg = 0.5 * hv;
      r = base[0] * (1.0 - tg) + 1.0 * tg;
      g = base[1] * (1.0 - tg) + (210 / 255) * tg;
      b = base[2] * (1.0 - tg) + (95 / 255) * tg;
    }

    if (hv < prob_threshold) {
      var u = hv / Math.max(0.0001, prob_threshold);
      var gray = 0.26 + 0.14 * u;
      var m = 0.45 * (1.0 - u);
      r = r * (1.0 - m) + gray * m;
      g = g * (1.0 - m) + gray * m;
      b = b * (1.0 - m) + (gray + 0.02) * m;
    }

    var pr = radius + 2.1 * hv;
    if (pr < radius) pr = radius;

    // Subtle dark halo so grains read as foreground over the manifold.
    mgraphics.set_source_rgba(0.0, 0.0, 0.0, 0.22 * alpha);
    mgraphics.arc(sx, sy, pr + 1.2, 0, Math.PI * 2);
    mgraphics.fill();

    mgraphics.set_source_rgba(r, g, b, alpha);
    mgraphics.arc(sx, sy, pr, 0, Math.PI * 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.0, 0.0, 0.0, 0.35 * alpha);
    mgraphics.set_line_width(0.6);
    mgraphics.arc(sx, sy, pr, 0, Math.PI * 2);
    mgraphics.stroke();

    if (view_mode !== "prob") {
      var rr = pr + 0.9;
      var ring_alpha = 0.10 + 0.55 * hv;
      mgraphics.set_source_rgba(1.0, 0.70, 0.25, ring_alpha);
      mgraphics.set_line_width(0.7 + 1.2 * hv);
      mgraphics.arc(sx, sy, rr, 0, Math.PI * 2);
      mgraphics.stroke();
    }
  }

  if (highlight_idx >= 0 && highlight_idx < n) {
    var hx = umap_data[highlight_idx * 2];
    var hy = umap_data[highlight_idx * 2 + 1];
    var hnx = (hx - minx) / rangex;
    var hny = (hy - miny) / rangey;
    var hsx = hnx * w;
    var hsy = (1.0 - hny) * h;

    // Selected grain: plain yellow fill.
    mgraphics.set_source_rgba(1.0, 0.70, 0.25, 1.0);
    mgraphics.arc(hsx, hsy, radius + 3.4, 0, Math.PI * 2);
    mgraphics.fill();
  }
}
