// Áudio da aula ao vivo: microfone → PCM16 16 kHz (base64) e reprodução contínua do PCM16 24 kHz do professor.
const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export class LiveAudio {
  constructor({ onChunk, onLevel }) {
    this.onChunk = onChunk;
    this.onLevel = onLevel || (() => {});
    this.muted = false;
    this.sources = new Set();
    this.nextTime = 0;
    // Sem fone, o microfone capta a voz do professor e a IA "responde a si mesma".
    // Com a trava ligada, o microfone só vai para a IA quando o professor não está falando,
    // a menos que o aluno fale alto por cima (interrupção).
    this.echoGuard = true;
    this.onBargeIn = () => {};
    this.loud = 0;
    this.held = [];
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('Seu navegador não suporta aula por voz. Use o Chrome, Edge ou Safari atualizados.');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.micCtx = new AudioContext();
    await this.micCtx.audioWorklet.addModule('/js/mic-worklet.js');
    const src = this.micCtx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.micCtx, 'mic-processor');
    this.node.port.onmessage = (e) => {
      if (this.muted) { this.onLevel(0, 'student'); return; }
      const { level, pcm } = e.data;
      if (this.echoGuard && this.busy) {
        // Professor falando: segura o áudio; se for voz forte e contínua, é o aluno interrompendo
        this.loud = level > 0.45 ? this.loud + 1 : 0;
        this.held.push(pcm); if (this.held.length > 5) this.held.shift();
        if (this.loud < 4) return;
        this.stopPlayback();
        this.onBargeIn();
        for (const h of this.held) this.onChunk(toBase64(h));
        this.held = []; this.loud = 0;
        return;
      }
      this.held = []; this.loud = 0;
      this.onLevel(level, 'student');
      this.onChunk(toBase64(pcm));
    };
    src.connect(this.node);
    this.playCtx = new AudioContext({ sampleRate: 24000 });
    this.analyser = this.playCtx.createAnalyser();
    this.analyser.fftSize = 256;
    // Toca por um <audio>: assim o cancelamento de eco do navegador "sabe" o que sai do alto-falante
    try {
      const dest = this.playCtx.createMediaStreamDestination();
      this.analyser.connect(dest);
      this.audioEl = new Audio();
      this.audioEl.srcObject = dest.stream;
      await this.audioEl.play();
    } catch {
      this.audioEl = null;
      this.analyser.disconnect();
      this.analyser.connect(this.playCtx.destination);
    }
    this.meter();
  }

  // Nível da voz do professor para a animação
  meter() {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      if (!this.playCtx) return;
      this.analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      if (this.sources.size) this.onLevel(peak, 'teacher');
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  play(base64) {
    if (!this.playCtx) return;
    if (this.playCtx.state === 'suspended') this.playCtx.resume();
    const bin = atob(base64);
    const len = bin.length >> 1;
    const buf = this.playCtx.createBuffer(1, len, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      if (v >= 0x8000) v -= 0x10000;
      ch[i] = v / 0x8000;
    }
    const node = this.playCtx.createBufferSource();
    node.buffer = buf;
    node.connect(this.analyser);
    const now = this.playCtx.currentTime;
    if (this.nextTime < now + 0.03) this.nextTime = now + 0.03;
    node.start(this.nextTime);
    this.nextTime += buf.duration;
    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
  }

  get speaking() { return this.sources.size > 0; }

  /** Professor falando (com uma folga para o eco do ambiente sumir) */
  get busy() { return this.speaking || (this.playCtx && this.playCtx.currentTime < this.nextTime + 0.4); }

  /** Aluno interrompeu: corta a fala do professor na hora */
  stopPlayback() {
    for (const s of this.sources) { try { s.stop(); } catch { /* já parou */ } }
    this.sources.clear();
    this.nextTime = 0;
  }

  setMuted(m) { this.muted = m; }

  async stop() {
    cancelAnimationFrame(this.raf);
    this.stopPlayback();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.srcObject = null; this.audioEl = null; }
    try { await this.micCtx?.close(); } catch { /* ok */ }
    try { await this.playCtx?.close(); } catch { /* ok */ }
    this.micCtx = null; this.playCtx = null;
  }
}
