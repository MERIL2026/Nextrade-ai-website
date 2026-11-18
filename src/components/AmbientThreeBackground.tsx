import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

const GRID_COLS = 34;
const GRID_ROWS = 22;
const GRID_WIDTH = 28;
const GRID_DEPTH = 18;

const _dummy = new THREE.Object3D();

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function sampleWaveHeight(x: number, z: number, t: number): number {
  return (
    Math.sin(x * 0.28 + t * 0.34) * 0.36 +
    Math.cos(z * 0.34 - t * 0.26) * 0.28 +
    Math.sin((x + z) * 0.16 + t * 0.2) * 0.14
  );
}

export const AmbientThreeBackground: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const width = container.clientWidth || window.innerWidth || 1200;
    const height = container.clientHeight || 680;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 7.5, 22);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 45);
    camera.position.set(0.6, 3.6, 10.8);
    camera.lookAt(0.8, -0.4, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xffffff, 0);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    const masterGroup = new THREE.Group();
    masterGroup.position.set(1.2, -1.35, -1.5);
    masterGroup.rotation.x = 0.08;
    masterGroup.rotation.y = -0.14;
    scene.add(masterGroup);

    // 1. Monochrome Topographic Quantitative Lattice (LineSegments)
    const numCols = GRID_COLS + 1;
    const numRows = GRID_ROWS + 1;
    const segmentCount = GRID_COLS * numRows + GRID_ROWS * numCols;
    const linePositions = new Float32Array(segmentCount * 2 * 3);
    const lineColors = new Float32Array(segmentCount * 2 * 3);

    const latticeGeo = track(new THREE.BufferGeometry());
    latticeGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    latticeGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const latticeMat = track(
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
    );
    const latticeMesh = new THREE.LineSegments(latticeGeo, latticeMat);
    masterGroup.add(latticeMesh);

    // 2. Sparse Instanced Monochrome Coordinate Nodes (single draw call)
    const nodeCoords: { x: number; z: number }[] = [];
    for (let r = 2; r < numRows - 2; r += 3) {
      for (let c = 2; c < numCols - 2; c += 4) {
        const x = (c / GRID_COLS - 0.5) * GRID_WIDTH;
        const z = (r / GRID_ROWS - 0.5) * GRID_DEPTH;
        nodeCoords.push({ x, z });
      }
    }

    const nodeGeo = track(new THREE.OctahedronGeometry(0.048, 0));
    const nodeMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x080b12,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    const nodeInstances = new THREE.InstancedMesh(
      nodeGeo,
      nodeMat,
      nodeCoords.length,
    );
    nodeInstances.frustumCulled = false;
    masterGroup.add(nodeInstances);

    // 3. Subtle Monochrome Architectural Calibration Arcs
    const createHairlineRing = (
      radius: number,
      segments: number,
      colorHex: number,
      opacity: number,
    ) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const geo = track(new THREE.BufferGeometry().setFromPoints(pts));
      const mat = track(
        new THREE.LineBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      return new THREE.LineLoop(geo, mat);
    };

    const outerArc = createHairlineRing(7.8, 96, 0x94a3b8, 0.24);
    outerArc.position.set(2.4, 1.35, -3.4);
    outerArc.rotation.set(0.42, 0.15, -0.18);
    scene.add(outerArc);

    const innerArc = createHairlineRing(5.4, 84, 0x64748b, 0.18);
    innerArc.position.set(2.4, 1.35, -3.4);
    innerArc.rotation.set(-0.34, 0.28, 0.22);
    scene.add(innerArc);

    const gridHeightCache = new Float32Array(numRows * numCols);
    const gridXCache = new Float32Array(numCols);
    const gridZCache = new Float32Array(numRows);
    for (let c = 0; c < numCols; c++) {
      gridXCache[c] = (c / GRID_COLS - 0.5) * GRID_WIDTH;
    }
    for (let r = 0; r < numRows; r++) {
      gridZCache[r] = (r / GRID_ROWS - 0.5) * GRID_DEPTH;
    }

    const updateWaveGeometry = (t: number) => {
      for (let r = 0; r < numRows; r++) {
        const z = gridZCache[r];
        for (let c = 0; c < numCols; c++) {
          const x = gridXCache[c];
          gridHeightCache[r * numCols + c] = sampleWaveHeight(x, z, t);
        }
      }

      const writeVertex = (idx: number, x: number, y: number, z: number) => {
        const base = idx * 3;
        linePositions[base] = x;
        linePositions[base + 1] = y;
        linePositions[base + 2] = z;

        // Monochrome luminance shading: ridges slightly darker graphite, troughs light slate
        const ridge = THREE.MathUtils.clamp((y + 0.78) / 1.56, 0, 1);
        const shade = 0.78 - ridge * 0.36;
        lineColors[base] = shade;
        lineColors[base + 1] = shade + 0.02;
        lineColors[base + 2] = shade + 0.05;
      };

      let vIdx = 0;
      for (let r = 0; r < numRows; r++) {
        const z = gridZCache[r];
        for (let c = 0; c < GRID_COLS; c++) {
          const y0 = gridHeightCache[r * numCols + c];
          const y1 = gridHeightCache[r * numCols + (c + 1)];
          writeVertex(vIdx++, gridXCache[c], y0, z);
          writeVertex(vIdx++, gridXCache[c + 1], y1, z);
        }
      }

      for (let c = 0; c < numCols; c++) {
        const x = gridXCache[c];
        for (let r = 0; r < GRID_ROWS; r++) {
          const y0 = gridHeightCache[r * numCols + c];
          const y1 = gridHeightCache[(r + 1) * numCols + c];
          writeVertex(vIdx++, x, y0, gridZCache[r]);
          writeVertex(vIdx++, x, y1, gridZCache[r + 1]);
        }
      }

      latticeGeo.attributes.position.needsUpdate = true;
      latticeGeo.attributes.color.needsUpdate = true;

      for (let i = 0; i < nodeCoords.length; i++) {
        const { x, z } = nodeCoords[i];
        const y = sampleWaveHeight(x, z, t);
        _dummy.position.set(x, y, z);
        _dummy.rotation.y = t * 0.35 + i * 0.2;
        const pulseScale = 0.85 + Math.max(0, y) * 0.5;
        _dummy.scale.setScalar(pulseScale);
        _dummy.updateMatrix();
        nodeInstances.setMatrixAt(i, _dummy.matrix);
      }
      nodeInstances.instanceMatrix.needsUpdate = true;
    };

    // Subtle pointer parallax over window
    let targetCamX = 0.6;
    let targetCamY = 3.6;
    const onPointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / (window.innerWidth || 1) - 0.5) * 2;
      const ny = (e.clientY / (window.innerHeight || 1) - 0.5) * 2;
      targetCamX = 0.6 + THREE.MathUtils.clamp(nx * 0.42, -0.45, 0.45);
      targetCamY = 3.6 - THREE.MathUtils.clamp(ny * 0.25, -0.3, 0.3);
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const handleResize = () => {
      const w = container.clientWidth || window.innerWidth || 1200;
      const h = container.clientHeight || 680;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    let disposed = false;
    let isVisible = true;
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
        if (disposed || !isVisible) return;
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

    const renderFrame = (dt: number) => {
      elapsed += dt;
      updateWaveGeometry(elapsed);

      outerArc.rotation.y += dt * 0.025;
      innerArc.rotation.y -= dt * 0.018;

      camera.position.x = THREE.MathUtils.damp(camera.position.x, targetCamX, 3.5, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, targetCamY, 3.5, dt);
      camera.lookAt(0.8, -0.4, 0);

      renderer.render(scene, camera);
    };

    const tick = () => {
      if (disposed || !isVisible) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      renderFrame(dt);

      if (prefersReducedMotion) return;

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const nextVisible = entry.isIntersecting;
        if (nextVisible && !isVisible) {
          isVisible = true;
          lastTime = performance.now();
          if (!prefersReducedMotion) tick();
        } else {
          isVisible = nextVisible;
          if (!isVisible) {
            cancelAnimationFrame(frameId);
            clearTimeout(frameId);
          }
        }
      },
      { threshold: 0.01 },
    );
    intersectionObserver.observe(container);

    // Initial render + start loop
    renderFrame(0);
    if (!prefersReducedMotion) {
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
    >
      <div ref={mountRef} className="h-full w-full" />
      {/* Soft radial & bottom fade to protect left editorial copy contrast */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 56% 74% at 24% 48%, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.34) 55%, rgba(255,255,255,0) 100%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-20"
        style={{
          background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, #FFFFFF 100%)',
        }}
      />
    </div>
  );
};
