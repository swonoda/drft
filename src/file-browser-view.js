export function createFileBrowser({ root, desktop, openFile }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const list = $("fileEntries"),
    status = $("fileStatus"),
    location = $("fileLocation");
  const up = $("fileUp"),
    refresh = $("fileRefresh");
  let folder = null,
    currentFile = null,
    visible = false,
    loading = false,
    opening = false,
    request = 0;

  function render() {
    const busy = loading || opening;
    location.textContent = folder?.name || "";
    location.title = folder?.path || "";
    up.disabled = busy || !folder?.parent;
    refresh.disabled = busy;
    root.setAttribute("aria-busy", String(busy));
    list.replaceChildren();
    for (const entry of folder?.entries || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file-entry";
      const directory = entry.kind === "directory";
      const selected = entry.path === currentFile;
      button.classList.toggle("current", selected);
      if (selected) button.setAttribute("aria-current", "true");
      button.disabled = busy || (!directory && !entry.canOpen);
      button.title =
        entry.path +
        (!directory && !entry.canOpen ? "（TXTファイルのみ開けます）" : "");
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      const shape = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      shape.setAttribute(
        "d",
        directory
          ? "M3 7V4h7l2 3h9v13H3Z"
          : "M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6",
      );
      icon.append(shape);
      const name = document.createElement("span");
      name.textContent = entry.name;
      button.append(icon, name);
      button.onclick = async () => {
        if (directory) return load(() => desktop.listDirectory(entry.path));
        if (selected || busy) return;
        opening = true;
        render();
        try {
          await openFile(entry.path);
        } catch (error) {
          status.textContent = `ファイルを開けません: ${error.message}`;
        } finally {
          opening = false;
          render();
        }
      };
      list.append(button);
    }
  }
  async function load(action) {
    const token = ++request;
    loading = true;
    status.textContent = "読み込み中…";
    render();
    try {
      const result = await action();
      if (token !== request) return;
      if (result) folder = result;
      status.textContent =
        folder && !folder.entries.length ? "このフォルダは空です" : "";
    } catch (error) {
      if (token !== request) return;
      status.textContent = `フォルダを開けません: ${error.message}`;
    } finally {
      if (token === request) {
        loading = false;
        render();
      }
    }
  }
  const reload = () => load(() => desktop.listDirectory(folder?.path));
  up.onclick = () =>
    folder?.parent && load(() => desktop.listDirectory(folder.parent));
  refresh.onclick = reload;
  render();
  return {
    setVisible(value) {
      const changed = visible !== value;
      visible = value;
      if (visible && changed) void reload();
    },
    setCurrentFile(file) {
      if (file === currentFile) return;
      currentFile = file;
      if (file) {
        folder = null;
        ++request;
        loading = false;
      }
      render();
      if (visible && file) void reload();
    },
  };
}
