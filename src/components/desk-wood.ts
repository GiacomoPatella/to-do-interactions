/* The desk's wood: oiled black walnut, drawn in WebGL2, no images.

   Two passes, on purpose:
   1. BAKE — the expensive part. The material (boards, rings, pores,
      sapwood, colour drift) is evaluated once per device pixel, 4x
      supersampled, into two RGBA8 textures: albedo + sheen, and
      height / grain angle / roughness / specular mask. Runs once, and
      again only when the width or the pixel ratio changes.
   2. LIGHT — cheap, ~2ms. Reads those textures, derives the normal from
      the height field, and shades with the current light. The time of
      day only ever re-runs this pass: it moves the light, not the wood.
      The light itself comes from skyAt() in day.ts.

   Nothing renders per frame. The canvas is fixed behind the page, so
   scrolling never touches WebGL.

   Why walnut, and why oiled: walnut's flowing, domain-warped figure was
   the most convincing of the three prototypes (oak, walnut, sapele —
   see public/prototypes/wood/). It started out lacquered, and the
   gloss is what gave it away as a render: a sharp reflection of the
   window sliding over the wood. Oil soaks into the wood instead of
   sitting on it, so the finish here follows the surface (low coatFill),
   is rough, and its glow along the fibre is broad and dim. Matte
   wood reads lighter than glossy at the same exposure, so the
   exposure comes down to keep it walnut rather than teak. */

import type { Sky } from "./day";

const COMMON = `#version 300 es
precision highp float;
precision highp int;
#define PI 3.14159265

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
uint h3u(ivec3 p) {
  return pcg(uint(p.x + 1048576) + pcg(uint(p.y + 1048576) + pcg(uint(p.z + 1048576))));
}
float h1(ivec3 p) { return float(h3u(p)) * (1.0 / 4294967295.0); }
float hashI(int a, int b) { return h1(ivec3(a, b, 7919)); }

vec3 g3(ivec3 p) {
  uint h = h3u(p);
  float z = float(h & 1023u) / 1023.0 * 2.0 - 1.0;
  float t = float((h >> 10u) & 1023u) / 1023.0 * 6.2831853;
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(t), r * sin(t), z);
}
// 3D gradient noise, roughly [-1, 1].
float gn(vec3 x) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(g3(i), f);
  float b = dot(g3(i + ivec3(1,0,0)), f - vec3(1,0,0));
  float c = dot(g3(i + ivec3(0,1,0)), f - vec3(0,1,0));
  float d = dot(g3(i + ivec3(1,1,0)), f - vec3(1,1,0));
  float e = dot(g3(i + ivec3(0,0,1)), f - vec3(0,0,1));
  float f2 = dot(g3(i + ivec3(1,0,1)), f - vec3(1,0,1));
  float g = dot(g3(i + ivec3(0,1,1)), f - vec3(0,1,1));
  float h = dot(g3(i + ivec3(1,1,1)), f - vec3(1,1,1));
  return 1.6 * mix(mix(mix(a,b,u.x), mix(c,d,u.x), u.y),
                   mix(mix(e,f2,u.x), mix(g,h,u.x), u.y), u.z);
}
float fbm(vec3 x, int oct) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 8; k++) {
    if (k >= oct) break;
    s += a * gn(x);
    x = x * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
vec3 s2l(vec3 c) { return pow(c, vec3(2.2)); }
vec3 hex(float r, float g, float b) { return s2l(vec3(r, g, b) / 255.0); }
vec3 hex(int r, int g, int b) { return hex(float(r), float(g), float(b)); }

struct Mat {
  vec3 albedo;   // linear
  float height;  // 0..1
  float angle;   // fibre direction in screen space, radians (0 = along x)
  float rough;   // finish roughness 0..1
  float spec;    // specular mask: 0 in the glue lines
  float sheen;   // chatoyance strength 0..1
};
`;

