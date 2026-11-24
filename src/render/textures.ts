import * as THREE from 'three';
import type { RoadTier } from '../sim/types';

export interface CityTextures {
  roads: Record<RoadTier, THREE.CanvasTexture>;
  terrainBump: THREE.CanvasTexture;
  waterBump: THREE.CanvasTexture;
  calcadaSidewalk: THREE.CanvasTexture;
  dispose: () => void;
}

function makeRoadTexture(tier: RoadTier, maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Smooth dark asphalt base
  ctx.fillStyle = '#272c35';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle mineral grain (non-pixelated smooth noise)
  for (let i = 0; i < 1800; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
    const px = Math.abs(x) * 512;
    const py = Math.abs(y) * 512;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(px, py, 2.5, 2.5);
  }

  // Sidewalk curbstones (Macau calçada tone)
  const curbW = tier === 'street' ? 68 : 54;
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, 0, curbW, 512);
  ctx.fillRect(512 - curbW, 0, curbW, 512);

  // Curb edge bevel line
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(curbW - 6, 0, 6, 512);
  ctx.fillRect(512 - curbW, 0, 6, 512);

  if (tier === 'street') {
    // Center dashed white line
    ctx.fillStyle = '#f8fafc';
    for (let y = 16; y < 512; y += 64) {
      ctx.fillRect(252, y, 8, 34);
    }
  } else {
    // 4-lane avenue or Bus-Priority avenue
    // Dedicated Bus Lane strips on outer lanes for bus_avenue
    if (tier === 'bus_avenue') {
      ctx.fillStyle = 'rgba(180, 62, 52, 0.72)';
      ctx.fillRect(curbW + 4, 0, 64, 512);
      ctx.fillRect(512 - curbW - 68, 0, 64, 512);

      // Crisp yellow bus-lane border
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(curbW + 68, 0, 4, 512);
      ctx.fillRect(512 - curbW - 72, 0, 4, 512);

      // Crisp rotated BUS stencil
      ctx.save();
      ctx.fillStyle = 'rgba(254, 243, 199, 0.88)';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BUS', curbW + 36, 140);
      ctx.fillText('BUS', curbW + 36, 396);
      ctx.fillText('BUS', 512 - curbW - 36, 256);
      ctx.restore();
    }

    // Center landscaped median strip
    ctx.fillStyle = '#3f624d';
    ctx.fillRect(244, 0, 24, 512);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(240, 0, 4, 512);
    ctx.fillRect(268, 0, 4, 512);

    // Lane dividers
    ctx.fillStyle = 'rgba(248, 250, 252, 0.85)';
    for (let y = 14; y < 512; y += 64) {
      ctx.fillRect(156, y, 5, 32);
      ctx.fillRect(351, y, 5, 32);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  return tex;
}

function makeTerrainBumpTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 2400; i++) {
    const px = ((Math.sin(i * 19.19) * 19381.1) % 1 + 1) % 1 * 512;
    const py = ((Math.cos(i * 47.73) * 29311.7) % 1 + 1) % 1 * 512;
    const r = 3 + (i % 7);
    const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)');
    grad.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  return tex;
}

function makeWaterBumpTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 512, 512);

  for (let y = 0; y < 512; y += 8) {
    for (let x = 0; x < 512; x += 8) {
      const wave =
        Math.sin(x * 0.049 + y * 0.0245) * 0.5 +
        Math.cos(y * 0.0736 - x * 0.0245) * 0.5;
      const v = Math.round(128 + wave * 36);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 8, 8);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  return tex;
}

function makeCalcadaTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, 512, 512);

  // Portuguese Macau wave paving pattern (Calçada Portuguesa)
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 14;
  for (let row = -1; row <= 8; row++) {
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 16) {
      const y = row * 64 + Math.sin((x / 512) * Math.PI * 4) * 16;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createCityTextures(renderer: THREE.WebGLRenderer): CityTextures {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const roads: Record<RoadTier, THREE.CanvasTexture> = {
    street: makeRoadTexture('street', maxAniso),
    avenue: makeRoadTexture('avenue', maxAniso),
    bus_avenue: makeRoadTexture('bus_avenue', maxAniso),
  };
  const terrainBump = makeTerrainBumpTexture(maxAniso);
  const waterBump = makeWaterBumpTexture(maxAniso);
  const calcadaSidewalk = makeCalcadaTexture(maxAniso);

  return {
    roads,
    terrainBump,
    waterBump,
    calcadaSidewalk,
    dispose: () => {
      roads.street.dispose();
      roads.avenue.dispose();
      roads.bus_avenue.dispose();
      terrainBump.dispose();
      waterBump.dispose();
      calcadaSidewalk.dispose();
    },
  };
}
