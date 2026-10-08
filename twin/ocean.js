/* Depth-driven light and surface effects for the mounted digital twin. */
'use strict';

const TwinOcean = {
  colorAtDepth(depth, look) {
    const stops = look.color_stops;
    const d = Math.max(0, Math.min(1, depth));
    for (let i = 1; i < stops.length; i++) {
      const right = stops[i];
      if (d > right.depth_norm) continue;
      const left = stops[i - 1];
      const t = (d - left.depth_norm) / (right.depth_norm - left.depth_norm);
      return left.rgb.map((value, channel) => value + (right.rgb[channel] - value) * t);
    }
    return stops[stops.length - 1].rgb.slice();
  },

  backgroundColor(stripX, stripY, depth, gridEnabled, look, stripLengthMm) {
    const d = Math.max(0, Math.min(1, depth));
    const u = ((stripX / stripLengthMm) % 1 + 1) % 1;
    const v = 0.5 - stripY / stripLengthMm;
    const wave = 0.5 + 0.5 * Math.sin(u * Math.PI * 10 + Math.sin(stripY / 9));
    const variation = (wave - 0.5) * 2;
    let rgb = this.colorAtDepth(d, look).map((value, channel) => value + variation * look.texture_amplitude_rgb[channel]);
    const vertical = Math.max(0, Math.min(1, v));
    const verticalGain = look.vertical_gradient_gain;
    const verticalLight = 1 + (0.5 - vertical) * verticalGain;
    rgb = rgb.map(value => value * verticalLight);

    const band = look.surface_band;
    const bandFade = Math.max(0, Math.min(1, 1 - d / band.fade_depth_norm));
    const sky = Math.max(0, Math.min(1, (band.threshold_v - v) / band.transition_v)) * bandFade;
    rgb = rgb.map((value, channel) => value + (band.rgb[channel] - value) * sky);

    const lens = look.snell_window;
    const depthFade = Math.max(0, Math.min(1, (lens.depth_fade_norm - d) / lens.depth_fade_norm));
    const window = depthFade * Math.max(0, Math.min(1, (lens.v_start - v) / lens.v_span)) * lens.strength;
    rgb = rgb.map((value, channel) => value + (lens.rgb[channel] - value) * window);

    if (gridEnabled) {
      const gridStep = stripLengthMm / 18;
      const longitude = Math.abs(stripX / gridStep - Math.round(stripX / gridStep));
      const latitude = Math.abs(stripY / gridStep - Math.round(stripY / gridStep));
      const amount = Math.max(Math.max(0, Math.min(1, (0.022 - longitude) / 0.022)),
        Math.max(0, Math.min(1, (0.022 - latitude) / 0.022))) * 0.58;
      rgb = rgb.map(value => value * (1 + amount * look.grid_gain));
    }

    const meridian = Math.min(u, 1 - u);
    if (meridian < 0.008) {
      const amount = (1 - meridian / 0.008) * look.meridian_gain;
      rgb = [rgb[0] * (1 - amount * 0.2), rgb[1] * (1 + amount), rgb[2] * (1 + amount * 0.4)];
    }
    return rgb;
  }
};

if (typeof module !== 'undefined') module.exports = TwinOcean;
