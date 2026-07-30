import * as THREE from 'three';
import { degToRad, type LatLon } from '../geo';
import { tileBlockAround, tileCount } from '../terrain/blocks';
import { serializeGeoHeightField, type GeoHeightFieldData } from '../terrain/heightField';
import { loadBlockHeightField } from '../terrain/loader';
import { PanoramaControls, type ViewState } from './controls';
import type { PolarMeshOptions } from './mesh';
import type { TerrainMeshRequest, TerrainMeshResponse } from './protocol';

/**
 * Moteur de rendu du panorama : orchestre WebGL autour du maillage produit
 * par le worker terrain (le fil principal ne fait ni échantillonnage ni
 * triangulation). Rendu à la demande : une frame n'est dessinée que si la
 * vue ou la scène a changé.
 */

/** Champ proche : haute résolution (z12 ≈ 26 m/pixel dans les Alpes). */
const INNER = { zoom: 12, radiusM: 24_000 };
/** Champ lointain : jusqu'à l'horizon du panorama (z10 ≈ 106 m/pixel). */
const OUTER = { zoom: 10, radiusM: 115_000 };
/** Hauteur de l'œil au-dessus du sol (m) — dégage le premier plan. */
const EYE_HEIGHT_M = 10;
/** Le maillage s'arrête un peu avant le bord du champ lointain. */
const MESH_MAX_RADIUS_M = OUTER.radiusM - 5_000;

const HORIZON_COLOR = new THREE.Color('#cfe2f3');
const ZENITH_COLOR = new THREE.Color('#5f9bd6');

export type ProgressCallback = (done: number, total: number) => void;

/** Ce que le chargement laisse derrière lui, prêt pour le worker de visibilité. */
export interface PanoramaContext {
  viewpoint: LatLon;
  /** Altitude de l'œil (sol + hauteur d'observation) (m). */
  eyeElevation: number;
  innerRadiusM: number;
  inner: GeoHeightFieldData;
  outer: GeoHeightFieldData;
}

export class PanoramaEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: PanoramaControls;
  private readonly observer: ResizeObserver;
  private readonly meshWorker: Worker;
  private readonly meshOptions: PolarMeshOptions;
  private pendingMesh = new Map<number, (response: TerrainMeshResponse) => void>();
  private nextRequestId = 1;
  private terrain: THREE.Mesh | null = null;
  private rafId = 0;

  readonly view: ViewState = { heading: 0, pitch: 5, fov: 55 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onViewChange?: (view: ViewState) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = HORIZON_COLOR;
    this.scene.fog = new THREE.Fog(HORIZON_COLOR, 25_000, 150_000);
    this.scene.add(buildSkyDome());

    const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    sun.position.set(-0.5, 0.8, 0.4).multiplyScalar(100_000);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight('#bcd6f2', '#3d4636', 0.9));

    this.camera = new THREE.PerspectiveCamera(this.view.fov, 1, 15, 400_000);
    this.camera.rotation.order = 'YXZ';

    // Écrans tactiles : grille allégée (~45 % de triangles en moins).
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.meshOptions = {
      azimuthSegments: coarse ? 540 : 720,
      radialSegments: coarse ? 130 : 160,
      maxRadiusM: MESH_MAX_RADIUS_M,
    };

    this.meshWorker = new Worker(new URL('../../workers/terrain.ts', import.meta.url), {
      type: 'module',
    });
    this.meshWorker.onmessage = (event: MessageEvent<TerrainMeshResponse>) => {
      const resolve = this.pendingMesh.get(event.data.requestId);
      this.pendingMesh.delete(event.data.requestId);
      resolve?.(event.data);
    };

    this.controls = new PanoramaControls(canvas, this.view, () => this.applyView());

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.applyView();
  }

  /** Charge le relief autour du point de vue et (re)construit le terrain. */
  async load(viewpoint: LatLon, onProgress?: ProgressCallback): Promise<PanoramaContext> {
    const innerBlock = tileBlockAround(viewpoint, INNER.radiusM, INNER.zoom);
    const outerBlock = tileBlockAround(viewpoint, OUTER.radiusM, OUTER.zoom);
    const total = tileCount(innerBlock) + tileCount(outerBlock);
    let done = 0;
    const tick = () => onProgress?.(++done, total);

    const [inner, outer] = await Promise.all([
      loadBlockHeightField(innerBlock, { onProgress: tick }),
      loadBlockHeightField(outerBlock, { onProgress: tick }),
    ]);

    const response = await this.requestMesh({
      requestId: this.nextRequestId++,
      viewpoint,
      innerRadiusM: INNER.radiusM,
      inner: serializeGeoHeightField(inner),
      outer: serializeGeoHeightField(outer),
      options: this.meshOptions,
    });

    this.installTerrain(response);
    const eyeElevation = response.groundElevation + EYE_HEIGHT_M;
    this.camera.position.set(0, eyeElevation, 0);
    this.applyView();

    return {
      viewpoint,
      eyeElevation,
      innerRadiusM: INNER.radiusM,
      inner: response.inner,
      outer: response.outer,
    };
  }

  private requestMesh(request: TerrainMeshRequest): Promise<TerrainMeshResponse> {
    return new Promise((resolve) => {
      this.pendingMesh.set(request.requestId, resolve);
      this.meshWorker.postMessage(request, [request.inner.data.buffer, request.outer.data.buffer]);
    });
  }

  private installTerrain(response: TerrainMeshResponse): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(response.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(response.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(response.indices, 1));
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    this.disposeTerrain();
    this.terrain = new THREE.Mesh(geometry, material);
    this.scene.add(this.terrain);
    this.scheduleRender();
  }

  private applyView(): void {
    this.camera.fov = this.view.fov;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.y = -degToRad(this.view.heading);
    this.camera.rotation.x = degToRad(this.view.pitch);
    this.onViewChange?.(this.view);
    this.scheduleRender();
  }

  /** Rendu à la demande : au plus une frame par rafraîchissement écran. */
  private scheduleRender(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? this.canvas.clientWidth ?? 1;
    const height = parent?.clientHeight ?? this.canvas.clientHeight ?? 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.scheduleRender();
  }

  private disposeTerrain(): void {
    if (!this.terrain) return;
    this.scene.remove(this.terrain);
    this.terrain.geometry.dispose();
    (this.terrain.material as THREE.Material).dispose();
    this.terrain = null;
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.observer.disconnect();
    this.controls.dispose();
    this.meshWorker.terminate();
    this.disposeTerrain();
    this.renderer.dispose();
  }
}

/** Dôme céleste en dégradé horizon → zénith (remplace le fond uni). */
function buildSkyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(320_000, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenithColor: { value: ZENITH_COLOR },
      horizonColor: { value: HORIZON_COLOR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenithColor;
      uniform vec3 horizonColor;
      varying vec3 vPosition;
      void main() {
        float h = clamp(normalize(vPosition).y, 0.0, 1.0);
        float t = smoothstep(0.0, 0.5, h);
        gl_FragColor = vec4(mix(horizonColor, zenithColor, t), 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.renderOrder = -1;
  return dome;
}
