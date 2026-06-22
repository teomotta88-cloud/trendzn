import { useState } from "react";
import { Pencil } from "lucide-react";

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
      <div className="flex h-full min-h-0 flex-col space-y-1.5">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="scrollbar-thin min-h-20 w-full flex-1 overflow-y-auto rounded-lg border border-border bg-background/60 px-2 py-1.5 text-[11px] leading-snug text-foreground outline-none focus:border-primary"
        />
        <div className="flex shrink-0 gap-1.5">
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
    <div className="group relative flex h-full min-h-0 flex-col">
      {value ? (
        <p className="scrollbar-thin min-h-0 flex-1 overflow-y-auto whitespace-pre-line pr-5 text-[11px] leading-snug">
          {value}
        </p>
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
