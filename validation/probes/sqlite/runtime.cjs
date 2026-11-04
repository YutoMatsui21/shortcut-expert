const assert = require("node:assert/strict");

/** @param {{ electron: string, packaged: boolean }} runtime @param {string} pinnedElectron @param {boolean} packaged */
function assertRuntime(runtime, pinnedElectron, packaged) {
  assert.equal(
    runtime.electron,
    pinnedElectron,
    "Repackage/reinstall Electron: runtime differs from package.json pin",
  );
  assert.equal(runtime.packaged, packaged);
}

module.exports = { assertRuntime };
