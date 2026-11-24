import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  dist2D,
  findRoadSnap,
  getTileAt,
  isCheocVanBeachCoast,
  isHacSaBeachCoast,
  isReclaimedZoneSurface,
  isTileAdjacentToUnlocked,
  isTileUnlockedAt,
  isWalkablePosition,
  isWaterAt,
  MAP_HALF_SIZE,
  terrainHeightAt,
} from '../sim/geometry';
import { LANDMARK_SPECS, ROAD_COST_PER_M, TERRAFORM_SPECS } from '../sim/economy';
import type {
  CityState,
  ClientAction,
  DynamicWorldElement,
  GamePhase,
  LandmarkType,
  MapTile,
  OverlayMode,
  PlayMode,
  RoadNode,
  RoadSegment,
  RoadTier,
  SnapResult,
  TerrainEdit,
  TerrainOpKind,
  ToolMode,
  Vec2,
  ZoneParcel,
  ZoneType,
} from '../sim/types';
import { createCityTextures, type CityTextures } from './textures';
import {
  animateCitizenRig,
  createBuildingGroup,
  createLandmarkGroup,
  createNpcAvatarGroup,
  createSimAvatarGroup,
} from './buildingMeshes';
import {
  computeTargetNpcCount,
  createNpcCitizen,
  getBuildingEntrances,
  stepNpcCitizens,
  type BuildingEntrance,
  type NpcCitizen,
} from '../sim/navigation';
import {
  computeNodeTrafficLoad,
  mapTrafficLoadToD3Style,
} from '../sim/trafficOverlay';

const TOOL_TO_LANDMARK: Partial<Record<ToolMode, LandmarkType>> = {
  landmark_tower: 'macau_tower',
  landmark_plaza: 'lotus_plaza',
  landmark_park: 'harbor_park',
  landmark_ferry: 'ferry_terminal',
  landmark_resort: 'grand_casino_resort',
  landmark_heritage: 'heritage_pavilion',
  landmark_solar: 'eco_solar_plant',
  landmark_hospital: 'fire_hospital_hub',
  landmark_grandprix: 'grand_prix_stand',
  landmark_ferris: 'coastal_promenade',
};

const TOOL_TO_TERRAFORM: Partial<Record<ToolMode, TerrainOpKind>> = {
  terraform_reclaim: 'reclaim',
  terraform_canal: 'canal',
  terraform_raise: 'raise',
  terraform_flatten: 'flatten',
  terraform_lower: 'lower',
};

interface CityViewportProps {
  cityState: CityState;
  phase: GamePhase;
  playMode: PlayMode;
  tool: ToolMode;
  overlay: OverlayMode;
  showCitizenNav: boolean;
  snapEnabled: boolean;
  localPlayerId: string;
  onAction: (action: ClientAction) => void;
  onSelectEntity: (info: {
    kind: string;
    title: string;
    subtitle: string;
    id?: string;
    canBuy?: boolean;
    canSell?: boolean;
    hasBuilding?: boolean;
    buildingLevel?: number;
  } | null) => void;
  onSnapHintChange?: (hint: { text: string; screenX: number; screenY: number } | null) => void;
}

// Pre-allocated scratch math helpers (zero GC inside animation loop)
const _vec3 = new THREE.Vector3();
const _vec3b = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2);

interface VehicleInstance {
  segIndex: number;
  t: number;
  dir: 1 | -1;
  speed: number;
  laneOffset: number;
  isBus: boolean;
}

