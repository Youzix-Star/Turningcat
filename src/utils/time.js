export function formatDate(timestamp) {

  const date = new Date((timestamp + 8 * 3600) * 1000);

  const yy = date.getUTCFullYear().toString().slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");

  return `${yy}.${mm}.${dd} ${hh}:${min}:${ss}`;

}
