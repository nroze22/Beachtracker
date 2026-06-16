// Object detector wrapper around TensorFlow.js COCO-SSD.
//
// COCO-SSD runs entirely in the browser on the WebGL backend (the iPhone GPU),
// so detection keeps working with no internet. We use the lite MobileNet v2
// base for a good speed/accuracy balance on phones.

import '@tensorflow/tfjs-backend-webgl';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { TRACKED_CLASSES } from './classes.js';

let model = null;

export async function loadDetector({ customModelUrl } = {}) {
  await tf.ready();
  try {
    await tf.setBackend('webgl');
  } catch {
    // Fall back to CPU/wasm default if WebGL is unavailable.
  }
  const opts = { base: 'lite_mobilenet_v2' };
  // A custom model URL must point to a COCO-SSD-compatible model.json
  // (e.g. an SSD MobileNet you retrained on seals/otters and exported to TF.js).
  if (customModelUrl) opts.modelUrl = customModelUrl;
  model = await cocoSsd.load(opts);
  return model;
}

/**
 * Run detection on a video/image element.
 * @returns {Array<{class:string, score:number, bbox:[number,number,number,number]}>}
 *          bbox is [x, y, width, height] in the element's pixel space.
 */
export async function detect(source, { maxObjects = 30, minScore = 0.4 } = {}) {
  if (!model) return [];
  const raw = await model.detect(source, maxObjects, minScore);
  return raw.filter((d) => TRACKED_CLASSES.has(d.class));
}

export function isReady() {
  return !!model;
}
