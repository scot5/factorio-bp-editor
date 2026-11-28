/** Union-find over layout indexes. */
export class UnionFind {
  private readonly parent = new Map<number, number>()

  constructor(items: Iterable<number>) {
    for (const i of items) this.parent.set(i, i)
  }

  has(i: number): boolean {
    return this.parent.has(i)
  }

  find(i: number): number {
    let root = i
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    this.parent.set(i, root)
    return root
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}
