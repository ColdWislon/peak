import * as THREE from 'three';
import { degToRad, localToLatLon, type LatLon } from '../geo';
import { tileBlockAround, tileCount } from '../terrain/blocks';
import {
  serializeGeoHeightField,
  type GeoHeightField,
  type GeoHeightFieldData,
} from '../terrain/heightField';
import { loadBlockHeightField } from '../terrain/loader';
import { elevationToColor } from './colors';
import { PanoramaControls, type ViewState } from './controls';
import { buildPolarTerrainMesh } from './mesh';

/**
 * Moteur de rendu du panorama : une scène Three.js minimale autour du maillage
 * polaire produit par mesh.ts. Toute la géométrie/géodésie vient des modules
 * purs ; ici on ne fait qu'orchestrer WebGL.
 */

/** Champ proche : haute résolution (z12 ≈ 26 m/pixel dans les Alpes). */
const INNER = { zoom: 12, radiusM: 24_000 };
/** Champ lointain : jusqu'à l'horizon du panorama (z10 ≈ 106 m/pixel). */
const OUTER = { zoom: 10, radiusM: 115_000 };
/** Hauteur de l'œil au-dessus du sol (m) — dégage le premier plan. */
const EYE_HEIGHT_M = 10;
/** Le maillage s'arrête un peu avant le bord du champ lointain. */
const MESH_MAX_RADIUS_M = OUTER.radiusM - 5_000;

const SKY_COLOR = new THREE.Color('#a9c8e6');

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
    this.scene.background = SKY_COLOR;
    this.scene.fog = new THREE.Fog(SKY_COLOR, 25_000, 150_000);

    const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    sun.position.set(-0.5, 0.8, 0.4).multiplyScalar(100_000);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight('#bcd6f2', '#3d4636', 0.9));

    this.camera = new THREE.PerspectiveCamera(this.view.fov, 1, 15, 400_000);
    this.camera.rotation.order = 'YXZ';

    this.controls = new PanoramaControls(canvas, this.view, () => this.applyView());

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.applyView();

    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
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

    const eyeElevation = this.buildTerrain(viewpoint, inner, outer);
    return {
      viewpoint,
      eyeElevation,
      innerRadiusM: INNER.radiusM,
      inner: serializeGeoHeightField(inner),
      outer: serializeGeoHeightField(outer),
    };
  }

  private buildTerrain(viewpoint: LatLon, inner: GeoHeightField, outer: GeoHeightField): number {
    // Fondu proche/lointain sur les 4 derniers kilomètres du champ z12 :
    // sans lui, le saut de résolution dessine une couture circulaire à 24 km.
    const blendStart = INNER.radiusM - 4_000;
    const sample = (east: number, north: number): number => {
      const p = localToLatLon(viewpoint, east, north);
      const r = Math.hypot(east, north);
      const outerElev = () => (outer.contains(p) ? outer.elevationAt(p) : 0);
      if (r >= INNER.radiusM || !inner.contains(p)) return outerElev();
      const innerElev = inner.elevationAt(p);
      if (r < blendStart) return innerElev;
      const t = (r - blendStart) / (INNER.radiusM - blendStart);
      return innerElev * (1 - t) + outerElev() * t;
    };

    const data = buildPolarTerrainMesh(sample, elevationToColor, {
      maxRadiusM: MESH_MAX_RADIUS_M,
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    this.disposeTerrain();
    this.terrain = new THREE.Mesh(geometry, material);
    this.scene.add(this.terrain);

    const groundElevation = sample(0, 0);
    const eyeElevation = groundElevation + EYE_HEIGHT_M;
    this.camera.position.set(0, eyeElevation, 0);
    this.applyView();
    return eyeElevation;
  }

  private applyView(): void {
    this.camera.fov = this.view.fov;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.y = -degToRad(this.view.heading);
    this.camera.rotation.x = degToRad(this.view.pitch);
    this.onViewChange?.(this.view);
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? this.canvas.clientWidth ?? 1;
    const height = parent?.clientHeight ?? this.canvas.clientHeight ?? 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
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
    this.disposeTerrain();
    this.renderer.dispose();
  }
}
