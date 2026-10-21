// Quality presets for the diorama (`?quality=high|medium|low`). Measured on WebGPU: the GPU cost
// sits in the post-processing passes (bloom about 65 % of them, ambient occlusion about 25 %) and
// in pixel count, not in the number of houses. Pure.

export type QualityName = 'high' | 'medium' | 'low';

export interface QualitySettings {
  /** Cap on device pixels per CSS pixel. */
  pixelRatio: number;
  msaa: number;
  ssao: boolean;
  bloom: boolean;
}

export const QUALITY: Record<QualityName, QualitySettings> = {
  high: { pixelRatio: 2, msaa: 4, ssao: true, bloom: true },
  medium: { pixelRatio: 1.5, msaa: 2, ssao: true, bloom: false },
  low: { pixelRatio: 1, msaa: 1, ssao: false, bloom: false },
};

export function parseQuality(value: string | null): QualityName {
  return value === 'medium' || value === 'low' ? value : 'high';
}
