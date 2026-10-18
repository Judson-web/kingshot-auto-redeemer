export type ClipboardFeedbackDetail = { label?: string };

export async function copyToClipboard(value: string | number, label = "Text"): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable. Use a secure browser and copy the text manually.");
  }

  await navigator.clipboard.writeText(String(value));

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ClipboardFeedbackDetail>("ks-copy-success", {
        detail: { label: String(label || "Text").trim() || "Text" },
      }),
    );
  }
}
