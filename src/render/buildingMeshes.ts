import * as THREE from 'three';
import type { Building, PlacedLandmark } from '../sim/types';

// Shared materials cache to minimize WebGL shader switches & draw overhead
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function getMat(
  key: string,
  color: number,
  roughness: number,
  metalness = 0.05,
  emissive = 0x000000,
  emissiveIntensity = 0,
): THREE.MeshStandardMaterial {
  const existing = matCache.get(key);
  if (existing) return existing;
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
  });
  matCache.set(key, mat);
  return mat;
}

export function createBuildingGroup(b: Building): THREE.Group {
  const group = new THREE.Group();
  group.position.set(b.x, 0, b.z);
  group.rotation.y = -b.angle;

  if (b.status === 'constructing') {
    // 5-part Construction Site + Tower Crane
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 0.9, 5.6),
      getMat('concrete_pad', 0x94a3b8, 0.88, 0.02),
    );
    pad.position.y = -0.15;
    group.add(pad);

    const coreH = 1.6 + b.buildProgress * 3.8;
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(4.0, coreH, 4.0),
      getMat('rebar_core', 0x64748b, 0.78, 0.15),
    );
    core.position.y = 0.3 + coreH * 0.5;
    core.castShadow = true;
    group.add(core);

    // Scaffolding frame columns
    const scaffMat = getMat('scaff_steel', 0xd97706, 0.42, 0.6);
    for (const sx of [-2.3, 2.3]) {
      for (const sz of [-2.3, 2.3]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, coreH + 0.8, 8), scaffMat);
        post.position.set(sx, (coreH + 0.8) * 0.5, sz);
        group.add(post);
      }
    }

    // Tower crane mast + jib
    const craneMat = getMat('crane_yellow', 0xf59e0b, 0.35, 0.55);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.35, coreH + 3.6, 0.35), craneMat);
    mast.position.set(-1.6, (coreH + 3.6) * 0.5, -1.6);
    group.add(mast);

    const jib = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.25, 0.25), craneMat);
    jib.position.set(0.2, coreH + 3.4, -1.6);
    group.add(jib);

    return group;
  }

  const levelScale = b.level === 1 ? 1 : b.level === 2 ? 1.55 : 2.15;

  if (b.zone === 'residential') {
    // Macau Pastel Portuguese-Cantonese Apartment / Tower (5-7 distinct parts)
    const wallColors = [0xf3d5b5, 0xcce3de, 0xf2c6c2];
    const roofColors = [0xb45309, 0x9a3412, 0x7c2d12];
    const wallMat = getMat(`res_wall_${b.styleVariant}`, wallColors[b.styleVariant % 3], 0.82, 0.04);
    const trimMat = getMat('res_trim', 0xf8fafc, 0.65, 0.05);
    const glassMat = getMat('res_glass', 0x38bdf8, 0.16, 0.25);
    const roofMat = getMat(`res_roof_${b.styleVariant}`, roofColors[b.styleVariant % 3], 0.72, 0.08);

    // 1. Stone plinth with retaining foundation skirt
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 1.4, 5.0),
      getMat('stone_base', 0x64748b, 0.85, 0.05),
    );
    plinth.position.y = 0.1;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    // 2. Main residential body
    const h = (3.6 + b.styleVariant * 0.6) * levelScale;
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, h, 4.4), wallMat);
    body.position.y = 0.8 + h * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // 3. Recessed glass window bands
    const floors = b.level + 2;
    for (let f = 0; f < floors; f++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(4.72, 0.52, 3.6), glassMat);
      band.position.y = 1.4 + (f + 0.5) * (h / (floors + 0.4));
      group.add(band);

      const balcony = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 4.78), trimMat);
      balcony.position.y = band.position.y - 0.34;
      group.add(balcony);
    }

    // 4. Macau pitched terracotta roof or penthouse crown
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.45, 1.4, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 0.8 + h + 0.7;
    roof.castShadow = true;
    group.add(roof);

    return group;
  }

  if (b.zone === 'commercial') {
    // Sleek Modern Macau Financial & Retail Tower (6 parts)
    const podiumMat = getMat('com_podium', 0x334155, 0.62, 0.18);
    const glassColors = [0x0ea5e9, 0x0284c7, 0x14b8a6];
    const glassMat = getMat(`com_glass_${b.styleVariant}`, glassColors[b.styleVariant % 3], 0.14, 0.55);
    const finMat = getMat('com_fin', 0xe2e8f0, 0.3, 0.75);

    const podium = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.4, 5.3), podiumMat);
    podium.position.y = 0.6;
    podium.castShadow = true;
    podium.receiveShadow = true;
    group.add(podium);

    const h = (5.2 + b.styleVariant * 0.9) * levelScale;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(3.9, h, 3.9), glassMat);
    shaft.position.y = 1.8 + h * 0.5;
    shaft.castShadow = true;
    group.add(shaft);

    // Structural vertical fins for clean silhouette
    for (const fx of [-2.0, 0, 2.0]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, h + 0.4, 4.15), finMat);
      fin.position.set(fx, 1.8 + h * 0.5, 0);
      group.add(fin);
    }

    const crown = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.8, 2.8), finMat);
    crown.position.y = 1.8 + h + 0.4;
    group.add(crown);

    return group;
  }

  if (b.zone === 'tourism') {
    // Cotai-inspired Grand Resort & Entertainment Complex (gold & warm glass)
    const stoneMat = getMat('tour_stone', 0xf5f5f4, 0.65, 0.08);
    const goldMat = getMat('tour_gold', 0xf59e0b, 0.22, 0.85, 0x78350f, 0.22);
    const glassMat = getMat('tour_glass', 0xfde68a, 0.15, 0.45, 0xfbbf24, 0.15);

    const base = new THREE.Mesh(new THREE.BoxGeometry(5.7, 2.1, 5.5), stoneMat);
    base.position.y = 0.45;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // Grand entrance awning
    const awning = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.28, 1.2), goldMat);
    awning.position.set(0, 1.35, 3.0);
    group.add(awning);

    const h = (4.8 + b.styleVariant * 1.1) * levelScale;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.3, h, 12), glassMat);
    tower.position.y = 1.5 + h * 0.5;
    tower.castShadow = true;
    group.add(tower);

    // Illuminated resort rings
    for (let r = 0; r < b.level + 1; r++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15 - r * 0.12, 0.12, 8, 24), goldMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 2.4 + r * (h / (b.level + 1.2));
      group.add(ring);
    }

    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.8, 12), goldMat);
    spire.position.y = 1.5 + h + 0.9;
    group.add(spire);

    return group;
  }

  // Tech Industrial / Clean Logistics Hub
  const slabMat = getMat('ind_slab', 0x475569, 0.85, 0.15);
  const hallMat = getMat('ind_hall', 0xcbd5e1, 0.55, 0.35);
  const solarMat = getMat('ind_solar', 0x1e3a8a, 0.18, 0.7);
  const accentMat = getMat('ind_accent', 0x8b5cf6, 0.4, 0.4);

  const slab = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.0, 5.4), slabMat);
  slab.position.y = -0.1;
  slab.receiveShadow = true;
  group.add(slab);

  const h = 2.4 * levelScale;
  const hall = new THREE.Mesh(new THREE.BoxGeometry(4.8, h, 4.4), hallMat);
  hall.position.y = 0.4 + h * 0.5;
  hall.castShadow = true;
  group.add(hall);

  // Solar roof panels
  for (const sx of [-1.2, 1.2]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 3.2), solarMat);
    panel.position.set(sx, 0.4 + h + 0.2, 0);
    panel.rotation.z = 0.22;
    group.add(panel);
  }

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.3, 4.5), accentMat);
  stripe.position.y = 0.4 + h - 0.35;
  group.add(stripe);

  return group;
}

