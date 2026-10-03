// Browser audio for the Live API: 16 kHz mono PCM16 in, 24 kHz mono PCM16 out.

const WORKLET = `class MicTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("mic-tap", MicTap);`;

const MIC_RATE = 16000;
const CHUNK_SAMPLES = 800; // 50 ms

export class MicCapture {
  muted = false;
  private constructor(
    private stream: MediaStream,
    private ctx: AudioContext,
    private node: AudioWorkletNode,
  ) {}

  // Asks for the microphone first so a denial never wastes a paid session.
  static async start(onChunk: (pcm16le: Uint8Array) => void) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const ctx = new AudioContext();
    const url = URL.createObjectURL(
      new Blob([WORKLET], { type: "application/javascript" }),
    );
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(ctx, "mic-tap");
    const mic = new MicCapture(stream, ctx, node);
    const ratio = ctx.sampleRate / MIC_RATE;
    let pending: number[] = [];
    let carry = 0; // fractional input position carried between blocks
    const out = new Int16Array(CHUNK_SAMPLES);
    let filled = 0;
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (mic.muted) return;
      const input = event.data;
      for (let i = 0; i < input.length; i++) pending.push(input[i]);
      // Box-filter downsample: average each ratio-sized window of input.
      while (carry + ratio <= pending.length) {
        let sum = 0;
        const start = Math.floor(carry),
          end = Math.floor(carry + ratio);
        for (let j = start; j < end; j++) sum += pending[j];
        const sample = Math.max(
          -1,
          Math.min(1, sum / Math.max(1, end - start)),
        );
        out[filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        carry += ratio;
        if (filled === CHUNK_SAMPLES) {
          onChunk(new Uint8Array(out.slice().buffer));
          filled = 0;
        }
      }
      const drop = Math.floor(carry);
      if (drop > 0) {
        pending = pending.slice(drop);
        carry -= drop;
      }
    };
    const silent = ctx.createGain();
    silent.gain.value = 0;
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(silent).connect(ctx.destination);
    await ctx.resume();
    return mic;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.stream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  stop() {
    this.node.port.onmessage = null;
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }
}

export class Player {
  private ctx: AudioContext;
  private gain: GainNode;
  private analyser: AnalyserNode;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private levelData: Uint8Array<ArrayBuffer>;
  onSpeakingChange: (speaking: boolean) => void = () => {};

  constructor(muted: boolean) {
    this.ctx = new AudioContext({ sampleRate: 24000 });
    this.gain = this.ctx.createGain();
    this.gain.gain.value = muted ? 0 : 1;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.levelData = new Uint8Array(this.analyser.frequencyBinCount);
    this.gain.connect(this.analyser).connect(this.ctx.destination);
  }

  resume() {
    return this.ctx.resume();
  }

  push(base64: string) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    const buffer = this.ctx.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const startAt = Math.max(this.ctx.currentTime + 0.03, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    if (!this.sources.size) this.onSpeakingChange(true);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) this.onSpeakingChange(false);
    };
  }

  // The visitor spoke over the agent: drop everything queued.
  interrupt() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
    }
    const wasSpeaking = this.sources.size > 0;
    this.sources.clear();
    this.nextTime = 0;
    if (wasSpeaking) this.onSpeakingChange(false);
  }

  setMuted(muted: boolean) {
    this.gain.gain.value = muted ? 0 : 1;
  }

  // 0..1 output loudness for the live indicator.
  level() {
    this.analyser.getByteTimeDomainData(this.levelData);
    let peak = 0;
    for (const v of this.levelData) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(1, peak / 64);
  }

  close() {
    this.interrupt();
    void this.ctx.close();
  }
}
