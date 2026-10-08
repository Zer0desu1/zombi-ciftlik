// Basit, yeniden kullanılabilir sonlu durum makinesi.
// states: { ad: { enter(owner, data), update(owner, dt), exit(owner) } }
export class StateMachine {
  constructor(owner, states, initial) {
    this.owner = owner;
    this.states = states;
    this.current = null;
    this.name = null;
    this.timeInState = 0;
    if (initial) this.set(initial);
  }

  set(name, data) {
    if (this.name === name) return;
    if (!this.states[name]) throw new Error(`Bilinmeyen durum: ${name}`);
    this.current?.exit?.(this.owner);
    this.name = name;
    this.current = this.states[name];
    this.timeInState = 0;
    this.current.enter?.(this.owner, data);
  }

  update(dt) {
    this.timeInState += dt;
    this.current?.update?.(this.owner, dt);
  }
}
