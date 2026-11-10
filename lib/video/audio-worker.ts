import { findImpacts, refineContact } from "../tracking/hits";

// FFT and speech features belong off the UI thread, especially for long phone recordings.
self.onmessage = async (event: MessageEvent<{ pcm: ArrayBuffer; sampleRate: number }>) => {
  try {
    const { sampleRate } = event.data;
    const pcm = new Int16Array(event.data.pcm);
    const impacts = await findImpacts(pcm, sampleRate, (progress) => self.postMessage({ progress }));
    const sounds = impacts.map((e) => ({
      ...e, t: refineContact(pcm, sampleRate, e.t),
    }));
    self.postMessage({ sounds });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : "Audio scan failed." });
  }
};
