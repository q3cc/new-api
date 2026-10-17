/*!
 * Optical model (rounded-rect SDF, circle-map lens refraction, 7-path
 * chromatic dispersion, directional edge highlight) adapted from
 * liquid-glass-webgl, Copyright 2025 Liquid Glass WebGL Port Contributors,
 * licensed under the GNU Affero General Public License v3.0.
 * https://github.com/martin65536/liquid-glass-webgl/tree/0b90f9fc1cea8c7e59825f9aff1cbb96674b5b80
 * Original Android optical model: Kyant0/AndroidLiquidGlass.
 * License text: /licenses/liquid-glass-webgl.txt
 * Modified for New API: DOM-aligned wallpaper sampling in CSS pixels, in-shader
 * 3x3 blur, hero scrim and pointer-driven highlight angle. No upstream UI or
 * application runtime is used.
 */
export const GLASS_VERTEX_SHADER = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`

export const GLASS_FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D uWallpaper;
uniform vec2 uSize;
uniform vec2 uOrigin;
uniform vec4 uImageRect;
uniform vec2 uHero;
uniform float uDpr;
uniform float uRadius;
uniform float uBlur;
uniform vec4 uLens;      // refraction height, refraction amount, dispersion, depth effect
uniform vec4 uLook;      // saturation, highlight alpha, highlight width, inner shadow
uniform float uHiAngle;
uniform vec4 uTint;
uniform vec4 uSurface;

float sdRoundedRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - (halfSize - vec2(radius));
  return length(max(q, 0.0)) - radius + min(max(q.x, q.y), 0.0);
}
vec2 gradRoundedRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - (halfSize - vec2(radius));
  if (q.x >= 0.0 || q.y >= 0.0) {
    vec2 v = max(q, vec2(0.0));
    return sign(p) * v / max(length(v), 0.00001);
  }
  float x = step(q.y, q.x);
  return sign(p) * vec2(x, 1.0 - x);
}
float circleMap(float x) { return 1.0 - sqrt(max(0.0, 1.0 - x * x)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 blendHue(vec3 dst, vec3 src) {
  vec3 dh = rgb2hsv(dst), sh = rgb2hsv(src);
  return hsv2rgb(vec3(sh.x, dh.y, dh.z));
}
vec3 backdrop(vec2 p) {
  vec2 uv = (p - uImageRect.xy) / uImageRect.zw;
  vec3 color = texture2D(uWallpaper, clamp(uv, 0.0, 1.0)).rgb;
  // Match the hero's dark scrim, including its scroll position.
  float y = clamp((p.y - uHero.x) / uHero.y, 0.0, 1.0);
  float shade = y < 0.35 ? mix(0.18, 0.14, y / 0.35)
    : mix(0.14, 0.60, (y - 0.35) / 0.65);
  return mix(color, vec3(6.0, 13.0, 23.0) / 255.0, shade);
}
vec3 frosted(vec2 p) {
  // Fixed 3x3 Gaussian kernel: bounded work on WebGL 1 mobile GPUs.
  vec3 color = backdrop(p) * 4.0;
  color += (backdrop(p + vec2(uBlur, 0.0)) + backdrop(p - vec2(uBlur, 0.0))
    + backdrop(p + vec2(0.0, uBlur)) + backdrop(p - vec2(0.0, uBlur))) * 2.0;
  color += backdrop(p + vec2(uBlur)) + backdrop(p - vec2(uBlur))
    + backdrop(p + vec2(uBlur, -uBlur)) + backdrop(p + vec2(-uBlur, uBlur));
  return color / 16.0;
}
void main() {
  vec2 local = vec2(gl_FragCoord.x / uDpr, uSize.y - gl_FragCoord.y / uDpr);
  vec2 halfSize = uSize * 0.5;
  vec2 coord = local - halfSize;
  float radius = min(uRadius, min(halfSize.x, halfSize.y));
  float sd = sdRoundedRect(coord, halfSize, radius);
  float edgeAlpha = 1.0 - smoothstep(-0.5 / uDpr, 0.5 / uDpr, sd);
  if (edgeAlpha <= 0.001) discard;
  vec2 base = uOrigin + local;
  vec3 color = frosted(base);

  // Lens refraction: the circle-map profile is steep at the rim and flattens
  // towards the interior, so the backdrop bulges exactly along the edge.
  float refractionHeight = uLens.x;
  if (refractionHeight > 0.5 && -sd < refractionHeight) {
    float sdClamped = min(sd, 0.0);
    float d = circleMap(1.0 - (-sdClamped) / refractionHeight) * uLens.y;
    float gradRadius = min(radius * 1.5, min(halfSize.x, halfSize.y));
    vec2 grad = gradRoundedRect(coord, halfSize, gradRadius);
    if (uLens.w > 0.5) {
      float dirLen = length(coord);
      if (dirLen > 0.000001) {
        vec2 gradSum = grad + coord / dirLen;
        float sumLen = length(gradSum);
        if (sumLen > 0.000001) grad = gradSum / sumLen;
      }
    }
    vec2 offset = d * grad;
    if (uLens.z > 0.001) {
      // Dispersion grows with the product of the normalised coordinates, so
      // it is strongest in the corners and absent along the centre lines.
      float di = (coord.x * coord.y) / max(halfSize.x * halfSize.y, 0.0001);
      vec2 dOff = offset * di * uLens.z;
      vec3 sRed = frosted(base + offset + dOff);
      vec3 sOrange = frosted(base + offset + dOff * (2.0 / 3.0));
      vec3 sYellow = frosted(base + offset + dOff * (1.0 / 3.0));
      vec3 sGreen = frosted(base + offset);
      vec3 sCyan = frosted(base + offset - dOff * (1.0 / 3.0));
      vec3 sBlue = frosted(base + offset - dOff * (2.0 / 3.0));
      vec3 sPurple = frosted(base + offset - dOff);
      vec3 disp = vec3(0.0);
      disp.r += sRed.r / 3.5;
      disp.r += sOrange.r / 3.5; disp.g += sOrange.g / 7.0;
      disp.r += sYellow.r / 3.5; disp.g += sYellow.g / 3.5;
      disp.g += sGreen.g / 3.5;
      disp.g += sCyan.g / 3.5; disp.b += sCyan.b / 3.0;
      disp.b += sBlue.b / 3.0;
      disp.r += sPurple.r / 7.0; disp.b += sPurple.b / 3.0;
      color = mix(sGreen, disp, clamp(uLens.z, 0.0, 1.0));
    } else {
      color = frosted(base + offset);
    }
  }

  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, uLook.x);
  if (uTint.a > 0.001) {
    color = mix(color, blendHue(color, uTint.rgb), uTint.a);
    color = mix(color, uTint.rgb, 0.75 * uTint.a);
  }
  if (uSurface.a > 0.001) color = mix(color, uSurface.rgb, uSurface.a);

  // Thin rim: bright where the light enters, darkened into a bevel opposite.
  if (uLook.y > 0.001) {
    float band = 1.0 - clamp((-sd) / max(uLook.z, 0.75 / uDpr), 0.0, 1.0);
    band = band * band * (3.0 - 2.0 * band);
    vec2 normal = normalize(gradRoundedRect(coord, halfSize, radius) + vec2(0.000001));
    vec2 light = vec2(cos(uHiAngle), sin(uHiAngle));
    float facing = clamp(dot(normal, light) * 0.5 + 0.5, 0.0, 1.0);
    float alpha = band * uLook.y;
    color = mix(color, vec3(1.0), clamp(alpha * facing, 0.0, 1.0));
    color *= 1.0 - clamp(alpha * 0.45 * (1.0 - facing), 0.0, 0.6);
  }
  color *= 1.0 - uLook.w * (1.0 - smoothstep(0.0, max(refractionHeight, 1.0) * 1.4, -sd));
  gl_FragColor = vec4(color * edgeAlpha, edgeAlpha);
}
`
