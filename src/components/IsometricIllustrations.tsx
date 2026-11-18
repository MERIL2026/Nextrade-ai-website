import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

function createPlatformGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#E4E8F2';
    ctx.lineWidth = 2;
    const step = 32;
    for (let i = 0; i <= 512; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    // Subtle cobalt calibration border
    ctx.strokeStyle = 'rgba(45, 70, 230, 0.28)';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 472, 472);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSparklineCardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 340;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 512, 340);

    // Subtle header lines
    ctx.fillStyle = '#2D46E6';
    ctx.font = 'bold 26px "JetBrains Mono", monospace';
    ctx.fillText('NSE / US', 36, 56);

    ctx.fillStyle = '#16A34A';
    ctx.font = 'bold 22px "JetBrains Mono", monospace';
    ctx.fillText('+2.19%', 390, 56);

    // Gridlines
    ctx.strokeStyle = '#E4E8F2';
    ctx.lineWidth = 2;
    for (let y = 110; y <= 270; y += 54) {
      ctx.beginPath();
      ctx.moveTo(36, y);
      ctx.lineTo(476, y);
      ctx.stroke();
    }

    // Chart area gradient
    const pts: [number, number][] = [
      [36, 255],
      [108, 232],
      [176, 244],
      [246, 186],
      [320, 196],
      [396, 134],
      [472, 98],
    ];
    const grad = ctx.createLinearGradient(0, 98, 0, 275);
    grad.addColorStop(0, 'rgba(45, 70, 230, 0.22)');
    grad.addColorStop(1, 'rgba(45, 70, 230, 0.0)');
    ctx.beginPath();
    ctx.moveTo(pts[0][0], 275);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(pts[pts.length - 1][0], 275);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Chart line
    ctx.beginPath();
    pts.forEach(([x, y], idx) => {
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#2D46E6';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Terminal highlight dot
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(last[0], last[1], 10, 0, Math.PI * 2);
    ctx.fillStyle = '#2D46E6';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(last[0], last[1], 5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createTelemetryBarsTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 440;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 440, 360);

    ctx.fillStyle = '#080B12';
    ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('RISK DISPERSION', 32, 54);

    const bars = [
      { label: 'NIFTY', w: 260, color: '#2D46E6' },
      { label: 'S&P 500', w: 310, color: '#4E66F0' },
      { label: 'BETA', w: 195, color: '#080B12' },
      { label: 'VOL', w: 235, color: '#16A34A' },
    ];
    bars.forEach((b, i) => {
      const y = 98 + i * 60;
      ctx.fillStyle = '#667085';
      ctx.font = 'bold 18px "JetBrains Mono", monospace';
      ctx.fillText(b.label, 32, y + 18);

      ctx.fillStyle = '#EFF2FA';
      ctx.fillRect(130, y, 278, 24);

      ctx.fillStyle = b.color;
      ctx.fillRect(130, y, b.w * 0.85, 24);
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 18, 128, 128, 126);
    grad.addColorStop(0, 'rgba(45, 70, 230, 0.22)');
    grad.addColorStop(0.55, 'rgba(15, 23, 42, 0.08)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const HeroIsometricEngine: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || 520;
    const height = container.clientHeight || 440;

    const scene = new THREE.Scene();

    const frustumSize = 4.65;
    const aspect = width / height;
    const camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      50,
    );
    camera.position.set(6.8, 5.4, 6.8);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    // 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xf3f6ff, 0xd8e0f5, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffaf2, 1.85);
    keyLight.position.set(5.5, 8.5, 4.5);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 22;
    keyLight.shadow.camera.left = -4.5;
    keyLight.shadow.camera.right = 4.5;
    keyLight.shadow.camera.top = 4.5;
    keyLight.shadow.camera.bottom = -4.5;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x6378f2, 1.05);
    rimLight.position.set(-5.0, 4.0, -5.0);
    scene.add(rimLight);

    // Materials & Disposable Trackers
    const disposables: { dispose: () => void }[] = [envTexture];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    const gridTex = track(createPlatformGridTexture());
    const sparkTex = track(createSparklineCardTexture());
    const barsTex = track(createTelemetryBarsTexture());
    const shadowTex = track(createContactShadowTexture());
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    gridTex.anisotropy = maxAniso;
    sparkTex.anisotropy = maxAniso;
    barsTex.anisotropy = maxAniso;

    const ceramicWhiteMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.34,
        metalness: 0.06,
      }),
    );
    const slateMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xeaf0fc,
        roughness: 0.42,
        metalness: 0.12,
      }),
    );
    const gridSurfaceMat = track(
      new THREE.MeshStandardMaterial({
        map: gridTex,
        roughness: 0.4,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    const cobaltMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x2d46e6,
        roughness: 0.22,
        metalness: 0.35,
        clearcoat: 0.75,
        clearcoatRoughness: 0.18,
      }),
    );
    const brightCobaltMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x4b63f5,
        roughness: 0.18,
        metalness: 0.3,
        clearcoat: 0.9,
        clearcoatRoughness: 0.12,
        emissive: 0x16269a,
        emissiveIntensity: 0.22,
      }),
    );
    const brushedSilverMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xdbe3f6,
        roughness: 0.2,
        metalness: 0.85,
      }),
    );
    const glassLensMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x99b2ff,
        roughness: 0.06,
        metalness: 0.0,
        transmission: isSoftwareGl ? 0 : 0.85,
        transparent: true,
        opacity: isSoftwareGl ? 0.45 : 1,
        ior: 1.55,
        thickness: 0.6,
        clearcoat: 1.0,
      }),
    );
    const greenAccentMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x16a34a,
        roughness: 0.3,
        metalness: 0.2,
        emissive: 0x16a34a,
        emissiveIntensity: 0.18,
      }),
    );

    // Master Root Sculpture Group
    const rootGroup = new THREE.Group();
    rootGroup.position.set(0, -0.35, 0);
    scene.add(rootGroup);

    // Soft Ground Contact Shadow
    const shadowGeo = track(new THREE.PlaneGeometry(5.6, 5.6));
    const shadowMat = track(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
      }),
    );
    const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = -0.36;
    rootGroup.add(contactShadow);

    // Helper for beveled rounded-rect extruded slab
    const createRoundedRectShape = (w: number, d: number, r: number) => {
      const shape = new THREE.Shape();
      const hw = w / 2;
      const hd = d / 2;
      shape.moveTo(-hw + r, -hd);
      shape.lineTo(hw - r, -hd);
      shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
      shape.lineTo(hw, hd - r);
      shape.quadraticCurveTo(hw, hd, hw - r, hd);
      shape.lineTo(-hw + r, hd);
      shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
      shape.lineTo(-hw, -hd + r);
      shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
      return shape;
    };

    // 1. Primary Cobalt Architectural Plinth + Ceramic Upper Deck
    const lowerBaseGeo = track(
      new THREE.ExtrudeGeometry(createRoundedRectShape(3.55, 3.55, 0.26), {
        depth: 0.2,
        bevelEnabled: true,
        bevelThickness: 0.04,
        bevelSize: 0.04,
        bevelSegments: 3,
      }),
    );
    lowerBaseGeo.rotateX(-Math.PI / 2);
    const lowerBase = new THREE.Mesh(lowerBaseGeo, cobaltMat);
    lowerBase.position.y = -0.26;
    lowerBase.receiveShadow = true;
    lowerBase.castShadow = true;
    rootGroup.add(lowerBase);

    const upperDeckGeo = track(
      new THREE.ExtrudeGeometry(createRoundedRectShape(3.38, 3.38, 0.22), {
        depth: 0.14,
        bevelEnabled: true,
        bevelThickness: 0.035,
        bevelSize: 0.035,
        bevelSegments: 3,
      }),
    );
    upperDeckGeo.rotateX(-Math.PI / 2);
    const upperDeck = new THREE.Mesh(upperDeckGeo, ceramicWhiteMat);
    upperDeck.position.y = -0.04;
    upperDeck.receiveShadow = true;
    upperDeck.castShadow = true;
    rootGroup.add(upperDeck);

    // Top calibrated grid inlay
    const gridPlaneGeo = track(new THREE.PlaneGeometry(3.05, 3.05));
    const gridPlane = new THREE.Mesh(gridPlaneGeo, gridSurfaceMat);
    gridPlane.rotation.x = -Math.PI / 2;
    gridPlane.position.y = 0.142;
    gridPlane.receiveShadow = true;
    rootGroup.add(gridPlane);

    // 2. Market Data Pipeline Track + Animated Data Blocks
    const trackGeo = track(new THREE.BoxGeometry(2.65, 0.06, 0.62));
    const pipelineTrack = new THREE.Mesh(trackGeo, slateMat);
    pipelineTrack.position.set(-0.08, 0.17, 0.56);
    pipelineTrack.receiveShadow = true;
    rootGroup.add(pipelineTrack);

    const blockGeo = track(new THREE.BoxGeometry(0.26, 0.14, 0.28));
    const blockCapGeo = track(new THREE.BoxGeometry(0.28, 0.04, 0.3));
    const pipelineBlocks: { group: THREE.Group; phase: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const bGroup = new THREE.Group();
      const body = new THREE.Mesh(blockGeo, i % 2 === 0 ? cobaltMat : ceramicWhiteMat);
      body.castShadow = true;
      const cap = new THREE.Mesh(blockCapGeo, i % 2 === 0 ? brushedSilverMat : cobaltMat);
      cap.position.y = 0.08;
      bGroup.add(body, cap);
      bGroup.position.set(0, 0.27, 0.56);
      rootGroup.add(bGroup);
      pipelineBlocks.push({ group: bGroup, phase: i / 4 });
    }

    // 3. Central Optical Inspection Pedestal + Levitating Faceted Core
    const stageBaseGeo = track(new THREE.CylinderGeometry(0.74, 0.84, 0.14, 40));
    const stageBase = new THREE.Mesh(stageBaseGeo, slateMat);
    stageBase.position.set(-0.08, 0.21, -0.18);
    stageBase.castShadow = true;
    stageBase.receiveShadow = true;
    rootGroup.add(stageBase);

    const stageRingGeo = track(new THREE.TorusGeometry(0.68, 0.045, 16, 48));
    const stageRing = new THREE.Mesh(stageRingGeo, cobaltMat);
    stageRing.rotation.x = Math.PI / 2;
    stageRing.position.set(-0.08, 0.29, -0.18);
    rootGroup.add(stageRing);

    const stageWellGeo = track(new THREE.CylinderGeometry(0.56, 0.56, 0.04, 36));
    const stageWell = new THREE.Mesh(stageWellGeo, glassLensMat);
    stageWell.position.set(-0.08, 0.285, -0.18);
    rootGroup.add(stageWell);

    // Floating Faceted Intelligence Crystal + Gyroscopic Halo
    const crystalGroup = new THREE.Group();
    crystalGroup.position.set(-0.08, 0.72, -0.18);
    rootGroup.add(crystalGroup);

    const crystalGeo = track(new THREE.OctahedronGeometry(0.32, 0));
    const crystalMesh = new THREE.Mesh(crystalGeo, brightCobaltMat);
    crystalMesh.castShadow = true;
    crystalGroup.add(crystalMesh);

    const haloGeo = track(new THREE.TorusGeometry(0.47, 0.018, 12, 48));
    const haloMesh = new THREE.Mesh(haloGeo, brushedSilverMat);
    haloMesh.rotation.x = Math.PI / 2.6;
    crystalGroup.add(haloMesh);

    // 4. Articulated Twin-Barrel Optical Microscope Gantry (Back-Right)
    const gantryGroup = new THREE.Group();
    gantryGroup.position.set(0.86, 0.14, -0.78);
    gantryGroup.rotation.y = -Math.PI / 4;
    rootGroup.add(gantryGroup);

    // Gantry Footing
    const footGeo = track(new THREE.BoxGeometry(0.68, 0.18, 0.68));
    const foot = new THREE.Mesh(footGeo, cobaltMat);
    foot.position.y = 0.09;
    foot.castShadow = true;
    gantryGroup.add(foot);

    // Vertical Structural Column
    const colGeo = track(new THREE.BoxGeometry(0.42, 1.56, 0.42));
    const column = new THREE.Mesh(colGeo, ceramicWhiteMat);
    column.position.y = 0.94;
    column.castShadow = true;
    gantryGroup.add(column);

    const spineGeo = track(new THREE.BoxGeometry(0.14, 1.48, 0.46));
    const spine = new THREE.Mesh(spineGeo, cobaltMat);
    spine.position.y = 0.94;
    gantryGroup.add(spine);

    // Cantilevered Head Housing
    const armGeo = track(new THREE.BoxGeometry(0.36, 0.28, 1.18));
    const arm = new THREE.Mesh(armGeo, ceramicWhiteMat);
    arm.position.set(0, 1.62, 0.44);
    arm.castShadow = true;
    gantryGroup.add(arm);

    const swivelCollarGeo = track(new THREE.CylinderGeometry(0.24, 0.24, 0.34, 24));
    const swivelCollar = new THREE.Mesh(swivelCollarGeo, brushedSilverMat);
    swivelCollar.rotation.z = Math.PI / 2;
    swivelCollar.position.set(0, 1.62, 0.94);
    gantryGroup.add(swivelCollar);

    // Tilted Twin Optical Barrels + Objective Turret
    const headTurret = new THREE.Group();
    headTurret.position.set(0, 1.62, 0.98);
    headTurret.rotation.x = Math.PI / 5.2;
    gantryGroup.add(headTurret);

    const barrelGeo = track(new THREE.CylinderGeometry(0.14, 0.15, 0.88, 28));
    const eyepieceRimGeo = track(new THREE.TorusGeometry(0.145, 0.028, 12, 28));
    [-0.17, 0.17].forEach((xOffset, idx) => {
      const barrel = new THREE.Mesh(barrelGeo, ceramicWhiteMat);
      barrel.position.set(xOffset, 0.26, 0);
      barrel.castShadow = true;
      headTurret.add(barrel);

      const collar = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.162, 0.162, 0.14, 28)),
        idx === 0 ? cobaltMat : brushedSilverMat,
      );
      collar.position.set(xOffset, 0.56, 0);
      headTurret.add(collar);

      const rim = new THREE.Mesh(eyepieceRimGeo, cobaltMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(xOffset, 0.7, 0);
      headTurret.add(rim);
    });

    // Lower Objective Nosepiece + Optical Glass Lens
    const objectiveHousing = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.24, 0.17, 0.36, 28)),
      cobaltMat,
    );
    objectiveHousing.position.set(0, -0.26, 0);
    objectiveHousing.castShadow = true;
    headTurret.add(objectiveHousing);

    const objectiveLens = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.13, 24, 16)),
      glassLensMat,
    );
    objectiveLens.scale.set(1, 0.55, 1);
    objectiveLens.position.set(0, -0.45, 0);
    headTurret.add(objectiveLens);

    // 5. Left Rising 3D Quant Bar Array (Portfolio / Factor Bars)
    const quantBars: { mesh: THREE.Mesh; baseH: number; speed: number; phase: number }[] = [];
    const barBaseGeo = track(new THREE.BoxGeometry(0.2, 1, 0.2));
    const barSpecs = [
      { x: -1.16, z: -0.92, h: 0.44, mat: slateMat },
      { x: -1.16, z: -0.62, h: 0.68, mat: cobaltMat },
      { x: -1.16, z: -0.32, h: 0.54, mat: brightCobaltMat },
      { x: -1.16, z: -0.02, h: 0.86, mat: cobaltMat },
    ];
    barSpecs.forEach((b, idx) => {
      const bar = new THREE.Mesh(barBaseGeo, b.mat);
      bar.scale.y = b.h;
      bar.position.set(b.x, 0.14 + b.h / 2, b.z);
      bar.castShadow = true;
      rootGroup.add(bar);
      quantBars.push({ mesh: bar, baseH: b.h, speed: 1.4 + idx * 0.25, phase: idx * 0.9 });
    });

    // 6. Floating Holographic Market Telemetry Slabs
    const leftCardGroup = new THREE.Group();
    leftCardGroup.position.set(-1.38, 1.24, 0.32);
    leftCardGroup.rotation.y = Math.PI / 4.8;
    rootGroup.add(leftCardGroup);

    const leftFrameGeo = track(new THREE.BoxGeometry(1.06, 0.72, 0.04));
    const leftFrame = new THREE.Mesh(leftFrameGeo, ceramicWhiteMat);
    leftFrame.castShadow = true;
    leftCardGroup.add(leftFrame);

    const leftBorder = new THREE.Mesh(
      track(new THREE.BoxGeometry(1.1, 0.76, 0.02)),
      cobaltMat,
    );
    leftBorder.position.z = -0.015;
    leftCardGroup.add(leftBorder);

    const leftScreen = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.98, 0.65)),
      track(new THREE.MeshBasicMaterial({ map: sparkTex })),
    );
    leftScreen.position.z = 0.022;
    leftCardGroup.add(leftScreen);

    const rightCardGroup = new THREE.Group();
    rightCardGroup.position.set(1.26, 0.96, 0.78);
    rightCardGroup.rotation.y = Math.PI / 3.4;
    rootGroup.add(rightCardGroup);

    const rightFrame = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.92, 0.72, 0.04)),
      ceramicWhiteMat,
    );
    rightFrame.castShadow = true;
    rightCardGroup.add(rightFrame);

    const rightBorder = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.96, 0.76, 0.02)),
      cobaltMat,
    );
    rightBorder.position.z = -0.015;
    rightCardGroup.add(rightBorder);

    const rightScreen = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.84, 0.64)),
      track(new THREE.MeshBasicMaterial({ map: barsTex })),
    );
    rightScreen.position.z = 0.022;
    rightCardGroup.add(rightScreen);

    // Small status indicator bead on front platform corner
    const statusGem = new THREE.Mesh(
      track(new THREE.OctahedronGeometry(0.11, 0)),
      greenAccentMat,
    );
    statusGem.position.set(1.22, 0.28, 1.22);
    rootGroup.add(statusGem);

    // Pre-compile on hardware GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // OrbitControls — drag to inspect 3D sculpture without hijacking page scroll
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minPolarAngle = Math.PI / 4.2;
    controls.maxPolarAngle = Math.PI / 2.25;
    controls.minAzimuthAngle = Math.PI / 10;
    controls.maxAzimuthAngle = Math.PI / 2.1;
    controls.target.set(0, 0.45, 0);
    controls.update();

    let isDragging = false;
    const onControlStart = () => {
      isDragging = true;
    };
    const onControlEnd = () => {
      isDragging = false;
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('end', onControlEnd);

    // Subtle pointer tilt parallax
    let targetTiltX = 0;
    let targetTiltZ = 0;
    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      targetTiltZ = THREE.MathUtils.clamp(-nx * 0.06, -0.08, 0.08);
      targetTiltX = THREE.MathUtils.clamp(ny * 0.05, -0.07, 0.07);
    };
    const onPointerLeave = () => {
      targetTiltX = 0;
      targetTiltZ = 0;
    };
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerleave', onPointerLeave);

    // ResizeObserver
    const handleResize = () => {
      const w = container.clientWidth || 520;
      const h = container.clientHeight || 440;
      const nextAspect = w / h;
      camera.left = (-frustumSize * nextAspect) / 2;
      camera.right = (frustumSize * nextAspect) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Animation loop (with software WebGL pacing via afterDraw)
    let disposed = false;
    let frameId = 0;
    let lastTime = performance.now();
    let elapsed = 0;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      elapsed += dt;
      const t = elapsed;

      // Levitate & spin intelligence crystal + halo
      crystalGroup.position.y = 0.72 + Math.sin(t * 1.8) * 0.055;
      crystalMesh.rotation.y += dt * 0.9;
      haloMesh.rotation.z += dt * 0.55;

      // Glide market pipeline data blocks smoothly
      for (let i = 0; i < pipelineBlocks.length; i++) {
        const pb = pipelineBlocks[i];
        const prog = (pb.phase + t * 0.14) % 1;
        pb.group.position.x = -1.15 + prog * 2.15;
        const edgeFade = Math.min(prog * 6, (1 - prog) * 6, 1);
        pb.group.scale.setScalar(0.55 + edgeFade * 0.45);
      }

      // Gently breathe quant bars
      for (let i = 0; i < quantBars.length; i++) {
        const qb = quantBars[i];
        const h = qb.baseH * (0.9 + 0.12 * Math.sin(t * qb.speed + qb.phase));
        qb.mesh.scale.y = h;
        qb.mesh.position.y = 0.14 + h / 2;
      }

      // Hover telemetry cards
      leftCardGroup.position.y = 1.24 + Math.sin(t * 1.4) * 0.04;
      rightCardGroup.position.y = 0.96 + Math.sin(t * 1.4 + 1.4) * 0.04;
      statusGem.rotation.y += dt * 1.2;

      // Damped interactive hover tilt on whole sculpture when not orbiting
      if (!isDragging) {
        rootGroup.rotation.x = THREE.MathUtils.damp(rootGroup.rotation.x, targetTiltX, 5, dt);
        rootGroup.rotation.z = THREE.MathUtils.damp(rootGroup.rotation.z, targetTiltZ, 5, dt);
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('end', onControlEnd);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      className="relative w-full max-w-[540px] mx-auto select-none"
      role="img"
      aria-label="Interactive 3D Nextrade AI market intelligence optical analyzer"
    >
      <div
        ref={mountRef}
        className="w-full h-[340px] sm:h-[420px] lg:h-[450px] cursor-grab active:cursor-grabbing"
      />
    </div>
  );
};