export function createLandmarkGroup(lm: PlacedLandmark): THREE.Group {
  const group = new THREE.Group();
  group.position.set(lm.x, 0, lm.z);

  if (lm.type === 'macau_tower') {
    const plazaMat = getMat('lm_plaza', 0xe2e8f0, 0.75, 0.05);
    const shaftMat = getMat('lm_tower_shaft', 0xf8fafc, 0.45, 0.2);
    const glassMat = getMat('lm_tower_glass', 0x38bdf8, 0.12, 0.6, 0x0284c7, 0.25);
    const spireMat = getMat('lm_tower_spire', 0xf59e0b, 0.2, 0.9, 0xfbbf24, 0.35);

    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6.3, 1.3, 24), plazaMat);
    plaza.position.y = -0.05;
    plaza.receiveShadow = true;
    group.add(plaza);

    const lowerShaft = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.85, 14, 16), shaftMat);
    lowerShaft.position.y = 7.3;
    lowerShaft.castShadow = true;
    group.add(lowerShaft);

    const podLower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.2, 1.4, 24), shaftMat);
    podLower.position.y = 14.5;
    podLower.castShadow = true;
    group.add(podLower);

    const obsGlass = new THREE.Mesh(new THREE.CylinderGeometry(3.35, 3.35, 1.5, 24), glassMat);
    obsGlass.position.y = 15.8;
    group.add(obsGlass);

    const podCap = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.4, 24), shaftMat);
    podCap.position.y = 17.2;
    group.add(podCap);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.55, 8.5, 12), spireMat);
    spire.position.y = 21.8;
    group.add(spire);

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 12), spireMat);
    beacon.position.y = 26.1;
    group.add(beacon);
    return group;
  }

  if (lm.type === 'lotus_plaza') {
    const stoneMat = getMat('lotus_stone', 0xe5e7eb, 0.72, 0.08);
    const goldMat = getMat('lotus_gold', 0xfbbf24, 0.18, 0.92, 0xd97706, 0.25);
    const waterMat = getMat('lotus_water', 0x0ea5e9, 0.1, 0.2);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.7, 1.2, 24), stoneMat);
    base.position.y = -0.1;
    base.receiveShadow = true;
    group.add(base);

    const pool = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 0.15, 24), waterMat);
    pool.position.y = 0.55;
    group.add(pool);

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 1.8, 12), stoneMat);
    pedestal.position.y = 1.4;
    pedestal.castShadow = true;
    group.add(pedestal);

    // Golden Lotus petals
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.ConeGeometry(0.65, 2.2, 6), goldMat);
      petal.position.set(Math.cos(ang) * 0.9, 2.9, Math.sin(ang) * 0.9);
      petal.rotation.z = -Math.cos(ang) * 0.45;
      petal.rotation.x = Math.sin(ang) * 0.45;
      group.add(petal);
    }
    const centerBud = new THREE.Mesh(new THREE.SphereGeometry(0.65, 14, 14), goldMat);
    centerBud.position.y = 3.2;
    group.add(centerBud);
    return group;
  }

  if (lm.type === 'grand_casino_resort') {
    const stoneMat = getMat('resort_stone', 0xf5f5f4, 0.72, 0.08);
    const goldMat = getMat('resort_gold', 0xf59e0b, 0.2, 0.88, 0xb45309, 0.28);
    const glassMat = getMat('resort_glass', 0xfde68a, 0.14, 0.55, 0xfbbf24, 0.18);
    const waterMat = getMat('lotus_water', 0x0ea5e9, 0.1, 0.2);

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(10.8, 1.4, 7.6), stoneMat);
    plinth.position.y = 0.2;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    const fountainPool = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.35, 16), waterMat);
    fountainPool.position.set(0, 1.0, 2.4);
    group.add(fountainPool);

    for (const tx of [-3.1, 3.1]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.8, 9.6, 3.4), glassMat);
      tower.position.set(tx, 5.7, -0.4);
      tower.castShadow = true;
      group.add(tower);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.5, 3.65), goldMat);
      trim.position.set(tx, 10.6, -0.4);
      group.add(trim);

      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.2, 4), goldMat);
      crown.rotation.y = Math.PI / 4;
      crown.position.set(tx, 11.9, -0.4);
      group.add(crown);
    }

    const skybridge = new THREE.Mesh(new THREE.BoxGeometry(7.6, 1.1, 2.2), goldMat);
    skybridge.position.set(0, 7.6, -0.4);
    skybridge.castShadow = true;
    group.add(skybridge);

    const centerCrest = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), goldMat);
    centerCrest.position.set(0, 9.2, -0.4);
    group.add(centerCrest);

    return group;
  }

  if (lm.type === 'coastal_promenade') {
    const deckMat = getMat('ferris_deck', 0xb45309, 0.86, 0.04);
    const steelMat = getMat('ferris_steel', 0xf8fafc, 0.32, 0.72);
    const goldMat = getMat('ferris_gold', 0xfbbf24, 0.22, 0.85, 0xf59e0b, 0.32);
    const cabinColors = [0x38bdf8, 0xfb7185, 0x34d399, 0xfbbf24];

    const deck = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.9, 6.8), deckMat);
    deck.position.y = 0.05;
    deck.receiveShadow = true;
    group.add(deck);

    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2.0), steelMat);
    kiosk.position.set(-2.9, 1.3, 1.6);
    kiosk.castShadow = true;
    group.add(kiosk);

    const kioskRoof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.9, 4), goldMat);
    kioskRoof.rotation.y = Math.PI / 4;
    kioskRoof.position.set(-2.9, 2.55, 1.6);
    group.add(kioskRoof);

    // Dual A-frame wheel supports
    for (const sz of [-1.0, 1.0]) {
      for (const tilt of [-0.28, 0.28]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 7.8, 8), steelMat);
        leg.position.set(tilt * 4.5, 4.0, sz);
        leg.rotation.z = tilt;
        group.add(leg);
      }
    }

    const wheel = new THREE.Group();
    wheel.name = 'ferrisWheel';
    wheel.position.set(0, 7.4, 0);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.22, 8, 24), goldMat);
    wheel.add(rim);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.5, 12), steelMat);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 8.8, 6), steelMat);
      spoke.rotation.z = ang;
      wheel.add(spoke);

      const podMat = getMat(`ferris_pod_${i % 4}`, cabinColors[i % 4], 0.35, 0.35);
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.85, 0.85), podMat);
      pod.position.set(Math.cos(ang) * 4.4, Math.sin(ang) * 4.4, 0);
      wheel.add(pod);
    }

    group.add(wheel);
    return group;
  }

  if (lm.type === 'grand_prix_stand') {
    const asphaltMat = getMat('gp_asphalt', 0x1e293b, 0.88, 0.05);
    const standMat = getMat('gp_stand', 0xe2e8f0, 0.65, 0.12);
    const redMat = getMat('gp_red', 0xdc2626, 0.42, 0.25);
    const yellowMat = getMat('gp_yellow', 0xfacc15, 0.35, 0.4, 0xeab308, 0.22);

    const apron = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.6, 8.2), asphaltMat);
    apron.position.y = -0.05;
    apron.receiveShadow = true;
    group.add(apron);

    // Tiered bleachers
    for (let t = 0; t < 3; t++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.9 + t * 0.7, 1.5), standMat);
      tier.position.set(0, 0.65 + t * 0.45, -2.5 + t * 1.15);
      tier.castShadow = true;
      group.add(tier);
    }

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.32, 4.4), redMat);
    canopy.position.set(0, 4.4, -1.3);
    canopy.rotation.x = 0.14;
    canopy.castShadow = true;
    group.add(canopy);

    // Starting gantry & race lights
    for (const px of [-4.2, 4.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 3.8, 8), standMat);
      post.position.set(px, 2.1, 2.8);
      group.add(post);
    }
    const gantry = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.55, 0.6), yellowMat);
    gantry.position.set(0, 3.9, 2.8);
    group.add(gantry);

    return group;
  }

  if (lm.type === 'heritage_pavilion') {
    const cobbleMat = getMat('her_cobble', 0xd6d3d1, 0.85, 0.04);
    const ochreMat = getMat('her_ochre', 0xfde047, 0.72, 0.04);
    const trimMat = getMat('her_trim', 0xf8fafc, 0.58, 0.06);
    const tileMat = getMat('her_roof', 0xb45309, 0.68, 0.08);

    const plaza = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.8, 8.4), cobbleMat);
    plaza.position.y = 0.02;
    plaza.receiveShadow = true;
    group.add(plaza);

    const mainHall = new THREE.Mesh(new THREE.BoxGeometry(7.6, 3.4, 4.6), ochreMat);
    mainHall.position.set(0, 2.1, -0.8);
    mainHall.castShadow = true;
    group.add(mainHall);

    const mainRoof = new THREE.Mesh(new THREE.ConeGeometry(4.8, 1.5, 4), tileMat);
    mainRoof.rotation.y = Math.PI / 4;
    mainRoof.scale.set(1.25, 1, 0.82);
    mainRoof.position.set(0, 4.5, -0.8);
    mainRoof.castShadow = true;
    group.add(mainRoof);

    // Front Portuguese white colonnade pillars
    for (const cx of [-3.0, -1.5, 0, 1.5, 3.0]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 2.8, 8), trimMat);
      col.position.set(cx, 1.8, 2.1);
      group.add(col);
    }
    const arcadeBeam = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.55, 1.4), trimMat);
    arcadeBeam.position.set(0, 3.3, 2.0);
    group.add(arcadeBeam);

    // Heritage Clock Spire
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.4, 1.9), trimMat);
    tower.position.set(0, 5.2, -0.8);
    group.add(tower);
    const spireCap = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.3, 4), tileMat);
    spireCap.rotation.y = Math.PI / 4;
    spireCap.position.set(0, 7.0, -0.8);
    group.add(spireCap);

    return group;
  }

  if (lm.type === 'fire_hospital_hub') {
    const padMat = getMat('hosp_pad', 0xe2e8f0, 0.78, 0.05);
    const wallMat = getMat('hosp_wall', 0xf8fafc, 0.52, 0.08);
    const redMat = getMat('hosp_red', 0xe11d48, 0.38, 0.2, 0x9f1239, 0.16);
    const glassMat = getMat('hosp_glass', 0x0ea5e9, 0.16, 0.48);

    const campus = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.85, 8.6), padMat);
    campus.position.y = 0.05;
    campus.receiveShadow = true;
    group.add(campus);

    const wardTower = new THREE.Mesh(new THREE.BoxGeometry(6.8, 4.6, 4.2), wallMat);
    wardTower.position.set(-1.1, 2.75, -0.9);
    wardTower.castShadow = true;
    group.add(wardTower);

    const glassBand = new THREE.Mesh(new THREE.BoxGeometry(6.95, 1.3, 3.4), glassMat);
    glassBand.position.set(-1.1, 3.4, -0.9);
    group.add(glassBand);

    // Rooftop Red Cross Emblem
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 0.65), redMat);
    crossA.position.set(-1.1, 5.18, -0.9);
    group.add(crossA);
    const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.25, 2.2), redMat);
    crossB.position.set(-1.1, 5.18, -0.9);
    group.add(crossB);

    // Red Fire Engine Bay wing
    const fireBay = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.5, 4.4), redMat);
    fireBay.position.set(3.2, 1.7, 1.2);
    fireBay.castShadow = true;
    group.add(fireBay);

    // Helipad ring on front apron
    const heliRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 20), redMat);
    heliRing.rotation.x = -Math.PI / 2;
    heliRing.position.set(-2.0, 0.5, 2.4);
    group.add(heliRing);

    return group;
  }

  if (lm.type === 'ferry_terminal') {
    const pierMat = getMat('ferry_pier', 0x94a3b8, 0.78, 0.1);
    const hallMat = getMat('ferry_hall', 0xf8fafc, 0.45, 0.18);
    const roofMat = getMat('ferry_roof', 0x0284c7, 0.24, 0.55);
    const hullWhite = getMat('ferry_hull', 0xf8fafc, 0.35, 0.2);
    const jetRed = getMat('ferry_red', 0xdc2626, 0.32, 0.3);

    const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(10.8, 1.8, 7.6), pierMat);
    pierDeck.position.y = 0.0;
    pierDeck.receiveShadow = true;
    group.add(pierDeck);

    const terminal = new THREE.Mesh(new THREE.BoxGeometry(7.2, 2.4, 4.2), hallMat);
    terminal.position.set(-0.8, 2.0, -0.9);
    terminal.castShadow = true;
    group.add(terminal);

    const waveRoof = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.55, 4.9), roofMat);
    waveRoof.position.set(-0.8, 3.4, -0.9);
    waveRoof.rotation.z = 0.05;
    waveRoof.castShadow = true;
    group.add(waveRoof);

    const gangway = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.6), roofMat);
    gangway.position.set(1.2, 1.35, 2.1);
    group.add(gangway);

    // Animated bobbing Macau hydrofoil ferry moored at pier
    const boat = new THREE.Group();
    boat.name = 'ferryBoat';
    boat.position.set(1.8, 0.45, 4.7);
    boat.rotation.y = 0.2;

    const hull = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.9, 1.9), hullWhite);
    hull.castShadow = true;
    boat.add(hull);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.75, 1.5), jetRed);
    cabin.position.set(-0.2, 0.8, 0);
    boat.add(cabin);

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 1.2), hullWhite);
    bridge.position.set(0.6, 1.35, 0);
    boat.add(bridge);

    group.add(boat);
    return group;
  }

  if (lm.type === 'eco_solar_plant') {
    const padMat = getMat('eco_pad', 0xdbeafe, 0.82, 0.05);
    const subMat = getMat('eco_sub', 0xf8fafc, 0.48, 0.15);
    const solarMat = getMat('eco_solar', 0x1d4ed8, 0.14, 0.78);
    const bladeMat = getMat('eco_blade', 0xf1f5f9, 0.35, 0.3);
    const greenMat = getMat('eco_green', 0x10b981, 0.45, 0.25, 0x059669, 0.18);

    const pad = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.75, 7.8), padMat);
    pad.position.y = -0.02;
    pad.receiveShadow = true;
    group.add(pad);

    const station = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 2.8), subMat);
    station.position.set(-2.6, 1.2, -1.6);
    station.castShadow = true;
    group.add(station);

    const glowRing = new THREE.Mesh(new THREE.BoxGeometry(3.35, 0.25, 2.95), greenMat);
    glowRing.position.set(-2.6, 2.1, -1.6);
    group.add(glowRing);

    // 4 Tilted Photovoltaic Arrays
    for (const [sx, sz] of [
      [-2.8, 1.6],
      [-0.5, 1.6],
      [1.8, 1.6],
      [0.8, -1.6],
    ]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 1.6), solarMat);
      panel.position.set(sx, 0.85, sz);
      panel.rotation.x = 0.38;
      panel.castShadow = true;
      group.add(panel);
    }

    // 2 Wind Turbine Masts with Rotating 3-Blade Hubs
    for (const [tx, tz, h] of [
      [3.2, -1.8, 6.2],
      [3.5, 1.8, 5.2],
    ]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, h, 10), subMat);
      mast.position.set(tx, h * 0.5 + 0.3, tz);
      mast.castShadow = true;
      group.add(mast);

      const rotor = new THREE.Group();
      rotor.name = 'turbineRotor';
      rotor.position.set(tx, h + 0.25, tz + 0.26);

      const spinner = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), greenMat);
      rotor.add(spinner);

      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 0.08), bladeMat);
        const ang = (b / 3) * Math.PI * 2;
        blade.position.set(Math.cos(ang) * 1.1, Math.sin(ang) * 1.1, 0);
        blade.rotation.z = ang - Math.PI / 2;
        rotor.add(blade);
      }

      group.add(rotor);
    }

    return group;
  }

  // Harbor Park
  const lawnMat = getMat('park_lawn', 0x22c55e, 0.88, 0.02);
  const pathMat = getMat('park_path', 0xe2e8f0, 0.8, 0.05);
  const waterMat = getMat('park_fountain', 0x38bdf8, 0.12, 0.25);
  const trunkMat = getMat('tree_trunk', 0x78350f, 0.9, 0.02);
  const leafMat = getMat('tree_leaf', 0x15803d, 0.78, 0.05);

  const lawn = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.2, 0.98, 24), lawnMat);
  lawn.position.y = -0.21;
  lawn.receiveShadow = true;
  group.add(lawn);

  const ringPath = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.6, 24), pathMat);
  ringPath.rotation.x = -Math.PI / 2;
  ringPath.position.y = 0.3;
  group.add(ringPath);

  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.55, 18), pathMat);
  fountain.position.y = 0.52;
  group.add(fountain);

  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 12), waterMat);
  jet.position.y = 1.2;
  group.add(jet);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.5, 8), trunkMat);
    trunk.position.set(Math.cos(a) * 3.5, 0.9, Math.sin(a) * 3.5);
    group.add(trunk);

    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 10), leafMat);
    canopy.position.set(Math.cos(a) * 3.5, 2.1, Math.sin(a) * 3.5);
    canopy.castShadow = true;
    group.add(canopy);
  }

  return group;
}