/* A walnut tabletop: three or four wide boards glued edge to edge.

   Walnut's figure is less geometric than oak's, so the ring coordinates
   go through two levels of domain warping (fBm fed back into its own
   input) before the ring function — the flowing, slightly wild figure
   walnut boards have. It's semi-ring-porous: pores are small and spread
   through the ring rather than banded, showing as fine dark scratches
   along the grain, and earlywood/latewood contrast is low. The outer
   rings are sapwood — pale cream — so a board cut far from the pith
   carries a light streak along one edge, which is the most recognisable
   thing about a real walnut top. Colour also drifts through purple-grey
   and warm tan in long streaks. */
const MATERIAL = `
Mat material(vec2 p) {
  Mat m;
  float y = p.y + 70.0;
  const float B = 300.0;
  int k = int(floor(y / B));
  float b0 = float(k) * B + 90.0 * (hashI(k, 9) - 0.5);
  if (y < b0) { k -= 1; b0 = float(k) * B + 90.0 * (hashI(k, 9) - 0.5); }
  float b1 = float(k + 1) * B + 90.0 * (hashI(k + 1, 9) - 0.5);
  if (y >= b1) { k += 1; b0 = b1; b1 = float(k + 1) * B + 90.0 * (hashI(k + 1, 9) - 0.5); }
  float W = b1 - b0;
  float v = y - b0;
  int pid = k * 13 + 7000;
  float hA = hashI(pid, 4), hB = hashI(pid, 5), hC = hashI(pid, 6), hD = hashI(pid, 7);
  vec3 sd = vec3(float(pid) * 5.71, float(pid) * 2.33, float(pid) * 0.77);
  float u = p.x + 4000.0 * hA;

  // Two levels of domain warp (fBm of fBm) on the board's coordinates.
  vec3 q = vec3(u * 0.0022, v * 0.0085, 0.0) + sd;
  vec2 w1 = vec2(fbm(q, 4), fbm(q + vec3(5.2, 1.3, 2.8), 4));
  vec3 q2 = q + vec3(w1 * 0.9, 0.0);
  vec2 w2 = vec2(fbm(q2 + vec3(1.7, 9.2, 0.0), 4), fbm(q2 + vec3(8.3, 2.8, 4.1), 4));

  float pithV = W * (0.5 + (hB - 0.5) * 0.9);
  float d = max(8.0 + 55.0 * hC + (hD - 0.5) * 0.09 * u + 16.0 * w2.y, 2.0);
  float dv = v - pithV + 11.0 * w2.x;
  float r = sqrt(dv * dv + d * d);

  float ringS = 6.0 + 4.0 * hD;
  float n = r / ringS + 1.2 * gn(vec3(r * 0.012, 0.5, sd.z));
  n += 0.45 * gn(vec3(n * 0.55, 3.5, sd.x));
  // Fibre jitter: ring boundaries ragged along the grain rather than
  // smooth iso-lines. Smooth boundaries at a fixed contrast are what
  // read as a contour map.
  n += 0.16 * gn(vec3(u * 0.035, r * 0.6, 71.0) + sd)
     + 0.07 * gn(vec3(u * 0.11, r * 1.4, 73.0) + sd);
  float f = fract(n);
  int ring = int(floor(n));
  float lw = 0.3 + 0.3 * hashI(ring + 300, pid);
  float late = smoothstep(1.0 - lw - 0.35, 1.0 - lw + 0.1, f);
  // The step back to earlywood, softened over the last few percent of
  // the ring instead of a hard cut.
  late *= 1.0 - smoothstep(0.9, 1.0, f);
  float edge = smoothstep(0.8, 0.97, f) * (1.0 - smoothstep(0.97, 1.0, f)); // the thin dark line closing each ring
  // Each year grew differently: contrast varies ring to ring, so no two
  // neighbouring bands match and the eye stops reading a pattern.
  float yr = hashI(ring + 500, pid);
  float lateAmt = 0.18 + 0.45 * yr * yr;
  float edgeAmt = 0.08 + 0.22 * hashI(ring + 700, pid);

  // Heartwood colour, streaky.
  vec3 cE = hex(96, 68, 50), cL = hex(70, 49, 37);
  vec3 col = mix(cE, cL, late * lateAmt);
  col = mix(col, hex(48, 33, 25), edge * edgeAmt);
  float streak = fbm(vec3(u * 0.0012, r * 0.03, 11.0) + sd, 3);
  col = mix(col, hex(84, 70, 68), smoothstep(0.05, 0.4, streak) * 0.25);  // purple-grey
  col = mix(col, hex(116, 82, 56), smoothstep(-0.05, -0.4, streak) * 0.35); // warm tan
  float str = gn(vec3(u * 0.02, r * 2.0, 21.0) + sd) + 0.5 * gn(vec3(u * 0.06, r * 4.5, 31.0) + sd);
  col *= 1.0 + 0.13 * str + 0.06 * gn(vec3(u * 0.004, r * 0.35, 61.0) + sd);

  // Sapwood: the outer rings, pale, with a blurred boundary.
  float sapR = 230.0 + 420.0 * hashI(pid, 8);
  float sap = 0.85 * smoothstep(sapR - 16.0, sapR + 30.0, r + 8.0 * gn(vec3(u * 0.01, v * 0.05, 41.0) + sd));
  vec3 sapCol = mix(hex(178, 150, 112), hex(156, 128, 94), late);
  col = mix(col, sapCol * (1.0 + 0.05 * str), sap);

  // Diffuse pores: fine dark scratches along the grain, everywhere.
  float pn = gn(vec3(u * 0.05, r * 1.9, 51.0) + sd);
  float pores = smoothstep(0.42, 0.68, pn);
  col = mix(col, col * 0.55, pores * 0.7);

  float e = min(v, W - v);
  float glue = smoothstep(0.0, 0.8, e);
  m.albedo = mix(col * 0.6, col, glue);
  m.height = (0.6 + 0.03 * late - 0.15 * pores) * glue;
  m.angle = 0.06 * w2.x;
  // Oil: rough, a weak reflection that the open pores break up further,
  // and only a faint glow along the fibre.
  m.rough = 0.68;
  m.spec = 0.5 * (1.0 - 0.5 * pores) * glue;
  m.sheen = 0.14;
  return m;
}
`;

