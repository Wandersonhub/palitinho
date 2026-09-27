// Cenário de boteco em 3D de verdade (Three.js/WebGL), só decorativo.
// Roda atrás da mesa (CSS) sem mexer na posição dos assentos.
// Se o dispositivo não tiver WebGL, cai no gradiente CSS do .bar-back e segue o jogo normalmente.
import * as THREE from './vendor/three.module.min.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function wallTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#5c4a3a'); grd.addColorStop(1, '#382b21');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(20,14,9,.4)'; g.lineWidth = 2;
    for (let x = 20; x < w; x += 46) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,.14)';
    for (let i = 0; i < 26; i++) {
      const rx = Math.random() * w, ry = Math.random() * h, r = 8 + Math.random() * 30;
      g.beginPath(); g.ellipse(rx, ry, r, r * .3, Math.random() * Math.PI, 0, Math.PI * 2); g.fill();
    }

    // relógio redondo de parede, igual boteco de verdade
    g.save(); g.translate(392, 66);
    g.fillStyle = '#e9e2d2'; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a1410'; g.lineWidth = 3; g.stroke();
    g.strokeStyle = '#2a221a'; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(10, -8); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-3, 15); g.stroke();
    g.fillStyle = '#c0392b'; g.beginPath(); g.arc(0, 0, 2.4, 0, Math.PI * 2); g.fill();
    g.restore();

    // cartaz/calendário colado de qualquer jeito
    g.save(); g.translate(120, 44); g.rotate(-0.045);
    g.fillStyle = '#e3ded0'; g.fillRect(0, 0, 72, 96);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.strokeRect(0, 0, 72, 96);
    g.fillStyle = '#b23a2e'; g.fillRect(6, 8, 60, 16);
    g.fillStyle = 'rgba(30,24,16,.5)';
    for (let i = 0; i < 6; i++) g.fillRect(8, 34 + i * 10, 52 - (i % 2) * 14, 4);
    g.fillStyle = '#cfae3c'; g.fillRect(30, -4, 12, 10);
    g.restore();

    // recibo/tabela de preço pregada perto do balcão
    g.save(); g.translate(300, 150); g.rotate(0.03);
    g.fillStyle = '#efe8d8'; g.fillRect(0, 0, 46, 60);
    g.strokeStyle = 'rgba(0,0,0,.2)'; g.strokeRect(0, 0, 46, 60);
    g.fillStyle = 'rgba(30,24,16,.55)';
    for (let i = 0; i < 5; i++) g.fillRect(5, 8 + i * 10, 36, 3);
    g.restore();
  });
}

function floorTileTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const n = 4, cell = w / n;
    for (let yi = 0; yi < n; yi++) {
      for (let xi = 0; xi < n; xi++) {
        g.fillStyle = (xi + yi) % 2 === 0 ? '#b6392c' : '#d8cfbd';
        g.fillRect(xi * cell, yi * cell, cell, cell);
      }
    }
    g.strokeStyle = 'rgba(20,14,9,.4)'; g.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(w, i * cell); g.stroke();
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, h); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.15)';
    for (let i = 0; i < 30; i++) {
      const rx = Math.random() * w, ry = Math.random() * h, r = 3 + Math.random() * 9;
      g.beginPath(); g.ellipse(rx, ry, r, r * .6, Math.random() * Math.PI, 0, Math.PI * 2); g.fill();
    }
  });
}

function counterTexture() {
  return canvasTexture(512, 160, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#6b4526'); grd.addColorStop(.15, '#4a2f18'); grd.addColorStop(1, '#231409');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.22)';
    for (let i = 0; i < 10; i++) {
      const ry = Math.random() * h, rw = 60 + Math.random() * 160;
      g.fillRect(Math.random() * w, ry, rw, 3 + Math.random() * 4);
    }
    g.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = 0; i < 6; i++) g.fillRect(Math.random() * w, Math.random() * h, 40 + Math.random() * 90, 2);
  });
}