interface CitizenGeos {
  shadow: THREE.CircleGeometry;
  interactRing: THREE.RingGeometry;
  leg: THREE.CapsuleGeometry;
  shoe: THREE.BoxGeometry;
  torso: THREE.CapsuleGeometry;
  arm: THREE.CapsuleGeometry;
  hand: THREE.SphereGeometry;
  head: THREE.SphereGeometry;
  hair: THREE.SphereGeometry;
  eye: THREE.BoxGeometry;
  bag: THREE.BoxGeometry;
  plumbob: THREE.OctahedronGeometry;
}

let cachedCitizenGeos: CitizenGeos | null = null;
function getCitizenGeos(): CitizenGeos {
  if (cachedCitizenGeos) return cachedCitizenGeos;

  const legGeo = new THREE.CapsuleGeometry(0.095, 0.36, 4, 8);
  legGeo.translate(0, -0.25, 0);

  const shoeGeo = new THREE.BoxGeometry(0.18, 0.1, 0.28);
  shoeGeo.translate(0, -0.49, 0.04);

  const armGeo = new THREE.CapsuleGeometry(0.075, 0.34, 4, 8);
  armGeo.translate(0, -0.22, 0);

  const handGeo = new THREE.SphereGeometry(0.075, 6, 6);
  handGeo.translate(0, -0.44, 0);

  cachedCitizenGeos = {
    shadow: new THREE.CircleGeometry(0.58, 14),
    interactRing: new THREE.RingGeometry(0.68, 0.88, 18),
    leg: legGeo,
    shoe: shoeGeo,
    torso: new THREE.CapsuleGeometry(0.24, 0.44, 6, 10),
    arm: armGeo,
    hand: handGeo,
    head: new THREE.SphereGeometry(0.24, 12, 10),
    hair: new THREE.SphereGeometry(0.255, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
    eye: new THREE.BoxGeometry(0.26, 0.07, 0.08),
    bag: new THREE.BoxGeometry(0.22, 0.28, 0.16),
    plumbob: new THREE.OctahedronGeometry(0.24, 0),
  };
  return cachedCitizenGeos;
}

function createArticulatedAvatarGroup(options: {
  colorHex: string;
  isLocalPlayer?: boolean;
  showPlumbob?: boolean;
  accessory?: 'bag' | 'camera' | 'briefcase' | 'none';
}): THREE.Group {
  const geos = getCitizenGeos();
  const group = new THREE.Group();
  const colorNum = new THREE.Color(options.colorHex).getHex();

  // 1. Contact ground shadow disc
  const shadow = new THREE.Mesh(
    geos.shadow,
    getMat('citizen_shadow_mat', 0x020617, 1.0, 0),
  );
  (shadow.material as THREE.MeshStandardMaterial).transparent = true;
  (shadow.material as THREE.MeshStandardMaterial).opacity = 0.34;
  (shadow.material as THREE.MeshStandardMaterial).depthWrite = false;
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  group.add(shadow);

  // 2. Ground Interaction Halo (shown softly when citizen interacts with building)
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const interactHalo = new THREE.Mesh(geos.interactRing, haloMat);
  interactHalo.rotation.x = -Math.PI / 2;
  interactHalo.position.y = 0.05;
  interactHalo.visible = false;
  interactHalo.name = 'interactHalo';
  group.add(interactHalo);

  // 3. Articulated Body Root (pelvis / waist height)
  const bodyRoot = new THREE.Group();
  bodyRoot.name = 'bodyRoot';
  group.add(bodyRoot);

  const pantsMat = getMat('sim_pants', 0x1e293b, 0.82, 0.04);
  const shoeMat = getMat('sim_shoes', 0x0f172a, 0.65, 0.08);
  const skinMat = getMat('sim_skin', 0xfde68a, 0.72, 0.02);
  const hairMat = getMat('sim_hair', 0x0f172a, 0.65, 0.1);
  const visorMat = getMat('sim_visor', 0x1e293b, 0.2, 0.5);
  const jacketMat = getMat(`sim_jacket_${colorNum.toString(16)}`, colorNum, 0.52, 0.1);

  // 4 & 5. Left & Right Leg Pivots (at hip y = 0.56)
  for (const [name, lx] of [
    ['leftLegPivot', -0.14],
    ['rightLegPivot', 0.14],
  ] as const) {
    const legPivot = new THREE.Group();
    legPivot.name = name;
    legPivot.position.set(lx, 0.56, 0);

    const legMesh = new THREE.Mesh(geos.leg, pantsMat);
    legMesh.castShadow = true;
    legPivot.add(legMesh);

    const shoeMesh = new THREE.Mesh(geos.shoe, shoeMat);
    legPivot.add(shoeMesh);
    bodyRoot.add(legPivot);
  }

  // 6. Torso
  const torso = new THREE.Mesh(geos.torso, jacketMat);
  torso.position.y = 0.94;
  torso.castShadow = true;
  bodyRoot.add(torso);

  // 7. Accessory (commuter bag / tourist camera / briefcase)
  if (options.accessory && options.accessory !== 'none') {
    const accColor =
      options.accessory === 'camera'
        ? 0xf59e0b
        : options.accessory === 'briefcase'
          ? 0x78350f
          : 0xe11d48;
    const accMat = getMat(`sim_acc_${options.accessory}`, accColor, 0.45, 0.25);
    const accMesh = new THREE.Mesh(geos.bag, accMat);
    if (options.accessory === 'camera') {
      accMesh.scale.set(0.7, 0.5, 0.65);
      accMesh.position.set(0, 0.96, 0.24);
    } else if (options.accessory === 'briefcase') {
      accMesh.position.set(0.32, 0.72, 0.05);
    } else {
      accMesh.position.set(0, 0.96, -0.22);
    }
    bodyRoot.add(accMesh);
  }

  // 8 & 9. Left & Right Arm Pivots (at shoulder y = 1.24)
  for (const [name, ax] of [
    ['leftArmPivot', -0.31],
    ['rightArmPivot', 0.31],
  ] as const) {
    const armPivot = new THREE.Group();
    armPivot.name = name;
    armPivot.position.set(ax, 1.24, 0);

    const sleeve = new THREE.Mesh(geos.arm, jacketMat);
    sleeve.castShadow = true;
    armPivot.add(sleeve);

    const hand = new THREE.Mesh(geos.hand, skinMat);
    armPivot.add(hand);
    bodyRoot.add(armPivot);
  }

  // 10. Head Pivot (at neck y = 1.48) with Hair & Forward Sunglasses/Eyes
  const headPivot = new THREE.Group();
  headPivot.name = 'headPivot';
  headPivot.position.set(0, 1.48, 0);

  const head = new THREE.Mesh(geos.head, skinMat);
  head.position.y = 0.16;
  head.castShadow = true;
  headPivot.add(head);

  const hair = new THREE.Mesh(geos.hair, hairMat);
  hair.position.y = 0.2;
  headPivot.add(hair);

  const visor = new THREE.Mesh(geos.eye, visorMat);
  visor.position.set(0, 0.18, 0.21);
  headPivot.add(visor);

  bodyRoot.add(headPivot);

  // Optional Plumbob Crystal (for connected Multiplayer SimPlayers)
  if (options.showPlumbob) {
    const plumbobMat = new THREE.MeshStandardMaterial({
      color: options.isLocalPlayer ? 0x10b981 : colorNum,
      emissive: options.isLocalPlayer ? 0x10b981 : colorNum,
      emissiveIntensity: 0.48,
      roughness: 0.15,
      metalness: 0.3,
    });
    const plumbob = new THREE.Mesh(geos.plumbob, plumbobMat);
    plumbob.scale.set(0.72, 1.32, 0.72);
    plumbob.position.y = 2.45;
    plumbob.name = 'plumbob';
    group.add(plumbob);
  }

  return group;
}

export function createSimAvatarGroup(colorHex: string, isLocal: boolean): THREE.Group {
  return createArticulatedAvatarGroup({
    colorHex,
    isLocalPlayer: isLocal,
    showPlumbob: true,
    accessory: 'bag',
  });
}

export function createNpcAvatarGroup(
  colorHex: string,
  accessory: 'bag' | 'camera' | 'briefcase' | 'none' = 'none',
): THREE.Group {
  return createArticulatedAvatarGroup({
    colorHex,
    showPlumbob: false,
    accessory,
  });
}

export function animateCitizenRig(
  group: THREE.Group,
  walkPhase: number,
  isWalking: boolean,
  isInteracting: boolean,
  interactionZone: string,
  elapsed: number,
): void {
  const bodyRoot = group.getObjectByName('bodyRoot');
  const leftLeg = group.getObjectByName('leftLegPivot');
  const rightLeg = group.getObjectByName('rightLegPivot');
  const leftArm = group.getObjectByName('leftArmPivot');
  const rightArm = group.getObjectByName('rightArmPivot');
  const head = group.getObjectByName('headPivot');
  const halo = group.getObjectByName('interactHalo') as THREE.Mesh | undefined;

  if (!bodyRoot || !leftLeg || !rightLeg || !leftArm || !rightArm || !head) return;

  if (isWalking) {
    const legSwing = Math.sin(walkPhase) * 0.65;
    const armSwing = Math.sin(walkPhase) * 0.52;
    leftLeg.rotation.x = legSwing;
    rightLeg.rotation.x = -legSwing;
    leftArm.rotation.x = -armSwing;
    rightArm.rotation.x = armSwing;
    leftArm.rotation.z = 0.08;
    rightArm.rotation.z = -0.08;
    bodyRoot.position.y = Math.abs(Math.sin(walkPhase)) * 0.07;
    bodyRoot.rotation.z = Math.cos(walkPhase) * 0.035;
    head.rotation.x = 0;
    head.rotation.y = Math.sin(walkPhase * 0.5) * 0.08;
    if (halo) halo.visible = false;
    return;
  }

  // Idle or Interacting at a building entrance
  leftLeg.rotation.x *= 0.8;
  rightLeg.rotation.x *= 0.8;
  bodyRoot.position.y = Math.sin(elapsed * 2.8) * 0.025;
  bodyRoot.rotation.z = 0;

  if (isInteracting) {
    if (interactionZone === 'tourism' || interactionZone === 'landmark') {
      // Looking up admiring Macau skyline / taking photo gesture
      rightArm.rotation.x = -1.15 + Math.sin(elapsed * 4.5) * 0.14;
      rightArm.rotation.z = -0.2;
      leftArm.rotation.x = -0.5;
      head.rotation.x = -0.22 + Math.sin(elapsed * 2.1) * 0.08;
      head.rotation.y = Math.sin(elapsed * 1.4) * 0.25;
    } else if (interactionZone === 'commercial' || interactionZone === 'dining') {
      // Friendly wave / shopping exchange gesture
      rightArm.rotation.x = -0.85 + Math.sin(elapsed * 6.0) * 0.28;
      rightArm.rotation.z = -0.25;
      leftArm.rotation.x = -0.35;
      head.rotation.x = Math.sin(elapsed * 3.0) * 0.08;
      head.rotation.y = Math.sin(elapsed * 1.8) * 0.18;
    } else if (interactionZone === 'industrial' || interactionZone === 'working') {
      // Clipboard / work coordination pose
      leftArm.rotation.x = -0.9;
      rightArm.rotation.x = -0.6 + Math.sin(elapsed * 5.0) * 0.2;
      head.rotation.x = 0.12;
      head.rotation.y = Math.sin(elapsed * 1.6) * 0.12;
    } else {
      // Residential greeting wave
      rightArm.rotation.x = -0.55 + Math.sin(elapsed * 4.2) * 0.24;
      leftArm.rotation.x = -0.15;
      head.rotation.x = 0;
      head.rotation.y = Math.sin(elapsed * 1.5) * 0.14;
    }

    if (halo) {
      halo.visible = true;
      const pulse = 1 + Math.sin(elapsed * 4.5) * 0.16;
      halo.scale.setScalar(pulse);
    }
  } else {
    leftArm.rotation.x = Math.sin(elapsed * 1.8) * 0.06;
    rightArm.rotation.x = -Math.sin(elapsed * 1.8) * 0.06;
    leftArm.rotation.z = 0.06;
    rightArm.rotation.z = -0.06;
    head.rotation.x = 0;
    head.rotation.y = Math.sin(elapsed * 1.1) * 0.18;
    if (halo) halo.visible = false;
  }
}
