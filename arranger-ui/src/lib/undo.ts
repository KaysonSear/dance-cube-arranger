/** 线性 undo/redo 栈:持有不可变状态快照(past/present/future),新编辑清空 redo。 */

export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    private present: T,
    private readonly cap = 500,
  ) {}

  get current(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  /** 诊断用:栈深度(见 window.__undoDiag)。 */
  get pastLength(): number {
    return this.past.length;
  }

  get futureLength(): number {
    return this.future.length;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  push(next: T): void {
    this.past.push(this.present);
    if (this.past.length > this.cap) this.past.shift();
    this.present = next;
    this.future = [];
  }

  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.present);
    this.present = prev;
    return prev;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.present = state;
  }
}
