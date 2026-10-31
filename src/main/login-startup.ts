import type { LoginStartupState } from '../shared/coach.ts';

// Stable registry value, shared with the NSIS uninstall hook.
export const loginItemName = 'Shortcut Expert';
export const loginItemArgs = ['--login-startup'];
type LoginApi = {
  getLoginItemSettings(options: { path: string; args: string[] }): { launchItems: { name: string; scope: string; enabled: boolean; path: string; args: string[] }[] };
  setLoginItemSettings(options: { openAtLogin: boolean; name: string; path: string; args: string[]; enabled: boolean }): void;
};
export class LoginStartup {
  private api: LoginApi | null;
  private path: string;
  private get lookupPath(): string { return /\s/.test(this.path) ? `"${this.path}"` : this.path; }
  private error: string | null = null;
  constructor(api: LoginApi | null, path: string) { this.api = api; this.path = path; }
  read(): LoginStartupState {
    if (!this.api) return { available: false, enabled: false, error: null };
    try {
      // Electron parses this option as a Windows command line, including spaces.
      const state = this.api.getLoginItemSettings({ path: this.lookupPath, args: loginItemArgs });
      // openAtLogin checks the AUMID-named Run value, not our custom name.
      const enabled = state.launchItems.some(item => item.name === loginItemName && item.scope === 'user' && item.enabled &&
        item.path.toLowerCase() === this.path.toLowerCase() && item.args.length === loginItemArgs.length && item.args.every((arg, i) => arg === loginItemArgs[i]));
      return { available: true, enabled, error: this.error };
    } catch { return { available: true, enabled: false, error: '自動起動の状態を取得できません。Windowsのスタートアップ設定を確認してください。' }; }
  }
  set(enabled: boolean): LoginStartupState {
    if (!this.api) return this.read();
    this.error = null;
    try {
      // Electron defaults enabled to true and clears StartupApproved on registration.
      // Refuse to rewrite an OS-disabled item, even after an explicit in-app ON.
      if (enabled && this.api.getLoginItemSettings({ path: this.lookupPath, args: loginItemArgs }).launchItems.some(item =>
        item.name === loginItemName && item.scope === 'user' && !item.enabled)) {
        this.error = 'Windowsで自動起動が無効です。Windowsのスタートアップ設定から有効にしてください。';
        return this.read();
      }
      this.api.setLoginItemSettings({ openAtLogin: enabled, name: loginItemName, path: this.path, args: loginItemArgs, enabled });
      const state = this.read();
      if (!state.error && state.enabled !== enabled) this.error = '自動起動を変更できません。Windowsのスタートアップ設定を確認してください。';
    } catch { this.error = '自動起動を変更できません。Windowsのスタートアップ設定を確認してください。'; }
    return this.read();
  }
}
