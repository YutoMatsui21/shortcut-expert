import { resolve } from "node:path";
import { SqliteRepository } from "../../src/main/sqlite-repository.ts";
const repository = new SqliteRepository(
  process.argv[2],
  resolve("src/main/storage-worker.ts"),
);
const loaded = await repository.load("2026-10-19");
await repository.commit({
  epoch: loaded.epoch,
  writeSession: repository.session,
  sequence: 1,
  today: "2026-10-19",
  count: { day: "2026-10-19", operation: "W03", origin: "key" },
  coverage: [],
});
process.stdout.write("COMMITTED\n");
// Supervisor kills this process rather than letting repository.close release the writer.
setInterval(() => {}, 1000);
