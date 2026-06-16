// Detection facade: routes to YOLOv8 (accurate, default) or COCO-SSD (light
// fallback). Both return the same shape so the rest of the app is engine-blind.

import '@tensorflow/tfjs-backend-webgl';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { loadYolo, detectYolo, yoloReady } from './yolo.js';
import { TRACKED_CLASSES } from './classes.js';

let engine = 'coco';
let cocoModel = null;

/**
 * @returns {{engine:'yolo'|'coco', fellBack:boolean}} which engine actually loaded.
 */
export async function loadDetector({
  engine: requested = 'yolo',
  customModelUrl,
  highAccuracy = true,
  yoloUrl
} = {}) {
  await tf.ready();
  try {
    await tf.setBackend('webgl');
  } catch {
    /* fall back to default backend */
  }

  if (requested === 'yolo') {
    try {
      await loadYolo(yoloUrl);
      engine = 'yolo';
      return { engine, fellBack: false };
    } catch (e) {
      console.error('YOLOv8 load failed, falling back to COCO-SSD:', e);
      // fall through to COCO
    }
  }

  const opts = { base: highAccuracy ? 'mobilenet_v2' : 'lite_mobilenet_v2' };
  if (customModelUrl) opts.modelUrl = customModelUrl;
  cocoModel = await cocoSsd.load(opts);
  engine = 'coco';
  return { engine, fellBack: requested === 'yolo' };
}

export function activeEngine() {
  return engine;
}

export function isReady() {
  return engine === 'yolo' ? yoloReady() : !!cocoModel;
}

/**
 * @returns {Promise<Array<{class:string, score:number, bbox:[number,number,number,number]}>>}
 */
export async function detect(source, { maxObjects = 30, minScore = 0.35 } = {}) {
  let raw;
  if (engine === 'yolo' && yoloReady()) {
    raw = await detectYolo(source, { minScore, maxObjects, iouThreshold: 0.45 });
  } else if (cocoModel) {
    raw = await cocoModel.detect(source, maxObjects, minScore);
  } else {
    return [];
  }
  return raw.filter((d) => TRACKED_CLASSES.has(d.class));
}
