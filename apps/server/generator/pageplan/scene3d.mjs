import fs from 'node:fs';
/**
 * Dependency-free WebGL 1 scene renderer for standalone PagePlan output.
 * Model data is declarative only; this module contains all executable scene logic.
 *
 * M7-B4B 质量跟进轮新增（相对候选 3D 包）：
 *   - 复合程序化原语：terrain / plateau / house / lighthouse / tree / shrub / rock / dock
 *   - 自动取景：从真实变换后的 mesh AABB 计算目标点与相机距离（含 FOV / aspect / 安全边距）
 *   - 分层光照：key + fill + hemisphere ambient + 接触阴影替代
 *   - 语义拾取：复合体内部零件共享父级 pickId，点选零件即选中语义对象
 *   - 预算：静态 part/三角形上限，超限阻断而非卡死
 *   - 修复：island 法线绕序（原实现 320 个环面法线全朝下）、高光过曝压缩
 *
 * 仍然不提供：物理折射、PBR、阴影贴图、骨骼动画、外部模型导入。
 */
// M7-B4D：主体占幅探针的源码。runtime 需要与 Node 测试**完全同一份实现**，
// 所以这里把 subject-coverage.mjs 的纯函数源码读出来，注入到浏览器 runtime 里，
// 而不是在 runtime 里再写一遍（那必然会漂移）。
export const SUBJECT_COVERAGE_SOURCE = (() => {
  // 该文件只含纯函数（无 DOM/GL 依赖），可安全内联。
  // 用同步读取避免把 scene3d.mjs 变成 async 模块。
  const src = fs.readFileSync(new URL('./subject-coverage.mjs', import.meta.url), 'utf8');
  // 去掉 import/export 关键字即可作为普通脚本执行
  return src
    .replace(/^export\s+(?=(?:const|function|class)\b)/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
})();

export const SCENE3D_LIMITS = Object.freeze({
  minObjects: 1,
  maxObjects: 48,
  coordinate: 25,
  scaleMin: 0.01,
  scaleMax: 16,
  maxPartsPerObject: 40,
  maxTotalParts: 420,
  maxTotalTriangles: 900_000,
});

export const SCENE3D_PRIMITIVES = Object.freeze(['sphere', 'box', 'cylinder', 'cone', 'torus', 'island', 'disk']);
export const SCENE3D_COMPOSITES = Object.freeze(['terrain', 'plateau', 'lagoon', 'dome', 'house', 'lighthouse', 'tree', 'shrub', 'rock', 'dock']);
export const SCENE3D_SHAPES = new Set([...SCENE3D_PRIMITIVES, ...SCENE3D_COMPOSITES]);
export const SCENE3D_MATERIALS = new Set(['jelly', 'matte', 'metal', 'foliage', 'wood', 'stone', 'water', 'sand']);

/** 复合形状的静态 part 数上限（用于 schema 阶段就拒绝明显超预算的计划）。 */
const SHAPE_PART_COUNT = Object.freeze({
  sphere: 1, box: 1, cylinder: 1, cone: 1, torus: 1, island: 1, disk: 1,
  terrain: 4, plateau: 5, lagoon: 6, dome: 16, house: 9, lighthouse: 6, tree: 34, shrub: 4, rock: 3, dock: 7,
});

const HEIGHTS = new Set(['compact', 'standard', 'wide']);
const ID_RE = /^[a-z][a-z0-9-]{0,49}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function validateScene3DNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const allowed = ['id', 'type', 'label', 'description', 'height', 'background', 'cameraDistance', 'controls', 'objects', 'shadows', 'groundColor'];
  if (Object.keys(node).some((key) => !allowed.includes(key))) return false;
  if (node.type !== 'scene3d' || !ID_RE.test(node.id ?? '')) return false;
  if (typeof node.label !== 'string' || !node.label.trim() || node.label.length > 180) return false;
  if (typeof node.description !== 'string' || node.description.length > 600) return false;
  if (!HEIGHTS.has(node.height)) return false;
  if (typeof node.background !== 'string' || !HEX_RE.test(node.background)) return false;
  if (!Number.isFinite(node.cameraDistance) || node.cameraDistance < 6 || node.cameraDistance > 28) return false;
  if (node.shadows != null && typeof node.shadows !== 'boolean') return false;
  if (node.groundColor != null && !HEX_RE.test(node.groundColor)) return false;
  if (!node.controls || typeof node.controls !== 'object' || Array.isArray(node.controls)) return false;
  const controlKeys = ['orbit', 'zoom', 'autoRotate', 'dayNight', 'tide'];
  if (Object.keys(node.controls).some((key) => !controlKeys.includes(key))) return false;
  if (controlKeys.some((key) => typeof node.controls[key] !== 'boolean')) return false;
  if (!Array.isArray(node.objects) || node.objects.length < SCENE3D_LIMITS.minObjects || node.objects.length > SCENE3D_LIMITS.maxObjects) return false;
  const ids = new Set();
  let parts = 0;
  for (const object of node.objects) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
    const keys = ['id', 'name', 'shape', 'position', 'scale', 'rotation', 'color', 'material', 'description', 'selectable', 'motion'];
    if (Object.keys(object).some((key) => !keys.includes(key))) return false;
    if (!ID_RE.test(object.id ?? '') || ids.has(object.id)) return false;
    ids.add(object.id);
    if (typeof object.name !== 'string' || !object.name.trim() || object.name.length > 120) return false;
    if (!SCENE3D_SHAPES.has(object.shape)) return false;
    if (!Array.isArray(object.position) || object.position.length !== 3 || object.position.some((n) => !Number.isFinite(n) || Math.abs(n) > SCENE3D_LIMITS.coordinate)) return false;
    if (!Array.isArray(object.scale) || object.scale.length !== 3 || object.scale.some((n) => !Number.isFinite(n) || n < SCENE3D_LIMITS.scaleMin || n > SCENE3D_LIMITS.scaleMax)) return false;
    if (!Array.isArray(object.rotation) || object.rotation.length !== 3 || object.rotation.some((n) => !Number.isFinite(n) || Math.abs(n) > 360)) return false;
    if (typeof object.color !== 'string' || !HEX_RE.test(object.color)) return false;
    if (!SCENE3D_MATERIALS.has(object.material)) return false;
    if (typeof object.description !== 'string' || object.description.length > 900) return false;
    if (typeof object.selectable !== 'boolean') return false;
    if (!['none', 'tide'].includes(object.motion)) return false;
    if (object.motion === 'tide' && object.shape !== 'disk') return false;
    parts += SHAPE_PART_COUNT[object.shape] ?? 1;
  }
  if (parts > SCENE3D_LIMITS.maxTotalParts) return false;
  return true;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const attr = (value) => esc(value).replace(/`/g, '&#96;');

export function renderScene3DNode(node, sceneBrief = null) {
  if (!validateScene3DNode(node)) throw new TypeError(`invalid scene3d node: ${String(node?.id ?? 'unknown')}`);
  // M7-B4D：把 brief 一并放进 config，供 runtime 做主体占幅对照（不改变 node 结构本身）
  const configForRuntime = sceneBrief ? { ...node, sceneBrief } : node;
  const json = JSON.stringify(configForRuntime).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const height = ({ compact: 330, standard: 450, wide: 560 })[node.height];
  const objects = node.objects.filter((object) => object.selectable);
  const objectButtons = objects.map((object) => `<button class="pp-scene3d-object" type="button" data-scene3d-select="${attr(object.id)}">${esc(object.name)}</button>`).join('');
  const description = node.description ? `<p class="pp-scene3d-description">${esc(node.description)}</p>` : '';
  const dayButton = node.controls.dayNight ? '<button class="pp-scene3d-control" type="button" data-scene3d-action="day-night" aria-pressed="false">切换昼夜</button>' : '';
  const tideControl = node.controls.tide ? '<label class="pp-scene3d-tide">潮位 <input type="range" min="-0.18" max="0.18" step="0.01" value="0" data-scene3d-tide aria-label="调整潮位"></label>' : '';
  const autoButton = '<button class="pp-scene3d-control" type="button" data-scene3d-action="auto-rotate" aria-pressed="false">自动旋转</button>';
  const resetButton = '<button class="pp-scene3d-control" type="button" data-scene3d-action="reset">重置视角</button>';
  const statusLabel = objects.length ? '拖拽旋转场景；滚轮缩放；选择下方对象查看档案。' : '拖拽旋转场景，滚轮缩放。';
  return `<section id="${attr(node.id)}" class="pp-scene3d pp-scene3d--${node.height}" aria-label="${attr(node.label)}" data-pageplan-scene3d>
    <div class="pp-scene3d-heading"><h3>${esc(node.label)}</h3>${description}</div>
    <div class="pp-scene3d-stage" style="--pp-scene-height:${height}px">
      <canvas class="pp-scene3d-canvas" data-scene3d-canvas="${attr(node.id)}" width="960" height="${height}" role="img" tabindex="0" aria-label="${attr(node.label)}。${esc(statusLabel)}"></canvas>
      <p class="pp-scene3d-status" data-scene3d-status role="status" aria-live="polite">正在初始化三维场景…</p>
      <div class="pp-scene3d-controls" aria-label="三维场景控制">${resetButton}${autoButton}${dayButton}${tideControl}</div>
      <div class="pp-scene3d-error" data-scene3d-error role="alert" hidden>此浏览器无法初始化 WebGL 三维场景。请更新浏览器或启用硬件加速；当前场景未被替换为静态图假装成功。</div>
    </div>
    <div class="pp-scene3d-inspector"><div><strong data-scene3d-selected-name>开始探索</strong><p data-scene3d-selected-description>选择场景中的可交互对象，或使用下方对象列表。键盘用户也可以使用对象列表。</p></div><div class="pp-scene3d-object-list" aria-label="可探索对象">${objectButtons}</div></div>
    <template data-scene3d-config="${attr(node.id)}">${json}</template>
  </section>`;
}

/** This function is stringified and embedded as trusted app-authored code in standalone HTML. */
function scene3dRuntimeMain() {
  'use strict';
  const MAX_TOTAL_TRIANGLES = 900000;
  const MAX_PARTS_PER_OBJECT = 40;
  const roots = document.querySelectorAll('[data-pageplan-scene3d]');
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const hexRgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const norm = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const matMul = (a, b) => {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return out;
  };
  const perspective = (fovy, aspect, near, far) => {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  };
  const lookAt = (eye, center, up) => {
    const z = norm(sub(eye, center)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  };
  const shaderSource = {
    vertex: `attribute vec3 aPosition; attribute vec3 aNormal; uniform mat4 uViewProjection; varying vec3 vPosition; varying vec3 vNormal; void main(){ vPosition=aPosition; vNormal=normalize(aNormal); gl_Position=uViewProjection*vec4(aPosition,1.0); }`,
    // key + fill + hemisphere ambient；高光与最终色都做有界压缩，避免 jelly 材质大片死白。
    fragment: `precision mediump float;
      uniform vec4 uColor; uniform float uGloss; uniform vec3 uEye; uniform float uNight; uniform float uPicking;
      uniform vec3 uKeyDir; uniform vec3 uFillDir; uniform vec3 uSkyColor; uniform vec3 uGroundColor;
      varying vec3 vPosition; varying vec3 vNormal;
      void main(){
        if(uPicking>0.5){ gl_FragColor=vec4(uColor.rgb,1.0); return; }
        vec3 n=normalize(vNormal);
        vec3 viewDir=normalize(uEye-vPosition);
        float keyDiff=max(dot(n,uKeyDir),0.0);
        float fillDiff=max(dot(n,uFillDir),0.0);
        float hemiFactor=n.y*0.5+0.5;
        vec3 ambientColor=mix(uGroundColor,uSkyColor,hemiFactor);
        float nightDim=1.0-uNight*0.62;
        vec3 base=uColor.rgb*(ambientColor*0.42 + keyDiff*0.95*nightDim + fillDiff*0.16*nightDim);
        vec3 halfDir=normalize(uKeyDir+viewDir);
        float spec=pow(max(dot(n,halfDir),0.0),mix(12.0,64.0,uGloss))*uGloss*nightDim;
        float rim=pow(1.0-max(dot(n,viewDir),0.0),2.6)*uGloss*0.42*nightDim;
        vec3 glow=vec3(spec+rim);
        glow=glow/(1.0+glow*0.95);
        vec3 color=base+glow;
        color=color/(1.0+color*0.22);
        gl_FragColor=vec4(color,uColor.a);
      }`,
    shadowVertex: `attribute vec2 aPosition; uniform mat4 uViewProjection; uniform vec3 uCenter; uniform vec2 uRadius; void main(){ vec3 p=vec3(uCenter.x+aPosition.x*uRadius.x, uCenter.y, uCenter.z+aPosition.y*uRadius.y); gl_Position=uViewProjection*vec4(p,1.0); }`,
    shadowFragment: `precision mediump float; uniform float uStrength; void main(){ gl_FragColor=vec4(0.18,0.10,0.20,uStrength); }`,
  };
  const compileShader = (gl, kind, source) => {
    const shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader) || 'shader compile failed'; gl.deleteShader(shader); throw new Error(message); }
    return shader;
  };
  const makeProgram = (gl, vertexSource, fragmentSource) => {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource), fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const message = gl.getProgramInfoLog(p) || 'program link failed'; gl.deleteProgram(p); throw new Error(message); }
    return p;
  };

  // ---- 基础几何（局部单位空间 ±0.5）----
  const triangle = (positions, normals, a, b, c, na, nb, nc) => { positions.push(...a, ...b, ...c); normals.push(...na, ...nb, ...nc); };
  const face = (positions, normals, a, b, c, d, n) => { triangle(positions, normals, a, b, c, n, n, n); triangle(positions, normals, a, c, d, n, n, n); };
  const geometry = (shape) => {
    const p = [], n = [];
    if (shape === 'box') {
      face(p, n, [-.5,-.5,.5], [.5,-.5,.5], [.5,.5,.5], [-.5,.5,.5], [0,0,1]);
      face(p, n, [.5,-.5,-.5], [-.5,-.5,-.5], [-.5,.5,-.5], [.5,.5,-.5], [0,0,-1]);
      face(p, n, [-.5,.5,.5], [.5,.5,.5], [.5,.5,-.5], [-.5,.5,-.5], [0,1,0]);
      face(p, n, [-.5,-.5,-.5], [.5,-.5,-.5], [.5,-.5,.5], [-.5,-.5,.5], [0,-1,0]);
      face(p, n, [.5,-.5,.5], [.5,-.5,-.5], [.5,.5,-.5], [.5,.5,.5], [1,0,0]);
      face(p, n, [-.5,-.5,-.5], [-.5,-.5,.5], [-.5,.5,.5], [-.5,.5,-.5], [-1,0,0]);
    } else if (shape === 'sphere') {
      const rings = 14, sides = 24;
      const v = (lat, lon) => { const a = lat * Math.PI, b = lon * 2 * Math.PI; return [Math.sin(a) * Math.cos(b) * .5, Math.cos(a) * .5, Math.sin(a) * Math.sin(b) * .5]; };
      for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
        const a = v(i / rings, j / sides), b = v((i + 1) / rings, j / sides), c = v((i + 1) / rings, (j + 1) / sides), d = v(i / rings, (j + 1) / sides);
        if (i !== 0) triangle(p,n,a,b,d,norm(a),norm(b),norm(d));
        if (i !== rings - 1) triangle(p,n,b,c,d,norm(b),norm(c),norm(d));
      }
    } else if (shape === 'cylinder' || shape === 'cone') {
      const sides = 28;
      for (let i = 0; i < sides; i++) {
        const a = i * Math.PI * 2 / sides, b = (i + 1) * Math.PI * 2 / sides;
        const p1 = [Math.cos(a)*.5,-.5,Math.sin(a)*.5], p2 = [Math.cos(b)*.5,-.5,Math.sin(b)*.5];
        const top = shape === 'cylinder' ? [Math.cos(a)*.5,.5,Math.sin(a)*.5] : [0,.5,0];
        const top2 = shape === 'cylinder' ? [Math.cos(b)*.5,.5,Math.sin(b)*.5] : [0,.5,0];
        const na = norm([Math.cos(a), shape === 'cone' ? .5 : 0, Math.sin(a)]), nb = norm([Math.cos(b), shape === 'cone' ? .5 : 0, Math.sin(b)]);
        triangle(p,n,p1,top,p2,na,na,nb); triangle(p,n,p2,top,top2,nb,na,nb);
        triangle(p,n,[0,-.5,0],p2,p1,[0,-1,0],[0,-1,0],[0,-1,0]);
        if (shape === 'cylinder') triangle(p,n,[0,.5,0],top,top2,[0,1,0],[0,1,0],[0,1,0]);
      }
    } else if (shape === 'torus') {
      const major = 30, minor = 10, R = .36, r = .14;
      const v = (u, w) => { const a=u*Math.PI*2, b=w*Math.PI*2, rr=R+r*Math.cos(b); return [rr*Math.cos(a), r*Math.sin(b), rr*Math.sin(a)]; };
      const normal = (u, w) => { const a=u*Math.PI*2,b=w*Math.PI*2; return norm([Math.cos(b)*Math.cos(a),Math.sin(b),Math.cos(b)*Math.sin(a)]); };
      for(let i=0;i<major;i++) for(let j=0;j<minor;j++) { const u=i/major, u1=(i+1)/major, w=j/minor, w1=(j+1)/minor; const a=v(u,w),b=v(u1,w),c=v(u1,w1),d=v(u,w1); triangle(p,n,a,b,d,normal(u,w),normal(u1,w),normal(u,w1)); triangle(p,n,b,c,d,normal(u1,w),normal(u1,w1),normal(u,w1)); }
    } else if (shape === 'disk') {
      const steps = 64;
      for (let i=0;i<steps;i++) { const a=i/steps*Math.PI*2,b=(i+1)/steps*Math.PI*2; triangle(p,n,[0,0,0],[Math.cos(a)*.5,0,Math.sin(a)*.5],[Math.cos(b)*.5,0,Math.sin(b)*.5],[0,1,0],[0,1,0],[0,1,0]); }
    } else if (shape === 'island') {
      const radii = [.16,.3,.48,.68,.84,1], heights = [.62,.58,.47,.28,.08,-.12], sides=64;
      const point = (ring, j) => { const a=j/sides*Math.PI*2, r=radii[ring]*(1+.055*Math.sin(3*a)+.035*Math.sin(7*a+.7)); const h=heights[ring]+.025*Math.sin(5*a+ring); return [Math.cos(a)*r,h,Math.sin(a)*r]; };
      const center=[0,.64,0];
      for(let j=0;j<sides;j++) triangle(p,n,center,point(0,j),point(0,j+1),[0,1,0],[0,1,0],[0,1,0]);
      for(let r=0;r<radii.length-1;r++) for(let j=0;j<sides;j++) {
        const a=point(r,j), b=point(r+1,j), c=point(r+1,j+1), d=point(r,j+1);
        // 绕序必须给出朝上法线：cross(w-u, v-u) 才是 +Y（原候选实现反了，导致岛体成灰块）。
        const n1=norm(cross(sub(d,a),sub(b,a))), n2=norm(cross(sub(d,b),sub(c,b)));
        triangle(p,n,a,b,d,n1,n1,n1); triangle(p,n,b,c,d,n2,n2,n2);
      }
      // 侧壁：把最外环向下延伸，形成有厚度的"地层"，避免开口曲面。
      const sides2 = sides, outer = (j) => point(radii.length - 1, j);
      for (let j = 0; j < sides2; j++) {
        const a = outer(j), b = outer(j + 1);
        const aLow = [a[0], a[1] - .34, a[2]], bLow = [b[0], b[1] - .34, b[2]];
        const outward = (pt) => norm([pt[0], 0.15, pt[2]]);
        face(p, n, a, b, bLow, aLow, outward([(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2]));
      }
      // 底面封口
      const botCenter = [0, -.46, 0];
      for (let j = 0; j < sides2; j++) {
        const a = outer(j), b = outer(j + 1);
        triangle(p,n,botCenter,[a[0],a[1]-.34,a[2]],[b[0],b[1]-.34,b[2]],[0,-1,0],[0,-1,0],[0,-1,0]);
      }
    }
    return { positions: new Float32Array(p), normals: new Float32Array(n), count: p.length / 3 };
  };
  const ringGeometry = () => {
    // 阴影盘：单位圆盘（只含 xz）
    const p = [], steps = 40;
    for (let i = 0; i < steps; i++) {
      const a = i / steps * Math.PI * 2, b = (i + 1) / steps * Math.PI * 2;
      p.push(0, 0, Math.cos(a) * .5, Math.sin(a) * .5, Math.cos(b) * .5, Math.sin(b) * .5);
    }
    return new Float32Array(p);
  };

  // ---- 复合原语：返回相对该对象局部空间的部件列表 ----
  // part = { shape, offset:[x,y,z], scale:[x,y,z], rotation:[x,y,z], tint:[r,g,b] }
  const tintOf = (mul) => mul;
  const compositeParts = (shape) => {
    if (shape === 'terrain') {
      return [
        // 岛体顶面（主题色）
        { shape: 'island', offset: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0], tint: [1, 1, 1] },
        // 砂岸带：略大的浅色扁环，露出岛体轮廓外缘
        { shape: 'torus', offset: [0, -0.02, 0], scale: [1.03, 0.10, 1.03], rotation: [0, 0, 0], tint: [1.30, 1.20, 1.02] },
        // 侧壁：深色沉积层 + 更深的基岩层，形成厚度
        { shape: 'island', offset: [0, -0.32, 0], scale: [1.00, 0.58, 1.00], rotation: [0, 4, 0], tint: [0.66, 0.55, 0.55] },
        { shape: 'island', offset: [0, -0.60, 0], scale: [0.99, 0.34, 0.99], rotation: [0, 9, 0], tint: [0.48, 0.40, 0.42] },
      ];
    }
    if (shape === 'lagoon') {
      // 分层水面：纯平单片 disk 只能得到"纯色塑料片"（审计结论）。
      // 这里用 4 层不同半径/高度/色偏的环与盘叠加，形成深水-浅水-岸线-高光的可读层次。
      return [
        // 深水底盘（最暗、最大）
        { shape: 'disk', offset: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0], tint: [0.80, 0.88, 0.95] },
        // 中层水：略亮、略小，形成色带
        { shape: 'disk', offset: [0, 0.012, 0], scale: [0.82, 1, 0.82], rotation: [0, 18, 0], tint: [1.02, 1.04, 1.0] },
        // 浅水带：最亮、更小，靠近岸
        { shape: 'disk', offset: [0, 0.024, 0], scale: [0.63, 1, 0.63], rotation: [0, -12, 0], tint: [1.18, 1.14, 1.02] },
        // 岸线泡沫环：细而亮
        { shape: 'torus', offset: [0, 0.030, 0], scale: [0.60, 0.035, 0.60], rotation: [0, 0, 0], tint: [1.45, 1.38, 1.16] },
        // 高光条带：两条细长扁盒，模拟参考图的水面高光
        { shape: 'box', offset: [0.12, 0.034, 0.16], scale: [0.62, 0.006, 0.045], rotation: [0, 22, 0], tint: [1.55, 1.52, 1.42] },
        { shape: 'box', offset: [-0.18, 0.034, -0.10], scale: [0.42, 0.006, 0.032], rotation: [0, -14, 0], tint: [1.42, 1.40, 1.30] },
      ];
    }
    if (shape === 'plateau') {
      return [
        // 主体：自顶向下 5 层，形成可读的地层剖面（砂层 / 浅沉积 / 深沉积带 / 基岩 / 底边）
        { shape: 'box', offset: [0, -0.26, 0], scale: [1, 0.52, 1], rotation: [0, 0, 0], tint: [0.96, 0.90, 0.80] },
        { shape: 'box', offset: [0, -0.06, 0], scale: [1.015, 0.05, 1.015], rotation: [0, 0, 0], tint: [1.02, 0.97, 0.88] },
        { shape: 'box', offset: [0, -0.30, 0], scale: [1.005, 0.030, 1.005], rotation: [0, 0, 0], tint: [0.44, 0.36, 0.34] },
        { shape: 'box', offset: [0, -0.56, 0], scale: [1, 0.30, 1], rotation: [0, 0, 0], tint: [0.66, 0.57, 0.52] },
        { shape: 'box', offset: [0, -0.74, 0], scale: [0.99, 0.08, 0.99], rotation: [0, 0, 0], tint: [0.40, 0.34, 0.32] },
      ];
    }
    if (shape === 'dome') {
      // 玻璃穹顶：审计发现没有原语时只能拿球簇硬凑（视觉上就是一颗蓝色球）。
      // 按球面方程生成环带：y 与半径同步变化，环带之间才能连成连续曲面，而不是叠盘子。
      const parts = [];
      const BANDS = 7;
      for (let i = 1; i <= BANDS; i++) {
        const t = i / BANDS;
        const phi = t * (Math.PI / 2);
        const y = 0.5 * Math.cos(phi);
        const r = 0.5 * Math.sin(phi);
        if (r < 0.02) continue;
        parts.push({ shape: 'torus', offset: [0, y, 0], scale: [r * 2.0, 0.035, r * 2.0], rotation: [0, 0, 0], tint: [1.0, 1.0, 1.0] });
      }
      parts.push({ shape: 'sphere', offset: [0, 0.42, 0], scale: [0.42, 0.32, 0.42], rotation: [0, 0, 0], tint: [1.10, 1.08, 1.04] });
      // 4 根贴壳面的竖柱：底在基座半径 0.46，顶收拢到 0.10
      for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        parts.push({
          shape: 'box',
          offset: [ux * 0.28, 0.23, uz * 0.28],
          scale: [0.055, 0.9, 0.055],
          rotation: [uz * 34, 0, -ux * 34],
          tint: [0.70, 0.74, 0.76],
        });
      }
      parts.push({ shape: 'torus', offset: [0, 0.01, 0], scale: [1.02, 0.09, 1.02], rotation: [0, 0, 0], tint: [0.78, 0.76, 0.72] });
      parts.push({ shape: 'box', offset: [0, 0.05, 0.47], scale: [0.24, 0.20, 0.05], rotation: [0, 0, 0], tint: [0.50, 0.56, 0.58] });
      parts.push({ shape: 'sphere', offset: [-0.16, 0.14, -0.08], scale: [0.30, 0.24, 0.30], rotation: [0, 0, 0], tint: [0.82, 1.04, 0.84] });
      parts.push({ shape: 'sphere', offset: [0.18, 0.11, 0.12], scale: [0.24, 0.18, 0.24], rotation: [0, 0, 0], tint: [0.88, 1.06, 0.86] });
      return parts;
    }
    if (shape === 'house') {
      return [
        { shape: 'box', offset: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0], tint: [1, 1, 1] },
        { shape: 'box', offset: [0, 0.60, 0.28], scale: [1.20, 0.10, 0.62], rotation: [26, 0, 0], tint: [0.72, 0.42, 0.52] },
        { shape: 'box', offset: [0, 0.60, -0.28], scale: [1.20, 0.10, 0.62], rotation: [-26, 0, 0], tint: [0.66, 0.38, 0.48] },
        { shape: 'box', offset: [0, 0.72, 0], scale: [1.14, 0.09, 0.12], rotation: [0, 0, 0], tint: [0.86, 0.58, 0.64] },
        { shape: 'box', offset: [0, -0.28, 0.51], scale: [0.26, 0.44, 0.06], rotation: [0, 0, 0], tint: [0.42, 0.34, 0.36] },
        { shape: 'box', offset: [-0.28, 0.10, 0.51], scale: [0.22, 0.22, 0.06], rotation: [0, 0, 0], tint: [0.72, 0.94, 0.98] },
        { shape: 'box', offset: [0.28, 0.10, 0.51], scale: [0.22, 0.22, 0.06], rotation: [0, 0, 0], tint: [0.72, 0.94, 0.98] },
        { shape: 'box', offset: [0, 0.10, -0.51], scale: [0.22, 0.22, 0.06], rotation: [0, 0, 0], tint: [0.72, 0.94, 0.98] },
        { shape: 'box', offset: [0, 0.52, 0.30], scale: [0.16, 0.34, 0.16], rotation: [0, 0, 0], tint: [0.66, 0.56, 0.58] },
      ];
    }
    if (shape === 'lighthouse') {
      return [
        { shape: 'cylinder', offset: [0, -0.44, 0], scale: [1.5, 0.32, 1.5], rotation: [0, 0, 0], tint: [0.80, 0.70, 0.74] },
        { shape: 'cylinder', offset: [0, -0.02, 0], scale: [1.0, 1.72, 1.0], rotation: [0, 0, 0], tint: [1, 1, 1] },
        { shape: 'cylinder', offset: [0, 0.86, 0], scale: [0.82, 0.22, 0.82], rotation: [0, 0, 0], tint: [0.88, 0.72, 0.70] },
        { shape: 'cylinder', offset: [0, 1.06, 0], scale: [0.66, 0.22, 0.66], rotation: [0, 0, 0], tint: [1.0, 0.90, 0.62] },
        { shape: 'cone', offset: [0, 1.24, 0], scale: [0.92, 0.36, 0.92], rotation: [0, 0, 0], tint: [0.78, 0.52, 0.66] },
        { shape: 'sphere', offset: [0, 1.06, 0], scale: [0.30, 0.30, 0.30], rotation: [0, 0, 0], tint: [1.22, 1.14, 0.86] },
      ];
    }
    if (shape === 'tree') {
      const parts = [
        { shape: 'cylinder', offset: [0, -0.24, 0], scale: [0.17, 1.10, 0.17], rotation: [0, 0, 2], tint: [0.52, 0.38, 0.32] },
      ];
      // 棕榈冠：两环羽状叶（下层下垂、上层上翘）+ 叶轴，形成有体积的树冠而不是"蜘蛛腿"。
      // 叶片沿自身伸展方向先偏移半个长度，所以是从树干顶端向外放射，不是绕原点交叉。
      // 羽状叶：单片扁盒只能得到"刀片"观感（审计结论）。
      // 改为每片叶由 3 段递减宽度 + 逐段下垂的盒组成，从侧面能看出叶轴与羽片的转折。
      const frondCount = 8;
      for (let i = 0; i < frondCount; i++) {
        const angle = (i / frondCount) * 360 + 12;
        const baseDroop = -30 - (i % 3) * 7;
        let cursor = [0, 0.58, 0];
        const segs = [
          { len: 0.30, width: 0.34, droop: baseDroop, tint: [0.88, 0.96, 0.86] },
          { len: 0.24, width: 0.26, droop: baseDroop - 10, tint: [0.94, 1.00, 0.90] },
          { len: 0.17, width: 0.17, droop: baseDroop - 20, tint: [1.00, 1.04, 0.94] },
        ];
        for (const seg of segs) {
          const rot = [seg.droop, angle, 0];
          const half = seg.len * 0.5;
          const step = rotateVec([0, 0, half], rot);
          const center = [cursor[0] + step[0], cursor[1] + step[1], cursor[2] + step[2]];
          parts.push({
            shape: "box", offset: center,
            scale: [seg.width, 0.045, seg.len], rotation: rot, tint: seg.tint,
          });
          const adv = rotateVec([0, 0, seg.len], rot);
          cursor = [cursor[0] + adv[0], cursor[1] + adv[1], cursor[2] + adv[2]];
        }
        // 上层小叶：从更高的起点往外挑，收拢树冠
        const upRot = [18 - (i % 2) * 9, angle + 26, 0];
        const upStep = rotateVec([0, 0, 0.15], upRot);
        parts.push({
          shape: "box", offset: [upStep[0], 0.74 + upStep[1], upStep[2]],
          scale: [0.14, 0.04, 0.30], rotation: upRot, tint: [1.02, 1.06, 0.96],
        });
      }
      // 树冠芯：让叶片有落点，避免"从空气里长出来"
      parts.push({ shape: "sphere", offset: [0, 0.60, 0], scale: [0.24, 0.18, 0.24], rotation: [0, 0, 0], tint: [0.70, 0.78, 0.68] });
      // 树干顶部：小的深色芯，让树冠有落点
      parts.push({ shape: 'sphere', offset: [0, 0.56, 0], scale: [0.26, 0.20, 0.26], rotation: [0, 0, 0], tint: [0.72, 0.80, 0.70] });
      return parts;
    }
    if (shape === 'shrub') {
      return [
        { shape: 'sphere', offset: [0, 0, 0], scale: [1, 0.82, 1], rotation: [0, 0, 0], tint: [1, 1, 1] },
        { shape: 'sphere', offset: [0.42, 0.06, 0.18], scale: [0.72, 0.60, 0.72], rotation: [0, 20, 0], tint: [0.90, 1.02, 0.92] },
        { shape: 'sphere', offset: [-0.36, 0.04, -0.22], scale: [0.64, 0.54, 0.64], rotation: [0, -14, 0], tint: [0.84, 0.96, 0.86] },
        { shape: 'sphere', offset: [0.06, 0.30, -0.34], scale: [0.48, 0.42, 0.48], rotation: [0, 0, 0], tint: [0.94, 1.04, 0.94] },
      ];
    }
    if (shape === 'rock') {
      return [
        { shape: 'sphere', offset: [0, 0, 0], scale: [1, 0.72, 0.90], rotation: [8, 22, -6], tint: [1, 1, 1] },
        { shape: 'sphere', offset: [0.34, -0.06, 0.22], scale: [0.54, 0.40, 0.50], rotation: [-12, -30, 12], tint: [0.92, 0.90, 0.94] },
        { shape: 'sphere', offset: [-0.28, 0.02, -0.18], scale: [0.42, 0.34, 0.40], rotation: [18, 8, -14], tint: [1.04, 1.00, 1.02] },
      ];
    }
    if (shape === 'dock') {
      return [
        { shape: 'box', offset: [0, 0, 0], scale: [1, 0.14, 0.34], rotation: [0, 0, 0], tint: [1, 1, 1] },
        { shape: 'box', offset: [0.42, -0.04, 0.30], scale: [0.46, 0.12, 0.28], rotation: [0, 22, 0], tint: [0.94, 0.90, 0.86] },
        { shape: 'cylinder', offset: [-0.44, -0.30, 0.13], scale: [0.13, 0.62, 0.13], rotation: [0, 0, 0], tint: [0.66, 0.56, 0.52] },
        { shape: 'cylinder', offset: [0.44, -0.30, 0.13], scale: [0.13, 0.62, 0.13], rotation: [0, 0, 0], tint: [0.66, 0.56, 0.52] },
        { shape: 'cylinder', offset: [-0.44, -0.30, -0.13], scale: [0.13, 0.62, 0.13], rotation: [0, 0, 0], tint: [0.66, 0.56, 0.52] },
        { shape: 'cylinder', offset: [0.44, -0.30, -0.13], scale: [0.13, 0.62, 0.13], rotation: [0, 0, 0], tint: [0.66, 0.56, 0.52] },
        { shape: 'box', offset: [0, 0.22, 0.14], scale: [0.90, 0.10, 0.06], rotation: [0, 0, 0], tint: [0.80, 0.72, 0.66] },
      ];
    }
    return null;
  };

  const partListFor = (object) => {
    const parts = compositeParts(object.shape);
    if (parts) return parts.slice(0, MAX_PARTS_PER_OBJECT);
    return [{ shape: object.shape, offset: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0], tint: [1, 1, 1] }];
  };

  const rotateVec = (v, rotation) => {
    const rx = rotation[0] * Math.PI / 180, ry = rotation[1] * Math.PI / 180, rz = rotation[2] * Math.PI / 180;
    let x = v[0], y = v[1], z = v[2];
    let yy = y * Math.cos(rx) - z * Math.sin(rx), zz = y * Math.sin(rx) + z * Math.cos(rx); y = yy; z = zz;
    let xx = x * Math.cos(ry) + z * Math.sin(ry); zz = -x * Math.sin(ry) + z * Math.cos(ry); x = xx; z = zz;
    xx = x * Math.cos(rz) - y * Math.sin(rz); yy = x * Math.sin(rz) + y * Math.cos(rz); x = xx; y = yy;
    return [x, y, z];
  };
  const worldPoint = (p, scale, rotation, position) => {
    let x = p[0] * scale[0], y = p[1] * scale[1], z = p[2] * scale[2];
    const r = rotateVec([x, y, z], rotation);
    return [r[0] + position[0], r[1] + position[1], r[2] + position[2]];
  };
  const worldNormal = (n, scale, rotation) => norm(rotateVec([n[0] / scale[0], n[1] / scale[1], n[2] / scale[2]], rotation));
  const makeWorldGeometry = (base, object) => {
    const p = new Float32Array(base.positions.length), n = new Float32Array(base.normals.length);
    for (let i = 0; i < base.positions.length; i += 3) {
      const wp = worldPoint([base.positions[i], base.positions[i + 1], base.positions[i + 2]], object.scale, object.rotation, object.position);
      const wn = worldNormal([base.normals[i], base.normals[i + 1], base.normals[i + 2]], object.scale, object.rotation);
      p.set(wp, i); n.set(wn, i);
    }
    return { positions: p, normals: n, count: base.count };
  };
  const hexToClear = (hex, night) => { const a = hexRgb(hex); return night ? [0.022, 0.030, 0.055, 1] : [a[0], a[1], a[2], 1]; };

  const MATERIALS = { jelly: 0.94, matte: 0.18, metal: 0.72, foliage: 0.28, wood: 0.12, stone: 0.16, water: 0.88, sand: 0.10 };

  for (const root of roots) {
    const configNode = root.querySelector('template[data-scene3d-config]');
    const canvas = root.querySelector('[data-scene3d-canvas]');
    const status = root.querySelector('[data-scene3d-status]');
    const error = root.querySelector('[data-scene3d-error]');
    if (!configNode || !canvas) continue;
    let cfg;
    // <template> 的内容在 .content DocumentFragment 中，textContent 为空
    const rawConfig = configNode.content ? configNode.content.textContent : configNode.textContent;
    try { cfg = JSON.parse(rawConfig); } catch { if (status) status.textContent = '三维场景配置无法读取'; if (error) error.hidden = false; root.setAttribute('data-scene3d-status', 'error'); continue; }
    let gl;
    try { gl = canvas.getContext('webgl', { alpha: false, antialias: true, depth: true, preserveDrawingBuffer: false }); }
    catch { gl = null; }
    if (!gl) { if (status) status.textContent = '当前浏览器未能初始化 WebGL'; if (error) error.hidden = false; root.setAttribute('data-scene3d-status', 'error'); root.setAttribute('data-scene3d-gl-error', 'context-unavailable'); continue; }
    try {
      const initStart = performance.now();
      const program = makeProgram(gl, shaderSource.vertex, shaderSource.fragment);
      gl.useProgram(program);
      const loc = {
        position: gl.getAttribLocation(program, 'aPosition'), normal: gl.getAttribLocation(program, 'aNormal'),
        vp: gl.getUniformLocation(program, 'uViewProjection'), color: gl.getUniformLocation(program, 'uColor'),
        gloss: gl.getUniformLocation(program, 'uGloss'), eye: gl.getUniformLocation(program, 'uEye'),
        night: gl.getUniformLocation(program, 'uNight'), picking: gl.getUniformLocation(program, 'uPicking'),
        keyDir: gl.getUniformLocation(program, 'uKeyDir'), fillDir: gl.getUniformLocation(program, 'uFillDir'),
        sky: gl.getUniformLocation(program, 'uSkyColor'), ground: gl.getUniformLocation(program, 'uGroundColor'),
      };
      const shadowProgram = makeProgram(gl, shaderSource.shadowVertex, shaderSource.shadowFragment);
      const shadowLoc = {
        position: gl.getAttribLocation(shadowProgram, 'aPosition'), vp: gl.getUniformLocation(shadowProgram, 'uViewProjection'),
        center: gl.getUniformLocation(shadowProgram, 'uCenter'), radius: gl.getUniformLocation(shadowProgram, 'uRadius'),
        strength: gl.getUniformLocation(shadowProgram, 'uStrength'),
      };
      const shadowBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, ringGeometry(), gl.STATIC_DRAW);

      let selectableIndex = 0;
      const meshes = [];
      const objectFrames = new Map();  // objectId → 世界 AABB（用于阴影与拾取聚合）
      const objectById = new Map(cfg.objects.map((o) => [o.id, o]));
      let totalTriangles = 0;
      let budgetExceeded = null;
      for (const object of cfg.objects) {
        const parts = partListFor(object);
        if (parts.length > MAX_PARTS_PER_OBJECT) { budgetExceeded = `对象 ${object.id} 部件数 ${parts.length} 超出预算 ${MAX_PARTS_PER_OBJECT}`; break; }
        const baseColor = hexRgb(object.color);
        const pickId = object.selectable ? ++selectableIndex : 0;
        const frame = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (const part of parts) {
          const localScale = [object.scale[0] * part.scale[0], object.scale[1] * part.scale[1], object.scale[2] * part.scale[2]];
          const localRotation = [object.rotation[0] + part.rotation[0], object.rotation[1] + part.rotation[1], object.rotation[2] + part.rotation[2]];
          const offsetWorld = rotateVec([part.offset[0] * object.scale[0], part.offset[1] * object.scale[1], part.offset[2] * object.scale[2]], object.rotation);
          const partObject = { position: [object.position[0] + offsetWorld[0], object.position[1] + offsetWorld[1], object.position[2] + offsetWorld[2]], scale: localScale, rotation: localRotation };
          const base = geometry(part.shape);
          const world = makeWorldGeometry(base, partObject);
          totalTriangles += world.count / 3;
          if (totalTriangles > MAX_TOTAL_TRIANGLES) { budgetExceeded = `三角形总数 ${Math.round(totalTriangles)} 超出预算 ${MAX_TOTAL_TRIANGLES}`; break; }
          for (let i = 0; i < world.positions.length; i += 3) {
            for (let a = 0; a < 3; a++) {
              if (world.positions[i + a] < frame.min[a]) frame.min[a] = world.positions[i + a];
              if (world.positions[i + a] > frame.max[a]) frame.max[a] = world.positions[i + a];
            }
          }
          const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, world.positions, gl.STATIC_DRAW);
          const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, world.normals, gl.STATIC_DRAW);
          const tint = part.tint ?? [1, 1, 1];
          meshes.push({
            objectId: object.id, part, world, pb, nb, count: world.count, lastTide: null,
            color: [Math.min(1, baseColor[0] * tint[0]), Math.min(1, baseColor[1] * tint[1]), Math.min(1, baseColor[2] * tint[2])],
            gloss: MATERIALS[object.material] ?? 0.3,
            pickId, selectable: object.selectable, selected: false,
            isWater: object.material === 'water' || object.motion === 'tide',
            basePosition: object.position.slice(),
            tideBase: object.position[1],
          });
        }
        objectFrames.set(object.id, frame);
        if (budgetExceeded) break;
      }
      if (budgetExceeded) {
        if (status) status.textContent = `场景超出渲染预算：${budgetExceeded}`;
        if (error) { error.hidden = false; error.textContent = `场景超出渲染预算（${budgetExceeded}）。请简化场景后重试；页面未用静态图冒充。`; }
        root.setAttribute('data-scene3d-status', 'error');
        root.setAttribute('data-scene3d-budget-error', budgetExceeded);
        continue;
      }

      // ---- 地面吸附（通用，不针对任何 fixture 特判）----
      // 模型给的是"大致位置"，很容易让房屋半埋进地形或悬浮在半空。
      // 做法：把地形类对象（terrain / island）的真实顶点栅格化成高度场，
      // 再按每个物件中心所在的格子采样地表高度，把物件底部对齐到该高度。
      // 只抬"立着的东西"（高度 > 0.2），绝不下压底座、水面或刻意放低的物件。
      const STANDING_SHAPES = new Set(['house', 'lighthouse', 'tree', 'shrub', 'rock', 'dock', 'cylinder', 'cone', 'box', 'sphere', 'torus']);
      const terrainMeshes = meshes.filter((m) => {
        const o = objectById.get(m.objectId);
        return o && (o.shape === 'terrain' || o.shape === 'island') && o.material !== 'water';
      });
      if (terrainMeshes.length) {
        // 高度场：按地形 AABB 建立 40×40 网格，记录每格最高 y
        const tMin = [Infinity, Infinity, Infinity], tMax = [-Infinity, -Infinity, -Infinity];
        for (const m of terrainMeshes) {
          const pos = m.world.positions;
          for (let i = 0; i < pos.length; i += 3) {
            for (let a = 0; a < 3; a++) { if (pos[i + a] < tMin[a]) tMin[a] = pos[i + a]; if (pos[i + a] > tMax[a]) tMax[a] = pos[i + a]; }
          }
        }
        const GRID = 40;
        const heights = new Float32Array(GRID * GRID).fill(-Infinity);
        const spanX = Math.max(1e-6, tMax[0] - tMin[0]), spanZ = Math.max(1e-6, tMax[2] - tMin[2]);
        for (const m of terrainMeshes) {
          // 用 mesh 自带的真实法线判断"朝上的面"，不要在这里重算叉积——
          // 重算很容易和几何绕序约定相反（本轮就踩过：符号反了，把所有朝上的面都过滤掉）。
          const pos = m.world.positions, nrm = m.world.normals;
          for (let i = 0; i < pos.length; i += 9) {
            if (nrm[i + 1] <= 0.25 || nrm[i + 4] <= 0.25 || nrm[i + 7] <= 0.25) continue;
            const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
            const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
            const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
            // 每个顶点都写入（而不是只写质心），保证高度场在地形边缘也连续
            for (const [vx, vy, vz] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
              const gx = Math.min(GRID - 1, Math.max(0, Math.floor((vx - tMin[0]) / spanX * GRID)));
              const gz = Math.min(GRID - 1, Math.max(0, Math.floor((vz - tMin[2]) / spanZ * GRID)));
              const idx = gz * GRID + gx;
              if (vy > heights[idx]) heights[idx] = vy;
            }
          }
        }
        const sampleHeight = (x, z, radius) => {
          // 在物件足迹范围内取最高格，保证不会把物件埋进坡里
          const gx = Math.min(GRID - 1, Math.max(0, Math.floor((x - tMin[0]) / spanX * GRID)));
          const gz = Math.min(GRID - 1, Math.max(0, Math.floor((z - tMin[2]) / spanZ * GRID)));
          const spread = Math.max(1, Math.round(radius / Math.max(spanX, spanZ) * GRID));
          let best = -Infinity;
          for (let dz = -spread; dz <= spread; dz++) for (let dx = -spread; dx <= spread; dx++) {
            const ix = gx + dx, iz = gz + dz;
            if (ix < 0 || iz < 0 || ix >= GRID || iz >= GRID) continue;
            const v = heights[iz * GRID + ix];
            if (v > best) best = v;
          }
          return Number.isFinite(best) ? best : null;
        };
        let lifted = 0;
        for (const [id, frame] of objectFrames) {
          const object = objectById.get(id);
          if (!object) continue;
          if (object.shape === 'terrain' || object.shape === 'island' || object.shape === 'plateau') continue;
          if (object.material === 'water' || object.motion === 'tide') continue;
          if (!STANDING_SHAPES.has(object.shape)) continue;
          const h = frame.max[1] - frame.min[1];
          if (h < 0.2) continue;
          const cx = (frame.min[0] + frame.max[0]) / 2, cz = (frame.min[2] + frame.max[2]) / 2;
          const footprint = Math.max(frame.max[0] - frame.min[0], frame.max[2] - frame.min[2]) / 2;
          const surface = sampleHeight(cx, cz, footprint);
          if (surface === null) continue;
          // 目标：物件底部略低于地表（埋入 6%，看起来是"长在地上"而不是"贴着放"）
          const embed = Math.min(0.06, h * 0.06);
          const shift = (surface - embed) - frame.min[1];
          if (Math.abs(shift) < 0.03) continue;
          if (shift > 1.6 || shift < -0.6) continue;  // 超出合理范围：模型坐标本身有问题，别乱搬
          for (const mesh of meshes) {
            if (mesh.objectId !== id) continue;
            for (let i = 1; i < mesh.world.positions.length; i += 3) mesh.world.positions[i] += shift;
            mesh.basePosition[1] += shift;
            mesh.tideBase += shift;
            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb);
            gl.bufferData(gl.ARRAY_BUFFER, mesh.world.positions, gl.STATIC_DRAW);
          }
          frame.min[1] += shift; frame.max[1] += shift;
          lifted++;
        }
        root.setAttribute('data-scene3d-grounded', String(lifted));
      }

      // ---- 自动取景：从真实变换后的顶点算 AABB ----
      const computeBounds = () => {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const mesh of meshes) {
          const pos = mesh.world.positions;
          for (let i = 0; i < pos.length; i += 3) {
            for (let a = 0; a < 3; a++) { if (pos[i + a] < min[a]) min[a] = pos[i + a]; if (pos[i + a] > max[a]) max[a] = pos[i + a]; }
          }
        }
        if (!Number.isFinite(min[0])) return { center: [0, 0, 0], radius: 1, min, max };
        const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
        let radius = 0;
        for (const mesh of meshes) {
          const pos = mesh.world.positions;
          for (let i = 0; i < pos.length; i += 3) {
            const d = Math.hypot(pos[i] - center[0], pos[i + 1] - center[1], pos[i + 2] - center[2]);
            if (d > radius) radius = d;
          }
        }
        return { center, radius: Math.max(radius, 0.5), min, max };
      };
      const bounds = computeBounds();
      const FOV_Y = Math.PI / 4;
      const autoFrameDistance = (aspect) => {
        const fovX = 2 * Math.atan(Math.tan(FOV_Y / 2) * Math.max(aspect, 0.2));
        const limiting = Math.min(FOV_Y, fovX);
        // 用 tan 而不是 sin：sin 版本是"球刚好内切"的保守距离，会让主体明显偏小
        const dist = bounds.radius / Math.tan(limiting / 2);
        return clamp(dist * 1.12, 4, 60);
      };
      const autoTarget = [bounds.center[0], bounds.center[1] + bounds.radius * 0.05, bounds.center[2]];
      let autoDistance = autoFrameDistance(canvas.width / Math.max(1, canvas.height));
      // 模型给的 cameraDistance 作为"偏好缩放"参考，但不得压过自动取景的合理性
      const preferred = Number(cfg.cameraDistance) || autoDistance;
      // 初始视角的单一来源：初始化与"重置视角"必须用同一套公式，
      // 否则重置出来的画面和首屏不一致（本轮实测踩到：初始化 0.72 / 重置 0.52）。
      const computeFramedDistance = (aspect) => {
        const auto = autoFrameDistance(aspect);
        return clamp(auto * clamp(preferred / auto, 0.72, 1.30), 5, 60);
      };
      const INITIAL_YAW = 0.70, INITIAL_PITCH = 0.66;
      let distance = computeFramedDistance(canvas.width / Math.max(1, canvas.height));
      let yaw = INITIAL_YAW, pitch = INITIAL_PITCH;
      let auto = Boolean(cfg.controls.autoRotate), night = false, tide = 0, dragging = false, moved = false;
      let lastX = 0, lastY = 0, startX = 0, startY = 0, raf = 0, lastFrame = 0;
      const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) auto = false;

      const viewState = () => {
        const cp = Math.cos(pitch);
        const eye = [autoTarget[0] + Math.sin(yaw) * cp * distance, autoTarget[1] + Math.sin(pitch) * distance, autoTarget[2] + Math.cos(yaw) * cp * distance];
        return { eye, vp: matMul(perspective(FOV_Y, canvas.width / Math.max(1, canvas.height), 0.1, 400), lookAt(eye, autoTarget, [0, 1, 0])) };
      };
      const setStatus = (text) => { if (status) status.textContent = text; };
      const setSelected = (mesh) => {
        const name = root.querySelector('[data-scene3d-selected-name]'), desc = root.querySelector('[data-scene3d-selected-description]');
        const object = cfg.objects.find((o) => o.id === mesh.objectId);
        if (name) name.textContent = object?.name ?? '';
        if (desc) desc.textContent = object?.description || '此对象没有额外档案。';
        root.querySelectorAll('[data-scene3d-select]').forEach((button) => {
          button.setAttribute('aria-pressed', String(button.getAttribute('data-scene3d-select') === mesh.objectId));
        });
        for (const m of meshes) m.selected = m.objectId === mesh.objectId;
        root.setAttribute('data-scene3d-selected', mesh.objectId);
        draw();
      };
      // 重置 = 回到"首屏那一帧"：相机 + 日夜 + 潮位全部复原，
      // 否则用户看到的不是初始状态（本轮实测：只重置相机、夜间/潮位仍保留 → 帧哈希不一致）。
      const resetView = () => {
        yaw = INITIAL_YAW; pitch = INITIAL_PITCH;
        distance = computeFramedDistance(canvas.width / Math.max(1, canvas.height));
        night = false;
        const dayBtn = root.querySelector('[data-scene3d-action="day-night"]');
        if (dayBtn) { dayBtn.setAttribute('aria-pressed', 'false'); dayBtn.textContent = '切换夜晚'; }
        const tideInput = root.querySelector('[data-scene3d-tide]');
        if (tideInput && Number(tideInput.value) !== 0) { tideInput.value = '0'; tide = 0; applyTide(); }
        setStatus('视角已重置');
        draw();
      };

      let lastDrawMs = 0;
      function draw() {
        if (!gl || !program || !canvas.width || !canvas.height) return;
        const drawStart = performance.now();
        const state = viewState();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(...hexToClear(cfg.background, night));
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);

        const keyDir = norm([-0.42, 0.80, 0.52]);
        const fillDir = norm([0.55, 0.35, -0.60]);
        const sky = hexRgb(cfg.background);
        const ground = cfg.groundColor ? hexRgb(cfg.groundColor) : [0.42, 0.36, 0.42];

        // 接触阴影：按"语义对象"聚合成一个软阴影盘（不是每个零件一片），
        // 方向向 -X/-Z 偏移（与 keyDir 反向在地面的投影一致），强度按对象高度衰减。
        if (cfg.shadows !== false) {
          gl.useProgram(shadowProgram);
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
          gl.uniformMatrix4fv(shadowLoc.vp, false, state.vp);
          gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuffer);
          gl.enableVertexAttribArray(shadowLoc.position);
          gl.vertexAttribPointer(shadowLoc.position, 2, gl.FLOAT, false, 0, 0);
          // 注意：不能用全局最低点 —— 底座在 -2.3 时阴影会被画到看不见的底面。
          // 每个对象贴自己的底部平面，落在它实际站立的那层表面上。
          for (const [objectId, frame] of objectFrames) {
            const object = objectById.get(objectId);
            if (!object || object.material === 'water' || object.motion === 'tide') continue;
            const w = frame.max[0] - frame.min[0], d = frame.max[2] - frame.min[2];
            if (!Number.isFinite(w) || w <= 0) continue;
            const groundY = frame.min[1] + 0.012;
            const height = Math.max(0, frame.max[1] - frame.min[1]);
            if (height < 0.08) continue;  // 贴地物不投影
            const cx = (frame.min[0] + frame.max[0]) / 2, cz = (frame.min[2] + frame.max[2]) / 2;
            // 主光来自 (-x,+y,+z) → 地面阴影朝 (+x,-z) 偏移
            const shift = Math.min(height * 0.42, 1.4);
            gl.uniform3f(shadowLoc.center, cx + shift * 0.55, groundY, cz - shift * 0.62);
            gl.uniform2f(shadowLoc.radius, Math.max(w * 0.62, 0.18), Math.max(d * 0.62, 0.18));
            gl.uniform1f(shadowLoc.strength, clamp(0.30 - height * 0.03, 0.10, 0.30) * (night ? 0.6 : 1));
            gl.drawArrays(gl.TRIANGLES, 0, 40 * 3);
          }
          gl.depthMask(true); gl.disable(gl.BLEND);
        }

        gl.useProgram(program);
        gl.uniformMatrix4fv(loc.vp, false, state.vp);
        gl.uniform3fv(loc.eye, state.eye);
        gl.uniform1f(loc.night, night ? 1 : 0);
        gl.uniform1f(loc.picking, 0);
        gl.uniform3fv(loc.keyDir, keyDir);
        gl.uniform3fv(loc.fillDir, fillDir);
        gl.uniform3fv(loc.sky, sky);
        gl.uniform3fv(loc.ground, ground);
        for (const mesh of meshes) {
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb); gl.enableVertexAttribArray(loc.position); gl.vertexAttribPointer(loc.position, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nb); gl.enableVertexAttribArray(loc.normal); gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);
          let color = mesh.color;
          if (mesh.selected) color = [Math.min(1, color[0] * 1.14 + .05), Math.min(1, color[1] * 1.14 + .04), Math.min(1, color[2] * 1.14 + .04)];
          gl.uniform4f(loc.color, color[0], color[1], color[2], 1);
          gl.uniform1f(loc.gloss, mesh.gloss);
          gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        }
        const drawError = gl.getError();
        canvas.setAttribute('data-webgl-context', 'webgl1');
        canvas.setAttribute('data-webgl-error', String(drawError));
        if (drawError !== gl.NO_ERROR) { root.setAttribute('data-scene3d-gl-error', String(drawError)); setStatus(`WebGL 渲染错误 ${drawError}`); }
        lastDrawMs = performance.now() - drawStart;
      }

      // 潮位：只更新标记为 tide 的对象（单 part 的 disk），其余缓冲不动
      const applyTide = () => {
        for (const mesh of meshes) {
          const sourceObject = objectById.get(mesh.objectId);
          if (!sourceObject || sourceObject.motion !== 'tide') continue;
          const offset = tide;
          if (mesh.lastTide === offset) continue;
          mesh.lastTide = offset;
          const waterObject = { position: [mesh.basePosition[0], mesh.tideBase + offset, mesh.basePosition[2]], scale: [sourceObject.scale[0], sourceObject.scale[1], sourceObject.scale[2]], rotation: sourceObject.rotation };
          const world = makeWorldGeometry(geometry('disk'), waterObject);
          mesh.world = world;
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb); gl.bufferData(gl.ARRAY_BUFFER, world.positions, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nb); gl.bufferData(gl.ARRAY_BUFFER, world.normals, gl.DYNAMIC_DRAW);
        }
      };
      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.min(2048, Math.round(rect.width * dpr)));
        const h = Math.max(1, Math.min(1200, Math.round(rect.height * dpr)));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h;
          autoDistance = autoFrameDistance(canvas.width / Math.max(1, canvas.height));
          draw();
        }
      };
      const tick = (time) => { if (!auto) { raf = 0; return; } if (time - lastFrame > 24) { yaw += .004; lastFrame = time; draw(); } raf = requestAnimationFrame(tick); };
      const setAuto = (value) => {
        auto = value && !prefersReduced;
        const btn = root.querySelector('[data-scene3d-action="auto-rotate"]');
        if (btn) btn.setAttribute('aria-pressed', String(auto));
        if (auto && !raf) raf = requestAnimationFrame(tick);
        if (!auto && raf) { cancelAnimationFrame(raf); raf = 0; }
        setStatus(prefersReduced && value ? '已启用减少动态效果设置，自动旋转未开启' : (auto ? '自动旋转已开启' : '自动旋转已关闭'));
      };

      canvas.addEventListener('pointerdown', (event) => { if (!cfg.controls.orbit) return; dragging = true; moved = false; lastX = startX = event.clientX; lastY = startY = event.clientY; try { canvas.setPointerCapture(event.pointerId); } catch {} });
      canvas.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const dx = event.clientX - lastX, dy = event.clientY - lastY;
        if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > 4) moved = true;
        yaw += dx * .008; pitch = clamp(pitch + dy * .006, .12, 1.32);
        lastX = event.clientX; lastY = event.clientY; draw();
      });
      const pickObject = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height || !rect.width || !rect.height) return null;
        const state = viewState();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.DITHER); gl.useProgram(program);
        gl.uniformMatrix4fv(loc.vp, false, state.vp); gl.uniform3fv(loc.eye, state.eye); gl.uniform1f(loc.night, night ? 1 : 0); gl.uniform1f(loc.picking, 1);
        for (const mesh of meshes) {
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb); gl.enableVertexAttribArray(loc.position); gl.vertexAttribPointer(loc.position, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nb); gl.enableVertexAttribArray(loc.normal); gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);
          gl.uniform4f(loc.color, mesh.pickId / 255, 0, 0, 1); gl.uniform1f(loc.gloss, 0);
          gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        }
        const px = Math.max(0, Math.min(canvas.width - 1, Math.floor(x * canvas.width / rect.width)));
        const py = Math.max(0, Math.min(canvas.height - 1, canvas.height - 1 - Math.floor(y * canvas.height / rect.height)));
        const pixel = new Uint8Array(4); gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        draw();
        if (!pixel[0]) return null;
        // 复合体：任意内部零件都映射回同一个语义对象
        return meshes.find((mesh) => mesh.pickId === pixel[0]) ?? null;
      };
      const finishDrag = (event) => {
        if (!dragging) return;
        dragging = false;
        if (!moved) { const selected = pickObject(event.clientX, event.clientY); if (selected) setSelected(selected); }
      };
      canvas.addEventListener('pointerup', finishDrag);
      canvas.addEventListener('pointercancel', () => { dragging = false; });
      canvas.addEventListener('wheel', (event) => { if (!cfg.controls.zoom) return; event.preventDefault(); distance = clamp(distance + Math.sign(event.deltaY) * .65, 4, 70); draw(); }, { passive: false });
      canvas.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') yaw -= .12;
        else if (event.key === 'ArrowRight') yaw += .12;
        else if (event.key === 'ArrowUp') pitch = clamp(pitch - .08, .12, 1.32);
        else if (event.key === 'ArrowDown') pitch = clamp(pitch + .08, .12, 1.32);
        else if (event.key === '+' || event.key === '=') distance = clamp(distance - .8, 4, 70);
        else if (event.key === '-') distance = clamp(distance + .8, 4, 70);
        else return;
        event.preventDefault(); draw();
      });
      root.querySelectorAll('[data-scene3d-select]').forEach((button) => button.addEventListener('click', () => {
        const id = button.getAttribute('data-scene3d-select');
        const mesh = meshes.find((item) => item.objectId === id && item.selectable);
        if (mesh) setSelected(mesh);
      }));
      root.querySelector('[data-scene3d-action="reset"]')?.addEventListener('click', resetView);
      root.querySelector('[data-scene3d-action="auto-rotate"]')?.addEventListener('click', () => setAuto(!auto));
      root.querySelector('[data-scene3d-action="day-night"]')?.addEventListener('click', (event) => {
        night = !night; event.currentTarget.setAttribute('aria-pressed', String(night));
        event.currentTarget.textContent = night ? '切换白昼' : '切换夜晚'; draw(); setStatus(night ? '夜景已开启' : '日景已开启');
      });
      root.querySelector('[data-scene3d-tide]')?.addEventListener('input', (event) => {
        tide = Number(event.currentTarget.value) || 0; applyTide(); draw(); setStatus(`潮位 ${tide >= 0 ? '+' : ''}${tide.toFixed(2)}`);
      });
      if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(canvas); else window.addEventListener('resize', resize);

      resize();
      applyTide();
      draw();
      const firstError = gl.getError();
      if (firstError !== gl.NO_ERROR) throw new Error(`WebGL draw reported error ${firstError}`);

      const initMs = Math.round(performance.now() - initStart);
      const metrics = {
        initMs,
        drawMs: Math.round(lastDrawMs * 100) / 100,
        objects: cfg.objects.length,
        meshes: meshes.length,
        triangles: Math.round(totalTriangles),
        parts: meshes.length,
        budget: { maxPartsPerObject: MAX_PARTS_PER_OBJECT, maxTotalTriangles: MAX_TOTAL_TRIANGLES },
        autoFrame: {
          target: autoTarget.map((v) => Math.round(v * 100) / 100),
          radius: Math.round(bounds.radius * 100) / 100,
          distance: Math.round(distance * 100) / 100,
          modelCameraDistance: cfg.cameraDistance,
          overridden: Math.abs(distance - cfg.cameraDistance) > 0.05,
        },
        bounds: { min: bounds.min.map((v) => Math.round(v * 100) / 100), max: bounds.max.map((v) => Math.round(v * 100) / 100) },
        canvas: { width: canvas.width, height: canvas.height },
      };
      // ---- M7-B4D：主体实际可见占幅（AABB 八角投影）----
      // 用真实 mesh 顶点累计出的 objectFrames（不是 scale 猜测），投影矩阵取当前相机。
      // 这是**近似指标**：不等于主体真实像素面积，也不等于视觉焦点是否成立。
      let subjectCoverage = null;
      try {
        const framesObj = {};
        for (const [oid, fr] of objectFrames) framesObj[oid] = { min: fr.min, max: fr.max };
        const measureState = viewState();
        subjectCoverage = evaluateSubjectCoverage({
          brief: cfg.sceneBrief || null,
          objectFrames: framesObj,
          viewProjection: measureState.vp,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        });
        metrics.subjectCoverage = {
          subjectId: subjectCoverage.subjectId,
          verdict: subjectCoverage.verdict,
          widthRatio: subjectCoverage.measurement ? subjectCoverage.measurement.widthRatio : null,
          heightRatio: subjectCoverage.measurement ? subjectCoverage.measurement.heightRatio : null,
          areaRatio: subjectCoverage.measurement ? subjectCoverage.measurement.areaRatio : null,
          clipped: subjectCoverage.measurement ? subjectCoverage.measurement.clipped : null,
          measureStatus: subjectCoverage.measurement ? subjectCoverage.measurement.status : 'no_measurement',
          projectedBounds: subjectCoverage.measurement ? subjectCoverage.measurement.projectedBounds : null,
          target: subjectCoverage.target,
          reasons: subjectCoverage.reasons,
          method: 'aabb-8corner-projection',
          approx: true,
        };
        root.setAttribute('data-scene3d-subject-coverage', JSON.stringify(metrics.subjectCoverage));
      } catch (e) {
        // 测量失败绝不等于通过
        metrics.subjectCoverage = { subjectId: null, verdict: 'warning', measureStatus: 'measure_failed', reason: String((e && e.message) || e).slice(0, 140), approx: true };
        root.setAttribute('data-scene3d-subject-coverage', JSON.stringify(metrics.subjectCoverage));
      }
      root.setAttribute('data-scene3d-metrics', JSON.stringify(metrics));
      setStatus(`WebGL 三维场景已初始化：${cfg.objects.length} 个对象 / ${meshes.length} 个网格 / ${metrics.triangles} 三角形（${initMs}ms）`);
      if (auto) setAuto(true);
      root.setAttribute('data-scene3d-status', 'ready');
      root.setAttribute('data-scene3d-gl-error', String(firstError));
    } catch (err) {
      if (status) status.textContent = '三维场景初始化失败';
      if (error) { error.hidden = false; error.textContent = '三维场景无法初始化。当前输出没有用静态图片代替真实 3D。请检查 WebGL 支持及浏览器控制台。'; }
      root.setAttribute('data-scene3d-status', 'error');
    }
  }
}

export const SCENE3D_RUNTIME = SUBJECT_COVERAGE_SOURCE + '\n' + `(${scene3dRuntimeMain.toString()})();`;
