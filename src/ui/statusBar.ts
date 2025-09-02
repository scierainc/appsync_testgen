import * as vscode from "vscode";

class StatusBarController {
  private item: vscode.StatusBarItem | null = null;
  private _enabled = true;
  private _spinning = false;
  private spinTimer: NodeJS.Timeout | null = null;
  private _baseText = "";
  private _tooltip = "";
  private readonly ctxKey = "appsyncTestGen.statusBar.enabled";

  init(context: vscode.ExtensionContext, enabled?: boolean) {
    this._enabled = enabled ?? this._enabled;
    if (!this.item) {
      this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      this.item.command = "appsyncTestGen.toggleStatusBar";
      context.subscriptions.push(this.item);
    }
    this.render();
  }

  enable() { this._enabled = true; this.render(); }
  disable() { this._enabled = false; this.render(); }
  toggle() { this._enabled = !this._enabled; this.render(); }

  isEnabled() { return this._enabled; }

  update(text: string, tooltip?: string) {
    this._baseText = text;
    if (tooltip !== undefined) this._tooltip = tooltip;
    this.render();
  }

  spin(on: boolean) {
    this._spinning = on;
    if (!this.item) return;
    if (on) {
      if (!this.spinTimer) {
        // VS Code has a spinner codicon
        this.item.text = `$(sync~spin) ${this._baseText}`;
      }
    } else {
      if (this.spinTimer) clearInterval(this.spinTimer);
      this.spinTimer = null;
    }
    this.render();
  }

  clear() { this._baseText = ""; this._tooltip = ""; this.render(); }

  private render() {
    if (!this.item) return;
    if (!this._enabled) { this.item.hide(); return; }
    const prefix = this._spinning ? "$(sync~spin) " : "";
    this.item.text = `${prefix}${this._baseText || "AppSync TestGen ready"}`;
    this.item.tooltip = this._tooltip || "Click to toggle status bar visibility";
    this.item.show();
  }

  dispose() {
    if (this.spinTimer) clearInterval(this.spinTimer);
    this.spinTimer = null;
    this.item?.dispose();
    this.item = null;
  }
}

export const statusBar = new StatusBarController();
