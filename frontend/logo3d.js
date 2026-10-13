// remnant 로고 — 하나의 고정된 도형이 아니라 "별 같은 점들의 모임"이어야 한다.
// "remnant" 글자 모양 위에서 점을 뽑아 점구름으로 띄우고, 마우스를 갖다 대면
// 그 주변 점들만 바깥으로 살짝 밀려났다가 서서히 제자리로 돌아온다. 입력창에
// 뭔가 입력하는 순간 점들이 사방으로 흩어지며 로고가 자연스럽게 사라진다.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const container = document.getElementById('logo3d');
if (container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 2000);
  camera.position.set(0, 0, 420);

  const group = new THREE.Group();
  scene.add(group);

  function sizeToContainer() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // 점 하나하나를 부드러운 동그란 빛으로 그릴 때 쓸 스프라이트(캔버스에 방사형
  // 그라데이션을 그려서 텍스처로 쓴다) — 별처럼 보이려면 각 모서리 또렷한 사각형
  // 점이 아니라 이렇게 번지는 동그란 점이어야 한다.
  function makeSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // "remnant"를 큰 캔버스에 커시브체로 그린 뒤, 글자가 실제로 칠해진 픽셀
  // 위치만 일정 간격으로 샘플링해서 점 좌표로 쓴다 — 그래서 로고가 꽉 찬 도형이
  // 아니라 글자 모양을 따라 흩뿌려진 별들의 집합이 된다.
  function sampleTextPoints() {
    const W = 1400, H = 460;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '220px "Pacifico", cursive';
    ctx.fillText('remnant', W / 2, H / 2 + 10);
    const data = ctx.getImageData(0, 0, W, H).data;
    const pts = [];
    const stride = 7; // 간격을 넓혀서 별들이 너무 빽빽하지 않게 한다
    for (let y = 0; y < H; y += stride) {
      for (let x = 0; x < W; x += stride) {
        const a = data[(y * W + x) * 4 + 3];
        if (a > 120) {
          // 가장자리에 살짝 무작위를 섞어 "꽉 찬 글자"가 아니라 입자가 모여
          // 글자를 이루는 느낌을 준다.
          const jx = (Math.random() - 0.5) * stride;
          const jy = (Math.random() - 0.5) * stride;
          pts.push([x + jx - W / 2, -(y + jy - H / 2)]);
        }
      }
    }
    return pts;
  }

  await document.fonts.load('220px "Pacifico"').catch(() => {});
  // ↑ Pacifico 웹폰트가 다 로드되기 전에 캔버스에 그리면 브라우저가 기본
  // 대체 글꼴로 그려버려서(그러면 로고 점 모양이 매번 달라진다), 로드를
  // 명시적으로 기다린 뒤에 샘플링한다.

  const rawPts = sampleTextPoints();
  const COUNT = rawPts.length;
  const SCALE = 1.0; // 캔버스 픽셀 좌표 -> 3D 월드 단위 축소 비율(로고 전체 크기)
  const DEPTH = 14; // 점구름에 살짝 두께를 줘서 완전히 납작하지 않게 한다

  const basePositions = new Float32Array(COUNT * 3);
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const twinklePhase = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    const [px, py] = rawPts[i];
    const x = px * SCALE, y = py * SCALE, z = (Math.random() - 0.5) * DEPTH;
    basePositions[i * 3] = x; basePositions[i * 3 + 1] = y; basePositions[i * 3 + 2] = z;
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    // 은은한 흰색/푸른빛 별들 사이에 가끔 따뜻한 색 하나씩 — 참고 이미지(은하)의
    // 색감을 살짝 빌려온다.
    const warm = Math.random() < 0.12;
    const tint = warm ? 0.75 + Math.random() * 0.2 : 0.85 + Math.random() * 0.15;
    colors[i * 3] = warm ? 1 : tint;
    colors[i * 3 + 1] = warm ? 0.78 + Math.random() * 0.15 : tint;
    colors[i * 3 + 2] = warm ? 0.55 : 1;
    twinklePhase[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 7.5, map: makeSprite(), transparent: true, opacity: 1,
    vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });
  const points = new THREE.Points(geometry, material);
  group.add(points);

  // ---- 상태 ----
  // 회전(자동 회전·드래그 360도)은 없앴다 — 로고는 고정된 채로, 마우스를
  // 갖다 댔을 때 근처 별들만 반응한다.
  let scattered = false, animating = false;
  const displacement = new Float32Array(COUNT * 3); // 현재 밀려난 거리(기준 위치 대비)
  const pushTarget = new Float32Array(COUNT * 3); // 이번 프레임에 밀어내야 할 목표 변위
  const mouseLocal = new THREE.Vector3(1e9, 1e9, 1e9); // 점구름 로컬 좌표계에서의 마우스 위치
  let hasMouse = false;
  // 점마다 살짝 다른 반응 세기·속도를 주기 위한 무작위 값 — 전부 똑같이
  // 반응하면 기계적인 원 모양으로 딱 밀려나 보이기 때문에 미리 하나씩 뽑아둔다.
  const pushJitter = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) pushJitter[i] = 0.7 + Math.random() * 0.6;

  function screenToLocal(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const vec = new THREE.Vector3(nx, ny, 0.5).unproject(camera);
    const dir = vec.sub(camera.position).normalize();
    const t = -camera.position.z / dir.z; // z=0 평면과의 교점(월드 좌표)
    const world = camera.position.clone().add(dir.multiplyScalar(t));
    return group.worldToLocal(world);
  }
  function onPointerMove(e) {
    if (scattered) return;
    const local = screenToLocal(e.clientX, e.clientY);
    mouseLocal.copy(local); hasMouse = true;
  }
  function onPointerLeave() { hasMouse = false; }
  window.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerleave', onPointerLeave);

  // ---- 흩어짐 / 재구성 ----
  function scatterRemnantLogo() {
    if (scattered || animating) return;
    animating = true;
    const start = performance.now(), dur = 820;
    const dirs = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const theta = Math.random() * Math.PI * 2, phi = Math.acos(Math.random() * 2 - 1);
      const r = 420 + Math.random() * 520;
      dirs[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      dirs[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
      dirs[i * 3 + 2] = Math.cos(phi) * r;
    }
    const posAttr = geometry.getAttribute('position');
    function step(now) {
      const q = Math.min(1, (now - start) / dur), e = q * q * (3 - 2 * q);
      for (let i = 0; i < COUNT; i++) {
        posAttr.array[i * 3] = basePositions[i * 3] + dirs[i * 3] * e;
        posAttr.array[i * 3 + 1] = basePositions[i * 3 + 1] + dirs[i * 3 + 1] * e;
        posAttr.array[i * 3 + 2] = basePositions[i * 3 + 2] + dirs[i * 3 + 2] * e;
      }
      posAttr.needsUpdate = true;
      material.opacity = 1 - e;
      if (q < 1) { requestAnimationFrame(step); return; }
      scattered = true; animating = false;
      container.style.pointerEvents = 'none';
    }
    requestAnimationFrame(step);
  }

  function resetRemnantLogo() {
    if (animating) return;
    animating = true;
    scattered = false;
    container.style.pointerEvents = '';
    displacement.fill(0);
    const posAttr = geometry.getAttribute('position');
    const start = performance.now(), dur = 700;
    // 흩어진 자리에서 시작해 다시 모여든다.
    const from = posAttr.array.slice();
    function step(now) {
      const q = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - q, 3);
      for (let i = 0; i < COUNT * 3; i++) posAttr.array[i] = from[i] + (basePositions[i] - from[i]) * e;
      posAttr.needsUpdate = true;
      material.opacity = e;
      if (q < 1) { requestAnimationFrame(step); return; }
      animating = false;
    }
    requestAnimationFrame(step);
  }
  window.scatterRemnantLogo = scatterRemnantLogo;
  window.resetRemnantLogo = resetRemnantLogo;

  // ---- 메인 루프 ----
  function animate(now) {
    requestAnimationFrame(animate);
    // 다 흩어진 뒤(그리고 다시 모이는 애니메이션 중이 아닐 때)는 더 그릴 게
    // 없으니 렌더를 쉰다 — 추론 과정이 진행되는 내내 계속 그릴 이유가 없다.
    // resetRemnantLogo()가 다시 animating을 켜면 자연스럽게 재개된다.
    if (scattered && !animating) return;

    // 마우스 근처 점들을 아주 살짝 밀어낸다 — 밀려날 때도 돌아올 때도 천천히,
    // 점마다 세기·속도가 조금씩 달라서 기계적인 원 모양으로 딱 밀려나지 않는다.
    const posAttr = geometry.getAttribute('position');
    if (!animating) {
      const RADIUS = 52, STRENGTH = 13;
      pushTarget.fill(0);
      if (hasMouse) {
        for (let i = 0; i < COUNT; i++) {
          const bx = basePositions[i * 3], by = basePositions[i * 3 + 1], bz = basePositions[i * 3 + 2];
          const dx = bx - mouseLocal.x, dy = by - mouseLocal.y, dz = bz - mouseLocal.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < RADIUS && dist > 0.001) {
            const n = 1 - dist / RADIUS;
            const f = n * n * STRENGTH * pushJitter[i]; // 부드러운 감쇠 + 점마다 다른 세기
            pushTarget[i * 3] = (dx / dist) * f;
            pushTarget[i * 3 + 1] = (dy / dist) * f;
            pushTarget[i * 3 + 2] = (dz / dist) * f;
          }
        }
      }
      for (let i = 0; i < COUNT; i++) {
        const jr = pushJitter[i];
        for (let k = 0; k < 3; k++) {
          const idx = i * 3 + k, target = pushTarget[idx];
          // 밀려날 땐 완만하게, 돌아올 땐 그보다 훨씬 천천히 — 둘 다 점마다
          // 속도가 살짝씩 달라서 한꺼번에 딱 맞춰 움직이지 않는다.
          const rate = target !== 0 ? 0.09 * jr : 0.025 * jr;
          displacement[idx] += (target - displacement[idx]) * rate;
        }
      }
      const t = now * 0.002;
      for (let i = 0; i < COUNT; i++) {
        // 별처럼 은은하게 반짝이도록 아주 살짝 흔든다.
        const tw = Math.sin(t + twinklePhase[i]) * 0.6;
        posAttr.array[i * 3] = basePositions[i * 3] + displacement[i * 3];
        posAttr.array[i * 3 + 1] = basePositions[i * 3 + 1] + displacement[i * 3 + 1] + tw;
        posAttr.array[i * 3 + 2] = basePositions[i * 3 + 2] + displacement[i * 3 + 2];
      }
      posAttr.needsUpdate = true;
    }

    renderer.render(scene, camera);
    if (!container.classList.contains('ready')) container.classList.add('ready');
  }

  window.addEventListener('resize', sizeToContainer);
  sizeToContainer();
  requestAnimationFrame(animate);
}