export const CityViewport: React.FC<CityViewportProps> = ({
  cityState,
  phase,
  playMode,
  tool,
  overlay,
  showCitizenNav,
  snapEnabled,
  localPlayerId,
  onAction,
  onSelectEntity,
  onSnapHintChange,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelsContainerRef = useRef<HTMLDivElement | null>(null);

  // Store latest props/callbacks in refs so WebGL scene mounts ONCE and never resets
  const stateRef = useRef(cityState);
  stateRef.current = cityState;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const showCitizenNavRef = useRef(showCitizenNav);
  showCitizenNavRef.current = showCitizenNav;
  const snapEnabledRef = useRef(snapEnabled);
  snapEnabledRef.current = snapEnabled;
  const localPlayerIdRef = useRef(localPlayerId);
  localPlayerIdRef.current = localPlayerId;
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const onSelectRef = useRef(onSelectEntity);
  onSelectRef.current = onSelectEntity;
  const onSnapHintRef = useRef(onSnapHintChange);
  onSnapHintRef.current = onSnapHintChange;

  // Trigger scene rebuild when city version changes
  const rebuildVersionRef = useRef(0);
  const lastCitySignatureRef = useRef('');

  useEffect(() => {
    const sig = [
      cityState.mapTiles.map((t) => `${t.id}:${t.unlocked ? 1 : 0}`).join(','),
      cityState.nodes.map((n) => `${n.id}:${n.isRoundabout ? 1 : 0}`).join(','),
      cityState.segments.map((s) => `${s.id}:${s.tier}:${Math.round(s.trafficLoad * 100)}`).join(','),
      cityState.parcels.map((p) => `${p.id}:${p.zone}:${p.ownerPlayerId || ''}:${p.landValue}`).join(','),
      cityState.buildings.map((b) => `${b.id}:${b.status}:${b.level}:${Math.round(b.buildProgress * 10)}`).join(','),
      cityState.landmarks.map((l) => l.id).join(','),
      cityState.dynamicElements.map((d) => `${d.id}:${d.kind}:${d.accentColor}`).join(','),
      cityState.terrainEdits.map((e) => e.id).join(','),
      overlay,
    ].join('|');

    if (sig !== lastCitySignatureRef.current) {
      lastCitySignatureRef.current = sig;
      rebuildVersionRef.current += 1;
    }
  }, [cityState, overlay]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: isSoftwareGl,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const skyColor = new THREE.Color(0xc7dff2);
    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(0xc7dff2, 0.00068);

    // Studio IBL for metallic landmarks & glass skyscrapers
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.5, 1300);
    camera.position.set(14, 48, 56);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.44;
    controls.minPolarAngle = 0.2;
    controls.minDistance = 14;
    controls.maxDistance = 440;
    controls.target.set(0, 0, -14);
    controls.update();

    // Warm Sun Key + Cool Sky Hemisphere Fill
    const hemiLight = new THREE.HemisphereLight(0xbbe1fa, 0x3f4e4f, 0.85);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff4dc, 1.85);
    sunLight.position.set(120, 175, 95);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 540;
    const d = 225;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.55);
    rimLight.position.set(-90, 60, -110);
    scene.add(rimLight);

    const textures: CityTextures = createCityTextures(renderer);

    // =========================================
    // STATIC HIGH-RES FULL MACAU TERRAIN & WATER
    // =========================================
    const terrainSize = MAP_HALF_SIZE * 2.15;
    const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, 288, 288);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    const cLow = new THREE.Color(0x3b7a57);
    const cHigh = new THREE.Color(0x234c35);
    const cCoast = new THREE.Color(0xd6c69c);
    const cHacSa = new THREE.Color(0x4a4035);
    const cReclaimed = new THREE.Color(0x7c8f87);
    const cShallow = new THREE.Color(0x149eb0);
    const cDeep = new THREE.Color(0x0f2f47);
    const tmpCol = new THREE.Color();

    const sampleCoastalHeight = (vx: number, vz: number, edits?: TerrainEdit[]): number => {
      const h0 = terrainHeightAt(vx, vz, edits);
      const w0 = isWaterAt(vx, vz, edits);
      const r = 1.15;
      const n1 = terrainHeightAt(vx + r, vz, edits);
      const n2 = terrainHeightAt(vx - r, vz, edits);
      const n3 = terrainHeightAt(vx, vz + r, edits);
      const n4 = terrainHeightAt(vx, vz - r, edits);
      const sameShore =
        isWaterAt(vx + r, vz, edits) === w0 &&
        isWaterAt(vx - r, vz, edits) === w0 &&
        isWaterAt(vx, vz + r, edits) === w0 &&
        isWaterAt(vx, vz - r, edits) === w0;
      if (sameShore) return h0;
      return h0 * 0.52 + ((n1 + n2 + n3 + n4) * 0.25) * 0.48;
    };

    const colorAttr = new THREE.BufferAttribute(colors, 3);
    terrainGeo.setAttribute('color', colorAttr);

    const updateTerrainGeometry = (edits?: TerrainEdit[]) => {
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        const h = sampleCoastalHeight(vx, vz, edits);
        posAttr.setY(i, h);

        if (h < -0.58) {
          tmpCol.copy(cDeep).lerp(cShallow, Math.max(0, (h + 1.55) / 0.97));
        } else if (h < 0.08) {
          tmpCol.copy(cShallow).lerp(cCoast, Math.max(0, (h + 0.58) / 0.66));
        } else if (isReclaimedZoneSurface(vx, vz, edits)) {
          tmpCol.copy(cReclaimed).lerp(cLow, Math.min(1, Math.max(0, (h - 0.35) * 0.5)));
        } else if (isHacSaBeachCoast(vx, vz) && h < 0.95) {
          tmpCol.copy(cHacSa).lerp(cLow, Math.max(0, (h - 0.25) / 0.7));
        } else if (isCheocVanBeachCoast(vx, vz) && h < 0.85) {
          tmpCol.copy(cCoast).lerp(cLow, Math.max(0, (h - 0.25) / 0.6));
        } else if (h < 0.44) {
          tmpCol.copy(cCoast).lerp(cLow, Math.max(0, (h - 0.08) / 0.36));
        } else {
          tmpCol.copy(cLow).lerp(cHigh, Math.min(1, (h - 0.44) / 6.2));
        }
        colors[i * 3] = tmpCol.r;
        colors[i * 3 + 1] = tmpCol.g;
        colors[i * 3 + 2] = tmpCol.b;
      }
      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      terrainGeo.computeVertexNormals();
    };
    updateTerrainGeometry(stateRef.current.terrainEdits);

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.02,
      bumpMap: textures.terrainBump,
      bumpScale: 0.08,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Seamless Deep Seabed + Translucent Pearl River Estuary Water
    const seabedGeo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
    seabedGeo.rotateX(-Math.PI / 2);
    const seabedMat = new THREE.MeshBasicMaterial({ color: 0x163d57 });
    const seabedMesh = new THREE.Mesh(seabedGeo, seabedMat);
    seabedMesh.position.y = -1.56;
    scene.add(seabedMesh);

    textures.waterBump.repeat.set(36, 36);
    const waterGeo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0891b2,
      roughness: 0.14,
      metalness: 0.35,
      bumpMap: textures.waterBump,
      bumpScale: 0.11,
      transparent: true,
      opacity: 0.78,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = -0.3;
    waterMesh.receiveShadow = true;
    waterMesh.renderOrder = 1;
    scene.add(waterMesh);

    // Instanced Multi-Tone Natural Hillside Trees across all 8 real Macau hills
    const treeTrunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.35, 6);
    treeTrunkGeo.translate(0, 0.65, 0);
    const treeCrownGeo = new THREE.DodecahedronGeometry(1.12, 1);
    treeCrownGeo.translate(0, 2.05, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c371e, roughness: 0.94 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 });

    const hillClusters = [
      { cx: -12, cz: -74, r: 22 }, // 東望洋山 Guia Hill
      { cx: -68, cz: -116, r: 20 }, // 望廈山 Mong Ha
      { cx: -146, cz: -160, r: 16 }, // 青洲山 Ilha Verde
      { cx: -64, cz: -20, r: 18 }, // 西望洋山 Penha Hill
      { cx: -56, cz: 44, r: 21 }, // 小潭山 Taipa Pequena
      { cx: 54, cz: 48, r: 24 }, // 大潭山 Taipa Grande
      { cx: -14, cz: 158, r: 34 }, // 疊石塘山 Alto de Coloane
      { cx: 102, cz: 162, r: 22 }, // 九澳山 Ka Ho Hill
    ];

    const treeCoords: { x: number; y: number; z: number; s: number }[] = [];
    for (let i = 0; i < 540; i++) {
      const cluster = hillClusters[i % hillClusters.length];
      const ang = i * 2.39996;
      const rad = 4.8 + ((i * 11) % 100) * 0.01 * cluster.r;
      const tx = cluster.cx + Math.cos(ang) * rad;
      const tz = cluster.cz + Math.sin(ang) * rad;
      if (isWaterAt(tx, tz)) continue;
      if (Math.hypot(tx + 12, tz + 74) < 4.5 || Math.hypot(tx + 14, tz - 158) < 5.5) continue;
      const y = terrainHeightAt(tx, tz);
      if (y > 0.85) {
        treeCoords.push({
          x: tx,
          y,
          z: tz,
          s: 0.72 + (i % 6) * 0.13,
        });
      }
    }
    const trunkInst = new THREE.InstancedMesh(treeTrunkGeo, trunkMat, treeCoords.length);
    const crownInst = new THREE.InstancedMesh(treeCrownGeo, crownMat, treeCoords.length);
    crownInst.castShadow = !isSoftwareGl;
    treeCoords.forEach((_, idx) => {
      const hueShift = idx % 29 === 0 ? 0.92 : 0.36 + (idx % 5) * 0.016;
      const sat = idx % 29 === 0 ? 0.72 : 0.56 + (idx % 3) * 0.07;
      const light = idx % 29 === 0 ? 0.32 : 0.14 + (idx % 4) * 0.035;
      crownInst.setColorAt(idx, new THREE.Color().setHSL(hueShift, sat, light));
    });
    if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;

    const syncTreeInstances = (st: CityState) => {
      treeCoords.forEach((tc, idx) => {
        const blocked =
          isWaterAt(tc.x, tc.z, st.terrainEdits) ||
          st.landmarks.some((lm) => Math.hypot(lm.x - tc.x, lm.z - tc.z) < 6.8) ||
          st.buildings.some((b) => Math.hypot(b.x - tc.x, b.z - tc.z) < 4.2);
        if (blocked) {
          _vec3.set(tc.x, -50, tc.z);
          _scale.setScalar(0.001);
        } else {
          const y = terrainHeightAt(tc.x, tc.z, st.terrainEdits);
          _vec3.set(tc.x, y, tc.z);
          _scale.setScalar(tc.s);
        }
        _mat4.compose(_vec3, _quat, _scale);
        trunkInst.setMatrixAt(idx, _mat4);
        crownInst.setMatrixAt(idx, _mat4);
      });
      trunkInst.instanceMatrix.needsUpdate = true;
      crownInst.instanceMatrix.needsUpdate = true;
      trunkInst.computeBoundingSphere();
      crownInst.computeBoundingSphere();
    };
    syncTreeInstances(stateRef.current);
    scene.add(trunkInst, crownInst);

    // =========================================
    // ICONIC FULL MACAU ARCHITECTURAL SILHOUETTES
    // =========================================
    const geoLandmarksGroup = new THREE.Group();
    const geoWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.52 });
    const geoGoldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.28, metalness: 0.72 });
    const geoAsphaltMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
    const geoRoofMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35, metalness: 0.45 });
    const geoTerracottaMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.65 });
    const geoCrimsonMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 });
    const geoMintMat = new THREE.MeshStandardMaterial({ color: 0x6ee7b7, roughness: 0.55 });
    const geoStoneMat = new THREE.MeshStandardMaterial({ color: 0xd6cfc2, roughness: 0.78 });
    const geoConcreteMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.72 });
    const geoGlassMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.16,
      metalness: 0.62,
    });

    // Helper for simple grounded placements
    const addGeoMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (ry !== 0) m.rotation.y = ry;
      geoLandmarksGroup.add(m);
      return m;
    };

    // 1. Guia Lighthouse, Fortress Bastion & Chapel (東望洋燈塔、砲台圍牆與聖母雪地殿) (-12, -74)
    const guiaY = terrainHeightAt(-12, -74);
    addGeoMesh(new THREE.CylinderGeometry(4.2, 4.8, 1.8, 12), geoStoneMat, -12, guiaY - 0.1, -74);
    addGeoMesh(new THREE.CylinderGeometry(1.1, 1.55, 4.8, 14), geoWhiteMat, -12, guiaY + 2.4, -74);
    addGeoMesh(new THREE.CylinderGeometry(1.35, 1.35, 0.35, 14), geoCrimsonMat, -12, guiaY + 4.75, -74);
    addGeoMesh(new THREE.CylinderGeometry(0.65, 0.65, 1.1, 12), geoGoldMat, -12, guiaY + 5.45, -74);
    addGeoMesh(new THREE.ConeGeometry(0.85, 0.75, 12), geoCrimsonMat, -12, guiaY + 6.3, -74);
    addGeoMesh(new THREE.BoxGeometry(2.8, 1.8, 3.6), geoWhiteMat, -14.8, guiaY + 0.9, -73.5);
    addGeoMesh(new THREE.BoxGeometry(3.0, 0.4, 3.8), geoTerracottaMat, -14.8, guiaY + 2.0, -73.5);

    // 2. Ruins of St. Paul's (大三巴牌坊與石階) near (-34, -62)
    const stPaulY = terrainHeightAt(-34, -62);
    for (let s = 0; s < 3; s++) {
      addGeoMesh(new THREE.BoxGeometry(5.6 - s * 0.4, 0.7, 2.2), geoStoneMat, -34, stPaulY + s * 0.45, -58.8 - s * 1.4);
    }
    addGeoMesh(new THREE.BoxGeometry(5.2, 4.2, 0.75), geoStoneMat, -34, stPaulY + 2.6, -62.4);
    addGeoMesh(new THREE.BoxGeometry(3.6, 1.8, 0.7), geoStoneMat, -34, stPaulY + 5.3, -62.4);
    addGeoMesh(new THREE.ConeGeometry(1.9, 1.6, 4), geoStoneMat, -34, stPaulY + 6.9, -62.4, Math.PI / 4);

    // 3. A-Ma Temple (媽閣廟) at Penha Southwest Shore (-76, -16)
    const amaTempleY = terrainHeightAt(-76, -16);
    addGeoMesh(new THREE.BoxGeometry(6.4, 1.2, 5.2), geoStoneMat, -76, amaTempleY + 0.1, -16);
    addGeoMesh(new THREE.BoxGeometry(4.2, 1.6, 3.2), geoCrimsonMat, -76, amaTempleY + 1.4, -16);
    addGeoMesh(new THREE.BoxGeometry(5.0, 0.55, 3.8), geoTerracottaMat, -76, amaTempleY + 2.45, -16);
    addGeoMesh(new THREE.BoxGeometry(2.6, 0.5, 2.2), geoGoldMat, -76, amaTempleY + 2.95, -16);

    // 4. Barrier Gate Ceremonial Archway (關閘凱旋門) at (-18, -184)
    const gateY = terrainHeightAt(-18, -184);
    addGeoMesh(new THREE.BoxGeometry(12, 1.0, 4.2), geoStoneMat, -18, gateY + 0.1, -184);
    addGeoMesh(new THREE.BoxGeometry(1.6, 4.8, 1.6), geoWhiteMat, -22, gateY + 2.6, -184);
    addGeoMesh(new THREE.BoxGeometry(1.6, 4.8, 1.6), geoWhiteMat, -14, gateY + 2.6, -184);
    addGeoMesh(new THREE.BoxGeometry(10.8, 1.5, 1.9), geoWhiteMat, -18, gateY + 5.2, -184);
    addGeoMesh(new THREE.BoxGeometry(4.4, 0.85, 2.1), geoTerracottaMat, -18, gateY + 6.2, -184);

    // 5. Macau International Airport NNW-SSE Runway Island + Piano Keys + Jet Bridges (澳門國際機場)
    const rwyAngle = Math.atan2(7, 94);
    const rwyGroup = new THREE.Group();
    rwyGroup.position.set(168, 0.35, 74.5);
    rwyGroup.rotation.y = -rwyAngle;
    const addRwyMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, lx: number, ly: number, lz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(lx, ly, lz);
      rwyGroup.add(m);
    };
    addRwyMesh(new THREE.BoxGeometry(12.2, 0.52, 88), geoAsphaltMat, 0, 0, 0);
    addRwyMesh(new THREE.BoxGeometry(0.9, 0.56, 76), geoWhiteMat, 0, 0.02, 0);
    for (const endZ of [-39, 39]) {
      for (const stripeX of [-3.6, -1.8, 1.8, 3.6]) {
        addRwyMesh(new THREE.BoxGeometry(0.85, 0.57, 4.2), geoWhiteMat, stripeX, 0.03, endZ);
      }
    }
    geoLandmarksGroup.add(rwyGroup);

    addGeoMesh(new THREE.BoxGeometry(56, 0.45, 4.2), geoAsphaltMat, 134, 0.34, 46);
    addGeoMesh(new THREE.BoxGeometry(58, 0.45, 4.2), geoAsphaltMat, 135, 0.34, 90.5);
    addGeoMesh(new THREE.BoxGeometry(14, 0.45, 34), geoAsphaltMat, 108, 0.34, 68);
    addGeoMesh(new THREE.BoxGeometry(8.2, 2.8, 24), geoRoofMat, 98.5, 1.65, 68);
    for (const jbZ of [59, 65, 71, 77]) {
      addGeoMesh(new THREE.BoxGeometry(4.4, 0.7, 1.0), geoGlassMat, 104.4, 1.45, jbZ);
    }
    addGeoMesh(new THREE.CylinderGeometry(1.0, 1.4, 8.2, 12), geoWhiteMat, 152, 4.1, 62);
    addGeoMesh(new THREE.CylinderGeometry(2.3, 1.6, 1.7, 12), geoRoofMat, 152, 8.6, 62);

    // 6. HZMB Frontier Port Wave Hall + Eastward Cross-Sea Viaduct Bridge (港珠澳口岸與跨海高架) at (172, -86)
    addGeoMesh(new THREE.BoxGeometry(24, 1.8, 34), geoWhiteMat, 172, 0.85, -86);
    addGeoMesh(new THREE.BoxGeometry(21, 1.2, 31), geoRoofMat, 172, 2.25, -86);
    addGeoMesh(new THREE.BoxGeometry(6.5, 1.1, 32), geoGoldMat, 172, 3.15, -86);
    addGeoMesh(new THREE.BoxGeometry(26, 0.75, 4.5), geoWhiteMat, 140, 1.9, -86);
    addGeoMesh(new THREE.BoxGeometry(44, 0.85, 5.0), geoConcreteMat, 206, 2.35, -86);
    for (const pierX of [190, 202, 214, 226]) {
      addGeoMesh(new THREE.CylinderGeometry(0.65, 0.9, 4.4, 10), geoConcreteMat, pierX, 0.15, -86);
    }

    // 7. Alto de Coloane A-Ma Statue (疊石塘山媽祖像與漢白玉祭壇) at (-14, 158)
    const altoY = terrainHeightAt(-14, 158);
    addGeoMesh(new THREE.CylinderGeometry(3.4, 4.0, 1.6, 16), geoWhiteMat, -14, altoY + 0.25, 158);
    addGeoMesh(new THREE.CylinderGeometry(2.0, 2.5, 1.5, 16), geoWhiteMat, -14, altoY + 1.75, 158);
    addGeoMesh(new THREE.ConeGeometry(1.2, 5.2, 12), geoGoldMat, -14, altoY + 4.95, 158);

    // 8. University of Macau Hengqin Campus (澳門大學橫琴嶺南校區與圖書館) at (-166, 96)
    const umY = terrainHeightAt(-166, 96);
    addGeoMesh(new THREE.BoxGeometry(16, 3.2, 12), geoWhiteMat, -166, umY + 1.2, 96);
    addGeoMesh(new THREE.BoxGeometry(18, 2.4, 6), geoWhiteMat, -166, umY + 0.9, 80);
    addGeoMesh(new THREE.BoxGeometry(19, 0.7, 6.8), geoTerracottaMat, -166, umY + 2.4, 80);
    addGeoMesh(new THREE.BoxGeometry(18, 2.4, 6), geoWhiteMat, -166, umY + 0.9, 112);
    addGeoMesh(new THREE.BoxGeometry(19, 0.7, 6.8), geoTerracottaMat, -166, umY + 2.4, 112);
    addGeoMesh(new THREE.CylinderGeometry(4.2, 4.8, 1.6, 18), geoGoldMat, -166, umY + 3.4, 96);

    // 9. Old Taipa Houses Museum 5 Mint Villas (龍環葡韻五幢薄荷綠葡式別墅) near (-14..10, 56)
    for (let v = 0; v < 5; v++) {
      const vx = -14 + v * 5.2;
      const vz = 58;
      const vy = terrainHeightAt(vx, vz);
      addGeoMesh(new THREE.BoxGeometry(3.2, 2.0, 2.8), geoMintMat, vx, vy + 0.7, vz);
      addGeoMesh(new THREE.BoxGeometry(3.5, 0.55, 3.1), geoTerracottaMat, vx, vy + 1.9, vz);
    }

    // 10. Cotai Strip Resort Silhouettes (路氹金光大道大型綜合度假村天際線) near (0, 102)
    const cotaiY = terrainHeightAt(0, 102);
    addGeoMesh(new THREE.BoxGeometry(16, 2.2, 10), geoStoneMat, -12, cotaiY + 0.7, 102);
    addGeoMesh(new THREE.BoxGeometry(11, 5.2, 6.5), geoGoldMat, -12, cotaiY + 4.1, 102);
    addGeoMesh(new THREE.BoxGeometry(12, 2.0, 10), geoStoneMat, 14, cotaiY + 0.6, 100);
    addGeoMesh(new THREE.CylinderGeometry(0.45, 2.8, 12.5, 4), geoGoldMat, 14, cotaiY + 7.2, 100, Math.PI / 4);

    // 11. Outer Harbor & Pac On Ferry Terminals + Kun Iam Lotus Ecumenical Centre (外港・北安碼頭與觀音蓮花苑)
    addGeoMesh(new THREE.BoxGeometry(11, 2.4, 6.5), geoRoofMat, 72, 1.2, -52);
    addGeoMesh(new THREE.BoxGeometry(14, 0.7, 3.6), geoConcreteMat, 78, 0.4, -47);
    addGeoMesh(new THREE.BoxGeometry(4.8, 1.0, 1.8), geoWhiteMat, 85, 0.25, -47, 0.25);
    addGeoMesh(new THREE.BoxGeometry(3.8, 0.5, 1.5), geoCrimsonMat, 85, 0.85, -47, 0.25);

    // Kun Iam Ecumenical Centre (觀音蓮花苑) offshore NAPE pier
    addGeoMesh(new THREE.BoxGeometry(2.2, 0.45, 9), geoConcreteMat, 53, 0.3, -34, -0.45);
    addGeoMesh(new THREE.CylinderGeometry(2.6, 3.2, 0.9, 12), geoWhiteMat, 56, 0.35, -30);
    addGeoMesh(new THREE.CylinderGeometry(0.75, 1.25, 4.6, 12), geoGoldMat, 56, 3.0, -30);

    // Pac On Taipa Ferry Terminal (氹仔北安客運碼頭)
    addGeoMesh(new THREE.BoxGeometry(12, 2.4, 7), geoRoofMat, 90, 1.2, 22);
    addGeoMesh(new THREE.BoxGeometry(4.8, 1.0, 1.8), geoWhiteMat, 99, 0.25, 12, -0.35);
    addGeoMesh(new THREE.BoxGeometry(3.8, 0.5, 1.5), geoCrimsonMat, 99, 0.85, 12, -0.35);

    // 12. Hac Sa Beach Parasols, Ka Ho Port Cranes & Coloane Village Pier (黑沙海灘、九澳深水港與路環譚公碼頭)
    for (let u = 0; u < 5; u++) {
      const ux = 44 + u * 7;
      const uz = 171;
      const uy = terrainHeightAt(ux, uz);
      addGeoMesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6), geoWhiteMat, ux, uy + 0.65, uz);
      addGeoMesh(new THREE.ConeGeometry(1.25, 0.55, 8), u % 2 === 0 ? geoCrimsonMat : geoGoldMat, ux, uy + 1.5, uz);
    }
    for (let c = 0; c < 3; c++) {
      const cx = 134 + c * 9;
      const cz = 156;
      const cy = terrainHeightAt(cx, cz);
      addGeoMesh(new THREE.BoxGeometry(1.4, 5.2, 1.4), geoCrimsonMat, cx, cy + 2.3, cz);
      addGeoMesh(new THREE.BoxGeometry(1.0, 0.7, 7.2), geoGoldMat, cx, cy + 4.9, cz + 1.6);
    }
    const coloaneY = terrainHeightAt(-102, 155);
    addGeoMesh(new THREE.BoxGeometry(4.5, 1.5, 3.6), geoCrimsonMat, -102, coloaneY + 0.75, 155);
    addGeoMesh(new THREE.BoxGeometry(5.2, 0.6, 4.2), geoTerracottaMat, -102, coloaneY + 1.75, 155);
    addGeoMesh(new THREE.BoxGeometry(8, 0.45, 2.4), geoConcreteMat, -116, 0.35, 155);

    scene.add(geoLandmarksGroup);

    // Dynamic Scene Groups
    const tilesGroup = new THREE.Group();
    const roadsGroup = new THREE.Group();
    const parcelsGroup = new THREE.Group();
    const buildingsGroup = new THREE.Group();
    const landmarksGroup = new THREE.Group();
    const dynamicElementsGroup = new THREE.Group();
    const previewGroup = new THREE.Group();
    const simsGroup = new THREE.Group();
    const npcsGroup = new THREE.Group();
    const navLinesGroup = new THREE.Group();
    const remoteCursorsGroup = new THREE.Group();
    scene.add(
      tilesGroup,
      roadsGroup,
      parcelsGroup,
      buildingsGroup,
      landmarksGroup,
      dynamicElementsGroup,
      previewGroup,
      simsGroup,
      npcsGroup,
      navLinesGroup,
      remoteCursorsGroup,
    );

    // Preview Meshes (Road Snap Indicator, Guide Lines, Ghost Road, Landmark Preview)
    const snapRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.55, 24),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }),
    );
    snapRingMesh.rotation.x = -Math.PI / 2;
    snapRingMesh.visible = false;
    previewGroup.add(snapRingMesh);

    const terraformRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 36),
      new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    terraformRingMesh.rotation.x = -Math.PI / 2;
    terraformRingMesh.visible = false;
    previewGroup.add(terraformRingMesh);

    const guideGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const guideMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 1.5,
      gapSize: 0.9,
    });
    const guideLineMesh = new THREE.Line(guideGeo, guideMat);
    guideLineMesh.visible = false;
    previewGroup.add(guideLineMesh);

    const secGuideGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const secGuideMat = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      dashSize: 1.2,
      gapSize: 0.8,
    });
    const secGuideLineMesh = new THREE.Line(secGuideGeo, secGuideMat);
    secGuideLineMesh.visible = false;
    previewGroup.add(secGuideLineMesh);

    const ghostRoadMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.55,
    });
    const ghostRoadMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.25, 1), ghostRoadMat);
    ghostRoadMesh.visible = false;
    previewGroup.add(ghostRoadMesh);

    // Instanced Traffic Vehicles (cars + Macau green/yellow buses)
    const MAX_VEHICLES = 72;
    const carGeo = new THREE.BoxGeometry(1.1, 0.65, 2.0);
    carGeo.translate(0, 0.33, 0);
    const carMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.4 });
    const vehiclesInst = new THREE.InstancedMesh(carGeo, carMat, MAX_VEHICLES);
    vehiclesInst.frustumCulled = false;
    scene.add(vehiclesInst);

    const vehiclePool: VehicleInstance[] = Array.from({ length: MAX_VEHICLES }, (_, i) => ({
      segIndex: i,
      t: (i * 0.6180339887) % 1,
      dir: i % 2 === 0 ? 1 : -1,
      speed: 0.11 + (i % 5) * 0.025,
      laneOffset: i % 2 === 0 ? 0.95 : -0.95,
      isBus: i % 5 === 0,
    }));

    // Track Sim Avatars, NPC Citizens & DOM Labels
    const simMeshes = new Map<
      string,
      {
        group: THREE.Group;
        currX: number;
        currZ: number;
        currHeading: number;
        walkPhase: number;
        color: string;
      }
    >();
    const simLabelEls = new Map<string, HTMLDivElement>();
    const npcPool: NpcCitizen[] = [];
    const npcMeshes = new Map<string, THREE.Group>();
    const npcLabelEls = new Map<string, HTMLDivElement>();
    const navRouteLinePool: THREE.Line[] = [];
    const MAX_NAV_LINES = 16;
    const MAX_LINE_VERTS = 24;
    const navLineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.72,
    });
    const highlightNavLineMat = new THREE.LineBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.95,
    });
    for (let i = 0; i < MAX_NAV_LINES; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINE_VERTS * 3), 3));
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, i === 0 ? highlightNavLineMat : navLineMat);
      line.visible = false;
      line.frustumCulled = false;
      navLinesGroup.add(line);
      navRouteLinePool.push(line);
    }

    let npcEntrancesCache: BuildingEntrance[] = [];
    let selectedNpcId: string | null = null;
    const remoteCursorMeshes = new Map<string, THREE.Mesh>();

    let builtVersion = -1;
    let pickableParcels: THREE.Mesh[] = [];
    let pickableSegments: THREE.Mesh[] = [];
    let pickableNodes: THREE.Mesh[] = [];
    let pickableBuildings: THREE.Mesh[] = [];
    let pickableLandmarks: THREE.Mesh[] = [];
    let pickableDynamicElements: THREE.Mesh[] = [];
    let pickableNpcs: THREE.Mesh[] = [];
    let dynamicElementEntries: Array<{
      el: DynamicWorldElement;
      group: THREE.Group;
      phaseOffset: number;
    }> = [];

    function disposeGroupChildren(g: THREE.Group) {
      while (g.children.length > 0) {
        const child = g.children[0];
        g.remove(child);
        child.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh || (obj as THREE.Line).isLine) {
            const m = obj as THREE.Mesh | THREE.Line;
            // Dispose dynamic road/parcel/tile geometries (building shared materials stay cached)
            if (m.userData.dynamicGeo) m.geometry.dispose();
            if (m.userData.dynamicMat && !Array.isArray(m.material)) m.material.dispose();
          }
        });
      }
    }

    function rebuildCityGeometry() {
      const st = stateRef.current;
      const ov = overlayRef.current;
      const nodeMap = new Map<string, RoadNode>(st.nodes.map((n) => [n.id, n]));

      disposeGroupChildren(tilesGroup);
      disposeGroupChildren(roadsGroup);
      disposeGroupChildren(parcelsGroup);
      disposeGroupChildren(buildingsGroup);
      disposeGroupChildren(landmarksGroup);
      disposeGroupChildren(dynamicElementsGroup);
      disposeGroupChildren(dynamicElementsGroup);
      disposeGroupChildren(dynamicElementsGroup);

      pickableParcels = [];
      pickableSegments = [];
      pickableNodes = [];
      pickableBuildings = [];
      pickableLandmarks = [];
      pickableDynamicElements = [];
      dynamicElementEntries = [];

      // 0. Progressive Macau 5x5 Terrain-Conforming District Borders & Locked Curtains
      for (const tile of st.mapTiles) {
        const w = tile.maxX - tile.minX;
        const d = tile.maxZ - tile.minZ;
        const cx = (tile.minX + tile.maxX) * 0.5;
        const cz = (tile.minZ + tile.maxZ) * 0.5;

        if (!tile.unlocked) {
          const adjacent = isTileAdjacentToUnlocked(tile, st.mapTiles);
          const curtainGeo = new THREE.PlaneGeometry(w - 0.8, d - 0.8, 16, 16);
          curtainGeo.rotateX(-Math.PI / 2);
          const cPos = curtainGeo.attributes.position as THREE.BufferAttribute;
          for (let vIdx = 0; vIdx < cPos.count; vIdx++) {
            const wx = cx + cPos.getX(vIdx);
            const wz = cz + cPos.getZ(vIdx);
            cPos.setY(vIdx, Math.max(-0.16, terrainHeightAt(wx, wz, st.terrainEdits) + 0.12));
          }
          cPos.needsUpdate = true;
          curtainGeo.computeVertexNormals();
          const curtainMat = new THREE.MeshBasicMaterial({
            color: adjacent ? 0x38bdf8 : 0x334155,
            transparent: true,
            opacity: adjacent ? 0.11 : 0.24,
            depthWrite: false,
          });
          const curtain = new THREE.Mesh(curtainGeo, curtainMat);
          curtain.position.set(cx, 0, cz);
          curtain.renderOrder = 2;
          curtain.userData = { dynamicGeo: true, dynamicMat: true, kind: 'tile', tile };
          tilesGroup.add(curtain);

          const x0 = tile.minX + 0.4;
          const x1 = tile.maxX - 0.4;
          const z0 = tile.minZ + 0.4;
          const z1 = tile.maxZ - 0.4;
          const pts: THREE.Vector3[] = [];
          const stepsPerEdge = 12;
          const pushPt = (px: number, pz: number) => {
            pts.push(new THREE.Vector3(px, Math.max(0.22, terrainHeightAt(px, pz, st.terrainEdits) + 0.28), pz));
          };
          for (let i = 0; i < stepsPerEdge; i++) pushPt(x0 + ((x1 - x0) * i) / stepsPerEdge, z0);
          for (let i = 0; i < stepsPerEdge; i++) pushPt(x1, z0 + ((z1 - z0) * i) / stepsPerEdge);
          for (let i = 0; i < stepsPerEdge; i++) pushPt(x1 - ((x1 - x0) * i) / stepsPerEdge, z1);
          for (let i = 0; i < stepsPerEdge; i++) pushPt(x0, z1 - ((z1 - z0) * i) / stepsPerEdge);

          const borderGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const borderMat = new THREE.LineBasicMaterial({
            color: adjacent ? 0x38bdf8 : 0x64748b,
            transparent: true,
            opacity: adjacent ? 0.82 : 0.34,
          });
          const borderLoop = new THREE.LineLoop(borderGeo, borderMat);
          borderLoop.renderOrder = 3;
          borderLoop.userData = { dynamicGeo: true, dynamicMat: true };
          tilesGroup.add(borderLoop);
        }
      }

      // 1. Sloped Roads & Cable-Stayed Cross-Harbor Bridges
      const roadUpVec = new THREE.Vector3(0, 1, 0);
      const roadForwardAxis = new THREE.Vector3(0, 0, 1);
      for (const seg of st.segments) {
        const a = nodeMap.get(seg.nodeA);
        const b = nodeMap.get(seg.nodeB);
        if (!a || !b) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len2d = Math.hypot(dx, dz);
        if (len2d < 0.5) continue;

        const roadW = seg.tier === 'street' ? 3.8 : 5.4;
        const angle = Math.atan2(dx, dz);
        const midX = (a.x + b.x) * 0.5;
        const midZ = (a.z + b.z) * 0.5;
        const yA = seg.isBridge ? 2.2 : terrainHeightAt(a.x, a.z, st.terrainEdits) + 0.14;
        const yB = seg.isBridge ? 2.2 : terrainHeightAt(b.x, b.z, st.terrainEdits) + 0.14;
        const dy = yB - yA;
        const len3d = Math.hypot(len2d, dy);
        const midH = (yA + yB) * 0.5;

        const tex = textures.roads[seg.tier].clone();
        tex.needsUpdate = true;
        tex.repeat.set(1, Math.max(1, len3d / 10));

        const trafficStyle = ov === 'traffic' ? mapTrafficLoadToD3Style(seg.trafficLoad) : null;

        const roadThickness = seg.isBridge ? 0.28 : 0.68;
        const roadGeo = new THREE.BoxGeometry(roadW, roadThickness, len3d + 0.8);
        const roadMat = new THREE.MeshStandardMaterial({
          map: tex,
          color: trafficStyle ? trafficStyle.colorInt : 0xffffff,
          emissive: trafficStyle ? trafficStyle.colorInt : 0x000000,
          emissiveIntensity: trafficStyle ? 0.24 : 0,
          roughness: 0.78,
          metalness: 0.05,
        });
        const roadMesh = new THREE.Mesh(roadGeo, roadMat);
        roadMesh.position.set(midX, midH - (seg.isBridge ? 0 : 0.22), midZ);
        const dir3 = new THREE.Vector3(dx, dy, dz).normalize();
        roadMesh.quaternion.setFromUnitVectors(roadForwardAxis, dir3);
        roadMesh.receiveShadow = true;
        roadMesh.userData = {
          dynamicGeo: true,
          dynamicMat: true,
          kind: 'segment',
          segmentId: seg.id,
          segment: seg,
        };
        roadsGroup.add(roadMesh);
        pickableSegments.push(roadMesh);

        // Crisp D3 density saturation ribbon along driving lanes when traffic overlay is active
        if (trafficStyle) {
          const stripGeo = new THREE.BoxGeometry(roadW * 0.72, 0.05, len3d + 0.5);
          const stripMat = new THREE.MeshStandardMaterial({
            color: trafficStyle.colorInt,
            emissive: trafficStyle.colorInt,
            emissiveIntensity: 0.32,
            roughness: 0.55,
            metalness: 0.05,
            transparent: true,
            opacity: 0.84,
          });
          const stripMesh = new THREE.Mesh(stripGeo, stripMat);
          stripMesh.position.set(midX, midH + 0.14, midZ);
          stripMesh.quaternion.setFromUnitVectors(roadForwardAxis, dir3);
          stripMesh.userData = { dynamicGeo: true, dynamicMat: true };
          roadsGroup.add(stripMesh);
        }

        // Grounded Bridge Piers, Pile Caps, Towers & Cable-Stays when crossing harbor
        if (seg.isBridge) {
          const pierMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.7 });
          const pierCount = Math.max(2, Math.floor(len2d / 14));
          for (let p = 1; p < pierCount; p++) {
            const t = p / pierCount;
            const px = a.x + dx * t;
            const pz = a.z + dz * t;
            const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 5.4, 10), pierMat);
            pier.position.set(px, -0.4, pz);
            pier.userData = { dynamicGeo: true, dynamicMat: true };
            roadsGroup.add(pier);
          }
          const pylonMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.25 });
          const cableMat = new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.75 });
          const nx = -dz / len2d;
          const nz = dx / len2d;
          const ux = dx / len2d;
          const uz = dz / len2d;
          for (const side of [-1, 1]) {
            const tx = midX + nx * 3.15 * side;
            const tz = midZ + nz * 3.15 * side;
            const tower = new THREE.Mesh(new THREE.BoxGeometry(0.65, 11.8, 0.9), pylonMat);
            tower.position.set(tx, 5.3, tz);
            tower.rotation.y = angle;
            tower.userData = { dynamicGeo: true, dynamicMat: true };
            roadsGroup.add(tower);

            const stayReach = Math.min(18, len2d * 0.38);
            const stayPts = [
              new THREE.Vector3(tx, 10.7, tz),
              new THREE.Vector3(tx - ux * stayReach, 2.32, tz - uz * stayReach),
              new THREE.Vector3(tx, 10.7, tz),
              new THREE.Vector3(tx + ux * stayReach, 2.32, tz + uz * stayReach),
              new THREE.Vector3(tx, 8.6, tz),
              new THREE.Vector3(tx - ux * stayReach * 0.55, 2.32, tz - uz * stayReach * 0.55),
              new THREE.Vector3(tx, 8.6, tz),
              new THREE.Vector3(tx + ux * stayReach * 0.55, 2.32, tz + uz * stayReach * 0.55),
            ];
            const cableGeo = new THREE.BufferGeometry().setFromPoints(stayPts);
            const cables = new THREE.LineSegments(cableGeo, cableMat);
            cables.userData = { dynamicGeo: true, dynamicMat: true };
            roadsGroup.add(cables);
          }
          const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.65, 0.75), pylonMat);
          crossBeam.position.set(midX, 10.6, midZ);
          crossBeam.rotation.y = angle;
          crossBeam.userData = { dynamicGeo: true, dynamicMat: true };
          roadsGroup.add(crossBeam);
          void roadUpVec;
        }
      }

      // 2. Road Intersections & Roundabouts (圓形地)
      for (const node of st.nodes) {
        const yBase = node.isBridgeNode ? 2.24 : terrainHeightAt(node.x, node.z, st.terrainEdits) + 0.16;
        const nodeTrafficStyle =
          ov === 'traffic'
            ? mapTrafficLoadToD3Style(computeNodeTrafficLoad(node.id, st.segments))
            : null;
        if (node.isRoundabout) {
          const outer = new THREE.Mesh(
            new THREE.CylinderGeometry(4.4, 4.6, 0.42, 24),
            new THREE.MeshStandardMaterial({
              color: nodeTrafficStyle ? nodeTrafficStyle.colorInt : 0x334155,
              emissive: nodeTrafficStyle ? nodeTrafficStyle.colorInt : 0x000000,
              emissiveIntensity: nodeTrafficStyle ? 0.28 : 0,
              roughness: 0.72,
            }),
          );
          outer.position.set(node.x, yBase - 0.06, node.z);
          outer.receiveShadow = true;
          outer.userData = { dynamicGeo: true, dynamicMat: true, kind: 'node', nodeId: node.id };
          roadsGroup.add(outer);
          pickableNodes.push(outer);

          const island = new THREE.Mesh(
            new THREE.CylinderGeometry(2.0, 2.2, 0.55, 20),
            new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.85 }),
          );
          island.position.set(node.x, yBase + 0.16, node.z);
          island.userData = { dynamicGeo: true, dynamicMat: true };
          roadsGroup.add(island);

          const obelisk = new THREE.Mesh(
            new THREE.ConeGeometry(0.55, 2.4, 8),
            new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.25, metalness: 0.8 }),
          );
          obelisk.position.set(node.x, yBase + 1.5, node.z);
          obelisk.userData = { dynamicGeo: true, dynamicMat: true };
          roadsGroup.add(obelisk);
        } else {
          const cap = new THREE.Mesh(
            new THREE.CylinderGeometry(2.5, 2.5, 0.36, 16),
            new THREE.MeshStandardMaterial({
              color: nodeTrafficStyle ? nodeTrafficStyle.colorInt : 0x272c35,
              emissive: nodeTrafficStyle ? nodeTrafficStyle.colorInt : 0x000000,
              emissiveIntensity: nodeTrafficStyle ? 0.28 : 0,
              roughness: 0.75,
            }),
          );
          cap.position.set(node.x, yBase - 0.06, node.z);
          cap.userData = { dynamicGeo: true, dynamicMat: true, kind: 'node', nodeId: node.id };
          roadsGroup.add(cap);
          pickableNodes.push(cap);
        }
      }

      // 3. Zone Parcels (Aligned flush to road sides with hillside retaining foundation!)
      const zoneColors: Record<ZoneType, number> = {
        none: 0x64748b,
        residential: 0x22c55e,
        commercial: 0x0ea5e9,
        tourism: 0xf59e0b,
        industrial: 0x8b5cf6,
      };

      for (const p of st.parcels) {
        const y = terrainHeightAt(p.x, p.z, st.terrainEdits) + 0.08;
        let colorHex = zoneColors[p.zone];
        let opacity = p.zone === 'none' ? 0.2 : 0.48;

        if (ov === 'land_value') {
          const ratio = Math.max(0, Math.min(1, (p.landValue - 20) / 70));
          const c = new THREE.Color(0x38bdf8).lerp(new THREE.Color(0xf59e0b), ratio);
          colorHex = c.getHex();
          opacity = 0.68;
        }

        const pGeo = new THREE.BoxGeometry(p.width, 0.72, p.depth);
        const pMat = new THREE.MeshStandardMaterial({
          color: colorHex,
          roughness: 0.85,
          transparent: true,
          opacity,
        });
        const pMesh = new THREE.Mesh(pGeo, pMat);
        pMesh.position.set(p.x, y - 0.3, p.z);
        pMesh.rotation.y = -p.angle;
        pMesh.receiveShadow = true;
        pMesh.userData = {
          dynamicGeo: true,
          dynamicMat: true,
          kind: 'parcel',
          parcelId: p.id,
          parcel: p,
        };
        parcelsGroup.add(pMesh);
        pickableParcels.push(pMesh);

        // Player-owned parcel border highlight
        if (p.ownerPlayerId) {
          const border = new THREE.Mesh(
            new THREE.RingGeometry(3.1, 3.45, 4),
            new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }),
          );
          border.rotation.x = -Math.PI / 2;
          border.rotation.z = Math.PI / 4 - p.angle;
          border.position.set(p.x, y + 0.08, p.z);
          border.userData = { dynamicGeo: true, dynamicMat: true };
          parcelsGroup.add(border);
        }
      }

      // 4. Composite 3D Buildings
      for (const b of st.buildings) {
        const bGroup = createBuildingGroup(b);
        bGroup.position.y = terrainHeightAt(b.x, b.z, st.terrainEdits) + 0.05;
        bGroup.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).userData.dynamicGeo = true;
        });
        buildingsGroup.add(bGroup);

        // Proxy hit mesh for fast raycasting
        const hitMesh = new THREE.Mesh(
          new THREE.BoxGeometry(5.5, 7 * b.level, 5.5),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        hitMesh.position.set(b.x, bGroup.position.y + 3.5 * b.level, b.z);
        hitMesh.userData = { dynamicGeo: true, dynamicMat: true, kind: 'building', building: b };
        buildingsGroup.add(hitMesh);
        pickableBuildings.push(hitMesh);
      }

      // 5. Landmarks
      for (const lm of st.landmarks) {
        const lmGroup = createLandmarkGroup(lm);
        const elev = terrainHeightAt(lm.x, lm.z, st.terrainEdits);
        lmGroup.position.y = lm.type === 'ferry_terminal' ? Math.max(-0.1, elev) + 0.05 : elev + 0.05;
        lmGroup.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).userData.dynamicGeo = true;
          if (o.name === 'ferrisWheel') animatedFerrisWheels.push(o);
          else if (o.name === 'turbineRotor') animatedTurbineRotors.push(o);
          else if (o.name === 'ferryBoat') animatedFerryBoats.push(o);
        });
        landmarksGroup.add(lmGroup);

        const hitMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(5.8, 5.8, 14, 10),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        hitMesh.position.set(lm.x, lmGroup.position.y + 7, lm.z);
        hitMesh.userData = { dynamicGeo: true, dynamicMat: true, kind: 'landmark', landmark: lm };
        landmarksGroup.add(hitMesh);
        pickableLandmarks.push(hitMesh);
      }

      // 5.5. AI-Generated Dynamic 3D World Elements (Parade Floats, Drone Shows, Markets, Flotillas)
      st.dynamicElements.forEach((el, idx) => {
        const grp = new THREE.Group();
        const accentHex = new THREE.Color(el.accentColor || '#38bdf8');
        const accentMat = new THREE.MeshStandardMaterial({
          color: accentHex,
          emissive: accentHex,
          emissiveIntensity: 0.45,
          roughness: 0.35,
        });
        const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
        const goldMat = new THREE.MeshStandardMaterial({
          color: 0xfbbf24,
          emissive: 0xf59e0b,
          emissiveIntensity: 0.25,
          metalness: 0.6,
          roughness: 0.3,
        });

        const addPart = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, name?: string) => {
          const m = new THREE.Mesh(geo, mat);
          m.position.set(x, y, z);
          if (name) m.name = name;
          m.userData = { dynamicGeo: true, dynamicMat: true };
          grp.add(m);
          return m;
        };

        if (el.kind === 'parade_float') {
          addPart(new THREE.BoxGeometry(2.1, 0.9, 4.6), whiteMat, 0, 0.65, 0);
          addPart(new THREE.BoxGeometry(1.9, 0.7, 3.6), accentMat, 0, 1.4, 0);
          const spinner = new THREE.Group();
          spinner.name = 'spinner';
          spinner.position.set(0, 2.55, 0);
          const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), goldMat);
          star.userData = { dynamicGeo: true, dynamicMat: true };
          spinner.add(star);
          grp.add(spinner);
          addPart(new THREE.SphereGeometry(0.28, 8, 8), goldMat, -0.95, 1.85, 1.4);
          addPart(new THREE.SphereGeometry(0.28, 8, 8), goldMat, 0.95, 1.85, -1.4);
        } else if (el.kind === 'drone_show') {
          addPart(new THREE.RingGeometry(2.2, 2.7, 24), accentMat, 0, 0.2, 0).rotation.x = -Math.PI / 2;
          const spinner = new THREE.Group();
          spinner.name = 'spinner';
          spinner.position.set(0, 13.5, 0);
          for (let dIdx = 0; dIdx < 10; dIdx++) {
            const ang = (dIdx / 10) * Math.PI * 2;
            const r = dIdx % 2 === 0 ? 5.2 : 3.2;
            const drone = new THREE.Mesh(
              new THREE.SphereGeometry(0.42, 8, 8),
              dIdx % 3 === 0 ? goldMat : accentMat,
            );
            drone.position.set(Math.cos(ang) * r, Math.sin(ang * 2) * 1.1, Math.sin(ang) * r);
            drone.userData = { dynamicGeo: true, dynamicMat: true };
            spinner.add(drone);
          }
          grp.add(spinner);
        } else if (el.kind === 'harbor_flotilla') {
          const spinner = new THREE.Group();
          spinner.name = 'spinner';
          for (const offset of [-2.4, 2.4]) {
            const hull = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 5.2), accentMat);
            hull.position.set(offset, 0.25, offset * 0.6);
            hull.userData = { dynamicGeo: true, dynamicMat: true };
            const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 2.4), whiteMat);
            canopy.position.set(offset, 0.85, offset * 0.6);
            canopy.userData = { dynamicGeo: true, dynamicMat: true };
            const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), goldMat);
            lantern.position.set(offset, 1.45, offset * 0.6 + 1.8);
            lantern.userData = { dynamicGeo: true, dynamicMat: true };
            spinner.add(hull, canopy, lantern);
          }
          grp.add(spinner);
        } else {
          // street_market
          addPart(new THREE.CylinderGeometry(4.2, 4.4, 0.3, 18), whiteMat, 0, 0.15, 0);
          const stallOffsets: [number, number][] = [
            [-2.4, -2.0],
            [2.4, -2.0],
            [-2.4, 2.0],
            [2.4, 2.0],
          ];
          stallOffsets.forEach(([sx, sz], sIdx) => {
            addPart(new THREE.BoxGeometry(2.0, 1.3, 1.8), whiteMat, sx, 0.8, sz);
            addPart(
              new THREE.ConeGeometry(1.55, 1.0, 4),
              sIdx % 2 === 0 ? accentMat : goldMat,
              sx,
              1.95,
              sz,
            ).rotation.y = Math.PI / 4;
          });
          const spinner = new THREE.Group();
          spinner.name = 'spinner';
          spinner.position.set(0, 3.6, 0);
          for (let bIdx = 0; bIdx < 4; bIdx++) {
            const ang = (bIdx / 4) * Math.PI * 2;
            const balloon = new THREE.Mesh(
              new THREE.SphereGeometry(0.5, 10, 10),
              bIdx % 2 === 0 ? accentMat : goldMat,
            );
            balloon.position.set(Math.cos(ang) * 2.1, (bIdx % 2) * 0.5, Math.sin(ang) * 2.1);
            balloon.userData = { dynamicGeo: true, dynamicMat: true };
            spinner.add(balloon);
          }
          grp.add(spinner);
        }

        const baseY =
          el.kind === 'harbor_flotilla' ? -0.1 : terrainHeightAt(el.x, el.z, st.terrainEdits) + 0.1;
        grp.position.set(el.x, baseY, el.z);

        const hitMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(4.2, 4.2, el.kind === 'drone_show' ? 16 : 5, 10),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        hitMesh.position.y = el.kind === 'drone_show' ? 8 : 2.5;
        hitMesh.userData = {
          dynamicGeo: true,
          dynamicMat: true,
          kind: 'dynamic_element',
          element: el,
        };
        grp.add(hitMesh);
        pickableDynamicElements.push(hitMesh);
        dynamicElementsGroup.add(grp);
        dynamicElementEntries.push({ el, group: grp, phaseOffset: idx * 1.7 });
      });

      // 6. Refresh Citizen Navigation Entrances & Target NPC Swarm Size
      npcEntrancesCache = getBuildingEntrances(st);
      const desiredNpcs = computeTargetNpcCount(st);
      while (npcPool.length < desiredNpcs) {
        const idx = npcPool.length;
        const npcId = `npc_${idx}`;
        const npc = createNpcCitizen(npcId, idx, st);
        npcPool.push(npc);
        const grp = createNpcAvatarGroup(npc.shirtColor, npc.accessory);
        const hitBox = new THREE.Mesh(
          new THREE.CylinderGeometry(0.65, 0.65, 2.2, 6),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        hitBox.position.y = 1.1;
        hitBox.userData = { kind: 'npc', npcId };
        grp.add(hitBox);
        pickableNpcs.push(hitBox);
        npcsGroup.add(grp);
        npcMeshes.set(npcId, grp);
      }
      while (npcPool.length > desiredNpcs) {
        const removed = npcPool.pop()!;
        const grp = npcMeshes.get(removed.id);
        if (grp) {
          npcsGroup.remove(grp);
          npcMeshes.delete(removed.id);
        }
        const lbl = npcLabelEls.get(removed.id);
        if (lbl) {
          lbl.remove();
          npcLabelEls.delete(removed.id);
        }
        pickableNpcs = pickableNpcs.filter((m) => m.userData.npcId !== removed.id);
      }
    }

    // =========================================
    // INTERACTION & ROAD SNAPPING STATE
    // =========================================
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let roadStart: { pos: Vec2; nodeId?: string; segmentId?: string } | null = null;
    let currentSnap: SnapResult | null = null;
    let isDraggingZone = false;
    const paintedInStroke = new Set<string>();
    let lastHoverTime = 0;
    let lastCursorEmit = 0;

    function updatePointerNdc(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function getGroundPoint(): Vec2 | null {
      raycaster.setFromCamera(pointerNdc, camera);
      const tHits = raycaster.intersectObject(terrainMesh, false);
      if (tHits.length > 0) {
        return { x: tHits[0].point.x, z: tHits[0].point.z };
      }
      const hit = raycaster.ray.intersectPlane(_groundPlane, _vec3);
      if (!hit) return null;
      return { x: hit.x, z: hit.z };
    }

    function updateRoadPreview(e?: PointerEvent) {
      const t = toolRef.current;
      const st = stateRef.current;

      if (t === 'unlock_tile' && phaseRef.current === 'playing' && playModeRef.current === 'mayor') {
        snapRingMesh.visible = false;
        terraformRingMesh.visible = false;
        guideLineMesh.visible = false;
        secGuideLineMesh.visible = false;
        ghostRoadMesh.visible = false;
        const gp = getGroundPoint();
        if (gp && e) {
          const tile: MapTile | null = getTileAt(gp.x, gp.z, st.mapTiles);
          if (tile) {
            const adjacent = isTileAdjacentToUnlocked(tile, st.mapTiles);
            const hint = tile.unlocked
              ? `${tile.name} · 已解鎖開放建設`
              : adjacent
                ? `點擊解鎖「${tile.name}」 · $${tile.unlockCost.toLocaleString()}${tile.minPopulation > 0 ? ` · 需人口 ${tile.minPopulation}` : ''}`
                : `${tile.name} · 需先解鎖相鄰分區`;
            onSnapHintRef.current?.({
              text: hint,
              screenX: e.clientX,
              screenY: e.clientY,
            });
          } else {
            onSnapHintRef.current?.(null);
          }
        }
        return;
      }

      const lmToolType = TOOL_TO_LANDMARK[t];
      if (lmToolType && phaseRef.current === 'playing' && playModeRef.current === 'mayor') {
        terraformRingMesh.visible = false;
        guideLineMesh.visible = false;
        secGuideLineMesh.visible = false;
        ghostRoadMesh.visible = false;
        const gp = getGroundPoint();
        if (gp) {
          const spec = LANDMARK_SPECS[lmToolType];
          const unlocked = isTileUnlockedAt(gp.x, gp.z, st.mapTiles);
          const onWater = isWaterAt(gp.x, gp.z, st.terrainEdits);
          const elev = terrainHeightAt(gp.x, gp.z, st.terrainEdits);
          const nearShore =
            !onWater
              ? isWaterAt(gp.x + 12, gp.z, st.terrainEdits) ||
                isWaterAt(gp.x - 12, gp.z, st.terrainEdits) ||
                isWaterAt(gp.x, gp.z + 12, st.terrainEdits) ||
                isWaterAt(gp.x, gp.z - 12, st.terrainEdits)
              : !isWaterAt(gp.x + 10, gp.z, st.terrainEdits) ||
                !isWaterAt(gp.x - 10, gp.z, st.terrainEdits) ||
                !isWaterAt(gp.x, gp.z + 10, st.terrainEdits) ||
                !isWaterAt(gp.x, gp.z - 10, st.terrainEdits);
          const surfaceOk = spec.allowWaterfront ? nearShore && elev <= 5.5 : !onWater && elev <= 5.5;
          const tooClose = st.landmarks.some((l) => dist2D(l, gp) < 8);
          const valid = unlocked && surfaceOk && !tooClose && st.stats.treasury >= spec.cost;

          snapRingMesh.scale.setScalar(3.4);
          snapRingMesh.position.set(gp.x, Math.max(-0.15, elev) + 0.36, gp.z);
          snapRingMesh.visible = true;
          (snapRingMesh.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0x10b981 : 0xef4444);

          if (e) {
            const reason = !unlocked
              ? '此分區尚未解鎖'
              : !surfaceOk
                ? spec.allowWaterfront
                  ? '碼頭需建於海陸交界岸線'
                  : '建築需建於平坦陸地'
                : tooClose
                  ? '距離現有建築過近'
                  : st.stats.treasury < spec.cost
                    ? `資金不足 (需 $${spec.cost.toLocaleString()})`
                    : `點擊興建「${spec.name}」 · $${spec.cost.toLocaleString()} · 地價+${spec.landValueBonus}`;
            onSnapHintRef.current?.({
              text: reason,
              screenX: e.clientX,
              screenY: e.clientY,
            });
          }
        }
        return;
      }

      const tfOp = TOOL_TO_TERRAFORM[t];
      if (tfOp && phaseRef.current === 'playing' && playModeRef.current === 'mayor') {
        snapRingMesh.visible = false;
        guideLineMesh.visible = false;
        secGuideLineMesh.visible = false;
        ghostRoadMesh.visible = false;
        const gp = getGroundPoint();
        if (gp) {
          const spec = TERRAFORM_SPECS[tfOp];
          const unlocked = isTileUnlockedAt(gp.x, gp.z, st.mapTiles);
          const onWater = isWaterAt(gp.x, gp.z, st.terrainEdits);
          const elev = terrainHeightAt(gp.x, gp.z, st.terrainEdits);
          const valid = unlocked && st.stats.treasury >= spec.cost;

          terraformRingMesh.scale.setScalar(spec.radius);
          terraformRingMesh.position.set(gp.x, Math.max(-0.2, elev) + 0.36, gp.z);
          terraformRingMesh.visible = true;
          (terraformRingMesh.material as THREE.MeshBasicMaterial).color.set(
            valid ? spec.colorHex : '#ef4444',
          );

          if (e) {
            const reason = !unlocked
              ? '此分區尚未解鎖'
              : st.stats.treasury < spec.cost
                ? `資金不足 (需 $${spec.cost.toLocaleString()})`
                : `點擊執行「${spec.name}」 · $${spec.cost.toLocaleString()} · 半徑 ${spec.radius}m · 海拔 ${elev.toFixed(1)}m${onWater ? ' (海域)' : ''}`;
            onSnapHintRef.current?.({
              text: reason,
              screenX: e.clientX,
              screenY: e.clientY,
            });
          }
        }
        return;
      }

      terraformRingMesh.visible = false;

      const isRoadTool = t === 'road_street' || t === 'road_avenue' || t === 'road_bus';
      if (!isRoadTool || phaseRef.current !== 'playing' || playModeRef.current !== 'mayor') {
        snapRingMesh.visible = false;
        snapRingMesh.scale.setScalar(1);
        guideLineMesh.visible = false;
        secGuideLineMesh.visible = false;
        ghostRoadMesh.visible = false;
        onSnapHintRef.current?.(null);
        return;
      }

      const gp = getGroundPoint();
      if (!gp) return;

      const snap = findRoadSnap(
        gp,
        roadStart?.pos || null,
        roadStart?.nodeId || null,
        st.nodes,
        st.segments,
        snapEnabledRef.current,
        st.mapTiles,
        st.terrainEdits,
      );
      currentSnap = snap;

      const ringY = (snap.isBridge ? 2.3 : terrainHeightAt(snap.pos.x, snap.pos.z, st.terrainEdits)) + 0.3;
      snapRingMesh.scale.setScalar(1);
      snapRingMesh.position.set(snap.pos.x, ringY, snap.pos.z);
      snapRingMesh.visible = true;
      (snapRingMesh.material as THREE.MeshBasicMaterial).color.setHex(
        !snap.valid
          ? 0xef4444
          : snap.kind === 'node' || snap.kind === 'segment'
            ? 0x10b981
            : snap.kind === 'angle' || snap.kind === 'parallel'
              ? 0x38bdf8
              : 0xfbbf24,
      );

      if (snap.guideLine) {
        const gPos = guideLineMesh.geometry.attributes.position as THREE.BufferAttribute;
        const gFromY = (isWaterAt(snap.guideLine.from.x, snap.guideLine.from.z, st.terrainEdits) ? 2.3 : terrainHeightAt(snap.guideLine.from.x, snap.guideLine.from.z, st.terrainEdits)) + 0.35;
        const gToY = (isWaterAt(snap.guideLine.to.x, snap.guideLine.to.z, st.terrainEdits) ? 2.3 : terrainHeightAt(snap.guideLine.to.x, snap.guideLine.to.z, st.terrainEdits)) + 0.35;
        gPos.setXYZ(0, snap.guideLine.from.x, gFromY, snap.guideLine.from.z);
        gPos.setXYZ(1, snap.guideLine.to.x, gToY, snap.guideLine.to.z);
        gPos.needsUpdate = true;
        guideLineMesh.computeLineDistances();
        guideLineMesh.visible = true;
      } else {
        guideLineMesh.visible = false;
      }

      if (snap.secondaryGuideLine) {
        const sPos = secGuideLineMesh.geometry.attributes.position as THREE.BufferAttribute;
        const sFromY = (isWaterAt(snap.secondaryGuideLine.from.x, snap.secondaryGuideLine.from.z, st.terrainEdits) ? 2.3 : terrainHeightAt(snap.secondaryGuideLine.from.x, snap.secondaryGuideLine.from.z, st.terrainEdits)) + 0.35;
        const sToY = (isWaterAt(snap.secondaryGuideLine.to.x, snap.secondaryGuideLine.to.z, st.terrainEdits) ? 2.3 : terrainHeightAt(snap.secondaryGuideLine.to.x, snap.secondaryGuideLine.to.z, st.terrainEdits)) + 0.35;
        sPos.setXYZ(0, snap.secondaryGuideLine.from.x, sFromY, snap.secondaryGuideLine.from.z);
        sPos.setXYZ(1, snap.secondaryGuideLine.to.x, sToY, snap.secondaryGuideLine.to.z);
        sPos.needsUpdate = true;
        secGuideLineMesh.computeLineDistances();
        secGuideLineMesh.visible = true;
      } else {
        secGuideLineMesh.visible = false;
      }

      if (roadStart) {
        const len = dist2D(roadStart.pos, snap.pos);
        if (len > 1) {
          const tier: RoadTier =
            t === 'road_street' ? 'street' : t === 'road_avenue' ? 'avenue' : 'bus_avenue';
          const roadW = tier === 'street' ? 3.8 : 5.4;
          const midX = (roadStart.pos.x + snap.pos.x) * 0.5;
          const midZ = (roadStart.pos.z + snap.pos.z) * 0.5;
          ghostRoadMesh.scale.set(roadW, 1, len);
          ghostRoadMesh.position.set(midX, ringY - 0.1, midZ);
          ghostRoadMesh.rotation.y = Math.atan2(
            snap.pos.x - roadStart.pos.x,
            snap.pos.z - roadStart.pos.z,
          );
          ghostRoadMat.color.setHex(snap.valid ? 0x22d3ee : 0xef4444);
          ghostRoadMesh.visible = true;

          const cost = Math.round(len * ROAD_COST_PER_M[tier] * (snap.isBridge ? 1.8 : 1));
          const snapTag =
            snap.kind === 'node'
              ? '路口對齊'
              : snap.kind === 'segment'
                ? 'T字連接'
                : snap.kind === 'angle'
                  ? '角度鎖定'
                  : snap.kind === 'parallel'
                    ? '平行對齊'
                    : '精準網格';

          if (e) {
            onSnapHintRef.current?.({
              text:
                !snap.valid && snap.reason
                  ? snap.reason
                  : `${Math.round(len)}m · ${Math.round(snap.angleDeg || 0)}° · ${snapTag}${snap.isBridge ? ' (跨海橋樑)' : ''} · $${cost.toLocaleString()}`,
              screenX: e.clientX,
              screenY: e.clientY,
            });
          }
        }
      } else {
        ghostRoadMesh.visible = false;
        if (e) {
          const snapTag =
            !snap.valid && snap.reason
              ? snap.reason
              : snap.kind === 'node'
                ? '點擊路口作為起點'
                : snap.kind === 'segment'
                  ? '點擊道路分割建立T字路口'
                  : '點擊地面設定道路起點';
          onSnapHintRef.current?.({
            text: snapTag,
            screenX: e.clientX,
            screenY: e.clientY,
          });
        }
      }
    }

    function paintZoneAtPointer() {
      const t = toolRef.current;
      if (!t.startsWith('zone_')) return;
      const zone = t.replace('zone_', '') as ZoneType;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(pickableParcels, false);
      if (hits.length > 0) {
        const parcel = hits[0].object.userData.parcel as ZoneParcel;
        if (parcel && !paintedInStroke.has(parcel.id)) {
          paintedInStroke.add(parcel.id);
          onActionRef.current({ type: 'paint_zone', parcelIds: [parcel.id], zone });
        }
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      if (e.button === 2) {
        // Right click cancels active road drawing
        roadStart = null;
        updateRoadPreview(e);
        return;
      }
      if (e.button !== 0) return;

      updatePointerNdc(e);

      // In Citizen (Sims) Mode: click NPC/Building/Parcel/Landmark to inspect & trade, or click walkable ground/bridge to walk!
      if (playModeRef.current === 'citizen') {
        raycaster.setFromCamera(pointerNdc, camera);
        const npcHits = raycaster.intersectObjects(pickableNpcs, false);
        if (npcHits.length > 0) {
          const nid = npcHits[0].object.userData.npcId as string;
          const npc = npcPool.find((n) => n.id === nid);
          if (npc) {
            selectedNpcId = npc.id;
            onSelectRef.current({
              kind: 'citizen',
              id: npc.id,
              title: `市民 ${npc.name} (${npc.state === 'interacting' ? '駐足互動' : '步行導航中'})`,
              subtitle:
                npc.state === 'interacting'
                  ? `正於「${npc.destLabel}」：${npc.interactionText}`
                  : `沿澳門道路前往「${npc.destLabel}」`,
            });
            return;
          }
        }
        selectedNpcId = null;

        const dHits = raycaster.intersectObjects(pickableDynamicElements, false);
        if (dHits.length > 0) {
          const el = dHits[0].object.userData.element as DynamicWorldElement;
          onSelectRef.current({
            kind: 'dynamic_element',
            id: el.id,
            title: `✨ ${el.title}`,
            subtitle: `${el.districtName} · 滿意+${el.happinessBonus} 文旅+${el.tourismBonus} · 剩 ${el.remainingTicks} 期`,
          });
          return;
        }

        const dHits = raycaster.intersectObjects(pickableDynamicElements, false);
        if (dHits.length > 0) {
          const el = dHits[0].object.userData.element as DynamicWorldElement;
          onSelectRef.current({
            kind: 'dynamic_element',
            id: el.id,
            title: `✨ ${el.title}`,
            subtitle: `${el.districtName} · 滿意+${el.happinessBonus} 文旅+${el.tourismBonus} · 剩 ${el.remainingTicks} 期`,
          });
          return;
        }

        const bHits = raycaster.intersectObjects(pickableBuildings, false);
        if (bHits.length > 0) {
          const b = bHits[0].object.userData.building;
          const m = stateRef.current.merchants.find((mc) => mc.id === b.ownerMerchantId);
          onSelectRef.current({
            kind: 'building',
            id: b.id,
            title: `${b.zone === 'residential' ? '住宅' : b.zone === 'commercial' ? '商業' : b.zone === 'tourism' ? '文旅' : '科創'}大廈 Lv.${b.level}`,
            subtitle: `開發商：${m?.name || '市政'} · 稅收 $${b.taxYield}/期`,
            buildingLevel: b.level,
          });
          return;
        }

        const pHits = raycaster.intersectObjects(pickableParcels, false);
        if (pHits.length > 0) {
          const p = pHits[0].object.userData.parcel as ZoneParcel;
          const m = stateRef.current.merchants.find((mc) => mc.id === p.ownerMerchantId);
          const ownerLabel =
            p.ownerPlayerId === localPlayerIdRef.current
              ? '您個人持有'
              : p.ownerPlayerId
                ? '其他線上玩家持有'
                : m
                  ? m.name
                  : '市政府待售地';
          onSelectRef.current({
            kind: 'parcel',
            id: p.id,
            title: `地塊 #${p.id.slice(-4)} (${p.zone === 'none' ? '未劃分' : p.zone})`,
            subtitle: `地價指數 ${p.landValue} · 業權：${ownerLabel}`,
            canBuy: !p.buildingId && p.ownerPlayerId !== localPlayerIdRef.current,
            canSell: p.ownerPlayerId === localPlayerIdRef.current,
            hasBuilding: Boolean(p.buildingId),
          });
          return;
        }

        onSelectRef.current(null);
        const gp = getGroundPoint();
        const st = stateRef.current;
        if (gp && isWalkablePosition(gp, st.nodes, st.segments, st.mapTiles, st.terrainEdits)) {
          onActionRef.current({ type: 'sim_move', x: gp.x, z: gp.z });
        }
        return;
      }

      const t = toolRef.current;
      if (t === 'unlock_tile') {
        const gp = getGroundPoint();
        if (gp) {
          const tile = getTileAt(gp.x, gp.z, stateRef.current.mapTiles);
          if (tile && !tile.unlocked) {
            onActionRef.current({ type: 'unlock_tile', tileId: tile.id });
          }
        }
        return;
      }

      if (t.startsWith('zone_')) {
        isDraggingZone = true;
        paintedInStroke.clear();
        controls.enabled = false;
        paintZoneAtPointer();
        return;
      }

      if (t === 'road_street' || t === 'road_avenue' || t === 'road_bus') {
        updateRoadPreview(e);
        if (!currentSnap) return;
        if (!roadStart) {
          if (!currentSnap.valid && currentSnap.reason) return;
          roadStart = {
            pos: { ...currentSnap.pos },
            nodeId: currentSnap.snappedNodeId,
            segmentId: currentSnap.snappedSegmentId,
          };
          updateRoadPreview(e);
        } else if (currentSnap.valid) {
          const tier: RoadTier =
            t === 'road_street' ? 'street' : t === 'road_avenue' ? 'avenue' : 'bus_avenue';
          onActionRef.current({
            type: 'build_road',
            startPos: roadStart.pos,
            endPos: currentSnap.pos,
            startNodeId: roadStart.nodeId || null,
            endNodeId: currentSnap.snappedNodeId || null,
            splitSegmentA: roadStart.segmentId || null,
            splitSegmentB: currentSnap.snappedSegmentId || null,
            tier,
          });
          // Chain seamlessly from end node unless snapped to an existing node/segment
          if (currentSnap.snappedNodeId || currentSnap.snappedSegmentId) {
            roadStart = null;
          } else {
            roadStart = { pos: { ...currentSnap.pos } };
          }
          updateRoadPreview(e);
        }
        return;
      }

      if (t === 'upgrade_roundabout') {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(pickableNodes, false);
        if (hits.length > 0) {
          const nid = hits[0].object.userData.nodeId as string;
          onActionRef.current({ type: 'upgrade_roundabout', nodeId: nid });
        }
        return;
      }

      if (t === 'upgrade_bus') {
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(pickableSegments, false);
        if (hits.length > 0) {
          const sid = hits[0].object.userData.segmentId as string;
          onActionRef.current({ type: 'upgrade_bus', segmentId: sid });
        }
        return;
      }

      const lmClickType = TOOL_TO_LANDMARK[t];
      if (lmClickType) {
        const gp = getGroundPoint();
        if (gp) {
          onActionRef.current({ type: 'place_landmark', landmarkType: lmClickType, x: gp.x, z: gp.z });
        }
        return;
      }

      const tfClickOp = TOOL_TO_TERRAFORM[t];
      if (tfClickOp) {
        const gp = getGroundPoint();
        if (gp) {
          onActionRef.current({ type: 'terraform', kind: tfClickOp, x: gp.x, z: gp.z });
        }
        return;
      }

      if (t === 'bulldoze') {
        raycaster.setFromCamera(pointerNdc, camera);
        const bHits = raycaster.intersectObjects(pickableBuildings, false);
        if (bHits.length > 0) {
          onActionRef.current({
            type: 'bulldoze',
            kind: 'building',
            id: bHits[0].object.userData.building.id,
          });
          return;
        }
        const lHits = raycaster.intersectObjects(pickableLandmarks, false);
        if (lHits.length > 0) {
          onActionRef.current({
            type: 'bulldoze',
            kind: 'landmark',
            id: lHits[0].object.userData.landmark.id,
          });
          return;
        }
        const sHits = raycaster.intersectObjects(pickableSegments, false);
        if (sHits.length > 0) {
          onActionRef.current({
            type: 'bulldoze',
            kind: 'segment',
            id: sHits[0].object.userData.segmentId,
          });
        }
        return;
      }

      // Default select / inspect mode
      if (t === 'select') {
        raycaster.setFromCamera(pointerNdc, camera);
        const npcHits = raycaster.intersectObjects(pickableNpcs, false);
        if (npcHits.length > 0) {
          const nid = npcHits[0].object.userData.npcId as string;
          const npc = npcPool.find((n) => n.id === nid);
          if (npc) {
            selectedNpcId = npc.id;
            onSelectRef.current({
              kind: 'citizen',
              id: npc.id,
              title: `市民 ${npc.name} (${npc.state === 'interacting' ? '駐足互動' : '步行導航中'})`,
              subtitle:
                npc.state === 'interacting'
                  ? `正於「${npc.destLabel}」：${npc.interactionText}`
                  : `沿澳門道路前往「${npc.destLabel}」`,
            });
            return;
          }
        }
        selectedNpcId = null;

        const bHits = raycaster.intersectObjects(pickableBuildings, false);
        if (bHits.length > 0) {
          const b = bHits[0].object.userData.building;
          const m = stateRef.current.merchants.find((mc) => mc.id === b.ownerMerchantId);
          onSelectRef.current({
            kind: 'building',
            id: b.id,
            title: `${b.zone === 'residential' ? '住宅' : b.zone === 'commercial' ? '商業' : b.zone === 'tourism' ? '文旅' : '科創'}大廈 Lv.${b.level}`,
            subtitle: `開發商：${m?.name || '市政'} · 稅收 $${b.taxYield}/期`,
            buildingLevel: b.level,
          });
          return;
        }
        const pHits = raycaster.intersectObjects(pickableParcels, false);
        if (pHits.length > 0) {
          const p = pHits[0].object.userData.parcel as ZoneParcel;
          const m = stateRef.current.merchants.find((mc) => mc.id === p.ownerMerchantId);
          const ownerLabel =
            p.ownerPlayerId === localPlayerIdRef.current
              ? '您個人持有'
              : p.ownerPlayerId
                ? '其他線上玩家持有'
                : m
                  ? m.name
                  : '市政府待售地';
          onSelectRef.current({
            kind: 'parcel',
            id: p.id,
            title: `地塊 #${p.id.slice(-4)} (${p.zone === 'none' ? '未劃分' : p.zone})`,
            subtitle: `地價指數 ${p.landValue} · 業權：${ownerLabel}`,
            canBuy: !p.buildingId && p.ownerPlayerId !== localPlayerIdRef.current,
            canSell: p.ownerPlayerId === localPlayerIdRef.current,
            hasBuilding: Boolean(p.buildingId),
          });
          return;
        }
        const sHits = raycaster.intersectObjects(pickableSegments, false);
        if (sHits.length > 0) {
          const seg = sHits[0].object.userData.segment as RoadSegment;
          onSelectRef.current({
            kind: 'road',
            id: seg.id,
            title:
              seg.tier === 'bus_avenue'
                ? '巴士專線大道'
                : seg.tier === 'avenue'
                  ? '四線主幹道'
                  : '二線街巷',
            subtitle: `車流負荷 ${Math.round(seg.trafficLoad * 100)}% · 長度 ${Math.round(seg.length)}m`,
          });
          return;
        }
        onSelectRef.current(null);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      const now = performance.now();
      if (now - lastHoverTime < 35) return;
      lastHoverTime = now;

      updatePointerNdc(e);

      if (isDraggingZone) {
        paintZoneAtPointer();
        return;
      }

      if (playModeRef.current === 'mayor') {
        updateRoadPreview(e);
        if (now - lastCursorEmit > 160) {
          lastCursorEmit = now;
          const gp = getGroundPoint();
          if (gp) onActionRef.current({ type: 'cursor', pos: gp });
        }
      }
    };

    const onPointerUp = () => {
      if (isDraggingZone) {
        isDraggingZone = false;
        paintedInStroke.clear();
        controls.enabled = true;
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      roadStart = null;
      updateRoadPreview();
    };

    // Keyboard movement (WASD / Arrow keys) for Mayor pan & Sim walk
    const keysDown = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      keysDown.add(e.code);
      if (e.code === 'Escape' && roadStart) {
        roadStart = null;
        updateRoadPreview();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.delete(e.code);
    };
    const onWindowBlur = () => {
      keysDown.clear();
      isDraggingZone = false;
      controls.enabled = true;
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.render(scene, camera);
    };
    const resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(container);

    // Pre-warm shaders on GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // =========================================
    // MAIN 60FPS / PACED ANIMATION LOOP
    // =========================================
    let frameId = 0;
    let prevTime = performance.now();
    let elapsed = 0;
    let simMoveEmitTimer = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function syncSimAvatars(dt: number) {
      const st = stateRef.current;
      // Only Citizen players have 3D Sim avatars walking Macau streets; Mayors guide from above with cursor rings
      const activeCitizenIds = new Set(
        Object.values(st.players)
          .filter((p) => p.role === 'citizen')
          .map((p) => p.id),
      );
      const activeIds = new Set(Object.keys(st.players));
      const labelContainer = labelsContainerRef.current;

      // Remove disconnected players or players who switched to Mayor
      for (const [pid, entry] of simMeshes.entries()) {
        if (!activeCitizenIds.has(pid)) {
          simsGroup.remove(entry.group);
          simMeshes.delete(pid);
          const el = simLabelEls.get(pid);
          if (el) {
            el.remove();
            simLabelEls.delete(pid);
          }
        }
      }
      for (const [pid, mesh] of remoteCursorMeshes.entries()) {
        if (!activeIds.has(pid)) {
          remoteCursorsGroup.remove(mesh);
          remoteCursorMeshes.delete(pid);
        }
      }

      const w = container!.clientWidth || window.innerWidth;
      const h = container!.clientHeight || window.innerHeight;
      const dampAlpha = 1 - Math.exp(-10 * dt);

      for (const player of Object.values(st.players)) {
        const isLocal = player.id === localPlayerIdRef.current;

        // Remote multiplayer cursor ring (visible for remote Mayors planning!)
        if (!isLocal) {
          let cMesh = remoteCursorMeshes.get(player.id);
          if (!cMesh) {
            cMesh = new THREE.Mesh(
              new THREE.RingGeometry(1.0, 1.35, 20),
              new THREE.MeshBasicMaterial({ color: player.color, side: THREE.DoubleSide }),
            );
            cMesh.rotation.x = -Math.PI / 2;
            remoteCursorsGroup.add(cMesh);
            remoteCursorMeshes.set(player.id, cMesh);
          }
          if (player.cursorPos && player.role === 'mayor') {
            cMesh.visible = true;
            cMesh.position.set(
              player.cursorPos.x,
              terrainHeightAt(player.cursorPos.x, player.cursorPos.z, st.terrainEdits) + 0.25,
              player.cursorPos.z,
            );
          } else {
            cMesh.visible = false;
          }
        }

        if (player.role !== 'citizen') continue;

        let entry = simMeshes.get(player.id);
        if (!entry || entry.color !== player.color) {
          if (entry) simsGroup.remove(entry.group);
          const grp = createSimAvatarGroup(player.color, isLocal);
          simsGroup.add(grp);
          entry = {
            group: grp,
            currX: player.x,
            currZ: player.z,
            currHeading: player.heading,
            walkPhase: 0,
            color: player.color,
          };
          simMeshes.set(player.id, entry);
        }

        const prevX = entry.currX;
        const prevZ = entry.currZ;
        entry.currX += (player.x - entry.currX) * dampAlpha;
        entry.currZ += (player.z - entry.currZ) * dampAlpha;
        const speedDist = Math.hypot(entry.currX - prevX, entry.currZ - prevZ);
        const isWalking = speedDist > 0.025 || Math.hypot(player.targetX - entry.currX, player.targetZ - entry.currZ) > 0.45;
        if (isWalking) {
          entry.walkPhase += Math.max(speedDist * 3.2, dt * 8.5);
        }

        const onWaterOrBridge = isWaterAt(entry.currX, entry.currZ, st.terrainEdits);
        const y = onWaterOrBridge ? 2.34 : terrainHeightAt(entry.currX, entry.currZ, st.terrainEdits) + 0.1;

        entry.group.position.set(entry.currX, y, entry.currZ);
        entry.group.rotation.y = player.heading;

        const isInteracting =
          !isWalking &&
          (player.activity === 'working' ||
            player.activity === 'dining' ||
            player.activity === 'resting' ||
            player.activity === 'entertaining' ||
            player.activity === 'socializing');

        animateCitizenRig(
          entry.group,
          entry.walkPhase,
          isWalking,
          isInteracting,
          player.activity,
          elapsed,
        );

        // Spin Plumbob gently
        const plumbob = entry.group.getObjectByName('plumbob');
        if (plumbob) {
          plumbob.rotation.y = elapsed * 2.2;
          plumbob.position.y = 2.45 + Math.sin(elapsed * 3.1) * 0.08;
        }

        // Screen-projected floating Sim name + bubble (only in playing state)
        if (labelContainer) {
          let labelEl = simLabelEls.get(player.id);
          if (!labelEl) {
            labelEl = document.createElement('div');
            labelEl.className =
              'absolute -translate-x-1/2 -translate-y-full pointer-events-none px-2 py-0.5 rounded bg-slate-950/85 border border-white/15 text-[11px] leading-tight text-white whitespace-nowrap shadow-md';
            labelContainer.appendChild(labelEl);
            simLabelEls.set(player.id, labelEl);
          }

          if (phaseRef.current === 'playing') {
            _vec3.set(entry.currX, y + 3.05, entry.currZ);
            _vec3.project(camera);
            if (_vec3.z >= -1 && _vec3.z <= 1) {
              const sx = ((_vec3.x + 1) / 2) * w;
              const sy = ((-_vec3.y + 1) / 2) * h;
              labelEl.style.display = 'block';
              labelEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
              const bubble = player.emoteText || player.activityBubble;
              labelEl.innerHTML = `<span style="color:${player.color};font-weight:600">🧑 ${player.name}</span> <span class="text-slate-300">· ${bubble}</span>`;
            } else {
              labelEl.style.display = 'none';
            }
          } else {
            labelEl.style.display = 'none';
          }
        }
      }
    }

    function updateNpcNavigation(dt: number) {
      const st = stateRef.current;
      stepNpcCitizens(npcPool, st, dt, Math.random, npcEntrancesCache);

      const w = container!.clientWidth || window.innerWidth;
      const h = container!.clientHeight || window.innerHeight;
      const camDist = camera.position.distanceTo(controls.target);
      const showNav = showCitizenNavRef.current;
      const labelContainer = labelsContainerRef.current;
      let shownBubbles = 0;
      const maxBubbles = showNav ? 8 : 4;

      for (const npc of npcPool) {
        const grp = npcMeshes.get(npc.id);
        if (!grp) continue;

        grp.position.set(npc.x, npc.y, npc.z);
        grp.rotation.y = npc.heading;

        animateCitizenRig(
          grp,
          npc.walkPhase,
          npc.state === 'walking',
          npc.state === 'interacting',
          npc.destZone,
          elapsed,
        );

        // Projected floating interaction badge for active interacting or selected NPCs
        if (labelContainer) {
          let labelEl = npcLabelEls.get(npc.id);
          const isSelected = selectedNpcId === npc.id;
          const shouldShow =
            phaseRef.current === 'playing' &&
            (isSelected || (npc.state === 'interacting' && camDist < 120 && shownBubbles < maxBubbles));

          if (shouldShow) {
            if (!labelEl) {
              labelEl = document.createElement('div');
              labelEl.className =
                'absolute -translate-x-1/2 -translate-y-full pointer-events-none px-2 py-0.5 rounded bg-slate-950/90 border border-sky-400/30 text-[10px] leading-tight text-slate-100 whitespace-nowrap shadow';
              labelContainer.appendChild(labelEl);
              npcLabelEls.set(npc.id, labelEl);
            }
            _vec3.set(npc.x, npc.y + 2.18, npc.z);
            _vec3.project(camera);
            if (_vec3.z >= -1 && _vec3.z <= 1) {
              const sx = ((_vec3.x + 1) / 2) * w;
              const sy = ((-_vec3.y + 1) / 2) * h;
              labelEl.style.display = 'block';
              labelEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
              labelEl.innerHTML = `<span style="color:${npc.shirtColor};font-weight:600">${npc.name}</span> <span class="text-slate-300">${npc.state === 'interacting' ? npc.interactionText : `→ ${npc.destLabel}`}</span>`;
              shownBubbles++;
            } else {
              labelEl.style.display = 'none';
            }
          } else if (labelEl) {
            labelEl.style.display = 'none';
          }
        }
      }

      // Render 3D Citizen Road Navigation Route Lines when showCitizenNav is active or an NPC is selected
      let lineIdx = 0;
      const writeRouteLine = (points: Array<{ x: number; y?: number; z: number }>, lineObj: THREE.Line) => {
        if (points.length < 2) {
          lineObj.visible = false;
          return;
        }
        const posAttr = lineObj.geometry.getAttribute('position') as THREE.BufferAttribute;
        const count = Math.min(MAX_LINE_VERTS, points.length);
        for (let k = 0; k < count; k++) {
          const pt = points[k];
          const py =
            pt.y !== undefined
              ? pt.y + 0.14
              : isWaterAt(pt.x, pt.z, st.terrainEdits)
                ? 2.46
                : terrainHeightAt(pt.x, pt.z, st.terrainEdits) + 0.28;
          posAttr.setXYZ(k, pt.x, py, pt.z);
        }
        posAttr.needsUpdate = true;
        lineObj.geometry.setDrawRange(0, count);
        lineObj.visible = true;
      };

      if (phaseRef.current === 'playing') {
        if (selectedNpcId) {
          const selNpc = npcPool.find((n) => n.id === selectedNpcId);
          if (selNpc && selNpc.state === 'walking' && selNpc.waypointIndex < selNpc.waypoints.length) {
            const pts = [{ x: selNpc.x, y: selNpc.y, z: selNpc.z }, ...selNpc.waypoints.slice(selNpc.waypointIndex)];
            writeRouteLine(pts, navRouteLinePool[lineIdx++]);
          }
        }

        if (showNav) {
          for (const pl of Object.values(st.players)) {
            if (lineIdx >= MAX_NAV_LINES) break;
            if (pl.role === 'citizen' && pl.waypoints && pl.waypoints.length > 0) {
              const pts = [{ x: pl.x, z: pl.z }, ...pl.waypoints];
              writeRouteLine(pts, navRouteLinePool[lineIdx++]);
            }
          }
          for (const npc of npcPool) {
            if (lineIdx >= MAX_NAV_LINES) break;
            if (npc.id === selectedNpcId) continue;
            if (npc.state === 'walking' && npc.waypointIndex < npc.waypoints.length) {
              const pts = [{ x: npc.x, y: npc.y, z: npc.z }, ...npc.waypoints.slice(npc.waypointIndex)];
              writeRouteLine(pts, navRouteLinePool[lineIdx++]);
            }
          }
        }
      }

      for (let i = lineIdx; i < MAX_NAV_LINES; i++) {
        navRouteLinePool[i].visible = false;
      }
    }

    function updateVehicles(dt: number) {
      const st = stateRef.current;
      const segs = st.segments;
      if (segs.length === 0) {
        vehiclesInst.count = 0;
        return;
      }
      const nodeMap = new Map(st.nodes.map((n) => [n.id, n]));
      const activeVehicles = Math.min(MAX_VEHICLES, Math.max(12, st.buildings.length * 4 + segs.length * 2));
      vehiclesInst.count = activeVehicles;

      const simFactor = st.simSpeed === 0 ? 0 : st.simSpeed === 1 ? 1 : st.simSpeed === 2 ? 1.8 : 2.6;

      for (let i = 0; i < activeVehicles; i++) {
        const v = vehiclePool[i];
        const seg = segs[v.segIndex % segs.length];
        const a = nodeMap.get(seg.nodeA);
        const b = nodeMap.get(seg.nodeB);
        if (!a || !b) continue;

        const congestionSlowdown = Math.max(0.28, 1.15 - seg.trafficLoad * 0.55);
        v.t += v.dir * v.speed * simFactor * congestionSlowdown * dt;
        if (v.t > 1) {
          v.t = 0;
          v.segIndex = (v.segIndex + 1) % segs.length;
        } else if (v.t < 0) {
          v.t = 1;
          v.segIndex = (v.segIndex + 1) % segs.length;
        }

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const px = a.x + dx * v.t + nx * v.laneOffset * v.dir;
        const pz = a.z + dz * v.t + nz * v.laneOffset * v.dir;
        const yA = seg.isBridge ? 2.2 : terrainHeightAt(a.x, a.z, st.terrainEdits);
        const yB = seg.isBridge ? 2.2 : terrainHeightAt(b.x, b.z, st.terrainEdits);
        const py = seg.isBridge ? 2.34 : yA + (yB - yA) * v.t + 0.24;

        _vec3.set(px, py, pz);
        const yaw = Math.atan2(dx * v.dir, dz * v.dir);
        _quat.setFromAxisAngle(_up, yaw);
        _scale.set(v.isBus ? 1.2 : 0.9, v.isBus ? 1.35 : 0.85, v.isBus ? 1.65 : 0.95);
        _mat4.compose(_vec3, _quat, _scale);
        vehiclesInst.setMatrixAt(i, _mat4);
        vehiclesInst.setColorAt(
          i,
          v.isBus
            ? new THREE.Color(0x10b981)
            : i % 3 === 0
              ? new THREE.Color(0xfbbf24)
              : i % 3 === 1
                ? new THREE.Color(0xf8fafc)
                : new THREE.Color(0xef4444),
        );
      }
      vehiclesInst.instanceMatrix.needsUpdate = true;
      if (vehiclesInst.instanceColor) vehiclesInst.instanceColor.needsUpdate = true;
    }

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const rawDt = (now - prevTime) / 1000;
      prevTime = now;
      const dt = Math.min(rawDt, 0.05);
      elapsed += dt;

      if (builtVersion !== rebuildVersionRef.current) {
        builtVersion = rebuildVersionRef.current;
        rebuildCityGeometry();
      }

      // Gentle animated harbor water shimmer
      textures.waterBump.offset.x = (elapsed * 0.015) % 1;
      textures.waterBump.offset.y = (elapsed * 0.01) % 1;

      updateVehicles(dt);
      syncSimAvatars(dt);
      updateNpcNavigation(dt);

      // Animate AI-Generated Dynamic 3D World Elements
      if (dynamicElementEntries.length > 0) {
        const st = stateRef.current;
        const nodeMap = new Map(st.nodes.map((n) => [n.id, n]));
        for (const entry of dynamicElementEntries) {
          const { el, group, phaseOffset } = entry;
          const tPhase = elapsed + phaseOffset;
          const spinner = group.getObjectByName('spinner');
          if (el.kind === 'parade_float') {
            const seg = el.segmentId ? st.segments.find((s) => s.id === el.segmentId) : null;
            const a = seg ? nodeMap.get(seg.nodeA) : null;
            const b = seg ? nodeMap.get(seg.nodeB) : null;
            if (seg && a && b) {
              const pingPong = 0.5 + 0.5 * Math.sin(tPhase * 0.55);
              const px = a.x + (b.x - a.x) * pingPong;
              const pz = a.z + (b.z - a.z) * pingPong;
              const py = seg.isBridge ? 2.38 : terrainHeightAt(px, pz, st.terrainEdits) + 0.22;
              group.position.set(px, py, pz);
              const dirSign = Math.cos(tPhase * 0.55) >= 0 ? 1 : -1;
              group.rotation.y = Math.atan2((b.x - a.x) * dirSign, (b.z - a.z) * dirSign);
            }
            if (spinner) spinner.rotation.y = tPhase * 2.2;
          } else if (el.kind === 'drone_show') {
            if (spinner) {
              spinner.rotation.y = tPhase * 0.9;
              spinner.position.y = 13.5 + Math.sin(tPhase * 1.8) * 1.2;
            }
          } else if (el.kind === 'harbor_flotilla') {
            const orbitX = el.x + Math.cos(tPhase * 0.45) * 6.5;
            const orbitZ = el.z + Math.sin(tPhase * 0.45) * 4.2;
            group.position.set(orbitX, -0.1 + Math.sin(tPhase * 2.4) * 0.08, orbitZ);
            group.rotation.y = -tPhase * 0.45;
          } else if (spinner) {
            spinner.rotation.y = tPhase * 0.8;
            spinner.position.y = 3.6 + Math.sin(tPhase * 2.0) * 0.35;
          }
        }
      }

      // Animate moving parts inside placed landmarks (Ferris wheels, wind turbines, ferry hydrofoils)
      for (const w of animatedFerrisWheels) {
        w.rotation.z = elapsed * 0.35;
      }
      for (const r of animatedTurbineRotors) {
        r.rotation.z = -elapsed * 2.4;
      }
      for (let i = 0; i < animatedFerryBoats.length; i++) {
        const boat = animatedFerryBoats[i];
        boat.position.y = 0.45 + Math.sin(elapsed * 2.2 + i) * 0.14;
        boat.rotation.z = Math.sin(elapsed * 1.7 + i) * 0.04;
      }

      // Camera Choreography
      if (phaseRef.current === 'title') {
        // Live World Camera Tour Flyover
        const tourAngle = elapsed * 0.14;
        const camX = Math.cos(tourAngle) * 76;
        const camZ = Math.sin(tourAngle) * 68 - 18;
        camera.position.set(camX, 38 + Math.sin(elapsed * 0.35) * 4, camZ);
        camera.lookAt(0, 2, -22);
      } else if (phaseRef.current === 'playing') {
        if (playModeRef.current === 'citizen') {
          const localPlayer = stateRef.current.players[localPlayerIdRef.current];
          if (localPlayer && localPlayer.role === 'citizen') {
            // Direct WASD / Arrow Sim walking across unlocked Macau districts
            let moveX = 0;
            let moveZ = 0;
            if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) moveZ -= 1;
            if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) moveZ += 1;
            if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) moveX -= 1;
            if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) moveX += 1;
            simMoveEmitTimer += dt;
            if ((moveX !== 0 || moveZ !== 0) && simMoveEmitTimer > 0.14) {
              simMoveEmitTimer = 0;
              const st = stateRef.current;
              const norm = Math.hypot(moveX, moveZ) || 1;
              const simBound = MAP_HALF_SIZE - 8;
              const stepDist = 7;
              const tryFull = {
                x: Math.max(-simBound, Math.min(simBound, localPlayer.x + (moveX / norm) * stepDist)),
                z: Math.max(-simBound, Math.min(simBound, localPlayer.z + (moveZ / norm) * stepDist)),
              };
              const tryX = {
                x: Math.max(-simBound, Math.min(simBound, localPlayer.x + (moveX / norm) * stepDist)),
                z: localPlayer.z,
              };
              const tryZ = {
                x: localPlayer.x,
                z: Math.max(-simBound, Math.min(simBound, localPlayer.z + (moveZ / norm) * stepDist)),
              };
              const dest = isWalkablePosition(tryFull, st.nodes, st.segments, st.mapTiles, st.terrainEdits)
                ? tryFull
                : moveX !== 0 && isWalkablePosition(tryX, st.nodes, st.segments, st.mapTiles, st.terrainEdits)
                  ? tryX
                  : moveZ !== 0 && isWalkablePosition(tryZ, st.nodes, st.segments, st.mapTiles, st.terrainEdits)
                    ? tryZ
                    : null;
              if (dest) {
                onActionRef.current({ type: 'sim_move', x: dest.x, z: dest.z });
              }
            }

            // Smoothly damp camera target to Sim avatar
            const damp = 1 - Math.exp(-6 * dt);
            _vec3.set(
              localPlayer.x,
              terrainHeightAt(localPlayer.x, localPlayer.z, stateRef.current.terrainEdits) + 1.5,
              localPlayer.z,
            );
            controls.target.lerp(_vec3, damp);
            // Pull camera closer in Sim mode if very zoomed out
            if (camera.position.distanceTo(controls.target) > 42) {
              _vec3b.copy(camera.position).sub(controls.target).setLength(32).add(controls.target);
              camera.position.lerp(_vec3b, damp);
            }
          }
        } else {
          // Mayor Mode keyboard WASD pan
          const panSpeed = 48 * dt;
          let px = 0;
          let pz = 0;
          if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) pz -= 1;
          if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) pz += 1;
          if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) px -= 1;
          if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) px += 1;
          if (px !== 0 || pz !== 0) {
            camera.getWorldDirection(_vec3);
            _vec3.y = 0;
            _vec3.normalize();
            _vec3b.crossVectors(_vec3, _up).normalize();
            const deltaX = (_vec3b.x * px - _vec3.x * pz) * panSpeed;
            const deltaZ = (_vec3b.z * px - _vec3.z * pz) * panSpeed;
            camera.position.x += deltaX;
            camera.position.z += deltaZ;
            controls.target.x += deltaX;
            controls.target.z += deltaZ;
          }
        }
        controls.update();
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    // Build initial scene before first render
    builtVersion = rebuildVersionRef.current;
    rebuildCityGeometry();
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObs.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      controls.dispose();
      navRouteLinePool.forEach((l) => l.geometry.dispose());
      navLineMat.dispose();
      highlightNavLineMat.dispose();
      textures.dispose();
      terrainGeo.dispose();
      terrainMat.dispose();
      seabedGeo.dispose();
      seabedMat.dispose();
      waterGeo.dispose();
      waterMat.dispose();
      treeTrunkGeo.dispose();
      treeCrownGeo.dispose();
      trunkMat.dispose();
      crownMat.dispose();
      geoLandmarksGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          (obj as THREE.Mesh).geometry.dispose();
        }
      });
      geoWhiteMat.dispose();
      geoGoldMat.dispose();
      geoAsphaltMat.dispose();
      geoRoofMat.dispose();
      geoTerracottaMat.dispose();
      geoCrimsonMat.dispose();
      geoMintMat.dispose();
      geoStoneMat.dispose();
      geoConcreteMat.dispose();
      geoGlassMat.dispose();
      disposeGroupChildren(tilesGroup);
      disposeGroupChildren(roadsGroup);
      disposeGroupChildren(parcelsGroup);
      disposeGroupChildren(buildingsGroup);
      disposeGroupChildren(landmarksGroup);
      previewGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh || (obj as THREE.Line).isLine) {
          const m = obj as THREE.Mesh | THREE.Line;
          m.geometry.dispose();
          if (!Array.isArray(m.material)) m.material.dispose();
        }
      });
      remoteCursorsGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry.dispose();
          if (!Array.isArray(m.material)) m.material.dispose();
        }
      });
      carGeo.dispose();
      carMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div
        ref={mountRef}
        data-testid="city-canvas-mount"
        className="w-full h-full cursor-crosshair"
      />
      <div
        ref={labelsContainerRef}
        className="fixed inset-0 pointer-events-none z-10 overflow-hidden"
      />
    </div>
  );
};
