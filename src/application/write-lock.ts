import { assert } from '../domain/model';

/** Shared by image operations and recovery cleanup so their mutations cannot overlap. */
export class WriteLock {
  private held = false;
  get busy(): boolean {
    return this.held;
  }

  acquire(): () => void {
    assert(!this.held, 'Another operation is running.');
    this.held = true;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.held = false;
      }
    };
  }
}
