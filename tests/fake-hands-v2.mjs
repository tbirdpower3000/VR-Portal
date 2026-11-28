// A stand-in for the MediaPipe hand finder, for tests/engine-v2.test.cjs. The page's window.__fake = { on, pinch }
// says whether a hand is in view and whether its thumb and index finger are together. Like the real one, it refuses
// every picture after a time that is not later than the last.
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const HandLandmarker = {
  createFromOptions: async () => {
    let last = -Infinity, broken = false;
    return {
      close() {},
      detectForVideo(src, now) {
        const f = window.__fake || { on: false };
        if (now <= last) broken = true;
        if (broken) throw new Error('stand-in: Packet timestamp mismatch');
        last = now;
        (window.__looks = window.__looks || []).push(now);
        if (!f.on) return { landmarks: [], worldLandmarks: [], handednesses: [] };
        const lm = Array.from({ length: 21 }, (_, i) => ({ x: 0.35 + (i % 5) * 0.06, y: 0.55 + Math.floor(i / 5) * 0.06, z: 0 }));
        const w = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
        w[9] = { x: 0, y: -0.09, z: 0 }; w[8] = { x: -0.02, y: -0.16, z: 0 };
        w[4] = f.pinch ? { x: -0.022, y: -0.155, z: 0 } : { x: -0.09, y: -0.1, z: 0 };
        return { landmarks: [lm], worldLandmarks: [w], handednesses: [[{ categoryName: 'Right' }]] };
      },
    };
  },
};