const BAKE_MAIN = `
uniform vec2 uRes;
uniform float uDpr;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 alb = vec3(0); float hgt = 0.0, rgh = 0.0, spc = 0.0, shn = 0.0;
  vec2 dir = vec2(0);
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k & 1), float(k >> 1)) * 0.5 - 0.25;
    Mat m = material((fc + o) / uDpr);
    alb += m.albedo; hgt += m.height; rgh += m.rough; spc += m.spec; shn += m.sheen;
    dir += vec2(cos(m.angle), sin(m.angle));
  }
  alb *= 0.25; hgt *= 0.25; rgh *= 0.25; spc *= 0.25; shn *= 0.25;
  float ang = atan(dir.y, dir.x);
  o0 = vec4(pow(alb, vec3(1.0 / 2.2)), shn);
  o1 = vec4(hgt, ang / PI * 0.5 + 0.5, rgh, spc);
}
`;

/* Window light plus a desk lamp. The lamp sits up and to the right of
   the page, so at night the light pools on the pad and falls away across
   the wood. */
const LIGHT_FS = `#version 300 es
precision highp float;
precision highp int;
#define PI 3.14159265
uniform sampler2D uT0;
uniform sampler2D uT1;
uniform vec2 uRes;
uniform float uDpr;
uniform vec3 uKeyDir;    // towards the light
uniform vec3 uKeyCol;    // colour * intensity
uniform float uKeyFall;  // how much the window light falls off across the desk
uniform vec3 uAmb;
uniform float uLampOn;
uniform vec3 uLampPos;   // CSS px, z = height above desk
uniform vec3 uLampCol;
uniform float uLampR;
uniform float uBump;
uniform float uCoatFill; // how much the finish levels the pores, for the coat normal
uniform float uSheenExp;
uniform vec3 uSheenTint;
uniform float uExposure;
uniform float uEnv;
out vec4 outColor;

// What the finish reflects: the window (a soft rectangle with a cross of
// glazing bars, centred on the key light's direction) and the lamp (a
// small disc), blurred and dimmed by roughness.
vec3 envRefl(vec3 R, float rough, vec3 L, vec3 Lc, vec3 lampDir, vec3 lampC) {
  vec3 e = vec3(0);
  float soft = 0.02 + rough * 0.9;
  if (dot(Lc, vec3(1)) > 0.0) {
    vec3 e1 = normalize(cross(L, vec3(0, 0, 1)) + vec3(1e-4, 0, 0));
    vec3 e2 = cross(e1, L);
    float z = dot(R, L);
    if (z > 0.05) {
      vec2 t = vec2(dot(R, e1), dot(R, e2)) / z;
      vec2 box = smoothstep(vec2(0.32, 0.5) + soft, vec2(0.32, 0.5) - soft, abs(t));
      float bars = 1.0 - (1.0 - smoothstep(0.0, 0.015 + soft, abs(t.x))) * 0.85
                       - (1.0 - smoothstep(0.0, 0.015 + soft, abs(t.y))) * 0.85;
      float norm = 1.0 / (1.0 + pow(soft / 0.25, 2.0));
      e += Lc * 0.35 * norm * box.x * box.y * clamp(bars, 0.0, 1.0);
    }
  }
  if (dot(lampC, vec3(1)) > 0.0) {
    float c = dot(R, lampDir);
    float normL = 0.0081 / (0.0081 + soft * soft);
    e += lampC * 1.2 * normL * smoothstep(cos(0.09 + soft), cos(0.07), c);
  }
  return e;
}

float H(ivec2 q) {
  q = clamp(q, ivec2(0), ivec2(uRes) - 1);
  return texelFetch(uT1, q, 0).r;
}
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float ggx(float nh, float a) {
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
float vis(float nl, float nv, float a) {
  float k = a * 0.5;
  return 0.25 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k));
}

vec3 shade(vec3 L, vec3 E, vec3 V, vec3 n, vec3 nc, vec3 T, vec3 alb,
           float rough, float spec, float sheen) {
  float nl = max(dot(n, L), 0.0);
  float ncl = max(dot(nc, L), 0.0);
  vec3 Hh = normalize(L + V);
  float a = max(rough * rough, 0.002);
  float nh = max(dot(nc, Hh), 0.0);
  float nv = max(dot(nc, V), 0.001);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
  float coat = ggx(nh, a) * vis(ncl, nv, a) * F * ncl * spec;
  // Kajiya-Kay style sheen along the fibre: chatoyance.
  float th = dot(T, Hh);
  float kk = pow(sqrt(max(0.0, 1.0 - th * th)), uSheenExp);
  vec3 sh = uSheenTint * alb * kk * sheen * nl;
  return E * (alb * nl * (1.0 - F) + vec3(coat) + sh);
}

void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 t0 = texelFetch(uT0, q, 0);
  vec4 t1 = texelFetch(uT1, q, 0);
  vec3 alb = pow(t0.rgb, vec3(2.2));
  float sheen = t0.a;
  float rough = t1.b;
  float spec = t1.a;
  float ang = (t1.g - 0.5) * 2.0 * PI;

  float hx = (H(q + ivec2(1, 0)) - H(q - ivec2(1, 0))) * 0.5 * uDpr;
  float hy = -(H(q + ivec2(0, 1)) - H(q - ivec2(0, 1))) * 0.5 * uDpr;
  vec3 n = normalize(vec3(-hx * uBump, -hy * uBump, 1.0));
  vec3 nc = normalize(mix(n, vec3(0, 0, 1), uCoatFill));
  vec3 T = vec3(cos(ang), sin(ang), 0.0);

  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 view = uRes / uDpr;
  vec3 P = vec3(p, 0.0);
  vec3 V = normalize(vec3(view * 0.5, 1400.0) - P);
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.6, t1.r));

  vec3 col = alb * uAmb * ao;
  col += uAmb * 0.35 * spec * 0.04;  // faint room reflection in the finish

  // Window light: directional, brighter on the side it comes from.
  if (dot(uKeyCol, vec3(1)) > 0.0) {
    vec2 ld = normalize(uKeyDir.xy + 1e-5);
    float along = dot((p - view * 0.5) / max(view.x, view.y), ld);
    float fall = mix(1.0 - uKeyFall, 1.0, smoothstep(-0.6, 0.6, along));
    col += shade(uKeyDir, uKeyCol * fall, V, n, nc, T, alb, rough, spec, sheen) * ao;
  }
  // Lamp: point light with a soft falloff.
  if (uLampOn > 0.5) {
    vec3 Lv = uLampPos - P;
    float d = length(Lv);
    vec3 L = Lv / d;
    float att = 1.0 / (1.0 + pow(d / uLampR, 2.0));
    col += shade(L, uLampCol * att, V, n, nc, T, alb, rough, spec, sheen) * ao;
  }
  // Reflections in the finish.
  {
    vec3 R = reflect(-V, nc);
    float nv = max(dot(nc, V), 0.0);
    float F = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
    vec3 Ll = normalize(uLampPos - P);
    float att = 1.0 / (1.0 + pow(length(uLampPos - P) / uLampR, 2.0));
    vec3 lc = uLampOn > 0.5 ? uLampCol * att * 4.0 : vec3(0);
    col += uEnv * F * spec * envRefl(R, rough, uKeyDir, uKeyCol, Ll, lc);
  }
  col = aces(col * uExposure);
  outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/* The finish. Lacquered walnut was coatFill 0.8, sheen exponent 26 and
   a full-strength reflection; oil is the opposite on all three. */
const FINISH = {
  bump: 1.8,
  coatFill: 0.25,
  sheenExp: 10,
  sheenTint: [0.9, 0.75, 0.6],
  exposure: 0.78,
  env: 0.3,
};

/* The desk lamp: warm, incandescent, a little above the desk. Its
   position is in viewport px, and the page's own lamplight in
   globals.css (.book-light) is centred on the same spot, so the wood and
   the paper agree about where the light is. */
const LAMP = {
  x: 0.8,
  y: 0.16,
  z: 380,
  rgb: [1.0, 0.76, 0.5],
  intensity: 3.2,
  radius: 520,
};

/* Draws the desk into `canvas` under `sky` and keeps it current. Returns
   a cleanup function and a relight for when the time of day moves. If
   WebGL2 is unavailable or the context is lost, the canvas simply never
   gets data-ready and the CSS fallback under it shows. */
export function startDesk(
  canvas: HTMLCanvasElement,
  initialSky: Sky,
): { stop: () => void; setSky: (sky: Sky) => void } {
  const none = { stop: () => {}, setSky: () => {} };
  let sky = initialSky;
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return none;
  const g = gl;

  function compile(type: number, src: string) {
    const s = g.createShader(type)!;
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
      throw new Error(g.getShaderInfoLog(s) ?? "shader compile failed");
    }
    return s;
  }
  function program(fs: string) {
    const p = g.createProgram()!;
    g.attachShader(p, compile(g.VERTEX_SHADER, VS));
    g.attachShader(p, compile(g.FRAGMENT_SHADER, fs));
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      throw new Error(g.getProgramInfoLog(p) ?? "program link failed");
    }
    return p;
  }

  let bakeProg: WebGLProgram, lightProg: WebGLProgram;
  try {
    bakeProg = program(COMMON + MATERIAL + BAKE_MAIN);
    lightProg = program(LIGHT_FS);
  } catch (err) {
    console.error(err);
    return none;
  }
  g.bindVertexArray(g.createVertexArray());

  let tex: WebGLTexture[] = [];
  let fbo: WebGLFramebuffer | null = null;
  let W = 0,
    H = 0,
    dpr = 1,
    bakedW = 0,
    bakedH = 0,
    bakedDpr = 0;

  function makeTex() {
    const t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, W, H, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
  }

  /* The canvas is sized in CSS px to what was baked, not stretched to the
     viewport, so a phone's URL bar sliding in and out (which changes
     innerHeight on every scroll) never re-bakes or rescales the wood. It
     only re-bakes when the width or the pixel ratio changes, or the
     viewport grows taller than what was baked. */
  function bake() {
    const cssW = innerWidth;
    const cssH = Math.max(innerHeight, screen.height || 0);
    dpr = devicePixelRatio || 1;
    let w = Math.round(cssW * dpr),
      h = Math.round(cssH * dpr);
    // Past ~16MP a bake gets slow and a GPU driver may reset: scale the
    // effective pixel ratio down instead.
    const max = g.getParameter(g.MAX_TEXTURE_SIZE) as number;
    const cap = Math.min(1, Math.sqrt(16e6 / (w * h)), max / w, max / h);
    if (cap < 1) {
      dpr *= cap;
      w = Math.round(cssW * dpr);
      h = Math.round(cssH * dpr);
    }
    W = w;
    H = h;
    bakedW = cssW;
    bakedH = cssH;
    bakedDpr = devicePixelRatio || 1;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    tex.forEach((t) => g.deleteTexture(t));
    if (fbo) g.deleteFramebuffer(fbo);
    tex = [makeTex(), makeTex()];
    fbo = g.createFramebuffer();
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex[0], 0);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT1, g.TEXTURE_2D, tex[1], 0);
    g.drawBuffers([g.COLOR_ATTACHMENT0, g.COLOR_ATTACHMENT1]);
    g.viewport(0, 0, W, H);
    g.useProgram(bakeProg);
    g.uniform2f(g.getUniformLocation(bakeProg, "uRes"), W, H);
    g.uniform1f(g.getUniformLocation(bakeProg, "uDpr"), dpr);
    g.drawArrays(g.TRIANGLES, 0, 3);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    light();
    canvas.dataset.ready = "";
  }

  function light() {
    const s = sky;
    const az = (s.az * Math.PI) / 180,
      el = (s.el * Math.PI) / 180;
    const key = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
    const u = (n: string) => g.getUniformLocation(lightProg, n);
    g.viewport(0, 0, W, H);
    g.useProgram(lightProg);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, tex[0]);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, tex[1]);
    g.uniform1i(u("uT0"), 0);
    g.uniform1i(u("uT1"), 1);
    g.uniform2f(u("uRes"), W, H);
    g.uniform1f(u("uDpr"), dpr);
    g.uniform3fv(u("uKeyDir"), key);
    g.uniform3fv(u("uKeyCol"), s.rgb.map((v) => v * s.intensity));
    g.uniform1f(u("uKeyFall"), 0.45);
    g.uniform3fv(u("uAmb"), s.amb);
    g.uniform1f(u("uLampOn"), s.lamp > 0.01 ? 1 : 0);
    g.uniform3fv(u("uLampPos"), [innerWidth * LAMP.x, innerHeight * LAMP.y, LAMP.z]);
    g.uniform3fv(u("uLampCol"), LAMP.rgb.map((v) => v * LAMP.intensity * s.lamp));
    g.uniform1f(u("uLampR"), LAMP.radius);
    g.uniform1f(u("uBump"), FINISH.bump);
    g.uniform1f(u("uCoatFill"), FINISH.coatFill);
    g.uniform1f(u("uSheenExp"), FINISH.sheenExp);
    g.uniform3fv(u("uSheenTint"), FINISH.sheenTint);
    g.uniform1f(u("uExposure"), FINISH.exposure);
    g.uniform1f(u("uEnv"), FINISH.env);
    g.drawArrays(g.TRIANGLES, 0, 3);
  }

  /* The bake is ~50–100ms of GPU work: keep it off the first paint. */
  const idle =
    window.requestIdleCallback ??
    ((cb: () => void) => window.setTimeout(cb, 1));
  const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
  const first = idle(bake);

  let rt = 0;
  function onResize() {
    window.clearTimeout(rt);
    rt = window.setTimeout(() => {
      if (
        innerWidth !== bakedW ||
        innerHeight > bakedH ||
        (devicePixelRatio || 1) !== bakedDpr
      ) {
        bake();
      }
    }, 150);
  }
  addEventListener("resize", onResize);
  function onLost(e: Event) {
    e.preventDefault();
    delete canvas.dataset.ready;
  }
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    stop() {
      cancelIdle(first);
      window.clearTimeout(rt);
      removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onLost);
      g.getExtension("WEBGL_lose_context")?.loseContext();
    },
    /* The cheap pass only, and only once the bake has landed: before
       that, the bake will light with whatever `sky` is by then. */
    setSky(next: Sky) {
      sky = next;
      if (W > 0 && canvas.dataset.ready !== undefined) light();
    },
  };
}
