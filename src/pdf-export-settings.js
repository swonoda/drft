const DEFAULTS = {
  separateTitle: false,
  titleParity: "odd",
  bodyParity: "even",
  cropMarks: false,
};

function parity(value, fallback) {
  return value === "odd" || value === "even" ? value : fallback;
}

export function readPdfExportSettings(storage, keys, defaults = {}) {
  const fallback = { ...DEFAULTS, ...defaults };
  return {
    separateTitle:
      storage.getItem(keys.separateTitle) === "true" ||
      (storage.getItem(keys.separateTitle) === null && fallback.separateTitle),
    titleParity: parity(
      storage.getItem(keys.titleParity),
      fallback.titleParity,
    ),
    bodyParity: parity(storage.getItem(keys.bodyParity), fallback.bodyParity),
    cropMarks:
      storage.getItem(keys.cropMarks) === "true" ||
      (storage.getItem(keys.cropMarks) === null && fallback.cropMarks),
  };
}

export function writePdfExportSettings(storage, keys, settings) {
  for (const key of Object.keys(DEFAULTS)) {
    storage.setItem(keys[key], String(settings[key]));
  }
  return settings;
}

export function createPdfExportSettingsController({
  controls,
  keys,
  defaults,
  storage = localStorage,
}) {
  const syncTitleControl = () => {
    controls.titleParity.disabled = !controls.separateTitle.checked;
  };
  const readControls = () => ({
    separateTitle: controls.separateTitle.checked,
    titleParity: controls.titleParity.value,
    bodyParity: controls.bodyParity.value,
    cropMarks: controls.cropMarks.checked,
  });
  const load = () => {
    const settings = readPdfExportSettings(storage, keys, defaults);
    controls.separateTitle.checked = settings.separateTitle;
    controls.titleParity.value = settings.titleParity;
    controls.bodyParity.value = settings.bodyParity;
    controls.cropMarks.checked = settings.cropMarks;
    syncTitleControl();
    return settings;
  };
  const save = () => writePdfExportSettings(storage, keys, readControls());

  controls.separateTitle.addEventListener("change", syncTitleControl);
  return { load, save, read: readControls, syncTitleControl };
}
