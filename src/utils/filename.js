export function sanitizeFilename(name) {

  return name.替换(/[\\/:*?"<>|]/g, "_").substring(0, 50);

}
