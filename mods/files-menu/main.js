// Right-click menu for a folder in the Files panel. Opened as a popup by my-files with
// props { folder: "<absolute path>", on?: "<machine name>", overlay }.
// ↑/↓ move, Enter runs, Esc closes.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, knownAgents, theme } from "herdr";

const ITEMS = [
  { label: "Open Claude Code here", icon: "icons/claude.svg", act: async (folder, on) => {
      // The launch command comes from programs.json (so a custom `claude` entry is honoured).
      const known = await knownAgents({ on }).catch(() => []);
      const argv = known.find((a) => a.key === "claude")?.run ?? ["claude"];
      run("tab.new", { folder, argv });
    } },
  // No argv: the machine's default shell.
  { label: "Open Terminal here", icon: "mods/workspace-chrome/terminal.svg", act: async (folder) => { run("tab.new", { folder }); } },
];

export default class FilesMenu extends View {
  init(_p, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const item = ITEMS[i], p = props() ?? {};
    if (!item) return;
    closeOverlay(p.overlay);
    if (p.folder) item.act(p.folder, p.on ?? null);
  }

  render() {
    const t = theme();
    return v_flex().id("files-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).border_1().border_color(t.input).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % ITEMS.length;
        else if (e.key === "up") this.at = (this.at + ITEMS.length - 1) % ITEMS.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children(ITEMS.map((it, i) =>
        h_flex().id(`fm-${i}`).h(31).px(8).gap(9).items_center().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.choose(i))
          .child(svg(it.icon).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(it.label))));
  }
}