export const CapabilityBadgeArt: React.FC<{ active?: boolean; kind: string }> = ({
  active = false,
  kind,
}) => {
  const stroke = active ? '#FFFFFF' : '#2D46E6';
  const fillBg = active ? 'rgba(255,255,255,0.14)' : '#EFF2FA';
  const accent = active ? '#FFFFFF' : '#2D46E6';

  return (
    <div
      className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border ${
        active ? 'border-white/30 bg-white/10' : 'border-[#DCE3FA] bg-[#EFF2FA]'
      }`}
      aria-hidden="true"
    >
      <svg width="34" height="34" viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="15" fill={fillBg} />
        {kind === 'research' && (
          <>
            <path d="M10 23L15 17L20 20L26 12" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="26" cy="12" r="2.2" fill={accent} />
          </>
        )}
        {kind === 'explainability' && (
          <>
            <rect x="9" y="10" width="18" height="4" rx="1.5" stroke={stroke} strokeWidth="1.75" />
            <rect x="9" y="17" width="13" height="4" rx="1.5" stroke={stroke} strokeWidth="1.75" />
            <rect x="9" y="24" width="16" height="4" rx="1.5" stroke={stroke} strokeWidth="1.75" />
          </>
        )}
        {kind === 'risk' && (
          <>
            <path d="M18 8L27 13V19C27 24 23 27.5 18 29C13 27.5 9 24 9 19V13L18 8Z" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" />
            <path d="M18 14V19" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
            <circle cx="18" cy="23" r="1.2" fill={accent} />
          </>
        )}
        {kind === 'portfolio' && (
          <>
            <circle cx="18" cy="18" r="8.5" stroke={stroke} strokeWidth="1.75" />
            <path d="M18 9.5V18H26.5" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {kind === 'paper' && (
          <>
            <path d="M11 14H25M11 14L14 11M11 14L14 17" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M25 22H11M25 22L22 19M25 22L22 25" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {kind === 'multimarket' && (
          <>
            <circle cx="18" cy="18" r="9" stroke={stroke} strokeWidth="1.75" />
            <ellipse cx="18" cy="18" rx="4" ry="9" stroke={stroke} strokeWidth="1.5" />
            <path d="M9.5 18H26.5" stroke={stroke} strokeWidth="1.5" />
          </>
        )}
      </svg>
    </div>
  );
};
