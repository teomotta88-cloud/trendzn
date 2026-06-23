// atob() decodifica il base64 in una stringa dove ogni char è un byte: se il
// contenuto originale è UTF-8 multi-byte (es. accenti), va riassemblato con
// TextDecoder, altrimenti caratteri come "è" diventano "Ã¨".
export function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}
