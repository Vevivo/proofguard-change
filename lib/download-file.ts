export function downloadFile(name: string, text: string, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Keep bytes available long enough for browser download managers to consume.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
