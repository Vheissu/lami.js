export class ValueSlot<T> {
  private hasValue = false;
  private value!: T;

  shouldWrite(next: T): boolean {
    if (this.hasValue && Object.is(this.value, next)) return false;
    this.hasValue = true;
    this.value = next;
    return true;
  }

  remember(next: T): void {
    this.hasValue = true;
    this.value = next;
  }
}
