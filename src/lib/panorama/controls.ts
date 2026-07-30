import { normalizeBearing } from '../geo';

/** État de la vue panoramique, en degrés. */
export interface ViewState {
  /** Cap regardé : 0 = nord, 90 = est. */
  heading: number;
  /** Assiette : positif vers le haut. */
  pitch: number;
  /** Champ de vision vertical. */
  fov: number;
}

const PITCH_MIN = -35;
const PITCH_MAX = 60;
const FOV_MIN = 18;
const FOV_MAX = 75;

/**
 * Contrôles « regarder autour de soi » au doigt et à la souris (Pointer Events) :
 * glisser pour tourner, molette ou pincement pour zoomer (variation du FOV).
 * Le contenu suit le doigt, comme dans une visionneuse de panorama.
 */
export class PanoramaControls {
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { distance: number; fov: number } | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly el: HTMLElement,
    private readonly state: ViewState,
    private readonly onChange: () => void,
  ) {
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    const wheel = (e: WheelEvent) => this.onWheel(e);

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    this.unsubscribe = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }

  dispose(): void {
    this.unsubscribe();
    this.pointers.clear();
  }

  /** Degrés balayés par pixel glissé, proportionnel au zoom courant. */
  private degreesPerPixel(): number {
    return this.state.fov / Math.max(1, this.el.clientHeight);
  }

  private onDown(e: PointerEvent): void {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      this.pinchStart = { distance: this.pinchDistance(), fov: this.state.fov };
    }
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2 && this.pinchStart) {
      const scale = this.pinchDistance() / this.pinchStart.distance;
      this.setFov(this.pinchStart.fov / scale);
      return;
    }

    const k = this.degreesPerPixel();
    this.state.heading = normalizeBearing(this.state.heading - dx * k);
    this.state.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.state.pitch + dy * k));
    this.onChange();
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.setFov(this.state.fov * Math.exp(e.deltaY * 0.001));
  }

  private setFov(fov: number): void {
    this.state.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, fov));
    this.onChange();
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 1;
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }
}
