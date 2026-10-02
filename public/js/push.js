// Lembrete diário por notificação: ativar, escolher horário e desligar (fica no painel do idioma)
import { api, toast, state, icon } from './core.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

function keyBytes(b64) {
  const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function enable() {
  const { publicKey } = await api('/push/key');
  if (!publicKey) throw new Error('Notificações ainda não estão disponíveis');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Você não permitiu as notificações');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api('/push/subscribe', { body: sub.toJSON() });
  if (state.me.reminderHour == null) {
    await api('/auth/prefs', { method: 'PATCH', body: { reminderHour: 19 } });
    state.me.reminderHour = 19;
  }
  await api('/push/test', { method: 'POST' }).catch(() => {});
}

async function disable() {
  const sub = await currentSub();
  if (sub) {
    await api('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } });
    await sub.unsubscribe().catch(() => {});
  }
  await api('/auth/prefs', { method: 'PATCH', body: { reminderHour: null } });
  state.me.reminderHour = null;
}

export async function reminderWidget(el) {
  if (!el) return;
  if (!supported()) {
    el.innerHTML = isIOS && !standalone()
      ? `<small class="muted remind-note">${icon('bell', 14)}No iPhone, instale o app para receber lembretes.</small>` : '';
    return;
  }
  const sub = Notification.permission === 'granted' ? await currentSub() : null;
  if (sub && state.me.reminderHour != null) {
    const hours = Array.from({ length: 18 }, (_, i) => i + 6)
      .map((h) => `<option value="${h}" ${h === state.me.reminderHour ? 'selected' : ''}>${h}h</option>`).join('');
    el.innerHTML = `<div class="remind on">${icon('bell', 16)}<span>Lembrete diário às</span>
      <select id="rh" aria-label="Horário do lembrete">${hours}</select><button type="button" class="linkish" id="roff">Desligar</button></div>`;
    el.querySelector('#rh').onchange = async (e) => {
      const h = Number(e.target.value);
      try { await api('/auth/prefs', { method: 'PATCH', body: { reminderHour: h } }); state.me.reminderHour = h; toast(`Lembrete às ${h}h`, { type: 'ok' }); }
      catch (err) { toast(err.message, { type: 'err' }); }
    };
    el.querySelector('#roff').onclick = async () => {
      try { await disable(); toast('Lembrete desligado', { type: 'info' }); } catch (err) { toast(err.message, { type: 'err' }); }
      reminderWidget(el);
    };
  } else if (Notification.permission === 'denied') {
    el.innerHTML = `<small class="muted remind-note">${icon('bell', 14)}Notificações bloqueadas. Libere nas configurações do site para receber lembretes.</small>`;
  } else {
    el.innerHTML = `<button type="button" class="remind" id="ron">${icon('bell', 16)}Ativar lembrete diário</button>`;
    el.querySelector('#ron').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { await enable(); toast('Lembrete ligado! Todo dia às ' + state.me.reminderHour + 'h, se você ainda não tiver estudado.', { type: 'ok' }); }
      catch (err) { toast(err.message, { type: 'err' }); }
      reminderWidget(el);
    };
  }
}
