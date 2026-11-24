import { download, hex32 } from "../store.js";
import { icon, fmt } from "../ui.js";

export function render(root, ctx) {
  const { store, toast, openModal } = ctx;
  const draw = () => {
    const s = store.state;
    const B = store.backups;
    root.innerHTML = `
      <div class="view-head">
        <div>
          <span class="eyebrow">Verify</span>
          <h1 style="margin-top:10px">Backups</h1>
          <p>Every edit is snapshotted automatically a moment after you make it. Pin your own named snapshots before big changes, restore any version, or export the whole project to a file.</p>
        </div>
        <div class="tools">
          <label class="btn btn-ghost btn-sm" for="imp" style="cursor:pointer">${icon("upload")} Import project</label><input type="file" id="imp" accept=".json,application/json" hidden>
          <button class="btn btn-ghost btn-sm" id="exp">${icon("download")} Export project</button>
        </div>
      </div>
      <div class="cols cols-main">
        <section class="panel">
          <div class="panel-h"><h2>Timeline</h2><span class="sub">${B.length} snapshots · newest first</span>
            <span class="right" style="gap:8px"><label class="sr-only" for="snap-name">Snapshot name</label><input id="snap-name" class="input" style="height:34px;width:220px" placeholder="Name this snapshot"><button class="btn btn-primary btn-sm" id="snap">${icon("plus")} Snapshot</button></span></div>
          <div class="timeline">${B.map((b, i) => `
            <div class="tl ${b.auto ? "" : "manual"}">
              <span class="node"></span>
              <div style="min-width:0"><b>${fmt.esc(b.label)}</b>${i === 0 ? ` <span class="pill neutral">Latest</span>` : ""}${b.auto ? "" : ` <span class="pill good">Pinned</span>`}<div class="meta">${fmt.time(b.at)} · ${b.changes} change${b.changes === 1 ? "" : "s"} · CRC ${b.crc}</div></div>
              <div class="act">
                <button class="btn btn-ghost btn-sm" data-restore="${b.id}">Restore</button>
                <button class="icon-btn" data-dl="${b.id}" aria-label="Download snapshot">${icon("download")}</button>
                <button class="icon-btn" data-del="${b.id}" aria-label="Delete snapshot">${icon("trash")}</button>
              </div>
            </div>`).join("")}</div>
        </section>
        <div class="stack">
          <section class="panel">
            <div class="panel-h"><h3>Stock recovery point</h3></div>
            <div class="panel-b" style="font-size:.86rem;color:var(--text-2);display:grid;gap:8px">
              ${s.stock ? `<div><b style="color:var(--text)">${fmt.esc(s.stock.name)}</b></div><div class="mono" style="font-size:.76rem">${s.stock.size.toLocaleString()} B · CRC ${hex32(s.stock.crc)}</div><div class="mono dim" style="font-size:.68rem;word-break:break-all">SHA-256 ${s.stock.sha}</div><div>Saved ${fmt.time(s.stock.at)}</div>`
                : `<div class="callout warn">${icon("alert")}<span>No stock file yet. Upload your stock read on the <a href="#overview" style="color:var(--accent)">Project</a> page. It's your way back if anything goes wrong.</span></div>`}
              <p class="dim" style="font-size:.76rem">Keep a copy of your stock .bin somewhere besides this computer, like a USB stick or cloud drive. Browser storage can be cleared.</p>
            </div>
          </section>
          <section class="panel">
            <div class="panel-h"><h3>How backups work</h3></div>
            <div class="panel-b"><ul style="margin:0;padding-left:18px;display:grid;gap:8px;font-size:.85rem;color:var(--text-2)">
              <li>Automatic snapshots are taken 1.5 seconds after each edit and are capped at 40. Pinned snapshots are kept first.</li>
              <li>Restoring is itself undoable (Ctrl+Z) and creates a new snapshot.</li>
              <li>Snapshots live in this browser. Export the project to move it to another device or send it with a mail-in order.</li>
            </ul></div>
          </section>
        </div>
      </div>`;
    root.querySelector("#snap").addEventListener("click", () => {
      const name = root.querySelector("#snap-name").value.trim() || `Snapshot ${new Date().toLocaleTimeString()}`;
      store.snapshot(name, false); toast(`Snapshot pinned · ${name}`);
    });
    root.querySelector("#exp").addEventListener("click", () => download(`${slug(s.project.name)}-stagline.json`, store.exportProject(), "application/json"));
    const imp = root.querySelector("#imp");
    imp.addEventListener("change", async () => { try { store.importProject(await imp.files[0].text()); toast("Project imported."); } catch (e) { toast(e.message, "warn"); } });
    root.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => {
      const bk = store.backups.find((x) => x.id === b.dataset.restore);
      openModal(`<div class="modal-head"><h2 style="font-size:1.4rem">Restore “${fmt.esc(bk.label)}”?</h2><p class="muted">Your current state is snapshotted first, so you can come back to it.</p></div>
        <div class="modal-foot"><button class="btn btn-quiet" data-close>Cancel</button><button class="btn btn-primary" data-ok>Restore</button></div>`, {
        onMount(m, close) { m.querySelector("[data-ok]").addEventListener("click", () => { store.snapshot("Before restore", false); store.restore(bk.id); close(); toast("Restored."); }); },
      });
    }));
    root.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => { const bk = store.backups.find((x) => x.id === b.dataset.dl); download(`${slug(bk.label)}.json`, JSON.stringify({ app: "stagline", exported: bk.at, checksum: bk.crc, state: JSON.parse(bk.data) }, null, 2), "application/json"); }));
    root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { store.deleteBackup(b.dataset.del); toast("Snapshot deleted."); }));
  };
  draw();
  return store.on(() => draw());
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stagline";
