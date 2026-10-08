import { QUESTS } from '../config.js';

// Görev durumu: { [id]: { status: 'active' | 'done', progress } }
export class QuestSystem {
  constructor(scene) {
    this.scene = scene;
    this.state = {};
  }

  def(id) { return QUESTS.find((q) => q.id === id); }

  // NPC'nin şu anki aktif görevi veya alınabilecek bir sonraki görevi
  forNpc(npcKey) {
    const list = QUESTS.filter((q) => q.npc === npcKey);
    const active = list.find((q) => this.state[q.id]?.status === 'active');
    if (active) return { quest: active, status: 'active' };
    const next = list.find((q) => !this.state[q.id]);
    if (next) return { quest: next, status: 'available' };
    return null;
  }

  activeList() {
    return QUESTS.filter((q) => this.state[q.id]?.status === 'active').map((q) => ({ ...q, progress: this.progress(q) }));
  }

  accept(id) {
    const q = this.def(id);
    // 'survive' görevlerinde ilerleme = atlatılmış dalga sayısı
    const survived = Math.max(0, this.scene.waves.wave - (this.scene.waves.active ? 1 : 0));
    this.state[id] = { status: 'active', progress: q.type === 'survive' ? survived : 0 };
    this.scene.events.emit('questsChanged');
  }

  progress(q) {
    if (q.type === 'deliver') return Math.min(q.amount, this.scene.inventory.count(q.item));
    return Math.min(q.amount, this.state[q.id]?.progress || 0);
  }

  canComplete(id) {
    const q = this.def(id);
    return this.state[id]?.status === 'active' && this.progress(q) >= q.amount;
  }

  complete(id) {
    if (!this.canComplete(id)) return false;
    const q = this.def(id);
    if (q.type === 'deliver') this.scene.inventory.remove(q.item, q.amount);
    this.state[id].status = 'done';
    if (q.reward.coins) this.scene.player.addCoins(q.reward.coins);
    Object.entries(q.reward.items || {}).forEach(([item, n]) => this.scene.giveItem(item, n));
    this.scene.events.emit('questsChanged');
    return true;
  }

  onKill() { this.bump('kill', 1); }
  onWaveSurvived(wave) {
    QUESTS.filter((q) => q.type === 'survive' && this.state[q.id]?.status === 'active')
      .forEach((q) => { this.state[q.id].progress = wave; });
    this.scene.events.emit('questsChanged');
  }

  bump(type, n) {
    let changed = false;
    QUESTS.filter((q) => q.type === type && this.state[q.id]?.status === 'active').forEach((q) => {
      this.state[q.id].progress = (this.state[q.id].progress || 0) + n;
      changed = true;
    });
    if (changed) this.scene.events.emit('questsChanged');
  }

  serialize() { return JSON.parse(JSON.stringify(this.state)); }
  load(d) { this.state = d || {}; }
}
