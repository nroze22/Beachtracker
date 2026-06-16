// YOLOv8 detector running in-browser on the TensorFlow.js WebGL backend.
//
// YOLOv8 is dramatically better than COCO-SSD at small/distant and large
// low-texture objects (exactly the "big ship far out" case), thanks to a 640px
// input and a stronger backbone. We load a pre-converted TF.js graph model,
// letterbox the frame to 640², run it, then decode the [1, 84, 8400] head with
// NMS and map boxes back to source-pixel coordinates.

import * as tf from '@tensorflow/tfjs';

// Standard COCO-80 class order (matches Ultralytics YOLOv8 training).
export const COCO_LABELS = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
  'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush'
];

let model = null;
let inputSize = 640;

export function yoloReady() {
  return !!model;
}

export async function loadYolo(url) {
  if (!url) throw new Error('No YOLO model URL');
  const m = await tf.loadGraphModel(url);
  // Infer the model's square input size if statically known (else keep 640).
  const ishape = m.inputs?.[0]?.shape;
  if (ishape && ishape.length === 4 && ishape[1] > 0) inputSize = ishape[1];
  // Warm up so the first real frame isn't janky.
  const dummy = tf.zeros([1, inputSize, inputSize, 3]);
  let w = m.execute(dummy);
  if (Array.isArray(w)) w.forEach((t) => t.dispose());
  else w.dispose();
  dummy.dispose();
  model = m;
  return model;
}

function srcDims(s) {
  return [s.videoWidth || s.width || s.naturalWidth, s.videoHeight || s.height || s.naturalHeight];
}

/**
 * @returns {Array<{class:string, score:number, bbox:[number,number,number,number]}>}
 *          bbox is [x, y, w, h] in source-pixel space.
 */
export async function detectYolo(source, { minScore = 0.25, iouThreshold = 0.45, maxObjects = 30 } = {}) {
  if (!model) return [];
  const [sw, sh] = srcDims(source);
  if (!sw || !sh) return [];
  const maxSide = Math.max(sw, sh);

  // Preprocess: letterbox to a square (pad bottom/right), resize to inputSize,
  // normalise to 0..1, add batch dim -> [1, S, S, 3].
  const input = tf.tidy(() => {
    const img = tf.browser.fromPixels(source);
    const padded = img.pad([
      [0, maxSide - sh],
      [0, maxSide - sw],
      [0, 0]
    ]);
    return tf.image.resizeBilinear(padded, [inputSize, inputSize]).div(255).expandDims(0);
  });

  let out = model.execute(input);
  if (Array.isArray(out)) out = out[0];
  input.dispose();

  // Decode head -> boxes (y1,x1,y2,x2 in input space), per-box best class/score.
  const { boxes, scores, classes } = tf.tidy(() => {
    let t = out.squeeze(0); // [84, 8400] or [8400, 84]
    if (t.shape[0] < t.shape[1]) t = t.transpose(); // -> [8400, 84]
    const nAttr = t.shape[1];
    const nClass = nAttr - 4;
    const xywh = t.slice([0, 0], [-1, 4]);
    const clsScores = t.slice([0, 4], [-1, nClass]);
    const score = clsScores.max(1);
    const cls = clsScores.argMax(1);
    const cx = xywh.slice([0, 0], [-1, 1]);
    const cy = xywh.slice([0, 1], [-1, 1]);
    const w = xywh.slice([0, 2], [-1, 1]);
    const h = xywh.slice([0, 3], [-1, 1]);
    const x1 = cx.sub(w.div(2));
    const y1 = cy.sub(h.div(2));
    const x2 = cx.add(w.div(2));
    const y2 = cy.add(h.div(2));
    return { boxes: tf.concat([y1, x1, y2, x2], 1), scores: score, classes: cls };
  });
  out.dispose();

  const nmsIdx = await tf.image.nonMaxSuppressionAsync(
    boxes,
    scores,
    maxObjects,
    iouThreshold,
    minScore
  );
  const [idx, boxesArr, scoresArr, classesArr] = await Promise.all([
    nmsIdx.array(),
    boxes.array(),
    scores.array(),
    classes.array()
  ]);
  tf.dispose([boxes, scores, classes, nmsIdx]);

  // input-space (0..inputSize over the padded square) -> source pixels.
  const k = maxSide / inputSize;
  const res = [];
  for (const i of idx) {
    const [y1, x1, y2, x2] = boxesArr[i];
    res.push({
      class: COCO_LABELS[classesArr[i]] || String(classesArr[i]),
      score: scoresArr[i],
      bbox: [x1 * k, y1 * k, (x2 - x1) * k, (y2 - y1) * k]
    });
  }
  return res;
}