function dogTexture() {
  return canvasTexture(340, 240, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.save(); g.translate(40, 160);

    // sombra no chão
    g.fillStyle = 'rgba(0,0,0,.3)';
    g.beginPath(); g.ellipse(90, 26, 118, 14, 0, 0, Math.PI * 2); g.fill();

    // rabo enroscado (atrás do corpo)
    g.fillStyle = '#b87a3c';
    g.beginPath();
    g.moveTo(-34, 6);
    g.bezierCurveTo(-58, -6, -56, -34, -30, -38);
    g.bezierCurveTo(-10, -40, -6, -22, -20, -16);
    g.bezierCurveTo(-28, -13, -26, -2, -10, 4);
    g.closePath(); g.fill();

    // corpo deitado, enroscado
    g.fillStyle = '#c98a4a';
    g.beginPath();
    g.moveTo(-38, 10);
    g.bezierCurveTo(-48, -22, -6, -36, 40, -32);
    g.bezierCurveTo(76, -30, 96, -34, 118, -26);
    g.bezierCurveTo(140, -18, 138, 4, 116, 6);
    g.bezierCurveTo(126, 16, 112, 30, 88, 34);
    g.bezierCurveTo(40, 44, -10, 38, -38, 22);
    g.closePath(); g.fill();

    // orelha caída
    g.fillStyle = '#a8703a';
    g.beginPath();
    g.moveTo(112, -30);
    g.bezierCurveTo(130, -34, 140, -22, 132, -8);
    g.bezierCurveTo(126, 0, 112, -4, 110, -16);
    g.closePath(); g.fill();

    // focinho
    g.fillStyle = '#c98a4a';
    g.beginPath(); g.ellipse(132, -6, 16, 11, -0.15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2413';
    g.beginPath(); g.ellipse(146, -4, 5, 3.6, -0.1, 0, Math.PI * 2); g.fill();

    // olho fechado (sono)
    g.strokeStyle = '#5a3a1e'; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(104, -14); g.quadraticCurveTo(112, -9, 120, -13); g.stroke();

    // pata dobrada na frente
    g.fillStyle = '#b87a3c';
    g.beginPath(); g.ellipse(96, 20, 20, 9, 0.1, 0, Math.PI * 2); g.fill();

    // zzz de quem está tirando uma soneca
    g.fillStyle = 'rgba(239,227,207,.8)'; g.font = 'italic 22px Georgia, serif';
    g.fillText('z z z', 120, -46);

    g.restore();
  });
}

function bottle(color, h, capColor) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.13, h, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.86 })
  );
  body.position.y = h / 2; body.castShadow = true;
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.09, h * 0.32, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.86 })
  );
  neck.position.y = h + h * 0.16;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10),
    new THREE.MeshStandardMaterial({ color: capColor || '#c9a24a', roughness: 0.4, metalness: 0.5 })
  );
  cap.position.y = h + h * 0.32 + 0.02;
  g.add(body, neck, cap);
  return g;
}

// garrafa com isopor (coolerzinho amarelo) — clássico de boteco
function bottleWithKoozie(h) {
  const g = bottle('#1f5c3a', h, '#c9a24a');
  const koozie = new THREE.Mesh(
    new THREE.CylinderGeometry(0.145, 0.135, h * 0.62, 16),
    new THREE.MeshStandardMaterial({ color: '#f4c623', roughness: 0.8 })
  );
  koozie.position.y = h * 0.34;
  koozie.castShadow = true;
  g.add(koozie);
  return g;
}

function glassOfBeer(scale) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09 * scale, 0.075 * scale, 0.22 * scale, 16, 1, true),
    new THREE.MeshPhysicalMaterial({ color: '#eaf4ee', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
  );
  glass.position.y = 0.11 * scale;
  const beer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.082 * scale, 0.07 * scale, 0.15 * scale, 16),
    new THREE.MeshStandardMaterial({ color: '#f0b93a', roughness: 0.25, transparent: true, opacity: 0.92 })
  );
  beer.position.y = 0.08 * scale;
  const foam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.086 * scale, 0.086 * scale, 0.045 * scale, 16),
    new THREE.MeshStandardMaterial({ color: '#fff8e8', roughness: 0.9 })
  );
  foam.position.y = 0.178 * scale;
  g.add(glass, beer, foam);
  return g;
}

