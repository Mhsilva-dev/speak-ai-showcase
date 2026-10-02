// Captura o microfone, reamostra para 16 kHz e entrega blocos PCM16 de ~100 ms para a thread principal.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.out = new Int16Array(1600);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let level = 0;
    for (let i = 0; i < ch.length; i++) level = Math.max(level, Math.abs(ch[i]));
    while (this.pos < ch.length) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) {
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
        this.out = new Int16Array(1600);
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);
