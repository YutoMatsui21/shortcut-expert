// Isolated feasibility app: same pinned Electron, ASAR and Windows x64 packager as the product.
module.exports = {
  appId: 'local.window-shortcut-coach.sqlite-probe',
  productName: 'SQLite Storage Probe',
  directories: { output: 'release/sqlite-probe' },
  files: ['validation/probes/sqlite/*.cjs', 'package.json'],
  asar: true,
  asarUnpack: ['validation/probes/sqlite/worker.cjs', 'validation/probes/sqlite/store.cjs'],
  extraMetadata: { main: 'validation/probes/sqlite/main.cjs' },
  win: { target: [{ target: 'dir', arch: ['x64'] }], signAndEditExecutable: false }
};
