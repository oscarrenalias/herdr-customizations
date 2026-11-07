// Renders a markdown file in a pane and reloads it when the file changes.
// props: { file: "<absolute path>", on?: "<machine name>" }
// Preview/Source toggle; relative .md links open in place (← goes back); web links open in the browser.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState } from "gpui-base";
import { props, readTextFile, watchFolder, theme, settings, exec, window } from "herdr";

const MAX = 600000;
const dirname = (p) => p.replace(/[\\/][^\\/]*$/, "") || "/";
const basename = (p) => p.split(/[\\/]/).pop();
const isMarkdown = (p) => /\.(md|markdown|mdx)$/i.test(p);

// Resolves a link against the shown file's folder, collapsing . and ..
function resolve(file, href) {
  let target;
  try { target = decodeURI(href.split("#")[0]); } catch { return null; }
  if (!target) return null;
  const parts = (target.startsWith("/") ? target : `${dirname(file)}/${target}`).split("/"), out = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return "/" + out.join("/");
}

export default class MdViewer extends View {
  init(_p, cx) {
    const p = props() ?? {};
    this.on = p.on ?? null;
    this.back = [];
    this.mode = "preview";
    this.version = 0;
    this.open(p.file ?? null, cx);
    // watchFolder is local only: poll another machine's file gently.
    if (this.on) cx.timer.every(3000, (cx) => this.load(cx));
  }

  open(file, cx) {
    this.file = file; this.text = null; this.error = null;
    this.source?.release(); this.source = null;
    this.load(cx);
    this.watch(cx);
  }

  watch(cx) {
    if (this.on || !this.file) return;
    const dir = dirname(this.file);
    if (this.watched === dir) return;
    this.watched = dir;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === dir) {
          const changed = await watchFolder(dir);
          // A returned root path means "refresh everything".
          if (this.watched === dir && changed.some((c) => c === dir || basename(c) === basename(this.file))) this.load(cx);
        }
      } catch { if (this.watched === dir) this.watched = null; }
    });
  }

  load(cx) {
    const file = this.file;
    if (!file) { this.error = "No file given"; cx.notify(); return; }
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(file, { on: this.on });
        if (this.file !== file) return;
        if (text === null) { this.error = "This file is no longer available"; this.text = null; }
        else {
          const next = text.length > MAX ? text.slice(0, MAX) + "\n\n… (file truncated)" : text;
          if (next !== this.text || this.error) {
            this.text = next; this.error = null; this.version++;
            this.source?.release(); this.source = null;
            if (this.mode === "source") this.ensureSource();
          }
        }
      } catch { if (this.file === file) { this.error = "Cannot read this file"; this.text = null; } }
      cx.notify();
    });
  }

  follow(url, cx) {
    if (/^(https?|mailto):/i.test(url)) {
      const platform = window()?.platform;
      exec(platform === "windows" ? "explorer" : platform === "macos" ? "open" : "xdg-open", [url]).catch(() => null);
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || !this.file) return;   // other schemes: ignore
    const target = resolve(this.file, url);
    if (target && isMarkdown(target)) { this.back.push(this.file); this.open(target, cx); }
  }

  // EditorState can't be created during render, so it's built when Source is picked.
  ensureSource() {
    if (this.source || this.text === null) return;
    const t = theme();
    this.source = EditorState.new({ language: "markdown", readonly: true, value: this.text,
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
  }

  chip(id, label, on, t, action) {
    return div().id(id).h(24).px(9).flex().flex_none().items_center().cursor_pointer().text_size(11.5)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click(action).child(label);
  }

  render() {
    const t = theme(), preview = this.mode === "preview";
    if (!this.file) return div().p(12).text_color(t.dim).child("No file given");
    return v_flex().id("md-root").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(32).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .when(this.back.length > 0, (el) => el.child(this.chip("md-back", "←", false, t, (_e, cx) => this.open(this.back.pop(), cx))))
        .child(div().font_semibold().flex_none().child(basename(this.file)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dirname(this.file)))
        .child(this.chip("md-mode-preview", "Preview", preview, t, (_e, cx) => { this.mode = "preview"; cx.notify(); }))
        .child(this.chip("md-mode-source", "Source", !preview, t, (_e, cx) => { this.mode = "source"; this.ensureSource(); cx.notify(); })))
      .when(this.text === null, (el) => el.child(div().p(16).text_color(this.error ? t.ansi1 : t.dim).child(this.error ?? "Loading…")))
      .when(this.text !== null && !preview, (el) => el.child(
        this.source ? Editor.new(this.source).flex_1().min_h(0) : div().p(16).text_color(t.dim).child("Loading…")))
      .when(this.text !== null && preview, (el) => el.child(
        div().id("md-scroll").flex_1().min_h(0).overflow_y_scrollbar()
          .child(h_flex().w_full().justify_center().px(16).py(12)
            .child(div().w_full().max_w(880).text_size(14)
              .child(TextView.markdown(`md-${this.version}`, this.text).selectable(true)
                .on_link_click((url, cx) => this.follow(url, cx)))))));
  }
}
