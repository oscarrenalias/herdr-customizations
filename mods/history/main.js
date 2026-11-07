// Git history for the focused pane's repo: recent commits, click one to see its diff.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, theme } from "herdr";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const MAX_COMMITS = 200, MAX_DIFF_LINES = 1500, SEP = "\x1f";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());

export default class History extends View {
  init(_p, cx) {
    this.commits = []; this.error = null; this.loading = false; this.head = null;
    this.selected = null; this.detail = null; this.detailError = null;
    this.refresh(cx);
    cx.timer.every(5000, cx => this.refresh(cx));
  }

  git(args, context) {
    return exec("git", [...READ, ...args], { cwd: context.cwd, on: context.on });
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      this.context = { key: next, cwd, on }; this.commits = []; this.error = null; this.head = null;
      this.selected = null; this.detail = null; this.loading = false;
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const r = await this.git(["log", `--max-count=${MAX_COMMITS}`, `--format=%H${SEP}%h${SEP}%an${SEP}%ar${SEP}%s${SEP}%D`], context);
        if (this.context !== context) return;
        if (r.code !== 0) { this.error = /not a git repository/i.test(r.stderr) ? "Not a git repository" : (r.stderr.trim() || "No commits yet"); this.commits = []; }
        else {
          const head = r.stdout.slice(0, 41);
          if (head !== this.head || !this.commits.length) {
            this.head = head; this.error = null;
            this.commits = r.stdout.split("\n").filter(Boolean).map(l => {
              const [hash, short, author, when, subject, refs] = l.split(SEP);
              return { hash, short, author, when, subject, refs: (refs ?? "").split(", ").filter(Boolean) };
            });
          } else {
            // Same history: only the relative times move.
            r.stdout.split("\n").filter(Boolean).forEach((l, i) => { if (this.commits[i]) this.commits[i].when = l.split(SEP)[3]; });
          }
        }
      } catch (e) { if (this.context === context) { this.error = "Cannot run git here"; this.commits = []; } }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  open(commit, cx) {
    this.selected = commit; this.detail = null; this.detailError = null;
    const context = this.context;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const r = await this.git(["show", "--no-color", "--stat", "--patch", "--format=%an <%ae>%n%ad%n%n%B", commit.hash], context);
        if (this.selected !== commit) return;
        if (r.code !== 0) { this.detailError = r.stderr.trim() || "Cannot read this commit"; }
        else {
          const lines = r.stdout.split("\n");
          this.detail = { lines: lines.slice(0, MAX_DIFF_LINES), cut: lines.length > MAX_DIFF_LINES };
        }
      } catch { if (this.selected === commit) this.detailError = "Cannot run git here"; }
      finally { cx.notify(); }
    });
  }

  lineColor(line, t) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return t.muted;
    if (line.startsWith("@@")) return t.ansi6;
    if (line.startsWith("+")) return t.ansi2;
    if (line.startsWith("-")) return t.ansi1;
    return t.foreground;
  }

  renderList(t) {
    return v_flex().id("history-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
      .children(this.commits.map(c =>
        v_flex().id(`commit-${c.hash}`).flex_none().px(8).py(6).gap(2).rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.open(c, cx))
          .child(h_flex().gap(6).items_center().min_w(0)
            .children(c.refs.slice(0, 2).map(r => div().flex_none().px(5).rounded(4).text_size(10).bg(t.selected).text_color(t.accent).child(r.replace("HEAD -> ", ""))))
            .child(div().flex_1().min_w(0).truncate().child(c.subject)))
          .child(div().truncate().text_size(11).text_color(t.dim).child(`${c.short} · ${c.author} · ${c.when}`))))
      .when(Boolean(this.error) || !this.commits.length, el => el.child(div().p(8).text_size(12).text_color(t.dim)
        .child(this.error || (this.loading ? "Loading history…" : this.context?.cwd ? "No commits" : "No folder"))));
  }

  renderDetail(t) {
    const d = this.detail;
    return v_flex().id("history-detail").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(0)
      .text_size(11).font_family("JetBrains Mono")
      .when(!d, el => el.child(div().text_color(t.dim).child(this.detailError || "Loading commit…")))
      .when(Boolean(d), el => el.children(d.lines.map((line, i) =>
        div().flex_none().whitespace_nowrap().text_color(this.lineColor(line, t)).child(line || " "))))
      .when(Boolean(d?.cut), el => el.child(div().pt(6).text_color(t.dim).child(`Diff cut at ${MAX_DIFF_LINES} lines`)));
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), sel = this.selected;
    return v_flex().id("history").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(sel), el => el.child(div().id("history-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.selected = null; this.detail = null; cx.notify(); }).child("←")))
        .child(div().font_semibold().child("History"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
          .child(sel ? `${sel.short} · ${sel.subject}` : this.context?.cwd?.split(/[\\/]/).pop() ?? "")))
      .child(sel ? this.renderDetail(t) : this.renderList(t));
  }
}
