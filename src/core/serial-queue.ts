export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    // 呼出し元には失敗を返し、キューは次の処理を続けられる状態に戻す。
    this.tail = result.catch(() => {});
    return result;
  }
}
