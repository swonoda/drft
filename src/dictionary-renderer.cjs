const $ = (id) => document.getElementById(id);
let entries = [];
let selected = -1;
let dirty = false;

function parseDictionary(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const parsed = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      if (current) {
        current.description = current.description.join("\n").trim();
        parsed.push(current);
      }
      current = { heading: match[1].trim(), description: [] };
    } else if (current) {
      current.description.push(line);
    }
  }
  if (current) {
    current.description = current.description.join("\n").trim();
    parsed.push(current);
  }
  return parsed;
}

function serializeDictionary(items) {
  return items
    .filter((entry) => entry.heading.trim())
    .map(
      (entry) => `# ${entry.heading.trim()}\n\n${entry.description.trim()}\n`,
    )
    .join("\n");
}

function renderList() {
  const query = $("filter").value.trim().toLowerCase();
  $("entryList").replaceChildren();
  entries.forEach((entry, index) => {
    if (
      query &&
      !`${entry.heading}\n${entry.description}`.toLowerCase().includes(query)
    )
      return;
    const item = document.createElement("div");
    item.className = `entry${index === selected ? " selected" : ""}`;
    item.textContent = entry.heading || "名称未設定";
    item.onclick = () => selectEntry(index, true);
    $("entryList").append(item);
  });
}

function selectEntry(index, find = false) {
  selected = index;
  const entry = entries[index];
  $("detail").classList.toggle("empty", !entry);
  if (!entry) return;
  $("heading").value = entry.heading;
  $("description").value = entry.description;
  renderList();
  if (find && entry.heading)
    window.dictionaryApi.findInManuscript(entry.heading);
}

function changed() {
  if (selected < 0) return;
  entries[selected] = {
    heading: $("heading").value,
    description: $("description").value,
  };
  $("saveState").textContent = "未保存";
  dirty = true;
  $("saveDictionary").disabled = false;
  renderList();
}

async function save() {
  $("saveState").textContent = "保存中…";
  try {
    if (!window.dictionaryApi) throw new Error("辞書APIを読み込めませんでした");
    await window.dictionaryApi.save(serializeDictionary(entries));
    $("saveState").textContent = "保存済み";
    dirty = false;
    $("saveDictionary").disabled = true;
  } catch (error) {
    $("saveState").textContent = `保存できません: ${error.message}`;
    $("saveDictionary").disabled = false;
  }
}

$("add").onclick = () => {
  entries.push({ heading: "新しい項目", description: "" });
  selectEntry(entries.length - 1);
  changed();
  $("heading").focus();
  $("heading").select();
};
$("remove").onclick = () => {
  if (
    selected < 0 ||
    !confirm(`「${entries[selected].heading}」を削除しますか？`)
  )
    return;
  entries.splice(selected, 1);
  selected = Math.min(selected, entries.length - 1);
  renderList();
  selectEntry(selected);
  $("saveState").textContent = "未保存";
  dirty = true;
  $("saveDictionary").disabled = false;
};
$("saveDictionary").onclick = save;
$("find").onclick = () => {
  if (selected >= 0 && entries[selected].heading)
    window.dictionaryApi.findInManuscript(entries[selected].heading);
};
$("filter").oninput = renderList;
$("heading").oninput = changed;
$("description").oninput = changed;
if (window.dictionaryApi) {
  window.dictionaryApi.onSaveRequest(save);
} else {
  $("saveState").textContent = "辞書APIを読み込めませんでした";
}

(async () => {
  if (!window.dictionaryApi) return;
  entries = parseDictionary(await window.dictionaryApi.load());
  renderList();
  if (entries.length) selectEntry(0);
})();
