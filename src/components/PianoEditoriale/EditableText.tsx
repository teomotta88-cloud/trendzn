import { useState } from "react";
import { Pencil } from "lucide-react";

const MAX_BOX_HEIGHT = "max-h-80";

export function EditableText({
  value,
  placeholder,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(value ?? "");
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-1.5">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={`${MAX_BOX_HEIGHT} min-h-20 w-full overflow-y-auto rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary`}
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Salvo…" : "Salva"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground"
          >
            Annulla
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      {value ? (
        <p className={`${MAX_BOX_HEIGHT} overflow-y-auto whitespace-pre-line pr-5`}>{value}</p>
      ) : (
        <span className="text-muted-foreground">{placeholder}</span>
      )}
      <button
        type="button"
        onClick={startEdit}
        className="absolute right-0 top-0 rounded-md p-1 text-muted-foreground opacity-0 transition hover:text-primary group-hover:opacity-100"
        title="Modifica"
      >
        <Pencil className="size-3" />
      </button>
    </div>
  );
}