export function initBarScene(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch (e) {
    return null; // sem WebGL: fica só o gradiente CSS do .bar-back
  }
  renderer.setClearColor(0x120c08, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  camera.position.set(0, 1.75, 4.7);
  camera.lookAt(0, 1.15, -1.8);

  scene.add(new THREE.HemisphereLight(0x8a7a63, 0x120c08, 1.0));
  scene.add(new THREE.AmbientLight(0x2b2018, 0.35));
  const bulb = new THREE.PointLight(0xffcf8a, 22, 14, 2);
  bulb.position.set(0.3, 3.1, -1.2);
  bulb.castShadow = true;
  bulb.shadow.mapSize.set(512, 512);
  scene.add(bulb);

  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.2), wallMat);
  wall.position.set(0, 2.1, -3.4);
  wall.receiveShadow = true;
  scene.add(wall);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), new THREE.MeshStandardMaterial({ map: floorTileTexture(), roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  const counterMat = new THREE.MeshStandardMaterial({ map: counterTexture(), roughness: 0.85 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(13, 0.9, 1.0), counterMat);
  counter.position.set(0, 0.45, -2.0);
  counter.castShadow = true; counter.receiveShadow = true;
  scene.add(counter);
  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(13, 0.05, 1.0), new THREE.MeshStandardMaterial({ color: '#8a6238', roughness: 0.5 }));
  counterTop.position.set(0, 0.925, -2.0);
  counterTop.receiveShadow = true;
  scene.add(counterTop);

  const shelfMat = new THREE.MeshStandardMaterial({ color: '#5a3d26', roughness: 0.8 });
  const shelfL = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 0.42), shelfMat);
  shelfL.position.set(-3.2, 2.5, -3.0);
  shelfL.castShadow = true; shelfL.receiveShadow = true;
  scene.add(shelfL);
  const shelfR = shelfL.clone();
  shelfR.position.set(3.3, 2.55, -3.0);
  scene.add(shelfR);

  const bottleColors = ['#8a5a22', '#3f5a3a', '#a67a3a', '#6b3a20'];
  const spreadShelf = (shelf, count, seed) => {
    const box = shelf.position.x;
    const start = box - 1.7, step = 3.4 / (count - 1);
    for (let i = 0; i < count; i++) {
      const h = 0.42 + ((seed + i * 37) % 17) / 100;
      const b = bottle(bottleColors[(seed + i) % bottleColors.length], h);
      b.position.set(start + i * step, shelf.position.y + 0.05, shelf.position.z + 0.02);
      b.rotation.y = ((seed + i * 13) % 10 - 5) * 0.03;
      b.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(b);
    }
  };
  spreadShelf(shelfL, 7, 3);
  spreadShelf(shelfR, 6, 11);

  const ledge = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: '#8a6238', roughness: 0.6 }));
  ledge.position.set(3.35, 1.78, -2.55);
  ledge.receiveShadow = true; ledge.castShadow = true;
  scene.add(ledge);

  const beerGroup = new THREE.Group();
  const koozieBottle = bottleWithKoozie(0.4);
  koozieBottle.position.set(-0.62, 0, 0.03);
  const beerBottle = bottle('#1f5c3a', 0.42, '#c9a24a');
  beerBottle.position.set(-0.28, 0, 0);
  const g1 = glassOfBeer(1); g1.position.set(0.09, 0, 0.02);
  const g2 = glassOfBeer(0.88); g2.position.set(0.36, 0, -0.02);
  beerGroup.add(koozieBottle, beerBottle, g1, g2);
  beerGroup.position.set(3.35, 1.85, -2.55);
  beerGroup.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(beerGroup);

  const dogMat = new THREE.MeshBasicMaterial({ map: dogTexture(), transparent: true, alphaTest: 0.2 });
  dogMat.toneMapped = false;
  const dog = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.45), dogMat);
  dog.position.set(-2.05, 0.72, 0.35);
  dog.rotation.y = 0.4;
  dog.castShadow = true;
  scene.add(dog);

  let flicker = 0;
  function renderFrame() {
    renderer.render(scene, camera);
  }
  const HALF_H_DEG = 25; // meta de campo de visão horizontal (mantém garrafas/cachorro visíveis nas laterais mesmo no celular em pé)
  function resize() {
    const el = canvas.parentElement;
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    const aspect = w / h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    const halfHRad = HALF_H_DEG * Math.PI / 180;
    const halfVRad = Math.atan(Math.tan(halfHRad) / aspect);
    camera.fov = Math.min(95, Math.max(28, halfVRad * 2 * 180 / Math.PI));
    camera.updateProjectionMatrix();
    renderFrame();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);
  resize();

  // luz de boteco: um leve tremular de vez em quando, sem loop contínuo (poupa bateria)
  const tick = () => {
    flicker = (flicker + 1) % 1000;
    bulb.intensity = 20 + Math.sin(flicker * 0.7) * 1.5 + Math.random() * 0.8;
    renderFrame();
  };
  const timer = setInterval(tick, 2600);

  return {
    dispose() {
      clearInterval(timer);
      ro.disconnect();
      renderer.dispose();
    }
  };
}
